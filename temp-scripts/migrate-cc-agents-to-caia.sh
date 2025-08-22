#!/bin/bash

# Temporary script to migrate CC agents to CAIA
# Will be deleted after migration

set -e

SOURCE_DIR="/Users/MAC/.claude/agents"
TARGET_DIR="/Users/MAC/Documents/projects/caia/agents"
PACKAGES_DIR="/Users/MAC/Documents/projects/caia/packages/agents"

echo "🚀 Migrating CC Agents to CAIA"
echo "================================"

# Create agent directories based on CAIA categories
mkdir -p "$TARGET_DIR/connectors"
mkdir -p "$TARGET_DIR/sme"
mkdir -p "$TARGET_DIR/orchestrators"
mkdir -p "$TARGET_DIR/optimizers"
mkdir -p "$TARGET_DIR/creative"
mkdir -p "$TARGET_DIR/support"
mkdir -p "$TARGET_DIR/management"
mkdir -p "$TARGET_DIR/testing"

# Function to determine category based on agent name
get_category() {
    local agent_name=$1
    
    # Connectors (integrate with external services)
    if [[ "$agent_name" =~ (jira|github|slack|discord|salesforce|api) ]]; then
        echo "connectors"
    # SME (Subject Matter Experts for technologies)
    elif [[ "$agent_name" =~ (developer|architect|engineer|builder|designer) ]] && 
         [[ ! "$agent_name" =~ (workflow|performance|infrastructure) ]]; then
        echo "sme"
    # Orchestrators (coordinate complex workflows)
    elif [[ "$agent_name" =~ (director|producer|shipper|coach) ]]; then
        echo "orchestrators"
    # Optimizers (improve performance and efficiency)
    elif [[ "$agent_name" =~ (optimizer|benchmarker|maintainer|evaluator|analyzer) ]]; then
        echo "optimizers"
    # Creative (design and content)
    elif [[ "$agent_name" =~ (whimsy|joker|storyteller|guardian|creator) ]]; then
        echo "creative"
    # Management (project and team management)
    elif [[ "$agent_name" =~ (owner|master|analyst) ]]; then
        echo "management"
    # Testing (quality assurance)
    elif [[ "$agent_name" =~ (test|qa) ]]; then
        echo "testing"
    # Support (help and documentation)
    elif [[ "$agent_name" =~ (support|responder|curator|synthesizer) ]]; then
        echo "support"
    else
        echo "uncategorized"
    fi
}

# Counter for progress
total=0
migrated=0
failed=0

# Create migration log
LOG_FILE="$TARGET_DIR/../temp-scripts/migration.log"
echo "Migration started at $(date)" > "$LOG_FILE"

# Process each agent
for agent_file in "$SOURCE_DIR"/*.md; do
    if [ -f "$agent_file" ]; then
        agent_name=$(basename "$agent_file" .md)
        category=$(get_category "$agent_name")
        total=$((total + 1))
        
        echo -n "[$total] Migrating $agent_name to $category... "
        
        # Create agent directory
        agent_dir="$TARGET_DIR/$category/$agent_name"
        
        if mkdir -p "$agent_dir"; then
            # Copy agent documentation
            cp "$agent_file" "$agent_dir/README.md"
            
            # Create package.json for the agent
            cat > "$agent_dir/package.json" << EOF
{
  "name": "@caia/agent-$agent_name",
  "version": "0.1.0",
  "description": "CAIA $agent_name agent",
  "main": "index.js",
  "scripts": {
    "test": "echo 'No tests yet'"
  },
  "keywords": ["caia", "agent", "$category", "$agent_name"],
  "author": "CAIA",
  "license": "MIT"
}
EOF
            
            # Create basic index.js
            cat > "$agent_dir/index.js" << EOF
/**
 * CAIA $agent_name Agent
 * Category: $category
 * Migrated from Claude Code agents
 */

module.exports = {
  name: '$agent_name',
  category: '$category',
  description: 'Migrated from CC agents - implementation pending',
  
  async execute(task) {
    // TODO: Implement agent logic
    throw new Error('Agent implementation pending migration');
  }
};
EOF
            
            echo "✅"
            echo "  ✅ $agent_name -> $category" >> "$LOG_FILE"
            migrated=$((migrated + 1))
        else
            echo "❌"
            echo "  ❌ $agent_name: Failed to create directory" >> "$LOG_FILE"
            failed=$((failed + 1))
        fi
    fi
done

# Create category summary
echo ""
echo "📊 Migration Summary"
echo "==================="
echo "Total agents: $total"
echo "✅ Migrated: $migrated"
echo "❌ Failed: $failed"
echo ""

# Show category distribution
echo "Category Distribution:"
for category in connectors sme orchestrators optimizers creative management testing support; do
    count=$(ls -1 "$TARGET_DIR/$category" 2>/dev/null | wc -l | tr -d ' ')
    if [ "$count" -gt 0 ]; then
        echo "  $category: $count agents"
    fi
done

# Update CAIA agent registry
echo ""
echo "📝 Updating CAIA agent registry..."

# Create agent registry file
cat > "$TARGET_DIR/AGENT_REGISTRY.md" << EOF
# 🗂️ CAIA Agent Registry

*Auto-generated on $(date)*

## Agent Categories and Count

EOF

for category in connectors sme orchestrators optimizers creative management testing support; do
    agents=$(ls -1 "$TARGET_DIR/$category" 2>/dev/null)
    if [ -n "$agents" ]; then
        count=$(echo "$agents" | wc -l | tr -d ' ')
        echo "### $category ($count agents)" >> "$TARGET_DIR/AGENT_REGISTRY.md"
        echo "" >> "$TARGET_DIR/AGENT_REGISTRY.md"
        for agent in $agents; do
            echo "- \`$agent\`" >> "$TARGET_DIR/AGENT_REGISTRY.md"
        done
        echo "" >> "$TARGET_DIR/AGENT_REGISTRY.md"
    fi
done

echo "✅ Agent registry updated"

# Final status
echo ""
echo "✅ Migration Complete!"
echo "Log file: $LOG_FILE"
echo ""
echo "Next steps:"
echo "1. Review agents in $TARGET_DIR"
echo "2. Update agent implementations"
echo "3. Configure as CAIA packages"
echo "4. Delete this temp script"