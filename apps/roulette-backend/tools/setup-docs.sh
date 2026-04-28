#!/bin/bash

# Function to check if a command exists
command_exists() {
  command -v "$1" >/dev/null 2>&1
}

# Ensure npx is available
if ! command_exists npx; then
  echo "npx is required but not found. Please install Node.js and npm."
  exit 1
fi

# Set up Docusaurus manually if we can't use the CLI
setup_docusaurus_manually() {
  echo "Setting up Docusaurus manually..."
  
  # Create base structure
  mkdir -p packages/docs/{src/{components,css,pages},static/{img,api},docs,blog}
  
  # Create package.json
  cat > packages/docs/package.json << EOL
{
  "name": "roulette-advisor-docs",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "docusaurus": "docusaurus",
    "start": "docusaurus start",
    "build": "docusaurus build",
    "swizzle": "docusaurus swizzle",
    "deploy": "docusaurus deploy",
    "clear": "docusaurus clear",
    "serve": "docusaurus serve",
    "write-translations": "docusaurus write-translations",
    "write-heading-ids": "docusaurus write-heading-ids",
    "typecheck": "tsc"
  },
  "dependencies": {
    "@docusaurus/core": "3.7.0",
    "@docusaurus/preset-classic": "3.7.0",
    "@mdx-js/react": "^3.0.0",
    "clsx": "^2.0.0",
    "prism-react-renderer": "^2.3.0",
    "react": "^18.0.0",
    "react-dom": "^18.0.0"
  },
  "devDependencies": {
    "@docusaurus/module-type-aliases": "3.7.0",
    "@docusaurus/tsconfig": "3.7.0",
    "@docusaurus/types": "3.7.0",
    "typescript": "~5.2.2"
  },
  "browserslist": {
    "production": [
      ">0.5%",
      "not dead",
      "not op_mini all"
    ],
    "development": [
      "last 1 chrome version",
      "last 1 firefox version",
      "last 1 safari version"
    ]
  },
  "engines": {
    "node": ">=18.0"
  }
}
EOL
  
  # Create tsconfig.json
  cat > packages/docs/tsconfig.json << EOL
{
  "extends": "@docusaurus/tsconfig",
  "compilerOptions": {
    "baseUrl": "."
  }
}
EOL
  
  # Create custom CSS
  mkdir -p packages/docs/src/css
  cat > packages/docs/src/css/custom.css << EOL
/**
 * Any CSS included here will be global. The classic template
 * bundles Infima by default. Infima is a CSS framework designed to
 * work well for content-centric websites.
 */

/* You can override the default Infima variables here. */
:root {
  --ifm-color-primary: #2e8555;
  --ifm-color-primary-dark: #29784c;
  --ifm-color-primary-darker: #277148;
  --ifm-color-primary-darkest: #205d3b;
  --ifm-color-primary-light: #33925d;
  --ifm-color-primary-lighter: #359962;
  --ifm-color-primary-lightest: #3cad6e;
  --ifm-code-font-size: 95%;
  --docusaurus-highlighted-code-line-bg: rgba(0, 0, 0, 0.1);
}

/* For readability concerns, you should choose a lighter palette in dark mode. */
[data-theme='dark'] {
  --ifm-color-primary: #25c2a0;
  --ifm-color-primary-dark: #21af90;
  --ifm-color-primary-darker: #1fa588;
  --ifm-color-primary-darkest: #1a8870;
  --ifm-color-primary-light: #29d5b0;
  --ifm-color-primary-lighter: #32d8b4;
  --ifm-color-primary-lightest: #4fddbf;
  --docusaurus-highlighted-code-line-bg: rgba(0, 0, 0, 0.3);
}
EOL
  
  # Create home page
  mkdir -p packages/docs/src/pages
  cat > packages/docs/src/pages/index.tsx << EOL
import clsx from 'clsx';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Layout from '@theme/Layout';
import Heading from '@theme/Heading';

import styles from './index.module.css';

