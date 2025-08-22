#!/usr/bin/env python3
"""
Automated Progress Collector - Git Hook and Daemon Integration
Automatically collects progress data from git commits and context changes
"""

import json
import os
import sys
import argparse
from datetime import datetime, timedelta
import subprocess
import re
from pathlib import Path

class AutomatedProgressCollector:
    def __init__(self):
        self.projects_root = "/Users/MAC/Documents/projects"
        self.admin_root = "/Users/MAC/Documents/projects/admin"
        
        # Patterns to detect work types from commit messages
        self.commit_patterns = {
            "feature": [r"feat:", r"add:", r"implement", r"create", r"new"],
            "bugfix": [r"fix:", r"bug:", r"resolve", r"patch", r"correct"],
            "refactor": [r"refactor:", r"clean", r"restructure", r"reorganize"],
            "docs": [r"docs:", r"documentation", r"readme", r"comment"],
            "test": [r"test:", r"spec:", r"coverage", r"unit", r"integration"],
            "chore": [r"chore:", r"update", r"bump", r"maintain", r"config"]
        }
        
        # Complexity indicators
        self.complexity_patterns = {
            "high": [r"major", r"breaking", r"complete", r"overhaul", r"architecture"],
            "medium": [r"enhance", r"improve", r"extend", r"modify"],
            "low": [r"minor", r"small", r"quick", r"simple", r"typo"]
        }
    
    def analyze_commit_message(self, message):
        """Analyze commit message to extract work type and complexity"""
        message_lower = message.lower()
        
        # Detect work type
        work_type = "chore"  # default
        for type_name, patterns in self.commit_patterns.items():
            if any(re.search(pattern, message_lower) for pattern in patterns):
                work_type = type_name
                break
        
        # Detect complexity
        complexity = "medium"  # default
        for complexity_name, patterns in self.complexity_patterns.items():
            if any(re.search(pattern, message_lower) for pattern in patterns):
                complexity = complexity_name
                break
        
        # Detect impact based on files and lines changed
        impact = "medium"  # Will be updated by caller with actual metrics
        
        return {
            "type": work_type,
            "complexity": complexity,
            "impact": impact
        }
    
    def collect_git_progress(self, repo_path, since_hours=1):
        """Collect progress from git commits in the last N hours"""
        if not self.is_git_repo(repo_path):
            return []
        
        try:
            # Get commits since N hours ago
            since_time = datetime.now() - timedelta(hours=since_hours)
            since_str = since_time.strftime("%Y-%m-%d %H:%M:%S")
            
            # Get commit data
            cmd = f"git log --since='{since_str}' --pretty=format:'%H|%ai|%s|%an' --numstat"
            output = subprocess.check_output(cmd, shell=True, cwd=repo_path, text=True)
            
            if not output.strip():
                return []
            
            commits = []
            current_commit = None
            
            for line in output.split('\n'):
                if '|' in line and len(line.split('|')) == 4:
                    # This is a commit line
                    if current_commit:
                        commits.append(current_commit)
                    
                    hash_val, timestamp, message, author = line.split('|')
                    
                    analysis = self.analyze_commit_message(message)
                    
                    current_commit = {
                        "hash": hash_val,
                        "timestamp": timestamp,
                        "message": message,
                        "author": author,
                        "type": analysis["type"],
                        "complexity": analysis["complexity"],
                        "impact": analysis["impact"],
                        "files_changed": [],
                        "lines_added": 0,
                        "lines_removed": 0
                    }
                elif line.strip() and '\t' in line:
                    # This is a numstat line
                    if current_commit:
                        parts = line.split('\t')
                        if len(parts) >= 3:
                            try:
                                added = int(parts[0]) if parts[0] != '-' else 0
                                removed = int(parts[1]) if parts[1] != '-' else 0
                                filename = parts[2]
                                
                                current_commit["files_changed"].append(filename)
                                current_commit["lines_added"] += added
                                current_commit["lines_removed"] += removed
                            except ValueError:
                                continue
            
            # Add the last commit
            if current_commit:
                commits.append(current_commit)
            
            # Update impact based on actual changes
            for commit in commits:
                total_changes = commit["lines_added"] + commit["lines_removed"]
                file_count = len(commit["files_changed"])
                
                if total_changes > 100 or file_count > 5:
                    commit["impact"] = "high"
                elif total_changes > 20 or file_count > 2:
                    commit["impact"] = "medium"
                else:
                    commit["impact"] = "low"
            
            return commits
            
        except Exception as e:
            print(f"Error collecting git progress: {e}")
            return []
    
    def auto_generate_accomplishments(self, commits):
        """Convert git commits to accomplishment entries"""
        accomplishments = []
        
        for commit in commits:
            # Parse timestamp
            commit_time = datetime.fromisoformat(commit["timestamp"].replace(" ", "T").replace(" +", "+"))
            
            accomplishment = {
                "time": commit_time.strftime("%H:%M"),
                "type": commit["type"],
                "title": self.generate_accomplishment_title(commit),
                "description": commit["message"],
                "files_changed": commit["files_changed"],
                "complexity": commit["complexity"],
                "impact": commit["impact"],
                "auto_generated": True,
                "git_hash": commit["hash"]
            }
            
            accomplishments.append(accomplishment)
        
        return accomplishments
    
    def generate_accomplishment_title(self, commit):
        """Generate a clean title from commit message"""
        message = commit["message"]
        
        # Remove common prefixes
        prefixes = ["feat:", "fix:", "docs:", "test:", "chore:", "refactor:"]
        for prefix in prefixes:
            if message.lower().startswith(prefix):
                message = message[len(prefix):].strip()
                break
        
        # Capitalize first letter
        if message:
            message = message[0].upper() + message[1:]
        
        # Truncate if too long
        if len(message) > 60:
            message = message[:57] + "..."
        
        return message or "Code changes"
    
    def update_repo_progress(self, repo_path, hours_back=1):
        """Update progress for a specific repository"""
        repo_name = os.path.basename(repo_path)
        progress_file = os.path.join(repo_path, "PROGRESS", "daily", f"{datetime.now().strftime('%Y-%m-%d')}.json")
        
        # Create progress directory if it doesn't exist
        os.makedirs(os.path.dirname(progress_file), exist_ok=True)
        
        # Load existing progress or create new
        if os.path.exists(progress_file):
            try:
                with open(progress_file, 'r') as f:
                    progress_data = json.load(f)
            except:
                progress_data = self.create_empty_progress(repo_name)
        else:
            progress_data = self.create_empty_progress(repo_name)
        
        # Collect git commits
        commits = self.collect_git_progress(repo_path, hours_back)
        
        if commits:
            # Generate accomplishments from commits
            new_accomplishments = self.auto_generate_accomplishments(commits)
            
            # Merge with existing accomplishments (avoid duplicates)
            existing_hashes = {acc.get("git_hash") for acc in progress_data.get("accomplishments", []) if acc.get("git_hash")}
            
            for acc in new_accomplishments:
                if acc["git_hash"] not in existing_hashes:
                    progress_data["accomplishments"].append(acc)
            
            # Update metrics
            total_commits = len(commits)
            total_files = len(set(f for commit in commits for f in commit["files_changed"]))
            total_lines_added = sum(commit["lines_added"] for commit in commits)
            total_lines_removed = sum(commit["lines_removed"] for commit in commits)
            
            progress_data["metrics"].update({
                "commits": progress_data["metrics"].get("commits", 0) + total_commits,
                "files_changed": max(progress_data["metrics"].get("files_changed", 0), total_files),
                "lines_added": progress_data["metrics"].get("lines_added", 0) + total_lines_added,
                "lines_removed": progress_data["metrics"].get("lines_removed", 0) + total_lines_removed
            })
            
            # Auto-generate daily summary if empty
            if not progress_data.get("daily_summary") and new_accomplishments:
                progress_data["daily_summary"] = self.generate_auto_summary(new_accomplishments)
            
            # Save updated progress
            with open(progress_file, 'w') as f:
                json.dump(progress_data, f, indent=2)
            
            return len(new_accomplishments)
        
        return 0
    
    def create_empty_progress(self, repo_name):
        """Create empty progress structure"""
        return {
            "repo": repo_name,
            "date": datetime.now().strftime("%Y-%m-%d"),
            "daily_summary": "",
            "accomplishments": [],
            "decisions": [],
            "blockers": [],
            "next_day_plan": [],
            "metrics": {
                "commits": 0,
                "files_changed": 0,
                "lines_added": 0,
                "lines_removed": 0,
                "tests_added": 0,
                "bugs_fixed": 0
            },
            "mood": "",
            "energy_level": 5,
            "notes": "",
            "auto_generated": True
        }
    
    def generate_auto_summary(self, accomplishments):
        """Generate automatic daily summary from accomplishments"""
        if not accomplishments:
            return ""
        
        # Count by type
        type_counts = {}
        for acc in accomplishments:
            type_counts[acc["type"]] = type_counts.get(acc["type"], 0) + 1
        
        # Generate summary
        summary_parts = []
        for work_type, count in type_counts.items():
            if count == 1:
                summary_parts.append(f"1 {work_type}")
            else:
                summary_parts.append(f"{count} {work_type}s")
        
        if len(summary_parts) == 1:
            return f"Worked on {summary_parts[0]}"
        elif len(summary_parts) == 2:
            return f"Worked on {summary_parts[0]} and {summary_parts[1]}"
        else:
            return f"Worked on {', '.join(summary_parts[:-1])}, and {summary_parts[-1]}"
    
    def is_git_repo(self, path):
        """Check if path is a git repository"""
        try:
            subprocess.check_output("git rev-parse --git-dir", shell=True, cwd=path, stderr=subprocess.DEVNULL)
            return True
        except:
            return False
    
    def collect_all_repos(self):
        """Collect progress for all repositories in the ecosystem"""
        updated_repos = []
        
        # Get all potential repo directories
        for item in os.listdir(self.projects_root):
            item_path = os.path.join(self.projects_root, item)
            
            if os.path.isdir(item_path) and not item.startswith('.'):
                if self.is_git_repo(item_path):
                    try:
                        new_accomplishments = self.update_repo_progress(item_path)
                        if new_accomplishments > 0:
                            updated_repos.append({
                                "repo": item,
                                "new_accomplishments": new_accomplishments
                            })
                    except Exception as e:
                        print(f"Error updating {item}: {e}")
        
        return updated_repos
    
    def create_git_hooks(self, repo_path):
        """Create git hooks for automatic progress collection"""
        hooks_dir = os.path.join(repo_path, ".git", "hooks")
        
        if not os.path.exists(hooks_dir):
            return False
        
        # Post-commit hook
        post_commit_hook = os.path.join(hooks_dir, "post-commit")
        hook_content = f"""#!/bin/bash
# Auto-generated progress collection hook

# Update progress after commit
python3 {self.admin_root}/scripts/automated_progress_collector.py update-repo "{repo_path}"

# Trigger ecosystem collection
python3 {self.admin_root}/scripts/automated_progress_collector.py collect-all
"""
        
        with open(post_commit_hook, 'w') as f:
            f.write(hook_content)
        
        # Make executable
        os.chmod(post_commit_hook, 0o755)
        
        return True
    
    def setup_all_hooks(self):
        """Setup git hooks for all repositories"""
        setup_count = 0
        
        for item in os.listdir(self.projects_root):
            item_path = os.path.join(self.projects_root, item)
            
            if os.path.isdir(item_path) and not item.startswith('.'):
                if self.is_git_repo(item_path):
                    if self.create_git_hooks(item_path):
                        setup_count += 1
                        print(f"✅ Setup hooks for {item}")
                    else:
                        print(f"❌ Failed to setup hooks for {item}")
        
        return setup_count

