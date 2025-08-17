# Quick Start

Get up and running with Autonomix in 5 minutes!

## Basic Example

```python
from autonomix import Autonomix

# Create an instance
engine = Autonomix()

# Process data
result = engine.process("Hello, World!")
print(result)
```

## Configuration

```python
from autonomix import Autonomix, Config

# Custom configuration
config = Config(
    verbose=True,
    max_workers=4,
    timeout=30
)

engine = Autonomix(config=config)
```

## Advanced Usage

```python
# Async processing
import asyncio
from autonomix import AsyncAutonomix

async def main():
    engine = AsyncAutonomix()
    result = await engine.process_async(data)
    return result

asyncio.run(main())
```

## What's Next?

- [User Guide](../guide/overview.md) - Comprehensive usage guide
- [API Reference](../api/core.md) - Detailed API documentation
- [Examples](../examples/basic.md) - More code examples
