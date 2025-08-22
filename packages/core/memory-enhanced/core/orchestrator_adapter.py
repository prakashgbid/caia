"""Adapter for using the extracted langgraph-orchestrator module."""

import sys
from pathlib import Path

# Add module path (temporary until pip install)
module_path = Path(__file__).parent.parent.parent / "modules" / "langgraph-orchestrator" / "src"
sys.path.insert(0, str(module_path))

# Import from the extracted module
from memcore import (
    AgentOrchestrator,
    AgentProfile,
    AgentType,
    CollaborationMode,
    AgentHandoff,
    AgentState,
    get_agent_orchestrator
)

# Re-export for backward compatibility
__all__ = [
    "AgentOrchestrator",
    "AgentProfile",
    "AgentType",
    "CollaborationMode",
    "AgentHandoff",
    "AgentState",
    "get_agent_orchestrator"
]

# Create MemCore-specific wrapper if needed
class MemCoreOrchestrator(AgentOrchestrator):
    """MemCore-specific orchestrator with custom configuration"""
    
    def __init__(self, langchain_engine=None, config=None):
        # Convert langchain_engine to llm_provider for compatibility
        super().__init__(llm_provider=langchain_engine, config=config)
        
        # Add MemCore-specific agents
        self._add_osa_agents()
    
    def _add_osa_agents(self):
        """Add MemCore-specific specialized agents"""
        
        # MemCore Vision Agent
        self.register_agent(AgentProfile(
            name="vision_keeper",
            agent_type=AgentType.SUPERVISOR,
            description="Maintains MemCore vision: 100% Autonomous, 100% Accurate, 100% Secure",
            capabilities=["vision_alignment", "goal_tracking", "autonomy_enforcement"],
            tools=["vision_checker", "goal_tracker", "autonomy_monitor"],
            llm_preference="claude"
        ))
        
        # Module Extractor Agent
        self.register_agent(AgentProfile(
            name="module_extractor",
            agent_type=AgentType.CODE,
            description="Extracts and creates open source modules from MemCore codebase",
            capabilities=["code_extraction", "module_creation", "dependency_analysis"],
            tools=["code_analyzer", "module_builder", "pip_packager"],
            llm_preference="gpt-4"
        ))
        
        # Self-Modification Agent
        self.register_agent(AgentProfile(
            name="self_modifier",
            agent_type=AgentType.LEARNING,
            description="Safely modifies MemCore's own code for self-improvement",
            capabilities=["code_analysis", "safe_modification", "performance_optimization"],
            tools=["ast_parser", "code_modifier", "test_runner"],
            llm_preference="gpt-4"
        ))


# Factory function for MemCore
def get_osa_orchestrator(langchain_engine=None, config=None):
    """Get MemCore-configured orchestrator instance"""
    return MemCoreOrchestrator(langchain_engine, config)