function HomepageHeader() {
  const {siteConfig} = useDocusaurusContext();
  return (
    <header className={clsx('hero hero--primary', styles.heroBanner)}>
      <div className="container">
        <Heading as="h1" className="hero__title">
          {siteConfig.title}
        </Heading>
        <p className="hero__subtitle">{siteConfig.tagline}</p>
        <div className={styles.buttons}>
          <Link
            className="button button--secondary button--lg"
            to="/docs/intro">
            Get Started
          </Link>
        </div>
      </div>
    </header>
  );
}

export default function Home(): JSX.Element {
  const {siteConfig} = useDocusaurusContext();
  return (
    <Layout
      title={\`\${siteConfig.title}\`}
      description="Description will go into a meta tag in <head />">
      <HomepageHeader />
      <main>
        <section className={styles.features}>
          <div className="container">
            <div className="row">
              <div className="col col--4">
                <div className="text--center">
                  <h3>Easy to Use</h3>
                  <p>
                    Roulette Advisor AI was designed to make your betting experience
                    more informed and methodical.
                  </p>
                </div>
              </div>
              <div className="col col--4">
                <div className="text--center">
                  <h3>Intelligent Analysis</h3>
                  <p>
                    Our advanced AI algorithms analyze betting patterns to provide
                    optimal recommendations.
                  </p>
                </div>
              </div>
              <div className="col col--4">
                <div className="text--center">
                  <h3>Track Your Results</h3>
                  <p>
                    Keep track of your betting history and performance metrics
                    over time.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>
    </Layout>
  );
}
EOL

  # Create CSS module for homepage
  cat > packages/docs/src/pages/index.module.css << EOL
/**
 * CSS files with the .module.css suffix will be treated as CSS modules
 * and scoped locally.
 */

.heroBanner {
  padding: 4rem 0;
  text-align: center;
  position: relative;
  overflow: hidden;
}

@media screen and (max-width: 996px) {
  .heroBanner {
    padding: 2rem;
  }
}

.buttons {
  display: flex;
  align-items: center;
  justify-content: center;
}

.features {
  display: flex;
  align-items: center;
  padding: 2rem 0;
  width: 100%;
}
EOL
  
  # Create sidebars.ts
  cat > packages/docs/sidebars.ts << EOL
import type {SidebarsConfig} from '@docusaurus/plugin-content-docs';

/**
 * Creating a sidebar enables you to:
 - create an ordered group of docs
 - render a sidebar for each doc of that group
 - provide next/previous navigation

 The sidebars can be generated from the filesystem, or explicitly defined here.

 Create as many sidebars as you want.
 */
const sidebars: SidebarsConfig = {
  // By default, Docusaurus generates a sidebar from the docs folder structure
  tutorialSidebar: [
    {
      type: 'category',
      label: 'Getting Started',
      items: ['intro'],
    },
    {
      type: 'category',
      label: 'Architecture',
      items: ['architecture/overview'],
    },
    {
      type: 'category',
      label: 'Development',
      items: ['development/setup'],
    },
  ],
};

export default sidebars;
EOL
  
  # Create docusaurus.config.ts
  cat > packages/docs/docusaurus.config.ts << EOL
import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

const config: Config = {
  title: 'Roulette Advisor AI',
  tagline: 'Advanced betting analytics and recommendations',
  favicon: 'img/favicon.ico',
  url: 'https://your-domain.com',
  baseUrl: '/',
  organizationName: 'your-org',
  projectName: 'roulette-advisor-ai',
  onBrokenLinks: 'throw',
  onBrokenMarkdownLinks: 'warn',
  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          editUrl:
            'https://github.com/your-org/roulette-advisor-ai/tree/main/packages/docs/',
        },
        blog: {
          showReadingTime: true,
          editUrl:
            'https://github.com/your-org/roulette-advisor-ai/tree/main/packages/docs/',
        },
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    // Replace with your project's social card
    image: 'img/docusaurus-social-card.jpg',
    navbar: {
      title: 'Roulette Advisor AI',
      logo: {
        alt: 'Roulette Advisor Logo',
        src: 'img/logo.svg',
      },
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'tutorialSidebar',
          position: 'left',
          label: 'Documentation',
        },
        {to: '/blog', label: 'Blog', position: 'left'},
        {
          href: 'https://github.com/your-org/roulette-advisor-ai',
          label: 'GitHub',
          position: 'right',
        },
        {
          to: '/api',
          label: 'API',
          position: 'left'
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Docs',
          items: [
            {
              label: 'Getting Started',
              to: '/docs/intro',
            },
            {
              label: 'API Reference',
              to: '/api',
            },
          ],
        },
        {
          title: 'Community',
          items: [
            {
              label: 'Stack Overflow',
              href: 'https://stackoverflow.com/questions/tagged/roulette-advisor-ai',
            },
            {
              label: 'Discord',
              href: 'https://discord.gg/your-discord',
            },
            {
              label: 'Twitter',
              href: 'https://twitter.com/your-twitter',
            },
          ],
        },
        {
          title: 'More',
          items: [
            {
              label: 'Blog',
              to: '/blog',
            },
            {
              label: 'GitHub',
              href: 'https://github.com/your-org/roulette-advisor-ai',
            },
          ],
        },
      ],
      copyright: \`Copyright © \${new Date().getFullYear()} Roulette Advisor AI. Built with Docusaurus.\`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
EOL

  # Create a minimal placeholder for logo
  mkdir -p packages/docs/static/img
  cat > packages/docs/static/img/logo.svg << EOL
<svg width="200" height="200" xmlns="http://www.w3.org/2000/svg">
  <circle cx="100" cy="100" r="50" fill="#2e8555" />
  <text x="100" y="110" font-family="Arial" font-size="20" text-anchor="middle" fill="white">RA</text>
</svg>
EOL

  cat > packages/docs/static/img/favicon.ico << EOL
This is a placeholder. Replace with a real favicon.ico file.
EOL

  # Add a social card image placeholder
  touch packages/docs/static/img/docusaurus-social-card.jpg

  echo "Manual Docusaurus setup complete!"
}

# Check if Docusaurus is already initialized
if [ -f "packages/docs/package.json" ]; then
  echo "Docusaurus already initialized in packages/docs, updating configuration files..."
  
  # We'll just update the configuration files instead of creating a new project
  # Update docusaurus.config.js
  cat > packages/docs/docusaurus.config.ts << EOL
import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

const config: Config = {
  title: 'Roulette Advisor AI',
  tagline: 'Advanced betting analytics and recommendations',
  favicon: 'img/favicon.ico',
  url: 'https://your-domain.com',
  baseUrl: '/',
  organizationName: 'your-org',
  projectName: 'roulette-advisor-ai',
  onBrokenLinks: 'throw',
  onBrokenMarkdownLinks: 'warn',
  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          editUrl:
            'https://github.com/your-org/roulette-advisor-ai/tree/main/packages/docs/',
        },
        blog: {
          showReadingTime: true,
          editUrl:
            'https://github.com/your-org/roulette-advisor-ai/tree/main/packages/docs/',
        },
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    // Replace with your project's social card
    image: 'img/docusaurus-social-card.jpg',
    navbar: {
      title: 'Roulette Advisor AI',
      logo: {
        alt: 'Roulette Advisor Logo',
        src: 'img/logo.svg',
      },
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'tutorialSidebar',
          position: 'left',
          label: 'Documentation',
        },
        {to: '/blog', label: 'Blog', position: 'left'},
        {
          href: 'https://github.com/your-org/roulette-advisor-ai',
          label: 'GitHub',
          position: 'right',
        },
        {
          to: '/api',
          label: 'API',
          position: 'left'
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Docs',
          items: [
            {
              label: 'Getting Started',
              to: '/docs/intro',
            },
            {
              label: 'API Reference',
              to: '/api',
            },
          ],
        },
        {
          title: 'Community',
          items: [
            {
              label: 'Stack Overflow',
              href: 'https://stackoverflow.com/questions/tagged/roulette-advisor-ai',
            },
            {
              label: 'Discord',
              href: 'https://discord.gg/your-discord',
            },
            {
              label: 'Twitter',
              href: 'https://twitter.com/your-twitter',
            },
          ],
        },
        {
          title: 'More',
          items: [
            {
              label: 'Blog',
              to: '/blog',
            },
            {
              label: 'GitHub',
              href: 'https://github.com/your-org/roulette-advisor-ai',
            },
          ],
        },
      ],
      copyright: \`Copyright © \${new Date().getFullYear()} Roulette Advisor AI. Built with Docusaurus.\`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
EOL

  echo "Configuration files updated!"
else
  # Try to use CLI first
  echo "Setting up Docusaurus documentation site..."
  
  # Check if directory exists but is incomplete
  if [ -d "packages/docs" ]; then
    echo "Directory exists but appears incomplete. Setting up manually..."
    setup_docusaurus_manually
  else
    # Create directory and attempt to use CLI
    mkdir -p packages/docs
    npx create-docusaurus@latest packages/docs classic --typescript

    # If failed (non-zero exit code), fallback to manual setup
    if [ $? -ne 0 ]; then
      echo "Failed to initialize with CLI. Falling back to manual setup..."
      setup_docusaurus_manually
    else
      # If successful, modify configuration
      # Update docusaurus.config.js
      cat > packages/docs/docusaurus.config.ts << EOL
import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

const config: Config = {
  title: 'Roulette Advisor AI',
  tagline: 'Advanced betting analytics and recommendations',
  favicon: 'img/favicon.ico',
  url: 'https://your-domain.com',
  baseUrl: '/',
  organizationName: 'your-org',
  projectName: 'roulette-advisor-ai',
  onBrokenLinks: 'throw',
  onBrokenMarkdownLinks: 'warn',
  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          editUrl:
            'https://github.com/your-org/roulette-advisor-ai/tree/main/packages/docs/',
        },
        blog: {
          showReadingTime: true,
          editUrl:
            'https://github.com/your-org/roulette-advisor-ai/tree/main/packages/docs/',
        },
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    // Replace with your project's social card
    image: 'img/docusaurus-social-card.jpg',
    navbar: {
      title: 'Roulette Advisor AI',
      logo: {
        alt: 'Roulette Advisor Logo',
        src: 'img/logo.svg',
      },
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'tutorialSidebar',
          position: 'left',
          label: 'Documentation',
        },
        {to: '/blog', label: 'Blog', position: 'left'},
        {
          href: 'https://github.com/your-org/roulette-advisor-ai',
          label: 'GitHub',
          position: 'right',
        },
        {
          to: '/api',
          label: 'API',
          position: 'left'
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Docs',
          items: [
            {
              label: 'Getting Started',
              to: '/docs/intro',
            },
            {
              label: 'API Reference',
              to: '/api',
            },
          ],
        },
        {
          title: 'Community',
          items: [
            {
              label: 'Stack Overflow',
              href: 'https://stackoverflow.com/questions/tagged/roulette-advisor-ai',
            },
            {
              label: 'Discord',
              href: 'https://discord.gg/your-discord',
            },
            {
              label: 'Twitter',
              href: 'https://twitter.com/your-twitter',
            },
          ],
        },
        {
          title: 'More',
          items: [
            {
              label: 'Blog',
              to: '/blog',
            },
            {
              label: 'GitHub',
              href: 'https://github.com/your-org/roulette-advisor-ai',
            },
          ],
        },
      ],
      copyright: \`Copyright © \${new Date().getFullYear()} Roulette Advisor AI. Built with Docusaurus.\`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
EOL
    fi
  fi
fi

# Create API page to link to TypeDoc generated docs
mkdir -p packages/docs/src/pages/api
cat > packages/docs/src/pages/api/index.tsx << EOL
import React from 'react';
import Layout from '@theme/Layout';
import { useHistory } from '@docusaurus/router';
import { useEffect } from 'react';

export default function ApiRedirect(): JSX.Element {
  const history = useHistory();
  
  useEffect(() => {
    // Redirect to the API documentation entry point
    history.replace('/api/index.html');
  }, [history]);
  
  return (
    <Layout title="API Reference">
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          height: '50vh',
          fontSize: '20px',
        }}>
        <p>Redirecting to API documentation...</p>
      </div>
    </Layout>
  );
}
EOL

# Create architecture documentation
mkdir -p packages/docs/docs/architecture
cat > packages/docs/docs/architecture/overview.md << EOL
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

\`\`\`
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
\`\`\`

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
EOL

# Create development setup documentation
mkdir -p packages/docs/docs/development
cat > packages/docs/docs/development/setup.md << EOL
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

\`\`\`bash
git clone https://github.com/your-org/roulette-advisor-ai.git
cd roulette-advisor-ai
\`\`\`

2. Install dependencies:

\`\`\`bash
npm run install:all
\`\`\`

3. Set up environment variables:

\`\`\`bash
cp apps/backend/.env.template apps/backend/.env
cp apps/frontend/.env.template apps/frontend/.env
\`\`\`

4. Edit the .env files with your configuration.

## Running the Application

### Standard Development

Start both frontend and backend:

\`\`\`bash
npm start
\`\`\`

Or start them individually:

- Frontend only: \`npm run start:frontend\`
- Backend only: \`npm run start:backend\`

### Docker Development

Run the application with Docker Compose:

\`\`\`bash
npm run docker:up
\`\`\`

This will start:
- Frontend at http://localhost:3000
- Backend at http://localhost:5000
- MongoDB at localhost:27017

Stop the Docker containers:

\`\`\`bash
npm run docker:down
\`\`\`

## Testing

Run all tests:

\`\`\`bash
npm test
\`\`\`

Or run tests for specific applications:

- Frontend tests: \`npm run test:frontend\`
- Backend tests: \`npm run test:backend\`

## Building for Production

Build all applications:

\`\`\`bash
npm run build:all
\`\`\`

Or build specific applications:

- Frontend: \`npm run build:frontend\`
- Backend: \`npm run build:backend\`

## Documentation

Generate API documentation:

\`\`\`bash
npm run docs:api
\`\`\`

Run the documentation site locally:

\`\`\`bash
npm run docs:dev
\`\`\`
EOL

# Create intro document
cat > packages/docs/docs/intro.md << EOL
---
sidebar_position: 1
---

# Introduction

Welcome to the Roulette Advisor AI documentation! This documentation will help you understand, use, and contribute to the Roulette Advisor AI platform.

## What is Roulette Advisor AI?

Roulette Advisor AI is an intelligent application that helps users make informed betting decisions in roulette games. It provides:

- Real-time betting recommendations based on statistical analysis
- Historical data tracking and visualization
- Betting pattern recognition
- Bankroll management advice

## Key Features

- **Interactive Roulette Board**: Visually place bets on any position
- **Intelligent Recommendations**: AI-powered betting suggestions
- **History Tracking**: View and analyze your betting history
- **Statistics Dashboard**: Track hot/cold numbers and betting patterns
- **User Accounts**: Secure authentication and profile management

## Getting Started

To get started with Roulette Advisor AI:

1. [Set up your development environment](/docs/development/setup)
2. [Understand the architecture](/docs/architecture/overview)
3. [Explore the API reference](/api)

## Target Audience

This documentation is intended for:

- **Developers** working on the Roulette Advisor AI codebase
- **System administrators** deploying the application
- **End-users** wanting to understand the system's capabilities

## Where to Go Next

- [Development Setup](/docs/development/setup)
- [Architecture Overview](/docs/architecture/overview)
- [API Reference](/api)
EOL

echo "Docusaurus documentation site setup complete!" 