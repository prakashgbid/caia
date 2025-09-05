#!/bin/bash

# Project Organization Script
# Reorganizes the projects folder to follow the CAIA monorepo structure

set -e

PROJECTS_ROOT="/Users/MAC/Documents/projects"
CAIA_ROOT="$PROJECTS_ROOT/caia"
OLD_PROJECTS="$PROJECTS_ROOT/old-projects"
STANDALONE="$PROJECTS_ROOT/standalone-apps"

echo "🎯 Organizing Projects Directory Structure"
echo "=========================================="
echo ""

# Create archive directories
echo "📁 Creating organization directories..."
mkdir -p "$OLD_PROJECTS"
mkdir -p "$STANDALONE"
mkdir -p "$PROJECTS_ROOT/active"

# Function to safely move directory
move_if_exists() {
    local src="$1"
    local dest="$2"
    if [ -d "$src" ]; then
        echo "  Moving: $(basename "$src") → $(basename "$dest")"
        mv "$src" "$dest" 2>/dev/null || echo "    ⚠️  Already moved or in use"
    fi
}

echo ""
echo "📦 Step 1: Archiving already migrated projects..."
echo "-------------------------------------------------"

# These projects have been migrated to CAIA packages
move_if_exists "$PROJECTS_ROOT/paraforge" "$OLD_PROJECTS/paraforge"
move_if_exists "$PROJECTS_ROOT/chatgpt-mcp-server" "$OLD_PROJECTS/chatgpt-mcp-server"
move_if_exists "$PROJECTS_ROOT/jira-connect" "$OLD_PROJECTS/jira-connect"
move_if_exists "$PROJECTS_ROOT/autonomous-chatgpt-agent" "$OLD_PROJECTS/autonomous-chatgpt-agent"
move_if_exists "$PROJECTS_ROOT/smart-agents-training-system" "$OLD_PROJECTS/smart-agents-training-system"

# OmniMind modules that were extracted
if [ -d "$PROJECTS_ROOT/omnimind" ]; then
    echo "  Archiving OmniMind (modules extracted to CAIA)..."
    mv "$PROJECTS_ROOT/omnimind" "$OLD_PROJECTS/omnimind" 2>/dev/null || echo "    ⚠️  Already moved"
fi

echo ""
echo "🚀 Step 2: Organizing standalone applications..."
echo "-----------------------------------------------"

# ADP and RC are standalone projects that consume CAIA
move_if_exists "$PROJECTS_ROOT/application-development-platform" "$STANDALONE/adp"
move_if_exists "$PROJECTS_ROOT/roulette-community" "$STANDALONE/roulette-community"

# Orchestra Platform remains standalone (integration package created)
move_if_exists "$PROJECTS_ROOT/orchestra-platform" "$STANDALONE/orchestra-platform"

# OmniMind Wiki can be standalone documentation
move_if_exists "$PROJECTS_ROOT/omnimind-wiki" "$STANDALONE/omnimind-wiki"

echo ""
echo "🔧 Step 3: Moving utility projects..."
echo "-------------------------------------"

# Claude Code Ultimate is a tool/utility
if [ -d "$PROJECTS_ROOT/claude-code-ultimate" ]; then
    echo "  Moving Claude Code Ultimate to CAIA tools..."
    mv "$PROJECTS_ROOT/claude-code-ultimate" "$CAIA_ROOT/tools/claude-code-ultimate" 2>/dev/null || echo "    ⚠️  Already moved"
fi

echo ""
echo "📝 Step 4: Organizing documentation and scripts..."
echo "-------------------------------------------------"

# Create docs directory in projects root
mkdir -p "$PROJECTS_ROOT/docs"

# Move architecture and strategy documents
for doc in CAIA-ARCHITECTURE.md ECOSYSTEM-STRATEGY.md ORCHESTRA-POSITIONING.md PRISM-API-DESIGN.md README-SUPER-AGENT.md SUPERLLM-ARCHITECTURE-ANALYSIS.md SUPERLLM-IMPLEMENTATION-PLAN.md; do
    if [ -f "$PROJECTS_ROOT/$doc" ]; then
        echo "  Moving $doc to docs/"
        mv "$PROJECTS_ROOT/$doc" "$PROJECTS_ROOT/docs/$doc" 2>/dev/null || echo "    ⚠️  Already moved"
    fi
done

