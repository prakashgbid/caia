import pendulum
import orjson
"""Core implementation of Autonomix autonomous AI engine"""

import asyncio
import logging
import re
import subprocess
from typing import Dict, List, Optional, Any, Tuple
from datetime import datetime
from pathlib import Path
from enum import Enum
from .utils import setup_logger
from .langchain_engine import get_langchain_engine, LANGCHAIN_AVAILABLE
from .self_learning import get_learning_system, LearningDomain, FeedbackType
from .task_planner import get_task_planner, TaskType, TaskPriority
from .mcp_client import get_mcp_client
from .code_generator import get_code_generator, CodeGenerationRequest, CodeType, ProgrammingLanguage
from .orchestrator_adapter import get_osa_orchestrator, AgentType, CollaborationMode
from .memory_adapter import get_persistent_memory, MemoryType, MemoryPriority
from ..agents.open_source_extractor_agent import get_open_source_extractor
from ..agents.open_source_solution_finder import get_solution_finder
import ollama
import asyncio
from .action_hooks import get_action_hooks
import subprocess


class IntentType(Enum):
    """Types of user intents Autonomix can detect"""
    CODE_GENERATION = 'code_generation'
    CODE_DEBUG = 'code_debug'
    CODE_REFACTOR = 'code_refactor'
    DEEP_THINKING = 'deep_thinking'
    PROBLEM_SOLVING = 'problem_solving'
    LEARNING = 'learning'
    EXPLANATION = 'explanation'
    CREATIVE = 'creative'
    ANALYSIS = 'analysis'
    GENERAL_CHAT = 'general_chat'
    SYSTEM_TASK = 'system_task'
