#!/usr/bin/env python3
"""
CAIA Admin Dashboard
Comprehensive overview of all admin systems and quick actions
"""

import os
import json
import subprocess
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Any

ADMIN_ROOT = "/Users/MAC/Documents/projects/admin"
SCRIPTS_DIR = os.path.join(ADMIN_ROOT, "scripts")

class AdminDashboard:
    def __init__(self):
        self.admin_root = Path(ADMIN_ROOT)
        self.scripts_dir = Path(SCRIPTS_DIR)
        
        # Admin system components
        self.admin_systems = {
            "context_management": {
                "description": "Project context capture and decision tracking",
                "scripts": ["capture_context.py", "log_decision.py", "query_context.py"],
                "status_file": "context/latest.json",
                "daemon": "capture_context.py --daemon"
            },
            "caia_tracking": {
                "description": "CAIA component and open source tracking",
                "scripts": ["caia_tracker.py", "caia_status.sh"],
                "status_file": "caia-tracking/latest_summary.json"
            },
            "real_time_monitoring": {
                "description": "Live monitoring of code quality, git, security",
                "scripts": ["realtime_monitor.py"],
                "status_file": "monitoring/latest.json"
            },
            "daily_updates": {
                "description": "Daily update checks and self-improvement",
                "scripts": ["daily_update_check.py"],
                "status_file": "updates/latest_updates.json"
            },
            "monorepo_management": {
                "description": "Mono-repo setup and quality gates",
                "scripts": ["monorepo_manager.py"],
                "config_file": "lerna.json"
            },
            "qa_automation": {
                "description": "Comprehensive quality assurance automation",
                "scripts": ["qa_automation.py"],
                "status_file": "qa/latest_qa_report.json"
            },
            "ccu_integration": {
                "description": "Claude Code Ultimate integration",
                "scripts": ["../claude-code-ultimate/configs/hooks/caia-session-startup.sh"],
                "config_file": "../claude-code-ultimate/configs/core/caia-integration.json"
            }
        }
        
        # Quick actions
        self.quick_actions = {
            "status": {
                "description": "Show current system status",
                "command": "admin/scripts/quick_status.sh",
                "category": "overview"
            },
            "caia_status": {
                "description": "CAIA project specific status",
                "command": "admin/scripts/caia_status.sh",
                "category": "caia"
            },
            "monitor_projects": {
                "description": "Run real-time monitoring scan",
                "command": "python3 admin/scripts/realtime_monitor.py --scan",
                "category": "monitoring"
            },
            "check_updates": {
                "description": "Check for daily updates",
                "command": "python3 admin/scripts/daily_update_check.py",
                "category": "updates"
            },
            "run_qa": {
                "description": "Run quality assurance for all projects",
                "command": "python3 admin/scripts/qa_automation.py --all",
                "category": "quality"
            },
            "setup_monorepo": {
                "description": "Setup CAIA monorepo structure",
                "command": "python3 admin/scripts/monorepo_manager.py --setup",
                "category": "monorepo"
            },
            "start_daemon": {
                "description": "Start context capture daemon",
                "command": "admin/scripts/start_context_daemon.sh",
                "category": "automation"
            },
            "stop_daemon": {
                "description": "Stop context capture daemon",
                "command": "admin/scripts/stop_context_daemon.sh",
                "category": "automation"
            }
        }
    
    def run_command(self, command: List[str], cwd: Path = None) -> Dict[str, Any]:
        """Run a command and return result"""
        try:
            result = subprocess.run(
                command,
                capture_output=True,
                text=True,
                cwd=cwd or self.admin_root.parent
            )
            return {
                "success": result.returncode == 0,
                "stdout": result.stdout.strip(),
                "stderr": result.stderr.strip(),
                "returncode": result.returncode
            }
        except Exception as e:
            return {"success": False, "error": str(e), "returncode": -1}
    
    def check_system_health(self) -> Dict[str, Any]:
        """Check health of all admin systems"""
        health_status = {
            "overall_health": "unknown",
            "systems": {},
            "daemons": {},
            "critical_issues": [],
            "warnings": []
        }
        
        healthy_systems = 0
        total_systems = len(self.admin_systems)
        
        for system_name, system_config in self.admin_systems.items():
            system_health = {
                "status": "unknown",
                "scripts_available": 0,
                "scripts_missing": 0,
                "has_status_file": False,
                "last_activity": None,
                "issues": []
            }
            
            # Check if scripts exist
            for script in system_config["scripts"]:
                script_path = self.scripts_dir / script if not script.startswith("../") else self.admin_root / script
                if script_path.exists():
                    system_health["scripts_available"] += 1
                else:
                    system_health["scripts_missing"] += 1
                    system_health["issues"].append(f"Missing script: {script}")
            
            # Check status file
            if "status_file" in system_config:
                status_file = self.admin_root / system_config["status_file"]
                if status_file.exists():
                    system_health["has_status_file"] = True
                    try:
                        stat = status_file.stat()
                        system_health["last_activity"] = datetime.fromtimestamp(stat.st_mtime).isoformat()
                    except:
                        pass
                else:
                    system_health["issues"].append("No status file found")
            
            # Check config file
            if "config_file" in system_config:
                config_file = self.admin_root / system_config["config_file"]
                if not config_file.exists():
                    system_health["issues"].append("Missing config file")
            
            # Determine system status
            if system_health["scripts_missing"] == 0 and len(system_health["issues"]) == 0:
                system_health["status"] = "healthy"
                healthy_systems += 1
            elif system_health["scripts_missing"] == 0:
                system_health["status"] = "warning"
            else:
                system_health["status"] = "critical"
                health_status["critical_issues"].extend([f"{system_name}: {issue}" for issue in system_health["issues"]])
            
            health_status["systems"][system_name] = system_health
        
        # Check daemon status
        daemon_check = self.run_command(["pgrep", "-f", "capture_context.py --daemon"])
        health_status["daemons"]["context_capture"] = {
            "running": daemon_check["success"],
            "pid": daemon_check["stdout"] if daemon_check["success"] else None
        }
        
        # Determine overall health
        health_percentage = (healthy_systems / total_systems) * 100
        
        if health_percentage >= 90:
            health_status["overall_health"] = "excellent"
        elif health_percentage >= 75:
            health_status["overall_health"] = "good"
        elif health_percentage >= 50:
            health_status["overall_health"] = "warning"
        else:
            health_status["overall_health"] = "critical"
        
        return health_status
    
    def get_recent_activity(self) -> Dict[str, Any]:
        """Get recent activity across all systems"""
        activity = {
            "last_context_capture": None,
            "last_decision_logged": None,
            "last_monitoring_scan": None,
            "last_update_check": None,
            "last_qa_run": None,
            "active_alerts": 0
        }
        
        # Check latest context capture
        context_file = self.admin_root / "context" / "latest.json"
        if context_file.exists():
            try:
                with open(context_file, 'r') as f:
                    context_data = json.load(f)
                    activity["last_context_capture"] = context_data.get("timestamp")
            except:
                pass
        
        # Check latest decisions
        decision_files = list((self.admin_root / "decisions").glob("decisions_*.json"))
        if decision_files:
            latest_decision_file = max(decision_files, key=lambda f: f.stat().st_mtime)
            activity["last_decision_logged"] = datetime.fromtimestamp(latest_decision_file.stat().st_mtime).isoformat()
        
        # Check monitoring
        monitoring_file = self.admin_root / "monitoring" / "latest.json"
        if monitoring_file.exists():
            try:
                with open(monitoring_file, 'r') as f:
                    monitoring_data = json.load(f)
                    activity["last_monitoring_scan"] = monitoring_data.get("timestamp")
                    activity["active_alerts"] = monitoring_data.get("summary", {}).get("total_alerts", 0)
            except:
                pass
        
        # Check updates
        updates_file = self.admin_root / "updates" / "latest_updates.json"
        if updates_file.exists():
            try:
                with open(updates_file, 'r') as f:
                    updates_data = json.load(f)
                    activity["last_update_check"] = updates_data.get("timestamp")
            except:
                pass
        
        # Check QA
        qa_file = self.admin_root / "qa" / "latest_qa_report.json"
        if qa_file.exists():
            try:
                with open(qa_file, 'r') as f:
                    qa_data = json.load(f)
                    activity["last_qa_run"] = qa_data.get("timestamp")
            except:
                pass
        
        return activity
    
    def generate_dashboard_report(self) -> str:
        """Generate comprehensive dashboard report"""
        health = self.check_system_health()
        activity = self.get_recent_activity()
        
        # Health status emoji
        health_emoji = {
            "excellent": "🟢",
            "good": "🟡", 
            "warning": "🟠",
            "critical": "🔴",
            "unknown": "⚪"
        }
        
        report_lines = [
            "=" * 80,
            "🎯 CAIA ADMIN DASHBOARD",
            f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
            "=" * 80,
            "",
            f"## SYSTEM HEALTH {health_emoji.get(health['overall_health'], '⚪')} {health['overall_health'].upper()}",
            ""
        ]
        
        # System status breakdown
        for system_name, system_health in health["systems"].items():
            status_emoji = {"healthy": "✅", "warning": "⚠️", "critical": "❌", "unknown": "⚪"}
            emoji = status_emoji.get(system_health["status"], "⚪")
            
            system_display = system_name.replace("_", " ").title()
            report_lines.append(f"### {emoji} {system_display}")
            report_lines.append(f"   Scripts: {system_health['scripts_available']}/{system_health['scripts_available'] + system_health['scripts_missing']}")
            
            if system_health["last_activity"]:
                last_activity = datetime.fromisoformat(system_health["last_activity"])
                hours_ago = (datetime.now() - last_activity).total_seconds() / 3600
                report_lines.append(f"   Last Activity: {hours_ago:.1f}h ago")
            
            if system_health["issues"]:
                for issue in system_health["issues"]:
                    report_lines.append(f"   ⚠️  {issue}")
            
            report_lines.append("")
        
        # Daemon status
        report_lines.append("## AUTOMATED SERVICES")
        daemon_status = health["daemons"]["context_capture"]
        daemon_emoji = "🟢" if daemon_status["running"] else "🔴"
        report_lines.append(f"   {daemon_emoji} Context Capture Daemon: {'Running' if daemon_status['running'] else 'Stopped'}")
        if daemon_status["pid"]:
            report_lines.append(f"      PID: {daemon_status['pid']}")
        report_lines.append("")
        
        # Recent activity
        report_lines.append("## RECENT ACTIVITY")
        
        activity_items = [
            ("Context Capture", activity["last_context_capture"]),
            ("Decision Logged", activity["last_decision_logged"]),
            ("Monitoring Scan", activity["last_monitoring_scan"]),
            ("Update Check", activity["last_update_check"]),
            ("QA Analysis", activity["last_qa_run"])
        ]
        
        for activity_name, timestamp in activity_items:
            if timestamp:
                try:
                    activity_time = datetime.fromisoformat(timestamp.replace('Z', '+00:00').replace('+00:00', ''))
                    hours_ago = (datetime.now() - activity_time).total_seconds() / 3600
                    
                    if hours_ago < 1:
                        time_display = f"{int(hours_ago * 60)}m ago"
                    elif hours_ago < 24:
                        time_display = f"{hours_ago:.1f}h ago"
                    else:
                        time_display = f"{hours_ago / 24:.1f}d ago"
                    
                    report_lines.append(f"   📊 {activity_name}: {time_display}")
                except:
                    report_lines.append(f"   📊 {activity_name}: Recently")
            else:
                report_lines.append(f"   ⚪ {activity_name}: Never")
        
        if activity["active_alerts"] > 0:
            report_lines.append(f"   🚨 Active Alerts: {activity['active_alerts']}")
        
        report_lines.append("")
        
        # Critical issues
        if health["critical_issues"]:
            report_lines.append("## 🚨 CRITICAL ISSUES")
            for issue in health["critical_issues"]:
                report_lines.append(f"   • {issue}")
            report_lines.append("")
        
        # Quick actions
        report_lines.append("## 🚀 QUICK ACTIONS")
        
        action_categories = {}
        for action_name, action_config in self.quick_actions.items():
            category = action_config["category"]
            if category not in action_categories:
                action_categories[category] = []
            action_categories[category].append((action_name, action_config))
        
        for category, actions in action_categories.items():
            report_lines.append(f"\n### {category.title()}")
            for action_name, action_config in actions:
                report_lines.append(f"   • {action_config['description']}")
                report_lines.append(f"     {action_config['command']}")
        
        # Admin commands summary
        report_lines.extend([
            "",
            "## 📋 SYSTEM COMMANDS",
            "",
            "### Context Management",
            "   • Quick status: admin/scripts/quick_status.sh",
            "   • Full summary: python3 admin/scripts/query_context.py --command summary",
            "   • Log decision: python3 admin/scripts/log_decision.py --help",
            "",
            "### CAIA Specific", 
            "   • CAIA status: admin/scripts/caia_status.sh",
            "   • Component tracking: python3 admin/scripts/caia_tracker.py --report",
            "   • Publish component: cd caia/utils/parallel/cc-orchestrator && npm publish",
            "",
            "### Monitoring & QA",
            "   • Real-time monitoring: python3 admin/scripts/realtime_monitor.py --scan",
            "   • Quality assurance: python3 admin/scripts/qa_automation.py --all",
            "   • Daily updates: python3 admin/scripts/daily_update_check.py",
            "",
            "### Monorepo Management",
            "   • Setup monorepo: python3 admin/scripts/monorepo_manager.py --setup",
            "   • Quality check: python3 admin/scripts/monorepo_manager.py --quality",
            "   • Bootstrap packages: cd /Users/MAC/Documents/projects && npm run bootstrap",
            "",
            "### Automation",
            "   • Start context daemon: admin/scripts/start_context_daemon.sh",
            "   • Stop context daemon: admin/scripts/stop_context_daemon.sh",
            "   • Dashboard: python3 admin/scripts/admin_dashboard.py",
            "",
            "=" * 80
        ])
        
        return "\n".join(report_lines)

