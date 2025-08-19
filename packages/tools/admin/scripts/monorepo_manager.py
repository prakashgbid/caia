#!/usr/bin/env python3
"""
Mono-repo Management System for CAIA
Manages the entire projects folder as a mono-repo with CAIA as the master project
"""

import os
import json
import subprocess
import shutil
from datetime import datetime
from pathlib import Path
import yaml
from typing import Dict, List, Any, Optional
import tempfile

PROJECTS_ROOT = "/Users/MAC/Documents/projects"
CAIA_ROOT = "/Users/MAC/Documents/projects/caia"
ADMIN_ROOT = "/Users/MAC/Documents/projects/admin"

class MonorepoManager:
    def __init__(self):
        self.projects_root = Path(PROJECTS_ROOT)
        self.caia_root = Path(CAIA_ROOT)
        self.admin_root = Path(ADMIN_ROOT)
        
        # Mono-repo configuration
        self.monorepo_config = {
            "master_project": "caia",
            "workspace_structure": {
                "packages": [
                    "agents/*",
                    "engines/*", 
                    "utils/*",
                    "modules/*",
                    "tools/*",
                    "integrations/*"
                ],
                "external_projects": [
                    "roulette-community",
                    "paraforge",
                    "omnimind",
                    "claude-code-ultimate"
                ]
            },
            "shared_configs": {
                "eslint": True,
                "prettier": True,
                "typescript": True,
                "jest": True,
                "husky": True,
                "commitlint": True,
                "semantic-release": True
            },
            "quality_gates": {
                "test_coverage": 80,
                "lint_errors": 0,
                "type_errors": 0,
                "security_vulnerabilities": 0
            }
        }
    
    def run_command(self, command: List[str], cwd: Path = None, capture_output: bool = True) -> Dict[str, Any]:
        """Run a command and return result"""
        try:
            result = subprocess.run(
                command,
                capture_output=capture_output,
                text=True,
                cwd=cwd or self.projects_root
            )
            return {
                "success": result.returncode == 0,
                "stdout": result.stdout.strip() if capture_output else "",
                "stderr": result.stderr.strip() if capture_output else "",
                "returncode": result.returncode
            }
        except Exception as e:
            return {"success": False, "error": str(e), "returncode": -1}
    
    def setup_root_workspace(self) -> Dict[str, Any]:
        """Set up the root workspace configuration"""
        setup_results = {
            "lerna_setup": False,
            "workspace_config": False,
            "shared_configs": [],
            "errors": []
        }
        
        # Create lerna.json for monorepo management
        lerna_config = {
            "version": "0.0.0",
            "npmClient": "npm",
            "command": {
                "publish": {
                    "conventionalCommits": True,
                    "message": "chore(release): publish",
                    "registry": "https://registry.npmjs.org/"
                },
                "bootstrap": {
                    "ignore": "component-*",
                    "npmClientArgs": ["--no-package-lock"]
                }
            },
            "packages": [
                "caia/agents/*",
                "caia/engines/*", 
                "caia/utils/*",
                "caia/modules/*",
                "caia/tools/*",
                "caia/integrations/*",
                "roulette-community",
                "paraforge",
                "omnimind/modules/*"
            ]
        }
        
        lerna_file = self.projects_root / "lerna.json"
        try:
            with open(lerna_file, 'w') as f:
                json.dump(lerna_config, f, indent=2)
            setup_results["lerna_setup"] = True
        except Exception as e:
            setup_results["errors"].append(f"Failed to create lerna.json: {e}")
        
        # Create root package.json
        root_package = {
            "name": "caia-monorepo",
            "version": "1.0.0",
            "description": "CAIA Monorepo - Chief AI Agent Ecosystem",
            "private": True,
            "workspaces": [
                "caia/agents/*",
                "caia/engines/*",
                "caia/utils/*", 
                "caia/modules/*",
                "caia/tools/*",
                "caia/integrations/*"
            ],
            "scripts": {
                "bootstrap": "lerna bootstrap",
                "clean": "lerna clean",
                "test": "lerna run test",
                "build": "lerna run build",
                "lint": "lerna run lint",
                "format": "lerna run format",
                "publish": "lerna publish",
                "version": "lerna version",
                "changed": "lerna changed",
                "diff": "lerna diff",
                "precommit": "lint-staged",
                "commit": "git-cz",
                "semantic-release": "semantic-release",
                "postinstall": "husky install"
            },
            "devDependencies": {
                "lerna": "^7.0.0",
                "@commitlint/cli": "^17.0.0",
                "@commitlint/config-conventional": "^17.0.0",
                "husky": "^8.0.0",
                "lint-staged": "^13.0.0",
                "commitizen": "^4.0.0",
                "cz-conventional-changelog": "^3.0.0",
                "semantic-release": "^21.0.0",
                "@semantic-release/changelog": "^6.0.0",
                "@semantic-release/git": "^10.0.0"
            },
            "config": {
                "commitizen": {
                    "path": "./node_modules/cz-conventional-changelog"
                }
            },
            "lint-staged": {
                "*.{js,ts,tsx}": ["eslint --fix", "prettier --write"],
                "*.{json,md,yml,yaml}": ["prettier --write"]
            },
            "engines": {
                "node": ">=16.0.0",
                "npm": ">=8.0.0"
            }
        }
        
        package_file = self.projects_root / "package.json"
        try:
            with open(package_file, 'w') as f:
                json.dump(root_package, f, indent=2)
            setup_results["workspace_config"] = True
        except Exception as e:
            setup_results["errors"].append(f"Failed to create package.json: {e}")
        
        return setup_results
    
    def setup_shared_configs(self) -> Dict[str, Any]:
        """Set up shared configuration files"""
        config_results = {
            "configs_created": [],
            "errors": []
        }
        
        # ESLint configuration
        eslint_config = {
            "root": True,
            "env": {
                "node": True,
                "es2022": True,
                "jest": True
            },
            "extends": [
                "eslint:recommended",
                "@typescript-eslint/recommended",
                "prettier"
            ],
            "parser": "@typescript-eslint/parser",
            "parserOptions": {
                "ecmaVersion": 2022,
                "sourceType": "module"
            },
            "plugins": ["@typescript-eslint"],
            "rules": {
                "no-unused-vars": "error",
                "no-console": "warn",
                "@typescript-eslint/no-explicit-any": "warn",
                "@typescript-eslint/explicit-function-return-type": "off",
                "@typescript-eslint/no-unused-vars": "error"
            },
            "ignorePatterns": ["node_modules/", "dist/", "build/", "coverage/"]
        }
        
        try:
            with open(self.projects_root / ".eslintrc.json", 'w') as f:
                json.dump(eslint_config, f, indent=2)
            config_results["configs_created"].append("ESLint")
        except Exception as e:
            config_results["errors"].append(f"Failed to create ESLint config: {e}")
        
        # Prettier configuration
        prettier_config = {
            "semi": True,
            "trailingComma": "es5",
            "singleQuote": True,
            "printWidth": 100,
            "tabWidth": 2,
            "useTabs": False,
            "bracketSpacing": True,
            "arrowParens": "avoid"
        }
        
        try:
            with open(self.projects_root / ".prettierrc.json", 'w') as f:
                json.dump(prettier_config, f, indent=2)
            config_results["configs_created"].append("Prettier")
        except Exception as e:
            config_results["errors"].append(f"Failed to create Prettier config: {e}")
        
        # TypeScript configuration
        typescript_config = {
            "compilerOptions": {
                "target": "ES2022",
                "module": "commonjs",
                "lib": ["ES2022"],
                "outDir": "./dist",
                "rootDir": "./src",
                "strict": True,
                "esModuleInterop": True,
                "skipLibCheck": True,
                "forceConsistentCasingInFileNames": True,
                "declaration": True,
                "declarationMap": True,
                "sourceMap": True,
                "composite": True,
                "incremental": True
            },
            "include": ["src/**/*"],
            "exclude": ["node_modules", "dist", "**/*.test.*"]
        }
        
        try:
            with open(self.projects_root / "tsconfig.json", 'w') as f:
                json.dump(typescript_config, f, indent=2)
            config_results["configs_created"].append("TypeScript")
        except Exception as e:
            config_results["errors"].append(f"Failed to create TypeScript config: {e}")
        
        # Jest configuration
        jest_config = {
            "preset": "ts-jest",
            "testEnvironment": "node",
            "roots": ["<rootDir>/src"],
            "testMatch": ["**/__tests__/**/*.ts", "**/?(*.)+(spec|test).ts"],
            "transform": {
                "^.+\\.ts$": "ts-jest"
            },
            "collectCoverageFrom": [
                "src/**/*.ts",
                "!src/**/*.d.ts",
                "!src/**/*.test.ts"
            ],
            "coverageThreshold": {
                "global": {
                    "branches": 80,
                    "functions": 80,
                    "lines": 80,
                    "statements": 80
                }
            },
            "setupFilesAfterEnv": ["<rootDir>/src/test-setup.ts"]
        }
        
        try:
            with open(self.projects_root / "jest.config.json", 'w') as f:
                json.dump(jest_config, f, indent=2)
            config_results["configs_created"].append("Jest")
        except Exception as e:
            config_results["errors"].append(f"Failed to create Jest config: {e}")
        
        # Commitlint configuration
        commitlint_config = {
            "extends": ["@commitlint/config-conventional"],
            "rules": {
                "type-enum": [
                    2,
                    "always",
                    ["feat", "fix", "docs", "style", "refactor", "test", "chore", "build", "ci"]
                ],
                "scope-empty": [2, "never"],
                "subject-case": [2, "always", "sentence-case"]
            }
        }
        
        try:
            with open(self.projects_root / "commitlint.config.js", 'w') as f:
                f.write(f"module.exports = {json.dumps(commitlint_config, indent=2)};")
            config_results["configs_created"].append("Commitlint")
        except Exception as e:
            config_results["errors"].append(f"Failed to create Commitlint config: {e}")
        
        # Husky setup
        husky_dir = self.projects_root / ".husky"
        try:
            husky_dir.mkdir(exist_ok=True)
            
            # Pre-commit hook
            pre_commit_hook = """#!/usr/bin/env sh
. "$(dirname -- "$0")/_/husky.sh"

# Run lint-staged
npx lint-staged

# Run tests
npm run test

# Run security check
npm audit --audit-level=moderate
"""
            with open(husky_dir / "pre-commit", 'w') as f:
                f.write(pre_commit_hook)
            
            # Commit message hook
            commit_msg_hook = """#!/usr/bin/env sh
. "$(dirname -- "$0")/_/husky.sh"

npx --no -- commitlint --edit ${1}
"""
            with open(husky_dir / "commit-msg", 'w') as f:
                f.write(commit_msg_hook)
            
            # Make hooks executable
            os.chmod(husky_dir / "pre-commit", 0o755)
            os.chmod(husky_dir / "commit-msg", 0o755)
            
            config_results["configs_created"].append("Husky")
        except Exception as e:
            config_results["errors"].append(f"Failed to create Husky hooks: {e}")
        
        return config_results
    
    def setup_ci_cd(self) -> Dict[str, Any]:
        """Set up CI/CD workflows"""
        ci_results = {
            "workflows_created": [],
            "errors": []
        }
        
        # GitHub Actions workflow
        github_dir = self.projects_root / ".github" / "workflows"
        github_dir.mkdir(parents=True, exist_ok=True)
        
        ci_workflow = {
            "name": "CI/CD Pipeline",
            "on": {
                "push": {
                    "branches": ["main", "develop"]
                },
                "pull_request": {
                    "branches": ["main"]
                }
            },
            "jobs": {
                "test": {
                    "runs-on": "ubuntu-latest",
                    "strategy": {
                        "matrix": {
                            "node-version": ["16.x", "18.x", "20.x"]
                        }
                    },
                    "steps": [
                        {
                            "uses": "actions/checkout@v3"
                        },
                        {
                            "name": "Use Node.js ${{ matrix.node-version }}",
                            "uses": "actions/setup-node@v3",
                            "with": {
                                "node-version": "${{ matrix.node-version }}",
                                "cache": "npm"
                            }
                        },
                        {
                            "run": "npm ci"
                        },
                        {
                            "run": "npm run lint"
                        },
                        {
                            "run": "npm run test"
                        },
                        {
                            "run": "npm run build"
                        },
                        {
                            "name": "Security audit",
                            "run": "npm audit --audit-level=moderate"
                        },
                        {
                            "name": "Upload coverage",
                            "uses": "codecov/codecov-action@v3"
                        }
                    ]
                },
                "semantic-release": {
                    "runs-on": "ubuntu-latest",
                    "needs": "test",
                    "if": "github.ref == 'refs/heads/main'",
                    "steps": [
                        {
                            "uses": "actions/checkout@v3",
                            "with": {
                                "fetch-depth": 0
                            }
                        },
                        {
                            "name": "Setup Node.js",
                            "uses": "actions/setup-node@v3",
                            "with": {
                                "node-version": "18",
                                "cache": "npm"
                            }
                        },
                        {
                            "run": "npm ci"
                        },
                        {
                            "run": "npm run build"
                        },
                        {
                            "name": "Release",
                            "env": {
                                "GITHUB_TOKEN": "${{ secrets.GITHUB_TOKEN }}",
                                "NPM_TOKEN": "${{ secrets.NPM_TOKEN }}"
                            },
                            "run": "npx semantic-release"
                        }
                    ]
                }
            }
        }
        
        try:
            with open(github_dir / "ci.yml", 'w') as f:
                yaml.dump(ci_workflow, f, default_flow_style=False)
            ci_results["workflows_created"].append("GitHub Actions CI/CD")
        except Exception as e:
            ci_results["errors"].append(f"Failed to create GitHub Actions workflow: {e}")
        
        return ci_results
    
    def migrate_projects_to_monorepo(self) -> Dict[str, Any]:
        """Migrate existing projects into the monorepo structure"""
        migration_results = {
            "projects_migrated": [],
            "projects_linked": [],
            "errors": []
        }
        
        # Projects to integrate directly into CAIA
        integration_candidates = [
            "chatgpt-mcp-server",
            "jira-connect",
            "smart-agents-training-system"
        ]
        
        # Projects to keep as external but linked
        external_projects = [
            "roulette-community",
            "paraforge", 
            "omnimind",
            "claude-code-ultimate"
        ]
        
        for project in integration_candidates:
            project_path = self.projects_root / project
            if project_path.exists():
                try:
                    # Determine target location in CAIA
                    if "agent" in project or "smart-agent" in project:
                        target_dir = self.caia_root / "agents" / "specialized" / project
                    elif "mcp" in project or "connect" in project:
                        target_dir = self.caia_root / "integrations" / project
                    else:
                        target_dir = self.caia_root / "tools" / project
                    
                    # Create target directory
                    target_dir.parent.mkdir(parents=True, exist_ok=True)
                    
                    # Move project (or copy for safety)
                    if not target_dir.exists():
                        shutil.copytree(project_path, target_dir)
                        migration_results["projects_migrated"].append(f"{project} -> {target_dir.relative_to(self.caia_root)}")
                    
                except Exception as e:
                    migration_results["errors"].append(f"Failed to migrate {project}: {e}")
        
        # Link external projects
        for project in external_projects:
            project_path = self.projects_root / project
            if project_path.exists():
                try:
                    # Update their package.json to reference the monorepo
                    package_json = project_path / "package.json"
                    if package_json.exists():
                        with open(package_json, 'r') as f:
                            package_data = json.load(f)
                        
                        # Add monorepo reference
                        package_data.setdefault("caia-monorepo", {
                            "integrated": True,
                            "role": "external-project",
                            "dependencies": ["@caia/core"]
                        })
                        
                        with open(package_json, 'w') as f:
                            json.dump(package_data, f, indent=2)
                        
                        migration_results["projects_linked"].append(project)
                
                except Exception as e:
                    migration_results["errors"].append(f"Failed to link {project}: {e}")
        
        return migration_results
    
    def run_quality_checks(self) -> Dict[str, Any]:
        """Run quality checks across the entire monorepo"""
        quality_results = {
            "overall_health": "unknown",
            "projects_checked": 0,
            "quality_gates": {
                "test_coverage": {"passed": 0, "failed": 0, "threshold": 80},
                "lint_errors": {"passed": 0, "failed": 0, "threshold": 0},
                "type_errors": {"passed": 0, "failed": 0, "threshold": 0},
                "security_issues": {"passed": 0, "failed": 0, "threshold": 0}
            },
            "projects": {}
        }
        
        # Check each project
        for project_dir in [self.caia_root] + list(self.projects_root.glob("*")):
            if project_dir.is_dir() and project_dir.name not in ["admin", ".git", "node_modules"]:
                project_name = project_dir.name
                project_quality = {
                    "test_coverage": 0,
                    "lint_errors": 0,
                    "type_errors": 0,
                    "security_issues": 0,
                    "quality_score": 0
                }
                
                # Run linting
                lint_result = self.run_command(["npm", "run", "lint"], project_dir)
                if not lint_result["success"]:
                    # Count errors (simplified)
                    project_quality["lint_errors"] = lint_result["stderr"].count("error")
                
                # Run type checking
                if (project_dir / "tsconfig.json").exists():
                    tsc_result = self.run_command(["npx", "tsc", "--noEmit"], project_dir)
                    if not tsc_result["success"]:
                        project_quality["type_errors"] = tsc_result["stderr"].count("error")
                
                # Run tests and coverage
                test_result = self.run_command(["npm", "run", "test", "--", "--coverage"], project_dir)
                if test_result["success"]:
                    # Extract coverage (simplified)
                    coverage_match = re.search(r'All files.*?(\d+\.?\d*)%', test_result["stdout"])
                    if coverage_match:
                        project_quality["test_coverage"] = float(coverage_match.group(1))
                
                # Security audit
                audit_result = self.run_command(["npm", "audit", "--json"], project_dir)
                if audit_result["success"]:
                    try:
                        audit_data = json.loads(audit_result["stdout"])
                        project_quality["security_issues"] = audit_data.get("metadata", {}).get("vulnerabilities", {}).get("total", 0)
                    except:
                        pass
                
                # Calculate quality score
                score = 0
                if project_quality["test_coverage"] >= 80:
                    score += 25
                if project_quality["lint_errors"] == 0:
                    score += 25
                if project_quality["type_errors"] == 0:
                    score += 25
                if project_quality["security_issues"] == 0:
                    score += 25
                
                project_quality["quality_score"] = score
                quality_results["projects"][project_name] = project_quality
                quality_results["projects_checked"] += 1
                
                # Update quality gates
                for gate in quality_results["quality_gates"]:
                    gate_data = quality_results["quality_gates"][gate]
                    project_value = project_quality[gate]
                    
                    if gate == "test_coverage":
                        if project_value >= gate_data["threshold"]:
                            gate_data["passed"] += 1
                        else:
                            gate_data["failed"] += 1
                    else:
                        if project_value <= gate_data["threshold"]:
                            gate_data["passed"] += 1
                        else:
                            gate_data["failed"] += 1
        
        # Calculate overall health
        total_projects = quality_results["projects_checked"]
        healthy_projects = sum(1 for p in quality_results["projects"].values() if p["quality_score"] >= 75)
        
        if total_projects == 0:
            quality_results["overall_health"] = "unknown"
        elif healthy_projects / total_projects >= 0.8:
            quality_results["overall_health"] = "excellent"
        elif healthy_projects / total_projects >= 0.6:
            quality_results["overall_health"] = "good"
        elif healthy_projects / total_projects >= 0.4:
            quality_results["overall_health"] = "warning"
        else:
            quality_results["overall_health"] = "critical"
        
        return quality_results
    
    def generate_monorepo_report(self) -> str:
        """Generate a comprehensive monorepo status report"""
        quality_results = self.run_quality_checks()
        
        report_lines = [
            "=" * 80,
            "CAIA MONOREPO STATUS REPORT",
            f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
            "=" * 80,
            "",
            "## MONOREPO HEALTH",
            f"Overall Status: {quality_results['overall_health'].upper()}",
            f"Projects Checked: {quality_results['projects_checked']}",
            "",
            "## QUALITY GATES"
        ]
        
        for gate_name, gate_data in quality_results["quality_gates"].items():
            total = gate_data["passed"] + gate_data["failed"]
            if total > 0:
                pass_rate = (gate_data["passed"] / total) * 100
                status = "✅" if pass_rate >= 80 else "⚠️" if pass_rate >= 60 else "❌"
                report_lines.append(f"   {status} {gate_name.replace('_', ' ').title()}: {gate_data['passed']}/{total} ({pass_rate:.1f}%)")
        
        # Top performing projects
        sorted_projects = sorted(
            quality_results["projects"].items(),
            key=lambda x: x[1]["quality_score"],
            reverse=True
        )
        
        report_lines.extend([
            "",
            "## TOP PERFORMING PROJECTS"
        ])
        
        for project_name, metrics in sorted_projects[:5]:
            score_emoji = "🟢" if metrics["quality_score"] >= 75 else "🟡" if metrics["quality_score"] >= 50 else "🔴"
            report_lines.append(f"   {score_emoji} {project_name}: {metrics['quality_score']}/100")
        
        # Projects needing attention
        attention_projects = [(name, metrics) for name, metrics in sorted_projects if metrics["quality_score"] < 50]
        
        if attention_projects:
            report_lines.extend([
                "",
                "## PROJECTS NEEDING ATTENTION"
            ])
            
            for project_name, metrics in attention_projects:
                report_lines.append(f"   🔴 {project_name}: {metrics['quality_score']}/100")
                if metrics["test_coverage"] < 80:
                    report_lines.append(f"      - Test coverage: {metrics['test_coverage']:.1f}% (need 80%)")
                if metrics["lint_errors"] > 0:
                    report_lines.append(f"      - Lint errors: {metrics['lint_errors']}")
                if metrics["security_issues"] > 0:
                    report_lines.append(f"      - Security issues: {metrics['security_issues']}")
        
        report_lines.extend([
            "",
            "## MONOREPO COMMANDS",
            "   • Setup monorepo: python3 admin/scripts/monorepo_manager.py --setup",
            "   • Run quality checks: python3 admin/scripts/monorepo_manager.py --quality",
            "   • Bootstrap all packages: npm run bootstrap",
            "   • Test all packages: npm run test",
            "   • Build all packages: npm run build",
            "   • Publish packages: npm run publish",
            "",
            "=" * 80
        ])
        
        return "\n".join(report_lines)

