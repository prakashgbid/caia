"""
Code Tools - File operations, git, testing, and development tools
"""

import os
import subprocess
import shutil
from pathlib import Path
from typing import Dict, Any, List, Optional
from datetime import datetime

class CodeTools:
    \"\"\"Tools for code operations\"\"\"
    
    def __init__(self):
        self.supported_languages = ['python', 'javascript', 'typescript', 'java', 'cpp', 'go', 'rust']
    
    async def read_file(self, file_path: str) -> str:
        \"\"\"Read file contents\"\"\"
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                return f.read()
        except Exception as e:
            raise Exception(f\"Failed to read file {file_path}: {str(e)}\")
    
    async def save_code(self, code: str, filename: str, create_dirs: bool = True) -> bool:
        \"\"\"Save code to file\"\"\"
        try:
            if create_dirs:
                os.makedirs(os.path.dirname(filename), exist_ok=True)
            
            with open(filename, 'w', encoding='utf-8') as f:
                f.write(code)
            return True
        except Exception as e:
            raise Exception(f\"Failed to save code to {filename}: {str(e)}\")
    
    async def backup_file(self, file_path: str) -> str:
        \"\"\"Create backup of file\"\"\"
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        backup_path = f\"{file_path}.backup_{timestamp}\"
        shutil.copy2(file_path, backup_path)
        return backup_path
    
    async def run_tests(self, test_path: str) -> Dict[str, Any]:
        \"\"\"Run tests and return results\"\"\"
        try:
            if test_path.endswith('.py'):
                result = subprocess.run(
                    ['python', '-m', 'pytest', test_path, '-v'],
                    capture_output=True, text=True, timeout=60
                )
            else:
                return {'status': 'not_supported', 'message': 'Language not supported for testing'}
            
            return {
                'status': 'passed' if result.returncode == 0 else 'failed',
                'return_code': result.returncode,
                'stdout': result.stdout,
                'stderr': result.stderr
            }
        except Exception as e:
            return {'status': 'error', 'message': str(e)}
    
    async def git_status(self, repo_path: str = '.') -> Dict[str, Any]:
        \"\"\"Get git status\"\"\"
        try:
            result = subprocess.run(
                ['git', 'status', '--porcelain'],
                cwd=repo_path, capture_output=True, text=True
            )
            
            if result.returncode == 0:
                return {'status': 'success', 'output': result.stdout}
            else:
                return {'status': 'error', 'message': result.stderr}
        except Exception as e:
            return {'status': 'error', 'message': str(e)}
    
    async def format_code(self, code: str, language: str) -> str:
        \"\"\"Format code using language-specific formatters\"\"\"
        # Simple formatting - in production would use actual formatters
        if language == 'python':
            # Basic Python formatting
            lines = code.split('\\n')
            formatted_lines = []
            indent_level = 0
            
            for line in lines:
                stripped = line.strip()
                if not stripped:
                    formatted_lines.append('')
                    continue
                
                if stripped.endswith(':'):
                    formatted_lines.append('    ' * indent_level + stripped)
                    indent_level += 1
                elif stripped in ['else:', 'elif', 'except:', 'finally:']:
                    formatted_lines.append('    ' * (indent_level - 1) + stripped)
                else:
                    formatted_lines.append('    ' * indent_level + stripped)
            
            return '\\n'.join(formatted_lines)
        
        return code  # Return as-is for unsupported languages