import pendulum
import orjson
#!/usr/bin/env python3
"""
Open Source Solution Finder Agent for MemCore

This agent is called BEFORE writing any custom code to:
1. Find existing open source solutions at package, module, or function level
2. Suggest libraries, utilities, or code snippets that can replace custom code
3. Scan the entire MemCore codebase to identify replacement opportunities
4. Extract reusable components as open source projects

Levels of operation:
- PACKAGE: Complete libraries that provide entire feature sets
- MODULE: Specific modules or classes for focused functionality
- FUNCTION: Individual utilities or helper functions
- SNIPPET: Code snippets or patterns that can be reused

This agent ensures MemCore follows "Integration over Custom Code" philosophy.
"""

import os
import json
import shutil
import asyncio
import subprocess
import ast
import re
from pathlib import Path
from typing import Dict, List, Optional, Any, Tuple, Set
from datetime import datetime
from enum import Enum
import logging
import hashlib
from dataclasses import dataclass, field

# For web research
import aiohttp
from github import Github


class SolutionLevel(Enum):
    """Level at which we're looking for solutions"""
    PACKAGE = "package"      # Full library/package
    MODULE = "module"        # Specific module/class
    FUNCTION = "function"    # Individual function/utility
    SNIPPET = "snippet"      # Code snippet/pattern


class SolutionType(Enum):
    """Type of solution found"""
    EXACT_MATCH = "exact_match"           # Exactly what we need
    PARTIAL_MATCH = "partial_match"       # Partially solves the problem
    ALTERNATIVE = "alternative"           # Different approach to same problem
    COMBINATION = "combination"           # Multiple libraries needed
    BUILD_CUSTOM = "build_custom"         # No good solution, build custom
    EXTRACT_MemCore = "extract_from_osa"     # Extract from MemCore as open source


@dataclass
class RequirementSpec:
    """Specification of what we need to implement"""
    description: str
    level: SolutionLevel
    keywords: List[str] = field(default_factory=list)
    required_features: List[str] = field(default_factory=list)
    nice_to_have: List[str] = field(default_factory=list)
    constraints: List[str] = field(default_factory=list)
    examples: List[str] = field(default_factory=list)


@dataclass
class OpenSourceSolution:
    """Represents a found open source solution"""
    name: str
    type: SolutionType
    level: SolutionLevel
    description: str
    url: str
    stars: int = 0
    downloads: int = 0
    last_updated: Optional[datetime] = None
    license: str = ""
    match_score: float = 0.0
    pros: List[str] = field(default_factory=list)
    cons: List[str] = field(default_factory=list)
    installation: str = ""
    usage_example: str = ""
    alternatives: List[str] = field(default_factory=list)


@dataclass
class CodebaseReplacementOpportunity:
    """Opportunity to replace MemCore code with open source"""
    file_path: str
    line_range: Tuple[int, int]
    current_code: str
    description: str
    suggested_library: str
    replacement_code: str
    benefits: List[str]
    migration_effort: str  # low, medium, high
    priority: int  # 1-5, 1 being highest


