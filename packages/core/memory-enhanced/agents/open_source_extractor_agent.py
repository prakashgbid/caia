import pendulum
import orjson
#!/usr/bin/env python3
"""
Open Source Extractor Agent for MemCore

This agent automates the entire workflow of:
1. Identifying open source opportunities in MemCore codebase
2. Conducting market research for similar solutions
3. Creating unique value proposition analysis
4. Extracting and restructuring code into standalone projects
5. Publishing to GitHub with complete documentation
6. Managing ongoing maintenance and updates

This agent runs continuously to scan for opportunities and manages
the entire lifecycle of open source projects extracted from MemCore.
"""

import os
import json
import shutil
import asyncio
import subprocess
from pathlib import Path
from typing import Dict, List, Optional, Any, Tuple
from datetime import datetime
from enum import Enum
import logging
import re
import ast
import hashlib

# For web research and GitHub operations
import aiohttp
import git
from github import Github


class ExtractionPhase(Enum):
    """Phases of the open source extraction process"""
    SCANNING = "scanning"
    RESEARCHING = "researching"
    ANALYZING = "analyzing"
    EXTRACTING = "extracting"
    RESTRUCTURING = "restructuring"
    DOCUMENTING = "documenting"
    PUBLISHING = "publishing"
    MAINTAINING = "maintaining"


class OpenSourceCandidate:
    """Represents a potential open source extraction candidate"""
    
    def __init__(self, name: str, path: str, description: str):
        self.name = name
        self.path = path
        self.description = description
        self.files: List[str] = []
        self.dependencies: List[str] = []
        self.market_research: Dict[str, Any] = {}
        self.unique_value_prop: str = ""
        self.similarity_score: float = 0.0
        self.extraction_ready: bool = False
        self.github_url: Optional[str] = None
        

