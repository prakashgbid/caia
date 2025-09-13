"""
Agent Examples - Demonstrates Phase 2 Advanced Agentic Layer usage
"""

import asyncio
from typing import Dict, Any

# Mock LLM Manager for examples
class ExampleLLMManager:
    async def agenerate(self, messages):
        class Response:
            def __init__(self, content):
                self.text = content
        
        # Return contextual responses based on message content
        message_content = str(messages).lower()
        
        if 'code' in message_content or 'function' in message_content:
            return Response("""
def fibonacci(n):
    if n <= 1:
        return n
    return fibonacci(n-1) + fibonacci(n-2)

def fibonacci_optimized(n):
    if n <= 1:
        return n
    a, b = 0, 1
    for _ in range(2, n + 1):
        a, b = b, a + b
    return b
            """)
        elif 'research' in message_content or 'search' in message_content:
            return Response("Found 5 relevant resources about Python best practices including PEP 8 style guide, async programming patterns, and testing frameworks.")
        elif 'plan' in message_content or 'decompose' in message_content:
            return Response("""
            [
                {"title": "Setup and Planning", "description": "Initialize project structure and define requirements"},
                {"title": "Core Development", "description": "Implement main functionality and features"},
                {"title": "Testing and QA", "description": "Write tests and ensure quality standards"},
                {"title": "Deployment", "description": "Deploy and configure production environment"}
            ]
            """)
        elif 'decide' in message_content or 'decision' in message_content:
            return Response("""
            {
                "base_estimate": 180,
                "confidence": 0.8,
                "reasoning": "Based on task complexity and typical development time",
                "factors": ["complexity", "testing_requirements", "documentation"]
            }
            """)
        else:
            return Response("I understand your request and will help you with that task.")

async def example_basic_agent_usage():
    """Example 1: Basic individual agent usage"""
    print("=== Example 1: Basic Agent Usage ===")
    
    from agents.specialized import CodeAgent, ResearchAgent, PlanningAgent
    
    llm = ExampleLLMManager()
    config = {'max_iterations': 5, 'timeout': 30}
    
    # 1. Code Agent Example
    print("\\n1. Using CodeAgent:")
    code_agent = CodeAgent(llm, config)
    result = await code_agent.execute("Generate a Python function to calculate fibonacci numbers")
    print(f"Success: {result.success}")
    if result.success and result.result:
        print(f"Generated code type: {type(result.result)}")
    
    # 2. Research Agent Example
    print("\\n2. Using ResearchAgent:")
    research_agent = ResearchAgent(llm, config)
    search_result = await research_agent.search_web("Python async programming", sources=['web'], max_results=5)
    print(f"Search success: {search_result['success']}")
    
    # 3. Planning Agent Example
    print("\\n3. Using PlanningAgent:")
    planning_agent = PlanningAgent(llm, config)
    plan_result = await planning_agent.decompose_task("Build a web application")
    print(f"Planning success: {plan_result['success']}")

async def example_multi_agent_orchestration():
    """Example 2: Multi-agent orchestration with supervisor"""
    print("\\n=== Example 2: Multi-Agent Orchestration ===")
    
    from orchestration import AgentSupervisor
    from agents.specialized import CodeAgent, ResearchAgent, PlanningAgent
    
    llm = ExampleLLMManager()
    config = {'max_concurrent_tasks': 5, 'assignment_strategy': 'capability_match'}
    
    # Create supervisor
    supervisor = AgentSupervisor(llm, config)
    
    # Create and register agents
    agents_info = [
        (CodeAgent(llm, {'max_iterations': 5}), ['code', 'python', 'programming']),
        (ResearchAgent(llm, {'max_search_results': 10}), ['research', 'search', 'analysis']),
        (PlanningAgent(llm, {'max_task_depth': 4}), ['planning', 'strategy', 'decomposition'])
    ]
    
    for agent, capabilities in agents_info:
        agent_id = supervisor.register_agent(agent, capabilities)
        print(f"Registered {agent.name} with ID: {agent_id}")
    
    # Execute complex multi-agent task
    print("\\nExecuting complex task...")
    result = await supervisor.execute_task(
        "Research Python web frameworks, create a development plan, and generate starter code"
    )
    
    print(f"Task execution success: {result['success']}")
    print(f"Tasks executed: {result.get('tasks_executed', 0)}")
    print(f"Execution iterations: {result.get('execution_time', 0)}")

