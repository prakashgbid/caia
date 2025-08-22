#!/usr/bin/env python3
"""
Progress to Web - Convert Progress Logs to GitHub Pages
Converts JSON progress logs to markdown and commits them to repos for GitHub Pages
"""

import json
import os
import sys
import argparse
from datetime import datetime, timedelta
import subprocess
import glob
from pathlib import Path
import re

class ProgressToWeb:
    def __init__(self):
        self.projects_root = "/Users/MAC/Documents/projects"
        self.admin_root = "/Users/MAC/Documents/projects/admin"
        self.caia_root = "/Users/MAC/Documents/projects/caia"
        
        self.today = datetime.now()
        self.date_str = self.today.strftime("%Y-%m-%d")
        
        # GitHub Pages structure
        self.pages_structure = {
            "docs": "docs",  # Most repos use docs/ for GitHub Pages
            "pages": "pages",  # Alternative
            "site": "site",   # Alternative
            "_site": "_site"  # Jekyll default
        }
    
    def convert_progress_to_markdown(self, progress_data, repo_name):
        """Convert JSON progress data to markdown format"""
        if not progress_data:
            return ""
        
        date = progress_data.get("date", self.date_str)
        
        md_content = f"""# Daily Progress - {date}

## {repo_name}

"""
        
        # Daily Summary
        if progress_data.get("daily_summary"):
            md_content += f"**Summary**: {progress_data['daily_summary']}\n\n"
        
        # Metrics
        metrics = progress_data.get("metrics", {})
        if any(metrics.values()):
            md_content += "## 📊 Metrics\n\n"
            md_content += f"- **Commits**: {metrics.get('commits', 0)}\n"
            md_content += f"- **Files Changed**: {metrics.get('files_changed', 0)}\n"
            md_content += f"- **Lines Added**: {metrics.get('lines_added', 0)}\n"
            md_content += f"- **Lines Removed**: {metrics.get('lines_removed', 0)}\n\n"
        
        # Accomplishments
        accomplishments = progress_data.get("accomplishments", [])
        if accomplishments:
            md_content += "## ✅ Accomplishments\n\n"
            for i, acc in enumerate(accomplishments, 1):
                time_str = acc.get("time", "")
                type_emoji = self.get_type_emoji(acc.get("type", "feature"))
                md_content += f"### {i}. {type_emoji} {acc.get('title', 'Untitled')}\n"
                if time_str:
                    md_content += f"**Time**: {time_str}  \n"
                md_content += f"**Type**: {acc.get('type', 'feature')}  \n"
                md_content += f"**Complexity**: {acc.get('complexity', 'medium')}  \n"
                md_content += f"**Impact**: {acc.get('impact', 'medium')}  \n"
                if acc.get("description"):
                    md_content += f"\n{acc['description']}\n"
                
                if acc.get("files_changed"):
                    md_content += f"\n**Files changed**: {', '.join(acc['files_changed'])}\n"
                
                md_content += "\n"
        
        # Decisions
        decisions = progress_data.get("decisions", [])
        if decisions:
            md_content += "## 🤔 Decisions\n\n"
            for i, dec in enumerate(decisions, 1):
                time_str = dec.get("time", "")
                md_content += f"### {i}. {dec.get('decision', 'Untitled Decision')}\n"
                if time_str:
                    md_content += f"**Time**: {time_str}  \n"
                md_content += f"**Reasoning**: {dec.get('reasoning', '')}\n"
                
                alternatives = dec.get("alternatives_considered", [])
                if alternatives:
                    md_content += f"**Alternatives Considered**: {', '.join(alternatives)}\n"
                
                md_content += "\n"
        
        # Blockers
        blockers = progress_data.get("blockers", [])
        if blockers:
            md_content += "## 🚫 Blockers\n\n"
            for i, blocker in enumerate(blockers, 1):
                md_content += f"### {i}. {blocker.get('title', 'Untitled Blocker')}\n"
                md_content += f"**Impact**: {blocker.get('impact', '')}\n"
                if blocker.get("plan"):
                    md_content += f"**Resolution Plan**: {blocker['plan']}\n"
                md_content += "\n"
        
        # Next Day Plan
        next_day = progress_data.get("next_day_plan", [])
        if next_day:
            md_content += "## 📋 Tomorrow's Plan\n\n"
            for item in next_day:
                md_content += f"- {item}\n"
            md_content += "\n"
        
        # Mood and Energy
        mood = progress_data.get("mood")
        energy = progress_data.get("energy_level")
        if mood or energy:
            md_content += "## 😊 Mood & Energy\n\n"
            if mood:
                mood_emoji = self.get_mood_emoji(mood)
                md_content += f"**Mood**: {mood_emoji} {mood}\n"
            if energy:
                md_content += f"**Energy Level**: {energy}/10\n"
            md_content += "\n"
        
        # Notes
        notes = progress_data.get("notes")
        if notes:
            md_content += "## 📝 Notes\n\n"
            md_content += f"{notes}\n\n"
        
        # Footer
        md_content += "---\n\n"
        md_content += f"*Generated on {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}*\n"
        
        return md_content
    
    def get_type_emoji(self, work_type):
        """Get emoji for work type"""
        emojis = {
            "feature": "🆕",
            "bugfix": "🐛", 
            "refactor": "♻️",
            "docs": "📚",
            "test": "🧪",
            "chore": "🔧"
        }
        return emojis.get(work_type, "⚡")
    
    def get_mood_emoji(self, mood):
        """Get emoji for mood"""
        emojis = {
            "productive": "🚀",
            "focused": "🎯",
            "energetic": "⚡",
            "frustrated": "😤",
            "tired": "😴"
        }
        return emojis.get(mood, "😊")
    
    def find_or_create_pages_dir(self, repo_path):
        """Find or create GitHub Pages directory"""
        # Check for existing pages directories
        for pages_dir in self.pages_structure.keys():
            full_path = os.path.join(repo_path, pages_dir)
            if os.path.exists(full_path):
                return full_path
        
        # Create docs directory (GitHub Pages default)
        docs_dir = os.path.join(repo_path, "docs")
        os.makedirs(docs_dir, exist_ok=True)
        
        # Create basic _config.yml for Jekyll
        config_file = os.path.join(docs_dir, "_config.yml")
        if not os.path.exists(config_file):
            config_content = """title: Daily Progress Logs
description: Automated daily progress tracking
theme: minima
plugins:
  - jekyll-feed

# Progress logs configuration
collections:
  daily_logs:
    output: true
    permalink: /daily/:year/:month/:day/

defaults:
  - scope:
      path: ""
      type: "daily_logs"
    values:
      layout: "post"
"""
            with open(config_file, 'w') as f:
                f.write(config_content)
        
        return docs_dir
    
    def create_daily_logs_index(self, pages_dir, repo_name):
        """Create or update daily logs index page"""
        index_file = os.path.join(pages_dir, "daily-logs.md")
        
        # Get all daily log files
        daily_logs_dir = os.path.join(pages_dir, "_daily_logs")
        log_files = []
        
        if os.path.exists(daily_logs_dir):
            log_files = sorted([f for f in os.listdir(daily_logs_dir) if f.endswith('.md')], reverse=True)
        
        index_content = f"""---
layout: page
title: Daily Progress Logs
permalink: /daily-logs/
---

# 📈 Daily Progress Logs - {repo_name}

## Recent Progress

"""
        
        if log_files:
            for log_file in log_files[:30]:  # Show last 30 days
                date_match = re.search(r'(\d{4}-\d{2}-\d{2})', log_file)
                if date_match:
                    date_str = date_match.group(1)
                    date_obj = datetime.strptime(date_str, "%Y-%m-%d")
                    formatted_date = date_obj.strftime("%B %d, %Y")
                    index_content += f"- [{formatted_date}]({{% link _daily_logs/{log_file} %}})\n"
        else:
            index_content += "*No progress logs yet. Start logging with `%lp` command!*\n"
        
        index_content += f"""

## How to View

- **Latest Progress**: See most recent entries above
- **All Logs**: Browse the complete history
- **JSON Data**: Raw data available in repo's `PROGRESS/` directory

## How to Log Progress

Use Claude Code admin commands:
- `%lp "title" "description"` - Log accomplishments
- `%pt` - View today's progress  
- `%pw` - View weekly summary

---

*Updated automatically via admin progress system*
"""
        
        with open(index_file, 'w') as f:
            f.write(index_content)
    
    def commit_progress_to_repo(self, repo_path, progress_data, repo_name):
        """Commit progress data to repository for GitHub Pages"""
        if not self.is_git_repo(repo_path):
            print(f"⚠️ {repo_name} is not a git repository")
            return False
        
        # Find or create pages directory
        pages_dir = self.find_or_create_pages_dir(repo_path)
        
        # Create daily logs collection directory
        daily_logs_dir = os.path.join(pages_dir, "_daily_logs")
        os.makedirs(daily_logs_dir, exist_ok=True)
        
        # Convert progress to markdown
        markdown_content = self.convert_progress_to_markdown(progress_data, repo_name)
        
        if not markdown_content.strip():
            print(f"ℹ️ No progress data for {repo_name}")
            return False
        
        # Create markdown file
        date = progress_data.get("date", self.date_str)
        md_filename = f"{date}-daily-progress.md"
        md_file_path = os.path.join(daily_logs_dir, md_filename)
        
        # Add Jekyll front matter
        jekyll_content = f"""---
layout: post
title: "Daily Progress - {date}"
date: {date}
categories: progress daily
---

{markdown_content}"""
        
        with open(md_file_path, 'w') as f:
            f.write(jekyll_content)
        
        # Update daily logs index
        self.create_daily_logs_index(pages_dir, repo_name)
        
        # Git operations
        try:
            # Add files
            subprocess.run(["git", "add", pages_dir], cwd=repo_path, check=True)
            
            # Check if there are changes to commit
            result = subprocess.run(["git", "diff", "--cached", "--quiet"], cwd=repo_path)
            if result.returncode == 0:
                print(f"ℹ️ No changes to commit for {repo_name}")
                return False
            
            # Commit
            commit_msg = f"docs: Add daily progress log for {date}\n\n🤖 Auto-generated from progress tracking system"
            subprocess.run(["git", "commit", "-m", commit_msg], cwd=repo_path, check=True)
            
            # Push (optional - you might want to control this)
            try:
                subprocess.run(["git", "push", "origin", "HEAD"], cwd=repo_path, check=True)
                print(f"✅ Progress committed and pushed for {repo_name}")
                return True
            except subprocess.CalledProcessError:
                print(f"✅ Progress committed for {repo_name} (push failed - manual push needed)")
                return True
                
        except subprocess.CalledProcessError as e:
            print(f"❌ Failed to commit progress for {repo_name}: {e}")
            return False
    
    def publish_individual_repo_progress(self, repo_name):
        """Publish progress for a specific repository"""
        repo_path = os.path.join(self.projects_root, repo_name)
        
        if not os.path.exists(repo_path):
            print(f"❌ Repository {repo_name} not found")
            return False
        
        # Load today's progress
        progress_file = os.path.join(repo_path, "PROGRESS", "2025-08", "daily", f"{self.date_str}.json")
        
        if not os.path.exists(progress_file):
            print(f"ℹ️ No progress data for {repo_name} today")
            return False
        
        try:
            with open(progress_file, 'r') as f:
                progress_data = json.load(f)
            
            return self.commit_progress_to_repo(repo_path, progress_data, repo_name)
            
        except Exception as e:
            print(f"❌ Error reading progress for {repo_name}: {e}")
            return False
    
    def publish_all_repos_progress(self):
        """Publish progress for all repositories"""
        published_repos = []
        failed_repos = []
        
        # Scan all project directories
        for item in os.listdir(self.projects_root):
            item_path = os.path.join(self.projects_root, item)
            
            if os.path.isdir(item_path) and not item.startswith('.'):
                if self.is_git_repo(item_path):
                    if self.publish_individual_repo_progress(item):
                        published_repos.append(item)
                    else:
                        failed_repos.append(item)
        
        return {
            "published": published_repos,
            "failed": failed_repos
        }
    
    def create_caia_aggregated_page(self):
        """Create aggregated progress page for CAIA monorepo"""
        caia_pages_dir = self.find_or_create_pages_dir(self.caia_root)
        
        # Load CAIA progress data
        caia_rollup_file = os.path.join(self.caia_root, "progress", "daily-rollup", f"{self.date_str}.json")
        
        if not os.path.exists(caia_rollup_file):
            print("ℹ️ No CAIA rollup data for today")
            return False
        
        try:
            with open(caia_rollup_file, 'r') as f:
                caia_data = json.load(f)
            
            # Create markdown content
            md_content = self.create_caia_progress_markdown(caia_data)
            
            # Save to CAIA pages
            progress_file = os.path.join(caia_pages_dir, f"caia-progress-{self.date_str}.md")
            
            jekyll_content = f"""---
layout: post
title: "CAIA Progress Rollup - {self.date_str}"
date: {self.date_str}
categories: caia progress rollup
---

{md_content}"""
            
            with open(progress_file, 'w') as f:
                f.write(jekyll_content)
            
            # Commit to CAIA repo
            return self.commit_caia_progress(caia_pages_dir)
            
        except Exception as e:
            print(f"❌ Error creating CAIA aggregated page: {e}")
            return False
    
    def create_caia_progress_markdown(self, caia_data):
        """Create markdown for CAIA progress rollup"""
        date = caia_data.get("date", self.date_str)
        overview = caia_data.get("caia_overview", {})
        
        md_content = f"""# 🎯 CAIA Progress Rollup - {date}

## Overview

- **Total Components**: {overview.get('total_components', 0)}
- **Active Components**: {overview.get('active_components', 0)}
- **Total Accomplishments**: {overview.get('total_accomplishments', 0)}
- **Total Commits**: {overview.get('total_commits', 0)}
- **Average Completion**: {overview.get('average_completion', 0)}%

"""
        
        # Top Performers
        top_performers = overview.get('top_performers', [])
        if top_performers:
            md_content += "## 🏆 Top Performers\n\n"
            for performer in top_performers:
                md_content += f"- **{performer['name']}**: {performer['accomplishments']} accomplishments\n"
            md_content += "\n"
        
        # Blocked Components
        blocked = overview.get('blocked_components', [])
        if blocked:
            md_content += "## 🚫 Blocked Components\n\n"
            for block in blocked:
                md_content += f"- **{block['name']}**: {block['blockers']} blockers\n"
            md_content += "\n"
        
        # Category Progress
        categories = caia_data.get('categories', {})
        if categories:
            md_content += "## 📂 Progress by Category\n\n"
            for category, data in categories.items():
                summary = data.get('summary', {})
                md_content += f"### {category.title()}\n"
                md_content += f"- Active: {summary.get('active_components', 0)}/{summary.get('total_components', 0)}\n"
                md_content += f"- Accomplishments: {summary.get('accomplishments', 0)}\n"
                md_content += f"- Commits: {summary.get('commits', 0)}\n\n"
        
        return md_content
    
    def commit_caia_progress(self, pages_dir):
        """Commit CAIA progress to repository"""
        try:
            subprocess.run(["git", "add", pages_dir], cwd=self.caia_root, check=True)
            
            commit_msg = f"docs: Add CAIA progress rollup for {self.date_str}"
            subprocess.run(["git", "commit", "-m", commit_msg], cwd=self.caia_root, check=True)
            
            subprocess.run(["git", "push", "origin", "HEAD"], cwd=self.caia_root, check=True)
            print("✅ CAIA progress committed and pushed")
            return True
            
        except subprocess.CalledProcessError as e:
            print(f"❌ Failed to commit CAIA progress: {e}")
            return False
    
    def is_git_repo(self, path):
        """Check if path is a git repository"""
        try:
            subprocess.check_output("git rev-parse --git-dir", shell=True, cwd=path, stderr=subprocess.DEVNULL)
            return True
        except:
            return False

