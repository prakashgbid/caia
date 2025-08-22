#!/usr/bin/env python3
"""
Progress Logger - Individual Repo Progress Tracking
Creates and manages daily progress logs for any repository
"""

import json
import os
import sys
import argparse
from datetime import datetime, timedelta
import subprocess
import glob
from pathlib import Path

class ProgressLogger:
    def __init__(self, repo_path=None):
        self.repo_path = repo_path or os.getcwd()
        self.repo_name = os.path.basename(self.repo_path)
        self.progress_dir = os.path.join(self.repo_path, "PROGRESS")
        self.today = datetime.now()
        self.date_str = self.today.strftime("%Y-%m-%d")
        self.month_dir = os.path.join(self.progress_dir, self.today.strftime("%Y-%m"))
        self.daily_dir = os.path.join(self.month_dir, "daily")
        self.today_file = os.path.join(self.daily_dir, f"{self.date_str}.json")
        
        self.setup_directories()
    
    def setup_directories(self):
        """Create progress directory structure if it doesn't exist"""
        os.makedirs(self.daily_dir, exist_ok=True)
        os.makedirs(os.path.join(self.progress_dir, "templates"), exist_ok=True)
        os.makedirs(os.path.join(self.progress_dir, "scripts"), exist_ok=True)
        
        # Create templates if they don't exist
        self.create_templates()
    
    def create_templates(self):
        """Create progress log templates"""
        daily_template = {
            "repo": self.repo_name,
            "date": "YYYY-MM-DD",
            "daily_summary": "Brief summary of the day's work",
            "accomplishments": [
                {
                    "time": "HH:MM",
                    "type": "feature|bugfix|refactor|docs|test|chore",
                    "title": "Short title",
                    "description": "Detailed description",
                    "files_changed": ["file1.js", "file2.py"],
                    "complexity": "low|medium|high",
                    "impact": "low|medium|high"
                }
            ],
            "decisions": [
                {
                    "time": "HH:MM",
                    "decision": "What was decided",
                    "reasoning": "Why this decision was made",
                    "alternatives_considered": ["option1", "option2"]
                }
            ],
            "blockers": [
                {
                    "title": "Blocker description",
                    "impact": "How it affects progress",
                    "plan": "How to resolve it"
                }
            ],
            "next_day_plan": [
                "Task 1 for tomorrow",
                "Task 2 for tomorrow"
            ],
            "metrics": {
                "commits": 0,
                "files_changed": 0,
                "lines_added": 0,
                "lines_removed": 0,
                "tests_added": 0,
                "bugs_fixed": 0
            },
            "mood": "productive|frustrated|focused|energetic|tired",
            "energy_level": 8,
            "notes": "Any additional thoughts or observations"
        }
        
        template_file = os.path.join(self.progress_dir, "templates", "daily-template.json")
        if not os.path.exists(template_file):
            with open(template_file, 'w') as f:
                json.dump(daily_template, f, indent=2)
    
    def get_git_metrics(self):
        """Get git metrics for today"""
        try:
            # Get commits since midnight
            midnight = self.today.replace(hour=0, minute=0, second=0, microsecond=0)
            since = midnight.strftime("%Y-%m-%d 00:00:00")
            
            # Count commits
            commits_cmd = f"git log --since='{since}' --oneline | wc -l"
            commits = int(subprocess.check_output(commits_cmd, shell=True, cwd=self.repo_path).strip())
            
            # Get file changes
            if commits > 0:
                stats_cmd = f"git log --since='{since}' --numstat --pretty=format:"
                stats_output = subprocess.check_output(stats_cmd, shell=True, cwd=self.repo_path, text=True)
                
                lines_added = 0
                lines_removed = 0
                files_changed = set()
                
                for line in stats_output.strip().split('\n'):
                    if line.strip() and '\t' in line:
                        parts = line.split('\t')
                        if len(parts) >= 3:
                            try:
                                lines_added += int(parts[0]) if parts[0] != '-' else 0
                                lines_removed += int(parts[1]) if parts[1] != '-' else 0
                                files_changed.add(parts[2])
                            except ValueError:
                                continue
                
                return {
                    "commits": commits,
                    "files_changed": len(files_changed),
                    "lines_added": lines_added,
                    "lines_removed": lines_removed,
                    "tests_added": 0,  # Would need more sophisticated detection
                    "bugs_fixed": 0    # Would need commit message analysis
                }
            else:
                return {
                    "commits": 0,
                    "files_changed": 0,
                    "lines_added": 0,
                    "lines_removed": 0,
                    "tests_added": 0,
                    "bugs_fixed": 0
                }
        except Exception as e:
            print(f"Warning: Could not get git metrics: {e}")
            return {
                "commits": 0,
                "files_changed": 0,
                "lines_added": 0,
                "lines_removed": 0,
                "tests_added": 0,
                "bugs_fixed": 0
            }
    
    def load_today_progress(self):
        """Load today's progress if it exists"""
        if os.path.exists(self.today_file):
            with open(self.today_file, 'r') as f:
                return json.load(f)
        else:
            # Create new progress log
            metrics = self.get_git_metrics()
            return {
                "repo": self.repo_name,
                "date": self.date_str,
                "daily_summary": "",
                "accomplishments": [],
                "decisions": [],
                "blockers": [],
                "next_day_plan": [],
                "metrics": metrics,
                "mood": "",
                "energy_level": 5,
                "notes": ""
            }
    
    def save_progress(self, progress_data):
        """Save progress data to file"""
        # Update metrics before saving
        progress_data["metrics"] = self.get_git_metrics()
        
        with open(self.today_file, 'w') as f:
            json.dump(progress_data, f, indent=2)
        
        print(f"✅ Progress saved to {self.today_file}")
    
    def add_accomplishment(self, title, description, work_type="feature", complexity="medium", impact="medium"):
        """Add an accomplishment to today's progress"""
        progress = self.load_today_progress()
        
        accomplishment = {
            "time": datetime.now().strftime("%H:%M"),
            "type": work_type,
            "title": title,
            "description": description,
            "files_changed": self.get_recent_files(),
            "complexity": complexity,
            "impact": impact
        }
        
        progress["accomplishments"].append(accomplishment)
        self.save_progress(progress)
        
        print(f"📝 Added accomplishment: {title}")
    
    def add_decision(self, decision, reasoning, alternatives=None):
        """Add a decision to today's progress"""
        progress = self.load_today_progress()
        
        decision_entry = {
            "time": datetime.now().strftime("%H:%M"),
            "decision": decision,
            "reasoning": reasoning,
            "alternatives_considered": alternatives or []
        }
        
        progress["decisions"].append(decision_entry)
        self.save_progress(progress)
        
        print(f"🤔 Added decision: {decision}")
    
    def add_blocker(self, title, impact, plan=""):
        """Add a blocker to today's progress"""
        progress = self.load_today_progress()
        
        blocker = {
            "title": title,
            "impact": impact,
            "plan": plan
        }
        
        progress["blockers"].append(blocker)
        self.save_progress(progress)
        
        print(f"🚫 Added blocker: {title}")
    
    def set_summary(self, summary):
        """Set daily summary"""
        progress = self.load_today_progress()
        progress["daily_summary"] = summary
        self.save_progress(progress)
        
        print(f"📋 Updated daily summary")
    
    def set_mood(self, mood, energy_level=None):
        """Set mood and energy level"""
        progress = self.load_today_progress()
        progress["mood"] = mood
        if energy_level is not None:
            progress["energy_level"] = energy_level
        self.save_progress(progress)
        
        print(f"😊 Updated mood: {mood} (energy: {energy_level})")
    
    def get_recent_files(self):
        """Get recently changed files"""
        try:
            cmd = "git diff --name-only HEAD~1..HEAD"
            files = subprocess.check_output(cmd, shell=True, cwd=self.repo_path, text=True)
            return [f.strip() for f in files.split('\n') if f.strip()]
        except:
            return []
    
    def view_today(self):
        """Display today's progress"""
        progress = self.load_today_progress()
        
        print(f"\n📈 Progress for {self.repo_name} - {self.date_str}")
        print("=" * 60)
        
        if progress["daily_summary"]:
            print(f"📋 Summary: {progress['daily_summary']}")
        
        print(f"\n📊 Metrics:")
        for key, value in progress["metrics"].items():
            print(f"   {key.replace('_', ' ').title()}: {value}")
        
        if progress["accomplishments"]:
            print(f"\n✅ Accomplishments ({len(progress['accomplishments'])}):")
            for i, acc in enumerate(progress["accomplishments"], 1):
                print(f"   {i}. [{acc['time']}] {acc['title']} ({acc['type']})")
                print(f"      {acc['description']}")
        
        if progress["decisions"]:
            print(f"\n🤔 Decisions ({len(progress['decisions'])}):")
            for i, dec in enumerate(progress["decisions"], 1):
                print(f"   {i}. [{dec['time']}] {dec['decision']}")
                print(f"      Reasoning: {dec['reasoning']}")
        
        if progress["blockers"]:
            print(f"\n🚫 Blockers ({len(progress['blockers'])}):")
            for i, blocker in enumerate(progress["blockers"], 1):
                print(f"   {i}. {blocker['title']}")
                print(f"      Impact: {blocker['impact']}")
        
        if progress["mood"]:
            print(f"\n😊 Mood: {progress['mood']} (Energy: {progress['energy_level']}/10)")
        
        if progress["notes"]:
            print(f"\n📝 Notes: {progress['notes']}")
    
    def view_week(self):
        """Display this week's progress"""
        week_start = self.today - timedelta(days=self.today.weekday())
        
        print(f"\n📅 Weekly Progress for {self.repo_name}")
        print("=" * 60)
        
        total_accomplishments = 0
        total_decisions = 0
        total_commits = 0
        
        for i in range(7):
            date = week_start + timedelta(days=i)
            date_str = date.strftime("%Y-%m-%d")
            
            # Try to load progress file
            month_dir = os.path.join(self.progress_dir, date.strftime("%Y-%m"))
            daily_file = os.path.join(month_dir, "daily", f"{date_str}.json")
            
            if os.path.exists(daily_file):
                with open(daily_file, 'r') as f:
                    progress = json.load(f)
                
                day_name = date.strftime("%A")
                print(f"\n{day_name} ({date_str}):")
                
                if progress.get("daily_summary"):
                    print(f"  📋 {progress['daily_summary']}")
                
                acc_count = len(progress.get("accomplishments", []))
                dec_count = len(progress.get("decisions", []))
                commits = progress.get("metrics", {}).get("commits", 0)
                
                print(f"  📊 {acc_count} accomplishments, {dec_count} decisions, {commits} commits")
                
                total_accomplishments += acc_count
                total_decisions += dec_count
                total_commits += commits
            else:
                print(f"\n{date.strftime('%A')} ({date_str}): No progress logged")
        
        print(f"\n📈 Week Totals:")
        print(f"   Accomplishments: {total_accomplishments}")
        print(f"   Decisions: {total_decisions}")
        print(f"   Commits: {total_commits}")