async def example_memory_and_learning():
    """Example 3: Memory management and learning from interactions"""
    print("\\n=== Example 3: Memory and Learning ===")
    
    from agents.specialized import MemoryAgent, LearningAgent
    
    llm = ExampleLLMManager()
    
    # 1. Memory Agent Example
    print("\\n1. Memory Agent:")
    memory_agent = MemoryAgent(llm, {
        'max_short_term_items': 100,
        'memory_db_path': 'example_memory.db'
    })
    
    # Store different types of memories
    memories = [
        ("User prefers concise explanations", 'semantic', {'user_preference': True}),
        ("Completed web scraping project successfully", 'episodic', {'project': 'web_scraper'}),
        ("How to implement async/await in Python", 'procedural', {'language': 'python'}),
        ("Important client meeting tomorrow", 'short_term', {'priority': 'high'})
    ]
    
    for content, mem_type, context in memories:
        result = await memory_agent.store_memory(content, memory_type=mem_type, context=context)
        print(f"Stored {mem_type} memory: {result['success']}")
    
    # Retrieve memories
    search_result = await memory_agent.retrieve_memories("python")
    print(f"Retrieved {len(search_result['result']['memories'])} memories about Python")
    
    # 2. Learning Agent Example  
    print("\\n2. Learning Agent:")
    learning_agent = LearningAgent(llm, {
        'pattern_confidence_threshold': 0.6,
        'min_pattern_frequency': 2
    })
    
    # Simulate user interactions
    interactions = [
        {
            'user_input': 'Can you explain this more simply?',
            'agent_response': 'Here is a simpler explanation...',
            'success': True,
            'context': {'simplification_request': True}
        },
        {
            'user_input': 'Please be more detailed',
            'agent_response': 'Here are the detailed steps...',
            'success': True,
            'context': {'detail_request': True}  
        },
        {
            'user_input': 'Make it shorter please',
            'agent_response': 'Brief summary: ...',
            'success': True,
            'context': {'brevity_request': True}
        }
    ]
    
    for interaction in interactions:
        result = await learning_agent.capture_interaction(interaction)
        print(f"Captured interaction: {result['success']}")
    
    # Detect patterns
    patterns = await learning_agent.detect_patterns(['behavioral', 'semantic'])
    print(f"Pattern detection success: {patterns['success']}")

async def example_decision_making():
    """Example 4: Decision making with multiple options"""
    print("\\n=== Example 4: Decision Making ===")
    
    from agents.specialized import DecisionAgent
    
    llm = ExampleLLMManager()
    decision_agent = DecisionAgent(llm, {
        'max_options': 5,
        'confidence_threshold': 0.7
    })
    
    # Define decision options for choosing a web framework
    framework_options = [
        {
            'name': 'FastAPI',
            'description': 'Modern, fast web framework for building APIs',
            'pros': ['High performance', 'Automatic API documentation', 'Type hints support'],
            'cons': ['Newer ecosystem', 'Less community content'],
            'effort': 6,
            'risk_level': 0.3
        },
        {
            'name': 'Django',
            'description': 'High-level Python web framework',
            'pros': ['Mature ecosystem', 'Built-in admin', 'Lots of packages'],
            'cons': ['Can be heavy for simple APIs', 'Steep learning curve'],
            'effort': 8,
            'risk_level': 0.2
        },
        {
            'name': 'Flask',
            'description': 'Lightweight WSGI web application framework',
            'pros': ['Simple and flexible', 'Large community', 'Easy to learn'],
            'cons': ['Requires more setup', 'Less built-in functionality'],
            'effort': 5,
            'risk_level': 0.4
        }
    ]
    
    # Evaluate options
    result = await decision_agent.evaluate_options(framework_options)
    print(f"Option evaluation success: {result['success']}")
    
    if result['success'] and 'evaluations' in result['result']:
        evaluations = result['result']['evaluations']
        print(f"Evaluated {len(evaluations)} options")
        
        if evaluations:
            best_option = evaluations[0]  # Sorted by score
            print(f"Top recommendation: Option {best_option.option_id} with score {best_option.total_score:.2f}")

