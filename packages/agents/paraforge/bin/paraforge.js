#!/usr/bin/env node

/**
 * ParaForge CLI
 * Command-line interface for ParaForge - AI-powered project management
 */

const { Command } = require('commander');
const chalk = require('chalk');
const fs = require('fs').promises;
const path = require('path');
const { ParaForgeCore } = require('../dist');
const dotenv = require('dotenv');
const inquirer = require('inquirer');

// Load environment variables
dotenv.config();

const program = new Command();

// ASCII Art Banner
const banner = `
${chalk.cyan('╔═══════════════════════════════════════════╗')}
${chalk.cyan('║')}  ${chalk.bold.white('ParaForge')} - AI Project Management     ${chalk.cyan('║')}
${chalk.cyan('║')}  ${chalk.gray('Transform ideas into JIRA tickets')}      ${chalk.cyan('║')}
${chalk.cyan('╚═══════════════════════════════════════════╝')}
`;

// Helper function to initialize ParaForge
async function initializeParaForge(options = {}) {
  const config = {
    jira: {
      host: options.jiraHost || process.env.JIRA_HOST,
      email: options.jiraEmail || process.env.JIRA_EMAIL,
      apiToken: options.jiraToken || process.env.JIRA_API_TOKEN
    },
    ai: {
      openai: options.openaiKey || process.env.OPENAI_API_KEY,
      anthropic: options.anthropicKey || process.env.ANTHROPIC_API_KEY
    },
    verbose: options.verbose || false
  };

  if (!config.jira.host || !config.jira.email || !config.jira.apiToken) {
    console.error(chalk.red('❌ JIRA credentials not configured. Use "paraforge config" to set them up.'));
    process.exit(1);
  }

  const paraforge = new ParaForgeCore(config);
  await paraforge.initialize();
  return paraforge;
}

// Helper function to display results
function displayResults(result) {
  console.log(chalk.green('\n✅ Processing complete!\n'));
  
  if (result.project) {
    console.log(chalk.bold('Project:'), result.project.name || result.project.key);
  }
  
  if (result.epics && result.epics.length > 0) {
    console.log(chalk.bold(`\n📚 Epics created: ${result.epics.length}`));
    result.epics.forEach((epic, i) => {
      console.log(`  ${i + 1}. ${epic.key} - ${epic.summary}`);
    });
  }
  
  if (result.stories && result.stories.length > 0) {
    console.log(chalk.bold(`\n📝 Stories created: ${result.stories.length}`));
    result.stories.forEach((story, i) => {
      console.log(`  ${i + 1}. ${story.key} - ${story.summary}`);
    });
  }
  
  if (result.tasks && result.tasks.length > 0) {
    console.log(chalk.bold(`\n✔️  Tasks created: ${result.tasks.length}`));
  }
  
  if (result.metadata) {
    console.log(chalk.bold('\n📊 Project Metadata:'));
    console.log(`  Total Estimate: ${result.metadata.totalEstimate || 'N/A'}`);
    console.log(`  Team Size: ${result.metadata.teamSize || 'N/A'}`);
    console.log(`  Duration: ${result.metadata.duration || 'N/A'}`);
  }
}

program
  .name('paraforge')
  .description('AI-powered project management tool for JIRA')
  .version('1.0.0')
  .option('-v, --verbose', 'Enable verbose output')
  .option('--no-color', 'Disable colored output');

// Process command - Main workflow
program
  .command('process')
  .description('Process an idea or requirements into JIRA tickets')
  .option('-f, --file <path>', 'Path to requirements file')
  .option('-i, --idea <text>', 'Idea description')
  .option('-p, --project <key>', 'JIRA project key')
  .option('--dry-run', 'Preview without creating tickets')
  .option('--parallel', 'Enable parallel processing')
  .option('--optimize', 'Optimize task scheduling')
  .action(async (options) => {
    console.log(banner);
    
    try {
      let input;
      
      // Get input from file or command line
      if (options.file) {
        console.log(chalk.blue(`📄 Reading requirements from ${options.file}...`));
        input = await fs.readFile(options.file, 'utf-8');
      } else if (options.idea) {
        input = options.idea;
      } else {
        // Interactive mode
        const answers = await inquirer.prompt([
          {
            type: 'editor',
            name: 'idea',
            message: 'Describe your project idea or paste requirements:'
          }
        ]);
        input = answers.idea;
      }
      
      console.log(chalk.blue('🚀 Initializing ParaForge...'));
      const paraforge = await initializeParaForge(options);
      
      console.log(chalk.blue('🤖 Processing with AI agents...'));
      const idea = {
        title: options.project || 'New Project',
        description: input,
        options: {
          dryRun: options.dryRun,
          parallel: options.parallel,
          optimize: options.optimize
        }
      };
      
      const result = await paraforge.processIdea(idea);
      
      if (options.dryRun) {
        console.log(chalk.yellow('\n⚠️  DRY RUN - No tickets were created\n'));
      }
      
      displayResults(result);
      
      // Save results to file
      const outputFile = `paraforge-output-${Date.now()}.json`;
      await fs.writeFile(outputFile, JSON.stringify(result, null, 2));
      console.log(chalk.green(`\n💾 Results saved to ${outputFile}`));
      
      await paraforge.shutdown();
    } catch (error) {
      console.error(chalk.red('❌ Error:'), error.message);
      if (options.verbose) {
        console.error(error.stack);
      }
      process.exit(1);
    }
  });

