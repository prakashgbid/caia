#!/usr/bin/env python3
"""
Business Analyst Agent - Creates detailed user stories from epics
One BA per project, all working in parallel
"""

import json
import asyncio
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Any
import concurrent.futures
import hashlib

class BusinessAnalystAgent:
    """
    Dedicated Business Analyst for a specific project
    Converts epics into detailed user stories with acceptance criteria
    """
    
    def __init__(self, project_name: str):
        self.project = project_name
        self.stories = []
        self.story_counter = 0
        self.max_parallel = 50
        
    async def analyze_epic(self, epic: Dict) -> List[Dict]:
        """
        Break down an epic into detailed user stories
        """
        stories = []
        
        # Determine number of stories based on epic complexity
        story_count = epic.get('estimation', 8) // 2  # Roughly 2-3 points per story
        story_count = max(3, min(story_count, 8))  # Between 3-8 stories per epic
        
        # Generate stories in parallel
        tasks = []
        for i in range(story_count):
            task = self._create_user_story(epic, i)
            tasks.append(task)
        
        stories = await asyncio.gather(*tasks)
        
        self.stories.extend(stories)
        return stories
    
    async def _create_user_story(self, epic: Dict, story_index: int) -> Dict:
        """
        Create a detailed user story from epic
        """
        self.story_counter += 1
        
        # Generate story based on epic and index
        story_types = ['frontend', 'backend', 'api', 'database', 'testing', 'documentation']
        story_type = story_types[story_index % len(story_types)]
        
        story = {
            'id': f"{self.project}-STORY-{self.story_counter:04d}",
            'epic_id': epic['id'],
            'type': 'story',
            'story_type': story_type,
            'title': self._generate_story_title(epic['title'], story_type),
            'user_story': self._generate_user_story_text(epic['title'], story_type),
            'acceptance_criteria': self._generate_acceptance_criteria(story_type),
            'technical_requirements': self._generate_technical_requirements(story_type),
            'estimation': self._estimate_story_points(story_type),
            'priority': epic.get('priority', 'medium'),
            'sprint': epic.get('sprint', 1),
            'dependencies': self._identify_dependencies(story_type, story_index),
            'test_scenarios': self._generate_test_scenarios(story_type),
            'definition_of_done': self._generate_dod(story_type),
            'created_by': f"BA-{self.project}",
            'created_at': datetime.now().isoformat(),
            'status': 'ready',
            'assignee': None,
            'implementation_notes': self._generate_implementation_notes(story_type)
        }
        
        return story
    
    def _generate_story_title(self, epic_title: str, story_type: str) -> str:
        """
        Generate story title based on epic and type
        """
        type_prefixes = {
            'frontend': 'Create UI for',
            'backend': 'Implement backend service for',
            'api': 'Build REST API for',
            'database': 'Design database schema for',
            'testing': 'Write tests for',
            'documentation': 'Document'
        }
        
        prefix = type_prefixes.get(story_type, 'Implement')
        return f"{prefix} {epic_title.lower()}"
    
    def _generate_user_story_text(self, epic_title: str, story_type: str) -> str:
        """
        Generate user story in standard format
        """
        personas = {
            'frontend': 'end user',
            'backend': 'system',
            'api': 'developer',
            'database': 'application',
            'testing': 'QA engineer',
            'documentation': 'developer'
        }
        
        values = {
            'frontend': 'interact with the feature easily',
            'backend': 'process data efficiently',
            'api': 'integrate with the system',
            'database': 'store and retrieve data quickly',
            'testing': 'ensure quality',
            'documentation': 'understand the implementation'
        }
        
        persona = personas.get(story_type, 'user')
        value = values.get(story_type, 'use the feature')
        
        return f"As a {persona}, I want {epic_title.lower()} so that I can {value}"
    
    def _generate_acceptance_criteria(self, story_type: str) -> List[str]:
        """
        Generate detailed acceptance criteria
        """
        base_criteria = [
            "Feature works as expected",
            "No critical bugs",
            "Performance meets requirements",
            "Security requirements met"
        ]
        
        type_specific = {
            'frontend': [
                "UI is responsive on all devices",
                "All interactive elements are accessible",
                "Loading time < 2 seconds",
                "Error states handled gracefully",
                "Cross-browser compatibility verified"
            ],
            'backend': [
                "API responds in < 100ms",
                "Data validation implemented",
                "Error handling complete",
                "Logging implemented",
                "Database transactions are atomic"
            ],
            'api': [
                "All endpoints documented",
                "Authentication required",
                "Rate limiting implemented",
                "Response format consistent",
                "Error codes standardized"
            ],
            'database': [
                "Schema optimized for queries",
                "Indexes created for performance",
                "Constraints enforced",
                "Migration scripts provided",
                "Backup strategy defined"
            ],
            'testing': [
                "Unit tests achieve 80% coverage",
                "Integration tests pass",
                "Performance tests meet SLA",
                "Security tests pass",
                "E2E tests cover critical paths"
            ],
            'documentation': [
                "API documentation complete",
                "Code comments added",
                "README updated",
                "Architecture diagrams created",
                "Deployment guide written"
            ]
        }
        
        return base_criteria + type_specific.get(story_type, [])
    
    def _generate_technical_requirements(self, story_type: str) -> List[str]:
        """
        Generate technical requirements
        """
        requirements = {
            'frontend': [
                "React/Vue/Angular framework",
                "TypeScript",
                "Responsive CSS",
                "State management",
                "API integration"
            ],
            'backend': [
                "Python/Node.js/Go",
                "RESTful design",
                "Database ORM",
                "Authentication middleware",
                "Caching layer"
            ],
            'api': [
                "OpenAPI specification",
                "JSON response format",
                "OAuth2/JWT auth",
                "CORS configuration",
                "Rate limiting"
            ],
            'database': [
                "PostgreSQL/MongoDB",
                "Normalized schema",
                "Indexing strategy",
                "Backup procedures",
                "Connection pooling"
            ],
            'testing': [
                "Jest/Pytest",
                "Test database",
                "CI/CD integration",
                "Coverage reporting",
                "Load testing tools"
            ],
            'documentation': [
                "Markdown format",
                "API examples",
                "Code snippets",
                "Diagrams",
                "Version control"
            ]
        }
        
        return requirements.get(story_type, ["Technical design required"])
    
    def _estimate_story_points(self, story_type: str) -> int:
        """
        Estimate story points based on type
        """
        estimates = {
            'frontend': 3,
            'backend': 5,
            'api': 3,
            'database': 5,
            'testing': 2,
            'documentation': 1
        }
        
        return estimates.get(story_type, 3)
    
    def _identify_dependencies(self, story_type: str, index: int) -> List[str]:
        """
        Identify story dependencies
        """
        dependencies = []
        
        # Frontend depends on API
        if story_type == 'frontend':
            dependencies.append('api')
        
        # API depends on backend
        elif story_type == 'api':
            dependencies.append('backend')
        
        # Backend depends on database
        elif story_type == 'backend':
            dependencies.append('database')
        
        # Testing depends on implementation
        elif story_type == 'testing':
            dependencies.extend(['frontend', 'backend', 'api'])
        
        # Documentation depends on everything
        elif story_type == 'documentation':
            dependencies.extend(['frontend', 'backend', 'api', 'database'])
        
        return dependencies
    
    def _generate_test_scenarios(self, story_type: str) -> List[str]:
        """
        Generate test scenarios
        """
        scenarios = {
            'frontend': [
                "Test happy path user flow",
                "Test error states",
                "Test edge cases",
                "Test accessibility",
                "Test performance"
            ],
            'backend': [
                "Test data validation",
                "Test business logic",
                "Test error handling",
                "Test concurrent requests",
                "Test database transactions"
            ],
            'api': [
                "Test all endpoints",
                "Test authentication",
                "Test authorization",
                "Test rate limiting",
                "Test response formats"
            ],
            'database': [
                "Test CRUD operations",
                "Test constraints",
                "Test indexes",
                "Test migrations",
                "Test backup/restore"
            ],
            'testing': [
                "Run unit tests",
                "Run integration tests",
                "Run performance tests",
                "Run security tests",
                "Generate coverage report"
            ],
            'documentation': [
                "Review accuracy",
                "Check completeness",
                "Verify examples work",
                "Test links",
                "Validate formatting"
            ]
        }
        
        return scenarios.get(story_type, ["Test basic functionality"])
    
    def _generate_dod(self, story_type: str) -> List[str]:
        """
        Generate Definition of Done
        """
        return [
            "Code complete and reviewed",
            "Unit tests written and passing",
            "Integration tests passing",
            "Documentation updated",
            "Deployed to staging",
            "Product Owner approval",
            "No known bugs"
        ]
    
    def _generate_implementation_notes(self, story_type: str) -> str:
        """
        Generate implementation notes for developers
        """
        notes = {
            'frontend': "Use component library for consistency. Implement lazy loading for performance.",
            'backend': "Use dependency injection. Implement circuit breaker pattern for resilience.",
            'api': "Follow REST best practices. Version the API from start.",
            'database': "Consider sharding for scale. Implement soft deletes.",
            'testing': "Use test fixtures. Implement parallel test execution.",
            'documentation': "Use templates. Include code examples."
        }
        
        return notes.get(story_type, "Follow project conventions and best practices.")
    
    def export_to_jira(self) -> List[Dict]:
        """
        Export stories in JIRA format
        """
        jira_stories = []
        
        for story in self.stories:
            jira_story = {
                'fields': {
                    'project': {'key': self.project.upper()[:4]},
                    'summary': story['title'],
                    'description': story['user_story'],
                    'issuetype': {'name': 'Story'},
                    'priority': {'name': story['priority'].capitalize()},
                    'customfield_10001': story['estimation'],  # Story points
                    'customfield_10003': '\n'.join(story['acceptance_criteria']),  # AC
                    'customfield_10004': '\n'.join(story['technical_requirements']),  # Tech req
                    'labels': [self.project, story['story_type'], f"sprint-{story['sprint']}"],
                    'components': [{'name': self.project}]
                }
            }
            jira_stories.append(jira_story)
        
        return jira_stories
    
    def generate_sprint_board(self, sprint_num: int = 1) -> Dict:
        """
        Generate sprint board for stories
        """
        sprint_stories = [s for s in self.stories if s['sprint'] == sprint_num]
        
        board = {
            'sprint': sprint_num,
            'project': self.project,
            'columns': {
                'backlog': [],
                'ready': [],
                'in_progress': [],
                'review': [],
                'done': []
            },
            'total_points': sum(s['estimation'] for s in sprint_stories),
            'story_count': len(sprint_stories)
        }
        
        # Distribute stories to columns
        for story in sprint_stories:
            status = story.get('status', 'ready')
            if status in board['columns']:
                board['columns'][status].append(story['id'])
        
        return board


