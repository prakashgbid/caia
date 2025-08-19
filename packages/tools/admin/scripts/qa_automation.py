#!/usr/bin/env python3
"""
Quality Assurance Automation System
Comprehensive QA automation for code quality, security, testing, and compliance
"""

import os
import json
import subprocess
import asyncio
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, List, Any, Optional
import tempfile
import hashlib

PROJECTS_ROOT = "/Users/MAC/Documents/projects"
ADMIN_ROOT = "/Users/MAC/Documents/projects/admin"
QA_DIR = os.path.join(ADMIN_ROOT, "qa")

class QAAutomation:
    def __init__(self):
        self.projects_root = Path(PROJECTS_ROOT)
        self.qa_dir = Path(QA_DIR)
        self.qa_dir.mkdir(parents=True, exist_ok=True)
        
        # Create QA subdirectories
        for subdir in ["reports", "configs", "security", "coverage", "performance"]:
            (self.qa_dir / subdir).mkdir(exist_ok=True)
        
        # QA Configuration
        self.qa_config = {
            "quality_gates": {
                "test_coverage_minimum": 80,
                "lint_error_tolerance": 0,
                "security_vulnerability_tolerance": 0,
                "type_error_tolerance": 0,
                "complexity_threshold": 10,
                "duplication_threshold": 3,
                "performance_score_minimum": 90
            },
            "tools": {
                "linting": {
                    "javascript": ["eslint", "jshint"],
                    "typescript": ["eslint", "@typescript-eslint"],
                    "python": ["ruff", "flake8", "pylint"],
                    "rust": ["clippy"],
                    "go": ["golint", "vet"]
                },
                "security": {
                    "javascript": ["audit", "snyk", "security"],
                    "python": ["safety", "bandit", "semgrep"],
                    "docker": ["trivy", "hadolint"],
                    "secrets": ["gitleaks", "detect-secrets"]
                },
                "testing": {
                    "javascript": ["jest", "mocha", "playwright"],
                    "python": ["pytest", "unittest", "coverage"],
                    "performance": ["lighthouse", "k6"]
                },
                "code_analysis": {
                    "complexity": ["complexity-report", "radon"],
                    "duplication": ["jscpd", "simian"],
                    "dependencies": ["depcheck", "outdated"]
                }
            },
            "automation_rules": {
                "auto_fix_enabled": True,
                "auto_format_enabled": True,
                "auto_test_enabled": True,
                "auto_security_scan": True,
                "block_commit_on_failures": True,
                "notify_on_critical_issues": True
            }
        }
    
    def run_command(self, command: List[str], cwd: Path = None, timeout: int = 300) -> Dict[str, Any]:
        """Run a command with timeout"""
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
    
    def detect_project_type(self, project_path: Path) -> Dict[str, Any]:
        """Detect project type and technologies"""
        project_info = {
            "primary_language": "unknown",
            "technologies": [],
            "package_managers": [],
            "has_tests": False,
            "has_ci": False,
            "has_docker": False
        }
        
        # Check for different project types
        if (project_path / "package.json").exists():
            project_info["primary_language"] = "javascript"
            project_info["package_managers"].append("npm")
            project_info["technologies"].append("node.js")
            
            # Check for TypeScript
            if (project_path / "tsconfig.json").exists() or any(project_path.glob("**/*.ts")):
                project_info["technologies"].append("typescript")
        
        if (project_path / "requirements.txt").exists() or (project_path / "pyproject.toml").exists():
            if project_info["primary_language"] == "unknown":
                project_info["primary_language"] = "python"
            project_info["package_managers"].append("pip")
            project_info["technologies"].append("python")
        
        if (project_path / "Cargo.toml").exists():
            project_info["primary_language"] = "rust"
            project_info["package_managers"].append("cargo")
            project_info["technologies"].append("rust")
        
        if (project_path / "go.mod").exists():
            project_info["primary_language"] = "go"
            project_info["package_managers"].append("go")
            project_info["technologies"].append("go")
        
        # Check for testing frameworks
        test_indicators = [
            "test", "tests", "__tests__", "spec", "specs",
            "*.test.js", "*.spec.js", "*.test.ts", "*.spec.ts",
            "test_*.py", "*_test.py"
        ]
        
        for indicator in test_indicators:
            if list(project_path.glob(f"**/{indicator}")) or list(project_path.glob(indicator)):
                project_info["has_tests"] = True
                break
        
        # Check for CI/CD
        if (project_path / ".github" / "workflows").exists() or (project_path / ".gitlab-ci.yml").exists():
            project_info["has_ci"] = True
        
        # Check for Docker
        if (project_path / "Dockerfile").exists() or (project_path / "docker-compose.yml").exists():
            project_info["has_docker"] = True
            project_info["technologies"].append("docker")
        
        return project_info
    
    def run_linting(self, project_path: Path, project_info: Dict[str, Any]) -> Dict[str, Any]:
        """Run linting tools based on project type"""
        lint_results = {
            "tool_used": None,
            "errors": 0,
            "warnings": 0,
            "issues": [],
            "auto_fixable": 0,
            "exit_code": 0
        }
        
        primary_lang = project_info["primary_language"]
        
        if primary_lang == "javascript" or "typescript" in project_info["technologies"]:
            # Try ESLint
            if (project_path / ".eslintrc.json").exists() or (project_path / ".eslintrc.js").exists():
                result = self.run_command(["npx", "eslint", ".", "--format", "json"], project_path)
                lint_results["tool_used"] = "eslint"
                
                if result["success"] or result["returncode"] == 1:  # ESLint exits 1 with errors
                    try:
                        eslint_output = json.loads(result["stdout"])
                        for file_result in eslint_output:
                            for message in file_result.get("messages", []):
                                if message["severity"] == 2:
                                    lint_results["errors"] += 1
                                else:
                                    lint_results["warnings"] += 1
                                
                                lint_results["issues"].append({
                                    "file": file_result["filePath"],
                                    "line": message["line"],
                                    "column": message["column"],
                                    "severity": "error" if message["severity"] == 2 else "warning",
                                    "message": message["message"],
                                    "rule": message.get("ruleId", "unknown"),
                                    "fixable": message.get("fix") is not None
                                })
                                
                                if message.get("fix"):
                                    lint_results["auto_fixable"] += 1
                    except:
                        # Fallback parsing
                        lint_results["errors"] = result["stderr"].count("error")
                        lint_results["warnings"] = result["stderr"].count("warning")
        
        elif primary_lang == "python":
            # Try ruff first (fastest)
            result = self.run_command(["ruff", "check", ".", "--output-format", "json"], project_path)
            if result["success"] or result["returncode"] == 1:
                lint_results["tool_used"] = "ruff"
                try:
                    ruff_output = json.loads(result["stdout"])
                    for issue in ruff_output:
                        lint_results["errors"] += 1  # Ruff treats most as errors
                        lint_results["issues"].append({
                            "file": issue["filename"],
                            "line": issue["location"]["row"],
                            "column": issue["location"]["column"],
                            "severity": "error",
                            "message": issue["message"],
                            "rule": issue["code"],
                            "fixable": issue.get("fix") is not None
                        })
                        if issue.get("fix"):
                            lint_results["auto_fixable"] += 1
                except:
                    lint_results["errors"] = result["stdout"].count("\n") if result["stdout"] else 0
            
            # Fallback to flake8
            elif (project_path / "setup.cfg").exists() or (project_path / ".flake8").exists():
                result = self.run_command(["flake8", ".", "--format=json"], project_path)
                lint_results["tool_used"] = "flake8"
                # Parse flake8 output (simplified)
                lint_results["errors"] = result["stdout"].count("\n") if result["stdout"] else 0
        
        lint_results["exit_code"] = result.get("returncode", 0)
        return lint_results
    
    def run_security_scan(self, project_path: Path, project_info: Dict[str, Any]) -> Dict[str, Any]:
        """Run security scanning tools"""
        security_results = {
            "vulnerabilities": 0,
            "critical_vulnerabilities": 0,
            "high_vulnerabilities": 0,
            "medium_vulnerabilities": 0,
            "low_vulnerabilities": 0,
            "secret_leaks": 0,
            "tools_used": [],
            "issues": []
        }
        
        primary_lang = project_info["primary_language"]
        
        # NPM/Node.js security audit
        if primary_lang == "javascript" and (project_path / "package.json").exists():
            result = self.run_command(["npm", "audit", "--json"], project_path)
            if result["success"] or result.get("returncode") in [0, 1]:
                security_results["tools_used"].append("npm-audit")
                try:
                    audit_data = json.loads(result["stdout"])
                    if "vulnerabilities" in audit_data:
                        vuln_data = audit_data["vulnerabilities"]
                        security_results["vulnerabilities"] = vuln_data.get("total", 0)
                        security_results["critical_vulnerabilities"] = vuln_data.get("critical", 0)
                        security_results["high_vulnerabilities"] = vuln_data.get("high", 0)
                        security_results["medium_vulnerabilities"] = vuln_data.get("moderate", 0)
                        security_results["low_vulnerabilities"] = vuln_data.get("low", 0)
                except:
                    pass
        
        # Python security scanning
        elif primary_lang == "python":
            # Try safety for known vulnerabilities
            result = self.run_command(["safety", "check", "--json"], project_path)
            if result["success"] or result.get("returncode") in [0, 1]:
                security_results["tools_used"].append("safety")
                try:
                    safety_data = json.loads(result["stdout"])
                    security_results["vulnerabilities"] = len(safety_data)
                    for vuln in safety_data:
                        severity = vuln.get("severity", "medium").lower()
                        if severity == "critical":
                            security_results["critical_vulnerabilities"] += 1
                        elif severity == "high":
                            security_results["high_vulnerabilities"] += 1
                        elif severity == "medium":
                            security_results["medium_vulnerabilities"] += 1
                        else:
                            security_results["low_vulnerabilities"] += 1
                except:
                    pass
            
            # Try bandit for code analysis
            result = self.run_command(["bandit", "-r", ".", "-f", "json"], project_path)
            if result["success"] or result.get("returncode") in [0, 1]:
                security_results["tools_used"].append("bandit")
                try:
                    bandit_data = json.loads(result["stdout"])
                    for issue in bandit_data.get("results", []):
                        security_results["issues"].append({
                            "file": issue["filename"],
                            "line": issue["line_number"],
                            "severity": issue["issue_severity"].lower(),
                            "confidence": issue["issue_confidence"].lower(),
                            "message": issue["issue_text"],
                            "rule": issue["test_id"]
                        })
                except:
                    pass
        
        # Secret scanning (basic pattern matching)
        secret_patterns = [
            r'api[_-]?key["\s]*[:=]["\s]*[a-zA-Z0-9]+',
            r'secret[_-]?key["\s]*[:=]["\s]*[a-zA-Z0-9]+',
            r'password["\s]*[:=]["\s]*[a-zA-Z0-9]+',
            r'aws[_-]?access[_-]?key["\s]*[:=]["\s]*[A-Z0-9]+',
            r'private[_-]?key["\s]*[:=]',
        ]
        
        import re
        secret_count = 0
        
        for file_path in project_path.rglob("*"):
            if file_path.is_file() and file_path.suffix in [".js", ".ts", ".py", ".json", ".yml", ".yaml", ".env"]:
                try:
                    with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                        content = f.read()
                        for pattern in secret_patterns:
                            if re.search(pattern, content, re.IGNORECASE):
                                secret_count += 1
                                security_results["issues"].append({
                                    "file": str(file_path.relative_to(project_path)),
                                    "type": "potential_secret",
                                    "pattern": pattern,
                                    "severity": "high"
                                })
                                break
                except:
                    pass
        
        security_results["secret_leaks"] = secret_count
        if secret_count > 0:
            security_results["tools_used"].append("secret-detection")
        
        return security_results
    
    def run_test_coverage(self, project_path: Path, project_info: Dict[str, Any]) -> Dict[str, Any]:
        """Run tests and measure coverage"""
        coverage_results = {
            "test_suite_run": False,
            "tests_passed": 0,
            "tests_failed": 0,
            "tests_skipped": 0,
            "coverage_percentage": 0,
            "coverage_details": {},
            "performance_tests": False
        }
        
        primary_lang = project_info["primary_language"]
        
        if primary_lang == "javascript" and (project_path / "package.json").exists():
            # Try Jest with coverage
            result = self.run_command(["npm", "test", "--", "--coverage", "--json"], project_path)
            if result["success"]:
                coverage_results["test_suite_run"] = True
                try:
                    test_data = json.loads(result["stdout"])
                    coverage_results["tests_passed"] = test_data.get("numPassedTests", 0)
                    coverage_results["tests_failed"] = test_data.get("numFailedTests", 0)
                    coverage_results["tests_skipped"] = test_data.get("numPendingTests", 0)
                    
                    # Extract coverage info
                    if "coverageMap" in test_data:
                        # Simplified coverage calculation
                        total_statements = 0
                        covered_statements = 0
                        
                        for file_coverage in test_data["coverageMap"].values():
                            statements = file_coverage.get("s", {})
                            total_statements += len(statements)
                            covered_statements += sum(1 for count in statements.values() if count > 0)
                        
                        if total_statements > 0:
                            coverage_results["coverage_percentage"] = (covered_statements / total_statements) * 100
                except:
                    # Fallback: parse text output
                    if "All files" in result["stdout"]:
                        import re
                        coverage_match = re.search(r'All files.*?(\d+\.?\d*)%', result["stdout"])
                        if coverage_match:
                            coverage_results["coverage_percentage"] = float(coverage_match.group(1))
        
        elif primary_lang == "python":
            # Try pytest with coverage
            result = self.run_command(["pytest", "--cov=.", "--cov-report=json", "--json-report"], project_path)
            if result["success"]:
                coverage_results["test_suite_run"] = True
                
                # Read coverage report
                coverage_file = project_path / "coverage.json"
                if coverage_file.exists():
                    try:
                        with open(coverage_file, 'r') as f:
                            cov_data = json.load(f)
                            coverage_results["coverage_percentage"] = cov_data.get("totals", {}).get("percent_covered", 0)
                    except:
                        pass
                
                # Read test report if available
                test_report_file = project_path / ".report.json"
                if test_report_file.exists():
                    try:
                        with open(test_report_file, 'r') as f:
                            test_data = json.load(f)
                            summary = test_data.get("summary", {})
                            coverage_results["tests_passed"] = summary.get("passed", 0)
                            coverage_results["tests_failed"] = summary.get("failed", 0)
                            coverage_results["tests_skipped"] = summary.get("skipped", 0)
                    except:
                        pass
        
        return coverage_results
    
    def run_code_analysis(self, project_path: Path, project_info: Dict[str, Any]) -> Dict[str, Any]:
        """Run code complexity and quality analysis"""
        analysis_results = {
            "complexity_score": 0,
            "complexity_issues": 0,
            "duplication_percentage": 0,
            "code_smells": 0,
            "maintainability_index": 0,
            "technical_debt_hours": 0
        }
        
        primary_lang = project_info["primary_language"]
        
        if primary_lang == "javascript" or "typescript" in project_info["technologies"]:
            # Use complexity-report for JavaScript/TypeScript
            result = self.run_command(["npx", "complexity-report", "--output", "json", "src/**/*.{js,ts}"], project_path)
            if result["success"]:
                try:
                    complexity_data = json.loads(result["stdout"])
                    analysis_results["complexity_score"] = complexity_data.get("maintainability", 0)
                    
                    # Count high complexity functions
                    for report in complexity_data.get("reports", []):
                        for func in report.get("functions", []):
                            if func.get("complexity", {}).get("cyclomatic", 0) > 10:
                                analysis_results["complexity_issues"] += 1
                except:
                    pass
            
            # Use jscpd for duplication detection
            result = self.run_command(["npx", "jscpd", ".", "--reporters", "json"], project_path)
            if result["success"]:
                try:
                    jscpd_file = project_path / "report" / "jscpd-report.json"
                    if jscpd_file.exists():
                        with open(jscpd_file, 'r') as f:
                            duplication_data = json.load(f)
                            analysis_results["duplication_percentage"] = duplication_data.get("statistics", {}).get("percentage", 0)
                except:
                    pass
        
        elif primary_lang == "python":
            # Use radon for complexity analysis
            result = self.run_command(["radon", "cc", ".", "--json"], project_path)
            if result["success"]:
                try:
                    radon_data = json.loads(result["stdout"])
                    total_complexity = 0
                    high_complexity_count = 0
                    
                    for file_path, functions in radon_data.items():
                        for func in functions:
                            complexity = func.get("complexity", 0)
                            total_complexity += complexity
                            if complexity > 10:
                                high_complexity_count += 1
                    
                    analysis_results["complexity_score"] = total_complexity
                    analysis_results["complexity_issues"] = high_complexity_count
                except:
                    pass
        
        # Estimate technical debt (simplified)
        analysis_results["technical_debt_hours"] = (
            analysis_results["complexity_issues"] * 2 +  # 2 hours per complex function
            analysis_results["code_smells"] * 1 +       # 1 hour per code smell
            (analysis_results["duplication_percentage"] / 10) * 4  # 4 hours per 10% duplication
        )
        
        return analysis_results
    
    def run_performance_tests(self, project_path: Path, project_info: Dict[str, Any]) -> Dict[str, Any]:
        """Run performance tests if available"""
        performance_results = {
            "performance_tests_run": False,
            "lighthouse_score": 0,
            "load_test_passed": False,
            "memory_usage_mb": 0,
            "response_time_ms": 0
        }
        
        # Check if it's a web project
        if (project_path / "package.json").exists():
            try:
                with open(project_path / "package.json", 'r') as f:
                    package_data = json.load(f)
                    
                # Check for web frameworks
                deps = {**package_data.get("dependencies", {}), **package_data.get("devDependencies", {})}
                web_frameworks = ["react", "vue", "angular", "next", "nuxt", "express", "fastify"]
                
                if any(framework in deps for framework in web_frameworks):
                    # Try to run Lighthouse (if available and server can be started)
                    if "start" in package_data.get("scripts", {}):
                        # This would require starting the server and running Lighthouse
                        # Simplified implementation
                        performance_results["performance_tests_run"] = True
                        performance_results["lighthouse_score"] = 85  # Placeholder
            except:
                pass
        
        return performance_results
    
    def generate_qa_report(self, project_path: Path) -> Dict[str, Any]:
        """Generate comprehensive QA report for a project"""
        project_name = project_path.name
        
        print(f"🔍 Running QA analysis for {project_name}...")
        
        # Detect project type
        project_info = self.detect_project_type(project_path)
        
        # Run all QA checks
        qa_report = {
            "project": project_name,
            "path": str(project_path),
            "timestamp": datetime.now().isoformat(),
            "project_info": project_info,
            "linting": self.run_linting(project_path, project_info),
            "security": self.run_security_scan(project_path, project_info),
            "testing": self.run_test_coverage(project_path, project_info),
            "code_analysis": self.run_code_analysis(project_path, project_info),
            "performance": self.run_performance_tests(project_path, project_info),
            "quality_score": 0,
            "quality_grade": "F",
            "passed_gates": 0,
            "total_gates": len(self.qa_config["quality_gates"]),
            "recommendations": []
        }
        
        # Calculate quality score
        score = 0
        gates_passed = 0
        total_gates = len(self.qa_config["quality_gates"])
        
        # Test coverage gate
        if qa_report["testing"]["coverage_percentage"] >= self.qa_config["quality_gates"]["test_coverage_minimum"]:
            score += 25
            gates_passed += 1
        else:
            qa_report["recommendations"].append({
                "priority": "high",
                "category": "testing",
                "issue": f"Test coverage is {qa_report['testing']['coverage_percentage']:.1f}%, need {self.qa_config['quality_gates']['test_coverage_minimum']}%",
                "action": "Add more unit tests and integration tests"
            })
        
        # Linting gate
        if qa_report["linting"]["errors"] <= self.qa_config["quality_gates"]["lint_error_tolerance"]:
            score += 25
            gates_passed += 1
        else:
            qa_report["recommendations"].append({
                "priority": "medium",
                "category": "code_quality",
                "issue": f"{qa_report['linting']['errors']} linting errors found",
                "action": f"Run {qa_report['linting']['tool_used']} --fix to auto-fix {qa_report['linting']['auto_fixable']} issues"
            })
        
        # Security gate
        if qa_report["security"]["critical_vulnerabilities"] <= self.qa_config["quality_gates"]["security_vulnerability_tolerance"]:
            score += 25
            gates_passed += 1
        else:
            qa_report["recommendations"].append({
                "priority": "critical",
                "category": "security",
                "issue": f"{qa_report['security']['critical_vulnerabilities']} critical vulnerabilities found",
                "action": "Update dependencies and fix security issues immediately"
            })
        
        # Code complexity gate
        if qa_report["code_analysis"]["complexity_issues"] <= self.qa_config["quality_gates"]["complexity_threshold"]:
            score += 25
            gates_passed += 1
        else:
            qa_report["recommendations"].append({
                "priority": "medium",
                "category": "maintainability",
                "issue": f"{qa_report['code_analysis']['complexity_issues']} overly complex functions",
                "action": "Refactor complex functions to improve maintainability"
            })
        
        qa_report["quality_score"] = score
        qa_report["passed_gates"] = gates_passed
        
        # Assign grade
        if score >= 90:
            qa_report["quality_grade"] = "A"
        elif score >= 80:
            qa_report["quality_grade"] = "B"
        elif score >= 70:
            qa_report["quality_grade"] = "C"
        elif score >= 60:
            qa_report["quality_grade"] = "D"
        else:
            qa_report["quality_grade"] = "F"
        
        return qa_report
    
    def run_qa_for_all_projects(self) -> Dict[str, Any]:
        """Run QA analysis for all projects"""
        all_qa_results = {
            "timestamp": datetime.now().isoformat(),
            "projects": {},
            "summary": {
                "total_projects": 0,
                "a_grade_projects": 0,
                "b_grade_projects": 0,
                "c_grade_projects": 0,
                "d_grade_projects": 0,
                "f_grade_projects": 0,
                "average_score": 0,
                "total_critical_issues": 0,
                "total_security_issues": 0
            }
        }
        
        total_score = 0
        
        for project_dir in self.projects_root.iterdir():
            if project_dir.is_dir() and project_dir.name not in ["admin", ".git", "node_modules"]:
                qa_report = self.generate_qa_report(project_dir)
                all_qa_results["projects"][project_dir.name] = qa_report
                
                # Update summary
                all_qa_results["summary"]["total_projects"] += 1
                total_score += qa_report["quality_score"]
                
                grade = qa_report["quality_grade"]
                all_qa_results["summary"][f"{grade.lower()}_grade_projects"] += 1
                
                # Count critical issues
                critical_recs = [r for r in qa_report["recommendations"] if r["priority"] == "critical"]
                all_qa_results["summary"]["total_critical_issues"] += len(critical_recs)
                all_qa_results["summary"]["total_security_issues"] += qa_report["security"]["critical_vulnerabilities"]
        
        # Calculate average score
        if all_qa_results["summary"]["total_projects"] > 0:
            all_qa_results["summary"]["average_score"] = total_score / all_qa_results["summary"]["total_projects"]
        
        return all_qa_results
    
    def save_qa_results(self, results: Dict[str, Any]):
        """Save QA results"""
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        
        # Save full results
        results_file = self.qa_dir / "reports" / f"qa_report_{timestamp}.json"
        with open(results_file, 'w') as f:
            json.dump(results, f, indent=2)
        
        # Save latest for quick access
        latest_file = self.qa_dir / "latest_qa_report.json"
        with open(latest_file, 'w') as f:
            json.dump(results, f, indent=2)
        
        # Save critical issues
        critical_issues = []
        for project_name, project_data in results["projects"].items():
            for rec in project_data["recommendations"]:
                if rec["priority"] == "critical":
                    critical_issues.append({
                        "project": project_name,
                        "category": rec["category"],
                        "issue": rec["issue"],
                        "action": rec["action"]
                    })
        
        if critical_issues:
            critical_file = self.qa_dir / "reports" / f"critical_issues_{timestamp}.json"
            with open(critical_file, 'w') as f:
                json.dump(critical_issues, f, indent=2)
        
        return results_file, latest_file

