/**
 * CAIA Todo App Example
 * Demonstrates how CAIA can build a complete application from a simple idea
 */

const { AgentOrchestrator, WorkflowEngine } = require('@caia/core');
const { ProductOwnerAgent } = require('@caia/agent-product-owner');
const { SolutionArchitectAgent } = require('@caia/agent-solution-architect');
const { FrontendEngineerAgent } = require('@caia/agent-frontend-engineer');
const { BackendEngineerAgent } = require('@caia/agent-backend-engineer');
const fs = require('fs').promises;
const path = require('path');
const chalk = require('chalk');

// Load environment variables
require('dotenv').config();

/**
 * Todo App Specification
 */
const todoAppIdea = {
  title: 'Modern Todo Application',
  description: `
    Build a modern, responsive todo application with the following features:
    
    Core Features:
    - User authentication (register/login/logout)
    - Create, read, update, delete todos
    - Mark todos as complete/incomplete
    - Filter todos by status (all, active, completed)
    - Search todos by title/description
    - Categories and tags for organization
    - Due dates and reminders
    - Priority levels (low, medium, high)
    
    Advanced Features:
    - Real-time synchronization
    - Offline support
    - Data export (JSON, CSV)
    - Dark/light theme toggle
    - Keyboard shortcuts
    - Drag and drop reordering
    - Bulk operations
    - Statistics and analytics
    
    Technical Requirements:
    - Modern, responsive UI
    - Progressive Web App (PWA)
    - Secure API with JWT authentication
    - Database persistence
    - Comprehensive testing
    - Docker containerization
    - CI/CD pipeline
  `,
  constraints: {
    timeline: '2 weeks',
    technology: {
      frontend: 'React with TypeScript',
      backend: 'Node.js with Express',
      database: 'PostgreSQL',
      styling: 'Tailwind CSS',
      testing: 'Jest and Cypress'
    },
    quality: 'Production-ready with 90%+ test coverage',
    deployment: 'Docker containers with CI/CD'
  }
};

/**
 * CAIA Todo App Builder
 */
class TodoAppBuilder {
  constructor() {
    this.outputDir = path.join(__dirname, 'generated-app');
    this.initializeAgents();
  }

  async initializeAgents() {
    console.log(chalk.blue('🤖 Initializing CAIA agents...'));
    
    // Agent configuration
    const agentConfig = {
      ai: {
        provider: 'anthropic',
        model: 'claude-3-sonnet-20240229',
        apiKey: process.env.ANTHROPIC_API_KEY,
        maxTokens: 4000
      },
      monitoring: {
        enableMetrics: true,
        logLevel: 'info'
      }
    };

    // Initialize specialized agents
    this.agents = {
      productOwner: new ProductOwnerAgent(agentConfig),
      solutionArchitect: new SolutionArchitectAgent(agentConfig),
      frontendEngineer: new FrontendEngineerAgent(agentConfig),
      backendEngineer: new BackendEngineerAgent(agentConfig)
    };

    // Initialize orchestrator
    this.orchestrator = new AgentOrchestrator({
      agents: this.agents,
      coordination: 'intelligent',
      enableLearning: true
    });

    // Initialize workflow engine
    this.workflowEngine = new WorkflowEngine({
      orchestrator: this.orchestrator,
      parallelExecution: true,
      optimizeSchedule: true
    });

    await this.orchestrator.initialize();
    console.log(chalk.green('✅ All agents initialized successfully'));
  }

  async buildApplication() {
    console.log(chalk.cyan('\n🚀 Starting Todo App generation with CAIA...\n'));
    
    try {
      // Step 1: Product Owner - Analyze requirements and create user stories
      const requirements = await this.analyzeRequirements();
      
      // Step 2: Solution Architect - Design system architecture
      const architecture = await this.designArchitecture(requirements);
      
      // Step 3: Generate code in parallel
      const codeGeneration = await this.generateCode(architecture);
      
      // Step 4: Create project structure and files
      await this.createProjectStructure(codeGeneration);
      
      // Step 5: Generate documentation and setup files
      await this.generateDocumentation({
        requirements,
        architecture,
        codeGeneration
      });
      
      console.log(chalk.green('\n🎉 Todo App generation completed successfully!'));
      console.log(chalk.blue(`📁 Generated application available at: ${this.outputDir}`));
      
      return {
        success: true,
        outputDir: this.outputDir,
        requirements,
        architecture,
        codeGeneration
      };
      
    } catch (error) {
      console.error(chalk.red('❌ Application generation failed:'), error.message);
      throw error;
    }
  }

