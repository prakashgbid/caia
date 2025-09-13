#!/usr/bin/env python3
"""
Dynamic User Profile Builder
Builds and maintains detailed user profiles from interactions
"""

import os
import json
import numpy as np
import logging
import sqlite3
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional, Tuple, Set
from pathlib import Path
from collections import defaultdict, Counter
import re
from dataclasses import dataclass, asdict
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.cluster import KMeans

@dataclass
class UserPreferences:
    """User preference data structure"""
    communication_style: str = "neutral"  # formal, casual, technical, neutral
    detail_level: str = "medium"  # brief, medium, detailed, comprehensive
    example_preference: str = "some"  # none, some, many
    code_style: str = "readable"  # concise, readable, verbose
    explanation_style: str = "step_by_step"  # overview, step_by_step, theoretical
    topic_interests: List[str] = None
    learning_pace: str = "moderate"  # slow, moderate, fast
    feedback_frequency: str = "moderate"  # rare, moderate, frequent
    
    def __post_init__(self):
        if self.topic_interests is None:
            self.topic_interests = []

@dataclass 
class UserBehavior:
    """User behavior patterns"""
    avg_session_length: float = 0.0
    avg_interactions_per_session: int = 0
    peak_activity_hours: List[int] = None
    question_types: Dict[str, int] = None
    response_satisfaction: float = 0.0
    learning_progress: float = 0.0
    engagement_score: float = 0.0
    
    def __post_init__(self):
        if self.peak_activity_hours is None:
            self.peak_activity_hours = []
        if self.question_types is None:
            self.question_types = {}

