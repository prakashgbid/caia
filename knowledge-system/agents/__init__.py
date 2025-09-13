"""
Agents Module - AI-First Agent Framework
Based on LangGraph and modern agentic architectures
"""

from .base_agent import BaseAgent, AgentState, AgentResult
from .knowledge_agent import KnowledgeAgent
from .reasoning_agent import ReasoningAgent
from .coding_agent import CodingAgent
from .orchestrator_agent import OrchestratorAgent
from .agent_manager import AgentManager

__all__ = [
    'BaseAgent',
    'AgentState', 
    'AgentResult',
    'KnowledgeAgent',
    'ReasoningAgent',
    'CodingAgent', 
    'OrchestratorAgent',
    'AgentManager'
]