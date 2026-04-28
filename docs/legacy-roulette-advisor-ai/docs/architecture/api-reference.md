---
sidebar_position: 4
---

# API Reference

This document provides a comprehensive reference for all API endpoints in the Roulette Advisor AI application. Each endpoint includes descriptions, request parameters, response formats, and examples.

## Base URL

All API endpoints are relative to the base URL:

```
Production: https://api.rouletteadvisor.ai/v1
Development: http://localhost:8080/v1
```

## Authentication

Most endpoints require authentication using JSON Web Tokens (JWT). Include the token in the Authorization header:

```
Authorization: Bearer <token>
```

To obtain a token, use the `/auth/login` endpoint.

## Error Handling

All API errors follow a consistent format:

```json
{
  "status": "error",
  "code": 400,
  "message": "Invalid request parameters",
  "details": {
    "field": ["Specific error message"]
  }
}
```

Common error codes:
- `400` - Bad Request
- `401` - Unauthorized
- `403` - Forbidden
- `404` - Not Found
- `422` - Unprocessable Entity
- `500` - Internal Server Error

## Authentication API

### Register User

Creates a new user account.

**Endpoint:** `POST /auth/register`

**Request Body:**
```json
{
  "username": "player123",
  "email": "player@example.com",
  "password": "SecurePassword123",
  "confirmPassword": "SecurePassword123"
}
```

**Response (201 Created):**
```json
{
  "status": "success",
  "data": {
    "userId": "6102a7f25d4c7e3458b7b74a",
    "username": "player123",
    "email": "player@example.com",
    "createdAt": "2023-08-15T14:22:34Z"
  }
}
```

### Login

Authenticates a user and returns access and refresh tokens.

**Endpoint:** `POST /auth/login`

**Request Body:**
```json
{
  "email": "player@example.com",
  "password": "SecurePassword123"
}
```

**Response (200 OK):**
```json
{
  "status": "success",
  "data": {
    "userId": "6102a7f25d4c7e3458b7b74a",
    "username": "player123",
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "expiresIn": 3600
  }
}
```

### Refresh Token

Refreshes the access token using a valid refresh token.

**Endpoint:** `POST /auth/refresh`

