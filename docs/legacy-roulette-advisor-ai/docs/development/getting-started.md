---
sidebar_position: 1
---

# Getting Started

This guide will help you set up your local development environment for the Roulette Advisor AI project. Follow these steps to get up and running quickly.

## Prerequisites

Before you begin, ensure you have the following installed on your system:

- **Node.js** (v16.x or later)
- **npm** (v8.x or later) or **yarn** (v1.22.x or later)
- **Docker** and **Docker Compose** (for containerized development)
- **Git** (v2.x or later)
- **MongoDB** (v5.x or later) - Optional if using Docker

## Clone the Repository

Start by cloning the repository to your local machine:

```bash
git clone https://github.com/yourusername/roulette-advisor-ai.git
cd roulette-advisor-ai
```

## Repository Structure

The project is organized as a monorepo with the following structure:

```
roulette-advisor-ai/
├── apps/                  # Main applications
│   ├── frontend/          # React frontend application
│   └── backend/           # Node.js backend application
├── packages/              # Shared libraries and utilities
├── infrastructure/        # Deployment configurations
└── tools/                 # Development scripts and utilities
```

## Setup Options

You have two options for setting up your development environment:

1. **Local Setup**: Run all services directly on your machine
2. **Docker Setup**: Run all services in Docker containers (recommended)

### Option 1: Local Setup

1. Install dependencies for all packages:

```bash
npm install
```

2. Create environment configuration files:

```bash
cp apps/frontend/.env.template apps/frontend/.env
cp apps/backend/.env.template apps/backend/.env
```

3. Edit the `.env` files with your local configuration.

4. Start MongoDB (if not using Docker):

```bash
# Start MongoDB using your preferred method
# For example, on macOS with Homebrew:
brew services start mongodb-community
```

5. Start the development servers:

```bash
# Start all services
npm run dev

# Or start individual services
npm run dev:frontend
npm run dev:backend
```

### Option 2: Docker Setup (Recommended)

1. Ensure Docker and Docker Compose are installed and running.

2. Start the development environment:

```bash
# Start all services in development mode
npm run docker:dev

# Or to run in detached mode
npm run docker:dev:detached
```

The Docker setup automatically:
- Creates and configures all necessary containers
- Sets up a MongoDB instance
- Connects all services with appropriate networking
- Enables hot reloading for frontend and backend

## Accessing the Applications

Once your development environment is running, you can access:

- **Frontend**: http://localhost:3000
- **Backend API**: http://localhost:8080
- **API Documentation**: http://localhost:8080/api-docs
- **MongoDB**: localhost:27017 (if using Docker or local MongoDB)

## Environment Configuration

### Frontend Environment Variables

Key environment variables for the frontend:

```
REACT_APP_API_URL=http://localhost:8080/v1
REACT_APP_WS_URL=ws://localhost:8080/v1/ws
```

### Backend Environment Variables

Key environment variables for the backend:

```
PORT=8080
NODE_ENV=development
MONGODB_URI=mongodb://localhost:27017/roulette-advisor
JWT_SECRET=your_jwt_secret_key
JWT_EXPIRATION=1h
REFRESH_TOKEN_EXPIRATION=7d
CORS_ORIGIN=http://localhost:3000
```

## Development Workflow

### Running Tests

```bash
# Run all tests
npm test

# Run frontend tests
npm run test:frontend

# Run backend tests
npm run test:backend

# Run tests in watch mode
npm run test:watch
```

### Linting and Formatting

```bash
# Lint all code
npm run lint

# Format all code
npm run format

# Lint and fix
npm run lint:fix
```

### Building for Production

```bash
# Build all packages for production
npm run build

# Build individual packages
npm run build:frontend
npm run build:backend
```

### Generating Documentation

```bash
# Generate API documentation
npm run docs:api

# Start documentation development server
npm run docs:dev

# Build documentation site
npm run docs:build
```

## Committing Changes

The project follows conventional commits for version management. Before committing, ensure:

1. Your code passes all tests and linting
2. You've documented any new features or API changes
3. Your commit message follows the [conventional commits format](https://www.conventionalcommits.org/):

```
<type>[optional scope]: <description>

[optional body]

[optional footer(s)]
```

Example:
```
feat(roulette): add betting history display component

This component shows the user's recent betting history with
detailed information about outcomes and profitability.

Closes #123
```

A pre-commit hook will verify your commit message format.

## Troubleshooting

### Common Issues

#### Port Conflicts

If you encounter port conflicts, modify the ports in your `.env` files or in the `docker-compose.yml` file.

#### MongoDB Connection Issues

If the backend cannot connect to MongoDB:

1. Verify MongoDB is running: `mongod --version`
2. Check the connection string in your `.env` file
3. If using Docker, ensure the MongoDB container is running: `docker ps`

#### Docker Build Failures

If Docker fails to build:

1. Ensure Docker has enough resources allocated
2. Try cleaning Docker: `docker system prune -a`
3. Check Docker logs: `docker logs <container_id>`

### Getting Help

If you encounter issues not covered here:

1. Check existing GitHub issues for similar problems
2. Ask in the project's Slack channel
3. Create a new issue with detailed information about your environment and the problem

## Next Steps

Once your development environment is set up:

1. Explore the [Architecture Documentation](../architecture/project-structure.md) to understand the system design
2. Review the [API Reference](../architecture/api-reference.md) to understand available endpoints
3. Check out the [Component Guide](../architecture/component-guide.md) to understand UI components
4. Follow the [Code Style Guidelines](./code-style.md) for consistent contributions 