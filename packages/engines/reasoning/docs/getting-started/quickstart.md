# Quick Start

Get up and running with Cognitron in 5 minutes!

## Basic Example

```python
from cognitron import Cognitron

# Create an instance
engine = Cognitron()

# Process data
result = engine.process("Hello, World!")
print(result)
```

## Configuration

```python
from cognitron import Cognitron, Config

# Custom configuration
config = Config(
    verbose=True,
    max_workers=4,
    timeout=30
)

engine = Cognitron(config=config)
```

## Advanced Usage

```python
# Async processing
import asyncio
from cognitron import AsyncCognitron

async def main():
    engine = AsyncCognitron()
    result = await engine.process_async(data)
    return result

asyncio.run(main())
```

## What's Next?

- [User Guide](../guide/overview.md) - Comprehensive usage guide
- [API Reference](../api/core.md) - Detailed API documentation
- [Examples](../examples/basic.md) - More code examples
