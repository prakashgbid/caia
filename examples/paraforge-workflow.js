/**
 * ParaForge End-to-End Workflow Example
 * Demonstrates the complete flow: idea → requirements → JIRA tickets
 */

const { ParaForgeCore } = require('../packages/agents/paraforge/dist');
const chalk = require('chalk');
const fs = require('fs').promises;
const path = require('path');

// Load environment variables
require('dotenv').config();

// Sample project ideas for demonstration
const sampleIdeas = {
  ecommerce: {
    title: 'Modern E-commerce Platform',
    description: `
      Build a comprehensive e-commerce platform with the following features:
      
      Core Features:
      - User registration and authentication
      - Product catalog with search and filtering
      - Shopping cart and wishlist
      - Secure payment processing
      - Order management and tracking
      - Inventory management
      - Admin dashboard
      
      Additional Requirements:
      - Mobile-responsive design
      - SEO optimization
      - Multi-language support
      - Email notifications
      - Analytics integration
      - Social media integration
      
      Technical Constraints:
      - Must be built with React and Node.js
      - PostgreSQL database
      - AWS hosting
      - 99.9% uptime requirement
      - GDPR compliance
    `,
    goals: [
      'Launch MVP within 3 months',
      'Support 10,000 concurrent users',
      'Achieve 2-second page load times',
      'Implement robust security measures',
      'Enable easy third-party integrations'
    ],
    constraints: {
      timeline: '3 months',
      budget: '$150,000',
      team: '8 developers (2 frontend, 3 backend, 1 DevOps, 1 QA, 1 PM)',
      technologies: ['React', 'Node.js', 'PostgreSQL', 'AWS', 'Stripe']
    }
  },
  
  socialMedia: {
    title: 'Social Media Analytics Dashboard',
    description: `
      Create a comprehensive social media analytics dashboard that helps businesses
      track their social media performance across multiple platforms.
      
      Features:
      - Multi-platform integration (Facebook, Twitter, Instagram, LinkedIn)
      - Real-time analytics and reporting
      - Competitor analysis
      - Content scheduling
      - Automated insights and recommendations
      - Custom dashboard creation
      - Team collaboration tools
      - White-label solutions
      
      Target Users:
      - Digital marketing agencies
      - Small to medium businesses
      - Social media managers
      - Enterprise marketing teams
    `,
    goals: [
      'Integrate with 10+ social platforms',
      'Process 1M+ social media posts daily',
      'Provide real-time insights',
      'Enable team collaboration',
      'Offer white-label solutions'
    ],
    constraints: {
      timeline: '6 months',
      budget: '$300,000',
      team: '12 developers',
      technologies: ['Vue.js', 'Python', 'MongoDB', 'Redis', 'Docker']
    }
  },
  
  healthTech: {
    title: 'Telemedicine Platform',
    description: `
      Develop a secure telemedicine platform connecting patients with healthcare providers.
      
      Core Features:
      - Video consultations
      - Appointment scheduling
      - Electronic health records (EHR)
      - Prescription management
      - Payment processing
      - Insurance integration
      - Mobile app for patients
      - Web portal for doctors
      
      Compliance Requirements:
      - HIPAA compliance
      - SOC 2 Type II
      - State licensing verification
      - Prescription regulations
      
      Technical Requirements:
      - End-to-end encryption
      - 24/7 availability
      - FHIR standard integration
      - Audit logging
    `,
    goals: [
      'Launch in 5 states initially',
      'Support 1000+ healthcare providers',
      'Process 10,000+ consultations monthly',
      'Achieve HIPAA compliance',
      'Integrate with major EHR systems'
    ],
    constraints: {
      timeline: '12 months',
      budget: '$500,000',
      team: '15 developers + compliance team',
      technologies: ['React Native', 'Node.js', 'PostgreSQL', 'WebRTC', 'AWS']
    }
  }
};

// Configuration for the workflow
const config = {
  jira: {
    host: process.env.JIRA_HOST,
    email: process.env.JIRA_EMAIL,
    apiToken: process.env.JIRA_API_TOKEN,
    projectKey: process.env.JIRA_PROJECT_KEY || 'DEMO'
  },
  ai: {
    openai: process.env.OPENAI_API_KEY,
    anthropic: process.env.ANTHROPIC_API_KEY
  },
  options: {
    enableLearning: true,
    optimizeParallel: true,
    generateDocumentation: true,
    enableMetrics: true
  }
};

