# Contributing to LangGraph Orchestrator

We love your input! We want to make contributing to LangGraph Orchestrator as easy and transparent as possible, whether it's:

- Reporting a bug
- Discussing the current state of the code
- Submitting a fix
- Proposing new features
- Becoming a maintainer

## We Develop with Github
We use GitHub to host code, to track issues and feature requests, as well as accept pull requests.

## We Use [Github Flow](https://guides.github.com/introduction/flow/index.html)
Pull requests are the best way to propose changes to the codebase. We actively welcome your pull requests:

1. Fork the repo and create your branch from `main`.
2. If you've added code that should be tested, add tests.
3. If you've changed APIs, update the documentation.
4. Ensure the test suite passes.
5. Make sure your code lints.
6. Issue that pull request!

## Any contributions you make will be under the MIT Software License
In short, when you submit code changes, your submissions are understood to be under the same [MIT License](LICENSE) that covers the project. Feel free to contact the maintainers if that's a concern.

## Report bugs using Github's [issues](https://github.com/prakashgbid/langgraph-orchestrator/issues)
We use GitHub issues to track public bugs. Report a bug by [opening a new issue](https://github.com/prakashgbid/langgraph-orchestrator/issues/new); it's that easy!

## Write bug reports with detail, background, and sample code

**Great Bug Reports** tend to have:

- A quick summary and/or background
- Steps to reproduce
  - Be specific!
  - Give sample code if you can
- What you expected would happen
- What actually happens
- Notes (possibly including why you think this might be happening, or stuff you tried that didn't work)

## Development Setup

1. Clone the repository:
```bash
git clone https://github.com/prakashgbid/langgraph-orchestrator.git
cd langgraph-orchestrator
```

2. Create a virtual environment:
```bash
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
```

3. Install in development mode:
```bash
pip install -e ".[dev]"
```

4. Run tests:
```bash
pytest
```

## Code Style

- We use [Black](https://github.com/psf/black) for code formatting
- We use [Flake8](https://flake8.pycqa.org/) for linting
- Type hints are encouraged where appropriate

Before submitting:
```bash
black src/ tests/
flake8 src/ tests/
pytest
```

## Adding New Agents

To add a new specialized agent:

1. Define the agent profile in `src/langgraph_orchestrator/orchestrator.py`
2. Add appropriate capabilities and tools
3. Write tests for the new agent
4. Update documentation

Example:
```python
self.register_agent(AgentProfile(
    name="your_agent",
    agent_type=AgentType.YOUR_TYPE,
    description="What your agent does",
    capabilities=["capability1", "capability2"],
    tools=["tool1", "tool2"],
    llm_preference="gpt-4"
))
```

## License
By contributing, you agree that your contributions will be licensed under its MIT License.

## References
This document was adapted from the open-source contribution guidelines for [Facebook's Draft](https://github.com/facebook/draft-js/blob/master/CONTRIBUTING.md)