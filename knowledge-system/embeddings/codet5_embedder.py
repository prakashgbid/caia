#!/usr/bin/env python3
"""CodeT5-based code embedding service."""

import os
import json
import numpy as np
from typing import List, Dict, Any, Union
from pathlib import Path
import logging
from dataclasses import dataclass

try:
    from transformers import AutoTokenizer, AutoModel
    import torch
    TRANSFORMERS_AVAILABLE = True
except ImportError:
    TRANSFORMERS_AVAILABLE = False
    print("Warning: transformers not available. Run: pip install transformers torch")

try:
    from sentence_transformers import SentenceTransformer
    SENTENCE_TRANSFORMERS_AVAILABLE = True
except ImportError:
    SENTENCE_TRANSFORMERS_AVAILABLE = False
    print("Warning: sentence-transformers not available. Run: pip install sentence-transformers")

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

@dataclass
class CodeEmbedding:
    """Represents a code embedding."""
    text: str
    embedding: np.ndarray
    metadata: Dict[str, Any] = None
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            'text': self.text,
            'embedding': self.embedding.tolist(),
            'metadata': self.metadata or {}
        }
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'CodeEmbedding':
        return cls(
            text=data['text'],
            embedding=np.array(data['embedding']),
            metadata=data.get('metadata', {})
        )

class CodeT5Embedder:
    """CodeT5-based code embedder."""
    
    def __init__(self, model_name: str = "Salesforce/codet5-base", cache_dir: str = None):
        self.model_name = model_name
        self.cache_dir = cache_dir or "/Users/MAC/Documents/projects/caia/knowledge-system/models"
        self.tokenizer = None
        self.model = None
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        
        if not TRANSFORMERS_AVAILABLE:
            raise ImportError("transformers package required. Run: pip install transformers torch")
        
        self._load_model()
    
    def _load_model(self):
        """Load the CodeT5 model and tokenizer."""
        try:
            logger.info(f"Loading CodeT5 model: {self.model_name}")
            
            # Create cache directory
            os.makedirs(self.cache_dir, exist_ok=True)
            
            # Load tokenizer and model
            self.tokenizer = AutoTokenizer.from_pretrained(
                self.model_name,
                cache_dir=self.cache_dir
            )
            
            self.model = AutoModel.from_pretrained(
                self.model_name,
                cache_dir=self.cache_dir
            )
            
            # Move to appropriate device
            self.model.to(self.device)
            self.model.eval()
            
            logger.info(f"Model loaded successfully on {self.device}")
            
        except Exception as e:
            logger.error(f"Error loading model: {e}")
            raise
    
    def embed_code(self, code_text: str, max_length: int = 512) -> np.ndarray:
        """Generate embedding for code text."""
        try:
            # Tokenize input
            inputs = self.tokenizer(
                code_text,
                max_length=max_length,
                padding=True,
                truncation=True,
                return_tensors="pt"
            )
            
            # Move to device
            inputs = {k: v.to(self.device) for k, v in inputs.items()}
            
            # Generate embeddings
            with torch.no_grad():
                outputs = self.model(**inputs)
                # Use mean pooling of last hidden states
                embedding = outputs.last_hidden_state.mean(dim=1)
                embedding = embedding.cpu().numpy().flatten()
            
            return embedding
            
        except Exception as e:
            logger.error(f"Error generating embedding: {e}")
            raise
    
    def embed_batch(self, code_texts: List[str], batch_size: int = 8) -> List[np.ndarray]:
        """Generate embeddings for multiple code texts."""
        embeddings = []
        
        for i in range(0, len(code_texts), batch_size):
            batch = code_texts[i:i + batch_size]
            batch_embeddings = []
            
            for text in batch:
                embedding = self.embed_code(text)
                batch_embeddings.append(embedding)
            
            embeddings.extend(batch_embeddings)
            logger.info(f"Processed batch {i//batch_size + 1}/{(len(code_texts)-1)//batch_size + 1}")
        
        return embeddings
    
    def embed_entities(self, entities: List[Dict[str, Any]]) -> List[CodeEmbedding]:
        """Generate embeddings for code entities."""
        embeddings = []
        
        for entity in entities:
            # Create text representation of the entity
            text_repr = self._create_text_representation(entity)
            
            # Generate embedding
            embedding_vector = self.embed_code(text_repr)
            
            # Create CodeEmbedding object
            code_embedding = CodeEmbedding(
                text=text_repr,
                embedding=embedding_vector,
                metadata={
                    'entity_type': entity.get('type'),
                    'entity_name': entity.get('name'),
                    'file_path': entity.get('file_path'),
                    'start_line': entity.get('start_line'),
                    'end_line': entity.get('end_line')
                }
            )
            
            embeddings.append(code_embedding)
        
        return embeddings
    
    def _create_text_representation(self, entity: Dict[str, Any]) -> str:
        """Create text representation of an entity for embedding."""
        parts = []
        
        # Add entity type and name
        if entity.get('type') and entity.get('name'):
            parts.append(f"{entity['type']} {entity['name']}")
        
        # Add signature if available
        if entity.get('signature'):
            parts.append(entity['signature'])
        
        # Add docstring if available
        if entity.get('docstring'):
            parts.append(entity['docstring'])
        
        # Join all parts
        return " ".join(parts)
    
    def save_embeddings(self, embeddings: List[CodeEmbedding], output_file: str):
        """Save embeddings to file."""
        data = [emb.to_dict() for emb in embeddings]
        
        with open(output_file, 'w') as f:
            json.dump(data, f, indent=2)
        
        logger.info(f"Saved {len(embeddings)} embeddings to {output_file}")
    
    def load_embeddings(self, input_file: str) -> List[CodeEmbedding]:
        """Load embeddings from file."""
        with open(input_file, 'r') as f:
            data = json.load(f)
        
        embeddings = [CodeEmbedding.from_dict(item) for item in data]
        logger.info(f"Loaded {len(embeddings)} embeddings from {input_file}")
        
        return embeddings

