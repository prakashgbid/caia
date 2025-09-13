#!/usr/bin/env python3
"""
Training Data Processor
Converts raw interactions into high-quality training datasets
"""

import json
import re
import sqlite3
import logging
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional, Tuple
from pathlib import Path
import numpy as np
from collections import Counter, defaultdict

class TrainingDataProcessor:
    """Advanced data processor for training datasets"""
    
    def __init__(self, db_path: str = "data/learning_interactions.db"):
        self.db_path = db_path
        self.setup_logging()
        self.quality_filters = self._setup_quality_filters()
        
    def setup_logging(self):
        logging.basicConfig(level=logging.INFO)
        self.logger = logging.getLogger(__name__)
    
    def _setup_quality_filters(self) -> Dict[str, Any]:
        """Setup data quality filters"""
        return {
            'min_input_length': 10,
            'max_input_length': 2000,
            'min_output_length': 20,
            'max_output_length': 4000,
            'min_quality_score': 0.5,
            'exclude_patterns': [
                r'^(hi|hello|hey)$',  # Too simple greetings
                r'^\w{1,3}$',         # Too short responses
                r'^(.)\1{10,}',       # Repeated characters
            ],
            'required_patterns': [
                r'\w+',               # Must contain words
            ]
        }
    
    def extract_training_data(self, days_back: int = 30, 
                            quality_threshold: float = 0.6) -> List[Dict]:
        """Extract high-quality training data"""
        self.logger.info(f"Extracting training data from last {days_back} days")
        
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        # Get interactions with quality metrics
        query = """
        SELECT 
            i.user_input,
            i.ai_response,
            i.context,
            i.confidence_score,
            i.user_satisfaction_predicted,
            f.rating,
            f.feedback_text,
            i.topic_category,
            i.intent_classification
        FROM interactions i
        LEFT JOIN feedback f ON i.id = f.interaction_id
        WHERE i.timestamp > datetime('now', '-{} days')
        AND i.confidence_score >= ?
        ORDER BY i.timestamp DESC
        """.format(days_back)
        
        cursor.execute(query, (quality_threshold,))
        rows = cursor.fetchall()
        conn.close()
        
        # Process and filter data
        training_examples = []
        for row in rows:
            user_input, ai_response, context, confidence, satisfaction, rating, feedback, topic, intent = row
            
            # Apply quality filters
            if self._passes_quality_filters(user_input, ai_response):
                example = self._create_training_example(
                    user_input, ai_response, context, confidence, 
                    satisfaction, rating, feedback, topic, intent
                )
                training_examples.append(example)
        
        self.logger.info(f"Extracted {len(training_examples)} training examples")
        return training_examples
    
    def _passes_quality_filters(self, user_input: str, ai_response: str) -> bool:
        """Check if data passes quality filters"""
        filters = self.quality_filters
        
        # Length filters
        if not (filters['min_input_length'] <= len(user_input) <= filters['max_input_length']):
            return False
        if not (filters['min_output_length'] <= len(ai_response) <= filters['max_output_length']):
            return False
        
        # Pattern filters
        for pattern in filters['exclude_patterns']:
            if re.search(pattern, user_input, re.IGNORECASE) or \
               re.search(pattern, ai_response, re.IGNORECASE):
                return False
        
        for pattern in filters['required_patterns']:
            if not re.search(pattern, user_input) or not re.search(pattern, ai_response):
                return False
        
        return True
    
    def _create_training_example(self, user_input: str, ai_response: str,
                                context: str, confidence: float,
                                satisfaction: float, rating: int,
                                feedback: str, topic: str, intent: str) -> Dict:
        """Create structured training example"""
        return {
            'input': self._clean_text(user_input),
            'output': self._clean_text(ai_response),
            'context': self._clean_text(context or ''),
            'metadata': {
                'confidence': confidence or 0.0,
                'satisfaction': satisfaction or 0.0,
                'rating': rating,
                'feedback': self._clean_text(feedback or ''),
                'topic': topic or 'general',
                'intent': intent or 'general',
                'quality_score': self._calculate_quality_score(
                    user_input, ai_response, confidence, satisfaction, rating
                )
            }
        }
    
    def _clean_text(self, text: str) -> str:
        """Clean and normalize text"""
        if not text:
            return ""
        
        # Remove extra whitespace
        text = re.sub(r'\s+', ' ', text.strip())
        
        # Remove special characters that might interfere with training
        text = re.sub(r'[^\w\s\.,!?;:\-\(\)\'\"]+', '', text)
        
        return text
    
    def _calculate_quality_score(self, user_input: str, ai_response: str,
                                confidence: float, satisfaction: float,
                                rating: int) -> float:
        """Calculate overall quality score for the example"""
        scores = []
        
        # Length appropriateness (not too short, not too long)
        input_len_score = min(1.0, len(user_input) / 100) * (1 - min(1.0, len(user_input) / 1000))
        output_len_score = min(1.0, len(ai_response) / 200) * (1 - min(1.0, len(ai_response) / 2000))
        scores.extend([input_len_score, output_len_score])
        
        # AI confidence
        if confidence:
            scores.append(confidence)
        
        # User satisfaction
        if satisfaction:
            scores.append(satisfaction)
        
        # Explicit rating
        if rating:
            scores.append(rating / 5.0)  # Normalize to 0-1
        
        # Complexity (more complex examples are often higher quality for training)
        complexity_score = min(1.0, (len(set(ai_response.split())) / 50))  # Unique words
        scores.append(complexity_score)
        
        return np.mean(scores) if scores else 0.5

if __name__ == "__main__":
    processor = TrainingDataProcessor()
    data = processor.extract_training_data(days_back=7)
    print(f"Extracted {len(data)} training examples")
    if data:
        print(f"Sample example: {data[0]}")