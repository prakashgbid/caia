#!/bin/bash

echo "Setting up Roulette Advisor AI documentation tools..."

# Ensure tools directory exists
if [ ! -d "tools" ]; then
  mkdir -p tools
fi

# Check if packages/docs only contains a static directory and is missing package.json
if [ -d "packages/docs" ] && [ ! -f "packages/docs/package.json" ]; then
  echo "Found incomplete docs directory structure. Cleaning up for fresh install..."
  rm -rf packages/docs
  mkdir -p packages/docs
fi

# Make the individual setup scripts executable
chmod +x tools/setup-docs.sh
chmod +x tools/setup-typedoc.sh

# Run the TypeDoc setup first to ensure API documentation is available
echo "Setting up TypeDoc API documentation..."
./tools/setup-typedoc.sh

# Run the Docusaurus setup
echo "Setting up Docusaurus documentation site..."
./tools/setup-docs.sh

# If package.json exists, update it with documentation scripts
if [ -f "package.json" ]; then
  # For macOS compatibility
  if [[ "$(uname)" == "Darwin" ]]; then
    sed -i '' '/"scripts": {/a\
    "docs:dev": "cd packages/docs && npm start",\
    "docs:build": "npm run docs:api && cd packages/docs && npm run build",\
    "docs:serve": "cd packages/docs && npm run serve",\
' package.json
  else
    # For Linux
    sed -i '/"scripts": {/a\
    "docs:dev": "cd packages/docs && npm start",\
    "docs:build": "npm run docs:api && cd packages/docs && npm run build",\
    "docs:serve": "cd packages/docs && npm run serve",\
' package.json
  fi
fi

echo "Documentation setup complete!"
echo "To start the documentation site, run: npm run docs:dev"
echo "To build the documentation site, run: npm run docs:build" 