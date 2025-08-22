#!/usr/bin/env python3
import os
import shutil
import json
from pathlib import Path
from datetime import datetime

SOURCE_DIR = Path("/Users/MAC/.claude/agents")
TARGET_DIR = Path("/Users/MAC/Documents/projects/caia/agents")
LOG_FILE = Path("/Users/MAC/Documents/projects/caia/temp-scripts/migration.log")

def get_category(agent_name):
    """Categorize agents based on their name and functionality"""
    if any(x in agent_name for x in ['jira', 'github', 'slack', 'api', 'chatgpt', 'twitter', 'instagram', 'reddit']):
        return 'connectors'
    elif any(x in agent_name for x in ['developer', 'architect', 'engineer', 'builder', 'frontend', 'backend', 'mobile', 'ui', 'ux']):
        return 'sme'
    elif any(x in agent_name for x in ['director', 'producer', 'shipper', 'coach', 'master']):
        return 'orchestrators'
    elif any(x in agent_name for x in ['optimizer', 'benchmarker', 'maintainer', 'automator']):
        return 'optimizers'
    elif any(x in agent_name for x in ['whimsy', 'joker', 'storyteller', 'creator', 'content']):
        return 'creative'
    elif any(x in agent_name for x in ['owner', 'analyst', 'finance', 'business', 'legal', 'compliance']):
        return 'management'
    elif any(x in agent_name for x in ['test', 'qa', 'tester']):
        return 'testing'
    elif any(x in agent_name for x in ['support', 'curator', 'synthesizer', 'memory', 'knowledge']):
        return 'support'
    return 'uncategorized'

def main():
    # Create log file directory
    LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
    
    # Create target categories
    categories = ['connectors', 'sme', 'orchestrators', 'optimizers', 'creative', 'management', 'testing', 'support', 'uncategorized']
    for cat in categories:
        (TARGET_DIR / cat).mkdir(parents=True, exist_ok=True)
    
    total = 0
    migrated_agents = []
    errors = []
    
    # Check if source directory exists
    if not SOURCE_DIR.exists():
        print(f"Source directory {SOURCE_DIR} does not exist")
        return
    
    # Migrate .md files (skip directories like jira-connect)
    for agent_file in SOURCE_DIR.glob("*.md"):
        try:
            agent_name = agent_file.stem
            category = get_category(agent_name)
            agent_dir = TARGET_DIR / category / agent_name
            agent_dir.mkdir(parents=True, exist_ok=True)
            
            # Copy the agent file as README.md
            target_file = agent_dir / "README.md"
            shutil.copy2(agent_file, target_file)
            
            migrated_agents.append(f"{agent_name} -> {category}/{agent_name}")
            total += 1
            
        except Exception as e:
            errors.append(f"Error migrating {agent_file}: {str(e)}")
    
    # Handle special case: jira-connect directory
    jira_connect_source = SOURCE_DIR / "jira-connect"
    if jira_connect_source.exists() and jira_connect_source.is_dir():
        try:
            jira_connect_target = TARGET_DIR / "connectors" / "jira-connect"
            if jira_connect_target.exists():
                shutil.rmtree(jira_connect_target)
            shutil.copytree(jira_connect_source, jira_connect_target)
            migrated_agents.append(f"jira-connect (directory) -> connectors/jira-connect")
            total += 1
        except Exception as e:
            errors.append(f"Error migrating jira-connect directory: {str(e)}")
    
    # Write log
    with open(LOG_FILE, 'w') as f:
        f.write(f"Agent Migration Log - {datetime.now().isoformat()}\n")
        f.write(f"Total agents migrated: {total}\n\n")
        f.write("Migrated agents:\n")
        for agent in migrated_agents:
            f.write(f"  {agent}\n")
        if errors:
            f.write("\nErrors:\n")
            for error in errors:
                f.write(f"  {error}\n")
    
    # Print results
    print(f"Migrated {total} agents")
    print("\nMigration details:")
    for agent in migrated_agents:
        print(f"  {agent}")
    
    if errors:
        print("\nErrors encountered:")
        for error in errors:
            print(f"  {error}")
    
    print(f"\nMigration log written to: {LOG_FILE}")

if __name__ == "__main__":
    main()