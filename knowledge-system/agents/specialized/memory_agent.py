"""
Memory Agent - Specialized agent for managing collective memory and context across the system
"""

import asyncio
import json
import pickle
import sqlite3
from typing import Dict, Any, List, Optional, Union, Tuple
from dataclasses import dataclass, field, asdict
from datetime import datetime, timedelta
from enum import Enum
import hashlib

from langchain_core.messages import HumanMessage, AIMessage, SystemMessage
from ..base_agent import BaseAgent, AgentState, AgentStatus

class MemoryType(Enum):
    SHORT_TERM = "short_term"  # Current session/conversation
    LONG_TERM = "long_term"    # Persistent across sessions
    EPISODIC = "episodic"      # Event-based memories
    SEMANTIC = "semantic"      # Concept and fact memories
    PROCEDURAL = "procedural"  # How-to and process memories

@dataclass
class MemoryItem:
    """Represents a memory item"""
    memory_id: str
    memory_type: MemoryType
    content: str
    context: Dict[str, Any]
    importance: float  # 0.0 to 1.0
    access_count: int = 0
    created_at: datetime = field(default_factory=datetime.now)
    last_accessed: datetime = field(default_factory=datetime.now)
    expires_at: Optional[datetime] = None
    tags: List[str] = field(default_factory=list)
    metadata: Dict[str, Any] = field(default_factory=dict)

@dataclass
class ContextSnapshot:
    """Represents a context snapshot"""
    snapshot_id: str
    timestamp: datetime
    agent_states: Dict[str, Dict[str, Any]]
    shared_context: Dict[str, Any]
    active_memories: List[str]  # memory_ids
    conversation_history: List[Dict[str, Any]]

