#!/usr/bin/env python3
"""
Comprehensive Interaction Logger
Captures EVERY interaction with rich metadata for continuous learning
"""

import os
import json
import time
import hashlib
import logging
import sqlite3
from datetime import datetime
from typing import List, Dict, Any, Optional, Union
from pathlib import Path
import threading
import queue
import asyncio
from contextlib import contextmanager
import psutil

class InteractionLogger:
    """Advanced interaction logger with real-time capture and analysis"""
    
    def __init__(self, db_path: str = "data/learning_interactions.db"):
        self.db_path = db_path
        self.setup_logging()
        self.setup_database()
        
        # Real-time logging queue
        self.log_queue = queue.Queue(maxsize=1000)
        self.logger_thread = None
        self.stop_logging = False
        
        # Session tracking
        self.current_session_id = self.generate_session_id()
        self.session_start_time = datetime.now()
        self.interaction_counter = 0
        
        # Context tracking
        self.conversation_context = []
        self.user_profile = {}
        self.system_metrics = {}
        
        # Start background logger
        self.start_background_logger()
        
    def setup_logging(self):
        """Setup comprehensive logging"""
        logging.basicConfig(
            level=logging.INFO,
            format='[INTERACTION_LOGGER] %(asctime)s - %(levelname)s - %(message)s',
            handlers=[
                logging.FileHandler('learning/logs/interaction_logger.log'),
                logging.StreamHandler()
            ]
        )
        self.logger = logging.getLogger(__name__)
        
    def generate_session_id(self) -> str:
        """Generate unique session ID"""
        timestamp = int(time.time() * 1000)
        random_part = hashlib.md5(str(timestamp).encode()).hexdigest()[:8]
        return f"session_{timestamp}_{random_part}"
        
    def setup_database(self):
        """Setup comprehensive database schema"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        # Main interactions table with extended metadata
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS interactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT NOT NULL,
            interaction_sequence INTEGER,
            timestamp TEXT NOT NULL,
            user_input TEXT,
            ai_response TEXT,
            context TEXT,
            conversation_turn INTEGER,
            input_tokens INTEGER,
            output_tokens INTEGER,
            response_time_ms REAL,
            confidence_score REAL,
            topic_category TEXT,
            intent_classification TEXT,
            sentiment_score REAL,
            complexity_score REAL,
            user_satisfaction_predicted REAL,
            system_metrics TEXT,
            metadata TEXT
        )
        """)
        
        # Session metadata
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS sessions (
            session_id TEXT PRIMARY KEY,
            start_time TEXT NOT NULL,
            end_time TEXT,
            total_interactions INTEGER DEFAULT 0,
            total_tokens INTEGER DEFAULT 0,
            avg_response_time REAL,
            user_satisfaction REAL,
            session_type TEXT,
            device_info TEXT,
            metadata TEXT
        )
        """)
        
        # Real-time feedback
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS feedback (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            interaction_id INTEGER,
            session_id TEXT,
            feedback_type TEXT,
            rating INTEGER,
            feedback_text TEXT,
            timestamp TEXT,
            implicit_feedback TEXT,
            FOREIGN KEY (interaction_id) REFERENCES interactions (id)
        )
        """)
        
        # User behavior patterns
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS user_patterns (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            pattern_type TEXT,
            pattern_data TEXT,
            frequency INTEGER,
            last_seen TEXT,
            confidence REAL
        )
        """)
        
        # Learning events
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS learning_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            event_type TEXT,
            event_data TEXT,
            timestamp TEXT,
            session_id TEXT,
            interaction_id INTEGER,
            importance_score REAL
        )
        """)
        
        conn.commit()
        conn.close()
        
        self.logger.info("Database schema initialized")
        
    def start_background_logger(self):
        """Start background thread for real-time logging"""
        if self.logger_thread is None or not self.logger_thread.is_alive():
            self.stop_logging = False
            self.logger_thread = threading.Thread(target=self._background_logger_worker)
            self.logger_thread.daemon = True
            self.logger_thread.start()
            self.logger.info("Background logger started")
    
    def _background_logger_worker(self):
        """Background worker for processing log queue"""
        while not self.stop_logging:
            try:
                # Get item from queue with timeout
                log_item = self.log_queue.get(timeout=1.0)
                
                # Process the log item
                if log_item['type'] == 'interaction':
                    self._save_interaction_to_db(log_item['data'])
                elif log_item['type'] == 'feedback':
                    self._save_feedback_to_db(log_item['data'])
                elif log_item['type'] == 'event':
                    self._save_event_to_db(log_item['data'])
                
                self.log_queue.task_done()
                
            except queue.Empty:
                continue
            except Exception as e:
                self.logger.error(f"Error in background logger: {e}")
    
    def log_interaction(self, user_input: str, ai_response: str,
                       context: str = "", response_time_ms: float = 0,
                       additional_metadata: Dict = None) -> int:
        """Log a complete interaction with rich metadata"""
        self.interaction_counter += 1
        
        # Extract metadata
        metadata = self._extract_interaction_metadata(
            user_input, ai_response, context, additional_metadata or {}
        )
        
        # Create interaction record
        interaction_data = {
            'session_id': self.current_session_id,
            'interaction_sequence': self.interaction_counter,
            'timestamp': datetime.now().isoformat(),
            'user_input': user_input,
            'ai_response': ai_response,
            'context': context,
            'conversation_turn': len(self.conversation_context),
            'input_tokens': self._count_tokens(user_input),
            'output_tokens': self._count_tokens(ai_response),
            'response_time_ms': response_time_ms,
            'confidence_score': metadata.get('confidence_score', 0.0),
            'topic_category': metadata.get('topic_category', ''),
            'intent_classification': metadata.get('intent_classification', ''),
            'sentiment_score': metadata.get('sentiment_score', 0.0),
            'complexity_score': metadata.get('complexity_score', 0.0),
            'user_satisfaction_predicted': metadata.get('user_satisfaction_predicted', 0.0),
            'system_metrics': json.dumps(self._get_system_metrics()),
            'metadata': json.dumps(metadata)
        }
        
        # Add to conversation context
        self.conversation_context.append({
            'user_input': user_input,
            'ai_response': ai_response,
            'timestamp': interaction_data['timestamp'],
            'turn': self.interaction_counter
        })
        
        # Keep context window manageable
        if len(self.conversation_context) > 20:
            self.conversation_context = self.conversation_context[-20:]
        
        # Queue for background processing
        try:
            self.log_queue.put_nowait({
                'type': 'interaction',
                'data': interaction_data
            })
        except queue.Full:
            self.logger.warning("Log queue full, processing immediately")
            self._save_interaction_to_db(interaction_data)
        
        # Return interaction ID (we'll need to get from DB)
        return self.interaction_counter
    
    def _extract_interaction_metadata(self, user_input: str, ai_response: str,
                                    context: str, additional: Dict) -> Dict:
        """Extract rich metadata from interaction"""
        metadata = {
            'input_length': len(user_input),
            'output_length': len(ai_response),
            'has_context': bool(context.strip()),
            'context_length': len(context),
            'input_word_count': len(user_input.split()),
            'output_word_count': len(ai_response.split()),
            'has_questions': '?' in user_input,
            'response_has_questions': '?' in ai_response,
            'has_code': any(marker in user_input.lower() or marker in ai_response.lower() 
                           for marker in ['```', 'def ', 'function', 'class ', 'import ']),
            'extraction_time': datetime.now().isoformat()
        }
        
        # Simple sentiment analysis (placeholder)
        metadata['sentiment_score'] = self._simple_sentiment_analysis(user_input)
        
        # Simple topic classification
        metadata['topic_category'] = self._simple_topic_classification(user_input)
        
        # Intent classification
        metadata['intent_classification'] = self._simple_intent_classification(user_input)
        
        # Complexity scoring
        metadata['complexity_score'] = self._calculate_complexity_score(user_input, ai_response)
        
        # Confidence scoring (placeholder)
        metadata['confidence_score'] = self._estimate_response_confidence(ai_response)
        
        # Predicted satisfaction (placeholder)
        metadata['user_satisfaction_predicted'] = self._predict_satisfaction(user_input, ai_response)
        
        # Merge with additional metadata
        metadata.update(additional)
        
        return metadata
    
    def _simple_sentiment_analysis(self, text: str) -> float:
        """Simple sentiment analysis (-1 to 1)"""
        positive_words = ['good', 'great', 'excellent', 'awesome', 'perfect', 'love', 'like', 'amazing']
        negative_words = ['bad', 'terrible', 'awful', 'hate', 'dislike', 'horrible', 'worst', 'stupid']
        
        words = text.lower().split()
        positive_count = sum(1 for word in words if word in positive_words)
        negative_count = sum(1 for word in words if word in negative_words)
        
        total_words = len(words)
        if total_words == 0:
            return 0.0
            
        sentiment = (positive_count - negative_count) / total_words
        return max(-1, min(1, sentiment))
    
    def _simple_topic_classification(self, text: str) -> str:
        """Simple topic classification"""
        text_lower = text.lower()
        
        topics = {
            'programming': ['code', 'function', 'python', 'javascript', 'programming', 'debug', 'error'],
            'data': ['data', 'database', 'sql', 'query', 'analysis', 'visualization'],
            'ai_ml': ['ai', 'machine learning', 'model', 'training', 'neural', 'algorithm'],
            'web': ['website', 'html', 'css', 'frontend', 'backend', 'api', 'server'],
            'general': []
        }
        
        for topic, keywords in topics.items():
            if any(keyword in text_lower for keyword in keywords):
                return topic
                
        return 'general'
    
    def _simple_intent_classification(self, text: str) -> str:
        """Simple intent classification"""
        text_lower = text.lower()
        
        if any(word in text_lower for word in ['how', 'what', 'when', 'where', 'why', '?']):
            return 'question'
        elif any(word in text_lower for word in ['please', 'can you', 'could you', 'help']):
            return 'request'
        elif any(word in text_lower for word in ['create', 'make', 'build', 'generate']):
            return 'creation'
        elif any(word in text_lower for word in ['fix', 'debug', 'error', 'problem']):
            return 'troubleshooting'
        else:
            return 'general'
    
    def _calculate_complexity_score(self, user_input: str, ai_response: str) -> float:
        """Calculate interaction complexity (0 to 1)"""
        factors = {
            'input_length': min(len(user_input) / 1000, 1),
            'output_length': min(len(ai_response) / 2000, 1),
            'technical_terms': self._count_technical_terms(user_input + ai_response) / 20,
            'code_blocks': (user_input.count('```') + ai_response.count('```')) / 10,
            'context_depth': min(len(self.conversation_context) / 10, 1)
        }
        
        return min(sum(factors.values()) / len(factors), 1.0)
    
    def _count_technical_terms(self, text: str) -> int:
        """Count technical terms in text"""
        technical_terms = [
            'algorithm', 'function', 'variable', 'database', 'server', 'api', 'frontend',
            'backend', 'machine learning', 'neural network', 'regression', 'classification',
            'deployment', 'optimization', 'authentication', 'authorization', 'encryption'
        ]
        
        text_lower = text.lower()
        return sum(1 for term in technical_terms if term in text_lower)
    
    def _estimate_response_confidence(self, response: str) -> float:
        """Estimate AI response confidence (0 to 1)"""
        uncertainty_phrases = [
            'i think', 'maybe', 'perhaps', 'possibly', 'might be',
            'not sure', 'uncertain', 'could be', 'seems like'
        ]
        
        response_lower = response.lower()
        uncertainty_count = sum(1 for phrase in uncertainty_phrases if phrase in response_lower)
        
        # Simple heuristic: fewer uncertainty phrases = higher confidence
        base_confidence = max(0, 1 - (uncertainty_count * 0.2))
        
        # Adjust based on response length and detail
        length_factor = min(len(response) / 500, 1)
        detail_factor = response.count('.') / 20  # Sentences as detail indicator
        
        confidence = (base_confidence + length_factor + detail_factor) / 3
        return min(confidence, 1.0)
    
    def _predict_satisfaction(self, user_input: str, ai_response: str) -> float:
        """Predict user satisfaction (0 to 1)"""
        # Simple heuristic based on response completeness
        input_questions = user_input.count('?')
        response_length = len(ai_response)
        
        # Baseline satisfaction
        satisfaction = 0.5
        
        # Boost if response is detailed
        if response_length > 200:
            satisfaction += 0.2
        
        # Boost if response addresses questions
        if input_questions > 0 and response_length > 100:
            satisfaction += 0.2
        
        # Reduce if response seems uncertain
        if any(phrase in ai_response.lower() for phrase in ['not sure', 'uncertain', "don't know"]):
            satisfaction -= 0.3
        
        return max(0, min(1, satisfaction))
    
    def _count_tokens(self, text: str) -> int:
        """Simple token counting (approximate)"""
        return len(text.split())
    
    def _get_system_metrics(self) -> Dict:
        """Get current system performance metrics"""
        try:
            return {
                'cpu_percent': psutil.cpu_percent(),
                'memory_percent': psutil.virtual_memory().percent,
                'timestamp': datetime.now().isoformat()
            }
        except:
            return {}
    
    def _save_interaction_to_db(self, interaction_data: Dict):
        """Save interaction to database"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        cursor.execute("""
        INSERT INTO interactions (
            session_id, interaction_sequence, timestamp, user_input, ai_response,
            context, conversation_turn, input_tokens, output_tokens, response_time_ms,
            confidence_score, topic_category, intent_classification, sentiment_score,
            complexity_score, user_satisfaction_predicted, system_metrics, metadata
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            interaction_data['session_id'],
            interaction_data['interaction_sequence'],
            interaction_data['timestamp'],
            interaction_data['user_input'],
            interaction_data['ai_response'],
            interaction_data['context'],
            interaction_data['conversation_turn'],
            interaction_data['input_tokens'],
            interaction_data['output_tokens'],
            interaction_data['response_time_ms'],
            interaction_data['confidence_score'],
            interaction_data['topic_category'],
            interaction_data['intent_classification'],
            interaction_data['sentiment_score'],
            interaction_data['complexity_score'],
            interaction_data['user_satisfaction_predicted'],
            interaction_data['system_metrics'],
            interaction_data['metadata']
        ))
        
        interaction_id = cursor.lastrowid
        conn.commit()
        conn.close()
        
        return interaction_id
    
    def log_feedback(self, interaction_id: int, feedback_type: str,
                    rating: Optional[int] = None, feedback_text: str = "",
                    implicit_feedback: Dict = None):
        """Log user feedback for an interaction"""
        feedback_data = {
            'interaction_id': interaction_id,
            'session_id': self.current_session_id,
            'feedback_type': feedback_type,
            'rating': rating,
            'feedback_text': feedback_text,
            'timestamp': datetime.now().isoformat(),
            'implicit_feedback': json.dumps(implicit_feedback or {})
        }
        
        try:
            self.log_queue.put_nowait({
                'type': 'feedback',
                'data': feedback_data
            })
        except queue.Full:
            self._save_feedback_to_db(feedback_data)
    
    def _save_feedback_to_db(self, feedback_data: Dict):
        """Save feedback to database"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        cursor.execute("""
        INSERT INTO feedback (
            interaction_id, session_id, feedback_type, rating,
            feedback_text, timestamp, implicit_feedback
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (
            feedback_data['interaction_id'],
            feedback_data['session_id'],
            feedback_data['feedback_type'],
            feedback_data['rating'],
            feedback_data['feedback_text'],
            feedback_data['timestamp'],
            feedback_data['implicit_feedback']
        ))
        
        conn.commit()
        conn.close()
    
    def log_learning_event(self, event_type: str, event_data: Dict,
                          interaction_id: Optional[int] = None,
                          importance_score: float = 1.0):
        """Log a learning-related event"""
        event_record = {
            'event_type': event_type,
            'event_data': json.dumps(event_data),
            'timestamp': datetime.now().isoformat(),
            'session_id': self.current_session_id,
            'interaction_id': interaction_id,
            'importance_score': importance_score
        }
        
        try:
            self.log_queue.put_nowait({
                'type': 'event',
                'data': event_record
            })
        except queue.Full:
            self._save_event_to_db(event_record)
    
    def _save_event_to_db(self, event_data: Dict):
        """Save learning event to database"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        cursor.execute("""
        INSERT INTO learning_events (
            event_type, event_data, timestamp, session_id,
            interaction_id, importance_score
        ) VALUES (?, ?, ?, ?, ?, ?)
        """, (
            event_data['event_type'],
            event_data['event_data'],
            event_data['timestamp'],
            event_data['session_id'],
            event_data['interaction_id'],
            event_data['importance_score']
        ))
        
        conn.commit()
        conn.close()
    
    def get_session_stats(self) -> Dict:
        """Get current session statistics"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        cursor.execute("""
        SELECT 
            COUNT(*) as interaction_count,
            AVG(response_time_ms) as avg_response_time,
            AVG(confidence_score) as avg_confidence,
            AVG(user_satisfaction_predicted) as predicted_satisfaction,
            SUM(input_tokens + output_tokens) as total_tokens
        FROM interactions 
        WHERE session_id = ?
        """, (self.current_session_id,))
        
        row = cursor.fetchone()
        conn.close()
        
        if row:
            return {
                'session_id': self.current_session_id,
                'interaction_count': row[0],
                'avg_response_time': row[1] or 0,
                'avg_confidence': row[2] or 0,
                'predicted_satisfaction': row[3] or 0,
                'total_tokens': row[4] or 0,
                'session_duration_minutes': (datetime.now() - self.session_start_time).total_seconds() / 60
            }
        else:
            return {'session_id': self.current_session_id, 'interaction_count': 0}
    
    def analyze_conversation_patterns(self) -> Dict:
        """Analyze patterns in current conversation"""
        if not self.conversation_context:
            return {}
        
        input_lengths = [len(turn['user_input']) for turn in self.conversation_context]
        response_lengths = [len(turn['ai_response']) for turn in self.conversation_context]
        
        patterns = {
            'avg_input_length': sum(input_lengths) / len(input_lengths) if input_lengths else 0,
            'avg_response_length': sum(response_lengths) / len(response_lengths) if response_lengths else 0,
            'question_ratio': sum('?' in turn['user_input'] for turn in self.conversation_context) / len(self.conversation_context),
            'topics': list(set(self._simple_topic_classification(turn['user_input']) for turn in self.conversation_context)),
            'conversation_turns': len(self.conversation_context),
            'time_span_minutes': (datetime.now() - self.session_start_time).total_seconds() / 60
        }
        
        return patterns
    
    def end_session(self):
        """End current session and save metadata"""
        session_stats = self.get_session_stats()
        conversation_patterns = self.analyze_conversation_patterns()
        
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        cursor.execute("""
        INSERT OR REPLACE INTO sessions (
            session_id, start_time, end_time, total_interactions,
            total_tokens, avg_response_time, user_satisfaction,
            session_type, metadata
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            self.current_session_id,
            self.session_start_time.isoformat(),
            datetime.now().isoformat(),
            session_stats.get('interaction_count', 0),
            session_stats.get('total_tokens', 0),
            session_stats.get('avg_response_time', 0),
            session_stats.get('predicted_satisfaction', 0),
            'interactive',
            json.dumps({
                'session_stats': session_stats,
                'conversation_patterns': conversation_patterns
            })
        ))
        
        conn.commit()
        conn.close()
        
        self.logger.info(f"Session ended: {self.current_session_id}")
        
    def cleanup(self):
        """Cleanup logger and end session"""
        self.stop_logging = True
        if self.logger_thread and self.logger_thread.is_alive():
            self.logger_thread.join(timeout=5)
        
        self.end_session()