class AutonomixEngine:
    """
    Autonomous AI engine that intelligently determines what to do
    based on user input without manual mode switching.
    """

    def __init__(self, config: Optional[Dict[str, Any]]=None):
        """Initialize Autonomix engine."""
        self.config = config or {}
        self.model = self.config.get('model', 'llama3.2:3b')
        self.verbose = self.config.get('verbose', False)
        self.logger = setup_logger('Autonomix-Engine', level='DEBUG' if self.verbose else 'INFO')
        self.langchain_engine = None
        if LANGCHAIN_AVAILABLE:
            try:
                self.langchain_engine = get_langchain_engine(config)
                self.logger.info('LangChain intelligence engine initialized')
            except Exception as e:
                self.logger.error(f'Failed to initialize LangChain: {e}')
        self.learning_system = None
        try:
            self.learning_system = get_learning_system(config)
            self.logger.info('Self-learning system initialized')
        except Exception as e:
            self.logger.error(f'Failed to initialize learning system: {e}')
        self.task_planner = None
        try:
            self.task_planner = get_task_planner(self.langchain_engine, config)
            self.logger.info('Task planning system initialized')
        except Exception as e:
            self.logger.error(f'Failed to initialize task planner: {e}')
        self.mcp_client = None
        try:
            self.mcp_client = get_mcp_client(config)
            self.logger.info('MCP client initialized')
        except Exception as e:
            self.logger.error(f'Failed to initialize MCP client: {e}')
        self.code_generator = None
        try:
            self.code_generator = get_code_generator(self.langchain_engine, config)
            self.logger.info('Code generation system initialized')
        except Exception as e:
            self.logger.error(f'Failed to initialize code generator: {e}')
        self.agent_orchestrator = None
        try:
            self.agent_orchestrator = get_osa_orchestrator(self.langchain_engine, config)
            self.logger.info('Multi-agent orchestrator initialized')
        except Exception as e:
            self.logger.error(f'Failed to initialize agent orchestrator: {e}')
        self.persistent_memory = None
        try:
            self.persistent_memory = get_persistent_memory(config)
            self.logger.info('Persistent memory system initialized')
            context = self.persistent_memory.get_context_for_session()
            if context['core_vision']:
                self.logger.info(f"Loaded {len(context['core_vision'])} core vision memories")
            if context['skills']:
                self.logger.info(f"Loaded {len(context['skills'])} learned skills")
        except Exception as e:
            self.logger.error(f'Failed to initialize persistent memory: {e}')
        self.open_source_extractor = None
        try:
            self.open_source_extractor = get_open_source_extractor(config)
            self.logger.info('Open Source Extractor Agent initialized')
            import asyncio
            asyncio.create_task(self.open_source_extractor.run_continuous_scan())
            self.logger.info('Started continuous open source scanning')
        except Exception as e:
            self.logger.error(f'Failed to initialize Open Source Extractor: {e}')
        self.solution_finder = None
        try:
            self.solution_finder = get_solution_finder(config)
            self.logger.info('Open Source Solution Finder initialized')
            self.logger.info('🎯 Will check for existing solutions before writing custom code')
        except Exception as e:
            self.logger.error(f'Failed to initialize Solution Finder: {e}')
        self.client = None
        if ollama:
            try:
                self.client = ollama.Client()
                self.logger.info(f'Ollama client initialized with model: {self.model}')
            except Exception as e:
                self.logger.error(f'Failed to initialize Ollama: {e}')
        self.conversation_context = []
        self.task_context = {}
        self.learning_memory = []
        self.intent_patterns = {IntentType.CODE_GENERATION: ['write.*(?:code|function|script|program|app)', 'create.*(?:function|script|program|app|code)', 'implement', 'build.*(?:app|program|script|function)', 'generate.*(?:script|code|function)', 'code.*for', 'develop', 'make.*(?:function|program|script)'], IntentType.CODE_DEBUG: ['debug', 'fix.*(?:error|bug|issue|problem)', 'error', 'not working', 'throwing.*error', 'bug', 'issue.*code', 'problem.*(?:with|in).*code', 'crash', 'exception', 'help.*fix'], IntentType.CODE_REFACTOR: ['refactor', 'improve.*code', 'optimize', 'clean.*up', 'make.*(?:better|cleaner|faster)', 'performance', 'faster', 'efficient'], IntentType.DEEP_THINKING: ['think.*(?:deeply|about)', 'philosophy', 'contemplate', 'reflect', 'ponder', 'meditate', 'consciousness', 'deep.*(?:dive|thought)', 'explore.*concept', 'nature of'], IntentType.PROBLEM_SOLVING: ['solve', 'how.*(?:do|can|to)', 'figure.*out', 'calculate', 'work.*out', 'find.*solution', 'resolve', 'equation', 'math'], IntentType.LEARNING: ['learn', 'teach.*(?:me|about)', 'explain.*how', 'understand', 'study', 'tutorial', 'guide', 'walk.*through', 'lesson', 'course'], IntentType.EXPLANATION: ['what.*is', 'explain(?!.*how)', 'describe', 'tell.*about', 'how.*does', 'why.*(?:is|does|are)', 'define', 'meaning', 'definition'], IntentType.CREATIVE: ['create.*(?:story|poem|tale|narrative)', 'write.*(?:story|poem|creative|fiction)', 'imagine', 'creative', 'design.*(?:story|character)', 'brainstorm', 'ideas.*for', 'invent.*story'], IntentType.ANALYSIS: ['analyze', 'evaluate', 'assess', 'review', 'examine', 'investigate', 'compare', 'critique', 'pros.*cons', 'advantages.*disadvantages'], IntentType.SYSTEM_TASK: ['run.*command', 'execute', 'terminal', 'system.*(?:command|task)', 'list.*files', 'file.*operation', 'directory', 'process']}
        self.logger.info('Autonomix autonomous system initialized')

    async def initialize(self):
        """Initialize Autonomix systems."""
        self.logger.info('🚀 Starting Autonomix autonomous systems...')
        if self.persistent_memory:
            critical_context = self.persistent_memory.export_critical_context()
            self.logger.info('Loaded persistent context from previous sessions')
            self.logger.debug(critical_context)
        if self.langchain_engine:
            try:
                from .action_hooks import get_action_hooks
                self.langchain_engine.set_action_hooks(get_action_hooks())
                success = await self.langchain_engine.initialize_intelligence_systems()
                if success:
                    self.logger.info('🧠 Advanced intelligence systems initialized')
                else:
                    self.logger.warning('⚠️ Some intelligence systems failed to initialize')
            except Exception as e:
                self.logger.error(f'Error initializing LangChain: {e}')
        if self.client:
            try:
                import subprocess
                result = subprocess.run(['ollama', 'list'], capture_output=True, text=True, timeout=5)
                if result.returncode == 0:
                    lines = result.stdout.strip().split('\n')[1:]
                    model_names = [line.split()[0] for line in lines if line.strip()]
                    if model_names:
                        self.logger.info(f'📚 Available models: {model_names}')
                        if self.model not in model_names:
                            self.model = model_names[0]
                            self.logger.info(f'🔄 Switched to available model: {self.model}')
            except Exception as e:
                self.logger.error(f'Error checking models: {e}')
        asyncio.create_task(self._background_intelligence())
        if self.learning_system:
            asyncio.create_task(self.learning_system.continuous_learning_loop())
            self.logger.info('📚 Continuous learning activated')
        if self.task_planner:
            asyncio.create_task(self.task_planner.run_execution_loop())
            self.logger.info('🎯 Task planner activated')
        if self.mcp_client:
            try:
                await self.mcp_client.start_all_servers()
                self.logger.info('🔌 MCP servers started')
            except Exception as e:
                self.logger.error(f'Failed to start MCP servers: {e}')
        self.logger.info('✅ Autonomix engine ready!')

    def detect_intent(self, user_input: str) -> Tuple[IntentType, float]:
        """
        Automatically detect user intent from input.
        Returns intent type and confidence score.
        """
        user_input_lower = user_input.lower()
        intent_scores = {}
        for (intent_type, patterns) in self.intent_patterns.items():
            score = 0
            for pattern in patterns:
                if re.search(pattern, user_input_lower):
                    score += 1
            if score > 0:
                intent_scores[intent_type] = score / len(patterns)
        if not intent_scores:
            return (IntentType.GENERAL_CHAT, 0.5)
        best_intent = max(intent_scores.items(), key=lambda x: x[1])
        return (best_intent[0], best_intent[1])

    def get_status_emoji(self, intent: IntentType) -> str:
        """Get status emoji for intent type."""
        emoji_map = {IntentType.CODE_GENERATION: '💻', IntentType.CODE_DEBUG: '🐛', IntentType.CODE_REFACTOR: '🔧', IntentType.DEEP_THINKING: '🧠', IntentType.PROBLEM_SOLVING: '🎯', IntentType.LEARNING: '📚', IntentType.EXPLANATION: '💡', IntentType.CREATIVE: '🎨', IntentType.ANALYSIS: '🔍', IntentType.GENERAL_CHAT: '💬', IntentType.SYSTEM_TASK: '⚙️'}
        return emoji_map.get(intent, '🤖')

    def _map_intent_to_task_type(self, intent: IntentType) -> str:
        """Map Autonomix intent to LangChain task type"""
        intent_mapping = {IntentType.CODE_GENERATION: 'coding', IntentType.CODE_DEBUG: 'coding', IntentType.CODE_REFACTOR: 'coding', IntentType.DEEP_THINKING: 'reasoning', IntentType.PROBLEM_SOLVING: 'reasoning', IntentType.ANALYSIS: 'reasoning', IntentType.LEARNING: 'rag_query', IntentType.EXPLANATION: 'reasoning', IntentType.CREATIVE: 'creative', IntentType.GENERAL_CHAT: 'general', IntentType.SYSTEM_TASK: 'general'}
        return intent_mapping.get(intent, 'general')

    def _map_intent_to_learning_domain(self, intent: IntentType) -> LearningDomain:
        """Map Autonomix intent to learning domain"""
        mapping = {IntentType.CODE_GENERATION: LearningDomain.CODING, IntentType.CODE_DEBUG: LearningDomain.CODING, IntentType.CODE_REFACTOR: LearningDomain.CODING, IntentType.DEEP_THINKING: LearningDomain.PROBLEM_SOLVING, IntentType.PROBLEM_SOLVING: LearningDomain.PROBLEM_SOLVING, IntentType.LEARNING: LearningDomain.KNOWLEDGE, IntentType.EXPLANATION: LearningDomain.KNOWLEDGE, IntentType.CREATIVE: LearningDomain.CONVERSATION, IntentType.ANALYSIS: LearningDomain.PROBLEM_SOLVING, IntentType.GENERAL_CHAT: LearningDomain.CONVERSATION, IntentType.SYSTEM_TASK: LearningDomain.BEHAVIOR}
        return mapping.get(intent, LearningDomain.CONVERSATION)

    def _map_intent_to_task_type_planner(self, intent: IntentType) -> TaskType:
        """Map Autonomix intent to task planner type"""
        mapping = {IntentType.CODE_GENERATION: TaskType.CODING, IntentType.CODE_DEBUG: TaskType.CODING, IntentType.CODE_REFACTOR: TaskType.CODING, IntentType.DEEP_THINKING: TaskType.ANALYSIS, IntentType.PROBLEM_SOLVING: TaskType.ANALYSIS, IntentType.LEARNING: TaskType.RESEARCH, IntentType.EXPLANATION: TaskType.COMMUNICATION, IntentType.CREATIVE: TaskType.CREATIVE, IntentType.ANALYSIS: TaskType.ANALYSIS, IntentType.GENERAL_CHAT: TaskType.COMMUNICATION, IntentType.SYSTEM_TASK: TaskType.SYSTEM}
        return mapping.get(intent, TaskType.ANALYSIS)

    async def _should_use_multi_agent(self, user_input: str, intent: IntentType) -> bool:
        """Determine if task requires multi-agent collaboration"""
        multi_agent_keywords = ['research and', 'analyze and', 'create and', 'then', 'after that', 'followed by', 'multiple', 'various', 'comprehensive', 'end-to-end', 'full stack', 'complete system']
        input_lower = user_input.lower()
        has_multi_step = any((keyword in input_lower for keyword in multi_agent_keywords))
        domain_count = sum(['code' in input_lower or 'program' in input_lower, 'research' in input_lower or 'find' in input_lower, 'analyze' in input_lower or 'evaluate' in input_lower, 'deploy' in input_lower or 'execute' in input_lower, 'plan' in input_lower or 'design' in input_lower])
        complex_intents = [IntentType.CODE_GENERATION, IntentType.PROBLEM_SOLVING, IntentType.ANALYSIS, IntentType.SYSTEM_TASK]
        return (has_multi_step or domain_count >= 2) and intent in complex_intents

    async def _needs_task_decomposition(self, user_input: str, intent: IntentType) -> bool:
        """Determine if input requires task decomposition"""
        complex_keywords = ['build', 'create', 'develop', 'implement', 'design', 'analyze', 'research', 'investigate', 'compare', 'multiple', 'several', 'various', 'complete', 'entire']
        input_lower = user_input.lower()
        has_complex_keyword = any((keyword in input_lower for keyword in complex_keywords))
        is_long_input = len(user_input) > 200
        is_complex_intent = intent in [IntentType.CODE_GENERATION, IntentType.PROBLEM_SOLVING, IntentType.ANALYSIS]
        return (has_complex_keyword or is_long_input) and is_complex_intent

    async def process_autonomously(self, user_input: str) -> str:
        """
        Process user input completely autonomously.
        Automatically determines intent and takes appropriate action.
        """
        (intent, confidence) = self.detect_intent(user_input)
        status_emoji = self.get_status_emoji(intent)
        status_msg = f"{status_emoji} Detected: {intent.value.replace('_', ' ').title()} (confidence: {confidence:.0%})"
        self.logger.info(status_msg)
        self.conversation_context.append({'input': user_input, 'intent': intent.value, 'timestamp': pendulum.now().isoformat()})
        if self.persistent_memory:
            self.persistent_memory.store_memory(content=f'User Query: {user_input}\nIntent: {intent.value}', memory_type=MemoryType.CONTEXT, priority=MemoryPriority.MEDIUM, metadata={'intent': intent.value, 'confidence': confidence})
        if await self._should_use_multi_agent(user_input, intent):
            result = await self.agent_orchestrator.execute_task(task=user_input, context={'intent': intent.value, 'confidence': confidence, 'conversation_context': self.conversation_context[-3:] if self.conversation_context else []})
            if result['success']:
                response_parts = [status_msg, '\n🤝 Multi-Agent Collaboration Complete\n']
                if result['handoffs']:
                    response_parts.append('Agent Flow:')
                    for handoff in result['handoffs']:
                        response_parts.append(f"  {handoff['from']} → {handoff['to']}")
                    response_parts.append('')
                response_parts.append('Result:')
                response_parts.append(result['result'] or 'Task completed successfully')
                return '\n'.join(response_parts)
        elif await self._needs_task_decomposition(user_input, intent):
            task = await self.task_planner.create_task(description=user_input, task_type=self._map_intent_to_task_type_planner(intent), priority=TaskPriority.HIGH, context={'intent': intent.value})
            return f"{status_msg}\n\n🎯 Complex task created with {len(task.steps)} steps. Task ID: {task.task_id}\n\nI'll work on this autonomously and update you on progress."
        learning_applied = False
        if self.learning_system:
            learning_domain = self._map_intent_to_learning_domain(intent)
            recommendations = await self.learning_system.apply_learning(learning_domain, user_input)
            if recommendations['confidence'] > 0.7:
                learning_applied = True
                self.logger.info(f"Applied learning with confidence: {recommendations['confidence']}")
        if self.langchain_engine:
            try:
                task_type = self._map_intent_to_task_type(intent)
                (response, metadata) = await self.langchain_engine.query_with_memory(user_input, task_type)
                if 'success' in metadata:
                    self.conversation_context[-1]['langchain_used'] = True
                    self.conversation_context[-1]['model_used'] = metadata.get('model_used', 'unknown')
                    self.conversation_context[-1]['learning_applied'] = learning_applied
                if self.learning_system:
                    learning_domain = self._map_intent_to_learning_domain(intent)
                    await self.learning_system.record_interaction(domain=learning_domain, input_context=user_input, output_response=response, feedback=(FeedbackType.IMPLICIT, 0.7))
                return f'{status_msg}\n\n{response}'
            except Exception as e:
                self.logger.error(f'LangChain processing failed: {e}')
        if intent == IntentType.CODE_GENERATION:
            response = await self._handle_code_generation(user_input)
        elif intent == IntentType.CODE_DEBUG:
            response = await self._handle_code_debug(user_input)
        elif intent == IntentType.CODE_REFACTOR:
            response = await self._handle_code_refactor(user_input)
        elif intent == IntentType.DEEP_THINKING:
            response = await self._handle_deep_thinking(user_input)
        elif intent == IntentType.PROBLEM_SOLVING:
            response = await self._handle_problem_solving(user_input)
        elif intent == IntentType.LEARNING:
            response = await self._handle_learning(user_input)
        elif intent == IntentType.EXPLANATION:
            response = await self._handle_explanation(user_input)
        elif intent == IntentType.CREATIVE:
            response = await self._handle_creative(user_input)
        elif intent == IntentType.ANALYSIS:
            response = await self._handle_analysis(user_input)
        elif intent == IntentType.SYSTEM_TASK:
            response = await self._handle_system_task(user_input)
        else:
            response = await self._handle_general_chat(user_input)
        await self._learn_from_interaction(user_input, intent, response)
        return f'{status_msg}\n\n{response}'

    async def _handle_code_generation(self, user_input: str) -> str:
        """Handle code generation requests."""
        self.logger.debug('📝 Generating code...')
        if self.code_generator:
            try:
                language = ProgrammingLanguage.PYTHON
                if any((lang in user_input.lower() for lang in ['javascript', 'js'])):
                    language = ProgrammingLanguage.JAVASCRIPT
                elif 'typescript' in user_input.lower():
                    language = ProgrammingLanguage.TYPESCRIPT
                elif 'go' in user_input.lower() or 'golang' in user_input.lower():
                    language = ProgrammingLanguage.GO
                code_type = CodeType.FUNCTION
                if 'class' in user_input.lower():
                    code_type = CodeType.CLASS
                elif 'module' in user_input.lower():
                    code_type = CodeType.MODULE
                elif 'script' in user_input.lower():
                    code_type = CodeType.SCRIPT
                elif 'test' in user_input.lower():
                    code_type = CodeType.TEST
                request = CodeGenerationRequest(description=user_input, code_type=code_type, language=language, requirements=['Clean code', 'Error handling', 'Documentation'], constraints=[])
                result = await self.code_generator.generate_code(request)
                response_parts = [f'Generated {result.language.value} code:', f'```{result.language.value}', result.code, '```']
                if result.tests:
                    response_parts.extend(['\nTests:', f'```{result.language.value}', result.tests, '```'])
                if result.documentation:
                    response_parts.append(f'\nDocumentation:\n{result.documentation}')
                if result.quality_score > 0:
                    response_parts.append(f'\nCode Quality Score: {result.quality_score:.0%}')
                return '\n'.join(response_parts)
            except Exception as e:
                self.logger.error(f'Code generation failed: {e}')
        prompt = f'As an expert programmer, generate clean, efficient code for:\n{user_input}\n\nProvide:\n1. Complete, working code\n2. Clear comments\n3. Usage example\n4. Brief explanation'
        return await self._generate_response(prompt)

    async def _handle_code_debug(self, user_input: str) -> str:
        """Handle debugging requests."""
        self.logger.debug('🔍 Debugging code...')
        prompt = f'As a debugging expert, help with:\n{user_input}\n\nProvide:\n1. Root cause analysis\n2. Step-by-step debugging approach\n3. Fixed code (if applicable)\n4. Prevention tips'
        return await self._generate_response(prompt)

    async def _handle_code_refactor(self, user_input: str) -> str:
        """Handle code refactoring requests."""
        self.logger.debug('♻️ Refactoring code...')
        prompt = f'As a code quality expert, refactor for:\n{user_input}\n\nFocus on:\n1. Better structure and organization\n2. Performance improvements\n3. Readability and maintainability\n4. Best practices'
        return await self._generate_response(prompt)

    async def _handle_deep_thinking(self, user_input: str) -> str:
        """Handle deep thinking requests."""
        self.logger.debug('💭 Engaging deep thinking mode...')
        prompt = f'Think deeply and philosophically about:\n{user_input}\n\nConsider:\n- Multiple perspectives\n- Underlying principles\n- Broader implications\n- Novel insights\n- Connections to other concepts'
        return await self._generate_response(prompt)

    async def _handle_problem_solving(self, user_input: str) -> str:
        """Handle problem-solving requests."""
        self.logger.debug('🧩 Solving problem...')
        prompt = f'Solve this problem systematically:\n{user_input}\n\nApproach:\n1. Understand the problem\n2. Break it down into steps\n3. Apply relevant methods\n4. Provide clear solution\n5. Verify the answer'
        return await self._generate_response(prompt)

    async def _handle_learning(self, user_input: str) -> str:
        """Handle learning/teaching requests."""
        self.logger.debug('📖 Teaching mode activated...')
        prompt = f'As an expert teacher, help learn:\n{user_input}\n\nStructure:\n1. Core concepts\n2. Step-by-step explanation\n3. Practical examples\n4. Common pitfalls\n5. Practice exercises'
        response = await self._generate_response(prompt)
        self.learning_memory.append({'topic': user_input, 'lesson': response[:500], 'timestamp': pendulum.now().isoformat()})
        return response

    async def _handle_explanation(self, user_input: str) -> str:
        """Handle explanation requests."""
        self.logger.debug('💡 Explaining concept...')
        prompt = f'Explain clearly and comprehensively:\n{user_input}\n\nInclude:\n1. Simple definition\n2. How it works\n3. Real-world analogy\n4. Why it matters\n5. Related concepts'
        return await self._generate_response(prompt)

    async def _handle_creative(self, user_input: str) -> str:
        """Handle creative requests."""
        self.logger.debug('🎨 Engaging creative mode...')
        prompt = f'Be creative and imaginative with:\n{user_input}\n\nLet creativity flow with:\n- Original ideas\n- Vivid descriptions\n- Unexpected connections\n- Emotional depth\n- Unique perspectives'
        return await self._generate_response(prompt)

    async def _handle_analysis(self, user_input: str) -> str:
        """Handle analysis requests."""
        self.logger.debug('📊 Analyzing...')
        prompt = f'Provide thorough analysis of:\n{user_input}\n\nAnalysis should include:\n1. Key observations\n2. Patterns and trends\n3. Strengths and weaknesses\n4. Implications\n5. Recommendations'
        return await self._generate_response(prompt)

    async def _handle_system_task(self, user_input: str) -> str:
        """Handle system/command tasks."""
        self.logger.debug('⚡ Processing system task...')
        prompt = f'Help with this system/command task:\n{user_input}\n\nProvide:\n1. Command or script needed\n2. What it does\n3. Safety considerations\n4. Expected output'
        return await self._generate_response(prompt)

    async def _handle_general_chat(self, user_input: str) -> str:
        """Handle general conversation."""
        self.logger.debug('💬 General conversation...')
        return await self._generate_response(user_input)

    async def _generate_response(self, prompt: str) -> str:
        """Generate response using Ollama."""
        if not self.client:
            return 'Autonomix is running in simulation mode (Ollama not connected)'
        try:
            if self.conversation_context:
                recent_context = self.conversation_context[-3:]
                context_str = '\n'.join([f"Previous: {c['input']}" for c in recent_context])
                prompt = f'Context:\n{context_str}\n\nCurrent request:\n{prompt}'
            response = self.client.generate(model=self.model, prompt=prompt)
            return response.get('response', 'No response generated')
        except Exception as e:
            self.logger.error(f'Error generating response: {e}')
            return f'Error processing request: {e}'

    async def _learn_from_interaction(self, user_input: str, intent: IntentType, response: str):
        """Learn from each interaction to improve future responses."""
        self.logger.debug(f'📚 Learning from {intent.value} interaction')
        if self.persistent_memory:
            learning_content = f'Pattern: {intent.value}\nInput: {user_input[:200]}\nResponse Quality: Good\nLesson: Successfully handled {intent.value} request'
            self.persistent_memory.store_memory(content=learning_content, memory_type=MemoryType.LEARNING, priority=MemoryPriority.MEDIUM, metadata={'intent': intent.value, 'success': True})

    async def _background_intelligence(self):
        """Background process for continuous intelligence."""
        while True:
            try:
                await asyncio.sleep(60)
                if len(self.conversation_context) > 10:
                    self.logger.debug('🧠 Background analysis running...')
            except Exception as e:
                self.logger.error(f'Background intelligence error: {e}')
                await asyncio.sleep(300)

    async def think_autonomously(self, topic: str) -> str:
        """Autonomous thinking without user direction."""
        self.logger.info('🧠 Autonomous thinking activated...')
        perspectives = ['technical perspective', 'philosophical angle', 'practical implications', 'future possibilities']
        thoughts = []
        for perspective in perspectives:
            prompt = f"Think about '{topic}' from a {perspective}"
            thought = await self._generate_response(prompt)
            thoughts.append(f'[{perspective.title()}]\n{thought}')
        return '\n\n'.join(thoughts)

    def get_status(self) -> Dict[str, Any]:
        """Get current Autonomix engine status."""
        status = {'model': self.model, 'conversations': len(self.conversation_context), 'learning_entries': len(self.learning_memory), 'last_intent': self.conversation_context[-1]['intent'] if self.conversation_context else None, 'ollama_connected': self.client is not None}
        if self.langchain_engine:
            langchain_status = self.langchain_engine.get_system_status()
            status['langchain'] = langchain_status
        else:
            status['langchain'] = {'available': False}
        if self.learning_system:
            status['learning'] = self.learning_system.get_learning_insights()
        else:
            status['learning'] = {'available': False}
        if self.task_planner:
            active_tasks = len(self.task_planner.running_tasks)
            pending_tasks = self.task_planner.execution_queue.qsize()
            status['task_planner'] = {'active_tasks': active_tasks, 'pending_tasks': pending_tasks, 'total_tasks': len(self.task_planner.tasks)}
        else:
            status['task_planner'] = {'available': False}
        if self.mcp_client:
            status['mcp'] = self.mcp_client.get_all_server_status()
        else:
            status['mcp'] = {'available': False}
        if self.code_generator:
            status['code_generator'] = {'available': True, 'templates': len(self.code_generator.templates), 'modifications': len(self.code_generator.modification_history)}
        else:
            status['code_generator'] = {'available': False}
        if self.agent_orchestrator:
            metrics = self.agent_orchestrator.get_metrics()
            status['agent_orchestrator'] = {'available': True, 'total_agents': len(self.agent_orchestrator.agents), 'collaboration_mode': self.agent_orchestrator.collaboration_mode.value, 'total_tasks': metrics['total_tasks'], 'successful_tasks': metrics['successful_tasks']}
        else:
            status['agent_orchestrator'] = {'available': False}
        return status

    async def shutdown(self):
        """Shutdown Autonomix engine gracefully."""
        self.logger.info('Shutting down Autonomix engine...')
        if self.langchain_engine:
            try:
                await self.langchain_engine.shutdown()
                self.logger.info('✓ LangChain systems shut down')
            except Exception as e:
                self.logger.error(f'Error shutting down LangChain: {e}')
        if self.mcp_client:
            try:
                await self.mcp_client.stop_all_servers()
                self.logger.info('✓ MCP servers stopped')
            except Exception as e:
                self.logger.error(f'Error stopping MCP servers: {e}')
        self.logger.info('✓ Autonomix engine shutdown complete')