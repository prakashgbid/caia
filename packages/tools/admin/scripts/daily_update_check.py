#!/usr/bin/env python3
"""
Daily Self-Update Check System
Checks internet for updates, news, documentation changes, and best practices
"""

import os
import json
import requests
import subprocess
from datetime import datetime, timedelta
from pathlib import Path
import re
import hashlib
from typing import Dict, List, Any, Optional
import asyncio
import aiohttp
from urllib.parse import urlparse

PROJECTS_ROOT = "/Users/MAC/Documents/projects"
ADMIN_ROOT = "/Users/MAC/Documents/projects/admin"
UPDATES_DIR = os.path.join(ADMIN_ROOT, "updates")

class DailyUpdateChecker:
    def __init__(self):
        self.projects_root = Path(PROJECTS_ROOT)
        self.updates_dir = Path(UPDATES_DIR)
        self.updates_dir.mkdir(parents=True, exist_ok=True)
        
        # Create update tracking subdirectories
        for subdir in ["dependencies", "documentation", "security", "tools", "news"]:
            (self.updates_dir / subdir).mkdir(exist_ok=True)
        
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'CAIA-Update-Checker/1.0'
        })
        
        # Update sources configuration
        self.update_sources = {
            "npm_registry": "https://registry.npmjs.org",
            "pypi_registry": "https://pypi.org/pypi",
            "github_releases": "https://api.github.com/repos",
            "security_advisories": "https://api.github.com/advisories",
            "tech_news": [
                "https://api.github.com/search/repositories?q=stars:>1000+pushed:>2024-01-01",
                "https://hacker-news.firebaseio.com/v0/topstories.json"
            ],
            "documentation_sites": {
                "typescript": "https://api.github.com/repos/microsoft/TypeScript/releases/latest",
                "node": "https://api.github.com/repos/nodejs/node/releases/latest",
                "python": "https://api.github.com/repos/python/cpython/releases/latest",
                "claude_code": "https://docs.anthropic.com/en/docs/claude-code",
                "best_practices": [
                    "https://github.com/goldbergyoni/nodebestpractices",
                    "https://github.com/google/python-fire"
                ]
            }
        }
    
    def get_project_dependencies(self, project_path: Path) -> Dict[str, Any]:
        """Extract dependencies from a project"""
        dependencies = {
            "npm": {},
            "python": {},
            "project_type": "unknown"
        }
        
        # Check for Node.js dependencies
        package_json = project_path / "package.json"
        if package_json.exists():
            try:
                with open(package_json, 'r') as f:
                    package_data = json.load(f)
                    dependencies["npm"] = {
                        **package_data.get("dependencies", {}),
                        **package_data.get("devDependencies", {})
                    }
                    dependencies["project_type"] = "node"
            except:
                pass
        
        # Check for Python dependencies
        requirements_txt = project_path / "requirements.txt"
        if requirements_txt.exists():
            try:
                with open(requirements_txt, 'r') as f:
                    for line in f:
                        line = line.strip()
                        if line and not line.startswith('#'):
                            # Parse requirement (simplified)
                            if '==' in line:
                                pkg, version = line.split('==')
                                dependencies["python"][pkg.strip()] = version.strip()
                            elif '>=' in line:
                                pkg = line.split('>=')[0].strip()
                                dependencies["python"][pkg] = "latest"
                            else:
                                dependencies["python"][line] = "latest"
                dependencies["project_type"] = "python"
            except:
                pass
        
        # Check pyproject.toml
        pyproject_toml = project_path / "pyproject.toml"
        if pyproject_toml.exists():
            dependencies["project_type"] = "python"
            # Simple parsing - could be enhanced with toml library
        
        return dependencies
    
    def check_npm_updates(self, packages: Dict[str, str]) -> Dict[str, Any]:
        """Check for NPM package updates"""
        updates = {
            "checked_packages": len(packages),
            "updates_available": 0,
            "security_updates": 0,
            "major_updates": 0,
            "minor_updates": 0,
            "patch_updates": 0,
            "package_updates": {}
        }
        
        for package_name, current_version in packages.items():
            try:
                # Clean version string
                current_version = re.sub(r'[^0-9.]', '', current_version)
                
                # Check latest version
                response = self.session.get(f"{self.update_sources['npm_registry']}/{package_name}")
                if response.status_code == 200:
                    package_info = response.json()
                    latest_version = package_info.get("dist-tags", {}).get("latest", "")
                    
                    if latest_version and latest_version != current_version:
                        update_type = self.determine_update_type(current_version, latest_version)
                        
                        updates["package_updates"][package_name] = {
                            "current": current_version,
                            "latest": latest_version,
                            "type": update_type,
                            "description": package_info.get("description", ""),
                            "last_modified": package_info.get("time", {}).get(latest_version, "")
                        }
                        
                        updates["updates_available"] += 1
                        if update_type == "major":
                            updates["major_updates"] += 1
                        elif update_type == "minor":
                            updates["minor_updates"] += 1
                        else:
                            updates["patch_updates"] += 1
                        
                        # Check for security advisories
                        if self.has_security_advisory(package_name):
                            updates["security_updates"] += 1
                            updates["package_updates"][package_name]["security_advisory"] = True
                
            except Exception as e:
                print(f"Error checking {package_name}: {e}")
                continue
        
        return updates
    
    def check_python_updates(self, packages: Dict[str, str]) -> Dict[str, Any]:
        """Check for Python package updates"""
        updates = {
            "checked_packages": len(packages),
            "updates_available": 0,
            "security_updates": 0,
            "package_updates": {}
        }
        
        for package_name, current_version in packages.items():
            try:
                response = self.session.get(f"{self.update_sources['pypi_registry']}/{package_name}/json")
                if response.status_code == 200:
                    package_info = response.json()
                    latest_version = package_info.get("info", {}).get("version", "")
                    
                    if latest_version and latest_version != current_version:
                        updates["package_updates"][package_name] = {
                            "current": current_version,
                            "latest": latest_version,
                            "description": package_info.get("info", {}).get("summary", ""),
                            "last_updated": package_info.get("info", {}).get("upload_time", "")
                        }
                        updates["updates_available"] += 1
                
            except Exception as e:
                print(f"Error checking {package_name}: {e}")
                continue
        
        return updates
    
    def determine_update_type(self, current: str, latest: str) -> str:
        """Determine if update is major, minor, or patch"""
        try:
            current_parts = [int(x) for x in current.split('.')]
            latest_parts = [int(x) for x in latest.split('.')]
            
            # Pad to same length
            max_len = max(len(current_parts), len(latest_parts))
            current_parts.extend([0] * (max_len - len(current_parts)))
            latest_parts.extend([0] * (max_len - len(latest_parts)))
            
            if latest_parts[0] > current_parts[0]:
                return "major"
            elif latest_parts[1] > current_parts[1]:
                return "minor"
            elif latest_parts[2] > current_parts[2]:
                return "patch"
            else:
                return "other"
        except:
            return "unknown"
    
    def has_security_advisory(self, package_name: str) -> bool:
        """Check if package has security advisories (simplified)"""
        try:
            # This is a simplified check - in production you'd use proper security databases
            response = self.session.get(
                f"https://api.github.com/search/repositories?q={package_name}+security+advisory"
            )
            if response.status_code == 200:
                results = response.json()
                return results.get("total_count", 0) > 0
        except:
            pass
        return False
    
    def check_github_releases(self, repos: List[str]) -> Dict[str, Any]:
        """Check for new GitHub releases"""
        releases = {
            "checked_repos": len(repos),
            "new_releases": 0,
            "repos_with_updates": {}
        }
        
        for repo in repos:
            try:
                response = self.session.get(f"{self.update_sources['github_releases']}/{repo}/releases/latest")
                if response.status_code == 200:
                    release_info = response.json()
                    
                    release_date = datetime.fromisoformat(
                        release_info["published_at"].replace('Z', '+00:00')
                    ).replace(tzinfo=None)
                    
                    # Check if release is from last 7 days
                    if release_date > datetime.now() - timedelta(days=7):
                        releases["repos_with_updates"][repo] = {
                            "tag_name": release_info["tag_name"],
                            "name": release_info["name"],
                            "published_at": release_info["published_at"],
                            "url": release_info["html_url"],
                            "description": release_info.get("body", "")[:200] + "..."
                        }
                        releases["new_releases"] += 1
                        
            except Exception as e:
                print(f"Error checking releases for {repo}: {e}")
                continue
        
        return releases
    
    def check_security_advisories(self) -> Dict[str, Any]:
        """Check for new security advisories"""
        advisories = {
            "new_advisories": 0,
            "critical_advisories": 0,
            "high_advisories": 0,
            "advisories": []
        }
        
        try:
            # Check GitHub security advisories
            response = self.session.get(
                f"{self.update_sources['security_advisories']}?sort=updated&order=desc&per_page=50"
            )
            if response.status_code == 200:
                advisory_list = response.json()
                
                for advisory in advisory_list:
                    updated_date = datetime.fromisoformat(
                        advisory["updated_at"].replace('Z', '+00:00')
                    ).replace(tzinfo=None)
                    
                    # Check if updated in last 24 hours
                    if updated_date > datetime.now() - timedelta(days=1):
                        severity = advisory.get("severity", "").lower()
                        
                        advisories["advisories"].append({
                            "id": advisory["ghsa_id"],
                            "summary": advisory["summary"],
                            "severity": severity,
                            "published_at": advisory["published_at"],
                            "updated_at": advisory["updated_at"],
                            "url": advisory["html_url"]
                        })
                        
                        advisories["new_advisories"] += 1
                        if severity == "critical":
                            advisories["critical_advisories"] += 1
                        elif severity == "high":
                            advisories["high_advisories"] += 1
                            
        except Exception as e:
            print(f"Error checking security advisories: {e}")
        
        return advisories
    
    def check_tech_news(self) -> Dict[str, Any]:
        """Check for relevant tech news and trends"""
        news = {
            "trending_repos": [],
            "hacker_news": [],
            "ai_updates": []
        }
        
        try:
            # Check trending repositories
            response = self.session.get(
                "https://api.github.com/search/repositories?q=stars:>1000+pushed:>2024-01-01&sort=updated&order=desc&per_page=10"
            )
            if response.status_code == 200:
                repos = response.json()
                for repo in repos.get("items", []):
                    news["trending_repos"].append({
                        "name": repo["full_name"],
                        "description": repo["description"],
                        "stars": repo["stargazers_count"],
                        "language": repo["language"],
                        "url": repo["html_url"],
                        "updated_at": repo["updated_at"]
                    })
            
            # Check Hacker News top stories (simplified)
            hn_response = self.session.get("https://hacker-news.firebaseio.com/v0/topstories.json")
            if hn_response.status_code == 200:
                story_ids = hn_response.json()[:10]
                for story_id in story_ids:
                    story_response = self.session.get(f"https://hacker-news.firebaseio.com/v0/item/{story_id}.json")
                    if story_response.status_code == 200:
                        story = story_response.json()
                        if "ai" in story.get("title", "").lower() or "claude" in story.get("title", "").lower():
                            news["hacker_news"].append({
                                "title": story.get("title", ""),
                                "url": story.get("url", ""),
                                "score": story.get("score", 0),
                                "time": story.get("time", 0)
                            })
                            
        except Exception as e:
            print(f"Error checking tech news: {e}")
        
        return news
    
    def check_documentation_updates(self) -> Dict[str, Any]:
        """Check for documentation and best practice updates"""
        doc_updates = {
            "documentation_changes": {},
            "best_practices_updates": [],
            "tool_updates": {}
        }
        
        # Check major tool releases
        tools_to_check = [
            "microsoft/TypeScript",
            "nodejs/node",
            "python/cpython",
            "anthropics/claude-code"
        ]
        
        for tool in tools_to_check:
            try:
                response = self.session.get(f"https://api.github.com/repos/{tool}/releases/latest")
                if response.status_code == 200:
                    release = response.json()
                    release_date = datetime.fromisoformat(
                        release["published_at"].replace('Z', '+00:00')
                    ).replace(tzinfo=None)
                    
                    if release_date > datetime.now() - timedelta(days=30):
                        doc_updates["tool_updates"][tool] = {
                            "version": release["tag_name"],
                            "published_at": release["published_at"],
                            "url": release["html_url"],
                            "notes": release.get("body", "")[:300] + "..."
                        }
                        
            except Exception as e:
                print(f"Error checking {tool}: {e}")
                continue
        
        return doc_updates
    
    def generate_update_recommendations(self, all_updates: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Generate actionable update recommendations"""
        recommendations = []
        
        # Security updates (highest priority)
        for project, project_updates in all_updates.items():
            if project_updates.get("npm", {}).get("security_updates", 0) > 0:
                recommendations.append({
                    "priority": "critical",
                    "type": "security",
                    "project": project,
                    "action": "Update packages with security vulnerabilities",
                    "command": f"cd {project} && npm audit fix",
                    "packages": [p for p, info in project_updates["npm"]["package_updates"].items() 
                               if info.get("security_advisory")]
                })
        
        # Major version updates (manual review needed)
        for project, project_updates in all_updates.items():
            major_updates = [
                p for p, info in project_updates.get("npm", {}).get("package_updates", {}).items()
                if info.get("type") == "major"
            ]
            if major_updates:
                recommendations.append({
                    "priority": "medium",
                    "type": "major_update",
                    "project": project,
                    "action": "Review major version updates",
                    "command": f"cd {project} && npm outdated",
                    "packages": major_updates
                })
        
        # Minor/patch updates (safer to auto-apply)
        for project, project_updates in all_updates.items():
            safe_updates = [
                p for p, info in project_updates.get("npm", {}).get("package_updates", {}).items()
                if info.get("type") in ["minor", "patch"]
            ]
            if safe_updates:
                recommendations.append({
                    "priority": "low",
                    "type": "safe_update",
                    "project": project,
                    "action": "Apply safe updates",
                    "command": f"cd {project} && npm update",
                    "packages": safe_updates
                })
        
        return recommendations
    
    def check_all_projects(self) -> Dict[str, Any]:
        """Check all projects for updates"""
        all_updates = {
            "timestamp": datetime.now().isoformat(),
            "projects": {},
            "global_updates": {
                "security_advisories": self.check_security_advisories(),
                "tech_news": self.check_tech_news(),
                "documentation": self.check_documentation_updates()
            },
            "summary": {
                "projects_checked": 0,
                "total_package_updates": 0,
                "security_issues": 0,
                "major_updates": 0
            }
        }
        
        for project_dir in self.projects_root.iterdir():
            if project_dir.is_dir() and project_dir.name not in ["admin", ".git"]:
                print(f"🔍 Checking updates for {project_dir.name}...")
                
                dependencies = self.get_project_dependencies(project_dir)
                
                project_updates = {
                    "project_type": dependencies["project_type"],
                    "npm": {},
                    "python": {}
                }
                
                # Check NPM updates
                if dependencies["npm"]:
                    project_updates["npm"] = self.check_npm_updates(dependencies["npm"])
                
                # Check Python updates  
                if dependencies["python"]:
                    project_updates["python"] = self.check_python_updates(dependencies["python"])
                
                all_updates["projects"][project_dir.name] = project_updates
                all_updates["summary"]["projects_checked"] += 1
                all_updates["summary"]["total_package_updates"] += (
                    project_updates["npm"].get("updates_available", 0) +
                    project_updates["python"].get("updates_available", 0)
                )
                all_updates["summary"]["security_issues"] += project_updates["npm"].get("security_updates", 0)
                all_updates["summary"]["major_updates"] += project_updates["npm"].get("major_updates", 0)
        
        # Generate recommendations
        all_updates["recommendations"] = self.generate_update_recommendations(all_updates["projects"])
        
        return all_updates
    
    def save_update_results(self, results: Dict[str, Any]):
        """Save update check results"""
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        
        # Save full results
        results_file = self.updates_dir / f"daily_update_{timestamp}.json"
        with open(results_file, 'w') as f:
            json.dump(results, f, indent=2)
        
        # Save latest for quick access
        latest_file = self.updates_dir / "latest_updates.json"
        with open(latest_file, 'w') as f:
            json.dump(results, f, indent=2)
        
        # Save recommendations separately
        recommendations_file = self.updates_dir / f"recommendations_{timestamp}.json"
        with open(recommendations_file, 'w') as f:
            json.dump(results["recommendations"], f, indent=2)
        
        # Save security issues if any
        if results["summary"]["security_issues"] > 0:
            security_file = self.updates_dir / "security" / f"security_alerts_{timestamp}.json"
            security_data = {
                "timestamp": results["timestamp"],
                "total_security_issues": results["summary"]["security_issues"],
                "projects_affected": [
                    project for project, data in results["projects"].items()
                    if data.get("npm", {}).get("security_updates", 0) > 0
                ],
                "global_security": results["global_updates"]["security_advisories"]
            }
            with open(security_file, 'w') as f:
                json.dump(security_data, f, indent=2)
        
        return results_file, latest_file, recommendations_file
    
    def generate_update_report(self, results: Dict[str, Any]) -> str:
        """Generate human-readable update report"""
        report_lines = [
            "=" * 80,
            "DAILY UPDATE CHECK REPORT",
            f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
            "=" * 80,
            "",
            "## EXECUTIVE SUMMARY",
            f"Projects Checked: {results['summary']['projects_checked']}",
            f"Package Updates Available: {results['summary']['total_package_updates']}",
            f"Security Issues: {results['summary']['security_issues']} 🚨",
            f"Major Updates: {results['summary']['major_updates']} ⚠️",
            "",
            "## CRITICAL SECURITY UPDATES"
        ]
        
        # Add security recommendations
        security_recs = [r for r in results["recommendations"] if r["priority"] == "critical"]
        if security_recs:
            for rec in security_recs:
                report_lines.append(f"\n🚨 {rec['project']}: {rec['action']}")
                report_lines.append(f"   Command: {rec['command']}")
                report_lines.append(f"   Packages: {', '.join(rec['packages'][:5])}")
        else:
            report_lines.append("   ✅ No critical security issues found")
        
        # Add major updates
        report_lines.append("\n## MAJOR VERSION UPDATES (Review Required)")
        major_recs = [r for r in results["recommendations"] if r["type"] == "major_update"]
        if major_recs:
            for rec in major_recs:
                report_lines.append(f"\n⚠️  {rec['project']}: {len(rec['packages'])} major updates")
                report_lines.append(f"   Packages: {', '.join(rec['packages'][:5])}")
        else:
            report_lines.append("   ✅ No major updates requiring review")
        
        # Add global updates
        global_updates = results["global_updates"]
        
        # Security advisories
        if global_updates["security_advisories"]["new_advisories"] > 0:
            report_lines.append("\n## NEW SECURITY ADVISORIES")
            for advisory in global_updates["security_advisories"]["advisories"][:5]:
                report_lines.append(f"   🔒 {advisory['severity'].upper()}: {advisory['summary']}")
        
        # Trending tech
        if global_updates["tech_news"]["trending_repos"]:
            report_lines.append("\n## TRENDING TECHNOLOGY")
            for repo in global_updates["tech_news"]["trending_repos"][:3]:
                report_lines.append(f"   ⭐ {repo['name']} ({repo['stars']} stars)")
                report_lines.append(f"      {repo['description'][:80]}...")
        
        # Documentation updates
        if global_updates["documentation"]["tool_updates"]:
            report_lines.append("\n## TOOL UPDATES")
            for tool, info in global_updates["documentation"]["tool_updates"].items():
                report_lines.append(f"   🔧 {tool}: {info['version']}")
        
        # Add action items
        report_lines.extend([
            "",
            "## RECOMMENDED ACTIONS",
            "",
            "### IMMEDIATE (Today)",
        ])
        
        immediate_actions = [r for r in results["recommendations"] if r["priority"] == "critical"]
        if immediate_actions:
            for action in immediate_actions:
                report_lines.append(f"   🚨 {action['action']} ({action['project']})")
        else:
            report_lines.append("   ✅ No immediate actions required")
        
        report_lines.extend([
            "",
            "### THIS WEEK",
        ])
        
        weekly_actions = [r for r in results["recommendations"] if r["priority"] == "medium"]
        if weekly_actions:
            for action in weekly_actions[:5]:
                report_lines.append(f"   ⚠️  {action['action']} ({action['project']})")
        else:
            report_lines.append("   ✅ No urgent actions for this week")
        
        report_lines.extend([
            "",
            "## UPDATE COMMANDS",
            "   • Run security updates: admin/scripts/apply_security_updates.sh",
            "   • Check specific project: python3 admin/scripts/daily_update_check.py --project PROJECT_NAME",
            "   • View recommendations: cat admin/updates/latest_updates.json | jq '.recommendations'",
            "   • Monitor updates: python3 admin/scripts/daily_update_check.py --watch",
            "",
            "=" * 80
        ])
        
        return "\n".join(report_lines)

def main():
    import argparse
    
    parser = argparse.ArgumentParser(description="Daily update checker")
    parser.add_argument("--project", help="Check specific project only")
    parser.add_argument("--security-only", action="store_true", help="Check security updates only")
    parser.add_argument("--deps-only", action="store_true", help="Check dependency updates only")
    parser.add_argument("--news-only", action="store_true", help="Check tech news only")
    parser.add_argument("--report", action="store_true", help="Generate detailed report")
    parser.add_argument("--json", action="store_true", help="Output JSON format")
    parser.add_argument("--apply", action="store_true", help="Apply safe updates automatically")
    
    args = parser.parse_args()
    
    checker = DailyUpdateChecker()
    
    if args.project:
        # Check specific project
        project_path = Path(PROJECTS_ROOT) / args.project
        if project_path.exists():
            print(f"🔍 Checking updates for {args.project}...")
            dependencies = checker.get_project_dependencies(project_path)
            
            results = {}
            if dependencies["npm"]:
                results["npm"] = checker.check_npm_updates(dependencies["npm"])
            if dependencies["python"]:
                results["python"] = checker.check_python_updates(dependencies["python"])
            
            if args.json:
                print(json.dumps(results, indent=2))
            else:
                print(f"Project: {args.project}")
                for pkg_type, data in results.items():
                    if data.get("updates_available", 0) > 0:
                        print(f"\n{pkg_type.upper()} Updates:")
                        for pkg, info in data.get("package_updates", {}).items():
                            print(f"  • {pkg}: {info['current']} → {info['latest']} ({info.get('type', 'unknown')})")
        else:
            print(f"❌ Project '{args.project}' not found")
    
    else:
        # Full update check
        print("🔍 Running daily update check...")
        results = checker.check_all_projects()
        
        # Save results
        results_file, latest_file, recommendations_file = checker.save_update_results(results)
        
        if args.json:
            print(json.dumps(results, indent=2))
        else:
            report = checker.generate_update_report(results)
            print(report)
            
            print(f"\n📁 Results saved to: {results_file}")
            print(f"📊 Latest updates: {latest_file}")
            print(f"📋 Recommendations: {recommendations_file}")
            
            # Log this check
            log_script = Path(PROJECTS_ROOT) / "admin" / "scripts" / "log_decision.py"
            if log_script.exists():
                subprocess.run([
                    "python3", str(log_script),
                    "--type", "progress",
                    "--title", "Daily Update Check Completed",
                    "--description", f"Checked {results['summary']['projects_checked']} projects. Found {results['summary']['total_package_updates']} updates, {results['summary']['security_issues']} security issues.",
                    "--project", "admin",
                    "--status", "completed",
                    "--completion", "100"
                ])

if __name__ == "__main__":
    main()