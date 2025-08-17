#!/usr/bin/env node

/**
 * Populate PARA Project with ParaForge Development Issues
 * Creates proper hierarchy: Features → Epics → Stories → Tasks
 */

const https = require('https');

// Configuration
const JIRA_HOST = 'roulettecommunity.atlassian.net';
const JIRA_EMAIL = 'prakashmailid@gmail.com';
const JIRA_TOKEN = process.env.JIRA_API_TOKEN || process.argv[2];
const PROJECT_KEY = 'PARA';

if (!JIRA_TOKEN) {
    console.log('❌ Please provide Jira API token');
    console.log('Usage: node populate-para-issues.js YOUR_TOKEN');
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

// ParaForge Project Structure
const projectStructure = {
    features: [
        {
            name: '🏗️ Core Architecture',
            description: 'Foundation and core system architecture for ParaForge',
            epics: [
                {
                    name: 'Multi-Agent System',
                    description: 'Implement specialized AI agents for technical analysis',
                    stories: [
                        {
                            name: 'Implement UX Analysis Agent',
                            tasks: ['Research UX patterns', 'Build agent logic', 'Create tests', 'Documentation']
                        },
                        {
                            name: 'Implement Database Agent',
                            tasks: ['Schema analysis logic', 'Dependency detection', 'Migration planning', 'Tests']
                        },
                        {
                            name: 'Implement API Agent',
                            tasks: ['Endpoint analysis', 'Contract validation', 'Integration mapping', 'Tests']
                        },
                        {
                            name: 'Create Agent Communication Protocol',
                            tasks: ['Message bus design', 'Protocol specification', 'Implementation', 'Integration tests']
                        }
                    ]
                },
                {
                    name: 'Synthesis Engine',
                    description: 'Build consensus and synthesis system',
                    stories: [
                        {
                            name: 'Build Dependency Matrix Generator',
                            tasks: ['Algorithm design', 'Matrix structure', 'Implementation', 'Validation']
                        },
                        {
                            name: 'Implement Consensus Protocol',
                            tasks: ['Protocol design', 'Voting mechanism', 'Conflict detection', 'Tests']
                        },
                        {
                            name: 'Create Conflict Resolution System',
                            tasks: ['Resolution strategies', 'Priority rules', 'Implementation', 'Tests']
                        }
                    ]
                }
            ]
        },
        {
            name: '🔀 Parallelization Engine',
            description: 'Intelligent task parallelization and optimization',
            epics: [
                {
                    name: 'Dependency Analysis',
                    description: 'Analyze and map task dependencies',
                    stories: [
                        {
                            name: 'Build Graph Analysis Algorithm',
                            tasks: ['DAG implementation', 'Cycle detection', 'Path analysis', 'Performance optimization']
                        },
                        {
                            name: 'Implement Critical Path Detection',
                            tasks: ['Algorithm selection', 'Implementation', 'Optimization', 'Visualization']
                        },
                        {
                            name: 'Create Parallel Path Generator',
                            tasks: ['Path identification', 'Resource constraints', 'Optimization logic', 'Tests']
                        }
                    ]
                },
                {
                    name: 'Optimization Engine',
                    description: 'Optimize parallel execution paths',
                    stories: [
                        {
                            name: 'Implement Resource Balancing',
                            tasks: ['Resource modeling', 'Balancing algorithm', 'Constraints handling', 'Tests']
                        },
                        {
                            name: 'Create Dynamic Rebalancing',
                            tasks: ['Monitoring system', 'Trigger conditions', 'Rebalancing logic', 'Performance tests']
                        },
                        {
                            name: 'Build Performance Metrics',
                            tasks: ['Metric definition', 'Collection system', 'Analysis tools', 'Dashboard']
                        }
                    ]
                }
            ]
        },
        {
            name: '🔗 Jira Integration',
            description: 'Complete Jira Cloud integration with MCP support',
            epics: [
                {
                    name: 'Jira Connector',
                    description: 'Core Jira API integration',
                    stories: [
                        {
                            name: 'Implement Issue Creation API',
                            tasks: ['API client setup', 'Issue templates', 'Batch creation', 'Error handling']
                        },
                        {
                            name: 'Build Hierarchy Management',
                            tasks: ['Parent-child linking', 'Epic management', 'Feature support', 'Validation']
                        },
                        {
                            name: 'Create Linking System',
                            tasks: ['Blocks/blocked by', 'Related issues', 'Dependency tracking', 'Tests']
                        }
                    ]
                },
                {
                    name: 'MCP Server Integration',
                    description: 'Integrate Jira MCP for AI operations',
                    stories: [
                        {
                            name: 'Integrate Jira MCP Server',
                            tasks: ['MCP setup', 'Configuration', 'Connection management', 'Tests']
                        },
                        {
                            name: 'Build AI-Native Operations',
                            tasks: ['Natural language queries', 'Smart filters', 'Automated updates', 'Tests']
                        },
                        {
                            name: 'Create Batch Processing',
                            tasks: ['Bulk operations', 'Transaction support', 'Performance optimization', 'Tests']
                        }
                    ]
                }
            ]
        },
        {
            name: '🎓 Learning System',
            description: 'Organizational memory and continuous improvement',
            epics: [
                {
                    name: 'Pattern Recognition',
                    description: 'Learn from project decompositions',
                    stories: [
                        {
                            name: 'Build Pattern Storage',
                            tasks: ['Database schema', 'Storage system', 'Indexing', 'Retrieval']
                        },
                        {
                            name: 'Implement Template Generation',
                            tasks: ['Pattern extraction', 'Template structure', 'Customization', 'Validation']
                        },
                        {
                            name: 'Create Domain Knowledge Base',
                            tasks: ['Knowledge structure', 'Domain modeling', 'Query system', 'Updates']
                        }
                    ]
                },
                {
                    name: 'Continuous Improvement',
                    description: 'Learn and improve from usage',
                    stories: [
                        {
                            name: 'Build Feedback Loop',
                            tasks: ['Feedback collection', 'Analysis system', 'Integration points', 'Metrics']
                        },
                        {
                            name: 'Implement Performance Analytics',
                            tasks: ['Metric collection', 'Analysis algorithms', 'Reporting', 'Dashboards']
                        },
                        {
                            name: 'Create Learning Algorithms',
                            tasks: ['ML model selection', 'Training pipeline', 'Validation', 'Deployment']
                        }
                    ]
                }
            ]
        }
    ]
};

async function createIssue(issueData) {
    try {
        const result = await makeRequest('/rest/api/3/issue', 'POST', issueData);
        return result;
    } catch (error) {
        console.error(`Failed: ${error}`);
        return null;
    }
}

async function populateParaProject() {
    console.log('🚀 Populating PARA Project with ParaForge Issues');
    console.log('================================================\n');

    try {
        // Test authentication
        const user = await makeRequest('/rest/api/3/myself');
        console.log(`✅ Authenticated as: ${user.displayName}\n`);

        let totalCreated = 0;

        // Create Features (as Epics with FEATURE prefix)
        for (const feature of projectStructure.features) {
            console.log(`\n📘 Creating Feature: ${feature.name}`);
            
            const featureData = {
                fields: {
                    project: { key: PROJECT_KEY },
                    summary: `FEATURE: ${feature.name}`,
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
                    issuetype: { id: '10000' } // Epic
                }
            };

            const createdFeature = await createIssue(featureData);
            if (createdFeature) {
                console.log(`  ✅ Created: ${createdFeature.key}`);
                totalCreated++;

                // Create Epics under Feature
                for (const epic of feature.epics) {
                    console.log(`    📗 Creating Epic: ${epic.name}`);
                    
                    const epicData = {
                        fields: {
                            project: { key: PROJECT_KEY },
                            summary: epic.name,
                            description: {
                                type: 'doc',
                                version: 1,
                                content: [{
                                    type: 'paragraph',
                                    content: [{
                                        type: 'text',
                                        text: epic.description
                                    }]
                                }]
                            },
                            issuetype: { id: '10000' } // Epic
                        }
                    };

                    const createdEpic = await createIssue(epicData);
                    if (createdEpic) {
                        console.log(`      ✅ Created: ${createdEpic.key}`);
                        totalCreated++;

                        // Create Stories under Epic
                        for (const story of epic.stories) {
                            const storyData = {
                                fields: {
                                    project: { key: PROJECT_KEY },
                                    summary: story.name,
                                    issuetype: { id: '10008' }, // Story
                                    parent: { key: createdEpic.key }
                                }
                            };

                            const createdStory = await createIssue(storyData);
                            if (createdStory) {
                                console.log(`        ✅ Story: ${createdStory.key} - ${story.name}`);
                                totalCreated++;

                                // Create Tasks under Story
                                for (const task of story.tasks) {
                                    const taskData = {
                                        fields: {
                                            project: { key: PROJECT_KEY },
                                            summary: task,
                                            issuetype: { id: '10034' }, // Task
                                            parent: { key: createdStory.key }
                                        }
                                    };

                                    const createdTask = await createIssue(taskData);
                                    if (createdTask) {
                                        console.log(`          ✅ Task: ${createdTask.key} - ${task}`);
                                        totalCreated++;
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        console.log('\n================================================');
        console.log(`✨ ParaForge project population complete!`);
        console.log(`📊 Created ${totalCreated} issues in PARA project`);
        console.log(`\n🔗 View your project at:`);
        console.log(`   https://${JIRA_HOST}/jira/software/c/projects/${PROJECT_KEY}/issues`);

    } catch (error) {
        console.error('❌ Failed:', error);
    }
}

// Run
populateParaProject();