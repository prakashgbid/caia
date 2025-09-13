"""
LLM Manager - Advanced Local & Remote LLM Integration
Handles Ollama, OpenAI, Anthropic with intelligent routing
"""

import asyncio
import logging
from typing import Dict, List, Optional, Any, Union
from dataclasses import dataclass
from enum import Enum
import time
import aiohttp
import requests
from langchain_community.llms import Ollama
from langchain_openai import OpenAI, ChatOpenAI
from langchain_anthropic import ChatAnthropic
from langchain_core.messages import BaseMessage, HumanMessage, AIMessage

logger = logging.getLogger(__name__)


class ProviderType(Enum):
    OLLAMA = "ollama"
    OPENAI = "openai"
    ANTHROPIC = "anthropic"


@dataclass
class ModelConfig:
    name: str
    provider: ProviderType
    max_tokens: int = 4000
    temperature: float = 0.7
    timeout: int = 300
    specialization: Optional[str] = None


class LLMManager:
    """Advanced LLM Manager with automatic failover and intelligent routing"""
    
    def __init__(self, config: Dict[str, Any]):
        self.config = config
        self.providers = {}
        self.model_configs = {}
        self.health_status = {}
        self.usage_stats = {}
        self._setup_providers()
        
    def _setup_providers(self):
        """Initialize all configured LLM providers"""
        llm_config = self.config.get('llm', {})
        
        # Setup Ollama
        if 'ollama' in llm_config.get('providers', {}):
            try:
                ollama_config = llm_config['providers']['ollama']
                self.providers[ProviderType.OLLAMA] = {
                    'base_url': ollama_config.get('base_url', 'http://localhost:11434'),
                    'models': ollama_config.get('models', {}),
                    'timeout': ollama_config.get('timeout', 300),
                    'max_retries': ollama_config.get('max_retries', 3)
                }
                self._setup_ollama_models(ollama_config['models'])
                logger.info("Ollama provider initialized")
            except Exception as e:
                logger.error(f"Failed to setup Ollama: {e}")
                
        # Setup OpenAI
        if 'openai' in llm_config.get('providers', {}):
            try:
                openai_config = llm_config['providers']['openai']
                self.providers[ProviderType.OPENAI] = ChatOpenAI(
                    api_key=openai_config.get('api_key'),
                    model=openai_config.get('model', 'gpt-4-turbo-preview'),
                    max_tokens=openai_config.get('max_tokens', 4000),
                    temperature=openai_config.get('temperature', 0.7)
                )
                logger.info("OpenAI provider initialized")
            except Exception as e:
                logger.error(f"Failed to setup OpenAI: {e}")
                
        # Setup Anthropic
        if 'anthropic' in llm_config.get('providers', {}):
            try:
                anthropic_config = llm_config['providers']['anthropic']
                self.providers[ProviderType.ANTHROPIC] = ChatAnthropic(
                    api_key=anthropic_config.get('api_key'),
                    model=anthropic_config.get('model', 'claude-3-sonnet-20240229'),
                    max_tokens=anthropic_config.get('max_tokens', 4000)
                )
                logger.info("Anthropic provider initialized")
            except Exception as e:
                logger.error(f"Failed to setup Anthropic: {e}")
    
    def _setup_ollama_models(self, models: Dict[str, str]):
        """Setup Ollama model configurations"""
        for role, model_name in models.items():
            self.model_configs[f"ollama_{role}"] = ModelConfig(
                name=model_name,
                provider=ProviderType.OLLAMA,
                specialization=role
            )
    
    async def health_check(self) -> Dict[str, bool]:
        """Check health of all providers"""
        health = {}
        
        # Check Ollama
        if ProviderType.OLLAMA in self.providers:
            try:
                base_url = self.providers[ProviderType.OLLAMA]['base_url']
                async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=10)) as session:
                    async with session.get(f"{base_url}/api/tags") as response:
                        health['ollama'] = response.status == 200
            except Exception as e:
                health['ollama'] = False
                logger.error(f"Ollama health check failed: {e}")
        
        # Check other providers
        for provider_type in [ProviderType.OPENAI, ProviderType.ANTHROPIC]:
            if provider_type in self.providers:
                try:
                    # Simple test call
                    result = await self._test_provider(provider_type)
                    health[provider_type.value] = result is not None
                except Exception as e:
                    health[provider_type.value] = False
                    logger.error(f"{provider_type.value} health check failed: {e}")
        
        self.health_status = health
        return health
    
    async def _test_provider(self, provider_type: ProviderType) -> Optional[str]:
        """Test a provider with a simple query"""
        try:
            if provider_type == ProviderType.OLLAMA:
                return await self._call_ollama("Test", "llama3.1:8b")
            elif provider_type in self.providers:
                provider = self.providers[provider_type]
                messages = [HumanMessage(content="Test")]
                response = await provider.ainvoke(messages)
                return response.content
        except Exception as e:
            logger.error(f"Provider test failed for {provider_type}: {e}")
            return None
    
    async def _call_ollama(self, prompt: str, model: str) -> Optional[str]:
        """Direct Ollama API call"""
        try:
            base_url = self.providers[ProviderType.OLLAMA]['base_url']
            timeout = self.providers[ProviderType.OLLAMA]['timeout']
            
            payload = {
                "model": model,
                "prompt": prompt,
                "stream": False,
                "options": {
                    "temperature": 0.7,
                    "top_p": 0.9
                }
            }
            
            async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=timeout)) as session:
                async with session.post(f"{base_url}/api/generate", json=payload) as response:
                    if response.status == 200:
                        data = await response.json()
                        return data.get('response', '')\n                    return None
        except Exception as e:
            logger.error(f"Ollama call failed: {e}")
            return None
    
    async def generate(self, 
                      prompt: str, 
                      model_preference: Optional[str] = None,
                      temperature: float = 0.7,
                      max_tokens: int = 4000) -> Optional[str]:
        """
        Generate response with intelligent model routing
        Falls back to available providers if preferred model fails
        """
        start_time = time.time()
        
        # Determine model priority
        model_priority = self._get_model_priority(model_preference)
        
        for provider_type in model_priority:
            if provider_type not in self.providers:
                continue
                
            try:
                response = await self._generate_with_provider(
                    provider_type, prompt, temperature, max_tokens
                )
                
                if response:
                    # Track usage
                    self._track_usage(provider_type, time.time() - start_time)
                    return response
                    
            except Exception as e:
                logger.warning(f"Provider {provider_type} failed: {e}")
                continue
        
        logger.error("All providers failed for generation request")
        return None
    
    def _get_model_priority(self, preference: Optional[str]) -> List[ProviderType]:
        """Get provider priority based on preference and health"""
        if preference:
            if preference.startswith('ollama'):
                return [ProviderType.OLLAMA, ProviderType.OPENAI, ProviderType.ANTHROPIC]
            elif preference.startswith('openai'):
                return [ProviderType.OPENAI, ProviderType.OLLAMA, ProviderType.ANTHROPIC]
            elif preference.startswith('anthropic'):
                return [ProviderType.ANTHROPIC, ProviderType.OLLAMA, ProviderType.OPENAI]
        
        # Default priority: Local first, then cloud
        return [ProviderType.OLLAMA, ProviderType.OPENAI, ProviderType.ANTHROPIC]
    
    async def _generate_with_provider(self, 
                                    provider_type: ProviderType, 
                                    prompt: str, 
                                    temperature: float, 
                                    max_tokens: int) -> Optional[str]:
        """Generate with specific provider"""
        if provider_type == ProviderType.OLLAMA:
            # Use primary Ollama model
            model = self.providers[ProviderType.OLLAMA]['models'].get('primary', 'llama3.1:8b')
            return await self._call_ollama(prompt, model)
            
        elif provider_type in self.providers:
            provider = self.providers[provider_type]
            messages = [HumanMessage(content=prompt)]
            response = await provider.ainvoke(messages)
            return response.content
        
        return None
    
    def _track_usage(self, provider_type: ProviderType, response_time: float):
        """Track usage statistics"""
        if provider_type.value not in self.usage_stats:
            self.usage_stats[provider_type.value] = {
                'requests': 0,
                'total_time': 0,
                'avg_time': 0,
                'errors': 0
            }
        
        stats = self.usage_stats[provider_type.value]
        stats['requests'] += 1
        stats['total_time'] += response_time
        stats['avg_time'] = stats['total_time'] / stats['requests']
    
    async def pull_ollama_model(self, model_name: str) -> bool:
        """Pull Ollama model if auto_pull is enabled"""
        if not self.config.get('llm', {}).get('providers', {}).get('ollama', {}).get('auto_pull', False):
            return False
            
        try:
            base_url = self.providers[ProviderType.OLLAMA]['base_url']
            payload = {"name": model_name}
            
            async with aiohttp.ClientSession() as session:
                async with session.post(f"{base_url}/api/pull", json=payload) as response:
                    if response.status == 200:
                        logger.info(f"Successfully pulled Ollama model: {model_name}")
                        return True
                    else:
                        logger.error(f"Failed to pull model {model_name}: {response.status}")
                        return False
        except Exception as e:
            logger.error(f"Error pulling Ollama model {model_name}: {e}")
            return False
    
    def get_available_models(self) -> Dict[str, List[str]]:
        """Get list of available models for each provider"""
        models = {}
        
        if ProviderType.OLLAMA in self.providers:
            models['ollama'] = list(self.providers[ProviderType.OLLAMA]['models'].values())
        
        if ProviderType.OPENAI in self.providers:
            models['openai'] = ['gpt-4-turbo-preview', 'gpt-3.5-turbo', 'gpt-4']
        
        if ProviderType.ANTHROPIC in self.providers:
            models['anthropic'] = ['claude-3-sonnet-20240229', 'claude-3-opus-20240229']
        
        return models
    
    def get_stats(self) -> Dict[str, Any]:
        """Get usage statistics"""
        return {
            'health_status': self.health_status,
            'usage_stats': self.usage_stats,
            'available_models': self.get_available_models()
        }