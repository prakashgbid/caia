"""
Graph Visualizer - Create interactive knowledge graph visualizations
Phase 4 - Advanced Knowledge Graph System
"""

import json
import logging
import networkx as nx
from typing import Dict, List, Set, Optional, Any, Tuple
from dataclasses import dataclass
import yaml
import colorsys
from flask import Flask, render_template, jsonify, request
import plotly.graph_objects as go
import plotly.express as px
from plotly.subplots import make_subplots

from ..core.graph_manager import GraphManager, get_graph_manager
from ..core.graph_schema import NodeType, RelationshipType

logger = logging.getLogger(__name__)

@dataclass
class VisualizationNode:
    """Node data for visualization"""
    id: str
    label: str
    type: str
    size: int = 10
    color: str = "#1f77b4"
    properties: Dict[str, Any] = None
    
    def __post_init__(self):
        if self.properties is None:
            self.properties = {}

@dataclass
class VisualizationEdge:
    """Edge data for visualization"""
    source: str
    target: str
    type: str
    weight: float = 1.0
    color: str = "#666666"
    width: int = 2
    properties: Dict[str, Any] = None
    
    def __post_init__(self):
        if self.properties is None:
            self.properties = {}

@dataclass
class GraphLayout:
    """Graph layout configuration"""
    algorithm: str = "force"  # force, hierarchical, circular, random
    dimensions: int = 2
    parameters: Dict[str, Any] = None
    
    def __post_init__(self):
        if self.parameters is None:
            self.parameters = {}

