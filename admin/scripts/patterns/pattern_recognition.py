#!/usr/bin/env python3
"""
PatternRecognition - Hierarchical Agent System Stream 3
Identifies common breakdown patterns, suggests templates, and detects anti-patterns
Integrates with existing context management system
"""

import os
import json
import sqlite3
import numpy as np
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, List, Any, Optional, Tuple, Set
import logging
from dataclasses import dataclass, asdict
from collections import defaultdict, Counter
import hashlib
import difflib
from sklearn.cluster import KMeans, DBSCAN
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity
from sklearn.decomposition import LatentDirichletAllocation
import networkx as nx
import warnings
warnings.filterwarnings('ignore')

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Configuration
ADMIN_ROOT = "/Users/MAC/Documents/projects/admin"
DB_PATH = os.path.join(ADMIN_ROOT, "pattern_recognition.db")
TEMPLATES_DIR = os.path.join(ADMIN_ROOT, "templates")

@dataclass
class Pattern:
    pattern_id: str
    pattern_type: str
    name: str
    description: str
    structure: Dict[str, Any]
    frequency: int
    success_rate: float
    examples: List[str]
    template: Optional[Dict[str, Any]] = None
    anti_pattern: bool = False

@dataclass
class Template:
    template_id: str
    name: str
    description: str
    category: str
    structure: Dict[str, Any]
    parameters: List[str]
    success_metrics: Dict[str, float]
    usage_count: int = 0

