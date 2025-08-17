#!/usr/bin/env python3
"""
Basic usage examples for LangGraph Orchestrator
"""

import asyncio
from memcore import (
    AgentOrchestrator,
    AgentProfile,
    AgentType,
    CollaborationMode,
    get_agent_orchestrator
)


async def simple_task_example():
    """Execute a simple task with default agents"""
    print("\n=== Simple Task Example ===")
    
    # Get the singleton orchestrator
    orchestrator = get_agent_orchestrator()
    
    # Execute a research task
    result = await orchestrator.execute_task(
        "Research the top 3 programming languages for AI development in 2025",
        context={"format": "bullet_points", "max_items": 3}
    )
    
    if result["success"]:
        print(f"Result: {result['result']}")
        print(f"Agents involved: {len(result['handoffs'])} handoffs")
        for handoff in result['handoffs']:
            print(f"  - {handoff['from']} → {handoff['to']}: {handoff.get('reason', '')[:50]}...")
    else:
        print(f"Task failed: {result.get('error')}")


async def multi_agent_collaboration():
    """Demonstrate multi-agent collaboration"""
    print("\n=== Multi-Agent Collaboration ===")
    
    orchestrator = get_agent_orchestrator()
    
    # Complex task requiring multiple agents
    result = await orchestrator.execute_task(
        """Create a comprehensive plan for building a social media analytics dashboard:
        1. Research current best practices
        2. Design the architecture
        3. Plan the implementation phases
        4. Identify required resources""",
        context={
            "project_duration": "3 months",
            "team_size": 5,
            "technology_stack": "Python/React"
        }
    )
    
    if result["success"]:
        print("Task completed successfully!")
        print(f"Final result preview: {result['result'][:200]}...")
        print(f"\nIntermediate results from {len(result['intermediate_results'])} agents:")
        for intermediate in result['intermediate_results']:
            print(f"  - {intermediate['agent']}: {intermediate['response'][:100]}...")


async def custom_agent_example():
    """Add and use a custom agent"""
    print("\n=== Custom Agent Example ===")
    
    orchestrator = AgentOrchestrator()
    
    # Create a custom security analyst agent
    security_agent = AgentProfile(
        name="security_analyst",
        agent_type=AgentType.ANALYSIS,
        description="Analyzes security vulnerabilities and provides recommendations",
        capabilities=[
            "vulnerability_assessment",
            "security_audit",
            "compliance_check",
            "threat_modeling"
        ],
        tools=[
            "security_scanner",
            "dependency_checker",
            "compliance_validator"
        ],
        llm_preference="gpt-4"
    )
    
    # Register the custom agent
    orchestrator.register_agent(security_agent)
    
    # Use the custom agent
    result = await orchestrator.execute_task(
        "Perform a security assessment of a Node.js web application",
        context={
            "framework": "express",
            "database": "mongodb",
            "authentication": "jwt"
        }
    )
    
    print(f"Security assessment completed: {result.get('success')}")


async def parallel_tasks_example():
    """Execute multiple tasks in parallel"""
    print("\n=== Parallel Tasks Example ===")
    
    orchestrator = get_agent_orchestrator()
    
    # Define multiple tasks
    tasks = [
        orchestrator.execute_task(
            "Generate a Python function for data validation",
            {"language": "python", "framework": "pydantic"}
        ),
        orchestrator.execute_task(
            "Research best practices for API rate limiting",
            {"context": "microservices"}
        ),
        orchestrator.execute_task(
            "Create a deployment checklist for Kubernetes",
            {"environment": "production"}
        )
    ]
    
    # Execute all tasks in parallel
    results = await asyncio.gather(*tasks)
    
    print(f"Completed {len(results)} tasks in parallel:")
    for i, result in enumerate(results, 1):
        status = "✓" if result.get("success") else "✗"
        print(f"  {status} Task {i}: {result.get('result', 'Failed')[:100]}...")


async def swarm_pattern_example():
    """Demonstrate swarm collaboration pattern"""
    print("\n=== Swarm Pattern Example ===")
    
    orchestrator = AgentOrchestrator()
    orchestrator.collaboration_mode = CollaborationMode.SWARM
    
    # Create a swarm for collaborative research
    swarm = await orchestrator.create_swarm([
        "researcher",
        "analyst",
        "creative",
        "communicator"
    ])
    
    print(f"Created swarm with {len(swarm['agents'])} agents")
    print(f"Swarm active: {swarm['active']}")
    print(f"Agents in swarm: {', '.join(swarm['agents'])}")


async def metrics_example():
    """Demonstrate metrics collection"""
    print("\n=== Metrics Example ===")
    
    orchestrator = get_agent_orchestrator()
    
    # Execute several tasks
    test_tasks = [
        "Write a hello world function",
        "Explain recursion",
        "Create a REST API endpoint"
    ]
    
    for task in test_tasks:
        await orchestrator.execute_task(task)
    
    # Get metrics
    metrics = orchestrator.get_metrics()
    
    print("Orchestrator Metrics:")
    print(f"  Total tasks: {metrics['total_tasks']}")
    print(f"  Successful: {metrics['successful_tasks']}")
    print(f"  Failed: {metrics['failed_tasks']}")
    print(f"  Average handoffs: {metrics['average_handoffs']:.2f}")
    
    if metrics['agent_performance']:
        print("\nAgent Performance:")
        for agent, stats in metrics['agent_performance'].items():
            print(f"  {agent}: {stats['tasks']} tasks")


async def main():
    """Run all examples"""
    print("=" * 60)
    print("LangGraph Orchestrator Examples")
    print("=" * 60)
    
    # Note: Some examples may not produce real results without LLM provider
    print("\nNote: Examples run without LLM provider will show placeholder results")
    
    try:
        await simple_task_example()
        await multi_agent_collaboration()
        await custom_agent_example()
        await parallel_tasks_example()
        await swarm_pattern_example()
        await metrics_example()
    except Exception as e:
        print(f"Error running examples: {e}")
    
    print("\n" + "=" * 60)
    print("Examples completed!")
    print("=" * 60)


if __name__ == "__main__":
    asyncio.run(main())