class GraphVisualizer:
    """
    Advanced graph visualization system for knowledge graphs
    
    Creates interactive, web-based visualizations of knowledge graphs
    with multiple layout algorithms, filtering, and exploration features.
    """
    
    def __init__(self, config_path: str = "graph_config.yaml"):
        """Initialize the graph visualizer"""
        self.config = self._load_config(config_path)
        self.graph_manager = get_graph_manager()
        
        # Visualization settings
        self.viz_config = self.config.get('visualization', {})
        self.max_nodes = self.viz_config.get('max_nodes', 1000)
        self.max_relationships = self.viz_config.get('max_relationships', 2000)
        
        # Color schemes
        self.node_colors = self._init_node_colors()
        self.edge_colors = self._init_edge_colors()
        
        # Layout algorithms
        self.layout_algorithms = {
            'force': self._force_layout,
            'hierarchical': self._hierarchical_layout,
            'circular': self._circular_layout,
            'random': self._random_layout,
            'spring': self._spring_layout
        }
        
        logger.info("Graph visualizer initialized successfully")
    
    def _load_config(self, config_path: str) -> Dict:
        """Load configuration"""
        try:
            with open(config_path, 'r') as f:
                return yaml.safe_load(f)
        except Exception as e:
            logger.warning(f"Could not load config from {config_path}: {e}")
            return self._default_config()
    
    def _default_config(self) -> Dict:
        """Default configuration"""
        return {
            'visualization': {
                'default_layout': 'force',
                'max_nodes': 1000,
                'max_relationships': 2000,
                'node_size_property': 'importance',
                'edge_width_property': 'strength',
                'colors': {
                    'Concept': '#FF6B6B',
                    'Entity': '#4ECDC4',
                    'CodeElement': '#45B7D1',
                    'Pattern': '#96CEB4',
                    'User': '#FFEAA7',
                    'Session': '#DDA0DD',
                    'Decision': '#98D8C8',
                    'Knowledge': '#F7DC6F'
                }
            }
        }
    
    def _init_node_colors(self) -> Dict[str, str]:
        """Initialize node color scheme"""
        default_colors = self.viz_config.get('colors', {})
        
        # Add colors for any missing node types
        all_colors = {}
        color_palette = [
            '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7',
            '#DDA0DD', '#98D8C8', '#F7DC6F', '#FFB6C1', '#87CEEB',
            '#DEB887', '#F0E68C', '#FF7F50', '#6495ED', '#DC143C'
        ]
        
        color_idx = 0
        for node_type in NodeType:
            if node_type.value in default_colors:
                all_colors[node_type.value] = default_colors[node_type.value]
            else:
                all_colors[node_type.value] = color_palette[color_idx % len(color_palette)]
                color_idx += 1
        
        return all_colors
    
    def _init_edge_colors(self) -> Dict[str, str]:
        """Initialize edge color scheme"""
        edge_colors = {}
        
        # Use darker colors for edges
        for rel_type in RelationshipType:
            # Generate color based on relationship type
            hue = hash(rel_type.value) % 360
            rgb = colorsys.hsv_to_rgb(hue/360.0, 0.6, 0.6)
            hex_color = '#{:02x}{:02x}{:02x}'.format(
                int(rgb[0] * 255),
                int(rgb[1] * 255),
                int(rgb[2] * 255)
            )
            edge_colors[rel_type.value] = hex_color
        
        return edge_colors
    
    def create_subgraph_visualization(self, node_ids: List[str] = None, 
                                    filters: Dict[str, Any] = None,
                                    layout: GraphLayout = None) -> Dict[str, Any]:
        """
        Create visualization for a subgraph
        
        Args:
            node_ids: Specific nodes to include (None for all)
            filters: Filtering criteria
            layout: Layout configuration
            
        Returns:
            Visualization data dictionary
        """
        try:
            # Get subgraph data
            subgraph_data = self._get_subgraph_data(node_ids, filters)
            
            if not subgraph_data['nodes']:
                logger.warning("No nodes found for visualization")
                return {'nodes': [], 'edges': [], 'metadata': {}}
            
            # Prepare nodes and edges for visualization
            viz_nodes = self._prepare_visualization_nodes(subgraph_data['nodes'])
            viz_edges = self._prepare_visualization_edges(subgraph_data['relationships'])
            
            # Apply layout algorithm
            if layout is None:
                layout = GraphLayout(self.viz_config.get('default_layout', 'force'))
            
            positions = self._calculate_layout(viz_nodes, viz_edges, layout)
            
            # Add positions to nodes
            for node in viz_nodes:
                if node.id in positions:
                    node.properties.update(positions[node.id])
            
            # Create visualization data
            viz_data = {
                'nodes': [self._node_to_dict(node) for node in viz_nodes],
                'edges': [self._edge_to_dict(edge) for edge in viz_edges],
                'metadata': {
                    'node_count': len(viz_nodes),
                    'edge_count': len(viz_edges),
                    'layout': layout.algorithm,
                    'timestamp': subgraph_data.get('metadata', {}).get('exported_at')
                }
            }
            
            logger.info(f"Created visualization with {len(viz_nodes)} nodes and {len(viz_edges)} edges")
            return viz_data
            
        except Exception as e:
            logger.error(f"Error creating subgraph visualization: {e}")
            return {'nodes': [], 'edges': [], 'metadata': {'error': str(e)}}
    
    def _get_subgraph_data(self, node_ids: List[str] = None, 
                          filters: Dict[str, Any] = None) -> Dict[str, Any]:
        """Get subgraph data from the graph database"""
        if node_ids:
            # Export specific subgraph
            return self.graph_manager.export_subgraph(node_ids, include_relationships=True)
        else:
            # Get filtered subgraph
            return self._get_filtered_graph(filters)
    
    def _get_filtered_graph(self, filters: Dict[str, Any] = None) -> Dict[str, Any]:
        """Get graph data with filters applied"""
        filters = filters or {}
        
        # Build query based on filters
        where_clauses = []
        params = {}
        
        if 'node_types' in filters:
            node_labels = [f"n:{nt}" for nt in filters['node_types']]
            where_clauses.append(f"({' OR '.join(node_labels)})")
        
        if 'relationship_types' in filters:
            rel_types = [f"type(r) = '{rt}'" for rt in filters['relationship_types']]
            where_clauses.append(f"({' OR '.join(rel_types)})")
        
        if 'confidence_min' in filters:
            where_clauses.append("n.confidence >= $confidence_min")
            params['confidence_min'] = filters['confidence_min']
        
        # Build query
        query = "MATCH (n)"
        if where_clauses:
            query += f" WHERE {' AND '.join(where_clauses)}"
        
        query += f" RETURN n, ID(n) as node_id, labels(n) as node_labels LIMIT {self.max_nodes}"
        
        # Execute query
        try:
            results = self.graph_manager.execute_query(query, params)
            
            nodes = []
            node_ids = []
            for record in results:
                node_data = {
                    'id': str(record['node_id']),
                    'labels': record['node_labels'],
                    'properties': dict(record['n'])
                }
                nodes.append(node_data)
                node_ids.append(str(record['node_id']))
            
            # Get relationships between these nodes
            if node_ids:
                relationships = self._get_relationships_between_nodes(node_ids)
            else:
                relationships = []
            
            return {
                'nodes': nodes,
                'relationships': relationships,
                'metadata': {
                    'node_count': len(nodes),
                    'relationship_count': len(relationships)
                }
            }
            
        except Exception as e:
            logger.error(f"Error getting filtered graph: {e}")
            return {'nodes': [], 'relationships': [], 'metadata': {}}
    
    def _get_relationships_between_nodes(self, node_ids: List[str]) -> List[Dict[str, Any]]:
        """Get relationships between specified nodes"""
        try:
            int_node_ids = [int(nid) for nid in node_ids]
            
            query = """
            MATCH (start)-[r]->(end)
            WHERE ID(start) IN $node_ids AND ID(end) IN $node_ids
            RETURN r, ID(r) as rel_id, type(r) as rel_type,
                   ID(start) as start_id, ID(end) as end_id
            LIMIT $max_rels
            """
            
            results = self.graph_manager.execute_query(query, {
                'node_ids': int_node_ids,
                'max_rels': self.max_relationships
            })
            
            relationships = []
            for record in results:
                relationships.append({
                    'id': str(record['rel_id']),
                    'type': record['rel_type'],
                    'start_node': str(record['start_id']),
                    'end_node': str(record['end_id']),
                    'properties': dict(record['r'])
                })
            
            return relationships
            
        except Exception as e:
            logger.error(f"Error getting relationships between nodes: {e}")
            return []
    
    def _prepare_visualization_nodes(self, nodes: List[Dict[str, Any]]) -> List[VisualizationNode]:
        """Prepare nodes for visualization"""
        viz_nodes = []
        
        for node in nodes:
            # Determine node type and label
            labels = node.get('labels', [])
            node_type = labels[0] if labels else 'Unknown'
            
            # Get node properties
            props = node.get('properties', {})
            
            # Determine node label
            label = props.get('name', props.get('content', node.get('id', 'Unknown')))
            if len(label) > 30:
                label = label[:27] + "..."
            
            # Determine node size
            size_prop = self.viz_config.get('node_size_property', 'importance')
            size = int(props.get(size_prop, 0.5) * 20) + 10  # Scale to 10-30
            
            # Get node color
            color = self.node_colors.get(node_type, '#CCCCCC')
            
            viz_node = VisualizationNode(
                id=node['id'],
                label=label,
                type=node_type,
                size=size,
                color=color,
                properties=props
            )
            
            viz_nodes.append(viz_node)
        
        return viz_nodes
    
    def _prepare_visualization_edges(self, relationships: List[Dict[str, Any]]) -> List[VisualizationEdge]:
        """Prepare edges for visualization"""
        viz_edges = []
        
        for rel in relationships:
            # Get relationship properties
            props = rel.get('properties', {})
            
            # Determine edge weight and width
            weight_prop = self.viz_config.get('edge_width_property', 'strength')
            weight = props.get(weight_prop, props.get('confidence', 1.0))
            width = max(1, int(weight * 5))  # Scale to 1-5
            
            # Get edge color
            color = self.edge_colors.get(rel['type'], '#666666')
            
            viz_edge = VisualizationEdge(
                source=rel['start_node'],
                target=rel['end_node'],
                type=rel['type'],
                weight=weight,
                color=color,
                width=width,
                properties=props
            )
            
            viz_edges.append(viz_edge)
        
        return viz_edges
    
    def _calculate_layout(self, nodes: List[VisualizationNode], 
                         edges: List[VisualizationEdge],
                         layout: GraphLayout) -> Dict[str, Dict[str, float]]:
        """Calculate node positions using specified layout algorithm"""
        # Create NetworkX graph
        G = nx.DiGraph()
        
        # Add nodes
        for node in nodes:
            G.add_node(node.id, **node.properties)
        
        # Add edges
        for edge in edges:
            G.add_edge(edge.source, edge.target, weight=edge.weight)
        
        # Apply layout algorithm
        layout_func = self.layout_algorithms.get(layout.algorithm, self._force_layout)
        positions = layout_func(G, **layout.parameters)
        
        # Convert positions to dictionary with x, y coordinates
        result = {}
        for node_id, (x, y) in positions.items():
            result[node_id] = {'x': float(x), 'y': float(y)}
        
        return result
    
    def _force_layout(self, graph: nx.Graph, **params) -> Dict[str, Tuple[float, float]]:
        """Force-directed layout (spring layout)"""
        k = params.get('k', None)
        iterations = params.get('iterations', 50)
        
        return nx.spring_layout(graph, k=k, iterations=iterations, seed=42)
    
    def _hierarchical_layout(self, graph: nx.Graph, **params) -> Dict[str, Tuple[float, float]]:
        """Hierarchical layout"""
        # Use shell layout as approximation for hierarchy
        return nx.shell_layout(graph)
    
    def _circular_layout(self, graph: nx.Graph, **params) -> Dict[str, Tuple[float, float]]:
        """Circular layout"""
        return nx.circular_layout(graph)
    
    def _random_layout(self, graph: nx.Graph, **params) -> Dict[str, Tuple[float, float]]:
        """Random layout"""
        return nx.random_layout(graph, seed=42)
    
    def _spring_layout(self, graph: nx.Graph, **params) -> Dict[str, Tuple[float, float]]:
        """Spring layout with custom parameters"""
        k = params.get('k', 1/len(graph.nodes())**0.5)
        iterations = params.get('iterations', 100)
        
        return nx.spring_layout(graph, k=k, iterations=iterations, seed=42)
    
    def _node_to_dict(self, node: VisualizationNode) -> Dict[str, Any]:
        """Convert visualization node to dictionary"""
        return {
            'id': node.id,
            'label': node.label,
            'type': node.type,
            'size': node.size,
            'color': node.color,
            'x': node.properties.get('x', 0),
            'y': node.properties.get('y', 0),
            'properties': node.properties
        }
    
    def _edge_to_dict(self, edge: VisualizationEdge) -> Dict[str, Any]:
        """Convert visualization edge to dictionary"""
        return {
            'source': edge.source,
            'target': edge.target,
            'type': edge.type,
            'weight': edge.weight,
            'color': edge.color,
            'width': edge.width,
            'properties': edge.properties
        }
    
    def create_plotly_visualization(self, viz_data: Dict[str, Any]) -> go.Figure:
        """Create Plotly visualization from viz data"""
        nodes = viz_data.get('nodes', [])
        edges = viz_data.get('edges', [])
        
        # Create edge traces
        edge_traces = []
        edge_info = []
        
        for edge in edges:
            # Find source and target node positions
            source_node = next((n for n in nodes if n['id'] == edge['source']), None)
            target_node = next((n for n in nodes if n['id'] == edge['target']), None)
            
            if source_node and target_node:
                edge_trace = go.Scatter(
                    x=[source_node['x'], target_node['x'], None],
                    y=[source_node['y'], target_node['y'], None],
                    line=dict(width=edge['width'], color=edge['color']),
                    hoverinfo='none',
                    mode='lines',
                    showlegend=False
                )
                edge_traces.append(edge_trace)
        
        # Create node trace
        node_x = [node['x'] for node in nodes]
        node_y = [node['y'] for node in nodes]
        node_text = [node['label'] for node in nodes]
        node_colors = [node['color'] for node in nodes]
        node_sizes = [node['size'] for node in nodes]
        
        node_trace = go.Scatter(
            x=node_x, 
            y=node_y,
            mode='markers+text',
            text=node_text,
            textposition="middle center",
            hoverinfo='text',
            hovertext=[f"{node['label']} ({node['type']})" for node in nodes],
            marker=dict(
                size=node_sizes,
                color=node_colors,
                line=dict(width=2, color='white')
            ),
            showlegend=False
        )
        
        # Create figure
        fig = go.Figure(data=edge_traces + [node_trace])
        
        # Update layout
        fig.update_layout(
            title="Knowledge Graph Visualization",
            showlegend=False,
            hovermode='closest',
            margin=dict(b=20,l=5,r=5,t=40),
            annotations=[ dict(
                text="Interactive Knowledge Graph",
                showarrow=False,
                xref="paper", yref="paper",
                x=0.005, y=-0.002,
                xanchor='left', yanchor='bottom',
                font=dict(color="#000000", size=12)
            )],
            xaxis=dict(showgrid=False, zeroline=False, showticklabels=False),
            yaxis=dict(showgrid=False, zeroline=False, showticklabels=False),
            plot_bgcolor='white'
        )
        
        return fig
    
    def create_network_statistics(self, viz_data: Dict[str, Any]) -> Dict[str, Any]:
        """Create network statistics for the visualization"""
        nodes = viz_data.get('nodes', [])
        edges = viz_data.get('edges', [])
        
        # Create NetworkX graph for analysis
        G = nx.DiGraph()
        
        for node in nodes:
            G.add_node(node['id'], **node['properties'])
        
        for edge in edges:
            G.add_edge(edge['source'], edge['target'], **edge['properties'])
        
        # Calculate statistics
        try:
            stats = {
                'basic': {
                    'nodes': len(nodes),
                    'edges': len(edges),
                    'density': nx.density(G),
                    'is_connected': nx.is_weakly_connected(G) if G.is_directed() else nx.is_connected(G)
                },
                'centrality': {
                    'degree': dict(sorted(nx.degree_centrality(G).items(), 
                                         key=lambda x: x[1], reverse=True)[:10]),
                    'betweenness': dict(sorted(nx.betweenness_centrality(G).items(), 
                                             key=lambda x: x[1], reverse=True)[:10]),
                    'closeness': dict(sorted(nx.closeness_centrality(G).items(), 
                                           key=lambda x: x[1], reverse=True)[:10])
                },
                'clustering': {
                    'average_clustering': nx.average_clustering(G.to_undirected()),
                    'transitivity': nx.transitivity(G.to_undirected())
                }
            }
            
            # Add node type distribution
            node_types = {}
            for node in nodes:
                node_type = node.get('type', 'Unknown')
                node_types[node_type] = node_types.get(node_type, 0) + 1
            
            stats['distribution'] = {
                'node_types': node_types,
                'edge_types': {}
            }
            
            # Add edge type distribution
            edge_types = {}
            for edge in edges:
                edge_type = edge.get('type', 'Unknown')
                edge_types[edge_type] = edge_types.get(edge_type, 0) + 1
            
            stats['distribution']['edge_types'] = edge_types
            
        except Exception as e:
            logger.error(f"Error calculating network statistics: {e}")
            stats = {'error': str(e)}
        
        return stats
    
    def export_visualization(self, viz_data: Dict[str, Any], format: str = "json", 
                           filename: str = None) -> str:
        """
        Export visualization data to file
        
        Args:
            viz_data: Visualization data
            format: Export format (json, graphml, gexf)
            filename: Output filename
            
        Returns:
            Path to exported file
        """
        if filename is None:
            filename = f"knowledge_graph_viz.{format}"
        
        try:
            if format == "json":
                with open(filename, 'w') as f:
                    json.dump(viz_data, f, indent=2, default=str)
            
            elif format == "graphml":
                # Convert to NetworkX and export
                G = nx.DiGraph()
                
                for node in viz_data.get('nodes', []):
                    G.add_node(node['id'], **node.get('properties', {}))
                
                for edge in viz_data.get('edges', []):
                    G.add_edge(edge['source'], edge['target'], **edge.get('properties', {}))
                
                nx.write_graphml(G, filename)
            
            elif format == "gexf":
                # Convert to NetworkX and export
                G = nx.DiGraph()
                
                for node in viz_data.get('nodes', []):
                    G.add_node(node['id'], **node.get('properties', {}))
                
                for edge in viz_data.get('edges', []):
                    G.add_edge(edge['source'], edge['target'], **edge.get('properties', {}))
                
                nx.write_gexf(G, filename)
            
            else:
                raise ValueError(f"Unsupported format: {format}")
            
            logger.info(f"Exported visualization to {filename}")
            return filename
            
        except Exception as e:
            logger.error(f"Error exporting visualization: {e}")
            raise
    
    def create_interactive_html(self, viz_data: Dict[str, Any], 
                              filename: str = "knowledge_graph.html") -> str:
        """Create interactive HTML visualization"""
        # Create Plotly figure
        fig = self.create_plotly_visualization(viz_data)
        
        # Export to HTML
        fig.write_html(filename, include_plotlyjs='cdn')
        
        logger.info(f"Created interactive HTML visualization: {filename}")
        return filename
    
    def get_node_neighborhood(self, node_id: str, depth: int = 1) -> Dict[str, Any]:
        """Get neighborhood visualization for a specific node"""
        try:
            # Get neighboring nodes
            neighbors = self.graph_manager.get_node_neighbors(node_id, limit=50)
            
            # Extract node IDs
            neighbor_ids = [neighbor[0].id for neighbor in neighbors] + [node_id]
            
            # Create subgraph visualization
            return self.create_subgraph_visualization(neighbor_ids)
            
        except Exception as e:
            logger.error(f"Error creating node neighborhood visualization: {e}")
            return {'nodes': [], 'edges': [], 'metadata': {'error': str(e)}}
    
    def search_and_visualize(self, query: str, limit: int = 50) -> Dict[str, Any]:
        """Search nodes and create visualization of results"""
        try:
            # Search nodes using full-text search
            search_results = self.graph_manager.search_full_text('concept_search', query, limit)
            
            if not search_results:
                return {'nodes': [], 'edges': [], 'metadata': {'message': 'No results found'}}
            
            # Get node IDs
            node_ids = [node.id for node in search_results]
            
            # Create visualization
            return self.create_subgraph_visualization(node_ids)
            
        except Exception as e:
            logger.error(f"Error in search visualization: {e}")
            return {'nodes': [], 'edges': [], 'metadata': {'error': str(e)}}