def main():
    parser = argparse.ArgumentParser(description="Individual Repository Progress Logger")
    parser.add_argument("--repo", help="Repository path (defaults to current directory)")
    
    subparsers = parser.add_subparsers(dest="command", help="Available commands")
    
    # Add accomplishment
    acc_parser = subparsers.add_parser("add", help="Add an accomplishment")
    acc_parser.add_argument("title", help="Title of accomplishment")
    acc_parser.add_argument("description", help="Description of accomplishment")
    acc_parser.add_argument("--type", default="feature", choices=["feature", "bugfix", "refactor", "docs", "test", "chore"])
    acc_parser.add_argument("--complexity", default="medium", choices=["low", "medium", "high"])
    acc_parser.add_argument("--impact", default="medium", choices=["low", "medium", "high"])
    
    # Add decision
    dec_parser = subparsers.add_parser("decide", help="Log a decision")
    dec_parser.add_argument("decision", help="The decision made")
    dec_parser.add_argument("reasoning", help="Reasoning behind the decision")
    dec_parser.add_argument("--alternatives", nargs="*", help="Alternative options considered")
    
    # Add blocker
    block_parser = subparsers.add_parser("block", help="Log a blocker")
    block_parser.add_argument("title", help="Blocker title")
    block_parser.add_argument("impact", help="Impact description")
    block_parser.add_argument("--plan", help="Plan to resolve", default="")
    
    # Set summary
    sum_parser = subparsers.add_parser("summary", help="Set daily summary")
    sum_parser.add_argument("summary", help="Daily summary text")
    
    # Set mood
    mood_parser = subparsers.add_parser("mood", help="Set mood and energy")
    mood_parser.add_argument("mood", choices=["productive", "frustrated", "focused", "energetic", "tired"])
    mood_parser.add_argument("--energy", type=int, choices=range(1, 11), help="Energy level 1-10")
    
    # View commands
    subparsers.add_parser("today", help="View today's progress")
    subparsers.add_parser("week", help="View this week's progress")
    subparsers.add_parser("init", help="Initialize progress tracking for this repo")
    
    args = parser.parse_args()
    
    if not args.command:
        parser.print_help()
        return
    
    logger = ProgressLogger(args.repo)
    
    if args.command == "add":
        logger.add_accomplishment(args.title, args.description, args.type, args.complexity, args.impact)
    elif args.command == "decide":
        logger.add_decision(args.decision, args.reasoning, args.alternatives)
    elif args.command == "block":
        logger.add_blocker(args.title, args.impact, args.plan)
    elif args.command == "summary":
        logger.set_summary(args.summary)
    elif args.command == "mood":
        logger.set_mood(args.mood, args.energy)
    elif args.command == "today":
        logger.view_today()
    elif args.command == "week":
        logger.view_week()
    elif args.command == "init":
        print(f"✅ Progress tracking initialized for {logger.repo_name}")
        print(f"📁 Progress directory: {logger.progress_dir}")

if __name__ == "__main__":
    main()