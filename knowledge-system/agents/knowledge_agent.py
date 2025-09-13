"""
Knowledge Agent - Specialized agent for knowledge management and retrieval
Uses RAG pipeline for intelligent information retrieval and synthesis
"""

import logging
from typing import Dict, Any, List, Optional
from langchain_core.messages import HumanMessage, AIMessage

from .base_agent import BaseAgent, AgentState
from ..ai_core.rag_pipeline import RAGPipeline

logger = logging.getLogger(__name__)


class KnowledgeAgent(BaseAgent):
    """
    Specialized agent for knowledge management and retrieval
    Focuses on finding, synthesizing, and presenting information
    """
    
    def __init__(self, 
                 name: str,
                 llm_manager: Any,
                 rag_pipeline: RAGPipeline,
                 config: Dict[str, Any]):
        
        # Initialize with knowledge-specific tools
        super().__init__(name, llm_manager, config)
        
        self.rag_pipeline = rag_pipeline
        self.knowledge_config = config
        
        # Knowledge-specific settings
        self.search_strategy = config.get('search_strategy', 'hybrid')
        self.max_sources = config.get('max_sources', 10)
        self.confidence_threshold = config.get('confidence_threshold', 0.6)
        
        logger.info(f"Knowledge Agent initialized with strategy: {self.search_strategy}")
    
    async def _plan_action(self, state: AgentState, context: Dict[str, Any]) -> Dict[str, Any]:
        """Plan knowledge retrieval and synthesis action"""
        
        # Analyze the query/task
        query = state.current_task
        
        # Determine search parameters
        search_params = {
            'strategy': self.search_strategy,
            'max_sources': self.max_sources,
            'filters': context.get('filters'),
            'require_high_confidence': context.get('require_high_confidence', False)
        }
        
        # Plan based on query type
        if self._is_factual_query(query):
            search_params['strategy'] = 'semantic'
            search_params['max_sources'] = min(5, self.max_sources)
        elif self._is_comparison_query(query):
            search_params['strategy'] = 'hybrid'
            search_params['max_sources'] = self.max_sources
        elif self._is_synthesis_query(query):
            search_params['strategy'] = 'hybrid'
            search_params['max_sources'] = max(10, self.max_sources)
        
        return {
            'action': 'knowledge_search',
            'context': {
                'search_params': search_params,
                'query_type': self._classify_query(query)
            },
            'metadata': {
                'iteration': state.iteration,
                'planning_strategy': 'knowledge_focused'
            }
        }
    
    async def _execute_action(self, state: AgentState) -> Dict[str, Any]:
        """Execute knowledge search and synthesis"""
        
        try:
            query = state.current_task
            search_params = state.context.get('search_params', {})
            
            # Execute RAG query
            rag_result = await self.rag_pipeline.query(
                query=query,
                filters=search_params.get('filters'),
                retrieval_strategy=search_params.get('strategy', 'hybrid'),
                max_sources=search_params.get('max_sources', self.max_sources)
            )
            
            # Check confidence threshold
            if rag_result.confidence < self.confidence_threshold:
                if search_params.get('require_high_confidence', False):
                    return {
                        'success': False,
                        'error': f'Confidence {rag_result.confidence:.2f} below threshold {self.confidence_threshold}',
                        'result': None
                    }
                else:
                    # Add uncertainty disclaimer
                    answer = f"Note: I have moderate confidence in this answer.\\n\\n{rag_result.answer}"
                    rag_result.answer = answer
            
            # Enhance answer based on query type
            enhanced_answer = await self._enhance_answer(rag_result, state.context.get('query_type'))
            
            return {
                'success': True,
                'result': {
                    'answer': enhanced_answer,
                    'sources': [source.__dict__ for source in rag_result.sources],
                    'confidence': rag_result.confidence,
                    'context_used': rag_result.context_used,
                    'query_type': state.context.get('query_type')
                },
                'tools_used': ['rag_pipeline', 'knowledge_synthesis'],
                'message': enhanced_answer
            }
            
        except Exception as e:
            logger.error(f"Knowledge search failed: {e}")
            return {
                'success': False,
                'error': str(e),
                'result': None
            }
    
    async def _enhance_answer(self, rag_result: Any, query_type: Optional[str]) -> str:
        """Enhance answer based on query type and available information"""
        
        base_answer = rag_result.answer
        sources_count = len(rag_result.sources)
        
        # Add source information
        if sources_count > 0:
            source_note = f\"\\n\\n*Based on {sources_count} source{'s' if sources_count > 1 else ''}*\"
            base_answer += source_note
        
        # Add confidence indicator
        if rag_result.confidence < 0.7:
            confidence_note = \"\\n\\n*Note: This answer has moderate confidence. Please verify important details.*\"
            base_answer += confidence_note
        elif rag_result.confidence > 0.9:
            confidence_note = \"\\n\\n*High confidence answer based on reliable sources.*\"
            base_answer += confidence_note
        
        # Query-type specific enhancements
        if query_type == 'factual' and rag_result.sources:
            # Add source citations for factual queries
            citation_text = \"\\n\\nSources:\"
            for i, source in enumerate(rag_result.sources[:3], 1):
                source_snippet = source.content[:100] + \"...\" if len(source.content) > 100 else source.content
                citation_text += f\"\\n{i}. {source_snippet}\"
            base_answer += citation_text
            
        elif query_type == 'comparison':
            # Add comparison summary
            if len(rag_result.sources) >= 2:
                base_answer += \"\\n\\n*This comparison is based on multiple sources providing different perspectives.*\"
        
        elif query_type == 'synthesis':
            # Add synthesis note
            if sources_count >= 3:
                base_answer += f\"\\n\\n*This synthesis combines insights from {sources_count} different sources.*\"
        
        return base_answer
    
    def _classify_query(self, query: str) -> str:
        \"\"\"Classify the type of query to optimize response\"\"\"
        query_lower = query.lower()
        
        # Factual queries
        factual_indicators = ['what is', 'who is', 'when did', 'where is', 'how many', 'define']
        if any(indicator in query_lower for indicator in factual_indicators):
            return 'factual'
        
        # Comparison queries
        comparison_indicators = ['compare', 'versus', 'vs', 'difference', 'better', 'best', 'worst']
        if any(indicator in query_lower for indicator in comparison_indicators):
            return 'comparison'
        
        # Synthesis queries
        synthesis_indicators = ['explain', 'analyze', 'summarize', 'overview', 'understand', 'concept']
        if any(indicator in query_lower for indicator in synthesis_indicators):
            return 'synthesis'
        
        # How-to queries
        howto_indicators = ['how to', 'how do i', 'tutorial', 'guide', 'steps']
        if any(indicator in query_lower for indicator in howto_indicators):
            return 'howto'
        
        # Default
        return 'general'
    
    def _is_factual_query(self, query: str) -> bool:
        \"\"\"Check if query is asking for specific facts\"\"\"
        return self._classify_query(query) == 'factual'
    
    def _is_comparison_query(self, query: str) -> bool:
        \"\"\"Check if query is asking for comparisons\"\"\"
        return self._classify_query(query) == 'comparison'
    
    def _is_synthesis_query(self, query: str) -> bool:
        \"\"\"Check if query requires synthesis of multiple sources\"\"\"
        return self._classify_query(query) in ['synthesis', 'general']
    
    async def _evaluate_progress(self, state: AgentState) -> Dict[str, Any]:
        \"\"\"Evaluate knowledge retrieval progress\"\"\"
        
        if state.result is None:
            return {'complete': False}
        
        result_data = state.result
        
        # Check if we have a good answer
        if isinstance(result_data, dict):
            confidence = result_data.get('confidence', 0.0)
            answer = result_data.get('answer', '')
            sources_count = len(result_data.get('sources', []))
            
            # Success criteria
            has_answer = len(answer.strip()) > 0
            sufficient_confidence = confidence >= self.confidence_threshold
            has_sources = sources_count > 0
            
            if has_answer and (sufficient_confidence or has_sources):
                return {
                    'complete': True,
                    'success': True,
                    'metadata': {
                        'final_confidence': confidence,
                        'sources_used': sources_count,
                        'answer_length': len(answer)
                    }
                }
        
        # Check if we should retry with different strategy
        if state.iteration < 2:
            return {
                'complete': False,
                'retry_with_different_strategy': True
            }
        
        # Failed after retries
        return {
            'complete': True,
            'success': False,
            'metadata': {'reason': 'insufficient_results_after_retries'}
        }
    
    async def add_knowledge(self, 
                           content: str, 
                           metadata: Optional[Dict[str, Any]] = None,
                           chunk: bool = True) -> List[str]:
        \"\"\"Add new knowledge to the system\"\"\"
        
        documents = [{
            'content': content,
            'metadata': metadata or {}
        }]
        
        try:
            doc_ids = await self.rag_pipeline.add_documents(
                documents=documents,
                chunk_documents=chunk
            )
            
            logger.info(f\"Added {len(doc_ids)} knowledge chunks\")
            return doc_ids
            
        except Exception as e:
            logger.error(f\"Failed to add knowledge: {e}\")
            raise
    
    async def search_knowledge(self, 
                              query: str,
                              filters: Optional[Dict[str, Any]] = None,
                              max_results: Optional[int] = None) -> Dict[str, Any]:
        \"\"\"Direct knowledge search without full agent workflow\"\"\"
        
        try:
            rag_result = await self.rag_pipeline.query(
                query=query,
                filters=filters,
                max_sources=max_results or self.max_sources
            )
            
            return {
                'answer': rag_result.answer,
                'sources': [source.__dict__ for source in rag_result.sources],
                'confidence': rag_result.confidence,
                'query': query
            }
            
        except Exception as e:
            logger.error(f\"Knowledge search failed: {e}\")
            raise
    
    def get_knowledge_stats(self) -> Dict[str, Any]:
        \"\"\"Get knowledge-specific statistics\"\"\"
        base_stats = self.get_stats()
        
        # Add knowledge-specific metrics
        base_stats.update({
            'search_strategy': self.search_strategy,
            'max_sources': self.max_sources,
            'confidence_threshold': self.confidence_threshold,
            'rag_pipeline_info': self.rag_pipeline.get_pipeline_info() if self.rag_pipeline else None
        })
        
        return base_stats