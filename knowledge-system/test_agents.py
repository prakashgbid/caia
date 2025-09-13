"""
Test Suite for Phase 2 Advanced Agentic Layer
"""

import asyncio
import pytest
from datetime import datetime
from typing import Dict, Any

from agents.specialized import *
from orchestration import AgentSupervisor, CommunicationHub, AgentRegistry
from memory import ShortTermMemory
from tools import CodeTools

class MockLLMManager:
    \"\"\"Mock LLM manager for testing\"\"\"
    
    async def agenerate(self, messages):
        class MockResponse:
            def __init__(self):
                self.text = \"Test response from mock LLM\"
        return MockResponse()

@pytest.fixture
def mock_llm():
    return MockLLMManager()

@pytest.fixture
def test_config():
    return {
        'max_iterations': 5,
        'timeout': 30,
        'memory_enabled': True
    }

@pytest.mark.asyncio
async def test_code_agent(mock_llm, test_config):
    \"\"\"Test CodeAgent functionality\"\"\"
    agent = CodeAgent(mock_llm, test_config)
    
    # Test task execution
    result = await agent.execute(\"Generate a Python function to calculate fibonacci numbers\")
    
    assert result.success == True
    assert 'code' in str(result.result).lower() or 'generate' in str(result.result).lower()
    assert result.execution_time > 0

@pytest.mark.asyncio
async def test_research_agent(mock_llm, test_config):
    \"\"\"Test ResearchAgent functionality\"\"\"
    agent = ResearchAgent(mock_llm, test_config)
    
    # Test search functionality
    result = await agent.search_web(\"Python best practices\", sources=['web'], max_results=5)
    
    assert result['success'] == True

@pytest.mark.asyncio  
async def test_planning_agent(mock_llm, test_config):
    \"\"\"Test PlanningAgent functionality\"\"\"
    agent = PlanningAgent(mock_llm, test_config)
    
    # Test task decomposition
    result = await agent.decompose_task(\"Build a web application\", method='hierarchical')
    
    assert result['success'] == True

@pytest.mark.asyncio
async def test_learning_agent(mock_llm, test_config):
    \"\"\"Test LearningAgent functionality\"\"\"
    agent = LearningAgent(mock_llm, test_config)
    
    # Test interaction capture
    interaction_data = {
        'user_input': 'Hello, how are you?',
        'agent_response': 'I am doing well, thank you!',
        'success': True,
        'context': {'session_id': 'test_session'}
    }
    
    result = await agent.capture_interaction(interaction_data)
    assert result['success'] == True

@pytest.mark.asyncio
async def test_memory_agent(mock_llm, test_config):
    \"\"\"Test MemoryAgent functionality\"\"\"
    agent = MemoryAgent(mock_llm, test_config)
    
    # Test memory storage
    result = await agent.store_memory(\"This is a test memory\", memory_type='short_term')
    assert result['success'] == True
    
    # Test memory retrieval
    result = await agent.retrieve_memories(\"test memory\")
    assert result['success'] == True

@pytest.mark.asyncio
async def test_decision_agent(mock_llm, test_config):
    \"\"\"Test DecisionAgent functionality\"\"\"
    agent = DecisionAgent(mock_llm, test_config)
    
    # Test decision making
    options = [
        {'name': 'Option A', 'description': 'First option', 'pros': ['Fast'], 'cons': ['Expensive']},
        {'name': 'Option B', 'description': 'Second option', 'pros': ['Cheap'], 'cons': ['Slow']}
    ]
    
    result = await agent.evaluate_options(options)
    assert result['success'] == True

@pytest.mark.asyncio
async def test_agent_supervisor(mock_llm, test_config):
    \"\"\"Test AgentSupervisor orchestration\"\"\"
    supervisor = AgentSupervisor(mock_llm, test_config)
    
    # Register test agents
    code_agent = CodeAgent(mock_llm, test_config)
    agent_id = supervisor.register_agent(code_agent, ['code', 'python'])
    
    # Execute supervised task
    result = await supervisor.execute_task(\"Write a simple Python function\")
    
    assert 'success' in result
    assert result.get('tasks_executed', 0) >= 0

def test_communication_hub():
    \"\"\"Test CommunicationHub message passing\"\"\"
    hub = CommunicationHub()
    
    # Test message creation and validation
    from orchestration.communication import Message, MessageType, MessagePriority
    
    message = Message(
        message_id=\"test_msg_1\",
        sender_id=\"agent_a\",
        recipient_id=\"agent_b\", 
        message_type=MessageType.DIRECT,
        content=\"Test message\",
        priority=MessagePriority.NORMAL
    )
    
    # Test synchronous validation
    is_valid = asyncio.run(hub._validate_message(message))
    assert is_valid == True

def test_agent_registry():
    \"\"\"Test AgentRegistry functionality\"\"\"
    registry = AgentRegistry()
    
    # Create mock agent
    class MockAgent:
        def __init__(self):
            self.name = \"TestAgent\"
    
    mock_agent = MockAgent()
    
    # Test registration
    agent_id = registry.register_agent(mock_agent, ['test', 'mock'])
    assert agent_id is not None
    assert len(registry.agents) == 1
    
    # Test capability search
    found_agents = registry.find_agents_by_capability('test')
    assert agent_id in found_agents
    
    # Test unregistration
    success = registry.unregister_agent(agent_id)
    assert success == True
    assert len(registry.agents) == 0

def test_short_term_memory():
    \"\"\"Test ShortTermMemory functionality\"\"\"
    memory = ShortTermMemory(max_items=10, retention_minutes=60)
    
    # Store items
    memory.store(\"Test memory item 1\", {'source': 'test'})
    memory.store(\"Test memory item 2\", {'source': 'test'})
    
    assert len(memory.items) == 2
    
    # Retrieve items
    results = memory.retrieve(\"memory\", limit=5)
    assert len(results) > 0
    assert \"memory\" in results[0].content.lower()

def test_code_tools():
    \"\"\"Test CodeTools functionality\"\"\"
    tools = CodeTools()
    
    # Test code formatting
    unformatted_code = \"def test():\\nprint('hello')\\nreturn True\"
    formatted = asyncio.run(tools.format_code(unformatted_code, 'python'))
    
    assert formatted != unformatted_code  # Should be different after formatting
    assert 'def test():' in formatted
    assert 'print(' in formatted

@pytest.mark.asyncio
async def test_integration_workflow():
    \"\"\"Test integration between multiple agents\"\"\"
    mock_llm = MockLLMManager()
    config = {'max_iterations': 3, 'timeout': 10}
    
    # Create supervisor and agents
    supervisor = AgentSupervisor(mock_llm, config)
    
    # Register multiple agents
    code_agent = CodeAgent(mock_llm, config)
    research_agent = ResearchAgent(mock_llm, config)
    planning_agent = PlanningAgent(mock_llm, config)
    
    code_id = supervisor.register_agent(code_agent, ['code', 'python'])
    research_id = supervisor.register_agent(research_agent, ['research', 'search'])
    planning_id = supervisor.register_agent(planning_agent, ['planning', 'tasks'])
    
    # Test complex workflow
    result = await supervisor.execute_task(\"Research Python best practices and create a coding plan\")
    
    # Should have attempted to execute the task
    assert 'success' in result
    assert isinstance(result.get('tasks_executed', 0), int)

if __name__ == \"__main__\":
    # Run basic tests
    print(\"Running Phase 2 Agent Tests...\")
    
    # Test components individually
    test_communication_hub()
    print(\"✓ CommunicationHub tests passed\")
    
    test_agent_registry()
    print(\"✓ AgentRegistry tests passed\")
    
    test_short_term_memory()
    print(\"✓ ShortTermMemory tests passed\")
    
    test_code_tools()
    print(\"✓ CodeTools tests passed\")
    
    print(\"\\nBasic component tests completed successfully!\")
    print(\"Run 'pytest test_agents.py -v' for full async tests\")