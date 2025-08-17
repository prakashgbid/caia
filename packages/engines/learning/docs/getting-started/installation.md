# Installation

## System Requirements

- Python 3.8 or higher
- pip 20.0 or higher
- Operating System: Windows, macOS, or Linux

## Installation Methods

### Using pip (Recommended)

Install the latest stable version from PyPI:

```bash
pip install evolux
```

### Using pip with extras

Install with optional dependencies:

```bash
# With development tools
pip install evolux[dev]

# With all extras
pip install evolux[all]
```

### From GitHub

Install the latest development version:

```bash
pip install git+https://github.com/prakashgbid/evolux-ai.git
```

### From Source

Clone and install from source:

```bash
git clone https://github.com/prakashgbid/evolux-ai.git
cd evolux-ai
pip install -e .
```

## Verify Installation

```python
import evolux
print(evolux.__version__)
```

## Docker Installation

```dockerfile
FROM python:3.9-slim
RUN pip install evolux
```

## Troubleshooting

### Common Issues

!!! warning "Import Error"
    If you encounter import errors, ensure you have the correct Python version:
    ```bash
    python --version
    ```

!!! tip "Virtual Environment"
    We recommend using a virtual environment:
    ```bash
    python -m venv venv
    source venv/bin/activate  # On Windows: venv\Scripts\activate
    pip install evolux
    ```

## Next Steps

- [Quick Start Guide](quickstart.md)
- [Configuration](configuration.md)
- [Tutorials](tutorials.md)
