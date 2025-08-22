# @caia/agent-frontend-engineer

Frontend Engineer Agent for UI/UX implementation, React/Vue/Angular development, and performance optimization within the CAIA ecosystem.

## Overview

The Frontend Engineer Agent specializes in modern frontend development, UI/UX implementation, component architecture, state management, performance optimization, and accessibility compliance. It delivers production-ready frontend solutions across multiple frameworks.

## Key Capabilities

- **UI/UX Implementation**: Create responsive and accessible user interfaces
- **Component Development**: Build reusable component libraries
- **State Management**: Implement robust state management solutions
- **Performance Optimization**: Optimize Core Web Vitals and frontend performance
- **Accessibility Compliance**: Ensure WCAG 2.1 AA compliance
- **Responsive Design**: Create mobile-first responsive designs
- **Testing Automation**: Setup comprehensive frontend testing
- **Build Optimization**: Configure and optimize build processes
- **Progressive Web Apps**: Implement PWA features
- **Design Systems**: Create and maintain design systems

## Installation

```bash
npm install @caia/agent-frontend-engineer
```

## Usage

### Basic Usage

```typescript
import { createFrontendEngineerAgent } from '@caia/agent-frontend-engineer';

// Create agent with default configuration
const agent = createFrontendEngineerAgent();

// Initialize the agent
await agent.initialize();

// Create a component library
const componentTask = {
  id: 'comp-001',
  type: 'create_component_library',
  priority: 3,
  payload: {
    framework: 'react',
    designSystem: {
      name: 'MyDesign System',
      tokens: ['colors', 'typography', 'spacing'],
      components: ['Button', 'Input', 'Card', 'Modal']
    },
    features: {
      typescript: true,
      storybook: true,
      testing: true,
      accessibility: true
    }
  },
  createdAt: new Date()
};

await agent.assignTask(componentTask);
```

### State Management Setup

```typescript
const stateTask = {
  id: 'state-001',
  type: 'setup_state_management',
  priority: 3,
  payload: {
    framework: 'react',
    library: 'redux-toolkit',
    architecture: 'flux',
    requirements: {
      persistence: true,
      devTools: true,
      middleware: ['logger', 'thunk'],
      timeTravel: true
    }
  },
  createdAt: new Date()
};

await agent.assignTask(stateTask);
```

### Performance Optimization

```typescript
const perfTask = {
  id: 'perf-001',
  type: 'optimize_performance',
  priority: 3,
  payload: {
    metrics: ['fcp', 'lcp', 'fid', 'cls', 'ttfb'],
    targets: {
      fcp: '1.8s',
      lcp: '2.5s',
      fid: '100ms',
      cls: '0.1'
    },
    strategies: [
      'code-splitting',
      'lazy-loading',
      'image-optimization',
      'critical-css'
    ]
  },
  createdAt: new Date()
};

await agent.assignTask(perfTask);
```

## Task Types

### design_ui_specification
Creates comprehensive UI specifications with wireframes, user flows, and component definitions.

### create_component_library
Builds reusable component libraries with documentation and testing.

### implement_component
Creates individual components with accessibility and responsive design.

### setup_state_management
Configures state management solutions (Redux, Zustand, Pinia, etc.).

### implement_responsive_design
Creates mobile-first responsive designs with flexible grids and breakpoints.

### optimize_performance
Optimizes Core Web Vitals and implements performance best practices.

### implement_accessibility
Ensures WCAG compliance with keyboard navigation and screen reader support.

### create_theme_system
Builds comprehensive theming systems with design tokens.

### setup_testing
Configures testing frameworks for unit, integration, and e2e testing.

### implement_progressive_web_app
Adds PWA features like service workers and offline support.

## Architecture

```
FrontendEngineerAgent
├── UIDesigner            # UI specification and wireframes
├── ComponentGenerator    # Component library creation
├── StateManager         # State management solutions
├── PerformanceOptimizer # Performance optimization
├── AccessibilityService # Accessibility compliance
├── ResponsiveDesigner   # Responsive design implementation
├── TestingService       # Testing framework setup
├── BuildService         # Build process optimization
├── ThemeService         # Theme system creation
├── UXService           # UX patterns and navigation
└── FormService         # Form implementation and validation
```

