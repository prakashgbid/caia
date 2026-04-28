#!/bin/bash

# Ensure package directories exist
mkdir -p packages/api-docs

# Install TypeDoc dependencies
echo "Installing TypeDoc packages..."
npm install --no-save typedoc typedoc-plugin-markdown

# Configure TypeDoc for frontend
cat > typedoc.frontend.json << EOL
{
  "entryPoints": ["apps/frontend/src"],
  "entryPointStrategy": "expand",
  "out": "packages/docs/static/api/frontend",
  "name": "Roulette Advisor AI - Frontend API",
  "includeVersion": true,
  "excludePrivate": true,
  "excludeProtected": true,
  "excludeExternals": true,
  "categorizeByGroup": true,
  "categoryOrder": ["Components", "Hooks", "Utils", "*"],
  "readme": "none",
  "githubPages": false,
  "skipErrorChecking": true,
  "disableSources": false,
  "cleanOutputDir": true
}
EOL

# Configure TypeDoc for backend
cat > typedoc.backend.json << EOL
{
  "entryPoints": ["apps/backend/src"],
  "entryPointStrategy": "expand",
  "out": "packages/docs/static/api/backend",
  "name": "Roulette Advisor AI - Backend API",
  "includeVersion": true,
  "excludePrivate": true,
  "excludeProtected": true,
  "excludeExternals": true,
  "categorizeByGroup": true,
  "categoryOrder": ["Services", "Controllers", "Models", "Utils", "*"],
  "readme": "none", 
  "githubPages": false,
  "skipErrorChecking": true,
  "disableSources": false,
  "cleanOutputDir": true
}
EOL

# Configure TypeDoc for common packages
cat > typedoc.common.json << EOL
{
  "entryPoints": ["packages/common/src"],
  "entryPointStrategy": "expand",
  "out": "packages/docs/static/api/common",
  "name": "Roulette Advisor AI - Common Library",
  "includeVersion": true,
  "excludePrivate": true,
  "excludeProtected": true,
  "excludeExternals": true,
  "categorizeByGroup": true,
  "categoryOrder": ["Types", "Utils", "*"],
  "readme": "none",
  "githubPages": false,
  "skipErrorChecking": true,
  "disableSources": false,
  "cleanOutputDir": true
}
EOL

# Create TypeDoc index HTML file to combine all documentation
mkdir -p packages/docs/static/api
cat > packages/docs/static/api/index.html << EOL
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Roulette Advisor AI - API Documentation</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
      margin: 0;
      padding: 0;
      background-color: #f5f6f7;
      color: #1c1e21;
    }
    .container {
      max-width: 1000px;
      margin: 0 auto;
      padding: 2rem;
    }
    header {
      text-align: center;
      margin-bottom: 2rem;
      padding-bottom: 1rem;
      border-bottom: 1px solid #dadde1;
    }
    h1 {
      font-size: 2.5rem;
      margin-bottom: 0.5rem;
    }
    .subtitle {
      font-size: 1.2rem;
      color: #606770;
      margin-bottom: 2rem;
    }
    .doc-links {
      display: flex;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 1.5rem;
    }
    .doc-card {
      flex: 1;
      min-width: 250px;
      background-color: white;
      border-radius: 8px;
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
      padding: 1.5rem;
      transition: all 0.3s ease;
    }
    .doc-card:hover {
      transform: translateY(-4px);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    }
    .doc-card h2 {
      margin-top: 0;
      font-size: 1.5rem;
      color: #385898;
    }
    .doc-card p {
      color: #606770;
      margin-bottom: 1.5rem;
    }
    .doc-card a {
      display: inline-block;
      background-color: #1877f2;
      color: white;
      text-decoration: none;
      padding: 0.5rem 1rem;
      border-radius: 4px;
      font-weight: 600;
      transition: background-color 0.2s ease;
    }
    .doc-card a:hover {
      background-color: #166fe5;
    }
    footer {
      text-align: center;
      margin-top: 3rem;
      padding-top: 1rem;
      color: #606770;
      font-size: 0.9rem;
      border-top: 1px solid #dadde1;
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>Roulette Advisor AI</h1>
      <div class="subtitle">API Documentation</div>
    </header>
    
    <div class="doc-links">
      <div class="doc-card">
        <h2>Frontend API</h2>
        <p>Documentation for React components, hooks, utilities, and state management.</p>
        <a href="./frontend/index.html">View Frontend API</a>
      </div>
      
      <div class="doc-card">
        <h2>Backend API</h2>
        <p>Documentation for services, controllers, models, and middleware.</p>
        <a href="./backend/index.html">View Backend API</a>
      </div>
      
      <div class="doc-card">
        <h2>Common Library</h2>
        <p>Documentation for shared types, utilities, and helper functions.</p>
        <a href="./common/index.html">View Common API</a>
      </div>
    </div>
    
    <footer>
      <p>Generated with TypeDoc | &copy; <span id="current-year"></span> Roulette Advisor AI</p>
    </footer>
  </div>
  
  <script>
    document.getElementById('current-year').textContent = new Date().getFullYear();
  </script>
</body>
</html>
EOL

# Create npm scripts in package.json
echo "Setting up package.json scripts for TypeDoc..."

# Check if root package.json exists
if [ -f "package.json" ]; then
  # Add TypeDoc scripts to the root package.json
  # Using temporary files and sed to modify the package.json
  
  # For macOS compatibility
  if [[ "$(uname)" == "Darwin" ]]; then
    sed -i '' '/"scripts": {/a\
    "docs:api:frontend": "npx typedoc --options typedoc.frontend.json",\
    "docs:api:backend": "npx typedoc --options typedoc.backend.json",\
    "docs:api:common": "npx typedoc --options typedoc.common.json",\
    "docs:api": "npm run docs:api:frontend && npm run docs:api:backend && npm run docs:api:common",
' package.json
  else
    # For Linux
    sed -i '/"scripts": {/a\
    "docs:api:frontend": "npx typedoc --options typedoc.frontend.json",\
    "docs:api:backend": "npx typedoc --options typedoc.backend.json",\
    "docs:api:common": "npx typedoc --options typedoc.common.json",\
    "docs:api": "npm run docs:api:frontend && npm run docs:api:backend && npm run docs:api:common",
' package.json
  fi
  
  echo "TypeDoc scripts added to package.json"
else
  echo "Error: Root package.json not found"
  exit 1
fi

echo "TypeDoc API documentation setup complete!" 