class PatternRecognition:
    """
    Advanced pattern recognition system for hierarchical task breakdown
    Identifies successful patterns, creates reusable templates, and detects anti-patterns
    """
    
    def __init__(self, db_path: str = DB_PATH):
        self.db_path = db_path
        self.admin_root = Path(ADMIN_ROOT)
        self.templates_dir = Path(TEMPLATES_DIR)
        self.admin_root.mkdir(parents=True, exist_ok=True)
        self.templates_dir.mkdir(parents=True, exist_ok=True)
        
        self._init_database()
        self._init_ml_components()
        
    def _init_database(self):
        """Initialize SQLite database for pattern data"""
        with sqlite3.connect(self.db_path) as conn:
            conn.execute('''
                CREATE TABLE IF NOT EXISTS patterns (
                    pattern_id TEXT PRIMARY KEY,
                    pattern_type TEXT NOT NULL,
                    name TEXT NOT NULL,
                    description TEXT,
                    structure TEXT NOT NULL,
                    frequency INTEGER DEFAULT 1,
                    success_rate REAL DEFAULT 0.0,
                    examples TEXT,
                    template_data TEXT,
                    anti_pattern INTEGER DEFAULT 0,
                    created_date TEXT NOT NULL,
                    last_updated TEXT
                )
            ''')
            
            conn.execute('''
                CREATE TABLE IF NOT EXISTS templates (
                    template_id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    description TEXT,
                    category TEXT NOT NULL,
                    structure TEXT NOT NULL,
                    parameters TEXT,
                    success_metrics TEXT,
                    usage_count INTEGER DEFAULT 0,
                    created_date TEXT NOT NULL,
                    last_used TEXT
                )
            ''')
            
            conn.execute('''
                CREATE TABLE IF NOT EXISTS project_structures (
                    project_id TEXT PRIMARY KEY,
                    project_name TEXT NOT NULL,
                    structure TEXT NOT NULL,
                    success_score REAL,
                    completion_time INTEGER,
                    team_size INTEGER,
                    complexity_factors TEXT,
                    created_date TEXT NOT NULL
                )
            ''')
            
            conn.execute('''
                CREATE TABLE IF NOT EXISTS pattern_matches (
                    match_id TEXT PRIMARY KEY,
                    project_id TEXT NOT NULL,
                    pattern_id TEXT NOT NULL,
                    confidence REAL NOT NULL,
                    match_details TEXT,
                    timestamp TEXT NOT NULL,
                    FOREIGN KEY (pattern_id) REFERENCES patterns(pattern_id)
                )
            ''')
            
            conn.execute('''
                CREATE TABLE IF NOT EXISTS similarity_graph (
                    source_project TEXT NOT NULL,
                    target_project TEXT NOT NULL,
                    similarity_score REAL NOT NULL,
                    similarity_type TEXT NOT NULL,
                    details TEXT,
                    timestamp TEXT NOT NULL,
                    PRIMARY KEY (source_project, target_project, similarity_type)
                )
            ''')
            
            # Create indexes
            conn.execute('CREATE INDEX IF NOT EXISTS idx_pattern_type ON patterns(pattern_type)')
            conn.execute('CREATE INDEX IF NOT EXISTS idx_template_category ON templates(category)')
            conn.execute('CREATE INDEX IF NOT EXISTS idx_pattern_matches_project ON pattern_matches(project_id)')
    
    def _init_ml_components(self):
        """Initialize ML components for pattern analysis"""
        self.vectorizer = TfidfVectorizer(
            max_features=1000,
            stop_words='english',
            ngram_range=(1, 3),
            max_df=0.8,
            min_df=0.1
        )
        self.lda_model = LatentDirichletAllocation(n_components=10, random_state=42)
        self.clustering_models = {
            'kmeans': KMeans(n_clusters=8, random_state=42),
            'dbscan': DBSCAN(eps=0.3, min_samples=3)
        }
    
    def analyze_project_structure(self, 
                                project_id: str,
                                project_name: str,
                                hierarchy_data: Dict[str, Any],
                                success_metrics: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Analyze project structure and identify patterns"""
        # Extract structural features
        structure_features = self._extract_structural_features(hierarchy_data)
        
        # Calculate success score
        success_score = self._calculate_success_score(success_metrics or {})
        
        # Store project structure
        self._store_project_structure(
            project_id, project_name, structure_features, 
            success_score, success_metrics or {}
        )
        
        # Find similar projects
        similar_projects = self._find_similar_projects(project_id, structure_features)
        
        # Identify patterns
        patterns = self._identify_patterns_in_structure(structure_features)
        
        # Check for anti-patterns
        anti_patterns = self._detect_anti_patterns(structure_features)
        
        # Generate recommendations
        recommendations = self._generate_pattern_recommendations(
            structure_features, patterns, anti_patterns, similar_projects
        )
        
        analysis_result = {
            'project_id': project_id,
            'structure_features': structure_features,
            'success_score': success_score,
            'similar_projects': similar_projects,
            'identified_patterns': patterns,
            'anti_patterns': anti_patterns,
            'recommendations': recommendations,
            'analysis_timestamp': datetime.now().isoformat()
        }
        
        logger.info(f"Analyzed project structure: {project_name} (Score: {success_score:.2f})")
        return analysis_result
    
    def _extract_structural_features(self, hierarchy_data: Dict[str, Any]) -> Dict[str, Any]:
        """Extract structural features from hierarchy data"""
        features = {
            'depth_levels': {},
            'branching_factors': [],
            'node_types': defaultdict(int),
            'dependencies': [],
            'text_features': [],
            'size_distribution': {},
            'complexity_indicators': {}
        }
        
        # Build graph representation
        G = nx.DiGraph()
        node_texts = []
        
        def traverse_hierarchy(node_data, level=0, parent_id=None):
            if isinstance(node_data, dict):
                node_id = node_data.get('id', f'node_{level}')
                node_type = node_data.get('type', 'unknown')
                title = node_data.get('title', '')
                children = node_data.get('children', [])
                
                # Add to graph
                G.add_node(node_id, type=node_type, title=title, level=level)
                if parent_id:
                    G.add_edge(parent_id, node_id)
                
                # Track features
                features['depth_levels'][level] = features['depth_levels'].get(level, 0) + 1
                features['node_types'][node_type] += 1
                
                if len(children) > 0:
                    features['branching_factors'].append(len(children))
                
                # Text analysis
                if title:
                    node_texts.append(title)
                
                # Recursively process children
                for child in children:
                    if isinstance(child, dict):
                        traverse_hierarchy(child, level + 1, node_id)
        
        # Process hierarchy
        if isinstance(hierarchy_data, dict):
            if 'children' in hierarchy_data or 'id' in hierarchy_data:
                traverse_hierarchy(hierarchy_data)
            else:
                # Multiple root nodes
                for root_id, root_data in hierarchy_data.items():
                    traverse_hierarchy(root_data)
        
        # Calculate graph metrics
        if G.number_of_nodes() > 0:
            features['graph_metrics'] = {
                'total_nodes': G.number_of_nodes(),
                'total_edges': G.number_of_edges(),
                'max_depth': max(features['depth_levels'].keys()) if features['depth_levels'] else 0,
                'average_branching': np.mean(features['branching_factors']) if features['branching_factors'] else 0,
                'density': nx.density(G),
                'is_connected': nx.is_weakly_connected(G)
            }
        
        # Text analysis
        if node_texts:
            features['text_features'] = node_texts
            
            # Extract keywords and topics
            try:
                tfidf_matrix = self.vectorizer.fit_transform(node_texts)
                feature_names = self.vectorizer.get_feature_names_out()
                
                # Get top keywords
                mean_scores = np.mean(tfidf_matrix.toarray(), axis=0)
                top_indices = np.argsort(mean_scores)[::-1][:10]
                features['top_keywords'] = [feature_names[i] for i in top_indices]
                
            except Exception as e:
                logger.warning(f"Text analysis failed: {e}")
                features['top_keywords'] = []
        
        return features
    
    def _calculate_success_score(self, metrics: Dict[str, Any]) -> float:
        """Calculate overall success score from metrics"""
        if not metrics:
            return 0.5  # Default neutral score
        
        score = 0.5
        
        # Time performance (completed on time = +0.2, early = +0.3, late = -0.2)
        if 'time_performance' in metrics:
            time_perf = metrics['time_performance']
            if time_perf == 'early':
                score += 0.3
            elif time_perf == 'on_time':
                score += 0.2
            elif time_perf == 'late':
                score -= 0.2
        
        # Quality metrics
        if 'quality_score' in metrics:
            quality = metrics['quality_score']
            score += (quality - 0.5) * 0.4
        
        # Team satisfaction
        if 'team_satisfaction' in metrics:
            satisfaction = metrics['team_satisfaction']
            score += (satisfaction - 0.5) * 0.2
        
        # Stakeholder satisfaction
        if 'stakeholder_satisfaction' in metrics:
            stakeholder = metrics['stakeholder_satisfaction']
            score += (stakeholder - 0.5) * 0.2
        
        # Budget performance
        if 'budget_performance' in metrics:
            budget = metrics['budget_performance']
            if budget <= 1.0:  # On or under budget
                score += 0.1
            else:
                score -= 0.1
        
        return max(0.0, min(1.0, score))
    
    def _store_project_structure(self, 
                                project_id: str,
                                project_name: str,
                                structure_features: Dict[str, Any],
                                success_score: float,
                                success_metrics: Dict[str, Any]):
        """Store project structure in database"""
        with sqlite3.connect(self.db_path) as conn:
            # Calculate additional metrics
            completion_time = success_metrics.get('completion_time_days', 0)
            team_size = success_metrics.get('team_size', 1)
            complexity_factors = success_metrics.get('complexity_factors', {})
            
            conn.execute('''
                INSERT OR REPLACE INTO project_structures 
                (project_id, project_name, structure, success_score, completion_time,
                 team_size, complexity_factors, created_date)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ''', (
                project_id, project_name, json.dumps(structure_features),
                success_score, completion_time, team_size,
                json.dumps(complexity_factors), datetime.now().isoformat()
            ))
    
    def _find_similar_projects(self, 
                              project_id: str,
                              structure_features: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Find projects with similar structures"""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.execute('''
                SELECT project_id, project_name, structure, success_score
                FROM project_structures 
                WHERE project_id != ?
                ORDER BY success_score DESC
            ''', (project_id,))
            
            similar_projects = []
            current_features = structure_features
            
            for row in cursor.fetchall():
                other_id, other_name, other_structure_str, other_success = row
                
                try:
                    other_features = json.loads(other_structure_str)
                    similarity = self._calculate_structural_similarity(current_features, other_features)
                    
                    if similarity > 0.3:  # Threshold for similarity
                        similar_projects.append({
                            'project_id': other_id,
                            'project_name': other_name,
                            'similarity_score': similarity,
                            'success_score': other_success
                        })
                        
                        # Store similarity in graph
                        self._store_similarity(project_id, other_id, similarity, 'structural')
                        
                except Exception as e:
                    logger.warning(f"Error comparing with project {other_id}: {e}")
            
            # Sort by similarity
            similar_projects.sort(key=lambda x: x['similarity_score'], reverse=True)
            return similar_projects[:5]  # Top 5 similar projects
    
    def _calculate_structural_similarity(self, 
                                       features1: Dict[str, Any],
                                       features2: Dict[str, Any]) -> float:
        """Calculate similarity between two project structures"""
        similarities = []
        
        # Graph metrics similarity
        if 'graph_metrics' in features1 and 'graph_metrics' in features2:
            metrics1 = features1['graph_metrics']
            metrics2 = features2['graph_metrics']
            
            metric_similarities = []
            for key in ['total_nodes', 'max_depth', 'average_branching', 'density']:
                if key in metrics1 and key in metrics2:
                    val1, val2 = metrics1[key], metrics2[key]
                    if val1 == 0 and val2 == 0:
                        metric_similarities.append(1.0)
                    elif val1 == 0 or val2 == 0:
                        metric_similarities.append(0.0)
                    else:
                        sim = 1.0 - abs(val1 - val2) / max(val1, val2)
                        metric_similarities.append(max(0.0, sim))
            
            if metric_similarities:
                similarities.append(np.mean(metric_similarities))
        
        # Node type distribution similarity
        if 'node_types' in features1 and 'node_types' in features2:
            types1 = features1['node_types']
            types2 = features2['node_types']
            
            all_types = set(types1.keys()) | set(types2.keys())
            if all_types:
                type_similarity = 0.0
                for node_type in all_types:
                    count1 = types1.get(node_type, 0)
                    count2 = types2.get(node_type, 0)
                    total1 = sum(types1.values()) or 1
                    total2 = sum(types2.values()) or 1
                    
                    prop1 = count1 / total1
                    prop2 = count2 / total2
                    
                    type_similarity += 1.0 - abs(prop1 - prop2)
                
                similarities.append(type_similarity / len(all_types))
        
        # Keyword similarity
        if 'top_keywords' in features1 and 'top_keywords' in features2:
            keywords1 = set(features1['top_keywords'])
            keywords2 = set(features2['top_keywords'])
            
            if keywords1 or keywords2:
                intersection = len(keywords1 & keywords2)
                union = len(keywords1 | keywords2)
                jaccard_sim = intersection / union if union > 0 else 0
                similarities.append(jaccard_sim)
        
        return np.mean(similarities) if similarities else 0.0
    
    def _store_similarity(self, 
                         source_project: str,
                         target_project: str,
                         similarity_score: float,
                         similarity_type: str):
        """Store similarity relationship"""
        with sqlite3.connect(self.db_path) as conn:
            conn.execute('''
                INSERT OR REPLACE INTO similarity_graph 
                (source_project, target_project, similarity_score, 
                 similarity_type, details, timestamp)
                VALUES (?, ?, ?, ?, ?, ?)
            ''', (
                source_project, target_project, similarity_score,
                similarity_type, json.dumps({}), datetime.now().isoformat()
            ))
    
    def _identify_patterns_in_structure(self, structure_features: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Identify common patterns in the structure"""
        patterns = []
        
        # Analyze graph structure patterns
        if 'graph_metrics' in structure_features:
            metrics = structure_features['graph_metrics']
            
            # Deep hierarchy pattern
            if metrics.get('max_depth', 0) > 6:
                patterns.append({
                    'type': 'deep_hierarchy',
                    'name': 'Deep Hierarchy Pattern',
                    'description': 'Project has deep nested structure (>6 levels)',
                    'confidence': min(1.0, metrics['max_depth'] / 10),
                    'implications': ['May indicate over-decomposition', 'Consider flattening structure']
                })
            
            # Wide hierarchy pattern
            if metrics.get('average_branching', 0) > 5:
                patterns.append({
                    'type': 'wide_hierarchy',
                    'name': 'Wide Hierarchy Pattern',
                    'description': 'Project has wide branching structure (>5 avg children)',
                    'confidence': min(1.0, metrics['average_branching'] / 8),
                    'implications': ['May indicate grouping opportunities', 'Consider intermediate levels']
                })
            
            # Balanced pattern
            if 3 <= metrics.get('max_depth', 0) <= 5 and 2 <= metrics.get('average_branching', 0) <= 4:
                patterns.append({
                    'type': 'balanced_hierarchy',
                    'name': 'Balanced Hierarchy Pattern',
                    'description': 'Well-balanced structure with good depth and branching',
                    'confidence': 0.8,
                    'implications': ['Good structure for manageable complexity', 'Maintain current approach']
                })
        
        # Analyze text patterns
        if 'top_keywords' in structure_features:
            keywords = structure_features['top_keywords']
            
            # Technical pattern
            technical_keywords = {'api', 'service', 'database', 'endpoint', 'integration', 'auth'}
            if any(kw in ' '.join(keywords).lower() for kw in technical_keywords):
                patterns.append({
                    'type': 'technical_focus',
                    'name': 'Technical-Heavy Pattern',
                    'description': 'Project heavily focused on technical implementation',
                    'confidence': 0.7,
                    'implications': ['Ensure business value is clear', 'Consider user-facing features']
                })
            
            # Feature pattern
            feature_keywords = {'user', 'feature', 'interface', 'experience', 'functionality'}
            if any(kw in ' '.join(keywords).lower() for kw in feature_keywords):
                patterns.append({
                    'type': 'feature_focus',
                    'name': 'Feature-Driven Pattern',
                    'description': 'Project organized around user features',
                    'confidence': 0.7,
                    'implications': ['Good user-centric approach', 'Ensure technical foundation is solid']
                })
        
        return patterns
    
    def _detect_anti_patterns(self, structure_features: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Detect anti-patterns in project structure"""
        anti_patterns = []
        
        if 'graph_metrics' in structure_features:
            metrics = structure_features['graph_metrics']
            
            # Monolith anti-pattern (too shallow)
            if metrics.get('max_depth', 0) <= 2 and metrics.get('total_nodes', 0) > 20:
                anti_patterns.append({
                    'type': 'monolith_structure',
                    'name': 'Monolith Anti-Pattern',
                    'description': 'Large project with insufficient decomposition',
                    'severity': 'high',
                    'confidence': 0.8,
                    'consequences': ['Poor manageability', 'High complexity', 'Difficult estimation'],
                    'solutions': ['Break down large items', 'Add intermediate hierarchy levels']
                })
            
            # Over-decomposition anti-pattern
            if metrics.get('max_depth', 0) > 8:
                anti_patterns.append({
                    'type': 'over_decomposition',
                    'name': 'Over-Decomposition Anti-Pattern',
                    'description': 'Excessive breakdown creating unnecessary complexity',
                    'severity': 'medium',
                    'confidence': min(1.0, (metrics['max_depth'] - 6) / 4),
                    'consequences': ['Management overhead', 'Lost context', 'Coordination complexity'],
                    'solutions': ['Consolidate related items', 'Reduce hierarchy depth']
                })
            
            # Unbalanced tree anti-pattern
            branching_factors = structure_features.get('branching_factors', [])
            if branching_factors and np.std(branching_factors) > 3:
                anti_patterns.append({
                    'type': 'unbalanced_tree',
                    'name': 'Unbalanced Tree Anti-Pattern',
                    'description': 'Highly uneven distribution of work items',
                    'severity': 'medium',
                    'confidence': min(1.0, np.std(branching_factors) / 5),
                    'consequences': ['Uneven workload', 'Bottlenecks', 'Resource allocation issues'],
                    'solutions': ['Redistribute work items', 'Balance team assignments']
                })
        
        # Naming inconsistency anti-pattern
        if 'text_features' in structure_features:
            texts = structure_features['text_features']
            if len(texts) > 5:
                # Check for naming consistency
                common_words = Counter()
                for text in texts:
                    words = text.lower().split()
                    common_words.update(words)
                
                # If no words appear more than once, likely inconsistent naming
                if len(common_words) > 0 and max(common_words.values()) <= 1:
                    anti_patterns.append({
                        'type': 'inconsistent_naming',
                        'name': 'Inconsistent Naming Anti-Pattern',
                        'description': 'No common naming conventions used',
                        'severity': 'low',
                        'confidence': 0.6,
                        'consequences': ['Poor readability', 'Confusion', 'Maintenance issues'],
                        'solutions': ['Establish naming conventions', 'Standardize terminology']
                    })
        
        return anti_patterns
    
    def discover_successful_patterns(self, min_frequency: int = 3) -> List[Pattern]:
        """Discover patterns that correlate with project success"""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.execute('''
                SELECT project_id, project_name, structure, success_score
                FROM project_structures 
                WHERE success_score > 0.7
                ORDER BY success_score DESC
            ''')
            
            successful_projects = cursor.fetchall()
        
        if len(successful_projects) < min_frequency:
            logger.warning(f"Insufficient successful projects for pattern discovery: {len(successful_projects)}")
            return []
        
        # Extract features from successful projects
        all_features = []
        for project_id, name, structure_str, success_score in successful_projects:
            try:
                features = json.loads(structure_str)
                features['success_score'] = success_score
                all_features.append(features)
            except:
                continue
        
        patterns = []
        
        # Cluster successful projects to find common patterns
        try:
            patterns.extend(self._cluster_successful_patterns(all_features))
        except Exception as e:
            logger.error(f"Clustering failed: {e}")
        
        # Analyze common structural characteristics
        patterns.extend(self._analyze_common_characteristics(all_features))
        
        # Store discovered patterns
        for pattern in patterns:
            self._store_pattern(pattern)
        
        return patterns
    
    def _cluster_successful_patterns(self, features_list: List[Dict[str, Any]]) -> List[Pattern]:
        """Use clustering to identify patterns in successful projects"""
        if len(features_list) < 3:
            return []
        
        # Create feature vectors for clustering
        feature_vectors = []
        valid_indices = []
        
        for i, features in enumerate(features_list):
            if 'graph_metrics' in features:
                metrics = features['graph_metrics']
                vector = [
                    metrics.get('total_nodes', 0),
                    metrics.get('max_depth', 0),
                    metrics.get('average_branching', 0),
                    metrics.get('density', 0),
                    features.get('success_score', 0)
                ]
                feature_vectors.append(vector)
                valid_indices.append(i)
        
        if len(feature_vectors) < 3:
            return []
        
        patterns = []
        feature_array = np.array(feature_vectors)
        
        # Normalize features
        from sklearn.preprocessing import StandardScaler
        scaler = StandardScaler()
        feature_array_scaled = scaler.fit_transform(feature_array)
        
        # Try different clustering approaches
        for cluster_name, clusterer in self.clustering_models.items():
            try:
                if cluster_name == 'kmeans':
                    n_clusters = min(5, len(feature_vectors) // 2)
                    clusterer = KMeans(n_clusters=n_clusters, random_state=42)
                
                cluster_labels = clusterer.fit_predict(feature_array_scaled)
                
                # Analyze each cluster
                for cluster_id in set(cluster_labels):
                    if cluster_id == -1:  # Noise in DBSCAN
                        continue
                    
                    cluster_indices = [i for i, label in enumerate(cluster_labels) if label == cluster_id]
                    
                    if len(cluster_indices) >= 2:  # At least 2 projects in cluster
                        cluster_features = [features_list[valid_indices[i]] for i in cluster_indices]
                        pattern = self._create_pattern_from_cluster(
                            cluster_id, cluster_name, cluster_features
                        )
                        patterns.append(pattern)
                        
            except Exception as e:
                logger.warning(f"Clustering with {cluster_name} failed: {e}")
        
        return patterns
    
    def _create_pattern_from_cluster(self, 
                                   cluster_id: int,
                                   cluster_method: str,
                                   cluster_features: List[Dict[str, Any]]) -> Pattern:
        """Create a pattern from clustered features"""
        # Calculate average characteristics
        avg_metrics = defaultdict(list)
        project_examples = []
        
        for features in cluster_features:
            if 'graph_metrics' in features:
                metrics = features['graph_metrics']
                for key, value in metrics.items():
                    if isinstance(value, (int, float)):
                        avg_metrics[key].append(value)
            
            # Get project example (first few characters of structure)
            project_examples.append(str(features)[:100])
        
        # Calculate averages
        pattern_structure = {}
        for key, values in avg_metrics.items():
            pattern_structure[key] = {
                'average': np.mean(values),
                'std': np.std(values),
                'range': [min(values), max(values)]
            }
        
        # Calculate success rate
        success_scores = [f.get('success_score', 0) for f in cluster_features]
        avg_success = np.mean(success_scores)
        
        pattern_id = f"cluster_{cluster_method}_{cluster_id}_{datetime.now().strftime('%Y%m%d')}"
        
        return Pattern(
            pattern_id=pattern_id,
            pattern_type='cluster_based',
            name=f'Successful {cluster_method.title()} Pattern #{cluster_id}',
            description=f'Pattern discovered through {cluster_method} clustering of successful projects',
            structure=pattern_structure,
            frequency=len(cluster_features),
            success_rate=avg_success,
            examples=project_examples[:3]  # First 3 examples
        )
    
    def _analyze_common_characteristics(self, features_list: List[Dict[str, Any]]) -> List[Pattern]:
        """Analyze common characteristics across successful projects"""
        patterns = []
        
        if not features_list:
            return patterns
        
        # Analyze depth patterns
        depths = [f.get('graph_metrics', {}).get('max_depth', 0) for f in features_list]
        depths = [d for d in depths if d > 0]
        
        if depths:
            common_depth = Counter(depths).most_common(1)[0]
            if common_depth[1] >= 3:  # At least 3 projects
                patterns.append(Pattern(
                    pattern_id=f"common_depth_{common_depth[0]}",
                    pattern_type='characteristic_based',
                    name=f'Optimal Depth Pattern ({common_depth[0]} levels)',
                    description=f'Successful projects tend to have {common_depth[0]} hierarchy levels',
                    structure={'optimal_depth': common_depth[0]},
                    frequency=common_depth[1],
                    success_rate=np.mean([f.get('success_score', 0) for f in features_list]),
                    examples=[f"Depth {common_depth[0]} used in {common_depth[1]} successful projects"]
                ))
        
        # Analyze branching patterns
        branchings = []
        for f in features_list:
            avg_branch = f.get('graph_metrics', {}).get('average_branching', 0)
            if avg_branch > 0:
                branchings.append(avg_branch)
        
        if branchings:
            # Find the most common branching range
            branching_ranges = []
            for b in branchings:
                if b <= 2:
                    branching_ranges.append('narrow')
                elif b <= 4:
                    branching_ranges.append('moderate')
                else:
                    branching_ranges.append('wide')
            
            common_range = Counter(branching_ranges).most_common(1)[0]
            if common_range[1] >= 3:
                patterns.append(Pattern(
                    pattern_id=f"common_branching_{common_range[0]}",
                    pattern_type='characteristic_based',
                    name=f'Optimal Branching Pattern ({common_range[0]})',
                    description=f'Successful projects tend to have {common_range[0]} branching factor',
                    structure={'optimal_branching': common_range[0]},
                    frequency=common_range[1],
                    success_rate=np.mean([f.get('success_score', 0) for f in features_list]),
                    examples=[f"{common_range[0].title()} branching used in {common_range[1]} successful projects"]
                ))
        
        return patterns
    
    def _store_pattern(self, pattern: Pattern):
        """Store discovered pattern in database"""
        with sqlite3.connect(self.db_path) as conn:
            conn.execute('''
                INSERT OR REPLACE INTO patterns 
                (pattern_id, pattern_type, name, description, structure, frequency,
                 success_rate, examples, template_data, anti_pattern, created_date, last_updated)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (
                pattern.pattern_id, pattern.pattern_type, pattern.name,
                pattern.description, json.dumps(pattern.structure),
                pattern.frequency, pattern.success_rate,
                json.dumps(pattern.examples),
                json.dumps(pattern.template) if pattern.template else None,
                1 if pattern.anti_pattern else 0,
                datetime.now().isoformat(),
                datetime.now().isoformat()
            ))
    
    def create_template_from_pattern(self, pattern_id: str, template_name: Optional[str] = None) -> Template:
        """Create a reusable template from a successful pattern"""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.execute(
                'SELECT * FROM patterns WHERE pattern_id = ?',
                (pattern_id,)
            )
            pattern_data = cursor.fetchone()
            
            if not pattern_data:
                raise ValueError(f"Pattern {pattern_id} not found")
        
        (pid, ptype, name, desc, structure_str, freq, success_rate,
         examples_str, template_data, anti_pattern, created, updated) = pattern_data
        
        if anti_pattern:
            raise ValueError("Cannot create template from anti-pattern")
        
        structure = json.loads(structure_str)
        examples = json.loads(examples_str) if examples_str else []
        
        template_id = f"template_{pattern_id}_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
        template_name = template_name or f"Template from {name}"
        
        # Extract parameters from structure
        parameters = self._extract_template_parameters(structure)
        
        # Create template structure
        template_structure = self._create_template_structure(structure, parameters)
        
        # Determine category
        category = self._determine_template_category(name, structure)
        
        # Calculate success metrics
        success_metrics = {
            'historical_success_rate': success_rate,
            'usage_frequency': freq,
            'pattern_confidence': min(1.0, freq / 10.0)
        }
        
        template = Template(
            template_id=template_id,
            name=template_name,
            description=f"Template generated from successful pattern: {desc}",
            category=category,
            structure=template_structure,
            parameters=parameters,
            success_metrics=success_metrics
        )
        
        # Store template
        with sqlite3.connect(self.db_path) as conn:
            conn.execute('''
                INSERT INTO templates 
                (template_id, name, description, category, structure, parameters,
                 success_metrics, usage_count, created_date, last_used)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (
                template.template_id, template.name, template.description,
                template.category, json.dumps(template.structure),
                json.dumps(template.parameters), json.dumps(template.success_metrics),
                0, datetime.now().isoformat(), None
            ))
        
        logger.info(f"Created template: {template_name} from pattern {pattern_id}")
        return template
    
    def _extract_template_parameters(self, structure: Dict[str, Any]) -> List[str]:
        """Extract configurable parameters from pattern structure"""
        parameters = []
        
        # Add common parameters
        if 'optimal_depth' in structure:
            parameters.append('max_hierarchy_depth')
        
        if 'optimal_branching' in structure:
            parameters.append('max_children_per_node')
        
        if 'average' in str(structure):
            parameters.extend(['project_size', 'team_size', 'complexity_level'])
        
        return parameters
    
    def _create_template_structure(self, 
                                 pattern_structure: Dict[str, Any],
                                 parameters: List[str]) -> Dict[str, Any]:
        """Create template structure with parameterized values"""
        template_structure = {
            'type': 'hierarchical_breakdown_template',
            'parameters': {param: f"${{{param}}}" for param in parameters},
            'constraints': {},
            'guidelines': []
        }
        
        # Add constraints based on pattern
        if 'optimal_depth' in pattern_structure:
            depth = pattern_structure['optimal_depth']
            template_structure['constraints']['max_depth'] = depth
            template_structure['guidelines'].append(f"Maintain hierarchy depth around {depth} levels")
        
        if 'optimal_branching' in pattern_structure:
            branching = pattern_structure['optimal_branching']
            template_structure['guidelines'].append(f"Use {branching} branching strategy")
        
        return template_structure
    
    def _determine_template_category(self, name: str, structure: Dict[str, Any]) -> str:
        """Determine template category based on characteristics"""
        name_lower = name.lower()
        
        if 'technical' in name_lower or 'api' in name_lower:
            return 'technical'
        elif 'feature' in name_lower or 'user' in name_lower:
            return 'feature_based'
        elif 'depth' in name_lower:
            return 'structural_depth'
        elif 'branching' in name_lower:
            return 'structural_branching'
        else:
            return 'general'
    
    def suggest_template_for_project(self, 
                                   project_characteristics: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Suggest appropriate templates for a new project"""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.execute('''
                SELECT template_id, name, description, category, structure, 
                       parameters, success_metrics, usage_count
                FROM templates 
                ORDER BY usage_count DESC, created_date DESC
            ''')
            
            templates = cursor.fetchall()
        
        suggestions = []
        
        for template_data in templates:
            (tid, name, desc, category, structure_str, params_str, 
             metrics_str, usage_count) = template_data
            
            try:
                structure = json.loads(structure_str)
                parameters = json.loads(params_str) if params_str else []
                success_metrics = json.loads(metrics_str) if metrics_str else {}
                
                # Calculate match score
                match_score = self._calculate_template_match(
                    project_characteristics, structure, category, success_metrics
                )
                
                if match_score > 0.3:  # Threshold for suggestion
                    suggestions.append({
                        'template_id': tid,
                        'name': name,
                        'description': desc,
                        'category': category,
                        'match_score': match_score,
                        'success_rate': success_metrics.get('historical_success_rate', 0),
                        'usage_count': usage_count,
                        'parameters': parameters,
                        'why_suggested': self._explain_template_match(
                            project_characteristics, structure, category, match_score
                        )
                    })
                    
            except Exception as e:
                logger.warning(f"Error processing template {tid}: {e}")
        
        # Sort by match score and success rate
        suggestions.sort(key=lambda x: (x['match_score'], x['success_rate']), reverse=True)
        return suggestions[:5]  # Top 5 suggestions
    
    def _calculate_template_match(self,
                                project_chars: Dict[str, Any],
                                template_structure: Dict[str, Any],
                                category: str,
                                success_metrics: Dict[str, Any]) -> float:
        """Calculate how well a template matches project characteristics"""
        match_factors = []
        
        # Category match
        project_type = project_chars.get('type', 'general')
        if category in project_type or project_type in category:
            match_factors.append(0.8)
        elif category == 'general':
            match_factors.append(0.5)
        else:
            match_factors.append(0.2)
        
        # Size match
        project_size = project_chars.get('estimated_size', 'medium')
        if 'constraints' in template_structure:
            constraints = template_structure['constraints']
            if 'max_depth' in constraints:
                template_depth = constraints['max_depth']
                if project_size == 'small' and template_depth <= 3:
                    match_factors.append(0.9)
                elif project_size == 'medium' and 3 < template_depth <= 5:
                    match_factors.append(0.9)
                elif project_size == 'large' and template_depth > 5:
                    match_factors.append(0.9)
                else:
                    match_factors.append(0.4)
        
        # Complexity match
        project_complexity = project_chars.get('complexity', 'medium')
        template_complexity = self._infer_template_complexity(template_structure)
        
        if project_complexity == template_complexity:
            match_factors.append(0.8)
        elif abs(['low', 'medium', 'high'].index(project_complexity) - 
                ['low', 'medium', 'high'].index(template_complexity)) == 1:
            match_factors.append(0.6)
        else:
            match_factors.append(0.3)
        
        # Success rate bonus
        success_rate = success_metrics.get('historical_success_rate', 0)
        match_factors.append(success_rate * 0.3)  # Up to 0.3 bonus for high success rate
        
        return np.mean(match_factors) if match_factors else 0.0
    
    def _infer_template_complexity(self, template_structure: Dict[str, Any]) -> str:
        """Infer complexity level from template structure"""
        if 'constraints' in template_structure:
            constraints = template_structure['constraints']
            depth = constraints.get('max_depth', 3)
            
            if depth <= 3:
                return 'low'
            elif depth <= 5:
                return 'medium'
            else:
                return 'high'
        
        return 'medium'
    
    def _explain_template_match(self,
                              project_chars: Dict[str, Any],
                              template_structure: Dict[str, Any],
                              category: str,
                              match_score: float) -> str:
        """Explain why a template was suggested"""
        reasons = []
        
        if match_score > 0.8:
            reasons.append("Excellent match for project characteristics")
        elif match_score > 0.6:
            reasons.append("Good match for project type and size")
        else:
            reasons.append("Partial match - consider adapting")
        
        project_type = project_chars.get('type', 'general')
        if category in project_type:
            reasons.append(f"Category '{category}' matches project type")
        
        project_size = project_chars.get('estimated_size', 'medium')
        reasons.append(f"Suitable for {project_size}-sized projects")
        
        return "; ".join(reasons)
    
    def _generate_pattern_recommendations(self,
                                        structure_features: Dict[str, Any],
                                        patterns: List[Dict[str, Any]],
                                        anti_patterns: List[Dict[str, Any]],
                                        similar_projects: List[Dict[str, Any]]) -> List[str]:
        """Generate actionable recommendations based on analysis"""
        recommendations = []
        
        # Recommendations from patterns
        for pattern in patterns:
            if pattern['type'] == 'balanced_hierarchy':
                recommendations.append("Maintain current balanced structure - it's optimal for success")
            elif pattern['type'] == 'deep_hierarchy':
                recommendations.append("Consider flattening hierarchy to improve manageability")
            elif pattern['type'] == 'wide_hierarchy':
                recommendations.append("Consider adding intermediate grouping levels")
        
        # Recommendations from anti-patterns
        for anti_pattern in anti_patterns:
            if anti_pattern['type'] == 'monolith_structure':
                recommendations.append("Break down large components into smaller, manageable pieces")
            elif anti_pattern['type'] == 'over_decomposition':
                recommendations.append("Consolidate over-decomposed items to reduce complexity")
            elif anti_pattern['type'] == 'unbalanced_tree':
                recommendations.append("Rebalance work distribution across hierarchy branches")
        
        # Recommendations from similar projects
        if similar_projects:
            best_similar = max(similar_projects, key=lambda x: x['success_score'])
            recommendations.append(
                f"Consider patterns from similar successful project: {best_similar['project_name']}"
            )
        
        # General recommendations
        if not patterns and not anti_patterns:
            recommendations.append("Structure appears unique - monitor success metrics closely")
        
        return recommendations

def main():
    """Main function for CLI usage"""
    import argparse
    
    parser = argparse.ArgumentParser(description="Pattern Recognition System")
    parser.add_argument("--action", choices=[
        'analyze', 'discover', 'create_template', 'suggest', 'export'
    ], required=True, help="Action to perform")
    
    # Analysis arguments
    parser.add_argument("--project-id", help="Project ID")
    parser.add_argument("--project-name", help="Project name")
    parser.add_argument("--hierarchy-file", help="JSON file with hierarchy data")
    parser.add_argument("--success-metrics", help="JSON string with success metrics")
    
    # Template creation arguments
    parser.add_argument("--pattern-id", help="Pattern ID for template creation")
    parser.add_argument("--template-name", help="Template name")
    
    # Suggestion arguments
    parser.add_argument("--characteristics", help="JSON string with project characteristics")
    
    # Discovery arguments
    parser.add_argument("--min-frequency", type=int, default=3, help="Minimum pattern frequency")
    
    args = parser.parse_args()
    
    recognizer = PatternRecognition()
    
    if args.action == 'analyze':
        if not all([args.project_id, args.project_name, args.hierarchy_file]):
            print("Error: Project ID, name, and hierarchy file required")
            return
        
        # Load hierarchy data
        with open(args.hierarchy_file, 'r') as f:
            hierarchy_data = json.load(f)
        
        success_metrics = json.loads(args.success_metrics) if args.success_metrics else {}
        
        result = recognizer.analyze_project_structure(
            args.project_id, args.project_name, hierarchy_data, success_metrics
        )
        print(json.dumps(result, indent=2))
        
    elif args.action == 'discover':
        patterns = recognizer.discover_successful_patterns(args.min_frequency)
        result = [asdict(pattern) for pattern in patterns]
        print(json.dumps(result, indent=2, default=str))
        
    elif args.action == 'create_template':
        if not args.pattern_id:
            print("Error: Pattern ID required")
            return
            
        template = recognizer.create_template_from_pattern(
            args.pattern_id, args.template_name
        )
        print(json.dumps(asdict(template), indent=2, default=str))
        
    elif args.action == 'suggest':
        if not args.characteristics:
            print("Error: Project characteristics required")
            return
            
        characteristics = json.loads(args.characteristics)
        suggestions = recognizer.suggest_template_for_project(characteristics)
        print(json.dumps(suggestions, indent=2))
        
    elif args.action == 'export':
        # Export all patterns and templates
        with sqlite3.connect(recognizer.db_path) as conn:
            # Get patterns
            cursor = conn.execute('SELECT * FROM patterns')
            patterns = [dict(zip([col[0] for col in cursor.description], row)) 
                       for row in cursor.fetchall()]
            
            # Get templates
            cursor = conn.execute('SELECT * FROM templates')
            templates = [dict(zip([col[0] for col in cursor.description], row)) 
                        for row in cursor.fetchall()]
        
        export_data = {
            'export_timestamp': datetime.now().isoformat(),
            'patterns': patterns,
            'templates': templates
        }
        
        print(json.dumps(export_data, indent=2, default=str))

if __name__ == "__main__":
    main()