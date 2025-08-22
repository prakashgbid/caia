#!/usr/bin/env python3
"""
Context Capture System for Projects
Captures comprehensive context including code changes, decisions, and progress
"""

import os
import json
import hashlib
import subprocess
from datetime import datetime, timedelta
from pathlib import Path
import argparse
from typing import Dict, List, Any
import difflib

# Configuration
PROJECTS_ROOT = "/Users/MAC/Documents/projects"
ADMIN_ROOT = os.path.join(PROJECTS_ROOT, "admin")
CONTEXT_DIR = os.path.join(ADMIN_ROOT, "context")
DECISIONS_DIR = os.path.join(ADMIN_ROOT, "decisions")
LOGS_DIR = os.path.join(ADMIN_ROOT, "logs")

# Files/folders to ignore
IGNORE_PATTERNS = {
    "node_modules", "__pycache__", ".git", "dist", "build", 
    ".next", ".cache", "coverage", "*.pyc", "*.log", ".DS_Store"
}

class ProjectContextCapture:
    def __init__(self, hours_back: int = 1):
        self.projects_root = Path(PROJECTS_ROOT)
        self.context_dir = Path(CONTEXT_DIR)
        self.decisions_dir = Path(DECISIONS_DIR)
        self.logs_dir = Path(LOGS_DIR)
        self.hours_back = hours_back
        self.timestamp = datetime.now()
        self.context_file = self.context_dir / f"context_{self.timestamp.strftime('%Y%m%d_%H%M%S')}.json"
        
        # Create directories if they don't exist
        self.context_dir.mkdir(parents=True, exist_ok=True)
        self.decisions_dir.mkdir(parents=True, exist_ok=True)
        self.logs_dir.mkdir(parents=True, exist_ok=True)
        
    def should_ignore(self, path: Path) -> bool:
        """Check if path should be ignored"""
        path_str = str(path)
        for pattern in IGNORE_PATTERNS:
            if pattern in path_str or path.name.startswith('.'):
                return True
        return False
    
    def get_git_changes(self, project_path: Path) -> Dict[str, Any]:
        """Get recent git changes for a project"""
        changes = {
            "commits": [],
            "modified_files": [],
            "untracked_files": [],
            "branches": [],
            "current_branch": None
        }
        
        try:
            # Check if it's a git repo
            if not (project_path / ".git").exists():
                return changes
            
            os.chdir(project_path)
            
            # Get current branch
            current_branch = subprocess.run(
                ["git", "branch", "--show-current"],
                capture_output=True, text=True
            ).stdout.strip()
            changes["current_branch"] = current_branch
            
            # Get recent commits (last X hours)
            since_time = (self.timestamp - timedelta(hours=self.hours_back)).strftime('%Y-%m-%d %H:%M:%S')
            commits_output = subprocess.run(
                ["git", "log", f"--since='{since_time}'", "--pretty=format:%H|%an|%ae|%ad|%s", "--date=iso"],
                capture_output=True, text=True
            ).stdout.strip()
            
            if commits_output:
                for line in commits_output.split('\n'):
                    if line:
                        parts = line.split('|')
                        if len(parts) >= 5:
                            changes["commits"].append({
                                "hash": parts[0],
                                "author": parts[1],
                                "email": parts[2],
                                "date": parts[3],
                                "message": parts[4]
                            })
            
            # Get modified files
            status_output = subprocess.run(
                ["git", "status", "--porcelain"],
                capture_output=True, text=True
            ).stdout.strip()
            
            if status_output:
                for line in status_output.split('\n'):
                    if line:
                        status = line[:2].strip()
                        file_path = line[3:]
                        if status == 'M':
                            changes["modified_files"].append(file_path)
                        elif status == '??':
                            changes["untracked_files"].append(file_path)
            
            # Get all branches
            branches_output = subprocess.run(
                ["git", "branch", "-a"],
                capture_output=True, text=True
            ).stdout.strip()
            
            if branches_output:
                changes["branches"] = [b.strip().replace('* ', '') for b in branches_output.split('\n') if b]
                
        except Exception as e:
            changes["error"] = str(e)
        finally:
            os.chdir(self.projects_root)
            
        return changes
    
    def scan_project(self, project_path: Path) -> Dict[str, Any]:
        """Deep scan of a single project"""
        project_info = {
            "name": project_path.name,
            "path": str(project_path),
            "last_modified": datetime.fromtimestamp(project_path.stat().st_mtime).isoformat(),
            "size_bytes": 0,
            "file_count": 0,
            "directory_count": 0,
            "recent_changes": [],
            "git_info": {},
            "key_files": {},
            "technologies": set(),
            "todos": [],
            "dependencies": {}
        }
        
        # Get git changes
        project_info["git_info"] = self.get_git_changes(project_path)
        
        # Scan project structure
        for root, dirs, files in os.walk(project_path):
            root_path = Path(root)
            
            # Filter out ignored directories
            dirs[:] = [d for d in dirs if not self.should_ignore(root_path / d)]
            
            project_info["directory_count"] += len(dirs)
            
            for file in files:
                file_path = root_path / file
                if self.should_ignore(file_path):
                    continue
                    
                project_info["file_count"] += 1
                project_info["size_bytes"] += file_path.stat().st_size
                
                # Check if file was recently modified
                file_mtime = datetime.fromtimestamp(file_path.stat().st_mtime)
                if file_mtime > (self.timestamp - timedelta(hours=self.hours_back)):
                    project_info["recent_changes"].append({
                        "file": str(file_path.relative_to(project_path)),
                        "modified": file_mtime.isoformat()
                    })
                
                # Detect technologies and key files
                if file == "package.json":
                    project_info["technologies"].add("Node.js")
                    project_info["key_files"]["package.json"] = str(file_path.relative_to(project_path))
                    # Read dependencies
                    try:
                        with open(file_path, 'r') as f:
                            pkg = json.load(f)
                            project_info["dependencies"]["npm"] = list(pkg.get("dependencies", {}).keys())
                    except:
                        pass
                elif file == "requirements.txt":
                    project_info["technologies"].add("Python")
                    project_info["key_files"]["requirements.txt"] = str(file_path.relative_to(project_path))
                elif file == "Cargo.toml":
                    project_info["technologies"].add("Rust")
                elif file == "go.mod":
                    project_info["technologies"].add("Go")
                elif file.endswith(".tsx") or file.endswith(".ts"):
                    project_info["technologies"].add("TypeScript")
                elif file == "docker-compose.yml" or file == "Dockerfile":
                    project_info["technologies"].add("Docker")
                
                # Scan for TODOs in code files
                if file.endswith(('.py', '.js', '.ts', '.tsx', '.go', '.rs', '.java')):
                    try:
                        with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                            lines = f.readlines()
                            for i, line in enumerate(lines, 1):
                                if 'TODO' in line or 'FIXME' in line or 'HACK' in line:
                                    project_info["todos"].append({
                                        "file": str(file_path.relative_to(project_path)),
                                        "line": i,
                                        "content": line.strip()
                                    })
                    except:
                        pass
        
        # Convert set to list for JSON serialization
        project_info["technologies"] = list(project_info["technologies"])
        
        return project_info
    
    def read_recent_decisions(self) -> List[Dict[str, Any]]:
        """Read recent decision logs"""
        decisions = []
        
        for decision_file in self.decisions_dir.glob("*.json"):
            file_mtime = datetime.fromtimestamp(decision_file.stat().st_mtime)
            if file_mtime > (self.timestamp - timedelta(hours=self.hours_back)):
                try:
                    with open(decision_file, 'r') as f:
                        decision_data = json.load(f)
                        # Handle both single decisions and lists of decisions
                        if isinstance(decision_data, list):
                            decisions.extend(decision_data)
                        else:
                            decisions.append(decision_data)
                except:
                    pass
        
        return sorted(decisions, key=lambda x: x.get('timestamp', '') if isinstance(x, dict) else '', reverse=True)
    
    def get_previous_context(self) -> Dict[str, Any]:
        """Get the most recent previous context for comparison"""
        context_files = sorted(self.context_dir.glob("context_*.json"))
        if len(context_files) > 0:
            try:
                with open(context_files[-1], 'r') as f:
                    return json.load(f)
            except:
                pass
        return {}
    
    def capture_context(self) -> Dict[str, Any]:
        """Main method to capture full context"""
        print(f"🔍 Capturing context at {self.timestamp.strftime('%Y-%m-%d %H:%M:%S')}")
        
        context = {
            "timestamp": self.timestamp.isoformat(),
            "hours_covered": self.hours_back,
            "projects": {},
            "recent_decisions": [],
            "summary": {
                "total_projects": 0,
                "active_projects": 0,
                "total_commits": 0,
                "total_todos": 0,
                "total_recent_changes": 0
            },
            "changes_since_last": {}
        }
        
        # Get previous context for comparison
        prev_context = self.get_previous_context()
        
        # Scan each project
        for project_dir in self.projects_root.iterdir():
            if project_dir.is_dir() and not self.should_ignore(project_dir):
                if project_dir.name == "admin":
                    continue  # Skip admin folder itself
                    
                print(f"  📦 Scanning {project_dir.name}...")
                project_info = self.scan_project(project_dir)
                context["projects"][project_dir.name] = project_info
                
                # Update summary
                context["summary"]["total_projects"] += 1
                if project_info["recent_changes"] or project_info["git_info"]["commits"]:
                    context["summary"]["active_projects"] += 1
                context["summary"]["total_commits"] += len(project_info["git_info"]["commits"])
                context["summary"]["total_todos"] += len(project_info["todos"])
                context["summary"]["total_recent_changes"] += len(project_info["recent_changes"])
        
        # Read recent decisions
        context["recent_decisions"] = self.read_recent_decisions()
        
        # Compare with previous context
        if prev_context:
            context["changes_since_last"] = self.compare_contexts(prev_context, context)
        
        # Save context
        with open(self.context_file, 'w') as f:
            json.dump(context, f, indent=2, default=str)
        
        print(f"✅ Context saved to {self.context_file}")
        print(f"📊 Summary: {context['summary']['active_projects']}/{context['summary']['total_projects']} active projects")
        print(f"📝 {context['summary']['total_commits']} commits, {context['summary']['total_recent_changes']} file changes")
        print(f"📌 {context['summary']['total_todos']} TODOs found")
        
        return context
    
    def compare_contexts(self, prev: Dict, curr: Dict) -> Dict[str, Any]:
        """Compare previous and current context to highlight changes"""
        changes = {
            "new_projects": [],
            "removed_projects": [],
            "new_commits": 0,
            "new_todos": 0,
            "new_decisions": len(curr.get("recent_decisions", []))
        }
        
        prev_projects = set(prev.get("projects", {}).keys())
        curr_projects = set(curr.get("projects", {}).keys())
        
        changes["new_projects"] = list(curr_projects - prev_projects)
        changes["removed_projects"] = list(prev_projects - curr_projects)
        
        # Count new commits
        for project in curr_projects & prev_projects:
            curr_commits = len(curr["projects"][project]["git_info"]["commits"])
            prev_commits = len(prev["projects"][project]["git_info"]["commits"]) if project in prev["projects"] else 0
            changes["new_commits"] += max(0, curr_commits - prev_commits)
        
        return changes

def main():
    parser = argparse.ArgumentParser(description="Capture project context")
    parser.add_argument("--hours", type=int, default=1, help="Hours to look back (default: 1)")
    parser.add_argument("--daemon", action="store_true", help="Run as daemon, capturing every hour")
    args = parser.parse_args()
    
    if args.daemon:
        import time
        print("🚀 Starting context capture daemon...")
        while True:
            capture = ProjectContextCapture(hours_back=args.hours)
            capture.capture_context()
            print(f"💤 Sleeping for 1 hour... Next capture at {(datetime.now() + timedelta(hours=1)).strftime('%H:%M:%S')}")
            time.sleep(3600)  # Sleep for 1 hour
    else:
        capture = ProjectContextCapture(hours_back=args.hours)
        capture.capture_context()

if __name__ == "__main__":
    main()