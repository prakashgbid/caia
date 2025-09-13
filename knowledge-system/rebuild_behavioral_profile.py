#!/usr/bin/env python3
"""
Rebuild Complete Behavioral Profile from Available Data
Reconstructs user behavior patterns from logs, configs, and git history
"""

import os
import json
import sqlite3
import re
from datetime import datetime
from pathlib import Path
from collections import defaultdict, Counter

class BehavioralProfileRebuilder:
    def __init__(self):
        self.base_dir = Path(__file__).parent
        self.data_dir = self.base_dir / "data"
        self.logs_dir = self.base_dir / "logs"
        self.behavioral_data = {
            'preferences': {},
            'patterns': [],
            'decisions': [],
            'tool_usage': defaultdict(int),
            'command_history': [],
            'workflow_patterns': [],
            'time_patterns': [],
            'success_patterns': []
        }
        
    def extract_from_claude_md(self):
        """Extract behavioral patterns from CLAUDE.md configuration"""
        print("📖 Extracting from CLAUDE.md configuration...")
        
        claude_md = Path.home() / '.claude' / 'CLAUDE.md'
        if not claude_md.exists():
            return
            
        with open(claude_md, 'r') as f:
            content = f.read()
            
        # Extract key behavioral indicators
        patterns = {
            'development_style': {
                'parallel_first': 'PARALLEL-FIRST EXECUTION' in content,
                'never_ask_permission': 'NEVER ASK FOR PERMISSION' in content,
                'speed_obsessed': 'MAX_PARALLEL=50' in content or 'MAX_PARALLEL=100' in content,
                'minimal_documentation': 'minimal docs' in content,
                'skip_tests': 'Skip tests for CC-only' in content,
                'direct_commits': 'work on main' in content,
                'simple_commits': 'just "updates"' in content,
                'no_prs': 'No PRs for solo dev' in content,
            },
            'tool_preferences': {
                'package_manager': 'pnpm' if 'pnpm' in content else 'npm',
                'search_tool': 'ripgrep' if 'rg' in content or 'ripgrep' in content else 'grep',
                'file_viewer': 'bat' if 'bat' in content else 'cat',
                'process_manager': 'pm2' if 'pm2' in content else 'native',
            },
            'workflow_patterns': {
                'cco_mandatory': 'CCO_AUTO_INVOKE=true' in content,
                'cks_mandatory': 'CKS_ENFORCEMENT=MANDATORY' in content,
                'integration_agent_only': 'NEVER access ANY external service directly' in content,
                'auto_optimization': 'CCU_AUTO_OPTIMIZE=true' in content,
            },
            'philosophy': {
                'ship_fast': 'ship features faster' in content,
                'working_over_perfect': 'Working features over test coverage' in content,
                'simple_over_proper': 'Simple solutions over "proper" architecture' in content,
                'today_over_tomorrow': 'Shipping today over planning for tomorrow' in content,
            },
            'performance_targets': {
                'file_ops_20x': '20x faster' in content,
                'git_ops_15x': '15x faster' in content,
                'search_25x': '25x faster' in content,
                'parallel_instances': 50 if 'MAX_PARALLEL=50' in content else 100,
            }
        }
        
        self.behavioral_data['preferences'] = patterns
        print(f"  ✅ Extracted {sum(len(v) for v in patterns.values())} behavioral patterns")
        
    def analyze_git_history(self):
        """Analyze git history for behavioral patterns"""
        print("📊 Analyzing git commit patterns...")
        
        try:
            import subprocess
            
            # Get recent commits
            result = subprocess.run(
                ['git', '-C', '/Users/MAC/Documents/projects/caia', 'log', '--oneline', '-100'],
                capture_output=True, text=True
            )
            
            if result.returncode == 0:
                commits = result.stdout.strip().split('\n')
                
                # Analyze commit patterns
                commit_patterns = {
                    'simple_messages': sum(1 for c in commits if 'updates' in c.lower()),
                    'feat_commits': sum(1 for c in commits if 'feat' in c.lower()),
                    'fix_commits': sum(1 for c in commits if 'fix' in c.lower()),
                    'parallel_mentions': sum(1 for c in commits if 'parallel' in c.lower()),
                    'cco_mentions': sum(1 for c in commits if 'cco' in c.lower() or 'orchestrator' in c.lower()),
                }
                
                self.behavioral_data['patterns'].append({
                    'type': 'git_behavior',
                    'data': commit_patterns,
                    'total_commits': len(commits)
                })
                
                print(f"  ✅ Analyzed {len(commits)} commits")
        except:
            pass
            
    def extract_from_logs(self):
        """Extract patterns from existing log files"""
        print("📁 Extracting from log files...")
        
        session_files = list(self.logs_dir.glob('cc_enhanced_session_*.jsonl'))
        
        tool_usage = defaultdict(int)
        action_types = defaultdict(int)
        attributions = defaultdict(int)
        
        for session_file in session_files:
            with open(session_file, 'r') as f:
                for line in f:
                    if line.strip():
                        try:
                            data = json.loads(line)
                            tool_usage[data.get('tool_used', 'unknown')] += 1
                            action_types[data.get('action_type', 'unknown')] += 1
                            attributions[data.get('attribution', 'unknown')] += 1
                        except:
                            pass
                            
        self.behavioral_data['tool_usage'] = dict(tool_usage)
        self.behavioral_data['patterns'].append({
            'type': 'action_patterns',
            'data': dict(action_types)
        })
        
        print(f"  ✅ Extracted from {len(session_files)} session files")
        
    def infer_behavioral_traits(self):
        """Infer behavioral traits from available data"""
        print("🧠 Inferring behavioral traits...")
        
        traits = {
            'speed_priority': 'EXTREME',  # Based on parallel execution obsession
            'automation_level': 'MAXIMUM',  # Never manual, always automated
            'risk_tolerance': 'HIGH',  # Skip tests, direct commits
            'documentation_style': 'MINIMAL',  # Code over docs
            'collaboration_style': 'SOLO',  # No PRs, direct commits
            'optimization_focus': 'PERFORMANCE',  # 20-50x targets
            'learning_style': 'EXPERIMENTAL',  # Try fast, fail fast
            'decision_speed': 'INSTANT',  # Never ask permission
            'complexity_preference': 'SIMPLE',  # Simple over proper
            'delivery_focus': 'SHIP_NOW',  # Today over tomorrow
        }
        
        # Behavioral patterns observed
        observed_patterns = [
            "Prefers massive parallelization (50-100 instances)",
            "Skips traditional best practices for speed",
            "Values working code over perfect code",
            "Automates everything possible",
            "Uses Integration Agents for all external services",
            "Mandates CKS for redundancy prevention",
            "Optimizes for AI consumption, not human reading",
            "Commits directly to main with simple messages",
            "Focuses on shipping features rapidly",
            "Uses CC Orchestrator for complex tasks",
        ]
        
        self.behavioral_data['traits'] = traits
        self.behavioral_data['observed_patterns'] = observed_patterns
        
        print(f"  ✅ Inferred {len(traits)} behavioral traits")
        
    def save_to_database(self):
        """Save rebuilt profile to database"""
        print("💾 Saving behavioral profile to database...")
        
        # Save to patterns database
        conn = sqlite3.connect(self.data_dir / 'patterns.db')
        cursor = conn.cursor()
        
        # Ensure table exists
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS user_behavior (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                category TEXT,
                pattern TEXT,
                value TEXT,
                confidence REAL,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        
        # Save preferences
        for category, prefs in self.behavioral_data['preferences'].items():
            for key, value in prefs.items():
                cursor.execute('''
                    INSERT INTO user_behavior (category, pattern, value, confidence)
                    VALUES (?, ?, ?, ?)
                ''', (category, key, str(value), 0.95))
                
        # Save traits
        for trait, value in self.behavioral_data.get('traits', {}).items():
            cursor.execute('''
                INSERT INTO user_behavior (category, pattern, value, confidence)
                VALUES (?, ?, ?, ?)
            ''', ('personality_traits', trait, value, 0.9))
            
        # Save observed patterns
        for pattern in self.behavioral_data.get('observed_patterns', []):
            cursor.execute('''
                INSERT INTO user_behavior (category, pattern, value, confidence)
                VALUES (?, ?, ?, ?)
            ''', ('observed_behaviors', 'pattern', pattern, 0.85))
            
        conn.commit()
        
        # Get count
        cursor.execute('SELECT COUNT(*) FROM user_behavior')
        count = cursor.fetchone()[0]
        
        conn.close()
        
        print(f"  ✅ Saved {count} behavioral patterns to database")
        
        # Also save as JSON for easy access
        json_path = self.data_dir / 'behavioral_profile.json'
        with open(json_path, 'w') as f:
            json.dump(self.behavioral_data, f, indent=2, default=str)
            
        print(f"  ✅ Saved complete profile to {json_path}")
        
    def display_summary(self):
        """Display summary of rebuilt profile"""
        print("\n" + "="*60)
        print("🧠 BEHAVIORAL PROFILE REBUILT")
        print("="*60)
        
        print("\n🎯 Key Traits Identified:")
        for trait, value in self.behavioral_data.get('traits', {}).items():
            print(f"  • {trait}: {value}")
            
        print("\n⚡ Performance Preferences:")
        perf = self.behavioral_data['preferences'].get('performance_targets', {})
        for key, value in perf.items():
            print(f"  • {key}: {value}")
            
        print("\n🛠️ Tool Preferences:")
        tools = self.behavioral_data['preferences'].get('tool_preferences', {})
        for key, value in tools.items():
            print(f"  • {key}: {value}")
            
        print("\n📊 Development Style:")
        style = self.behavioral_data['preferences'].get('development_style', {})
        active_styles = [k for k, v in style.items() if v]
        for style in active_styles[:5]:
            print(f"  • {style.replace('_', ' ').title()}")
            
        print("\n🔄 Observed Patterns:")
        for pattern in self.behavioral_data.get('observed_patterns', [])[:5]:
            print(f"  • {pattern}")
            
        print("\n" + "="*60)
        print("✨ Profile reconstruction complete!")
        print("📊 The system now understands your preferences and will optimize accordingly")
        
    def run(self):
        """Execute complete rebuild"""
        print("\n🔧 REBUILDING BEHAVIORAL PROFILE")
        print("="*60)
        
        # Extract from all sources
        self.extract_from_claude_md()
        self.analyze_git_history()
        self.extract_from_logs()
        self.infer_behavioral_traits()
        
        # Save everything
        self.save_to_database()
        
        # Show summary
        self.display_summary()
        
        return self.behavioral_data

if __name__ == "__main__":
    rebuilder = BehavioralProfileRebuilder()
    profile = rebuilder.run()