#!/usr/bin/env python3
"""
Comprehensive Feedback Collector
Captures both explicit and implicit feedback from users
"""

import json
import time
import sqlite3
import logging
from datetime import datetime
from typing import Dict, Any, Optional, List
import asyncio
from dataclasses import dataclass

@dataclass
class FeedbackItem:
    """Structured feedback item"""
    interaction_id: int
    feedback_type: str  # 'explicit', 'implicit'
    rating: Optional[int] = None
    feedback_text: str = ""
    implicit_signals: Dict[str, Any] = None
    timestamp: str = None
    
    def __post_init__(self):
        if self.implicit_signals is None:
            self.implicit_signals = {}
        if self.timestamp is None:
            self.timestamp = datetime.now().isoformat()

class FeedbackCollector:
    """Advanced feedback collection system"""
    
    def __init__(self, db_path: str = "data/learning_interactions.db"):
        self.db_path = db_path
        self.setup_logging()
        self.setup_database()
        
        # Implicit feedback tracking
        self.interaction_start_times = {}
        self.user_behaviors = {}
        
    def setup_logging(self):
        logging.basicConfig(level=logging.INFO)
        self.logger = logging.getLogger(__name__)
    
    def setup_database(self):
        """Setup feedback database tables"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        # Enhanced feedback table
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS feedback (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            interaction_id INTEGER,
            session_id TEXT,
            feedback_type TEXT,
            rating INTEGER,
            feedback_text TEXT,
            implicit_signals TEXT,
            timestamp TEXT,
            processed BOOLEAN DEFAULT 0,
            FOREIGN KEY (interaction_id) REFERENCES interactions (id)
        )
        """)
        
        # Feedback patterns table for learning
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS feedback_patterns (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            pattern_type TEXT,
            pattern_data TEXT,
            confidence REAL,
            frequency INTEGER DEFAULT 1,
            last_updated TEXT
        )
        """)
        
        conn.commit()
        conn.close()
    
    def collect_explicit_feedback(self, interaction_id: int, 
                                 rating: int, feedback_text: str = "",
                                 session_id: str = "") -> bool:
        """Collect explicit user feedback"""
        try:
            feedback = FeedbackItem(
                interaction_id=interaction_id,
                feedback_type="explicit",
                rating=rating,
                feedback_text=feedback_text
            )
            
            return self._save_feedback(feedback, session_id)
            
        except Exception as e:
            self.logger.error(f"Error collecting explicit feedback: {e}")
            return False
    
    def collect_implicit_feedback(self, interaction_id: int,
                                 implicit_signals: Dict[str, Any],
                                 session_id: str = "") -> bool:
        """Collect implicit behavioral feedback"""
        try:
            # Analyze implicit signals
            inferred_satisfaction = self._analyze_implicit_signals(implicit_signals)
            
            feedback = FeedbackItem(
                interaction_id=interaction_id,
                feedback_type="implicit",
                rating=inferred_satisfaction,
                implicit_signals=implicit_signals
            )
            
            return self._save_feedback(feedback, session_id)
            
        except Exception as e:
            self.logger.error(f"Error collecting implicit feedback: {e}")
            return False
    
    def _analyze_implicit_signals(self, signals: Dict[str, Any]) -> int:
        """Analyze implicit signals to infer satisfaction rating"""
        satisfaction_score = 3  # Neutral baseline
        
        # Time spent reading response
        read_time = signals.get('read_time_seconds', 0)
        response_length = signals.get('response_length', 100)
        expected_read_time = response_length / 200  # ~200 chars per second
        
        if read_time > expected_read_time * 0.8:  # Read most of response
            satisfaction_score += 1
        elif read_time < expected_read_time * 0.3:  # Quickly dismissed
            satisfaction_score -= 1
        
        # Follow-up behavior
        if signals.get('asked_follow_up', False):
            satisfaction_score += 1  # Engaged with response
        
        if signals.get('repeated_question', False):
            satisfaction_score -= 1  # Response wasn't satisfactory
        
        if signals.get('copied_response', False):
            satisfaction_score += 1  # Found response useful
        
        # Session continuation
        if signals.get('continued_session', True):
            satisfaction_score += 0.5
        else:
            satisfaction_score -= 0.5
        
        # Click patterns
        if signals.get('clicked_external_links', False):
            satisfaction_score += 0.5  # Engaged with suggestions
        
        # Scroll behavior
        scroll_percentage = signals.get('scroll_percentage', 50)
        if scroll_percentage > 80:
            satisfaction_score += 0.5  # Read full response
        elif scroll_percentage < 20:
            satisfaction_score -= 0.5  # Barely read response
        
        # Clamp to valid rating range
        return max(1, min(5, int(round(satisfaction_score))))
    
    def _save_feedback(self, feedback: FeedbackItem, session_id: str) -> bool:
        """Save feedback to database"""
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()
            
            cursor.execute("""
            INSERT INTO feedback (
                interaction_id, session_id, feedback_type, rating,
                feedback_text, implicit_signals, timestamp, processed
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                feedback.interaction_id,
                session_id,
                feedback.feedback_type,
                feedback.rating,
                feedback.feedback_text,
                json.dumps(feedback.implicit_signals),
                feedback.timestamp,
                0
            ))
            
            conn.commit()
            conn.close()
            
            self.logger.info(f"Saved {feedback.feedback_type} feedback for interaction {feedback.interaction_id}")
            return True
            
        except Exception as e:
            self.logger.error(f"Error saving feedback: {e}")
            return False
    
    def start_interaction_tracking(self, interaction_id: int):
        """Start tracking interaction for implicit feedback"""
        self.interaction_start_times[interaction_id] = time.time()
    
    def end_interaction_tracking(self, interaction_id: int,
                               user_actions: Dict[str, Any] = None) -> Dict[str, Any]:
        """End tracking and collect implicit signals"""
        start_time = self.interaction_start_times.get(interaction_id)
        if start_time is None:
            return {}
        
        end_time = time.time()
        interaction_duration = end_time - start_time
        
        # Collect implicit signals
        implicit_signals = {
            'interaction_duration_seconds': interaction_duration,
            'timestamp': datetime.now().isoformat()
        }
        
        # Add user actions if provided
        if user_actions:
            implicit_signals.update(user_actions)
        
        # Clean up tracking
        del self.interaction_start_times[interaction_id]
        
        return implicit_signals
    
    def get_feedback_summary(self, days_back: int = 7) -> Dict[str, Any]:
        """Get feedback summary for recent period"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        cursor.execute("""
        SELECT 
            feedback_type,
            AVG(rating) as avg_rating,
            COUNT(*) as count,
            MIN(rating) as min_rating,
            MAX(rating) as max_rating
        FROM feedback 
        WHERE timestamp > datetime('now', '-{} days')
        GROUP BY feedback_type
        """.format(days_back))
        
        results = cursor.fetchall()
        conn.close()
        
        summary = {
            'period_days': days_back,
            'total_feedback': 0,
            'by_type': {}
        }
        
        for feedback_type, avg_rating, count, min_rating, max_rating in results:
            summary['total_feedback'] += count
            summary['by_type'][feedback_type] = {
                'count': count,
                'avg_rating': round(avg_rating, 2) if avg_rating else 0,
                'min_rating': min_rating,
                'max_rating': max_rating
            }
        
        return summary
    
    def get_low_rated_interactions(self, rating_threshold: int = 2,
                                  days_back: int = 7) -> List[Dict]:
        """Get interactions with low ratings for analysis"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        cursor.execute("""
        SELECT 
            i.id,
            i.user_input,
            i.ai_response,
            f.rating,
            f.feedback_text,
            f.timestamp
        FROM interactions i
        JOIN feedback f ON i.id = f.interaction_id
        WHERE f.rating <= ?
        AND f.timestamp > datetime('now', '-{} days')
        ORDER BY f.rating ASC, f.timestamp DESC
        """.format(days_back), (rating_threshold,))
        
        results = cursor.fetchall()
        conn.close()
        
        low_rated = []
        for row in results:
            interaction_id, user_input, ai_response, rating, feedback_text, timestamp = row
            low_rated.append({
                'interaction_id': interaction_id,
                'user_input': user_input,
                'ai_response': ai_response,
                'rating': rating,
                'feedback_text': feedback_text,
                'timestamp': timestamp
            })
        
        return low_rated
    
    def analyze_feedback_patterns(self) -> Dict[str, Any]:
        """Analyze patterns in feedback data"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        # Get recent feedback
        cursor.execute("""
        SELECT 
            f.rating,
            f.feedback_text,
            f.implicit_signals,
            i.topic_category,
            i.intent_classification,
            i.confidence_score
        FROM feedback f
        JOIN interactions i ON f.interaction_id = i.id
        WHERE f.timestamp > datetime('now', '-30 days')
        """)
        
        results = cursor.fetchall()
        conn.close()
        
        patterns = {
            'rating_distribution': {},
            'topic_performance': {},
            'confidence_correlation': [],
            'common_complaints': [],
            'improvement_areas': []
        }
        
        # Analyze patterns
        topic_ratings = {}
        for row in results:
            rating, feedback_text, implicit_signals, topic, intent, confidence = row
            
            # Rating distribution
            patterns['rating_distribution'][rating] = patterns['rating_distribution'].get(rating, 0) + 1
            
            # Topic performance
            if topic:
                if topic not in topic_ratings:
                    topic_ratings[topic] = []
                topic_ratings[topic].append(rating)
            
            # Confidence correlation
            if confidence and rating:
                patterns['confidence_correlation'].append((confidence, rating))
            
            # Analyze feedback text for common issues
            if feedback_text and rating <= 2:
                patterns['common_complaints'].append(feedback_text.lower())
        
        # Calculate topic performance
        for topic, ratings in topic_ratings.items():
            patterns['topic_performance'][topic] = {
                'avg_rating': sum(ratings) / len(ratings),
                'count': len(ratings),
                'needs_improvement': sum(ratings) / len(ratings) < 3.5
            }
        
        return patterns
    
    def get_feedback_for_learning(self, min_rating_diff: int = 2) -> List[Dict]:
        """Get feedback data suitable for RLHF training"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        # Get interactions with clear preference signals
        cursor.execute("""
        SELECT 
            i.user_input,
            i.ai_response,
            i.context,
            f.rating,
            f.feedback_text,
            i.topic_category
        FROM interactions i
        JOIN feedback f ON i.id = f.interaction_id
        WHERE f.rating IS NOT NULL
        AND f.processed = 0
        ORDER BY i.user_input, f.rating DESC
        """)
        
        results = cursor.fetchall()
        conn.close()
        
        # Group by similar inputs to create preference pairs
        input_groups = {}
        for row in results:
            user_input, ai_response, context, rating, feedback_text, topic = row
            key = user_input.lower().strip()[:100]  # Group similar inputs
            
            if key not in input_groups:
                input_groups[key] = []
            
            input_groups[key].append({
                'user_input': user_input,
                'ai_response': ai_response,
                'context': context or '',
                'rating': rating,
                'feedback_text': feedback_text or '',
                'topic': topic or 'general'
            })
        
        # Create preference pairs
        preference_data = []
        for input_key, responses in input_groups.items():
            if len(responses) >= 2:
                # Sort by rating
                responses.sort(key=lambda x: x['rating'], reverse=True)
                
                # Create pairs with rating differences >= min_rating_diff
                for i in range(len(responses)):
                    for j in range(i + 1, len(responses)):
                        if responses[i]['rating'] - responses[j]['rating'] >= min_rating_diff:
                            preference_data.append({
                                'preferred': responses[i],
                                'rejected': responses[j],
                                'preference_strength': responses[i]['rating'] - responses[j]['rating']
                            })
        
        self.logger.info(f"Generated {len(preference_data)} preference pairs for learning")
        return preference_data

if __name__ == "__main__":
    # Test feedback collector
    collector = FeedbackCollector()
    
    # Test explicit feedback
    collector.collect_explicit_feedback(
        interaction_id=1,
        rating=4,
        feedback_text="Good response, very helpful!",
        session_id="test_session"
    )
    
    # Test implicit feedback
    collector.collect_implicit_feedback(
        interaction_id=2,
        implicit_signals={
            'read_time_seconds': 15,
            'response_length': 200,
            'asked_follow_up': True,
            'copied_response': True,
            'scroll_percentage': 90
        },
        session_id="test_session"
    )
    
    # Get summary
    summary = collector.get_feedback_summary(days_back=30)
    print(f"Feedback summary: {summary}")
    
    # Get learning data
    learning_data = collector.get_feedback_for_learning()
    print(f"Generated {len(learning_data)} preference pairs for learning")