def main():
    parser = argparse.ArgumentParser(description="Progress to Web Publisher")
    parser.add_argument("command", choices=[
        "publish-repo", "publish-all", "publish-caia", "publish-ecosystem"
    ], help="Command to execute")
    parser.add_argument("--repo", help="Repository name for publish-repo command")
    
    args = parser.parse_args()
    
    publisher = ProgressToWeb()
    
    if args.command == "publish-repo":
        if not args.repo:
            print("Error: --repo required for publish-repo command")
            return
        
        success = publisher.publish_individual_repo_progress(args.repo)
        if success:
            repo_path = os.path.join(publisher.projects_root, args.repo)
            print(f"🌐 View online: https://prakashgbid.github.io/{args.repo}/daily-logs/")
    
    elif args.command == "publish-all":
        result = publisher.publish_all_repos_progress()
        
        if result["published"]:
            print(f"✅ Published progress for {len(result['published'])} repositories:")
            for repo in result["published"]:
                print(f"   • {repo}: https://prakashgbid.github.io/{repo}/daily-logs/")
        
        if result["failed"]:
            print(f"❌ Failed to publish {len(result['failed'])} repositories:")
            for repo in result["failed"]:
                print(f"   • {repo}")
    
    elif args.command == "publish-caia":
        success = publisher.create_caia_aggregated_page()
        if success:
            print("🌐 View CAIA progress: https://prakashgbid.github.io/caia/")
    
    elif args.command == "publish-ecosystem":
        # TODO: Implement ecosystem-wide publishing to admin repo
        print("🚧 Ecosystem publishing coming soon...")

if __name__ == "__main__":
    main()