"""
Entity Extractor - Extract entities from text and code
Phase 4 - Advanced Knowledge Graph System
"""

import re
import ast
import spacy
import logging
from typing import Dict, List, Set, Optional, Tuple, Any
from dataclasses import dataclass
from collections import defaultdict
import yaml

from ..core.graph_schema import NodeType, get_graph_schema

logger = logging.getLogger(__name__)

@dataclass
class ExtractedEntity:
    """Represents an extracted entity"""
    text: str
    entity_type: str
    confidence: float
    start_pos: int
    end_pos: int
    context: str = ""
    metadata: Dict[str, Any] = None
    
    def __post_init__(self):
        if self.metadata is None:
            self.metadata = {}

@dataclass
class CodeEntity:
    """Represents a code entity"""
    name: str
    entity_type: str  # function, class, variable, import, etc.
    file_path: str
    line_start: int
    line_end: int = None
    language: str = "python"
    parameters: List[str] = None
    return_type: str = None
    docstring: str = None
    complexity: int = 1
    
    def __post_init__(self):
        if self.parameters is None:
            self.parameters = []
        if self.line_end is None:
            self.line_end = self.line_start

class EntityExtractor:
    """
    Extracts entities from text and code using multiple approaches
    
    Combines NLP models, pattern matching, and AST analysis to identify
    and extract meaningful entities from various data sources.
    """
    
    def __init__(self, config_path: str = "graph_config.yaml"):
        """Initialize the entity extractor"""
        self.config = self._load_config(config_path)
        self.schema = get_graph_schema()
        
        # Initialize NLP models
        self.nlp = self._init_spacy_model()
        
        # Code analysis patterns
        self.code_patterns = self._init_code_patterns()
        
        # Entity type mappings
        self.entity_type_map = self._init_entity_type_map()
        
        logger.info("Entity extractor initialized successfully")
    
    def _load_config(self, config_path: str) -> Dict:
        """Load configuration"""
        try:
            with open(config_path, 'r') as f:
                return yaml.safe_load(f)
        except Exception as e:
            logger.warning(f"Could not load config from {config_path}: {e}")
            return self._default_config()
    
    def _default_config(self) -> Dict:
        """Default configuration"""
        return {
            'semantic': {
                'entity_extraction': {
                    'models': [
                        {'name': 'spacy_en_core_web_lg', 'enabled': True, 'confidence_threshold': 0.7}
                    ],
                    'entity_types': [
                        'PERSON', 'ORG', 'GPE', 'PRODUCT', 'EVENT',
                        'CODE_FUNCTION', 'CODE_CLASS', 'CODE_VARIABLE', 'CONCEPT', 'PATTERN'
                    ]
                }
            }
        }
    
    def _init_spacy_model(self):
        """Initialize spaCy NLP model"""
        try:
            # Try to load the large model first
            nlp = spacy.load("en_core_web_lg")
            logger.info("Loaded spaCy large model (en_core_web_lg)")
        except OSError:
            try:
                # Fallback to medium model
                nlp = spacy.load("en_core_web_md")
                logger.info("Loaded spaCy medium model (en_core_web_md)")
            except OSError:
                try:
                    # Fallback to small model
                    nlp = spacy.load("en_core_web_sm")
                    logger.info("Loaded spaCy small model (en_core_web_sm)")
                except OSError:
                    logger.error("No spaCy model found. Please install: python -m spacy download en_core_web_lg")
                    nlp = None
        
        return nlp
    
    def _init_code_patterns(self) -> Dict[str, re.Pattern]:
        """Initialize regex patterns for code entity extraction"""
        patterns = {
            'python_function': re.compile(r'def\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(([^)]*)\)'),
            'python_class': re.compile(r'class\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*(?:\([^)]*\))?:'),
            'python_variable': re.compile(r'([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*([^#\n]+)'),
            'python_import': re.compile(r'(?:from\s+([^\s]+)\s+)?import\s+([^\s#\n]+)'),
            'javascript_function': re.compile(r'(?:function\s+)?([a-zA-Z_$][a-zA-Z0-9_$]*)\s*(?:=\s*)?(?:function)?\s*\([^)]*\)'),
            'javascript_class': re.compile(r'class\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*(?:extends\s+[^\s{]+)?\s*{'),
            'api_endpoint': re.compile(r'(?:GET|POST|PUT|DELETE|PATCH)\s+([/\w\-{}:]+)'),
            'url_pattern': re.compile(r'https?://[^\s]+'),
            'file_path': re.compile(r'(?:[/\\][\w\-. ]+)+\.\w+'),
            'version_number': re.compile(r'\b\d+\.\d+(?:\.\d+)?(?:-[a-zA-Z0-9]+)?\b'),
        }
        
        return patterns
    
    def _init_entity_type_map(self) -> Dict[str, str]:
        """Map spaCy entity types to our entity types"""
        return {
            'PERSON': 'PERSON',
            'ORG': 'ORGANIZATION', 
            'GPE': 'LOCATION',
            'PRODUCT': 'PRODUCT',
            'EVENT': 'EVENT',
            'WORK_OF_ART': 'CONCEPT',
            'LANGUAGE': 'LANGUAGE',
            'NORP': 'GROUP',
            'FACILITY': 'LOCATION',
            'MONEY': 'VALUE',
            'PERCENT': 'VALUE',
            'DATE': 'TEMPORAL',
            'TIME': 'TEMPORAL',
            'CARDINAL': 'NUMBER',
            'ORDINAL': 'NUMBER',
        }
    
    def extract_from_text(self, text: str, source: str = None) -> List[ExtractedEntity]:
        """
        Extract entities from natural language text
        
        Args:
            text: Input text to analyze
            source: Source identifier for the text
            
        Returns:
            List of extracted entities
        """
        entities = []
        
        if not self.nlp:
            logger.warning("spaCy model not available, using pattern-based extraction only")
            return self._extract_with_patterns(text, source)
        
        try:
            # Process text with spaCy
            doc = self.nlp(text)
            
            # Extract named entities
            for ent in doc.ents:
                entity_type = self.entity_type_map.get(ent.label_, ent.label_)
                
                # Get confidence threshold for this entity type
                confidence_threshold = self._get_confidence_threshold(entity_type)
                
                # Calculate confidence based on entity characteristics
                confidence = self._calculate_entity_confidence(ent, doc)
                
                if confidence >= confidence_threshold:
                    # Get surrounding context
                    context = self._get_entity_context(ent, doc, context_window=50)
                    
                    entity = ExtractedEntity(
                        text=ent.text,
                        entity_type=entity_type,
                        confidence=confidence,
                        start_pos=ent.start_char,
                        end_pos=ent.end_char,
                        context=context,
                        metadata={
                            'spacy_label': ent.label_,
                            'source': source,
                            'extraction_method': 'spacy_nlp'
                        }
                    )
                    
                    entities.append(entity)
            
            # Also extract with patterns for additional entities
            pattern_entities = self._extract_with_patterns(text, source)
            entities.extend(pattern_entities)
            
            # Remove duplicates and merge similar entities
            entities = self._deduplicate_entities(entities)
            
            logger.debug(f"Extracted {len(entities)} entities from text")
            
        except Exception as e:
            logger.error(f"Error extracting entities from text: {e}")
            # Fallback to pattern extraction
            entities = self._extract_with_patterns(text, source)
        
        return entities
    
    def _extract_with_patterns(self, text: str, source: str = None) -> List[ExtractedEntity]:
        """Extract entities using regex patterns"""
        entities = []
        
        # Extract URLs
        for match in self.code_patterns['url_pattern'].finditer(text):
            entities.append(ExtractedEntity(
                text=match.group(0),
                entity_type='URL',
                confidence=0.9,
                start_pos=match.start(),
                end_pos=match.end(),
                context=self._get_match_context(text, match, 50),
                metadata={'source': source, 'extraction_method': 'regex_pattern'}
            ))
        
        # Extract file paths
        for match in self.code_patterns['file_path'].finditer(text):
            entities.append(ExtractedEntity(
                text=match.group(0),
                entity_type='FILE_PATH',
                confidence=0.8,
                start_pos=match.start(),
                end_pos=match.end(),
                context=self._get_match_context(text, match, 30),
                metadata={'source': source, 'extraction_method': 'regex_pattern'}
            ))
        
        # Extract version numbers
        for match in self.code_patterns['version_number'].finditer(text):
            entities.append(ExtractedEntity(
                text=match.group(0),
                entity_type='VERSION',
                confidence=0.7,
                start_pos=match.start(),
                end_pos=match.end(),
                context=self._get_match_context(text, match, 20),
                metadata={'source': source, 'extraction_method': 'regex_pattern'}
            ))
        
        return entities
    
    def extract_from_code(self, code: str, file_path: str = None, language: str = "python") -> List[CodeEntity]:
        """
        Extract entities from source code
        
        Args:
            code: Source code string
            file_path: Path to the source file
            language: Programming language
            
        Returns:
            List of code entities
        """
        entities = []
        
        if language.lower() == "python":
            entities = self._extract_python_entities(code, file_path)
        elif language.lower() in ["javascript", "typescript"]:
            entities = self._extract_javascript_entities(code, file_path)
        else:
            # Generic pattern-based extraction
            entities = self._extract_generic_code_entities(code, file_path, language)
        
        logger.debug(f"Extracted {len(entities)} code entities from {language} code")
        return entities
    
    def _extract_python_entities(self, code: str, file_path: str = None) -> List[CodeEntity]:
        """Extract entities from Python code using AST"""
        entities = []
        
        try:
            # Parse code into AST
            tree = ast.parse(code)
            
            # Extract entities using AST visitor
            visitor = PythonEntityVisitor(file_path)
            visitor.visit(tree)
            entities = visitor.entities
            
        except SyntaxError as e:
            logger.warning(f"Syntax error in Python code, falling back to pattern matching: {e}")
            # Fallback to pattern matching
            entities = self._extract_python_with_patterns(code, file_path)
        except Exception as e:
            logger.error(f"Error parsing Python code: {e}")
            entities = self._extract_python_with_patterns(code, file_path)
        
        return entities
    
    def _extract_python_with_patterns(self, code: str, file_path: str = None) -> List[CodeEntity]:
        """Extract Python entities using regex patterns"""
        entities = []
        lines = code.split('\n')
        
        for line_num, line in enumerate(lines, 1):
            # Extract functions
            func_match = self.code_patterns['python_function'].search(line)
            if func_match:
                entities.append(CodeEntity(
                    name=func_match.group(1),
                    entity_type='function',
                    file_path=file_path or 'unknown',
                    line_start=line_num,
                    language='python',
                    parameters=self._parse_parameters(func_match.group(2))
                ))
            
            # Extract classes
            class_match = self.code_patterns['python_class'].search(line)
            if class_match:
                entities.append(CodeEntity(
                    name=class_match.group(1),
                    entity_type='class',
                    file_path=file_path or 'unknown',
                    line_start=line_num,
                    language='python'
                ))
            
            # Extract imports
            import_match = self.code_patterns['python_import'].search(line)
            if import_match:
                module = import_match.group(2)
                entities.append(CodeEntity(
                    name=module,
                    entity_type='import',
                    file_path=file_path or 'unknown',
                    line_start=line_num,
                    language='python'
                ))
        
        return entities
    
    def _extract_javascript_entities(self, code: str, file_path: str = None) -> List[CodeEntity]:
        """Extract entities from JavaScript/TypeScript code"""
        entities = []
        lines = code.split('\n')
        
        for line_num, line in enumerate(lines, 1):
            # Extract functions
            func_match = self.code_patterns['javascript_function'].search(line)
            if func_match:
                entities.append(CodeEntity(
                    name=func_match.group(1),
                    entity_type='function',
                    file_path=file_path or 'unknown',
                    line_start=line_num,
                    language='javascript'
                ))
            
            # Extract classes
            class_match = self.code_patterns['javascript_class'].search(line)
            if class_match:
                entities.append(CodeEntity(
                    name=class_match.group(1),
                    entity_type='class',
                    file_path=file_path or 'unknown',
                    line_start=line_num,
                    language='javascript'
                ))
        
        return entities
    
    def _extract_generic_code_entities(self, code: str, file_path: str = None, language: str = "unknown") -> List[CodeEntity]:
        """Generic code entity extraction using patterns"""
        entities = []
        lines = code.split('\n')
        
        # Extract API endpoints if present
        for line_num, line in enumerate(lines, 1):
            api_match = self.code_patterns['api_endpoint'].search(line)
            if api_match:
                entities.append(CodeEntity(
                    name=api_match.group(1),
                    entity_type='api_endpoint',
                    file_path=file_path or 'unknown',
                    line_start=line_num,
                    language=language
                ))
        
        return entities
    
    def _parse_parameters(self, param_string: str) -> List[str]:
        """Parse function parameters from string"""
        if not param_string.strip():
            return []
        
        # Simple parameter parsing
        params = []
        for param in param_string.split(','):
            param = param.strip()
            if param:
                # Remove default values and type annotations
                param = param.split('=')[0].split(':')[0].strip()
                if param and param != 'self':
                    params.append(param)
        
        return params
    
    def _calculate_entity_confidence(self, entity, doc) -> float:
        """Calculate confidence score for an entity"""
        base_confidence = 0.7
        
        # Boost confidence for entities with title case
        if entity.text.istitle():
            base_confidence += 0.1
        
        # Boost confidence for longer entities
        if len(entity.text) > 5:
            base_confidence += 0.1
        
        # Check if entity appears multiple times
        entity_count = sum(1 for ent in doc.ents if ent.text.lower() == entity.text.lower())
        if entity_count > 1:
            base_confidence += 0.05 * min(entity_count - 1, 3)
        
        # Cap confidence at 1.0
        return min(base_confidence, 1.0)
    
    def _get_entity_context(self, entity, doc, context_window: int = 50) -> str:
        """Get context around an entity"""
        start_char = max(0, entity.start_char - context_window)
        end_char = min(len(doc.text), entity.end_char + context_window)
        return doc.text[start_char:end_char].replace('\n', ' ').strip()
    
    def _get_match_context(self, text: str, match, context_window: int = 50) -> str:
        """Get context around a regex match"""
        start = max(0, match.start() - context_window)
        end = min(len(text), match.end() + context_window)
        return text[start:end].replace('\n', ' ').strip()
    
    def _get_confidence_threshold(self, entity_type: str) -> float:
        """Get confidence threshold for entity type"""
        config_section = self.config.get('semantic', {}).get('entity_extraction', {})
        
        # Check for model-specific thresholds
        for model_config in config_section.get('models', []):
            if model_config.get('enabled', True):
                return model_config.get('confidence_threshold', 0.7)
        
        return 0.7  # Default threshold
    
    def _deduplicate_entities(self, entities: List[ExtractedEntity]) -> List[ExtractedEntity]:
        """Remove duplicate entities and merge similar ones"""
        # Group entities by text and type
        entity_groups = defaultdict(list)
        for entity in entities:
            key = (entity.text.lower(), entity.entity_type)
            entity_groups[key].append(entity)
        
        deduplicated = []
        for entities_group in entity_groups.values():
            if len(entities_group) == 1:
                deduplicated.append(entities_group[0])
            else:
                # Merge entities with same text and type
                merged = self._merge_entities(entities_group)
                deduplicated.append(merged)
        
        return deduplicated
    
    def _merge_entities(self, entities: List[ExtractedEntity]) -> ExtractedEntity:
        """Merge multiple entities of the same text and type"""
        # Use the entity with highest confidence as base
        base_entity = max(entities, key=lambda e: e.confidence)
        
        # Collect all metadata
        merged_metadata = {}
        for entity in entities:
            merged_metadata.update(entity.metadata or {})
        
        # Average confidence scores
        avg_confidence = sum(e.confidence for e in entities) / len(entities)
        
        base_entity.confidence = avg_confidence
        base_entity.metadata = merged_metadata
        
        return base_entity
    
    def batch_extract_from_files(self, file_paths: List[str]) -> Dict[str, List[CodeEntity]]:
        """
        Extract entities from multiple source files
        
        Args:
            file_paths: List of file paths to process
            
        Returns:
            Dictionary mapping file paths to extracted entities
        """
        results = {}
        
        for file_path in file_paths:
            try:
                # Determine language from file extension
                language = self._detect_language(file_path)
                
                # Read file content
                with open(file_path, 'r', encoding='utf-8') as f:
                    content = f.read()
                
                # Extract entities
                entities = self.extract_from_code(content, file_path, language)
                results[file_path] = entities
                
                logger.debug(f"Extracted {len(entities)} entities from {file_path}")
                
            except Exception as e:
                logger.error(f"Error processing file {file_path}: {e}")
                results[file_path] = []
        
        return results
    
    def _detect_language(self, file_path: str) -> str:
        """Detect programming language from file extension"""
        extension_map = {
            '.py': 'python',
            '.js': 'javascript',
            '.ts': 'typescript',
            '.java': 'java',
            '.cpp': 'cpp',
            '.c': 'c',
            '.cs': 'csharp',
            '.rb': 'ruby',
            '.go': 'go',
            '.rs': 'rust',
            '.php': 'php',
            '.swift': 'swift',
            '.kt': 'kotlin',
            '.scala': 'scala',
            '.clj': 'clojure',
            '.r': 'r',
            '.sql': 'sql',
            '.sh': 'bash',
            '.ps1': 'powershell'
        }
        
        # Get file extension
        extension = file_path[file_path.rfind('.'):].lower() if '.' in file_path else ''
        return extension_map.get(extension, 'unknown')

