/**
 * Web-based live dashboard with Socket.IO
 */

import * as express from 'express';
import * as http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import * as path from 'path';
import { MonorepoTestOrchestrator, TestProgress } from '../index';

export interface DashboardConfig {
  port?: number;
  host?: string;
  staticDir?: string;
}

export class WebDashboard {
  private app: express.Application;
  private server: http.Server;
  private io: SocketIOServer;
  private orchestrator: MonorepoTestOrchestrator;
  private config: DashboardConfig;
  private updateInterval: NodeJS.Timeout;
  
  constructor(orchestrator: MonorepoTestOrchestrator, config: DashboardConfig = {}) {
    this.orchestrator = orchestrator;
    this.config = {
      port: config.port || 3000,
      host: config.host || 'localhost',
      staticDir: config.staticDir || path.join(__dirname, '../../public')
    };
    
    this.app = express();
    this.server = http.createServer(this.app);
    this.io = new SocketIOServer(this.server, {
      cors: {
        origin: '*',
        methods: ['GET', 'POST']
      }
    });
    
    this.setupRoutes();
    this.setupSocketHandlers();
    this.attachOrchestratorEvents();
  }
  
  /**
   * Set up Express routes
   */
  private setupRoutes() {
    // Serve static files
    this.app.use(express.static(this.config.staticDir));
    
    // API endpoints
    this.app.get('/api/status', (req, res) => {
      res.json(this.orchestrator.getProgress());
    });
    
    this.app.get('/api/packages', (req, res) => {
      const packages = Array.from(this.orchestrator['packages'].values());
      res.json(packages);
    });
    
    this.app.get('/api/results', (req, res) => {
      const results = Array.from(this.orchestrator['results'].values());
      res.json(results);
    });
    
    // Serve dashboard HTML
    this.app.get('/', (req, res) => {
      res.send(this.getDashboardHTML());
    });
  }
  
  /**
   * Set up Socket.IO handlers
   */
  private setupSocketHandlers() {
    this.io.on('connection', (socket) => {
      console.log('Dashboard client connected');
      
      // Send initial state
      socket.emit('initial-state', {
        progress: this.orchestrator.getProgress(),
        packages: Array.from(this.orchestrator['packages'].values()),
        results: Array.from(this.orchestrator['results'].values())
      });
      
      // Handle client requests
      socket.on('start-tests', async () => {
        try {
          await this.orchestrator.execute();
        } catch (error) {
          socket.emit('error', { message: error.message });
        }
      });
      
      socket.on('stop-tests', () => {
        // Implement stop functionality
        socket.emit('tests-stopped');
      });
      
      socket.on('disconnect', () => {
        console.log('Dashboard client disconnected');
      });
    });
  }
  
  /**
   * Attach orchestrator event listeners
   */
  private attachOrchestratorEvents() {
    // Forward all orchestrator events to Socket.IO
    const events = [
      'discovery:start',
      'discovery:complete',
      'planning:start',
      'planning:complete',
      'execution:start',
      'execution:complete',
      'test:start',
      'test:complete',
      'test:failed'
    ];
    
    events.forEach(event => {
      this.orchestrator.on(event, (data) => {
        this.io.emit(event, data);
      });
    });
    
    // Start progress updates when execution starts
    this.orchestrator.on('execution:start', () => {
      this.startProgressBroadcast();
    });
    
    // Stop updates when execution completes
    this.orchestrator.on('execution:complete', () => {
      this.stopProgressBroadcast();
    });
  }
  
  /**
   * Start broadcasting progress updates
   */
  private startProgressBroadcast() {
    this.updateInterval = setInterval(() => {
      const progress = this.orchestrator.getProgress();
      this.io.emit('progress-update', progress);
    }, 100); // Update every 100ms
  }
  
  /**
   * Stop broadcasting progress updates
   */
  private stopProgressBroadcast() {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
  }
  
