#!/usr/bin/env python3
"""
CAIA Progress Aggregator - Monorepo Progress Collection
Aggregates progress from all CAIA components into unified views
"""

import json
import os
import sys
import argparse
from datetime import datetime, timedelta
import subprocess
import glob
from pathlib import Path
from collections import defaultdict

class CAIAProgressAggregator:
    def __init__(self):
        self.caia_root = "/Users/MAC/Documents/projects/caia"
        self.progress_dir = os.path.join(self.caia_root, "progress")
        self.components_dir = os.path.join(self.progress_dir, "components")
        self.daily_rollup_dir = os.path.join(self.progress_dir, "daily-rollup")
        self.milestones_dir = os.path.join(self.progress_dir, "milestones")
        self.scripts_dir = os.path.join(self.progress_dir, "scripts")
        
        self.today = datetime.now()
        self.date_str = self.today.strftime("%Y-%m-%d")
        
        self.setup_directories()
        
        # CAIA component structure
        self.component_paths = {
            "agents": [
                "agents/connectors",
                "agents/orchestrators",
                "agents/sme"
            ],
            "tools": [
                "tools/cc-ultimate-config",
                "tools/claude-code-ultimate",
                "tools/cli",
                "tools/debugging",
                "tools/monitoring",
                "tools/testing"
            ],
            "utils": [
                "utils/ai",
                "utils/core",
                "utils/data",
                "utils/network",
                "utils/parallel"
            ],
            "packages": [
                "packages"
            ],
            "core": [
                "core"
            ]
        }
    
    def setup_directories(self):
        """Create CAIA progress directory structure"""
        os.makedirs(self.components_dir, exist_ok=True)
        os.makedirs(self.daily_rollup_dir, exist_ok=True)
        os.makedirs(self.milestones_dir, exist_ok=True)
        os.makedirs(self.scripts_dir, exist_ok=True)
    
    def collect_component_progress(self, component_category):
        """Collect progress from all components in a category"""
        category_progress = {
            "category": component_category,
            "date": self.date_str,
            "components": [],
            "summary": {
                "total_components": 0,
                "active_components": 0,
                "total_accomplishments": 0,
                "total_commits": 0,
                "completion_percentage": 0
            }
        }
        
        for component_path in self.component_paths.get(component_category, []):
            full_path = os.path.join(self.caia_root, component_path)
            
            if os.path.exists(full_path):
                component_data = self.get_component_progress(full_path, component_path)
                if component_data:
                    category_progress["components"].append(component_data)
        
        # Calculate summary
        category_progress["summary"]["total_components"] = len(category_progress["components"])
        category_progress["summary"]["active_components"] = len([c for c in category_progress["components"] if c["is_active"]])
        category_progress["summary"]["total_accomplishments"] = sum(c["today_accomplishments"] for c in category_progress["components"])
        category_progress["summary"]["total_commits"] = sum(c["today_commits"] for c in category_progress["components"])
        
        if category_progress["components"]:
            avg_completion = sum(c["completion_percentage"] for c in category_progress["components"]) / len(category_progress["components"])
            category_progress["summary"]["completion_percentage"] = round(avg_completion, 1)
        
        return category_progress
    
    def get_component_progress(self, component_path, component_name):
        """Get progress for a specific component"""
        progress_file = os.path.join(component_path, "PROGRESS", "daily", f"{self.date_str}.json")
        
        component_data = {
            "name": component_name,
            "path": component_path,
            "is_active": False,
            "today_accomplishments": 0,
            "today_commits": 0,
            "completion_percentage": 0,
            "current_milestone": "",
            "blockers": [],
            "recent_activity": []
        }
        
        # Check if component has progress tracking
        if os.path.exists(progress_file):
            try:
                with open(progress_file, 'r') as f:
                    progress_data = json.load(f)
                
                component_data.update({
                    "is_active": True,
                    "today_accomplishments": len(progress_data.get("accomplishments", [])),
                    "today_commits": progress_data.get("metrics", {}).get("commits", 0),
                    "completion_percentage": self.estimate_completion(progress_data),
                    "blockers": progress_data.get("blockers", []),
                    "recent_activity": progress_data.get("accomplishments", [])[-3:]  # Last 3 items
                })
                
                # Extract current milestone from progress
                if progress_data.get("daily_summary"):
                    component_data["current_milestone"] = progress_data["daily_summary"][:50] + "..."
                
            except Exception as e:
                print(f"Warning: Could not read progress for {component_name}: {e}")
        
        # Check git activity even without progress file
        if not component_data["is_active"]:
            git_activity = self.get_git_activity(component_path)
            if git_activity["commits"] > 0:
                component_data.update({
                    "is_active": True,
                    "today_commits": git_activity["commits"],
                    "recent_activity": [{"title": f"{git_activity['commits']} commits made today", "type": "commit"}]
                })
        
        return component_data
    
    def estimate_completion(self, progress_data):
        """Estimate completion percentage based on progress data"""
        # Simple heuristic based on activity level and accomplishments
        accomplishments = len(progress_data.get("accomplishments", []))
        commits = progress_data.get("metrics", {}).get("commits", 0)
        
        # Base score from activity
        score = min(accomplishments * 10 + commits * 5, 80)
        
        # Bonus for having clear goals
        if progress_data.get("next_day_plan"):
            score += 10
        
        # Penalty for blockers
        if progress_data.get("blockers"):
            score -= len(progress_data["blockers"]) * 5
        
        return max(0, min(100, score))
    
    def get_git_activity(self, path):
        """Get git activity for a path"""
        try:
            if not os.path.exists(os.path.join(path, ".git")) and not self.is_in_git_repo(path):
                return {"commits": 0, "files": 0}
            
            # Get commits since midnight
            midnight = self.today.replace(hour=0, minute=0, second=0, microsecond=0)
            since = midnight.strftime("%Y-%m-%d 00:00:00")
            
            cmd = f"git log --since='{since}' --oneline -- . | wc -l"
            commits = int(subprocess.check_output(cmd, shell=True, cwd=path).strip())
            
            return {"commits": commits, "files": 0}
        except:
            return {"commits": 0, "files": 0}
    
    def is_in_git_repo(self, path):
        """Check if path is in a git repository"""
        try:
            subprocess.check_output("git rev-parse --git-dir", shell=True, cwd=path, stderr=subprocess.DEVNULL)
            return True
        except:
            return False
    
    def generate_daily_rollup(self):
        """Generate daily rollup across all CAIA components"""
        rollup = {
            "date": self.date_str,
            "caia_overview": {
                "total_components": 0,
                "active_components": 0,
                "total_accomplishments": 0,
                "total_commits": 0,
                "average_completion": 0,
                "top_performers": [],
                "blocked_components": []
            },
            "categories": {},
            "milestones": self.get_milestone_progress(),
            "trends": self.get_weekly_trends()
        }
        
        total_completion = 0
        total_components = 0
        all_components = []
        
        # Collect progress from each category
        for category in self.component_paths.keys():
            category_progress = self.collect_component_progress(category)
            rollup["categories"][category] = category_progress
            
            # Aggregate totals
            rollup["caia_overview"]["total_components"] += category_progress["summary"]["total_components"]
            rollup["caia_overview"]["active_components"] += category_progress["summary"]["active_components"]
            rollup["caia_overview"]["total_accomplishments"] += category_progress["summary"]["total_accomplishments"]
            rollup["caia_overview"]["total_commits"] += category_progress["summary"]["total_commits"]
            
            # Track individual components for ranking
            for component in category_progress["components"]:
                all_components.append(component)
                if component["completion_percentage"] > 0:
                    total_completion += component["completion_percentage"]
                    total_components += 1
                
                # Track blocked components
                if component["blockers"]:
                    rollup["caia_overview"]["blocked_components"].append({
                        "name": component["name"],
                        "blockers": len(component["blockers"])
                    })
        
        # Calculate average completion
        if total_components > 0:
            rollup["caia_overview"]["average_completion"] = round(total_completion / total_components, 1)
        
        # Find top performers (most accomplishments today)
        top_performers = sorted(all_components, key=lambda x: x["today_accomplishments"], reverse=True)[:5]
        rollup["caia_overview"]["top_performers"] = [
            {"name": comp["name"], "accomplishments": comp["today_accomplishments"]}
            for comp in top_performers if comp["today_accomplishments"] > 0
        ]
        
        # Save rollup
        rollup_file = os.path.join(self.daily_rollup_dir, f"{self.date_str}.json")
        with open(rollup_file, 'w') as f:
            json.dump(rollup, f, indent=2)
        
        return rollup
    
    def get_milestone_progress(self):
        """Get milestone progress across CAIA"""
        milestones_file = os.path.join(self.milestones_dir, "current-milestones.json")
        
        if os.path.exists(milestones_file):
            try:
                with open(milestones_file, 'r') as f:
                    return json.load(f)
            except:
                pass
        
        # Default milestones if file doesn't exist
        return {
            "v1.0-release": {
                "target_date": "2025-12-31",
                "completion": 25,
                "components_needed": ["agents", "tools", "core"],
                "status": "in_progress"
            },
            "npm-packages": {
                "target_date": "2025-10-31", 
                "completion": 60,
                "components_needed": ["utils", "packages"],
                "status": "in_progress"
            }
        }
    
    def get_weekly_trends(self):
        """Get weekly trend data"""
        week_files = []
        week_start = self.today - timedelta(days=7)
        
        for i in range(7):
            date = week_start + timedelta(days=i)
            date_str = date.strftime("%Y-%m-%d")
            rollup_file = os.path.join(self.daily_rollup_dir, f"{date_str}.json")
            
            if os.path.exists(rollup_file):
                try:
                    with open(rollup_file, 'r') as f:
                        week_files.append(json.load(f))
                except:
                    continue
        
        if not week_files:
            return {"trend": "no_data", "velocity": 0}
        
        # Calculate trend
        accomplishments = [d["caia_overview"]["total_accomplishments"] for d in week_files]
        avg_accomplishments = sum(accomplishments) / len(accomplishments) if accomplishments else 0
        
        return {
            "trend": "increasing" if len(accomplishments) > 1 and accomplishments[-1] > accomplishments[0] else "stable",
            "velocity": round(avg_accomplishments, 1),
            "weekly_total": sum(accomplishments)
        }
    
    def view_caia_status(self):
        """Display CAIA status overview"""
        rollup = self.generate_daily_rollup()
        
        print(f"\n🎯 CAIA Progress Overview - {self.date_str}")
        print("=" * 60)
        
        overview = rollup["caia_overview"]
        print(f"📊 Components: {overview['active_components']}/{overview['total_components']} active")
        print(f"✅ Accomplishments: {overview['total_accomplishments']}")
        print(f"🔄 Commits: {overview['total_commits']}")
        print(f"📈 Average Completion: {overview['average_completion']}%")
        
        if overview["top_performers"]:
            print(f"\n🏆 Top Performers Today:")
            for performer in overview["top_performers"]:
                print(f"   • {performer['name']}: {performer['accomplishments']} accomplishments")
        
        if overview["blocked_components"]:
            print(f"\n🚫 Blocked Components:")
            for blocked in overview["blocked_components"]:
                print(f"   • {blocked['name']}: {blocked['blockers']} blockers")
        
        print(f"\n📂 Category Progress:")
        for category, data in rollup["categories"].items():
            summary = data["summary"]
            print(f"   {category.title()}: {summary['active_components']}/{summary['total_components']} active, {summary['total_accomplishments']} accomplishments")
        
        print(f"\n🎯 Milestones:")
        for milestone, data in rollup["milestones"].items():
            status_emoji = "✅" if data["completion"] == 100 else "🔄" if data["completion"] > 0 else "⏸️"
            print(f"   {status_emoji} {milestone}: {data['completion']}% (target: {data['target_date']})")
        
        trends = rollup["trends"]
        trend_emoji = "📈" if trends["trend"] == "increasing" else "📊"
        print(f"\n{trend_emoji} Weekly Trend: {trends['trend']} (velocity: {trends['velocity']} accomplishments/day)")

def main():
    parser = argparse.ArgumentParser(description="CAIA Progress Aggregator")
    parser.add_argument("command", choices=["rollup", "status", "category"], 
                       help="Command to execute")
    parser.add_argument("--category", help="Specific category for category command")
    
    args = parser.parse_args()
    
    aggregator = CAIAProgressAggregator()
    
    if args.command == "rollup":
        rollup = aggregator.generate_daily_rollup()
        print(f"✅ Daily rollup generated: {aggregator.daily_rollup_dir}/{aggregator.date_str}.json")
    elif args.command == "status":
        aggregator.view_caia_status()
    elif args.command == "category":
        if not args.category:
            print("Error: --category required for category command")
            return
        
        progress = aggregator.collect_component_progress(args.category)
        print(f"\n📂 {args.category.title()} Progress - {aggregator.date_str}")
        print("=" * 50)
        
        for component in progress["components"]:
            status = "🟢" if component["is_active"] else "⚪"
            print(f"{status} {component['name']}: {component['today_accomplishments']} accomplishments, {component['today_commits']} commits")
            
            if component["blockers"]:
                print(f"   🚫 {len(component['blockers'])} blockers")

if __name__ == "__main__":
    main()