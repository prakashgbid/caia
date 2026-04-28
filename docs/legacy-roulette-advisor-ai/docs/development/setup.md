---
sidebar_position: 1
---

# Development Setup

This guide will help you set up the Roulette Advisor AI application for local development.

## Prerequisites

- Node.js (v18 or later)
- npm (v9 or later)
- Docker and Docker Compose (for containerized development)
- MongoDB (if running locally)

## Installation

1. Clone the repository:

```bash
git clone https://github.com/your-org/roulette-advisor-ai.git
cd roulette-advisor-ai
```

2. Install dependencies:

```bash
npm run install:all
```

3. Set up environment variables:

```bash
cp apps/backend/.env.template apps/backend/.env
cp apps/frontend/.env.template apps/frontend/.env
```

4. Edit the .env files with your configuration.

## Running the Application

### Standard Development

Start both frontend and backend:

```bash
npm start
```

Or start them individually:

- Frontend only: `npm run start:frontend`
- Backend only: `npm run start:backend`

### Docker Development

Run the application with Docker Compose:

```bash
npm run docker:up
```

This will start:
- Frontend at http://localhost:3000
- Backend at http://localhost:5000
- MongoDB at localhost:27017

Stop the Docker containers:

```bash
npm run docker:down
```

## Testing

Run all tests:

```bash
npm test
```

Or run tests for specific applications:

- Frontend tests: `npm run test:frontend`
- Backend tests: `npm run test:backend`

## Building for Production

Build all applications:

```bash
npm run build:all
```

Or build specific applications:

- Frontend: `npm run build:frontend`
- Backend: `npm run build:backend`

## Documentation

Generate API documentation:

```bash
npm run docs:api
```

Run the documentation site locally:

```bash
npm run docs:dev
```
