# @caia/agent-backend-engineer

Backend Engineer Agent for API development, database design, and server infrastructure within the CAIA ecosystem.

## Overview

The Backend Engineer Agent specializes in backend development, API design, database architecture, microservices, authentication systems, and server infrastructure. It provides comprehensive backend solutions from design to deployment.

## Key Capabilities

- **API Development**: Design and implement RESTful and GraphQL APIs
- **Database Design**: Create optimal database schemas and data models
- **Microservices Architecture**: Design and implement microservice systems
- **Authentication & Authorization**: Setup secure authentication and authorization systems
- **Message Queues**: Implement event-driven communication systems
- **Performance Optimization**: Optimize backend performance and scalability
- **Security Implementation**: Implement backend security measures and best practices
- **Monitoring & Observability**: Setup comprehensive monitoring and logging
- **Code Generation**: Generate backend code and scaffolding
- **Database Migrations**: Create and manage database schema changes

## Installation

```bash
npm install @caia/agent-backend-engineer
```

## Usage

### Basic Usage

```typescript
import { createBackendEngineerAgent } from '@caia/agent-backend-engineer';

// Create agent with default configuration
const agent = createBackendEngineerAgent();

// Initialize the agent
await agent.initialize();

// Design an API
const apiTask = {
  id: 'api-001',
  type: 'design_api',
  priority: 3,
  payload: {
    requirements: {
      entities: ['User', 'Product', 'Order'],
      operations: ['CRUD', 'search', 'analytics'],
      authentication: 'JWT',
      rateLimit: true,
      pagination: 'cursor'
    },
    constraints: {
      performance: 'high',
      scalability: 'horizontal'
    }
  },
  createdAt: new Date()
};

await agent.assignTask(apiTask);
```

### Database Design

```typescript
const dbTask = {
  id: 'db-001',
  type: 'design_database',
  priority: 3,
  payload: {
    entities: [
      {
        name: 'User',
        attributes: ['id', 'email', 'password', 'profile']
      },
      {
        name: 'Product',
        attributes: ['id', 'name', 'price', 'description', 'category']
      }
    ],
    relationships: [
      {
        from: 'Order',
        to: 'User',
        type: 'many-to-one'
      }
    ],
    requirements: {
      type: 'postgresql',
      consistency: 'ACID',
      scalability: 'vertical'
    }
  },
  createdAt: new Date()
};

await agent.assignTask(dbTask);
```

## Task Types

### design_api
Creates comprehensive API specifications with endpoints, validation, and documentation.

### implement_api
Generates complete API implementations with chosen framework and patterns.

### design_database
Designs optimal database schemas with relationships, indexes, and constraints.

### implement_database
Creates database migrations, models, and repository patterns.

### design_microservices
Designs microservice architectures with proper service boundaries and communication patterns.

### setup_authentication
Implements authentication systems with JWT, OAuth2, or other strategies.

### setup_message_queue
Configures message queues for event-driven architectures.

### optimize_performance
Analyzes and optimizes backend performance bottlenecks.

### implement_security
Implements comprehensive security measures and best practices.

### generate_backend_code
Generates complete backend applications with best practices.

## Architecture

```
BackendEngineerAgent
├── ApiGenerator           # API specification and implementation
├── DatabaseDesigner      # Database schema design
├── AuthenticationService # Authentication and authorization
├── MicroserviceDesigner  # Microservice architecture
├── MessageQueueService   # Event-driven communication
├── SecurityService       # Security implementation
├── PerformanceOptimizer  # Performance optimization
├── MonitoringService     # Observability and monitoring
├── CodeGenerator         # Code generation and scaffolding
└── DatabaseMigrator      # Database migration management
```

## Services

### ApiGenerator
- Generates OpenAPI specifications
- Creates API implementations
- Implements validation and error handling
- Generates API documentation

### DatabaseDesigner
- Designs normalized database schemas
- Creates optimal indexes and constraints
- Handles relationships and foreign keys
- Supports multiple database types

### AuthenticationService
- Implements JWT, OAuth2, SAML authentication
- Creates role-based authorization
- Handles session management
- Implements multi-factor authentication

### MicroserviceDesigner
- Designs service boundaries
- Creates communication patterns
- Implements service discovery
- Handles distributed transactions

### MessageQueueService
- Configures RabbitMQ, Kafka, Redis
- Implements pub/sub patterns
- Handles message routing
- Creates dead letter queues

### SecurityService
- Implements input validation
- Creates security headers
- Handles encryption
- Performs vulnerability scanning

### PerformanceOptimizer
- Analyzes performance bottlenecks
- Implements caching strategies
- Optimizes database queries
- Creates scaling strategies

### MonitoringService
- Sets up application monitoring
- Implements distributed tracing
- Creates alerting rules
- Generates dashboards

## Supported Technologies

### Frameworks
- **Node.js**: Express, Fastify, NestJS, Koa, Hapi
- **Python**: Django, FastAPI, Flask
- **Java**: Spring Boot, Quarkus
- **Go**: Gin, Echo, Fiber
- **.NET**: ASP.NET Core

### Databases
- **Relational**: PostgreSQL, MySQL, SQL Server
- **NoSQL**: MongoDB, CouchDB, DynamoDB
- **Cache**: Redis, Memcached
- **Search**: Elasticsearch, Solr

### Message Brokers
- RabbitMQ
- Apache Kafka
- Redis Pub/Sub
- AWS SQS/SNS
- Google Cloud Pub/Sub

## Integration with CAIA

- **Solution Architect Agent**: Implements architectural designs
- **Frontend Engineer Agent**: Provides APIs for frontend consumption
- **DevOps Agent**: Coordinates deployment and infrastructure
- **Testing Agent**: Implements backend testing strategies

## Development

### Building
```bash
npm run build
```

### Testing
```bash
npm test
npm run test:integration
```

### Code Generation Example
```typescript
const codeGenTask = {
  id: 'codegen-001',
  type: 'generate_backend_code',
  payload: {
    framework: 'express',
    language: 'typescript',
    patterns: ['repository', 'service', 'controller'],
    features: [
      'authentication',
      'validation',
      'error-handling',
      'logging',
      'testing'
    ]
  },
  createdAt: new Date()
};
```

## License

MIT