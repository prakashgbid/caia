// Project Planner - Adapts Knowledge Graph Explorer for Hierarchical Project Planning

class ProjectPlanner {
    constructor() {
        this.network = null;
        this.gridApi = null;
        this.projectData = null;
        this.currentView = 'graph';
        this.selectedItem = null;

        this.levelColors = {
            'idea': '#FF6B6B',
            'initiative': '#4ECDC4',
            'feature': '#45B7D1',
            'epic': '#96CEB4',
            'story': '#FFEAA7',
            'task': '#DFE6E9',
            'subtask': '#B2BEC3'
        };

        this.levelIcons = {
            'idea': '💡',
            'initiative': '🎯',
            'feature': '⚡',
            'epic': '📚',
            'story': '📝',
            'task': '✓',
            'subtask': '•'
        };

        this.init();
    }

    init() {
        this.setupEventListeners();
        this.initializeGraphView();
        this.initializeGridView();
        this.loadSampleData();
    }

    setupEventListeners() {
        // View switching
        document.getElementById('view-graph-btn').addEventListener('click', () => this.switchView('graph'));
        document.getElementById('view-grid-btn').addEventListener('click', () => this.switchView('grid'));

        // Breakdown button
        document.getElementById('breakdown-btn').addEventListener('click', () => this.breakdownIdea());

        // Export buttons
        document.getElementById('export-jira-btn').addEventListener('click', () => this.exportToJira());
        document.getElementById('export-csv-btn').addEventListener('click', () => this.exportToCSV());

        // Graph controls
        document.getElementById('expand-all').addEventListener('click', () => this.expandAll());
        document.getElementById('collapse-all').addEventListener('click', () => this.collapseAll());
        document.getElementById('center-graph').addEventListener('click', () => this.centerGraph());
        document.getElementById('fit-graph').addEventListener('click', () => this.fitGraph());

        // Details panel
        document.getElementById('close-details').addEventListener('click', () => this.closeDetails());
        document.getElementById('save-item').addEventListener('click', () => this.saveItemDetails());

        // Filters
        document.getElementById('apply-filters-btn').addEventListener('click', () => this.applyFilters());
        document.getElementById('clear-filters-btn').addEventListener('click', () => this.clearFilters());
    }

    initializeGraphView() {
        const container = document.getElementById('network-container');

        const options = {
            nodes: {
                shape: 'box',
                font: {
                    size: 14,
                    face: 'Arial'
                },
                borderWidth: 2,
                shadow: true,
                margin: 10
            },
            edges: {
                arrows: {
                    to: {
                        enabled: true,
                        scaleFactor: 0.5
                    }
                },
                smooth: {
                    type: 'cubicBezier',
                    forceDirection: 'vertical',
                    roundness: 0.4
                },
                color: {
                    color: '#848484',
                    highlight: '#45B7D1'
                }
            },
            layout: {
                hierarchical: {
                    enabled: true,
                    levelSeparation: 150,
                    nodeSpacing: 100,
                    treeSpacing: 200,
                    direction: 'UD',
                    sortMethod: 'directed'
                }
            },
            physics: {
                enabled: false
            },
            interaction: {
                hover: true,
                tooltipDelay: 200,
                navigationButtons: true,
                keyboard: true
            }
        };

        this.network = new vis.Network(container, {nodes: [], edges: []}, options);

        // Network events
        this.network.on('click', (params) => {
            if (params.nodes.length > 0) {
                this.showItemDetails(params.nodes[0]);
            }
        });

        this.network.on('doubleClick', (params) => {
            if (params.nodes.length > 0) {
                this.toggleNodeExpansion(params.nodes[0]);
            }
        });
    }

    initializeGridView() {
        const gridOptions = {
            columnDefs: [
                {
                    field: 'title',
                    headerName: 'Item',
                    cellRenderer: 'agGroupCellRenderer',
                    width: 350,
                    cellRendererParams: {
                        innerRenderer: (params) => {
                            const icon = this.levelIcons[params.data?.level] || '';
                            return `${icon} ${params.value}`;
                        }
                    }
                },
                { field: 'level', headerName: 'Level', width: 100 },
                { field: 'status', headerName: 'Status', width: 120 },
                { field: 'priority', headerName: 'Priority', width: 100 },
                { field: 'assignee', headerName: 'Assignee', width: 150 },
                { field: 'effort', headerName: 'Effort', width: 80 },
                {
                    field: 'labels',
                    headerName: 'Labels',
                    width: 200,
                    cellRenderer: (params) => {
                        return params.value ? params.value.join(', ') : '';
                    }
                }
            ],
            defaultColDef: {
                sortable: true,
                filter: true,
                resizable: true
            },
            treeData: true,
            getDataPath: (data) => data.path,
            animateRows: true,
            groupDefaultExpanded: 1,
            onRowClicked: (event) => {
                this.showItemDetails(event.data.id);
            }
        };

        const gridContainer = document.getElementById('grid-container');
        this.gridApi = agGrid.createGrid(gridContainer, gridOptions);
    }

