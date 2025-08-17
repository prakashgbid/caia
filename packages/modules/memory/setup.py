"""Setup configuration for MemCore."""

from setuptools import setup, find_packages

with open("README.md", "r", encoding="utf-8") as fh:
    long_description = fh.read()

setup(
    name="memcore",
    version="1.0.0",
    author="MemCore Contributors",
    author_email="hello@memcore.ai",
    description="Advanced persistent memory system for intelligent applications",
    long_description=long_description,
    long_description_content_type="text/markdown",
    url="https://github.com/prakashgbid/memcore-ai",
    packages=find_packages(where="src"),
    package_dir={"": "src"},
    classifiers=[
        "Development Status :: 4 - Beta",
        "Intended Audience :: Developers",
        "Topic :: Scientific/Engineering :: Artificial Intelligence",
        "License :: OSI Approved :: MIT License",
        "Programming Language :: Python :: 3",
        "Programming Language :: Python :: 3.8",
        "Programming Language :: Python :: 3.9",
        "Programming Language :: Python :: 3.10",
        "Programming Language :: Python :: 3.11",
    ],
    python_requires=">=3.8",
    install_requires=[
        "chromadb>=0.4.22",
        "sentence-transformers>=2.3.1",
        "numpy>=1.24.0",
        "sqlite3",
    ],
    extras_require={
        "dev": [
            "pytest>=7.4.0",
            "pytest-asyncio>=0.21.0",
            "black>=23.0.0",
            "flake8>=6.0.0",
        ],
    },
    entry_points={
        "console_scripts": [
            "memcore=memcore.cli:main",
        ],
    },
    keywords="ai memory persistence context llm agent chromadb vector-database",
    project_urls={
        "Bug Reports": "https://github.com/prakashgbid/memcore-ai/issues",
        "Source": "https://github.com/prakashgbid/memcore-ai",
        "Documentation": "https://memcore-ai.readthedocs.io",
    },
)