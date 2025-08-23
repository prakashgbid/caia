#!/usr/bin/env python3
"""
EstimationLearning - Hierarchical Agent System Stream 3
Records actual vs estimated hours and applies ML to improve future estimates
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
import pickle
from sklearn.ensemble import RandomForestRegressor, GradientBoostingRegressor
from sklearn.model_selection import train_test_split
from sklearn.metrics import mean_absolute_error, mean_squared_error
from sklearn.preprocessing import StandardScaler, LabelEncoder
import warnings
warnings.filterwarnings('ignore')

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Configuration
ADMIN_ROOT = "/Users/MAC/Documents/projects/admin"
DB_PATH = os.path.join(ADMIN_ROOT, "estimation_learning.db")
MODELS_DIR = os.path.join(ADMIN_ROOT, "ml_models")

@dataclass
class EstimationRecord:
    id: str
    task_id: str
    task_type: str
    task_title: str
    estimated_hours: float
    actual_hours: Optional[float]
    team_member: str
    project: str
    complexity_factors: Dict[str, Any]
    timestamp: datetime
    completion_date: Optional[datetime] = None
    accuracy_score: Optional[float] = None

@dataclass
class EstimationPattern:
    pattern_id: str
    pattern_type: str
    features: Dict[str, Any]
    average_accuracy: float
    sample_count: int
    recommendations: List[str]

class EstimationLearning:
    """
    Machine learning system for improving time estimation accuracy
    Learns from historical data to provide better future estimates
    """
    
    def __init__(self, db_path: str = DB_PATH):
        self.db_path = db_path
        self.admin_root = Path(ADMIN_ROOT)
        self.models_dir = Path(MODELS_DIR)
        self.admin_root.mkdir(parents=True, exist_ok=True)
        self.models_dir.mkdir(parents=True, exist_ok=True)
        
        self._init_database()
        self._init_ml_components()
        
    def _init_database(self):
        """Initialize SQLite database for estimation data"""
        with sqlite3.connect(self.db_path) as conn:
            conn.execute('''
                CREATE TABLE IF NOT EXISTS estimation_records (
                    id TEXT PRIMARY KEY,
                    task_id TEXT NOT NULL,
                    task_type TEXT NOT NULL,
                    task_title TEXT NOT NULL,
                    estimated_hours REAL NOT NULL,
                    actual_hours REAL,
                    team_member TEXT NOT NULL,
                    project TEXT NOT NULL,
                    complexity_factors TEXT,
                    timestamp TEXT NOT NULL,
                    completion_date TEXT,
                    accuracy_score REAL
                )
            ''')
            
            conn.execute('''
                CREATE TABLE IF NOT EXISTS team_performance (
                    team_member TEXT PRIMARY KEY,
                    total_estimates INTEGER DEFAULT 0,
                    completed_estimates INTEGER DEFAULT 0,
                    average_accuracy REAL DEFAULT 0.0,
                    accuracy_trend REAL DEFAULT 0.0,
                    specializations TEXT,
                    last_updated TEXT
                )
            ''')
            
            conn.execute('''
                CREATE TABLE IF NOT EXISTS estimation_patterns (
                    pattern_id TEXT PRIMARY KEY,
                    pattern_type TEXT NOT NULL,
                    features TEXT NOT NULL,
                    average_accuracy REAL DEFAULT 0.0,
                    sample_count INTEGER DEFAULT 0,
                    recommendations TEXT,
                    created_date TEXT NOT NULL,
                    last_updated TEXT
                )
            ''')
            
            conn.execute('''
                CREATE TABLE IF NOT EXISTS model_performance (
                    model_name TEXT PRIMARY KEY,
                    model_type TEXT NOT NULL,
                    training_date TEXT NOT NULL,
                    mae REAL,
                    rmse REAL,
                    accuracy_improvement REAL,
                    feature_importance TEXT,
                    model_path TEXT
                )
            ''')
            
            # Create indexes
            conn.execute('CREATE INDEX IF NOT EXISTS idx_task_type ON estimation_records(task_type)')
            conn.execute('CREATE INDEX IF NOT EXISTS idx_team_member ON estimation_records(team_member)')
            conn.execute('CREATE INDEX IF NOT EXISTS idx_project ON estimation_records(project)')
            conn.execute('CREATE INDEX IF NOT EXISTS idx_completion ON estimation_records(completion_date)')
    
    def _init_ml_components(self):
        """Initialize machine learning components"""
        self.models = {
            'random_forest': RandomForestRegressor(n_estimators=100, random_state=42),
            'gradient_boost': GradientBoostingRegressor(n_estimators=100, random_state=42)
        }
        self.scaler = StandardScaler()
        self.label_encoders = {}
        self.feature_columns = [
            'task_type', 'team_member', 'project', 'complexity_score',
            'dependencies_count', 'similar_tasks_count', 'team_experience',
            'project_phase', 'priority_level', 'uncertainty_factor'
        ]
    
    def record_estimation(self,
                         task_id: str,
                         task_type: str,
                         task_title: str,
                         estimated_hours: float,
                         team_member: str,
                         project: str,
                         complexity_factors: Optional[Dict[str, Any]] = None) -> str:
        """Record a new estimation"""
        record_id = f"est_{datetime.now().strftime('%Y%m%d_%H%M%S')}_{task_id}"
        
        record = EstimationRecord(
            id=record_id,
            task_id=task_id,
            task_type=task_type,
            task_title=task_title,
            estimated_hours=estimated_hours,
            actual_hours=None,
            team_member=team_member,
            project=project,
            complexity_factors=complexity_factors or {},
            timestamp=datetime.now()
        )
        
        with sqlite3.connect(self.db_path) as conn:
            conn.execute('''
                INSERT INTO estimation_records 
                (id, task_id, task_type, task_title, estimated_hours, actual_hours,
                 team_member, project, complexity_factors, timestamp, completion_date, accuracy_score)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (
                record.id, record.task_id, record.task_type, record.task_title,
                record.estimated_hours, record.actual_hours, record.team_member,
                record.project, json.dumps(record.complexity_factors),
                record.timestamp.isoformat(), None, None
            ))
        
        logger.info(f"Recorded estimation: {task_title} ({estimated_hours}h) by {team_member}")
        return record_id
    
    def update_actual_hours(self, 
                           estimation_id: str, 
                           actual_hours: float,
                           completion_date: Optional[datetime] = None) -> Dict[str, Any]:
        """Update actual hours for an estimation and calculate accuracy"""
        if completion_date is None:
            completion_date = datetime.now()
        
        # Get the original estimation
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.execute(
                'SELECT estimated_hours, team_member FROM estimation_records WHERE id = ?',
                (estimation_id,)
            )
            result = cursor.fetchone()
            
            if not result:
                raise ValueError(f"Estimation record {estimation_id} not found")
            
            estimated_hours, team_member = result
        
        # Calculate accuracy score
        accuracy_score = self._calculate_accuracy_score(estimated_hours, actual_hours)
        
        # Update the record
        with sqlite3.connect(self.db_path) as conn:
            conn.execute('''
                UPDATE estimation_records 
                SET actual_hours = ?, completion_date = ?, accuracy_score = ?
                WHERE id = ?
            ''', (actual_hours, completion_date.isoformat(), accuracy_score, estimation_id))
        
        # Update team performance
        self._update_team_performance(team_member)
        
        logger.info(f"Updated actual hours: {actual_hours}h (accuracy: {accuracy_score:.2f})")
        
        return {
            'estimation_id': estimation_id,
            'estimated_hours': estimated_hours,
            'actual_hours': actual_hours,
            'accuracy_score': accuracy_score,
            'variance_hours': actual_hours - estimated_hours,
            'variance_percentage': ((actual_hours - estimated_hours) / estimated_hours) * 100
        }
    
    def _calculate_accuracy_score(self, estimated: float, actual: float) -> float:
        """Calculate accuracy score (0-1, where 1 is perfect)"""
        if estimated == 0:
            return 0.0 if actual > 0 else 1.0
        
        # Use relative error with a cap to prevent extreme scores
        relative_error = abs(actual - estimated) / estimated
        accuracy = max(0.0, 1.0 - min(relative_error, 2.0))  # Cap at 200% error
        return accuracy
    
    def _update_team_performance(self, team_member: str):
        """Update team member performance statistics"""
        with sqlite3.connect(self.db_path) as conn:
            # Get all completed estimates for this team member
            cursor = conn.execute('''
                SELECT accuracy_score FROM estimation_records 
                WHERE team_member = ? AND actual_hours IS NOT NULL
            ''', (team_member,))
            
            accuracy_scores = [row[0] for row in cursor.fetchall() if row[0] is not None]
            
            if not accuracy_scores:
                return
            
            total_estimates = len(accuracy_scores)
            average_accuracy = sum(accuracy_scores) / len(accuracy_scores)
            
            # Calculate trend (improvement over time)
            if len(accuracy_scores) >= 5:
                recent_scores = accuracy_scores[-5:]
                older_scores = accuracy_scores[:-5] if len(accuracy_scores) > 5 else accuracy_scores
                accuracy_trend = sum(recent_scores) / len(recent_scores) - sum(older_scores) / len(older_scores)
            else:
                accuracy_trend = 0.0
            
            # Get specializations (most common task types)
            cursor = conn.execute('''
                SELECT task_type, COUNT(*) as count 
                FROM estimation_records 
                WHERE team_member = ? 
                GROUP BY task_type 
                ORDER BY count DESC 
                LIMIT 3
            ''', (team_member,))
            
            specializations = [row[0] for row in cursor.fetchall()]
            
            # Update or insert team performance
            conn.execute('''
                INSERT OR REPLACE INTO team_performance 
                (team_member, total_estimates, completed_estimates, average_accuracy, 
                 accuracy_trend, specializations, last_updated)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            ''', (
                team_member, total_estimates, total_estimates, average_accuracy,
                accuracy_trend, json.dumps(specializations), datetime.now().isoformat()
            ))
    
    def get_team_performance(self, team_member: Optional[str] = None) -> Dict[str, Any]:
        """Get team performance analytics"""
        with sqlite3.connect(self.db_path) as conn:
            if team_member:
                cursor = conn.execute(
                    'SELECT * FROM team_performance WHERE team_member = ?',
                    (team_member,)
                )
                results = cursor.fetchall()
            else:
                cursor = conn.execute('SELECT * FROM team_performance ORDER BY average_accuracy DESC')
                results = cursor.fetchall()
        
        performance_data = []
        for row in results:
            (member, total_est, completed_est, avg_accuracy, trend, 
             specializations_str, last_updated) = row
            
            specializations = json.loads(specializations_str) if specializations_str else []
            
            performance_data.append({
                'team_member': member,
                'total_estimates': total_est,
                'completed_estimates': completed_est,
                'average_accuracy': avg_accuracy,
                'accuracy_trend': trend,
                'specializations': specializations,
                'last_updated': last_updated
            })
        
        if team_member and performance_data:
            return performance_data[0]
        
        return {
            'team_performance': performance_data,
            'summary': self._calculate_team_summary(performance_data)
        }
    
    def _calculate_team_summary(self, performance_data: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Calculate team performance summary statistics"""
        if not performance_data:
            return {}
        
        accuracies = [p['average_accuracy'] for p in performance_data if p['average_accuracy'] > 0]
        trends = [p['accuracy_trend'] for p in performance_data]
        
        return {
            'total_team_members': len(performance_data),
            'average_team_accuracy': sum(accuracies) / len(accuracies) if accuracies else 0,
            'best_performer': max(performance_data, key=lambda x: x['average_accuracy'])['team_member'],
            'most_improved': max(performance_data, key=lambda x: x['accuracy_trend'])['team_member'],
            'total_completed_estimates': sum(p['completed_estimates'] for p in performance_data)
        }
    
    def train_ml_models(self, min_samples: int = 50) -> Dict[str, Any]:
        """Train machine learning models on historical data"""
        # Get training data
        training_data = self._prepare_training_data()
        
        if len(training_data) < min_samples:
            logger.warning(f"Insufficient training data: {len(training_data)} samples (minimum: {min_samples})")
            return {'error': 'Insufficient training data'}
        
        # Prepare features and target
        X, y = self._extract_features(training_data)
        
        if len(X) == 0:
            return {'error': 'No valid features extracted'}
        
        # Split data
        X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)
        
        results = {}
        
        # Train each model
        for model_name, model in self.models.items():
            logger.info(f"Training {model_name} model...")
            
            # Train model
            model.fit(X_train, y_train)
            
            # Make predictions
            y_pred = model.predict(X_test)
            
            # Calculate metrics
            mae = mean_absolute_error(y_test, y_pred)
            rmse = np.sqrt(mean_squared_error(y_test, y_pred))
            
            # Calculate accuracy improvement over naive baseline
            baseline_mae = np.mean(np.abs(y_test - np.mean(y_train)))
            improvement = max(0, (baseline_mae - mae) / baseline_mae * 100)
            
            # Get feature importance
            if hasattr(model, 'feature_importances_'):
                feature_importance = dict(zip(self.feature_columns, model.feature_importances_))
            else:
                feature_importance = {}
            
            # Save model
            model_path = self.models_dir / f"{model_name}_model.pkl"
            with open(model_path, 'wb') as f:
                pickle.dump({
                    'model': model,
                    'scaler': self.scaler,
                    'label_encoders': self.label_encoders,
                    'feature_columns': self.feature_columns
                }, f)
            
            # Store results
            results[model_name] = {
                'mae': mae,
                'rmse': rmse,
                'accuracy_improvement': improvement,
                'feature_importance': feature_importance,
                'model_path': str(model_path)
            }
            
            # Update database
            with sqlite3.connect(self.db_path) as conn:
                conn.execute('''
                    INSERT OR REPLACE INTO model_performance 
                    (model_name, model_type, training_date, mae, rmse, 
                     accuracy_improvement, feature_importance, model_path)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ''', (
                    model_name, model.__class__.__name__, datetime.now().isoformat(),
                    mae, rmse, improvement, json.dumps(feature_importance),
                    str(model_path)
                ))
        
        logger.info(f"Training completed. Best model: {min(results.keys(), key=lambda k: results[k]['mae'])}")
        
        return {
            'training_samples': len(training_data),
            'test_samples': len(X_test),
            'models': results,
            'best_model': min(results.keys(), key=lambda k: results[k]['mae'])
        }
    
    def _prepare_training_data(self) -> List[Dict[str, Any]]:
        """Prepare training data from completed estimations"""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.execute('''
                SELECT er.*, tp.average_accuracy as team_avg_accuracy
                FROM estimation_records er
                LEFT JOIN team_performance tp ON er.team_member = tp.team_member
                WHERE er.actual_hours IS NOT NULL
                ORDER BY er.completion_date
            ''')
            
            training_data = []
            for row in cursor.fetchall():
                (id, task_id, task_type, task_title, estimated_hours, actual_hours,
                 team_member, project, complexity_factors_str, timestamp,
                 completion_date, accuracy_score, team_avg_accuracy) = row
                
                complexity_factors = json.loads(complexity_factors_str) if complexity_factors_str else {}
                
                training_data.append({
                    'id': id,
                    'task_type': task_type,
                    'estimated_hours': estimated_hours,
                    'actual_hours': actual_hours,
                    'team_member': team_member,
                    'project': project,
                    'complexity_factors': complexity_factors,
                    'team_avg_accuracy': team_avg_accuracy or 0.5,
                    'timestamp': timestamp
                })
        
        return training_data
    
    def _extract_features(self, training_data: List[Dict[str, Any]]) -> Tuple[np.ndarray, np.ndarray]:
        """Extract features for ML training"""
        features = []
        targets = []
        
        for record in training_data:
            # Extract complexity factors
            complexity = record['complexity_factors']
            
            feature_row = {
                'task_type': record['task_type'],
                'team_member': record['team_member'],
                'project': record['project'],
                'complexity_score': complexity.get('complexity_score', 5),
                'dependencies_count': complexity.get('dependencies_count', 0),
                'similar_tasks_count': complexity.get('similar_tasks_count', 0),
                'team_experience': record['team_avg_accuracy'],
                'project_phase': complexity.get('project_phase', 'development'),
                'priority_level': complexity.get('priority_level', 'medium'),
                'uncertainty_factor': complexity.get('uncertainty_factor', 0.5)
            }
            
            features.append(feature_row)
            targets.append(record['actual_hours'])
        
        # Convert to DataFrame-like structure for encoding
        import pandas as pd
        df = pd.DataFrame(features)
        
        # Encode categorical variables
        for col in ['task_type', 'team_member', 'project', 'project_phase', 'priority_level']:
            if col not in self.label_encoders:
                self.label_encoders[col] = LabelEncoder()
            
            if col in df.columns:
                # Fit on all unique values seen so far
                unique_vals = df[col].astype(str).unique()
                if hasattr(self.label_encoders[col], 'classes_'):
                    # Update with new values
                    all_vals = np.concatenate([self.label_encoders[col].classes_, unique_vals])
                    all_vals = np.unique(all_vals)
                    self.label_encoders[col].classes_ = all_vals
                else:
                    self.label_encoders[col].fit(unique_vals)
                
                df[col] = self.label_encoders[col].transform(df[col].astype(str))
        
        # Scale numerical features
        X = df[self.feature_columns].values
        X_scaled = self.scaler.fit_transform(X)
        
        return X_scaled, np.array(targets)
    
    def predict_estimation(self, 
                          task_type: str,
                          team_member: str,
                          project: str,
                          complexity_factors: Optional[Dict[str, Any]] = None,
                          model_name: str = 'random_forest') -> Dict[str, Any]:
        """Predict task estimation using trained ML model"""
        # Load trained model
        model_path = self.models_dir / f"{model_name}_model.pkl"
        
        if not model_path.exists():
            # Fall back to pattern-based estimation
            return self._pattern_based_estimation(task_type, team_member, project, complexity_factors)
        
        try:
            with open(model_path, 'rb') as f:
                model_data = pickle.load(f)
            
            model = model_data['model']
            scaler = model_data['scaler']
            encoders = model_data['label_encoders']
            feature_cols = model_data['feature_columns']
            
            # Prepare features
            complexity = complexity_factors or {}
            features = {
                'task_type': task_type,
                'team_member': team_member,
                'project': project,
                'complexity_score': complexity.get('complexity_score', 5),
                'dependencies_count': complexity.get('dependencies_count', 0),
                'similar_tasks_count': complexity.get('similar_tasks_count', 0),
                'team_experience': self._get_team_experience(team_member),
                'project_phase': complexity.get('project_phase', 'development'),
                'priority_level': complexity.get('priority_level', 'medium'),
                'uncertainty_factor': complexity.get('uncertainty_factor', 0.5)
            }
            
            # Encode categorical features
            encoded_features = []
            for col in feature_cols:
                if col in encoders:
                    value = str(features[col])
                    if value in encoders[col].classes_:
                        encoded_features.append(encoders[col].transform([value])[0])
                    else:
                        # Handle unseen categories
                        encoded_features.append(0)
                else:
                    encoded_features.append(features[col])
            
            # Scale features
            X = scaler.transform([encoded_features])
            
            # Make prediction
            predicted_hours = model.predict(X)[0]
            
            # Get confidence based on historical accuracy
            confidence = self._calculate_prediction_confidence(task_type, team_member, project)
            
            return {
                'predicted_hours': max(0.1, predicted_hours),  # Minimum 0.1 hours
                'confidence_score': confidence,
                'model_used': model_name,
                'factors_considered': list(features.keys()),
                'similar_tasks': self._find_similar_tasks(task_type, team_member, project),
                'recommendations': self._generate_estimation_recommendations(features, predicted_hours)
            }
            
        except Exception as e:
            logger.error(f"ML prediction failed: {e}")
            return self._pattern_based_estimation(task_type, team_member, project, complexity_factors)
    
    def _get_team_experience(self, team_member: str) -> float:
        """Get team member experience score"""
        perf_data = self.get_team_performance(team_member)
        if isinstance(perf_data, dict) and 'average_accuracy' in perf_data:
            return perf_data['average_accuracy']
        return 0.5  # Default experience
    
    def _calculate_prediction_confidence(self, task_type: str, team_member: str, project: str) -> float:
        """Calculate confidence in prediction based on historical data"""
        with sqlite3.connect(self.db_path) as conn:
            # Find similar completed tasks
            cursor = conn.execute('''
                SELECT accuracy_score FROM estimation_records 
                WHERE task_type = ? AND team_member = ? AND project = ? 
                AND actual_hours IS NOT NULL
                LIMIT 10
            ''', (task_type, team_member, project))
            
            scores = [row[0] for row in cursor.fetchall() if row[0] is not None]
            
            if scores:
                return sum(scores) / len(scores)
            
            # Fallback to team member's overall accuracy
            return self._get_team_experience(team_member)
    
    def _find_similar_tasks(self, task_type: str, team_member: str, project: str) -> List[Dict[str, Any]]:
        """Find similar completed tasks for reference"""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.execute('''
                SELECT task_title, estimated_hours, actual_hours, accuracy_score
                FROM estimation_records 
                WHERE task_type = ? AND (team_member = ? OR project = ?)
                AND actual_hours IS NOT NULL
                ORDER BY accuracy_score DESC
                LIMIT 5
            ''', (task_type, team_member, project))
            
            similar_tasks = []
            for row in cursor.fetchall():
                task_title, estimated, actual, accuracy = row
                similar_tasks.append({
                    'title': task_title,
                    'estimated_hours': estimated,
                    'actual_hours': actual,
                    'accuracy_score': accuracy
                })
        
        return similar_tasks
    
    def _generate_estimation_recommendations(self, features: Dict[str, Any], predicted_hours: float) -> List[str]:
        """Generate recommendations for the estimation"""
        recommendations = []
        
        complexity = features.get('complexity_score', 5)
        team_exp = features.get('team_experience', 0.5)
        uncertainty = features.get('uncertainty_factor', 0.5)
        
        if complexity > 7:
            recommendations.append("High complexity task - consider breaking down into smaller subtasks")
        
        if team_exp < 0.6:
            recommendations.append("Team member has lower accuracy - consider adding buffer time")
        
        if uncertainty > 0.7:
            recommendations.append("High uncertainty - add 20-30% buffer time")
        
        if predicted_hours > 40:
            recommendations.append("Large task detected - strongly recommend decomposition")
        
        if features.get('dependencies_count', 0) > 3:
            recommendations.append("Multiple dependencies - factor in coordination overhead")
        
        return recommendations
    
    def _pattern_based_estimation(self, 
                                task_type: str, 
                                team_member: str, 
                                project: str,
                                complexity_factors: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Fallback pattern-based estimation when ML models aren't available"""
        with sqlite3.connect(self.db_path) as conn:
            # Find historical averages for similar tasks
            cursor = conn.execute('''
                SELECT AVG(actual_hours), AVG(accuracy_score), COUNT(*)
                FROM estimation_records 
                WHERE task_type = ? AND actual_hours IS NOT NULL
            ''', (task_type,))
            
            result = cursor.fetchone()
            avg_hours, avg_accuracy, count = result if result else (8.0, 0.6, 0)
            
            if count == 0:
                # No historical data, use defaults
                avg_hours = 8.0
                avg_accuracy = 0.5
            
            # Adjust based on team member experience
            team_exp = self._get_team_experience(team_member)
            if team_exp > 0.8:
                avg_hours *= 0.9  # Experienced member
            elif team_exp < 0.4:
                avg_hours *= 1.2  # Less experienced
            
            # Apply complexity factors
            complexity = complexity_factors or {}
            complexity_score = complexity.get('complexity_score', 5)
            avg_hours *= (complexity_score / 5.0)  # Scale by complexity
            
        return {
            'predicted_hours': max(0.1, avg_hours),
            'confidence_score': avg_accuracy,
            'model_used': 'pattern_based',
            'factors_considered': ['task_type', 'team_experience', 'complexity'],
            'similar_tasks': self._find_similar_tasks(task_type, team_member, project),
            'recommendations': ['Pattern-based estimation - consider training ML model with more data']
        }
    
    def generate_estimation_insights(self, 
                                   project: Optional[str] = None,
                                   time_period: int = 30) -> Dict[str, Any]:
        """Generate insights from estimation data"""
        start_date = datetime.now() - timedelta(days=time_period)
        
        with sqlite3.connect(self.db_path) as conn:
            # Base query conditions
            conditions = ['completion_date IS NOT NULL']
            params = []
            
            if project:
                conditions.append('project = ?')
                params.append(project)
            
            conditions.append('completion_date > ?')
            params.append(start_date.isoformat())
            
            where_clause = ' AND '.join(conditions)
            
            # Overall statistics
            cursor = conn.execute(f'''
                SELECT 
                    COUNT(*) as total_completed,
                    AVG(accuracy_score) as avg_accuracy,
                    AVG(ABS(actual_hours - estimated_hours)) as avg_error,
                    AVG(actual_hours) as avg_actual_hours,
                    AVG(estimated_hours) as avg_estimated_hours
                FROM estimation_records 
                WHERE {where_clause}
            ''', params)
            
            stats = cursor.fetchone()
            total, avg_acc, avg_error, avg_actual, avg_estimated = stats or (0, 0, 0, 0, 0)
            
            # Accuracy by task type
            cursor = conn.execute(f'''
                SELECT task_type, AVG(accuracy_score) as avg_acc, COUNT(*) as count
                FROM estimation_records 
                WHERE {where_clause}
                GROUP BY task_type
                ORDER BY avg_acc DESC
            ''', params)
            
            task_type_accuracy = [
                {'task_type': row[0], 'accuracy': row[1], 'count': row[2]}
                for row in cursor.fetchall()
            ]
            
            # Top performers
            cursor = conn.execute(f'''
                SELECT team_member, AVG(accuracy_score) as avg_acc, COUNT(*) as count
                FROM estimation_records 
                WHERE {where_clause}
                GROUP BY team_member
                HAVING count >= 3
                ORDER BY avg_acc DESC
                LIMIT 5
            ''', params)
            
            top_performers = [
                {'team_member': row[0], 'accuracy': row[1], 'count': row[2]}
                for row in cursor.fetchall()
            ]
            
            # Estimation bias analysis
            over_estimators = []
            under_estimators = []
            
            cursor = conn.execute(f'''
                SELECT team_member, 
                       AVG(estimated_hours - actual_hours) as avg_bias,
                       COUNT(*) as count
                FROM estimation_records 
                WHERE {where_clause}
                GROUP BY team_member
                HAVING count >= 3
            ''', params)
            
            for row in cursor.fetchall():
                member, bias, count = row
                if bias > 2:
                    over_estimators.append({'member': member, 'bias': bias, 'count': count})
                elif bias < -2:
                    under_estimators.append({'member': member, 'bias': abs(bias), 'count': count})
        
        insights = {
            'period_days': time_period,
            'project': project,
            'overall_stats': {
                'total_completed': total or 0,
                'average_accuracy': avg_acc or 0,
                'average_error_hours': avg_error or 0,
                'estimation_bias': (avg_estimated or 0) - (avg_actual or 0)
            },
            'task_type_performance': task_type_accuracy,
            'top_performers': top_performers,
            'estimation_bias': {
                'over_estimators': over_estimators,
                'under_estimators': under_estimators
            },
            'recommendations': self._generate_insights_recommendations(
                avg_acc or 0, task_type_accuracy, over_estimators, under_estimators
            )
        }
        
        return insights
    
    def _generate_insights_recommendations(self,
                                         avg_accuracy: float,
                                         task_accuracy: List[Dict[str, Any]],
                                         over_estimators: List[Dict[str, Any]],
                                         under_estimators: List[Dict[str, Any]]) -> List[str]:
        """Generate recommendations based on insights"""
        recommendations = []
        
        if avg_accuracy < 0.6:
            recommendations.append("Overall estimation accuracy is low. Consider estimation training.")
        
        if task_accuracy:
            worst_task_type = min(task_accuracy, key=lambda x: x['accuracy'])
            if worst_task_type['accuracy'] < 0.5:
                recommendations.append(f"Task type '{worst_task_type['task_type']}' has poor accuracy. Review estimation approach.")
        
        if over_estimators:
            recommendations.append(f"{len(over_estimators)} team members tend to over-estimate. Consider bias training.")
        
        if under_estimators:
            recommendations.append(f"{len(under_estimators)} team members tend to under-estimate. Build in buffer time.")
        
        if not recommendations:
            recommendations.append("Estimation performance is good. Continue current practices.")
        
        return recommendations

def main():
    """Main function for CLI usage"""
    import argparse
    
    parser = argparse.ArgumentParser(description="Estimation Learning System")
    parser.add_argument("--action", choices=[
        'record', 'update', 'predict', 'train', 'performance', 'insights'
    ], required=True, help="Action to perform")
    
    # Record estimation arguments
    parser.add_argument("--task-id", help="Task ID")
    parser.add_argument("--task-type", help="Task type")
    parser.add_argument("--task-title", help="Task title")
    parser.add_argument("--estimated-hours", type=float, help="Estimated hours")
    parser.add_argument("--actual-hours", type=float, help="Actual hours")
    parser.add_argument("--team-member", help="Team member")
    parser.add_argument("--project", help="Project name")
    parser.add_argument("--complexity", help="Complexity factors (JSON)")
    
    # Other arguments
    parser.add_argument("--estimation-id", help="Estimation ID for updates")
    parser.add_argument("--model-name", default="random_forest", help="ML model to use")
    parser.add_argument("--time-period", type=int, default=30, help="Time period for insights (days)")
    
    args = parser.parse_args()
    
    learning = EstimationLearning()
    
    if args.action == 'record':
        if not all([args.task_id, args.task_type, args.task_title, 
                   args.estimated_hours, args.team_member, args.project]):
            print("Error: Missing required parameters for recording")
            return
        
        complexity = json.loads(args.complexity) if args.complexity else {}
        
        estimation_id = learning.record_estimation(
            args.task_id, args.task_type, args.task_title,
            args.estimated_hours, args.team_member, args.project, complexity
        )
        print(f"Recorded estimation: {estimation_id}")
        
    elif args.action == 'update':
        if not args.estimation_id or not args.actual_hours:
            print("Error: Estimation ID and actual hours required")
            return
            
        result = learning.update_actual_hours(args.estimation_id, args.actual_hours)
        print(json.dumps(result, indent=2))
        
    elif args.action == 'predict':
        if not all([args.task_type, args.team_member, args.project]):
            print("Error: Task type, team member, and project required")
            return
            
        complexity = json.loads(args.complexity) if args.complexity else {}
        
        prediction = learning.predict_estimation(
            args.task_type, args.team_member, args.project, complexity, args.model_name
        )
        print(json.dumps(prediction, indent=2))
        
    elif args.action == 'train':
        results = learning.train_ml_models()
        print(json.dumps(results, indent=2))
        
    elif args.action == 'performance':
        performance = learning.get_team_performance(args.team_member)
        print(json.dumps(performance, indent=2))
        
    elif args.action == 'insights':
        insights = learning.generate_estimation_insights(args.project, args.time_period)
        print(json.dumps(insights, indent=2))

if __name__ == "__main__":
    main()