def main():
    parser = argparse.ArgumentParser(description="Automated Progress Collector")
    parser.add_argument("command", choices=[
        "update-repo", "collect-all", "setup-hooks", "analyze-commit"
    ], help="Command to execute")
    parser.add_argument("--repo", help="Repository path for update-repo command")
    parser.add_argument("--hours", type=int, default=1, help="Hours to look back for commits")
    parser.add_argument("--message", help="Commit message for analyze-commit command")
    
    args = parser.parse_args()
    
    collector = AutomatedProgressCollector()
    
    if args.command == "update-repo":
        if not args.repo:
            print("Error: --repo required for update-repo command")
            return
        
        new_accomplishments = collector.update_repo_progress(args.repo, args.hours)
        print(f"✅ Updated {os.path.basename(args.repo)}: {new_accomplishments} new accomplishments")
    
    elif args.command == "collect-all":
        updated_repos = collector.collect_all_repos()
        
        if updated_repos:
            print(f"✅ Updated {len(updated_repos)} repositories:")
            for repo_info in updated_repos:
                print(f"   • {repo_info['repo']}: {repo_info['new_accomplishments']} accomplishments")
        else:
            print("ℹ️ No new progress detected across repositories")
    
    elif args.command == "setup-hooks":
        setup_count = collector.setup_all_hooks()
        print(f"✅ Setup git hooks for {setup_count} repositories")
    
    elif args.command == "analyze-commit":
        if not args.message:
            print("Error: --message required for analyze-commit command")
            return
        
        analysis = collector.analyze_commit_message(args.message)
        print(f"Analysis: {analysis}")

if __name__ == "__main__":
    main()