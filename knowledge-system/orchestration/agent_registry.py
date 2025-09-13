"""
Agent Registry - Dynamic agent registration and discovery system
"""

import uuid
from typing import Dict, Any, List, Optional, Set
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum

from ..agents.base_agent import BaseAgent

class AgentStatus(Enum):
    IDLE = "idle"
    BUSY = "busy"
    OFFLINE = "offline"
    ERROR = "error"

@dataclass
class AgentRegistration:
    """Agent registration information"""
    agent_id: str
    agent: BaseAgent
    name: str
    agent_type: str
    capabilities: List[str]
    status: AgentStatus
    registered_at: datetime
    last_heartbeat: datetime
    metadata: Dict[str, Any] = field(default_factory=dict)
    current_tasks: List[str] = field(default_factory=list)
    task_history: List[str] = field(default_factory=list)

class AgentRegistry:
    """
    Registry for managing agent registration and discovery
    """
    
    def __init__(self, config: Dict[str, Any] = None):
        self.config = config or {}
        self.agents: Dict[str, AgentRegistration] = {}
        self.capability_index: Dict[str, Set[str]] = {}  # capability -> agent_ids
        self.type_index: Dict[str, Set[str]] = {}  # agent_type -> agent_ids
        
        # Configuration
        self.heartbeat_timeout_seconds = self.config.get('heartbeat_timeout', 300)  # 5 minutes
    
    def register_agent(self, agent: BaseAgent, capabilities: List[str] = None, 
                      metadata: Dict[str, Any] = None) -> str:
        """Register an agent with the registry"""
        agent_id = str(uuid.uuid4())
        
        registration = AgentRegistration(
            agent_id=agent_id,
            agent=agent,
            name=agent.name,
            agent_type=agent.__class__.__name__,
            capabilities=capabilities or [],
            status=AgentStatus.IDLE,
            registered_at=datetime.now(),
            last_heartbeat=datetime.now(),
            metadata=metadata or {}
        )
        
        # Store registration
        self.agents[agent_id] = registration
        
        # Update indices
        for capability in registration.capabilities:
            if capability not in self.capability_index:
                self.capability_index[capability] = set()
            self.capability_index[capability].add(agent_id)
        
        if registration.agent_type not in self.type_index:
            self.type_index[registration.agent_type] = set()
        self.type_index[registration.agent_type].add(agent_id)
        
        return agent_id
    
    def unregister_agent(self, agent_id: str) -> bool:
        """Unregister an agent"""
        if agent_id not in self.agents:
            return False
        
        registration = self.agents[agent_id]
        
        # Remove from indices
        for capability in registration.capabilities:
            if capability in self.capability_index:
                self.capability_index[capability].discard(agent_id)
                if not self.capability_index[capability]:
                    del self.capability_index[capability]
        
        if registration.agent_type in self.type_index:
            self.type_index[registration.agent_type].discard(agent_id)
            if not self.type_index[registration.agent_type]:
                del self.type_index[registration.agent_type]
        
        # Remove registration
        del self.agents[agent_id]
        
        return True
    
    def get_agent(self, agent_id: str) -> Optional[BaseAgent]:
        """Get agent by ID"""
        registration = self.agents.get(agent_id)
        return registration.agent if registration else None
    
    def get_agent_info(self, agent_id: str) -> Optional[AgentRegistration]:
        """Get agent registration info"""
        return self.agents.get(agent_id)
    
    def find_agents_by_capability(self, capability: str) -> List[str]:
        """Find agents with specific capability"""
        return list(self.capability_index.get(capability, set()))
    
    def find_agents_by_type(self, agent_type: str) -> List[str]:
        """Find agents by type"""
        return list(self.type_index.get(agent_type, set()))
    
    def find_available_agents(self, capabilities: List[str] = None, 
                             agent_type: str = None) -> List[str]:
        """Find available agents matching criteria"""
        candidate_agents = set(self.agents.keys())
        
        # Filter by capabilities
        if capabilities:
            for capability in capabilities:
                if capability in self.capability_index:
                    candidate_agents &= self.capability_index[capability]
                else:
                    candidate_agents = set()  # No agents have this capability
                    break
        
        # Filter by type
        if agent_type and agent_type in self.type_index:
            candidate_agents &= self.type_index[agent_type]
        elif agent_type:
            candidate_agents = set()  # No agents of this type
        
        # Filter by availability
        available_agents = []
        for agent_id in candidate_agents:
            registration = self.agents[agent_id]
            if registration.status == AgentStatus.IDLE:
                available_agents.append(agent_id)
        
        return available_agents
    
    def update_agent_status(self, agent_id: str, status: AgentStatus) -> bool:
        """Update agent status"""
        if agent_id not in self.agents:
            return False
        
        self.agents[agent_id].status = status
        self.agents[agent_id].last_heartbeat = datetime.now()
        return True
    
    def add_task_to_agent(self, agent_id: str, task_id: str) -> bool:
        """Add task to agent's current tasks"""
        if agent_id not in self.agents:
            return False
        
        registration = self.agents[agent_id]
        if task_id not in registration.current_tasks:
            registration.current_tasks.append(task_id)
            registration.status = AgentStatus.BUSY
        
        return True
    
    def remove_task_from_agent(self, agent_id: str, task_id: str) -> bool:
        """Remove task from agent's current tasks"""
        if agent_id not in self.agents:
            return False
        
        registration = self.agents[agent_id]
        if task_id in registration.current_tasks:
            registration.current_tasks.remove(task_id)
            registration.task_history.append(task_id)
            
            # Update status
            if not registration.current_tasks:
                registration.status = AgentStatus.IDLE
        
        return True
    
    def heartbeat(self, agent_id: str, metadata: Dict[str, Any] = None) -> bool:
        """Update agent heartbeat"""
        if agent_id not in self.agents:
            return False
        
        registration = self.agents[agent_id]
        registration.last_heartbeat = datetime.now()
        
        if metadata:
            registration.metadata.update(metadata)
        
        # Update status if was offline
        if registration.status == AgentStatus.OFFLINE:
            registration.status = AgentStatus.IDLE
        
        return True
    
    def check_agent_health(self) -> Dict[str, Any]:
        """Check health of all registered agents"""
        now = datetime.now()
        health_report = {
            'total_agents': len(self.agents),
            'healthy_agents': 0,
            'unhealthy_agents': 0,
            'offline_agents': 0,
            'agent_details': {}
        }
        
        for agent_id, registration in self.agents.items():
            # Check heartbeat timeout
            time_since_heartbeat = (now - registration.last_heartbeat).total_seconds()
            is_healthy = time_since_heartbeat < self.heartbeat_timeout_seconds
            
            if not is_healthy and registration.status != AgentStatus.OFFLINE:
                # Mark as offline
                registration.status = AgentStatus.OFFLINE
                health_report['offline_agents'] += 1
            elif is_healthy and registration.status != AgentStatus.OFFLINE:
                health_report['healthy_agents'] += 1
            elif registration.status == AgentStatus.OFFLINE:
                health_report['offline_agents'] += 1
            else:
                health_report['unhealthy_agents'] += 1
            
            health_report['agent_details'][agent_id] = {
                'name': registration.name,
                'type': registration.agent_type,
                'status': registration.status.value,
                'last_heartbeat': registration.last_heartbeat.isoformat(),
                'time_since_heartbeat': time_since_heartbeat,
                'current_tasks': len(registration.current_tasks),
                'is_healthy': is_healthy
            }
        
        return health_report
    
    def get_agent_statistics(self) -> Dict[str, Any]:
        """Get agent registry statistics"""
        stats = {
            'total_registered': len(self.agents),
            'by_status': {},
            'by_type': {},
            'by_capability': {},
            'load_distribution': {}
        }
        
        # Count by status
        for registration in self.agents.values():
            status = registration.status.value
            stats['by_status'][status] = stats['by_status'].get(status, 0) + 1
        
        # Count by type
        for agent_type, agent_ids in self.type_index.items():
            stats['by_type'][agent_type] = len(agent_ids)
        
        # Count by capability
        for capability, agent_ids in self.capability_index.items():
            stats['by_capability'][capability] = len(agent_ids)
        
        # Load distribution
        for agent_id, registration in self.agents.items():
            load = len(registration.current_tasks)
            if load not in stats['load_distribution']:
                stats['load_distribution'][load] = 0
            stats['load_distribution'][load] += 1
        
        return stats
    
    def get_all_agents(self) -> Dict[str, Dict[str, Any]]:
        """Get all agent information"""
        return {
            agent_id: {
                'agent': registration.agent,
                'name': registration.name,
                'type': registration.agent_type,
                'capabilities': registration.capabilities,
                'status': registration.status.value,
                'current_tasks': len(registration.current_tasks),
                'metadata': registration.metadata
            }
            for agent_id, registration in self.agents.items()
        }
    
    def get_agent_status(self) -> Dict[str, Any]:
        """Get status summary of all agents"""
        return {
            agent_id: {
                'name': reg.name,
                'type': reg.agent_type,
                'status': reg.status.value,
                'current_tasks': len(reg.current_tasks),
                'last_heartbeat': reg.last_heartbeat.isoformat()
            }
            for agent_id, reg in self.agents.items()
        }
    
    def clear_all(self):
        """Clear all registrations"""
        self.agents.clear()
        self.capability_index.clear()
        self.type_index.clear()
    
    def export_registry(self) -> Dict[str, Any]:
        """Export registry state (for persistence)"""
        return {
            'agents': {
                agent_id: {
                    'name': reg.name,
                    'agent_type': reg.agent_type,
                    'capabilities': reg.capabilities,
                    'status': reg.status.value,
                    'registered_at': reg.registered_at.isoformat(),
                    'last_heartbeat': reg.last_heartbeat.isoformat(),
                    'metadata': reg.metadata,
                    'current_tasks': reg.current_tasks,
                    'task_history': reg.task_history[-10:]  # Keep last 10
                }
                for agent_id, reg in self.agents.items()
            },
            'statistics': self.get_agent_statistics()
        }