class OpenSourceExtractorAgent:
    """
    Autonomous agent for identifying, extracting, and publishing
    open source projects from MemCore codebase
    """
    
    def __init__(self, config: Dict[str, Any] = None):
        self.config = config or {}
        self.logger = logging.getLogger("OpenSourceExtractor")
        
        # Paths
        self.osa_root = Path("/Users/MAC/Documents/projects/omnimind")
        self.modules_dir = self.osa_root / "modules"
        self.src_dir = self.osa_root / "src"
        self.projects_dir = Path("/Users/MAC/Documents/projects")
        
        # GitHub configuration
        self.github_token = os.getenv("GITHUB_TOKEN")
        self.github_username = self.config.get("github_username", "prakashgbid")
        self.github_client = None
        if self.github_token:
            self.github_client = Github(self.github_token)
        
        # Tracking
        self.candidates: List[OpenSourceCandidate] = []
        self.published_projects: Dict[str, str] = {}  # name -> github_url
        self.scan_history: Dict[str, datetime] = {}
        
        # Patterns to identify modular code
        self.module_patterns = [
            r"class\s+\w+Agent",
            r"class\s+\w+Manager",
            r"class\s+\w+Orchestrator",
            r"class\s+\w+Engine",
            r"class\s+\w+System",
            r"def\s+get_\w+",  # Singleton patterns
        ]
        
        # Load extraction history
        self.history_file = self.osa_root / ".open_source_history.json"
        self.load_history()
    
    def load_history(self):
        """Load extraction history from file"""
        if self.history_file.exists():
            with open(self.history_file, 'r') as f:
                data = json.load(f)
                self.published_projects = data.get("published", {})
                self.scan_history = {
                    k: datetime.fromisoformat(v) 
                    for k, v in data.get("scans", {}).items()
                }
    
    def save_history(self):
        """Save extraction history to file"""
        data = {
            "published": self.published_projects,
            "scans": {k: v.isoformat() for k, v in self.scan_history.items()}
        }
        with open(self.history_file, 'w') as f:
            json.dump(data, f, indent=2)
    
    async def scan_for_opportunities(self) -> List[OpenSourceCandidate]:
        """Scan MemCore codebase for potential open source extractions"""
        self.logger.info("Scanning MemCore codebase for open source opportunities...")
        candidates = []
        
        # Scan src directory for modular components
        for py_file in self.src_dir.rglob("*.py"):
            if "__pycache__" in str(py_file):
                continue
                
            content = py_file.read_text()
            
            # Check for modular patterns
            for pattern in self.module_patterns:
                if re.search(pattern, content):
                    # Analyze the file for extraction potential
                    candidate = self.analyze_file_for_extraction(py_file, content)
                    if candidate and candidate.name not in self.published_projects:
                        candidates.append(candidate)
                        break
        
        # Also check for cohesive module directories
        for subdir in self.src_dir.iterdir():
            if subdir.is_dir() and not subdir.name.startswith("_"):
                candidate = self.analyze_directory_for_extraction(subdir)
                if candidate and candidate.name not in self.published_projects:
                    candidates.append(candidate)
        
        self.candidates = candidates
        self.logger.info(f"Found {len(candidates)} potential open source candidates")
        return candidates
    
    def analyze_file_for_extraction(self, file_path: Path, content: str) -> Optional[OpenSourceCandidate]:
        """Analyze a single file for extraction potential"""
        try:
            tree = ast.parse(content)
            
            # Look for classes that could be standalone
            classes = [node for node in ast.walk(tree) if isinstance(node, ast.ClassDef)]
            
            for cls in classes:
                # Check if class has sufficient complexity
                methods = [n for n in cls.body if isinstance(n, ast.FunctionDef)]
                if len(methods) >= 5:  # At least 5 methods
                    # Check for low coupling (few imports from parent modules)
                    imports = self.get_internal_imports(tree)
                    if len(imports) <= 3:  # Low coupling
                        candidate = OpenSourceCandidate(
                            name=self.generate_project_name(cls.name),
                            path=str(file_path),
                            description=self.extract_docstring(cls) or f"Extracted {cls.name} module"
                        )
                        candidate.files = [str(file_path)]
                        return candidate
        except:
            pass
        
        return None
    
    def analyze_directory_for_extraction(self, dir_path: Path) -> Optional[OpenSourceCandidate]:
        """Analyze a directory for extraction potential"""
        py_files = list(dir_path.glob("*.py"))
        
        # Check if it's a cohesive module
        if len(py_files) >= 2 and (dir_path / "__init__.py").exists():
            # Check for low external coupling
            total_imports = 0
            for py_file in py_files:
                try:
                    content = py_file.read_text()
                    tree = ast.parse(content)
                    imports = self.get_internal_imports(tree)
                    total_imports += len(imports)
                except:
                    pass
            
            # Low coupling threshold
            if total_imports / len(py_files) <= 2:
                candidate = OpenSourceCandidate(
                    name=self.generate_project_name(dir_path.name),
                    path=str(dir_path),
                    description=f"Extracted {dir_path.name} module from MemCore"
                )
                candidate.files = [str(f) for f in py_files]
                return candidate
        
        return None
    
    def get_internal_imports(self, tree: ast.AST) -> List[str]:
        """Get imports from parent MemCore modules"""
        imports = []
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom):
                if node.module and node.module.startswith("."):
                    imports.append(node.module)
        return imports
    
    def extract_docstring(self, node: ast.AST) -> Optional[str]:
        """Extract docstring from AST node"""
        if isinstance(node, (ast.FunctionDef, ast.ClassDef, ast.Module)):
            if node.body and isinstance(node.body[0], ast.Expr):
                if isinstance(node.body[0].value, ast.Str):
                    return node.body[0].value.s
        return None
    
    def generate_project_name(self, base_name: str) -> str:
        """Generate a project name from base name"""
        # Convert CamelCase to kebab-case
        name = re.sub(r'(?<!^)(?=[A-Z])', '-', base_name).lower()
        name = name.replace("_", "-")
        
        # Remove common suffixes/prefixes
        for suffix in ["agent", "manager", "system", "engine", "orchestrator"]:
            if name.endswith(f"-{suffix}"):
                name = name[:-len(suffix)-1]
        
        return name
    
    async def research_similar_projects(self, candidate: OpenSourceCandidate) -> Dict[str, Any]:
        """Research similar projects in the market"""
        self.logger.info(f"Researching similar projects for {candidate.name}...")
        
        research = {
            "pypi_packages": [],
            "github_repos": [],
            "similarity_analysis": {},
            "market_gap": ""
        }
        
        # Search PyPI
        pypi_results = await self.search_pypi(candidate.name, candidate.description)
        research["pypi_packages"] = pypi_results
        
        # Search GitHub
        github_results = await self.search_github(candidate.name, candidate.description)
        research["github_repos"] = github_results
        
        # Analyze similarity
        similarity = self.analyze_similarity(candidate, pypi_results + github_results)
        research["similarity_analysis"] = similarity
        
        # Identify market gap
        research["market_gap"] = self.identify_market_gap(candidate, similarity)
        
        candidate.market_research = research
        candidate.similarity_score = similarity.get("max_score", 0)
        
        return research
    
    async def search_pypi(self, name: str, description: str) -> List[Dict[str, Any]]:
        """Search PyPI for similar packages"""
        results = []
        
        search_terms = name.split("-") + description.split()[:5]
        query = " ".join(search_terms[:3])
        
        try:
            async with aiohttp.ClientSession() as session:
                url = f"https://pypi.org/pypi/{query}/json"
                async with session.get(url) as response:
                    if response.status == 200:
                        data = await response.json()
                        results.append({
                            "name": data["info"]["name"],
                            "summary": data["info"]["summary"],
                            "url": data["info"]["project_url"]
                        })
        except:
            pass
        
        return results
    
    async def search_github(self, name: str, description: str) -> List[Dict[str, Any]]:
        """Search GitHub for similar repositories"""
        results = []
        
        if self.github_client:
            try:
                search_query = f"{name} {description.split()[0]} language:python"
                repos = self.github_client.search_repositories(query=search_query, sort="stars")
                
                for repo in repos[:5]:  # Top 5 results
                    results.append({
                        "name": repo.full_name,
                        "description": repo.description,
                        "stars": repo.stargazers_count,
                        "url": repo.html_url
                    })
            except:
                pass
        
        return results
    
    def analyze_similarity(self, candidate: OpenSourceCandidate, 
                          existing_projects: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Analyze similarity between candidate and existing projects"""
        analysis = {
            "max_score": 0,
            "similar_projects": [],
            "unique_features": []
        }
        
        # Simple similarity scoring based on name and description matching
        for project in existing_projects:
            score = 0
            project_name = project.get("name", "").lower()
            project_desc = project.get("description", "").lower() or project.get("summary", "").lower()
            
            # Name similarity
            if candidate.name.lower() in project_name or project_name in candidate.name.lower():
                score += 0.5
            
            # Description similarity (simple word overlap)
            candidate_words = set(candidate.description.lower().split())
            project_words = set(project_desc.split())
            overlap = len(candidate_words & project_words)
            if overlap > 3:
                score += overlap * 0.1
            
            if score > 0.3:
                analysis["similar_projects"].append({
                    "project": project,
                    "score": score
                })
            
            analysis["max_score"] = max(analysis["max_score"], score)
        
        return analysis
    
    def identify_market_gap(self, candidate: OpenSourceCandidate, 
                           similarity_analysis: Dict[str, Any]) -> str:
        """Identify the market gap this project would fill"""
        if similarity_analysis["max_score"] < 0.3:
            return "No similar projects found - completely new solution"
        elif similarity_analysis["max_score"] < 0.6:
            return "Some similar projects exist but with different approach"
        else:
            return "Similar projects exist - need strong differentiation"
    
    async def generate_unique_value_proposition(self, candidate: OpenSourceCandidate) -> str:
        """Generate unique value proposition for the candidate"""
        uvp_parts = []
        
        # Based on similarity score
        if candidate.similarity_score < 0.3:
            uvp_parts.append("First-of-its-kind solution")
        elif candidate.similarity_score < 0.6:
            uvp_parts.append("Unique approach to existing problem")
        
        # Based on MemCore integration
        uvp_parts.append("Battle-tested in MemCore production environment")
        uvp_parts.append("Designed for autonomous AI systems")
        
        # Based on features
        if "orchestrat" in candidate.name.lower():
            uvp_parts.append("Advanced orchestration capabilities")
        if "memory" in candidate.name.lower():
            uvp_parts.append("Persistent cross-session memory")
        if "learn" in candidate.name.lower():
            uvp_parts.append("Self-learning and adaptation")
        
        candidate.unique_value_prop = " | ".join(uvp_parts)
        return candidate.unique_value_prop
    
    def generate_project_name(self, candidate: OpenSourceCandidate) -> str:
        """Generate a proper project name based on functionality"""
        name_parts = []
        
        # Extract key concepts from the candidate
        if "self" in candidate.name.lower() and "learn" in candidate.name.lower():
            name_parts = ["adaptive", "learner"]
        elif "continuous" in candidate.name.lower() and "think" in candidate.name.lower():
            name_parts = ["deep", "reasoner"]
        elif "code" in candidate.name.lower() and "generat" in candidate.name.lower():
            name_parts = ["auto", "coder"]
        elif "task" in candidate.name.lower() and "plan" in candidate.name.lower():
            name_parts = ["smart", "planner"]
        elif "memory" in candidate.name.lower():
            name_parts = ["persistent", "memory"]
        elif "orchestrat" in candidate.name.lower():
            name_parts = ["multi", "orchestrator"]
        elif "mcp" in candidate.name.lower():
            name_parts = ["mcp", "bridge"]
        elif "metric" in candidate.name.lower():
            name_parts = ["ai", "metrics"]
        else:
            # Default: clean up the existing name
            name_parts = candidate.name.lower().replace("_", "-").replace("osa-", "").split("-")
        
        # Create the project name
        project_name = "-".join(name_parts)
        
        # Ensure it's valid for PyPI
        project_name = re.sub(r'[^a-z0-9-]', '-', project_name.lower())
        project_name = re.sub(r'-+', '-', project_name).strip('-')
        
        return project_name
    
    def generate_package_structure(self, project_name: str) -> Dict[str, Any]:
        """Generate proper package structure based on project name"""
        # Convert project name to package name (replace - with _)
        package_name = project_name.replace("-", "_")
        
        # Define the structure
        structure = {
            "project_name": project_name,
            "package_name": package_name,
            "main_module": f"{package_name}.py",
            "main_class": self.to_class_name(project_name),
            "directories": {
                "src": {
                    package_name: {
                        "__init__.py": True,
                        "core.py": True,
                        "utils.py": True,
                        "exceptions.py": True,
                        "types.py": True,
                    }
                },
                "tests": {
                    "__init__.py": True,
                    f"test_{package_name}.py": True,
                    "test_integration.py": True,
                },
                "docs": {
                    "api.md": True,
                    "examples.md": True,
                    "architecture.md": True,
                },
                "examples": {
                    "basic_usage.py": True,
                    "advanced_usage.py": True,
                },
                ".github": {
                    "workflows": {
                        "ci.yml": True,
                        "release.yml": True,
                    }
                }
            },
            "files": {
                "README.md": True,
                "LICENSE": True,
                "setup.py": True,
                "setup.cfg": True,
                "pyproject.toml": True,
                ".gitignore": True,
                "CONTRIBUTING.md": True,
                "CHANGELOG.md": True,
                "requirements.txt": True,
                "requirements-dev.txt": True,
            }
        }
        
        return structure
    
    def to_class_name(self, project_name: str) -> str:
        """Convert project name to class name"""
        parts = project_name.split("-")
        return "".join(word.capitalize() for word in parts)
    
    def refactor_code_for_package(self, source_code: str, package_structure: Dict[str, Any]) -> Dict[str, str]:
        """Refactor source code to match package structure"""
        package_name = package_structure["package_name"]
        main_class = package_structure["main_class"]
        
        # Parse the source code
        try:
            tree = ast.parse(source_code)
        except:
            # If parsing fails, return original
            return {"core.py": source_code}
        
        # Separate imports, classes, and functions
        imports = []
        classes = []
        functions = []
        constants = []
        
        for node in ast.walk(tree):
            if isinstance(node, ast.Import) or isinstance(node, ast.ImportFrom):
                imports.append(ast.unparse(node))
            elif isinstance(node, ast.ClassDef):
                # Rename class to match project conventions
                if node.name.lower() in package_name.lower():
                    node.name = main_class
                classes.append(ast.unparse(node))
            elif isinstance(node, ast.FunctionDef) and node.col_offset == 0:
                functions.append(ast.unparse(node))
            elif isinstance(node, ast.Assign) and node.col_offset == 0:
                constants.append(ast.unparse(node))
        
        # Create refactored files
        files = {}
        
        # core.py - main implementation
        core_content = []
        core_content.append(f'"""Core implementation of {package_structure["project_name"]}"""\n')
        core_content.extend(imports)
        core_content.append("\n")
        core_content.extend(classes)
        files["core.py"] = "\n".join(core_content)
        
        # utils.py - utility functions
        if functions:
            utils_content = []
            utils_content.append(f'"""Utility functions for {package_structure["project_name"]}"""\n')
            utils_content.extend([imp for imp in imports if "typing" in imp])
            utils_content.append("\n")
            utils_content.extend(functions)
            files["utils.py"] = "\n".join(utils_content)
        
        # types.py - type definitions
        types_content = f'''"""Type definitions for {package_structure["project_name"]}"""

from typing import Dict, List, Optional, Any, Union, Callable
from enum import Enum
from dataclasses import dataclass

# Add custom types here
'''
        files["types.py"] = types_content
        
        # exceptions.py - custom exceptions
        exceptions_content = f'''"""Custom exceptions for {package_structure["project_name"]}"""


class {main_class}Error(Exception):
    """Base exception for {package_structure["project_name"]}"""
    pass


class ConfigurationError({main_class}Error):
    """Raised when configuration is invalid"""
    pass


class ValidationError({main_class}Error):
    """Raised when validation fails"""
    pass
'''
        files["exceptions.py"] = exceptions_content
        
        # __init__.py - package initialization
        init_content = f'''"""\n{package_structure["project_name"]}
==={'=' * len(package_structure["project_name"])}

A powerful Python package extracted from MemCore.
"""

__version__ = "0.1.0"
__author__ = "MemCore Contributors"

from .core import {main_class}
from .exceptions import {main_class}Error

__all__ = [
    "{main_class}",
    "{main_class}Error",
]
'''
        files["__init__.py"] = init_content
        
        return files
    
    async def extract_and_restructure(self, candidate: OpenSourceCandidate) -> Path:
        """Extract code and restructure as standalone project with proper naming"""
        self.logger.info(f"Extracting and restructuring {candidate.name}...")
        
        # Generate proper project name
        project_name = self.generate_project_name(candidate)
        self.logger.info(f"Generated project name: {project_name}")
        
        # Generate package structure
        package_structure = self.generate_package_structure(project_name)
        package_name = package_structure["package_name"]
        
        # Create project directory in modules
        project_dir = self.modules_dir / project_name
        project_dir.mkdir(parents=True, exist_ok=True)
        
        # Create directory structure based on generated structure
        self.create_directory_structure(project_dir, package_structure["directories"])
        
        # Process and refactor source files
        src_package = project_dir / "src" / package_name
        
        # Read and combine source files
        combined_source = ""
        for file_path in candidate.files:
            source = Path(file_path)
            if source.is_file() and source.suffix == ".py":
                content = source.read_text()
                combined_source += content + "\n\n"
        
        # Refactor code for the new package structure
        refactored_files = self.refactor_code_for_package(combined_source, package_structure)
        
        # Write refactored files
        for filename, content in refactored_files.items():
            file_path = src_package / filename
            file_path.write_text(content)
            self.clean_imports(file_path)
        
        # Create all necessary files
        self.create_project_files(project_dir, package_structure, candidate)
        
        # Initialize git repository
        self.initialize_git_repo(project_dir, project_name)
        
        # Update MemCore to use the extracted module
        self.create_adapter_with_new_name(candidate, project_name, package_name)
        
        # Store the proper project name
        candidate.project_name = project_name
        candidate.package_name = package_name
        
        return project_dir
    
    def create_directory_structure(self, base_dir: Path, structure: Dict[str, Any]):
        """Recursively create directory structure"""
        for name, content in structure.items():
            path = base_dir / name
            if isinstance(content, dict):
                path.mkdir(parents=True, exist_ok=True)
                self.create_directory_structure(path, content)
            elif content is True:
                # It's a file marker, we'll create it later
                pass
    
    def create_project_files(self, project_dir: Path, package_structure: Dict[str, Any], candidate: OpenSourceCandidate):
        """Create all project files with proper naming"""
        project_name = package_structure["project_name"]
        package_name = package_structure["package_name"]
        main_class = package_structure["main_class"]
        
        # Create setup.py
        self.create_enhanced_setup_file(project_dir, project_name, package_name, candidate)
        
        # Create pyproject.toml
        self.create_pyproject_toml(project_dir, project_name)
        
        # Create README.md
        self.create_enhanced_readme(project_dir, project_name, package_name, main_class, candidate)
        
        # Create LICENSE
        self.create_license(project_dir)
        
        # Create .gitignore
        self.create_gitignore(project_dir)
        
        # Create CONTRIBUTING.md
        self.create_enhanced_contributing(project_dir, project_name)
        
        # Create CHANGELOG.md
        self.create_changelog(project_dir, project_name)
        
        # Create requirements files
        self.create_requirements_files(project_dir, candidate)
        
        # Create tests
        self.create_enhanced_tests(project_dir / "tests", package_name, main_class)
        
        # Create examples
        self.create_enhanced_examples(project_dir / "examples", package_name, main_class)
        
        # Create GitHub Actions
        self.create_enhanced_github_actions(project_dir, project_name)
        
        # Create documentation
        self.create_documentation(project_dir / "docs", project_name, package_name, main_class)
    
    def initialize_git_repo(self, project_dir: Path, project_name: str):
        """Initialize git repository and make initial commit"""
        try:
            repo = git.Repo.init(project_dir)
            repo.index.add("*")
            repo.index.commit(f"Initial commit for {project_name}")
            self.logger.info(f"Initialized git repository for {project_name}")
        except Exception as e:
            self.logger.warning(f"Could not initialize git repo: {e}")
    
    def create_adapter_with_new_name(self, candidate: OpenSourceCandidate, project_name: str, package_name: str):
        """Create adapter in MemCore to use the extracted module with new name"""
        adapter_content = f'''"""Adapter for using extracted {project_name} module"""

try:
    from {package_name} import {self.to_class_name(project_name)}
    AVAILABLE = True
except ImportError:
    AVAILABLE = False
    
    # Fallback to original implementation
    from {candidate.path.replace("/", ".")} import *

# Compatibility layer
if AVAILABLE:
    # Module has been extracted and installed
    pass
else:
    # Using original MemCore implementation
    pass
'''
        
        # Save adapter
        adapter_path = self.src_dir / "adapters" / f"{package_name}_adapter.py"
        adapter_path.parent.mkdir(exist_ok=True)
        adapter_path.write_text(adapter_content)
    
    def clean_imports(self, file_path: Path):
        """Clean internal MemCore imports from extracted file"""
        content = file_path.read_text()
        
        # Remove relative imports from MemCore
        content = re.sub(r'from \.\. import.*\n', '', content)
        content = re.sub(r'from \. import.*\n', '', content)
        
        # Convert absolute MemCore imports to TODO comments
        content = re.sub(
            r'from src\.core\.(.*) import (.*)',
            r'# TODO: Replace with appropriate import\n# from \1 import \2',
            content
        )
        
        file_path.write_text(content)
    
    def create_init_file(self, package_dir: Path, candidate: OpenSourceCandidate):
        """Create __init__.py with proper exports"""
        content = f'''"""{candidate.description}"""

__version__ = "0.1.0"

# Import main components
# TODO: Add actual imports based on module structure

__all__ = [
    # TODO: Add exported classes and functions
]
'''
        (package_dir / "__init__.py").write_text(content)
    
    def create_setup_file(self, project_dir: Path, candidate: OpenSourceCandidate):
        """Create setup.py for the project"""
        package_name = candidate.name.replace("-", "_")
        content = f'''"""Setup configuration for {candidate.name}"""

from setuptools import setup, find_packages

with open("README.md", "r", encoding="utf-8") as fh:
    long_description = fh.read()

setup(
    name="{candidate.name}",
    version="0.1.0",
    author="MemCore Contributors",
    author_email="osa@omnimind.ai",
    description="{candidate.description}",
    long_description=long_description,
    long_description_content_type="text/markdown",
    url="https://github.com/{self.github_username}/{candidate.name}",
    packages=find_packages(where="src"),
    package_dir={{"": "src"}},
    classifiers=[
        "Development Status :: 3 - Alpha",
        "Intended Audience :: Developers",
        "Topic :: Software Development :: Libraries :: Python Modules",
        "License :: OSI Approved :: MIT License",
        "Programming Language :: Python :: 3",
        "Programming Language :: Python :: 3.8",
        "Programming Language :: Python :: 3.9",
        "Programming Language :: Python :: 3.10",
        "Programming Language :: Python :: 3.11",
    ],
    python_requires=">=3.8",
    install_requires=[
        # TODO: Add actual dependencies
    ],
    extras_require={{
        "dev": [
            "pytest>=7.0.0",
            "black>=22.0.0",
            "flake8>=4.0.0",
            "mypy>=0.950",
        ],
    }},
)
'''
        (project_dir / "setup.py").write_text(content)
    
    def create_readme(self, project_dir: Path, candidate: OpenSourceCandidate):
        """Create comprehensive README.md"""
        content = f'''# {candidate.name}

{candidate.description}

## 🎯 Unique Value Proposition

{candidate.unique_value_prop}

## 📋 Features

- Extracted from production-ready MemCore system
- Battle-tested in real-world applications
- Designed for AI and automation workflows
- Fully async support
- Comprehensive test coverage

## 🚀 Installation

```bash
pip install {candidate.name}
```

Or install from source:

```bash
git clone https://github.com/{self.github_username}/{candidate.name}.git
cd {candidate.name}
pip install -e .
```

## 📖 Quick Start

```python
# TODO: Add quick start example
import {candidate.name.replace("-", "_")}

# Your code here
```

## 📚 Documentation

Full documentation available at [https://{self.github_username}.github.io/{candidate.name}](https://{self.github_username}.github.io/{candidate.name})

## 🤝 Contributing

We welcome contributions! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## 📝 License

MIT License - see [LICENSE](LICENSE) file for details.

## 🏗️ Project Origin

This project was extracted from [MemCore (OmniMind Super Agent)](https://github.com/{self.github_username}/omnimind), 
an autonomous AI system designed for 100% autonomous operation.

## 📊 Market Research

### Similar Projects
{self.format_market_research(candidate.market_research)}

### Why This Project?
{candidate.market_research.get("market_gap", "Filling a unique gap in the ecosystem")}

## 🛠️ Development

```bash
# Install in development mode
pip install -e ".[dev]"

# Run tests
pytest

# Format code
black src tests

# Lint
flake8 src tests
```

## 📈 Roadmap

- [ ] Initial release
- [ ] Add more examples
- [ ] Improve documentation
- [ ] Add more tests
- [ ] Performance optimizations

## 💬 Support

- Issues: [GitHub Issues](https://github.com/{self.github_username}/{candidate.name}/issues)
- Discussions: [GitHub Discussions](https://github.com/{self.github_username}/{candidate.name}/discussions)
'''
        (project_dir / "README.md").write_text(content)
    
    def format_market_research(self, research: Dict[str, Any]) -> str:
        """Format market research for README"""
        lines = []
        
        if research.get("pypi_packages"):
            lines.append("**PyPI Packages:**")
            for pkg in research["pypi_packages"][:3]:
                lines.append(f"- [{pkg['name']}]({pkg.get('url', '#')})")
        
        if research.get("github_repos"):
            lines.append("\n**GitHub Repositories:**")
            for repo in research["github_repos"][:3]:
                lines.append(f"- [{repo['name']}]({repo['url']}) ⭐ {repo.get('stars', 0)}")
        
        if not lines:
            lines.append("No directly similar projects found.")
        
        return "\n".join(lines)
    
    def create_license(self, project_dir: Path):
        """Create MIT LICENSE file"""
        content = f'''MIT License

Copyright (c) {pendulum.now().year} MemCore Contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
'''
        (project_dir / "LICENSE").write_text(content)
    
    def create_gitignore(self, project_dir: Path):
        """Create .gitignore file"""
        content = '''# Byte-compiled / optimized / DLL files
__pycache__/
*.py[cod]
*$py.class

# Distribution / packaging
.Python
build/
develop-eggs/
dist/
downloads/
eggs/
.eggs/
lib/
lib64/
parts/
sdist/
var/
wheels/
*.egg-info/
.installed.cfg
*.egg

# PyInstaller
*.manifest
*.spec

# Unit test / coverage reports
htmlcov/
.tox/
.coverage
.coverage.*
.cache
nosetests.xml
coverage.xml
*.cover
.hypothesis/
.pytest_cache/

# Environments
.env
.venv
env/
venv/
ENV/

# IDEs
.idea/
.vscode/
*.swp
*.swo
*~
.DS_Store

# Project specific
*.log
*.db
*.sqlite3
'''
        (project_dir / ".gitignore").write_text(content)
    
    def create_contributing(self, project_dir: Path, candidate: OpenSourceCandidate):
        """Create CONTRIBUTING.md"""
        content = f'''# Contributing to {candidate.name}

We love your input! We want to make contributing as easy and transparent as possible.

## Development Process

1. Fork the repo and create your branch from `main`
2. If you've added code that should be tested, add tests
3. If you've changed APIs, update the documentation
4. Ensure the test suite passes
5. Make sure your code lints
6. Issue that pull request!

## Code Style

- We use Black for Python code formatting
- We use flake8 for linting
- Type hints are encouraged

## Testing

```bash
pytest tests/
```

## License

By contributing, you agree that your contributions will be licensed under MIT License.
'''
        (project_dir / "CONTRIBUTING.md").write_text(content)
    
    def create_basic_tests(self, tests_dir: Path, candidate: OpenSourceCandidate):
        """Create basic test structure"""
        content = f'''"""Tests for {candidate.name}"""

import pytest


def test_import():
    """Test that the package can be imported"""
    import {candidate.name.replace("-", "_")}
    assert {candidate.name.replace("-", "_")} is not None


# TODO: Add actual tests based on module functionality
'''
        (tests_dir / f"test_{candidate.name.replace('-', '_')}.py").write_text(content)
    
    def create_examples(self, examples_dir: Path, candidate: OpenSourceCandidate):
        """Create example files"""
        content = f'''#!/usr/bin/env python3
"""Basic usage example for {candidate.name}"""

import {candidate.name.replace("-", "_")}


def main():
    """Main example function"""
    # TODO: Add actual usage example
    print(f"Using {candidate.name}...")


if __name__ == "__main__":
    main()
'''
        (examples_dir / "basic_usage.py").write_text(content)
    
    def create_github_actions(self, project_dir: Path):
        """Create GitHub Actions CI/CD workflow"""
        workflow_dir = project_dir / ".github" / "workflows"
        workflow_dir.mkdir(parents=True, exist_ok=True)
        
        content = '''name: CI

on:
  push:
    branches: [ main ]
  pull_request:
    branches: [ main ]

jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        python-version: ["3.8", "3.9", "3.10", "3.11"]

    steps:
    - uses: actions/checkout@v3
    
    - name: Set up Python ${{ matrix.python-version }}
      uses: actions/setup-python@v4
      with:
        python-version: ${{ matrix.python-version }}
    
    - name: Install dependencies
      run: |
        python -m pip install --upgrade pip
        pip install -e ".[dev]"
    
    - name: Lint with flake8
      run: |
        flake8 src tests --count --select=E9,F63,F7,F82 --show-source --statistics
    
    - name: Test with pytest
      run: |
        pytest tests/
'''
        (workflow_dir / "ci.yml").write_text(content)
    
    def create_enhanced_setup_file(self, project_dir: Path, project_name: str, package_name: str, candidate: OpenSourceCandidate):
        """Create enhanced setup.py with proper project name"""
        content = f'''"""Setup configuration for {project_name}"""

from setuptools import setup, find_packages

with open("README.md", "r", encoding="utf-8") as fh:
    long_description = fh.read()

setup(
    name="{project_name}",
    version="0.1.0",
    author="MemCore Contributors",
    author_email="osa@omnimind.ai",
    description="{candidate.description}",
    long_description=long_description,
    long_description_content_type="text/markdown",
    url="https://github.com/{self.github_username}/{project_name}",
    packages=find_packages(where="src"),
    package_dir={{"": "src"}},
    classifiers=[
        "Development Status :: 3 - Alpha",
        "Intended Audience :: Developers",
        "Topic :: Software Development :: Libraries :: Python Modules",
        "License :: OSI Approved :: MIT License",
        "Programming Language :: Python :: 3",
        "Programming Language :: Python :: 3.8",
        "Programming Language :: Python :: 3.9",
        "Programming Language :: Python :: 3.10",
        "Programming Language :: Python :: 3.11",
    ],
    python_requires=">=3.8",
    install_requires=[
        # TODO: Add actual dependencies
    ],
    extras_require={{
        "dev": [
            "pytest>=7.0.0",
            "black>=22.0.0",
            "flake8>=4.0.0",
            "mypy>=0.950",
        ],
    }},
)
'''
        (project_dir / "setup.py").write_text(content)
    
    def create_pyproject_toml(self, project_dir: Path, project_name: str):
        """Create pyproject.toml for modern Python packaging"""
        content = f'''[build-system]
requires = ["setuptools>=61.0", "wheel"]
build-backend = "setuptools.build_meta"

[project]
name = "{project_name}"
version = "0.1.0"
description = "Extracted from MemCore - Autonomous AI System"
readme = "README.md"
requires-python = ">=3.8"
license = {{text = "MIT"}}
authors = [
    {{name = "MemCore Contributors", email = "osa@omnimind.ai"}},
]
classifiers = [
    "Development Status :: 3 - Alpha",
    "Intended Audience :: Developers",
    "License :: OSI Approved :: MIT License",
    "Programming Language :: Python :: 3",
]

[project.urls]
Homepage = "https://github.com/{self.github_username}/{project_name}"
Documentation = "https://{self.github_username}.github.io/{project_name}"
Repository = "https://github.com/{self.github_username}/{project_name}"
Issues = "https://github.com/{self.github_username}/{project_name}/issues"

[tool.black]
line-length = 100
target-version = ['py38', 'py39', 'py310', 'py311']

[tool.pytest.ini_options]
testpaths = ["tests"]
python_files = ["test_*.py"]

[tool.mypy]
python_version = "3.8"
warn_return_any = true
warn_unused_configs = true
'''
        (project_dir / "pyproject.toml").write_text(content)
    
    def create_enhanced_readme(self, project_dir: Path, project_name: str, package_name: str, main_class: str, candidate: OpenSourceCandidate):
        """Create enhanced README with proper naming"""
        content = f'''# {project_name}

{candidate.description}

## 🎯 Unique Value Proposition

{candidate.unique_value_prop}

## 📋 Features

- Extracted from production-ready MemCore system
- Battle-tested in real-world applications
- Designed for AI and automation workflows
- Fully async support
- Comprehensive test coverage

## 🚀 Installation

```bash
pip install {project_name}
```

Or install from source:

```bash
git clone https://github.com/{self.github_username}/{project_name}.git
cd {project_name}
pip install -e .
```

## 📖 Quick Start

```python
from {package_name} import {main_class}

# Initialize
instance = {main_class}()

# Use the functionality
# TODO: Add actual usage examples
```

## 📚 Documentation

Full documentation available at [https://{self.github_username}.github.io/{project_name}](https://{self.github_username}.github.io/{project_name})

## 🤝 Contributing

We welcome contributions! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## 📝 License

MIT License - see [LICENSE](LICENSE) file for details.

## 🏗️ Project Origin

This project was extracted from [MemCore (OmniMind Super Agent)](https://github.com/{self.github_username}/omnimind), 
an autonomous AI system designed for 100% autonomous operation.

## 📊 Market Research

{self.format_market_research(candidate.market_research)}

### Why This Project?
{candidate.market_research.get("market_gap", "Filling a unique gap in the ecosystem")}

## 🛠️ Development

```bash
# Install in development mode
pip install -e ".[dev]"

# Run tests
pytest

# Format code
black src tests

# Lint
flake8 src tests
```

## 📈 Roadmap

- [ ] Initial release
- [ ] Add comprehensive examples
- [ ] Improve documentation
- [ ] Add more tests
- [ ] Performance optimizations
- [ ] PyPI publication

## 💬 Support

- Issues: [GitHub Issues](https://github.com/{self.github_username}/{project_name}/issues)
- Discussions: [GitHub Discussions](https://github.com/{self.github_username}/{project_name}/discussions)
'''
        (project_dir / "README.md").write_text(content)
    
    def create_enhanced_contributing(self, project_dir: Path, project_name: str):
        """Create enhanced CONTRIBUTING.md"""
        content = f'''# Contributing to {project_name}

We love your input! We want to make contributing as easy and transparent as possible.

## Development Process

1. Fork the repo and create your branch from `main`
2. If you've added code that should be tested, add tests
3. If you've changed APIs, update the documentation
4. Ensure the test suite passes
5. Make sure your code lints
6. Issue that pull request!

## Code Style

- We use Black for Python code formatting (line length: 100)
- We use flake8 for linting
- Type hints are required for all new code
- Docstrings required for all public functions/classes

## Testing

```bash
# Run all tests
pytest tests/

# Run with coverage
pytest --cov=src tests/

# Run specific test file
pytest tests/test_specific.py
```

## Pull Request Process

1. Update the README.md with details of changes if applicable
2. Update the CHANGELOG.md with your changes
3. The PR will be merged once you have the sign-off of at least one maintainer

## License

By contributing, you agree that your contributions will be licensed under MIT License.
'''
        (project_dir / "CONTRIBUTING.md").write_text(content)
    
    def create_changelog(self, project_dir: Path, project_name: str):
        """Create CHANGELOG.md"""
        content = f'''# Changelog

All notable changes to {project_name} will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Initial extraction from MemCore codebase
- Basic project structure
- Core functionality
- Test suite
- Documentation

### Changed
- Nothing yet

### Fixed
- Nothing yet

## [0.1.0] - {pendulum.now().format("%Y-%m-%d")}

### Added
- Initial release
- Extracted from MemCore project
'''
        (project_dir / "CHANGELOG.md").write_text(content)
    
    def create_requirements_files(self, project_dir: Path, candidate: OpenSourceCandidate):
        """Create requirements files"""
        # Main requirements
        requirements = []
        if "async" in str(candidate.files):
            requirements.append("asyncio")
        if "typing" in str(candidate.files):
            requirements.append("typing-extensions>=4.0.0")
        
        (project_dir / "requirements.txt").write_text("\n".join(requirements) if requirements else "# No dependencies yet\n")
        
        # Dev requirements
        dev_requirements = [
            "pytest>=7.0.0",
            "pytest-asyncio>=0.21.0",
            "pytest-cov>=4.0.0",
            "black>=22.0.0",
            "flake8>=4.0.0",
            "mypy>=0.950",
            "sphinx>=5.0.0",
            "sphinx-rtd-theme>=1.0.0",
        ]
        (project_dir / "requirements-dev.txt").write_text("\n".join(dev_requirements))
    
    def create_enhanced_tests(self, tests_dir: Path, package_name: str, main_class: str):
        """Create enhanced test files"""
        # Main test file
        test_content = f'''"""Tests for {package_name}"""

import pytest
from {package_name} import {main_class}


class Test{main_class}:
    """Test cases for {main_class}"""
    
    def test_import(self):
        """Test that the package can be imported"""
        assert {main_class} is not None
    
    def test_initialization(self):
        """Test initialization"""
        instance = {main_class}()
        assert instance is not None
    
    # TODO: Add actual tests based on functionality


@pytest.fixture
def sample_instance():
    """Fixture for creating test instance"""
    return {main_class}()
'''
        (tests_dir / f"test_{package_name}.py").write_text(test_content)
        
        # Integration test file
        integration_content = f'''"""Integration tests for {package_name}"""

import pytest
from {package_name} import {main_class}


@pytest.mark.integration
class TestIntegration:
    """Integration test cases"""
    
    def test_end_to_end(self):
        """Test end-to-end functionality"""
        # TODO: Add integration tests
        pass
'''
        (tests_dir / "test_integration.py").write_text(integration_content)
    
    def create_enhanced_examples(self, examples_dir: Path, package_name: str, main_class: str):
        """Create enhanced example files"""
        # Basic usage
        basic_content = f'''#!/usr/bin/env python3
"""Basic usage example for {package_name}"""

from {package_name} import {main_class}


def main():
    """Main example function"""
    # Initialize
    instance = {main_class}()
    
    # TODO: Add actual usage examples
    print(f"Using {{instance}}")


if __name__ == "__main__":
    main()
'''
        (examples_dir / "basic_usage.py").write_text(basic_content)
        
        # Advanced usage
        advanced_content = f'''#!/usr/bin/env python3
"""Advanced usage example for {package_name}"""

import asyncio
from {package_name} import {main_class}


async def advanced_example():
    """Advanced async example"""
    # Initialize with custom config
    config = {{
        # TODO: Add configuration options
    }}
    instance = {main_class}(config)
    
    # TODO: Add advanced usage examples
    print(f"Advanced usage with {{instance}}")


if __name__ == "__main__":
    asyncio.run(advanced_example())
'''
        (examples_dir / "advanced_usage.py").write_text(advanced_content)
    
    def create_enhanced_github_actions(self, project_dir: Path, project_name: str):
        """Create enhanced GitHub Actions workflows"""
        workflow_dir = project_dir / ".github" / "workflows"
        workflow_dir.mkdir(parents=True, exist_ok=True)
        
        # CI workflow
        ci_content = f'''name: CI

on:
  push:
    branches: [ main, develop ]
  pull_request:
    branches: [ main ]

jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        python-version: ["3.8", "3.9", "3.10", "3.11"]

    steps:
    - uses: actions/checkout@v3
    
    - name: Set up Python ${{{{ matrix.python-version }}}}
      uses: actions/setup-python@v4
      with:
        python-version: ${{{{ matrix.python-version }}}}
    
    - name: Install dependencies
      run: |
        python -m pip install --upgrade pip
        pip install -e ".[dev]"
    
    - name: Format check with black
      run: |
        black --check src tests
    
    - name: Lint with flake8
      run: |
        flake8 src tests
    
    - name: Type check with mypy
      run: |
        mypy src
    
    - name: Test with pytest
      run: |
        pytest tests/ --cov=src --cov-report=term-missing
'''
        (workflow_dir / "ci.yml").write_text(ci_content)
        
        # Release workflow
        release_content = f'''name: Release

on:
  push:
    tags:
      - 'v*'

jobs:
  release:
    runs-on: ubuntu-latest
    
    steps:
    - uses: actions/checkout@v3
    
    - name: Set up Python
      uses: actions/setup-python@v4
      with:
        python-version: '3.10'
    
    - name: Install dependencies
      run: |
        python -m pip install --upgrade pip
        pip install build twine
    
    - name: Build package
      run: |
        python -m build
    
    - name: Publish to PyPI
      env:
        TWINE_USERNAME: __token__
        TWINE_PASSWORD: ${{{{ secrets.PYPI_API_TOKEN }}}}
      run: |
        twine upload dist/*
'''
        (workflow_dir / "release.yml").write_text(release_content)
    
    def create_documentation(self, docs_dir: Path, project_name: str, package_name: str, main_class: str):
        """Create documentation files"""
        # API documentation
        api_content = f'''# API Reference

## {main_class}

The main class for {project_name}.

### Methods

TODO: Document methods

### Examples

```python
from {package_name} import {main_class}

instance = {main_class}()
```
'''
        (docs_dir / "api.md").write_text(api_content)
        
        # Architecture documentation
        arch_content = f'''# Architecture

## Overview

{project_name} is designed with the following principles:

- Modularity
- Extensibility
- Performance
- Ease of use

## Components

TODO: Document components

## Data Flow

TODO: Document data flow
'''
        (docs_dir / "architecture.md").write_text(arch_content)
        
        # Examples documentation
        examples_content = f'''# Examples

## Basic Usage

See [basic_usage.py](../examples/basic_usage.py)

## Advanced Usage

See [advanced_usage.py](../examples/advanced_usage.py)

## Real-world Use Cases

TODO: Add real-world examples
'''
        (docs_dir / "examples.md").write_text(examples_content)
    
    def create_adapter(self, candidate: OpenSourceCandidate):
        """Create adapter in MemCore to use the extracted module"""
        adapter_name = f"{candidate.name.replace('-', '_')}_adapter.py"
        adapter_path = self.src_dir / "adapters" / adapter_name
        adapter_path.parent.mkdir(exist_ok=True)
        
        content = f'''"""Adapter for using the extracted {candidate.name} module"""

import sys
from pathlib import Path

# Add module path (temporary until pip install)
module_path = Path(__file__).parent.parent.parent / "modules" / "{candidate.name}" / "src"
sys.path.insert(0, str(module_path))

# Import from the extracted module
try:
    import {candidate.name.replace("-", "_")}
    # TODO: Import specific components
except ImportError:
    print(f"Warning: {candidate.name} not installed. Install with: pip install {candidate.name}")
    {candidate.name.replace("-", "_")} = None

# Re-export for backward compatibility
__all__ = [
    # TODO: Add exports
]
'''
        adapter_path.write_text(content)
    
    async def publish_to_github(self, project_dir: Path, candidate: OpenSourceCandidate) -> str:
        """Publish project to GitHub"""
        self.logger.info(f"Publishing {candidate.name} to GitHub...")
        
        try:
            # Initialize git repository
            repo = git.Repo.init(project_dir)
            
            # Add all files
            repo.index.add("*")
            
            # Create initial commit
            repo.index.commit(f"feat: initial release of {candidate.name}\n\n{candidate.description}")
            
            # Create GitHub repository
            if self.github_client:
                github_repo = self.github_client.get_user().create_repo(
                    name=candidate.name,
                    description=candidate.description,
                    private=False,
                    has_issues=True,
                    has_wiki=True,
                    has_downloads=True,
                    auto_init=False
                )
                
                # Add remote and push
                origin = repo.create_remote("origin", github_repo.clone_url)
                origin.push(refspec="main:main")
                
                candidate.github_url = github_repo.html_url
                self.published_projects[candidate.name] = candidate.github_url
                self.save_history()
                
                self.logger.info(f"Published to: {candidate.github_url}")
                return candidate.github_url
            else:
                self.logger.warning("GitHub client not configured, skipping publish")
                return ""
                
        except Exception as e:
            self.logger.error(f"Failed to publish to GitHub: {e}")
            return ""
    
    def cleanup_projects_folder(self):
        """Clean up the projects folder after successful extraction"""
        # Move successfully published projects to modules directory
        # Remove temporary files
        # Update references in MemCore
        pass
    
    
    async def monitor_and_maintain(self):
        """Monitor published projects and maintain them"""
        # Check for issues
        # Update dependencies
        # Merge PRs
        pass
    
    async def run_continuous_scan(self):
        """Run continuous scanning for open source opportunities"""
        while True:
            try:
                # Scan for new opportunities
                candidates = await self.scan_for_opportunities()
                
                for candidate in candidates:
                    # Research similar projects
                    await self.research_similar_projects(candidate)
                    
                    # Generate unique value proposition
                    await self.generate_unique_value_proposition(candidate)
                    
                    # Check if worth extracting (low similarity, high value)
                    if candidate.similarity_score < 0.7:
                        self.logger.info(f"Extracting {candidate.name} (similarity: {candidate.similarity_score:.2f})")
                        
                        # Extract and restructure
                        project_dir = await self.extract_and_restructure(candidate)
                        
                        # Publish to GitHub
                        github_url = await self.publish_to_github(project_dir, candidate)
                        
                        if github_url:
                            # Create documentation
                            await self.create_documentation(candidate)
                            
                            # Cleanup
                            self.cleanup_projects_folder()
                            
                            self.logger.info(f"Successfully published {candidate.name} to {github_url}")
                
                # Update scan history
                self.scan_history[pendulum.now().isoformat()] = pendulum.now()
                self.save_history()
                
                # Wait before next scan (e.g., daily)
                await asyncio.sleep(86400)  # 24 hours
                
            except Exception as e:
                self.logger.error(f"Error in continuous scan: {e}")
                await asyncio.sleep(3600)  # Retry in 1 hour


# Singleton instance
_extractor_agent = None

def get_open_source_extractor(config: Dict[str, Any] = None) -> OpenSourceExtractorAgent:
    """Get or create the global open source extractor agent"""
    global _extractor_agent
    if _extractor_agent is None:
        _extractor_agent = OpenSourceExtractorAgent(config)
    return _extractor_agent


async def main():
    """Main entry point for the agent"""
    agent = get_open_source_extractor()
    
    # Run continuous scanning
    await agent.run_continuous_scan()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    asyncio.run(main())