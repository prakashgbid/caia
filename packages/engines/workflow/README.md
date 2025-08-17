# LangGraph Orchestrator

Production-ready multi-agent orchestration using LangGraph for building intelligent AI systems.

## Features

- **10 Specialized Agents**: Pre-configured agents for research, coding, planning, decision-making, and more
- **Multiple Collaboration Patterns**: Supervisor, swarm, hierarchical, democratic, and hybrid modes
- **LangGraph Integration**: Built on top of LangGraph for robust workflow management
- **Performance Metrics**: Track task success, agent performance, and collaboration efficiency
- **Async First**: Fully asynchronous for high-performance operations
- **Extensible**: Easy to add custom agents and collaboration patterns

## Installation

```bash
pip install langgraph-orchestrator
```

Or install from source:

```bash
git clone https://github.com/prakashgbid/langgraph-orchestrator.git
cd langgraph-orchestrator
pip install -e .
```

## Quick Start

```python
from langgraph_orchestrator import AgentOrchestrator, get_agent_orchestrator
import asyncio

# Create orchestrator
orchestrator = get_agent_orchestrator()

# Execute a task
async def main():
    result = await orchestrator.execute_task(
        "Research the latest AI trends and create a summary report",
        context={"format": "markdown", "max_length": 500}
    )
    
    print(f"Result: {result['result']}")
    print(f"Handoffs: {len(result['handoffs'])}")
    print(f"Agents involved: {[h['to'] for h in result['handoffs']]}")

# Run
asyncio.run(main())
```

## Built-in Agents

### 1. Supervisor Agent
- **Role**: Coordinates other agents and manages workflows
- **Capabilities**: Task delegation, workflow management, decision routing
- **Best for**: Complex multi-step tasks requiring coordination

### 2. Research Agent
- **Role**: Conducts research and gathers information
- **Capabilities**: Web search, document analysis, fact checking
- **Best for**: Information gathering, market research, literature review

### 3. Code Agent
- **Role**: Writes, debugs, and optimizes code
- **Capabilities**: Code generation, debugging, refactoring, testing
- **Best for**: Software development, bug fixes, code optimization

### 4. Planning Agent
- **Role**: Creates plans and decomposes complex tasks
- **Capabilities**: Task decomposition, scheduling, resource allocation
- **Best for**: Project planning, strategy development, roadmap creation

### 5. Decision Agent
- **Role**: Makes informed decisions based on analysis
- **Capabilities**: Multi-criteria analysis, risk assessment, consensus building
- **Best for**: Strategic decisions, option evaluation, risk analysis

### 6. Execution Agent
- **Role**: Executes system commands and deployments
- **Capabilities**: Command execution, deployment, monitoring
- **Best for**: System operations, deployment automation, infrastructure management

### 7. Learning Agent
- **Role**: Learns from interactions and improves system
- **Capabilities**: Pattern recognition, knowledge extraction, model training
- **Best for**: System improvement, pattern detection, knowledge management

### 8. Creative Agent
- **Role**: Generates creative content and solutions
- **Capabilities**: Content generation, brainstorming, design
- **Best for**: Creative writing, idea generation, design concepts

### 9. Analysis Agent
- **Role**: Analyzes data and provides insights
- **Capabilities**: Data analysis, visualization, reporting
- **Best for**: Data insights, trend analysis, performance reporting

### 10. Communication Agent
- **Role**: Handles communication and messaging
- **Capabilities**: Email, Slack, documentation, translation
- **Best for**: External communication, documentation, multi-language support

## Collaboration Patterns

### Supervisor Pattern (Default)
```python
orchestrator.collaboration_mode = CollaborationMode.SUPERVISOR
# Central supervisor delegates to specialized agents
```

### Swarm Pattern
```python
# Agents work peer-to-peer, handing off tasks
swarm = await orchestrator.create_swarm(["researcher", "analyst", "communicator"])
```