class MemoryAgent(BaseAgent):
    """
    Specialized agent for memory management:
    - Short-term memory (current session)
    - Long-term memory (persistent storage)
    - Episodic memory (events and experiences)
    - Semantic memory (facts and concepts)
    - Context management across agents
    """
    
    def __init__(self, llm_manager, config: Dict[str, Any]):
        super().__init__(
            name="MemoryAgent",
            llm_manager=llm_manager,
            config=config
        )
        
        # Memory configuration
        self.max_short_term_items = config.get('max_short_term_items', 1000)
        self.max_long_term_items = config.get('max_long_term_items', 10000)
        self.importance_threshold = config.get('importance_threshold', 0.3)
        self.memory_decay_rate = config.get('memory_decay_rate', 0.1)
        self.context_window_size = config.get('context_window_size', 50)
        
        # Memory stores
        self.short_term_memory: Dict[str, MemoryItem] = {}
        self.long_term_memory: Dict[str, MemoryItem] = {}
        self.episodic_memory: Dict[str, MemoryItem] = {}
        self.semantic_memory: Dict[str, MemoryItem] = {}
        self.procedural_memory: Dict[str, MemoryItem] = {}
        
        # Context management
        self.current_context: Dict[str, Any] = {}
        self.context_history: List[ContextSnapshot] = []
        self.conversation_history: List[Dict[str, Any]] = []
        
        # Database connection for persistence
        self.db_path = config.get('memory_db_path', 'memory.db')
        self._init_database()
        
        # Memory consolidation
        self.consolidation_interval = config.get('consolidation_interval_hours', 24)
        self.last_consolidation = datetime.now()
    
    def _init_database(self):
        """Initialize SQLite database for persistent memory"""
        self.conn = sqlite3.connect(self.db_path, check_same_thread=False)
        self.conn.execute('''
            CREATE TABLE IF NOT EXISTS memories (
                memory_id TEXT PRIMARY KEY,
                memory_type TEXT,
                content TEXT,
                context TEXT,
                importance REAL,
                access_count INTEGER,
                created_at TEXT,
                last_accessed TEXT,
                expires_at TEXT,
                tags TEXT,
                metadata TEXT
            )
        ''')
        
        self.conn.execute('''
            CREATE TABLE IF NOT EXISTS context_snapshots (
                snapshot_id TEXT PRIMARY KEY,
                timestamp TEXT,
                agent_states TEXT,
                shared_context TEXT,
                active_memories TEXT,
                conversation_history TEXT
            )
        ''')
        
        self.conn.commit()
    
    async def _plan_action(self, state: AgentState, context: Dict[str, Any]) -> Dict[str, Any]:
        """Plan memory-related actions"""
        task = state.current_task
        task_type = self._classify_memory_task(task)
        
        plan = {
            'task_type': task_type,
            'context': {},
            'metadata': {
                'task_classification': task_type,
                'memory_iteration': state.iteration
            }
        }
        
        if task_type == 'store_memory':
            plan['context'] = await self._plan_memory_storage(task, context)
        elif task_type == 'retrieve_memory':
            plan['context'] = await self._plan_memory_retrieval(task, context)
        elif task_type == 'consolidate_memory':
            plan['context'] = await self._plan_memory_consolidation(task, context)
        elif task_type == 'manage_context':
            plan['context'] = await self._plan_context_management(task, context)
        elif task_type == 'analyze_patterns':
            plan['context'] = await self._plan_pattern_analysis(task, context)
        elif task_type == 'cleanup_memory':
            plan['context'] = await self._plan_memory_cleanup(task, context)
        else:
            plan['context'] = {'approach': 'general_memory'}
        
        return plan
    
    async def _execute_action(self, state: AgentState) -> Dict[str, Any]:
        """Execute memory-related actions"""
        task_type = state.context.get('task_type')
        
        try:
            if task_type == 'store_memory':
                return await self._execute_memory_storage(state)
            elif task_type == 'retrieve_memory':
                return await self._execute_memory_retrieval(state)
            elif task_type == 'consolidate_memory':
                return await self._execute_memory_consolidation(state)
            elif task_type == 'manage_context':
                return await self._execute_context_management(state)
            elif task_type == 'analyze_patterns':
                return await self._execute_pattern_analysis(state)
            elif task_type == 'cleanup_memory':
                return await self._execute_memory_cleanup(state)
            else:
                return await self._execute_general_memory(state)
                
        except Exception as e:
            return {
                'success': False,
                'error': str(e),
                'tools_used': ['memory_agent_internal']
            }
    
    def _classify_memory_task(self, task: str) -> str:
        """Classify the type of memory task"""
        task_lower = task.lower()
        
        if any(word in task_lower for word in ['store', 'save', 'remember', 'memorize']):
            return 'store_memory'
        elif any(word in task_lower for word in ['retrieve', 'recall', 'find', 'search memory']):
            return 'retrieve_memory'
        elif any(word in task_lower for word in ['consolidate', 'organize', 'merge']):
            return 'consolidate_memory'
        elif any(word in task_lower for word in ['context', 'manage context', 'update context']):
            return 'manage_context'
        elif any(word in task_lower for word in ['pattern', 'analyze', 'insight']):
            return 'analyze_patterns'
        elif any(word in task_lower for word in ['cleanup', 'clean', 'purge', 'expire']):
            return 'cleanup_memory'
        else:
            return 'general_memory'
    
    async def _plan_memory_storage(self, task: str, context: Dict[str, Any]) -> Dict[str, Any]:
        """Plan memory storage strategy"""
        memory_data = context.get('memory_data', {})
        memory_type = self._infer_memory_type(task, memory_data)
        
        return {
            'approach': 'store_memory',
            'memory_type': memory_type,
            'memory_data': memory_data,
            'calculate_importance': True,
            'extract_tags': True
        }
    
    async def _plan_memory_retrieval(self, task: str, context: Dict[str, Any]) -> Dict[str, Any]:
        """Plan memory retrieval strategy"""
        search_query = self._extract_search_query(task)
        memory_types = context.get('memory_types', list(MemoryType))
        
        return {
            'approach': 'retrieve_memory',
            'search_query': search_query,
            'memory_types': memory_types,
            'max_results': context.get('max_results', 10),
            'relevance_threshold': context.get('relevance_threshold', 0.5)
        }
    
    async def _plan_memory_consolidation(self, task: str, context: Dict[str, Any]) -> Dict[str, Any]:
        """Plan memory consolidation"""
        return {
            'approach': 'consolidate_memory',
            'consolidation_type': context.get('type', 'full'),
            'time_window_hours': context.get('time_window', 24),
            'merge_similar': True
        }
    
    async def _plan_context_management(self, task: str, context: Dict[str, Any]) -> Dict[str, Any]:
        """Plan context management"""
        operation = self._extract_context_operation(task)
        
        return {
            'approach': 'manage_context',
            'operation': operation,
            'context_data': context.get('context_data', {}),
            'agent_id': context.get('agent_id'),
            'create_snapshot': context.get('create_snapshot', True)
        }
    
    async def _plan_pattern_analysis(self, task: str, context: Dict[str, Any]) -> Dict[str, Any]:
        """Plan memory pattern analysis"""
        return {
            'approach': 'analyze_patterns',
            'analysis_scope': context.get('scope', 'all'),
            'pattern_types': ['temporal', 'semantic', 'behavioral'],
            'time_range': context.get('time_range', 'last_week')
        }
    
    async def _plan_memory_cleanup(self, task: str, context: Dict[str, Any]) -> Dict[str, Any]:
        """Plan memory cleanup"""
        return {
            'approach': 'cleanup_memory',
            'cleanup_criteria': context.get('criteria', ['expired', 'low_importance', 'unused']),
            'force_cleanup': context.get('force', False),
            'backup_before_cleanup': True
        }
    
    async def _execute_memory_storage(self, state: AgentState) -> Dict[str, Any]:
        """Execute memory storage"""
        context = state.context
        memory_data = context.get('memory_data', {})
        memory_type = MemoryType(context.get('memory_type', MemoryType.SHORT_TERM.value))
        
        try:
            # Create memory item
            memory_item = MemoryItem(
                memory_id=self._generate_memory_id(memory_data),
                memory_type=memory_type,
                content=memory_data.get('content', ''),
                context=memory_data.get('context', {}),
                importance=0.5  # Will be calculated
            )
            
            # Calculate importance
            if context.get('calculate_importance', True):
                memory_item.importance = await self._calculate_importance(memory_item)
            
            # Extract tags
            if context.get('extract_tags', True):
                memory_item.tags = await self._extract_tags(memory_item)
            
            # Set expiration for short-term memory
            if memory_type == MemoryType.SHORT_TERM:
                memory_item.expires_at = datetime.now() + timedelta(hours=24)
            
            # Store in appropriate memory store
            if memory_type == MemoryType.SHORT_TERM:
                self.short_term_memory[memory_item.memory_id] = memory_item
            elif memory_type == MemoryType.LONG_TERM:
                self.long_term_memory[memory_item.memory_id] = memory_item
                await self._persist_memory(memory_item)
            elif memory_type == MemoryType.EPISODIC:
                self.episodic_memory[memory_item.memory_id] = memory_item
                await self._persist_memory(memory_item)
            elif memory_type == MemoryType.SEMANTIC:
                self.semantic_memory[memory_item.memory_id] = memory_item
                await self._persist_memory(memory_item)
            elif memory_type == MemoryType.PROCEDURAL:
                self.procedural_memory[memory_item.memory_id] = memory_item
                await self._persist_memory(memory_item)
            
            # Manage memory size limits
            await self._manage_memory_limits(memory_type)
            
            return {
                'success': True,
                'result': {
                    'memory_id': memory_item.memory_id,
                    'memory_type': memory_type.value,
                    'importance': memory_item.importance,
                    'tags': memory_item.tags,
                    'expires_at': memory_item.expires_at.isoformat() if memory_item.expires_at else None
                },
                'message': f"Stored memory item with importance {memory_item.importance:.2f}",
                'tools_used': ['memory_storage', 'importance_calculation', 'tag_extraction']
            }
            
        except Exception as e:
            return {
                'success': False,
                'error': f"Memory storage failed: {str(e)}",
                'tools_used': ['memory_storage']
            }
    
    async def _execute_memory_retrieval(self, state: AgentState) -> Dict[str, Any]:
        """Execute memory retrieval"""
        context = state.context
        search_query = context.get('search_query', '')
        memory_types = context.get('memory_types', list(MemoryType))
        max_results = context.get('max_results', 10)
        relevance_threshold = context.get('relevance_threshold', 0.5)
        
        try:
            retrieved_memories = []
            
            # Search across specified memory types
            for memory_type in memory_types:
                if isinstance(memory_type, str):
                    memory_type = MemoryType(memory_type)
                
                memory_store = self._get_memory_store(memory_type)
                
                for memory_item in memory_store.values():
                    # Check expiration
                    if self._is_memory_expired(memory_item):
                        continue
                    
                    # Calculate relevance
                    relevance = await self._calculate_relevance(memory_item, search_query)
                    
                    if relevance >= relevance_threshold:
                        # Update access information
                        memory_item.access_count += 1
                        memory_item.last_accessed = datetime.now()
                        
                        retrieved_memories.append({
                            'memory_item': memory_item,
                            'relevance_score': relevance
                        })
            
            # Sort by relevance and limit results
            retrieved_memories.sort(key=lambda x: x['relevance_score'], reverse=True)
            retrieved_memories = retrieved_memories[:max_results]
            
            # Extract just the memory items for result
            memory_items = [item['memory_item'] for item in retrieved_memories]
            
            # Generate retrieval summary
            summary = await self._generate_retrieval_summary(memory_items, search_query)
            
            return {
                'success': True,
                'result': {
                    'memories': memory_items,
                    'total_found': len(retrieved_memories),
                    'search_query': search_query,
                    'summary': summary,
                    'relevance_scores': [item['relevance_score'] for item in retrieved_memories]
                },
                'message': f"Retrieved {len(memory_items)} relevant memories",
                'tools_used': ['memory_search', 'relevance_calculation', 'summary_generation']
            }
            
        except Exception as e:
            return {
                'success': False,
                'error': f"Memory retrieval failed: {str(e)}",
                'tools_used': ['memory_search']
            }
    
    async def _execute_memory_consolidation(self, state: AgentState) -> Dict[str, Any]:
        """Execute memory consolidation"""
        context = state.context
        consolidation_type = context.get('consolidation_type', 'full')
        time_window_hours = context.get('time_window_hours', 24)
        merge_similar = context.get('merge_similar', True)
        
        try:
            cutoff_time = datetime.now() - timedelta(hours=time_window_hours)
            
            consolidation_results = {
                'promoted_to_long_term': 0,
                'merged_memories': 0,
                'expired_memories': 0,
                'total_processed': 0
            }
            
            # Process short-term memories
            if consolidation_type in ['full', 'short_term']:
                short_term_results = await self._consolidate_short_term_memories(cutoff_time, merge_similar)
                consolidation_results.update(short_term_results)
            
            # Process episodic memories
            if consolidation_type in ['full', 'episodic']:
                episodic_results = await self._consolidate_episodic_memories(cutoff_time, merge_similar)
                consolidation_results['episodic_consolidated'] = episodic_results.get('consolidated', 0)
            
            # Update semantic memories
            if consolidation_type in ['full', 'semantic']:
                semantic_results = await self._update_semantic_memories()
                consolidation_results['semantic_updated'] = semantic_results.get('updated', 0)
            
            # Clean expired memories
            expired_count = await self._remove_expired_memories()
            consolidation_results['expired_memories'] = expired_count
            
            self.last_consolidation = datetime.now()
            
            return {
                'success': True,
                'result': consolidation_results,
                'message': f"Consolidated {consolidation_results['total_processed']} memories",
                'tools_used': ['memory_consolidation', 'memory_promotion', 'memory_merging']
            }
            
        except Exception as e:
            return {
                'success': False,
                'error': f"Memory consolidation failed: {str(e)}",
                'tools_used': ['memory_consolidation']
            }
    
    async def _execute_context_management(self, state: AgentState) -> Dict[str, Any]:
        """Execute context management"""
        context = state.context
        operation = context.get('operation', 'update')
        context_data = context.get('context_data', {})
        agent_id = context.get('agent_id')
        create_snapshot = context.get('create_snapshot', True)
        
        try:
            if operation == 'update':
                # Update current context
                if agent_id:
                    if 'agent_contexts' not in self.current_context:
                        self.current_context['agent_contexts'] = {}
                    self.current_context['agent_contexts'][agent_id] = context_data
                else:
                    self.current_context.update(context_data)
                
                result_message = "Updated context"
                
            elif operation == 'get':
                # Get current context
                if agent_id:
                    context_data = self.current_context.get('agent_contexts', {}).get(agent_id, {})
                else:
                    context_data = self.current_context.copy()
                
                result_message = "Retrieved context"
                
            elif operation == 'clear':
                # Clear context
                if agent_id:
                    if 'agent_contexts' in self.current_context:
                        self.current_context['agent_contexts'].pop(agent_id, None)
                else:
                    self.current_context.clear()
                
                result_message = "Cleared context"
                
            else:
                return {
                    'success': False,
                    'error': f"Unknown context operation: {operation}",
                    'tools_used': ['context_management']
                }
            
            # Create context snapshot if requested
            snapshot_id = None
            if create_snapshot and operation in ['update', 'clear']:
                snapshot_id = await self._create_context_snapshot()
            
            # Update conversation history
            if 'conversation' in context_data:
                self.conversation_history.append({
                    'timestamp': datetime.now().isoformat(),
                    'agent_id': agent_id,
                    'content': context_data['conversation']
                })
                
                # Maintain conversation history size
                if len(self.conversation_history) > self.context_window_size:
                    self.conversation_history = self.conversation_history[-self.context_window_size:]
            
            return {
                'success': True,
                'result': {
                    'operation': operation,
                    'context_data': context_data if operation == 'get' else None,
                    'snapshot_id': snapshot_id,
                    'context_size': len(self.current_context),
                    'conversation_history_size': len(self.conversation_history)
                },
                'message': result_message,
                'tools_used': ['context_management', 'snapshot_creation']
            }
            
        except Exception as e:
            return {
                'success': False,
                'error': f"Context management failed: {str(e)}",
                'tools_used': ['context_management']
            }
    
    async def _execute_pattern_analysis(self, state: AgentState) -> Dict[str, Any]:
        """Execute memory pattern analysis"""
        context = state.context
        analysis_scope = context.get('analysis_scope', 'all')
        pattern_types = context.get('pattern_types', ['temporal', 'semantic', 'behavioral'])
        time_range = context.get('time_range', 'last_week')
        
        try:
            # Define time range
            time_ranges = {
                'last_hour': timedelta(hours=1),
                'last_day': timedelta(days=1),
                'last_week': timedelta(weeks=1),
                'last_month': timedelta(days=30),
                'all_time': timedelta(days=365*10)  # 10 years
            }
            
            cutoff_time = datetime.now() - time_ranges.get(time_range, timedelta(weeks=1))
            
            # Collect memories for analysis
            memories_to_analyze = []
            
            if analysis_scope == 'all':
                for memory_store in [self.short_term_memory, self.long_term_memory, 
                                   self.episodic_memory, self.semantic_memory, self.procedural_memory]:
                    memories_to_analyze.extend([
                        memory for memory in memory_store.values()
                        if memory.created_at >= cutoff_time
                    ])
            else:
                memory_store = self._get_memory_store(MemoryType(analysis_scope))
                memories_to_analyze = [
                    memory for memory in memory_store.values()
                    if memory.created_at >= cutoff_time
                ]
            
            patterns = {}
            
            # Analyze patterns by type
            for pattern_type in pattern_types:
                if pattern_type == 'temporal':
                    patterns['temporal'] = await self._analyze_temporal_patterns(memories_to_analyze)
                elif pattern_type == 'semantic':
                    patterns['semantic'] = await self._analyze_semantic_patterns(memories_to_analyze)
                elif pattern_type == 'behavioral':
                    patterns['behavioral'] = await self._analyze_behavioral_patterns(memories_to_analyze)
            
            # Generate insights
            insights = await self._generate_pattern_insights(patterns)
            
            return {
                'success': True,
                'result': {
                    'patterns': patterns,
                    'insights': insights,
                    'memories_analyzed': len(memories_to_analyze),
                    'time_range': time_range,
                    'analysis_scope': analysis_scope
                },
                'message': f"Analyzed {len(memories_to_analyze)} memories for {len(pattern_types)} pattern types",
                'tools_used': ['pattern_analysis', 'insight_generation']
            }
            
        except Exception as e:
            return {
                'success': False,
                'error': f"Pattern analysis failed: {str(e)}",
                'tools_used': ['pattern_analysis']
            }
    
    async def _execute_memory_cleanup(self, state: AgentState) -> Dict[str, Any]:
        """Execute memory cleanup"""
        context = state.context
        cleanup_criteria = context.get('cleanup_criteria', ['expired', 'low_importance'])
        force_cleanup = context.get('force', False)
        backup_before_cleanup = context.get('backup_before_cleanup', True)
        
        try:
            cleanup_results = {
                'expired_removed': 0,
                'low_importance_removed': 0,
                'unused_removed': 0,
                'total_removed': 0,
                'backup_created': False
            }
            
            # Create backup if requested
            if backup_before_cleanup:
                backup_id = await self._create_memory_backup()
                cleanup_results['backup_created'] = True
                cleanup_results['backup_id'] = backup_id
            
            # Clean by criteria
            for criterion in cleanup_criteria:
                if criterion == 'expired':
                    expired_count = await self._remove_expired_memories()
                    cleanup_results['expired_removed'] = expired_count
                    
                elif criterion == 'low_importance':
                    low_importance_count = await self._remove_low_importance_memories()
                    cleanup_results['low_importance_removed'] = low_importance_count
                    
                elif criterion == 'unused':
                    unused_count = await self._remove_unused_memories()
                    cleanup_results['unused_removed'] = unused_count
            
            cleanup_results['total_removed'] = (
                cleanup_results['expired_removed'] + 
                cleanup_results['low_importance_removed'] + 
                cleanup_results['unused_removed']
            )
            
            # Force cleanup if memory is getting full
            if force_cleanup or self._is_memory_full():
                additional_cleanup = await self._force_memory_cleanup()
                cleanup_results['force_cleanup_removed'] = additional_cleanup
                cleanup_results['total_removed'] += additional_cleanup
            
            return {
                'success': True,
                'result': cleanup_results,
                'message': f"Cleaned up {cleanup_results['total_removed']} memory items",
                'tools_used': ['memory_cleanup', 'memory_backup']
            }
            
        except Exception as e:
            return {
                'success': False,
                'error': f"Memory cleanup failed: {str(e)}",
                'tools_used': ['memory_cleanup']
            }
    
    async def _execute_general_memory(self, state: AgentState) -> Dict[str, Any]:
        """Execute general memory task"""
        task = state.current_task
        
        # Use LLM for general memory advice
        prompt = SystemMessage(content=f"""
        You are a memory management expert. Help with this memory-related task:
        {task}
        
        Consider:
        - Memory types (short-term, long-term, episodic, semantic, procedural)
        - Memory consolidation and organization
        - Context management
        - Information retrieval strategies
        
        Provide specific recommendations.
        """)
        
        try:
            response = await self.llm_manager.agenerate([prompt])
            
            return {
                'success': True,
                'result': {
                    'memory_advice': response.text,
                    'task': task
                },
                'message': "Generated memory management advice",
                'tools_used': ['llm_memory_advice']
            }
            
        except Exception as e:
            return {
                'success': False,
                'error': str(e),
                'tools_used': ['llm_memory_advice']
            }
    
    # Helper methods for memory operations
    def _generate_memory_id(self, memory_data: Dict[str, Any]) -> str:
        """Generate unique memory ID"""
        content_hash = hashlib.md5(str(memory_data).encode()).hexdigest()
        timestamp = datetime.now().isoformat()
        return f"mem_{content_hash[:8]}_{timestamp.replace(':', '').replace('-', '')[:14]}"
    
    def _infer_memory_type(self, task: str, memory_data: Dict[str, Any]) -> str:
        """Infer memory type from task and data"""
        task_lower = task.lower()
        content = memory_data.get('content', '').lower()
        
        if 'procedure' in task_lower or 'how to' in content:
            return MemoryType.PROCEDURAL.value
        elif 'fact' in task_lower or 'concept' in task_lower:
            return MemoryType.SEMANTIC.value
        elif 'event' in task_lower or 'episode' in task_lower:
            return MemoryType.EPISODIC.value
        elif 'long term' in task_lower or 'permanent' in task_lower:
            return MemoryType.LONG_TERM.value
        else:
            return MemoryType.SHORT_TERM.value
    
    def _extract_search_query(self, task: str) -> str:
        """Extract search query from task"""
        import re
        
        # Look for quoted search terms
        quoted_match = re.search(r'"([^"]*)"', task)
        if quoted_match:
            return quoted_match.group(1)
        
        # Look for "find/search/recall" patterns
        patterns = [
            r'find (.+?)(?:\.|$)',
            r'search for (.+?)(?:\.|$)',
            r'recall (.+?)(?:\.|$)',
            r'retrieve (.+?)(?:\.|$)'
        ]
        
        for pattern in patterns:
            match = re.search(pattern, task, re.IGNORECASE)
            if match:
                return match.group(1).strip()
        
        # Fallback: use the whole task
        return task.strip()
    
    def _extract_context_operation(self, task: str) -> str:
        """Extract context operation from task"""
        task_lower = task.lower()
        
        if any(word in task_lower for word in ['update', 'set', 'add']):
            return 'update'
        elif any(word in task_lower for word in ['get', 'retrieve', 'show']):
            return 'get'
        elif any(word in task_lower for word in ['clear', 'reset', 'delete']):
            return 'clear'
        else:
            return 'update'
    
    async def _calculate_importance(self, memory_item: MemoryItem) -> float:
        """Calculate importance score for a memory item"""
        # Base importance factors
        importance = 0.5
        
        # Content-based factors
        content_length = len(memory_item.content)
        if content_length > 500:
            importance += 0.2
        elif content_length < 50:
            importance -= 0.1
        
        # Context-based factors
        if 'user_explicit' in memory_item.context:
            importance += 0.3
        
        if memory_item.context.get('emotion', '') in ['important', 'urgent', 'critical']:
            importance += 0.2
        
        # Type-based factors
        type_importance = {
            MemoryType.PROCEDURAL: 0.8,
            MemoryType.SEMANTIC: 0.7,
            MemoryType.EPISODIC: 0.6,
            MemoryType.LONG_TERM: 0.7,
            MemoryType.SHORT_TERM: 0.4
        }
        importance *= type_importance.get(memory_item.memory_type, 1.0)
        
        return max(0.0, min(1.0, importance))
    
    async def _extract_tags(self, memory_item: MemoryItem) -> List[str]:
        """Extract tags from memory content"""
        tags = []
        content = memory_item.content.lower()
        
        # Common topic tags
        topic_keywords = {
            'technology': ['code', 'programming', 'software', 'tech', 'api'],
            'work': ['project', 'task', 'deadline', 'meeting', 'work'],
            'learning': ['learn', 'study', 'understand', 'knowledge', 'skill'],
            'personal': ['personal', 'family', 'friend', 'hobby', 'life'],
            'problem': ['problem', 'issue', 'error', 'bug', 'fix'],
            'idea': ['idea', 'thought', 'concept', 'brainstorm', 'innovation']
        }
        
        for topic, keywords in topic_keywords.items():
            if any(keyword in content for keyword in keywords):
                tags.append(topic)
        
        # Add memory type as tag
        tags.append(memory_item.memory_type.value)
        
        # Add importance level as tag
        if memory_item.importance > 0.8:
            tags.append('high_importance')
        elif memory_item.importance < 0.3:
            tags.append('low_importance')
        
        return list(set(tags))  # Remove duplicates
    
    def _get_memory_store(self, memory_type: MemoryType) -> Dict[str, MemoryItem]:
        """Get the appropriate memory store for a memory type"""
        store_map = {
            MemoryType.SHORT_TERM: self.short_term_memory,
            MemoryType.LONG_TERM: self.long_term_memory,
            MemoryType.EPISODIC: self.episodic_memory,
            MemoryType.SEMANTIC: self.semantic_memory,
            MemoryType.PROCEDURAL: self.procedural_memory
        }
        return store_map.get(memory_type, self.short_term_memory)
    
    def _is_memory_expired(self, memory_item: MemoryItem) -> bool:
        """Check if memory item has expired"""
        if memory_item.expires_at is None:
            return False
        return datetime.now() > memory_item.expires_at
    
    async def _calculate_relevance(self, memory_item: MemoryItem, query: str) -> float:
        """Calculate relevance of memory item to search query"""
        query_words = set(query.lower().split())
        content_words = set(memory_item.content.lower().split())
        
        # Word overlap relevance
        if not query_words or not content_words:
            word_relevance = 0.0
        else:
            overlap = len(query_words & content_words)
            word_relevance = overlap / len(query_words | content_words)
        
        # Tag relevance
        tag_relevance = 0.0
        for tag in memory_item.tags:
            if any(word in tag.lower() for word in query_words):
                tag_relevance += 0.1
        
        # Recency boost
        days_old = (datetime.now() - memory_item.created_at).days
        recency_relevance = max(0.0, 1.0 - (days_old / 30))  # Decay over 30 days
        
        # Access frequency boost
        frequency_relevance = min(0.2, memory_item.access_count * 0.01)
        
        # Combine relevance factors
        total_relevance = (
            word_relevance * 0.5 + 
            tag_relevance * 0.2 + 
            recency_relevance * 0.2 + 
            frequency_relevance * 0.1
        )
        
        return min(1.0, total_relevance)
    
    async def _persist_memory(self, memory_item: MemoryItem):
        """Persist memory item to database"""
        try:
            self.conn.execute('''
                INSERT OR REPLACE INTO memories 
                (memory_id, memory_type, content, context, importance, access_count, 
                 created_at, last_accessed, expires_at, tags, metadata)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (
                memory_item.memory_id,
                memory_item.memory_type.value,
                memory_item.content,
                json.dumps(memory_item.context),
                memory_item.importance,
                memory_item.access_count,
                memory_item.created_at.isoformat(),
                memory_item.last_accessed.isoformat(),
                memory_item.expires_at.isoformat() if memory_item.expires_at else None,
                json.dumps(memory_item.tags),
                json.dumps(memory_item.metadata)
            ))
            self.conn.commit()
        except Exception as e:
            print(f"Failed to persist memory: {e}")
    
    async def _manage_memory_limits(self, memory_type: MemoryType):
        """Manage memory store size limits"""
        memory_store = self._get_memory_store(memory_type)
        
        limits = {
            MemoryType.SHORT_TERM: self.max_short_term_items,
            MemoryType.LONG_TERM: self.max_long_term_items,
            MemoryType.EPISODIC: 5000,
            MemoryType.SEMANTIC: 3000,
            MemoryType.PROCEDURAL: 2000
        }
        
        limit = limits.get(memory_type, 1000)
        
        if len(memory_store) > limit:
            # Remove least important and oldest memories
            memories_to_remove = sorted(
                memory_store.values(),
                key=lambda m: (m.importance, m.last_accessed)
            )[:len(memory_store) - limit]
            
            for memory in memories_to_remove:
                memory_store.pop(memory.memory_id, None)
    
    async def _create_context_snapshot(self) -> str:
        """Create a snapshot of current context"""
        snapshot = ContextSnapshot(
            snapshot_id=f"snap_{datetime.now().isoformat().replace(':', '').replace('-', '')}",
            timestamp=datetime.now(),
            agent_states=self.current_context.get('agent_contexts', {}),
            shared_context={k: v for k, v in self.current_context.items() if k != 'agent_contexts'},
            active_memories=list(self.short_term_memory.keys())[:20],  # Recent memories
            conversation_history=self.conversation_history[-10:]  # Recent conversation
        )
        
        # Store snapshot in database
        try:
            self.conn.execute('''
                INSERT INTO context_snapshots 
                (snapshot_id, timestamp, agent_states, shared_context, active_memories, conversation_history)
                VALUES (?, ?, ?, ?, ?, ?)
            ''', (
                snapshot.snapshot_id,
                snapshot.timestamp.isoformat(),
                json.dumps(snapshot.agent_states),
                json.dumps(snapshot.shared_context),
                json.dumps(snapshot.active_memories),
                json.dumps(snapshot.conversation_history)
            ))
            self.conn.commit()
            
            # Add to history
            self.context_history.append(snapshot)
            
            # Limit history size
            if len(self.context_history) > 100:
                self.context_history = self.context_history[-100:]
            
            return snapshot.snapshot_id
        except Exception as e:
            print(f"Failed to create context snapshot: {e}")
            return ""
    
    # Additional helper methods for comprehensive functionality
    async def _generate_retrieval_summary(self, memories: List[MemoryItem], query: str) -> str:
        """Generate summary of retrieved memories"""
        if not memories:
            return f"No relevant memories found for: {query}"
        
        memory_types = set(memory.memory_type.value for memory in memories)
        avg_importance = sum(memory.importance for memory in memories) / len(memories)
        
        return f"Found {len(memories)} memories across {len(memory_types)} types (avg importance: {avg_importance:.2f}) for query: {query}"
    
    # Override evaluate progress for memory-specific evaluation
    async def _evaluate_progress(self, state: AgentState) -> Dict[str, Any]:
        """Evaluate progress specific to memory tasks"""
        if state.result is not None:
            result = state.result
            task_type = state.context.get('task_type')
            
            success_indicators = {
                'store_memory': 'memory_id' in result,
                'retrieve_memory': 'memories' in result,
                'consolidate_memory': 'promoted_to_long_term' in result or 'total_processed' in result,
                'manage_context': 'operation' in result,
                'analyze_patterns': 'patterns' in result,
                'cleanup_memory': 'total_removed' in result
            }
            
            if task_type in success_indicators and success_indicators[task_type]:
                return {'complete': True, 'success': True, 'quality': 'effective'}
            
            return {'complete': True, 'success': True}
        
        return await super()._evaluate_progress(state)
    
    # Public interface methods
    async def store_memory(self, content: str, memory_type: str = 'short_term', 
                          context: Dict[str, Any] = None, importance: float = None) -> Dict[str, Any]:
        """Public method to store a memory"""
        memory_data = {
            'content': content,
            'context': context or {},
            'importance': importance
        }
        
        context_data = {
            'memory_data': memory_data,
            'memory_type': memory_type
        }
        
        return await self.execute(f"store memory: {content[:50]}...", context=context_data)
    
    async def retrieve_memories(self, query: str, memory_types: List[str] = None, max_results: int = 10) -> Dict[str, Any]:
        """Public method to retrieve memories"""
        context = {
            'search_query': query,
            'memory_types': memory_types or [mt.value for mt in MemoryType],
            'max_results': max_results
        }
        
        return await self.execute(f"retrieve memories for: {query}", context=context)
    
    async def update_context(self, context_data: Dict[str, Any], agent_id: str = None) -> Dict[str, Any]:
        """Public method to update context"""
        context = {
            'operation': 'update',
            'context_data': context_data,
            'agent_id': agent_id
        }
        
        return await self.execute("update context", context=context)
    
    async def consolidate_memories(self, consolidation_type: str = 'full') -> Dict[str, Any]:
        """Public method to consolidate memories"""
        context = {
            'consolidation_type': consolidation_type
        }
        
        return await self.execute("consolidate memories", context=context)
    
    def get_memory_statistics(self) -> Dict[str, Any]:
        """Get memory system statistics"""
        return {
            'short_term_count': len(self.short_term_memory),
            'long_term_count': len(self.long_term_memory),
            'episodic_count': len(self.episodic_memory),
            'semantic_count': len(self.semantic_memory),
            'procedural_count': len(self.procedural_memory),
            'total_memories': sum([
                len(self.short_term_memory),
                len(self.long_term_memory),
                len(self.episodic_memory),
                len(self.semantic_memory),
                len(self.procedural_memory)
            ]),
            'context_snapshots': len(self.context_history),
            'conversation_history_size': len(self.conversation_history),
            'last_consolidation': self.last_consolidation.isoformat()
        }