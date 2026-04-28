---
sidebar_position: 2
---

# Project Structure

The Roulette Advisor AI application is organized as a monorepo, containing multiple applications and packages. This structure facilitates code sharing, consistent tooling, and coordinated deployments across all parts of the system.

## Directory Overview

```
roulette-advisor-ai/
├── apps/                      # Main applications
│   ├── frontend/              # React frontend application
│   └── backend/               # Node.js microservices backend
├── packages/                  # Shared libraries and utilities
│   ├── common/                # Shared utilities, types, and functions
│   ├── database/              # Database models and access layer
│   └── docs/                  # Documentation site
├── infrastructure/            # Deployment and infrastructure configurations
│   ├── docker/                # Docker and docker-compose configuration
│   ├── gcp/                   # Google Cloud Platform deployment
│   └── mongodb/               # MongoDB configuration
└── tools/                     # Development and build scripts
```

## Applications

### Frontend Application (`apps/frontend/`)

The frontend application is built with React and TypeScript, providing an interactive user interface for the roulette game.

```
apps/frontend/
├── public/                    # Static assets
├── src/                       # Source code
│   ├── app/                   # Application-wide setup
│   │   ├── store.ts           # Redux store configuration
│   │   └── hooks.ts           # Custom React hooks
│   ├── features/              # Feature modules
│   │   ├── auth/              # Authentication components
│   │   └── roulette/          # Roulette game components
│   ├── components/            # Shared UI components
│   ├── api/                   # API client and utilities
│   └── index.tsx              # Application entry point
├── package.json               # Dependencies and scripts
└── tsconfig.json              # TypeScript configuration
```

#### Key Frontend Components

- **RouletteBoard**: Interactive visualization of the roulette table with betting positions
- **RouletteControls**: Game controls for spinning the wheel and managing bets
- **BetHistory**: History and analysis of past bets and outcomes
- **Authentication**: Login, registration, and profile management

### Backend Application (`apps/backend/`)

The backend is a Node.js Express application structured as microservices to handle different aspects of the game.

```
apps/backend/
├── src/
│   ├── config/                # Configuration management
│   ├── middleware/            # Express middleware
│   ├── models/                # MongoDB models
│   ├── services/              # Business logic organized by domain
│   │   ├── auth/              # Authentication service
│   │   ├── game/              # Game management service
│   │   └── betting/           # Betting service
│   ├── types/                 # TypeScript type definitions
│   ├── utils/                 # Utility functions
│   └── server.js              # Express server setup
├── package.json               # Dependencies and scripts
└── tsconfig.json              # TypeScript configuration
```

#### Backend Services

1. **Authentication Service**
   - User registration and login
   - JWT token generation and validation
   - Password management
   - User profile operations

2. **Game Service**
   - Game session management
   - Roulette wheel simulation
   - Game state persistence
   - Result history tracking

3. **Betting Service**
   - Bet placement and validation
   - Payout calculations
   - Bet history tracking
   - Statistical analysis

## Shared Packages

### Common Package (`packages/common/`)

Contains shared code used by both frontend and backend applications.

```
packages/common/
├── src/
│   ├── types/                 # Shared TypeScript interfaces
│   ├── constants/             # Application constants
│   ├── utils/                 # Shared utility functions
│   └── index.ts               # Package entry point
├── package.json
└── tsconfig.json
```

### Database Package (`packages/database/`)

Handles database connectivity and shared models.

```
packages/database/
├── src/
│   ├── models/                # Shared MongoDB models
│   ├── migrations/            # Database migrations
│   ├── seeders/               # Test data seeders
│   └── index.ts               # Package entry point
├── package.json
└── tsconfig.json
```

### Documentation Package (`packages/docs/`)

Contains the Docusaurus-powered documentation site.

```
packages/docs/
├── docs/                      # Markdown documentation files
│   ├── intro.md               # Introduction
│   ├── architecture/          # Architecture documentation
│   └── development/           # Development guides
├── src/                       # Documentation site source
├── static/                    # Static assets
│   └── api/                   # Auto-generated API documentation
├── docusaurus.config.js       # Docusaurus configuration
└── package.json
```

## Infrastructure Configuration

### Docker Configuration (`infrastructure/docker/`)

Contains Docker and Docker Compose configurations for local development and production.

```
infrastructure/docker/
├── docker-compose.yml         # Multi-container Docker setup
├── frontend.Dockerfile        # Frontend container definition
└── backend.Dockerfile         # Backend container definition
```

### GCP Configuration (`infrastructure/gcp/`)

Configuration files for Google Cloud Platform deployment.

```
infrastructure/gcp/
├── kubernetes/                # Kubernetes manifests
│   ├── frontend.yaml          # Frontend deployment and service
│   └── backend.yaml           # Backend deployment and service
└── cloudbuild.yaml            # CI/CD pipeline configuration
```

### MongoDB Configuration (`infrastructure/mongodb/`)

MongoDB configuration for both development and production environments.

```
infrastructure/mongodb/
├── init-mongo.js              # MongoDB initialization script
└── mongo-config.yaml          # MongoDB configuration
```

## Development Tools (`tools/`)

Contains scripts and tools for development, building, and deployment.

```
tools/
├── deploy-to-gcp.sh           # GCP deployment script
├── setup-docs.sh              # Documentation setup
├── setup-typedoc.sh           # API documentation generator
└── setup-docs-root.sh         # Documentation builder
```

## Root Configuration Files

- `package.json`: Root package configuration with scripts for the monorepo
- `typedoc.json`: TypeDoc configuration for API documentation generation
- `README.md`: Project documentation
- `CHANGELOG.md`: Project changelog
- `COMMIT_CONVENTION.md`: Commit message guidelines
- `.gitignore`: Git ignore patterns
- `restructure.sh`: Script for project restructuring 