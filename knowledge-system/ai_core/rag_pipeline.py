"""
RAG Pipeline - Advanced Retrieval Augmented Generation
Combines semantic search, reranking, and intelligent context management
"""

import asyncio
import logging
import re
from typing import List, Dict, Any, Optional, Tuple, Union
import numpy as np
from dataclasses import dataclass
from sentence_transformers import CrossEncoder
from langchain.text_splitter import RecursiveCharacterTextSplitter, Language
from langchain_core.messages import HumanMessage, AIMessage

from .llm_manager import LLMManager
from .embedding_service import EmbeddingService
from .vector_store import VectorStoreManager

logger = logging.getLogger(__name__)


@dataclass
class RetrievalResult:
    content: str
    metadata: Dict[str, Any]
    score: float
    source: str
    rank: int


@dataclass
class RAGResponse:
    answer: str
    sources: List[RetrievalResult]
    query: str
    context_used: str
    confidence: float
    metadata: Dict[str, Any]


class RAGPipeline:
    """Advanced RAG pipeline with hybrid search and reranking"""
    
    def __init__(self, 
                 llm_manager: LLMManager,
                 embedding_service: EmbeddingService,
                 vector_store: VectorStoreManager,
                 config: Dict[str, Any]):
        
        self.llm_manager = llm_manager
        self.embedding_service = embedding_service
        self.vector_store = vector_store
        self.config = config
        self.rag_config = config.get('rag', {})
        
        # Retrieval settings
        self.retrieval_config = self.rag_config.get('retrieval', {})
        self.top_k = self.retrieval_config.get('top_k', 10)
        self.similarity_threshold = self.retrieval_config.get('similarity_threshold', 0.7)
        self.retrieval_strategy = self.retrieval_config.get('retrieval_strategy', 'hybrid')
        self.rerank_enabled = self.retrieval_config.get('rerank', True)
        
        # Generation settings
        self.generation_config = self.rag_config.get('generation', {})
        self.max_context_length = self.generation_config.get('max_context_length', 8192)
        self.overlap_tokens = self.generation_config.get('overlap_tokens', 200)
        self.temperature = self.generation_config.get('temperature', 0.7)
        
        # Text splitter for chunking
        self.text_splitter = RecursiveCharacterTextSplitter(
            chunk_size=self.generation_config.get('chunk_size', 1000),
            chunk_overlap=self.overlap_tokens,
            length_function=len,
            separators=[\"\\n\\n\", \"\\n\", \" \", \"\"]
        )
        
        # Initialize reranker if enabled
        self.reranker = None
        if self.rerank_enabled:
            try:
                rerank_model = self.retrieval_config.get('rerank_model', 'cross-encoder/ms-marco-MiniLM-L-6-v2')
                self.reranker = CrossEncoder(rerank_model)
                logger.info(f"Initialized reranker: {rerank_model}")
            except Exception as e:
                logger.error(f"Failed to load reranker: {e}")
                self.rerank_enabled = False
    
    async def query(self, 
                   query: str, 
                   filters: Optional[Dict[str, Any]] = None,
                   retrieval_strategy: Optional[str] = None,
                   max_sources: Optional[int] = None) -> RAGResponse:
        """
        Execute RAG query with retrieval and generation
        
        Args:
            query: User query
            filters: Metadata filters for retrieval
            retrieval_strategy: Override default retrieval strategy
            max_sources: Maximum number of sources to use
            
        Returns:
            RAG response with answer and sources
        """
        strategy = retrieval_strategy or self.retrieval_strategy
        max_sources = max_sources or self.top_k
        
        logger.info(f"Processing RAG query: {query[:100]}...")
        
        # Step 1: Retrieve relevant documents
        retrieval_results = await self._retrieve_documents(query, filters, strategy, max_sources)
        
        # Step 2: Rerank if enabled
        if self.rerank_enabled and self.reranker:
            retrieval_results = await self._rerank_documents(query, retrieval_results)
        
        # Step 3: Filter by similarity threshold
        filtered_results = [
            result for result in retrieval_results 
            if result.score >= self.similarity_threshold
        ]
        
        if not filtered_results:
            logger.warning(f"No documents found above similarity threshold {self.similarity_threshold}")
            return RAGResponse(
                answer=\"I don't have enough relevant information to answer your question.\",
                sources=[],
                query=query,
                context_used=\"\",
                confidence=0.0,
                metadata={'strategy': strategy, 'total_sources': 0}
            )
        
        # Step 4: Build context
        context, sources_used = self._build_context(filtered_results)
        
        # Step 5: Generate response
        answer = await self._generate_response(query, context)
        
        # Step 6: Calculate confidence score
        confidence = self._calculate_confidence(retrieval_results, answer)
        
        return RAGResponse(
            answer=answer,
            sources=sources_used,
            query=query,
            context_used=context,
            confidence=confidence,
            metadata={
                'strategy': strategy,
                'total_sources': len(sources_used),
                'context_length': len(context)
            }
        )
    
    async def _retrieve_documents(self, 
                                query: str, 
                                filters: Optional[Dict[str, Any]], 
                                strategy: str,
                                max_sources: int) -> List[RetrievalResult]:
        """Retrieve documents using specified strategy"""
        
        if strategy == 'semantic':
            return await self._semantic_search(query, filters, max_sources)
        elif strategy == 'keyword':
            return await self._keyword_search(query, filters, max_sources)
        elif strategy == 'hybrid':
            return await self._hybrid_search(query, filters, max_sources)
        else:
            raise ValueError(f\"Unknown retrieval strategy: {strategy}\")
    
    async def _semantic_search(self, 
                             query: str, 
                             filters: Optional[Dict[str, Any]], 
                             max_sources: int) -> List[RetrievalResult]:
        \"\"\"Semantic search using embeddings\"\"\"
        # Generate query embedding
        query_embedding = await self.embedding_service.embed_text(query, model_type='general')
        
        # Search vector store
        search_results = await self.vector_store.search(
            query_embedding=query_embedding,
            top_k=max_sources,
            filters=filters
        )
        
        # Convert to RetrievalResult objects
        results = []
        for i, result in enumerate(search_results):
            results.append(RetrievalResult(
                content=result['content'],
                metadata=result['metadata'],
                score=result['score'],
                source=result.get('id', f'doc_{i}'),
                rank=i
            ))
        
        return results
    
    async def _keyword_search(self, 
                            query: str, 
                            filters: Optional[Dict[str, Any]], 
                            max_sources: int) -> List[RetrievalResult]:
        \"\"\"Keyword-based search (simplified implementation)\"\"\"
        # For now, fall back to semantic search
        # In a full implementation, this would use BM25 or similar
        logger.warning(\"Keyword search not implemented, falling back to semantic search\")
        return await self._semantic_search(query, filters, max_sources)
    
    async def _hybrid_search(self, 
                           query: str, 
                           filters: Optional[Dict[str, Any]], 
                           max_sources: int) -> List[RetrievalResult]:
        \"\"\"Hybrid search combining semantic and keyword approaches\"\"\"
        # Get semantic results
        semantic_results = await self._semantic_search(query, filters, max_sources)
        
        # For now, just return semantic results
        # In a full implementation, this would combine with keyword search and merge results
        return semantic_results
    
    async def _rerank_documents(self, 
                              query: str, 
                              results: List[RetrievalResult]) -> List[RetrievalResult]:
        \"\"\"Rerank documents using cross-encoder\"\"\"
        if not results or not self.reranker:
            return results
        
        try:
            # Prepare query-document pairs
            query_doc_pairs = [[query, result.content] for result in results]
            
            # Get reranking scores
            rerank_scores = self.reranker.predict(query_doc_pairs)
            
            # Update scores and re-sort
            for result, score in zip(results, rerank_scores):
                result.score = float(score)
            
            # Sort by new scores
            results.sort(key=lambda x: x.score, reverse=True)
            
            # Update ranks
            for i, result in enumerate(results):
                result.rank = i
            
            logger.info(f\"Reranked {len(results)} documents\")
            
        except Exception as e:
            logger.error(f\"Reranking failed: {e}\")
        
        return results
    
    def _build_context(self, 
                      results: List[RetrievalResult]) -> Tuple[str, List[RetrievalResult]]:
        \"\"\"Build context string from retrieval results\"\"\"
        context_parts = []
        sources_used = []
        current_length = 0
        
        for result in results:
            # Estimate token count (rough approximation: 1 token ≈ 4 characters)
            estimated_tokens = len(result.content) // 4
            
            if current_length + estimated_tokens > self.max_context_length:
                break
            
            # Format context entry
            context_entry = f\"Source {len(sources_used) + 1}:\\n{result.content}\\n\"
            context_parts.append(context_entry)
            sources_used.append(result)
            current_length += estimated_tokens
        
        context = \"\\n\".join(context_parts)
        
        logger.info(f\"Built context with {len(sources_used)} sources, ~{current_length} tokens\")
        
        return context, sources_used
    
    async def _generate_response(self, query: str, context: str) -> str:
        \"\"\"Generate response using LLM\"\"\"
        # Build prompt
        prompt = self._build_prompt(query, context)
        
        # Generate response
        try:
            response = await self.llm_manager.generate(
                prompt=prompt,
                temperature=self.temperature,
                max_tokens=self.generation_config.get('max_tokens', 2000)
            )
            
            if response:
                return response.strip()
            else:
                return \"I apologize, but I'm unable to generate a response at the moment.\"
                
        except Exception as e:
            logger.error(f\"Response generation failed: {e}\")
            return \"I apologize, but I encountered an error while generating the response.\"
    
    def _build_prompt(self, query: str, context: str) -> str:
        \"\"\"Build prompt for LLM generation\"\"\"
        prompt_template = \"\"\"You are a knowledgeable AI assistant. Answer the question based on the provided context. Be accurate, helpful, and cite your sources when possible.

Context:
{context}

Question: {query}

Instructions:
- Provide a clear, comprehensive answer based on the context
- If the context doesn't contain enough information, say so
- Cite relevant sources when making specific claims
- Be concise but thorough

Answer:\"\"\"
        
        return prompt_template.format(context=context, query=query)
    
    def _calculate_confidence(self, 
                            retrieval_results: List[RetrievalResult], 
                            answer: str) -> float:
        \"\"\"Calculate confidence score for the response\"\"\"
        if not retrieval_results:
            return 0.0
        
        # Base confidence on average retrieval scores
        avg_score = sum(result.score for result in retrieval_results) / len(retrieval_results)
        
        # Adjust based on number of sources
        source_factor = min(len(retrieval_results) / self.top_k, 1.0)
        
        # Adjust based on answer length (very short answers might indicate uncertainty)
        length_factor = min(len(answer) / 100, 1.0) if len(answer) < 100 else 1.0
        
        confidence = avg_score * 0.6 + source_factor * 0.2 + length_factor * 0.2
        
        return max(0.0, min(1.0, confidence))
    
    async def add_documents(self, 
                          documents: List[Dict[str, Any]], 
                          chunk_documents: bool = True,
                          embedding_model: str = 'general') -> List[str]:
        \"\"\"
        Add documents to the knowledge base
        
        Args:
            documents: List of documents with content and metadata
            chunk_documents: Whether to split documents into chunks
            embedding_model: Embedding model to use
            
        Returns:
            List of document IDs
        \"\"\"
        processed_docs = []
        
        for doc in documents:
            content = doc.get('content', '')
            metadata = doc.get('metadata', {})
            
            if chunk_documents and len(content) > self.generation_config.get('chunk_size', 1000):
                # Split into chunks
                chunks = self.text_splitter.split_text(content)
                
                for i, chunk in enumerate(chunks):
                    chunk_metadata = metadata.copy()
                    chunk_metadata.update({
                        'chunk_index': i,
                        'total_chunks': len(chunks),
                        'original_doc_id': doc.get('id', 'unknown')
                    })
                    
                    processed_docs.append({
                        'content': chunk,
                        'metadata': chunk_metadata,
                        'id': f\"{doc.get('id', 'doc')}_{i}\"
                    })
            else:
                processed_docs.append(doc)
        
        # Generate embeddings
        texts = [doc['content'] for doc in processed_docs]
        embeddings = await self.embedding_service.embed_text(texts, model_type=embedding_model)
        
        # Add to vector store
        doc_ids = await self.vector_store.add_documents(processed_docs, embeddings)
        
        logger.info(f\"Added {len(doc_ids)} documents to knowledge base\")
        
        return doc_ids
    
    async def get_document_sources(self, doc_ids: List[str]) -> List[Dict[str, Any]]:
        \"\"\"Get source documents by IDs\"\"\"
        sources = []
        
        for doc_id in doc_ids:
            doc = await self.vector_store.get_document(doc_id)
            if doc:
                sources.append(doc)
        
        return sources
    
    async def health_check(self) -> Dict[str, bool]:
        \"\"\"Check health of RAG pipeline components\"\"\"
        health = {}
        
        # Check LLM manager
        try:
            llm_health = await self.llm_manager.health_check()
            health['llm'] = any(llm_health.values())
        except Exception as e:
            health['llm'] = False
            logger.error(f\"LLM health check failed: {e}\")
        
        # Check embedding service
        try:
            embedding_health = await self.embedding_service.health_check()
            health['embeddings'] = any(embedding_health.values())
        except Exception as e:
            health['embeddings'] = False
            logger.error(f\"Embedding health check failed: {e}\")
        
        # Check vector store
        try:
            vector_health = await self.vector_store.health_check()
            health['vector_store'] = any(vector_health.values())
        except Exception as e:
            health['vector_store'] = False
            logger.error(f\"Vector store health check failed: {e}\")
        
        # Check reranker
        health['reranker'] = self.reranker is not None
        
        return health
    
    def get_pipeline_info(self) -> Dict[str, Any]:
        \"\"\"Get information about the RAG pipeline\"\"\"
        return {
            'retrieval_strategy': self.retrieval_strategy,
            'top_k': self.top_k,
            'similarity_threshold': self.similarity_threshold,
            'rerank_enabled': self.rerank_enabled,
            'max_context_length': self.max_context_length,
            'chunk_size': self.generation_config.get('chunk_size', 1000),
            'temperature': self.temperature,
            'llm_info': self.llm_manager.get_available_models(),
            'embedding_info': self.embedding_service.get_model_info(),
            'vector_store_info': self.vector_store.get_store_info()
        }