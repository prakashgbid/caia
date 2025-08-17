#!/usr/bin/env python3
"""
Autonomous ChatGPT Agent V2

A truly autonomous agent that uses the ChatGPT MCP Server.
This agent thinks independently, pursues goals, and manages its work autonomously.
"""

import asyncio
import json
import hashlib
from typing import Dict, List, Optional, Any
from datetime import datetime, timedelta
from pathlib import Path
from dataclasses import dataclass, field
import logging
import sys
import os

# Add parent directory to path for imports
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Import MCP client
from chatgpt_mcp_server.client import ChatGPTMCPClient, ChatGPTConversation


@dataclass
class Goal:
    """Represents an autonomous goal"""
    id: str
    description: str
    priority: int
    subtasks: List[str] = field(default_factory=list)
    completed_subtasks: List[str] = field(default_factory=list)
    status: str = "pending"
    created_at: datetime = field(default_factory=datetime.now)
    results: Dict[str, Any] = field(default_factory=dict)
    
    def progress(self) -> float:
        if not self.subtasks:
            return 0.0
        return len(self.completed_subtasks) / len(self.subtasks) * 100


class ThoughtEngine:
    """Internal reasoning and decision-making engine"""
    
    def __init__(self):
        self.thoughts = []
        self.decisions = []
        self.learnings = []
        self.strategies = {
            'research': self._research_strategy,
            'development': self._development_strategy,
            'creative': self._creative_strategy,
            'analytical': self._analytical_strategy
        }
    
    def think(self, context: Dict[str, Any]) -> Dict[str, Any]:
        """
        Core thinking process - analyzes situation and decides action.
        This is where the agent's autonomy comes from.
        """
        thought = {
            'timestamp': datetime.now(),
            'context_analysis': self._analyze_context(context),
            'goal_analysis': self._analyze_goals(context.get('goals', [])),
            'resource_analysis': self._analyze_resources(context),
            'decision': None
        }
        
        # Decide what to do
        if thought['goal_analysis']['active_goals']:
            highest_priority = thought['goal_analysis']['highest_priority']
            strategy = self._select_strategy(highest_priority)
            thought['decision'] = {
                'action': 'pursue_goal',
                'goal': highest_priority,
                'strategy': strategy,
                'approach': self.strategies[strategy](highest_priority)
            }
        else:
            thought['decision'] = {
                'action': 'idle',
                'reason': 'No active goals'
            }
        
        # Learn from past actions
        if 'history' in context:
            learnings = self._learn_from_history(context['history'])
            if learnings:
                self.learnings.extend(learnings)
                thought['new_learnings'] = learnings
        
        self.thoughts.append(thought)
        return thought
    
    def _analyze_context(self, context: Dict[str, Any]) -> Dict[str, Any]:
        """Analyze current context"""
        return {
            'time_of_day': datetime.now().hour,
            'optimal_work_time': 9 <= datetime.now().hour <= 17,
            'mcp_available': context.get('mcp_status', {}).get('healthy', False),
            'resources_available': True
        }
    
    def _analyze_goals(self, goals: List[Goal]) -> Dict[str, Any]:
        """Analyze goals and prioritize"""
        active_goals = [g for g in goals if g.status != 'completed']
        
        analysis = {
            'total_goals': len(goals),
            'active_goals': len(active_goals),
            'completed_goals': len(goals) - len(active_goals),
            'highest_priority': None
        }
        
        if active_goals:
            analysis['highest_priority'] = min(active_goals, key=lambda g: g.priority)
            analysis['average_progress'] = sum(g.progress() for g in active_goals) / len(active_goals)
        
        return analysis
    
    def _analyze_resources(self, context: Dict[str, Any]) -> Dict[str, Any]:
        """Analyze available resources"""
        mcp_status = context.get('mcp_status', {})
        
        return {
            'mcp_sessions_available': mcp_status.get('active_sessions', 0) < mcp_status.get('max_sessions', 3),
            'mcp_healthy': mcp_status.get('healthy', False),
            'memory_available': True,
            'can_proceed': True
        }
    
    def _select_strategy(self, goal: Goal) -> str:
        """Select best strategy for goal"""
        keywords = goal.description.lower()
        
        if any(word in keywords for word in ['research', 'investigate', 'explore', 'study']):
            return 'research'
        elif any(word in keywords for word in ['build', 'create', 'implement', 'develop', 'code']):
            return 'development'
        elif any(word in keywords for word in ['design', 'imagine', 'conceive', 'artistic']):
            return 'creative'
        elif any(word in keywords for word in ['analyze', 'evaluate', 'assess', 'measure']):
            return 'analytical'
        else:
            return 'research'  # Default
    
    def _research_strategy(self, goal: Goal) -> Dict[str, Any]:
        """Strategy for research goals"""
        return {
            'type': 'research',
            'approach': 'systematic',
            'phases': [
                'broad_exploration',
                'deep_dive',
                'synthesis',
                'documentation'
            ],
            'session_type': 'research',
            'questions': self._generate_research_questions(goal)
        }
    
    def _development_strategy(self, goal: Goal) -> Dict[str, Any]:
        """Strategy for development goals"""
        return {
            'type': 'development',
            'approach': 'iterative',
            'phases': [
                'requirements_analysis',
                'architecture_design',
                'implementation',
                'testing',
                'refinement'
            ],
            'session_type': 'analytical'
        }
    
    def _creative_strategy(self, goal: Goal) -> Dict[str, Any]:
        """Strategy for creative goals"""
        return {
            'type': 'creative',
            'approach': 'exploratory',
            'phases': [
                'inspiration',
                'ideation',
                'creation',
                'refinement'
            ],
            'session_type': 'creative'
        }
    
    def _analytical_strategy(self, goal: Goal) -> Dict[str, Any]:
        """Strategy for analytical goals"""
        return {
            'type': 'analytical',
            'approach': 'methodical',
            'phases': [
                'data_gathering',
                'analysis',
                'pattern_recognition',
                'insights',
                'recommendations'
            ],
            'session_type': 'analytical'
        }
    
    def _generate_research_questions(self, goal: Goal) -> List[str]:
        """Generate research questions for a goal"""
        base = goal.description
        return [
            f"What are the key concepts in {base}?",
            f"What are the current best practices for {base}?",
            f"What challenges are commonly faced with {base}?",
            f"What tools or technologies are used for {base}?",
            f"What are recent innovations in {base}?",
            f"How do experts approach {base}?"
        ]
    
    def _learn_from_history(self, history: List[Dict[str, Any]]) -> List[str]:
        """Learn from past actions"""
        learnings = []
        
        # Analyze success patterns
        successes = [h for h in history if h.get('success', False)]
        if len(successes) > 5:
            # Find patterns in successful actions
            success_times = [h['timestamp'].hour for h in successes[-10:]]
            if success_times:
                most_productive = max(set(success_times), key=success_times.count)
                learnings.append(f"Most productive at hour {most_productive}")
        
        # Analyze failure patterns
        failures = [h for h in history if not h.get('success', False)]
        if failures:
            failure_types = [h.get('error_type', 'unknown') for h in failures[-5:]]
            if 'timeout' in failure_types:
                learnings.append("Need to optimize request timing")
        
        return learnings