# Global logger instance
_global_logger = None

def get_interaction_logger() -> InteractionLogger:
    """Get global interaction logger instance"""
    global _global_logger
    if _global_logger is None:
        _global_logger = InteractionLogger()
    return _global_logger

@contextmanager
def log_interaction_context(user_input: str, ai_response: str = "",
                           context: str = "", metadata: Dict = None):
    """Context manager for logging interactions"""
    logger = get_interaction_logger()
    start_time = time.time()
    
    try:
        yield logger
        
        # Calculate response time
        response_time_ms = (time.time() - start_time) * 1000
        
        # Log the interaction
        if ai_response:
            interaction_id = logger.log_interaction(
                user_input, ai_response, context, 
                response_time_ms, metadata
            )
            return interaction_id
            
    except Exception as e:
        logger.logger.error(f"Error in interaction context: {e}")
        raise

if __name__ == "__main__":
    # Test the interaction logger
    logger = InteractionLogger()
    
    # Log some sample interactions
    interaction_id = logger.log_interaction(
        "How do I implement a neural network?",
        "To implement a neural network, you'll need to define layers, activation functions, and a training loop...",
        "User is asking about machine learning implementation",
        response_time_ms=250.5
    )
    
    # Log feedback
    logger.log_feedback(interaction_id, "explicit", rating=4, feedback_text="Very helpful!")
    
    # Log learning event
    logger.log_learning_event("pattern_detected", {
        "pattern_type": "user_preference",
        "pattern": "prefers detailed technical explanations"
    })
    
    # Get stats
    stats = logger.get_session_stats()
    print(f"Session stats: {stats}")
    
    # Cleanup
    logger.cleanup()