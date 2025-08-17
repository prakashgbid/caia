"""Setup configuration for FlowMaster."""

from setuptools import setup, find_packages

with open("README.md", "r", encoding="utf-8") as fh:
    long_description = fh.read()

setup(
    name="flowmaster",
    version="1.0.0",
    author="FlowMaster Contributors",
    author_email="hello@flowmaster.ai",
    description="Advanced workflow orchestration and agent coordination platform",
    long_description=long_description,
    long_description_content_type="text/markdown",
    url="https://github.com/prakashgbid/flowmaster-orchestrator",
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
        "langgraph>=0.0.20",
        "langchain>=0.1.0",
        "langchain-core>=0.1.0",
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
            "flowmaster=flowmaster.cli:main",
        ],
    },
    keywords="agents orchestration langgraph langchain multi-agent supervisor swarm",
    project_urls={
        "Bug Reports": "https://github.com/prakashgbid/flowmaster-orchestrator/issues",
        "Source": "https://github.com/prakashgbid/flowmaster-orchestrator",
        "Documentation": "https://flowmaster-orchestrator.readthedocs.io",
    },
)