"""
Planning Agent - Specialized agent for task decomposition, strategy formation, and project planning
"""

import asyncio
import uuid
from typing import Dict, Any, List, Optional, Union, Tuple
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from enum import Enum

from langchain_core.messages import HumanMessage, AIMessage, SystemMessage
from ..base_agent import BaseAgent, AgentState, AgentStatus

class TaskPriority(Enum):
    LOW = 1
    MEDIUM = 2
    HIGH = 3
    CRITICAL = 4

class TaskStatus(Enum):
    PLANNED = "planned"
    IN_PROGRESS = "in_progress" 
    BLOCKED = "blocked"
    COMPLETED = "completed"
    CANCELLED = "cancelled"

@dataclass
class Task:
    """Represents a task in the planning system"""
    task_id: str
    title: str
    description: str
    priority: TaskPriority
    status: TaskStatus
    estimated_duration: Optional[int] = None  # in minutes
    dependencies: List[str] = field(default_factory=list)  # task_ids
    assigned_agent: Optional[str] = None
    created_at: datetime = field(default_factory=datetime.now)
    due_date: Optional[datetime] = None
    progress: float = 0.0  # 0-1
    metadata: Dict[str, Any] = field(default_factory=dict)
    subtasks: List['Task'] = field(default_factory=list)

@dataclass  
class Project:
    """Represents a project containing multiple tasks"""
    project_id: str
    name: str
    description: str
    tasks: List[Task] = field(default_factory=list)
    start_date: datetime = field(default_factory=datetime.now)
    end_date: Optional[datetime] = None
    status: str = "active"
    owner: Optional[str] = None
    metadata: Dict[str, Any] = field(default_factory=dict)

@dataclass
class Strategy:
    """Represents a strategic approach"""
    strategy_id: str
    name: str
    description: str
    objectives: List[str]
    key_actions: List[str]
    success_metrics: List[str]
    timeline: str
    confidence_level: float
    created_at: datetime = field(default_factory=datetime.now)