class SentenceTransformerEmbedder:
    """Fallback embedder using SentenceTransformers."""
    
    def __init__(self, model_name: str = "all-MiniLM-L6-v2"):
        if not SENTENCE_TRANSFORMERS_AVAILABLE:
            raise ImportError("sentence-transformers required. Run: pip install sentence-transformers")
        
        self.model = SentenceTransformer(model_name)
        logger.info(f"Loaded SentenceTransformer model: {model_name}")
    
    def embed_code(self, code_text: str) -> np.ndarray:
        """Generate embedding using SentenceTransformer."""
        return self.model.encode([code_text])[0]
    
    def embed_batch(self, code_texts: List[str]) -> List[np.ndarray]:
        """Generate embeddings for batch."""
        return self.model.encode(code_texts)

class EmbeddingService:
    """Main embedding service with fallbacks."""
    
    def __init__(self, prefer_codet5: bool = True):
        self.embedder = None
        
        if prefer_codet5 and TRANSFORMERS_AVAILABLE:
            try:
                self.embedder = CodeT5Embedder()
                logger.info("Using CodeT5 embedder")
            except Exception as e:
                logger.warning(f"Failed to load CodeT5: {e}")
        
        if self.embedder is None and SENTENCE_TRANSFORMERS_AVAILABLE:
            try:
                self.embedder = SentenceTransformerEmbedder()
                logger.info("Using SentenceTransformer embedder")
            except Exception as e:
                logger.warning(f"Failed to load SentenceTransformer: {e}")
        
        if self.embedder is None:
            raise RuntimeError("No embedding model available. Install transformers or sentence-transformers")
    
    def embed_code(self, code_text: str) -> np.ndarray:
        """Generate code embedding."""
        return self.embedder.embed_code(code_text)
    
    def embed_batch(self, code_texts: List[str]) -> List[np.ndarray]:
        """Generate embeddings for batch."""
        return self.embedder.embed_batch(code_texts)

def main():
    """CLI interface for the embedder."""
    import argparse
    
    parser = argparse.ArgumentParser(description="CodeT5 embedding service")
    parser.add_argument("--text", help="Code text to embed")
    parser.add_argument("--file", help="File containing code to embed")
    parser.add_argument("--output", help="Output file for embeddings")
    
    args = parser.parse_args()
    
    service = EmbeddingService()
    
    if args.text:
        embedding = service.embed_code(args.text)
        print(f"Embedding shape: {embedding.shape}")
        print(f"Embedding (first 10 values): {embedding[:10]}")
    
    elif args.file:
        with open(args.file, 'r') as f:
            code_text = f.read()
        
        embedding = service.embed_code(code_text)
        
        if args.output:
            np.save(args.output, embedding)
            print(f"Embedding saved to {args.output}")
        else:
            print(f"Embedding shape: {embedding.shape}")
            print(f"Embedding (first 10 values): {embedding[:10]}")
    
    else:
        print("Please provide --text or --file argument")

if __name__ == "__main__":
    main()
