#!/usr/bin/env python3
"""
Real-time Project Monitoring System
Monitors code quality, security, testing, git status, and more across all projects
"""

import os
import json
import subprocess
import time
from datetime import datetime, timedelta
from pathlib import Path
import threading
import asyncio
from typing import Dict, List, Any, Optional
import hashlib
import tempfile

PROJECTS_ROOT = "/Users/MAC/Documents/projects"
ADMIN_ROOT = "/Users/MAC/Documents/projects/admin"
MONITORING_DIR = os.path.join(ADMIN_ROOT, "monitoring")

class RealTimeMonitor:
    def __init__(self):
        self.projects_root = Path(PROJECTS_ROOT)
        self.monitoring_dir = Path(MONITORING_DIR)
        self.monitoring_dir.mkdir(parents=True, exist_ok=True)
        
        # Create monitoring subdirectories
        for subdir in ["quality", "security", "performance", "git", "dependencies", "alerts"]:
            (self.monitoring_dir / subdir).mkdir(exist_ok=True)
        
        self.monitoring_active = False
        self.alerts = []
        
        # Monitoring configuration
        self.config = {
            "git_monitoring": {
                "check_uncommitted_changes": True,
                "check_unpushed_commits": True,
                "check_branch_protection": True,
                "alert_threshold_hours": 2  # Alert if uncommitted for 2+ hours
            },
            "code_quality": {
                "test_coverage_minimum": 80,
                "lint_on_save": True,
                "format_on_save": True,
                "complexity_threshold": 10
            },
            "security": {
                "scan_dependencies": True,
                "check_secrets": True,
                "scan_docker_images": True,
                "vulnerability_threshold": "medium"
            },
            "performance": {
                "bundle_size_threshold_mb": 10,
                "build_time_threshold_seconds": 300,
                "memory_threshold_mb": 1000
            },
            "dependencies": {
                "check_outdated": True,
                "security_audit": True,
                "license_compliance": True,
                "auto_update_patch": False  # Safety: don't auto-update
            }
        }
    
    def run_command(self, command: List[str], cwd: Path = None, timeout: int = 30) -> Dict[str, Any]:
        """Run a command and return result"""
        try:
            result = subprocess.run(
                command, 
                capture_output=True, 
                text=True, 
                timeout=timeout,
                cwd=cwd or self.projects_root
            )
            return {
                "success": result.returncode == 0,
                "stdout": result.stdout.strip(),
                "stderr": result.stderr.strip(),
                "returncode": result.returncode
            }
        except subprocess.TimeoutExpired:
            return {"success": False, "error": "Command timed out", "returncode": -1}
        except Exception as e:
            return {"success": False, "error": str(e), "returncode": -1}
    
    def check_git_status(self, project_path: Path) -> Dict[str, Any]:
        """Check git status for a project"""
        git_status = {
            "is_git_repo": False,
            "current_branch": None,
            "uncommitted_changes": False,
            "untracked_files": [],
            "unpushed_commits": 0,
            "behind_remote": 0,
            "last_commit_age_hours": None,
            "alerts": []
        }
        
        if not (project_path / ".git").exists():
            return git_status
        
        git_status["is_git_repo"] = True
        
        # Get current branch
        result = self.run_command(["git", "branch", "--show-current"], project_path)
        if result["success"]:
            git_status["current_branch"] = result["stdout"]
        
        # Check for uncommitted changes
        result = self.run_command(["git", "status", "--porcelain"], project_path)
        if result["success"] and result["stdout"]:
            git_status["uncommitted_changes"] = True
            lines = result["stdout"].split('\n')
            for line in lines:
                if line.startswith('??'):
                    git_status["untracked_files"].append(line[3:])
        
        # Check for unpushed commits
        result = self.run_command(["git", "log", "--oneline", "@{upstream}..HEAD"], project_path)
        if result["success"]:
            git_status["unpushed_commits"] = len([l for l in result["stdout"].split('\n') if l.strip()])
        
        # Get last commit age
        result = self.run_command(["git", "log", "-1", "--format=%ct"], project_path)
        if result["success"] and result["stdout"]:
            last_commit_timestamp = int(result["stdout"])
            last_commit_time = datetime.fromtimestamp(last_commit_timestamp)
            git_status["last_commit_age_hours"] = (datetime.now() - last_commit_time).total_seconds() / 3600
        
        # Generate alerts
        if git_status["uncommitted_changes"]:
            if git_status["last_commit_age_hours"] and git_status["last_commit_age_hours"] > self.config["git_monitoring"]["alert_threshold_hours"]:
                git_status["alerts"].append("Uncommitted changes for >2 hours")
        
        if git_status["unpushed_commits"] > 5:
            git_status["alerts"].append(f"{git_status['unpushed_commits']} unpushed commits")
        
        return git_status
    
    def check_code_quality(self, project_path: Path) -> Dict[str, Any]:
        """Check code quality metrics"""
        quality_status = {
            "has_linting": False,
            "has_formatting": False,
            "has_tests": False,
            "test_coverage": None,
            "lint_errors": 0,
            "complexity_issues": 0,
            "alerts": []
        }
        
        # Check for linting config
        lint_configs = [".eslintrc", ".eslintrc.js", ".eslintrc.json", "ruff.toml", ".flake8", "pylint.rc"]
        for config in lint_configs:
            if (project_path / config).exists():
                quality_status["has_linting"] = True
                break
        
        # Check for formatting config
        format_configs = [".prettierrc", ".prettier.json", "pyproject.toml", ".black"]
        for config in format_configs:
            if (project_path / config).exists():
                quality_status["has_formatting"] = True
                break
        
        # Check for tests
        test_dirs = ["test", "tests", "__tests__", "spec"]
        test_files = list(project_path.glob("**/*test*")) + list(project_path.glob("**/*spec*"))
        if any((project_path / test_dir).exists() for test_dir in test_dirs) or test_files:
            quality_status["has_tests"] = True
        
        # Run linting if available
        if quality_status["has_linting"]:
            # Try ESLint for JS/TS projects
            if (project_path / "package.json").exists():
                result = self.run_command(["npx", "eslint", ".", "--format", "json"], project_path)
                if result["success"]:
                    try:
                        lint_results = json.loads(result["stdout"])
                        quality_status["lint_errors"] = sum(len(file.get("messages", [])) for file in lint_results)
                    except:
                        pass
            
            # Try ruff for Python projects
            elif (project_path / "ruff.toml").exists() or any(f.suffix == ".py" for f in project_path.glob("*.py")):
                result = self.run_command(["ruff", "check", ".", "--output-format", "json"], project_path)
                if result["success"]:
                    try:
                        lint_results = json.loads(result["stdout"])
                        quality_status["lint_errors"] = len(lint_results)
                    except:
                        pass
        
        # Generate alerts
        if not quality_status["has_linting"]:
            quality_status["alerts"].append("No linting configuration found")
        
        if not quality_status["has_formatting"]:
            quality_status["alerts"].append("No code formatting configuration found")
        
        if not quality_status["has_tests"]:
            quality_status["alerts"].append("No tests found")
        
        if quality_status["lint_errors"] > 0:
            quality_status["alerts"].append(f"{quality_status['lint_errors']} linting errors")
        
        return quality_status
    
    def check_security(self, project_path: Path) -> Dict[str, Any]:
        """Check security status"""
        security_status = {
            "has_security_scan": False,
            "dependency_vulnerabilities": 0,
            "secret_leaks": 0,
            "security_alerts": [],
            "last_security_scan": None,
            "alerts": []
        }
        
        # Check for dependency vulnerabilities in Node.js projects
        if (project_path / "package.json").exists():
            result = self.run_command(["npm", "audit", "--json"], project_path)
            if result["success"]:
                try:
                    audit_results = json.loads(result["stdout"])
                    if "vulnerabilities" in audit_results:
                        security_status["dependency_vulnerabilities"] = audit_results["vulnerabilities"].get("total", 0)
                        security_status["has_security_scan"] = True
                except:
                    pass
        
        # Check for Python vulnerabilities
        elif any(f.name in ["requirements.txt", "pyproject.toml", "Pipfile"] for f in project_path.glob("*")):
            # Check if safety is available
            result = self.run_command(["safety", "check", "--json"], project_path)
            if result["success"]:
                try:
                    safety_results = json.loads(result["stdout"])
                    security_status["dependency_vulnerabilities"] = len(safety_results)
                    security_status["has_security_scan"] = True
                except:
                    pass
        
        # Simple secret detection (basic patterns)
        secret_patterns = [
            "api_key", "secret_key", "password", "token", "aws_access_key",
            "private_key", "credential", "auth_token"
        ]
        
        for file_path in project_path.glob("**/*"):
            if file_path.is_file() and file_path.suffix in [".js", ".ts", ".py", ".json", ".yml", ".yaml", ".env"]:
                try:
                    with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                        content = f.read().lower()
                        for pattern in secret_patterns:
                            if pattern in content and "=" in content:
                                security_status["secret_leaks"] += 1
                                break
                except:
                    pass
        
        # Generate alerts
        if security_status["dependency_vulnerabilities"] > 0:
            security_status["alerts"].append(f"{security_status['dependency_vulnerabilities']} dependency vulnerabilities")
        
        if security_status["secret_leaks"] > 0:
            security_status["alerts"].append(f"Potential secret leaks detected")
        
        if not security_status["has_security_scan"]:
            security_status["alerts"].append("No security scanning configured")
        
        return security_status
    
    def check_dependencies(self, project_path: Path) -> Dict[str, Any]:
        """Check dependency status"""
        dep_status = {
            "has_dependencies": False,
            "outdated_packages": 0,
            "package_manager": None,
            "last_update": None,
            "license_issues": 0,
            "alerts": []
        }
        
        # Check Node.js dependencies
        if (project_path / "package.json").exists():
            dep_status["has_dependencies"] = True
            dep_status["package_manager"] = "npm"
            
            # Check for outdated packages
            result = self.run_command(["npm", "outdated", "--json"], project_path)
            if result["success"] and result["stdout"]:
                try:
                    outdated = json.loads(result["stdout"])
                    dep_status["outdated_packages"] = len(outdated)
                except:
                    pass
        
        # Check Python dependencies
        elif (project_path / "requirements.txt").exists() or (project_path / "pyproject.toml").exists():
            dep_status["has_dependencies"] = True
            dep_status["package_manager"] = "pip"
            
            # Check for outdated packages (if pip-check available)
            result = self.run_command(["pip", "list", "--outdated", "--format=json"], project_path)
            if result["success"] and result["stdout"]:
                try:
                    outdated = json.loads(result["stdout"])
                    dep_status["outdated_packages"] = len(outdated)
                except:
                    pass
        
        # Generate alerts
        if dep_status["outdated_packages"] > 10:
            dep_status["alerts"].append(f"{dep_status['outdated_packages']} outdated packages")
        
        return dep_status
    
    def monitor_project(self, project_path: Path) -> Dict[str, Any]:
        """Monitor a single project"""
        project_name = project_path.name
        
        monitoring_result = {
            "project": project_name,
            "path": str(project_path),
            "timestamp": datetime.now().isoformat(),
            "git": self.check_git_status(project_path),
            "quality": self.check_code_quality(project_path),
            "security": self.check_security(project_path),
            "dependencies": self.check_dependencies(project_path),
            "overall_health": "good",
            "total_alerts": 0
        }
        
        # Calculate overall health
        total_alerts = 0
        for category in ["git", "quality", "security", "dependencies"]:
            total_alerts += len(monitoring_result[category].get("alerts", []))
        
        monitoring_result["total_alerts"] = total_alerts
        
        if total_alerts == 0:
            monitoring_result["overall_health"] = "excellent"
        elif total_alerts <= 2:
            monitoring_result["overall_health"] = "good"
        elif total_alerts <= 5:
            monitoring_result["overall_health"] = "warning"
        else:
            monitoring_result["overall_health"] = "critical"
        
        return monitoring_result
    
    def monitor_all_projects(self) -> Dict[str, Any]:
        """Monitor all projects"""
        monitoring_results = {
            "timestamp": datetime.now().isoformat(),
            "projects": {},
            "summary": {
                "total_projects": 0,
                "healthy_projects": 0,
                "warning_projects": 0,
                "critical_projects": 0,
                "total_alerts": 0
            }
        }
        
        for project_dir in self.projects_root.iterdir():
            if project_dir.is_dir() and project_dir.name != "admin":
                print(f"🔍 Monitoring {project_dir.name}...")
                result = self.monitor_project(project_dir)
                monitoring_results["projects"][project_dir.name] = result
                
                # Update summary
                monitoring_results["summary"]["total_projects"] += 1
                monitoring_results["summary"]["total_alerts"] += result["total_alerts"]
                
                if result["overall_health"] == "excellent" or result["overall_health"] == "good":
                    monitoring_results["summary"]["healthy_projects"] += 1
                elif result["overall_health"] == "warning":
                    monitoring_results["summary"]["warning_projects"] += 1
                else:
                    monitoring_results["summary"]["critical_projects"] += 1
        
        return monitoring_results
    
    def save_monitoring_results(self, results: Dict[str, Any]):
        """Save monitoring results"""
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        
        # Save full results
        results_file = self.monitoring_dir / f"monitoring_{timestamp}.json"
        with open(results_file, 'w') as f:
            json.dump(results, f, indent=2)
        
        # Save latest for quick access
        latest_file = self.monitoring_dir / "latest.json"
        with open(latest_file, 'w') as f:
            json.dump(results, f, indent=2)
        
        # Save alerts summary
        alerts_summary = {
            "timestamp": results["timestamp"],
            "critical_alerts": [],
            "warning_alerts": [],
            "summary": results["summary"]
        }
        
        for project_name, project_data in results["projects"].items():
            if project_data["overall_health"] == "critical":
                alerts_summary["critical_alerts"].append({
                    "project": project_name,
                    "alerts": sum(len(project_data[cat].get("alerts", [])) 
                                for cat in ["git", "quality", "security", "dependencies"])
                })
            elif project_data["overall_health"] == "warning":
                alerts_summary["warning_alerts"].append({
                    "project": project_name,
                    "alerts": sum(len(project_data[cat].get("alerts", [])) 
                                for cat in ["git", "quality", "security", "dependencies"])
                })
        
        alerts_file = self.monitoring_dir / "alerts" / f"alerts_{timestamp}.json"
        with open(alerts_file, 'w') as f:
            json.dump(alerts_summary, f, indent=2)
        
        return results_file, latest_file, alerts_file
    
    def generate_monitoring_report(self, results: Dict[str, Any]) -> str:
        """Generate human-readable monitoring report"""
        report_lines = [
            "=" * 80,
            "REAL-TIME PROJECT MONITORING REPORT",
            f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
            "=" * 80,
            "",
            "## EXECUTIVE SUMMARY",
            f"Total Projects Monitored: {results['summary']['total_projects']}",
            f"Healthy Projects: {results['summary']['healthy_projects']} ✅",
            f"Warning Projects: {results['summary']['warning_projects']} ⚠️",
            f"Critical Projects: {results['summary']['critical_projects']} 🚨",
            f"Total Alerts: {results['summary']['total_alerts']}",
            "",
            "## PROJECT HEALTH STATUS"
        ]
        
        # Sort projects by health status
        for status in ["critical", "warning", "good", "excellent"]:
            projects_with_status = [
                (name, data) for name, data in results["projects"].items()
                if data["overall_health"] == status
            ]
            
            if projects_with_status:
                status_emoji = {"critical": "🚨", "warning": "⚠️", "good": "✅", "excellent": "🌟"}
                report_lines.append(f"\n### {status.upper()} PROJECTS {status_emoji.get(status, '')}")
                
                for project_name, project_data in projects_with_status:
                    report_lines.append(f"\n📂 **{project_name}**")
                    
                    # Git status
                    git_info = project_data["git"]
                    if git_info["is_git_repo"]:
                        git_status = "✅" if not git_info["alerts"] else "❌"
                        report_lines.append(f"   Git: {git_status} {git_info['current_branch']}")
                        if git_info["uncommitted_changes"]:
                            report_lines.append("     - Uncommitted changes detected")
                        if git_info["unpushed_commits"] > 0:
                            report_lines.append(f"     - {git_info['unpushed_commits']} unpushed commits")
                    
                    # Quality status
                    quality_info = project_data["quality"]
                    quality_status = "✅" if not quality_info["alerts"] else "❌"
                    report_lines.append(f"   Quality: {quality_status}")
                    if quality_info["lint_errors"] > 0:
                        report_lines.append(f"     - {quality_info['lint_errors']} linting errors")
                    
                    # Security status
                    security_info = project_data["security"]
                    security_status = "✅" if not security_info["alerts"] else "❌"
                    report_lines.append(f"   Security: {security_status}")
                    if security_info["dependency_vulnerabilities"] > 0:
                        report_lines.append(f"     - {security_info['dependency_vulnerabilities']} vulnerabilities")
                    
                    # Dependencies status
                    deps_info = project_data["dependencies"]
                    deps_status = "✅" if not deps_info["alerts"] else "❌"
                    report_lines.append(f"   Dependencies: {deps_status}")
                    if deps_info["outdated_packages"] > 0:
                        report_lines.append(f"     - {deps_info['outdated_packages']} outdated packages")
        
        # Add action items
        report_lines.extend([
            "",
            "## RECOMMENDED ACTIONS",
            "",
            "### IMMEDIATE (Critical Issues)",
        ])
        
        critical_actions = []
        for project_name, project_data in results["projects"].items():
            if project_data["overall_health"] == "critical":
                for category in ["git", "quality", "security", "dependencies"]:
                    for alert in project_data[category].get("alerts", []):
                        critical_actions.append(f"🚨 {project_name}: {alert}")
        
        if critical_actions:
            for action in critical_actions[:10]:  # Show top 10
                report_lines.append(f"   {action}")
        else:
            report_lines.append("   ✅ No critical issues found")
        
        report_lines.extend([
            "",
            "### SHORT TERM (Warning Issues)",
        ])
        
        warning_actions = []
        for project_name, project_data in results["projects"].items():
            if project_data["overall_health"] == "warning":
                for category in ["git", "quality", "security", "dependencies"]:
                    for alert in project_data[category].get("alerts", []):
                        warning_actions.append(f"⚠️  {project_name}: {alert}")
        
        if warning_actions:
            for action in warning_actions[:10]:  # Show top 10
                report_lines.append(f"   {action}")
        else:
            report_lines.append("   ✅ No warning issues found")
        
        report_lines.extend([
            "",
            "## MONITORING COMMANDS",
            "   • View latest status: python3 admin/scripts/realtime_monitor.py --status",
            "   • Full monitoring scan: python3 admin/scripts/realtime_monitor.py --scan",
            "   • Project-specific: python3 admin/scripts/realtime_monitor.py --project PROJECT_NAME",
            "   • Watch mode: python3 admin/scripts/realtime_monitor.py --watch",
            "",
            "=" * 80
        ])
        
        return "\n".join(report_lines)

