#!/usr/bin/env python3
"""
Decision Logger for Claude Sessions
Logs decisions, discussions, and important context from Claude interactions
"""

import os
import json
import sys
from datetime import datetime
from pathlib import Path
import argparse
from typing import Dict, Any, Optional

DECISIONS_DIR = "/Users/MAC/Documents/projects/admin/decisions"

class DecisionLogger:
    def __init__(self):
        self.decisions_dir = Path(DECISIONS_DIR)
        self.decisions_dir.mkdir(parents=True, exist_ok=True)
        self.timestamp = datetime.now()
        
    def log_decision(self, 
                    title: str,
                    description: str,
                    category: str = "general",
                    project: Optional[str] = None,
                    tags: Optional[list] = None,
                    metadata: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Log a single decision or discussion point"""
        
        decision = {
            "id": self.timestamp.strftime("%Y%m%d_%H%M%S"),
            "timestamp": self.timestamp.isoformat(),
            "title": title,
            "description": description,
            "category": category,
            "project": project,
            "tags": tags or [],
            "metadata": metadata or {}
        }
        
        # Save to daily decision file
        daily_file = self.decisions_dir / f"decisions_{self.timestamp.strftime('%Y%m%d')}.json"
        
        # Load existing decisions for today
        decisions_today = []
        if daily_file.exists():
            try:
                with open(daily_file, 'r') as f:
                    decisions_today = json.load(f)
            except:
                decisions_today = []
        
        # Append new decision
        decisions_today.append(decision)
        
        # Save updated decisions
        with open(daily_file, 'w') as f:
            json.dump(decisions_today, f, indent=2)
        
        # Also save to individual file for important decisions
        if category in ["architecture", "critical", "milestone"]:
            individual_file = self.decisions_dir / f"decision_{decision['id']}.json"
            with open(individual_file, 'w') as f:
                json.dump(decision, f, indent=2)
        
        return decision
    
    def log_progress(self, 
                    project: str,
                    task: str,
                    status: str,
                    details: Optional[str] = None,
                    completion_percentage: Optional[int] = None) -> Dict[str, Any]:
        """Log progress on a specific task"""
        
        progress = {
            "id": self.timestamp.strftime("%Y%m%d_%H%M%S"),
            "timestamp": self.timestamp.isoformat(),
            "project": project,
            "task": task,
            "status": status,
            "details": details,
            "completion_percentage": completion_percentage,
            "type": "progress"
        }
        
        # Save to progress file
        progress_file = self.decisions_dir / f"progress_{self.timestamp.strftime('%Y%m%d')}.json"
        
        # Load existing progress
        progress_today = []
        if progress_file.exists():
            try:
                with open(progress_file, 'r') as f:
                    progress_today = json.load(f)
            except:
                progress_today = []
        
        # Append new progress
        progress_today.append(progress)
        
        # Save updated progress
        with open(progress_file, 'w') as f:
            json.dump(progress_today, f, indent=2)
        
        return progress
    
    def log_discussion(self,
                      topic: str,
                      summary: str,
                      key_points: list,
                      action_items: Optional[list] = None,
                      project: Optional[str] = None) -> Dict[str, Any]:
        """Log a discussion with key points and action items"""
        
        discussion = {
            "id": self.timestamp.strftime("%Y%m%d_%H%M%S"),
            "timestamp": self.timestamp.isoformat(),
            "topic": topic,
            "summary": summary,
            "key_points": key_points,
            "action_items": action_items or [],
            "project": project,
            "type": "discussion"
        }
        
        # Save to discussion file
        discussion_file = self.decisions_dir / f"discussions_{self.timestamp.strftime('%Y%m%d')}.json"
        
        # Load existing discussions
        discussions_today = []
        if discussion_file.exists():
            try:
                with open(discussion_file, 'r') as f:
                    discussions_today = json.load(f)
            except:
                discussions_today = []
        
        # Append new discussion
        discussions_today.append(discussion)
        
        # Save updated discussions
        with open(discussion_file, 'w') as f:
            json.dump(discussions_today, f, indent=2)
        
        return discussion

def main():
    parser = argparse.ArgumentParser(description="Log decisions and discussions")
    parser.add_argument("--type", choices=["decision", "progress", "discussion"], 
                       default="decision", help="Type of log entry")
    parser.add_argument("--title", required=True, help="Title or topic")
    parser.add_argument("--description", required=True, help="Description or details")
    parser.add_argument("--project", help="Related project name")
    parser.add_argument("--category", default="general", help="Category for decisions")
    parser.add_argument("--tags", nargs="+", help="Tags for the entry")
    parser.add_argument("--status", help="Status for progress entries")
    parser.add_argument("--completion", type=int, help="Completion percentage")
    parser.add_argument("--key-points", nargs="+", help="Key points for discussions")
    parser.add_argument("--action-items", nargs="+", help="Action items from discussion")
    
    args = parser.parse_args()
    
    logger = DecisionLogger()
    
    if args.type == "decision":
        result = logger.log_decision(
            title=args.title,
            description=args.description,
            category=args.category,
            project=args.project,
            tags=args.tags
        )
        print(f"✅ Decision logged: {result['id']}")
        
    elif args.type == "progress":
        result = logger.log_progress(
            project=args.project or "general",
            task=args.title,
            status=args.status or "in_progress",
            details=args.description,
            completion_percentage=args.completion
        )
        print(f"📈 Progress logged: {result['id']}")
        
    elif args.type == "discussion":
        result = logger.log_discussion(
            topic=args.title,
            summary=args.description,
            key_points=args.key_points or [],
            action_items=args.action_items,
            project=args.project
        )
        print(f"💬 Discussion logged: {result['id']}")
    
    print(json.dumps(result, indent=2))

if __name__ == "__main__":
    main()