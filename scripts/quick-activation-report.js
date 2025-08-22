#!/usr/bin/env node

/**
 * Quick Activation Report Generator
 * 
 * Generates a comprehensive report of agent activation status and next steps
 * without requiring the full activation system to run.
 */

const fs = require('fs');
const path = require('path');

class QuickReporter {
  constructor() {
    this.agentsDir = path.join(__dirname, '../packages/agents');
    this.report = {
      timestamp: new Date(),
      totalAgents: 0,
      implemented: 0,
      needsActivation: 0,
      agents: [],
      categories: {},
      recommendations: []
    };
  }

  async generateReport() {
    console.log('📊 CAIA Quick Activation Report');
    console.log('===============================\n');

    // Known agents from glob results
    const knownAgents = [
      'chatgpt-autonomous',
      'paraforge', 
      'training-system',
      'jira-connect',
      'product-owner',
      'solution-architect',
      'backend-engineer',
      'frontend-engineer'
    ];

    console.log(`🔍 Analyzing ${knownAgents.length} known agents...\n`);

    for (const agentName of knownAgents) {
      await this.analyzeAgent(agentName);
    }

    this.generateSummary();
    this.generateRecommendations();
    this.saveReport();
  }

  async analyzeAgent(agentName) {
    const agentPath = path.join(this.agentsDir, agentName);
    const agentInfo = {
      name: agentName,
      category: this.categorizeAgent(agentName),
      hasReadme: false,
      hasPackageJson: false,
      hasSrc: false,
      hasImplementation: false,
      implementationFiles: [],
      status: 'unknown'
    };

    try {
      // Check files
      agentInfo.hasReadme = fs.existsSync(path.join(agentPath, 'README.md'));
      agentInfo.hasPackageJson = fs.existsSync(path.join(agentPath, 'package.json'));
      
      const srcPath = path.join(agentPath, 'src');
      agentInfo.hasSrc = fs.existsSync(srcPath);
      
      if (agentInfo.hasSrc) {
        const srcFiles = fs.readdirSync(srcPath);
        agentInfo.implementationFiles = srcFiles.filter(f => f.endsWith('.ts'));
        agentInfo.hasImplementation = agentInfo.implementationFiles.some(f => 
          f !== 'types.ts' && f !== 'index.ts'
        );
      }

      // Determine status
      if (agentInfo.hasImplementation) {
        agentInfo.status = 'implemented';
        this.report.implemented++;
      } else if (agentInfo.hasReadme) {
        agentInfo.status = 'needs-activation';
        this.report.needsActivation++;
      } else {
        agentInfo.status = 'incomplete';
      }

      console.log(`${this.getStatusEmoji(agentInfo.status)} ${agentName} (${agentInfo.category})`);
      console.log(`   README: ${agentInfo.hasReadme ? '✅' : '❌'} | Package: ${agentInfo.hasPackageJson ? '✅' : '❌'} | Src: ${agentInfo.hasSrc ? '✅' : '❌'} | Implementation: ${agentInfo.hasImplementation ? '✅' : '❌'}`);
      
      if (agentInfo.implementationFiles.length > 0) {
        console.log(`   Files: ${agentInfo.implementationFiles.join(', ')}`);
      }
      console.log('');

    } catch (error) {
      agentInfo.status = 'error';
      agentInfo.error = error.message;
      console.log(`❌ ${agentName}: Error - ${error.message}\n`);
    }

    this.report.agents.push(agentInfo);
    this.report.totalAgents++;

    // Update category counts
    if (!this.report.categories[agentInfo.category]) {
      this.report.categories[agentInfo.category] = {
        total: 0,
        implemented: 0,
        needsActivation: 0
      };
    }
    
    this.report.categories[agentInfo.category].total++;
    if (agentInfo.status === 'implemented') {
      this.report.categories[agentInfo.category].implemented++;
    } else if (agentInfo.status === 'needs-activation') {
      this.report.categories[agentInfo.category].needsActivation++;
    }
  }

  categorizeAgent(agentName) {
    const name = agentName.toLowerCase();
    
    if (name.includes('connector') || name.includes('connect')) {
      return 'connector';
    } else if (name.includes('sme') || name.includes('expert')) {
      return 'sme';
    } else if (name.includes('engineer') || name.includes('owner') || name.includes('architect')) {
      return 'role';
    } else if (name.includes('processor') || name.includes('generator') || name.includes('analyzer')) {
      return 'processor';
    } else if (name.includes('guardian') || name.includes('monitor') || name.includes('security')) {
      return 'guardian';
    } else if (name.includes('autonomous') || name.includes('training')) {
      return 'system';
    } else if (name.includes('paraforge')) {
      return 'orchestrator';
    }
    
    return 'utility';
  }

  getStatusEmoji(status) {
    const emojis = {
      'implemented': '✅',
      'needs-activation': '🔨',
      'incomplete': '⚠️',
      'error': '❌',
      'unknown': '❓'
    };
    return emojis[status] || '❓';
  }

  generateSummary() {
    console.log('📊 Summary');
    console.log('----------');
    console.log(`Total Agents: ${this.report.totalAgents}`);
    console.log(`Already Implemented: ${this.report.implemented}`);
    console.log(`Need Activation: ${this.report.needsActivation}`);
    
    if (this.report.totalAgents > 0) {
      const implementedPct = Math.round((this.report.implemented / this.report.totalAgents) * 100);
      console.log(`Implementation Progress: ${implementedPct}%`);
    }

    console.log('\n📋 By Category:');
    Object.entries(this.report.categories).forEach(([category, stats]) => {
      const pct = stats.total > 0 ? Math.round((stats.implemented / stats.total) * 100) : 0;
      console.log(`  ${category}: ${stats.implemented}/${stats.total} implemented (${pct}%), ${stats.needsActivation} need activation`);
    });
  }

