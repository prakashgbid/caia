"""
Embedding Service - Advanced semantic embeddings with multiple models
Handles sentence-transformers, OpenAI embeddings, and custom models
"""

import asyncio
import logging
import numpy as np
from typing import List, Dict, Any, Optional, Union
from pathlib import Path
import pickle
import hashlib
import torch
from sentence_transformers import SentenceTransformer
from transformers import AutoTokenizer, AutoModel
import openai
from concurrent.futures import ThreadPoolExecutor

logger = logging.getLogger(__name__)


class EmbeddingService:
    """Advanced embedding service with multiple models and caching"""
    
    def __init__(self, config: Dict[str, Any]):
        self.config = config
        self.embedding_config = config.get('embeddings', {})
        self.models = {}
        self.tokenizers = {}
        self.cache_enabled = self.embedding_config.get('cache_embeddings', True)
        self.cache_dir = Path(self.embedding_config.get('cache_directory', './cache/embeddings'))
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.executor = ThreadPoolExecutor(max_workers=4)
        
        self._load_models()
        
    def _load_models(self):
        """Load all configured embedding models"""
        models_config = self.embedding_config.get('models', {})
        
        for model_type, model_name in models_config.items():
            try:
                if model_type == 'code' and 'codebert' in model_name:
                    # Special handling for CodeBERT
                    self._load_codebert(model_name, model_type)
                else:
                    # Standard sentence-transformers models
                    self._load_sentence_transformer(model_name, model_type)
                    
                logger.info(f"Loaded embedding model: {model_type} ({model_name})")
                
            except Exception as e:
                logger.error(f"Failed to load {model_type} model {model_name}: {e}")
    
    def _load_sentence_transformer(self, model_name: str, model_type: str):
        """Load sentence-transformer model"""
        model = SentenceTransformer(model_name)
        self.models[model_type] = {
            'model': model,
            'type': 'sentence_transformer',
            'dimension': model.get_sentence_embedding_dimension(),
            'name': model_name
        }
    
    def _load_codebert(self, model_name: str, model_type: str):
        """Load CodeBERT model"""
        tokenizer = AutoTokenizer.from_pretrained(model_name)
        model = AutoModel.from_pretrained(model_name)
        
        self.models[model_type] = {
            'model': model,
            'tokenizer': tokenizer,
            'type': 'transformer',
            'dimension': model.config.hidden_size,
            'name': model_name
        }
    
    async def embed_text(self, 
                        text: Union[str, List[str]], 
                        model_type: str = 'general',
                        batch_size: Optional[int] = None) -> np.ndarray:
        """
        Generate embeddings for text(s)
        
        Args:
            text: Single text or list of texts
            model_type: Type of model to use (general, code, semantic, etc.)
            batch_size: Batch size for processing (uses config default if None)
            
        Returns:
            numpy array of embeddings
        """
        if model_type not in self.models:
            logger.warning(f"Model type {model_type} not available, using 'general'")
            model_type = 'general'
            
        if model_type not in self.models:
            raise ValueError(f"No embedding models available")
        
        # Handle single text vs list
        texts = [text] if isinstance(text, str) else text
        if not texts:
            return np.array([])
        
        # Check cache first
        cached_embeddings = []
        texts_to_embed = []
        
        if self.cache_enabled:
            for t in texts:
                cached = self._get_cached_embedding(t, model_type)
                if cached is not None:
                    cached_embeddings.append(cached)
                else:
                    texts_to_embed.append(t)
                    cached_embeddings.append(None)
        else:
            texts_to_embed = texts
            cached_embeddings = [None] * len(texts)
        
        # Generate new embeddings
        if texts_to_embed:
            batch_size = batch_size or self.embedding_config.get('batch_size', 32)
            new_embeddings = await self._generate_embeddings(texts_to_embed, model_type, batch_size)
            
            # Cache new embeddings
            if self.cache_enabled:
                for text, embedding in zip(texts_to_embed, new_embeddings):
                    self._cache_embedding(text, embedding, model_type)
        else:
            new_embeddings = []
        
        # Combine cached and new embeddings
        result_embeddings = []
        new_idx = 0
        
        for cached in cached_embeddings:
            if cached is not None:
                result_embeddings.append(cached)
            else:
                result_embeddings.append(new_embeddings[new_idx])
                new_idx += 1
        
        embeddings_array = np.array(result_embeddings)
        
        # Return single embedding if single text input
        if isinstance(text, str):
            return embeddings_array[0]
        
        return embeddings_array
    
    async def _generate_embeddings(self, 
                                 texts: List[str], 
                                 model_type: str, 
                                 batch_size: int) -> List[np.ndarray]:
        """Generate embeddings using specified model"""
        model_info = self.models[model_type]
        
        if model_info['type'] == 'sentence_transformer':
            return await self._embed_sentence_transformer(texts, model_info, batch_size)
        elif model_info['type'] == 'transformer':
            return await self._embed_transformer(texts, model_info, batch_size)
        else:
            raise ValueError(f"Unknown model type: {model_info['type']}")
    
    async def _embed_sentence_transformer(self, 
                                        texts: List[str], 
                                        model_info: Dict[str, Any], 
                                        batch_size: int) -> List[np.ndarray]:
        """Generate embeddings using sentence-transformer"""
        model = model_info['model']
        
        # Run in thread pool to avoid blocking
        loop = asyncio.get_event_loop()
        embeddings = await loop.run_in_executor(
            self.executor,
            lambda: model.encode(texts, batch_size=batch_size, show_progress_bar=False)
        )
        
        return [emb for emb in embeddings]
    
    async def _embed_transformer(self, 
                               texts: List[str], 
                               model_info: Dict[str, Any], 
                               batch_size: int) -> List[np.ndarray]:
        """Generate embeddings using transformer model"""
        model = model_info['model']
        tokenizer = model_info['tokenizer']
        
        embeddings = []
        
        for i in range(0, len(texts), batch_size):
            batch_texts = texts[i:i + batch_size]
            
            # Tokenize
            inputs = tokenizer(batch_texts, 
                             return_tensors='pt', 
                             padding=True, 
                             truncation=True, 
                             max_length=512)
            
            # Generate embeddings
            with torch.no_grad():
                outputs = model(**inputs)
                # Use mean pooling of last hidden states
                embeddings_batch = outputs.last_hidden_state.mean(dim=1)
            
            embeddings.extend(embeddings_batch.numpy())
        
        return embeddings
    
    def _get_cache_key(self, text: str, model_type: str) -> str:
        """Generate cache key for text and model type"""
        content = f"{text}:{model_type}:{self.models[model_type]['name']}"
        return hashlib.md5(content.encode()).hexdigest()
    
    def _get_cached_embedding(self, text: str, model_type: str) -> Optional[np.ndarray]:
        """Retrieve cached embedding"""
        try:
            cache_key = self._get_cache_key(text, model_type)
            cache_file = self.cache_dir / f"{cache_key}.pkl"
            
            if cache_file.exists():
                with open(cache_file, 'rb') as f:
                    return pickle.load(f)
        except Exception as e:
            logger.warning(f"Failed to load cached embedding: {e}")
        
        return None
    
    def _cache_embedding(self, text: str, embedding: np.ndarray, model_type: str):
        """Cache embedding to disk"""
        try:
            cache_key = self._get_cache_key(text, model_type)
            cache_file = self.cache_dir / f"{cache_key}.pkl"
            
            with open(cache_file, 'wb') as f:
                pickle.dump(embedding, f)
        except Exception as e:
            logger.warning(f"Failed to cache embedding: {e}")
    
    async def embed_documents(self, documents: List[Dict[str, Any]], 
                            text_field: str = 'content',
                            model_type: str = 'general') -> List[Dict[str, Any]]:
        """
        Embed documents and add embeddings to document metadata
        
        Args:
            documents: List of documents with text content
            text_field: Field name containing text to embed
            model_type: Type of embedding model to use
            
        Returns:
            Documents with added 'embedding' field
        """
        texts = [doc.get(text_field, '') for doc in documents]
        embeddings = await self.embed_text(texts, model_type)
        
        # Add embeddings to documents
        for doc, embedding in zip(documents, embeddings):
            doc['embedding'] = embedding
            doc['embedding_model'] = self.models[model_type]['name']
            doc['embedding_dimension'] = self.models[model_type]['dimension']
        
        return documents
    
    def get_similarity(self, 
                      embedding1: np.ndarray, 
                      embedding2: np.ndarray, 
                      metric: str = 'cosine') -> float:
        """
        Calculate similarity between two embeddings
        
        Args:
            embedding1, embedding2: Embeddings to compare
            metric: Similarity metric ('cosine', 'euclidean', 'dot')
            
        Returns:
            Similarity score
        """
        if metric == 'cosine':
            norm1 = np.linalg.norm(embedding1)
            norm2 = np.linalg.norm(embedding2)
            if norm1 == 0 or norm2 == 0:
                return 0.0
            return np.dot(embedding1, embedding2) / (norm1 * norm2)
        
        elif metric == 'dot':
            return np.dot(embedding1, embedding2)
        
        elif metric == 'euclidean':
            return 1.0 / (1.0 + np.linalg.norm(embedding1 - embedding2))
        
        else:
            raise ValueError(f"Unknown similarity metric: {metric}")
    
    def find_most_similar(self, 
                         query_embedding: np.ndarray,
                         candidate_embeddings: List[np.ndarray],
                         top_k: int = 5,
                         metric: str = 'cosine') -> List[tuple]:
        """
        Find most similar embeddings
        
        Args:
            query_embedding: Query embedding
            candidate_embeddings: List of candidate embeddings
            top_k: Number of top results to return
            metric: Similarity metric
            
        Returns:
            List of (index, similarity_score) tuples
        """
        similarities = []
        
        for i, candidate in enumerate(candidate_embeddings):
            similarity = self.get_similarity(query_embedding, candidate, metric)
            similarities.append((i, similarity))
        
        # Sort by similarity (descending) and return top-k
        similarities.sort(key=lambda x: x[1], reverse=True)
        return similarities[:top_k]
    
    def get_model_info(self) -> Dict[str, Any]:
        """Get information about loaded models"""
        info = {}
        for model_type, model_info in self.models.items():
            info[model_type] = {
                'name': model_info['name'],
                'dimension': model_info['dimension'],
                'type': model_info['type']
            }
        return info
    
    def clear_cache(self, model_type: Optional[str] = None):
        """Clear embedding cache"""
        try:
            if model_type:
                # Clear cache for specific model
                pattern = f"*{model_type}*"
                for cache_file in self.cache_dir.glob(pattern):
                    cache_file.unlink()
            else:
                # Clear all cache
                for cache_file in self.cache_dir.glob("*.pkl"):
                    cache_file.unlink()
            
            logger.info(f"Cleared embedding cache for {model_type or 'all models'}")
        except Exception as e:
            logger.error(f"Failed to clear cache: {e}")
    
    async def health_check(self) -> Dict[str, bool]:
        """Check health of embedding service"""
        health = {}
        
        for model_type in self.models:
            try:
                # Test embedding generation
                test_embedding = await self.embed_text("test", model_type)
                health[model_type] = test_embedding is not None and len(test_embedding) > 0
            except Exception as e:
                health[model_type] = False
                logger.error(f"Health check failed for {model_type}: {e}")
        
        return health