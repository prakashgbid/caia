#!/usr/bin/env python3
"""
Ecosystem Progress Dashboard - All Projects Combined View
Aggregates progress from all repositories in the projects ecosystem
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

class EcosystemProgressDashboard:
    def __init__(self):
        self.projects_root = "/Users/MAC/Documents/projects"
        self.admin_root = "/Users/MAC/Documents/projects/admin"
        self.dashboard_dir = os.path.join(self.admin_root, "progress-dashboard")
        self.ecosystem_daily_dir = os.path.join(self.dashboard_dir, "ecosystem-daily")
        self.cross_project_dir = os.path.join(self.dashboard_dir, "cross-project")
        self.reports_dir = os.path.join(self.dashboard_dir, "reports")
        
        self.today = datetime.now()
        self.date_str = self.today.strftime("%Y-%m-%d")
        
        self.setup_directories()
        
        # Define project categories
        self.project_categories = {
            "core": ["caia", "admin"],
            "apps": ["roulette-community", "orchestra-platform"],
            "tools": ["omnimind", "paraforge", "smart-agents-training-system"],
            "standalone": ["standalone-apps"],
            "legacy": ["old-projects"],
            "utilities": ["scripts", "docs", "temp-scripts"]
        }
        
        # All projects to scan
        self.all_projects = []
        for category_projects in self.project_categories.values():
            self.all_projects.extend(category_projects)
    
    def setup_directories(self):
        """Create ecosystem dashboard directory structure"""
        os.makedirs(self.ecosystem_daily_dir, exist_ok=True)
        os.makedirs(self.cross_project_dir, exist_ok=True)
        os.makedirs(self.reports_dir, exist_ok=True)
        os.makedirs(os.path.join(self.dashboard_dir, "scripts"), exist_ok=True)
    
    def collect_all_project_progress(self):
        """Collect progress from all projects in the ecosystem"""
        ecosystem_data = {
            "date": self.date_str,
            "ecosystem_overview": {
                "total_projects": 0,
                "active_projects": 0,
                "total_accomplishments": 0,
                "total_commits": 0,
                "total_decisions": 0,
                "avg_velocity": 0,
                "top_projects": [],
                "struggling_projects": [],
                "cross_project_dependencies": []
            },
            "categories": {},
            "projects": {},
            "trends": self.get_ecosystem_trends(),
            "resource_allocation": self.analyze_resource_allocation(),
            "velocity_insights": self.get_velocity_insights()
        }
        
        total_velocity = 0
        active_project_count = 0
        all_project_data = []
        
        # Process each category
        for category, projects in self.project_categories.items():
            category_data = {
                "name": category,
                "projects": [],
                "summary": {
                    "total_projects": len(projects),
                    "active_projects": 0,
                    "accomplishments": 0,
                    "commits": 0,
                    "decisions": 0
                }
            }
            
            for project in projects:
                project_data = self.get_project_progress(project)
                if project_data:
                    category_data["projects"].append(project_data)
                    ecosystem_data["projects"][project] = project_data
                    all_project_data.append(project_data)
                    
                    # Update category summary
                    if project_data["is_active"]:
                        category_data["summary"]["active_projects"] += 1
                        active_project_count += 1
                    
                    category_data["summary"]["accomplishments"] += project_data["today_accomplishments"]
                    category_data["summary"]["commits"] += project_data["today_commits"]
                    category_data["summary"]["decisions"] += project_data["today_decisions"]
                    
                    # Calculate velocity
                    project_velocity = project_data["today_accomplishments"] + (project_data["today_commits"] * 0.3)
                    total_velocity += project_velocity
            
            ecosystem_data["categories"][category] = category_data
        
        # Calculate ecosystem overview
        ecosystem_data["ecosystem_overview"]["total_projects"] = len(self.all_projects)
        ecosystem_data["ecosystem_overview"]["active_projects"] = active_project_count
        ecosystem_data["ecosystem_overview"]["total_accomplishments"] = sum(p["today_accomplishments"] for p in all_project_data)
        ecosystem_data["ecosystem_overview"]["total_commits"] = sum(p["today_commits"] for p in all_project_data)
        ecosystem_data["ecosystem_overview"]["total_decisions"] = sum(p["today_decisions"] for p in all_project_data)
        ecosystem_data["ecosystem_overview"]["avg_velocity"] = round(total_velocity / max(active_project_count, 1), 2)
        
        # Find top and struggling projects
        sorted_by_activity = sorted(all_project_data, key=lambda x: x["today_accomplishments"] + x["today_commits"], reverse=True)
        ecosystem_data["ecosystem_overview"]["top_projects"] = [
            {"name": p["name"], "activity_score": p["today_accomplishments"] + p["today_commits"]}
            for p in sorted_by_activity[:5] if p["today_accomplishments"] + p["today_commits"] > 0
        ]
        
        # Find projects with blockers or low activity
        struggling = [p for p in all_project_data if len(p["blockers"]) > 0 or (p["is_active"] and p["today_accomplishments"] == 0)]
        ecosystem_data["ecosystem_overview"]["struggling_projects"] = [
            {"name": p["name"], "issues": len(p["blockers"]), "reason": "blockers" if p["blockers"] else "no_progress"}
            for p in struggling[:5]
        ]
        
        # Save ecosystem data
        ecosystem_file = os.path.join(self.ecosystem_daily_dir, f"{self.date_str}.json")
        with open(ecosystem_file, 'w') as f:
            json.dump(ecosystem_data, f, indent=2)
        
        return ecosystem_data
    
    def get_project_progress(self, project_name):
        """Get progress data for a specific project"""
        project_path = os.path.join(self.projects_root, project_name)
        
        if not os.path.exists(project_path):
            return None
        
        project_data = {
            "name": project_name,
            "path": project_path,
            "is_active": False,
            "today_accomplishments": 0,
            "today_commits": 0,
            "today_decisions": 0,
            "completion_estimate": 0,
            "blockers": [],
            "recent_activity": [],
            "next_milestones": [],
            "health_score": 0
        }
        
        # Check for PROGRESS directory (new system)
        progress_file = os.path.join(project_path, "PROGRESS", "daily", f"{self.date_str}.json")
        if os.path.exists(progress_file):
            try:
                with open(progress_file, 'r') as f:
                    progress_data = json.load(f)
                
                project_data.update({
                    "is_active": True,
                    "today_accomplishments": len(progress_data.get("accomplishments", [])),
                    "blockers": progress_data.get("blockers", []),
                    "recent_activity": progress_data.get("accomplishments", [])[-3:],
                    "next_milestones": progress_data.get("next_day_plan", [])
                })
                
                # Calculate completion estimate
                project_data["completion_estimate"] = self.estimate_project_completion(progress_data)
                
            except Exception as e:
                print(f"Warning: Could not read progress for {project_name}: {e}")
        
        # Get git activity
        git_metrics = self.get_git_metrics(project_path)
        project_data["today_commits"] = git_metrics["commits"]
        
        if git_metrics["commits"] > 0 and not project_data["is_active"]:
            project_data["is_active"] = True
            project_data["recent_activity"] = [{"title": f"{git_metrics['commits']} commits", "type": "git"}]
        
        # Check admin decision logs for this project
        project_data["today_decisions"] = self.get_project_decisions(project_name)
        
        # Calculate health score
        project_data["health_score"] = self.calculate_health_score(project_data, git_metrics)
        
        return project_data
    
    def get_git_metrics(self, project_path):
        """Get git metrics for a project"""
        try:
            if not self.is_git_repo(project_path):
                return {"commits": 0, "files_changed": 0, "lines_added": 0}
            
            # Get commits since midnight
            midnight = self.today.replace(hour=0, minute=0, second=0, microsecond=0)
            since = midnight.strftime("%Y-%m-%d 00:00:00")
            
            # Count commits
            commits_cmd = f"git log --since='{since}' --oneline | wc -l"
            commits = int(subprocess.check_output(commits_cmd, shell=True, cwd=project_path).strip())
            
            # Get file changes if there are commits
            files_changed = 0
            lines_added = 0
            
            if commits > 0:
                try:
                    stats_cmd = f"git log --since='{since}' --numstat --pretty=format:"
                    stats_output = subprocess.check_output(stats_cmd, shell=True, cwd=project_path, text=True)
                    
                    changed_files = set()
                    for line in stats_output.strip().split('\n'):
                        if line.strip() and '\t' in line:
                            parts = line.split('\t')
                            if len(parts) >= 3:
                                try:
                                    lines_added += int(parts[0]) if parts[0] != '-' else 0
                                    changed_files.add(parts[2])
                                except ValueError:
                                    continue
                    
                    files_changed = len(changed_files)
                except:
                    pass
            
            return {
                "commits": commits,
                "files_changed": files_changed,
                "lines_added": lines_added
            }
        except:
            return {"commits": 0, "files_changed": 0, "lines_added": 0}
    
    def is_git_repo(self, path):
        """Check if path is a git repository"""
        try:
            subprocess.check_output("git rev-parse --git-dir", shell=True, cwd=path, stderr=subprocess.DEVNULL)
            return True
        except:
            return False
    
    def get_project_decisions(self, project_name):
        """Get decisions logged for a project today"""
        decisions_file = os.path.join(self.admin_root, "decisions", f"decisions_{self.today.strftime('%Y%m%d')}.json")
        
        if os.path.exists(decisions_file):
            try:
                with open(decisions_file, 'r') as f:
                    decisions = json.load(f)
                
                # Count decisions for this project
                project_decisions = [d for d in decisions if d.get("project") == project_name and d.get("timestamp", "").startswith(self.date_str)]
                return len(project_decisions)
            except:
                pass
        
        return 0
    
    def estimate_project_completion(self, progress_data):
        """Estimate project completion percentage"""
        # Simple heuristic based on activity and structure
        accomplishments = len(progress_data.get("accomplishments", []))
        has_plan = len(progress_data.get("next_day_plan", [])) > 0
        has_summary = bool(progress_data.get("daily_summary"))
        commits = progress_data.get("metrics", {}).get("commits", 0)
        
        # Base score from activity
        score = min(accomplishments * 8 + commits * 3, 60)
        
        # Organization bonus
        if has_plan:
            score += 15
        if has_summary:
            score += 10
        
        # Blockers penalty
        score -= len(progress_data.get("blockers", [])) * 5
        
        # Mood factor
        mood = progress_data.get("mood", "")
        if mood in ["productive", "focused", "energetic"]:
            score += 10
        elif mood in ["frustrated", "tired"]:
            score -= 5
        
        return max(0, min(100, score))
    
    def calculate_health_score(self, project_data, git_metrics):
        """Calculate overall project health score (0-100)"""
        score = 50  # Base score
        
        # Activity factors
        if project_data["today_accomplishments"] > 0:
            score += 20
        if git_metrics["commits"] > 0:
            score += 15
        if project_data["today_decisions"] > 0:
            score += 10
        
        # Planning factors
        if project_data["next_milestones"]:
            score += 10
        
        # Health penalties
        score -= len(project_data["blockers"]) * 15
        
        # Activity level
        total_activity = project_data["today_accomplishments"] + git_metrics["commits"]
        if total_activity > 5:
            score += 10
        elif total_activity == 0 and project_data["is_active"]:
            score -= 20
        
        return max(0, min(100, score))
    
    def get_ecosystem_trends(self):
        """Get ecosystem-wide trends over the past week"""
        trends = {
            "weekly_velocity": [],
            "project_activity": {},
            "decision_frequency": [],
            "overall_trend": "stable"
        }
        
        # Look at past 7 days
        for i in range(7):
            date = self.today - timedelta(days=i)
            date_str = date.strftime("%Y-%m-%d")
            
            daily_file = os.path.join(self.ecosystem_daily_dir, f"{date_str}.json")
            if os.path.exists(daily_file):
                try:
                    with open(daily_file, 'r') as f:
                        daily_data = json.load(f)
                    
                    trends["weekly_velocity"].append({
                        "date": date_str,
                        "accomplishments": daily_data["ecosystem_overview"]["total_accomplishments"],
                        "commits": daily_data["ecosystem_overview"]["total_commits"]
                    })
                except:
                    continue
        
        # Calculate overall trend
        if len(trends["weekly_velocity"]) >= 2:
            recent = trends["weekly_velocity"][0]["accomplishments"]
            older = trends["weekly_velocity"][-1]["accomplishments"]
            if recent > older * 1.2:
                trends["overall_trend"] = "increasing"
            elif recent < older * 0.8:
                trends["overall_trend"] = "decreasing"
        
        return trends
    
    def analyze_resource_allocation(self):
        """Analyze resource allocation across projects"""
        return {
            "high_activity_projects": [],
            "underutilized_projects": [],
            "resource_conflicts": [],
            "recommendations": []
        }
    
    def get_velocity_insights(self):
        """Get velocity insights across the ecosystem"""
        return {
            "avg_daily_velocity": 0,
            "peak_performance_days": [],
            "productivity_patterns": {},
            "velocity_by_category": {}
        }
    
    def generate_weekly_report(self):
        """Generate weekly ecosystem report"""
        week_start = self.today - timedelta(days=7)
        week_end = self.today
        
        report = {
            "week_period": f"{week_start.strftime('%Y-%m-%d')} to {week_end.strftime('%Y-%m-%d')}",
            "summary": {},
            "highlights": [],
            "challenges": [],
            "recommendations": []
        }
        
        # Collect week data
        week_data = []
        for i in range(7):
            date = week_start + timedelta(days=i)
            date_str = date.strftime("%Y-%m-%d")
            daily_file = os.path.join(self.ecosystem_daily_dir, f"{date_str}.json")
            
            if os.path.exists(daily_file):
                try:
                    with open(daily_file, 'r') as f:
                        week_data.append(json.load(f))
                except:
                    continue
        
        if week_data:
            # Calculate weekly totals
            total_accomplishments = sum(d["ecosystem_overview"]["total_accomplishments"] for d in week_data)
            total_commits = sum(d["ecosystem_overview"]["total_commits"] for d in week_data)
            avg_active_projects = sum(d["ecosystem_overview"]["active_projects"] for d in week_data) / len(week_data)
            
            report["summary"] = {
                "total_accomplishments": total_accomplishments,
                "total_commits": total_commits,
                "avg_active_projects": round(avg_active_projects, 1),
                "most_productive_day": max(week_data, key=lambda x: x["ecosystem_overview"]["total_accomplishments"])["date"]
            }
        
        # Save report
        report_file = os.path.join(self.reports_dir, f"weekly-{self.today.strftime('%Y-%W')}.json")
        with open(report_file, 'w') as f:
            json.dump(report, f, indent=2)
        
        return report
    
    def view_ecosystem_dashboard(self):
        """Display ecosystem dashboard"""
        ecosystem_data = self.collect_all_project_progress()
        
        print(f"\n🌍 Ecosystem Progress Dashboard - {self.date_str}")
        print("=" * 70)
        
        overview = ecosystem_data["ecosystem_overview"]
        print(f"📊 Overview:")
        print(f"   Projects: {overview['active_projects']}/{overview['total_projects']} active")
        print(f"   Accomplishments: {overview['total_accomplishments']}")
        print(f"   Commits: {overview['total_commits']}")
        print(f"   Decisions: {overview['total_decisions']}")
        print(f"   Avg Velocity: {overview['avg_velocity']}")
        
        if overview["top_projects"]:
            print(f"\n🏆 Top Performing Projects:")
            for project in overview["top_projects"]:
                print(f"   • {project['name']}: {project['activity_score']} activity points")
        
        if overview["struggling_projects"]:
            print(f"\n⚠️ Projects Needing Attention:")
            for project in overview["struggling_projects"]:
                reason = "has blockers" if project["reason"] == "blockers" else "no progress today"
                print(f"   • {project['name']}: {reason}")
        
        print(f"\n📂 Progress by Category:")
        for category, data in ecosystem_data["categories"].items():
            summary = data["summary"]
            print(f"   {category.title()}: {summary['active_projects']}/{summary['total_projects']} active, "
                  f"{summary['accomplishments']} accomplishments, {summary['commits']} commits")
        
        trends = ecosystem_data["trends"]
        trend_emoji = "📈" if trends["overall_trend"] == "increasing" else "📉" if trends["overall_trend"] == "decreasing" else "📊"
        print(f"\n{trend_emoji} Weekly Trend: {trends['overall_trend']}")

def main():
    parser = argparse.ArgumentParser(description="Ecosystem Progress Dashboard")
    parser.add_argument("command", choices=["dashboard", "collect", "weekly", "project"], 
                       help="Command to execute")
    parser.add_argument("--project", help="Specific project for project command")
    
    args = parser.parse_args()
    
    dashboard = EcosystemProgressDashboard()
    
    if args.command == "dashboard":
        dashboard.view_ecosystem_dashboard()
    elif args.command == "collect":
        data = dashboard.collect_all_project_progress()
        print(f"✅ Ecosystem data collected: {dashboard.ecosystem_daily_dir}/{dashboard.date_str}.json")
    elif args.command == "weekly":
        report = dashboard.generate_weekly_report()
        print(f"✅ Weekly report generated")
        print(f"📊 Summary: {report['summary']}")
    elif args.command == "project":
        if not args.project:
            print("Error: --project required for project command")
            return
        
        project_data = dashboard.get_project_progress(args.project)
        if project_data:
            print(f"\n📁 {args.project} Progress")
            print("=" * 40)
            print(f"Status: {'🟢 Active' if project_data['is_active'] else '⚪ Inactive'}")
            print(f"Accomplishments: {project_data['today_accomplishments']}")
            print(f"Commits: {project_data['today_commits']}")
            print(f"Decisions: {project_data['today_decisions']}")
            print(f"Health Score: {project_data['health_score']}/100")
            
            if project_data["blockers"]:
                print(f"Blockers: {len(project_data['blockers'])}")
        else:
            print(f"Project '{args.project}' not found")

if __name__ == "__main__":
    main()