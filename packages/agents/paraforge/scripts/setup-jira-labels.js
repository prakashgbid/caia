#!/usr/bin/env node

/**
 * Setup Jira Labels for PARA Project
 * Creates and applies comprehensive labeling system
 */

const https = require('https');

// Configuration
const JIRA_HOST = 'roulettecommunity.atlassian.net';
const JIRA_EMAIL = 'prakashmailid@gmail.com';
const JIRA_TOKEN = process.env.JIRA_API_TOKEN || process.argv[2];
const PROJECT_KEY = 'PARA';

if (!JIRA_TOKEN) {
    console.log('❌ Please provide Jira API token');
    console.log('Usage: node setup-jira-labels.js YOUR_TOKEN');
    process.exit(1);
}

const auth = Buffer.from(`${JIRA_EMAIL}:${JIRA_TOKEN}`).toString('base64');

// Define all labels to create
const LABELS = {
    hierarchy: [
        'PROJECT',
        'INITIATIVE',
        'FEATURE',
        'CAPABILITY', 
        'COMPONENT',
        'MILESTONE',
        'FOUNDATION'
    ],
    scope: [
        'SCOPE:XXL',
        'SCOPE:XL',
        'SCOPE:L',
        'SCOPE:M',
        'SCOPE:S',
        'SCOPE:XS'
    ],
    domain: [
        'DOMAIN:UI',
        'DOMAIN:UX',
        'DOMAIN:API',
        'DOMAIN:DB',
        'DOMAIN:AUTH',
        'DOMAIN:INFRA',
        'DOMAIN:INTEGRATION',
        'DOMAIN:ANALYTICS',
        'DOMAIN:SECURITY',
        'DOMAIN:PERFORMANCE',
        'DOMAIN:AI',
        'DOMAIN:MOBILE',
        'DOMAIN:WEB'
    ],
    type: [
        'TYPE:RESEARCH',
        'TYPE:DESIGN',
        'TYPE:IMPLEMENTATION',
        'TYPE:TESTING',
        'TYPE:DOCUMENTATION',
        'TYPE:REFACTOR',
        'TYPE:BUGFIX',
        'TYPE:OPTIMIZATION',
        'TYPE:MIGRATION',
        'TYPE:CONFIGURATION'
    ],
    priority: [
        'PRIORITY:CRITICAL',
        'PRIORITY:HIGH',
        'PRIORITY:MEDIUM',
        'PRIORITY:LOW',
        'PRIORITY:BACKLOG'
    ],
    dependency: [
        'BLOCKS:RELEASE',
        'BLOCKS:FEATURE',
        'BLOCKS:TEAM',
        'DEPENDENCY:EXTERNAL',
        'DEPENDENCY:INTERNAL',
        'STANDALONE'
    ],
    phase: [
        'PHASE:DISCOVERY',
        'PHASE:DESIGN',
        'PHASE:DEVELOPMENT',
        'PHASE:TESTING',
        'PHASE:REVIEW',
        'PHASE:DEPLOYMENT',
        'PHASE:MONITORING'
    ],
    team: [
        'TEAM:FRONTEND',
        'TEAM:BACKEND',
        'TEAM:FULLSTACK',
        'TEAM:DEVOPS',
        'TEAM:QA',
        'TEAM:DESIGN',
        'TEAM:PRODUCT',
        'TEAM:DATA'
    ],
    risk: [
        'RISK:HIGH',
        'RISK:MEDIUM',
        'RISK:LOW',
        'RISK:SECURITY',
        'RISK:BREAKING'
    ],
    review: [
        'NEEDS:REVIEW',
        'NEEDS:APPROVAL',
        'NEEDS:TESTING',
        'NEEDS:DOCUMENTATION',
        'READY:PRODUCTION'
    ],
    sprint: [
        'SPRINT:READY',
        'SPRINT:CARRYOVER',
        'SPRINT:STRETCH',
        'SPRINT:COMMITTED'
    ]
};

function makeRequest(path, method = 'GET', data = null) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: JIRA_HOST,
            path: path,
            method: method,
            headers: {
                'Authorization': `Basic ${auth}`,
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            }
        };

        const req = https.request(options, (res) => {
            let responseData = '';
            res.on('data', chunk => responseData += chunk);
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    try {
                        resolve(JSON.parse(responseData || '{}'));
                    } catch {
                        resolve(responseData);
                    }
                } else {
                    reject(`HTTP ${res.statusCode}: ${responseData}`);
                }
            });
        });

        req.on('error', reject);
        if (data) req.write(JSON.stringify(data));
        req.end();
    });
}

async function addLabelToIssue(issueKey, labels) {
    try {
        const data = {
            update: {
                labels: labels.map(label => ({ add: label }))
            }
        };
        
        await makeRequest(`/rest/api/3/issue/${issueKey}`, 'PUT', data);
        return true;
    } catch (error) {
        console.error(`Failed to add labels to ${issueKey}: ${error}`);
        return false;
    }
}