  generateRecommendations() {
    console.log('\n🎯 Recommendations');
    console.log('------------------');

    const recommendations = [];

    // Priority recommendations based on status
    const agentsNeedingActivation = this.report.agents.filter(a => a.status === 'needs-activation');
    
    if (agentsNeedingActivation.length > 0) {
      recommendations.push({
        priority: 'HIGH',
        action: 'Activate Pending Agents',
        description: `${agentsNeedingActivation.length} agents have documentation but no implementation`,
        command: 'node scripts/activate-all.js',
        agents: agentsNeedingActivation.map(a => a.name)
      });
    }

    // Core functionality recommendations
    const coreAgents = this.report.agents.filter(a => 
      ['jira-connect', 'product-owner', 'solution-architect'].includes(a.name)
    );
    
    const pendingCoreAgents = coreAgents.filter(a => a.status === 'needs-activation');
    if (pendingCoreAgents.length > 0) {
      recommendations.push({
        priority: 'CRITICAL',
        action: 'Activate Core Agents First',
        description: 'Core workflow agents need immediate activation',
        command: `node scripts/activate-agents.js --agents ${pendingCoreAgents.map(a => a.name).join(',')}`,
        agents: pendingCoreAgents.map(a => a.name)
      });
    }

    // Implementation refinement
    const implementedAgents = this.report.agents.filter(a => a.status === 'implemented');
    if (implementedAgents.length > 0) {
      recommendations.push({
        priority: 'MEDIUM',
        action: 'Refine Implementations',
        description: 'Implemented agents may have basic stubs that need proper logic',
        command: 'cd packages/agents/<agent> && npm run build && npm test',
        agents: implementedAgents.map(a => a.name)
      });
    }

    // Testing recommendations
    recommendations.push({
      priority: 'MEDIUM',
      action: 'Add Comprehensive Tests',
      description: 'All agents need thorough test coverage',
      command: 'node scripts/validate-agents.js',
      agents: this.report.agents.map(a => a.name)
    });

    // Integration recommendations
    recommendations.push({
      priority: 'HIGH',
      action: 'Register with CAIA Core',
      description: 'Agents need to be registered in the main orchestrator',
      command: 'Update packages/core/src/index.ts with agent imports',
      agents: ['all']
    });

    this.report.recommendations = recommendations;

    recommendations.forEach((rec, index) => {
      console.log(`\n${index + 1}. ${rec.action} (${rec.priority})`);
      console.log(`   ${rec.description}`);
      console.log(`   Command: ${rec.command}`);
      if (rec.agents.length <= 5) {
        console.log(`   Affects: ${rec.agents.join(', ')}`);
      } else {
        console.log(`   Affects: ${rec.agents.length} agents`);
      }
    });
  }

  saveReport() {
    const reportPath = path.join(__dirname, 'quick-activation-report.json');
    
    try {
      fs.writeFileSync(reportPath, JSON.stringify(this.report, null, 2));
      console.log(`\n📄 Detailed report saved to: ${reportPath}`);
    } catch (error) {
      console.error(`\n❌ Failed to save report: ${error.message}`);
    }

    // Also save markdown version
    const markdownPath = path.join(__dirname, 'QUICK-ACTIVATION-REPORT.md');
    const markdown = this.generateMarkdownReport();
    
    try {
      fs.writeFileSync(markdownPath, markdown);
      console.log(`📝 Markdown report saved to: ${markdownPath}`);
    } catch (error) {
      console.error(`❌ Failed to save markdown report: ${error.message}`);
    }
  }

  generateMarkdownReport() {
    return `# CAIA Agent Activation Status Report

Generated: ${this.report.timestamp.toISOString()}

## Summary

- **Total Agents**: ${this.report.totalAgents}
- **Already Implemented**: ${this.report.implemented}
- **Need Activation**: ${this.report.needsActivation}
- **Implementation Progress**: ${Math.round((this.report.implemented / this.report.totalAgents) * 100)}%

## Agents by Status

${this.report.agents.map(agent => `
### ${agent.name} (${agent.category})

- **Status**: ${agent.status}
- **README**: ${agent.hasReadme ? '✅' : '❌'}
- **Package**: ${agent.hasPackageJson ? '✅' : '❌'}
- **Source**: ${agent.hasSrc ? '✅' : '❌'}
- **Implementation**: ${agent.hasImplementation ? '✅' : '❌'}
${agent.implementationFiles.length > 0 ? `- **Files**: ${agent.implementationFiles.join(', ')}` : ''}
${agent.error ? `- **Error**: ${agent.error}` : ''}
`).join('')}

## Categories

${Object.entries(this.report.categories).map(([category, stats]) => `
- **${category}**: ${stats.implemented}/${stats.total} implemented (${Math.round((stats.implemented / stats.total) * 100)}%), ${stats.needsActivation} need activation
`).join('')}

## Recommendations

${this.report.recommendations.map((rec, index) => `
### ${index + 1}. ${rec.action} (${rec.priority})

${rec.description}

\`\`\`bash
${rec.command}
\`\`\`

**Affects**: ${rec.agents.length <= 5 ? rec.agents.join(', ') : `${rec.agents.length} agents`}
`).join('')}

---

*Generated by CAIA Quick Activation Reporter*
`;
  }
}

// Run if called directly
if (require.main === module) {
  const reporter = new QuickReporter();
  reporter.generateReport().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = QuickReporter;