class PlanningAgent(BaseAgent):
    """
    Specialized agent for planning and strategy:
    - Task decomposition
    - Project planning
    - Strategy formation
    - Resource allocation
    - Timeline optimization
    - Risk assessment
    """
    
    def __init__(self, llm_manager, config: Dict[str, Any]):
        super().__init__(
            name="PlanningAgent",
            llm_manager=llm_manager, 
            config=config
        )
        
        # Planning configuration
        self.max_task_depth = config.get('max_task_depth', 5)
        self.default_estimation_buffer = config.get('estimation_buffer', 0.2)  # 20% buffer
        self.max_parallel_tasks = config.get('max_parallel_tasks', 10)
        
        # Planning state
        self.projects: Dict[str, Project] = {}
        self.tasks: Dict[str, Task] = {}
        self.strategies: Dict[str, Strategy] = {}
        
        # Planning algorithms
        self.decomposition_strategies = {
            'hierarchical': self._hierarchical_decomposition,
            'temporal': self._temporal_decomposition,
            'dependency_based': self._dependency_decomposition,
            'resource_based': self._resource_decomposition
        }
        
        # Estimation models
        self.estimation_methods = {
            'expert': self._expert_estimation,
            'historical': self._historical_estimation,
            'parametric': self._parametric_estimation,
            'analogous': self._analogous_estimation
        }
    
    async def _plan_action(self, state: AgentState, context: Dict[str, Any]) -> Dict[str, Any]:
        """Plan planning-related actions"""
        task = state.current_task
        task_type = self._classify_planning_task(task)
        
        plan = {
            'task_type': task_type,
            'context': {},
            'metadata': {
                'task_classification': task_type,
                'planning_iteration': state.iteration
            }
        }
        
        if task_type == 'decompose_task':
            plan['context'] = await self._plan_task_decomposition(task, context)
        elif task_type == 'create_project':
            plan['context'] = await self._plan_project_creation(task, context)
        elif task_type == 'develop_strategy':
            plan['context'] = await self._plan_strategy_development(task, context)
        elif task_type == 'estimate_effort':
            plan['context'] = await self._plan_effort_estimation(task, context)
        elif task_type == 'optimize_schedule':
            plan['context'] = await self._plan_schedule_optimization(task, context)
        elif task_type == 'assess_risk':
            plan['context'] = await self._plan_risk_assessment(task, context)
        else:
            plan['context'] = {'approach': 'general_planning'}
        
        return plan
    
    async def _execute_action(self, state: AgentState) -> Dict[str, Any]:
        """Execute planning-related actions"""
        task_type = state.context.get('task_type')
        
        try:
            if task_type == 'decompose_task':
                return await self._execute_task_decomposition(state)
            elif task_type == 'create_project':
                return await self._execute_project_creation(state)
            elif task_type == 'develop_strategy':
                return await self._execute_strategy_development(state)
            elif task_type == 'estimate_effort':
                return await self._execute_effort_estimation(state)
            elif task_type == 'optimize_schedule':
                return await self._execute_schedule_optimization(state)
            elif task_type == 'assess_risk':
                return await self._execute_risk_assessment(state)
            else:
                return await self._execute_general_planning(state)
                
        except Exception as e:
            return {
                'success': False,
                'error': str(e),
                'tools_used': ['planning_agent_internal']
            }
    
    def _classify_planning_task(self, task: str) -> str:
        """Classify the type of planning task"""
        task_lower = task.lower()
        
        if any(word in task_lower for word in ['decompose', 'break down', 'split', 'divide']):
            return 'decompose_task'
        elif any(word in task_lower for word in ['project', 'plan project', 'create project']):
            return 'create_project'
        elif any(word in task_lower for word in ['strategy', 'approach', 'methodology']):
            return 'develop_strategy'
        elif any(word in task_lower for word in ['estimate', 'effort', 'time', 'duration']):
            return 'estimate_effort'
        elif any(word in task_lower for word in ['schedule', 'timeline', 'optimize', 'sequence']):
            return 'optimize_schedule'
        elif any(word in task_lower for word in ['risk', 'assess', 'analyze risk', 'identify risk']):
            return 'assess_risk'
        else:
            return 'general_planning'
    
    async def _plan_task_decomposition(self, task: str, context: Dict[str, Any]) -> Dict[str, Any]:
        """Plan task decomposition strategy"""
        target_task = self._extract_target_task(task)
        decomposition_method = context.get('method', 'hierarchical')
        
        return {
            'approach': 'decompose_task',
            'target_task': target_task,
            'decomposition_method': decomposition_method,
            'max_depth': context.get('max_depth', self.max_task_depth),
            'consider_dependencies': True
        }
    
    async def _plan_project_creation(self, task: str, context: Dict[str, Any]) -> Dict[str, Any]:
        """Plan project creation"""
        project_scope = self._extract_project_scope(task)
        
        return {
            'approach': 'create_project',
            'project_scope': project_scope,
            'include_timeline': True,
            'assign_resources': context.get('assign_resources', True),
            'risk_analysis': context.get('risk_analysis', True)
        }
    
    async def _plan_strategy_development(self, task: str, context: Dict[str, Any]) -> Dict[str, Any]:
        """Plan strategy development"""
        strategy_domain = self._extract_strategy_domain(task)
        
        return {
            'approach': 'develop_strategy',
            'domain': strategy_domain,
            'time_horizon': context.get('time_horizon', 'medium_term'),
            'include_alternatives': True
        }
    
    async def _plan_effort_estimation(self, task: str, context: Dict[str, Any]) -> Dict[str, Any]:
        """Plan effort estimation"""
        estimation_target = self._extract_estimation_target(task)
        
        return {
            'approach': 'estimate_effort',
            'target': estimation_target,
            'estimation_method': context.get('method', 'expert'),
            'include_buffer': True,
            'consider_complexity': True
        }
    
    async def _plan_schedule_optimization(self, task: str, context: Dict[str, Any]) -> Dict[str, Any]:
        """Plan schedule optimization"""
        return {
            'approach': 'optimize_schedule',
            'project_id': context.get('project_id'),
            'optimization_criteria': context.get('criteria', ['time', 'resources', 'dependencies']),
            'constraints': context.get('constraints', [])
        }
    
    async def _plan_risk_assessment(self, task: str, context: Dict[str, Any]) -> Dict[str, Any]:
        """Plan risk assessment"""
        assessment_scope = self._extract_risk_scope(task)
        
        return {
            'approach': 'assess_risk',
            'scope': assessment_scope,
            'risk_categories': ['technical', 'schedule', 'resource', 'external'],
            'include_mitigation': True
        }
    
    async def _execute_task_decomposition(self, state: AgentState) -> Dict[str, Any]:
        """Execute task decomposition"""
        context = state.context
        target_task_desc = context.get('target_task', '')
        method = context.get('decomposition_method', 'hierarchical')
        max_depth = context.get('max_depth', self.max_task_depth)
        
        try:
            # Create the main task
            main_task = Task(
                task_id=str(uuid.uuid4()),
                title=target_task_desc,
                description=f"Main task: {target_task_desc}",
                priority=TaskPriority.MEDIUM,
                status=TaskStatus.PLANNED
            )
            
            # Decompose the task
            if method in self.decomposition_strategies:
                subtasks = await self.decomposition_strategies[method](
                    main_task, max_depth, 1
                )
                main_task.subtasks = subtasks
                
                # Store all tasks
                self.tasks[main_task.task_id] = main_task
                self._store_subtasks_recursive(main_task.subtasks)
                
                # Generate execution plan
                execution_plan = await self._generate_execution_plan(main_task)
                
                return {
                    'success': True,
                    'result': {
                        'main_task': main_task,
                        'total_subtasks': len(subtasks),
                        'execution_plan': execution_plan,
                        'estimated_duration': self._calculate_total_duration(main_task)
                    },
                    'message': f"Decomposed task into {len(subtasks)} subtasks using {method} method",
                    'tools_used': ['task_decomposition', 'execution_planning']
                }
            else:
                return {
                    'success': False,
                    'error': f"Unknown decomposition method: {method}",
                    'tools_used': ['task_decomposition']
                }
                
        except Exception as e:
            return {
                'success': False,
                'error': f"Task decomposition failed: {str(e)}",
                'tools_used': ['task_decomposition']
            }
    
    async def _execute_project_creation(self, state: AgentState) -> Dict[str, Any]:
        """Execute project creation"""
        context = state.context
        project_scope = context.get('project_scope', {})
        
        try:
            # Create project
            project = Project(
                project_id=str(uuid.uuid4()),
                name=project_scope.get('name', 'Unnamed Project'),
                description=project_scope.get('description', ''),
                start_date=datetime.now(),
                metadata=project_scope.get('metadata', {})
            )
            
            # Create initial tasks based on scope
            initial_tasks = await self._create_initial_tasks(project_scope)
            project.tasks = initial_tasks
            
            # Store tasks
            for task in initial_tasks:
                self.tasks[task.task_id] = task
            
            # Generate project timeline
            timeline = await self._generate_project_timeline(project)
            
            # Resource allocation if requested
            resource_plan = None
            if context.get('assign_resources', True):
                resource_plan = await self._create_resource_plan(project)
            
            # Risk analysis if requested
            risk_assessment = None
            if context.get('risk_analysis', True):
                risk_assessment = await self._assess_project_risks(project)
            
            # Store project
            self.projects[project.project_id] = project
            
            return {
                'success': True,
                'result': {
                    'project': project,
                    'timeline': timeline,
                    'resource_plan': resource_plan,
                    'risk_assessment': risk_assessment,
                    'total_tasks': len(initial_tasks)
                },
                'message': f"Created project '{project.name}' with {len(initial_tasks)} tasks",
                'tools_used': ['project_creation', 'timeline_generation', 'resource_planning']
            }
            
        except Exception as e:
            return {
                'success': False,
                'error': f"Project creation failed: {str(e)}",
                'tools_used': ['project_creation']
            }
    
    async def _execute_strategy_development(self, state: AgentState) -> Dict[str, Any]:
        """Execute strategy development"""
        context = state.context
        domain = context.get('domain', '')
        time_horizon = context.get('time_horizon', 'medium_term')
        
        try:
            # Analyze the domain and context
            domain_analysis = await self._analyze_strategy_domain(domain)
            
            # Generate strategic options
            strategic_options = await self._generate_strategic_options(domain, domain_analysis)
            
            # Evaluate options
            option_evaluations = await self._evaluate_strategic_options(strategic_options)
            
            # Select primary strategy
            primary_strategy = max(option_evaluations, key=lambda x: x['score'])
            
            # Create detailed strategy
            strategy = Strategy(
                strategy_id=str(uuid.uuid4()),
                name=primary_strategy['name'],
                description=primary_strategy['description'],
                objectives=primary_strategy['objectives'],
                key_actions=primary_strategy['key_actions'],
                success_metrics=primary_strategy['success_metrics'],
                timeline=time_horizon,
                confidence_level=primary_strategy['confidence']
            )
            
            # Generate implementation plan
            implementation_plan = await self._create_implementation_plan(strategy)
            
            # Store strategy
            self.strategies[strategy.strategy_id] = strategy
            
            return {
                'success': True,
                'result': {
                    'strategy': strategy,
                    'alternatives': [opt for opt in option_evaluations if opt != primary_strategy],
                    'implementation_plan': implementation_plan,
                    'domain_analysis': domain_analysis
                },
                'message': f"Developed strategy for {domain} with {len(strategy.key_actions)} key actions",
                'tools_used': ['strategy_development', 'option_evaluation', 'implementation_planning']
            }
            
        except Exception as e:
            return {
                'success': False,
                'error': f"Strategy development failed: {str(e)}",
                'tools_used': ['strategy_development']
            }
    
    async def _execute_effort_estimation(self, state: AgentState) -> Dict[str, Any]:
        """Execute effort estimation"""
        context = state.context
        target = context.get('target', '')
        method = context.get('estimation_method', 'expert')
        
        try:
            # Find or create task for estimation
            task_to_estimate = None
            if isinstance(target, dict) and 'task_id' in target:
                task_to_estimate = self.tasks.get(target['task_id'])
            else:
                # Create temporary task for estimation
                task_to_estimate = Task(
                    task_id='temp_estimate',
                    title=target,
                    description=f"Task for estimation: {target}",
                    priority=TaskPriority.MEDIUM,
                    status=TaskStatus.PLANNED
                )
            
            if not task_to_estimate:
                return {
                    'success': False,
                    'error': "Could not identify task for estimation",
                    'tools_used': ['effort_estimation']
                }
            
            # Apply estimation method
            estimation_result = None
            if method in self.estimation_methods:
                estimation_result = await self.estimation_methods[method](task_to_estimate)
            else:
                estimation_result = await self._expert_estimation(task_to_estimate)
            
            # Add buffer if requested
            if context.get('include_buffer', True):
                buffered_estimate = estimation_result['base_estimate'] * (1 + self.default_estimation_buffer)
                estimation_result['buffered_estimate'] = buffered_estimate
            
            # Update task if it exists in storage
            if task_to_estimate.task_id in self.tasks:
                self.tasks[task_to_estimate.task_id].estimated_duration = estimation_result.get('buffered_estimate', estimation_result['base_estimate'])
            
            return {
                'success': True,
                'result': estimation_result,
                'message': f"Estimated effort using {method} method: {estimation_result['base_estimate']} minutes",
                'tools_used': ['effort_estimation', f'{method}_estimation']
            }
            
        except Exception as e:
            return {
                'success': False,
                'error': f"Effort estimation failed: {str(e)}",
                'tools_used': ['effort_estimation']
            }
    
    async def _execute_schedule_optimization(self, state: AgentState) -> Dict[str, Any]:
        """Execute schedule optimization"""
        context = state.context
        project_id = context.get('project_id')
        criteria = context.get('optimization_criteria', ['time', 'resources'])
        
        try:
            if not project_id or project_id not in self.projects:
                return {
                    'success': False,
                    'error': "Project not found for optimization",
                    'tools_used': ['schedule_optimization']
                }
            
            project = self.projects[project_id]
            
            # Analyze current schedule
            current_schedule = await self._analyze_current_schedule(project)
            
            # Identify optimization opportunities
            opportunities = await self._identify_optimization_opportunities(project, criteria)
            
            # Generate optimized schedule
            optimized_schedule = await self._generate_optimized_schedule(project, opportunities)
            
            # Calculate improvements
            improvements = await self._calculate_schedule_improvements(current_schedule, optimized_schedule)
            
            return {
                'success': True,
                'result': {
                    'current_schedule': current_schedule,
                    'optimized_schedule': optimized_schedule,
                    'improvements': improvements,
                    'optimization_opportunities': opportunities
                },
                'message': f"Optimized schedule with {len(improvements)} improvements",
                'tools_used': ['schedule_optimization', 'improvement_calculation']
            }
            
        except Exception as e:
            return {
                'success': False,
                'error': f"Schedule optimization failed: {str(e)}",
                'tools_used': ['schedule_optimization']
            }
    
    async def _execute_risk_assessment(self, state: AgentState) -> Dict[str, Any]:
        """Execute risk assessment"""
        context = state.context
        scope = context.get('scope', {})
        risk_categories = context.get('risk_categories', ['technical', 'schedule', 'resource'])
        
        try:
            identified_risks = []
            
            # Identify risks by category
            for category in risk_categories:
                category_risks = await self._identify_risks_by_category(scope, category)
                identified_risks.extend(category_risks)
            
            # Assess risk impact and probability
            risk_assessments = []
            for risk in identified_risks:
                assessment = await self._assess_individual_risk(risk)
                risk_assessments.append(assessment)
            
            # Prioritize risks
            prioritized_risks = sorted(risk_assessments, key=lambda r: r['risk_score'], reverse=True)
            
            # Generate mitigation strategies
            mitigation_strategies = []
            if context.get('include_mitigation', True):
                for risk in prioritized_risks[:5]:  # Top 5 risks
                    mitigation = await self._generate_mitigation_strategy(risk)
                    mitigation_strategies.append(mitigation)
            
            # Create risk matrix
            risk_matrix = await self._create_risk_matrix(risk_assessments)
            
            return {
                'success': True,
                'result': {
                    'identified_risks': identified_risks,
                    'risk_assessments': risk_assessments,
                    'prioritized_risks': prioritized_risks,
                    'mitigation_strategies': mitigation_strategies,
                    'risk_matrix': risk_matrix,
                    'total_risk_score': sum(r['risk_score'] for r in risk_assessments)
                },
                'message': f"Assessed {len(identified_risks)} risks across {len(risk_categories)} categories",
                'tools_used': ['risk_assessment', 'mitigation_planning', 'risk_matrix']
            }
            
        except Exception as e:
            return {
                'success': False,
                'error': f"Risk assessment failed: {str(e)}",
                'tools_used': ['risk_assessment']
            }
    
    async def _execute_general_planning(self, state: AgentState) -> Dict[str, Any]:
        """Execute general planning task"""
        task = state.current_task
        
        # Use LLM for general planning advice
        prompt = SystemMessage(content=f"""
        You are a planning expert. Help with this planning task:
        {task}
        
        Consider:
        - Task breakdown and dependencies
        - Resource requirements
        - Timeline estimation
        - Risk identification
        - Success criteria
        
        Provide a structured planning approach.
        """)
        
        try:
            response = await self.llm_manager.agenerate([prompt])
            
            return {
                'success': True,
                'result': {
                    'planning_advice': response.text,
                    'task': task
                },
                'message': "Generated planning advice for general task",
                'tools_used': ['llm_planning_advice']
            }
            
        except Exception as e:
            return {
                'success': False,
                'error': str(e),
                'tools_used': ['llm_planning_advice']
            }
    
    # Decomposition strategy implementations
    async def _hierarchical_decomposition(self, task: Task, max_depth: int, current_depth: int) -> List[Task]:
        """Hierarchical task decomposition"""
        if current_depth >= max_depth:
            return []
        
        # Use LLM to break down the task
        prompt = SystemMessage(content=f"""
        Break down this task hierarchically:
        Task: {task.title}
        Description: {task.description}
        
        Provide 3-5 subtasks that are:
        - Specific and actionable
        - Properly scoped for the current level
        - Logically ordered
        
        Format as JSON: {{"subtasks": [{{"title": "...", "description": "...", "priority": "medium", "estimated_minutes": 60}}]}}
        """)
        
        try:
            response = await self.llm_manager.agenerate([prompt])
            import json
            subtask_data = json.loads(response.text)
            
            subtasks = []
            for i, sub_data in enumerate(subtask_data.get('subtasks', [])):
                subtask = Task(
                    task_id=f"{task.task_id}_sub_{i}",
                    title=sub_data['title'],
                    description=sub_data['description'],
                    priority=self._parse_priority(sub_data.get('priority', 'medium')),
                    status=TaskStatus.PLANNED,
                    estimated_duration=sub_data.get('estimated_minutes', 60)
                )
                
                # Recursive decomposition
                if current_depth + 1 < max_depth:
                    subtask.subtasks = await self._hierarchical_decomposition(
                        subtask, max_depth, current_depth + 1
                    )
                
                subtasks.append(subtask)
            
            return subtasks
            
        except Exception as e:
            # Fallback to basic decomposition
            return self._basic_decomposition(task)
    
    async def _temporal_decomposition(self, task: Task, max_depth: int, current_depth: int) -> List[Task]:
        """Temporal/sequential task decomposition"""
        if current_depth >= max_depth:
            return []
        
        # Create time-based subtasks
        phases = ['Planning', 'Execution', 'Review']
        subtasks = []
        
        for i, phase in enumerate(phases):
            subtask = Task(
                task_id=f"{task.task_id}_{phase.lower()}",
                title=f"{phase}: {task.title}",
                description=f"{phase} phase for {task.description}",
                priority=task.priority,
                status=TaskStatus.PLANNED,
                estimated_duration=task.estimated_duration // len(phases) if task.estimated_duration else 60
            )
            
            if i > 0:  # Add dependency on previous phase
                subtask.dependencies.append(subtasks[i-1].task_id)
            
            subtasks.append(subtask)
        
        return subtasks
    
    async def _dependency_decomposition(self, task: Task, max_depth: int, current_depth: int) -> List[Task]:
        """Dependency-based task decomposition"""
        if current_depth >= max_depth:
            return []
        
        # Identify logical dependencies
        dependency_groups = [
            'Prerequisites',
            'Core Work',
            'Integration',
            'Testing'
        ]
        
        subtasks = []
        for i, group in enumerate(dependency_groups):
            subtask = Task(
                task_id=f"{task.task_id}_{group.lower().replace(' ', '_')}",
                title=f"{group}: {task.title}",
                description=f"{group} activities for {task.description}",
                priority=task.priority,
                status=TaskStatus.PLANNED,
                estimated_duration=task.estimated_duration // len(dependency_groups) if task.estimated_duration else 45
            )
            
            # Add dependencies
            if i > 0:
                subtask.dependencies.extend([st.task_id for st in subtasks])
            
            subtasks.append(subtask)
        
        return subtasks
    
    async def _resource_decomposition(self, task: Task, max_depth: int, current_depth: int) -> List[Task]:
        """Resource-based task decomposition"""
        if current_depth >= max_depth:
            return []
        
        # Decompose by resource type/skill
        resource_types = ['Research', 'Design', 'Implementation', 'Testing']
        subtasks = []
        
        for resource_type in resource_types:
            subtask = Task(
                task_id=f"{task.task_id}_{resource_type.lower()}",
                title=f"{resource_type}: {task.title}",
                description=f"{resource_type} work for {task.description}",
                priority=task.priority,
                status=TaskStatus.PLANNED,
                estimated_duration=task.estimated_duration // len(resource_types) if task.estimated_duration else 90,
                metadata={'resource_type': resource_type}
            )
            subtasks.append(subtask)
        
        return subtasks
    
    # Estimation method implementations
    async def _expert_estimation(self, task: Task) -> Dict[str, Any]:
        """Expert-based estimation using LLM"""
        prompt = SystemMessage(content=f"""
        As an expert estimator, estimate the effort for this task:
        Task: {task.title}
        Description: {task.description}
        
        Consider:
        - Complexity level
        - Required skills
        - Dependencies
        - Risk factors
        
        Provide estimate in minutes with reasoning.
        Format: {{"base_estimate": 120, "confidence": 0.8, "reasoning": "...", "factors": ["complexity", "skills"]}}
        """)
        
        try:
            response = await self.llm_manager.agenerate([prompt])
            import json
            return json.loads(response.text)
        except:
            # Fallback estimation
            return {
                'base_estimate': 120,
                'confidence': 0.6,
                'reasoning': 'Default estimation applied',
                'factors': ['unknown']
            }
    
    async def _historical_estimation(self, task: Task) -> Dict[str, Any]:
        """Historical data-based estimation"""
        # Find similar tasks from history
        similar_tasks = self._find_similar_tasks(task)
        
        if similar_tasks:
            estimates = [t.estimated_duration for t in similar_tasks if t.estimated_duration]
            if estimates:
                avg_estimate = sum(estimates) / len(estimates)
                return {
                    'base_estimate': avg_estimate,
                    'confidence': 0.9,
                    'reasoning': f'Based on {len(estimates)} similar historical tasks',
                    'factors': ['historical_data']
                }
        
        # Fallback to expert estimation
        return await self._expert_estimation(task)
    
    async def _parametric_estimation(self, task: Task) -> Dict[str, Any]:
        """Parametric estimation using task parameters"""
        # Simple parametric model
        base_time = 60  # Base 1 hour
        
        # Complexity multiplier
        complexity_multiplier = 1.0
        if 'complex' in task.description.lower():
            complexity_multiplier = 2.0
        elif 'simple' in task.description.lower():
            complexity_multiplier = 0.5
        
        # Priority multiplier
        priority_multiplier = {
            TaskPriority.LOW: 0.8,
            TaskPriority.MEDIUM: 1.0,
            TaskPriority.HIGH: 1.3,
            TaskPriority.CRITICAL: 1.5
        }.get(task.priority, 1.0)
        
        estimate = base_time * complexity_multiplier * priority_multiplier
        
        return {
            'base_estimate': estimate,
            'confidence': 0.7,
            'reasoning': f'Parametric: base={base_time}, complexity={complexity_multiplier}, priority={priority_multiplier}',
            'factors': ['complexity', 'priority']
        }
    
    async def _analogous_estimation(self, task: Task) -> Dict[str, Any]:
        """Analogous estimation using similar completed tasks"""
        # Find the most similar completed task
        completed_tasks = [t for t in self.tasks.values() if t.status == TaskStatus.COMPLETED]
        
        if not completed_tasks:
            return await self._expert_estimation(task)
        
        # Simple similarity based on title word overlap
        best_match = max(completed_tasks, key=lambda t: self._calculate_task_similarity(task, t))
        similarity_score = self._calculate_task_similarity(task, best_match)
        
        if similarity_score > 0.3 and best_match.estimated_duration:
            return {
                'base_estimate': best_match.estimated_duration,
                'confidence': similarity_score,
                'reasoning': f'Analogous to completed task: {best_match.title}',
                'factors': ['analogous_task', 'similarity']
            }
        
        return await self._expert_estimation(task)
    
    # Helper methods
    def _basic_decomposition(self, task: Task) -> List[Task]:
        """Basic fallback decomposition"""
        return [
            Task(
                task_id=f"{task.task_id}_prepare",
                title=f"Prepare for {task.title}",
                description=f"Preparation activities for {task.description}",
                priority=task.priority,
                status=TaskStatus.PLANNED,
                estimated_duration=30
            ),
            Task(
                task_id=f"{task.task_id}_execute",
                title=f"Execute {task.title}",
                description=f"Main execution of {task.description}",
                priority=task.priority,
                status=TaskStatus.PLANNED,
                estimated_duration=90
            ),
            Task(
                task_id=f"{task.task_id}_finalize",
                title=f"Finalize {task.title}",
                description=f"Finalization activities for {task.description}",
                priority=task.priority,
                status=TaskStatus.PLANNED,
                estimated_duration=30
            )
        ]
    
    def _store_subtasks_recursive(self, subtasks: List[Task]):
        """Recursively store subtasks"""
        for subtask in subtasks:
            self.tasks[subtask.task_id] = subtask
            if subtask.subtasks:
                self._store_subtasks_recursive(subtask.subtasks)
    
    def _calculate_total_duration(self, task: Task) -> int:
        """Calculate total duration including subtasks"""
        total = task.estimated_duration or 0
        
        for subtask in task.subtasks:
            total += self._calculate_total_duration(subtask)
        
        return total
    
    def _parse_priority(self, priority_str: str) -> TaskPriority:
        """Parse priority string to enum"""
        priority_map = {
            'low': TaskPriority.LOW,
            'medium': TaskPriority.MEDIUM,
            'high': TaskPriority.HIGH,
            'critical': TaskPriority.CRITICAL
        }
        return priority_map.get(priority_str.lower(), TaskPriority.MEDIUM)
    
    def _find_similar_tasks(self, task: Task) -> List[Task]:
        """Find similar tasks in the task database"""
        similar_tasks = []
        
        for stored_task in self.tasks.values():
            if stored_task.task_id != task.task_id:
                similarity = self._calculate_task_similarity(task, stored_task)
                if similarity > 0.4:  # 40% similarity threshold
                    similar_tasks.append(stored_task)
        
        return sorted(similar_tasks, key=lambda t: self._calculate_task_similarity(task, t), reverse=True)
    
    def _calculate_task_similarity(self, task1: Task, task2: Task) -> float:
        """Calculate similarity between two tasks"""
        # Simple word-based similarity
        words1 = set(task1.title.lower().split() + task1.description.lower().split())
        words2 = set(task2.title.lower().split() + task2.description.lower().split())
        
        if not words1 or not words2:
            return 0.0
        
        intersection = len(words1 & words2)
        union = len(words1 | words2)
        
        return intersection / union if union > 0 else 0.0
    
    # Placeholder implementations for various planning methods
    def _extract_target_task(self, task_desc: str) -> str:
        """Extract target task from description"""
        # Look for quoted task or task after "decompose"
        import re
        quoted_match = re.search(r'"([^"]*)"', task_desc)
        if quoted_match:
            return quoted_match.group(1)
        
        decompose_match = re.search(r'decompose\s+(.+)', task_desc, re.IGNORECASE)
        if decompose_match:
            return decompose_match.group(1)
        
        return task_desc.strip()
    
    def _extract_project_scope(self, task: str) -> Dict[str, Any]:
        """Extract project scope from task description"""
        # Simple extraction - in production would be more sophisticated
        return {
            'name': 'New Project',
            'description': task,
            'metadata': {}
        }
    
    def _extract_strategy_domain(self, task: str) -> str:
        """Extract strategy domain from task"""
        domains = ['technology', 'business', 'product', 'marketing', 'operations']
        for domain in domains:
            if domain in task.lower():
                return domain
        return 'general'
    
    async def _generate_execution_plan(self, task: Task) -> Dict[str, Any]:
        """Generate execution plan for task"""
        return {
            'total_tasks': 1 + len(task.subtasks),
            'estimated_duration': self._calculate_total_duration(task),
            'critical_path': [task.task_id] + [st.task_id for st in task.subtasks[:3]],
            'parallel_opportunities': len([st for st in task.subtasks if not st.dependencies])
        }
    
    async def _create_initial_tasks(self, project_scope: Dict[str, Any]) -> List[Task]:
        """Create initial tasks for project"""
        return [
            Task(
                task_id=str(uuid.uuid4()),
                title="Project Setup",
                description="Initialize project structure and resources",
                priority=TaskPriority.HIGH,
                status=TaskStatus.PLANNED,
                estimated_duration=120
            ),
            Task(
                task_id=str(uuid.uuid4()),
                title="Requirements Analysis",
                description="Analyze and document project requirements",
                priority=TaskPriority.HIGH,
                status=TaskStatus.PLANNED,
                estimated_duration=180
            ),
            Task(
                task_id=str(uuid.uuid4()),
                title="Implementation",
                description="Core implementation work",
                priority=TaskPriority.MEDIUM,
                status=TaskStatus.PLANNED,
                estimated_duration=480
            )
        ]
    
    # Override evaluate progress for planning-specific evaluation
    async def _evaluate_progress(self, state: AgentState) -> Dict[str, Any]:
        """Evaluate progress specific to planning tasks"""
        if state.result is not None:
            result = state.result
            task_type = state.context.get('task_type')
            
            success_indicators = {
                'decompose_task': 'subtasks' in result or 'main_task' in result,
                'create_project': 'project' in result,
                'develop_strategy': 'strategy' in result,
                'estimate_effort': 'base_estimate' in result,
                'optimize_schedule': 'optimized_schedule' in result,
                'assess_risk': 'identified_risks' in result
            }
            
            if task_type in success_indicators and success_indicators[task_type]:
                return {'complete': True, 'success': True, 'quality': 'comprehensive'}
            
            return {'complete': True, 'success': True}
        
        return await super()._evaluate_progress(state)
    
    # Public interface methods
    async def decompose_task(self, task_description: str, method: str = 'hierarchical', max_depth: int = None) -> Dict[str, Any]:
        """Public method to decompose a task"""
        context = {
            'target_task': task_description,
            'method': method,
            'max_depth': max_depth or self.max_task_depth
        }
        return await self.execute(f"decompose {task_description}", context=context)
    
    async def create_project_plan(self, project_name: str, description: str, include_risks: bool = True) -> Dict[str, Any]:
        """Public method to create a project plan"""
        context = {
            'project_scope': {
                'name': project_name,
                'description': description
            },
            'risk_analysis': include_risks
        }
        return await self.execute(f"create project {project_name}", context=context)
    
    async def estimate_task_effort(self, task_description: str, method: str = 'expert') -> Dict[str, Any]:
        """Public method to estimate task effort"""
        context = {
            'target': task_description,
            'estimation_method': method
        }
        return await self.execute(f"estimate effort for {task_description}", context=context)
    
    def get_project_status(self, project_id: str) -> Optional[Dict[str, Any]]:
        """Get status of a specific project"""
        if project_id in self.projects:
            project = self.projects[project_id]
            completed_tasks = len([t for t in project.tasks if t.status == TaskStatus.COMPLETED])
            total_tasks = len(project.tasks)
            
            return {
                'project_id': project_id,
                'name': project.name,
                'status': project.status,
                'progress': completed_tasks / max(total_tasks, 1),
                'total_tasks': total_tasks,
                'completed_tasks': completed_tasks,
                'start_date': project.start_date.isoformat(),
                'estimated_completion': project.end_date.isoformat() if project.end_date else None
            }
        return None
    
    def get_planning_statistics(self) -> Dict[str, Any]:
        """Get planning agent statistics"""
        return {
            'total_projects': len(self.projects),
            'total_tasks': len(self.tasks),
            'total_strategies': len(self.strategies),
            'active_projects': len([p for p in self.projects.values() if p.status == 'active']),
            'completed_tasks': len([t for t in self.tasks.values() if t.status == TaskStatus.COMPLETED]),
            'task_completion_rate': len([t for t in self.tasks.values() if t.status == TaskStatus.COMPLETED]) / max(len(self.tasks), 1)
        }