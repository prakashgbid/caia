# Quick Start

Get up and running with Strategix in 5 minutes!

## Basic Example

```python
from strategix import Strategix

# Create an instance
engine = Strategix()

# Process data
result = engine.process("Hello, World!")
print(result)
```

## Configuration

```python
from strategix import Strategix, Config

# Custom configuration
config = Config(
    verbose=True,
    max_workers=4,
    timeout=30
)

engine = Strategix(config=config)
```

## Advanced Usage

```python
# Async processing
import asyncio
from strategix import AsyncStrategix

async def main():
    engine = AsyncStrategix()
    result = await engine.process_async(data)
    return result

asyncio.run(main())
```

## What's Next?

- [User Guide](../guide/overview.md) - Comprehensive usage guide
- [API Reference](../api/core.md) - Detailed API documentation
- [Examples](../examples/basic.md) - More code examples
