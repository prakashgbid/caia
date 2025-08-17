# Installation

## System Requirements

- Python 3.8 or higher
- pip 20.0 or higher
- Operating System: Windows, macOS, or Linux

## Installation Methods

### Using pip (Recommended)

Install the latest stable version from PyPI:

```bash
pip install codeforge
```

### Using pip with extras

Install with optional dependencies:

```bash
# With development tools
pip install codeforge[dev]

# With all extras
pip install codeforge[all]
```

### From GitHub

Install the latest development version:

```bash
pip install git+https://github.com/prakashgbid/codeforge-ai.git
```

### From Source

Clone and install from source:

```bash
git clone https://github.com/prakashgbid/codeforge-ai.git
cd codeforge-ai
pip install -e .
```

## Verify Installation

```python
import codeforge
print(codeforge.__version__)
```

## Docker Installation

```dockerfile
FROM python:3.9-slim
RUN pip install codeforge
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
    pip install codeforge
    ```

## Next Steps

- [Quick Start Guide](quickstart.md)
- [Configuration](configuration.md)
- [Tutorials](tutorials.md)