class PythonEntityVisitor(ast.NodeVisitor):
    """AST visitor for extracting Python entities"""
    
    def __init__(self, file_path: str = None):
        self.file_path = file_path or 'unknown'
        self.entities = []
    
    def visit_FunctionDef(self, node):
        """Visit function definitions"""
        # Extract function parameters
        params = [arg.arg for arg in node.args.args if arg.arg != 'self']
        
        # Get docstring if present
        docstring = None
        if (node.body and isinstance(node.body[0], ast.Expr) and 
            isinstance(node.body[0].value, ast.Constant) and
            isinstance(node.body[0].value.value, str)):
            docstring = node.body[0].value.value
        
        # Calculate complexity (simple metric based on control structures)
        complexity = self._calculate_complexity(node)
        
        entity = CodeEntity(
            name=node.name,
            entity_type='function',
            file_path=self.file_path,
            line_start=node.lineno,
            line_end=node.end_lineno,
            language='python',
            parameters=params,
            docstring=docstring,
            complexity=complexity
        )
        
        self.entities.append(entity)
        self.generic_visit(node)
    
    def visit_AsyncFunctionDef(self, node):
        """Visit async function definitions"""
        # Treat similar to regular functions
        self.visit_FunctionDef(node)
    
    def visit_ClassDef(self, node):
        """Visit class definitions"""
        # Get docstring if present
        docstring = None
        if (node.body and isinstance(node.body[0], ast.Expr) and 
            isinstance(node.body[0].value, ast.Constant) and
            isinstance(node.body[0].value.value, str)):
            docstring = node.body[0].value.value
        
        entity = CodeEntity(
            name=node.name,
            entity_type='class',
            file_path=self.file_path,
            line_start=node.lineno,
            line_end=node.end_lineno,
            language='python',
            docstring=docstring
        )
        
        self.entities.append(entity)
        self.generic_visit(node)
    
    def visit_Import(self, node):
        """Visit import statements"""
        for alias in node.names:
            entity = CodeEntity(
                name=alias.name,
                entity_type='import',
                file_path=self.file_path,
                line_start=node.lineno,
                language='python'
            )
            self.entities.append(entity)
    
    def visit_ImportFrom(self, node):
        """Visit from...import statements"""
        if node.module:
            entity = CodeEntity(
                name=node.module,
                entity_type='import',
                file_path=self.file_path,
                line_start=node.lineno,
                language='python'
            )
            self.entities.append(entity)
    
    def _calculate_complexity(self, node) -> int:
        """Calculate cyclomatic complexity of a function"""
        complexity = 1  # Base complexity
        
        for child in ast.walk(node):
            if isinstance(child, (ast.If, ast.While, ast.For, ast.AsyncFor,
                                ast.With, ast.AsyncWith, ast.Try, ast.ExceptHandler)):
                complexity += 1
            elif isinstance(child, ast.BoolOp):
                # Add complexity for boolean operations
                complexity += len(child.values) - 1
        
        return complexity