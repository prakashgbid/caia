#!/usr/bin/env python3
"""
TraceabilityManager - Hierarchical Agent System Stream 3
Creates and maintains idea-to-subtask mapping with complete hierarchy trees
Integrates with existing context management system
"""

import os
import json
import sqlite3
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, List, Any, Optional, Tuple
import logging
from dataclasses import dataclass, asdict
from collections import defaultdict
import hashlib

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Configuration
ADMIN_ROOT = "/Users/MAC/Documents/projects/admin"
DB_PATH = os.path.join(ADMIN_ROOT, "traceability.db")

@dataclass
class TraceabilityLink:
    source_id: str
    source_type: str
    target_id: str
    target_type: str
    relationship: str
    timestamp: datetime
    metadata: Optional[Dict[str, Any]] = None

@dataclass
class HierarchyNode:
    id: str
    type: str
    title: str
    parent_id: Optional[str] = None
    children: List[str] = None
    level: int = 0
    metadata: Optional[Dict[str, Any]] = None

class TraceabilityManager:
    """
    Manages complete traceability from ideas to subtasks
    Builds hierarchy trees and impact analysis
    """
    
    def __init__(self, db_path: str = DB_PATH):
        self.db_path = db_path
        self.admin_root = Path(ADMIN_ROOT)
        self.admin_root.mkdir(parents=True, exist_ok=True)
        self._init_database()
        
    def _init_database(self):
        """Initialize SQLite database for traceability data"""
        with sqlite3.connect(self.db_path) as conn:
            conn.execute('''
                CREATE TABLE IF NOT EXISTS traceability_links (
                    id TEXT PRIMARY KEY,
                    source_id TEXT NOT NULL,
                    source_type TEXT NOT NULL,
                    target_id TEXT NOT NULL,
                    target_type TEXT NOT NULL,
                    relationship TEXT NOT NULL,
                    timestamp TEXT NOT NULL,
                    metadata TEXT
                )
            ''')
            
            conn.execute('''
                CREATE TABLE IF NOT EXISTS hierarchy_nodes (
                    id TEXT PRIMARY KEY,
                    type TEXT NOT NULL,
                    title TEXT NOT NULL,
                    parent_id TEXT,
                    level INTEGER DEFAULT 0,
                    timestamp TEXT NOT NULL,
                    metadata TEXT,
                    FOREIGN KEY (parent_id) REFERENCES hierarchy_nodes(id)
                )
            ''')
            
            conn.execute('''
                CREATE TABLE IF NOT EXISTS impact_analysis (
                    source_id TEXT NOT NULL,
                    impacted_id TEXT NOT NULL,
                    impact_type TEXT NOT NULL,
                    severity INTEGER DEFAULT 1,
                    timestamp TEXT NOT NULL,
                    PRIMARY KEY (source_id, impacted_id, impact_type)
                )
            ''')
            
            conn.execute('''
                CREATE INDEX IF NOT EXISTS idx_links_source ON traceability_links(source_id, source_type)
            ''')
            conn.execute('''
                CREATE INDEX IF NOT EXISTS idx_links_target ON traceability_links(target_id, target_type)
            ''')
            conn.execute('''
                CREATE INDEX IF NOT EXISTS idx_hierarchy_parent ON hierarchy_nodes(parent_id)
            ''')
            
    def create_traceability_link(self, 
                               source_id: str, 
                               source_type: str,
                               target_id: str, 
                               target_type: str,
                               relationship: str,
                               metadata: Optional[Dict[str, Any]] = None) -> str:
        """Create a new traceability link between two items"""
        link_id = hashlib.md5(f"{source_id}-{target_id}-{relationship}".encode()).hexdigest()
        
        link = TraceabilityLink(
            source_id=source_id,
            source_type=source_type,
            target_id=target_id,
            target_type=target_type,
            relationship=relationship,
            timestamp=datetime.now(),
            metadata=metadata
        )
        
        with sqlite3.connect(self.db_path) as conn:
            conn.execute('''
                INSERT OR REPLACE INTO traceability_links 
                (id, source_id, source_type, target_id, target_type, relationship, timestamp, metadata)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ''', (
                link_id,
                link.source_id,
                link.source_type,
                link.target_id,
                link.target_type,
                link.relationship,
                link.timestamp.isoformat(),
                json.dumps(link.metadata or {})
            ))
        
        logger.info(f"Created traceability link: {source_type}({source_id}) -> {target_type}({target_id})")
        return link_id
    
    def create_hierarchy_node(self,
                            node_id: str,
                            node_type: str,
                            title: str,
                            parent_id: Optional[str] = None,
                            metadata: Optional[Dict[str, Any]] = None) -> HierarchyNode:
        """Create a new hierarchy node"""
        level = 0
        if parent_id:
            parent_level = self.get_node_level(parent_id)
            level = parent_level + 1
        
        node = HierarchyNode(
            id=node_id,
            type=node_type,
            title=title,
            parent_id=parent_id,
            level=level,
            metadata=metadata
        )
        
        with sqlite3.connect(self.db_path) as conn:
            conn.execute('''
                INSERT OR REPLACE INTO hierarchy_nodes 
                (id, type, title, parent_id, level, timestamp, metadata)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            ''', (
                node.id,
                node.type,
                node.title,
                node.parent_id,
                node.level,
                datetime.now().isoformat(),
                json.dumps(node.metadata or {})
            ))
        
        # Create traceability link to parent if exists
        if parent_id:
            self.create_traceability_link(
                parent_id, "hierarchy_node",
                node_id, "hierarchy_node",
                "parent_of"
            )
        
        logger.info(f"Created hierarchy node: {node_type} - {title} (Level {level})")
        return node
    
    def get_node_level(self, node_id: str) -> int:
        """Get the hierarchy level of a node"""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.execute(
                'SELECT level FROM hierarchy_nodes WHERE id = ?',
                (node_id,)
            )
            result = cursor.fetchone()
            return result[0] if result else 0
    
    def build_hierarchy_tree(self, root_id: Optional[str] = None) -> Dict[str, Any]:
        """Build complete hierarchy tree from root or all roots"""
        with sqlite3.connect(self.db_path) as conn:
            if root_id:
                # Build tree from specific root
                cursor = conn.execute('''
                    SELECT id, type, title, parent_id, level, metadata 
                    FROM hierarchy_nodes 
                    WHERE id = ? OR parent_id IS NOT NULL
                    ORDER BY level, id
                ''', (root_id,))
            else:
                # Build all trees
                cursor = conn.execute('''
                    SELECT id, type, title, parent_id, level, metadata 
                    FROM hierarchy_nodes 
                    ORDER BY level, id
                ''')
            
            nodes = cursor.fetchall()
        
        # Build tree structure
        tree = {}
        node_map = {}
        
        for node_data in nodes:
            node_id, node_type, title, parent_id, level, metadata_str = node_data
            metadata = json.loads(metadata_str) if metadata_str else {}
            
            node = {
                'id': node_id,
                'type': node_type,
                'title': title,
                'level': level,
                'children': [],
                'metadata': metadata,
                'traceability_links': self.get_node_links(node_id)
            }
            
            node_map[node_id] = node
            
            if parent_id and parent_id in node_map:
                node_map[parent_id]['children'].append(node)
            elif not parent_id:
                tree[node_id] = node
        
        return tree
    
    def get_node_links(self, node_id: str) -> List[Dict[str, Any]]:
        """Get all traceability links for a node"""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.execute('''
                SELECT source_id, source_type, target_id, target_type, relationship, metadata
                FROM traceability_links 
                WHERE source_id = ? OR target_id = ?
            ''', (node_id, node_id))
            
            links = []
            for row in cursor.fetchall():
                source_id, source_type, target_id, target_type, relationship, metadata_str = row
                metadata = json.loads(metadata_str) if metadata_str else {}
                
                links.append({
                    'source_id': source_id,
                    'source_type': source_type,
                    'target_id': target_id,
                    'target_type': target_type,
                    'relationship': relationship,
                    'metadata': metadata
                })
        
        return links
    
    def generate_traceability_matrix(self, project_id: Optional[str] = None) -> Dict[str, Any]:
        """Generate comprehensive traceability matrix"""
        with sqlite3.connect(self.db_path) as conn:
            if project_id:
                # Filter by project if specified
                cursor = conn.execute('''
                    SELECT tl.*, hn1.title as source_title, hn2.title as target_title
                    FROM traceability_links tl
                    LEFT JOIN hierarchy_nodes hn1 ON tl.source_id = hn1.id
                    LEFT JOIN hierarchy_nodes hn2 ON tl.target_id = hn2.id
                    WHERE tl.metadata LIKE ?
                    ORDER BY tl.source_type, tl.target_type
                ''', (f'%"project_id":"{project_id}"%',))
            else:
                cursor = conn.execute('''
                    SELECT tl.*, hn1.title as source_title, hn2.title as target_title
                    FROM traceability_links tl
                    LEFT JOIN hierarchy_nodes hn1 ON tl.source_id = hn1.id
                    LEFT JOIN hierarchy_nodes hn2 ON tl.target_id = hn2.id
                    ORDER BY tl.source_type, tl.target_type
                ''')
            
            links = cursor.fetchall()
        
        # Build matrix structure
        matrix = {
            'links': [],
            'coverage': {},
            'gaps': [],
            'statistics': {
                'total_links': len(links),
                'link_types': defaultdict(int),
                'coverage_by_type': {}
            }
        }
        
        link_types = defaultdict(list)
        
        for link_data in links:
            (link_id, source_id, source_type, target_id, target_type, 
             relationship, timestamp, metadata_str, source_title, target_title) = link_data
            
            metadata = json.loads(metadata_str) if metadata_str else {}
            
            link = {
                'source_id': source_id,
                'source_type': source_type,
                'source_title': source_title,
                'target_id': target_id,
                'target_type': target_type,
                'target_title': target_title,
                'relationship': relationship,
                'timestamp': timestamp,
                'metadata': metadata
            }
            
            matrix['links'].append(link)
            
            # Group by relationship type
            relationship_key = f"{source_type}_{relationship}_{target_type}"
            link_types[relationship_key].append(link)
            matrix['statistics']['link_types'][relationship_key] += 1
        
        # Calculate coverage statistics
        matrix['coverage'] = link_types
        
        # Identify potential gaps (nodes without sufficient links)
        matrix['gaps'] = self._identify_traceability_gaps()
        
        return matrix
    
    def _identify_traceability_gaps(self) -> List[Dict[str, Any]]:
        """Identify nodes that lack sufficient traceability links"""
        gaps = []
        
        with sqlite3.connect(self.db_path) as conn:
            # Find nodes with no incoming or outgoing links
            cursor = conn.execute('''
                SELECT hn.id, hn.type, hn.title, hn.level
                FROM hierarchy_nodes hn
                LEFT JOIN traceability_links tl1 ON hn.id = tl1.source_id
                LEFT JOIN traceability_links tl2 ON hn.id = tl2.target_id
                WHERE tl1.source_id IS NULL AND tl2.target_id IS NULL
            ''')
            
            for row in cursor.fetchall():
                node_id, node_type, title, level = row
                gaps.append({
                    'node_id': node_id,
                    'node_type': node_type,
                    'title': title,
                    'level': level,
                    'gap_type': 'isolated',
                    'description': 'Node has no traceability links'
                })
        
        return gaps
    
    def perform_impact_analysis(self, changed_item_id: str) -> Dict[str, Any]:
        """Analyze impact of changes to a specific item"""
        impacts = {
            'direct_impacts': [],
            'indirect_impacts': [],
            'severity_analysis': {},
            'change_recommendations': []
        }
        
        # Find direct impacts (immediate children and dependencies)
        direct_impacts = self._find_direct_impacts(changed_item_id)
        impacts['direct_impacts'] = direct_impacts
        
        # Find indirect impacts (cascading effects)
        indirect_impacts = self._find_indirect_impacts(changed_item_id, direct_impacts)
        impacts['indirect_impacts'] = indirect_impacts
        
        # Analyze severity
        impacts['severity_analysis'] = self._analyze_impact_severity(direct_impacts + indirect_impacts)
        
        # Generate recommendations
        impacts['change_recommendations'] = self._generate_change_recommendations(impacts)
        
        # Store impact analysis
        self._store_impact_analysis(changed_item_id, impacts)
        
        return impacts
    
    def _find_direct_impacts(self, item_id: str) -> List[Dict[str, Any]]:
        """Find items directly impacted by changes to given item"""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.execute('''
                SELECT target_id, target_type, relationship, metadata
                FROM traceability_links 
                WHERE source_id = ?
            ''', (item_id,))
            
            impacts = []
            for row in cursor.fetchall():
                target_id, target_type, relationship, metadata_str = row
                metadata = json.loads(metadata_str) if metadata_str else {}
                
                impacts.append({
                    'impacted_id': target_id,
                    'impacted_type': target_type,
                    'relationship': relationship,
                    'impact_level': 'direct',
                    'metadata': metadata
                })
        
        return impacts
    
    def _find_indirect_impacts(self, root_item_id: str, direct_impacts: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Find items indirectly impacted through cascading effects"""
        indirect_impacts = []
        processed = {root_item_id}
        
        # Process each direct impact to find cascading effects
        for direct_impact in direct_impacts:
            impacted_id = direct_impact['impacted_id']
            if impacted_id in processed:
                continue
                
            processed.add(impacted_id)
            
            # Find what this impacted item affects
            cascading_impacts = self._find_direct_impacts(impacted_id)
            
            for cascade in cascading_impacts:
                if cascade['impacted_id'] not in processed:
                    cascade['impact_level'] = 'indirect'
                    cascade['cascade_source'] = impacted_id
                    indirect_impacts.append(cascade)
        
        return indirect_impacts
    
    def _analyze_impact_severity(self, all_impacts: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Analyze severity of impacts"""
        severity_counts = {'critical': 0, 'high': 0, 'medium': 0, 'low': 0}
        
        for impact in all_impacts:
            # Determine severity based on type and level
            severity = 'medium'  # default
            
            impact_type = impact.get('impacted_type', '')
            impact_level = impact.get('impact_level', 'direct')
            
            if impact_type in ['idea', 'initiative']:
                severity = 'critical' if impact_level == 'direct' else 'high'
            elif impact_type in ['feature', 'epic']:
                severity = 'high' if impact_level == 'direct' else 'medium'
            elif impact_type in ['story', 'task']:
                severity = 'medium' if impact_level == 'direct' else 'low'
            
            severity_counts[severity] += 1
        
        return {
            'counts': severity_counts,
            'total_impacted': len(all_impacts),
            'risk_level': self._calculate_overall_risk(severity_counts)
        }
    
    def _calculate_overall_risk(self, severity_counts: Dict[str, int]) -> str:
        """Calculate overall risk level from severity counts"""
        if severity_counts['critical'] > 0:
            return 'critical'
        elif severity_counts['high'] > 2:
            return 'high' 
        elif severity_counts['high'] > 0 or severity_counts['medium'] > 5:
            return 'medium'
        else:
            return 'low'
    
    def _generate_change_recommendations(self, impacts: Dict[str, Any]) -> List[str]:
        """Generate recommendations based on impact analysis"""
        recommendations = []
        
        risk_level = impacts['severity_analysis']['risk_level']
        total_impacted = impacts['severity_analysis']['total_impacted']
        
        if risk_level == 'critical':
            recommendations.append("Critical impact detected. Conduct thorough review before implementation.")
            recommendations.append("Consider phased rollout to minimize risk.")
            
        if total_impacted > 10:
            recommendations.append(f"Large scope impact ({total_impacted} items). Create detailed change plan.")
            
        if len(impacts['indirect_impacts']) > len(impacts['direct_impacts']):
            recommendations.append("High cascading effect detected. Review indirect impacts carefully.")
        
        recommendations.append("Update all impacted documentation and stakeholder communications.")
        
        return recommendations
    
    def _store_impact_analysis(self, source_id: str, impacts: Dict[str, Any]):
        """Store impact analysis results"""
        with sqlite3.connect(self.db_path) as conn:
            timestamp = datetime.now().isoformat()
            
            all_impacts = impacts['direct_impacts'] + impacts['indirect_impacts']
            
            for impact in all_impacts:
                severity = 1  # Default
                if impact.get('impact_level') == 'direct':
                    severity = 2
                    
                conn.execute('''
                    INSERT OR REPLACE INTO impact_analysis 
                    (source_id, impacted_id, impact_type, severity, timestamp)
                    VALUES (?, ?, ?, ?, ?)
                ''', (
                    source_id,
                    impact['impacted_id'],
                    impact.get('relationship', 'unknown'),
                    severity,
                    timestamp
                ))
    
    def generate_audit_trail(self, 
                           start_date: Optional[datetime] = None,
                           end_date: Optional[datetime] = None,
                           item_id: Optional[str] = None) -> Dict[str, Any]:
        """Generate comprehensive audit trail"""
        if not start_date:
            start_date = datetime.now() - timedelta(days=30)
        if not end_date:
            end_date = datetime.now()
            
        with sqlite3.connect(self.db_path) as conn:
            conditions = ['timestamp BETWEEN ? AND ?']
            params = [start_date.isoformat(), end_date.isoformat()]
            
            if item_id:
                conditions.append('(source_id = ? OR target_id = ?)')
                params.extend([item_id, item_id])
            
            query = f'''
                SELECT * FROM traceability_links 
                WHERE {' AND '.join(conditions)}
                ORDER BY timestamp DESC
            '''
            
            cursor = conn.execute(query, params)
            audit_records = []
            
            for row in cursor.fetchall():
                (link_id, source_id, source_type, target_id, target_type,
                 relationship, timestamp, metadata_str) = row
                
                metadata = json.loads(metadata_str) if metadata_str else {}
                
                audit_records.append({
                    'timestamp': timestamp,
                    'action': 'link_created',
                    'source_id': source_id,
                    'source_type': source_type,
                    'target_id': target_id,
                    'target_type': target_type,
                    'relationship': relationship,
                    'metadata': metadata
                })
        
        return {
            'audit_period': {
                'start': start_date.isoformat(),
                'end': end_date.isoformat()
            },
            'total_records': len(audit_records),
            'records': audit_records,
            'summary': {
                'actions_by_type': self._summarize_audit_actions(audit_records),
                'most_active_items': self._find_most_active_items(audit_records)
            }
        }
    
    def _summarize_audit_actions(self, records: List[Dict[str, Any]]) -> Dict[str, int]:
        """Summarize audit actions by type"""
        summary = defaultdict(int)
        for record in records:
            action_type = f"{record['relationship']}"
            summary[action_type] += 1
        return dict(summary)
    
    def _find_most_active_items(self, records: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Find items with most activity"""
        activity_count = defaultdict(int)
        item_info = {}
        
        for record in records:
            source_id = record['source_id']
            target_id = record['target_id']
            
            activity_count[source_id] += 1
            activity_count[target_id] += 1
            
            item_info[source_id] = record['source_type']
            item_info[target_id] = record['target_type']
        
        # Sort by activity count
        sorted_items = sorted(activity_count.items(), key=lambda x: x[1], reverse=True)
        
        return [
            {
                'item_id': item_id,
                'item_type': item_info.get(item_id, 'unknown'),
                'activity_count': count
            }
            for item_id, count in sorted_items[:10]
        ]
    
    def export_traceability_data(self, format: str = 'json') -> str:
        """Export all traceability data"""
        hierarchy_tree = self.build_hierarchy_tree()
        traceability_matrix = self.generate_traceability_matrix()
        
        export_data = {
            'export_timestamp': datetime.now().isoformat(),
            'hierarchy_tree': hierarchy_tree,
            'traceability_matrix': traceability_matrix,
            'statistics': {
                'total_nodes': len(hierarchy_tree),
                'total_links': len(traceability_matrix['links']),
                'link_types': dict(traceability_matrix['statistics']['link_types'])
            }
        }
        
        if format == 'json':
            output_file = self.admin_root / f"traceability_export_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
            with open(output_file, 'w') as f:
                json.dump(export_data, f, indent=2, default=str)
            return str(output_file)
        
        return json.dumps(export_data, indent=2, default=str)

def main():
    """Main function for CLI usage"""
    import argparse
    
    parser = argparse.ArgumentParser(description="Traceability Manager for Hierarchical Agent System")
    parser.add_argument("--action", choices=['create_link', 'create_node', 'build_tree', 'matrix', 'impact', 'audit', 'export'],
                       required=True, help="Action to perform")
    parser.add_argument("--source-id", help="Source ID for links")
    parser.add_argument("--source-type", help="Source type for links")
    parser.add_argument("--target-id", help="Target ID for links")
    parser.add_argument("--target-type", help="Target type for links")
    parser.add_argument("--relationship", help="Relationship type")
    parser.add_argument("--node-id", help="Node ID")
    parser.add_argument("--node-type", help="Node type")
    parser.add_argument("--title", help="Node title")
    parser.add_argument("--parent-id", help="Parent node ID")
    parser.add_argument("--project-id", help="Project ID filter")
    parser.add_argument("--format", default='json', help="Export format")
    
    args = parser.parse_args()
    
    manager = TraceabilityManager()
    
    if args.action == 'create_link':
        if not all([args.source_id, args.source_type, args.target_id, args.target_type, args.relationship]):
            print("Error: All link parameters required")
            return
        
        link_id = manager.create_traceability_link(
            args.source_id, args.source_type,
            args.target_id, args.target_type,
            args.relationship
        )
        print(f"Created link: {link_id}")
        
    elif args.action == 'create_node':
        if not all([args.node_id, args.node_type, args.title]):
            print("Error: Node ID, type, and title required")
            return
            
        node = manager.create_hierarchy_node(
            args.node_id, args.node_type, args.title, args.parent_id
        )
        print(f"Created node: {node.id}")
        
    elif args.action == 'build_tree':
        tree = manager.build_hierarchy_tree()
        print(json.dumps(tree, indent=2, default=str))
        
    elif args.action == 'matrix':
        matrix = manager.generate_traceability_matrix(args.project_id)
        print(json.dumps(matrix, indent=2, default=str))
        
    elif args.action == 'impact':
        if not args.node_id:
            print("Error: Node ID required for impact analysis")
            return
            
        impacts = manager.perform_impact_analysis(args.node_id)
        print(json.dumps(impacts, indent=2, default=str))
        
    elif args.action == 'audit':
        audit = manager.generate_audit_trail(item_id=args.node_id)
        print(json.dumps(audit, indent=2, default=str))
        
    elif args.action == 'export':
        output_file = manager.export_traceability_data(args.format)
        print(f"Exported to: {output_file}")

if __name__ == "__main__":
    main()