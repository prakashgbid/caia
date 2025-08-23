#!/usr/bin/env python3
"""
ConfidenceScorer - Hierarchical Agent System Stream 3
Calculates confidence scores for each hierarchy level with dynamic threshold adjustment
Integrates with existing context management system
"""

import os
import json
import sqlite3
import numpy as np
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, List, Any, Optional, Tuple
import logging
from dataclasses import dataclass, asdict
from collections import defaultdict
import hashlib
from sklearn.preprocessing import StandardScaler
from sklearn.ensemble import RandomForestRegressor
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, precision_recall_curve
import warnings
warnings.filterwarnings('ignore')

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Configuration
ADMIN_ROOT = "/Users/MAC/Documents/projects/admin"
DB_PATH = os.path.join(ADMIN_ROOT, "confidence_scoring.db")

@dataclass
class ConfidenceScore:
    item_id: str
    item_type: str
    hierarchy_level: int
    base_score: float
    adjusted_score: float
    factors: Dict[str, float]
    threshold_met: bool
    quality_prediction: float
    timestamp: datetime
    metadata: Optional[Dict[str, Any]] = None

@dataclass
class ConfidenceThreshold:
    hierarchy_level: int
    item_type: str
    base_threshold: float
    dynamic_threshold: float
    success_rate_at_threshold: float
    false_positive_rate: float
    last_updated: datetime

