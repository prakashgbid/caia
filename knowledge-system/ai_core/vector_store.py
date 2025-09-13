"""
Vector Store Manager - Multi-backend vector database management
Supports ChromaDB, Qdrant, FAISS with automatic failover
"""

import asyncio
import logging
import numpy as np
from typing import List, Dict, Any, Optional, Union, Tuple
from pathlib import Path
import uuid
import json
from datetime import datetime

# Vector database imports
import chromadb
from chromadb.config import Settings
try:
    from qdrant_client import QdrantClient
    from qdrant_client.http import models
    QDRANT_AVAILABLE = True
except ImportError:
    QDRANT_AVAILABLE = False

try:
    import faiss
    FAISS_AVAILABLE = True
except ImportError:
    FAISS_AVAILABLE = False

logger = logging.getLogger(__name__)


class VectorStoreManager:
    """Advanced vector store manager with multiple backends"""
    
    def __init__(self, config: Dict[str, Any]):
        self.config = config
        self.vector_config = config.get('vector_db', {})
        self.stores = {}
        self.active_store = None
        self.default_provider = self.vector_config.get('default_provider', 'chroma')
        
        self._initialize_stores()
    
    def _initialize_stores(self):
        """Initialize all configured vector stores"""
        providers = self.vector_config.get('providers', {})
        
        # Initialize ChromaDB
        if 'chroma' in providers:
            try:
                self._init_chroma(providers['chroma'])
                logger.info("ChromaDB initialized successfully")
            except Exception as e:
                logger.error(f"Failed to initialize ChromaDB: {e}")
        
        # Initialize Qdrant
        if 'qdrant' in providers and QDRANT_AVAILABLE:
            try:
                self._init_qdrant(providers['qdrant'])
                logger.info("Qdrant initialized successfully")
            except Exception as e:
                logger.error(f"Failed to initialize Qdrant: {e}")
        
        # Initialize FAISS
        if 'faiss' in providers and FAISS_AVAILABLE:
            try:
                self._init_faiss(providers['faiss'])
                logger.info("FAISS initialized successfully")
            except Exception as e:
                logger.error(f"Failed to initialize FAISS: {e}")
        
        # Set active store
        if self.default_provider in self.stores:
            self.active_store = self.default_provider
        elif self.stores:
            self.active_store = list(self.stores.keys())[0]
        else:
            raise RuntimeError("No vector stores could be initialized")
    
    def _init_chroma(self, config: Dict[str, Any]):
        """Initialize ChromaDB"""
        persist_directory = config.get('persist_directory', './data/chroma_db')
        Path(persist_directory).mkdir(parents=True, exist_ok=True)
        
        client = chromadb.PersistentClient(
            path=persist_directory,
            settings=Settings(
                allow_reset=True,
                anonymized_telemetry=False
            )
        )
        
        collection_name = config.get('collection_name', 'caia_knowledge')
        distance_metric = config.get('distance_metric', 'cosine')
        
        # Create or get collection
        try:
            collection = client.get_collection(collection_name)
        except Exception:
            collection = client.create_collection(
                name=collection_name,
                metadata={"hnsw:space": distance_metric}
            )
        
        self.stores['chroma'] = {
            'client': client,
            'collection': collection,
            'type': 'chroma',
            'config': config
        }
    
    def _init_qdrant(self, config: Dict[str, Any]):
        """Initialize Qdrant"""
        host = config.get('host', 'localhost')
        port = config.get('port', 6333)
        
        client = QdrantClient(host=host, port=port)
        
        collection_name = config.get('collection_name', 'caia_vectors')
        vector_size = config.get('vector_size', 384)
        distance = config.get('distance', 'Cosine')
        
        # Create collection if it doesn't exist
        try:
            collections = client.get_collections()
            collection_exists = any(c.name == collection_name for c in collections.collections)
            
            if not collection_exists:
                client.create_collection(
                    collection_name=collection_name,
                    vectors_config=models.VectorParams(
                        size=vector_size,
                        distance=models.Distance.COSINE if distance == 'Cosine' else models.Distance.EUCLIDEAN
                    )
                )
        except Exception as e:
            logger.warning(f"Could not create Qdrant collection: {e}")
        
        self.stores['qdrant'] = {
            'client': client,
            'collection_name': collection_name,
            'type': 'qdrant',
            'config': config
        }
    
    def _init_faiss(self, config: Dict[str, Any]):
        """Initialize FAISS"""
        index_path = Path(config.get('index_path', './data/faiss_index'))
        index_path.mkdir(parents=True, exist_ok=True)
        
        dimension = config.get('dimension', 384)
        index_type = config.get('index_type', 'IndexFlatIP')
        
        # Create or load index
        index_file = index_path / 'index.faiss'
        metadata_file = index_path / 'metadata.json'
        
        if index_file.exists():
            index = faiss.read_index(str(index_file))
            with open(metadata_file, 'r') as f:
                metadata = json.load(f)
        else:
            if index_type == 'IndexFlatIP':
                index = faiss.IndexFlatIP(dimension)
            else:
                index = faiss.IndexFlatL2(dimension)
            metadata = {'ids': [], 'documents': []}
        
        self.stores['faiss'] = {
            'index': index,
            'index_path': index_file,
            'metadata_path': metadata_file,
            'metadata': metadata,
            'type': 'faiss',
            'config': config
        }
    
    async def add_documents(self, 
                          documents: List[Dict[str, Any]], 
                          embeddings: Optional[List[np.ndarray]] = None,
                          store_type: Optional[str] = None) -> List[str]:
        """
        Add documents to vector store
        
        Args:
            documents: List of documents with content and metadata
            embeddings: Pre-computed embeddings (optional)
            store_type: Specific store to use (optional)
            
        Returns:
            List of document IDs
        """
        store_type = store_type or self.active_store
        
        if store_type not in self.stores:
            raise ValueError(f"Store type {store_type} not available")
        
        store = self.stores[store_type]
        
        if store['type'] == 'chroma':
            return await self._add_to_chroma(documents, embeddings, store)
        elif store['type'] == 'qdrant':
            return await self._add_to_qdrant(documents, embeddings, store)
        elif store['type'] == 'faiss':
            return await self._add_to_faiss(documents, embeddings, store)
        else:
            raise ValueError(f"Unknown store type: {store['type']}")
    
    async def _add_to_chroma(self, 
                           documents: List[Dict[str, Any]], 
                           embeddings: Optional[List[np.ndarray]], 
                           store: Dict[str, Any]) -> List[str]:
        """Add documents to ChromaDB"""
        collection = store['collection']
        
        # Prepare data
        ids = [doc.get('id', str(uuid.uuid4())) for doc in documents]
        texts = [doc.get('content', '') for doc in documents]
        metadatas = [doc.get('metadata', {}) for doc in documents]
        
        # Ensure metadata is JSON serializable
        for metadata in metadatas:
            for key, value in metadata.items():
                if isinstance(value, (datetime, np.ndarray)):
                    metadata[key] = str(value)
        
        # Add to collection
        if embeddings is not None:
            embeddings_list = [emb.tolist() if isinstance(emb, np.ndarray) else emb for emb in embeddings]
            collection.add(
                ids=ids,
                documents=texts,
                metadatas=metadatas,
                embeddings=embeddings_list
            )
        else:
            collection.add(
                ids=ids,
                documents=texts,
                metadatas=metadatas
            )
        
        return ids
    
    async def _add_to_qdrant(self, 
                           documents: List[Dict[str, Any]], 
                           embeddings: Optional[List[np.ndarray]], 
                           store: Dict[str, Any]) -> List[str]:
        """Add documents to Qdrant"""
        client = store['client']
        collection_name = store['collection_name']
        
        points = []
        ids = []
        
        for i, doc in enumerate(documents):
            doc_id = doc.get('id', str(uuid.uuid4()))
            ids.append(doc_id)
            
            payload = {
                'content': doc.get('content', ''),
                'metadata': doc.get('metadata', {})
            }
            
            vector = embeddings[i].tolist() if embeddings and i < len(embeddings) else None
            
            points.append(models.PointStruct(
                id=doc_id,
                vector=vector,
                payload=payload
            ))
        
        client.upsert(
            collection_name=collection_name,
            points=points
        )
        
        return ids
    
    async def _add_to_faiss(self, 
                          documents: List[Dict[str, Any]], 
                          embeddings: Optional[List[np.ndarray]], 
                          store: Dict[str, Any]) -> List[str]:
        """Add documents to FAISS"""
        if embeddings is None:
            raise ValueError("FAISS requires pre-computed embeddings")
        
        index = store['index']
        metadata = store['metadata']
        
        # Convert embeddings to numpy array
        embeddings_array = np.array([emb for emb in embeddings]).astype('float32')
        
        # Add vectors to index
        index.add(embeddings_array)
        
        # Add metadata
        ids = []
        for doc in documents:
            doc_id = doc.get('id', str(uuid.uuid4()))
            ids.append(doc_id)
            metadata['ids'].append(doc_id)
            metadata['documents'].append({
                'content': doc.get('content', ''),
                'metadata': doc.get('metadata', {})
            })
        
        # Save index and metadata
        faiss.write_index(index, str(store['index_path']))
        with open(store['metadata_path'], 'w') as f:
            json.dump(metadata, f)
        
        return ids
    
    async def search(self, 
                    query_embedding: np.ndarray,
                    top_k: int = 10,
                    filters: Optional[Dict[str, Any]] = None,
                    store_type: Optional[str] = None) -> List[Dict[str, Any]]:
        """
        Search vector store
        
        Args:
            query_embedding: Query vector
            top_k: Number of results to return
            filters: Metadata filters (optional)
            store_type: Specific store to use (optional)
            
        Returns:
            List of search results with content, metadata, and scores
        """
        store_type = store_type or self.active_store
        
        if store_type not in self.stores:
            raise ValueError(f"Store type {store_type} not available")
        
        store = self.stores[store_type]
        
        if store['type'] == 'chroma':
            return await self._search_chroma(query_embedding, top_k, filters, store)
        elif store['type'] == 'qdrant':
            return await self._search_qdrant(query_embedding, top_k, filters, store)
        elif store['type'] == 'faiss':
            return await self._search_faiss(query_embedding, top_k, filters, store)
        else:
            raise ValueError(f"Unknown store type: {store['type']}")
    
    async def _search_chroma(self, 
                           query_embedding: np.ndarray, 
                           top_k: int, 
                           filters: Optional[Dict[str, Any]], 
                           store: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Search ChromaDB"""
        collection = store['collection']
        
        query_embeddings = [query_embedding.tolist()]
        
        results = collection.query(
            query_embeddings=query_embeddings,
            n_results=top_k,
            where=filters
        )
        
        search_results = []
        for i in range(len(results['ids'][0])):
            search_results.append({
                'id': results['ids'][0][i],
                'content': results['documents'][0][i] if results['documents'] else '',
                'metadata': results['metadatas'][0][i] if results['metadatas'] else {},
                'score': results['distances'][0][i] if results['distances'] else 0.0
            })
        
        return search_results
    
    async def _search_qdrant(self, 
                           query_embedding: np.ndarray, 
                           top_k: int, 
                           filters: Optional[Dict[str, Any]], 
                           store: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Search Qdrant"""
        client = store['client']
        collection_name = store['collection_name']
        
        search_result = client.search(
            collection_name=collection_name,
            query_vector=query_embedding.tolist(),
            limit=top_k,
            query_filter=models.Filter(**filters) if filters else None
        )
        
        search_results = []
        for point in search_result:
            search_results.append({
                'id': point.id,
                'content': point.payload.get('content', ''),
                'metadata': point.payload.get('metadata', {}),
                'score': point.score
            })
        
        return search_results
    
    async def _search_faiss(self, 
                          query_embedding: np.ndarray, 
                          top_k: int, 
                          filters: Optional[Dict[str, Any]], 
                          store: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Search FAISS"""
        index = store['index']
        metadata = store['metadata']
        
        query_vector = query_embedding.reshape(1, -1).astype('float32')
        scores, indices = index.search(query_vector, top_k)
        
        search_results = []
        for i, (score, idx) in enumerate(zip(scores[0], indices[0])):
            if idx < len(metadata['documents']):
                doc = metadata['documents'][idx]
                search_results.append({
                    'id': metadata['ids'][idx],
                    'content': doc.get('content', ''),
                    'metadata': doc.get('metadata', {}),
                    'score': float(score)
                })
        
        return search_results
    
    async def get_document(self, doc_id: str, store_type: Optional[str] = None) -> Optional[Dict[str, Any]]:
        """Get document by ID"""
        store_type = store_type or self.active_store
        
        if store_type not in self.stores:
            return None
        
        store = self.stores[store_type]
        
        if store['type'] == 'chroma':
            collection = store['collection']
            result = collection.get(ids=[doc_id])
            if result['ids']:
                return {
                    'id': result['ids'][0],
                    'content': result['documents'][0] if result['documents'] else '',
                    'metadata': result['metadatas'][0] if result['metadatas'] else {}
                }
        
        elif store['type'] == 'qdrant':
            client = store['client']
            collection_name = store['collection_name']
            result = client.retrieve(collection_name=collection_name, ids=[doc_id])
            if result:
                point = result[0]
                return {
                    'id': point.id,
                    'content': point.payload.get('content', ''),
                    'metadata': point.payload.get('metadata', {})
                }
        
        elif store['type'] == 'faiss':
            metadata = store['metadata']
            try:
                idx = metadata['ids'].index(doc_id)
                doc = metadata['documents'][idx]
                return {
                    'id': doc_id,
                    'content': doc.get('content', ''),
                    'metadata': doc.get('metadata', {})
                }
            except ValueError:
                return None
        
        return None
    
    async def delete_document(self, doc_id: str, store_type: Optional[str] = None) -> bool:
        """Delete document by ID"""
        store_type = store_type or self.active_store
        
        if store_type not in self.stores:
            return False
        
        store = self.stores[store_type]
        
        try:
            if store['type'] == 'chroma':
                collection = store['collection']
                collection.delete(ids=[doc_id])
                return True
                
            elif store['type'] == 'qdrant':
                client = store['client']
                collection_name = store['collection_name']
                client.delete(collection_name=collection_name, points_selector=models.PointIdsList(points=[doc_id]))
                return True
                
            elif store['type'] == 'faiss':
                # FAISS doesn't support deletion, would need to rebuild index
                logger.warning("FAISS doesn't support document deletion")
                return False
            
        except Exception as e:
            logger.error(f"Failed to delete document {doc_id}: {e}")
            return False
        
        return False
    
    def get_store_info(self) -> Dict[str, Any]:
        """Get information about available stores"""
        info = {
            'active_store': self.active_store,
            'available_stores': list(self.stores.keys()),
            'stores': {}
        }
        
        for store_type, store in self.stores.items():
            store_info = {
                'type': store['type'],
                'config': store['config']
            }
            
            if store['type'] == 'chroma':
                collection = store['collection']
                store_info['collection_name'] = collection.name
                store_info['count'] = collection.count()
                
            elif store['type'] == 'qdrant':
                client = store['client']
                collection_name = store['collection_name']
                try:
                    collection_info = client.get_collection(collection_name)
                    store_info['collection_name'] = collection_name
                    store_info['count'] = collection_info.points_count
                except Exception:
                    store_info['count'] = 0
                    
            elif store['type'] == 'faiss':
                index = store['index']
                store_info['count'] = index.ntotal
                store_info['dimension'] = index.d
            
            info['stores'][store_type] = store_info
        
        return info
    
    async def health_check(self) -> Dict[str, bool]:
        """Check health of all vector stores"""
        health = {}
        
        for store_type, store in self.stores.items():
            try:
                if store['type'] == 'chroma':
                    collection = store['collection']
                    collection.count()  # Simple operation to check if working
                    health[store_type] = True
                    
                elif store['type'] == 'qdrant':
                    client = store['client']
                    client.get_collections()  # Check connection
                    health[store_type] = True
                    
                elif store['type'] == 'faiss':
                    index = store['index']
                    index.ntotal  # Access property to check if working
                    health[store_type] = True
                    
            except Exception as e:
                health[store_type] = False
                logger.error(f"Health check failed for {store_type}: {e}")
        
        return health