// Global data store
let dashboardData = null;

// Initialize dashboard
document.addEventListener('DOMContentLoaded', () => {
    loadData();
    setInterval(updateTimestamp, 60000); // Update timestamp every minute
});

// Load data from API
async function loadData() {
    showLoading(true);

    try {
        const response = await fetch('/api/scan');
        dashboardData = await response.json();

        updateStats();
        renderOverview();
        renderAllTabs();
        updateTimestamp();

    } catch (error) {
        console.error('Error loading data:', error);
        showError('Failed to load data. Please refresh the page.');
    } finally {
        showLoading(false);
    }
}

// Refresh data
async function refreshData() {
    const refreshBtn = document.querySelector('button[onclick="refreshData()"]');
    refreshBtn.disabled = true;
    refreshBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Refreshing...';

    try {
        const response = await fetch('/api/refresh');
        dashboardData = await response.json();

        updateStats();
        renderOverview();
        renderAllTabs();
        updateTimestamp();

        showNotification('Data refreshed successfully!', 'success');
    } catch (error) {
        console.error('Error refreshing data:', error);
        showNotification('Failed to refresh data', 'error');
    } finally {
        refreshBtn.disabled = false;
        refreshBtn.innerHTML = '<i class="fas fa-sync-alt mr-2"></i> Refresh';
    }
}

// Update statistics
function updateStats() {
    if (!dashboardData) return;

    document.getElementById('totalProjects').textContent = dashboardData.packages.length;
    document.getElementById('totalAgents').textContent = dashboardData.agents.length;
    document.getElementById('totalTools').textContent = dashboardData.tools.length;
    document.getElementById('totalUtilities').textContent = dashboardData.utilities.length;
    document.getElementById('totalFiles').textContent = dashboardData.stats.totalFiles || 0;
}

// Render overview tab
function renderOverview() {
    if (!dashboardData) return;

    // Language stats
    const langStatsEl = document.getElementById('languageStats');
    langStatsEl.innerHTML = '';

    const totalLangFiles = Object.values(dashboardData.stats.languages || {})
        .reduce((a, b) => a + b, 0);

    Object.entries(dashboardData.stats.languages || {})
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .forEach(([lang, count]) => {
            const percentage = ((count / totalLangFiles) * 100).toFixed(1);
            langStatsEl.innerHTML += `
                <div class="flex justify-between items-center">
                    <span class="text-gray-700">.${lang}</span>
                    <div class="flex items-center">
                        <div class="w-24 bg-gray-200 rounded-full h-2 mr-2">
                            <div class="bg-purple-600 h-2 rounded-full" style="width: ${percentage}%"></div>
                        </div>
                        <span class="text-sm text-gray-600">${count}</span>
                    </div>
                </div>
            `;
        });

    // Quick stats
    const quickStatsEl = document.getElementById('quickStats');
    const allItems = [
        ...dashboardData.packages,
        ...dashboardData.agents,
        ...dashboardData.tools,
        ...dashboardData.utilities,
        ...dashboardData.services
    ];

    const withReadme = allItems.filter(i => i.readme).length;
    const withPackageJson = allItems.filter(i => i.packageJson).length;

    quickStatsEl.innerHTML = `
        <div class="flex justify-between">
            <span class="text-gray-700">With README</span>
            <span class="font-semibold">${withReadme}</span>
        </div>
        <div class="flex justify-between">
            <span class="text-gray-700">With package.json</span>
            <span class="font-semibold">${withPackageJson}</span>
        </div>
        <div class="flex justify-between">
            <span class="text-gray-700">Total Components</span>
            <span class="font-semibold">${allItems.length}</span>
        </div>
    `;

    // Recent activity (mock data for now)
    const recentActivityEl = document.getElementById('recentActivity');
    recentActivityEl.innerHTML = `
        <div class="text-gray-600">• Agent system updated</div>
        <div class="text-gray-600">• New tool added</div>
        <div class="text-gray-600">• Bug fixes in utilities</div>
        <div class="text-gray-600">• Documentation improved</div>
    `;

    // Featured items
    const featuredEl = document.getElementById('featuredItems');
    featuredEl.innerHTML = '';

    const featured = allItems
        .filter(item => item.files > 10)
        .sort((a, b) => b.files - a.files)
        .slice(0, 8);

    featured.forEach(item => {
        featuredEl.innerHTML += createFeatureCard(item, getItemType(item));
    });
}