  async analyzeRequirements() {
    console.log(chalk.blue('📋 Step 1: Analyzing requirements with Product Owner...'));
    
    const analysisResult = await this.agents.productOwner.analyzeRequirements({
      idea: todoAppIdea,
      generateUserStories: true,
      createAcceptanceCriteria: true,
      estimateEffort: true,
      prioritizeFeatures: true
    });
    
    console.log(chalk.green(`✅ Requirements analysis completed`));
    console.log(`   • ${analysisResult.userStories?.length || 0} user stories created`);
    console.log(`   • ${analysisResult.epics?.length || 0} epics identified`);
    console.log(`   • Estimated effort: ${analysisResult.estimation?.totalEffort || 'N/A'}`);
    
    return analysisResult;
  }

  async designArchitecture(requirements) {
    console.log(chalk.blue('🏗️  Step 2: Designing architecture with Solution Architect...'));
    
    const architectureResult = await this.agents.solutionArchitect.designArchitecture({
      requirements,
      constraints: todoAppIdea.constraints,
      patterns: ['MVC', 'REST', 'JWT', 'PWA'],
      generateDiagrams: true,
      includeInfrastructure: true,
      securityConsiderations: true
    });
    
    console.log(chalk.green('✅ Architecture design completed'));
    console.log(`   • ${architectureResult.components?.length || 0} components designed`);
    console.log(`   • ${architectureResult.apis?.length || 0} API endpoints defined`);
    console.log(`   • Database schema: ${architectureResult.database?.tables?.length || 0} tables`);
    
    return architectureResult;
  }

  async generateCode(architecture) {
    console.log(chalk.blue('💻 Step 3: Generating code with Frontend and Backend Engineers...'));
    
    // Parallel code generation
    const [frontendResult, backendResult] = await Promise.all([
      this.generateFrontendCode(architecture),
      this.generateBackendCode(architecture)
    ]);
    
    console.log(chalk.green('✅ Code generation completed'));
    console.log(`   • Frontend components: ${frontendResult.components?.length || 0}`);
    console.log(`   • Backend endpoints: ${backendResult.endpoints?.length || 0}`);
    console.log(`   • Database migrations: ${backendResult.migrations?.length || 0}`);
    
    return {
      frontend: frontendResult,
      backend: backendResult
    };
  }

  async generateFrontendCode(architecture) {
    return this.agents.frontendEngineer.generateApplication({
      architecture,
      framework: 'react',
      language: 'typescript',
      styling: 'tailwindcss',
      stateManagement: 'redux-toolkit',
      features: [
        'authentication',
        'todo-management',
        'filtering',
        'search',
        'categories',
        'themes',
        'pwa-support'
      ],
      generateTests: true,
      accessibility: true,
      responsive: true
    });
  }

  async generateBackendCode(architecture) {
    return this.agents.backendEngineer.generateApplication({
      architecture,
      framework: 'express',
      language: 'typescript',
      database: 'postgresql',
      authentication: 'jwt',
      features: [
        'user-management',
        'todo-crud',
        'search',
        'categories',
        'export',
        'real-time-sync'
      ],
      generateTests: true,
      documentation: true,
      containerization: true
    });
  }

  async createProjectStructure(codeGeneration) {
    console.log(chalk.blue('📁 Step 4: Creating project structure...'));
    
    // Ensure output directory exists
    await fs.mkdir(this.outputDir, { recursive: true });
    
    // Create frontend structure
    await this.createFrontendStructure(codeGeneration.frontend);
    
    // Create backend structure
    await this.createBackendStructure(codeGeneration.backend);
    
    // Create root files
    await this.createRootFiles();
    
    console.log(chalk.green('✅ Project structure created'));
  }

  async createFrontendStructure(frontendCode) {
    const frontendDir = path.join(this.outputDir, 'frontend');
    await fs.mkdir(frontendDir, { recursive: true });
    
    // Create package.json
    await fs.writeFile(
      path.join(frontendDir, 'package.json'),
      JSON.stringify(frontendCode.packageJson, null, 2)
    );
    
    // Create source files
    for (const component of frontendCode.components || []) {
      const componentPath = path.join(frontendDir, 'src', component.path);
      await fs.mkdir(path.dirname(componentPath), { recursive: true });
      await fs.writeFile(componentPath, component.code);
    }
    
    // Create styles
    if (frontendCode.styles) {
      const stylesDir = path.join(frontendDir, 'src/styles');
      await fs.mkdir(stylesDir, { recursive: true });
      
      for (const [filename, content] of Object.entries(frontendCode.styles)) {
        await fs.writeFile(path.join(stylesDir, filename), content);
      }
    }
    
    // Create configuration files
    for (const [filename, content] of Object.entries(frontendCode.configFiles || {})) {
      await fs.writeFile(path.join(frontendDir, filename), content);
    }
  }

