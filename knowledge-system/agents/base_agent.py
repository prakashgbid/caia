"""
Base Agent - Foundation for all AI agents
Built on LangGraph for advanced workflows and state management
"""

import asyncio
import logging
import uuid
from typing import Dict, Any, List, Optional, Union, Callable
from dataclasses import dataclass, field
from datetime import datetime
from abc import ABC, abstractmethod
from enum import Enum

from langchain_core.messages import BaseMessage, HumanMessage, AIMessage
from langgraph.graph import Graph, StateGraph
from langgraph.checkpoint.memory import MemorySaver

logger = logging.getLogger(__name__)


class AgentStatus(Enum):
    IDLE = "idle"
    THINKING = "thinking"
    WORKING = "working"
    WAITING = "waiting"
    COMPLETED = "completed"
    FAILED = "failed"


@dataclass
class AgentState:
    """Agent state for LangGraph workflows"""
    messages: List[BaseMessage] = field(default_factory=list)
    current_task: Optional[str] = None
    context: Dict[str, Any] = field(default_factory=dict)
    tools_used: List[str] = field(default_factory=list)
    iteration: int = 0
    max_iterations: int = 10
    error_count: int = 0
    status: AgentStatus = AgentStatus.IDLE
    result: Optional[Any] = None
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class AgentResult:
    """Result from agent execution"""
    success: bool
    result: Any
    error: Optional[str] = None
    execution_time: float = 0.0
    iterations: int = 0
    tools_used: List[str] = field(default_factory=list)
    metadata: Dict[str, Any] = field(default_factory=dict)


