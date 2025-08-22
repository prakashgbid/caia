#!/usr/bin/env python3
"""
Context Query System
Query and summarize past context, decisions, and progress
"""

import os
import json
from datetime import datetime, timedelta
from pathlib import Path
import argparse
from typing import Dict, List, Any, Optional
from collections import defaultdict

ADMIN_ROOT = "/Users/MAC/Documents/projects/admin"
CONTEXT_DIR = os.path.join(ADMIN_ROOT, "context")
DECISIONS_DIR = os.path.join(ADMIN_ROOT, "decisions")

class ContextQuery:
    def __init__(self):
        self.context_dir = Path(CONTEXT_DIR)
        self.decisions_dir = Path(DECISIONS_DIR)
        
    def get_latest_context(self) -> Dict[str, Any]:
        """Get the most recent context file"""
        context_files = sorted(self.context_dir.glob("context_*.json"))
        if context_files:
            with open(context_files[-1], 'r') as f:
                return json.load(f)
        return {}
    
    def get_context_history(self, days_back: int = 7) -> List[Dict[str, Any]]:
        """Get context history for the past N days"""
        cutoff_date = datetime.now() - timedelta(days=days_back)
        contexts = []
        
        for context_file in sorted(self.context_dir.glob("context_*.json")):
            file_date = datetime.fromtimestamp(context_file.stat().st_mtime)
            if file_date >= cutoff_date:
                try:
                    with open(context_file, 'r') as f:
                        contexts.append(json.load(f))
                except:
                    pass
        
        return contexts
    
    def get_project_summary(self, project_name: str) -> Dict[str, Any]:
        """Get comprehensive summary for a specific project"""
        latest_context = self.get_latest_context()
        
        if project_name not in latest_context.get("projects", {}):
            return {"error": f"Project '{project_name}' not found"}
        
        project_data = latest_context["projects"][project_name]
        
        # Get historical data
        history = self.get_context_history(days_back=7)
        commit_history = []
        todo_trend = []
        
        for ctx in history:
            if project_name in ctx.get("projects", {}):
                proj = ctx["projects"][project_name]
                commit_history.extend(proj.get("git_info", {}).get("commits", []))
                todo_trend.append({
                    "date": ctx["timestamp"],
                    "count": len(proj.get("todos", []))
                })
        
        summary = {
            "project": project_name,
            "current_state": {
                "files": project_data.get("file_count", 0),
                "directories": project_data.get("directory_count", 0),
                "size_mb": round(project_data.get("size_bytes", 0) / (1024 * 1024), 2),
                "technologies": project_data.get("technologies", []),
                "current_branch": project_data.get("git_info", {}).get("current_branch"),
                "modified_files": len(project_data.get("git_info", {}).get("modified_files", [])),
                "untracked_files": len(project_data.get("git_info", {}).get("untracked_files", []))
            },
            "recent_activity": {
                "commits_last_week": len(commit_history),
                "recent_changes": project_data.get("recent_changes", [])[:10],
                "active_todos": len(project_data.get("todos", []))
            },
            "todo_trend": todo_trend,
            "key_files": project_data.get("key_files", {}),
            "dependencies": project_data.get("dependencies", {})
        }
        
        return summary
    
    def get_all_decisions(self, days_back: int = 7, project: Optional[str] = None) -> List[Dict[str, Any]]:
        """Get all decisions from the past N days"""
        cutoff_date = datetime.now() - timedelta(days=days_back)
        all_decisions = []
        
        for decision_file in self.decisions_dir.glob("decisions_*.json"):
            file_date = datetime.fromtimestamp(decision_file.stat().st_mtime)
            if file_date >= cutoff_date:
                try:
                    with open(decision_file, 'r') as f:
                        decisions = json.load(f)
                        for decision in decisions:
                            if project is None or decision.get("project") == project:
                                all_decisions.append(decision)
                except:
                    pass
        
        # Sort by timestamp
        all_decisions.sort(key=lambda x: x.get("timestamp", ""), reverse=True)
        return all_decisions
    
    def get_progress_report(self, project: Optional[str] = None) -> Dict[str, Any]:
        """Generate a progress report"""
        progress_files = sorted(self.decisions_dir.glob("progress_*.json"))
        all_progress = []
        
        for progress_file in progress_files:
            try:
                with open(progress_file, 'r') as f:
                    progress_entries = json.load(f)
                    for entry in progress_entries:
                        if project is None or entry.get("project") == project:
                            all_progress.append(entry)
            except:
                pass
        
        # Group by project and task
        report = defaultdict(lambda: defaultdict(list))
        
        for entry in all_progress:
            proj = entry.get("project", "general")
            task = entry.get("task", "unknown")
            report[proj][task].append(entry)
        
        # Calculate completion rates
        summary = {}
        for proj, tasks in report.items():
            task_summaries = {}
            for task, entries in tasks.items():
                latest_entry = entries[-1] if entries else {}
                task_summaries[task] = {
                    "status": latest_entry.get("status", "unknown"),
                    "completion": latest_entry.get("completion_percentage", 0),
                    "last_updated": latest_entry.get("timestamp", ""),
                    "total_updates": len(entries)
                }
            summary[proj] = task_summaries
        
        return summary
    
    def generate_executive_summary(self) -> str:
        """Generate an executive summary of all projects"""
        context = self.get_latest_context()
        decisions = self.get_all_decisions(days_back=1)
        progress = self.get_progress_report()
        
        summary_lines = [
            "=" * 60,
            "PROJECTS EXECUTIVE SUMMARY",
            f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
            "=" * 60,
            "",
            "## OVERVIEW",
            f"Total Projects: {context.get('summary', {}).get('total_projects', 0)}",
            f"Active Projects: {context.get('summary', {}).get('active_projects', 0)}",
            f"Recent Commits: {context.get('summary', {}).get('total_commits', 0)}",
            f"Open TODOs: {context.get('summary', {}).get('total_todos', 0)}",
            "",
            "## RECENT ACTIVITY"
        ]
        
        # Add recent commits by project
        for project_name, project_data in context.get("projects", {}).items():
            commits = project_data.get("git_info", {}).get("commits", [])
            if commits:
                summary_lines.append(f"\n### {project_name}")
                for commit in commits[:3]:  # Show last 3 commits
                    summary_lines.append(f"  - {commit['message']} ({commit['author']})")
        
        # Add recent decisions
        if decisions:
            summary_lines.extend([
                "",
                "## RECENT DECISIONS (Last 24 hours)"
            ])
            for decision in decisions[:5]:  # Show last 5 decisions
                summary_lines.append(f"  - [{decision['category']}] {decision['title']}")
                if decision.get('project'):
                    summary_lines.append(f"    Project: {decision['project']}")
        
        # Add progress summary
        if progress:
            summary_lines.extend([
                "",
                "## PROJECT PROGRESS"
            ])
            for project, tasks in progress.items():
                if tasks:
                    summary_lines.append(f"\n### {project}")
                    for task, info in tasks.items():
                        status_emoji = "✅" if info['status'] == 'completed' else "🔄" if info['status'] == 'in_progress' else "⏸️"
                        summary_lines.append(f"  {status_emoji} {task}: {info['completion']}% complete")
        
        # Add critical TODOs
        critical_todos = []
        for project_name, project_data in context.get("projects", {}).items():
            for todo in project_data.get("todos", []):
                if "FIXME" in todo["content"] or "CRITICAL" in todo["content"]:
                    critical_todos.append({
                        "project": project_name,
                        "file": todo["file"],
                        "line": todo["line"],
                        "content": todo["content"]
                    })
        
        if critical_todos:
            summary_lines.extend([
                "",
                "## CRITICAL TODOs"
            ])
            for todo in critical_todos[:10]:  # Show top 10
                summary_lines.append(f"  - [{todo['project']}] {todo['file']}:{todo['line']}")
                summary_lines.append(f"    {todo['content'][:80]}...")
        
        summary_lines.extend([
            "",
            "=" * 60
        ])
        
        return "\n".join(summary_lines)