/**
 * Display workflow progress
 */
function showProgress(step, message, status = 'info') {
  const icons = {
    info: '🔄',
    success: '✅',
    error: '❌',
    warning: '⚠️'
  };
  
  const colors = {
    info: chalk.blue,
    success: chalk.green,
    error: chalk.red,
    warning: chalk.yellow
  };
  
  console.log(`\n${icons[status]} ${colors[status](`Step ${step}:`)} ${message}`);
}

/**
 * Display results in a formatted way
 */
function displayResults(results) {
  console.log(chalk.bold('\n\n=== WORKFLOW RESULTS ===\n'));
  
  if (results.project) {
    console.log(chalk.bold('🏢 Project Information:'));
    console.log(`  Name: ${results.project.name}`);
    console.log(`  Key: ${results.project.key}`);
    console.log(`  Description: ${results.project.description}`);
  }
  
  if (results.analysis) {
    console.log(chalk.bold('\n🔍 Analysis Summary:'));
    console.log(`  Total Epics: ${results.analysis.epics?.length || 0}`);
    console.log(`  Total Stories: ${results.analysis.stories?.length || 0}`);
    console.log(`  Total Tasks: ${results.analysis.tasks?.length || 0}`);
    console.log(`  Estimated Duration: ${results.analysis.metadata?.estimatedDuration || 'N/A'}`);
    console.log(`  Team Size: ${results.analysis.metadata?.teamSize || 'N/A'}`);
  }
  
  if (results.created) {
    console.log(chalk.bold('\n🎆 JIRA Issues Created:'));
    
    if (results.created.epics?.length > 0) {
      console.log(chalk.bold('\n  Epics:'));
      results.created.epics.forEach((epic, i) => {
        console.log(`    ${i + 1}. ${epic.key} - ${epic.summary}`);
      });
    }
    
    if (results.created.stories?.length > 0) {
      console.log(chalk.bold('\n  Stories:'));
      results.created.stories.forEach((story, i) => {
        console.log(`    ${i + 1}. ${story.key} - ${story.summary}`);
      });
    }
    
    if (results.created.tasks?.length > 0) {
      console.log(chalk.bold('\n  Tasks:'));
      results.created.tasks.slice(0, 10).forEach((task, i) => {
        console.log(`    ${i + 1}. ${task.key} - ${task.summary}`);
      });
      if (results.created.tasks.length > 10) {
        console.log(`    ... and ${results.created.tasks.length - 10} more tasks`);
      }
    }
  }
  
  if (results.optimization) {
    console.log(chalk.bold('\n⚡ Optimization Results:'));
    console.log(`  Parallel Groups: ${results.optimization.parallelGroups?.length || 0}`);
    console.log(`  Critical Path: ${results.optimization.criticalPath?.length || 0} tasks`);
    console.log(`  Total Duration: ${results.optimization.totalDuration || 'N/A'}`);
    console.log(`  Efficiency Gain: ${results.optimization.efficiencyGain || 'N/A'}`);
  }
  
  if (results.metrics) {
    console.log(chalk.bold('\n📊 Performance Metrics:'));
    console.log(`  Processing Time: ${results.metrics.processingTime}ms`);
    console.log(`  AI Analysis Time: ${results.metrics.aiAnalysisTime}ms`);
    console.log(`  JIRA Creation Time: ${results.metrics.jiraCreationTime}ms`);
    console.log(`  Total Issues Created: ${results.metrics.totalIssuesCreated}`);
  }
}

/**
 * Run the complete ParaForge workflow
 */
