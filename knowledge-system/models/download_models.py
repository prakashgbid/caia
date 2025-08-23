#!/usr/bin/env python3
"""Download and cache required models."""

import os
from pathlib import Path

def download_codet5():
    """Download CodeT5 model."""
    try:
        from transformers import AutoTokenizer, AutoModel
        
        model_name = "Salesforce/codet5-base"
        cache_dir = "/Users/MAC/Documents/projects/caia/knowledge-system/models"
        
        print(f"Downloading {model_name}...")
        
        # Download tokenizer
        tokenizer = AutoTokenizer.from_pretrained(model_name, cache_dir=cache_dir)
        print("Tokenizer downloaded")
        
        # Download model  
        model = AutoModel.from_pretrained(model_name, cache_dir=cache_dir)
        print("Model downloaded")
        
        print("CodeT5 model ready")
        
    except ImportError:
        print("transformers not installed. Run: pip install transformers torch")
    except Exception as e:
        print(f"Error downloading CodeT5: {e}")

def download_sentence_transformer():
    """Download SentenceTransformer model."""
    try:
        from sentence_transformers import SentenceTransformer
        
        model_name = "all-MiniLM-L6-v2"
        
        print(f"Downloading {model_name}...")
        model = SentenceTransformer(model_name)
        print("SentenceTransformer model ready")
        
    except ImportError:
        print("sentence-transformers not installed. Run: pip install sentence-transformers")
    except Exception as e:
        print(f"Error downloading SentenceTransformer: {e}")

if __name__ == "__main__":
    print("Downloading embedding models...")
    download_codet5()
    download_sentence_transformer()
    print("Model download complete")
