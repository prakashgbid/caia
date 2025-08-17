import pendulum
"""Tests for LangGraph Orchestrator"""

import pytest
import asyncio
from unittest.mock import Mock, AsyncMock, patch
from datetime import datetime

from memcore import (
    AgentOrchestrator,
    AgentProfile,
    AgentType,
    CollaborationMode,
    get_agent_orchestrator
)


class TestAgentOrchestrator:
    """Test suite for AgentOrchestrator"""
    
    @pytest.fixture
    def orchestrator(self):
        """Create orchestrator instance for testing"""
        return AgentOrchestrator()
    
    def test_initialization(self, orchestrator):
        """Test orchestrator initialization"""
        assert orchestrator is not None
        assert len(orchestrator.agents) == 10  # Default agents
        assert orchestrator.collaboration_mode == CollaborationMode.HYBRID
        assert orchestrator.max_handoffs == 10
    
    def test_default_agents(self, orchestrator):
        """Test default agents are registered"""
        expected_agents = [
            "supervisor", "researcher", "coder", "planner",
            "decision_maker", "executor", "learner", "creative",
            "analyst", "communicator"
        ]
        
        for agent_name in expected_agents:
            assert agent_name in orchestrator.agents
            profile = orchestrator.agents[agent_name]
            assert isinstance(profile, AgentProfile)
            assert profile.name == agent_name
    
    def test_register_custom_agent(self, orchestrator):
        """Test registering a custom agent"""
        custom_agent = AgentProfile(
            name="custom_agent",
            agent_type=AgentType.ANALYSIS,
            description="Custom test agent",
            capabilities=["test_capability"],
            tools=["test_tool"]
        )
        
        orchestrator.register_agent(custom_agent)
        
        assert "custom_agent" in orchestrator.agents
        assert orchestrator.agents["custom_agent"] == custom_agent
    
    @pytest.mark.asyncio
    async def test_execute_task_without_workflow(self, orchestrator):
        """Test task execution without workflow initialized"""
        orchestrator.workflow = None
        
        result = await orchestrator.execute_task("Test task")
        
        assert result["error"] == "Workflow not initialized"
        assert orchestrator.metrics["failed_tasks"] == 1
    
    @pytest.mark.asyncio
    async def test_execute_task_with_mock_workflow(self, orchestrator):
        """Test task execution with mocked workflow"""
        # Mock the workflow
        mock_workflow = AsyncMock()
        mock_workflow.ainvoke.return_value = {
            "messages": [],
            "final_result": "Task completed successfully",
            "intermediate_results": [
                {"agent": "researcher", "response": "Research done"}
            ],
            "handoffs": [
                {"from": "supervisor", "to": "researcher", "reason": "Research needed"}
            ],
            "metadata": {"start_time": pendulum.now().isoformat()}
        }
        
        orchestrator.workflow = mock_workflow
        
        result = await orchestrator.execute_task(
            "Test task",
            context={"test": True}
        )
        
        assert result["success"] is True
        assert result["result"] == "Task completed successfully"
        assert len(result["handoffs"]) == 1
        assert orchestrator.metrics["successful_tasks"] == 1
    
    def test_get_metrics(self, orchestrator):
        """Test getting orchestrator metrics"""
        metrics = orchestrator.get_metrics()
        
        assert "total_tasks" in metrics
        assert "successful_tasks" in metrics
        assert "failed_tasks" in metrics
        assert "average_handoffs" in metrics
        assert "agent_performance" in metrics
    
    def test_get_agent_profiles(self, orchestrator):
        """Test getting agent profiles"""
        profiles = orchestrator.get_agent_profiles()
        
        assert len(profiles) == 10  # Default agents
        
        for name, profile in profiles.items():
            assert "type" in profile
            assert "description" in profile
            assert "capabilities" in profile
            assert "tools" in profile
            assert "llm_preference" in profile
    
    def test_format_agent_list(self, orchestrator):
        """Test formatting agent list"""
        agent_list = orchestrator._format_agent_list()
        
        assert "researcher:" in agent_list
        assert "coder:" in agent_list
        assert "supervisor:" not in agent_list  # Supervisor excluded
    
    def test_extract_agent_name(self, orchestrator):
        """Test extracting agent name from response"""
        response = "I think the researcher agent should handle this task"
        agent_name = orchestrator._extract_agent_name(response)
        assert agent_name == "researcher"
        
        response = "No specific agent mentioned"
        agent_name = orchestrator._extract_agent_name(response)
        assert agent_name is None
    
    def test_is_task_complete(self, orchestrator):
        """Test checking if task is complete"""
        complete_responses = [
            "Task completed successfully",
            "The task is done",
            "Finished processing",
            "Final answer: 42",
            "Final result: Success"
        ]
        
        for response in complete_responses:
            assert orchestrator._is_task_complete(response) is True
        
        incomplete_responses = [
            "Still working on it",
            "Need more information",
            "Processing continues"
        ]
        
        for response in incomplete_responses:
            assert orchestrator._is_task_complete(response) is False
    
    @pytest.mark.asyncio
    async def test_create_swarm(self, orchestrator):
        """Test creating agent swarm"""
        agents = ["researcher", "analyst", "communicator"]
        swarm = await orchestrator.create_swarm(agents)
        
        assert swarm["agents"] == agents
        assert swarm["active"] is True
        assert "created_at" in swarm
    
    @pytest.mark.asyncio
    async def test_create_hierarchy(self, orchestrator):
        """Test creating agent hierarchy"""
        structure = {
            "supervisor": ["planner", "decision_maker"],
            "planner": ["researcher", "analyst"]
        }
        
        hierarchy = await orchestrator.create_hierarchy(structure)
        
        assert hierarchy["structure"] == structure
        assert hierarchy["active"] is True
        assert "created_at" in hierarchy


class TestSingletonPattern:
    """Test singleton pattern for get_agent_orchestrator"""
    
    def test_singleton_instance(self):
        """Test that get_agent_orchestrator returns same instance"""
        orchestrator1 = get_agent_orchestrator()
        orchestrator2 = get_agent_orchestrator()
        
        assert orchestrator1 is orchestrator2
    
    def test_singleton_with_config(self):
        """Test singleton with configuration"""
        # Reset global instance
        import memcore.orchestrator
        memcore.orchestrator._orchestrator = None
        
        config = {"max_handoffs": 20}
        orchestrator = get_agent_orchestrator(config=config)
        
        assert orchestrator.max_handoffs == 20


class TestCollaborationModes:
    """Test different collaboration modes"""
    
    def test_collaboration_mode_enum(self):
        """Test CollaborationMode enum values"""
        assert CollaborationMode.SUPERVISOR.value == "supervisor"
        assert CollaborationMode.SWARM.value == "swarm"
        assert CollaborationMode.HIERARCHICAL.value == "hierarchical"
        assert CollaborationMode.DEMOCRATIC.value == "democratic"
        assert CollaborationMode.HYBRID.value == "hybrid"


class TestAgentTypes:
    """Test agent type definitions"""
    
    def test_agent_type_enum(self):
        """Test AgentType enum values"""
        expected_types = [
            "supervisor", "research", "code", "planning",
            "decision", "execution", "learning", "creative",
            "analysis", "communication"
        ]
        
        for expected in expected_types:
            assert any(agent_type.value == expected for agent_type in AgentType)


if __name__ == "__main__":
    pytest.main([__file__, "-v"])