def main():
    import argparse
    
    parser = argparse.ArgumentParser(description="Monorepo management for CAIA")
    parser.add_argument("--setup", action="store_true", help="Set up monorepo structure")
    parser.add_argument("--migrate", action="store_true", help="Migrate projects to monorepo")
    parser.add_argument("--quality", action="store_true", help="Run quality checks")
    parser.add_argument("--report", action="store_true", help="Generate status report")
    parser.add_argument("--bootstrap", action="store_true", help="Bootstrap packages")
    parser.add_argument("--json", action="store_true", help="Output JSON format")
    
    args = parser.parse_args()
    
    manager = MonorepoManager()
    
    if args.setup:
        print("🏗️  Setting up CAIA monorepo...")
        
        # Setup workspace
        workspace_result = manager.setup_root_workspace()
        print(f"✅ Workspace setup: Lerna={workspace_result['lerna_setup']}, Package.json={workspace_result['workspace_config']}")
        
        # Setup shared configs
        config_result = manager.setup_shared_configs()
        print(f"✅ Shared configs: {', '.join(config_result['configs_created'])}")
        
        # Setup CI/CD
        ci_result = manager.setup_ci_cd()
        print(f"✅ CI/CD setup: {', '.join(ci_result['workflows_created'])}")
        
        if workspace_result["errors"] or config_result["errors"] or ci_result["errors"]:
            print("⚠️  Some errors occurred:")
            for error in workspace_result["errors"] + config_result["errors"] + ci_result["errors"]:
                print(f"   - {error}")
    
    elif args.migrate:
        print("📦 Migrating projects to monorepo...")
        migration_result = manager.migrate_projects_to_monorepo()
        
        if migration_result["projects_migrated"]:
            print("✅ Projects migrated:")
            for project in migration_result["projects_migrated"]:
                print(f"   • {project}")
        
        if migration_result["projects_linked"]:
            print("🔗 Projects linked:")
            for project in migration_result["projects_linked"]:
                print(f"   • {project}")
        
        if migration_result["errors"]:
            print("❌ Errors occurred:")
            for error in migration_result["errors"]:
                print(f"   • {error}")
    
    elif args.quality:
        print("🔍 Running quality checks...")
        quality_result = manager.run_quality_checks()
        
        if args.json:
            print(json.dumps(quality_result, indent=2))
        else:
            print(f"Overall Health: {quality_result['overall_health']}")
            print(f"Projects Checked: {quality_result['projects_checked']}")
            
            for gate_name, gate_data in quality_result["quality_gates"].items():
                total = gate_data["passed"] + gate_data["failed"]
                if total > 0:
                    pass_rate = (gate_data["passed"] / total) * 100
                    print(f"{gate_name}: {gate_data['passed']}/{total} ({pass_rate:.1f}%)")
    
    elif args.bootstrap:
        print("🚀 Bootstrapping monorepo packages...")
        result = manager.run_command(["npm", "run", "bootstrap"])
        if result["success"]:
            print("✅ Bootstrap completed")
        else:
            print(f"❌ Bootstrap failed: {result['stderr']}")
    
    else:
        # Default: generate report
        report = manager.generate_monorepo_report()
        print(report)

if __name__ == "__main__":
    main()