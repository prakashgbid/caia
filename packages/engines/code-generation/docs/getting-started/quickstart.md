# Quick Start

Get up and running with CodeForge in 5 minutes!

## Basic Example

```python
from codeforge import CodeForge

# Create an instance
engine = CodeForge()

# Process data
result = engine.process("Hello, World!")
print(result)
```

## Configuration

```python
from codeforge import CodeForge, Config

# Custom configuration
config = Config(
    verbose=True,
    max_workers=4,
    timeout=30
)

engine = CodeForge(config=config)
```

## Advanced Usage

```python
# Async processing
import asyncio
from codeforge import AsyncCodeForge

async def main():
    engine = AsyncCodeForge()
    result = await engine.process_async(data)
    return result

asyncio.run(main())
```

## What's Next?

- [User Guide](../guide/overview.md) - Comprehensive usage guide
- [API Reference](../api/core.md) - Detailed API documentation
- [Examples](../examples/basic.md) - More code examples