class ParallelBusinessAnalystOrchestrator:
    """
    Orchestrates multiple Business Analysts working in parallel
    """
    
    def __init__(self):
        self.analysts = {}
        self.all_stories = {}
        self.max_parallel = 50
    
    async def deploy_analysts_for_projects(self, projects: List[str]) -> Dict:
        """
        Deploy one BA per project, all working in parallel
        """
        print(f"🤖 Deploying {len(projects)} Business Analysts in parallel...")
        
        # Create BA for each project
        for project in projects:
            self.analysts[project] = BusinessAnalystAgent(project)
        
        return self.analysts
    
    async def process_all_epics(self, feature_backlog: Dict) -> Dict:
        """
        Process all epics across all projects in massive parallel
        """
        print(f"📝 Processing epics across {len(feature_backlog)} projects...")
        
        start_time = datetime.now()
        
        # Process all projects in parallel
        tasks = []
        for project, epics in feature_backlog.items():
            if project in self.analysts:
                ba = self.analysts[project]
                task = self._process_project_epics(ba, epics)
                tasks.append(task)
        
        results = await asyncio.gather(*tasks)
        
        # Collect all stories
        for project, stories in zip(feature_backlog.keys(), results):
            self.all_stories[project] = stories
        
        end_time = datetime.now()
        duration = (end_time - start_time).total_seconds()
        
        total_stories = sum(len(stories) for stories in self.all_stories.values())
        
        print(f"✅ Created {total_stories} stories across {len(self.all_stories)} projects in {duration:.2f} seconds")
        
        return self.all_stories
    
    async def _process_project_epics(self, ba: BusinessAnalystAgent, epics: List[Dict]) -> List[Dict]:
        """
        Process all epics for a project
        """
        all_stories = []
        
        # Process epics in parallel
        tasks = []
        for epic in epics:
            task = ba.analyze_epic(epic)
            tasks.append(task)
        
        epic_stories = await asyncio.gather(*tasks)
        
        # Flatten the list
        for stories in epic_stories:
            all_stories.extend(stories)
        
        return all_stories
    
    def generate_work_distribution(self) -> Dict:
        """
        Generate work distribution across teams
        """
        distribution = {
            'total_stories': 0,
            'total_points': 0,
            'by_project': {},
            'by_type': {},
            'by_sprint': {}
        }
        
        for project, stories in self.all_stories.items():
            project_points = sum(s['estimation'] for s in stories)
            
            distribution['total_stories'] += len(stories)
            distribution['total_points'] += project_points
            
            distribution['by_project'][project] = {
                'stories': len(stories),
                'points': project_points,
                'types': {}
            }
            
            # Count by type
            for story in stories:
                story_type = story.get('story_type', 'unknown')
                
                if story_type not in distribution['by_type']:
                    distribution['by_type'][story_type] = 0
                distribution['by_type'][story_type] += 1
                
                if story_type not in distribution['by_project'][project]['types']:
                    distribution['by_project'][project]['types'][story_type] = 0
                distribution['by_project'][project]['types'][story_type] += 1
                
                # Count by sprint
                sprint = story.get('sprint', 1)
                if sprint not in distribution['by_sprint']:
                    distribution['by_sprint'][sprint] = []
                distribution['by_sprint'][sprint].append(story['id'])
        
        return distribution