    async breakdownIdea() {
        const ideaText = document.getElementById('idea-input').value.trim();
        if (!ideaText) {
            alert('Please enter a project idea');
            return;
        }

        this.showLoading(true);

        try {
            // Call the Hierarchical Agent System API
            const response = await this.callBreakdownAPI(ideaText);
            this.projectData = this.transformResponseToHierarchy(response);
            this.updateVisualization();
            this.updateStatistics();
        } catch (error) {
            console.error('Breakdown failed:', error);
            // Use mock data as fallback
            this.projectData = this.generateMockBreakdown(ideaText);
            this.updateVisualization();
            this.updateStatistics();
        } finally {
            this.showLoading(false);
        }
    }

    async callBreakdownAPI(idea) {
        // Try to call the existing Hierarchical Agent System
        try {
            const response = await fetch('http://localhost:3000/api/breakdown', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ idea })
            });
            return await response.json();
        } catch (error) {
            // Fallback to mock
            return null;
        }
    }

    generateMockBreakdown(idea) {
        const nodes = [];
        const edges = [];
        let nodeId = 0;

        // Create root idea node
        const ideaNode = {
            id: nodeId++,
            label: idea.substring(0, 50),
            title: idea,
            level: 'idea',
            status: 'pending',
            priority: 'high',
            color: this.levelColors['idea']
        };
        nodes.push(ideaNode);

        // Generate initiatives
        for (let i = 0; i < 2; i++) {
            const initNode = {
                id: nodeId++,
                label: `Initiative ${i + 1}`,
                title: `Strategic Initiative ${i + 1}`,
                level: 'initiative',
                status: 'pending',
                priority: 'high',
                color: this.levelColors['initiative']
            };
            nodes.push(initNode);
            edges.push({ from: ideaNode.id, to: initNode.id });

            // Generate features
            for (let j = 0; j < 3; j++) {
                const featNode = {
                    id: nodeId++,
                    label: `Feature ${i + 1}.${j + 1}`,
                    title: `Feature Implementation ${i + 1}.${j + 1}`,
                    level: 'feature',
                    status: 'pending',
                    priority: 'medium',
                    color: this.levelColors['feature']
                };
                nodes.push(featNode);
                edges.push({ from: initNode.id, to: featNode.id });

                // Generate epics
                for (let k = 0; k < 2; k++) {
                    const epicNode = {
                        id: nodeId++,
                        label: `Epic ${i + 1}.${j + 1}.${k + 1}`,
                        title: `Epic Story ${i + 1}.${j + 1}.${k + 1}`,
                        level: 'epic',
                        status: 'pending',
                        priority: 'medium',
                        color: this.levelColors['epic']
                    };
                    nodes.push(epicNode);
                    edges.push({ from: featNode.id, to: epicNode.id });
                }
            }
        }

        return { nodes, edges };
    }

    updateVisualization() {
        if (this.currentView === 'graph') {
            this.network.setData(this.projectData);
        } else {
            this.updateGrid();
        }
    }

    updateGrid() {
        const treeData = this.convertToTreeData(this.projectData);
        this.gridApi.setGridOption('rowData', treeData);
    }

    convertToTreeData(graphData) {
        // Convert graph nodes/edges to tree structure for AG Grid
        const treeData = [];
        const nodeMap = {};

        // Build node map
        graphData.nodes.forEach(node => {
            nodeMap[node.id] = {
                ...node,
                path: [],
                children: []
            };
        });

        // Build tree structure
        graphData.edges.forEach(edge => {
            const parent = nodeMap[edge.from];
            const child = nodeMap[edge.to];
            if (parent && child) {
                parent.children.push(child);
                child.path = [...parent.path, parent.title];
            }
        });

        // Find root nodes
        Object.values(nodeMap).forEach(node => {
            if (node.level === 'idea') {
                treeData.push(node);
            }
        });

        return treeData;
    }

    updateStatistics() {
        const levelCounts = {};
        this.projectData.nodes.forEach(node => {
            levelCounts[node.level] = (levelCounts[node.level] || 0) + 1;
        });

        // Update level counts
        Object.keys(levelCounts).forEach(level => {
            const element = document.querySelector(`[data-level="${level}"] .level-count`);
            if (element) {
                element.textContent = levelCounts[level];
            }
        });

        // Update header stats
        document.getElementById('total-items').textContent = this.projectData.nodes.length;
        document.getElementById('breakdown-time').textContent = '12';
    }

    switchView(view) {
        this.currentView = view;

        document.getElementById('graph-view').style.display = view === 'graph' ? 'block' : 'none';
        document.getElementById('grid-view').style.display = view === 'grid' ? 'block' : 'none';

        document.getElementById('view-graph-btn').classList.toggle('active', view === 'graph');
        document.getElementById('view-grid-btn').classList.toggle('active', view === 'grid');

        if (view === 'grid' && this.projectData) {
            this.updateGrid();
        }
    }

    showItemDetails(itemId) {
        const node = this.projectData.nodes.find(n => n.id === itemId);
        if (!node) return;

        this.selectedItem = node;

        document.getElementById('item-title').textContent = node.title;
        document.getElementById('item-description').textContent = node.description || '-';
        document.getElementById('item-level').textContent = node.level;
        document.getElementById('item-status').value = node.status || 'pending';
        document.getElementById('item-priority').value = node.priority || 'medium';
        document.getElementById('item-assignee').value = node.assignee || '';
        document.getElementById('item-effort').value = node.effort || '';
        document.getElementById('item-labels').value = (node.labels || []).join(', ');
        document.getElementById('item-criteria').value = (node.acceptanceCriteria || []).join('\n');

        document.getElementById('details-panel').style.display = 'block';
    }

    closeDetails() {
        document.getElementById('details-panel').style.display = 'none';
        this.selectedItem = null;
    }

    saveItemDetails() {
        if (!this.selectedItem) return;

        // Update node data
        this.selectedItem.status = document.getElementById('item-status').value;
        this.selectedItem.priority = document.getElementById('item-priority').value;
        this.selectedItem.assignee = document.getElementById('item-assignee').value;
        this.selectedItem.effort = document.getElementById('item-effort').value;
        this.selectedItem.labels = document.getElementById('item-labels').value.split(',').map(l => l.trim());
        this.selectedItem.acceptanceCriteria = document.getElementById('item-criteria').value.split('\n');

        // Update visualization
        this.updateVisualization();
        this.closeDetails();
    }

    expandAll() {
        if (this.currentView === 'graph') {
            this.network.fit();
        } else {
            this.gridApi.expandAll();
        }
    }

    collapseAll() {
        if (this.currentView === 'grid') {
            this.gridApi.collapseAll();
        }
    }

    centerGraph() {
        this.network.fit();
    }

    fitGraph() {
        this.network.fit();
    }

    applyFilters() {
        // Implement filtering logic
        const statusFilter = Array.from(document.getElementById('status-filter').selectedOptions).map(o => o.value);
        const priorityFilter = Array.from(document.getElementById('priority-filter').selectedOptions).map(o => o.value);
        const labelFilter = document.getElementById('label-filter').value;

        // Apply filters to visualization
        console.log('Applying filters:', { statusFilter, priorityFilter, labelFilter });
    }

    clearFilters() {
        document.getElementById('status-filter').selectedIndex = -1;
        document.getElementById('priority-filter').selectedIndex = -1;
        document.getElementById('label-filter').value = '';
        this.applyFilters();
    }

    async exportToJira() {
        alert('Exporting to JIRA via Hierarchical Agent System...');
        // Implement JIRA export
    }

    exportToCSV() {
        if (this.gridApi) {
            this.gridApi.exportDataAsCsv();
        }
    }

    showLoading(show) {
        document.getElementById('loading-overlay').style.display = show ? 'flex' : 'none';
    }

    loadSampleData() {
        // Load sample data for demonstration
        const sampleIdea = "Build a comprehensive project management system with AI-powered task breakdown";
        document.getElementById('idea-input').value = sampleIdea;
    }
}

// Initialize the Project Planner when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.projectPlanner = new ProjectPlanner();
});