async function runWorkflow(ideaKey = 'ecommerce', options = {}) {
  const startTime = Date.now();
  const results = {};
  
  try {
    // Step 1: Initialize ParaForge
    showProgress(1, 'Initializing ParaForge with AI agents...', 'info');
    
    const paraforge = new ParaForgeCore({
      ...config,
      ...options,
      verbose: true
    });
    
    await paraforge.initialize();
    showProgress(1, 'ParaForge initialized successfully', 'success');
    
    // Step 2: Load and validate idea
    showProgress(2, `Loading project idea: ${ideaKey}`, 'info');
    
    const idea = sampleIdeas[ideaKey];
    if (!idea) {
      throw new Error(`Unknown idea key: ${ideaKey}. Available: ${Object.keys(sampleIdeas).join(', ')}`);
    }
    
    showProgress(2, `Loaded "${idea.title}"`, 'success');
    
    // Step 3: Analyze requirements with AI
    showProgress(3, 'Analyzing requirements with product owner agent...', 'info');
    
    const analysisStartTime = Date.now();
    const analysis = await paraforge.analyzeRequirements(idea.description, {
      goals: idea.goals,
      constraints: idea.constraints,
      generateEstimates: true,
      optimizeStructure: true
    });
    
    results.analysis = analysis;
    results.metrics = {
      ...results.metrics,
      aiAnalysisTime: Date.now() - analysisStartTime
    };
    
    showProgress(3, `Analysis complete: ${analysis.epics?.length || 0} epics, ${analysis.stories?.length || 0} stories identified`, 'success');
    
    // Step 4: Optimize project structure
    showProgress(4, 'Optimizing task dependencies and scheduling...', 'info');
    
    const optimizer = paraforge.getOptimizer();
    const optimization = await optimizer.optimizeProject(analysis, {
      enableParallelExecution: true,
      minimizeCriticalPath: true,
      balanceTeamWorkload: true
    });
    
    results.optimization = optimization;
    showProgress(4, `Optimization complete: ${optimization.efficiencyGain || 'N/A'} efficiency gain`, 'success');
    
    // Step 5: Create JIRA project structure
    showProgress(5, 'Creating JIRA project and issue hierarchy...', 'info');
    
    const jiraStartTime = Date.now();
    
    // Create or get project
    const project = await paraforge.ensureProject({
      key: config.jira.projectKey,
      name: idea.title,
      description: idea.description,
      projectTypeKey: 'software',
      leadAccountId: null // Will use current user
    });
    
    results.project = project;
    
    // Create issue hierarchy
    const created = await paraforge.createIssueHierarchy(analysis, {
      projectKey: project.key,
      enableBatching: true,
      linkRelatedIssues: true,
      addLabels: true,
      setEstimates: true
    });
    
    results.created = created;
    results.metrics = {
      ...results.metrics,
      jiraCreationTime: Date.now() - jiraStartTime,
      totalIssuesCreated: (created.epics?.length || 0) + (created.stories?.length || 0) + (created.tasks?.length || 0)
    };
    
    showProgress(5, `JIRA structure created: ${results.metrics.totalIssuesCreated} issues`, 'success');
    
    // Step 6: Generate documentation
    if (config.options.generateDocumentation) {
      showProgress(6, 'Generating project documentation...', 'info');
      
      const documentation = await paraforge.generateDocumentation({
        project: results.project,
        analysis: results.analysis,
        optimization: results.optimization,
        created: results.created
      });
      
      // Save documentation
      const docPath = path.join(__dirname, `${ideaKey}-project-docs.md`);
      await fs.writeFile(docPath, documentation.markdown);
      
      results.documentation = {
        path: docPath,
        size: documentation.markdown.length
      };
      
      showProgress(6, `Documentation generated: ${docPath}`, 'success');
    }
    
    // Step 7: Run learning system
    if (config.options.enableLearning) {
      showProgress(7, 'Running learning system for future improvements...', 'info');
      
      const learningSystem = paraforge.getLearningSystem();
      await learningSystem.analyzeProjectStructure({
        idea,
        analysis: results.analysis,
        optimization: results.optimization,
        metrics: results.metrics
      });
      
      showProgress(7, 'Learning data captured for future improvements', 'success');
    }
    
    // Calculate final metrics
    results.metrics = {
      ...results.metrics,
      processingTime: Date.now() - startTime,
      workflowSteps: 7,
      successRate: 100
    };
    
    // Step 8: Display results
    showProgress(8, 'Workflow completed successfully!', 'success');
    displayResults(results);
    
    // Save results to file
    const resultsPath = path.join(__dirname, `paraforge-results-${ideaKey}-${Date.now()}.json`);
    await fs.writeFile(resultsPath, JSON.stringify(results, null, 2));
    console.log(chalk.blue(`\n💾 Complete results saved to: ${resultsPath}`));
    
    // Cleanup
    await paraforge.shutdown();
    
    return results;
    
  } catch (error) {
    console.error(chalk.red('\n❌ Workflow failed:'), error.message);
    if (config.verbose) {
      console.error(error.stack);
    }
    throw error;
  }
}