// Analyze command
program
  .command('analyze <file>')
  .description('Analyze requirements and generate project structure')
  .option('--format <type>', 'Output format (json|markdown|html)', 'json')
  .action(async (file, options) => {
    console.log(banner);
    
    try {
      console.log(chalk.blue(`📄 Analyzing ${file}...`));
      const requirements = await fs.readFile(file, 'utf-8');
      
      const paraforge = await initializeParaForge(options);
      const analysis = await paraforge.analyzeRequirements(requirements);
      
      console.log(chalk.green('\n✅ Analysis complete!\n'));
      
      // Display analysis based on format
      if (options.format === 'json') {
        console.log(JSON.stringify(analysis, null, 2));
      } else if (options.format === 'markdown') {
        // Convert to markdown
        console.log('# Project Analysis\n');
        analysis.epics.forEach(epic => {
          console.log(`## ${epic.title}\n`);
          console.log(`${epic.description}\n`);
          epic.stories.forEach(story => {
            console.log(`### ${story.title}\n`);
            console.log(`${story.description}\n`);
          });
        });
      }
      
      await paraforge.shutdown();
    } catch (error) {
      console.error(chalk.red('❌ Error:'), error.message);
      process.exit(1);
    }
  });

// Create command
program
  .command('create <type>')
  .description('Create JIRA issues (epic|story|task)')
  .option('-t, --title <title>', 'Issue title')
  .option('-d, --description <desc>', 'Issue description')
  .option('-p, --project <key>', 'JIRA project key')
  .option('--parent <key>', 'Parent issue key')
  .option('--priority <level>', 'Priority (highest|high|medium|low|lowest)')
  .option('--estimate <time>', 'Time estimate (e.g., 2h, 3d)')
  .action(async (type, options) => {
    try {
      const paraforge = await initializeParaForge(options);
      
      const issueData = {
        type: type.charAt(0).toUpperCase() + type.slice(1),
        summary: options.title || `New ${type}`,
        description: options.description || '',
        project: options.project || process.env.JIRA_PROJECT_KEY,
        parent: options.parent,
        priority: options.priority || 'medium',
        estimate: options.estimate
      };
      
      console.log(chalk.blue(`Creating ${type}...`));
      const result = await paraforge.createIssue(issueData);
      
      console.log(chalk.green(`✅ Created ${result.key}`));
      console.log(`View at: ${process.env.JIRA_HOST}/browse/${result.key}`);
      
      await paraforge.shutdown();
    } catch (error) {
      console.error(chalk.red('❌ Error:'), error.message);
      process.exit(1);
    }
  });

// Config command
program
  .command('config')
  .description('Configure ParaForge settings')
  .action(async () => {
    console.log(banner);
    console.log(chalk.blue('⚙️  ParaForge Configuration\n'));
    
    const answers = await inquirer.prompt([
      {
        type: 'input',
        name: 'jiraHost',
        message: 'JIRA Host (e.g., yourcompany.atlassian.net):',
        default: process.env.JIRA_HOST
      },
      {
        type: 'input',
        name: 'jiraEmail',
        message: 'JIRA Email:',
        default: process.env.JIRA_EMAIL
      },
      {
        type: 'password',
        name: 'jiraToken',
        message: 'JIRA API Token:',
        mask: '*'
      },
      {
        type: 'password',
        name: 'openaiKey',
        message: 'OpenAI API Key (optional):',
        mask: '*'
      },
      {
        type: 'password',
        name: 'anthropicKey',
        message: 'Anthropic API Key (optional):',
        mask: '*'
      }
    ]);
    
    // Save to .env file
    const envContent = `
# ParaForge Configuration
JIRA_HOST=${answers.jiraHost}
JIRA_EMAIL=${answers.jiraEmail}
JIRA_API_TOKEN=${answers.jiraToken}
OPENAI_API_KEY=${answers.openaiKey || ''}
ANTHROPIC_API_KEY=${answers.anthropicKey || ''}
`;
    
    await fs.writeFile('.env', envContent);
    console.log(chalk.green('\n✅ Configuration saved to .env file'));
  });

