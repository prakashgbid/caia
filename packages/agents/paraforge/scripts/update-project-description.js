#!/usr/bin/env node

/**
 * Update Project Description using jira-connect agent
 * This script now uses the global MCP-based jira-connect agent
 */

const jiraConnect = require(`${process.env.HOME}/.claude/agents/jira-connect/index.js`);

const ISSUE_KEY = 'PARA-35';

// Comprehensive description for the PROJECT epic
const projectDescription = `
# 🚀 ParaForge - AI-Powered Requirements Gathering & Jira Modeling Framework

## Executive Summary
ParaForge is an intelligent framework that transforms user ideas into comprehensive, development-ready Jira tickets through AI-powered requirements gathering and multi-agent orchestration. It ensures developers have ALL information needed before starting work, eliminating interruptions and blockers during sprints.

---

## 🎯 Core Value Proposition
**Zero Questions During Development**: By conducting exhaustive requirements gathering upfront through AI agents, every ticket contains complete specifications, designs, test cases, and implementation details.

---

## 📋 How ParaForge Works

### 1️⃣ Initial Request
User provides their project idea to Claude Code (CC) with any level of detail

### 2️⃣ Product Owner Interview
CC invokes specialized Product Owner (PO) Agent who conducts comprehensive discovery:
- Business objectives and success metrics
- User personas and use cases
- Feature requirements and priorities
- Technical constraints and preferences
- Integration requirements
- Deployment and scaling needs
- Security and compliance requirements
- Budget and timeline constraints

### 3️⃣ PROJECT Epic Creation
PO creates master PROJECT epic containing:
- Complete refined scope
- Business justification
- Success criteria
- Risk assessment
- Stakeholder map

### 4️⃣ INITIATIVE Breakdown
PO decomposes PROJECT into strategic INITIATIVEs (6-12 month objectives)

### 5️⃣ Parallel Feature Development
For each INITIATIVE, spawn new CC+PO instance to create FEATURE epics (3-6 month capabilities)

### 6️⃣ Story Generation
For each FEATURE, spawn new CC+PO instance to create user STORIES (3-5 day deliverables)

### 7️⃣ Task Decomposition
For each STORY, spawn new CC+PO instance to create technical TASKS with TO-DO checklists

### 8️⃣ Multi-Agent Enrichment
At every level, specialized agents contribute:
- **Solution Architect**: Technical specifications, architecture diagrams, API contracts
- **UX/UI Designer**: Wireframes, mockups, user flows, design systems
- **QA Engineer**: Test scenarios, acceptance criteria, edge cases
- **SME Agents**: Domain-specific requirements and constraints

---

## 🏗️ Jira Hierarchy Structure

\`\`\`
PROJECT (12+ months) - Complete project scope
  ├── INITIATIVE (6-12 months) - Strategic business objectives
  │   ├── FEATURE (3-6 months) - Major business capabilities
  │   │   ├── EPIC (1-3 months) - Significant functionality
  │   │   │   ├── STORY (3-5 days) - User-facing value
  │   │   │   │   ├── TASK (1-2 days) - Technical implementation
  │   │   │   │   │   └── TO-DOS (hours) - Checklist items
\`\`\`

---

## 🎨 Ticket Content Standards

### Every Ticket Contains:
✅ **Requirements**: Complete functional and non-functional requirements
✅ **Architecture**: Technical design, data models, API specifications
✅ **Design**: UI mockups, interaction patterns, responsive layouts
✅ **Testing**: Test cases, scenarios, edge cases, performance criteria
✅ **Dependencies**: External services, libraries, other tickets
✅ **Acceptance Criteria**: Definition of done, validation steps
✅ **Implementation Guide**: Step-by-step approach, code examples
✅ **TO-DO Checklist**: Granular tasks with time estimates

---

## 🔧 Technical Architecture

### Core Components:
1. **CC → PO Invocation Logic**: Reliable agent triggering mechanism
2. **PO Thinking Engine**: Comprehensive questioning framework
3. **Jira API Integration**: Robust ticket creation and management
4. **Multi-Terminal Orchestration**: Parallel CC instance spawning
5. **Agent Framework**: Extensible multi-agent system
6. **Template System**: Consistent ticket formatting
7. **Validation Engine**: Completeness and quality checks

### Technology Stack:
- **Runtime**: Node.js for orchestration
- **AI**: Claude API for agent intelligence
- **Integration**: Jira REST API v3
- **Parallelization**: Worker threads / child processes
- **Storage**: JSON for templates and configurations

---

## 📊 Success Metrics

### Primary KPIs:
- **Requirements Completeness**: 100% of questions answered pre-development
- **Development Interruptions**: 0 questions during sprint execution
- **Ticket Quality Score**: 95%+ marked "development-ready"
- **Time to Market**: 90% reduction in requirements phase
- **Parallel Efficiency**: 10x faster than sequential processing

### Quality Metrics:
- **Requirement Coverage**: All user stories traced to business objectives
- **Design Completeness**: Every UI component specified
- **Test Coverage**: 100% of acceptance criteria have test cases
- **Documentation Quality**: Self-contained tickets requiring no external docs

---

## 🚀 Implementation Roadmap

### Phase 1: Core Framework (Weeks 1-4)
- [ ] Basic PO Agent implementation
- [ ] CC → PO invocation mechanism
- [ ] Simple Jira ticket creation
- [ ] PROJECT and INITIATIVE creation

### Phase 2: Intelligent Gathering (Weeks 5-8)
- [ ] PO Thinking Engine with comprehensive questions
- [ ] Interview state management
- [ ] Template system for all hierarchy levels
- [ ] Validation and completeness checking

### Phase 3: Multi-Agent System (Weeks 9-12)
- [ ] Solution Architect Agent
- [ ] UX/UI Designer Agent
- [ ] QA Test Engineer Agent
- [ ] Agent collaboration protocol

### Phase 4: Orchestration Engine (Weeks 13-16)
- [ ] Multi-terminal CC spawning
- [ ] Parallel execution framework
- [ ] State synchronization
- [ ] Progress monitoring

### Phase 5: Production Hardening (Weeks 17-20)
- [ ] Error handling and recovery
- [ ] Performance optimization
- [ ] SME agent plugin system
- [ ] Enterprise features

---

## 💡 Key Innovations

### 1. **Exhaustive Upfront Discovery**
Unlike traditional requirements gathering, ParaForge uses AI to ask EVERY relevant question before development begins.

### 2. **Multi-Agent Collaboration**
Different specialist agents provide their expertise simultaneously, ensuring comprehensive coverage.

### 3. **Hierarchical Parallelization**
Recursive spawning of CC instances enables massive parallelization while maintaining context.

### 4. **Template-Driven Consistency**
Standardized templates ensure no critical information is ever missed.

### 5. **Zero-Interruption Development**
Complete elimination of mid-sprint questions through exhaustive preparation.

---

## 🎯 Target Users

### Primary:
- **Product Managers**: Rapid idea-to-backlog transformation
- **Technical Leads**: Comprehensive technical specifications
- **Startup Founders**: Fast MVP development planning
- **Enterprise Teams**: Standardized requirements process

### Secondary:
- **Developers**: Clear, complete tickets
- **Designers**: Integrated design requirements
- **QA Engineers**: Comprehensive test coverage
- **Project Managers**: Predictable delivery

---

## 🔒 Governance & Standards

### Quality Gates:
- Requirement completeness validation
- Technical feasibility review
- Design consistency checks
- Test coverage verification

### Compliance:
- GDPR data handling
- SOC2 security standards
- Accessibility guidelines
- Industry best practices

---

## 📚 References & Resources

### Documentation:
- PROJECT-SCOPE.md - Authoritative scope definition
- TODO-IMPLEMENTATION.md - Complete implementation checklist
- JIRA-LABELING-STRATEGY.md - Hierarchy organization
- README.md - Project overview

### External:
- Jira REST API v3 Documentation
- Claude API Documentation
- Agile/Scrum best practices
- Requirements engineering standards

---

## 🤝 Contact & Support

**Project Owner**: Product Owner Agent (via Claude Code)
**Technical Lead**: Solution Architect Agent
**Repository**: /Users/MAC/Documents/projects/paraforge
**Jira Project**: https://roulettecommunity.atlassian.net/jira/software/c/projects/PARA

---

*This PROJECT epic serves as the master context for all ParaForge development. Every CC instance working on this project should reference this description to understand the complete scope, approach, and standards.*

**Last Updated**: ${new Date().toISOString()}
`;

async function updateProjectDescription() {
    try {
        console.log(`Updating ${ISSUE_KEY} with comprehensive description using jira-connect...`);
        
        // Initialize jira-connect if needed
        await jiraConnect.initialize();
        
        // Update issue using MCP-based agent
        const result = await jiraConnect.updateIssue(ISSUE_KEY, {
            description: projectDescription
        });
        
        console.log(`✅ Successfully updated ${ISSUE_KEY} via jira-connect agent`);
        console.log(`View at: https://roulettecommunity.atlassian.net/browse/${ISSUE_KEY}`);
        
        // Shutdown cleanly
        await jiraConnect.shutdown();
        
    } catch (error) {
        console.error('Error updating PROJECT epic:', error.message);
        await jiraConnect.shutdown();
        process.exit(1);
    }
}

// Run the update
updateProjectDescription();