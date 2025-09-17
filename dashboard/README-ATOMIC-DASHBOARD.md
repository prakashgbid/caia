# 🚀 CAIA Atomic-Level Master Dashboard

## Overview
A comprehensive dashboard providing atomic-level visibility into ALL aspects of the CAIA ecosystem, including projects, packages, utils, features, modules, configs, rules, CC configurations, and more.

## Features

### 📊 Complete System Coverage
- **18+ Projects & Repositories** - Full project tree with file counts
- **42+ AI Agents** - All specialized agents with status and capabilities
- **82 CC Configurations** - Every optimization and enhancement setting
- **24+ Active Hooks** - All automation and enforcement rules
- **15+ APIs & Services** - Real-time status of all system endpoints
- **9,000+ Code Elements** - Functions, classes, and components indexed

### 🎯 Dashboard Tabs

1. **System Overview** - Live status of all services and APIs
2. **Projects & Packages** - Complete project tree and package analytics
3. **AI Agents** - All agents with tools, status, and descriptions
4. **CC Configs** - All Claude Code configurations grouped by category
5. **Rules & Hooks** - Active enforcement rules and automation hooks
6. **APIs & Services** - All running services with endpoints
7. **Performance** - Real-time CPU, memory, and resource metrics
8. **Knowledge System** - CKS statistics and learning events

### 🔄 Real-Time Features
- Auto-refresh every 5 seconds
- Live metric updates
- Dynamic resource monitoring
- Active service health checks
- Git repository status tracking

## Access Points

### Web Dashboard
```bash
http://localhost:3457/
```

### API Endpoints
```bash
# All data aggregated
http://localhost:3457/api/dashboard-data

# Individual endpoints
http://localhost:3457/api/systems      # System status
http://localhost:3457/api/projects     # Project tree
http://localhost:3457/api/agents       # AI agents
http://localhost:3457/api/configs      # Configurations
http://localhost:3457/api/hooks        # Hooks and automation
http://localhost:3457/api/knowledge    # Knowledge system stats
http://localhost:3457/api/performance  # Performance metrics
http://localhost:3457/api/git-status   # Repository status
http://localhost:3457/api/search?query=term  # Search across all systems
```

## Quick Start

### Start Dashboard
```bash
# Easy launch
./start-atomic-dashboard.sh

# Or manually
cd /Users/MAC/Documents/projects/caia/dashboard
node atomic-server.js
```

### Stop Dashboard
```bash
pkill -f atomic-server.js
```

### View Logs
```bash
tail -f /tmp/atomic-dashboard.log
```

## Architecture

### Frontend
- **Technology**: HTML5 + Alpine.js + Tailwind CSS
- **Visualization**: Chart.js + D3.js
- **Updates**: Real-time via polling (5s intervals)
- **Responsive**: Mobile-friendly grid layout

### Backend
- **Server**: Node.js + Express
- **Data Sources**:
  - CKS API (port 5555)
  - Enhancement API (port 5002)
  - Learning API (port 5003)
  - CC Orchestrator (port 8885)
  - Direct filesystem access
  - SQLite databases
- **Aggregation**: Parallel API calls with fallbacks

### Data Collection
The dashboard aggregates data from:
1. **20+ existing dashboards** unified into one view
2. **15+ API endpoints** for real-time data
3. **Multiple SQLite databases** for historical data
4. **Git repositories** for version control status
5. **System commands** for performance metrics

## Key Metrics Displayed

### Top-Level Metrics
- Total Projects (18+)
- AI Agents (42+)
- Active APIs (15+)
- CC Configs (82)
- Active Hooks (24+)
- Performance Boost (4.3M×)

### Detailed Information Per Category

#### Systems
- Service name, status, port, type, path
- Health check status (active/inactive)
- API endpoints and capabilities

#### Projects
- Full directory tree with item counts
- Package distribution analytics
- Repository status (clean/modified)
- Current branch and change count

#### Agents
- Name, description, icon
- Active/inactive status
- Available tools and permissions
- Location and configuration

#### Configurations
- Environment variables
- Enforcement rules
- Optimization settings
- Integration configurations

#### Performance
- CPU, Memory, Disk I/O percentages
- Network usage
- Active CC instance count
- Response times and throughput

## Customization

### Add New Data Source
Edit `atomic-server.js` and add new endpoint:
```javascript
app.get('/api/your-data', async (req, res) => {
    const data = await fetchYourData();
    res.json(data);
});
```

### Modify Dashboard Layout
Edit `atomic-dashboard.html` to add new tabs or sections.

### Change Refresh Interval
In `atomic-dashboard.html`, modify:
```javascript
setInterval(() => this.updateLiveData(), 5000); // Change 5000 to desired ms
```

## Dependencies
- Node.js
- Express.js
- Axios (HTTP client)
- SQLite3 (Database access)
- Alpine.js (Frontend reactivity)
- Tailwind CSS (Styling)
- Chart.js (Charts)
- D3.js (Visualizations)

## Troubleshooting

### Dashboard won't start
```bash
# Check if port is in use
lsof -i :3457

# Kill existing process
pkill -f atomic-server.js

# Check logs
cat /tmp/atomic-dashboard.log
```

### Missing data
- Ensure all required services are running
- Check API health endpoints
- Verify database paths are correct

### Performance issues
- Increase refresh interval
- Reduce concurrent API calls
- Check system resources

## Integration with Existing Tools

This dashboard integrates with:
1. **CAIA Feature Browser** (port 3456)
2. **Knowledge Explorer UI** (port 5000)
3. **Hierarchical Agent System UI**
4. **CC Ultimate Monitor**
5. **All admin scripts and tools**

## Future Enhancements
- WebSocket for real-time updates
- Historical data graphing
- Alert system for critical events
- Export functionality for reports
- Dark/light theme toggle
- User preferences persistence

---

*The ultimate atomic-level visibility into your entire CAIA ecosystem*