/**
 * Run multiple workflows in parallel for performance testing
 */
async function runParallelWorkflows() {
  console.log(chalk.bold('\n=== PARALLEL WORKFLOW EXECUTION ===\n'));
  
  const ideas = ['ecommerce', 'socialMedia', 'healthTech'];
  const startTime = Date.now();
  
  try {
    const results = await Promise.all(
      ideas.map(async (idea, index) => {
        console.log(chalk.blue(`Starting workflow ${index + 1}: ${idea}`));
        return await runWorkflow(idea, {
          jira: {
            ...config.jira,
            projectKey: `${config.jira.projectKey}${index + 1}`
          }
        });
      })
    );
    
    const totalTime = Date.now() - startTime;
    
    console.log(chalk.bold('\n=== PARALLEL EXECUTION SUMMARY ==='));
    console.log(`Total workflows: ${results.length}`);
    console.log(`Total execution time: ${totalTime}ms`);
    console.log(`Average time per workflow: ${Math.round(totalTime / results.length)}ms`);
    console.log(`Total issues created: ${results.reduce((sum, r) => sum + (r.metrics?.totalIssuesCreated || 0), 0)}`);
    
    return results;
    
  } catch (error) {
    console.error(chalk.red('Parallel execution failed:'), error.message);
    throw error;
  }
}

/**
 * Main execution function
 */
async function main() {
  console.log(chalk.cyan('\n╔══════════════════════════════════════════╗'));
  console.log(chalk.cyan('║') + chalk.bold.white('    ParaForge End-to-End Workflow Demo    ') + chalk.cyan('║'));
  console.log(chalk.cyan('║') + chalk.gray('     AI-Powered Project Management       ') + chalk.cyan('║'));
  console.log(chalk.cyan('╚══════════════════════════════════════════╝'));
  
  // Check if required configuration is present
  if (!config.jira.host || !config.jira.email || !config.jira.apiToken) {
    console.error(chalk.red('\n❌ Missing JIRA configuration. Please set:'));
    console.error('  - JIRA_HOST');
    console.error('  - JIRA_EMAIL');
    console.error('  - JIRA_API_TOKEN');
    process.exit(1);
  }
  
  const args = process.argv.slice(2);
  const command = args[0] || 'single';
  const ideaKey = args[1] || 'ecommerce';
  
  try {
    switch (command) {
      case 'single':
        console.log(chalk.blue(`\nRunning single workflow: ${ideaKey}`));
        await runWorkflow(ideaKey);
        break;
        
      case 'parallel':
        console.log(chalk.blue('\nRunning parallel workflows...'));
        await runParallelWorkflows();
        break;
        
      case 'list':
        console.log(chalk.blue('\nAvailable project ideas:'));
        Object.keys(sampleIdeas).forEach(key => {
          console.log(`  - ${key}: ${sampleIdeas[key].title}`);
        });
        break;
        
      default:
        console.log(chalk.blue('\nUsage:'));
        console.log('  node paraforge-workflow.js single [idea]    # Run single workflow');
        console.log('  node paraforge-workflow.js parallel         # Run parallel workflows');
        console.log('  node paraforge-workflow.js list             # List available ideas');
        console.log('\nAvailable ideas: ' + Object.keys(sampleIdeas).join(', '));
    }
    
    console.log(chalk.green('\n✅ All operations completed successfully!'));
    
  } catch (error) {
    console.error(chalk.red('\n❌ Execution failed:'), error.message);
    process.exit(1);
  }
}

// Export for use as module
module.exports = {
  runWorkflow,
  runParallelWorkflows,
  sampleIdeas,
  config
};

// Run if called directly
if (require.main === module) {
  main().catch(error => {
    console.error(chalk.red('Fatal error:'), error);
    process.exit(1);
  });
}