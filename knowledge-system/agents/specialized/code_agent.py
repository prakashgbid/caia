"""
Code Agent - Specialized agent for code generation, analysis, and refactoring
"""

import asyncio
import ast
import re
import os
import subprocess
from typing import Dict, Any, List, Optional, Union
from dataclasses import dataclass
from pathlib import Path

from langchain_core.messages import HumanMessage, AIMessage, SystemMessage
from ..base_agent import BaseAgent, AgentState, AgentStatus
from ...tools.code_tools import CodeTools

@dataclass
class CodeAnalysis:
    """Code analysis results"""
    complexity: int
    lines_of_code: int
    functions: List[str]
    classes: List[str]
    imports: List[str]
    issues: List[str]
    suggestions: List[str]

class CodeAgent(BaseAgent):
    """
    Specialized agent for code-related tasks:
    - Code generation
    - Code analysis
    - Refactoring
    - Testing
    - Documentation
    """
    
    def __init__(self, llm_manager, config: Dict[str, Any]):
        # Initialize with code-specific tools
        tools = [CodeTools()]
        
        super().__init__(
            name="CodeAgent",
            llm_manager=llm_manager,
            config=config,
            tools=tools
        )
        
        self.code_tools = tools[0]
        self.supported_languages = config.get('supported_languages', 
            ['python', 'javascript', 'typescript', 'java', 'cpp', 'go', 'rust'])
        self.max_file_size = config.get('max_file_size', 50000)  # 50KB
        self.enable_testing = config.get('enable_testing', True)
    
    async def _plan_action(self, state: AgentState, context: Dict[str, Any]) -> Dict[str, Any]:
        """Plan code-related actions"""
        task = state.current_task
        
        # Determine task type
        task_type = self._classify_task(task)
        
        # Create plan based on task type
        plan = {
            'task_type': task_type,
            'context': {},
            'metadata': {
                'task_classification': task_type,
                'iteration': state.iteration
            }
        }
        
        if task_type == 'generate':
            plan['context'] = await self._plan_generation(task, context)
        elif task_type == 'analyze':
            plan['context'] = await self._plan_analysis(task, context)
        elif task_type == 'refactor':
            plan['context'] = await self._plan_refactoring(task, context)
        elif task_type == 'test':
            plan['context'] = await self._plan_testing(task, context)
        elif task_type == 'document':
            plan['context'] = await self._plan_documentation(task, context)
        else:
            plan['context'] = {'approach': 'general_code_task'}
        
        return plan
    
    async def _execute_action(self, state: AgentState) -> Dict[str, Any]:
        """Execute code-related actions"""
        task_type = state.context.get('task_type')
        
        try:
            if task_type == 'generate':
                return await self._execute_generation(state)
            elif task_type == 'analyze':
                return await self._execute_analysis(state)
            elif task_type == 'refactor':
                return await self._execute_refactoring(state)
            elif task_type == 'test':
                return await self._execute_testing(state)
            elif task_type == 'document':
                return await self._execute_documentation(state)
            else:
                return await self._execute_general_task(state)
                
        except Exception as e:
            return {
                'success': False,
                'error': str(e),
                'tools_used': ['code_agent_internal']
            }
    
    def _classify_task(self, task: str) -> str:
        """Classify the type of code task"""
        task_lower = task.lower()
        
        if any(word in task_lower for word in ['generate', 'create', 'write', 'implement']):
            return 'generate'
        elif any(word in task_lower for word in ['analyze', 'review', 'examine', 'check']):
            return 'analyze'
        elif any(word in task_lower for word in ['refactor', 'optimize', 'improve', 'clean']):
            return 'refactor'
        elif any(word in task_lower for word in ['test', 'unit test', 'testing']):
            return 'test'
        elif any(word in task_lower for word in ['document', 'doc', 'readme', 'comments']):
            return 'document'
        else:
            return 'general'
    
    async def _plan_generation(self, task: str, context: Dict[str, Any]) -> Dict[str, Any]:
        """Plan code generation"""
        # Extract requirements from task
        language = self._extract_language(task)
        file_type = self._extract_file_type(task)
        
        return {
            'approach': 'generate_code',
            'language': language,
            'file_type': file_type,
            'requirements': self._extract_requirements(task),
            'template': self._select_template(language, file_type)
        }
    
    async def _plan_analysis(self, task: str, context: Dict[str, Any]) -> Dict[str, Any]:
        """Plan code analysis"""
        files_to_analyze = self._extract_file_paths(task)
        
        return {
            'approach': 'analyze_code',
            'files': files_to_analyze,
            'analysis_types': ['complexity', 'quality', 'security', 'performance']
        }
    
    async def _plan_refactoring(self, task: str, context: Dict[str, Any]) -> Dict[str, Any]:
        """Plan code refactoring"""
        return {
            'approach': 'refactor_code',
            'target_files': self._extract_file_paths(task),
            'refactoring_goals': self._extract_refactoring_goals(task)
        }
    
    async def _plan_testing(self, task: str, context: Dict[str, Any]) -> Dict[str, Any]:
        """Plan test creation"""
        return {
            'approach': 'create_tests',
            'target_code': self._extract_file_paths(task),
            'test_types': ['unit', 'integration'] if 'integration' in task.lower() else ['unit']
        }
    
    async def _plan_documentation(self, task: str, context: Dict[str, Any]) -> Dict[str, Any]:
        """Plan documentation creation"""
        return {
            'approach': 'create_documentation',
            'target_files': self._extract_file_paths(task),
            'doc_types': self._extract_doc_types(task)
        }
    
    async def _execute_generation(self, state: AgentState) -> Dict[str, Any]:
        """Execute code generation"""
        context = state.context
        task = state.current_task
        
        # Generate code using LLM
        prompt = self._create_generation_prompt(task, context)
        
        try:
            response = await self.llm_manager.agenerate([prompt])
            generated_code = response.text
            
            # Validate generated code
            validation_result = await self._validate_code(generated_code, context.get('language'))
            
            if validation_result['valid']:
                # Save code if filename provided
                if context.get('filename'):
                    await self.code_tools.save_code(
                        code=generated_code,
                        filename=context['filename']
                    )
                
                return {
                    'success': True,
                    'result': {
                        'code': generated_code,
                        'validation': validation_result,
                        'filename': context.get('filename')
                    },
                    'message': f"Generated {context.get('language', 'code')} code successfully",
                    'tools_used': ['llm_generation', 'code_validation']
                }
            else:
                return {
                    'success': False,
                    'error': f"Generated code validation failed: {validation_result['errors']}",
                    'tools_used': ['llm_generation', 'code_validation']
                }
                
        except Exception as e:
            return {
                'success': False,
                'error': f"Code generation failed: {str(e)}",
                'tools_used': ['llm_generation']
            }
    
    async def _execute_analysis(self, state: AgentState) -> Dict[str, Any]:
        """Execute code analysis"""
        context = state.context
        files = context.get('files', [])
        
        analysis_results = []
        
        for file_path in files:
            try:
                # Read file
                code = await self.code_tools.read_file(file_path)
                
                # Perform analysis
                analysis = await self._analyze_code(code, file_path)
                analysis_results.append({
                    'file': file_path,
                    'analysis': analysis
                })
                
            except Exception as e:
                analysis_results.append({
                    'file': file_path,
                    'error': str(e)
                })
        
        return {
            'success': True,
            'result': {
                'analyses': analysis_results,
                'summary': self._summarize_analyses(analysis_results)
            },
            'message': f"Analyzed {len(files)} files",
            'tools_used': ['code_analysis', 'file_reader']
        }
    
    async def _execute_refactoring(self, state: AgentState) -> Dict[str, Any]:
        """Execute code refactoring"""
        context = state.context
        files = context.get('target_files', [])
        goals = context.get('refactoring_goals', [])
        
        refactoring_results = []
        
        for file_path in files:
            try:
                # Read original code
                original_code = await self.code_tools.read_file(file_path)
                
                # Create refactoring prompt
                prompt = self._create_refactoring_prompt(original_code, goals)
                
                # Get refactored code from LLM
                response = await self.llm_manager.agenerate([prompt])
                refactored_code = response.text
                
                # Validate refactored code
                validation = await self._validate_code(refactored_code)
                
                if validation['valid']:
                    # Create backup and save refactored code
                    backup_path = await self.code_tools.backup_file(file_path)
                    await self.code_tools.save_code(refactored_code, file_path)
                    
                    refactoring_results.append({
                        'file': file_path,
                        'success': True,
                        'backup': backup_path,
                        'changes_summary': self._summarize_changes(original_code, refactored_code)
                    })
                else:
                    refactoring_results.append({
                        'file': file_path,
                        'success': False,
                        'error': f"Validation failed: {validation['errors']}"
                    })
                    
            except Exception as e:
                refactoring_results.append({
                    'file': file_path,
                    'success': False,
                    'error': str(e)
                })
        
        return {
            'success': True,
            'result': {
                'refactoring_results': refactoring_results,
                'files_processed': len(files),
                'successful_refactoring': sum(1 for r in refactoring_results if r.get('success'))
            },
            'message': f"Refactored {len([r for r in refactoring_results if r.get('success')])} files",
            'tools_used': ['llm_refactoring', 'code_validation', 'file_operations']
        }
    
    async def _execute_testing(self, state: AgentState) -> Dict[str, Any]:
        """Execute test creation"""
        context = state.context
        target_files = context.get('target_code', [])
        test_types = context.get('test_types', ['unit'])
        
        test_results = []
        
        for file_path in target_files:
            try:
                # Read source code
                source_code = await self.code_tools.read_file(file_path)
                
                # Generate tests for each type
                for test_type in test_types:
                    prompt = self._create_test_prompt(source_code, file_path, test_type)
                    
                    response = await self.llm_manager.agenerate([prompt])
                    test_code = response.text
                    
                    # Create test file name
                    test_filename = self._generate_test_filename(file_path, test_type)
                    
                    # Save test file
                    await self.code_tools.save_code(test_code, test_filename)
                    
                    # Run tests if enabled
                    if self.enable_testing:
                        test_result = await self._run_tests(test_filename)
                        test_results.append({
                            'source_file': file_path,
                            'test_file': test_filename,
                            'test_type': test_type,
                            'test_result': test_result
                        })
                    else:
                        test_results.append({
                            'source_file': file_path,
                            'test_file': test_filename,
                            'test_type': test_type,
                            'status': 'created_not_run'
                        })
                        
            except Exception as e:
                test_results.append({
                    'source_file': file_path,
                    'error': str(e)
                })
        
        return {
            'success': True,
            'result': {
                'test_results': test_results,
                'tests_created': len([r for r in test_results if 'test_file' in r])
            },
            'message': f"Created tests for {len(target_files)} files",
            'tools_used': ['llm_test_generation', 'file_operations', 'test_runner']
        }
    
    async def _execute_documentation(self, state: AgentState) -> Dict[str, Any]:
        """Execute documentation creation"""
        context = state.context
        target_files = context.get('target_files', [])
        doc_types = context.get('doc_types', ['api'])
        
        doc_results = []
        
        for file_path in target_files:
            try:
                # Read source code
                source_code = await self.code_tools.read_file(file_path)
                
                # Generate documentation
                for doc_type in doc_types:
                    prompt = self._create_documentation_prompt(source_code, file_path, doc_type)
                    
                    response = await self.llm_manager.agenerate([prompt])
                    documentation = response.text
                    
                    # Create documentation file name
                    doc_filename = self._generate_doc_filename(file_path, doc_type)
                    
                    # Save documentation
                    await self.code_tools.save_code(documentation, doc_filename)
                    
                    doc_results.append({
                        'source_file': file_path,
                        'doc_file': doc_filename,
                        'doc_type': doc_type,
                        'status': 'created'
                    })
                    
            except Exception as e:
                doc_results.append({
                    'source_file': file_path,
                    'error': str(e)
                })
        
        return {
            'success': True,
            'result': {
                'documentation_results': doc_results,
                'docs_created': len([r for r in doc_results if 'doc_file' in r])
            },
            'message': f"Created documentation for {len(target_files)} files",
            'tools_used': ['llm_documentation', 'file_operations']
        }
    
    async def _execute_general_task(self, state: AgentState) -> Dict[str, Any]:
        """Execute general code task"""
        task = state.current_task
        
        # Create general prompt for code task
        prompt = SystemMessage(content=f"""
        You are a code expert. Please help with this task:
        {task}
        
        Provide a detailed response with code examples if applicable.
        """)
        
        try:
            response = await self.llm_manager.agenerate([prompt])
            
            return {
                'success': True,
                'result': response.text,
                'message': "Completed general code task",
                'tools_used': ['llm_general']
            }
            
        except Exception as e:
            return {
                'success': False,
                'error': str(e),
                'tools_used': ['llm_general']
            }
    
    async def _analyze_code(self, code: str, file_path: str) -> CodeAnalysis:
        """Perform comprehensive code analysis"""
        try:
            # Parse AST for Python files
            if file_path.endswith('.py'):
                tree = ast.parse(code)
                
                functions = [node.name for node in ast.walk(tree) if isinstance(node, ast.FunctionDef)]
                classes = [node.name for node in ast.walk(tree) if isinstance(node, ast.ClassDef)]
                imports = []
                
                for node in ast.walk(tree):
                    if isinstance(node, ast.Import):
                        imports.extend([alias.name for alias in node.names])
                    elif isinstance(node, ast.ImportFrom):
                        module = node.module or ''
                        imports.extend([f"{module}.{alias.name}" for alias in node.names])
            else:
                # Basic analysis for other languages
                functions = re.findall(r'function\s+(\w+)|def\s+(\w+)|(\w+)\s*\(.*\)\s*{', code)
                classes = re.findall(r'class\s+(\w+)', code)
                imports = re.findall(r'import\s+([^;\n]+)', code)
            
            # Calculate metrics
            lines_of_code = len([line for line in code.split('\n') if line.strip()])
            complexity = self._calculate_complexity(code)
            
            # Identify issues
            issues = await self._identify_issues(code, file_path)
            suggestions = await self._generate_suggestions(code, issues)
            
            return CodeAnalysis(
                complexity=complexity,
                lines_of_code=lines_of_code,
                functions=[f for f in functions if f],
                classes=[c for c in classes if c],
                imports=[i for i in imports if i],
                issues=issues,
                suggestions=suggestions
            )
            
        except Exception as e:
            return CodeAnalysis(
                complexity=0,
                lines_of_code=0,
                functions=[],
                classes=[],
                imports=[],
                issues=[f"Analysis failed: {str(e)}"],
                suggestions=[]
            )
    
    async def _validate_code(self, code: str, language: str = None) -> Dict[str, Any]:
        """Validate generated code"""
        try:
            if language == 'python' or (not language and 'def ' in code):
                # Python validation
                ast.parse(code)
                return {'valid': True, 'errors': []}
            
            # Basic validation for other languages
            # Check for basic syntax issues
            if not code.strip():
                return {'valid': False, 'errors': ['Empty code']}
            
            # Check for common syntax errors
            errors = []
            if code.count('{') != code.count('}'):
                errors.append('Mismatched braces')
            if code.count('(') != code.count(')'):
                errors.append('Mismatched parentheses')
            if code.count('[') != code.count(']'):
                errors.append('Mismatched brackets')
            
            return {'valid': len(errors) == 0, 'errors': errors}
            
        except SyntaxError as e:
            return {'valid': False, 'errors': [str(e)]}
        except Exception as e:
            return {'valid': False, 'errors': [f"Validation error: {str(e)}"]}
    
    def _calculate_complexity(self, code: str) -> int:
        """Calculate cyclomatic complexity"""
        # Simplified complexity calculation
        complexity_indicators = [
            'if ', 'elif ', 'else:', 'for ', 'while ', 'try:', 'except:', 'finally:',
            'with ', 'and ', 'or ', '?', 'case ', 'switch', 'catch'
        ]
        
        complexity = 1  # Base complexity
        for indicator in complexity_indicators:
            complexity += code.lower().count(indicator)
        
        return complexity
    
    async def _identify_issues(self, code: str, file_path: str) -> List[str]:
        """Identify code issues"""
        issues = []
        
        # Common issues
        if len(code.split('\n')) > 500:
            issues.append("File is very long (>500 lines)")
        
        if 'TODO' in code or 'FIXME' in code:
            issues.append("Contains TODO or FIXME comments")
        
        if code.count('try:') > code.count('except:'):
            issues.append("Try blocks without corresponding except blocks")
        
        # Language-specific issues
        if file_path.endswith('.py'):
            if 'import *' in code:
                issues.append("Uses wildcard imports")
            if re.search(r'def \w+\([^)]{50,}', code):
                issues.append("Functions with many parameters")
        
        return issues
    
    async def _generate_suggestions(self, code: str, issues: List[str]) -> List[str]:
        """Generate improvement suggestions"""
        suggestions = []
        
        for issue in issues:
            if "very long" in issue:
                suggestions.append("Consider splitting into smaller modules")
            elif "TODO" in issue:
                suggestions.append("Complete or remove TODO items")
            elif "wildcard imports" in issue:
                suggestions.append("Use explicit imports instead of wildcards")
            elif "many parameters" in issue:
                suggestions.append("Consider using parameter objects or reducing parameters")
        
        return suggestions
    
    def _extract_language(self, task: str) -> str:
        """Extract programming language from task"""
        task_lower = task.lower()
        for lang in self.supported_languages:
            if lang in task_lower:
                return lang
        return 'python'  # Default
    
    def _extract_file_type(self, task: str) -> str:
        """Extract file type from task"""
        extensions = re.findall(r'\.(\w+)', task)
        return extensions[0] if extensions else 'py'
    
    def _extract_file_paths(self, task: str) -> List[str]:
        """Extract file paths from task"""
        # Simple pattern matching for file paths
        patterns = [
            r'["\']([^"\']*\.[a-z]+)["\']',  # Quoted paths
            r'(\w+/[\w/]*\.\w+)',  # Unix paths
            r'(\w+\\[\w\\]*\.\w+)',  # Windows paths
        ]
        
        paths = []
        for pattern in patterns:
            matches = re.findall(pattern, task)
            paths.extend(matches)
        
        return paths
    
    def _extract_requirements(self, task: str) -> List[str]:
        """Extract requirements from task description"""
        # Simple extraction of requirements
        requirements = []
        
        # Look for bullet points or numbered lists
        lines = task.split('\n')
        for line in lines:
            line = line.strip()
            if line.startswith(('- ', '* ', '1. ', '2. ', '3.')):
                requirements.append(line)
        
        return requirements
    
    def _extract_refactoring_goals(self, task: str) -> List[str]:
        """Extract refactoring goals from task"""
        goals = []
        
        goal_keywords = {
            'performance': ['optimize', 'faster', 'performance', 'speed'],
            'readability': ['readable', 'clean', 'clear', 'understandable'],
            'maintainability': ['maintainable', 'modular', 'reusable'],
            'security': ['secure', 'safe', 'security', 'vulnerability']
        }
        
        task_lower = task.lower()
        for goal, keywords in goal_keywords.items():
            if any(keyword in task_lower for keyword in keywords):
                goals.append(goal)
        
        return goals if goals else ['general_improvement']
    
    def _extract_doc_types(self, task: str) -> List[str]:
        """Extract documentation types from task"""
        task_lower = task.lower()
        doc_types = []
        
        if any(word in task_lower for word in ['api', 'function', 'method']):
            doc_types.append('api')
        if any(word in task_lower for word in ['readme', 'overview']):
            doc_types.append('readme')
        if any(word in task_lower for word in ['comment', 'inline']):
            doc_types.append('inline')
        
        return doc_types if doc_types else ['api']
    
    def _select_template(self, language: str, file_type: str) -> str:
        """Select appropriate code template"""
        templates = {
            'python': {
                'class': 'class_template.py',
                'function': 'function_template.py',
                'script': 'script_template.py'
            },
            'javascript': {
                'class': 'class_template.js',
                'function': 'function_template.js',
                'module': 'module_template.js'
            }
        }
        
        return templates.get(language, {}).get(file_type, 'basic_template')
    
    def _create_generation_prompt(self, task: str, context: Dict[str, Any]) -> SystemMessage:
        """Create prompt for code generation"""
        language = context.get('language', 'python')
        requirements = context.get('requirements', [])
        
        requirements_text = '\n'.join(requirements) if requirements else "No specific requirements provided."
        
        prompt = f"""
        You are an expert {language} developer. Generate high-quality, production-ready code for the following task:

        Task: {task}

        Requirements:
        {requirements_text}

        Language: {language}
        
        Please provide:
        1. Clean, well-structured code
        2. Appropriate comments and docstrings
        3. Error handling where needed
        4. Follow best practices for {language}
        
        Generate only the code without additional explanations unless specifically requested.
        """
        
        return SystemMessage(content=prompt)
    
    def _create_refactoring_prompt(self, original_code: str, goals: List[str]) -> SystemMessage:
        """Create prompt for code refactoring"""
        goals_text = ', '.join(goals)
        
        prompt = f"""
        You are an expert code refactoring specialist. Please refactor the following code to improve: {goals_text}

        Original Code:
        ```
        {original_code}
        ```

        Requirements:
        - Maintain the same functionality
        - Improve {goals_text}
        - Add comments where helpful
        - Follow best practices
        - Ensure the code is more maintainable

        Please provide the refactored code with a brief summary of changes made.
        """
        
        return SystemMessage(content=prompt)
    
    def _create_test_prompt(self, source_code: str, file_path: str, test_type: str) -> SystemMessage:
        """Create prompt for test generation"""
        prompt = f"""
        You are an expert test developer. Create comprehensive {test_type} tests for the following code:

        File: {file_path}
        Source Code:
        ```
        {source_code}
        ```

        Requirements:
        - Create {test_type} tests for all public functions/methods
        - Include edge cases and error conditions
        - Use appropriate testing framework (pytest for Python, jest for JavaScript, etc.)
        - Include setup and teardown if needed
        - Add meaningful test descriptions
        - Ensure good test coverage

        Generate complete test file with all necessary imports and test cases.
        """
        
        return SystemMessage(content=prompt)
    
    def _create_documentation_prompt(self, source_code: str, file_path: str, doc_type: str) -> SystemMessage:
        """Create prompt for documentation generation"""
        prompt = f"""
        You are an expert technical writer. Create {doc_type} documentation for the following code:

        File: {file_path}
        Source Code:
        ```
        {source_code}
        ```

        Requirements for {doc_type} documentation:
        """
        
        if doc_type == 'api':
            prompt += """
            - Document all public functions, classes, and methods
            - Include parameter descriptions and types
            - Document return values
            - Include usage examples
            - Note any exceptions that might be raised
            """
        elif doc_type == 'readme':
            prompt += """
            - Provide overview of the module/package
            - Installation instructions if applicable
            - Usage examples
            - API reference summary
            - Contributing guidelines if applicable
            """
        elif doc_type == 'inline':
            prompt += """
            - Add inline comments explaining complex logic
            - Add docstrings to functions and classes
            - Explain the purpose of important variables
            - Document any non-obvious algorithms
            """
        
        prompt += "\nGenerate clear, comprehensive documentation that helps other developers understand and use the code."
        
        return SystemMessage(content=prompt)
    
    def _generate_test_filename(self, source_file: str, test_type: str) -> str:
        """Generate test filename"""
        path = Path(source_file)
        name = path.stem
        ext = path.suffix
        
        if test_type == 'unit':
            return f"test_{name}{ext}"
        else:
            return f"test_{test_type}_{name}{ext}"
    
    def _generate_doc_filename(self, source_file: str, doc_type: str) -> str:
        """Generate documentation filename"""
        path = Path(source_file)
        name = path.stem
        
        if doc_type == 'api':
            return f"{name}_api.md"
        elif doc_type == 'readme':
            return "README.md"
        else:
            return f"{name}_docs.md"
    
    async def _run_tests(self, test_file: str) -> Dict[str, Any]:
        """Run tests and return results"""
        try:
            if test_file.endswith('.py'):
                # Run pytest
                result = subprocess.run(
                    ['python', '-m', 'pytest', test_file, '-v'],
                    capture_output=True,
                    text=True,
                    timeout=30
                )
            else:
                # For other languages, return placeholder
                return {'status': 'not_implemented', 'output': 'Test execution not implemented for this language'}
            
            return {
                'status': 'passed' if result.returncode == 0 else 'failed',
                'return_code': result.returncode,
                'stdout': result.stdout,
                'stderr': result.stderr
            }
            
        except subprocess.TimeoutExpired:
            return {'status': 'timeout', 'error': 'Test execution timed out'}
        except Exception as e:
            return {'status': 'error', 'error': str(e)}
    
    def _summarize_analyses(self, analyses: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Summarize multiple code analyses"""
        total_files = len(analyses)
        total_loc = sum(a.get('analysis', {}).get('lines_of_code', 0) for a in analyses if 'analysis' in a)
        avg_complexity = sum(a.get('analysis', {}).get('complexity', 0) for a in analyses if 'analysis' in a) / max(total_files, 1)
        
        all_issues = []
        for a in analyses:
            if 'analysis' in a:
                all_issues.extend(a['analysis'].get('issues', []))
        
        return {
            'total_files': total_files,
            'total_lines_of_code': total_loc,
            'average_complexity': round(avg_complexity, 2),
            'total_issues': len(all_issues),
            'common_issues': list(set(all_issues))
        }
    
    def _summarize_changes(self, original: str, refactored: str) -> Dict[str, Any]:
        """Summarize changes made during refactoring"""
        original_lines = original.split('\n')
        refactored_lines = refactored.split('\n')
        
        return {
            'lines_before': len(original_lines),
            'lines_after': len(refactored_lines),
            'size_change': len(refactored_lines) - len(original_lines),
            'major_changes': ['Refactored for improved structure and readability']
        }

    async def _evaluate_progress(self, state: AgentState) -> Dict[str, Any]:
        """Evaluate progress specific to code tasks"""
        # Check if we have a result
        if state.result is not None:
            result = state.result
            
            # Evaluate based on task type
            task_type = state.context.get('task_type')
            
            if task_type == 'generate':
                # For generation, check if code was created and validated
                if isinstance(result, dict) and result.get('code'):
                    return {'complete': True, 'success': True, 'quality': 'good'}
            
            elif task_type == 'analyze':
                # For analysis, check if analyses were completed
                if isinstance(result, dict) and result.get('analyses'):
                    return {'complete': True, 'success': True, 'quality': 'comprehensive'}
            
            elif task_type in ['refactor', 'test', 'document']:
                # For other tasks, check success count
                if isinstance(result, dict):
                    success_count = result.get('files_processed', 0)
                    if success_count > 0:
                        return {'complete': True, 'success': True, 'processed': success_count}
            
            return {'complete': True, 'success': True}
        
        # Default evaluation
        return await super()._evaluate_progress(state)