class UserProfileBuilder:
    """Advanced user profile builder with machine learning"""
    
    def __init__(self, db_path: str = "data/learning_interactions.db"):
        self.db_path = db_path
        self.setup_logging()
        self.setup_database()
        
        # Analysis models
        self.vectorizer = TfidfVectorizer(max_features=1000, stop_words='english')
        self.topic_model = None
        
        # Profile cache
        self.profile_cache = {}
        self.last_update = {}
        
    def setup_logging(self):
        """Setup comprehensive logging"""
        logging.basicConfig(
            level=logging.INFO,
            format='[USER_PROFILE] %(asctime)s - %(levelname)s - %(message)s',
            handlers=[
                logging.FileHandler('learning/logs/user_profile.log'),
                logging.StreamHandler()
            ]
        )
        self.logger = logging.getLogger(__name__)
    
    def setup_database(self):
        """Setup user profile database tables"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        # User profiles table
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS user_profiles (
            user_id TEXT PRIMARY KEY,
            preferences TEXT,
            behavior_patterns TEXT,
            topic_interests TEXT,
            skill_assessments TEXT,
            learning_history TEXT,
            last_updated TEXT,
            profile_version INTEGER DEFAULT 1
        )
        """)
        
        # User sessions summary
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS user_session_summary (
            user_id TEXT,
            date TEXT,
            session_count INTEGER,
            total_interactions INTEGER,
            avg_satisfaction REAL,
            topics_discussed TEXT,
            PRIMARY KEY (user_id, date)
        )
        """)
        
        # Skill progression tracking
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS skill_progression (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT,
            skill_area TEXT,
            assessment_date TEXT,
            skill_level REAL,
            confidence REAL,
            evidence TEXT
        )
        """)
        
        conn.commit()
        conn.close()
        
    def identify_user(self, session_id: str = None, 
                     user_identifier: str = None) -> str:
        """Identify user from session or create anonymous profile"""
        if user_identifier:
            return user_identifier
        elif session_id:
            # For now, use session-based identification
            # In production, this would integrate with authentication
            return f"session_user_{session_id[:8]}"
        else:
            return f"anonymous_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
    
    def analyze_communication_style(self, interactions: List[Dict]) -> str:
        """Analyze user's communication style from interactions"""
        if not interactions:
            return "neutral"
        
        formal_indicators = ['please', 'thank you', 'could you', 'would you', 'appreciate']
        casual_indicators = ['hey', 'hi', 'thanks', 'cool', 'awesome', 'yeah']
        technical_indicators = ['implement', 'algorithm', 'function', 'class', 'method', 'api']
        
        formal_score = 0
        casual_score = 0
        technical_score = 0
        total_words = 0
        
        for interaction in interactions:
            user_input = interaction.get('user_input', '').lower()
            words = user_input.split()
            total_words += len(words)
            
            formal_score += sum(1 for indicator in formal_indicators if indicator in user_input)
            casual_score += sum(1 for indicator in casual_indicators if indicator in user_input)
            technical_score += sum(1 for indicator in technical_indicators if indicator in user_input)
        
        if total_words == 0:
            return "neutral"
        
        # Normalize scores
        formal_ratio = formal_score / total_words
        casual_ratio = casual_score / total_words
        technical_ratio = technical_score / total_words
        
        if technical_ratio > 0.05:
            return "technical"
        elif formal_ratio > casual_ratio and formal_ratio > 0.02:
            return "formal"
        elif casual_ratio > 0.02:
            return "casual"
        else:
            return "neutral"
    
    def analyze_detail_preference(self, interactions: List[Dict]) -> str:
        """Analyze user's preference for detail level"""
        if not interactions:
            return "medium"
        
        brief_requests = 0
        detailed_requests = 0
        total_requests = 0
        
        for interaction in interactions:
            user_input = interaction.get('user_input', '').lower()
            total_requests += 1
            
            if any(phrase in user_input for phrase in ['briefly', 'summary', 'quick', 'short']):
                brief_requests += 1
            elif any(phrase in user_input for phrase in ['detailed', 'comprehensive', 'explain thoroughly', 'step by step']):
                detailed_requests += 1
        
        if total_requests == 0:
            return "medium"
        
        brief_ratio = brief_requests / total_requests
        detailed_ratio = detailed_requests / total_requests
        
        if detailed_ratio > brief_ratio and detailed_ratio > 0.3:
            return "detailed" if detailed_ratio > 0.5 else "comprehensive"
        elif brief_ratio > 0.3:
            return "brief"
        else:
            return "medium"
    
    def analyze_topic_interests(self, interactions: List[Dict]) -> List[str]:
        """Analyze user's topic interests from interactions"""
        if not interactions:
            return []
        
        # Extract topics from all interactions
        all_text = []
        topic_counts = Counter()
        
        for interaction in interactions:
            user_input = interaction.get('user_input', '')
            topic_category = interaction.get('topic_category', '')
            
            all_text.append(user_input)
            if topic_category:
                topic_counts[topic_category] += 1
        
        # Simple keyword-based topic extraction
        topics = self._extract_topics_from_text(' '.join(all_text))
        
        # Combine with classified topics
        for topic, count in topic_counts.most_common():
            if topic not in topics:
                topics.append(topic)
        
        return topics[:10]  # Top 10 interests
    
    def _extract_topics_from_text(self, text: str) -> List[str]:
        """Extract topics from text using keyword analysis"""
        topic_keywords = {
            'programming': ['python', 'javascript', 'code', 'programming', 'function', 'class', 'method'],
            'data_science': ['data', 'analysis', 'pandas', 'numpy', 'visualization', 'statistics'],
            'machine_learning': ['ml', 'machine learning', 'model', 'training', 'neural', 'ai'],
            'web_development': ['html', 'css', 'react', 'vue', 'angular', 'frontend', 'backend'],
            'database': ['sql', 'database', 'query', 'mongodb', 'postgresql', 'mysql'],
            'devops': ['docker', 'kubernetes', 'deployment', 'ci/cd', 'aws', 'azure', 'cloud'],
            'mobile': ['android', 'ios', 'mobile', 'react native', 'flutter', 'swift'],
            'security': ['security', 'encryption', 'authentication', 'vulnerability', 'hack']
        }
        
        text_lower = text.lower()
        detected_topics = []
        
        for topic, keywords in topic_keywords.items():
            score = sum(1 for keyword in keywords if keyword in text_lower)
            if score > 0:
                detected_topics.append((topic, score))
        
        # Sort by relevance and return topic names
        detected_topics.sort(key=lambda x: x[1], reverse=True)
        return [topic for topic, _ in detected_topics]
    
    def analyze_learning_pace(self, interactions: List[Dict]) -> str:
        """Analyze user's learning pace from interaction patterns"""
        if not interactions:
            return "moderate"
        
        # Calculate metrics that indicate learning pace
        follow_up_questions = 0
        implementation_attempts = 0
        clarification_requests = 0
        total_interactions = len(interactions)
        
        for i, interaction in enumerate(interactions):
            user_input = interaction.get('user_input', '').lower()
            
            # Check for follow-up patterns
            if any(phrase in user_input for phrase in ['also', 'additionally', 'furthermore', 'what about']):
                follow_up_questions += 1
            
            # Check for implementation attempts
            if any(phrase in user_input for phrase in ['tried', 'attempting', 'implement', 'working on']):
                implementation_attempts += 1
            
            # Check for clarification requests
            if any(phrase in user_input for phrase in ['clarify', 'confused', 'not sure', 'explain again']):
                clarification_requests += 1
        
        # Calculate pace indicators
        follow_up_ratio = follow_up_questions / total_interactions
        implementation_ratio = implementation_attempts / total_interactions
        clarification_ratio = clarification_requests / total_interactions
        
        # Determine pace
        if follow_up_ratio > 0.3 and implementation_ratio > 0.2:
            return "fast"
        elif clarification_ratio > 0.3 or follow_up_ratio < 0.1:
            return "slow"
        else:
            return "moderate"
    
    def analyze_behavior_patterns(self, user_id: str, 
                                 days_back: int = 30) -> UserBehavior:
        """Analyze user behavior patterns"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        # Get user sessions and interactions
        cursor.execute("""
        SELECT 
            i.session_id,
            i.timestamp,
            i.user_input,
            i.intent_classification,
            i.user_satisfaction_predicted,
            s.start_time,
            s.end_time,
            s.total_interactions
        FROM interactions i
        LEFT JOIN sessions s ON i.session_id = s.session_id
        WHERE i.timestamp > datetime('now', '-{} days')
        ORDER BY i.timestamp
        """.format(days_back))
        
        rows = cursor.fetchall()
        conn.close()
        
        if not rows:
            return UserBehavior()
        
        # Analyze patterns
        sessions = defaultdict(list)
        session_data = {}
        satisfaction_scores = []
        activity_hours = []
        question_types = Counter()
        
        for row in rows:
            session_id, timestamp, user_input, intent, satisfaction, start_time, end_time, total_interactions = row
            
            sessions[session_id].append({
                'timestamp': timestamp,
                'user_input': user_input,
                'intent': intent or 'general',
                'satisfaction': satisfaction or 0.0
            })
            
            if session_id not in session_data and start_time and end_time:
                session_data[session_id] = {
                    'start_time': start_time,
                    'end_time': end_time,
                    'total_interactions': total_interactions or 0
                }
            
            if satisfaction:
                satisfaction_scores.append(satisfaction)
            
            # Extract hour from timestamp
            try:
                dt = datetime.fromisoformat(timestamp)
                activity_hours.append(dt.hour)
            except:
                pass
            
            if intent:
                question_types[intent] += 1
        
        # Calculate behavior metrics
        session_lengths = []
        interactions_per_session = []
        
        for session_id, session_info in session_data.items():
            try:
                start = datetime.fromisoformat(session_info['start_time'])
                end = datetime.fromisoformat(session_info['end_time'])
                length = (end - start).total_seconds() / 60  # minutes
                session_lengths.append(length)
                interactions_per_session.append(session_info['total_interactions'])
            except:
                pass
        
        # Calculate peak activity hours (top 3)
        hour_counts = Counter(activity_hours)
        peak_hours = [hour for hour, _ in hour_counts.most_common(3)]
        
        # Calculate engagement score
        engagement_factors = [
            len(sessions) / 30,  # Session frequency
            np.mean(interactions_per_session) / 10 if interactions_per_session else 0,  # Interaction depth
            np.mean(satisfaction_scores) if satisfaction_scores else 0.5,  # Satisfaction
            min(len(set(question_types.keys())) / 5, 1)  # Diversity of interests
        ]
        engagement_score = np.mean(engagement_factors)
        
        return UserBehavior(
            avg_session_length=np.mean(session_lengths) if session_lengths else 0.0,
            avg_interactions_per_session=int(np.mean(interactions_per_session)) if interactions_per_session else 0,
            peak_activity_hours=peak_hours,
            question_types=dict(question_types),
            response_satisfaction=np.mean(satisfaction_scores) if satisfaction_scores else 0.0,
            engagement_score=engagement_score
        )
    
    def assess_skill_levels(self, user_id: str, interactions: List[Dict]) -> Dict[str, Dict]:
        """Assess user skill levels in different areas"""
        skill_areas = ['programming', 'data_science', 'machine_learning', 'web_development', 'general_tech']
        skill_assessments = {}
        
        for skill_area in skill_areas:
            skill_interactions = [
                i for i in interactions 
                if i.get('topic_category', '').lower().replace('_', ' ') == skill_area.replace('_', ' ')
            ]
            
            if not skill_interactions:
                continue
            
            # Assess skill based on question complexity and understanding
            complexity_scores = [i.get('complexity_score', 0.0) for i in skill_interactions]
            confidence_scores = [i.get('confidence_score', 0.0) for i in skill_interactions]
            
            # Simple skill level calculation
            avg_complexity = np.mean(complexity_scores) if complexity_scores else 0.0
            avg_confidence = np.mean(confidence_scores) if confidence_scores else 0.0
            
            # Skill level: beginner (0-0.3), intermediate (0.3-0.7), advanced (0.7-1.0)
            skill_score = (avg_complexity + avg_confidence) / 2
            
            if skill_score < 0.3:
                skill_level = "beginner"
            elif skill_score < 0.7:
                skill_level = "intermediate"
            else:
                skill_level = "advanced"
            
            skill_assessments[skill_area] = {
                'level': skill_level,
                'score': skill_score,
                'confidence': avg_confidence,
                'interaction_count': len(skill_interactions),
                'last_interaction': max(i.get('timestamp', '') for i in skill_interactions)
            }
        
        return skill_assessments
    
    def build_user_profile(self, user_id: str, 
                          force_rebuild: bool = False) -> Dict[str, Any]:
        """Build comprehensive user profile"""
        self.logger.info(f"Building user profile for: {user_id}")
        
        # Check cache
        if not force_rebuild and user_id in self.profile_cache:
            last_update = self.last_update.get(user_id, datetime.min)
            if (datetime.now() - last_update).hours < 1:  # Cache for 1 hour
                return self.profile_cache[user_id]
        
        # Get user interactions
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        cursor.execute("""
        SELECT 
            user_input, ai_response, context, timestamp,
            topic_category, intent_classification, sentiment_score,
            complexity_score, confidence_score, user_satisfaction_predicted,
            metadata
        FROM interactions 
        WHERE session_id LIKE ?
        ORDER BY timestamp DESC
        LIMIT 1000
        """, (f"%{user_id}%",))
        
        rows = cursor.fetchall()
        conn.close()
        
        if not rows:
            self.logger.warning(f"No interactions found for user: {user_id}")
            return self._create_default_profile(user_id)
        
        # Convert rows to dictionaries
        interactions = []
        for row in rows:
            interaction = {
                'user_input': row[0],
                'ai_response': row[1],
                'context': row[2],
                'timestamp': row[3],
                'topic_category': row[4],
                'intent_classification': row[5],
                'sentiment_score': row[6],
                'complexity_score': row[7],
                'confidence_score': row[8],
                'user_satisfaction_predicted': row[9],
                'metadata': json.loads(row[10]) if row[10] else {}
            }
            interactions.append(interaction)
        
        # Analyze preferences
        preferences = UserPreferences(
            communication_style=self.analyze_communication_style(interactions),
            detail_level=self.analyze_detail_preference(interactions),
            topic_interests=self.analyze_topic_interests(interactions),
            learning_pace=self.analyze_learning_pace(interactions)
        )
        
        # Analyze behavior patterns
        behavior = self.analyze_behavior_patterns(user_id)
        
        # Assess skill levels
        skill_assessments = self.assess_skill_levels(user_id, interactions)
        
        # Build complete profile
        profile = {
            'user_id': user_id,
            'preferences': asdict(preferences),
            'behavior_patterns': asdict(behavior),
            'skill_assessments': skill_assessments,
            'profile_stats': {
                'total_interactions': len(interactions),
                'date_range': {
                    'first_interaction': interactions[-1]['timestamp'] if interactions else None,
                    'last_interaction': interactions[0]['timestamp'] if interactions else None
                },
                'avg_sentiment': np.mean([i.get('sentiment_score', 0) for i in interactions]),
                'preferred_topics': preferences.topic_interests[:5],
                'activity_score': behavior.engagement_score
            },
            'last_updated': datetime.now().isoformat(),
            'profile_version': 2
        }
        
        # Cache the profile
        self.profile_cache[user_id] = profile
        self.last_update[user_id] = datetime.now()
        
        # Save to database
        self._save_profile_to_db(profile)
        
        self.logger.info(f"Profile built for {user_id}: {len(interactions)} interactions analyzed")
        return profile
    
    def _create_default_profile(self, user_id: str) -> Dict[str, Any]:
        """Create default profile for new users"""
        return {
            'user_id': user_id,
            'preferences': asdict(UserPreferences()),
            'behavior_patterns': asdict(UserBehavior()),
            'skill_assessments': {},
            'profile_stats': {
                'total_interactions': 0,
                'date_range': {'first_interaction': None, 'last_interaction': None},
                'avg_sentiment': 0.0,
                'preferred_topics': [],
                'activity_score': 0.0
            },
            'last_updated': datetime.now().isoformat(),
            'profile_version': 2
        }
    
    def _save_profile_to_db(self, profile: Dict):
        """Save user profile to database"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        cursor.execute("""
        INSERT OR REPLACE INTO user_profiles (
            user_id, preferences, behavior_patterns, topic_interests,
            skill_assessments, learning_history, last_updated, profile_version
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            profile['user_id'],
            json.dumps(profile['preferences']),
            json.dumps(profile['behavior_patterns']),
            json.dumps(profile['preferences']['topic_interests']),
            json.dumps(profile['skill_assessments']),
            json.dumps(profile['profile_stats']),
            profile['last_updated'],
            profile['profile_version']
        ))
        
        conn.commit()
        conn.close()
    
    def get_personalization_context(self, user_id: str) -> Dict[str, Any]:
        """Get personalization context for AI responses"""
        profile = self.build_user_profile(user_id)
        
        context = {
            'communication_style': profile['preferences']['communication_style'],
            'detail_level': profile['preferences']['detail_level'],
            'learning_pace': profile['preferences']['learning_pace'],
            'topic_interests': profile['preferences']['topic_interests'][:3],
            'skill_levels': {
                area: assessment['level'] 
                for area, assessment in profile['skill_assessments'].items()
            },
            'engagement_level': profile['behavior_patterns']['engagement_score'],
            'preferred_question_types': list(profile['behavior_patterns']['question_types'].keys())[:3]
        }
        
        return context
    
    def update_profile_from_feedback(self, user_id: str, 
                                   interaction_data: Dict,
                                   feedback_data: Dict):
        """Update user profile based on new feedback"""
        # This would update the profile with new information
        # For now, we'll mark the profile for rebuild
        if user_id in self.profile_cache:
            del self.profile_cache[user_id]
        
        self.logger.info(f"Profile invalidated for {user_id} due to new feedback")

if __name__ == "__main__":
    # Test user profile builder
    profile_builder = UserProfileBuilder()
    
    # Build profile for a test user
    user_id = "test_user_123"
    profile = profile_builder.build_user_profile(user_id)
    
    print(f"User Profile: {json.dumps(profile, indent=2)}")
    
    # Get personalization context
    context = profile_builder.get_personalization_context(user_id)
    print(f"Personalization Context: {json.dumps(context, indent=2)}")