# Move setup scripts to scripts directory
mkdir -p "$PROJECTS_ROOT/scripts"
for script in claude-super-agent-setup.sh install-super-agent.sh orchestra-init.sh organize-projects.sh; do
    if [ -f "$PROJECTS_ROOT/$script" ]; then
        echo "  Moving $script to scripts/"
        mv "$PROJECTS_ROOT/$script" "$PROJECTS_ROOT/scripts/$script" 2>/dev/null || echo "    ⚠️  Already moved"
    fi
done

# Move TypeScript files to appropriate location
if [ -f "$PROJECTS_ROOT/claude-code-super-agent.ts" ]; then
    echo "  Moving claude-code-super-agent.ts to CAIA..."
    mkdir -p "$CAIA_ROOT/examples/super-agent"
    mv "$PROJECTS_ROOT/claude-code-super-agent.ts" "$CAIA_ROOT/examples/super-agent/claude-code-super-agent.ts" 2>/dev/null
fi

echo ""
echo "🔗 Step 5: Creating convenient symlinks..."
echo "------------------------------------------"

# Create symlinks for active development
cd "$PROJECTS_ROOT"

# CAIA is the main project
if [ ! -L "MAIN" ] && [ -d "caia" ]; then
    ln -s caia MAIN
    echo "  Created symlink: MAIN → caia"
fi

# Admin tools
if [ ! -L "ADMIN" ] && [ -d "admin" ]; then
    ln -s admin ADMIN
    echo "  Created symlink: ADMIN → admin"
fi

# Standalone apps
if [ ! -L "APPS" ] && [ -d "standalone-apps" ]; then
    ln -s standalone-apps APPS
    echo "  Created symlink: APPS → standalone-apps"
fi

echo ""
echo "📊 Step 6: Creating projects inventory..."
echo "----------------------------------------"

cat > "$PROJECTS_ROOT/PROJECTS-STRUCTURE.md" << 'EOF'
# Projects Directory Structure

## 🧠 Main Project
- **caia/** - Chief AI Agent monorepo (MAIN)
  - packages/agents/ - AI agents
  - packages/engines/ - Processing engines
  - packages/integrations/ - Third-party integrations
  - packages/modules/ - Business modules
  - packages/utils/ - Utilities
  - tools/ - Development tools
  - examples/ - Example implementations

## 🛠️ Administration
- **admin/** - Admin scripts and tools (ADMIN)
  - scripts/ - Context capture, monitoring, updates
  - contexts/ - Captured project contexts
  - decisions/ - Architectural decisions log

## 🚀 Standalone Applications
- **standalone-apps/** - Applications that consume CAIA (APPS)
  - adp/ - Application Development Platform
  - roulette-community/ - Roulette Community app
  - orchestra-platform/ - Orchestra LLM consensus platform
  - omnimind-wiki/ - Documentation wiki

## 📚 Documentation
- **docs/** - Architecture and strategy documents
  - All high-level architecture docs
  - Strategy and planning documents
  - Implementation guides

## 🔧 Scripts
- **scripts/** - Setup and utility scripts
  - Installation scripts
  - Organization scripts
  - Initialization scripts

## 📦 Archived
- **old-projects/** - Migrated/archived projects
  - Projects that have been integrated into CAIA
  - Legacy implementations

## Quick Access Symlinks
- MAIN → caia (primary development)
- ADMIN → admin (administration tools)
- APPS → standalone-apps (consuming applications)

## Development Workflow
1. Primary development happens in `caia/`
2. Admin tools manage the entire ecosystem
3. Standalone apps consume CAIA packages
4. Documentation in `docs/` for high-level planning

EOF

echo "  Created PROJECTS-STRUCTURE.md"

echo ""
echo "✅ Organization Complete!"
echo "========================"
echo ""
echo "📋 Summary of changes:"
echo "  - Migrated projects archived to old-projects/"
echo "  - Standalone apps organized in standalone-apps/"
echo "  - Documentation consolidated in docs/"
echo "  - Scripts organized in scripts/"
echo "  - Created convenient symlinks for navigation"
echo ""
echo "🎯 Current structure:"
echo "  MAIN (caia/) - Primary monorepo development"
echo "  ADMIN (admin/) - Administrative tools"
echo "  APPS (standalone-apps/) - Applications using CAIA"
echo ""
echo "Next steps:"
echo "  1. cd MAIN && npm install"
echo "  2. Review old-projects/ and delete if no longer needed"
echo "  3. Update any hardcoded paths in scripts"