class BaseAgent(ABC):
    """
    Base class for all AI agents
    Provides LangGraph integration, memory, and tool management
    """
    
    def __init__(self, 
                 name: str,
                 llm_manager: Any,
                 config: Dict[str, Any],
                 tools: Optional[List[Callable]] = None):
        
        self.name = name
        self.agent_id = str(uuid.uuid4())
        self.llm_manager = llm_manager
        self.config = config
        self.tools = tools or []
        
        # Agent configuration
        self.max_iterations = config.get('max_iterations', 10)
        self.timeout = config.get('timeout', 300)  # 5 minutes
        self.memory_enabled = config.get('memory_enabled', True)
        
        # State management
        self.memory = MemorySaver() if self.memory_enabled else None
        self.graph = None
        self.current_state = None
        
        # Statistics
        self.stats = {
            'tasks_completed': 0,
            'total_execution_time': 0.0,
            'average_execution_time': 0.0,
            'error_count': 0,
            'tools_usage': {}
        }
        
        # Build the agent graph
        self._build_graph()
        
        logger.info(f"Initialized agent {self.name} ({self.agent_id})")
    
    def _build_graph(self):
        """Build the LangGraph workflow"""
        # Create state graph
        workflow = StateGraph(AgentState)
        
        # Add nodes
        workflow.add_node("think", self._think_node)
        workflow.add_node("act", self._act_node)
        workflow.add_node("evaluate", self._evaluate_node)
        workflow.add_node("complete", self._complete_node)
        
        # Add edges
        workflow.add_edge("think", "act")
        workflow.add_edge("act", "evaluate")
        workflow.add_conditional_edges(
            "evaluate",
            self._should_continue,
            {
                "continue": "think",
                "complete": "complete"
            }
        )
        
        # Set entry point
        workflow.set_entry_point("think")
        
        # Compile with memory
        if self.memory:
            self.graph = workflow.compile(checkpointer=self.memory)
        else:
            self.graph = workflow.compile()
    
    async def _think_node(self, state: AgentState) -> AgentState:
        """Thinking/planning node"""
        state.status = AgentStatus.THINKING
        state.iteration += 1
        
        try:
            # Get current context
            context = self._get_context(state)
            
            # Plan next action
            plan = await self._plan_action(state, context)
            
            # Update state with plan
            state.context.update(plan.get('context', {}))
            state.metadata.update(plan.get('metadata', {}))
            
            logger.debug(f"{self.name} thinking: iteration {state.iteration}")
            
        except Exception as e:
            logger.error(f"{self.name} thinking failed: {e}")
            state.error_count += 1
            state.status = AgentStatus.FAILED
        
        return state
    
    async def _act_node(self, state: AgentState) -> AgentState:
        """Action execution node"""
        state.status = AgentStatus.WORKING
        
        try:
            # Execute action
            action_result = await self._execute_action(state)
            
            # Update state with results
            if action_result.get('success', False):
                state.result = action_result.get('result')
                state.tools_used.extend(action_result.get('tools_used', []))
                
                # Add AI message
                if action_result.get('message'):
                    state.messages.append(AIMessage(content=action_result['message']))
            else:
                state.error_count += 1
                logger.warning(f"{self.name} action failed: {action_result.get('error')}")
            
            logger.debug(f"{self.name} acting: iteration {state.iteration}")
            
        except Exception as e:
            logger.error(f"{self.name} action execution failed: {e}")
            state.error_count += 1
            state.status = AgentStatus.FAILED
        
        return state
    
    async def _evaluate_node(self, state: AgentState) -> AgentState:
        """Evaluation node - assess progress and decide next steps"""
        try:
            # Evaluate current state
            evaluation = await self._evaluate_progress(state)
            
            # Update metadata
            state.metadata.update(evaluation.get('metadata', {}))
            
            # Determine if task is complete
            if evaluation.get('complete', False):
                state.status = AgentStatus.COMPLETED
            elif state.iteration >= state.max_iterations:
                state.status = AgentStatus.FAILED
                logger.warning(f"{self.name} reached max iterations ({state.max_iterations})")
            elif state.error_count > 3:
                state.status = AgentStatus.FAILED
                logger.error(f"{self.name} too many errors ({state.error_count})")
            else:
                state.status = AgentStatus.THINKING
            
            logger.debug(f"{self.name} evaluating: status={state.status.value}")
            
        except Exception as e:
            logger.error(f"{self.name} evaluation failed: {e}")
            state.error_count += 1
            state.status = AgentStatus.FAILED
        
        return state
    
    async def _complete_node(self, state: AgentState) -> AgentState:
        """Completion node - finalize results"""
        try:
            # Finalize results
            final_result = await self._finalize_result(state)
            state.result = final_result
            
            # Update statistics
            self._update_stats(state)
            
            logger.info(f"{self.name} completed task in {state.iteration} iterations")
            
        except Exception as e:
            logger.error(f"{self.name} completion failed: {e}")
            state.status = AgentStatus.FAILED
        
        return state
    
    def _should_continue(self, state: AgentState) -> str:
        """Decide whether to continue or complete"""
        if state.status in [AgentStatus.COMPLETED, AgentStatus.FAILED]:
            return "complete"
        else:
            return "continue"
    
    def _get_context(self, state: AgentState) -> Dict[str, Any]:
        """Get current context for decision making"""
        return {
            'current_task': state.current_task,
            'messages': state.messages,
            'iteration': state.iteration,
            'tools_used': state.tools_used,
            'context': state.context,
            'metadata': state.metadata
        }
    
    @abstractmethod
    async def _plan_action(self, state: AgentState, context: Dict[str, Any]) -> Dict[str, Any]:
        """Plan the next action (implemented by subclasses)"""
        pass
    
    @abstractmethod
    async def _execute_action(self, state: AgentState) -> Dict[str, Any]:
        """Execute the planned action (implemented by subclasses)"""
        pass
    
    async def _evaluate_progress(self, state: AgentState) -> Dict[str, Any]:
        """Evaluate progress (can be overridden by subclasses)"""
        # Default evaluation logic
        if state.result is not None:
            return {'complete': True, 'success': True}
        elif state.error_count > 2:
            return {'complete': True, 'success': False}
        else:
            return {'complete': False}
    
    async def _finalize_result(self, state: AgentState) -> Any:
        """Finalize the result (can be overridden by subclasses)"""
        return state.result
    
    def _update_stats(self, state: AgentState):
        """Update agent statistics"""
        self.stats['tasks_completed'] += 1
        
        # Update tool usage stats
        for tool in state.tools_used:
            self.stats['tools_usage'][tool] = self.stats['tools_usage'].get(tool, 0) + 1
    
    async def execute(self, 
                     task: str, 
                     context: Optional[Dict[str, Any]] = None,
                     config: Optional[Dict[str, Any]] = None) -> AgentResult:
        """
        Execute a task using the agent
        
        Args:
            task: Task description
            context: Initial context
            config: Execution configuration
            
        Returns:
            AgentResult with execution results
        """
        start_time = asyncio.get_event_loop().time()
        
        # Initialize state
        initial_state = AgentState(
            current_task=task,
            messages=[HumanMessage(content=task)],
            context=context or {},
            max_iterations=config.get('max_iterations', self.max_iterations) if config else self.max_iterations
        )
        
        self.current_state = initial_state
        
        try:
            # Execute the graph
            config_dict = {"configurable": {"thread_id": self.agent_id}} if self.memory else {}
            
            async for output in self.graph.astream(initial_state, config=config_dict):
                # Process intermediate outputs if needed
                pass
            
            final_state = output[list(output.keys())[-1]]
            execution_time = asyncio.get_event_loop().time() - start_time
            
            # Update global stats
            self.stats['total_execution_time'] += execution_time
            if self.stats['tasks_completed'] > 0:
                self.stats['average_execution_time'] = self.stats['total_execution_time'] / self.stats['tasks_completed']
            
            # Create result
            result = AgentResult(
                success=final_state.status == AgentStatus.COMPLETED,
                result=final_state.result,
                error=final_state.metadata.get('error'),
                execution_time=execution_time,
                iterations=final_state.iteration,
                tools_used=final_state.tools_used,
                metadata=final_state.metadata
            )
            
            logger.info(f"{self.name} execution {'completed' if result.success else 'failed'} "
                       f"in {execution_time:.2f}s ({final_state.iteration} iterations)")
            
            return result
            
        except Exception as e:
            execution_time = asyncio.get_event_loop().time() - start_time
            self.stats['error_count'] += 1
            
            logger.error(f"{self.name} execution failed: {e}")
            
            return AgentResult(
                success=False,
                result=None,
                error=str(e),
                execution_time=execution_time,
                iterations=0,
                metadata={'exception': type(e).__name__}
            )
    
    def get_stats(self) -> Dict[str, Any]:
        """Get agent statistics"""
        return {
            'agent_id': self.agent_id,
            'name': self.name,
            'stats': self.stats.copy(),
            'current_status': self.current_state.status.value if self.current_state else 'idle'
        }
    
    async def reset(self):
        """Reset agent state"""
        self.current_state = None
        if self.memory:
            # Clear memory for this agent
            pass  # Memory clearing implementation would go here
        
        logger.info(f"Reset agent {self.name}")
    
    async def health_check(self) -> Dict[str, Any]:
        """Check agent health"""
        try:
            # Test LLM connection
            if hasattr(self.llm_manager, 'health_check'):
                llm_health = await self.llm_manager.health_check()
            else:
                llm_health = {'unknown': True}
            
            return {
                'agent_healthy': True,
                'llm_health': llm_health,
                'graph_compiled': self.graph is not None,
                'memory_enabled': self.memory is not None,
                'tools_count': len(self.tools),
                'error_rate': self.stats['error_count'] / max(self.stats['tasks_completed'], 1)
            }
            
        except Exception as e:
            logger.error(f"{self.name} health check failed: {e}")
            return {
                'agent_healthy': False,
                'error': str(e)
            }