## Services

### UIDesigner
- Creates UI specifications
- Generates wireframes and mockups
- Defines user flows
- Creates component specifications

### ComponentGenerator
- Builds component libraries
- Implements atomic design principles
- Creates Storybook documentation
- Generates TypeScript definitions

### StateManager
- Configures Redux, Zustand, Pinia
- Implements state patterns
- Creates selectors and actions
- Handles state persistence

### PerformanceOptimizer
- Optimizes Core Web Vitals
- Implements code splitting
- Optimizes images and assets
- Creates performance budgets

### AccessibilityService
- Ensures WCAG 2.1 compliance
- Implements keyboard navigation
- Creates screen reader support
- Performs accessibility audits

### ResponsiveDesigner
- Creates mobile-first designs
- Implements flexible grids
- Handles responsive images
- Creates adaptive components

### TestingService
- Sets up Jest, Vitest, Cypress
- Creates testing utilities
- Implements visual regression testing
- Configures accessibility testing

### ThemeService
- Creates design token systems
- Implements theme switching
- Handles CSS custom properties
- Creates theme inheritance

## Supported Frameworks

### JavaScript Frameworks
- **React**: Hooks, Context, Suspense
- **Vue**: Composition API, Pinia
- **Angular**: Standalone components, Signals
- **Svelte**: SvelteKit, Stores
- **Solid**: Fine-grained reactivity

### Styling Solutions
- **CSS-in-JS**: Styled-components, Emotion
- **Utility-first**: Tailwind CSS
- **Preprocessors**: Sass, Less, Stylus
- **CSS Modules**: Scoped styling
- **PostCSS**: Modern CSS processing

### Build Tools
- **Bundlers**: Webpack, Vite, Parcel, Rollup
- **Compilers**: Babel, TypeScript, SWC
- **Task Runners**: npm scripts, Gulp
- **Linters**: ESLint, Stylelint
- **Formatters**: Prettier

### Testing Frameworks
- **Unit**: Jest, Vitest, Mocha
- **Component**: Testing Library, Enzyme
- **E2E**: Cypress, Playwright, Puppeteer
- **Visual**: Chromatic, Percy
- **Accessibility**: axe-core, Pa11y

## Integration with CAIA

- **Solution Architect Agent**: Implements UI architecture designs
- **Backend Engineer Agent**: Consumes backend APIs
- **UX Designer Agent**: Implements design specifications
- **DevOps Agent**: Coordinates deployment strategies

## Performance Features

### Core Web Vitals Optimization
- **First Contentful Paint (FCP)**: < 1.8s
- **Largest Contentful Paint (LCP)**: < 2.5s
- **First Input Delay (FID)**: < 100ms
- **Cumulative Layout Shift (CLS)**: < 0.1

### Optimization Techniques
- Code splitting and lazy loading
- Image optimization and responsive images
- Critical CSS inlining
- Resource preloading and prefetching
- Service worker caching
- Bundle analysis and optimization

## Accessibility Features

### WCAG 2.1 Compliance
- **Level AA** compliance by default
- Keyboard navigation support
- Screen reader compatibility
- Color contrast validation
- Focus management
- Semantic HTML structure

### Testing and Validation
- Automated accessibility testing
- Manual testing guidelines
- Screen reader testing
- Keyboard-only navigation testing
- Color blindness simulation

## Development

### Building
```bash
npm run build
```

### Testing
```bash
npm test
npm run test:e2e
npm run test:visual
npm run test:a11y
```

### Component Library Example
```typescript
const libraryTask = {
  id: 'lib-001',
  type: 'create_component_library',
  payload: {
    framework: 'react',
    components: [
      {
        name: 'Button',
        variants: ['primary', 'secondary', 'ghost'],
        props: ['size', 'disabled', 'loading', 'icon']
      },
      {
        name: 'Input',
        variants: ['text', 'email', 'password'],
        props: ['label', 'error', 'required', 'placeholder']
      }
    ],
    patterns: ['atomic-design', 'compound-components'],
    buildSystem: {
      bundler: 'rollup',
      cssProcessor: 'styled-components',
      testRunner: 'jest'
    }
  },
  createdAt: new Date()
};
```

## License

MIT