  async createBackendStructure(backendCode) {
    const backendDir = path.join(this.outputDir, 'backend');
    await fs.mkdir(backendDir, { recursive: true });
    
    // Create package.json
    await fs.writeFile(
      path.join(backendDir, 'package.json'),
      JSON.stringify(backendCode.packageJson, null, 2)
    );
    
    // Create source files
    for (const file of backendCode.sourceFiles || []) {
      const filePath = path.join(backendDir, file.path);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, file.code);
    }
    
    // Create migrations
    if (backendCode.migrations) {
      const migrationsDir = path.join(backendDir, 'migrations');
      await fs.mkdir(migrationsDir, { recursive: true });
      
      for (const migration of backendCode.migrations) {
        await fs.writeFile(
          path.join(migrationsDir, migration.filename),
          migration.sql
        );
      }
    }
    
    // Create configuration files
    for (const [filename, content] of Object.entries(backendCode.configFiles || {})) {
      await fs.writeFile(path.join(backendDir, filename), content);
    }
  }

  async createRootFiles() {
    // Docker Compose
    const dockerCompose = `
version: '3.8'
services:
  frontend:
    build: ./frontend
    ports:
      - "3000:3000"
    environment:
      - REACT_APP_API_URL=http://localhost:3001
    depends_on:
      - backend
  
  backend:
    build: ./backend
    ports:
      - "3001:3001"
    environment:
      - DATABASE_URL=postgresql://user:password@postgres:5432/todoapp
      - JWT_SECRET=your-secret-key
    depends_on:
      - postgres
  
  postgres:
    image: postgres:15
    environment:
      - POSTGRES_DB=todoapp
      - POSTGRES_USER=user
      - POSTGRES_PASSWORD=password
    volumes:
      - postgres_data:/var/lib/postgresql/data
    ports:
      - "5432:5432"

volumes:
  postgres_data:
`;
    
    await fs.writeFile(path.join(this.outputDir, 'docker-compose.yml'), dockerCompose);
    
    // Root README
    const readme = `
# Todo App - Generated by CAIA

A modern, full-stack todo application generated entirely by AI agents.

## Features

- ✅ User authentication
- ✅ Todo CRUD operations
- ✅ Filtering and search
- ✅ Categories and tags
- ✅ Due dates and priorities
- ✅ Real-time synchronization
- ✅ PWA support
- ✅ Dark/light themes
- ✅ Responsive design

## Quick Start

\`\`\`bash
# Start with Docker Compose
docker-compose up -d

# Or run individually:
# Frontend
cd frontend && npm install && npm start

# Backend
cd backend && npm install && npm run dev
\`\`\`

## Architecture

- **Frontend**: React with TypeScript, Tailwind CSS
- **Backend**: Node.js with Express, TypeScript
- **Database**: PostgreSQL
- **Authentication**: JWT
- **Containerization**: Docker

## Generated by CAIA

This application was generated by the CAIA (Chief AI Agent) framework using:
- Product Owner Agent: Requirements analysis and user stories
- Solution Architect Agent: System design and architecture
- Frontend Engineer Agent: React application generation
- Backend Engineer Agent: API and database design

## Development

See individual README files in frontend/ and backend/ directories for detailed development instructions.
`;
    
    await fs.writeFile(path.join(this.outputDir, 'README.md'), readme);
    
    // Makefile for easy commands
    const makefile = `
.PHONY: install start stop test clean

install:
	cd frontend && npm install
	cd backend && npm install

start:
	docker-compose up -d

stop:
	docker-compose down

test:
	cd frontend && npm test
	cd backend && npm test

dev-frontend:
	cd frontend && npm start

dev-backend:
	cd backend && npm run dev

clean:
	docker-compose down -v
	docker system prune -f
`;
    
    await fs.writeFile(path.join(this.outputDir, 'Makefile'), makefile);
  }

  async generateDocumentation(buildResult) {
    console.log(chalk.blue('📚 Step 5: Generating documentation...'));
    
    const docsDir = path.join(this.outputDir, 'docs');
    await fs.mkdir(docsDir, { recursive: true });
    
    // Architecture documentation
    const archDoc = `
# System Architecture

## Overview

This todo application follows a modern, scalable architecture with clear separation of concerns.

## Components

### Frontend (React + TypeScript)
- **UI Components**: Reusable React components with TypeScript
- **State Management**: Redux Toolkit for predictable state updates
- **Styling**: Tailwind CSS for utility-first styling
- **PWA**: Service worker for offline functionality

### Backend (Node.js + Express)
- **API Layer**: RESTful API with Express.js
- **Authentication**: JWT-based authentication
- **Database**: PostgreSQL with TypeORM
- **Real-time**: WebSocket support for live updates

### Database Schema

\`\`\`sql
-- Users table
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Todos table
CREATE TABLE todos (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  title VARCHAR(255) NOT NULL,
  description TEXT,
  completed BOOLEAN DEFAULT FALSE,
  priority VARCHAR(10) DEFAULT 'medium',
  due_date TIMESTAMP,
  category_id INTEGER,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
\`\`\`

## Security

- JWT tokens for stateless authentication
- Password hashing with bcrypt
- Input validation and sanitization
- CORS configuration
- Rate limiting

## Deployment

The application is containerized with Docker and can be deployed using:
- Docker Compose for local development
- Kubernetes for production scaling
- CI/CD pipeline with GitHub Actions
`;
    
    await fs.writeFile(path.join(docsDir, 'ARCHITECTURE.md'), archDoc);
    
    // API documentation
    const apiDoc = `
# API Documentation

## Authentication

### POST /api/auth/register
Register a new user account.

### POST /api/auth/login
Authenticate user and receive JWT token.

### POST /api/auth/logout
Invalidate current session.

## Todos

### GET /api/todos
Retrieve all todos for authenticated user.

### POST /api/todos
Create a new todo item.

### PUT /api/todos/:id
Update existing todo item.

### DELETE /api/todos/:id
Delete todo item.

### GET /api/todos/search?q=:query
Search todos by title or description.

## Categories

### GET /api/categories
Retrieve all categories for user.

### POST /api/categories
Create new category.

### PUT /api/categories/:id
Update category.

### DELETE /api/categories/:id
Delete category.
`;
    
    await fs.writeFile(path.join(docsDir, 'API.md'), apiDoc);
    
    // Deployment guide
    const deployDoc = `
# Deployment Guide

## Local Development

1. Clone the repository
2. Run \`make install\` to install dependencies
3. Start services with \`make start\`
4. Access frontend at http://localhost:3000

## Production Deployment

### Docker

\`\`\`bash
# Build images
docker-compose -f docker-compose.prod.yml build

# Deploy
docker-compose -f docker-compose.prod.yml up -d
\`\`\`

### Kubernetes

\`\`\`bash
# Apply configurations
kubectl apply -f k8s/

# Check status
kubectl get pods
\`\`\`

## Environment Variables

### Backend
- \`DATABASE_URL\`: PostgreSQL connection string
- \`JWT_SECRET\`: Secret key for JWT signing
- \`PORT\`: Server port (default: 3001)

### Frontend
- \`REACT_APP_API_URL\`: Backend API URL
- \`REACT_APP_ENV\`: Environment (development/production)
`;
    
    await fs.writeFile(path.join(docsDir, 'DEPLOYMENT.md'), deployDoc);
    
    console.log(chalk.green('✅ Documentation generated'));
  }

  async cleanup() {
    await this.orchestrator.shutdown();
  }
}

