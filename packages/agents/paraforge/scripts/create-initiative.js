#!/usr/bin/env node

/**
 * Create an INITIATIVE-level Epic in PARA Project
 */

const https = require('https');

// Configuration
const JIRA_HOST = 'roulettecommunity.atlassian.net';
const JIRA_EMAIL = 'prakashmailid@gmail.com';
const JIRA_TOKEN = process.env.JIRA_API_TOKEN || process.argv[2];
const PROJECT_KEY = 'PARA';

if (!JIRA_TOKEN) {
    console.log('❌ Please provide Jira API token');
    console.log('Usage: node create-initiative.js YOUR_TOKEN');
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

async function createInitiative() {
    console.log('🚀 Creating INITIATIVE-level Epic for PARA Project');
    console.log('================================================\n');

    try {
        // Test authentication
        const user = await makeRequest('/rest/api/3/myself');
        console.log(`✅ Authenticated as: ${user.displayName}\n`);

        // Create the INITIATIVE epic
        const initiative = {
            fields: {
                project: { key: PROJECT_KEY },
                summary: "INITIATIVE: AI-Orchestrated Project Management Platform",
                description: {
                    type: "doc",
                    version: 1,
                    content: [
                        {
                            type: "heading",
                            attrs: { level: 1 },
                            content: [{ type: "text", text: "Strategic Initiative" }]
                        },
                        {
                            type: "paragraph",
                            content: [
                                { 
                                    type: "text", 
                                    text: "Build a comprehensive AI-powered platform that revolutionizes project management through intelligent multi-agent orchestration, automated dependency analysis, and parallel task execution."
                                }
                            ]
                        },
                        {
                            type: "heading",
                            attrs: { level: 2 },
                            content: [{ type: "text", text: "Key Features" }]
                        },
                        {
                            type: "bulletList",
                            content: [
                                {
                                    type: "listItem",
                                    content: [{
                                        type: "paragraph",
                                        content: [{ type: "text", text: "FEATURE: Multi-Agent Intelligence System" }]
                                    }]
                                },
                                {
                                    type: "listItem",
                                    content: [{
                                        type: "paragraph",
                                        content: [{ type: "text", text: "FEATURE: Jira Deep Integration" }]
                                    }]
                                },
                                {
                                    type: "listItem",
                                    content: [{
                                        type: "paragraph",
                                        content: [{ type: "text", text: "FEATURE: Parallelization Engine" }]
                                    }]
                                },
                                {
                                    type: "listItem",
                                    content: [{
                                        type: "paragraph",
                                        content: [{ type: "text", text: "FEATURE: Consensus-Based Decision Making" }]
                                    }]
                                }
                            ]
                        },
                        {
                            type: "heading",
                            attrs: { level: 2 },
                            content: [{ type: "text", text: "Success Metrics" }]
                        },
                        {
                            type: "bulletList",
                            content: [
                                {
                                    type: "listItem",
                                    content: [{
                                        type: "paragraph",
                                        content: [{ type: "text", text: "90% reduction in project planning time" }]
                                    }]
                                },
                                {
                                    type: "listItem",
                                    content: [{
                                        type: "paragraph",
                                        content: [{ type: "text", text: "75% improvement in task parallelization" }]
                                    }]
                                },
                                {
                                    type: "listItem",
                                    content: [{
                                        type: "paragraph",
                                        content: [{ type: "text", text: "10x faster dependency resolution" }]
                                    }]
                                }
                            ]
                        }
                    ]
                },
                issuetype: { id: "10000" }, // Epic
                labels: [
                    "INITIATIVE",
                    "SCOPE:XXL",
                    "PRIORITY:CRITICAL",
                    "DOMAIN:AI",
                    "DOMAIN:INTEGRATION",
                    "DOMAIN:API",
                    "TEAM:FULLSTACK",
                    "TEAM:DATA",
                    "PHASE:DISCOVERY",
                    "MILESTONE"
                ]
            }
        };

        console.log('📝 Creating INITIATIVE epic...');
        const createdInitiative = await makeRequest('/rest/api/3/issue', 'POST', initiative);
        console.log(`✅ Created: ${createdInitiative.key} - INITIATIVE: AI-Orchestrated Project Management Platform`);
        console.log(`   URL: https://${JIRA_HOST}/browse/${createdInitiative.key}\n`);

        // Now create some FEATURE-level epics under this initiative
        const features = [
            {
                summary: "FEATURE: Multi-Agent Intelligence System",
                description: "Build the core multi-agent system with specialized agents for different technical domains",
                labels: ["FEATURE", "SCOPE:XL", "DOMAIN:AI", "PRIORITY:HIGH", "TEAM:DATA"]
            },
            {
                summary: "FEATURE: Jira Deep Integration",
                description: "Complete bi-directional integration with Jira including real-time sync and automation",
                labels: ["FEATURE", "SCOPE:XL", "DOMAIN:INTEGRATION", "PRIORITY:HIGH", "TEAM:BACKEND"]
            },
            {
                summary: "FEATURE: Parallelization Engine",
                description: "Build the DAG-based parallel execution engine for optimal task scheduling",
                labels: ["FEATURE", "SCOPE:XL", "DOMAIN:PERFORMANCE", "PRIORITY:HIGH", "TEAM:BACKEND"]
            }
        ];

        console.log('📋 Creating FEATURE epics linked to INITIATIVE...\n');
        
        for (const feature of features) {
            const featureIssue = {
                fields: {
                    project: { key: PROJECT_KEY },
                    summary: feature.summary,
                    description: {
                        type: "doc",
                        version: 1,
                        content: [{
                            type: "paragraph",
                            content: [{ type: "text", text: feature.description }]
                        }]
                    },
                    issuetype: { id: "10000" }, // Epic
                    labels: feature.labels,
                    parent: { key: createdInitiative.key } // Link to INITIATIVE
                }
            };

            try {
                const created = await makeRequest('/rest/api/3/issue', 'POST', featureIssue);
                console.log(`✅ Created: ${created.key} - ${feature.summary}`);
            } catch (error) {
                // If parent linking fails, create without parent and use issue links instead
                delete featureIssue.fields.parent;
                const created = await makeRequest('/rest/api/3/issue', 'POST', featureIssue);
                console.log(`✅ Created: ${created.key} - ${feature.summary}`);
                
                // Create an "is part of" link
                try {
                    await makeRequest('/rest/api/3/issueLink', 'POST', {
                        type: { name: "Relates" },
                        inwardIssue: { key: createdInitiative.key },
                        outwardIssue: { key: created.key },
                        comment: {
                            body: {
                                type: "doc",
                                version: 1,
                                content: [{
                                    type: "paragraph",
                                    content: [{ type: "text", text: "Feature is part of Initiative" }]
                                }]
                            }
                        }
                    });
                    console.log(`   🔗 Linked to INITIATIVE`);
                } catch (linkError) {
                    console.log(`   ⚠️  Could not create link: ${linkError}`);
                }
            }
        }

        console.log('\n✨ INITIATIVE hierarchy created successfully!');
        console.log(`\n🔗 View your INITIATIVE at:`);
        console.log(`   https://${JIRA_HOST}/browse/${createdInitiative.key}`);
        
        console.log('\n📊 Hierarchy Structure:');
        console.log('   INITIATIVE: AI-Orchestrated Project Management Platform');
        console.log('      ├── FEATURE: Multi-Agent Intelligence System');
        console.log('      ├── FEATURE: Jira Deep Integration');
        console.log('      └── FEATURE: Parallelization Engine');
        
    } catch (error) {
        console.error('❌ Failed:', error);
    }
}

// Run
createInitiative();