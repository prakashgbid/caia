# CAIA Project Structure

## Recommended Structure

```
caia/
├── core/                    # Core orchestration engine
│   ├── src/
│   └── package.json
│
├── agents/                  # ALL agents in one place
│   ├── paraforge/          # Requirements → Jira orchestrator
│   ├── product-owner/      # Requirements gathering
│   ├── jira-connect/       # Jira integration
│   ├── npm-connector/      # NPM management
│   ├── github-sync/        # GitHub operations
│   ├── solution-architect/ # Technical design
│   ├── qa-engineer/        # Test generation
│   ├── frontend-engineer/  # Frontend development
│   ├── backend-engineer/   # Backend development
│   └── ...                 # All other agents
│
├── engines/                 # Processing engines (flat structure)
│   ├── consensus/          # Multi-agent consensus
│   ├── parallelization/    # Parallel processing
│   ├── app-genesis/        # App generation
│   ├── code-synthesis/     # Code generation
│   └── ...
│
├── utils/                   # Utilities (flat structure)
│   ├── logger/             # Logging utility
│   ├── validator/          # Validation utility
│   ├── parallel/           # Parallel execution
│   ├── retry/              # Retry logic
│   └── ...
│
├── modules/                 # Business modules (flat structure)
│   ├── ecommerce/          # E-commerce components
│   ├── auth/               # Authentication
│   ├── payments/           # Payment processing
│   └── ...
│
├── tools/                   # Development tools
│   ├── cli/                # CAIA CLI
│   ├── debugger/           # Debug tools
│   └── ...
│
├── docs/                    # Documentation
├── scripts/                 # Build/deploy scripts
└── package.json            # Root monorepo config
```

## Key Principles

1. **Flat Agent Structure**: All agents directly under `/agents/` folder
2. **No Deep Nesting**: Avoid category folders within agents
3. **Clear Naming**: Agent names are self-descriptive
4. **Consistent Packaging**: Each folder is a npm package

## Package Naming Convention

```
@caia/core                  # Core engine
@caia/agent-{name}          # Agents
@caia/engine-{name}         # Engines
@caia/util-{name}           # Utilities
@caia/module-{name}         # Modules
@caia/tool-{name}           # Tools
```

## Benefits

- **Simple Navigation**: Find any agent immediately
- **Easy Discovery**: All agents in one place
- **Clear Dependencies**: No confusion about paths
- **Better IDE Support**: Simpler imports
- **Easier Testing**: Straightforward test paths