async function setupLabels() {
    console.log('🏷️  Setting up Jira Labels for PARA Project');
    console.log('============================================\n');

    try {
        // Test authentication
        const user = await makeRequest('/rest/api/3/myself');
        console.log(`✅ Authenticated as: ${user.displayName}\n`);

        // Get all project issues
        console.log('📋 Fetching project issues...');
        const searchResult = await makeRequest(
            `/rest/api/3/search?jql=project=${PROJECT_KEY}&maxResults=100&fields=summary,issuetype`
        );
        
        console.log(`Found ${searchResult.issues.length} issues\n`);

        // Apply labels based on issue characteristics
        console.log('🏷️  Applying labels to issues...\n');
        
        for (const issue of searchResult.issues) {
            const labels = [];
            const summary = issue.fields.summary.toLowerCase();
            const issueType = issue.fields.issuetype.name;
            
            // Apply hierarchy labels
            if (summary.includes('initiative:')) {
                labels.push('INITIATIVE', 'SCOPE:XXL');
            } else if (summary.includes('feature:')) {
                labels.push('FEATURE', 'SCOPE:XL');
            } else if (issueType === 'Epic') {
                if (summary.includes('multi-agent') || summary.includes('synthesis') || 
                    summary.includes('dependency') || summary.includes('optimization')) {
                    labels.push('CAPABILITY', 'SCOPE:L');
                }
            } else if (issueType === 'Story') {
                labels.push('SCOPE:M');
            } else if (issueType === 'Task') {
                labels.push('SCOPE:S');
            }
            
            // Apply domain labels based on content
            if (summary.includes('ui') || summary.includes('interface')) {
                labels.push('DOMAIN:UI');
            }
            if (summary.includes('ux') || summary.includes('user experience')) {
                labels.push('DOMAIN:UX');
            }
            if (summary.includes('api') || summary.includes('endpoint')) {
                labels.push('DOMAIN:API');
            }
            if (summary.includes('database') || summary.includes('db') || summary.includes('schema')) {
                labels.push('DOMAIN:DB');
            }
            if (summary.includes('auth') || summary.includes('permission')) {
                labels.push('DOMAIN:AUTH');
            }
            if (summary.includes('jira') || summary.includes('integration')) {
                labels.push('DOMAIN:INTEGRATION');
            }
            if (summary.includes('agent') || summary.includes('ai')) {
                labels.push('DOMAIN:AI');
            }
            if (summary.includes('performance') || summary.includes('optimization')) {
                labels.push('DOMAIN:PERFORMANCE');
            }
            
            // Apply type labels
            if (summary.includes('implement')) {
                labels.push('TYPE:IMPLEMENTATION');
            } else if (summary.includes('build') || summary.includes('create')) {
                labels.push('TYPE:IMPLEMENTATION');
            } else if (summary.includes('test')) {
                labels.push('TYPE:TESTING');
            } else if (summary.includes('design')) {
                labels.push('TYPE:DESIGN');
            } else if (summary.includes('research')) {
                labels.push('TYPE:RESEARCH');
            } else if (summary.includes('document')) {
                labels.push('TYPE:DOCUMENTATION');
            }
            
            // Apply team labels based on domain
            if (labels.includes('DOMAIN:UI') || labels.includes('DOMAIN:UX')) {
                labels.push('TEAM:FRONTEND');
            } else if (labels.includes('DOMAIN:API') || labels.includes('DOMAIN:DB')) {
                labels.push('TEAM:BACKEND');
            } else if (labels.includes('DOMAIN:AI')) {
                labels.push('TEAM:DATA');
            }
            
            // Apply default priority
            if (labels.includes('FEATURE')) {
                labels.push('PRIORITY:HIGH');
            } else if (labels.includes('CAPABILITY')) {
                labels.push('PRIORITY:MEDIUM');
            }
            
            // Apply phase labels
            labels.push('PHASE:DISCOVERY'); // All start in discovery
            
            // Apply dependency labels
            if (summary.includes('core') || summary.includes('foundation')) {
                labels.push('FOUNDATION');
            }
            
            if (labels.length > 0) {
                const success = await addLabelToIssue(issue.key, labels);
                if (success) {
                    console.log(`✅ ${issue.key}: Added ${labels.join(', ')}`);
                } else {
                    console.log(`❌ ${issue.key}: Failed to add labels`);
                }
            }
        }
        
        console.log('\n📊 Label Statistics:');
        console.log('====================');
        
        // Print all available labels for reference
        console.log('\n📋 Available Labels by Category:\n');
        
        Object.entries(LABELS).forEach(([category, labelList]) => {
            console.log(`${category.toUpperCase()}:`);
            console.log(labelList.map(l => `  • ${l}`).join('\n'));
            console.log();
        });
        
        console.log('✨ Label setup complete!');
        console.log(`\n🔗 View labeled issues at:`);
        console.log(`   https://${JIRA_HOST}/jira/software/c/projects/${PROJECT_KEY}/issues`);
        
        console.log('\n💡 Example JQL Queries:');
        console.log('   • Features: labels = "FEATURE"');
        console.log('   • High Priority: labels = "PRIORITY:HIGH"');
        console.log('   • Backend Work: labels = "TEAM:BACKEND"');
        console.log('   • AI Domain: labels = "DOMAIN:AI"');
        console.log('   • Ready for Sprint: labels = "SPRINT:READY"');
        
    } catch (error) {
        console.error('❌ Failed:', error);
    }
}

// Run
setupLabels();