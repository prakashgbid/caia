"""
Agent Supervisor - Orchestrates and coordinates multiple agents using LangGraph
"""

import asyncio
import uuid
from typing import Dict, Any, List, Optional, Callable, Union, Tuple
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from enum import Enum

from langgraph.graph import StateGraph, Graph
from langgraph.checkpoint.memory import MemorySaver
from langchain_core.messages import BaseMessage, HumanMessage, AIMessage, SystemMessage

from ..agents.base_agent import BaseAgent
from .communication import CommunicationHub, Message, MessageType
from .agent_registry import AgentRegistry

class TaskStatus(Enum):
    PENDING = "pending"
    ASSIGNED = "assigned"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    FAILED = "failed"
    DELEGATED = "delegated"

class TaskPriority(Enum):
    LOW = 1
    MEDIUM = 2
    HIGH = 3
    CRITICAL = 4

@dataclass
class SupervisorState:
    """State for the supervisor's LangGraph workflow"""
    current_task: Optional[str] = None
    assigned_agents: Dict[str, str] = field(default_factory=dict)  # task_id -> agent_id
    task_results: Dict[str, Any] = field(default_factory=dict)  # task_id -> result
    active_tasks: List[str] = field(default_factory=list)
    completed_tasks: List[str] = field(default_factory=list)
    failed_tasks: List[str] = field(default_factory=list)
    iteration: int = 0
    max_iterations: int = 50
    metadata: Dict[str, Any] = field(default_factory=dict)

@dataclass
class Task:
    """Represents a task to be executed by agents"""
    task_id: str
    description: str
    task_type: str
    priority: TaskPriority
    status: TaskStatus
    assigned_agent: Optional[str] = None
    required_capabilities: List[str] = field(default_factory=list)
    dependencies: List[str] = field(default_factory=list)  # task_ids
    context: Dict[str, Any] = field(default_factory=dict)
    result: Optional[Any] = None
    error: Optional[str] = None
    created_at: datetime = field(default_factory=datetime.now)
    assigned_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    timeout: Optional[timedelta] = None

@dataclass
class WorkflowStep:
    """Represents a step in a workflow"""
    step_id: str
    name: str
    agent_type: str
    task_description: str
    depends_on: List[str] = field(default_factory=list)
    parallel_with: List[str] = field(default_factory=list)
    context_mapping: Dict[str, str] = field(default_factory=dict)

