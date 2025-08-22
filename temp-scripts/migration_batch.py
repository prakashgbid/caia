#!/usr/bin/env python3
"""
Agent Migration Batch Script
Migrates agents from .claude/agents to CAIA project structure
"""

# Agent categorization mapping
AGENT_CATEGORIES = {
    # Connectors - External integrations and APIs
    'connectors': [
        'jira-automation', 'chatgpt-access', 'twitter-engager', 
        'instagram-curator', 'reddit-community-builder', 'api-tester'
    ],
    
    # SME - Subject Matter Experts for technical domains
    'sme': [
        'ai-engineer', 'backend-architect', 'frontend-developer', 
        'mobile-app-builder', 'ui-designer', 'ux-researcher', 
        'devops-automator', 'rapid-prototyper', 'solution-architect', 
        'enterprise-architect'
    ],
    
    # Orchestrators - Project and team management
    'orchestrators': [
        'project-director', 'studio-producer', 'studio-coach', 
        'project-shipper', 'scrum-master'
    ],
    
    # Optimizers - Performance and process improvement
    'optimizers': [
        'workflow-optimizer', 'performance-benchmarker', 
        'app-store-optimizer', 'infrastructure-maintainer'
    ],
    
    # Creative - Content and creative work
    'creative': [
        'content-creator', 'visual-storyteller', 'whimsy-injector', 
        'joker', 'brand-guardian'
    ],
    
    # Management - Business and strategic roles
    'management': [
        'business-analyst', 'product-owner', 'chief-architecture-officer', 
        'finance-tracker', 'legal-compliance-checker'
    ],
    
    # Testing - Quality assurance and testing
    'testing': [
        'test-writer-fixer', 'test-results-analyzer', 'tool-evaluator'
    ],
    
    # Support - Helper and utility agents
    'support': [
        'support-responder', 'knowledge-curator', 'memory-manager', 
        'feedback-synthesizer', 'analytics-reporter'
    ],
    
    # Uncategorized - Agents that don't fit other categories
    'uncategorized': [
        'growth-hacker', 'trend-researcher', 'sprint-prioritizer'
    ]
}

# Reverse mapping for quick lookup
AGENT_TO_CATEGORY = {}
for category, agents in AGENT_CATEGORIES.items():
    for agent in agents:
        AGENT_TO_CATEGORY[agent] = category

print("Agent Migration Categorization:")
print("=" * 50)
for category, agents in AGENT_CATEGORIES.items():
    print(f"\n{category.upper()} ({len(agents)} agents):")
    for agent in agents:
        print(f"  - {agent}")

print(f"\nTotal agents to migrate: {sum(len(agents) for agents in AGENT_CATEGORIES.values())}")
print("\nMigration ready - categories defined.")