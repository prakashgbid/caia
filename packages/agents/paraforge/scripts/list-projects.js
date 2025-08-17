#!/usr/bin/env node

const https = require('https');

const JIRA_HOST = 'roulettecommunity.atlassian.net';
const JIRA_EMAIL = 'prakashmailid@gmail.com';
const JIRA_TOKEN = process.argv[2];

if (!JIRA_TOKEN) {
    console.log('Usage: node list-projects.js YOUR_TOKEN');
    process.exit(1);
}

const auth = Buffer.from(`${JIRA_EMAIL}:${JIRA_TOKEN}`).toString('base64');

const options = {
    hostname: JIRA_HOST,
    path: '/rest/api/3/project',
    method: 'GET',
    headers: {
        'Authorization': `Basic ${auth}`,
        'Accept': 'application/json'
    }
};

const req = https.request(options, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
        try {
            const projects = JSON.parse(data);
            console.log('\nAvailable Jira Projects:');
            console.log('========================');
            if (Array.isArray(projects)) {
                projects.forEach(p => {
                    console.log(`\nProject Key: ${p.key}`);
                    console.log(`Name: ${p.name}`);
                    console.log(`ID: ${p.id}`);
                    console.log(`URL: https://${JIRA_HOST}/browse/${p.key}`);
                });
            } else {
                console.log('Response:', data);
            }
        } catch (e) {
            console.log('Error:', e);
            console.log('Response:', data);
        }
    });
});

req.on('error', (e) => {
    console.error(`Problem with request: ${e.message}`);
});

req.end();