// Test command
program
  .command('test')
  .description('Test JIRA connection')
  .action(async () => {
    try {
      console.log(chalk.blue('🔌 Testing JIRA connection...'));
      const paraforge = await initializeParaForge();
      
      const result = await paraforge.testConnection();
      
      if (result.success) {
        console.log(chalk.green('✅ Connection successful!'));
        console.log(`Connected to: ${result.serverInfo.baseUrl}`);
        console.log(`Version: ${result.serverInfo.version}`);
      } else {
        console.log(chalk.red('❌ Connection failed'));
      }
      
      await paraforge.shutdown();
    } catch (error) {
      console.error(chalk.red('❌ Error:'), error.message);
      process.exit(1);
    }
  });

// Workflow command
program
  .command('workflow <action>')
  .description('Execute predefined workflows (sprint|release|retrospective)')
  .option('-p, --project <key>', 'JIRA project key')
  .option('--sprint <name>', 'Sprint name')
  .option('--duration <weeks>', 'Sprint duration in weeks', '2')
  .action(async (action, options) => {
    try {
      console.log(chalk.blue(`🔄 Executing ${action} workflow...`));
      const paraforge = await initializeParaForge(options);
      
      let result;
      switch (action) {
        case 'sprint':
          result = await paraforge.createSprint({
            project: options.project,
            name: options.sprint || `Sprint ${Date.now()}`,
            duration: parseInt(options.duration)
          });
          break;
        case 'release':
          result = await paraforge.planRelease({
            project: options.project,
            version: options.version
          });
          break;
        case 'retrospective':
          result = await paraforge.runRetrospective({
            project: options.project,
            sprint: options.sprint
          });
          break;
        default:
          console.log(chalk.red(`Unknown workflow: ${action}`));
          process.exit(1);
      }
      
      console.log(chalk.green('✅ Workflow completed successfully'));
      console.log(result);
      
      await paraforge.shutdown();
    } catch (error) {
      console.error(chalk.red('❌ Error:'), error.message);
      process.exit(1);
    }
  });

// Interactive mode
program
  .command('interactive')
  .alias('i')
  .description('Start interactive mode')
  .action(async () => {
    console.log(banner);
    console.log(chalk.blue('🎮 Interactive Mode\n'));
    
    const paraforge = await initializeParaForge();
    
    while (true) {
      const { action } = await inquirer.prompt([
        {
          type: 'list',
          name: 'action',
          message: 'What would you like to do?',
          choices: [
            'Process an idea',
            'Analyze requirements',
            'Create JIRA issue',
            'Test connection',
            'View statistics',
            'Exit'
          ]
        }
      ]);
      
      if (action === 'Exit') {
        break;
      }
      
      try {
        switch (action) {
          case 'Process an idea':
            const { idea } = await inquirer.prompt([
              {
                type: 'editor',
                name: 'idea',
                message: 'Describe your idea:'
              }
            ]);
            const result = await paraforge.processIdea({ description: idea });
            displayResults(result);
            break;
            
          case 'Test connection':
            const test = await paraforge.testConnection();
            console.log(test.success ? 
              chalk.green('✅ Connection successful') : 
              chalk.red('❌ Connection failed'));
            break;
            
          // Add more cases as needed
        }
      } catch (error) {
        console.error(chalk.red('Error:'), error.message);
      }
      
      console.log(''); // Empty line for spacing
    }
    
    await paraforge.shutdown();
    console.log(chalk.blue('👋 Goodbye!'));
  });

// Statistics command
program
  .command('stats')
  .description('Show project statistics')
  .option('-p, --project <key>', 'JIRA project key')
  .action(async (options) => {
    try {
      const paraforge = await initializeParaForge(options);
      const stats = await paraforge.getStatistics(options.project);
      
      console.log(chalk.bold('\n📊 Project Statistics\n'));
      console.log(`Total Epics: ${stats.epics}`);
      console.log(`Total Stories: ${stats.stories}`);
      console.log(`Total Tasks: ${stats.tasks}`);
      console.log(`Completed: ${stats.completed}`);
      console.log(`In Progress: ${stats.inProgress}`);
      console.log(`To Do: ${stats.todo}`);
      
      await paraforge.shutdown();
    } catch (error) {
      console.error(chalk.red('❌ Error:'), error.message);
      process.exit(1);
    }
  });

// Parse arguments
program.parse(process.argv);

// Show help if no command provided
if (!process.argv.slice(2).length) {
  console.log(banner);
  program.outputHelp();
}

// Handle uncaught errors
process.on('unhandledRejection', (error) => {
  console.error(chalk.red('\n❌ Unexpected error:'), error.message);
  process.exit(1);
});