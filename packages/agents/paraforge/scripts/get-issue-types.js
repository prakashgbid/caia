#!/usr/bin/env node

const https = require('https');

const JIRA_HOST = 'roulettecommunity.atlassian.net';
const JIRA_EMAIL = 'prakashmailid@gmail.com';
const JIRA_TOKEN = process.argv[2];

if (!JIRA_TOKEN) {
    console.log('Usage: node get-issue-types.js YOUR_TOKEN');
    process.exit(1);
}

const auth = Buffer.from(`${JIRA_EMAIL}:${JIRA_TOKEN}`).toString('base64');

function makeRequest(path) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: JIRA_HOST,
            path: path,
            method: 'GET',
            headers: {
                'Authorization': `Basic ${auth}`,
                'Accept': 'application/json'
            }
        };

        https.get(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode === 200) {
                    resolve(JSON.parse(data));
                } else {
                    reject(`HTTP ${res.statusCode}: ${data}`);
                }
            });
        }).on('error', reject);
    });
}

async function getIssueTypes() {
    try {
        // Get project details including issue types
        const project = await makeRequest('/rest/api/3/project/PARA');
        console.log('Issue Types for PARA project:\n');
        
        project.issueTypes.forEach(type => {
            console.log(`ID: ${type.id}`);
            console.log(`Name: ${type.name}`);
            console.log(`Description: ${type.description}`);
            console.log(`Subtask: ${type.subtask}`);
            console.log('---');
        });

    } catch (error) {
        console.error('Error:', error);
    }
}

getIssueTypes();