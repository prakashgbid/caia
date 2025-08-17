# Quick Start

Get up and running with Evolux in 5 minutes!

## Basic Example

```python
from evolux import Evolux

# Create an instance
engine = Evolux()

# Process data
result = engine.process("Hello, World!")
print(result)
```

## Configuration

```python
from evolux import Evolux, Config

# Custom configuration
config = Config(
    verbose=True,
    max_workers=4,
    timeout=30
)

engine = Evolux(config=config)
```

## Advanced Usage

```python
# Async processing
import asyncio
from evolux import AsyncEvolux

async def main():
    engine = AsyncEvolux()
    result = await engine.process_async(data)
    return result

asyncio.run(main())
```

## What's Next?

- [User Guide](../guide/overview.md) - Comprehensive usage guide
- [API Reference](../api/core.md) - Detailed API documentation
- [Examples](../examples/basic.md) - More code examples