// Render all tabs
function renderAllTabs() {
    if (!dashboardData) return;

    renderItemList('packages', dashboardData.packages);
    renderItemList('agents', dashboardData.agents);
    renderItemList('tools', dashboardData.tools);
    renderItemList('utilities', dashboardData.utilities);
    renderItemList('services', dashboardData.services);
}

// Render item list
function renderItemList(type, items) {
    const listEl = document.getElementById(`${type}List`);
    if (!listEl) return;

    listEl.innerHTML = '';

    if (items.length === 0) {
        listEl.innerHTML = `
            <div class="col-span-full text-center py-8 text-gray-500">
                <i class="fas fa-inbox text-4xl mb-2"></i>
                <p>No ${type} found</p>
            </div>
        `;
        return;
    }

    items.forEach(item => {
        listEl.innerHTML += createFeatureCard(item, type);
    });
}

// Create feature card
function createFeatureCard(item, type) {
    const icon = getTypeIcon(type);
    const color = getTypeColor(type);

    return `
        <div class="feature-card bg-white rounded-lg p-4 cursor-pointer hover:shadow-lg"
             onclick="showDetails('${type}', '${item.name}')"
             data-name="${item.name.toLowerCase()}">
            <div class="flex items-start justify-between mb-2">
                <div class="flex items-center">
                    <i class="${icon} text-${color}-600 mr-2"></i>
                    <h3 class="font-semibold text-gray-800">${item.name}</h3>
                </div>
                ${item.version ? `<span class="text-xs bg-gray-100 px-2 py-1 rounded">v${item.version}</span>` : ''}
            </div>

            <p class="text-sm text-gray-600 mb-3 line-clamp-2">
                ${item.description || 'No description available'}
            </p>

            <div class="flex items-center justify-between text-xs text-gray-500">
                <div class="flex items-center space-x-3">
                    <span><i class="fas fa-file"></i> ${item.files || 0}</span>
                    <span><i class="fas fa-hdd"></i> ${item.size || 'N/A'}</span>
                </div>
                <div class="flex items-center space-x-2">
                    ${item.readme ? '<i class="fas fa-book text-green-500" title="Has README"></i>' : ''}
                    ${item.packageJson ? '<i class="fas fa-box text-blue-500" title="Has package.json"></i>' : ''}
                </div>
            </div>

            ${item.features && item.features.length > 0 ? `
                <div class="mt-3 flex flex-wrap gap-1">
                    ${item.features.slice(0, 3).map(f =>
                        `<span class="text-xs bg-${color}-100 text-${color}-700 px-2 py-1 rounded">${f}</span>`
                    ).join('')}
                    ${item.features.length > 3 ?
                        `<span class="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded">+${item.features.length - 3}</span>`
                        : ''}
                </div>
            ` : ''}
        </div>
    `;
}

