import orjson
"""Core implementation of auto-coder"""

import ast
import re
import subprocess
import tempfile
import asyncio
from typing import Dict, Any, Optional, List, Tuple
from pathlib import Path
from dataclasses import dataclass
from enum import Enum
import logging
import black
import autopep8
from ..agents.open_source_solution_finder import get_solution_finder, check_before_coding, RequirementSpec, SolutionLevel


class CodeType(Enum):
    """Types of code generation tasks"""
    FUNCTION = 'function'
    CLASS = 'class'
    MODULE = 'module'
    SCRIPT = 'script'
    TEST = 'test'
    REFACTOR = 'refactor'
    OPTIMIZATION = 'optimization'
    DOCUMENTATION = 'documentation'
    SELF_MODIFICATION = 'self_modification'
class ProgrammingLanguage(Enum):
    """Supported programming languages"""
    PYTHON = 'python'
    JAVASCRIPT = 'javascript'
    TYPESCRIPT = 'typescript'
    GO = 'go'
    RUST = 'rust'
    JAVA = 'java'
    CPP = 'cpp'
    SHELL = 'shell'
@dataclass
class CodeTemplate:
    """Template for code generation"""
    name: str
    language: ProgrammingLanguage
    template: str
    variables: List[str]
    description: str
@dataclass
class CodeGenerationRequest:
    """Request for code generation"""
    description: str
    code_type: CodeType
    language: ProgrammingLanguage
    requirements: List[str]
    constraints: List[str]
    examples: List[str] = None
    context: Dict[str, Any] = None
@dataclass
class GeneratedCode:
    """Generated code result"""
    code: str
    language: ProgrammingLanguage
    description: str
    tests: Optional[str] = None
    documentation: Optional[str] = None
    complexity_score: float = 0.0
    quality_score: float = 0.0
