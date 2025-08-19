#!/usr/bin/env python3
"""
Parallel Sprint Planning Agent
Maximizes parallelism by analyzing dependencies and creating optimal sprint tracks
"""

import json
import asyncio
from datetime import datetime
from typing import Dict, List, Set, Tuple, Any
from collections import defaultdict, deque

class ParallelSprintPlanningAgent:
    """
    Analyzes feature dependencies and creates optimal parallel sprint tracks
    """
    
    def __init__(self, max_processes: int = 1000):
        self.max_processes = max_processes
        self.agents_per_team = 16  # Standard team size
        self.max_teams = max_processes // self.agents_per_team  # 62 teams with 1000 processes
        self.stories_per_sprint = 5
        self.dependency_graph = {}
        self.parallel_tracks = []
        self.sequential_tracks = []
        self.resource_allocation = {}
        
    def analyze_features(self, features: List[Dict]) -> Dict:
        """
        Analyze features and their dependencies
        """
        analysis = {
            'total_features': len(features),
            'dependency_graph': {},
            'independent_features': [],
            'dependent_features': [],
            'critical_path': [],
            'parallelism_score': 0.0
        }
        
        # Build dependency graph
        for feature in features:
            feature_id = feature.get('id', feature.get('name'))
            dependencies = feature.get('dependencies', [])
            
            self.dependency_graph[feature_id] = {
                'dependencies': dependencies,
                'complexity': feature.get('complexity', 'medium'),
                'priority': feature.get('priority', 'medium'),
                'estimated_effort': feature.get('effort', 5),
                'feature': feature
            }
            
            if not dependencies:
                analysis['independent_features'].append(feature_id)
            else:
                analysis['dependent_features'].append(feature_id)
        
        analysis['dependency_graph'] = self.dependency_graph
        
        # Calculate critical path
        analysis['critical_path'] = self._find_critical_path()
        
        # Calculate parallelism score (0-1, higher is better)
        if len(features) > 0:
            analysis['parallelism_score'] = len(analysis['independent_features']) / len(features)
        
        return analysis
    
    def _find_critical_path(self) -> List[str]:
        """
        Find the longest dependency chain (critical path)
        """
        def dfs(node: str, visited: Set[str], path: List[str]) -> List[str]:
            if node in visited:
                return path
            
            visited.add(node)
            path.append(node)
            
            longest_subpath = []
            if node in self.dependency_graph:
                for dep in self.dependency_graph[node]['dependencies']:
                    if dep not in visited:
                        subpath = dfs(dep, visited.copy(), [])
                        if len(subpath) > len(longest_subpath):
                            longest_subpath = subpath
            
            return path + longest_subpath
        
        longest_path = []
        for node in self.dependency_graph:
            path = dfs(node, set(), [])
            if len(path) > len(longest_path):
                longest_path = path
        
        return longest_path
    
    def create_parallel_tracks(self, features: List[Dict]) -> Dict:
        """
        Create optimal parallel execution tracks
        """
        analysis = self.analyze_features(features)
        
        # Topological sort for dependency ordering
        sorted_features = self._topological_sort()
        
        # Group features into parallel tracks
        tracks = self._group_into_tracks(sorted_features)
        
        # Allocate resources to tracks
        allocation = self._allocate_resources(tracks)
        
        result = {
            'analysis': analysis,
            'tracks': tracks,
            'resource_allocation': allocation,
            'execution_plan': self._create_execution_plan(tracks, allocation),
            'estimated_duration': self._estimate_duration(tracks),
            'optimization_suggestions': self._generate_suggestions(analysis)
        }
        
        return result
    
    def _topological_sort(self) -> List[List[str]]:
        """
        Perform topological sort to identify execution levels
        """
        in_degree = defaultdict(int)
        adjacency = defaultdict(list)
        
        # Build adjacency list and calculate in-degrees
        for node, data in self.dependency_graph.items():
            for dep in data['dependencies']:
                adjacency[dep].append(node)
                in_degree[node] += 1
        
        # Find all nodes with no dependencies
        queue = deque([node for node in self.dependency_graph if in_degree[node] == 0])
        levels = []
        
        while queue:
            current_level = []
            level_size = len(queue)
            
            for _ in range(level_size):
                node = queue.popleft()
                current_level.append(node)
                
                # Reduce in-degree for dependent nodes
                for neighbor in adjacency[node]:
                    in_degree[neighbor] -= 1
                    if in_degree[neighbor] == 0:
                        queue.append(neighbor)
            
            levels.append(current_level)
        
        return levels
    
    def _group_into_tracks(self, sorted_features: List[List[str]]) -> List[Dict]:
        """
        Group features into parallel and sequential tracks
        """
        tracks = []
        
        for level_idx, level in enumerate(sorted_features):
            # Each level can be executed in parallel
            if len(level) == 1:
                # Sequential track needed
                track = {
                    'id': f'track_seq_{level_idx}',
                    'type': 'sequential',
                    'features': level,
                    'level': level_idx,
                    'can_parallel': False
                }
            else:
                # Parallel track possible
                track = {
                    'id': f'track_par_{level_idx}',
                    'type': 'parallel',
                    'features': level,
                    'level': level_idx,
                    'can_parallel': True
                }
            tracks.append(track)
        
        return tracks
    
    def _allocate_resources(self, tracks: List[Dict]) -> Dict:
        """
        Dynamically allocate processes to tracks based on complexity and priority
        """
        allocation = {}
        total_complexity = 0
        
        # Calculate total complexity
        for track in tracks:
            track_complexity = 0
            for feature_id in track['features']:
                if feature_id in self.dependency_graph:
                    complexity = self.dependency_graph[feature_id]['complexity']
                    priority = self.dependency_graph[feature_id]['priority']
                    
                    # Weight calculation
                    weight = {
                        'low': 1, 'medium': 2, 'high': 3
                    }.get(complexity, 2)
                    
                    priority_mult = {
                        'low': 0.8, 'medium': 1.0, 'high': 1.5
                    }.get(priority, 1.0)
                    
                    track_complexity += weight * priority_mult
            
            allocation[track['id']] = {
                'complexity': track_complexity,
                'features': track['features']
            }
            total_complexity += track_complexity
        
        # Allocate processes proportionally
        available_processes = self.max_processes - 100  # Keep 100 as reserve
        
        for track_id, data in allocation.items():
            if total_complexity > 0:
                process_count = int((data['complexity'] / total_complexity) * available_processes)
                # Ensure minimum allocation
                process_count = max(process_count, self.agents_per_team)
                # Round to team size
                team_count = process_count // self.agents_per_team
                process_count = team_count * self.agents_per_team
            else:
                process_count = self.agents_per_team
            
            allocation[track_id]['processes'] = process_count
            allocation[track_id]['teams'] = process_count // self.agents_per_team
        
        return allocation
    
    def _create_execution_plan(self, tracks: List[Dict], allocation: Dict) -> List[Dict]:
        """
        Create detailed execution plan with timing
        """
        plan = []
        current_time = 0
        
        for track in tracks:
            track_allocation = allocation.get(track['id'], {})
            
            step = {
                'step': len(plan) + 1,
                'track_id': track['id'],
                'type': track['type'],
                'features': track['features'],
                'teams': track_allocation.get('teams', 1),
                'processes': track_allocation.get('processes', self.agents_per_team),
                'start_time': current_time,
                'duration': self._estimate_track_duration(track, track_allocation),
                'can_parallel': track['can_parallel']
            }
            
            plan.append(step)
            
            # Update time for sequential tracks
            if not track['can_parallel']:
                current_time += step['duration']
        
        return plan
    
    def _estimate_track_duration(self, track: Dict, allocation: Dict) -> float:
        """
        Estimate duration for a track in seconds
        """
        total_effort = 0
        for feature_id in track['features']:
            if feature_id in self.dependency_graph:
                total_effort += self.dependency_graph[feature_id]['estimated_effort']
        
        # With parallel teams, duration reduces
        teams = allocation.get('teams', 1)
        
        # Base time: 5 seconds per story
        base_time = (total_effort * 5) / teams
        
        # Add overhead for coordination
        if track['can_parallel']:
            overhead = 1.1  # 10% overhead for parallel coordination
        else:
            overhead = 1.0  # No overhead for sequential
        
        return base_time * overhead
    
    def _estimate_duration(self, tracks: List[Dict]) -> float:
        """
        Estimate total sprint duration
        """
        total_duration = 0
        parallel_duration = 0
        
        for track in tracks:
            track_duration = self._estimate_track_duration(
                track, 
                self.resource_allocation.get(track['id'], {'teams': 1})
            )
            
            if track['can_parallel']:
                parallel_duration = max(parallel_duration, track_duration)
            else:
                total_duration += track_duration
        
        return total_duration + parallel_duration
    
    def _generate_suggestions(self, analysis: Dict) -> List[str]:
        """
        Generate optimization suggestions
        """
        suggestions = []
        
        # Check parallelism score
        if analysis['parallelism_score'] < 0.5:
            suggestions.append(
                f"Low parallelism score ({analysis['parallelism_score']:.2f}). "
                "Consider breaking down dependent features into smaller, independent stories."
            )
        
        # Check critical path
        if len(analysis['critical_path']) > 5:
            suggestions.append(
                f"Long critical path ({len(analysis['critical_path'])} steps). "
                "Consider refactoring to reduce dependencies."
            )
        
        # Check for bottlenecks
        if len(analysis['independent_features']) < len(analysis['dependent_features']):
            suggestions.append(
                "More dependent features than independent. "
                "Prioritize completing independent features first to unblock others."
            )
        
        # Resource optimization
        if self.max_teams > len(analysis['independent_features']):
            suggestions.append(
                f"You have capacity for {self.max_teams} teams but only "
                f"{len(analysis['independent_features'])} independent features. "
                "Consider splitting large features for better parallelism."
            )
        
        return suggestions
    
    def optimize_sprint(self, current_sprint: Dict) -> Dict:
        """
        Optimize an existing sprint for better parallelism
        """
        optimizations = {
            'original': current_sprint,
            'optimized': {},
            'improvements': []
        }
        
        # Analyze current sprint
        features = current_sprint.get('features', [])
        current_analysis = self.analyze_features(features)
        
        # Suggestions for optimization
        if current_analysis['parallelism_score'] < 0.7:
            # Try to break down complex features
            optimized_features = []
            for feature in features:
                if feature.get('complexity') == 'high' and not feature.get('dependencies'):
                    # Split high complexity independent features
                    sub_features = self._split_feature(feature)
                    optimized_features.extend(sub_features)
                    optimizations['improvements'].append(
                        f"Split feature '{feature.get('name')}' into {len(sub_features)} sub-features"
                    )
                else:
                    optimized_features.append(feature)
            
            optimizations['optimized']['features'] = optimized_features
            optimizations['optimized']['tracks'] = self.create_parallel_tracks(optimized_features)
        
        return optimizations
    
    def _split_feature(self, feature: Dict) -> List[Dict]:
        """
        Split a complex feature into smaller sub-features
        """
        sub_features = []
        base_name = feature.get('name', 'Feature')
        
        # Common splits for different feature types
        if 'auth' in base_name.lower():
            splits = ['Login UI', 'Registration', 'Password Reset', 'Session Management']
        elif 'payment' in base_name.lower():
            splits = ['Payment UI', 'Stripe Integration', 'Transaction History', 'Receipts']
        elif 'dashboard' in base_name.lower():
            splits = ['Layout', 'Widgets', 'Data Fetching', 'Real-time Updates']
        else:
            splits = ['Frontend', 'Backend', 'Database', 'Testing']
        
        for idx, split_name in enumerate(splits):
            sub_feature = {
                'id': f"{feature.get('id', 'f')}_{idx}",
                'name': f"{base_name} - {split_name}",
                'complexity': 'low',
                'priority': feature.get('priority', 'medium'),
                'dependencies': [],
                'effort': 2
            }
            sub_features.append(sub_feature)
        
        return sub_features
    
    def monitor_sprint_execution(self, sprint_status: Dict) -> Dict:
        """
        Monitor ongoing sprint and suggest reallocations
        """
        monitoring = {
            'status': sprint_status,
            'bottlenecks': [],
            'reallocation_suggestions': [],
            'health_score': 0.0
        }
        
        # Identify bottlenecks
        for track_id, track_status in sprint_status.get('tracks', {}).items():
            completion_rate = track_status.get('completion_rate', 0)
            if completion_rate < 0.5 and track_status.get('elapsed_time', 0) > 10:
                monitoring['bottlenecks'].append({
                    'track': track_id,
                    'completion': completion_rate,
                    'suggestion': 'Allocate more resources to this track'
                })
        
        # Calculate health score
        total_completion = sum(
            t.get('completion_rate', 0) 
            for t in sprint_status.get('tracks', {}).values()
        )
        track_count = len(sprint_status.get('tracks', {}))
        
        if track_count > 0:
            monitoring['health_score'] = total_completion / track_count
        
        # Generate reallocation suggestions
        if monitoring['health_score'] < 0.7:
            monitoring['reallocation_suggestions'].append(
                "Sprint health is low. Consider reallocating idle resources to bottleneck tracks."
            )
        
        return monitoring


