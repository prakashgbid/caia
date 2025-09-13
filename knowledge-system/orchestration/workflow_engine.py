"""
Workflow Engine - Complex multi-agent workflows
"""

import asyncio
import uuid
from typing import Dict, Any, List, Optional
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum

from .supervisor import AgentSupervisor, WorkflowStep

class WorkflowStatus(Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    PAUSED = "paused"

@dataclass
class Workflow:
    workflow_id: str
    name: str
    description: str
    steps: List[WorkflowStep]
    status: WorkflowStatus = WorkflowStatus.PENDING
    created_at: datetime = field(default_factory=datetime.now)
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    context: Dict[str, Any] = field(default_factory=dict)
    results: Dict[str, Any] = field(default_factory=dict)

class WorkflowEngine:
    """
    Engine for executing complex multi-agent workflows
    """
    
    def __init__(self, supervisor: AgentSupervisor):
        self.supervisor = supervisor
        self.workflows: Dict[str, Workflow] = {}
        self.active_workflows: Dict[str, Workflow] = {}
    
    async def create_workflow(self, name: str, description: str, 
                            steps: List[Dict[str, Any]]) -> str:
        """Create a new workflow"""
        workflow_id = str(uuid.uuid4())
        
        workflow_steps = [
            WorkflowStep(
                step_id=step.get('id', f"step_{i}"),
                name=step.get('name', f"Step {i}"),
                agent_type=step.get('agent_type', 'general'),
                task_description=step.get('task', ''),
                depends_on=step.get('depends_on', []),
                parallel_with=step.get('parallel_with', []),
                context_mapping=step.get('context_mapping', {})
            )
            for i, step in enumerate(steps)
        ]
        
        workflow = Workflow(
            workflow_id=workflow_id,
            name=name,
            description=description,
            steps=workflow_steps
        )
        
        self.workflows[workflow_id] = workflow
        return workflow_id
    
    async def execute_workflow(self, workflow_id: str, 
                             context: Dict[str, Any] = None) -> Dict[str, Any]:
        """Execute a workflow"""
        if workflow_id not in self.workflows:
            return {'success': False, 'error': 'Workflow not found'}
        
        workflow = self.workflows[workflow_id]
        workflow.status = WorkflowStatus.RUNNING
        workflow.started_at = datetime.now()
        workflow.context.update(context or {})
        
        self.active_workflows[workflow_id] = workflow
        
        try:
            # Execute workflow steps
            for step in workflow.steps:
                result = await self.supervisor.execute_task(
                    step.task_description,
                    {'workflow_id': workflow_id, 'step_id': step.step_id}
                )
                workflow.results[step.step_id] = result
            
            workflow.status = WorkflowStatus.COMPLETED
            workflow.completed_at = datetime.now()
            
            return {
                'success': True,
                'workflow_id': workflow_id,
                'results': workflow.results
            }
            
        except Exception as e:
            workflow.status = WorkflowStatus.FAILED
            return {'success': False, 'error': str(e)}
        
        finally:
            self.active_workflows.pop(workflow_id, None)
    
    def get_workflow_status(self, workflow_id: str) -> Optional[Dict[str, Any]]:
        """Get workflow status"""
        if workflow_id not in self.workflows:
            return None
        
        workflow = self.workflows[workflow_id]
        return {
            'workflow_id': workflow_id,
            'name': workflow.name,
            'status': workflow.status.value,
            'created_at': workflow.created_at.isoformat(),
            'started_at': workflow.started_at.isoformat() if workflow.started_at else None,
            'completed_at': workflow.completed_at.isoformat() if workflow.completed_at else None,
            'steps_completed': len(workflow.results),
            'total_steps': len(workflow.steps)
        }