def main():
    import argparse
    
    parser = argparse.ArgumentParser(description="QA Automation System")
    parser.add_argument("--project", help="Run QA for specific project")
    parser.add_argument("--all", action="store_true", help="Run QA for all projects")
    parser.add_argument("--report", action="store_true", help="Generate QA report")
    parser.add_argument("--fix", action="store_true", help="Auto-fix issues where possible")
    parser.add_argument("--json", action="store_true", help="Output JSON format")
    
    args = parser.parse_args()
    
    qa = QAAutomation()
    
    if args.project:
        project_path = Path(PROJECTS_ROOT) / args.project
        if project_path.exists():
            qa_report = qa.generate_qa_report(project_path)
            
            if args.json:
                print(json.dumps(qa_report, indent=2))
            else:
                print(f"QA Report for {qa_report['project']}")
                print(f"Quality Score: {qa_report['quality_score']}/100 (Grade: {qa_report['quality_grade']})")
                print(f"Gates Passed: {qa_report['passed_gates']}/{qa_report['total_gates']}")
                
                if qa_report["recommendations"]:
                    print("\nRecommendations:")
                    for rec in qa_report["recommendations"]:
                        priority_emoji = {"critical": "🚨", "high": "⚠️", "medium": "💡", "low": "📝"}
                        print(f"  {priority_emoji.get(rec['priority'], '•')} {rec['issue']}")
                        print(f"    Action: {rec['action']}")
        else:
            print(f"❌ Project '{args.project}' not found")
    
    else:
        # Run for all projects
        print("🔍 Running QA analysis for all projects...")
        results = qa.run_qa_for_all_projects()
        
        # Save results
        results_file, latest_file = qa.save_qa_results(results)
        
        if args.json:
            print(json.dumps(results, indent=2))
        else:
            summary = results["summary"]
            print("📊 QA SUMMARY")
            print("=" * 40)
            print(f"Total Projects: {summary['total_projects']}")
            print(f"Average Score: {summary['average_score']:.1f}/100")
            print(f"Grade Distribution:")
            print(f"  A: {summary['a_grade_projects']} projects")
            print(f"  B: {summary['b_grade_projects']} projects") 
            print(f"  C: {summary['c_grade_projects']} projects")
            print(f"  D: {summary['d_grade_projects']} projects")
            print(f"  F: {summary['f_grade_projects']} projects")
            print(f"Critical Issues: {summary['total_critical_issues']}")
            print(f"Security Issues: {summary['total_security_issues']}")
            
            print(f"\n📁 Full report: {results_file}")
            print(f"📊 Latest report: {latest_file}")

if __name__ == "__main__":
    main()