def main():
    import argparse
    
    parser = argparse.ArgumentParser(description="CAIA Admin Dashboard")
    parser.add_argument("--health", action="store_true", help="Show system health only")
    parser.add_argument("--activity", action="store_true", help="Show recent activity only")
    parser.add_argument("--actions", action="store_true", help="Show available actions")
    parser.add_argument("--json", action="store_true", help="Output JSON format")
    
    args = parser.parse_args()
    
    dashboard = AdminDashboard()
    
    if args.health:
        health = dashboard.check_system_health()
        if args.json:
            print(json.dumps(health, indent=2))
        else:
            print(f"Overall Health: {health['overall_health']}")
            for system, status in health["systems"].items():
                print(f"  {system}: {status['status']}")
    
    elif args.activity:
        activity = dashboard.get_recent_activity()
        if args.json:
            print(json.dumps(activity, indent=2))
        else:
            print("Recent Activity:")
            for key, value in activity.items():
                if value:
                    print(f"  {key}: {value}")
    
    elif args.actions:
        if args.json:
            print(json.dumps(dashboard.quick_actions, indent=2))
        else:
            print("Available Actions:")
            for action_name, action_config in dashboard.quick_actions.items():
                print(f"  • {action_config['description']}")
                print(f"    {action_config['command']}")
    
    else:
        # Full dashboard
        report = dashboard.generate_dashboard_report()
        print(report)

if __name__ == "__main__":
    main()