  /**
   * Start the web server
   */
  async start(): Promise<void> {
    return new Promise((resolve) => {
      this.server.listen(this.config.port, this.config.host, () => {
        console.log(`🌐 Dashboard running at http://${this.config.host}:${this.config.port}`);
        resolve();
      });
    });
  }
  
  /**
   * Stop the web server
   */
  async stop(): Promise<void> {
    this.stopProgressBroadcast();
    
    return new Promise((resolve) => {
      this.io.close();
      this.server.close(() => {
        console.log('Dashboard server stopped');
        resolve();
      });
    });
  }
  
  /**
   * Get dashboard HTML
   */
  private getDashboardHTML(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>CAIA Monorepo Test Dashboard</title>
    <script src="https://cdn.socket.io/4.6.0/socket.io.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: #fff;
            min-height: 100vh;
            padding: 20px;
        }
        
        .container {
            max-width: 1400px;
            margin: 0 auto;
        }
        
        h1 {
            text-align: center;
            margin-bottom: 30px;
            font-size: 2.5em;
            text-shadow: 2px 2px 4px rgba(0,0,0,0.3);
        }
        
        .dashboard {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 20px;
        }
        
        .card {
            background: rgba(255,255,255,0.1);
            backdrop-filter: blur(10px);
            border-radius: 15px;
            padding: 20px;
            box-shadow: 0 8px 32px 0 rgba(31, 38, 135, 0.37);
            border: 1px solid rgba(255,255,255,0.18);
        }
        
        .card h2 {
            margin-bottom: 15px;
            font-size: 1.3em;
            color: #ffd700;
        }
        
        .progress-bar {
            width: 100%;
            height: 30px;
            background: rgba(255,255,255,0.2);
            border-radius: 15px;
            overflow: hidden;
            position: relative;
        }
        