// Show details modal
async function showDetails(type, name) {
    const modal = document.getElementById('detailModal');
    const modalTitle = document.getElementById('modalTitle');
    const modalContent = document.getElementById('modalContent');

    modalTitle.textContent = `${name} Details`;
    modalContent.innerHTML = '<div class="loader mx-auto"></div>';
    modal.classList.remove('hidden');

    try {
        const response = await fetch(`/api/details/${type}/${name}`);
        const details = await response.json();

        modalContent.innerHTML = `
            <div class="space-y-4">
                <div class="grid grid-cols-2 gap-4">
                    <div>
                        <h3 class="font-semibold text-gray-700 mb-2">Information</h3>
                        <dl class="space-y-1">
                            <div class="flex justify-between">
                                <dt class="text-gray-600">Type:</dt>
                                <dd class="font-medium">${type}</dd>
                            </div>
                            <div class="flex justify-between">
                                <dt class="text-gray-600">Version:</dt>
                                <dd class="font-medium">${details.version || 'N/A'}</dd>
                            </div>
                            <div class="flex justify-between">
                                <dt class="text-gray-600">Files:</dt>
                                <dd class="font-medium">${details.files}</dd>
                            </div>
                            <div class="flex justify-between">
                                <dt class="text-gray-600">Size:</dt>
                                <dd class="font-medium">${details.size}</dd>
                            </div>
                        </dl>
                    </div>

                    <div>
                        <h3 class="font-semibold text-gray-700 mb-2">Status</h3>
                        <div class="space-y-2">
                            <div class="flex items-center">
                                ${details.readme ?
                                    '<i class="fas fa-check-circle text-green-500 mr-2"></i> Has README' :
                                    '<i class="fas fa-times-circle text-gray-400 mr-2"></i> No README'}
                            </div>
                            <div class="flex items-center">
                                ${details.packageJson ?
                                    '<i class="fas fa-check-circle text-green-500 mr-2"></i> Has package.json' :
                                    '<i class="fas fa-times-circle text-gray-400 mr-2"></i> No package.json'}
                            </div>
                        </div>
                    </div>
                </div>

                ${details.description ? `
                    <div>
                        <h3 class="font-semibold text-gray-700 mb-2">Description</h3>
                        <p class="text-gray-600">${details.description}</p>
                    </div>
                ` : ''}

                ${details.features && details.features.length > 0 ? `
                    <div>
                        <h3 class="font-semibold text-gray-700 mb-2">Features (${details.features.length})</h3>
                        <div class="flex flex-wrap gap-2">
                            ${details.features.map(f =>
                                `<span class="bg-purple-100 text-purple-700 px-3 py-1 rounded-full text-sm">${f}</span>`
                            ).join('')}
                        </div>
                    </div>
                ` : ''}

                ${details.fileTree ? `
                    <div>
                        <h3 class="font-semibold text-gray-700 mb-2">File Structure</h3>
                        <pre class="bg-gray-100 p-3 rounded text-xs overflow-x-auto">${details.fileTree}</pre>
                    </div>
                ` : ''}

                <div>
                    <h3 class="font-semibold text-gray-700 mb-2">Path</h3>
                    <code class="bg-gray-100 px-2 py-1 rounded text-sm">${details.path}</code>
                </div>
            </div>
        `;
    } catch (error) {
        modalContent.innerHTML = `
            <div class="text-red-600">
                <i class="fas fa-exclamation-triangle mr-2"></i>
                Failed to load details
            </div>
        `;
    }
}

// Close modal
function closeModal() {
    document.getElementById('detailModal').classList.add('hidden');
}

// Switch tabs
function switchTab(tabName) {
    // Update buttons
    document.querySelectorAll('.tab-button').forEach(btn => {
        btn.classList.remove('active');
        if (btn.textContent.toLowerCase().includes(tabName) ||
            (tabName === 'overview' && btn.textContent.includes('Overview'))) {
            btn.classList.add('active');
        }
    });

    // Update content
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
    });
    document.getElementById(tabName).classList.add('active');
}

// Filter items
function filterItems(type, query) {
    const cards = document.querySelectorAll(`#${type}List .feature-card`);

    cards.forEach(card => {
        const name = card.dataset.name;
        if (name.includes(query.toLowerCase())) {
            card.style.display = '';
        } else {
            card.style.display = 'none';
        }
    });
}

// Helper functions
function getTypeIcon(type) {
    const icons = {
        packages: 'fas fa-box',
        agents: 'fas fa-robot',
        tools: 'fas fa-wrench',
        utilities: 'fas fa-cogs',
        services: 'fas fa-server',
        agent: 'fas fa-robot',
        tool: 'fas fa-wrench',
        utility: 'fas fa-cogs',
        service: 'fas fa-server'
    };
    return icons[type] || 'fas fa-folder';
}

function getTypeColor(type) {
    const colors = {
        packages: 'blue',
        agents: 'purple',
        tools: 'green',
        utilities: 'yellow',
        services: 'red',
        agent: 'purple',
        tool: 'green',
        utility: 'yellow',
        service: 'red'
    };
    return colors[type] || 'gray';
}

function getItemType(item) {
    if (item.type) return item.type;
    if (dashboardData.agents.includes(item)) return 'agent';
    if (dashboardData.tools.includes(item)) return 'tool';
    if (dashboardData.utilities.includes(item)) return 'utility';
    if (dashboardData.services.includes(item)) return 'service';
    return 'package';
}

function showLoading(show) {
    document.getElementById('loading').style.display = show ? 'flex' : 'none';
}

function updateTimestamp() {
    const el = document.querySelector('#lastUpdate span');
    el.textContent = new Date().toLocaleTimeString();
}

function showNotification(message, type = 'info') {
    // Simple notification (could be enhanced with a toast library)
    console.log(`[${type}] ${message}`);
}

function showError(message) {
    console.error(message);
    showNotification(message, 'error');
}