class AgentSupervisor:
    """
    Agent Supervisor using LangGraph for orchestration
    Manages multiple specialized agents and coordinates their work
    """
    
    def __init__(self, llm_manager, config: Dict[str, Any]):
        self.llm_manager = llm_manager
        self.config = config
        
        # Core components
        self.agent_registry = AgentRegistry()
        self.communication_hub = CommunicationHub()
        self.memory = MemorySaver()
        
        # Task management
        self.tasks: Dict[str, Task] = {}
        self.active_workflows: Dict[str, Dict[str, Any]] = {}
        
        # Supervisor configuration
        self.max_concurrent_tasks = config.get('max_concurrent_tasks', 10)
        self.default_task_timeout = config.get('default_task_timeout_minutes', 30)
        self.delegation_threshold = config.get('delegation_threshold', 0.7)
        
        # Build supervisor workflow
        self.supervisor_graph = self._build_supervisor_graph()
        
        # Task assignment strategies
        self.assignment_strategies = {
            'capability_match': self._capability_based_assignment,
            'load_balance': self._load_balanced_assignment,
            'priority_based': self._priority_based_assignment,
            'specialization': self._specialization_based_assignment
        }
        
        # Monitoring
        self.performance_metrics = {
            'tasks_completed': 0,
            'tasks_failed': 0,
            'average_completion_time': 0.0,
            'agent_utilization': {},
            'workflow_success_rate': 0.0
        }
    
    def _build_supervisor_graph(self) -> Graph:
        """Build the LangGraph workflow for supervision"""
        workflow = StateGraph(SupervisorState)
        
        # Add nodes for supervisor workflow
        workflow.add_node("analyze_request", self._analyze_request_node)
        workflow.add_node("plan_execution", self._plan_execution_node)
        workflow.add_node("assign_tasks", self._assign_tasks_node)
        workflow.add_node("monitor_progress", self._monitor_progress_node)
        workflow.add_node("coordinate_agents", self._coordinate_agents_node)
        workflow.add_node("consolidate_results", self._consolidate_results_node)
        workflow.add_node("complete_workflow", self._complete_workflow_node)
        
        # Add edges
        workflow.add_edge("analyze_request", "plan_execution")
        workflow.add_edge("plan_execution", "assign_tasks")
        workflow.add_edge("assign_tasks", "monitor_progress")
        workflow.add_conditional_edges(
            "monitor_progress",
            self._should_continue_monitoring,
            {
                "coordinate": "coordinate_agents",
                "consolidate": "consolidate_results",
                "continue": "monitor_progress"
            }
        )
        workflow.add_edge("coordinate_agents", "monitor_progress")
        workflow.add_edge("consolidate_results", "complete_workflow")
        
        # Set entry point
        workflow.set_entry_point("analyze_request")
        
        # Compile with memory
        return workflow.compile(checkpointer=self.memory)
    
    async def _analyze_request_node(self, state: SupervisorState) -> SupervisorState:
        """Analyze incoming request and determine requirements"""
        try:
            request = state.current_task
            
            # Analyze the request using LLM
            analysis_prompt = SystemMessage(content=f"""
            Analyze this request and determine:
            1. Task type and complexity
            2. Required agent capabilities
            3. Estimated effort and timeline
            4. Dependencies and prerequisites
            5. Success criteria
            
            Request: {request}
            
            Respond with structured analysis in JSON format.
            """)
            
            response = await self.llm_manager.agenerate([analysis_prompt])
            
            # Parse analysis (simplified - in production would use proper JSON parsing)
            analysis = {
                'task_type': 'general',
                'complexity': 'medium',
                'required_capabilities': ['general'],
                'estimated_effort': 30,  # minutes
                'dependencies': [],
                'success_criteria': ['Task completed successfully']
            }
            
            state.metadata['request_analysis'] = analysis
            state.iteration += 1
            
        except Exception as e:
            state.metadata['analysis_error'] = str(e)
        
        return state
    
    async def _plan_execution_node(self, state: SupervisorState) -> SupervisorState:
        """Plan the execution strategy"""
        try:
            analysis = state.metadata.get('request_analysis', {})
            
            # Determine if task should be decomposed
            if analysis.get('complexity') in ['high', 'complex']:
                # Decompose into subtasks
                subtasks = await self._decompose_task(state.current_task, analysis)
                
                # Create tasks for each subtask
                for i, subtask_desc in enumerate(subtasks):
                    task = Task(
                        task_id=f"subtask_{i}_{uuid.uuid4().hex[:8]}",
                        description=subtask_desc,
                        task_type=analysis.get('task_type', 'general'),
                        priority=TaskPriority.MEDIUM,
                        status=TaskStatus.PENDING,
                        required_capabilities=analysis.get('required_capabilities', []),
                        timeout=timedelta(minutes=analysis.get('estimated_effort', 30))
                    )
                    self.tasks[task.task_id] = task
                    state.active_tasks.append(task.task_id)
            else:
                # Single task
                task = Task(
                    task_id=f"task_{uuid.uuid4().hex[:8]}",
                    description=state.current_task,
                    task_type=analysis.get('task_type', 'general'),
                    priority=TaskPriority.MEDIUM,
                    status=TaskStatus.PENDING,
                    required_capabilities=analysis.get('required_capabilities', []),
                    timeout=timedelta(minutes=analysis.get('estimated_effort', 30))
                )
                self.tasks[task.task_id] = task
                state.active_tasks.append(task.task_id)
            
            state.metadata['execution_plan'] = {
                'total_tasks': len(state.active_tasks),
                'decomposed': len(state.active_tasks) > 1,
                'strategy': 'parallel' if len(state.active_tasks) > 1 else 'single'
            }
            
        except Exception as e:
            state.metadata['planning_error'] = str(e)
        
        return state
    
    async def _assign_tasks_node(self, state: SupervisorState) -> SupervisorState:
        """Assign tasks to appropriate agents"""
        try:
            assignment_strategy = self.config.get('assignment_strategy', 'capability_match')
            
            for task_id in state.active_tasks:
                if task_id in self.tasks:
                    task = self.tasks[task_id]
                    
                    if task.status == TaskStatus.PENDING:
                        # Find suitable agent
                        if assignment_strategy in self.assignment_strategies:
                            agent_id = await self.assignment_strategies[assignment_strategy](task)
                        else:
                            agent_id = await self._capability_based_assignment(task)
                        
                        if agent_id:
                            # Assign task
                            task.assigned_agent = agent_id
                            task.status = TaskStatus.ASSIGNED
                            task.assigned_at = datetime.now()
                            state.assigned_agents[task_id] = agent_id
                            
                            # Send task to agent
                            await self._send_task_to_agent(agent_id, task)
                        else:
                            task.status = TaskStatus.FAILED
                            task.error = "No suitable agent found"
                            state.failed_tasks.append(task_id)
            
            state.metadata['assignment_results'] = {
                'assigned': len(state.assigned_agents),
                'failed_assignments': len(state.failed_tasks)
            }
            
        except Exception as e:
            state.metadata['assignment_error'] = str(e)
        
        return state
    
    async def _monitor_progress_node(self, state: SupervisorState) -> SupervisorState:
        """Monitor progress of assigned tasks"""
        try:
            # Check status of active tasks
            for task_id in list(state.active_tasks):
                task = self.tasks.get(task_id)
                if not task:
                    continue
                
                # Check for timeouts
                if task.assigned_at and task.timeout:
                    if datetime.now() - task.assigned_at > task.timeout:
                        task.status = TaskStatus.FAILED
                        task.error = "Task timeout"
                        state.active_tasks.remove(task_id)
                        state.failed_tasks.append(task_id)
                        continue
                
                # Check for completion
                agent_id = task.assigned_agent
                if agent_id and agent_id in self.agent_registry.agents:
                    agent = self.agent_registry.agents[agent_id]
                    
                    # Get task result (simplified - in production would have proper result checking)
                    if hasattr(agent, 'get_task_result'):
                        result = await agent.get_task_result(task_id)
                        if result:
                            task.result = result
                            task.status = TaskStatus.COMPLETED
                            task.completed_at = datetime.now()
                            state.active_tasks.remove(task_id)
                            state.completed_tasks.append(task_id)
                            state.task_results[task_id] = result
            
            state.metadata['monitoring_status'] = {
                'active': len(state.active_tasks),
                'completed': len(state.completed_tasks),
                'failed': len(state.failed_tasks)
            }
            
        except Exception as e:
            state.metadata['monitoring_error'] = str(e)
        
        return state
    
    async def _coordinate_agents_node(self, state: SupervisorState) -> SupervisorState:
        """Coordinate agents when needed"""
        try:
            # Check for coordination needs
            coordination_needed = await self._assess_coordination_needs(state)
            
            if coordination_needed:
                # Send coordination messages
                for coordination in coordination_needed:
                    await self.communication_hub.send_message(
                        Message(
                            message_id=str(uuid.uuid4()),
                            sender_id="supervisor",
                            recipient_id=coordination['agent_id'],
                            message_type=MessageType.COORDINATION,
                            content=coordination['message'],
                            metadata={'task_id': coordination.get('task_id')}
                        )
                    )
            
            state.metadata['coordination_actions'] = len(coordination_needed) if coordination_needed else 0
            
        except Exception as e:
            state.metadata['coordination_error'] = str(e)
        
        return state
    
    async def _consolidate_results_node(self, state: SupervisorState) -> SupervisorState:
        """Consolidate results from all completed tasks"""
        try:
            if state.task_results:
                # Consolidate results based on task relationships
                consolidated_result = await self._consolidate_task_results(state.task_results)
                state.metadata['consolidated_result'] = consolidated_result
            
            # Calculate success metrics
            total_tasks = len(state.completed_tasks) + len(state.failed_tasks)
            success_rate = len(state.completed_tasks) / total_tasks if total_tasks > 0 else 0
            
            state.metadata['final_metrics'] = {
                'success_rate': success_rate,
                'total_tasks': total_tasks,
                'completed_tasks': len(state.completed_tasks),
                'failed_tasks': len(state.failed_tasks),
                'total_iterations': state.iteration
            }
            
        except Exception as e:
            state.metadata['consolidation_error'] = str(e)
        
        return state
    
    async def _complete_workflow_node(self, state: SupervisorState) -> SupervisorState:
        """Complete the workflow"""
        try:
            # Update performance metrics
            self._update_performance_metrics(state)
            
            # Clean up completed tasks
            await self._cleanup_completed_tasks(state)
            
            state.metadata['workflow_completed'] = True
            
        except Exception as e:
            state.metadata['completion_error'] = str(e)
        
        return state
    
    def _should_continue_monitoring(self, state: SupervisorState) -> str:
        """Decide whether to continue monitoring or move to next phase"""
        # Check iteration limit
        if state.iteration >= state.max_iterations:
            return "consolidate"
        
        # If all tasks are done (completed or failed)
        if not state.active_tasks:
            return "consolidate"
        
        # If coordination is needed
        if self._needs_coordination(state):
            return "coordinate"
        
        # Continue monitoring
        return "continue"
    
    def _needs_coordination(self, state: SupervisorState) -> bool:
        """Check if agent coordination is needed"""
        # Simple heuristics for coordination needs
        
        # If multiple agents are working on related tasks
        active_agents = set(self.tasks[task_id].assigned_agent 
                          for task_id in state.active_tasks 
                          if task_id in self.tasks and self.tasks[task_id].assigned_agent)
        
        if len(active_agents) > 1:
            # Check for task dependencies or shared resources
            for task_id in state.active_tasks:
                task = self.tasks.get(task_id)
                if task and task.dependencies:
                    return True
        
        return False
    
    async def _decompose_task(self, task_description: str, analysis: Dict[str, Any]) -> List[str]:
        """Decompose a complex task into subtasks"""
        # Use LLM to decompose task
        decomposition_prompt = SystemMessage(content=f"""
        Break down this complex task into 3-5 smaller, manageable subtasks:
        
        Task: {task_description}
        Complexity: {analysis.get('complexity', 'medium')}
        Type: {analysis.get('task_type', 'general')}
        
        Each subtask should be:
        - Specific and actionable
        - Independent when possible
        - Logically ordered
        
        Return as a simple list of subtask descriptions.
        """)
        
        try:
            response = await self.llm_manager.agenerate([decomposition_prompt])
            # Parse response (simplified)
            subtasks = response.text.strip().split('\n')
            subtasks = [task.strip('- ').strip() for task in subtasks if task.strip()]
            return subtasks[:5]  # Limit to 5 subtasks
        except:
            # Fallback decomposition
            return [
                f"Analyze and plan: {task_description}",
                f"Execute main work: {task_description}",
                f"Review and finalize: {task_description}"
            ]
    
    async def _capability_based_assignment(self, task: Task) -> Optional[str]:
        """Assign task based on agent capabilities"""
        suitable_agents = []
        
        for agent_id, agent_info in self.agent_registry.get_all_agents().items():
            agent = agent_info['agent']
            capabilities = agent_info.get('capabilities', [])
            
            # Check if agent has required capabilities
            if any(cap in capabilities for cap in task.required_capabilities):
                # Check agent availability
                if self._is_agent_available(agent_id):
                    suitable_agents.append((agent_id, agent))
        
        if suitable_agents:
            # Select least loaded agent
            return min(suitable_agents, key=lambda x: self._get_agent_load(x[0]))[0]
        
        # Fallback: find any available general agent
        for agent_id, agent_info in self.agent_registry.get_all_agents().items():
            if self._is_agent_available(agent_id):
                return agent_id
        
        return None
    
    async def _load_balanced_assignment(self, task: Task) -> Optional[str]:
        """Assign task based on agent load balancing"""
        available_agents = [
            (agent_id, self._get_agent_load(agent_id))
            for agent_id in self.agent_registry.get_all_agents().keys()
            if self._is_agent_available(agent_id)
        ]
        
        if available_agents:
            # Select agent with lowest load
            return min(available_agents, key=lambda x: x[1])[0]
        
        return None
    
    async def _priority_based_assignment(self, task: Task) -> Optional[str]:
        """Assign task based on task priority and agent specialization"""
        if task.priority == TaskPriority.CRITICAL:
            # Assign to best available agent regardless of load
            best_agents = self._get_agents_by_specialization(task.task_type)
            for agent_id in best_agents:
                if self._is_agent_available(agent_id):
                    return agent_id
        
        # Use capability-based assignment for other priorities
        return await self._capability_based_assignment(task)
    
    async def _specialization_based_assignment(self, task: Task) -> Optional[str]:
        """Assign task based on agent specialization"""
        # Map task types to agent types
        task_agent_mapping = {
            'code': 'CodeAgent',
            'research': 'ResearchAgent',
            'planning': 'PlanningAgent',
            'decision': 'DecisionAgent',
            'learning': 'LearningAgent',
            'memory': 'MemoryAgent'
        }
        
        preferred_agent_type = task_agent_mapping.get(task.task_type, 'general')
        
        # Find agents of preferred type
        for agent_id, agent_info in self.agent_registry.get_all_agents().items():
            agent = agent_info['agent']
            if agent.name == preferred_agent_type and self._is_agent_available(agent_id):
                return agent_id
        
        # Fallback to any available agent
        return await self._capability_based_assignment(task)
    
    async def _send_task_to_agent(self, agent_id: str, task: Task):
        """Send task to assigned agent"""
        message = Message(
            message_id=str(uuid.uuid4()),
            sender_id="supervisor",
            recipient_id=agent_id,
            message_type=MessageType.TASK_ASSIGNMENT,
            content=task.description,
            metadata={
                'task_id': task.task_id,
                'task_type': task.task_type,
                'priority': task.priority.value,
                'context': task.context,
                'timeout': task.timeout.total_seconds() if task.timeout else None
            }
        )
        
        await self.communication_hub.send_message(message)
    
    def _is_agent_available(self, agent_id: str) -> bool:
        """Check if agent is available for new tasks"""
        # Simple availability check based on current load
        current_load = self._get_agent_load(agent_id)
        max_concurrent = self.config.get('max_concurrent_per_agent', 3)
        return current_load < max_concurrent
    
    def _get_agent_load(self, agent_id: str) -> int:
        """Get current load (number of active tasks) for agent"""
        active_tasks = sum(1 for task in self.tasks.values() 
                          if task.assigned_agent == agent_id and task.status in [TaskStatus.ASSIGNED, TaskStatus.IN_PROGRESS])
        return active_tasks
    
    def _get_agents_by_specialization(self, task_type: str) -> List[str]:
        """Get agents ordered by specialization for task type"""
        agents_with_scores = []
        
        for agent_id, agent_info in self.agent_registry.get_all_agents().items():
            agent = agent_info['agent']
            capabilities = agent_info.get('capabilities', [])
            
            # Calculate specialization score
            score = 0
            if task_type in capabilities:
                score += 10
            if agent.name.lower().startswith(task_type.lower()):
                score += 20
            
            # Add general capability score
            score += len(capabilities)
            
            agents_with_scores.append((agent_id, score))
        
        # Sort by score (highest first)
        agents_with_scores.sort(key=lambda x: x[1], reverse=True)
        return [agent_id for agent_id, _ in agents_with_scores]
    
    async def _assess_coordination_needs(self, state: SupervisorState) -> List[Dict[str, Any]]:
        """Assess if agent coordination is needed"""
        coordination_needed = []
        
        # Check for task dependencies
        for task_id in state.active_tasks:
            task = self.tasks.get(task_id)
            if not task or not task.assigned_agent:
                continue
            
            # Check if task depends on others
            for dep_task_id in task.dependencies:
                if dep_task_id in state.active_tasks:
                    dep_task = self.tasks.get(dep_task_id)
                    if dep_task and dep_task.assigned_agent and dep_task.assigned_agent != task.assigned_agent:
                        coordination_needed.append({
                            'agent_id': task.assigned_agent,
                            'message': f"Task {task_id} depends on task {dep_task_id} being completed by {dep_task.assigned_agent}",
                            'task_id': task_id,
                            'dependency_id': dep_task_id
                        })
        
        return coordination_needed
    
    async def _consolidate_task_results(self, task_results: Dict[str, Any]) -> Dict[str, Any]:
        """Consolidate results from multiple tasks"""
        if not task_results:
            return {}
        
        # Simple consolidation - combine all results
        consolidated = {
            'task_count': len(task_results),
            'individual_results': task_results,
            'summary': f"Completed {len(task_results)} tasks successfully",
            'combined_output': {}
        }
        
        # Try to merge results intelligently
        for task_id, result in task_results.items():
            if isinstance(result, dict):
                for key, value in result.items():
                    if key not in consolidated['combined_output']:
                        consolidated['combined_output'][key] = []
                    consolidated['combined_output'][key].append(value)
        
        return consolidated
    
    def _update_performance_metrics(self, state: SupervisorState):
        """Update supervisor performance metrics"""
        metrics = state.metadata.get('final_metrics', {})
        
        self.performance_metrics['tasks_completed'] += metrics.get('completed_tasks', 0)
        self.performance_metrics['tasks_failed'] += metrics.get('failed_tasks', 0)
        
        # Update success rate
        total = self.performance_metrics['tasks_completed'] + self.performance_metrics['tasks_failed']
        if total > 0:
            self.performance_metrics['workflow_success_rate'] = self.performance_metrics['tasks_completed'] / total
        
        # Update agent utilization
        for agent_id in state.assigned_agents.values():
            if agent_id not in self.performance_metrics['agent_utilization']:
                self.performance_metrics['agent_utilization'][agent_id] = 0
            self.performance_metrics['agent_utilization'][agent_id] += 1
    
    async def _cleanup_completed_tasks(self, state: SupervisorState):
        """Clean up completed tasks"""
        # Remove completed tasks older than configured retention period
        retention_hours = self.config.get('task_retention_hours', 24)
        cutoff_time = datetime.now() - timedelta(hours=retention_hours)
        
        tasks_to_remove = []
        for task_id, task in self.tasks.items():
            if (task.status in [TaskStatus.COMPLETED, TaskStatus.FAILED] and 
                task.completed_at and task.completed_at < cutoff_time):
                tasks_to_remove.append(task_id)
        
        for task_id in tasks_to_remove:
            del self.tasks[task_id]
    
    # Public interface methods
    async def execute_task(self, task_description: str, context: Dict[str, Any] = None) -> Dict[str, Any]:
        """Execute a task using the supervisor workflow"""
        initial_state = SupervisorState(
            current_task=task_description,
            metadata={'context': context or {}}
        )
        
        config_dict = {"configurable": {"thread_id": str(uuid.uuid4())}}
        
        try:
            # Execute supervisor workflow
            final_state = None
            async for state_update in self.supervisor_graph.astream(initial_state, config=config_dict):
                final_state = list(state_update.values())[0]
            
            if final_state:
                return {
                    'success': final_state.metadata.get('workflow_completed', False),
                    'result': final_state.metadata.get('consolidated_result'),
                    'metrics': final_state.metadata.get('final_metrics'),
                    'tasks_executed': len(final_state.completed_tasks),
                    'execution_time': final_state.iteration,
                    'error': final_state.metadata.get('error')
                }
            else:
                return {
                    'success': False,
                    'error': 'Workflow execution failed',
                    'result': None
                }
                
        except Exception as e:
            return {
                'success': False,
                'error': str(e),
                'result': None
            }
    
    def register_agent(self, agent: BaseAgent, capabilities: List[str] = None) -> str:
        """Register an agent with the supervisor"""
        return self.agent_registry.register_agent(agent, capabilities or [])
    
    def unregister_agent(self, agent_id: str) -> bool:
        """Unregister an agent"""
        return self.agent_registry.unregister_agent(agent_id)
    
    def get_agent_status(self) -> Dict[str, Any]:
        """Get status of all registered agents"""
        return self.agent_registry.get_agent_status()
    
    def get_task_status(self, task_id: str = None) -> Union[Dict[str, Any], List[Dict[str, Any]]]:
        """Get status of tasks"""
        if task_id:
            task = self.tasks.get(task_id)
            if task:
                return {
                    'task_id': task.task_id,
                    'description': task.description,
                    'status': task.status.value,
                    'assigned_agent': task.assigned_agent,
                    'created_at': task.created_at.isoformat(),
                    'completed_at': task.completed_at.isoformat() if task.completed_at else None,
                    'error': task.error
                }
            return None
        else:
            return [
                {
                    'task_id': task.task_id,
                    'description': task.description[:100],
                    'status': task.status.value,
                    'assigned_agent': task.assigned_agent
                }
                for task in self.tasks.values()
            ]
    
    def get_performance_metrics(self) -> Dict[str, Any]:
        """Get supervisor performance metrics"""
        return self.performance_metrics.copy()
    
    async def shutdown(self):
        """Shutdown supervisor and clean up resources"""
        # Cancel active tasks
        for task in self.tasks.values():
            if task.status in [TaskStatus.ASSIGNED, TaskStatus.IN_PROGRESS]:
                task.status = TaskStatus.FAILED
                task.error = "Supervisor shutdown"
        
        # Cleanup communication hub
        await self.communication_hub.shutdown()
        
        # Clear registrations
        self.agent_registry.clear_all()