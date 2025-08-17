#!/usr/bin/env node

const https = require('https');

const JIRA_HOST = 'roulettecommunity.atlassian.net';
const JIRA_EMAIL = 'prakashmailid@gmail.com';
const JIRA_TOKEN = process.argv[2];

if (!JIRA_TOKEN) {
    console.log('Usage: node create-para-project.js YOUR_TOKEN');
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
                        resolve(responseData ? JSON.parse(responseData) : {});
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

async function createProject() {
    console.log('Creating PARA project for ParaForge...\n');
    
    const projectData = {
        key: 'PARA',
        name: 'ParaForge',
        description: 'AI-Powered Requirements Gathering & Jira Modeling Framework',
        projectTypeKey: 'software',
        leadAccountId: null, // Will be set to current user
        assigneeType: 'UNASSIGNED'
    };

    try {
        // First, get current user to set as lead
        const user = await makeRequest('/rest/api/3/myself');
        console.log(`Authenticated as: ${user.displayName}\n`);
        projectData.leadAccountId = user.accountId;
        
        // Create the project
        console.log('Creating project...');
        const project = await makeRequest('/rest/api/3/project', 'POST', projectData);
        
        console.log(`✅ Project created successfully!`);
        console.log(`   Key: ${project.key}`);
        console.log(`   Name: ${project.name}`);
        console.log(`   URL: https://${JIRA_HOST}/browse/${project.key}`);
        
        return project;
    } catch (error) {
        console.error('❌ Failed to create project:', error);
        
        // If project exists, try to get it
        if (error.includes('already exists')) {
            console.log('\n🔍 Checking if PARA project already exists...');
            try {
                const existingProject = await makeRequest('/rest/api/3/project/PARA');
                console.log(`✅ Found existing project: ${existingProject.key}`);
                return existingProject;
            } catch (e) {
                console.log('Could not find existing project');
            }
        }
    }
}

// Run
createProject();