### Hierarchical Pattern
```python
# Layered delegation with management hierarchy
hierarchy = await orchestrator.create_hierarchy({
    "supervisor": ["planner", "decision_maker"],
    "planner": ["researcher", "analyst"],
    "decision_maker": ["executor", "communicator"]
})
```

## Custom Agents

```python
from langgraph_orchestrator import AgentProfile, AgentType

# Create custom agent profile
custom_agent = AgentProfile(
    name="data_scientist",
    agent_type=AgentType.ANALYSIS,
    description="Performs advanced data science and ML tasks",
    capabilities=["ml_modeling", "statistical_analysis", "prediction"],
    tools=["sklearn", "pandas", "tensorflow"],
    llm_preference="gpt-4"
)

# Register the agent
orchestrator.register_agent(custom_agent)
```

## Integration with LLM Providers

```python
# Example with OpenAI
from langchain.llms import OpenAI

llm_provider = OpenAI(api_key="your-api-key")
orchestrator = AgentOrchestrator(llm_provider=llm_provider)

# Example with multiple LLMs
from langgraph_orchestrator.providers import MultiLLMProvider

provider = MultiLLMProvider({
    "gpt-4": OpenAI(model="gpt-4"),
    "claude": Anthropic(model="claude-2"),
    "gemini": GoogleGenerativeAI(model="gemini-pro")
})

orchestrator = AgentOrchestrator(llm_provider=provider)
```

## Performance Metrics

```python
# Get orchestrator metrics
metrics = orchestrator.get_metrics()
print(f"Total tasks: {metrics['total_tasks']}")
print(f"Success rate: {metrics['successful_tasks'] / metrics['total_tasks'] * 100}%")
print(f"Average handoffs: {metrics['average_handoffs']}")

# Get agent performance
for agent, stats in metrics['agent_performance'].items():
    print(f"{agent}: {stats['tasks']} tasks")
```

## Advanced Usage

### Complex Task with Multiple Agents
```python
async def complex_project():
    # Research phase
    research_result = await orchestrator.execute_task(
        "Research best practices for microservices architecture",
        context={"depth": "comprehensive"}
    )
    
    # Planning phase
    plan_result = await orchestrator.execute_task(
        f"Create implementation plan based on: {research_result['result']}",
        context={"timeline": "2 weeks", "team_size": 5}
    )
    
    # Execution phase
    implementation = await orchestrator.execute_task(
        f"Generate code structure based on: {plan_result['result']}",
        context={"language": "python", "framework": "fastapi"}
    )
    
    return implementation
```

### Parallel Agent Execution
```python
async def parallel_analysis():
    tasks = [
        orchestrator.execute_task("Analyze market trends", {"market": "tech"}),
        orchestrator.execute_task("Review competitor strategies", {"industry": "AI"}),
        orchestrator.execute_task("Assess internal capabilities", {"focus": "ML"})
    ]
    
    results = await asyncio.gather(*tasks)
    
    # Synthesize results
    synthesis = await orchestrator.execute_task(
        f"Create strategic recommendation based on: {results}",
        context={"format": "executive_summary"}
    )
    
    return synthesis
```

## Configuration

```python
config = {
    "max_handoffs": 15,  # Maximum agent handoffs per task
    "timeout": 300,  # Task timeout in seconds
    "retry_on_failure": True,
    "log_level": "INFO",
    "checkpoint_interval": 5,  # Save state every N steps
}

orchestrator = AgentOrchestrator(config=config)
```

## Contributing

We welcome contributions! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Support

- Documentation: [https://langgraph-orchestrator.readthedocs.io](https://langgraph-orchestrator.readthedocs.io)
- Issues: [GitHub Issues](https://github.com/prakashgbid/langgraph-orchestrator/issues)
- Discussions: [GitHub Discussions](https://github.com/prakashgbid/langgraph-orchestrator/discussions)

## Citation

If you use this library in your research, please cite:

```bibtex
@software{langgraph_orchestrator,
  title = {LangGraph Orchestrator: Production-Ready Multi-Agent System},
  author = {OSA Contributors},
  year = {2025},
  url = {https://github.com/prakashgbid/langgraph-orchestrator}
}
```