class OpenSourceSolutionFinder:
    """
    Agent that finds open source solutions BEFORE writing custom code
    and identifies replacement opportunities in existing codebase
    """
    
    def __init__(self, config: Dict[str, Any] = None):
        self.config = config or {}
        self.logger = logging.getLogger("SolutionFinder")
        
        # Paths
        self.osa_root = Path("/Users/MAC/Documents/projects/omnimind")
        self.cache_dir = self.osa_root / ".solution_cache"
        self.cache_dir.mkdir(exist_ok=True)
        
        # GitHub client for searching
        self.github_token = os.getenv("GITHUB_TOKEN")
        self.github_client = None
        if self.github_token:
            self.github_client = Github(self.github_token)
        
        # Solution cache (to avoid repeated searches)
        self.solution_cache: Dict[str, List[OpenSourceSolution]] = {}
        self.load_cache()
        
        # Known good libraries for common tasks
        self.known_solutions = {
            # Utility functions
            "date_manipulation": ["pendulum", "arrow", "dateutil"],
            "string_manipulation": ["inflect", "humanize", "slugify"],
            "file_operations": ["pathlib", "watchdog", "python-magic"],
            "data_validation": ["pydantic", "marshmallow", "cerberus"],
            "configuration": ["python-decouple", "configparser", "dynaconf"],
            
            # Web and API
            "http_client": ["httpx", "requests", "aiohttp"],
            "web_scraping": ["beautifulsoup4", "scrapy", "selenium"],
            "api_framework": ["fastapi", "flask", "django-rest-framework"],
            "websocket": ["websockets", "python-socketio"],
            
            # Data processing
            "json_handling": ["orjson", "ujson", "simplejson"],
            "csv_processing": ["pandas", "csvkit", "tablib"],
            "data_transformation": ["pandas", "polars", "dask"],
            
            # Testing
            "unit_testing": ["pytest", "unittest", "nose2"],
            "mocking": ["unittest.mock", "pytest-mock", "responses"],
            "test_data": ["faker", "factory-boy", "hypothesis"],
            
            # Async and concurrency
            "async_tasks": ["asyncio", "aiofiles", "aiodns"],
            "task_queue": ["celery", "rq", "huey"],
            "parallel_processing": ["multiprocessing", "joblib", "ray"],
            
            # AI/ML specific
            "llm_integration": ["langchain", "llama-index", "semantic-kernel"],
            "vector_database": ["chromadb", "pinecone", "weaviate", "qdrant"],
            "embeddings": ["sentence-transformers", "openai", "cohere"],
            "agent_framework": ["crewai", "autogen", "agency-swarm"],
            
            # Database
            "orm": ["sqlalchemy", "peewee", "tortoise-orm"],
            "mongodb": ["pymongo", "motor", "mongoengine"],
            "redis": ["redis-py", "aioredis", "pottery"],
            
            # Monitoring and logging
            "logging": ["loguru", "structlog", "python-json-logger"],
            "monitoring": ["prometheus-client", "statsd", "opentelemetry"],
            "profiling": ["memory-profiler", "line-profiler", "py-spy"],
            
            # CLI and terminal
            "cli_framework": ["click", "typer", "fire"],
            "terminal_ui": ["rich", "textual", "blessed"],
            "progress_bar": ["tqdm", "alive-progress", "progressbar2"],
        }
        
        # Patterns that indicate custom code that could be replaced
        self.replacement_patterns = [
            # Date/time manipulation
            (r"datetime\.now\(\).*strftime", "Consider using 'pendulum' for better timezone handling"),
            (r"datetime.*timedelta", "Consider using 'arrow' for simpler date arithmetic"),
            
            # File operations
            (r"os\.path\.", "Use 'pathlib.Path' for modern path handling"),
            (r"open\(.*\)\.read", "Consider 'aiofiles' for async file operations"),
            
            # JSON handling
            (r"json\.loads.*json\.dumps", "Use 'orjson' for faster JSON processing"),
            
            # HTTP requests
            (r"urllib\.request", "Use 'httpx' or 'requests' for better HTTP client"),
            
            # String manipulation
            (r"\.lower\(\)\.replace\(['\"][ -]['\"],", "Use 'slugify' for URL-safe strings"),
            
            # Configuration
            (r"os\.environ\.get", "Use 'python-decouple' for better config management"),
        ]
        
        # Statistics tracking
        self.stats = {
            "searches_performed": 0,
            "solutions_found": 0,
            "custom_code_prevented": 0,
            "replacements_suggested": 0,
        }
    
    def load_cache(self):
        """Load solution cache from disk"""
        cache_file = self.cache_dir / "solutions.json"
        if cache_file.exists():
            with open(cache_file, 'r') as f:
                cache_data = json.load(f)
                # Convert back to OpenSourceSolution objects
                for key, solutions in cache_data.items():
                    self.solution_cache[key] = [
                        OpenSourceSolution(**sol) for sol in solutions
                    ]
    
    def save_cache(self):
        """Save solution cache to disk"""
        cache_file = self.cache_dir / "solutions.json"
        # Convert to JSON-serializable format
        cache_data = {}
        for key, solutions in self.solution_cache.items():
            cache_data[key] = [
                {k: v for k, v in sol.__dict__.items() 
                 if not k.startswith('_')}
                for sol in solutions
            ]
        
        with open(cache_file, 'w') as f:
            json.dump(cache_data, f, indent=2, default=str)
    
    async def find_solution_before_coding(
        self,
        requirement: RequirementSpec
    ) -> List[OpenSourceSolution]:
        """
        PRIMARY METHOD: Called BEFORE writing any custom code
        Finds open source solutions for the requirement
        """
        self.logger.info(f"🔍 Searching for solutions: {requirement.description}")
        self.stats["searches_performed"] += 1
        
        # Check cache first
        cache_key = self._get_cache_key(requirement)
        if cache_key in self.solution_cache:
            self.logger.info("Found in cache")
            return self.solution_cache[cache_key]
        
        solutions = []
        
        # 1. Check known good solutions
        for keyword in requirement.keywords:
            if keyword.lower() in self.known_solutions:
                known_libs = self.known_solutions[keyword.lower()]
                for lib in known_libs:
                    solution = await self._evaluate_library(lib, requirement)
                    if solution:
                        solutions.append(solution)
        
        # 2. Search PyPI
        pypi_solutions = await self._search_pypi(requirement)
        solutions.extend(pypi_solutions)
        
        # 3. Search GitHub
        github_solutions = await self._search_github(requirement)
        solutions.extend(github_solutions)
        
        # 4. Search for code snippets
        snippet_solutions = await self._search_snippets(requirement)
        solutions.extend(snippet_solutions)
        
        # 5. Sort by match score
        solutions.sort(key=lambda x: x.match_score, reverse=True)
        
        # 6. If no good solutions, suggest building custom
        if not solutions or all(s.match_score < 0.5 for s in solutions):
            custom_solution = OpenSourceSolution(
                name="Custom Implementation",
                type=SolutionType.BUILD_CUSTOM,
                level=requirement.level,
                description="No suitable open source solution found",
                url="",
                match_score=0.0,
                pros=["Exactly fits requirements", "No external dependencies"],
                cons=["Requires development time", "Needs maintenance"],
                usage_example="# Build custom implementation"
            )
            solutions.append(custom_solution)
        
        # Cache results
        self.solution_cache[cache_key] = solutions
        self.save_cache()
        
        self.stats["solutions_found"] += len(solutions)
        return solutions
    
    def _get_cache_key(self, requirement: RequirementSpec) -> str:
        """Generate cache key for requirement"""
        key_parts = [
            requirement.description,
            requirement.level.value,
            ",".join(sorted(requirement.keywords))
        ]
        key_str = "|".join(key_parts)
        return hashlib.md5(key_str.encode()).hexdigest()
    
    async def _evaluate_library(
        self,
        library_name: str,
        requirement: RequirementSpec
    ) -> Optional[OpenSourceSolution]:
        """Evaluate if a library meets the requirement"""
        try:
            # Get library info from PyPI
            async with aiohttp.ClientSession() as session:
                url = f"https://pypi.org/pypi/{library_name}/json"
                async with session.get(url) as response:
                    if response.status != 200:
                        return None
                    
                    data = await response.json()
                    info = data["info"]
                    
                    # Calculate match score
                    match_score = self._calculate_match_score(info, requirement)
                    
                    if match_score < 0.3:
                        return None
                    
                    # Get download stats
                    downloads = 0
                    try:
                        # Note: This is a simplified approach
                        downloads = info.get("downloads", {}).get("last_month", 0)
                    except:
                        pass
                    
                    solution = OpenSourceSolution(
                        name=library_name,
                        type=SolutionType.EXACT_MATCH if match_score > 0.8 else SolutionType.PARTIAL_MATCH,
                        level=requirement.level,
                        description=info.get("summary", ""),
                        url=info.get("home_page", f"https://pypi.org/project/{library_name}"),
                        downloads=downloads,
                        license=info.get("license", ""),
                        match_score=match_score,
                        installation=f"pip install {library_name}",
                        pros=self._extract_pros(info, requirement),
                        cons=self._extract_cons(info, requirement)
                    )
                    
                    # Add usage example
                    solution.usage_example = await self._get_usage_example(library_name)
                    
                    return solution
                    
        except Exception as e:
            self.logger.error(f"Error evaluating {library_name}: {e}")
            return None
    
    def _calculate_match_score(
        self,
        library_info: Dict[str, Any],
        requirement: RequirementSpec
    ) -> float:
        """Calculate how well a library matches the requirement"""
        score = 0.0
        
        # Check description match
        lib_desc = (library_info.get("summary", "") + " " + 
                   library_info.get("description", "")).lower()
        
        # Keyword matching
        for keyword in requirement.keywords:
            if keyword.lower() in lib_desc:
                score += 0.2
        
        # Required features matching
        for feature in requirement.required_features:
            if feature.lower() in lib_desc:
                score += 0.3
        
        # Nice to have features
        for feature in requirement.nice_to_have:
            if feature.lower() in lib_desc:
                score += 0.1
        
        # Popularity bonus (based on GitHub stars or downloads)
        # This would need actual implementation
        
        # Recent updates bonus
        # This would need actual implementation
        
        return min(score, 1.0)
    
    def _extract_pros(
        self,
        library_info: Dict[str, Any],
        requirement: RequirementSpec
    ) -> List[str]:
        """Extract pros of using this library"""
        pros = []
        
        # Check for active maintenance
        if library_info.get("yanked", False) is False:
            pros.append("Actively maintained")
        
        # Check for documentation
        if library_info.get("docs_url"):
            pros.append("Good documentation")
        
        # Check license
        license_name = library_info.get("license", "").lower()
        if "mit" in license_name or "apache" in license_name or "bsd" in license_name:
            pros.append("Permissive license")
        
        return pros
    
    def _extract_cons(
        self,
        library_info: Dict[str, Any],
        requirement: RequirementSpec
    ) -> List[str]:
        """Extract cons of using this library"""
        cons = []
        
        # Check for heavy dependencies
        requires = library_info.get("requires_dist", [])
        if requires and len(requires) > 10:
            cons.append(f"Many dependencies ({len(requires)})")
        
        # Check for Python version requirements
        requires_python = library_info.get("requires_python", "")
        if requires_python and "3.11" not in requires_python:
            cons.append(f"Python version constraint: {requires_python}")
        
        return cons
    
    async def _get_usage_example(self, library_name: str) -> str:
        """Get a simple usage example for the library"""
        # This would ideally fetch from documentation or examples
        # For now, return a template
        return f"""
import {library_name}

# TODO: Add actual usage example
# See documentation: https://pypi.org/project/{library_name}
"""
    
    async def _search_pypi(
        self,
        requirement: RequirementSpec
    ) -> List[OpenSourceSolution]:
        """Search PyPI for solutions"""
        solutions = []
        
        try:
            # Search PyPI using keywords
            search_query = " ".join(requirement.keywords[:3])
            
            async with aiohttp.ClientSession() as session:
                # PyPI XML-RPC search is deprecated, using simple search
                url = f"https://pypi.org/search/"
                params = {"q": search_query}
                
                # Note: This would need proper HTML parsing
                # For now, we'll use known solutions
                for keyword in requirement.keywords:
                    if keyword.lower() in self.known_solutions:
                        for lib in self.known_solutions[keyword.lower()][:3]:
                            solution = await self._evaluate_library(lib, requirement)
                            if solution:
                                solutions.append(solution)
                
        except Exception as e:
            self.logger.error(f"PyPI search error: {e}")
        
        return solutions
    
    async def _search_github(
        self,
        requirement: RequirementSpec
    ) -> List[OpenSourceSolution]:
        """Search GitHub for solutions"""
        solutions = []
        
        if not self.github_client:
            return solutions
        
        try:
            # Build search query
            query_parts = requirement.keywords[:3] + ["language:python"]
            search_query = " ".join(query_parts)
            
            # Search repositories
            repos = self.github_client.search_repositories(
                query=search_query,
                sort="stars",
                order="desc"
            )
            
            for repo in repos[:5]:  # Top 5 results
                solution = OpenSourceSolution(
                    name=repo.name,
                    type=SolutionType.ALTERNATIVE,
                    level=requirement.level,
                    description=repo.description or "",
                    url=repo.html_url,
                    stars=repo.stargazers_count,
                    last_updated=repo.updated_at,
                    license=repo.license.name if repo.license else "Unknown",
                    match_score=self._calculate_github_match_score(repo, requirement),
                    installation=f"pip install git+{repo.clone_url}",
                    pros=[f"⭐ {repo.stargazers_count} stars", "Source code available"],
                    cons=["May not be on PyPI", "Might need building from source"]
                )
                solutions.append(solution)
                
        except Exception as e:
            self.logger.error(f"GitHub search error: {e}")
        
        return solutions
    
    def _calculate_github_match_score(
        self,
        repo: Any,
        requirement: RequirementSpec
    ) -> float:
        """Calculate match score for GitHub repo"""
        score = 0.0
        
        repo_text = (repo.name + " " + (repo.description or "")).lower()
        
        for keyword in requirement.keywords:
            if keyword.lower() in repo_text:
                score += 0.2
        
        # Popularity bonus
        if repo.stargazers_count > 1000:
            score += 0.2
        elif repo.stargazers_count > 100:
            score += 0.1
        
        # Recent activity bonus
        if repo.updated_at:
            days_old = (pendulum.now() - repo.updated_at).days
            if days_old < 30:
                score += 0.2
            elif days_old < 180:
                score += 0.1
        
        return min(score, 1.0)
    
    async def _search_snippets(
        self,
        requirement: RequirementSpec
    ) -> List[OpenSourceSolution]:
        """Search for code snippets that solve the problem"""
        solutions = []
        
        # Search in known snippet sources
        # This would integrate with services like:
        # - GitHub Gists
        # - Stack Overflow
        # - Python cookbook sites
        
        # For now, return empty
        return solutions
    
    async def scan_codebase_for_replacements(self) -> List[CodebaseReplacementOpportunity]:
        """
        Scan entire MemCore codebase to find opportunities to replace
        custom code with open source solutions
        """
        self.logger.info("🔍 Scanning MemCore codebase for replacement opportunities...")
        
        opportunities = []
        
        # Scan all Python files
        for py_file in self.osa_root.rglob("*.py"):
            if "__pycache__" in str(py_file) or ".venv" in str(py_file):
                continue
            
            try:
                content = py_file.read_text()
                lines = content.splitlines()
                
                # Check against replacement patterns
                for pattern, suggestion in self.replacement_patterns:
                    for i, line in enumerate(lines, 1):
                        if re.search(pattern, line):
                            opportunity = CodebaseReplacementOpportunity(
                                file_path=str(py_file),
                                line_range=(i, i),
                                current_code=line.strip(),
                                description=f"Pattern '{pattern}' found",
                                suggested_library=suggestion,
                                replacement_code="# TODO: Replace with suggested library",
                                benefits=["More maintainable", "Better performance", "Less custom code"],
                                migration_effort="low",
                                priority=3
                            )
                            opportunities.append(opportunity)
                
                # Analyze imports to find reinvented wheels
                tree = ast.parse(content)
                opportunities.extend(self._analyze_ast_for_replacements(tree, py_file))
                
            except Exception as e:
                self.logger.error(f"Error scanning {py_file}: {e}")
        
        # Sort by priority
        opportunities.sort(key=lambda x: x.priority)
        
        self.stats["replacements_suggested"] = len(opportunities)
        
        return opportunities
    
    def _analyze_ast_for_replacements(
        self,
        tree: ast.AST,
        file_path: Path
    ) -> List[CodebaseReplacementOpportunity]:
        """Analyze AST to find replacement opportunities"""
        opportunities = []
        
        for node in ast.walk(tree):
            # Check for common patterns that could be replaced
            
            # Custom retry logic
            if isinstance(node, ast.FunctionDef):
                if "retry" in node.name.lower():
                    opportunities.append(CodebaseReplacementOpportunity(
                        file_path=str(file_path),
                        line_range=(node.lineno, node.end_lineno or node.lineno),
                        current_code=f"def {node.name}(...)",
                        description="Custom retry logic detected",
                        suggested_library="tenacity or retrying",
                        replacement_code="from tenacity import retry, stop_after_attempt",
                        benefits=["Battle-tested retry logic", "More features", "Less maintenance"],
                        migration_effort="medium",
                        priority=2
                    ))
            
            # Custom caching
            if isinstance(node, ast.FunctionDef):
                for decorator in node.decorator_list:
                    if isinstance(decorator, ast.Name) and "cache" in decorator.id.lower():
                        opportunities.append(CodebaseReplacementOpportunity(
                            file_path=str(file_path),
                            line_range=(node.lineno, node.end_lineno or node.lineno),
                            current_code=f"@{decorator.id}",
                            description="Custom caching detected",
                            suggested_library="functools.lru_cache or cachetools",
                            replacement_code="from functools import lru_cache",
                            benefits=["Standard library", "Well-tested", "No custom code"],
                            migration_effort="low",
                            priority=1
                        ))
        
        return opportunities
    
    async def suggest_architecture(
        self,
        feature_description: str
    ) -> Dict[str, Any]:
        """
        Suggest complete architecture using open source components
        for a feature instead of building from scratch
        """
        self.logger.info(f"🏗️ Suggesting architecture for: {feature_description}")
        
        architecture = {
            "description": feature_description,
            "components": [],
            "integration_points": [],
            "estimated_effort": "",
            "alternatives": []
        }
        
        # Analyze feature requirements
        keywords = self._extract_keywords(feature_description)
        
        # Suggest components based on keywords
        if any(word in keywords for word in ["api", "rest", "http"]):
            architecture["components"].append({
                "purpose": "API Framework",
                "recommended": "FastAPI",
                "alternatives": ["Flask", "Django REST Framework"],
                "reason": "Modern, fast, with automatic API documentation"
            })
        
        if any(word in keywords for word in ["database", "storage", "persist"]):
            architecture["components"].append({
                "purpose": "Database ORM",
                "recommended": "SQLAlchemy",
                "alternatives": ["Peewee", "Tortoise ORM"],
                "reason": "Mature, flexible, supports multiple databases"
            })
        
        if any(word in keywords for word in ["async", "concurrent", "parallel"]):
            architecture["components"].append({
                "purpose": "Async Processing",
                "recommended": "asyncio with aiohttp",
                "alternatives": ["Celery", "RQ"],
                "reason": "Built-in Python support, excellent performance"
            })
        
        if any(word in keywords for word in ["ai", "llm", "agent"]):
            architecture["components"].append({
                "purpose": "AI/LLM Framework",
                "recommended": "LangChain",
                "alternatives": ["LlamaIndex", "Semantic Kernel"],
                "reason": "Most comprehensive, large community"
            })
        
        return architecture
    
    def _extract_keywords(self, text: str) -> List[str]:
        """Extract keywords from text"""
        # Simple keyword extraction
        # In production, use NLP libraries like spaCy or NLTK
        words = text.lower().split()
        # Filter common words
        stopwords = {"the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for"}
        keywords = [w for w in words if w not in stopwords and len(w) > 3]
        return keywords
    
    def generate_report(self) -> str:
        """Generate a report of findings and recommendations"""
        report = f"""
# Open Source Solution Finder Report
Generated: {pendulum.now().isoformat()}

## Statistics
- Searches performed: {self.stats['searches_performed']}
- Solutions found: {self.stats['solutions_found']}
- Custom code prevented: {self.stats['custom_code_prevented']}
- Replacements suggested: {self.stats['replacements_suggested']}

## Cached Solutions
Total cached: {len(self.solution_cache)} unique searches

## Recommendations
1. Always check for existing solutions before writing custom code
2. Prefer well-maintained libraries with good documentation
3. Consider the total cost of ownership, not just initial development
4. Regularly scan codebase for replacement opportunities

## Next Steps
1. Run `scan_codebase_for_replacements()` monthly
2. Update `known_solutions` dictionary with new discoveries
3. Share findings with team to prevent duplicate work
"""
        return report
    
    async def interactive_mode(self):
        """Interactive mode for finding solutions"""
        print("🔍 Open Source Solution Finder - Interactive Mode")
        print("Type 'help' for commands, 'quit' to exit\n")
        
        while True:
            try:
                command = input("finder> ").strip().lower()
                
                if command == "quit":
                    break
                elif command == "help":
                    print("""
Commands:
  find <description>  - Find solution for a requirement
  scan               - Scan codebase for replacements
  report            - Generate statistics report
  clear             - Clear solution cache
  quit              - Exit
""")
                elif command.startswith("find "):
                    description = command[5:]
                    req = RequirementSpec(
                        description=description,
                        level=SolutionLevel.PACKAGE,
                        keywords=self._extract_keywords(description)
                    )
                    solutions = await self.find_solution_before_coding(req)
                    
                    print(f"\nFound {len(solutions)} solutions:")
                    for i, sol in enumerate(solutions[:5], 1):
                        print(f"\n{i}. {sol.name} ({sol.type.value})")
                        print(f"   Score: {sol.match_score:.2f}")
                        print(f"   {sol.description}")
                        if sol.installation:
                            print(f"   Install: {sol.installation}")
                
                elif command == "scan":
                    opportunities = await self.scan_codebase_for_replacements()
                    print(f"\nFound {len(opportunities)} replacement opportunities")
                    for opp in opportunities[:10]:
                        print(f"\n{opp.file_path}:{opp.line_range[0]}")
                        print(f"  Current: {opp.current_code[:50]}...")
                        print(f"  Suggest: {opp.suggested_library}")
                        print(f"  Priority: {opp.priority}, Effort: {opp.migration_effort}")
                
                elif command == "report":
                    print(self.generate_report())
                
                elif command == "clear":
                    self.solution_cache.clear()
                    self.save_cache()
                    print("Cache cleared")
                
                else:
                    print("Unknown command. Type 'help' for commands.")
                    
            except KeyboardInterrupt:
                print("\nUse 'quit' to exit")
            except Exception as e:
                print(f"Error: {e}")