        .progress-fill {
            height: 100%;
            background: linear-gradient(90deg, #00d4ff, #00ff88);
            transition: width 0.3s ease;
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: bold;
            text-shadow: 1px 1px 2px rgba(0,0,0,0.5);
        }
        
        .stat-grid {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 10px;
        }
        
        .stat {
            background: rgba(255,255,255,0.1);
            padding: 10px;
            border-radius: 10px;
            text-align: center;
        }
        
        .stat-value {
            font-size: 2em;
            font-weight: bold;
            color: #00ff88;
        }
        
        .stat-label {
            font-size: 0.9em;
            opacity: 0.8;
            margin-top: 5px;
        }
        
        .package-list {
            max-height: 400px;
            overflow-y: auto;
        }
        
        .package-item {
            padding: 10px;
            margin: 5px 0;
            background: rgba(255,255,255,0.1);
            border-radius: 8px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            transition: all 0.3s ease;
        }
        
        .package-item:hover {
            background: rgba(255,255,255,0.2);
            transform: translateX(5px);
        }
        
        .package-item.running {
            border-left: 4px solid #ffd700;
            animation: pulse 1.5s infinite;
        }
        
        .package-item.passed {
            border-left: 4px solid #00ff88;
        }
        
        .package-item.failed {
            border-left: 4px solid #ff4444;
        }
        
        @keyframes pulse {
            0% { opacity: 1; }
            50% { opacity: 0.7; }
            100% { opacity: 1; }
        }
        
        .coverage-badge {
            background: rgba(0,255,136,0.2);
            padding: 2px 8px;
            border-radius: 12px;
            font-size: 0.9em;
        }
        
        .control-panel {
            display: flex;
            gap: 10px;
            margin-bottom: 20px;
            justify-content: center;
        }
        
        button {
            background: linear-gradient(45deg, #00d4ff, #00ff88);
            border: none;
            color: #000;
            padding: 12px 30px;
            border-radius: 25px;
            font-size: 1.1em;
            font-weight: bold;
            cursor: pointer;
            transition: all 0.3s ease;
            box-shadow: 0 4px 15px 0 rgba(0,212,255,0.4);
        }
        
        button:hover {
            transform: translateY(-2px);
            box-shadow: 0 6px 20px 0 rgba(0,212,255,0.6);
        }
        
        button:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }
        
        .event-log {
            max-height: 300px;
            overflow-y: auto;
            font-family: 'Courier New', monospace;
            font-size: 0.9em;
        }
        
        .event-item {
            padding: 5px;
            margin: 2px 0;
            background: rgba(0,0,0,0.2);
            border-radius: 4px;
        }
        
        .chart-container {
            position: relative;
            height: 200px;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>🚀 CAIA Monorepo Test Dashboard</h1>
        
        <div class="control-panel">
            <button id="startBtn" onclick="startTests()">Start Tests</button>
            <button id="stopBtn" onclick="stopTests()" disabled>Stop Tests</button>
        </div>
        
        <div class="dashboard">
            <!-- Progress Card -->
            <div class="card" style="grid-column: span 2;">
                <h2>Overall Progress</h2>
                <div class="progress-bar">
                    <div class="progress-fill" id="progressBar" style="width: 0%">
                        0%
                    </div>
                </div>
                <div class="stat-grid" style="margin-top: 15px;">
                    <div class="stat">
                        <div class="stat-value" id="completedCount">0</div>
                        <div class="stat-label">Completed</div>
                    </div>
                    <div class="stat">
                        <div class="stat-value" id="totalCount">0</div>
                        <div class="stat-label">Total</div>
                    </div>
                    <div class="stat">
                        <div class="stat-value" id="passedCount">0</div>
                        <div class="stat-label">Passed</div>
                    </div>
                    <div class="stat">
                        <div class="stat-value" id="failedCount">0</div>
                        <div class="stat-label">Failed</div>
                    </div>
                </div>
            </div>
            
            <!-- Coverage Card -->
            <div class="card">
                <h2>Coverage</h2>
                <div class="stat">
                    <div class="stat-value" id="coveragePercent">0%</div>
                    <div class="stat-label">Overall Coverage</div>
                </div>
                <canvas id="coverageChart"></canvas>
            </div>
            
            <!-- Throughput Card -->
            <div class="card">
                <h2>Throughput</h2>
                <div class="chart-container">
                    <canvas id="throughputChart"></canvas>
                </div>
                <div class="stat" style="margin-top: 10px;">
                    <div class="stat-value" id="throughputValue">0</div>
                    <div class="stat-label">Tests/sec</div>
                </div>
            </div>
            
            <!-- Package List -->
            <div class="card" style="grid-column: span 2;">
                <h2>Packages</h2>
                <div class="package-list" id="packageList">
                    <!-- Packages will be added here -->
                </div>
            </div>
            
            <!-- Event Log -->
            <div class="card" style="grid-column: span 2;">
                <h2>Event Log</h2>
                <div class="event-log" id="eventLog">
                    <!-- Events will be added here -->
                </div>
            </div>
        </div>
    </div>
    
    <script>
        const socket = io();
        let throughputChart, coverageChart;
        let throughputData = [];
        
        // Initialize charts
        function initCharts() {
            // Throughput chart
            const throughputCtx = document.getElementById('throughputChart').getContext('2d');
            throughputChart = new Chart(throughputCtx, {
                type: 'line',
                data: {
                    labels: [],
                    datasets: [{
                        label: 'Throughput',
                        data: [],
                        borderColor: '#00ff88',
                        backgroundColor: 'rgba(0,255,136,0.1)',
                        tension: 0.4
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                        y: {
                            beginAtZero: true,
                            grid: { color: 'rgba(255,255,255,0.1)' },
                            ticks: { color: '#fff' }
                        },
                        x: {
                            grid: { color: 'rgba(255,255,255,0.1)' },
                            ticks: { color: '#fff' }
                        }
                    },
                    plugins: {
                        legend: { display: false }
                    }
                }
            });
            
            // Coverage chart
            const coverageCtx = document.getElementById('coverageChart').getContext('2d');
            coverageChart = new Chart(coverageCtx, {
                type: 'doughnut',
                data: {
                    labels: ['Covered', 'Uncovered'],
                    datasets: [{
                        data: [0, 100],
                        backgroundColor: ['#00ff88', 'rgba(255,255,255,0.1)'],
                        borderWidth: 0
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false }
                    }
                }
            });
        }
        
        // Socket event handlers
        socket.on('connect', () => {
            addEvent('✅ Connected to test orchestrator');
        });
        
        socket.on('initial-state', (state) => {
            updateProgress(state.progress);
            updatePackageList(state.packages);
        });
        
        socket.on('progress-update', (progress) => {
            updateProgress(progress);
        });
        
        socket.on('test:start', (data) => {
            addEvent(\`🧪 Testing \${data.package}...\`);
            updatePackageStatus(data.package, 'running');
        });
        
        socket.on('test:complete', (data) => {
            const icon = data.result.success ? '✅' : '❌';
            addEvent(\`\${icon} \${data.package}: \${data.result.tests.passed}/\${data.result.tests.total} passed\`);
            updatePackageStatus(data.package, data.result.success ? 'passed' : 'failed');
        });
        
        socket.on('execution:complete', (data) => {
            addEvent('🎉 All tests complete!');
            document.getElementById('startBtn').disabled = false;
            document.getElementById('stopBtn').disabled = true;
        });
        
        // Update functions
        function updateProgress(progress) {
            const percent = (progress.completedPackages / progress.totalPackages * 100).toFixed(1);
            document.getElementById('progressBar').style.width = percent + '%';
            document.getElementById('progressBar').textContent = percent + '%';
            
            document.getElementById('completedCount').textContent = progress.completedPackages;
            document.getElementById('totalCount').textContent = progress.totalPackages;
            document.getElementById('passedCount').textContent = progress.passedPackages.length;
            document.getElementById('failedCount').textContent = progress.failedPackages.length;
            
            document.getElementById('coveragePercent').textContent = progress.coverage.overall.toFixed(1) + '%';
            document.getElementById('throughputValue').textContent = progress.currentThroughput.toFixed(2);
            
            // Update coverage chart
            if (coverageChart) {
                coverageChart.data.datasets[0].data = [
                    progress.coverage.overall,
                    100 - progress.coverage.overall
                ];
                coverageChart.update('none');
            }
            
            // Update throughput chart
            if (throughputChart) {
                throughputData.push(progress.currentThroughput);
                if (throughputData.length > 60) throughputData.shift();
                
                throughputChart.data.labels = throughputData.map((_, i) => i);
                throughputChart.data.datasets[0].data = throughputData;
                throughputChart.update('none');
            }
        }
        
        function updatePackageList(packages) {
            const list = document.getElementById('packageList');
            list.innerHTML = packages.map(pkg => \`
                <div class="package-item" id="pkg-\${pkg.name}">
                    <span>\${pkg.name}</span>
                    <span class="coverage-badge">-</span>
                </div>
            \`).join('');
        }
        
        function updatePackageStatus(packageName, status) {
            const element = document.getElementById(\`pkg-\${packageName}\`);
            if (element) {
                element.className = \`package-item \${status}\`;
            }
        }
        
        function addEvent(message) {
            const log = document.getElementById('eventLog');
            const event = document.createElement('div');
            event.className = 'event-item';
            event.textContent = new Date().toLocaleTimeString() + ' - ' + message;
            log.insertBefore(event, log.firstChild);
            
            // Keep only last 100 events
            while (log.children.length > 100) {
                log.removeChild(log.lastChild);
            }
        }
        
        // Control functions
        function startTests() {
            socket.emit('start-tests');
            document.getElementById('startBtn').disabled = true;
            document.getElementById('stopBtn').disabled = false;
            addEvent('🚀 Starting tests...');
        }
        
        function stopTests() {
            socket.emit('stop-tests');
            document.getElementById('startBtn').disabled = false;
            document.getElementById('stopBtn').disabled = true;
            addEvent('⏹️ Stopping tests...');
        }
        
        // Initialize on load
        window.addEventListener('load', () => {
            initCharts();
        });
    </script>
</body>
</html>`;
  }
}

export default WebDashboard;