#!/usr/bin/env python3
"""
CAIA Open Source Components Tracker
Specialized tracking for CAIA's ecosystem of agents, engines, modules, and utilities
"""

import os
import json
import subprocess
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Any, Optional
import re

CAIA_ROOT = "/Users/MAC/Documents/projects/caia"
ADMIN_ROOT = "/Users/MAC/Documents/projects/admin"
TRACKING_DIR = os.path.join(ADMIN_ROOT, "caia-tracking")

class CAIAComponentTracker:
    def __init__(self):
        self.caia_root = Path(CAIA_ROOT)
        self.tracking_dir = Path(TRACKING_DIR)
        self.tracking_dir.mkdir(parents=True, exist_ok=True)
        self.timestamp = datetime.now()
        
        # Define CAIA component structure
        self.component_types = {
            "agents": {
                "prefix": "@caia/agent-",
                "categories": ["orchestration", "development", "quality", "design", "business", "integration", "specialized"]
            },
            "engines": {
                "prefix": "@caia/engine-",
                "categories": ["generation", "analysis", "optimization", "learning", "orchestration"]
            },
            "utils": {
                "prefix": "@caia/util-",
                "categories": ["core", "ai", "data", "network", "parallel"]
            },
            "modules": {
                "prefix": "@caia/module-",
                "categories": ["ecommerce", "social", "analytics", "content"]
            },
            "tools": {
                "prefix": "@caia/tool-",
                "categories": ["cli", "debugging", "monitoring", "testing"]
            },
            "integrations": {
                "prefix": "@caia/integration-",
                "categories": ["jira", "github", "aws", "mcp"]
            }
        }
        
    def scan_component(self, component_path: Path, component_type: str) -> Dict[str, Any]:
        """Scan a single CAIA component"""
        component_info = {
            "name": component_path.name,
            "type": component_type,
            "path": str(component_path),
            "package_name": None,
            "version": None,
            "description": None,
            "status": "not_initialized",
            "npm_published": False,
            "github_url": None,
            "dependencies": [],
            "exports": [],
            "todos": [],
            "test_coverage": None,
            "documentation": {
                "readme": False,
                "api_docs": False,
                "examples": False
            },
            "quality_metrics": {
                "lines_of_code": 0,
                "test_files": 0,
                "typescript": False,
                "linting": False
            }
        }
        
        # Check for package.json
        package_json_path = component_path / "package.json"
        if package_json_path.exists():
            try:
                with open(package_json_path, 'r') as f:
                    package_data = json.load(f)
                    component_info["package_name"] = package_data.get("name")
                    component_info["version"] = package_data.get("version")
                    component_info["description"] = package_data.get("description")
                    component_info["dependencies"] = list(package_data.get("dependencies", {}).keys())
                    component_info["status"] = "initialized"
                    
                    # Check if published to npm
                    if component_info["package_name"]:
                        npm_check = subprocess.run(
                            ["npm", "view", component_info["package_name"], "version"],
                            capture_output=True, text=True
                        )
                        if npm_check.returncode == 0:
                            component_info["npm_published"] = True
                            component_info["status"] = "published"
            except:
                pass
        
        # Check for README
        readme_path = component_path / "README.md"
        if readme_path.exists():
            component_info["documentation"]["readme"] = True
            
        # Check for examples
        examples_path = component_path / "examples"
        if examples_path.exists() and examples_path.is_dir():
            component_info["documentation"]["examples"] = True
            
        # Count TypeScript/JavaScript files
        ts_files = list(component_path.glob("**/*.ts")) + list(component_path.glob("**/*.tsx"))
        js_files = list(component_path.glob("**/*.js")) + list(component_path.glob("**/*.jsx"))
        test_files = list(component_path.glob("**/*.test.*")) + list(component_path.glob("**/*.spec.*"))
        
        component_info["quality_metrics"]["typescript"] = len(ts_files) > 0
        component_info["quality_metrics"]["test_files"] = len(test_files)
        
        # Count lines of code (rough estimate)
        total_lines = 0
        for file_list in [ts_files, js_files]:
            for file_path in file_list:
                try:
                    with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                        total_lines += len(f.readlines())
                except:
                    pass
        component_info["quality_metrics"]["lines_of_code"] = total_lines
        
        # Scan for TODOs
        for file_list in [ts_files, js_files]:
            for file_path in file_list:
                try:
                    with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                        lines = f.readlines()
                        for i, line in enumerate(lines, 1):
                            if 'TODO' in line or 'FIXME' in line:
                                component_info["todos"].append({
                                    "file": str(file_path.relative_to(component_path)),
                                    "line": i,
                                    "content": line.strip()
                                })
                except:
                    pass
        
        # Check for TypeScript exports (main API surface)
        index_files = ["index.ts", "index.js", "src/index.ts", "src/index.js"]
        for index_file in index_files:
            index_path = component_path / index_file
            if index_path.exists():
                try:
                    with open(index_path, 'r', encoding='utf-8', errors='ignore') as f:
                        content = f.read()
                        # Extract exports (simplified)
                        exports = re.findall(r'export\s+(?:class|function|const|interface|type)\s+(\w+)', content)
                        component_info["exports"] = list(set(exports))
                        break
                except:
                    pass
        
        return component_info
    
    def scan_all_components(self) -> Dict[str, Any]:
        """Scan all CAIA components"""
        tracking_data = {
            "timestamp": self.timestamp.isoformat(),
            "summary": {
                "total_components": 0,
                "published_components": 0,
                "initialized_components": 0,
                "not_initialized_components": 0,
                "total_lines_of_code": 0,
                "total_todos": 0,
                "components_with_tests": 0,
                "components_with_docs": 0
            },
            "components_by_type": {},
            "all_components": []
        }
        
        # Scan each component type directory
        for comp_type, config in self.component_types.items():
            type_dir = self.caia_root / comp_type
            if type_dir.exists() and type_dir.is_dir():
                tracking_data["components_by_type"][comp_type] = {
                    "count": 0,
                    "published": 0,
                    "components": []
                }
                
                # Scan each category within the type
                for category in config["categories"]:
                    category_dir = type_dir / category
                    if category_dir.exists() and category_dir.is_dir():
                        # Check if it's a component itself
                        if (category_dir / "package.json").exists():
                            component_info = self.scan_component(category_dir, comp_type)
                            component_info["category"] = category
                            tracking_data["all_components"].append(component_info)
                            tracking_data["components_by_type"][comp_type]["components"].append(component_info["name"])
                            tracking_data["components_by_type"][comp_type]["count"] += 1
                            
                            # Update summary
                            tracking_data["summary"]["total_components"] += 1
                            if component_info["npm_published"]:
                                tracking_data["summary"]["published_components"] += 1
                                tracking_data["components_by_type"][comp_type]["published"] += 1
                            elif component_info["status"] == "initialized":
                                tracking_data["summary"]["initialized_components"] += 1
                            else:
                                tracking_data["summary"]["not_initialized_components"] += 1
                            
                            tracking_data["summary"]["total_lines_of_code"] += component_info["quality_metrics"]["lines_of_code"]
                            tracking_data["summary"]["total_todos"] += len(component_info["todos"])
                            
                            if component_info["quality_metrics"]["test_files"] > 0:
                                tracking_data["summary"]["components_with_tests"] += 1
                            
                            if component_info["documentation"]["readme"]:
                                tracking_data["summary"]["components_with_docs"] += 1
                        
                        # Also check subdirectories for components
                        for subdir in category_dir.iterdir():
                            if subdir.is_dir() and (subdir / "package.json").exists():
                                component_info = self.scan_component(subdir, comp_type)
                                component_info["category"] = category
                                tracking_data["all_components"].append(component_info)
                                tracking_data["components_by_type"][comp_type]["components"].append(component_info["name"])
                                tracking_data["components_by_type"][comp_type]["count"] += 1
                                
                                # Update summary
                                tracking_data["summary"]["total_components"] += 1
                                if component_info["npm_published"]:
                                    tracking_data["summary"]["published_components"] += 1
                                    tracking_data["components_by_type"][comp_type]["published"] += 1
                                elif component_info["status"] == "initialized":
                                    tracking_data["summary"]["initialized_components"] += 1
                                else:
                                    tracking_data["summary"]["not_initialized_components"] += 1
                                
                                tracking_data["summary"]["total_lines_of_code"] += component_info["quality_metrics"]["lines_of_code"]
                                tracking_data["summary"]["total_todos"] += len(component_info["todos"])
                                
                                if component_info["quality_metrics"]["test_files"] > 0:
                                    tracking_data["summary"]["components_with_tests"] += 1
                                
                                if component_info["documentation"]["readme"]:
                                    tracking_data["summary"]["components_with_docs"] += 1
        
        return tracking_data
    
    def generate_roadmap(self, tracking_data: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Generate a roadmap for component development"""
        roadmap = []
        
        for component in tracking_data["all_components"]:
            priority = "low"
            actions = []
            
            # Determine priority and actions
            if component["status"] == "not_initialized":
                priority = "high"
                actions.append("Initialize package.json")
                actions.append("Create basic structure")
            elif component["status"] == "initialized":
                priority = "medium"
                if not component["npm_published"]:
                    actions.append("Prepare for npm publication")
                if not component["documentation"]["readme"]:
                    actions.append("Create README.md")
                if component["quality_metrics"]["test_files"] == 0:
                    actions.append("Add unit tests")
                if not component["documentation"]["examples"]:
                    actions.append("Add usage examples")
            elif component["status"] == "published":
                priority = "low"
                if component["quality_metrics"]["test_files"] == 0:
                    priority = "medium"
                    actions.append("Add test coverage")
                if len(component["todos"]) > 5:
                    priority = "medium"
                    actions.append(f"Address {len(component['todos'])} TODOs")
            
            if actions:
                roadmap.append({
                    "component": component["name"],
                    "type": component["type"],
                    "category": component.get("category", "unknown"),
                    "current_status": component["status"],
                    "priority": priority,
                    "actions": actions,
                    "estimated_effort": len(actions) * 2  # hours
                })
        
        # Sort by priority
        priority_order = {"high": 0, "medium": 1, "low": 2}
        roadmap.sort(key=lambda x: priority_order[x["priority"]])
        
        return roadmap
    
    def save_tracking(self, tracking_data: Dict[str, Any], roadmap: List[Dict[str, Any]]):
        """Save tracking data and roadmap"""
        # Save main tracking data
        tracking_file = self.tracking_dir / f"caia_components_{self.timestamp.strftime('%Y%m%d_%H%M%S')}.json"
        with open(tracking_file, 'w') as f:
            json.dump(tracking_data, f, indent=2)
        
        # Save roadmap
        roadmap_file = self.tracking_dir / f"caia_roadmap_{self.timestamp.strftime('%Y%m%d')}.json"
        with open(roadmap_file, 'w') as f:
            json.dump(roadmap, f, indent=2)
        
        # Save latest summary for quick access
        summary_file = self.tracking_dir / "latest_summary.json"
        summary = {
            "last_updated": self.timestamp.isoformat(),
            "summary": tracking_data["summary"],
            "components_by_type": {
                k: {"count": v["count"], "published": v["published"]}
                for k, v in tracking_data["components_by_type"].items()
            },
            "high_priority_items": len([r for r in roadmap if r["priority"] == "high"]),
            "medium_priority_items": len([r for r in roadmap if r["priority"] == "medium"]),
            "total_estimated_hours": sum(r["estimated_effort"] for r in roadmap)
        }
        with open(summary_file, 'w') as f:
            json.dump(summary, f, indent=2)
        
        return tracking_file, roadmap_file, summary_file
    
    def generate_report(self, tracking_data: Dict[str, Any], roadmap: List[Dict[str, Any]]) -> str:
        """Generate a human-readable report"""
        report_lines = [
            "=" * 70,
            "CAIA OPEN SOURCE COMPONENTS TRACKING REPORT",
            f"Generated: {self.timestamp.strftime('%Y-%m-%d %H:%M:%S')}",
            "=" * 70,
            "",
            "## EXECUTIVE SUMMARY",
            f"Total Components: {tracking_data['summary']['total_components']}",
            f"Published to NPM: {tracking_data['summary']['published_components']}",
            f"Ready to Publish: {tracking_data['summary']['initialized_components']}",
            f"Need Initialization: {tracking_data['summary']['not_initialized_components']}",
            f"Total Lines of Code: {tracking_data['summary']['total_lines_of_code']:,}",
            f"Total TODOs: {tracking_data['summary']['total_todos']}",
            f"Components with Tests: {tracking_data['summary']['components_with_tests']}",
            f"Components with Docs: {tracking_data['summary']['components_with_docs']}",
            "",
            "## COMPONENT BREAKDOWN BY TYPE"
        ]
        
        for comp_type, data in tracking_data["components_by_type"].items():
            if data["count"] > 0:
                report_lines.append(f"\n### {comp_type.upper()}")
                report_lines.append(f"  Total: {data['count']} | Published: {data['published']}")
                report_lines.append(f"  Components: {', '.join(data['components'][:5])}")
                if len(data['components']) > 5:
                    report_lines.append(f"  ... and {len(data['components']) - 5} more")
        
        report_lines.extend([
            "",
            "## DEVELOPMENT ROADMAP",
            f"High Priority Items: {len([r for r in roadmap if r['priority'] == 'high'])}",
            f"Medium Priority Items: {len([r for r in roadmap if r['priority'] == 'medium'])}",
            f"Total Estimated Hours: {sum(r['estimated_effort'] for r in roadmap)}",
            "",
            "### TOP PRIORITY ACTIONS"
        ])
        
        for item in roadmap[:10]:
            if item["priority"] == "high":
                report_lines.append(f"\n📍 {item['component']} ({item['type']}/{item['category']})")
                report_lines.append(f"   Status: {item['current_status']}")
                for action in item["actions"]:
                    report_lines.append(f"   • {action}")
                report_lines.append(f"   Estimated: {item['estimated_effort']} hours")
        
        # Add components ready for immediate publishing
        ready_to_publish = [
            c for c in tracking_data["all_components"]
            if c["status"] == "initialized" and not c["npm_published"]
        ]
        
        if ready_to_publish:
            report_lines.extend([
                "",
                "## READY FOR NPM PUBLICATION",
                f"Total: {len(ready_to_publish)} components"
            ])
            for comp in ready_to_publish[:5]:
                report_lines.append(f"  • {comp['package_name'] or comp['name']} (v{comp.get('version', '0.0.1')})")
        
        # Add quality concerns
        quality_concerns = []
        for comp in tracking_data["all_components"]:
            if comp["status"] == "published" and comp["quality_metrics"]["test_files"] == 0:
                quality_concerns.append(comp)
        
        if quality_concerns:
            report_lines.extend([
                "",
                "## QUALITY CONCERNS",
                f"Published components without tests: {len(quality_concerns)}"
            ])
            for comp in quality_concerns[:5]:
                report_lines.append(f"  ⚠️  {comp['name']} - No test files found")
        
        report_lines.extend([
            "",
            "## NEXT STEPS",
            "1. Initialize high-priority components that are not set up",
            "2. Publish components that are ready for NPM",
            "3. Add test coverage to published components",
            "4. Create documentation for undocumented components",
            "5. Address critical TODOs in active components",
            "",
            "=" * 70
        ])
        
        return "\n".join(report_lines)

def main():
    import argparse
    
    parser = argparse.ArgumentParser(description="Track CAIA open source components")
    parser.add_argument("--report", action="store_true", help="Generate and display report")
    parser.add_argument("--json", action="store_true", help="Output raw JSON data")
    parser.add_argument("--roadmap", action="store_true", help="Show development roadmap")
    args = parser.parse_args()
    
    tracker = CAIAComponentTracker()
    
    print("🔍 Scanning CAIA components...")
    tracking_data = tracker.scan_all_components()
    roadmap = tracker.generate_roadmap(tracking_data)
    
    # Save tracking data
    tracking_file, roadmap_file, summary_file = tracker.save_tracking(tracking_data, roadmap)
    
    if args.json:
        print(json.dumps(tracking_data, indent=2))
    elif args.roadmap:
        print(json.dumps(roadmap, indent=2))
    else:
        report = tracker.generate_report(tracking_data, roadmap)
        print(report)
        
        if not args.report:
            print(f"\n📁 Tracking saved to: {tracking_file}")
            print(f"📋 Roadmap saved to: {roadmap_file}")
            print(f"📊 Summary saved to: {summary_file}")

if __name__ == "__main__":
    main()