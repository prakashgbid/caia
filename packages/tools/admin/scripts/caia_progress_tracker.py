#!/usr/bin/env python3

"""
CAIA Progress Tracker
Tracks development progress, milestones, and tasks across sessions
"""

import json
import os
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, List, Any
import subprocess

class CAIAProgressTracker:
    def __init__(self):
        self.admin_dir = Path("/Users/MAC/Documents/projects/admin")
        self.tracking_dir = self.admin_dir / "caia-tracking"
        self.tracking_dir.mkdir(exist_ok=True)
        
        # Tracking files
        self.progress_file = self.tracking_dir / "progress.json"
        self.milestones_file = self.tracking_dir / "milestones.json"
        self.tasks_file = self.tracking_dir / "tasks.json"
        self.blockers_file = self.tracking_dir / "blockers.json"
        self.daily_log = self.tracking_dir / "daily_log.json"
        
        self.load_data()
    
    def load_data(self):
        """Load existing tracking data"""
        self.progress = self._load_json(self.progress_file, {
            "phase": 1,
            "phase_name": "Foundation",
            "overall_progress": 25,
            "last_updated": datetime.now().isoformat(),
            "version": "0.1.0-alpha"
        })
        
        self.milestones = self._load_json(self.milestones_file, self._default_milestones())
        self.tasks = self._load_json(self.tasks_file, self._default_tasks())
        self.blockers = self._load_json(self.blockers_file, [])
        self.daily_log = self._load_json(self.daily_log, {})
    
    def _load_json(self, file_path: Path, default: Any) -> Any:
        """Load JSON file or return default"""
        if file_path.exists():
            with open(file_path, 'r') as f:
                return json.load(f)
        return default
    
    def _save_json(self, file_path: Path, data: Any):
        """Save data to JSON file"""
        with open(file_path, 'w') as f:
            json.dump(data, f, indent=2, default=str)
    
    def _default_milestones(self) -> Dict:
        """Default milestone structure"""
        return {
            "M1.1": {
                "name": "Monorepo Setup",
                "status": "completed",
                "progress": 100,
                "completed_date": "2024-12-16",
                "tasks": [
                    {"name": "Lerna configuration", "status": "done"},
                    {"name": "NPM workspaces", "status": "done"},
                    {"name": "Package structure", "status": "done"},
                    {"name": "CI/CD pipelines", "status": "done"}
                ]
            },
            "M1.2": {
                "name": "Fix Package Compilation",
                "status": "in_progress",
                "progress": 0,
                "target_date": "2024-12-30",
                "tasks": [
                    {"name": "Resolve TypeScript errors", "status": "pending"},
                    {"name": "Ensure packages build", "status": "pending"},
                    {"name": "Add type definitions", "status": "pending"},
                    {"name": "Update dependencies", "status": "pending"}
                ]
            },
            "M1.3": {
                "name": "Core Package Development",
                "status": "pending",
                "progress": 0,
                "target_date": "2025-01-15",
                "tasks": [
                    {"name": "Create @caia/core", "status": "pending"},
                    {"name": "Base agent class", "status": "pending"},
                    {"name": "Plugin architecture", "status": "pending"},
                    {"name": "Inter-package communication", "status": "pending"}
                ]
            }
        }
    
    def _default_tasks(self) -> Dict:
        """Default task structure"""
        return {
            "immediate": [
                {"id": "T001", "title": "Fix @caia/agent-paraforge TypeScript", "status": "pending", "priority": "high"},
                {"id": "T002", "title": "Fix @caia/util-cc-orchestrator", "status": "pending", "priority": "high"},
                {"id": "T003", "title": "Create @caia/core package", "status": "pending", "priority": "high"},
                {"id": "T004", "title": "Set up NPM organization", "status": "pending", "priority": "medium"},
                {"id": "T005", "title": "Write getting started guide", "status": "pending", "priority": "low"}
            ],
            "backlog": [],
            "completed": []
        }
    
    def get_status(self) -> Dict:
        """Get current project status"""
        # Calculate milestone progress
        total_milestones = len(self.milestones)
        completed_milestones = sum(1 for m in self.milestones.values() if m["status"] == "completed")
        
        # Calculate task progress
        immediate_tasks = self.tasks.get("immediate", [])
        completed_tasks = [t for t in immediate_tasks if t["status"] == "done"]
        
        # Get package status
        package_status = self._get_package_status()
        
        return {
            "overview": {
                "phase": self.progress["phase"],
                "phase_name": self.progress["phase_name"],
                "overall_progress": self.progress["overall_progress"],
                "last_updated": self.progress["last_updated"],
                "version": self.progress["version"]
            },
            "milestones": {
                "total": total_milestones,
                "completed": completed_milestones,
                "in_progress": sum(1 for m in self.milestones.values() if m["status"] == "in_progress"),
                "current": next((k for k, v in self.milestones.items() if v["status"] == "in_progress"), None)
            },
            "tasks": {
                "immediate": len(immediate_tasks),
                "completed": len(completed_tasks),
                "blocked": len(self.blockers),
                "next_task": immediate_tasks[0] if immediate_tasks else None
            },
            "packages": package_status,
            "blockers": self.blockers[:3] if self.blockers else []
        }
    
    def _get_package_status(self) -> Dict:
        """Get status of CAIA packages"""
        caia_dir = Path("/Users/MAC/Documents/projects/caia")
        packages_dir = caia_dir / "packages"
        
        if not packages_dir.exists():
            return {"error": "Packages directory not found"}
        
        # Count packages by category
        categories = ["agents", "engines", "integrations", "modules", "utils"]
        package_count = {}
        
        for category in categories:
            cat_dir = packages_dir / category
            if cat_dir.exists():
                package_count[category] = len(list(cat_dir.iterdir()))
            else:
                package_count[category] = 0
        
        return {
            "total": sum(package_count.values()),
            "by_category": package_count,
            "published": 0,  # TODO: Check NPM for published packages
            "building": 0,    # TODO: Check which packages build successfully
            "failing": 14     # Currently all have TypeScript errors
        }
    
    def log_progress(self, message: str, category: str = "general"):
        """Log daily progress"""
        today = datetime.now().strftime("%Y-%m-%d")
        
        if today not in self.daily_log:
            self.daily_log[today] = []
        
        self.daily_log[today].append({
            "time": datetime.now().isoformat(),
            "category": category,
            "message": message
        })
        
        self._save_json(self.daily_log, self.daily_log)
    
    def update_task(self, task_id: str, status: str):
        """Update task status"""
        for task_list in ["immediate", "backlog"]:
            for task in self.tasks.get(task_list, []):
                if task["id"] == task_id:
                    task["status"] = status
                    if status == "done":
                        task["completed_date"] = datetime.now().isoformat()
                        self.tasks["completed"].append(task)
                        self.tasks[task_list].remove(task)
                    break
        
        self._save_json(self.tasks_file, self.tasks)
        self.log_progress(f"Task {task_id} updated to {status}", "task")
    
    def add_blocker(self, blocker: str, severity: str = "medium"):
        """Add a new blocker"""
        self.blockers.append({
            "id": f"B{len(self.blockers)+1:03d}",
            "description": blocker,
            "severity": severity,
            "created": datetime.now().isoformat(),
            "status": "active"
        })
        self._save_json(self.blockers_file, self.blockers)
        self.log_progress(f"New blocker added: {blocker}", "blocker")
    
    def generate_report(self, report_type: str = "daily") -> str:
        """Generate progress report"""
        status = self.get_status()
        
        report = []
        report.append("=" * 60)
        report.append(f"📊 CAIA Progress Report - {datetime.now().strftime('%Y-%m-%d %H:%M')}")
        report.append("=" * 60)
        report.append("")
        
        # Overview
        report.append("📈 PROJECT OVERVIEW")
        report.append(f"  Phase: {status['overview']['phase']} - {status['overview']['phase_name']}")
        report.append(f"  Overall Progress: {status['overview']['overall_progress']}%")
        report.append(f"  Version: {status['overview']['version']}")
        report.append("")
        
        # Milestones
        report.append("🎯 MILESTONES")
        report.append(f"  Completed: {status['milestones']['completed']}/{status['milestones']['total']}")
        report.append(f"  Current: {status['milestones']['current'] or 'None'}")
        if status['milestones']['current']:
            current = self.milestones[status['milestones']['current']]
            report.append(f"    Name: {current['name']}")
            report.append(f"    Progress: {current['progress']}%")
        report.append("")
        
        # Tasks
        report.append("📋 TASKS")
        report.append(f"  Immediate: {status['tasks']['immediate']} tasks")
        report.append(f"  Completed: {status['tasks']['completed']} tasks")
        if status['tasks']['next_task']:
            report.append(f"  Next: {status['tasks']['next_task']['title']}")
        report.append("")
        
        # Packages
        report.append("📦 PACKAGES")
        report.append(f"  Total: {status['packages']['total']} packages")
        report.append(f"  Status: {status['packages']['failing']} failing, {status['packages']['building']} building")
        report.append("  By Category:")
        for cat, count in status['packages']['by_category'].items():
            report.append(f"    {cat}: {count}")
        report.append("")
        
        # Blockers
        if status['blockers']:
            report.append("🚫 BLOCKERS")
            for blocker in status['blockers']:
                report.append(f"  - {blocker['description']} ({blocker['severity']})")
            report.append("")
        
        # Recent activity
        if report_type == "daily":
            today = datetime.now().strftime("%Y-%m-%d")
            if today in self.daily_log:
                report.append("📝 TODAY'S ACTIVITY")
                for entry in self.daily_log[today][-5:]:
                    time = datetime.fromisoformat(entry['time']).strftime("%H:%M")
                    report.append(f"  {time} - {entry['message']}")
                report.append("")
        
        # Next steps
        report.append("🚀 NEXT STEPS")
        report.append("  1. Fix TypeScript compilation errors")
        report.append("  2. Publish first package to NPM")
        report.append("  3. Create @caia/core orchestrator")
        report.append("  4. Set up documentation site")
        report.append("  5. Demo first working agent")
        
        return "\n".join(report)
    
    def quick_status(self) -> str:
        """Generate quick status summary"""
        status = self.get_status()
        
        summary = []
        summary.append(f"🚀 CAIA Status: Phase {status['overview']['phase']} ({status['overview']['overall_progress']}%)")
        summary.append(f"📊 Milestones: {status['milestones']['completed']}/{status['milestones']['total']} complete")
        summary.append(f"📋 Tasks: {status['tasks']['immediate']} pending, {status['tasks']['blocked']} blocked")
        summary.append(f"📦 Packages: {status['packages']['total']} total ({status['packages']['failing']} need fixes)")
        
        if status['tasks']['next_task']:
            summary.append(f"👉 Next: {status['tasks']['next_task']['title']}")
        
        return "\n".join(summary)


def main():
    """Main entry point"""
    import sys
    
    tracker = CAIAProgressTracker()
    
    if len(sys.argv) > 1:
        command = sys.argv[1]
        
        if command == "status":
            print(tracker.quick_status())
        elif command == "report":
            print(tracker.generate_report())
        elif command == "log" and len(sys.argv) > 2:
            message = " ".join(sys.argv[2:])
            tracker.log_progress(message)
            print(f"✅ Logged: {message}")
        elif command == "task" and len(sys.argv) > 3:
            task_id = sys.argv[2]
            status = sys.argv[3]
            tracker.update_task(task_id, status)
            print(f"✅ Updated task {task_id} to {status}")
        elif command == "blocker" and len(sys.argv) > 2:
            blocker = " ".join(sys.argv[2:])
            tracker.add_blocker(blocker)
            print(f"✅ Added blocker: {blocker}")
        else:
            print("Usage: caia_progress_tracker.py [status|report|log|task|blocker]")
    else:
        # Default to showing report
        print(tracker.generate_report())


if __name__ == "__main__":
    main()