/**
 * Main execution function
 */
async function main() {
  console.log(chalk.cyan('\n🎯 CAIA Todo App Builder\n'));
  console.log(chalk.gray('Demonstrating how CAIA can build a complete application from a simple idea...\n'));
  
  const builder = new TodoAppBuilder();
  
  try {
    const result = await builder.buildApplication();
    
    console.log(chalk.green('\n🎉 Success! Todo app has been generated.'));
    console.log(chalk.blue('\n📋 What was created:'));
    console.log('  • Complete React frontend with TypeScript');
    console.log('  • Node.js backend API with Express');
    console.log('  • PostgreSQL database schema');
    console.log('  • Docker configuration');
    console.log('  • Comprehensive documentation');
    console.log('  • Testing setup');
    console.log('  • CI/CD pipeline configuration');
    
    console.log(chalk.blue('\n🚀 Next steps:'));
    console.log(`  1. cd ${result.outputDir}`);
    console.log('  2. make install');
    console.log('  3. make start');
    console.log('  4. Open http://localhost:3000');
    
    console.log(chalk.yellow('\n💡 This demonstrates CAIA\'s ability to:'));
    console.log('  • Understand high-level requirements');
    console.log('  • Design comprehensive system architecture');
    console.log('  • Generate production-ready code');
    console.log('  • Create proper documentation');
    console.log('  • Set up deployment infrastructure');
    
  } catch (error) {
    console.error(chalk.red('\n❌ Generation failed:'), error.message);
    if (process.env.DEBUG) {
      console.error(error.stack);
    }
    process.exit(1);
  } finally {
    await builder.cleanup();
  }
}

// Export for use as module
module.exports = {
  TodoAppBuilder,
  todoAppIdea,
  main
};

// Run if called directly
if (require.main === module) {
  main().catch(error => {
    console.error(chalk.red('Fatal error:'), error);
    process.exit(1);
  });
}