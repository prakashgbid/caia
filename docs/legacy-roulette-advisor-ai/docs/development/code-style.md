---
sidebar_position: 2
---

# Code Style and Documentation

This document outlines the coding standards and documentation practices for the Roulette Advisor AI project. Following these guidelines ensures code consistency, maintainability, and generates high-quality documentation.

## Code Documentation Standards

### General Guidelines

- **Document All Code**: Every file, component, function, class, and interface should have documentation
- **Use JSDoc/TSDoc Format**: Follow standard JSDoc/TSDoc format for comments
- **Document Public APIs Thoroughly**: All public APIs must have complete documentation
- **Keep Comments Current**: Update documentation when code changes
- **Be Concise But Comprehensive**: Balance brevity with providing necessary context

### File Headers

Every source file should begin with a header comment:

```typescript
/**
 * @file filename.ts
 * @description Brief description of the file's purpose
 * 
 * Additional details about the file's role in the system,
 * important considerations, or special notes.
 */
```

### Component Documentation

React components should be documented with:

```typescript
/**
 * ComponentName Component
 * 
 * Detailed description of what the component does and its purpose in the UI.
 * Include any important context or usage information.
 * 
 * @example
 * <ComponentName prop1="value" prop2={value} />
 * 
 * @returns {JSX.Element} Rendered component
 */
```

### Function Documentation

Functions should be documented with:

```typescript
/**
 * Brief description of what the function does
 * 
 * More detailed explanation if needed, describing the algorithm,
 * side effects, or important implementation details.
 * 
 * @param {Type} paramName - Description of the parameter
 * @param {Type} paramName2 - Description of the parameter
 * @returns {ReturnType} Description of the return value
 * @throws {ErrorType} Description of when/why errors are thrown
 */
```

### Interface and Type Documentation

TypeScript interfaces and types should be documented with:

```typescript
/**
 * Description of what the interface represents or is used for
 * 
 * @property {Type} propertyName - Description of the property
 * @property {Type} propertyName2 - Description of the property
 */
```

## Code Style Guidelines

### TypeScript/JavaScript

- Use TypeScript for all new code
- Maintain strict type checking with `"strict": true` in tsconfig
- Use interface for object types that will be extended or implemented
- Use type for unions, intersections, and mapped types
- Prefer const over let where possible
- Use async/await instead of raw promises
- Limit line length to 100 characters

### React

- Use functional components with hooks, not class components
- Break complex components into smaller, focused components
- Prefer destructuring for props and state
- Use named exports for components
- Co-locate related components in the same directory
- Keep UI state and business logic separate

### File Organization

- One component per file (except for closely related small components)
- Group related files in feature directories
- Keep directory nesting to a reasonable depth (max 4-5 levels)
- Use consistent file naming:
  - PascalCase for component files: `RouletteBoard.tsx`
  - camelCase for utility files: `formatCurrency.ts`
  - kebab-case for configuration files: `webpack.config.js`

## Redux Guidelines

- Use Redux Toolkit for all Redux code
- Document all reducers, action creators, and selectors
- Keep reducers focused on a specific domain/slice of state
- Use selectors for accessing state
- Document the state shape with TypeScript interfaces

Example:

```typescript
/**
 * Redux slice for the roulette game state
 * 
 * Manages the state of the roulette game including bets,
 * game history, and player statistics.
 */

/**
 * State interface for the roulette game
 * 
 * @property {Bet[]} bets - Current active bets
 * @property {number[]} history - Past results from spins
 * @property {number} bankroll - Player's current balance
 */
interface RouletteState {
  bets: Bet[];
  history: number[];
  bankroll: number;
}
```

## API Documentation

Backend API endpoints should be documented with:

```javascript
/**
 * @route POST /api/endpoint
 * @access Public/Private
 * @description What the endpoint does
 * 
 * @param {Type} req.body.paramName - Description of request body parameter
 * @param {Type} req.params.paramName - Description of URL parameter
 * @param {Type} req.query.paramName - Description of query parameter
 * 
 * @returns {Object} Response data structure
 * @throws {ErrorType} Error condition and HTTP status code
 */
```

## Documentation Generation

Our codebase is configured to automatically generate documentation using:

- **TypeDoc** for API reference documentation
- **Docusaurus** for user guides and conceptual documentation

To ensure your code contributes to good documentation:

1. Run the documentation generation tools before submitting pull requests:
   ```
   npm run docs:api
   npm run docs:build
   ```

2. Check the generated documentation at `packages/docs/static/api` and verify that your code is properly documented

3. Preview the documentation site:
   ```
   npm run docs:dev
   ```

## Commit Messages

Follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:

```
<type>[optional scope]: <description>

[optional body]

[optional footer(s)]
```

Example:
```
feat(roulette): add betting history display component

- Shows last 10 bets with outcomes
- Includes total winnings/losses
- Implements filters by bet type

Closes #123
```

## Best Practices for Comments

1. **Comment Why, Not What**: The code should show what it does; comments should explain why

2. **Avoid Obvious Comments**:
   ```typescript
   // Bad
   let i = 0; // Set i to 0
   
   // Good
   let i = 0; // Start from the first element to ensure correct ordering
   ```

3. **Document Non-Obvious Behavior**:
   ```typescript
   // Use timeout to prevent API rate limiting
   setTimeout(() => {
     fetchData();
   }, 1000);
   ```

4. **Use TODO Comments for Future Work**:
   ```typescript
   // TODO: Implement caching to improve performance
   // Issue #145
   ```

By following these documentation and code style guidelines, we ensure our codebase remains maintainable and our automatically generated documentation stays comprehensive and useful. 