class CodeGenerator:
    """Advanced code generation system for MemCore"""

    def __init__(self, langchain_engine=None, config: Dict[str, Any]=None):
        self.config = config or {}
        self.langchain_engine = langchain_engine
        self.logger = logging.getLogger('MemCore-CodeGen')
        self.templates = self._initialize_templates()
        self.analyzers = {ProgrammingLanguage.PYTHON: self._analyze_python, ProgrammingLanguage.JAVASCRIPT: self._analyze_javascript}
        self.formatters = {ProgrammingLanguage.PYTHON: self._format_python, ProgrammingLanguage.JAVASCRIPT: self._format_javascript}
        self.modification_history = []
        self.code_cache = {}

    def _initialize_templates(self) -> Dict[str, CodeTemplate]:
        """Initialize code generation templates"""
        templates = {}
        templates['python_function'] = CodeTemplate(name='python_function', language=ProgrammingLanguage.PYTHON, template='def {function_name}({parameters}){type_hints}:\n    """\n    {description}\n    \n    Args:\n        {args_description}\n    \n    Returns:\n        {return_description}\n    """\n    {implementation}\n', variables=['function_name', 'parameters', 'type_hints', 'description', 'args_description', 'return_description', 'implementation'], description='Template for Python functions')
        templates['python_class'] = CodeTemplate(name='python_class', language=ProgrammingLanguage.PYTHON, template='class {class_name}({base_classes}):\n    """\n    {description}\n    \n    Attributes:\n        {attributes_description}\n    """\n    \n    def __init__(self, {init_parameters}):\n        """Initialize {class_name}"""\n        {init_implementation}\n    \n    {methods}\n', variables=['class_name', 'base_classes', 'description', 'attributes_description', 'init_parameters', 'init_implementation', 'methods'], description='Template for Python classes')
        templates['python_async'] = CodeTemplate(name='python_async', language=ProgrammingLanguage.PYTHON, template='async def {function_name}({parameters}){type_hints}:\n    """\n    {description}\n    \n    Async function for {purpose}\n    """\n    {implementation}\n', variables=['function_name', 'parameters', 'type_hints', 'description', 'purpose', 'implementation'], description='Template for async Python functions')
        return templates

    async def generate_code(self, request: CodeGenerationRequest) -> GeneratedCode:
        """Generate code based on request"""
        self.logger.info(f'Generating {request.code_type.value} in {request.language.value}')
        if SOLUTION_FINDER_AVAILABLE:
            solution_check = await self._check_for_existing_solution(request)
            if solution_check['should_use_library']:
                self.logger.info(f"🎯 Found open source solution: {solution_check['recommendation']}")
                return await self._generate_library_usage_code(request, solution_check)
        self.logger.info('No suitable open source solution found, generating custom code')
        if self.langchain_engine:
            return await self._generate_with_langchain(request)
        return await self._generate_with_templates(request)

    async def _generate_with_langchain(self, request: CodeGenerationRequest) -> GeneratedCode:
        """Generate code using LangChain"""
        prompt = self._build_generation_prompt(request)
        (response, metadata) = await self.langchain_engine.query_with_memory(prompt, 'coding')
        code = self._extract_code_from_response(response, request.language)
        if request.language in self.formatters:
            code = self.formatters[request.language](code)
        tests = None
        if request.code_type != CodeType.TEST:
            tests = await self._generate_tests(code, request)
        documentation = await self._generate_documentation(code, request)
        quality_score = await self._analyze_code_quality(code, request.language)
        return GeneratedCode(code=code, language=request.language, description=request.description, tests=tests, documentation=documentation, quality_score=quality_score)

    async def _generate_with_templates(self, request: CodeGenerationRequest) -> GeneratedCode:
        """Generate code using templates (fallback)"""
        template_key = f'{request.language.value}_{request.code_type.value}'
        if template_key in self.templates:
            template = self.templates[template_key]
            code = template.template.format(**self._get_template_variables(request, template))
            return GeneratedCode(code=code, language=request.language, description=request.description)
        return GeneratedCode(code=f'# TODO: Implement {request.description}', language=request.language, description=request.description)

    def _build_generation_prompt(self, request: CodeGenerationRequest) -> str:
        """Build prompt for code generation"""
        prompt_parts = [f'Generate {request.code_type.value} code in {request.language.value}.', f'Description: {request.description}', '\nRequirements:']
        for req in request.requirements:
            prompt_parts.append(f'- {req}')
        if request.constraints:
            prompt_parts.append('\nConstraints:')
            for constraint in request.constraints:
                prompt_parts.append(f'- {constraint}')
        if request.examples:
            prompt_parts.append('\nExamples for reference:')
            for example in request.examples:
                prompt_parts.append(f'```\n{example}\n```')
        prompt_parts.extend(['\nGenerate clean, efficient, well-documented code.', 'Include error handling and edge cases.', 'Follow best practices and coding standards.', f'Output the code in {request.language.value} format.'])
        return '\n'.join(prompt_parts)

    def _extract_code_from_response(self, response: str, language: ProgrammingLanguage) -> str:
        """Extract code from LLM response"""
        code_pattern = '```(?:\\w+)?\\n(.*?)```'
        matches = re.findall(code_pattern, response, re.DOTALL)
        if matches:
            return matches[0].strip()
        lines = response.split('\n')
        code_lines = []
        for line in lines:
            if not any((marker in line.lower() for marker in ['here', 'this', 'the following', 'code:', 'example:'])):
                code_lines.append(line)
        return '\n'.join(code_lines).strip()

    async def _generate_tests(self, code: str, request: CodeGenerationRequest) -> Optional[str]:
        """Generate tests for the code"""
        if not self.langchain_engine:
            return None
        test_prompt = f'Generate comprehensive tests for the following {request.language.value} code:\n\n```{request.language.value}\n{code}\n```\n\nGenerate unit tests that:\n- Test normal cases\n- Test edge cases\n- Test error conditions\n- Achieve high code coverage\n- Follow testing best practices for {request.language.value}\n'
        (response, _) = await self.langchain_engine.query_with_memory(test_prompt, 'coding')
        return self._extract_code_from_response(response, request.language)

    async def _generate_documentation(self, code: str, request: CodeGenerationRequest) -> str:
        """Generate documentation for the code"""
        if not self.langchain_engine:
            return '# Documentation pending'
        doc_prompt = f'Generate comprehensive documentation for the following {request.language.value} code:\n\n```{request.language.value}\n{code}\n```\n\nInclude:\n- Overview and purpose\n- Usage examples\n- Parameter descriptions\n- Return value documentation\n- Potential errors/exceptions\n- Performance considerations\n'
        (response, _) = await self.langchain_engine.query_with_memory(doc_prompt, 'documentation')
        return response

    async def _analyze_code_quality(self, code: str, language: ProgrammingLanguage) -> float:
        """Analyze code quality and return score"""
        if language in self.analyzers:
            return self.analyzers[language](code)
        return 0.5

    def _analyze_python(self, code: str) -> float:
        """Analyze Python code quality"""
        score = 1.0
        try:
            tree = ast.parse(code)
            for node in ast.walk(tree):
                if isinstance(node, (ast.FunctionDef, ast.ClassDef, ast.AsyncFunctionDef)):
                    if not ast.get_docstring(node):
                        score -= 0.1
            has_try = any((isinstance(node, ast.Try) for node in ast.walk(tree)))
            if not has_try and len(code) > 100:
                score -= 0.1
            if '->' not in code and len(code) > 50:
                score -= 0.05
        except SyntaxError:
            score = 0.0
        return max(0.0, min(1.0, score))

    def _analyze_javascript(self, code: str) -> float:
        """Analyze JavaScript code quality"""
        score = 1.0
        if 'var ' in code:
            score -= 0.1
        if 'console.log' in code:
            score -= 0.05
        if not any((marker in code for marker in ['try', 'catch', '.catch'])):
            score -= 0.1
        return max(0.0, min(1.0, score))

    def _format_python(self, code: str) -> str:
        """Format Python code"""
        try:
            formatted = black.format_str(code, mode=black.Mode())
            return formatted
        except:
            try:
                return autopep8.fix_code(code)
            except:
                return code

    def _format_javascript(self, code: str) -> str:
        """Format JavaScript code"""
        return code

    def _get_template_variables(self, request: CodeGenerationRequest, template: CodeTemplate) -> Dict[str, str]:
        """Get variables for template filling"""
        variables = {}
        for var in template.variables:
            if var == 'description':
                variables[var] = request.description
            elif var == 'function_name':
                variables[var] = re.sub('[^a-zA-Z0-9_]', '_', request.description.lower().replace(' ', '_'))[:30]
            else:
                variables[var] = f'# TODO: {var}'
        return variables

    async def self_modify(self, target_file: str, modification_request: str, enabled: bool = False) -> bool:
        """Self-modify MemCore's own code"""
        if not enabled:
            self.logger.error('Self-modification is disabled by default. Set enabled=True to allow it.')
            return False

        self.logger.warning(f'Self-modification requested for {target_file}')

        if not self._is_safe_to_modify(target_file):
            self.logger.error('Self-modification blocked for safety')
            return False
        target_path = Path(target_file)
        if not target_path.exists():
            self.logger.error(f'Target file {target_file} not found')
            return False
        original_code = target_path.read_text()
        if self.langchain_engine:
            modified_code = await self._generate_modification(original_code, modification_request)
        else:
            self.logger.error('LangChain engine required for self-modification')
            return False
        if not self._validate_modification(original_code, modified_code):
            self.logger.error('Modification validation failed')
            return False
        backup_path = target_path.with_suffix('.bak')
        backup_path.write_text(original_code)
        target_path.write_text(modified_code)
        self.modification_history.append({'file': target_file, 'request': modification_request, 'timestamp': asyncio.get_event_loop().time(), 'backup': str(backup_path)})
        self.logger.info(f'Successfully self-modified {target_file}')
        return True

    def _is_safe_to_modify(self, target_file: str) -> bool:
        """Check if file is safe to modify"""
        # Ensure the target file is within the project's root directory
        root_dir = Path.cwd()
        target_path = Path(target_file).resolve()
        if not target_path.is_relative_to(root_dir):
            self.logger.error(f'Target file {target_file} is outside the project root directory.')
            return False

        safe_patterns = ['osa_*.py', 'src/core/*.py', 'src/plugins/*.py']
        for pattern in safe_patterns:
            if target_path.match(pattern):
                return True
        return False

    async def _generate_modification(self, original_code: str, request: str) -> str:
        """Generate code modification"""
        prompt = f'Modify the following code according to the request:\n\nOriginal Code:\n```python\n{original_code}\n```\n\nModification Request:\n{request}\n\nRequirements:\n- Preserve existing functionality unless explicitly changed\n- Maintain code style and conventions\n- Add appropriate error handling\n- Include comments for significant changes\n- Ensure backward compatibility\n\nGenerate the complete modified code:\n'
        (response, _) = await self.langchain_engine.query_with_memory(prompt, 'coding')
        return self._extract_code_from_response(response, ProgrammingLanguage.PYTHON)

    def _validate_modification(self, original: str, modified: str) -> bool:
        """Validate code modification"""
        try:
            ast.parse(modified)
            if len(modified.strip()) < 10:
                return False
            if original == modified:
                return False
            return True
        except SyntaxError:
            return False

    async def optimize_code(self, code: str, language: ProgrammingLanguage) -> str:
        """Optimize existing code"""
        if not self.langchain_engine:
            return code
        optimize_prompt = f'Optimize the following {language.value} code for:\n- Performance\n- Memory usage  \n- Readability\n- Best practices\n\nCode:\n```{language.value}\n{code}\n```\n\nGenerate optimized version:\n'
        (response, _) = await self.langchain_engine.query_with_memory(optimize_prompt, 'coding')
        optimized = self._extract_code_from_response(response, language)
        if language in self.formatters:
            optimized = self.formatters[language](optimized)
        return optimized

    async def refactor_code(self, code: str, language: ProgrammingLanguage, refactor_goals: List[str]) -> str:
        """Refactor code based on specific goals"""
        if not self.langchain_engine:
            return code
        goals_str = '\n'.join((f'- {goal}' for goal in refactor_goals))
        refactor_prompt = f'Refactor the following {language.value} code to achieve these goals:\n{goals_str}\n\nCode:\n```{language.value}\n{code}\n```\n\nGenerate refactored version:\n'
        (response, _) = await self.langchain_engine.query_with_memory(refactor_prompt, 'coding')
        return self._extract_code_from_response(response, language)

    def get_modification_history(self) -> List[Dict[str, Any]]:
        """Get history of self-modifications"""
        return self.modification_history.copy()

    async def _check_for_existing_solution(self, request: CodeGenerationRequest) -> Dict[str, Any]:
        """Check if there's an open source solution before writing custom code"""
        if not SOLUTION_FINDER_AVAILABLE:
            return {'should_use_library': False}
        level_map = {CodeType.FUNCTION: SolutionLevel.FUNCTION, CodeType.CLASS: SolutionLevel.MODULE, CodeType.MODULE: SolutionLevel.PACKAGE, CodeType.SCRIPT: SolutionLevel.PACKAGE}
        level = level_map.get(request.code_type, SolutionLevel.FUNCTION)
        result = await check_before_coding(description=request.description, level=level, features=request.requirements, constraints=request.constraints)
        return result

    async def _generate_library_usage_code(self, request: CodeGenerationRequest, solution_check: Dict[str, Any]) -> GeneratedCode:
        """Generate code that uses an open source library instead of custom implementation"""
        best_solution = solution_check['solutions'][0] if solution_check['solutions'] else None
        if not best_solution:
            return await self._generate_with_langchain(request)
        library_code = f"\n# Using {best_solution.name} library instead of custom implementation\n# {best_solution.description}\n# Installation: {best_solution.installation}\n\n{solution_check.get('code_example', '')}\n\n# Implementation using {best_solution.name}:\n"
        if self.langchain_engine:
            prompt = f"Generate {request.language.value} code that uses the '{best_solution.name}' library\nto implement: {request.description}\n\nThe library provides: {best_solution.description}\nInstallation: {best_solution.installation}\n\nGenerate clean, production-ready code that properly uses this library:\n"
            (response, _) = await self.langchain_engine.query_with_memory(prompt, 'coding')
            implementation = self._extract_code_from_response(response, request.language)
            library_code += implementation
        else:
            library_code += f'\nimport {best_solution.name}\n\n# TODO: Implement using {best_solution.name}\n# See documentation: {best_solution.url}\n'
        if request.language in self.formatters:
            library_code = self.formatters[request.language](library_code)
        documentation = f"\n## Implementation using {best_solution.name}\n\nThis implementation uses the open source library '{best_solution.name}' instead of custom code.\n\n### Why use this library?\n{(', '.join(best_solution.pros) if hasattr(best_solution, 'pros') else 'Well-maintained, tested solution')}\n\n### Installation\n```bash\n{best_solution.installation}\n```\n\n### Documentation\n{best_solution.url}\n\n### Match Score\n{best_solution.match_score:.2f} - {solution_check['recommendation']}\n"
        return GeneratedCode(code=library_code, language=request.language, description=f'Implementation using {best_solution.name}: {request.description}', tests=None, documentation=documentation, quality_score=0.9)

    def rollback_modification(self, file_path: str) -> bool:
        """Rollback a self-modification"""
        for mod in reversed(self.modification_history):
            if mod['file'] == file_path:
                backup_path = Path(mod['backup'])
                if backup_path.exists():
                    target_path = Path(file_path)
                    target_path.write_text(backup_path.read_text())
                    self.logger.info(f'Rolled back {file_path} from {backup_path}')
                    return True
        self.logger.error(f'No backup found for {file_path}')
        return False