class ConfidenceScorer:
    """
    Advanced confidence scoring system for hierarchical breakdowns
    Uses multiple factors and ML models to predict success likelihood
    """
    
    def __init__(self, db_path: str = DB_PATH):
        self.db_path = db_path
        self.admin_root = Path(ADMIN_ROOT)
        self.admin_root.mkdir(parents=True, exist_ok=True)
        
        self._init_database()
        self._init_scoring_models()
        
        # Confidence factors and their weights
        self.confidence_factors = {
            'completeness': 0.25,      # How complete is the description/breakdown
            'clarity': 0.20,           # How clear and unambiguous
            'precedent': 0.20,         # How similar to past successful items
            'team_experience': 0.15,   # Team's experience with similar items
            'external_dependencies': 0.10,  # Number of external dependencies
            'complexity_alignment': 0.10     # Alignment between estimated and actual complexity
        }
        
        # Base thresholds by hierarchy level
        self.base_thresholds = {
            1: 0.9,  # Ideas - very high threshold
            2: 0.85, # Initiatives - high threshold  
            3: 0.8,  # Features - high threshold
            4: 0.75, # Epics - medium-high threshold
            5: 0.7,  # Stories - medium threshold
            6: 0.65, # Tasks - medium-low threshold
            7: 0.6   # Subtasks - lower threshold
        }
        
    def _init_database(self):
        """Initialize SQLite database for confidence data"""
        with sqlite3.connect(self.db_path) as conn:
            conn.execute('''
                CREATE TABLE IF NOT EXISTS confidence_scores (
                    score_id TEXT PRIMARY KEY,
                    item_id TEXT NOT NULL,
                    item_type TEXT NOT NULL,
                    hierarchy_level INTEGER NOT NULL,
                    base_score REAL NOT NULL,
                    adjusted_score REAL NOT NULL,
                    factors TEXT NOT NULL,
                    threshold_met INTEGER NOT NULL,
                    quality_prediction REAL NOT NULL,
                    timestamp TEXT NOT NULL,
                    metadata TEXT
                )
            ''')
            
            conn.execute('''
                CREATE TABLE IF NOT EXISTS confidence_thresholds (
                    threshold_id TEXT PRIMARY KEY,
                    hierarchy_level INTEGER NOT NULL,
                    item_type TEXT NOT NULL,
                    base_threshold REAL NOT NULL,
                    dynamic_threshold REAL NOT NULL,
                    success_rate_at_threshold REAL DEFAULT 0.0,
                    false_positive_rate REAL DEFAULT 0.0,
                    last_updated TEXT NOT NULL,
                    UNIQUE(hierarchy_level, item_type)
                )
            ''')
            
            conn.execute('''
                CREATE TABLE IF NOT EXISTS historical_outcomes (
                    outcome_id TEXT PRIMARY KEY,
                    item_id TEXT NOT NULL,
                    predicted_confidence REAL NOT NULL,
                    actual_success INTEGER NOT NULL,
                    success_metrics TEXT,
                    failure_reasons TEXT,
                    completion_date TEXT NOT NULL,
                    lessons_learned TEXT
                )
            ''')
            
            conn.execute('''
                CREATE TABLE IF NOT EXISTS factor_analysis (
                    analysis_id TEXT PRIMARY KEY,
                    factor_name TEXT NOT NULL,
                    hierarchy_level INTEGER NOT NULL,
                    correlation_with_success REAL NOT NULL,
                    optimal_threshold REAL,
                    predictive_power REAL NOT NULL,
                    analysis_date TEXT NOT NULL
                )
            ''')
            
            conn.execute('''
                CREATE TABLE IF NOT EXISTS confidence_calibration (
                    calibration_id TEXT PRIMARY KEY,
                    confidence_range_min REAL NOT NULL,
                    confidence_range_max REAL NOT NULL,
                    actual_success_rate REAL NOT NULL,
                    sample_count INTEGER NOT NULL,
                    calibration_error REAL NOT NULL,
                    calibration_date TEXT NOT NULL
                )
            ''')
            
            # Create indexes
            conn.execute('CREATE INDEX IF NOT EXISTS idx_confidence_item ON confidence_scores(item_id)')
            conn.execute('CREATE INDEX IF NOT EXISTS idx_confidence_level ON confidence_scores(hierarchy_level)')
            conn.execute('CREATE INDEX IF NOT EXISTS idx_outcomes_completion ON historical_outcomes(completion_date)')
    
    def _init_scoring_models(self):
        """Initialize ML models for confidence scoring"""
        self.regression_model = RandomForestRegressor(
            n_estimators=100, 
            random_state=42,
            max_depth=10
        )
        self.classification_model = LogisticRegression(
            random_state=42,
            class_weight='balanced'
        )
        self.scaler = StandardScaler()
        self.models_trained = False
        
    def calculate_confidence_score(self,
                                 item_id: str,
                                 item_type: str,
                                 hierarchy_level: int,
                                 item_data: Dict[str, Any],
                                 historical_context: Optional[Dict[str, Any]] = None) -> ConfidenceScore:
        """Calculate comprehensive confidence score for an item"""
        
        # Calculate individual factor scores
        factor_scores = {}
        
        # Completeness factor
        factor_scores['completeness'] = self._assess_completeness(item_data, item_type)
        
        # Clarity factor
        factor_scores['clarity'] = self._assess_clarity(item_data)
        
        # Precedent factor
        factor_scores['precedent'] = self._assess_precedent(
            item_type, item_data, historical_context
        )
        
        # Team experience factor
        factor_scores['team_experience'] = self._assess_team_experience(
            item_data, historical_context
        )
        
        # External dependencies factor
        factor_scores['external_dependencies'] = self._assess_dependencies(item_data)
        
        # Complexity alignment factor
        factor_scores['complexity_alignment'] = self._assess_complexity_alignment(item_data)
        
        # Calculate base confidence score
        base_score = sum(
            factor_scores[factor] * weight 
            for factor, weight in self.confidence_factors.items()
        )
        
        # Apply hierarchy level adjustments
        level_adjustment = self._get_hierarchy_level_adjustment(hierarchy_level)
        adjusted_score = min(1.0, base_score * level_adjustment)
        
        # Get threshold for this level and type
        threshold = self._get_dynamic_threshold(hierarchy_level, item_type)
        threshold_met = adjusted_score >= threshold
        
        # Predict quality outcome
        quality_prediction = self._predict_quality_outcome(
            adjusted_score, factor_scores, hierarchy_level, item_type
        )
        
        # Create confidence score object
        score = ConfidenceScore(
            item_id=item_id,
            item_type=item_type,
            hierarchy_level=hierarchy_level,
            base_score=base_score,
            adjusted_score=adjusted_score,
            factors=factor_scores,
            threshold_met=threshold_met,
            quality_prediction=quality_prediction,
            timestamp=datetime.now(),
            metadata={
                'threshold_used': threshold,
                'level_adjustment': level_adjustment,
                'model_version': '1.0'
            }
        )
        
        # Store the score
        self._store_confidence_score(score)
        
        logger.info(f"Calculated confidence: {item_id} = {adjusted_score:.3f} ({'PASS' if threshold_met else 'FAIL'})")
        
        return score
    
    def _assess_completeness(self, item_data: Dict[str, Any], item_type: str) -> float:
        """Assess how complete the item definition is"""
        required_fields = {
            'idea': ['title', 'description', 'market_analysis'],
            'initiative': ['title', 'description', 'objectives', 'timeline'],
            'feature': ['title', 'description', 'user_stories', 'acceptance_criteria'],
            'epic': ['title', 'description', 'acceptance_criteria'],
            'story': ['title', 'description', 'acceptance_criteria', 'story_points'],
            'task': ['title', 'description', 'estimated_hours'],
            'subtask': ['title', 'description', 'estimated_hours']
        }
        
        required = required_fields.get(item_type.lower(), ['title', 'description'])
        present_count = 0
        quality_score = 0
        
        for field in required:
            value = item_data.get(field)
            if value:
                present_count += 1
                # Assess quality of content
                if isinstance(value, str):
                    if len(value.strip()) > 20:  # Meaningful content
                        quality_score += 1
                    elif len(value.strip()) > 5:  # Basic content
                        quality_score += 0.5
                elif isinstance(value, (list, dict)) and value:
                    quality_score += 1
        
        # Combine presence and quality
        presence_score = present_count / len(required)
        quality_score = quality_score / len(required)
        
        return (presence_score * 0.6) + (quality_score * 0.4)
    
    def _assess_clarity(self, item_data: Dict[str, Any]) -> float:
        """Assess clarity and unambiguity of the item"""
        clarity_indicators = []
        
        # Check title clarity
        title = item_data.get('title', '')
        if title:
            # Avoid vague words
            vague_words = {'thing', 'stuff', 'something', 'various', 'misc', 'other'}
            title_lower = title.lower()
            vague_count = sum(1 for word in vague_words if word in title_lower)
            title_clarity = max(0, 1 - (vague_count * 0.3))
            clarity_indicators.append(title_clarity)
        
        # Check description clarity
        description = item_data.get('description', '')
        if description:
            desc_lower = description.lower()
            
            # Positive indicators
            positive_words = {'specific', 'exactly', 'precisely', 'clearly', 'defined'}
            positive_count = sum(1 for word in positive_words if word in desc_lower)
            
            # Negative indicators  
            uncertain_words = {'maybe', 'possibly', 'perhaps', 'probably', 'might', 'could', 'unclear'}
            uncertain_count = sum(1 for word in uncertain_words if word in desc_lower)
            
            desc_clarity = 0.5 + (positive_count * 0.1) - (uncertain_count * 0.1)
            desc_clarity = max(0, min(1, desc_clarity))
            clarity_indicators.append(desc_clarity)
        
        # Check acceptance criteria clarity
        criteria = item_data.get('acceptance_criteria', [])
        if criteria:
            if isinstance(criteria, list) and len(criteria) > 0:
                criteria_clarity = 0.8  # Having criteria is good
                # Check for testable criteria
                testable_words = {'verify', 'test', 'check', 'validate', 'confirm', 'ensure'}
                testable_count = 0
                for criterion in criteria:
                    if isinstance(criterion, str):
                        if any(word in criterion.lower() for word in testable_words):
                            testable_count += 1
                
                if len(criteria) > 0:
                    testable_ratio = testable_count / len(criteria)
                    criteria_clarity += testable_ratio * 0.2
                    
                clarity_indicators.append(min(1, criteria_clarity))
        
        return np.mean(clarity_indicators) if clarity_indicators else 0.3
    
    def _assess_precedent(self, 
                         item_type: str,
                         item_data: Dict[str, Any],
                         historical_context: Optional[Dict[str, Any]]) -> float:
        """Assess similarity to past successful items"""
        if not historical_context:
            return 0.4  # Neutral score without historical data
        
        similar_items = historical_context.get('similar_items', [])
        if not similar_items:
            return 0.4
        
        # Calculate similarity score
        current_features = self._extract_item_features(item_data, item_type)
        similarity_scores = []
        
        for similar_item in similar_items:
            if similar_item.get('success', False):
                similar_features = self._extract_item_features(
                    similar_item.get('data', {}), 
                    similar_item.get('type', item_type)
                )
                
                similarity = self._calculate_feature_similarity(current_features, similar_features)
                success_weight = similar_item.get('success_score', 0.5)
                weighted_similarity = similarity * success_weight
                similarity_scores.append(weighted_similarity)
        
        if similarity_scores:
            # Use highest similarity with successful precedent
            return max(similarity_scores)
        
        return 0.4
    
    def _extract_item_features(self, item_data: Dict[str, Any], item_type: str) -> Dict[str, Any]:
        """Extract comparable features from item data"""
        features = {
            'type': item_type,
            'has_timeline': 'timeline' in item_data,
            'has_acceptance_criteria': bool(item_data.get('acceptance_criteria')),
            'has_dependencies': bool(item_data.get('dependencies')),
            'estimated_complexity': item_data.get('complexity', 5),
            'word_count': len(str(item_data.get('description', '')).split()),
            'has_resources': 'resources' in item_data or 'team' in item_data
        }
        
        # Add text-based features
        text_content = ' '.join([
            str(item_data.get('title', '')),
            str(item_data.get('description', ''))
        ]).lower()
        
        # Technical vs business focus
        technical_words = {'api', 'database', 'service', 'endpoint', 'integration', 'auth', 'security'}
        business_words = {'user', 'customer', 'business', 'value', 'revenue', 'market', 'stakeholder'}
        
        technical_count = sum(1 for word in technical_words if word in text_content)
        business_count = sum(1 for word in business_words if word in text_content)
        
        features['technical_focus'] = technical_count / (technical_count + business_count + 1)
        features['business_focus'] = business_count / (technical_count + business_count + 1)
        
        return features
    
    def _calculate_feature_similarity(self, features1: Dict[str, Any], features2: Dict[str, Any]) -> float:
        """Calculate similarity between feature sets"""
        similarities = []
        
        # Boolean features
        bool_features = ['has_timeline', 'has_acceptance_criteria', 'has_dependencies', 'has_resources']
        for feature in bool_features:
            if feature in features1 and feature in features2:
                similarities.append(1.0 if features1[feature] == features2[feature] else 0.0)
        
        # Categorical features
        if features1.get('type') == features2.get('type'):
            similarities.append(1.0)
        else:
            similarities.append(0.0)
        
        # Numerical features
        numerical_features = ['estimated_complexity', 'word_count', 'technical_focus', 'business_focus']
        for feature in numerical_features:
            val1 = features1.get(feature, 0)
            val2 = features2.get(feature, 0)
            
            if val1 == 0 and val2 == 0:
                similarities.append(1.0)
            elif val1 == 0 or val2 == 0:
                similarities.append(0.0)
            else:
                similarity = 1.0 - abs(val1 - val2) / max(val1, val2)
                similarities.append(max(0.0, similarity))
        
        return np.mean(similarities) if similarities else 0.0
    
    def _assess_team_experience(self, 
                               item_data: Dict[str, Any],
                               historical_context: Optional[Dict[str, Any]]) -> float:
        """Assess team's experience with similar items"""
        if not historical_context:
            return 0.5  # Neutral score
        
        team_info = historical_context.get('team_experience', {})
        if not team_info:
            return 0.5
        
        # Get team members assigned to this item
        assigned_team = item_data.get('assigned_team', [])
        if isinstance(assigned_team, str):
            assigned_team = [assigned_team]
        
        if not assigned_team:
            # Use project team if no specific assignment
            assigned_team = team_info.get('project_team', [])
        
        if not assigned_team:
            return 0.5
        
        # Calculate team experience score
        experience_scores = []
        for member in assigned_team:
            member_exp = team_info.get(member, {})
            if member_exp:
                # Consider success rate and number of similar items completed
                success_rate = member_exp.get('success_rate', 0.5)
                similar_items_count = member_exp.get('similar_items_completed', 0)
                
                # Experience factor based on count (diminishing returns)
                exp_factor = min(1.0, similar_items_count / 10.0)
                
                member_score = (success_rate * 0.7) + (exp_factor * 0.3)
                experience_scores.append(member_score)
            else:
                experience_scores.append(0.3)  # New team member
        
        return np.mean(experience_scores) if experience_scores else 0.5
    
    def _assess_dependencies(self, item_data: Dict[str, Any]) -> float:
        """Assess risk from external dependencies"""
        dependencies = item_data.get('dependencies', [])
        external_deps = item_data.get('external_dependencies', [])
        
        all_deps = []
        if isinstance(dependencies, list):
            all_deps.extend(dependencies)
        if isinstance(external_deps, list):
            all_deps.extend(external_deps)
        
        dep_count = len(all_deps)
        
        if dep_count == 0:
            return 1.0  # No dependencies = high confidence
        elif dep_count <= 2:
            return 0.8  # Few dependencies = good
        elif dep_count <= 5:
            return 0.6  # Some dependencies = moderate risk
        else:
            return max(0.2, 1.0 - (dep_count * 0.1))  # Many dependencies = higher risk
    
    def _assess_complexity_alignment(self, item_data: Dict[str, Any]) -> float:
        """Assess alignment between estimated and perceived complexity"""
        estimated_complexity = item_data.get('complexity', 5)
        estimated_hours = item_data.get('estimated_hours', 0)
        
        # Infer complexity from other indicators
        description_length = len(str(item_data.get('description', '')))
        criteria_count = len(item_data.get('acceptance_criteria', []))
        dependencies_count = len(item_data.get('dependencies', []))
        
        # Calculate implied complexity
        implied_complexity = 1  # Base complexity
        
        if description_length > 500:
            implied_complexity += 2
        elif description_length > 200:
            implied_complexity += 1
        
        if criteria_count > 5:
            implied_complexity += 2
        elif criteria_count > 2:
            implied_complexity += 1
        
        if dependencies_count > 3:
            implied_complexity += 2
        elif dependencies_count > 0:
            implied_complexity += 1
        
        implied_complexity = min(10, implied_complexity)
        
        # Calculate alignment
        if estimated_complexity == 0:
            return 0.5  # No estimate provided
        
        alignment = 1.0 - abs(estimated_complexity - implied_complexity) / 10.0
        return max(0.0, alignment)
    
    def _get_hierarchy_level_adjustment(self, level: int) -> float:
        """Get confidence adjustment factor based on hierarchy level"""
        # Higher levels (ideas, initiatives) should have higher confidence requirements
        # Lower levels (tasks, subtasks) can have lower confidence
        adjustments = {
            1: 1.0,   # Ideas - no adjustment (already high threshold)
            2: 1.05,  # Initiatives - slight boost
            3: 1.1,   # Features - small boost
            4: 1.15,  # Epics - moderate boost
            5: 1.2,   # Stories - higher boost
            6: 1.25,  # Tasks - significant boost
            7: 1.3    # Subtasks - highest boost
        }
        
        return adjustments.get(level, 1.0)
    
    def _get_dynamic_threshold(self, hierarchy_level: int, item_type: str) -> float:
        """Get dynamically adjusted threshold for the item"""
        # Try to get stored dynamic threshold
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.execute('''
                SELECT dynamic_threshold FROM confidence_thresholds 
                WHERE hierarchy_level = ? AND item_type = ?
            ''', (hierarchy_level, item_type))
            
            result = cursor.fetchone()
            
        if result:
            return result[0]
        
        # Fall back to base threshold
        return self.base_thresholds.get(hierarchy_level, 0.7)
    
    def _predict_quality_outcome(self, 
                                confidence_score: float,
                                factor_scores: Dict[str, float],
                                hierarchy_level: int,
                                item_type: str) -> float:
        """Predict the likelihood of successful outcome"""
        if not self.models_trained:
            return confidence_score  # Simple fallback
        
        # Prepare features for ML model
        features = [
            confidence_score,
            factor_scores.get('completeness', 0),
            factor_scores.get('clarity', 0),
            factor_scores.get('precedent', 0),
            factor_scores.get('team_experience', 0),
            factor_scores.get('external_dependencies', 0),
            factor_scores.get('complexity_alignment', 0),
            hierarchy_level,
            1.0  # Placeholder for item type encoding
        ]
        
        try:
            features_scaled = self.scaler.transform([features])
            prediction = self.regression_model.predict(features_scaled)[0]
            return max(0.0, min(1.0, prediction))
        except:
            return confidence_score
    
    def _store_confidence_score(self, score: ConfidenceScore):
        """Store confidence score in database"""
        score_id = hashlib.md5(
            f"{score.item_id}_{score.timestamp.isoformat()}".encode()
        ).hexdigest()
        
        with sqlite3.connect(self.db_path) as conn:
            conn.execute('''
                INSERT OR REPLACE INTO confidence_scores 
                (score_id, item_id, item_type, hierarchy_level, base_score,
                 adjusted_score, factors, threshold_met, quality_prediction,
                 timestamp, metadata)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (
                score_id, score.item_id, score.item_type, score.hierarchy_level,
                score.base_score, score.adjusted_score, json.dumps(score.factors),
                1 if score.threshold_met else 0, score.quality_prediction,
                score.timestamp.isoformat(), json.dumps(score.metadata)
            ))
    
    def record_outcome(self,
                      item_id: str,
                      success: bool,
                      success_metrics: Optional[Dict[str, Any]] = None,
                      failure_reasons: Optional[List[str]] = None,
                      lessons_learned: Optional[str] = None):
        """Record actual outcome for confidence score calibration"""
        # Get the confidence score for this item
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.execute('''
                SELECT adjusted_score FROM confidence_scores 
                WHERE item_id = ? ORDER BY timestamp DESC LIMIT 1
            ''', (item_id,))
            
            result = cursor.fetchone()
            
        if not result:
            logger.warning(f"No confidence score found for item {item_id}")
            return
        
        predicted_confidence = result[0]
        
        outcome_id = f"outcome_{item_id}_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
        
        with sqlite3.connect(self.db_path) as conn:
            conn.execute('''
                INSERT INTO historical_outcomes 
                (outcome_id, item_id, predicted_confidence, actual_success,
                 success_metrics, failure_reasons, completion_date, lessons_learned)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ''', (
                outcome_id, item_id, predicted_confidence, 1 if success else 0,
                json.dumps(success_metrics or {}),
                json.dumps(failure_reasons or []),
                datetime.now().isoformat(),
                lessons_learned
            ))
        
        logger.info(f"Recorded outcome: {item_id} = {'SUCCESS' if success else 'FAILURE'}")
        
        # Trigger threshold recalibration
        self._recalibrate_thresholds()
    
    def _recalibrate_thresholds(self):
        """Recalibrate confidence thresholds based on historical outcomes"""
        with sqlite3.connect(self.db_path) as conn:
            # Get all historical outcomes with confidence scores
            cursor = conn.execute('''
                SELECT cs.hierarchy_level, cs.item_type, ho.predicted_confidence, ho.actual_success
                FROM historical_outcomes ho
                JOIN confidence_scores cs ON ho.item_id = cs.item_id
                WHERE ho.completion_date > date('now', '-90 days')
            ''')
            
            outcomes_data = cursor.fetchall()
        
        if len(outcomes_data) < 10:  # Need minimum data for calibration
            return
        
        # Group by hierarchy level and item type
        grouped_data = defaultdict(list)
        for level, item_type, confidence, success in outcomes_data:
            grouped_data[(level, item_type)].append((confidence, success))
        
        # Recalibrate thresholds for each group
        for (level, item_type), data in grouped_data.items():
            if len(data) < 5:  # Need minimum data per group
                continue
            
            confidences = [d[0] for d in data]
            successes = [d[1] for d in data]
            
            # Find optimal threshold using precision-recall curve
            optimal_threshold = self._find_optimal_threshold(confidences, successes)
            
            # Calculate metrics at this threshold
            predictions = [1 if c >= optimal_threshold else 0 for c in confidences]
            success_rate = np.mean([s for i, s in enumerate(successes) if predictions[i] == 1])
            false_positive_rate = np.mean([1-s for i, s in enumerate(successes) if predictions[i] == 1])
            
            # Store updated threshold
            threshold_id = f"thresh_{level}_{item_type}"
            base_threshold = self.base_thresholds.get(level, 0.7)
            
            with sqlite3.connect(self.db_path) as conn:
                conn.execute('''
                    INSERT OR REPLACE INTO confidence_thresholds 
                    (threshold_id, hierarchy_level, item_type, base_threshold,
                     dynamic_threshold, success_rate_at_threshold, false_positive_rate, last_updated)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ''', (
                    threshold_id, level, item_type, base_threshold,
                    optimal_threshold, success_rate, false_positive_rate,
                    datetime.now().isoformat()
                ))
            
            logger.info(f"Updated threshold for {item_type} L{level}: {optimal_threshold:.3f}")
    
    def _find_optimal_threshold(self, confidences: List[float], successes: List[int]) -> float:
        """Find optimal threshold using F1 score"""
        if len(set(successes)) < 2:  # Need both success and failure cases
            return np.mean(confidences)
        
        try:
            precision, recall, thresholds = precision_recall_curve(successes, confidences)
            
            # Calculate F1 scores
            f1_scores = []
            for p, r in zip(precision, recall):
                if p + r > 0:
                    f1_scores.append(2 * p * r / (p + r))
                else:
                    f1_scores.append(0)
            
            # Find threshold with best F1 score
            best_idx = np.argmax(f1_scores)
            
            if best_idx < len(thresholds):
                return thresholds[best_idx]
            else:
                return np.mean(confidences)
                
        except Exception as e:
            logger.warning(f"Threshold optimization failed: {e}")
            return np.mean(confidences)
    
    def train_prediction_models(self, min_samples: int = 50) -> Dict[str, Any]:
        """Train ML models for quality prediction"""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.execute('''
                SELECT cs.adjusted_score, cs.factors, cs.hierarchy_level, 
                       cs.item_type, ho.actual_success
                FROM confidence_scores cs
                JOIN historical_outcomes ho ON cs.item_id = ho.item_id
                WHERE ho.completion_date > date('now', '-180 days')
            ''')
            
            training_data = cursor.fetchall()
        
        if len(training_data) < min_samples:
            logger.warning(f"Insufficient training data: {len(training_data)} samples")
            return {'error': 'Insufficient training data'}
        
        # Prepare training data
        X = []
        y = []
        
        for row in training_data:
            confidence, factors_str, level, item_type, success = row
            
            try:
                factors = json.loads(factors_str)
                
                features = [
                    confidence,
                    factors.get('completeness', 0),
                    factors.get('clarity', 0),
                    factors.get('precedent', 0),
                    factors.get('team_experience', 0),
                    factors.get('external_dependencies', 0),
                    factors.get('complexity_alignment', 0),
                    level,
                    1.0  # Placeholder for item type
                ]
                
                X.append(features)
                y.append(success)
                
            except Exception as e:
                logger.warning(f"Error processing training sample: {e}")
                continue
        
        if len(X) < min_samples:
            return {'error': 'Insufficient valid training data'}
        
        # Split data
        from sklearn.model_selection import train_test_split
        X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)
        
        # Scale features
        X_train_scaled = self.scaler.fit_transform(X_train)
        X_test_scaled = self.scaler.transform(X_test)
        
        # Train regression model
        self.regression_model.fit(X_train_scaled, y_train)
        
        # Train classification model
        self.classification_model.fit(X_train_scaled, y_train)
        
        # Evaluate models
        reg_predictions = self.regression_model.predict(X_test_scaled)
        class_predictions = self.classification_model.predict(X_test_scaled)
        
        results = {
            'training_samples': len(X_train),
            'test_samples': len(X_test),
            'regression_mae': np.mean(np.abs(reg_predictions - y_test)),
            'classification_accuracy': accuracy_score(y_test, class_predictions),
            'feature_importance': dict(zip(
                ['confidence', 'completeness', 'clarity', 'precedent', 
                 'team_experience', 'external_deps', 'complexity_alignment', 
                 'hierarchy_level', 'item_type'],
                self.regression_model.feature_importances_
            ))
        }
        
        self.models_trained = True
        logger.info("Models trained successfully")
        
        return results
    
    def analyze_confidence_patterns(self, 
                                  time_period_days: int = 90) -> Dict[str, Any]:
        """Analyze confidence scoring patterns and accuracy"""
        start_date = datetime.now() - timedelta(days=time_period_days)
        
        with sqlite3.connect(self.db_path) as conn:
            # Get confidence scores with outcomes
            cursor = conn.execute('''
                SELECT cs.*, ho.actual_success
                FROM confidence_scores cs
                LEFT JOIN historical_outcomes ho ON cs.item_id = ho.item_id
                WHERE cs.timestamp > ?
            ''', (start_date.isoformat(),))
            
            scores_with_outcomes = cursor.fetchall()
        
        analysis = {
            'period_days': time_period_days,
            'total_scores': len(scores_with_outcomes),
            'scores_with_outcomes': 0,
            'calibration': {},
            'factor_analysis': {},
            'threshold_analysis': {},
            'recommendations': []
        }
        
        # Separate scores with and without outcomes
        scores_with_known_outcomes = [
            row for row in scores_with_outcomes if row[-1] is not None
        ]
        
        analysis['scores_with_outcomes'] = len(scores_with_known_outcomes)
        
        if len(scores_with_known_outcomes) < 10:
            analysis['recommendations'].append("Need more historical outcomes for meaningful analysis")
            return analysis
        
        # Calibration analysis
        analysis['calibration'] = self._analyze_calibration(scores_with_known_outcomes)
        
        # Factor importance analysis
        analysis['factor_analysis'] = self._analyze_factor_importance(scores_with_known_outcomes)
        
        # Threshold effectiveness analysis
        analysis['threshold_analysis'] = self._analyze_threshold_effectiveness(scores_with_known_outcomes)
        
        # Generate recommendations
        analysis['recommendations'] = self._generate_analysis_recommendations(analysis)
        
        return analysis
    
    def _analyze_calibration(self, scores_with_outcomes: List[Tuple]) -> Dict[str, Any]:
        """Analyze how well confidence scores match actual outcomes"""
        calibration_bins = np.arange(0, 1.1, 0.1)
        calibration_data = []
        
        for i in range(len(calibration_bins) - 1):
            bin_min = calibration_bins[i]
            bin_max = calibration_bins[i + 1]
            
            bin_scores = [
                row for row in scores_with_outcomes
                if bin_min <= row[5] < bin_max  # adjusted_score column
            ]
            
            if bin_scores:
                predicted_confidence = np.mean([row[5] for row in bin_scores])
                actual_success_rate = np.mean([row[-1] for row in bin_scores])
                calibration_error = abs(predicted_confidence - actual_success_rate)
                
                calibration_data.append({
                    'confidence_range': f"{bin_min:.1f}-{bin_max:.1f}",
                    'sample_count': len(bin_scores),
                    'predicted_confidence': predicted_confidence,
                    'actual_success_rate': actual_success_rate,
                    'calibration_error': calibration_error
                })
        
        # Calculate overall calibration metrics
        if calibration_data:
            avg_calibration_error = np.mean([d['calibration_error'] for d in calibration_data])
            max_calibration_error = max([d['calibration_error'] for d in calibration_data])
            
            calibration_quality = 'good' if avg_calibration_error < 0.1 else 'needs_improvement'
        else:
            avg_calibration_error = 0
            max_calibration_error = 0
            calibration_quality = 'insufficient_data'
        
        return {
            'bin_analysis': calibration_data,
            'average_calibration_error': avg_calibration_error,
            'max_calibration_error': max_calibration_error,
            'calibration_quality': calibration_quality
        }
    
    def _analyze_factor_importance(self, scores_with_outcomes: List[Tuple]) -> Dict[str, Any]:
        """Analyze which factors are most predictive of success"""
        factor_correlations = {}
        
        for row in scores_with_outcomes:
            try:
                factors_str = row[6]  # factors column
                actual_success = row[-1]
                factors = json.loads(factors_str)
                
                for factor_name, factor_score in factors.items():
                    if factor_name not in factor_correlations:
                        factor_correlations[factor_name] = {'scores': [], 'outcomes': []}
                    
                    factor_correlations[factor_name]['scores'].append(factor_score)
                    factor_correlations[factor_name]['outcomes'].append(actual_success)
                    
            except:
                continue
        
        # Calculate correlations
        factor_analysis = {}
        for factor_name, data in factor_correlations.items():
            if len(data['scores']) > 5:
                correlation = np.corrcoef(data['scores'], data['outcomes'])[0, 1]
                if not np.isnan(correlation):
                    factor_analysis[factor_name] = {
                        'correlation_with_success': correlation,
                        'sample_count': len(data['scores']),
                        'average_score': np.mean(data['scores']),
                        'predictive_power': abs(correlation)
                    }
        
        # Sort by predictive power
        sorted_factors = sorted(
            factor_analysis.items(),
            key=lambda x: x[1]['predictive_power'],
            reverse=True
        )
        
        return {
            'factor_correlations': dict(sorted_factors),
            'most_predictive': sorted_factors[0][0] if sorted_factors else None,
            'least_predictive': sorted_factors[-1][0] if sorted_factors else None
        }
    
    def _analyze_threshold_effectiveness(self, scores_with_outcomes: List[Tuple]) -> Dict[str, Any]:
        """Analyze effectiveness of current thresholds"""
        threshold_analysis = defaultdict(lambda: {
            'above_threshold': [],
            'below_threshold': []
        })
        
        for row in scores_with_outcomes:
            hierarchy_level = row[3]
            threshold_met = bool(row[7])  # threshold_met column
            actual_success = row[-1]
            
            key = f"level_{hierarchy_level}"
            
            if threshold_met:
                threshold_analysis[key]['above_threshold'].append(actual_success)
            else:
                threshold_analysis[key]['below_threshold'].append(actual_success)
        
        # Calculate effectiveness metrics
        effectiveness_data = {}
        for level_key, data in threshold_analysis.items():
            above_count = len(data['above_threshold'])
            below_count = len(data['below_threshold'])
            
            if above_count > 0 and below_count > 0:
                above_success_rate = np.mean(data['above_threshold'])
                below_success_rate = np.mean(data['below_threshold'])
                
                effectiveness_data[level_key] = {
                    'above_threshold_success_rate': above_success_rate,
                    'below_threshold_success_rate': below_success_rate,
                    'threshold_effectiveness': above_success_rate - below_success_rate,
                    'sample_counts': {
                        'above': above_count,
                        'below': below_count
                    }
                }
        
        return effectiveness_data
    
    def _generate_analysis_recommendations(self, analysis: Dict[str, Any]) -> List[str]:
        """Generate recommendations based on confidence analysis"""
        recommendations = []
        
        # Calibration recommendations
        calibration = analysis.get('calibration', {})
        if calibration.get('calibration_quality') == 'needs_improvement':
            avg_error = calibration.get('average_calibration_error', 0)
            recommendations.append(
                f"Calibration needs improvement (avg error: {avg_error:.3f}). "
                "Consider retraining models or adjusting thresholds."
            )
        
        # Factor analysis recommendations
        factor_analysis = analysis.get('factor_analysis', {})
        most_predictive = factor_analysis.get('most_predictive')
        if most_predictive:
            recommendations.append(
                f"Factor '{most_predictive}' is most predictive of success. "
                "Focus on improving this factor in assessments."
            )
        
        least_predictive = factor_analysis.get('least_predictive')
        if least_predictive:
            recommendations.append(
                f"Factor '{least_predictive}' shows low predictive power. "
                "Consider reducing its weight or improving measurement."
            )
        
        # Threshold effectiveness recommendations
        threshold_analysis = analysis.get('threshold_analysis', {})
        for level, data in threshold_analysis.items():
            effectiveness = data.get('threshold_effectiveness', 0)
            if effectiveness < 0.1:
                recommendations.append(
                    f"Threshold for {level} shows low effectiveness ({effectiveness:.3f}). "
                    "Consider adjusting threshold values."
                )
        
        # Data quantity recommendations
        if analysis.get('scores_with_outcomes', 0) < 50:
            recommendations.append(
                "Limited outcome data available. Focus on recording more completion outcomes "
                "to improve confidence scoring accuracy."
            )
        
        return recommendations

def main():
    """Main function for CLI usage"""
    import argparse
    
    parser = argparse.ArgumentParser(description="Confidence Scoring System")
    parser.add_argument("--action", choices=[
        'score', 'record_outcome', 'train', 'analyze', 'recalibrate'
    ], required=True, help="Action to perform")
    
    # Scoring arguments
    parser.add_argument("--item-id", help="Item ID")
    parser.add_argument("--item-type", help="Item type")
    parser.add_argument("--hierarchy-level", type=int, help="Hierarchy level")
    parser.add_argument("--item-data", help="JSON string with item data")
    parser.add_argument("--historical-context", help="JSON string with historical context")
    
    # Outcome recording arguments
    parser.add_argument("--success", type=bool, help="Whether item was successful")
    parser.add_argument("--success-metrics", help="JSON string with success metrics")
    parser.add_argument("--failure-reasons", help="JSON string with failure reasons")
    parser.add_argument("--lessons-learned", help="Lessons learned")
    
    # Analysis arguments
    parser.add_argument("--time-period", type=int, default=90, help="Time period for analysis (days)")
    
    args = parser.parse_args()
    
    scorer = ConfidenceScorer()
    
    if args.action == 'score':
        if not all([args.item_id, args.item_type, args.hierarchy_level, args.item_data]):
            print("Error: Item ID, type, hierarchy level, and data required")
            return
        
        item_data = json.loads(args.item_data)
        historical_context = json.loads(args.historical_context) if args.historical_context else None
        
        score = scorer.calculate_confidence_score(
            args.item_id, args.item_type, args.hierarchy_level,
            item_data, historical_context
        )
        
        print(json.dumps(asdict(score), indent=2, default=str))
        
    elif args.action == 'record_outcome':
        if not args.item_id or args.success is None:
            print("Error: Item ID and success status required")
            return
        
        success_metrics = json.loads(args.success_metrics) if args.success_metrics else None
        failure_reasons = json.loads(args.failure_reasons) if args.failure_reasons else None
        
        scorer.record_outcome(
            args.item_id, args.success, success_metrics,
            failure_reasons, args.lessons_learned
        )
        print(f"Recorded outcome for {args.item_id}")
        
    elif args.action == 'train':
        results = scorer.train_prediction_models()
        print(json.dumps(results, indent=2))
        
    elif args.action == 'analyze':
        analysis = scorer.analyze_confidence_patterns(args.time_period)
        print(json.dumps(analysis, indent=2))
        
    elif args.action == 'recalibrate':
        scorer._recalibrate_thresholds()
        print("Thresholds recalibrated")

if __name__ == "__main__":
    main()