**Request Body:**
```json
{
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Response (200 OK):**
```json
{
  "status": "success",
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "expiresIn": 3600
  }
}
```

### Logout

Invalidates the user's refresh token.

**Endpoint:** `POST /auth/logout`

**Request Headers:**
```
Authorization: Bearer <access_token>
```

**Response (200 OK):**
```json
{
  "status": "success",
  "message": "Logged out successfully"
}
```

## User API

### Get User Profile

Retrieves the authenticated user's profile information.

**Endpoint:** `GET /users/profile`

**Request Headers:**
```
Authorization: Bearer <access_token>
```

**Response (200 OK):**
```json
{
  "status": "success",
  "data": {
    "userId": "6102a7f25d4c7e3458b7b74a",
    "username": "player123",
    "email": "player@example.com",
    "createdAt": "2023-08-15T14:22:34Z",
    "preferences": {
      "theme": "dark",
      "notifications": true
    },
    "stats": {
      "gamesPlayed": 150,
      "totalWagered": 5000,
      "totalWon": 5430,
      "netProfit": 430
    }
  }
}
```

### Update User Profile

Updates the authenticated user's profile information.

**Endpoint:** `PUT /users/profile`

**Request Headers:**
```
Authorization: Bearer <access_token>
```

**Request Body:**
```json
{
  "username": "newUsername",
  "email": "newemail@example.com",
  "preferences": {
    "theme": "light",
    "notifications": false
  }
}
```

**Response (200 OK):**
```json
{
  "status": "success",
  "data": {
    "userId": "6102a7f25d4c7e3458b7b74a",
    "username": "newUsername",
    "email": "newemail@example.com",
    "preferences": {
      "theme": "light",
      "notifications": false
    }
  }
}
```

## Game API

### Spin Roulette Wheel

Spins the roulette wheel and returns the result.

**Endpoint:** `POST /game/spin`

**Request Headers:**
```
Authorization: Bearer <access_token>
```

**Response (200 OK):**
```json
{
  "status": "success",
  "data": {
    "gameId": "6102a8c35d4c7e3458b7b74b",
    "winningNumber": 17,
    "color": "black",
    "timestamp": "2023-08-15T14:30:45Z"
  }
}
```

### Get Game History

Retrieves the user's game history with pagination.

**Endpoint:** `GET /game/history?page=1&limit=10`

**Request Headers:**
```
Authorization: Bearer <access_token>
```

**Response (200 OK):**
```json
{
  "status": "success",
  "data": {
    "games": [
      {
        "gameId": "6102a8c35d4c7e3458b7b74b",
        "winningNumber": 17,
        "color": "black",
        "timestamp": "2023-08-15T14:30:45Z",
        "bets": [
          {
            "betId": "6102a8c35d4c7e3458b7b74c",
            "type": "straight",
            "number": 17,
            "amount": 10,
            "payout": 360
          }
        ]
      },
      {
        "gameId": "6102a9d25d4c7e3458b7b74d",
        "winningNumber": 0,
        "color": "green",
        "timestamp": "2023-08-15T14:35:12Z",
        "bets": [
          {
            "betId": "6102a9d25d4c7e3458b7b74e",
            "type": "corner",
            "numbers": [1, 2, 4, 5],
            "amount": 20,
            "payout": 0
          }
        ]
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 10,
      "totalPages": 5,
      "totalGames": 45
    }
  }
}
```

### Get Game Statistics

Retrieves statistical information about past games.

**Endpoint:** `GET /game/stats`

**Request Headers:**
```
Authorization: Bearer <access_token>
```

**Response (200 OK):**
```json
{
  "status": "success",
  "data": {
    "numberFrequency": {
      "0": 3,
      "1": 5,
      "2": 2,
      // ... other numbers
      "36": 4
    },
    "colorFrequency": {
      "red": 68,
      "black": 74,
      "green": 8
    },
    "hotNumbers": [1, 17, 23, 34],
    "coldNumbers": [6, 11, 27, 30],
    "oddEvenRatio": {
      "odd": 75,
      "even": 67
    },
    "highLowRatio": {
      "high": 72,
      "low": 70
    }
  }
}
```

## Betting API

### Place Bets

Places one or more bets for the next spin.

**Endpoint:** `POST /bets/place`

**Request Headers:**
```
Authorization: Bearer <access_token>
```

**Request Body:**
```json
{
  "bets": [
    {
      "type": "straight",
      "number": 17,
      "amount": 10
    },
    {
      "type": "split",
      "numbers": [32, 35],
      "amount": 5
    },
    {
      "type": "dozen",
      "dozen": 2,
      "amount": 20
    }
  ]
}
```

**Response (201 Created):**
```json
{
  "status": "success",
  "data": {
    "bets": [
      {
        "betId": "6102aa8e5d4c7e3458b7b74f",
        "type": "straight",
        "number": 17,
        "amount": 10,
        "potentialPayout": 360
      },
      {
        "betId": "6102aa8e5d4c7e3458b7b750",
        "type": "split",
        "numbers": [32, 35],
        "amount": 5,
        "potentialPayout": 90
      },
      {
        "betId": "6102aa8e5d4c7e3458b7b751",
        "type": "dozen",
        "dozen": 2,
        "amount": 20,
        "potentialPayout": 60
      }
    ],
    "totalAmount": 35
  }
}
```

### Get Betting History

Retrieves the user's betting history with pagination.

**Endpoint:** `GET /bets/history?page=1&limit=20`

**Request Headers:**
```
Authorization: Bearer <access_token>
```

**Response (200 OK):**
```json
{
  "status": "success",
  "data": {
    "bets": [
      {
        "betId": "6102a8c35d4c7e3458b7b74c",
        "gameId": "6102a8c35d4c7e3458b7b74b",
        "type": "straight",
        "number": 17,
        "amount": 10,
        "payout": 360,
        "result": "win",
        "timestamp": "2023-08-15T14:30:45Z"
      },
      {
        "betId": "6102a9d25d4c7e3458b7b74e",
        "gameId": "6102a9d25d4c7e3458b7b74d",
        "type": "corner",
        "numbers": [1, 2, 4, 5],
        "amount": 20,
        "payout": 0,
        "result": "loss",
        "timestamp": "2023-08-15T14:35:12Z"
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "totalPages": 8,
      "totalBets": 150
    }
  }
}
```

## Advisor API

### Get Betting Recommendations

Retrieves AI-generated betting recommendations based on game history.

**Endpoint:** `GET /advisor/recommend`

**Request Headers:**
```
Authorization: Bearer <access_token>
```

**Query Parameters:**
- `riskLevel` (optional): low, medium, high (default: medium)
- `maxBets` (optional): Maximum number of recommendations (default: 5)

**Response (200 OK):**
```json
{
  "status": "success",
  "data": {
    "recommendations": [
      {
        "type": "straight",
        "number": 23,
        "amount": 5,
        "confidence": 0.75,
        "reasoning": "Number 23 has not appeared in the last 50 spins, statistical regression suggests higher probability."
      },
      {
        "type": "corner",
        "numbers": [5, 6, 8, 9],
        "amount": 10,
        "confidence": 0.68,
        "reasoning": "This corner has shown positive expected value based on recent patterns."
      },
      {
        "type": "dozen",
        "dozen": 1,
        "amount": 20,
        "confidence": 0.82,
        "reasoning": "First dozen (1-12) is underrepresented in recent spins, suggesting potential regression to mean."
      }
    ],
    "analysisTime": "2023-08-15T14:40:23Z",
    "basedOn": {
      "dataPoints": 150,
      "timespan": "3 days"
    }
  }
}
```

### Submit Feedback on Recommendations

Submits user feedback about the quality of advisor recommendations.

**Endpoint:** `POST /advisor/feedback`

**Request Headers:**
```
Authorization: Bearer <access_token>
```

**Request Body:**
```json
{
  "recommendationId": "6102ab765d4c7e3458b7b752",
  "rating": 4,
  "comments": "This recommendation was accurate and profitable.",
  "outcome": "win"
}
```

**Response (200 OK):**
```json
{
  "status": "success",
  "message": "Feedback received successfully",
  "data": {
    "recommendationId": "6102ab765d4c7e3458b7b752",
    "feedbackId": "6102ab985d4c7e3458b7b753"
  }
}
```

## Bankroll API

### Get Bankroll Balance

Retrieves the user's current bankroll balance.

**Endpoint:** `GET /bankroll/balance`

**Request Headers:**
```
Authorization: Bearer <access_token>
```

**Response (200 OK):**
```json
{
  "status": "success",
  "data": {
    "balance": 1250.50,
    "currency": "USD",
    "lastUpdated": "2023-08-15T14:45:12Z"
  }
}
```

### Add Funds to Bankroll

Adds virtual funds to the user's bankroll.

**Endpoint:** `POST /bankroll/deposit`

**Request Headers:**
```
Authorization: Bearer <access_token>
```

**Request Body:**
```json
{
  "amount": 500,
  "currency": "USD"
}
```

**Response (200 OK):**
```json
{
  "status": "success",
  "data": {
    "transactionId": "6102ac125d4c7e3458b7b754",
    "type": "deposit",
    "amount": 500,
    "currency": "USD",
    "previousBalance": 1250.50,
    "newBalance": 1750.50,
    "timestamp": "2023-08-15T14:48:34Z"
  }
}
```

### Get Transaction History

Retrieves the user's bankroll transaction history.

**Endpoint:** `GET /bankroll/transactions?page=1&limit=10`

**Request Headers:**
```
Authorization: Bearer <access_token>
```

**Response (200 OK):**
```json
{
  "status": "success",
  "data": {
    "transactions": [
      {
        "transactionId": "6102ac125d4c7e3458b7b754",
        "type": "deposit",
        "amount": 500,
        "currency": "USD",
        "balance": 1750.50,
        "description": "Manual deposit",
        "timestamp": "2023-08-15T14:48:34Z"
      },
      {
        "transactionId": "6102a8c35d4c7e3458b7b755",
        "type": "bet",
        "amount": -10,
        "currency": "USD",
        "balance": 1240.50,
        "description": "Bet placed on game #6102a8c35d4c7e3458b7b74b",
        "timestamp": "2023-08-15T14:30:45Z"
      },
      {
        "transactionId": "6102a8c35d4c7e3458b7b756",
        "type": "win",
        "amount": 360,
        "currency": "USD",
        "balance": 1250.50,
        "description": "Win from game #6102a8c35d4c7e3458b7b74b",
        "timestamp": "2023-08-15T14:30:45Z"
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 10,
      "totalPages": 12,
      "totalTransactions": 115
    }
  }
}
```

## WebSocket API

In addition to the REST API, the application provides real-time updates through WebSocket connections.

### Connection

Connect to the WebSocket server:

```
wss://api.rouletteadvisor.ai/v1/ws
```

Authentication is required by sending a message after connection:

```json
{
  "type": "authenticate",
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

### Message Types

#### Game Updates

```json
{
  "type": "gameUpdate",
  "data": {
    "gameId": "6102a8c35d4c7e3458b7b74b",
    "status": "completed",
    "winningNumber": 17,
    "color": "black",
    "timestamp": "2023-08-15T14:30:45Z"
  }
}
```

#### Bet Updates

```json
{
  "type": "betUpdate",
  "data": {
    "betId": "6102a8c35d4c7e3458b7b74c",
    "status": "settled",
    "result": "win",
    "payout": 360
  }
}
```

#### Bankroll Updates

```json
{
  "type": "bankrollUpdate",
  "data": {
    "balance": 1750.50,
    "change": 500,
    "reason": "deposit"
  }
}
```

## Rate Limiting

The API implements rate limiting to prevent abuse. Limits are applied per user and per IP address:

- Authentication endpoints: 10 requests per minute
- Game endpoints: 30 requests per minute
- Betting endpoints: 50 requests per minute
- Other endpoints: 100 requests per minute

When a rate limit is exceeded, the API returns a 429 Too Many Requests response:

```json
{
  "status": "error",
  "code": 429,
  "message": "Rate limit exceeded",
  "details": {
    "retryAfter": 30
  }
}
```

## API Versioning

The API uses URL versioning (e.g., `/v1/endpoint`). When breaking changes are introduced, a new version will be released, and the previous version will be maintained for a transition period. 