if __name__ == "__main__":
    # Test the Business Analyst system
    print("📊 Business Analyst Agent System Ready!")
    
    async def test():
        # Create orchestrator
        orchestrator = ParallelBusinessAnalystOrchestrator()
        
        # Deploy BAs for projects
        projects = ['evolux-ai', 'cognitron-engine', 'codeforge-ai', 'osa']
        analysts = await orchestrator.deploy_analysts_for_projects(projects)
        
        # Create sample epics
        sample_backlog = {}
        for project in projects:
            sample_backlog[project] = [
                {
                    'id': f"{project}-EPIC-001",
                    'title': f"Core functionality for {project}",
                    'estimation': 8,
                    'priority': 'high',
                    'sprint': 1
                },
                {
                    'id': f"{project}-EPIC-002",
                    'title': f"API integration for {project}",
                    'estimation': 5,
                    'priority': 'medium',
                    'sprint': 1
                }
            ]
        
        # Process all epics in parallel
        stories = await orchestrator.process_all_epics(sample_backlog)
        
        # Generate distribution report
        distribution = orchestrator.generate_work_distribution()
        
        print(f"\n📊 Work Distribution:")
        print(f"Total Stories: {distribution['total_stories']}")
        print(f"Total Points: {distribution['total_points']}")
        print(f"By Type: {distribution['by_type']}")
    
    asyncio.run(test())