# Singleton instance
_solution_finder = None

def get_solution_finder(config: Dict[str, Any] = None) -> OpenSourceSolutionFinder:
    """Get or create the global solution finder"""
    global _solution_finder
    if _solution_finder is None:
        _solution_finder = OpenSourceSolutionFinder(config)
    return _solution_finder


# Integration with MemCore - Called before any custom code
async def check_before_coding(description: str, **kwargs) -> Dict[str, Any]:
    """
    PRIMARY INTEGRATION POINT
    Called by MemCore before writing ANY custom code
    
    Returns:
        {
            "should_use_library": bool,
            "solutions": List[OpenSourceSolution],
            "recommendation": str,
            "code_example": str
        }
    """
    finder = get_solution_finder()
    
    # Create requirement from description
    req = RequirementSpec(
        description=description,
        level=kwargs.get("level", SolutionLevel.FUNCTION),
        keywords=finder._extract_keywords(description),
        required_features=kwargs.get("features", []),
        constraints=kwargs.get("constraints", [])
    )
    
    # Find solutions
    solutions = await finder.find_solution_before_coding(req)
    
    # Make recommendation
    should_use_library = False
    recommendation = ""
    code_example = ""
    
    if solutions and solutions[0].match_score > 0.7:
        should_use_library = True
        best = solutions[0]
        recommendation = f"Use {best.name}: {best.description}"
        code_example = best.usage_example
        finder.stats["custom_code_prevented"] += 1
    else:
        recommendation = "No suitable library found, proceed with custom implementation"
    
    return {
        "should_use_library": should_use_library,
        "solutions": solutions[:5],  # Top 5 solutions
        "recommendation": recommendation,
        "code_example": code_example
    }


async def main():
    """Main entry point for testing"""
    import argparse
    
    parser = argparse.ArgumentParser(description="Open Source Solution Finder")
    parser.add_argument("--interactive", "-i", action="store_true",
                       help="Run in interactive mode")
    parser.add_argument("--scan", "-s", action="store_true",
                       help="Scan codebase for replacements")
    parser.add_argument("--find", "-f", type=str,
                       help="Find solution for requirement")
    
    args = parser.parse_args()
    
    finder = get_solution_finder()
    
    if args.interactive:
        await finder.interactive_mode()
    elif args.scan:
        opportunities = await finder.scan_codebase_for_replacements()
        print(f"Found {len(opportunities)} replacement opportunities")
        for opp in opportunities[:20]:
            print(f"{opp.file_path}:{opp.line_range[0]} - {opp.suggested_library}")
    elif args.find:
        result = await check_before_coding(args.find)
        print(f"Recommendation: {result['recommendation']}")
        if result['solutions']:
            print("\nTop solutions:")
            for sol in result['solutions']:
                print(f"  - {sol.name}: {sol.description}")
    else:
        parser.print_help()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    asyncio.run(main())