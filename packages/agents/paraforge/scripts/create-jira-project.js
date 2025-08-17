#!/usr/bin/env node

/**
 * Create ParaForge Project in Jira
 * Sets up proper hierarchy: Features → Epics → Stories → Tasks
 */

const https = require('https');

// Configuration
const JIRA_HOST = 'roulettecommunity.atlassian.net';
const JIRA_EMAIL = 'prakashmailid@gmail.com';
const JIRA_TOKEN = process.env.JIRA_API_TOKEN || process.argv[2];
const PROJECT_KEY = 'PARA'; // ParaForge project key
const PROJECT_NAME = 'ParaForge';

if (!JIRA_TOKEN) {
    console.log('❌ Please provide Jira API token');
    console.log('Usage: node create-jira-project.js YOUR_TOKEN');
    process.exit(1);
}

const auth = Buffer.from(`${JIRA_EMAIL}:${JIRA_TOKEN}`).toString('base64');

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

async function createParaForgeProject() {
    console.log('🚀 Creating ParaForge Project in Jira');
    console.log('=====================================\n');

    try {
        // Test authentication
        const user = await makeRequest('/rest/api/3/myself');
        console.log(`✅ Authenticated as: ${user.displayName}\n`);

        // Check if project exists
        try {
            const existing = await makeRequest(`/rest/api/3/project/${PROJECT_KEY}`);
            console.log(`⚠️  Project ${PROJECT_KEY} already exists!`);
            console.log(`   URL: https://${JIRA_HOST}/jira/software/projects/${PROJECT_KEY}`);
            return existing;
        } catch (e) {
            console.log('📝 Project does not exist, creating...\n');
        }

        // Create project
        const projectData = {
            key: PROJECT_KEY,
            name: PROJECT_NAME,
            description: 'Intelligent AI-Orchestrated Project Management System',
            projectTypeKey: 'software',
            leadAccountId: user.accountId,
            assigneeType: 'PROJECT_LEAD'
        };

        const project = await makeRequest('/rest/api/3/project', 'POST', projectData);
        console.log(`✅ Project created: ${project.key}\n`);

        // Create initial Feature-level Epics
        console.log('Creating Feature hierarchy...\n');

        const features = [
            {
                name: '🏗️ FEATURE: Core Architecture',
                description: 'Foundation and core system architecture',
                epics: [
                    {
                        name: 'Multi-Agent System',
                        stories: [
                            'Implement UX Analysis Agent',
                            'Implement Database Agent',
                            'Implement API Agent',
                            'Create Agent Communication Protocol'
                        ]
                    },
                    {
                        name: 'Synthesis Engine',
                        stories: [
                            'Build Dependency Matrix Generator',
                            'Implement Consensus Protocol',
                            'Create Conflict Resolution System'
                        ]
                    }
                ]
            },
            {
                name: '🔀 FEATURE: Parallelization Engine',
                description: 'Intelligent task parallelization and optimization',
                epics: [
                    {
                        name: 'Dependency Analysis',
                        stories: [
                            'Build Graph Analysis Algorithm',
                            'Implement Critical Path Detection',
                            'Create Parallel Path Generator'
                        ]
                    },
                    {
                        name: 'Optimization Engine',
                        stories: [
                            'Implement Resource Balancing',
                            'Create Dynamic Rebalancing',
                            'Build Performance Metrics'
                        ]
                    }
                ]
            },
            {
                name: '🔗 FEATURE: Jira Integration',
                description: 'Complete Jira Cloud integration',
                epics: [
                    {
                        name: 'Jira Connector',
                        stories: [
                            'Implement Issue Creation API',
                            'Build Hierarchy Management',
                            'Create Linking System'
                        ]
                    },
                    {
                        name: 'MCP Server Integration',
                        stories: [
                            'Integrate Jira MCP Server',
                            'Build AI-Native Operations',
                            'Create Batch Processing'
                        ]
                    }
                ]
            },
            {
                name: '🎓 FEATURE: Learning System',
                description: 'Organizational memory and pattern recognition',
                epics: [
                    {
                        name: 'Pattern Recognition',
                        stories: [
                            'Build Pattern Storage',
                            'Implement Template Generation',
                            'Create Domain Knowledge Base'
                        ]
                    },
                    {
                        name: 'Continuous Improvement',
                        stories: [
                            'Build Feedback Loop',
                            'Implement Performance Analytics',
                            'Create Learning Algorithms'
                        ]
                    }
                ]
            }
        ];

        // Create Features as Epics (since Jira doesn't have Feature type by default)
        for (const feature of features) {
            console.log(`Creating ${feature.name}`);
            
            const featureData = {
                fields: {
                    project: { key: PROJECT_KEY },
                    summary: feature.name,
                    description: {
                        type: 'doc',
                        version: 1,
                        content: [{
                            type: 'paragraph',
                            content: [{
                                type: 'text',
                                text: feature.description
                            }]
                        }]
                    },
                    issuetype: { id: '10001' } // Epic
                    // Note: assignee field removed due to screen configuration
                }
            };

            try {
                const createdFeature = await makeRequest('/rest/api/3/issue', 'POST', featureData);
                console.log(`  ✅ Created: ${createdFeature.key}`);

                // Create child Epics under this Feature
                for (const epic of feature.epics) {
                    const epicData = {
                        fields: {
                            project: { key: PROJECT_KEY },
                            summary: `EPIC: ${epic.name}`,
                            issuetype: { id: '10001' } // Epic
                        }
                    };

                    const createdEpic = await makeRequest('/rest/api/3/issue', 'POST', epicData);
                    console.log(`    ✅ Epic: ${createdEpic.key} - ${epic.name}`);

                    // Create Stories under Epic
                    for (const story of epic.stories) {
                        const storyData = {
                            fields: {
                                project: { key: PROJECT_KEY },
                                summary: story,
                                issuetype: { id: '10004' }, // Story
                                parent: { key: createdEpic.key }
                            }
                        };

                        try {
                            const createdStory = await makeRequest('/rest/api/3/issue', 'POST', storyData);
                            console.log(`      ✅ Story: ${createdStory.key}`);
                        } catch (e) {
                            console.log(`      ⚠️  Could not create story: ${story}`);
                        }
                    }
                }
            } catch (e) {
                console.log(`  ❌ Failed to create feature: ${e}`);
            }
        }

        console.log('\n✨ ParaForge project structure created!');
        console.log(`\n🔗 View project: https://${JIRA_HOST}/jira/software/projects/${PROJECT_KEY}`);
        
        return project;

    } catch (error) {
        console.error('❌ Failed:', error);
        process.exit(1);
    }
}

// Run
createParaForgeProject();