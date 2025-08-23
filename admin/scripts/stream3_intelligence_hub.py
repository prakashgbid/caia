#!/usr/bin/env python3
"""
Stream 3 Intelligence Hub - Hierarchical Agent System
Unified interface for all Stream 3 intelligence and learning modules
Orchestrates traceability, estimation, patterns, confidence, and analytics
"""

import os
import json
import asyncio
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, List, Any, Optional
import logging

# Import all Stream 3 modules
from traceability.traceability_manager import TraceabilityManager
from learning.estimation_learning import EstimationLearning
from patterns.pattern_recognition import PatternRecognition
from confidence.confidence_scorer import ConfidenceScorer
from analytics.analytics_engine import AnalyticsEngine

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Configuration
ADMIN_ROOT = "/Users/MAC/Documents/projects/admin"

class IntelligenceHub:
    """
    Central hub for all Stream 3 intelligence and learning capabilities
    Provides unified interface and orchestrates all components
    """
    
    def __init__(self):
        self.admin_root = Path(ADMIN_ROOT)
        self.admin_root.mkdir(parents=True, exist_ok=True)
        
        # Initialize all components
        self.traceability = TraceabilityManager()
        self.estimation = EstimationLearning()
        self.patterns = PatternRecognition()
        self.confidence = ConfidenceScorer()
        self.analytics = AnalyticsEngine()
        
        logger.info("Intelligence Hub initialized with all Stream 3 components")
    
    async def process_new_project(self, 
                                 project_id: str,
                                 project_data: Dict[str, Any],
                                 team_context: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """
        Process a new project through all intelligence modules
        Returns comprehensive analysis and recommendations
        """
        logger.info(f"Processing new project: {project_id}")
        
        results = {
            'project_id': project_id,
            'processing_timestamp': datetime.now().isoformat(),
            'traceability_analysis': {},
            'estimation_analysis': {},
            'pattern_analysis': {},
            'confidence_analysis': {},
            'integrated_recommendations': [],
            'risk_assessment': {},
            'success_predictions': {}
        }
        
        try:
            # 1. Build traceability structure
            if 'hierarchy_data' in project_data:
                hierarchy_data = project_data['hierarchy_data']
                
                # Create hierarchy nodes in traceability system
                await self._build_traceability_structure(project_id, hierarchy_data)
                
                # Analyze project structure with patterns
                pattern_analysis = self.patterns.analyze_project_structure(
                    project_id,
                    project_data.get('name', project_id),
                    hierarchy_data,
                    project_data.get('success_metrics', {})
                )
                results['pattern_analysis'] = pattern_analysis
                
                # Generate confidence scores for all items
                confidence_analysis = await self._analyze_project_confidence(
                    project_id, hierarchy_data, team_context
                )
                results['confidence_analysis'] = confidence_analysis
            
            # 2. Process estimations if provided
            if 'estimations' in project_data:
                estimation_analysis = await self._process_project_estimations(
                    project_id, project_data['estimations'], team_context
                )
                results['estimation_analysis'] = estimation_analysis
            
            # 3. Generate traceability matrix
            traceability_matrix = self.traceability.generate_traceability_matrix(project_id)
            results['traceability_analysis'] = {
                'matrix': traceability_matrix,
                'completeness': self._calculate_traceability_completeness(traceability_matrix)
            }
            
            # 4. Generate integrated recommendations
            results['integrated_recommendations'] = self._generate_integrated_recommendations(
                results, project_data
            )
            
            # 5. Perform risk assessment
            results['risk_assessment'] = self._perform_integrated_risk_assessment(results)
            
            # 6. Generate success predictions
            results['success_predictions'] = self._generate_success_predictions(results)
            
            logger.info(f"Successfully processed project: {project_id}")
            
        except Exception as e:
            logger.error(f"Error processing project {project_id}: {e}")
            results['error'] = str(e)
        
        return results
    
    async def _build_traceability_structure(self, 
                                          project_id: str, 
                                          hierarchy_data: Dict[str, Any]):
        """Build traceability structure from hierarchy data"""
        
        def process_hierarchy_level(nodes, parent_id=None, level=1):
            """Recursively process hierarchy levels"""
            if isinstance(nodes, dict):
                nodes = [nodes]
            elif not isinstance(nodes, list):
                return
            
            for node in nodes:
                if not isinstance(node, dict):
                    continue
                
                node_id = node.get('id')
                node_type = node.get('type', 'unknown')
                title = node.get('title', '')
                
                if not node_id:
                    continue
                
                # Create hierarchy node
                self.traceability.create_hierarchy_node(
                    node_id, node_type, title, parent_id,
                    metadata={'project_id': project_id, 'level': level}
                )
                
                # Create traceability links
                if parent_id:
                    self.traceability.create_traceability_link(
                        parent_id, 'hierarchy_node',
                        node_id, 'hierarchy_node',
                        'parent_of',
                        metadata={'project_id': project_id}
                    )
                
                # Process children
                children = node.get('children', [])
                if children:
                    process_hierarchy_level(children, node_id, level + 1)
        
        # Process the hierarchy
        if isinstance(hierarchy_data, dict):
            if 'children' in hierarchy_data or 'id' in hierarchy_data:
                process_hierarchy_level([hierarchy_data])
            else:
                # Multiple root nodes
                process_hierarchy_level(list(hierarchy_data.values()))
        elif isinstance(hierarchy_data, list):
            process_hierarchy_level(hierarchy_data)
    
    async def _analyze_project_confidence(self, 
                                        project_id: str,
                                        hierarchy_data: Dict[str, Any],
                                        team_context: Optional[Dict[str, Any]]) -> Dict[str, Any]:
        """Analyze confidence scores for all project items"""
        confidence_results = {
            'overall_confidence': 0.0,
            'item_scores': [],
            'threshold_compliance': {},
            'risk_items': []
        }
        
        def analyze_node_confidence(node, level=1):
            """Recursively analyze confidence for nodes"""
            if not isinstance(node, dict):
                return
            
            node_id = node.get('id')
            node_type = node.get('type', 'unknown')
            
            if not node_id:
                return
            
            # Calculate confidence score
            score = self.confidence.calculate_confidence_score(
                node_id, node_type, level, node, team_context
            )
            
            confidence_results['item_scores'].append({
                'item_id': node_id,
                'item_type': node_type,
                'level': level,
                'confidence_score': score.adjusted_score,
                'threshold_met': score.threshold_met,
                'quality_prediction': score.quality_prediction
            })
            
            # Track risk items
            if not score.threshold_met:
                confidence_results['risk_items'].append({
                    'item_id': node_id,
                    'item_type': node_type,
                    'confidence_score': score.adjusted_score,
                    'issues': [f for f, v in score.factors.items() if v < 0.5]
                })
            
            # Process children
            children = node.get('children', [])
            for child in children:
                analyze_node_confidence(child, level + 1)
        
        # Analyze all nodes
        if isinstance(hierarchy_data, dict):
            if 'children' in hierarchy_data or 'id' in hierarchy_data:
                analyze_node_confidence(hierarchy_data)
            else:
                for root_node in hierarchy_data.values():
                    analyze_node_confidence(root_node)
        elif isinstance(hierarchy_data, list):
            for node in hierarchy_data:
                analyze_node_confidence(node)
        
        # Calculate overall confidence
        if confidence_results['item_scores']:
            confidence_results['overall_confidence'] = sum(
                item['confidence_score'] for item in confidence_results['item_scores']
            ) / len(confidence_results['item_scores'])
        
        # Calculate threshold compliance by level
        by_level = {}
        for item in confidence_results['item_scores']:
            level = item['level']
            if level not in by_level:
                by_level[level] = {'total': 0, 'passed': 0}
            by_level[level]['total'] += 1
            if item['threshold_met']:
                by_level[level]['passed'] += 1
        
        confidence_results['threshold_compliance'] = {
            level: stats['passed'] / stats['total'] if stats['total'] > 0 else 0
            for level, stats in by_level.items()
        }
        
        return confidence_results
    
    async def _process_project_estimations(self, 
                                         project_id: str,
                                         estimations: List[Dict[str, Any]],
                                         team_context: Optional[Dict[str, Any]]) -> Dict[str, Any]:
        """Process project estimations through estimation learning system"""
        estimation_results = {
            'total_estimations': len(estimations),
            'recorded_estimates': [],
            'predictions': [],
            'team_recommendations': {}
        }
        
        for estimation in estimations:
            try:
                # Record the estimation
                estimation_id = self.estimation.record_estimation(
                    estimation['task_id'],
                    estimation['task_type'],
                    estimation['task_title'],
                    estimation['estimated_hours'],
                    estimation['team_member'],
                    project_id,
                    estimation.get('complexity_factors', {})
                )
                
                estimation_results['recorded_estimates'].append({
                    'estimation_id': estimation_id,
                    'task_id': estimation['task_id'],
                    'estimated_hours': estimation['estimated_hours']
                })
                
                # Generate ML prediction for comparison
                prediction = self.estimation.predict_estimation(
                    estimation['task_type'],
                    estimation['team_member'],
                    project_id,
                    estimation.get('complexity_factors', {})
                )
                
                estimation_results['predictions'].append({
                    'task_id': estimation['task_id'],
                    'human_estimate': estimation['estimated_hours'],
                    'ml_prediction': prediction['predicted_hours'],
                    'confidence': prediction['confidence_score'],
                    'recommendations': prediction.get('recommendations', [])
                })
                
            except Exception as e:
                logger.warning(f"Error processing estimation for {estimation.get('task_id')}: {e}")
        
        return estimation_results
    
    def _calculate_traceability_completeness(self, traceability_matrix: Dict[str, Any]) -> Dict[str, Any]:
        """Calculate traceability completeness metrics"""
        completeness = {
            'overall_score': 0.0,
            'link_coverage': 0.0,
            'gap_count': len(traceability_matrix.get('gaps', [])),
            'completeness_by_type': {}
        }
        
        links = traceability_matrix.get('links', [])
        if links:
            # Calculate basic completeness metrics
            source_types = set(link['source_type'] for link in links)
            target_types = set(link['target_type'] for link in links)
            
            # Simple completeness calculation
            completeness['link_coverage'] = min(1.0, len(links) / 100)  # Assuming 100 is target
            completeness['overall_score'] = max(0.0, 1.0 - (completeness['gap_count'] / 20))  # 20 max gaps
        
        return completeness
    
    def _generate_integrated_recommendations(self, 
                                           analysis_results: Dict[str, Any],
                                           project_data: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Generate integrated recommendations from all analysis results"""
        recommendations = []
        
        # Confidence-based recommendations
        confidence_analysis = analysis_results.get('confidence_analysis', {})
        risk_items = confidence_analysis.get('risk_items', [])
        
        if risk_items:
            recommendations.append({
                'priority': 'high',
                'category': 'confidence',
                'title': f'Address {len(risk_items)} Low-Confidence Items',
                'description': f'Items failing confidence thresholds detected',
                'actions': [
                    'Review and improve item definitions',
                    'Add missing acceptance criteria',
                    'Clarify ambiguous requirements',
                    'Seek subject matter expert input'
                ],
                'affected_items': [item['item_id'] for item in risk_items[:5]]
            })
        
        # Pattern-based recommendations
        pattern_analysis = analysis_results.get('pattern_analysis', {})
        anti_patterns = pattern_analysis.get('anti_patterns', [])
        
        for anti_pattern in anti_patterns:
            if anti_pattern.get('severity') == 'high':
                recommendations.append({
                    'priority': 'high',
                    'category': 'patterns',
                    'title': f'Fix Anti-Pattern: {anti_pattern["name"]}',
                    'description': anti_pattern.get('description', ''),
                    'actions': anti_pattern.get('solutions', []),
                    'impact': anti_pattern.get('consequences', [])
                })
        
        # Estimation-based recommendations
        estimation_analysis = analysis_results.get('estimation_analysis', {})
        predictions = estimation_analysis.get('predictions', [])
        
        large_discrepancies = [
            p for p in predictions 
            if abs(p['human_estimate'] - p['ml_prediction']) > (p['human_estimate'] * 0.5)
        ]
        
        if large_discrepancies:
            recommendations.append({
                'priority': 'medium',
                'category': 'estimation',
                'title': f'Review {len(large_discrepancies)} Estimation Discrepancies',
                'description': 'Large differences between human and ML estimates detected',
                'actions': [
                    'Review estimation methodology',
                    'Consider complexity factors',
                    'Validate with historical data',
                    'Calibrate team estimates'
                ],
                'affected_tasks': [p['task_id'] for p in large_discrepancies[:5]]
            })
        
        # Traceability-based recommendations
        traceability_analysis = analysis_results.get('traceability_analysis', {})
        completeness = traceability_analysis.get('completeness', {})
        
        if completeness.get('overall_score', 1.0) < 0.7:
            recommendations.append({
                'priority': 'medium',
                'category': 'traceability',
                'title': 'Improve Traceability Coverage',
                'description': f'Traceability completeness at {completeness.get("overall_score", 0):.2f}',
                'actions': [
                    'Create missing traceability links',
                    'Document dependencies',
                    'Complete hierarchy relationships',
                    'Regular traceability audits'
                ]
            })
        
        # Sort recommendations by priority
        priority_order = {'high': 1, 'medium': 2, 'low': 3}
        recommendations.sort(key=lambda x: priority_order.get(x['priority'], 3))
        
        return recommendations
    
    def _perform_integrated_risk_assessment(self, analysis_results: Dict[str, Any]) -> Dict[str, Any]:
        """Perform integrated risk assessment across all analyses"""
        risk_assessment = {
            'overall_risk_level': 'medium',
            'risk_factors': [],
            'mitigation_strategies': [],
            'monitoring_recommendations': []
        }
        
        risk_score = 0.0
        risk_factors = []
        
        # Confidence risks
        confidence_analysis = analysis_results.get('confidence_analysis', {})
        overall_confidence = confidence_analysis.get('overall_confidence', 0.5)
        
        if overall_confidence < 0.6:
            risk_score += 0.3
            risk_factors.append({
                'factor': 'Low Overall Confidence',
                'score': overall_confidence,
                'impact': 'High likelihood of scope changes and delays'
            })
        
        # Pattern risks
        pattern_analysis = analysis_results.get('pattern_analysis', {})
        high_severity_anti_patterns = [
            ap for ap in pattern_analysis.get('anti_patterns', [])
            if ap.get('severity') == 'high'
        ]
        
        if high_severity_anti_patterns:
            risk_score += 0.2 * len(high_severity_anti_patterns)
            risk_factors.append({
                'factor': 'High-Severity Anti-Patterns',
                'count': len(high_severity_anti_patterns),
                'impact': 'Structural issues may cause significant problems'
            })
        
        # Estimation risks
        estimation_analysis = analysis_results.get('estimation_analysis', {})
        predictions = estimation_analysis.get('predictions', [])
        
        if predictions:
            low_confidence_predictions = [
                p for p in predictions if p.get('confidence', 1.0) < 0.5
            ]
            
            if len(low_confidence_predictions) > len(predictions) * 0.3:
                risk_score += 0.2
                risk_factors.append({
                    'factor': 'Low Estimation Confidence',
                    'percentage': len(low_confidence_predictions) / len(predictions),
                    'impact': 'Budget and timeline uncertainty'
                })
        
        # Traceability risks
        traceability_analysis = analysis_results.get('traceability_analysis', {})
        gap_count = traceability_analysis.get('completeness', {}).get('gap_count', 0)
        
        if gap_count > 10:
            risk_score += 0.15
            risk_factors.append({
                'factor': 'Traceability Gaps',
                'gap_count': gap_count,
                'impact': 'Difficult change impact analysis'
            })
        
        # Determine overall risk level
        if risk_score < 0.3:
            risk_assessment['overall_risk_level'] = 'low'
        elif risk_score < 0.6:
            risk_assessment['overall_risk_level'] = 'medium'
        else:
            risk_assessment['overall_risk_level'] = 'high'
        
        risk_assessment['risk_factors'] = risk_factors
        risk_assessment['risk_score'] = min(1.0, risk_score)
        
        # Generate mitigation strategies
        risk_assessment['mitigation_strategies'] = self._generate_risk_mitigation_strategies(risk_factors)
        
        return risk_assessment
    
    def _generate_risk_mitigation_strategies(self, risk_factors: List[Dict[str, Any]]) -> List[str]:
        """Generate risk mitigation strategies"""
        strategies = []
        
        for factor in risk_factors:
            if factor['factor'] == 'Low Overall Confidence':
                strategies.extend([
                    'Conduct detailed requirements review sessions',
                    'Engage subject matter experts early',
                    'Implement frequent checkpoint reviews'
                ])
            elif factor['factor'] == 'High-Severity Anti-Patterns':
                strategies.extend([
                    'Restructure problematic components',
                    'Apply proven architectural patterns',
                    'Conduct design review sessions'
                ])
            elif factor['factor'] == 'Low Estimation Confidence':
                strategies.extend([
                    'Use historical data for validation',
                    'Implement three-point estimation',
                    'Add contingency buffers'
                ])
            elif factor['factor'] == 'Traceability Gaps':
                strategies.extend([
                    'Conduct traceability mapping sessions',
                    'Implement change impact analysis tools',
                    'Regular traceability audits'
                ])
        
        return list(set(strategies))  # Remove duplicates
    
    def _generate_success_predictions(self, analysis_results: Dict[str, Any]) -> Dict[str, Any]:
        """Generate success predictions based on all analyses"""
        predictions = {
            'overall_success_probability': 0.5,
            'success_factors': [],
            'concern_areas': [],
            'key_milestones_at_risk': [],
            'recommended_success_metrics': []
        }
        
        # Calculate success probability
        success_indicators = []
        
        # Confidence indicator
        confidence_analysis = analysis_results.get('confidence_analysis', {})
        overall_confidence = confidence_analysis.get('overall_confidence', 0.5)
        success_indicators.append(overall_confidence)
        
        # Pattern indicator
        pattern_analysis = analysis_results.get('pattern_analysis', {})
        patterns = pattern_analysis.get('identified_patterns', [])
        balanced_patterns = [p for p in patterns if p.get('type') == 'balanced_hierarchy']
        
        if balanced_patterns:
            success_indicators.append(0.8)
        else:
            success_indicators.append(0.4)
        
        # Risk indicator (inverse)
        risk_assessment = analysis_results.get('risk_assessment', {})
        risk_score = risk_assessment.get('risk_score', 0.5)
        success_indicators.append(1.0 - risk_score)
        
        # Calculate overall probability
        predictions['overall_success_probability'] = sum(success_indicators) / len(success_indicators)
        
        # Identify success factors
        if overall_confidence > 0.7:
            predictions['success_factors'].append('High confidence scores across hierarchy')
        
        if balanced_patterns:
            predictions['success_factors'].append('Well-balanced project structure')
        
        # Identify concern areas
        risk_factors = risk_assessment.get('risk_factors', [])
        predictions['concern_areas'] = [
            factor['factor'] for factor in risk_factors
        ]
        
        # Recommended success metrics
        predictions['recommended_success_metrics'] = [
            'Track confidence score trends',
            'Monitor estimation accuracy',
            'Measure traceability completeness',
            'Review pattern compliance',
            'Assess team performance variance'
        ]
        
        return predictions
    
    def get_system_status(self) -> Dict[str, Any]:
        """Get comprehensive status of all Stream 3 components"""
        status = {
            'timestamp': datetime.now().isoformat(),
            'components': {},
            'overall_health': 'unknown'
        }
        
        # Check each component
        components = {
            'traceability': self.traceability,
            'estimation': self.estimation,
            'patterns': self.patterns,
            'confidence': self.confidence,
            'analytics': self.analytics
        }
        
        healthy_components = 0
        
        for name, component in components.items():
            try:
                # Basic health check (database connectivity)
                component_status = {
                    'status': 'healthy',
                    'database': 'connected',
                    'last_activity': 'unknown'
                }
                
                # Check if database exists and is accessible
                if hasattr(component, 'db_path'):
                    db_path = Path(component.db_path)
                    if db_path.exists():
                        component_status['database'] = 'connected'
                        component_status['database_size'] = db_path.stat().st_size
                        healthy_components += 1
                    else:
                        component_status['database'] = 'not_found'
                        component_status['status'] = 'degraded'
                
                status['components'][name] = component_status
                
            except Exception as e:
                status['components'][name] = {
                    'status': 'error',
                    'error': str(e)
                }
        
        # Determine overall health
        if healthy_components == len(components):
            status['overall_health'] = 'healthy'
        elif healthy_components > len(components) / 2:
            status['overall_health'] = 'degraded'
        else:
            status['overall_health'] = 'unhealthy'
        
        return status
    
    def generate_comprehensive_report(self, 
                                    project_id: Optional[str] = None,
                                    time_period_days: int = 30) -> Dict[str, Any]:
        """Generate comprehensive intelligence report"""
        logger.info("Generating comprehensive intelligence report")
        
        report = {
            'report_metadata': {
                'generated_at': datetime.now().isoformat(),
                'project_id': project_id,
                'time_period_days': time_period_days
            },
            'system_status': self.get_system_status(),
            'analytics_insights': {},
            'recommendations': [],
            'executive_summary': {}
        }
        
        try:
            # Generate analytics insights
            report['analytics_insights'] = self.analytics.generate_comprehensive_insights(
                time_period_days, include_forecasting=True
            )
            
            # Extract key recommendations
            insights = report['analytics_insights']
            report['recommendations'] = insights.get('actionable_recommendations', [])
            
            # Generate executive summary
            report['executive_summary'] = {
                'system_health': report['system_status']['overall_health'],
                'key_insights': len(insights.get('pattern_insights', {}).get('successful_patterns', [])),
                'critical_recommendations': len([
                    r for r in report['recommendations'] if r.get('priority') == 'high'
                ]),
                'overall_performance': insights.get('executive_summary', {}).get('overall_health_score', 0)
            }
            
        except Exception as e:
            logger.error(f"Error generating comprehensive report: {e}")
            report['error'] = str(e)
        
        return report

def main():
    """Main function for CLI usage"""
    import argparse
    
    parser = argparse.ArgumentParser(description="Stream 3 Intelligence Hub")
    parser.add_argument("--action", choices=[
        'process_project', 'status', 'report', 'test_integration'
    ], required=True, help="Action to perform")
    
    # Project processing arguments
    parser.add_argument("--project-id", help="Project ID")
    parser.add_argument("--project-data", help="JSON file with project data")
    parser.add_argument("--team-context", help="JSON file with team context")
    
    # Report arguments
    parser.add_argument("--time-period", type=int, default=30, help="Time period for reports")
    
    args = parser.parse_args()
    
    hub = IntelligenceHub()
    
    if args.action == 'process_project':
        if not args.project_id or not args.project_data:
            print("Error: Project ID and project data file required")
            return
        
        # Load project data
        with open(args.project_data, 'r') as f:
            project_data = json.load(f)
        
        # Load team context if provided
        team_context = None
        if args.team_context:
            with open(args.team_context, 'r') as f:
                team_context = json.load(f)
        
        # Process project
        result = asyncio.run(hub.process_new_project(
            args.project_id, project_data, team_context
        ))
        
        print(json.dumps(result, indent=2, default=str))
        
    elif args.action == 'status':
        status = hub.get_system_status()
        print(json.dumps(status, indent=2))
        
    elif args.action == 'report':
        report = hub.generate_comprehensive_report(
            args.project_id, args.time_period
        )
        print(json.dumps(report, indent=2, default=str))
        
    elif args.action == 'test_integration':
        # Test integration of all components
        status = hub.get_system_status()
        print("System Status:", status['overall_health'])
        
        for component, info in status['components'].items():
            print(f"  {component}: {info['status']}")
        
        print("\nIntegration test completed")

if __name__ == "__main__":
    main()