class AutonomousAgent:
    """
    Main autonomous agent that uses ChatGPT MCP Server.
    Operates independently to pursue goals.
    """
    
    def __init__(self, mcp_url: str = "http://localhost:8000"):
        self.mcp_url = mcp_url
        self.mcp_client: Optional[ChatGPTMCPClient] = None
        self.thought_engine = ThoughtEngine()
        self.goals: List[Goal] = []
        self.action_history = []
        self.memory_path = Path.home() / ".autonomous-agent-v2"
        self.memory_path.mkdir(exist_ok=True)
        
        # Setup logging
        log_file = self.memory_path / f"agent_{datetime.now():%Y%m%d}.log"
        logging.basicConfig(
            level=logging.INFO,
            format='%(asctime)s - %(message)s',
            handlers=[
                logging.FileHandler(log_file),
                logging.StreamHandler()
            ]
        )
        
        self.running = False
    
    async def initialize(self):
        """Initialize the agent"""
        logging.info("🧠 Initializing Autonomous Agent V2...")
        
        # Connect to MCP server
        self.mcp_client = ChatGPTMCPClient(self.mcp_url)
        
        # Check MCP health
        if not await self.mcp_client.health_check():
            logging.error("❌ MCP Server not available. Start it with: ./start_server.sh")
            raise Exception("MCP Server not available")
        
        # Load saved state
        await self._load_state()
        
        logging.info("✅ Agent initialized and ready to work autonomously")
    
    async def add_goal(self, description: str, priority: int = 1) -> Goal:
        """Add a new goal for the agent to pursue"""
        goal = Goal(
            id=hashlib.md5(f"{description}{datetime.now()}".encode()).hexdigest()[:8],
            description=description,
            priority=priority,
            subtasks=self._decompose_goal(description)
        )
        
        self.goals.append(goal)
        logging.info(f"🎯 New goal added: {description}")
        logging.info(f"   Subtasks: {goal.subtasks}")
        
        return goal
    
    def _decompose_goal(self, description: str) -> List[str]:
        """Break down goal into subtasks"""
        keywords = description.lower()
        subtasks = []
        
        # Research tasks
        if 'research' in keywords or 'investigate' in keywords:
            subtasks.extend([
                "Explore current state of knowledge",
                "Identify key concepts and terminology",
                "Find authoritative sources",
                "Analyze different perspectives",
                "Synthesize findings",
                "Document conclusions"
            ])
        
        # Development tasks
        if 'build' in keywords or 'create' in keywords or 'implement' in keywords:
            subtasks.extend([
                "Define requirements",
                "Design architecture",
                "Implement core functionality",
                "Add error handling",
                "Test thoroughly",
                "Optimize and refine",
                "Create documentation"
            ])
        
        # Analysis tasks
        if 'analyze' in keywords or 'evaluate' in keywords:
            subtasks.extend([
                "Gather relevant data",
                "Identify analysis criteria",
                "Perform analysis",
                "Identify patterns",
                "Draw conclusions",
                "Create report"
            ])
        
        # Default if no specific keywords
        if not subtasks:
            subtasks = [
                "Understand the objective",
                "Research background information",
                "Plan approach",
                "Execute plan",
                "Verify results",
                "Document outcome"
            ]
        
        return subtasks
    
    async def run(self):
        """Run the agent autonomously"""
        self.running = True
        logging.info("🚀 Agent starting autonomous operation")
        
        while self.running:
            try:
                # Get MCP status
                mcp_status = await self.mcp_client.get_status()
                
                # Think about current situation
                context = {
                    'goals': self.goals,
                    'mcp_status': mcp_status,
                    'history': self.action_history[-20:]  # Last 20 actions
                }
                
                thought = self.thought_engine.think(context)
                
                # Log thinking
                logging.info(f"💭 Thinking: {thought['decision']}")
                
                # Execute decision
                if thought['decision']['action'] == 'pursue_goal':
                    await self._pursue_goal(
                        thought['decision']['goal'],
                        thought['decision']['approach']
                    )
                elif thought['decision']['action'] == 'idle':
                    logging.info("😴 No active goals, waiting...")
                    await asyncio.sleep(10)
                
                # Save state periodically
                await self._save_state()
                
                # Brief pause between cycles
                await asyncio.sleep(2)
                
            except KeyboardInterrupt:
                logging.info("⚠️ Interrupted by user")
                break
            except Exception as e:
                logging.error(f"❌ Error in main loop: {e}")
                await asyncio.sleep(5)
        
        logging.info("Agent stopped")
    
    async def _pursue_goal(self, goal: Goal, approach: Dict[str, Any]):
        """Pursue a specific goal"""
        logging.info(f"🎯 Working on: {goal.description}")
        
        # Get next incomplete subtask
        remaining_tasks = [t for t in goal.subtasks if t not in goal.completed_subtasks]
        
        if not remaining_tasks:
            goal.status = 'completed'
            logging.info(f"✅ Goal completed: {goal.description}")
            return
        
        current_task = remaining_tasks[0]
        logging.info(f"📋 Current subtask: {current_task}")
        
        # Execute based on strategy type
        strategy_type = approach.get('type', 'research')
        
        if strategy_type == 'research':
            await self._execute_research(goal, current_task, approach)
        elif strategy_type == 'development':
            await self._execute_development(goal, current_task, approach)
        elif strategy_type == 'creative':
            await self._execute_creative(goal, current_task, approach)
        elif strategy_type == 'analytical':
            await self._execute_analytical(goal, current_task, approach)
        
        # Mark subtask complete
        goal.completed_subtasks.append(current_task)
        logging.info(f"✅ Subtask completed: {current_task}")
        logging.info(f"   Progress: {goal.progress():.1f}%")
    
    async def _execute_research(self, goal: Goal, task: str, approach: Dict[str, Any]):
        """Execute research task"""
        async with self.mcp_client as client:
            conversation = ChatGPTConversation(client, session_type='research')
            
            # Ask research questions
            questions = approach.get('questions', [])[:3]  # Limit to 3 for now
            
            for question in questions:
                logging.info(f"   Asking: {question}")
                response = await conversation.ask(question, human_mode=True)
                
                # Save response
                if 'research' not in goal.results:
                    goal.results['research'] = []
                
                goal.results['research'].append({
                    'question': question,
                    'answer': response,
                    'timestamp': datetime.now().isoformat()
                })
                
                # Brief pause
                await asyncio.sleep(3)
            
            # Save research to file
            research_file = self.memory_path / f"research_{goal.id}_{task.replace(' ', '_')}.json"
            with open(research_file, 'w') as f:
                json.dump(goal.results.get('research', []), f, indent=2)
    
    async def _execute_development(self, goal: Goal, task: str, approach: Dict[str, Any]):
        """Execute development task"""
        async with self.mcp_client as client:
            conversation = ChatGPTConversation(client, session_type='analytical')
            
            # Development prompt
            prompt = f"""
            Task: {task}
            Goal: {goal.description}
            
            Please provide a detailed solution with code if applicable.
            Focus on clean, maintainable implementation.
            """
            
            response = await conversation.ask(prompt, human_mode=True)
            
            # Save code/solution
            if 'development' not in goal.results:
                goal.results['development'] = []
            
            goal.results['development'].append({
                'task': task,
                'solution': response,
                'timestamp': datetime.now().isoformat()
            })
            
            # Save to file
            dev_file = self.memory_path / f"dev_{goal.id}_{task.replace(' ', '_')}.md"
            with open(dev_file, 'w') as f:
                f.write(f"# {task}\n\n{response}")
    
    async def _execute_creative(self, goal: Goal, task: str, approach: Dict[str, Any]):
        """Execute creative task"""
        async with self.mcp_client as client:
            conversation = ChatGPTConversation(client, session_type='creative')
            
            prompt = f"Creative task: {task}\nContext: {goal.description}\n\nBe innovative and think outside the box."
            response = await conversation.ask(prompt, human_mode=True)
            
            # Save creative output
            if 'creative' not in goal.results:
                goal.results['creative'] = []
            
            goal.results['creative'].append({
                'task': task,
                'output': response,
                'timestamp': datetime.now().isoformat()
            })
    
    async def _execute_analytical(self, goal: Goal, task: str, approach: Dict[str, Any]):
        """Execute analytical task"""
        async with self.mcp_client as client:
            conversation = ChatGPTConversation(client, session_type='analytical')
            
            prompt = f"Analyze: {task}\nIn context of: {goal.description}\n\nProvide data-driven insights."
            response = await conversation.ask(prompt, human_mode=True)
            
            # Save analysis
            if 'analysis' not in goal.results:
                goal.results['analysis'] = []
            
            goal.results['analysis'].append({
                'task': task,
                'analysis': response,
                'timestamp': datetime.now().isoformat()
            })
    
    async def _save_state(self):
        """Save agent state"""
        state = {
            'goals': [
                {
                    'id': g.id,
                    'description': g.description,
                    'priority': g.priority,
                    'subtasks': g.subtasks,
                    'completed_subtasks': g.completed_subtasks,
                    'status': g.status,
                    'results': g.results
                }
                for g in self.goals
            ],
            'thoughts': [
                {
                    'timestamp': t['timestamp'].isoformat(),
                    'decision': t['decision']
                }
                for t in self.thought_engine.thoughts[-50:]
            ],
            'learnings': self.thought_engine.learnings
        }
        
        state_file = self.memory_path / "agent_state.json"
        with open(state_file, 'w') as f:
            json.dump(state, f, indent=2)
    
    async def _load_state(self):
        """Load saved state"""
        state_file = self.memory_path / "agent_state.json"
        if state_file.exists():
            with open(state_file, 'r') as f:
                state = json.load(f)
                
                # Restore goals
                for goal_data in state.get('goals', []):
                    if goal_data['status'] != 'completed':
                        goal = Goal(
                            id=goal_data['id'],
                            description=goal_data['description'],
                            priority=goal_data['priority'],
                            subtasks=goal_data['subtasks'],
                            completed_subtasks=goal_data['completed_subtasks']
                        )
                        goal.status = goal_data['status']
                        goal.results = goal_data.get('results', {})
                        self.goals.append(goal)
                
                # Restore learnings
                self.thought_engine.learnings = state.get('learnings', [])
                
                logging.info(f"📚 Loaded {len(self.goals)} active goals")
    
    def get_status(self) -> Dict[str, Any]:
        """Get agent status"""
        return {
            'running': self.running,
            'goals': {
                'total': len(self.goals),
                'active': len([g for g in self.goals if g.status != 'completed']),
                'completed': len([g for g in self.goals if g.status == 'completed'])
            },
            'current_goal': min(
                [g for g in self.goals if g.status != 'completed'],
                key=lambda g: g.priority
            ).description if any(g.status != 'completed' for g in self.goals) else None,
            'thoughts': len(self.thought_engine.thoughts),
            'learnings': self.thought_engine.learnings[-5:]
        }


async def main():
    """Example of running the autonomous agent"""
    
    # Create agent
    agent = AutonomousAgent()
    
    try:
        # Initialize
        await agent.initialize()
        
        # Add some goals
        await agent.add_goal(
            "Research the latest developments in quantum computing",
            priority=1
        )
        
        await agent.add_goal(
            "Build a Python web scraper with error handling",
            priority=2
        )
        
        # Run autonomously
        print("\n🧠 Agent running autonomously...")
        print("Press Ctrl+C to stop\n")
        
        await agent.run()
        
    except KeyboardInterrupt:
        print("\n✋ Stopping agent...")
    except Exception as e:
        print(f"❌ Error: {e}")
    finally:
        # Get final status
        status = agent.get_status()
        print("\n📊 Final Status:")
        print(f"   Goals completed: {status['goals']['completed']}/{status['goals']['total']}")
        print(f"   Thoughts generated: {status['thoughts']}")
        print(f"   Learnings: {status['learnings']}")


if __name__ == "__main__":
    asyncio.run(main())