if __name__ == "__main__":
    # Test the agent
    planner = ParallelSprintPlanningAgent(max_processes=1000)
    
    # Sample features with dependencies
    features = [
        {'id': 'auth', 'name': 'Authentication', 'complexity': 'high', 'priority': 'high', 'dependencies': []},
        {'id': 'profile', 'name': 'User Profile', 'complexity': 'medium', 'priority': 'medium', 'dependencies': ['auth']},
        {'id': 'dashboard', 'name': 'Dashboard', 'complexity': 'high', 'priority': 'high', 'dependencies': ['auth', 'profile']},
        {'id': 'payments', 'name': 'Payments', 'complexity': 'high', 'priority': 'high', 'dependencies': ['auth']},
        {'id': 'analytics', 'name': 'Analytics', 'complexity': 'medium', 'priority': 'low', 'dependencies': []},
        {'id': 'seo', 'name': 'SEO Pages', 'complexity': 'low', 'priority': 'medium', 'dependencies': []},
        {'id': 'roulette', 'name': 'Roulette Engine', 'complexity': 'high', 'priority': 'high', 'dependencies': []},
        {'id': 'social', 'name': 'Social Features', 'complexity': 'medium', 'priority': 'low', 'dependencies': ['auth', 'profile']},
    ]
    
    result = planner.create_parallel_tracks(features)
    
    print("🎯 Parallel Sprint Planning Complete!")
    print(f"Parallelism Score: {result['analysis']['parallelism_score']:.2f}")
    print(f"Total Tracks: {len(result['tracks'])}")
    print(f"Estimated Duration: {result['estimated_duration']:.1f} seconds")
    print(f"Suggestions: {result['optimization_suggestions']}")