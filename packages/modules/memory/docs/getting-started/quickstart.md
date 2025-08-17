# Quick Start

Get up and running with MemCore in 5 minutes!

## Basic Example

```python
from memcore import MemCore

# Create an instance
engine = MemCore()

# Process data
result = engine.process("Hello, World!")
print(result)
```

## Configuration

```python
from memcore import MemCore, Config

# Custom configuration
config = Config(
    verbose=True,
    max_workers=4,
    timeout=30
)

engine = MemCore(config=config)
```

## Advanced Usage

```python
# Async processing
import asyncio
from memcore import AsyncMemCore

async def main():
    engine = AsyncMemCore()
    result = await engine.process_async(data)
    return result

asyncio.run(main())
```

## What's Next?

- [User Guide](../guide/overview.md) - Comprehensive usage guide
- [API Reference](../api/core.md) - Detailed API documentation
- [Examples](../examples/basic.md) - More code examples