def main():
    import argparse
    
    parser = argparse.ArgumentParser(description="Real-time project monitoring")
    parser.add_argument("--scan", action="store_true", help="Run full monitoring scan")
    parser.add_argument("--status", action="store_true", help="Show current status")
    parser.add_argument("--project", help="Monitor specific project")
    parser.add_argument("--watch", action="store_true", help="Continuous monitoring mode")
    parser.add_argument("--report", action="store_true", help="Generate detailed report")
    parser.add_argument("--json", action="store_true", help="Output JSON format")
    
    args = parser.parse_args()
    
    monitor = RealTimeMonitor()
    
    if args.scan or (not any([args.status, args.project, args.watch, args.report])):
        print("🔍 Running comprehensive project monitoring...")
        results = monitor.monitor_all_projects()
        
        # Save results
        results_file, latest_file, alerts_file = monitor.save_monitoring_results(results)
        
        if args.json:
            print(json.dumps(results, indent=2))
        else:
            report = monitor.generate_monitoring_report(results)
            print(report)
            print(f"\n📁 Results saved to: {results_file}")
            print(f"📊 Latest status: {latest_file}")
            print(f"🚨 Alerts summary: {alerts_file}")
    
    elif args.status:
        latest_file = monitor.monitoring_dir / "latest.json"
        if latest_file.exists():
            with open(latest_file, 'r') as f:
                results = json.load(f)
            
            if args.json:
                print(json.dumps(results["summary"], indent=2))
            else:
                print("📊 PROJECT MONITORING STATUS")
                print("=" * 40)
                print(f"Total Projects: {results['summary']['total_projects']}")
                print(f"Healthy: {results['summary']['healthy_projects']} ✅")
                print(f"Warning: {results['summary']['warning_projects']} ⚠️")
                print(f"Critical: {results['summary']['critical_projects']} 🚨")
                print(f"Total Alerts: {results['summary']['total_alerts']}")
                print(f"Last Update: {results['timestamp']}")
        else:
            print("❌ No monitoring data available. Run --scan first.")
    
    elif args.project:
        project_path = Path(PROJECTS_ROOT) / args.project
        if project_path.exists():
            print(f"🔍 Monitoring {args.project}...")
            result = monitor.monitor_project(project_path)
            
            if args.json:
                print(json.dumps(result, indent=2))
            else:
                print(f"📂 Project: {result['project']}")
                print(f"Health: {result['overall_health']}")
                print(f"Alerts: {result['total_alerts']}")
                for category in ["git", "quality", "security", "dependencies"]:
                    alerts = result[category].get("alerts", [])
                    if alerts:
                        print(f"\n{category.title()} Issues:")
                        for alert in alerts:
                            print(f"  - {alert}")
        else:
            print(f"❌ Project '{args.project}' not found")
    
    elif args.watch:
        print("👁️  Starting continuous monitoring mode...")
        print("Press Ctrl+C to stop")
        
        try:
            while True:
                print(f"\n🔍 Monitoring scan at {datetime.now().strftime('%H:%M:%S')}")
                results = monitor.monitor_all_projects()
                monitor.save_monitoring_results(results)
                
                # Show summary
                print(f"Status: {results['summary']['healthy_projects']}✅ "
                      f"{results['summary']['warning_projects']}⚠️ "
                      f"{results['summary']['critical_projects']}🚨")
                
                # Wait 5 minutes
                time.sleep(300)
        except KeyboardInterrupt:
            print("\n👋 Monitoring stopped")

if __name__ == "__main__":
    main()