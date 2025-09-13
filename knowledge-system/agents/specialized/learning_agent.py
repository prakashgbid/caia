"""
Learning Agent - Specialized agent for pattern capture and learning from interactions
"""

import asyncio
import json
import pickle
from typing import Dict, Any, List, Optional, Union, Tuple
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from collections import defaultdict, Counter

from langchain_core.messages import HumanMessage, AIMessage, SystemMessage
from ..base_agent import BaseAgent, AgentState, AgentStatus

@dataclass
class LearningPattern:
    """Represents a learned pattern"""
    pattern_id: str
    pattern_type: str  # 'behavioral', 'semantic', 'temporal', 'causal'
    description: str
    confidence: float
    frequency: int
    last_seen: datetime
    context: Dict[str, Any]
    examples: List[Dict[str, Any]]
    metadata: Dict[str, Any] = field(default_factory=dict)

@dataclass
class InteractionEvent:
    """Represents an interaction event for learning"""
    timestamp: datetime
    event_type: str
    user_input: str
    agent_response: str
    context: Dict[str, Any]
    success: bool
    feedback: Optional[str] = None
    metadata: Dict[str, Any] = field(default_factory=dict)

class LearningAgent(BaseAgent):
    """
    Specialized agent for learning and pattern recognition:
    - Captures interaction patterns
    - Learns from user behavior
    - Adapts responses based on learned patterns
    - Maintains knowledge base of patterns
    """
    
    def __init__(self, llm_manager, config: Dict[str, Any]):
        super().__init__(
            name="LearningAgent",
            llm_manager=llm_manager,
            config=config
        )
        
        # Learning configuration
        self.pattern_confidence_threshold = config.get('pattern_confidence_threshold', 0.7)
        self.min_pattern_frequency = config.get('min_pattern_frequency', 3)
        self.learning_window_days = config.get('learning_window_days', 30)
        self.max_patterns_per_type = config.get('max_patterns_per_type', 100)
        
        # Pattern storage
        self.patterns: Dict[str, LearningPattern] = {}
        self.interaction_history: List[InteractionEvent] = []
        
        # Learning statistics
        self.learning_stats = {
            'patterns_learned': 0,
            'interactions_processed': 0,
            'successful_predictions': 0,
            'failed_predictions': 0,
            'adaptation_count': 0
        }
        
        # Pattern detection algorithms
        self.pattern_detectors = {
            'behavioral': self._detect_behavioral_patterns,
            'semantic': self._detect_semantic_patterns,
            'temporal': self._detect_temporal_patterns,
            'causal': self._detect_causal_patterns
        }
    
    async def _plan_action(self, state: AgentState, context: Dict[str, Any]) -> Dict[str, Any]:
        """Plan learning-related actions"""
        task = state.current_task
        task_type = self._classify_learning_task(task)
        
        plan = {
            'task_type': task_type,
            'context': {},
            'metadata': {
                'task_classification': task_type,
                'learning_iteration': state.iteration
            }
        }
        
        if task_type == 'capture_interaction':
            plan['context'] = await self._plan_interaction_capture(task, context)
        elif task_type == 'detect_patterns':
            plan['context'] = await self._plan_pattern_detection(task, context)
        elif task_type == 'adapt_behavior':
            plan['context'] = await self._plan_behavior_adaptation(task, context)
        elif task_type == 'predict_next':
            plan['context'] = await self._plan_prediction(task, context)
        elif task_type == 'analyze_learning':
            plan['context'] = await self._plan_learning_analysis(task, context)
        else:
            plan['context'] = {'approach': 'general_learning'}
        
        return plan
    
    async def _execute_action(self, state: AgentState) -> Dict[str, Any]:
        """Execute learning-related actions"""
        task_type = state.context.get('task_type')
        
        try:
            if task_type == 'capture_interaction':
                return await self._execute_interaction_capture(state)
            elif task_type == 'detect_patterns':
                return await self._execute_pattern_detection(state)
            elif task_type == 'adapt_behavior':
                return await self._execute_behavior_adaptation(state)
            elif task_type == 'predict_next':
                return await self._execute_prediction(state)
            elif task_type == 'analyze_learning':
                return await self._execute_learning_analysis(state)
            else:
                return await self._execute_general_learning(state)
                
        except Exception as e:
            return {
                'success': False,
                'error': str(e),
                'tools_used': ['learning_agent_internal']
            }
    
    def _classify_learning_task(self, task: str) -> str:
        """Classify the type of learning task"""
        task_lower = task.lower()
        
        if any(word in task_lower for word in ['capture', 'record', 'store', 'log']):
            return 'capture_interaction'
        elif any(word in task_lower for word in ['detect', 'find', 'identify', 'pattern']):
            return 'detect_patterns'
        elif any(word in task_lower for word in ['adapt', 'adjust', 'modify', 'improve']):
            return 'adapt_behavior'
        elif any(word in task_lower for word in ['predict', 'anticipate', 'forecast', 'next']):
            return 'predict_next'
        elif any(word in task_lower for word in ['analyze', 'report', 'summary', 'learning']):
            return 'analyze_learning'
        else:
            return 'general_learning'
    
    async def _plan_interaction_capture(self, task: str, context: Dict[str, Any]) -> Dict[str, Any]:
        """Plan interaction capture"""
        return {
            'approach': 'capture_interaction',
            'interaction_data': context.get('interaction_data', {}),
            'capture_metadata': True,
            'extract_patterns': True
        }
    
    async def _plan_pattern_detection(self, task: str, context: Dict[str, Any]) -> Dict[str, Any]:
        """Plan pattern detection"""
        pattern_types = self._extract_pattern_types(task)
        
        return {
            'approach': 'detect_patterns',
            'pattern_types': pattern_types,
            'time_window': context.get('time_window', self.learning_window_days),
            'confidence_threshold': context.get('confidence_threshold', self.pattern_confidence_threshold)
        }
    
    async def _plan_behavior_adaptation(self, task: str, context: Dict[str, Any]) -> Dict[str, Any]:
        """Plan behavior adaptation"""
        return {
            'approach': 'adapt_behavior',
            'adaptation_targets': self._extract_adaptation_targets(task),
            'use_patterns': True,
            'validate_changes': True
        }
    
    async def _plan_prediction(self, task: str, context: Dict[str, Any]) -> Dict[str, Any]:
        """Plan prediction"""
        return {
            'approach': 'predict_next',
            'prediction_type': self._extract_prediction_type(task),
            'context_window': context.get('context_window', 10),
            'use_patterns': True
        }
    
    async def _plan_learning_analysis(self, task: str, context: Dict[str, Any]) -> Dict[str, Any]:
        """Plan learning analysis"""
        return {
            'approach': 'analyze_learning',
            'analysis_scope': self._extract_analysis_scope(task),
            'include_recommendations': True,
            'time_range': context.get('time_range', 'last_30_days')
        }
    
    async def _execute_interaction_capture(self, state: AgentState) -> Dict[str, Any]:
        """Execute interaction capture"""
        context = state.context
        interaction_data = context.get('interaction_data', {})
        
        try:
            # Create interaction event
            event = InteractionEvent(
                timestamp=datetime.now(),
                event_type=interaction_data.get('type', 'general'),
                user_input=interaction_data.get('user_input', ''),
                agent_response=interaction_data.get('agent_response', ''),
                context=interaction_data.get('context', {}),
                success=interaction_data.get('success', True),
                feedback=interaction_data.get('feedback'),
                metadata=interaction_data.get('metadata', {})
            )
            
            # Add to history
            self.interaction_history.append(event)
            
            # Update statistics
            self.learning_stats['interactions_processed'] += 1
            
            # Extract immediate patterns if requested
            patterns_found = []
            if context.get('extract_patterns', False):
                patterns_found = await self._extract_immediate_patterns(event)
            
            # Maintain history size
            await self._maintain_history_size()
            
            return {
                'success': True,
                'result': {
                    'event_captured': True,
                    'patterns_extracted': len(patterns_found),
                    'immediate_patterns': patterns_found
                },
                'message': f"Captured interaction event with {len(patterns_found)} immediate patterns",
                'tools_used': ['interaction_capture', 'pattern_extraction']
            }
            
        except Exception as e:
            return {
                'success': False,
                'error': f"Interaction capture failed: {str(e)}",
                'tools_used': ['interaction_capture']
            }
    
    async def _execute_pattern_detection(self, state: AgentState) -> Dict[str, Any]:
        """Execute pattern detection"""
        context = state.context
        pattern_types = context.get('pattern_types', list(self.pattern_detectors.keys()))
        time_window = context.get('time_window', self.learning_window_days)
        confidence_threshold = context.get('confidence_threshold', self.pattern_confidence_threshold)
        
        # Get relevant interactions
        cutoff_date = datetime.now() - timedelta(days=time_window)
        relevant_interactions = [
            event for event in self.interaction_history
            if event.timestamp >= cutoff_date
        ]
        
        detected_patterns = {}
        
        for pattern_type in pattern_types:
            if pattern_type in self.pattern_detectors:
                try:
                    patterns = await self.pattern_detectors[pattern_type](
                        relevant_interactions,
                        confidence_threshold
                    )
                    detected_patterns[pattern_type] = patterns
                    
                    # Store high-confidence patterns
                    for pattern in patterns:
                        if pattern.confidence >= confidence_threshold:
                            self.patterns[pattern.pattern_id] = pattern
                            self.learning_stats['patterns_learned'] += 1
                            
                except Exception as e:
                    detected_patterns[pattern_type] = {'error': str(e)}
        
        # Generate insights
        insights = await self._generate_pattern_insights(detected_patterns)
        
        return {
            'success': True,
            'result': {
                'detected_patterns': detected_patterns,
                'total_patterns': sum(len(p) for p in detected_patterns.values() if isinstance(p, list)),
                'high_confidence_patterns': len([p for patterns in detected_patterns.values() 
                                               if isinstance(patterns, list) 
                                               for p in patterns if p.confidence >= confidence_threshold]),
                'insights': insights
            },
            'message': f"Detected patterns across {len(pattern_types)} pattern types",
            'tools_used': ['pattern_detection', 'insight_generation']
        }
    
    async def _execute_behavior_adaptation(self, state: AgentState) -> Dict[str, Any]:
        """Execute behavior adaptation based on learned patterns"""
        context = state.context
        adaptation_targets = context.get('adaptation_targets', [])
        
        adaptations_made = []
        
        for target in adaptation_targets:
            try:
                # Find relevant patterns for adaptation
                relevant_patterns = self._find_relevant_patterns(target)
                
                if relevant_patterns:
                    # Generate adaptation strategy
                    adaptation_strategy = await self._generate_adaptation_strategy(
                        target, relevant_patterns
                    )
                    
                    # Apply adaptation
                    if adaptation_strategy and context.get('validate_changes', True):
                        validation_result = await self._validate_adaptation(adaptation_strategy)
                        
                        if validation_result['valid']:
                            await self._apply_adaptation(adaptation_strategy)
                            adaptations_made.append({
                                'target': target,
                                'strategy': adaptation_strategy,
                                'patterns_used': len(relevant_patterns)
                            })
                            self.learning_stats['adaptation_count'] += 1
                        else:
                            adaptations_made.append({
                                'target': target,
                                'error': f"Validation failed: {validation_result['reason']}"
                            })
                    else:
                        adaptations_made.append({
                            'target': target,
                            'strategy': adaptation_strategy,
                            'status': 'planned_not_applied'
                        })
                else:
                    adaptations_made.append({
                        'target': target,
                        'error': 'No relevant patterns found'
                    })
                    
            except Exception as e:
                adaptations_made.append({
                    'target': target,
                    'error': str(e)
                })
        
        successful_adaptations = [a for a in adaptations_made if 'error' not in a]
        
        return {
            'success': True,
            'result': {
                'adaptations': adaptations_made,
                'successful_adaptations': len(successful_adaptations),
                'total_targets': len(adaptation_targets)
            },
            'message': f"Applied {len(successful_adaptations)} behavioral adaptations",
            'tools_used': ['pattern_matching', 'adaptation_strategy', 'validation']
        }
    
    async def _execute_prediction(self, state: AgentState) -> Dict[str, Any]:
        """Execute prediction based on patterns"""
        context = state.context
        prediction_type = context.get('prediction_type', 'next_action')
        context_window = context.get('context_window', 10)
        
        # Get recent context
        recent_interactions = self.interaction_history[-context_window:]
        
        predictions = {}
        
        try:
            if prediction_type == 'next_action':
                predictions = await self._predict_next_action(recent_interactions)
            elif prediction_type == 'user_intent':
                predictions = await self._predict_user_intent(recent_interactions)
            elif prediction_type == 'success_probability':
                predictions = await self._predict_success_probability(recent_interactions)
            elif prediction_type == 'optimal_response':
                predictions = await self._predict_optimal_response(recent_interactions)
            else:
                predictions = await self._predict_general(recent_interactions, prediction_type)
            
            # Validate predictions against patterns
            validation = await self._validate_predictions(predictions)
            
            return {
                'success': True,
                'result': {
                    'predictions': predictions,
                    'prediction_type': prediction_type,
                    'confidence': validation.get('confidence', 0.0),
                    'validation': validation
                },
                'message': f"Generated {prediction_type} predictions",
                'tools_used': ['prediction_engine', 'pattern_matching']
            }
            
        except Exception as e:
            return {
                'success': False,
                'error': f"Prediction failed: {str(e)}",
                'tools_used': ['prediction_engine']
            }
    
    async def _execute_learning_analysis(self, state: AgentState) -> Dict[str, Any]:
        """Execute learning analysis"""
        context = state.context
        analysis_scope = context.get('analysis_scope', 'comprehensive')
        time_range = context.get('time_range', 'last_30_days')
        
        # Determine analysis period
        if time_range == 'last_30_days':
            cutoff_date = datetime.now() - timedelta(days=30)
        elif time_range == 'last_7_days':
            cutoff_date = datetime.now() - timedelta(days=7)
        else:
            cutoff_date = datetime.now() - timedelta(days=365)  # Last year
        
        # Filter interactions
        relevant_interactions = [
            event for event in self.interaction_history
            if event.timestamp >= cutoff_date
        ]
        
        analysis = {}
        
        if analysis_scope in ['comprehensive', 'patterns']:
            analysis['pattern_analysis'] = await self._analyze_patterns()
        
        if analysis_scope in ['comprehensive', 'performance']:
            analysis['performance_analysis'] = await self._analyze_learning_performance(relevant_interactions)
        
        if analysis_scope in ['comprehensive', 'trends']:
            analysis['trend_analysis'] = await self._analyze_learning_trends(relevant_interactions)
        
        if analysis_scope in ['comprehensive', 'effectiveness']:
            analysis['effectiveness_analysis'] = await self._analyze_learning_effectiveness()
        
        # Generate recommendations
        recommendations = []
        if context.get('include_recommendations', True):
            recommendations = await self._generate_learning_recommendations(analysis)
        
        return {
            'success': True,
            'result': {
                'analysis': analysis,
                'recommendations': recommendations,
                'analysis_period': time_range,
                'interactions_analyzed': len(relevant_interactions),
                'summary': await self._generate_analysis_summary(analysis)
            },
            'message': f"Completed {analysis_scope} learning analysis",
            'tools_used': ['learning_analysis', 'recommendation_engine']
        }
    
    async def _execute_general_learning(self, state: AgentState) -> Dict[str, Any]:
        """Execute general learning task"""
        task = state.current_task
        
        # Use LLM to understand and respond to learning task
        prompt = SystemMessage(content=f"""
        You are a learning specialist AI. Help with this learning-related task:
        {task}
        
        Consider:
        - Pattern recognition techniques
        - Learning from interactions
        - Behavioral adaptation
        - Predictive modeling
        
        Provide specific, actionable recommendations.
        """)
        
        try:
            response = await self.llm_manager.agenerate([prompt])
            
            return {
                'success': True,
                'result': response.text,
                'message': "Completed general learning task",
                'tools_used': ['llm_learning_advice']
            }
            
        except Exception as e:
            return {
                'success': False,
                'error': str(e),
                'tools_used': ['llm_learning_advice']
            }
    
    async def _detect_behavioral_patterns(self, interactions: List[InteractionEvent], confidence_threshold: float) -> List[LearningPattern]:
        """Detect behavioral patterns in interactions"""
        patterns = []
        
        # Group interactions by user behavior indicators
        behavior_groups = defaultdict(list)
        
        for interaction in interactions:
            # Extract behavioral indicators
            indicators = self._extract_behavioral_indicators(interaction)
            for indicator in indicators:
                behavior_groups[indicator].append(interaction)
        
        # Find patterns in behavior groups
        for behavior, events in behavior_groups.items():
            if len(events) >= self.min_pattern_frequency:
                # Calculate confidence based on frequency and consistency
                confidence = min(len(events) / len(interactions), 1.0) * 0.8  # Max 0.8 for behavioral
                
                if confidence >= confidence_threshold:
                    pattern = LearningPattern(
                        pattern_id=f"behavioral_{behavior}_{len(patterns)}",
                        pattern_type="behavioral",
                        description=f"User exhibits {behavior} behavior",
                        confidence=confidence,
                        frequency=len(events),
                        last_seen=max(e.timestamp for e in events),
                        context={'behavior_type': behavior},
                        examples=[self._interaction_to_example(e) for e in events[:5]]
                    )
                    patterns.append(pattern)
        
        return patterns
    
    async def _detect_semantic_patterns(self, interactions: List[InteractionEvent], confidence_threshold: float) -> List[LearningPattern]:
        """Detect semantic patterns in user language"""
        patterns = []
        
        # Extract semantic features
        semantic_features = defaultdict(list)
        
        for interaction in interactions:
            features = await self._extract_semantic_features(interaction.user_input)
            for feature, value in features.items():
                semantic_features[feature].append((interaction, value))
        
        # Find semantic patterns
        for feature, feature_data in semantic_features.items():
            if len(feature_data) >= self.min_pattern_frequency:
                # Analyze semantic consistency
                values = [value for _, value in feature_data]
                consistency = self._calculate_semantic_consistency(values)
                
                confidence = consistency * 0.9  # Higher confidence for semantic patterns
                
                if confidence >= confidence_threshold:
                    pattern = LearningPattern(
                        pattern_id=f"semantic_{feature}_{len(patterns)}",
                        pattern_type="semantic",
                        description=f"Consistent semantic pattern in {feature}",
                        confidence=confidence,
                        frequency=len(feature_data),
                        last_seen=max(interaction.timestamp for interaction, _ in feature_data),
                        context={'semantic_feature': feature, 'consistency': consistency},
                        examples=[self._interaction_to_example(interaction) for interaction, _ in feature_data[:5]]
                    )
                    patterns.append(pattern)
        
        return patterns
    
    async def _detect_temporal_patterns(self, interactions: List[InteractionEvent], confidence_threshold: float) -> List[LearningPattern]:
        """Detect temporal patterns in interactions"""
        patterns = []
        
        # Group by time patterns (hour of day, day of week, etc.)
        temporal_groups = {
            'hour_of_day': defaultdict(list),
            'day_of_week': defaultdict(list),
            'time_between_interactions': []
        }
        
        for i, interaction in enumerate(interactions):
            # Hour of day pattern
            hour = interaction.timestamp.hour
            temporal_groups['hour_of_day'][hour].append(interaction)
            
            # Day of week pattern
            day_of_week = interaction.timestamp.weekday()
            temporal_groups['day_of_week'][day_of_week].append(interaction)
            
            # Time between interactions
            if i > 0:
                time_diff = interaction.timestamp - interactions[i-1].timestamp
                temporal_groups['time_between_interactions'].append(time_diff.total_seconds())
        
        # Analyze hour of day patterns
        for hour, events in temporal_groups['hour_of_day'].items():
            if len(events) >= self.min_pattern_frequency:
                total_interactions = len(interactions)
                expected_per_hour = total_interactions / 24
                actual_count = len(events)
                
                # Calculate significance
                if actual_count > expected_per_hour * 1.5:  # 50% above average
                    confidence = min((actual_count / expected_per_hour) / 3, 1.0) * 0.7
                    
                    if confidence >= confidence_threshold:
                        pattern = LearningPattern(
                            pattern_id=f"temporal_hour_{hour}_{len(patterns)}",
                            pattern_type="temporal",
                            description=f"High activity during hour {hour}",
                            confidence=confidence,
                            frequency=actual_count,
                            last_seen=max(e.timestamp for e in events),
                            context={'temporal_type': 'hour_of_day', 'hour': hour},
                            examples=[self._interaction_to_example(e) for e in events[:5]]
                        )
                        patterns.append(pattern)
        
        # Analyze time between interactions
        if len(temporal_groups['time_between_interactions']) >= self.min_pattern_frequency:
            intervals = temporal_groups['time_between_interactions']
            avg_interval = sum(intervals) / len(intervals)
            interval_consistency = self._calculate_interval_consistency(intervals)
            
            if interval_consistency > 0.6:  # 60% consistency
                confidence = interval_consistency * 0.6  # Lower confidence for timing
                
                if confidence >= confidence_threshold:
                    pattern = LearningPattern(
                        pattern_id=f"temporal_interval_{len(patterns)}",
                        pattern_type="temporal",
                        description=f"Consistent interaction intervals (~{avg_interval/60:.1f} minutes)",
                        confidence=confidence,
                        frequency=len(intervals),
                        last_seen=interactions[-1].timestamp,
                        context={
                            'temporal_type': 'interaction_interval',
                            'avg_interval_seconds': avg_interval,
                            'consistency': interval_consistency
                        },
                        examples=[]
                    )
                    patterns.append(pattern)
        
        return patterns
    
    async def _detect_causal_patterns(self, interactions: List[InteractionEvent], confidence_threshold: float) -> List[LearningPattern]:
        """Detect causal patterns between user actions and outcomes"""
        patterns = []
        
        # Look for action -> outcome sequences
        for i in range(len(interactions) - 1):
            current_interaction = interactions[i]
            next_interaction = interactions[i + 1]
            
            # Extract potential causal relationships
            action_features = self._extract_action_features(current_interaction)
            outcome_features = self._extract_outcome_features(next_interaction)
            
            # Find similar action->outcome pairs
            similar_pairs = []
            for j in range(len(interactions) - 1):
                if j == i:
                    continue
                
                action_j = self._extract_action_features(interactions[j])
                outcome_j = self._extract_outcome_features(interactions[j + 1])
                
                action_similarity = self._calculate_feature_similarity(action_features, action_j)
                outcome_similarity = self._calculate_feature_similarity(outcome_features, outcome_j)
                
                if action_similarity > 0.7 and outcome_similarity > 0.7:
                    similar_pairs.append((interactions[j], interactions[j + 1]))
            
            # If we found enough similar pairs, create a causal pattern
            if len(similar_pairs) >= self.min_pattern_frequency - 1:  # -1 because we have the original pair
                confidence = min(len(similar_pairs) / (len(interactions) / 2), 1.0) * 0.8
                
                if confidence >= confidence_threshold:
                    pattern = LearningPattern(
                        pattern_id=f"causal_{len(patterns)}",
                        pattern_type="causal",
                        description=f"Causal pattern: {action_features.get('summary', 'action')} leads to {outcome_features.get('summary', 'outcome')}",
                        confidence=confidence,
                        frequency=len(similar_pairs) + 1,
                        last_seen=max(pair[1].timestamp for pair in similar_pairs + [(current_interaction, next_interaction)]),
                        context={
                            'action_features': action_features,
                            'outcome_features': outcome_features
                        },
                        examples=[self._pair_to_example(pair[0], pair[1]) for pair in similar_pairs[:3]]
                    )
                    patterns.append(pattern)
        
        return patterns
    
    def _extract_behavioral_indicators(self, interaction: InteractionEvent) -> List[str]:
        """Extract behavioral indicators from interaction"""
        indicators = []
        
        user_input = interaction.user_input.lower()
        
        # Length-based indicators
        if len(user_input) < 10:
            indicators.append('brief_communication')
        elif len(user_input) > 100:
            indicators.append('detailed_communication')
        
        # Politeness indicators
        if any(word in user_input for word in ['please', 'thank you', 'thanks', 'sorry']):
            indicators.append('polite')
        
        # Urgency indicators
        if any(word in user_input for word in ['urgent', 'asap', 'quickly', 'fast', '!!!']):
            indicators.append('urgent')
        
        # Question vs statement
        if '?' in user_input:
            indicators.append('questioning')
        else:
            indicators.append('instructional')
        
        # Technical level
        technical_words = ['api', 'database', 'function', 'algorithm', 'code', 'debug', 'error']
        if any(word in user_input for word in technical_words):
            indicators.append('technical')
        
        return indicators
    
    async def _extract_semantic_features(self, text: str) -> Dict[str, Any]:
        """Extract semantic features from text"""
        features = {}
        
        # Basic linguistic features
        features['word_count'] = len(text.split())
        features['sentence_count'] = text.count('.') + text.count('!') + text.count('?')
        features['avg_word_length'] = sum(len(word) for word in text.split()) / max(len(text.split()), 1)
        
        # Sentiment indicators
        positive_words = ['good', 'great', 'excellent', 'perfect', 'love', 'like']
        negative_words = ['bad', 'terrible', 'hate', 'wrong', 'error', 'problem']
        
        positive_count = sum(1 for word in positive_words if word in text.lower())
        negative_count = sum(1 for word in negative_words if word in text.lower())
        
        features['sentiment_score'] = positive_count - negative_count
        
        # Complexity indicators
        complex_words = [word for word in text.split() if len(word) > 7]
        features['complexity_score'] = len(complex_words) / max(len(text.split()), 1)
        
        return features
    
    def _calculate_semantic_consistency(self, values: List[Any]) -> float:
        """Calculate consistency in semantic values"""
        if not values or len(values) < 2:
            return 0.0
        
        # For numeric values, calculate coefficient of variation
        if all(isinstance(v, (int, float)) for v in values):
            mean_val = sum(values) / len(values)
            if mean_val == 0:
                return 1.0 if all(v == 0 for v in values) else 0.0
            
            variance = sum((v - mean_val) ** 2 for v in values) / len(values)
            std_dev = variance ** 0.5
            cv = std_dev / abs(mean_val)
            
            # Convert coefficient of variation to consistency (0-1)
            return max(0.0, 1.0 - cv)
        
        # For categorical values, calculate mode frequency
        from collections import Counter
        counter = Counter(values)
        most_common_freq = counter.most_common(1)[0][1]
        return most_common_freq / len(values)
    
    def _calculate_interval_consistency(self, intervals: List[float]) -> float:
        """Calculate consistency in time intervals"""
        if len(intervals) < 2:
            return 0.0
        
        mean_interval = sum(intervals) / len(intervals)
        if mean_interval == 0:
            return 1.0 if all(i == 0 for i in intervals) else 0.0
        
        # Calculate normalized standard deviation
        variance = sum((interval - mean_interval) ** 2 for interval in intervals) / len(intervals)
        std_dev = variance ** 0.5
        normalized_std = std_dev / mean_interval
        
        # Convert to consistency score (0-1)
        return max(0.0, 1.0 - normalized_std)
    
    def _extract_action_features(self, interaction: InteractionEvent) -> Dict[str, Any]:
        """Extract features that represent an action"""
        features = {
            'input_length': len(interaction.user_input),
            'event_type': interaction.event_type,
            'has_question': '?' in interaction.user_input,
            'word_count': len(interaction.user_input.split()),
            'summary': interaction.user_input[:50] + '...' if len(interaction.user_input) > 50 else interaction.user_input
        }
        
        # Extract keywords
        words = interaction.user_input.lower().split()
        action_words = ['create', 'delete', 'update', 'get', 'find', 'search', 'analyze', 'generate']
        features['action_words'] = [word for word in words if word in action_words]
        
        return features
    
    def _extract_outcome_features(self, interaction: InteractionEvent) -> Dict[str, Any]:
        """Extract features that represent an outcome"""
        features = {
            'success': interaction.success,
            'response_length': len(interaction.agent_response),
            'event_type': interaction.event_type,
            'has_feedback': interaction.feedback is not None,
            'summary': interaction.agent_response[:50] + '...' if len(interaction.agent_response) > 50 else interaction.agent_response
        }
        
        return features
    
    def _calculate_feature_similarity(self, features1: Dict[str, Any], features2: Dict[str, Any]) -> float:
        """Calculate similarity between feature sets"""
        common_keys = set(features1.keys()) & set(features2.keys())
        if not common_keys:
            return 0.0
        
        similarities = []
        
        for key in common_keys:
            val1, val2 = features1[key], features2[key]
            
            if isinstance(val1, bool) and isinstance(val2, bool):
                similarities.append(1.0 if val1 == val2 else 0.0)
            elif isinstance(val1, (int, float)) and isinstance(val2, (int, float)):
                if val1 == 0 and val2 == 0:
                    similarities.append(1.0)
                elif val1 == 0 or val2 == 0:
                    similarities.append(0.0)
                else:
                    similarities.append(1.0 - abs(val1 - val2) / max(abs(val1), abs(val2)))
            elif isinstance(val1, str) and isinstance(val2, str):
                # Simple string similarity
                common_words = set(val1.lower().split()) & set(val2.lower().split())
                total_words = set(val1.lower().split()) | set(val2.lower().split())
                similarities.append(len(common_words) / max(len(total_words), 1))
            elif isinstance(val1, list) and isinstance(val2, list):
                common_items = set(val1) & set(val2)
                total_items = set(val1) | set(val2)
                similarities.append(len(common_items) / max(len(total_items), 1))
            else:
                similarities.append(1.0 if val1 == val2 else 0.0)
        
        return sum(similarities) / len(similarities)
    
    def _interaction_to_example(self, interaction: InteractionEvent) -> Dict[str, Any]:
        """Convert interaction to example format"""
        return {
            'timestamp': interaction.timestamp.isoformat(),
            'user_input': interaction.user_input[:100] + '...' if len(interaction.user_input) > 100 else interaction.user_input,
            'agent_response': interaction.agent_response[:100] + '...' if len(interaction.agent_response) > 100 else interaction.agent_response,
            'success': interaction.success,
            'event_type': interaction.event_type
        }
    
    def _pair_to_example(self, action_interaction: InteractionEvent, outcome_interaction: InteractionEvent) -> Dict[str, Any]:
        """Convert interaction pair to example format"""
        return {
            'action': self._interaction_to_example(action_interaction),
            'outcome': self._interaction_to_example(outcome_interaction),
            'time_gap_seconds': (outcome_interaction.timestamp - action_interaction.timestamp).total_seconds()
        }
    
    # Additional helper methods for the remaining functionality
    async def _extract_immediate_patterns(self, event: InteractionEvent) -> List[Dict[str, Any]]:
        """Extract immediate patterns from a single event"""
        patterns = []
        
        # Look for patterns with recent events
        recent_events = self.interaction_history[-10:] if len(self.interaction_history) > 10 else self.interaction_history
        
        # Simple pattern: similar events
        similar_events = [
            e for e in recent_events 
            if e.event_type == event.event_type and 
            len(set(e.user_input.lower().split()) & set(event.user_input.lower().split())) > 2
        ]
        
        if len(similar_events) >= 2:
            patterns.append({
                'type': 'similar_events',
                'count': len(similar_events),
                'pattern': f"Similar {event.event_type} events"
            })
        
        return patterns
    
    async def _maintain_history_size(self):
        """Maintain interaction history size"""
        max_history_size = self.config.get('max_history_size', 10000)
        
        if len(self.interaction_history) > max_history_size:
            # Keep recent interactions and high-value ones
            cutoff_index = len(self.interaction_history) - int(max_history_size * 0.8)
            
            # Prioritize successful interactions and those with feedback
            high_value_interactions = [
                i for i in self.interaction_history[:cutoff_index]
                if i.success and (i.feedback is not None or i.metadata.get('important', False))
            ]
            
            recent_interactions = self.interaction_history[cutoff_index:]
            
            self.interaction_history = high_value_interactions[-int(max_history_size * 0.2):] + recent_interactions
    
    def _extract_pattern_types(self, task: str) -> List[str]:
        """Extract pattern types from task description"""
        task_lower = task.lower()
        pattern_types = []
        
        if 'behavioral' in task_lower or 'behavior' in task_lower:
            pattern_types.append('behavioral')
        if 'semantic' in task_lower or 'language' in task_lower or 'meaning' in task_lower:
            pattern_types.append('semantic')
        if 'temporal' in task_lower or 'time' in task_lower or 'timing' in task_lower:
            pattern_types.append('temporal')
        if 'causal' in task_lower or 'cause' in task_lower or 'effect' in task_lower:
            pattern_types.append('causal')
        
        return pattern_types if pattern_types else list(self.pattern_detectors.keys())
    
    def _extract_adaptation_targets(self, task: str) -> List[str]:
        """Extract adaptation targets from task"""
        targets = []
        
        # Look for specific targets in the task
        if 'response' in task.lower():
            targets.append('response_style')
        if 'timing' in task.lower():
            targets.append('response_timing')
        if 'accuracy' in task.lower():
            targets.append('prediction_accuracy')
        if 'personalization' in task.lower():
            targets.append('personalization')
        
        return targets if targets else ['general_behavior']
    
    def _extract_prediction_type(self, task: str) -> str:
        """Extract prediction type from task"""
        task_lower = task.lower()
        
        if 'action' in task_lower or 'next' in task_lower:
            return 'next_action'
        elif 'intent' in task_lower:
            return 'user_intent'
        elif 'success' in task_lower or 'probability' in task_lower:
            return 'success_probability'
        elif 'response' in task_lower:
            return 'optimal_response'
        else:
            return 'general'
    
    def _extract_analysis_scope(self, task: str) -> str:
        """Extract analysis scope from task"""
        task_lower = task.lower()
        
        if 'pattern' in task_lower:
            return 'patterns'
        elif 'performance' in task_lower:
            return 'performance'
        elif 'trend' in task_lower:
            return 'trends'
        elif 'effectiveness' in task_lower:
            return 'effectiveness'
        else:
            return 'comprehensive'
    
    def _find_relevant_patterns(self, target: str) -> List[LearningPattern]:
        """Find patterns relevant to adaptation target"""
        relevant_patterns = []
        
        for pattern in self.patterns.values():
            # Check if pattern is relevant to target
            if target in pattern.description.lower() or target in str(pattern.context).lower():
                relevant_patterns.append(pattern)
        
        # Sort by confidence and recency
        relevant_patterns.sort(key=lambda p: (p.confidence, p.last_seen), reverse=True)
        
        return relevant_patterns[:10]  # Top 10 most relevant patterns
    
    async def _generate_adaptation_strategy(self, target: str, patterns: List[LearningPattern]) -> Dict[str, Any]:
        """Generate adaptation strategy based on patterns"""
        strategy = {
            'target': target,
            'adaptations': [],
            'confidence': 0.0,
            'rationale': []
        }
        
        # Analyze patterns to create adaptations
        for pattern in patterns:
            if pattern.pattern_type == 'behavioral':
                if target == 'response_style':
                    strategy['adaptations'].append({
                        'type': 'response_style',
                        'change': f"Adapt to {pattern.context.get('behavior_type', 'user')} behavior pattern",
                        'pattern_confidence': pattern.confidence
                    })
            elif pattern.pattern_type == 'temporal':
                if target == 'response_timing':
                    strategy['adaptations'].append({
                        'type': 'response_timing',
                        'change': f"Optimize timing based on {pattern.description}",
                        'pattern_confidence': pattern.confidence
                    })
        
        if strategy['adaptations']:
            strategy['confidence'] = sum(a['pattern_confidence'] for a in strategy['adaptations']) / len(strategy['adaptations'])
            strategy['rationale'] = [f"Based on pattern: {p.description}" for p in patterns[:3]]
        
        return strategy
    
    async def _validate_adaptation(self, strategy: Dict[str, Any]) -> Dict[str, Any]:
        """Validate adaptation strategy"""
        # Simple validation - in practice, this would be more sophisticated
        if strategy['confidence'] > 0.5 and len(strategy['adaptations']) > 0:
            return {'valid': True, 'confidence': strategy['confidence']}
        else:
            return {'valid': False, 'reason': 'Low confidence or no adaptations'}
    
    async def _apply_adaptation(self, strategy: Dict[str, Any]):
        """Apply adaptation strategy"""
        # In a real implementation, this would modify agent behavior
        # For now, we just log the adaptation
        self.learning_stats['adaptation_count'] += 1
    
    # Prediction methods
    async def _predict_next_action(self, recent_interactions: List[InteractionEvent]) -> Dict[str, Any]:
        """Predict the next likely user action"""
        if not recent_interactions:
            return {'prediction': 'unknown', 'confidence': 0.0}
        
        # Find similar sequences in history
        similar_sequences = self._find_similar_sequences(recent_interactions)
        
        if similar_sequences:
            # Get the most common next action
            next_actions = [seq[-1].event_type for seq in similar_sequences if len(seq) > len(recent_interactions)]
            if next_actions:
                from collections import Counter
                most_common = Counter(next_actions).most_common(1)[0]
                return {
                    'prediction': most_common[0],
                    'confidence': most_common[1] / len(next_actions),
                    'supporting_sequences': len(similar_sequences)
                }
        
        return {'prediction': 'continue_conversation', 'confidence': 0.3}
    
    async def _predict_user_intent(self, recent_interactions: List[InteractionEvent]) -> Dict[str, Any]:
        """Predict user intent based on recent interactions"""
        if not recent_interactions:
            return {'intent': 'unknown', 'confidence': 0.0}
        
        latest_interaction = recent_interactions[-1]
        
        # Simple intent classification based on keywords
        user_input = latest_interaction.user_input.lower()
        
        intent_keywords = {
            'information_seeking': ['what', 'how', 'why', 'when', 'where', 'explain', 'tell me'],
            'task_completion': ['create', 'make', 'generate', 'build', 'do', 'help me'],
            'problem_solving': ['error', 'problem', 'issue', 'bug', 'fix', 'help'],
            'exploration': ['show', 'list', 'find', 'search', 'browse', 'explore']
        }
        
        intent_scores = {}
        for intent, keywords in intent_keywords.items():
            score = sum(1 for keyword in keywords if keyword in user_input)
            if score > 0:
                intent_scores[intent] = score / len(keywords)
        
        if intent_scores:
            best_intent = max(intent_scores.items(), key=lambda x: x[1])
            return {
                'intent': best_intent[0],
                'confidence': min(best_intent[1], 0.8),
                'alternative_intents': sorted(intent_scores.items(), key=lambda x: x[1], reverse=True)[1:3]
            }
        
        return {'intent': 'general_conversation', 'confidence': 0.4}
    
    async def _predict_success_probability(self, recent_interactions: List[InteractionEvent]) -> Dict[str, Any]:
        """Predict probability of successful interaction"""
        if not recent_interactions:
            return {'success_probability': 0.5, 'confidence': 0.0}
        
        # Calculate success rate from recent similar interactions
        similar_interactions = self._find_similar_interactions(recent_interactions[-1])
        
        if similar_interactions:
            success_rate = sum(1 for i in similar_interactions if i.success) / len(similar_interactions)
            confidence = min(len(similar_interactions) / 10, 1.0)  # Max confidence with 10+ similar interactions
            
            return {
                'success_probability': success_rate,
                'confidence': confidence,
                'similar_interactions': len(similar_interactions)
            }
        
        # Fall back to overall success rate
        all_interactions = self.interaction_history
        if all_interactions:
            overall_success_rate = sum(1 for i in all_interactions if i.success) / len(all_interactions)
            return {
                'success_probability': overall_success_rate,
                'confidence': 0.3,
                'fallback_to_overall': True
            }
        
        return {'success_probability': 0.5, 'confidence': 0.0}
    
    async def _predict_optimal_response(self, recent_interactions: List[InteractionEvent]) -> Dict[str, Any]:
        """Predict optimal response characteristics"""
        if not recent_interactions:
            return {'optimal_response': 'standard', 'confidence': 0.0}
        
        latest_interaction = recent_interactions[-1]
        
        # Find successful similar interactions
        similar_successful = [
            i for i in self.interaction_history 
            if i.success and self._calculate_interaction_similarity(latest_interaction, i) > 0.6
        ]
        
        if similar_successful:
            # Analyze characteristics of successful responses
            response_lengths = [len(i.agent_response) for i in similar_successful]
            avg_length = sum(response_lengths) / len(response_lengths)
            
            response_style = 'detailed' if avg_length > 200 else 'concise'
            
            return {
                'optimal_response': response_style,
                'recommended_length': int(avg_length),
                'confidence': min(len(similar_successful) / 5, 0.8),
                'based_on_interactions': len(similar_successful)
            }
        
        return {'optimal_response': 'standard', 'confidence': 0.3}
    
    async def _predict_general(self, recent_interactions: List[InteractionEvent], prediction_type: str) -> Dict[str, Any]:
        """Handle general prediction requests"""
        return {
            'prediction_type': prediction_type,
            'result': f'General prediction for {prediction_type}',
            'confidence': 0.4,
            'note': 'This is a general prediction - more specific prediction types are available'
        }
    
    def _find_similar_sequences(self, recent_interactions: List[InteractionEvent]) -> List[List[InteractionEvent]]:
        """Find similar interaction sequences in history"""
        similar_sequences = []
        sequence_length = len(recent_interactions)
        
        # Look for similar sequences in history
        for i in range(len(self.interaction_history) - sequence_length):
            historical_sequence = self.interaction_history[i:i + sequence_length]
            
            # Calculate sequence similarity
            similarity = self._calculate_sequence_similarity(recent_interactions, historical_sequence)
            
            if similarity > 0.6:  # 60% similarity threshold
                # Include the next interaction if available
                if i + sequence_length < len(self.interaction_history):
                    extended_sequence = self.interaction_history[i:i + sequence_length + 1]
                    similar_sequences.append(extended_sequence)
        
        return similar_sequences
    
    def _find_similar_interactions(self, interaction: InteractionEvent) -> List[InteractionEvent]:
        """Find similar interactions in history"""
        similar = []
        
        for hist_interaction in self.interaction_history:
            if hist_interaction != interaction:
                similarity = self._calculate_interaction_similarity(interaction, hist_interaction)
                if similarity > 0.6:
                    similar.append(hist_interaction)
        
        return similar
    
    def _calculate_interaction_similarity(self, interaction1: InteractionEvent, interaction2: InteractionEvent) -> float:
        """Calculate similarity between two interactions"""
        # Event type similarity
        event_type_sim = 1.0 if interaction1.event_type == interaction2.event_type else 0.0
        
        # Text similarity (simple word overlap)
        words1 = set(interaction1.user_input.lower().split())
        words2 = set(interaction2.user_input.lower().split())
        
        if not words1 and not words2:
            text_sim = 1.0
        elif not words1 or not words2:
            text_sim = 0.0
        else:
            text_sim = len(words1 & words2) / len(words1 | words2)
        
        # Context similarity
        context1 = interaction1.context
        context2 = interaction2.context
        context_sim = self._calculate_context_similarity(context1, context2)
        
        # Weighted average
        return (event_type_sim * 0.4 + text_sim * 0.4 + context_sim * 0.2)
    
    def _calculate_sequence_similarity(self, seq1: List[InteractionEvent], seq2: List[InteractionEvent]) -> float:
        """Calculate similarity between two interaction sequences"""
        if len(seq1) != len(seq2):
            return 0.0
        
        similarities = []
        for i1, i2 in zip(seq1, seq2):
            similarities.append(self._calculate_interaction_similarity(i1, i2))
        
        return sum(similarities) / len(similarities)
    
    def _calculate_context_similarity(self, context1: Dict[str, Any], context2: Dict[str, Any]) -> float:
        """Calculate similarity between context dictionaries"""
        if not context1 and not context2:
            return 1.0
        if not context1 or not context2:
            return 0.0
        
        common_keys = set(context1.keys()) & set(context2.keys())
        if not common_keys:
            return 0.0
        
        similarities = []
        for key in common_keys:
            val1, val2 = context1[key], context2[key]
            if val1 == val2:
                similarities.append(1.0)
            elif isinstance(val1, str) and isinstance(val2, str):
                # Simple string similarity
                words1 = set(val1.lower().split())
                words2 = set(val2.lower().split())
                if words1 or words2:
                    similarities.append(len(words1 & words2) / len(words1 | words2))
                else:
                    similarities.append(1.0)
            else:
                similarities.append(0.0)
        
        return sum(similarities) / len(similarities)
    
    async def _validate_predictions(self, predictions: Dict[str, Any]) -> Dict[str, Any]:
        """Validate predictions against known patterns"""
        validation = {
            'confidence': predictions.get('confidence', 0.0),
            'validation_score': 0.0,
            'supporting_patterns': []
        }
        
        # Find patterns that support the predictions
        for pattern in self.patterns.values():
            if self._pattern_supports_prediction(pattern, predictions):
                validation['supporting_patterns'].append(pattern.pattern_id)
        
        # Calculate validation score based on supporting patterns
        if validation['supporting_patterns']:
            validation['validation_score'] = min(len(validation['supporting_patterns']) / 3, 1.0)
        
        return validation
    
    def _pattern_supports_prediction(self, pattern: LearningPattern, predictions: Dict[str, Any]) -> bool:
        """Check if a pattern supports the predictions"""
        # Simple check - in practice this would be more sophisticated
        prediction_str = str(predictions).lower()
        pattern_str = (pattern.description + str(pattern.context)).lower()
        
        # Look for common terms
        prediction_words = set(prediction_str.split())
        pattern_words = set(pattern_str.split())
        
        common_words = prediction_words & pattern_words
        return len(common_words) > 0
    
    # Analysis methods
    async def _analyze_patterns(self) -> Dict[str, Any]:
        """Analyze current patterns"""
        analysis = {
            'total_patterns': len(self.patterns),
            'patterns_by_type': {},
            'high_confidence_patterns': 0,
            'recent_patterns': 0,
            'pattern_quality_distribution': {}
        }
        
        # Group patterns by type
        for pattern in self.patterns.values():
            pattern_type = pattern.pattern_type
            if pattern_type not in analysis['patterns_by_type']:
                analysis['patterns_by_type'][pattern_type] = 0
            analysis['patterns_by_type'][pattern_type] += 1
            
            # High confidence patterns
            if pattern.confidence > 0.8:
                analysis['high_confidence_patterns'] += 1
            
            # Recent patterns (last 7 days)
            if pattern.last_seen > datetime.now() - timedelta(days=7):
                analysis['recent_patterns'] += 1
        
        # Quality distribution
        confidence_ranges = [(0.0, 0.3), (0.3, 0.6), (0.6, 0.8), (0.8, 1.0)]
        for low, high in confidence_ranges:
            range_key = f"{low}-{high}"
            count = sum(1 for p in self.patterns.values() if low <= p.confidence < high)
            analysis['pattern_quality_distribution'][range_key] = count
        
        return analysis
    
    async def _analyze_learning_performance(self, interactions: List[InteractionEvent]) -> Dict[str, Any]:
        """Analyze learning performance metrics"""
        analysis = {
            'total_interactions': len(interactions),
            'success_rate': 0.0,
            'prediction_accuracy': 0.0,
            'adaptation_effectiveness': 0.0,
            'learning_trend': 'stable'
        }
        
        if interactions:
            # Success rate
            successful = sum(1 for i in interactions if i.success)
            analysis['success_rate'] = successful / len(interactions)
            
            # Calculate trends over time
            if len(interactions) > 10:
                # Split into first and second half
                mid_point = len(interactions) // 2
                first_half = interactions[:mid_point]
                second_half = interactions[mid_point:]
                
                first_half_success = sum(1 for i in first_half if i.success) / len(first_half)
                second_half_success = sum(1 for i in second_half if i.success) / len(second_half)
                
                if second_half_success > first_half_success + 0.1:
                    analysis['learning_trend'] = 'improving'
                elif second_half_success < first_half_success - 0.1:
                    analysis['learning_trend'] = 'declining'
        
        return analysis
    
    async def _analyze_learning_trends(self, interactions: List[InteractionEvent]) -> Dict[str, Any]:
        """Analyze learning trends over time"""
        analysis = {
            'interaction_frequency_trend': 'stable',
            'success_rate_trend': 'stable',
            'complexity_trend': 'stable',
            'user_satisfaction_trend': 'unknown'
        }
        
        if len(interactions) < 10:
            return analysis
        
        # Group interactions by day
        from collections import defaultdict
        daily_interactions = defaultdict(list)
        
        for interaction in interactions:
            date_key = interaction.timestamp.date()
            daily_interactions[date_key].append(interaction)
        
        # Calculate daily metrics
        daily_metrics = {}
        for date, day_interactions in daily_interactions.items():
            daily_metrics[date] = {
                'count': len(day_interactions),
                'success_rate': sum(1 for i in day_interactions if i.success) / len(day_interactions),
                'avg_complexity': sum(len(i.user_input.split()) for i in day_interactions) / len(day_interactions)
            }
        
        # Analyze trends
        if len(daily_metrics) >= 5:
            dates = sorted(daily_metrics.keys())
            first_half = dates[:len(dates)//2]
            second_half = dates[len(dates)//2:]
            
            # Interaction frequency trend
            first_half_avg = sum(daily_metrics[d]['count'] for d in first_half) / len(first_half)
            second_half_avg = sum(daily_metrics[d]['count'] for d in second_half) / len(second_half)
            
            if second_half_avg > first_half_avg * 1.2:
                analysis['interaction_frequency_trend'] = 'increasing'
            elif second_half_avg < first_half_avg * 0.8:
                analysis['interaction_frequency_trend'] = 'decreasing'
        
        return analysis
    
    async def _analyze_learning_effectiveness(self) -> Dict[str, Any]:
        """Analyze overall learning effectiveness"""
        analysis = {
            'pattern_discovery_rate': 0.0,
            'adaptation_success_rate': 0.0,
            'prediction_accuracy': 0.0,
            'overall_effectiveness': 0.0
        }
        
        # Pattern discovery rate (patterns per interaction)
        if self.learning_stats['interactions_processed'] > 0:
            analysis['pattern_discovery_rate'] = self.learning_stats['patterns_learned'] / self.learning_stats['interactions_processed']
        
        # Adaptation success rate
        if self.learning_stats['adaptation_count'] > 0:
            # This would need actual tracking of adaptation outcomes
            analysis['adaptation_success_rate'] = 0.7  # Placeholder
        
        # Prediction accuracy
        total_predictions = self.learning_stats['successful_predictions'] + self.learning_stats['failed_predictions']
        if total_predictions > 0:
            analysis['prediction_accuracy'] = self.learning_stats['successful_predictions'] / total_predictions
        
        # Overall effectiveness
        metrics = [
            analysis['pattern_discovery_rate'] * 10,  # Scale to 0-1 range
            analysis['adaptation_success_rate'],
            analysis['prediction_accuracy']
        ]
        non_zero_metrics = [m for m in metrics if m > 0]
        if non_zero_metrics:
            analysis['overall_effectiveness'] = sum(non_zero_metrics) / len(non_zero_metrics)
        
        return analysis
    
    async def _generate_pattern_insights(self, detected_patterns: Dict[str, Any]) -> List[str]:
        """Generate insights from detected patterns"""
        insights = []
        
        for pattern_type, patterns in detected_patterns.items():
            if isinstance(patterns, list) and patterns:
                high_conf_count = sum(1 for p in patterns if p.confidence > 0.8)
                if high_conf_count > 0:
                    insights.append(f"Found {high_conf_count} high-confidence {pattern_type} patterns")
                
                # Most frequent pattern
                most_frequent = max(patterns, key=lambda p: p.frequency)
                insights.append(f"Most frequent {pattern_type} pattern: {most_frequent.description}")
        
        return insights
    
    async def _generate_learning_recommendations(self, analysis: Dict[str, Any]) -> List[str]:
        """Generate recommendations based on analysis"""
        recommendations = []
        
        # Pattern analysis recommendations
        if 'pattern_analysis' in analysis:
            pattern_analysis = analysis['pattern_analysis']
            
            if pattern_analysis['total_patterns'] < 5:
                recommendations.append("Collect more interaction data to improve pattern detection")
            
            if pattern_analysis['high_confidence_patterns'] / max(pattern_analysis['total_patterns'], 1) < 0.3:
                recommendations.append("Review pattern detection parameters to improve confidence")
        
        # Performance analysis recommendations
        if 'performance_analysis' in analysis:
            perf_analysis = analysis['performance_analysis']
            
            if perf_analysis['success_rate'] < 0.7:
                recommendations.append("Focus on improving interaction success rate")
            
            if perf_analysis['learning_trend'] == 'declining':
                recommendations.append("Investigate causes of declining performance trend")
        
        # Effectiveness recommendations
        if 'effectiveness_analysis' in analysis:
            eff_analysis = analysis['effectiveness_analysis']
            
            if eff_analysis['overall_effectiveness'] < 0.5:
                recommendations.append("Consider adjusting learning algorithms for better effectiveness")
            
            if eff_analysis['prediction_accuracy'] < 0.6:
                recommendations.append("Improve prediction models with more training data")
        
        return recommendations
    
    async def _generate_analysis_summary(self, analysis: Dict[str, Any]) -> Dict[str, Any]:
        """Generate a summary of the analysis"""
        summary = {
            'key_findings': [],
            'strengths': [],
            'areas_for_improvement': [],
            'next_steps': []
        }
        
        # Key findings
        if 'pattern_analysis' in analysis:
            pa = analysis['pattern_analysis']
            summary['key_findings'].append(f"Discovered {pa['total_patterns']} patterns across {len(pa['patterns_by_type'])} types")
        
        if 'performance_analysis' in analysis:
            perf = analysis['performance_analysis']
            summary['key_findings'].append(f"Current success rate: {perf['success_rate']:.1%}")
        
        # Strengths and areas for improvement would be determined based on thresholds
        # This is a simplified example
        
        return summary

    # Override evaluate progress for learning-specific evaluation
    async def _evaluate_progress(self, state: AgentState) -> Dict[str, Any]:
        """Evaluate progress specific to learning tasks"""
        if state.result is not None:
            result = state.result
            task_type = state.context.get('task_type')
            
            if task_type == 'capture_interaction':
                if isinstance(result, dict) and result.get('event_captured'):
                    return {'complete': True, 'success': True, 'quality': 'captured'}
            
            elif task_type == 'detect_patterns':
                if isinstance(result, dict) and result.get('detected_patterns'):
                    pattern_count = result.get('total_patterns', 0)
                    return {'complete': True, 'success': True, 'patterns_found': pattern_count}
            
            elif task_type in ['adapt_behavior', 'predict_next', 'analyze_learning']:
                if isinstance(result, dict):
                    return {'complete': True, 'success': True}
            
            return {'complete': True, 'success': True}
        
        # Default evaluation
        return await super()._evaluate_progress(state)

    # Public interface methods for external interaction
    async def capture_interaction(self, interaction_data: Dict[str, Any]) -> Dict[str, Any]:
        """Public method to capture an interaction"""
        return await self.execute(
            "capture_interaction",
            context={'interaction_data': interaction_data}
        )
    
    async def detect_patterns(self, pattern_types: Optional[List[str]] = None, 
                            time_window: int = 30, 
                            confidence_threshold: float = None) -> Dict[str, Any]:
        """Public method to detect patterns"""
        context = {
            'pattern_types': pattern_types or list(self.pattern_detectors.keys()),
            'time_window': time_window,
            'confidence_threshold': confidence_threshold or self.pattern_confidence_threshold
        }
        
        return await self.execute("detect_patterns", context=context)
    
    async def predict_next_user_action(self, context_window: int = 10) -> Dict[str, Any]:
        """Public method to predict next user action"""
        return await self.execute(
            "predict_next",
            context={'prediction_type': 'next_action', 'context_window': context_window}
        )
    
    async def get_learning_analysis(self, scope: str = 'comprehensive') -> Dict[str, Any]:
        """Public method to get learning analysis"""
        return await self.execute(
            "analyze_learning",
            context={'analysis_scope': scope}
        )
    
    def get_learning_statistics(self) -> Dict[str, Any]:
        """Get current learning statistics"""
        return {
            **self.learning_stats,
            'patterns_count': len(self.patterns),
            'history_size': len(self.interaction_history),
            'patterns_by_type': {
                pattern_type: len([p for p in self.patterns.values() if p.pattern_type == pattern_type])
                for pattern_type in ['behavioral', 'semantic', 'temporal', 'causal']
            }
        }