def main():
    parser = argparse.ArgumentParser(description="Query project context")
    parser.add_argument("--command", choices=["latest", "history", "project", "decisions", "progress", "summary"],
                       default="summary", help="Query command to execute")
    parser.add_argument("--project", help="Project name for project-specific queries")
    parser.add_argument("--days", type=int, default=7, help="Days to look back")
    parser.add_argument("--format", choices=["json", "text"], default="text", help="Output format")
    
    args = parser.parse_args()
    
    query = ContextQuery()
    
    if args.command == "latest":
        result = query.get_latest_context()
        if args.format == "json":
            print(json.dumps(result, indent=2))
        else:
            print(f"Latest context from: {result.get('timestamp', 'Unknown')}")
            print(f"Projects: {', '.join(result.get('projects', {}).keys())}")
            
    elif args.command == "history":
        result = query.get_context_history(days_back=args.days)
        if args.format == "json":
            print(json.dumps(result, indent=2))
        else:
            print(f"Found {len(result)} context snapshots from the last {args.days} days")
            
    elif args.command == "project":
        if not args.project:
            print("Error: --project required for project command")
            return
        result = query.get_project_summary(args.project)
        if args.format == "json":
            print(json.dumps(result, indent=2))
        else:
            if "error" in result:
                print(result["error"])
            else:
                print(f"Project: {result['project']}")
                print(f"Files: {result['current_state']['files']}")
                print(f"Size: {result['current_state']['size_mb']} MB")
                print(f"Technologies: {', '.join(result['current_state']['technologies'])}")
                print(f"Active TODOs: {result['recent_activity']['active_todos']}")
                
    elif args.command == "decisions":
        result = query.get_all_decisions(days_back=args.days, project=args.project)
        if args.format == "json":
            print(json.dumps(result, indent=2))
        else:
            print(f"Found {len(result)} decisions from the last {args.days} days")
            for decision in result[:10]:
                print(f"  - [{decision['category']}] {decision['title']}")
                
    elif args.command == "progress":
        result = query.get_progress_report(project=args.project)
        if args.format == "json":
            print(json.dumps(result, indent=2))
        else:
            for project, tasks in result.items():
                print(f"\n{project}:")
                for task, info in tasks.items():
                    print(f"  - {task}: {info['status']} ({info['completion']}%)")
                    
    elif args.command == "summary":
        print(query.generate_executive_summary())

if __name__ == "__main__":
    main()