async def example_communication_workflow():
    """Example 5: Inter-agent communication and workflows"""
    print("\\n=== Example 5: Communication and Workflows ===")
    
    from orchestration import CommunicationHub, Message, MessageType, MessagePriority
    from orchestration import WorkflowEngine, AgentSupervisor
    from agents.specialized import CodeAgent, PlanningAgent
    
    llm = ExampleLLMManager()
    
    # 1. Communication Hub
    print("\\n1. Communication Hub:")
    comm_hub = CommunicationHub()
    await comm_hub.start()
    
    # Create test message
    message = Message(
        message_id="test_001",
        sender_id="planning_agent",
        recipient_id="code_agent",
        message_type=MessageType.COORDINATION,
        content="Development plan is ready. Please proceed with code generation.",
        priority=MessagePriority.HIGH,
        metadata={'plan_id': 'web_app_plan_v1'}
    )
    
    # Send message
    sent = await comm_hub.send_message(message)
    print(f"Message sent: {sent}")
    
    # Get communication stats
    stats = comm_hub.get_communication_stats()
    print(f"Messages in system: {stats['total_messages']}")
    
    # 2. Workflow Engine
    print("\\n2. Workflow Engine:")
    supervisor = AgentSupervisor(llm, {'max_concurrent_tasks': 3})
    workflow_engine = WorkflowEngine(supervisor)
    
    # Register agents
    planning_agent = PlanningAgent(llm, {})
    code_agent = CodeAgent(llm, {})
    
    supervisor.register_agent(planning_agent, ['planning'])
    supervisor.register_agent(code_agent, ['code'])
    
    # Define workflow
    workflow_steps = [
        {
            'id': 'plan_step',
            'name': 'Create Plan',
            'agent_type': 'PlanningAgent',
            'task': 'Create development plan for a simple web API',
            'depends_on': []
        },
        {
            'id': 'code_step',
            'name': 'Generate Code',
            'agent_type': 'CodeAgent', 
            'task': 'Generate Python code based on the development plan',
            'depends_on': ['plan_step']
        }
    ]
    
    # Create and execute workflow
    workflow_id = await workflow_engine.create_workflow(
        "API Development Workflow",
        "Complete workflow for API development",
        workflow_steps
    )
    
    print(f"Created workflow: {workflow_id}")
    
    # Execute workflow
    workflow_result = await workflow_engine.execute_workflow(workflow_id)
    print(f"Workflow execution: {workflow_result['success']}")
    
    # Cleanup
    await comm_hub.stop()

async def example_comprehensive_integration():
    """Example 6: Comprehensive system integration"""
    print("\\n=== Example 6: Comprehensive Integration ===")
    
    from orchestration import AgentSupervisor
    from agents.specialized import *
    
    llm = ExampleLLMManager()
    
    # Create comprehensive multi-agent system
    supervisor = AgentSupervisor(llm, {
        'max_concurrent_tasks': 8,
        'assignment_strategy': 'specialization'
    })
    
    # Create all specialized agents
    agents = [
        (CodeAgent(llm, {'enable_testing': True}), ['code', 'python', 'testing']),
        (ResearchAgent(llm, {'max_search_results': 15}), ['research', 'analysis']),
        (PlanningAgent(llm, {'max_task_depth': 5}), ['planning', 'strategy']),
        (LearningAgent(llm, {'pattern_confidence_threshold': 0.7}), ['learning', 'adaptation']),
        (MemoryAgent(llm, {'max_long_term_items': 5000}), ['memory', 'context']),
        (DecisionAgent(llm, {'max_options': 8}), ['decision', 'analysis'])
    ]
    
    # Register all agents
    agent_ids = []
    for agent, capabilities in agents:
        agent_id = supervisor.register_agent(agent, capabilities)
        agent_ids.append((agent_id, agent.name))
        print(f"Registered {agent.name}")
    
    # Execute complex multi-step task
    complex_task = '''
    Research current trends in web development, analyze the pros and cons of different approaches,
    create a comprehensive development strategy, make decisions on technology stack,
    generate starter code, and learn from this process for future projects.
    '''
    
    print(f"\\nExecuting complex integrated task...")
    print(f"Task: {complex_task[:100]}...")
    
    result = await supervisor.execute_task(complex_task)
    
    print(f"\\nIntegrated task results:")
    print(f"Success: {result['success']}")
    print(f"Tasks executed: {result.get('tasks_executed', 0)}")
    print(f"Execution iterations: {result.get('execution_time', 0)}")
    
    # Get system statistics
    print(f"\\nSystem Statistics:")
    agent_status = supervisor.get_agent_status()
    print(f"Total agents: {len(agent_status)}")
    
    performance_metrics = supervisor.get_performance_metrics()
    print(f"Tasks completed: {performance_metrics['tasks_completed']}")
    print(f"Success rate: {performance_metrics.get('workflow_success_rate', 0):.2%}")

async def main():
    """Run all examples"""
    print("🤖 Phase 2 Advanced Agentic Layer - Examples\\n")
    
    try:
        await example_basic_agent_usage()
        await example_multi_agent_orchestration() 
        await example_memory_and_learning()
        await example_decision_making()
        await example_communication_workflow()
        await example_comprehensive_integration()
        
        print("\\n✅ All examples completed successfully!")
        print("\\n📚 See PHASE_2_AGENTS.md for detailed documentation")
        
    except Exception as e:
        print(f"\\n❌ Example failed: {str(e)}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    # Run examples
    asyncio.run(main())