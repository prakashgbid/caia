---
sidebar_position: 1
---

# Architecture Overview

The Roulette Advisor AI application follows a microservices architecture pattern with a monorepo structure.

## System Components

### Frontend Application

The React-based frontend application provides the user interface for the Roulette Advisor AI. It's built using:

- **React** with TypeScript for type safety
- **Material UI** for component styling
- **Redux** for state management
- **React Router** for navigation

### Backend Services

The backend is built with Node.js and Express, organized as microservices:

- **Authentication Service**: Handles user registration, login, and session management
- **Game Service**: Manages game sessions and state
- **Betting Service**: Processes bets and calculates payouts

### Database Layer

MongoDB is used as the primary database:

- **User Collection**: Stores user profiles and authentication data
- **Game Collection**: Stores game history and state
- **Bet Collection**: Records all betting transactions

## Deployment Architecture

The application is designed to be deployed on Google Cloud Platform using Kubernetes:

```
┌───────────────┐      ┌───────────────┐
│   Frontend    │◄────►│  API Gateway  │
│   Container   │      │   Container   │
└───────────────┘      └───────┬───────┘
                               │
                ┌──────────────┴──────────────┐
                │                             │
        ┌───────▼──────┐            ┌────────▼─────┐
        │     Auth     │            │    Game      │
        │   Service    │            │   Service    │
        └───────┬──────┘            └──────┬───────┘
                │                          │
                │         ┌────────────────┘
                │         │
        ┌───────▼─────────▼────┐
        │                      │
        │      Database        │
        │      (MongoDB)       │
        │                      │
        └──────────────────────┘
```

## Technology Stack

| Component             | Technology                               |
|-----------------------|------------------------------------------|
| Frontend              | React, TypeScript, Material UI, Redux    |
| Backend               | Node.js, Express, TypeScript             |
| Database              | MongoDB                                  |
| API Documentation     | TypeDoc, Swagger                         |
| Containerization      | Docker                                   |
| Orchestration         | Kubernetes                               |
| CI/CD                 | GitHub Actions                           |
| Cloud Infrastructure  | Google Cloud Platform                    |
