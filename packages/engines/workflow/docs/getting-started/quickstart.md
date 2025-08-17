# Quick Start

Get up and running with FlowMaster in 5 minutes!

## Basic Example

```python
from flowmaster import FlowMaster

# Create an instance
engine = FlowMaster()

# Process data
result = engine.process("Hello, World!")
print(result)
```

## Configuration

```python
from flowmaster import FlowMaster, Config

# Custom configuration
config = Config(
    verbose=True,
    max_workers=4,
    timeout=30
)

engine = FlowMaster(config=config)
```

## Advanced Usage

```python
# Async processing
import asyncio
from flowmaster import AsyncFlowMaster

async def main():
    engine = AsyncFlowMaster()
    result = await engine.process_async(data)
    return result

asyncio.run(main())
```

## What's Next?

- [User Guide](../guide/overview.md) - Comprehensive usage guide
- [API Reference](../api/core.md) - Detailed API documentation
- [Examples](../examples/basic.md) - More code examples
