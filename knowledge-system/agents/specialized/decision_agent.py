"""
Decision Agent - Specialized agent for making strategic decisions based on context and analysis
"""

import asyncio
import json
import uuid
from typing import Dict, Any, List, Optional, Union, Tuple
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from enum import Enum

from langchain_core.messages import HumanMessage, AIMessage, SystemMessage
from ..base_agent import BaseAgent, AgentState, AgentStatus

class DecisionType(Enum):
    STRATEGIC = "strategic"
    TACTICAL = "tactical"
    OPERATIONAL = "operational"
    EMERGENCY = "emergency"
    RESOURCE_ALLOCATION = "resource_allocation"
    PRIORITIZATION = "prioritization"
    TRADE_OFF = "trade_off"

class DecisionUrgency(Enum):
    LOW = 1
    MEDIUM = 2
    HIGH = 3
    CRITICAL = 4

@dataclass
class DecisionCriteria:
    """Represents decision criteria"""
    name: str
    weight: float  # 0.0 to 1.0
    description: str
    measurement_method: str
    target_value: Optional[Any] = None

@dataclass
class DecisionOption:
    """Represents a decision option"""
    option_id: str
    name: str
    description: str
    pros: List[str] = field(default_factory=list)
    cons: List[str] = field(default_factory=list)
    cost: Optional[float] = None
    effort: Optional[int] = None  # in person-hours
    risk_level: float = 0.5  # 0.0 to 1.0
    expected_outcome: str = ""
    metadata: Dict[str, Any] = field(default_factory=dict)

@dataclass
class DecisionEvaluation:
    """Represents evaluation of a decision option"""
    option_id: str
    criteria_scores: Dict[str, float]  # criteria_name -> score
    total_score: float
    confidence: float
    rationale: List[str]
    risks: List[str]
    dependencies: List[str]

@dataclass
class Decision:
    """Represents a decision and its context"""
    decision_id: str
    title: str
    description: str
    decision_type: DecisionType
    urgency: DecisionUrgency
    criteria: List[DecisionCriteria]
    options: List[DecisionOption]
    evaluations: List[DecisionEvaluation]
    recommended_option: Optional[str] = None  # option_id
    final_decision: Optional[str] = None  # option_id
    decision_maker: Optional[str] = None
    stakeholders: List[str] = field(default_factory=list)
    created_at: datetime = field(default_factory=datetime.now)
    decided_at: Optional[datetime] = None
    context: Dict[str, Any] = field(default_factory=dict)
    metadata: Dict[str, Any] = field(default_factory=dict)

class DecisionAgent(BaseAgent):
    """
    Specialized agent for decision making:
    - Strategic decision analysis
    - Multi-criteria decision making
    - Risk assessment
    - Option evaluation
    - Trade-off analysis
    - Decision recommendations
    """
    
    def __init__(self, llm_manager, config: Dict[str, Any]):
        super().__init__(
            name="DecisionAgent",
            llm_manager=llm_manager,
            config=config
        )
        
        # Decision configuration
        self.max_options_per_decision = config.get('max_options', 10)
        self.max_criteria_per_decision = config.get('max_criteria', 15)
        self.confidence_threshold = config.get('confidence_threshold', 0.7)
        self.default_decision_timeout_hours = config.get('timeout_hours', 72)
        
        # Decision storage
        self.decisions: Dict[str, Decision] = {}
        self.decision_history: List[str] = []
        
        # Decision making frameworks
        self.decision_frameworks = {
            'weighted_scoring': self._weighted_scoring_framework,
            'cost_benefit': self._cost_benefit_framework,
            'risk_matrix': self._risk_matrix_framework,
            'analytical_hierarchy': self._analytical_hierarchy_framework,
            'decision_tree': self._decision_tree_framework
        }
        
        # Analysis methods
        self.analysis_methods = {
            'swot': self._swot_analysis,
            'pareto': self._pareto_analysis,
            'sensitivity': self._sensitivity_analysis,
            'scenario': self._scenario_analysis
        }
    
    async def _plan_action(self, state: AgentState, context: Dict[str, Any]) -> Dict[str, Any]:
        """Plan decision-related actions"""
        task = state.current_task
        task_type = self._classify_decision_task(task)
        
        plan = {
            'task_type': task_type,
            'context': {},
            'metadata': {
                'task_classification': task_type,
                'decision_iteration': state.iteration
            }
        }
        
        if task_type == 'make_decision':
            plan['context'] = await self._plan_decision_making(task, context)
        elif task_type == 'evaluate_options':
            plan['context'] = await self._plan_option_evaluation(task, context)
        elif task_type == 'analyze_tradeoffs':
            plan['context'] = await self._plan_tradeoff_analysis(task, context)
        elif task_type == 'assess_risk':
            plan['context'] = await self._plan_risk_assessment(task, context)
        elif task_type == 'prioritize_items':
            plan['context'] = await self._plan_prioritization(task, context)
        elif task_type == 'recommend_action':
            plan['context'] = await self._plan_action_recommendation(task, context)
        else:
            plan['context'] = {'approach': 'general_decision'}
        
        return plan
    
    async def _execute_action(self, state: AgentState) -> Dict[str, Any]:
        """Execute decision-related actions"""
        task_type = state.context.get('task_type')
        
        try:
            if task_type == 'make_decision':
                return await self._execute_decision_making(state)
            elif task_type == 'evaluate_options':
                return await self._execute_option_evaluation(state)
            elif task_type == 'analyze_tradeoffs':
                return await self._execute_tradeoff_analysis(state)
            elif task_type == 'assess_risk':
                return await self._execute_risk_assessment(state)
            elif task_type == 'prioritize_items':
                return await self._execute_prioritization(state)
            elif task_type == 'recommend_action':
                return await self._execute_action_recommendation(state)
            else:
                return await self._execute_general_decision(state)
                
        except Exception as e:
            return {
                'success': False,
                'error': str(e),
                'tools_used': ['decision_agent_internal']
            }
    
    def _classify_decision_task(self, task: str) -> str:
        """Classify the type of decision task"""
        task_lower = task.lower()
        
        if any(word in task_lower for word in ['decide', 'choose', 'select', 'make decision']):
            return 'make_decision'
        elif any(word in task_lower for word in ['evaluate', 'compare', 'assess options']):
            return 'evaluate_options'
        elif any(word in task_lower for word in ['tradeoff', 'trade-off', 'compromise']):
            return 'analyze_tradeoffs'
        elif any(word in task_lower for word in ['risk', 'assess risk', 'identify risk']):
            return 'assess_risk'
        elif any(word in task_lower for word in ['prioritize', 'priority', 'rank', 'order']):
            return 'prioritize_items'
        elif any(word in task_lower for word in ['recommend', 'suggest', 'advise']):
            return 'recommend_action'
        else:
            return 'general_decision'
    
    async def _plan_decision_making(self, task: str, context: Dict[str, Any]) -> Dict[str, Any]:
        """Plan comprehensive decision making"""
        decision_context = context.get('decision_context', {})
        
        return {
            'approach': 'make_decision',
            'decision_title': self._extract_decision_title(task),
            'decision_type': context.get('decision_type', 'strategic'),
            'urgency': context.get('urgency', 'medium'),
            'framework': context.get('framework', 'weighted_scoring'),
            'include_risk_analysis': True,
            'generate_options': context.get('generate_options', True),
            'stakeholders': context.get('stakeholders', [])
        }
    
    async def _plan_option_evaluation(self, task: str, context: Dict[str, Any]) -> Dict[str, Any]:
        """Plan option evaluation"""
        options = context.get('options', [])
        criteria = context.get('criteria', [])
        
        return {
            'approach': 'evaluate_options',
            'options': options,
            'criteria': criteria,
            'evaluation_method': context.get('method', 'weighted_scoring'),
            'include_sensitivity': context.get('sensitivity_analysis', True)
        }
    
    async def _plan_tradeoff_analysis(self, task: str, context: Dict[str, Any]) -> Dict[str, Any]:
        """Plan tradeoff analysis"""
        return {
            'approach': 'analyze_tradeoffs',
            'tradeoff_dimensions': context.get('dimensions', ['cost', 'time', 'quality']),
            'options': context.get('options', []),
            'create_matrix': True,
            'identify_pareto_frontier': True
        }
    
    async def _plan_risk_assessment(self, task: str, context: Dict[str, Any]) -> Dict[str, Any]:
        """Plan risk assessment for decisions"""
        return {
            'approach': 'assess_risk',
            'decision_context': context.get('decision_context', {}),
            'risk_categories': ['financial', 'operational', 'strategic', 'compliance'],
            'include_mitigation': True,
            'probability_impact_matrix': True
        }
    
    async def _plan_prioritization(self, task: str, context: Dict[str, Any]) -> Dict[str, Any]:
        """Plan prioritization process"""
        items = context.get('items', [])
        
        return {
            'approach': 'prioritize_items',
            'items': items,
            'prioritization_method': context.get('method', 'weighted_scoring'),
            'criteria': context.get('criteria', ['impact', 'urgency', 'effort']),
            'create_priority_matrix': True
        }
    
    async def _plan_action_recommendation(self, task: str, context: Dict[str, Any]) -> Dict[str, Any]:
        """Plan action recommendation"""
        return {
            'approach': 'recommend_action',
            'situation_context': context.get('situation', {}),
            'constraints': context.get('constraints', []),
            'objectives': context.get('objectives', []),
            'generate_alternatives': True,
            'include_implementation_plan': True
        }
    
    async def _execute_decision_making(self, state: AgentState) -> Dict[str, Any]:
        """Execute comprehensive decision making process"""
        context = state.context
        decision_title = context.get('decision_title', 'Decision')
        decision_type = DecisionType(context.get('decision_type', 'strategic'))
        urgency = DecisionUrgency[context.get('urgency', 'MEDIUM').upper()]
        framework = context.get('framework', 'weighted_scoring')
        
        try:
            # Create decision object
            decision = Decision(
                decision_id=str(uuid.uuid4()),
                title=decision_title,
                description=state.current_task,
                decision_type=decision_type,
                urgency=urgency,
                criteria=[],
                options=[],
                evaluations=[],
                stakeholders=context.get('stakeholders', []),
                context=context
            )
            
            # Generate decision criteria
            decision.criteria = await self._generate_decision_criteria(decision)
            
            # Generate options if requested
            if context.get('generate_options', True):
                decision.options = await self._generate_decision_options(decision)
            else:
                decision.options = [self._dict_to_option(opt) for opt in context.get('options', [])]
            
            # Evaluate options using selected framework
            if framework in self.decision_frameworks:
                decision.evaluations = await self.decision_frameworks[framework](decision)
            else:
                decision.evaluations = await self._weighted_scoring_framework(decision)
            
            # Determine recommendation
            if decision.evaluations:
                best_evaluation = max(decision.evaluations, key=lambda e: e.total_score)
                decision.recommended_option = best_evaluation.option_id
            
            # Perform risk analysis if requested
            risk_analysis = None
            if context.get('include_risk_analysis', True):
                risk_analysis = await self._analyze_decision_risks(decision)
            
            # Store decision
            self.decisions[decision.decision_id] = decision
            self.decision_history.append(decision.decision_id)
            
            # Generate decision report
            decision_report = await self._generate_decision_report(decision, risk_analysis)
            
            return {
                'success': True,
                'result': {
                    'decision': decision,
                    'recommendation': self._get_recommended_option(decision),
                    'risk_analysis': risk_analysis,
                    'decision_report': decision_report,
                    'confidence': self._calculate_decision_confidence(decision)
                },
                'message': f"Completed decision analysis with {len(decision.options)} options",
                'tools_used': ['decision_framework', 'option_evaluation', 'risk_analysis']
            }
            
        except Exception as e:
            return {
                'success': False,
                'error': f"Decision making failed: {str(e)}",
                'tools_used': ['decision_making']
            }
    
    async def _execute_option_evaluation(self, state: AgentState) -> Dict[str, Any]:
        """Execute option evaluation"""
        context = state.context
        options_data = context.get('options', [])
        criteria_data = context.get('criteria', [])
        evaluation_method = context.get('evaluation_method', 'weighted_scoring')
        
        try:
            # Convert data to objects
            options = [self._dict_to_option(opt) for opt in options_data]
            criteria = [self._dict_to_criteria(crit) for crit in criteria_data]
            
            # Create temporary decision for evaluation
            temp_decision = Decision(
                decision_id='temp_evaluation',
                title='Option Evaluation',
                description=state.current_task,
                decision_type=DecisionType.TACTICAL,
                urgency=DecisionUrgency.MEDIUM,
                criteria=criteria,
                options=options,
                evaluations=[]
            )
            
            # Perform evaluation
            if evaluation_method in self.decision_frameworks:
                evaluations = await self.decision_frameworks[evaluation_method](temp_decision)
            else:
                evaluations = await self._weighted_scoring_framework(temp_decision)
            
            # Sort evaluations by score
            evaluations.sort(key=lambda e: e.total_score, reverse=True)
            
            # Sensitivity analysis if requested
            sensitivity_analysis = None
            if context.get('include_sensitivity', True):
                sensitivity_analysis = await self._perform_sensitivity_analysis(temp_decision, evaluations)
            
            return {
                'success': True,
                'result': {
                    'evaluations': evaluations,
                    'top_option': evaluations[0] if evaluations else None,
                    'sensitivity_analysis': sensitivity_analysis,
                    'evaluation_summary': self._create_evaluation_summary(evaluations)
                },
                'message': f"Evaluated {len(options)} options using {evaluation_method}",
                'tools_used': ['option_evaluation', 'sensitivity_analysis']
            }
            
        except Exception as e:
            return {
                'success': False,
                'error': f"Option evaluation failed: {str(e)}",
                'tools_used': ['option_evaluation']
            }
    
    async def _execute_tradeoff_analysis(self, state: AgentState) -> Dict[str, Any]:
        """Execute tradeoff analysis"""
        context = state.context
        dimensions = context.get('tradeoff_dimensions', ['cost', 'time', 'quality'])
        options_data = context.get('options', [])
        
        try:
            options = [self._dict_to_option(opt) for opt in options_data]
            
            # Create tradeoff matrix
            tradeoff_matrix = await self._create_tradeoff_matrix(options, dimensions)
            
            # Identify Pareto frontier if requested
            pareto_frontier = None
            if context.get('identify_pareto_frontier', True):
                pareto_frontier = await self._identify_pareto_frontier(options, dimensions)
            
            # Generate tradeoff insights
            insights = await self._generate_tradeoff_insights(tradeoff_matrix, pareto_frontier)
            
            return {
                'success': True,
                'result': {
                    'tradeoff_matrix': tradeoff_matrix,
                    'pareto_frontier': pareto_frontier,
                    'insights': insights,
                    'dimensions_analyzed': dimensions
                },
                'message': f"Analyzed tradeoffs across {len(dimensions)} dimensions",
                'tools_used': ['tradeoff_analysis', 'pareto_analysis']
            }
            
        except Exception as e:
            return {
                'success': False,
                'error': f"Tradeoff analysis failed: {str(e)}",
                'tools_used': ['tradeoff_analysis']
            }
    
    async def _execute_risk_assessment(self, state: AgentState) -> Dict[str, Any]:
        """Execute risk assessment for decisions"""
        context = state.context
        decision_context = context.get('decision_context', {})
        risk_categories = context.get('risk_categories', ['financial', 'operational', 'strategic'])
        
        try:
            # Identify risks by category
            identified_risks = []
            for category in risk_categories:
                category_risks = await self._identify_category_risks(decision_context, category)
                identified_risks.extend(category_risks)
            
            # Assess probability and impact
            risk_assessments = []
            for risk in identified_risks:
                assessment = await self._assess_risk_probability_impact(risk, decision_context)
                risk_assessments.append(assessment)
            
            # Create risk matrix if requested
            risk_matrix = None
            if context.get('probability_impact_matrix', True):
                risk_matrix = await self._create_risk_matrix(risk_assessments)
            
            # Generate mitigation strategies if requested
            mitigation_strategies = []
            if context.get('include_mitigation', True):
                for risk in risk_assessments:
                    if risk['risk_score'] > 0.6:  # High risk threshold
                        mitigation = await self._generate_risk_mitigation(risk)
                        mitigation_strategies.append(mitigation)
            
            return {
                'success': True,
                'result': {
                    'identified_risks': identified_risks,
                    'risk_assessments': risk_assessments,
                    'risk_matrix': risk_matrix,
                    'mitigation_strategies': mitigation_strategies,
                    'overall_risk_score': sum(r['risk_score'] for r in risk_assessments) / len(risk_assessments) if risk_assessments else 0
                },
                'message': f"Assessed {len(identified_risks)} risks with {len(mitigation_strategies)} mitigation strategies",
                'tools_used': ['risk_identification', 'risk_assessment', 'mitigation_planning']
            }
            
        except Exception as e:
            return {
                'success': False,
                'error': f"Risk assessment failed: {str(e)}",
                'tools_used': ['risk_assessment']
            }
    
    async def _execute_prioritization(self, state: AgentState) -> Dict[str, Any]:
        """Execute prioritization process"""
        context = state.context
        items = context.get('items', [])
        method = context.get('prioritization_method', 'weighted_scoring')
        criteria = context.get('criteria', ['impact', 'urgency', 'effort'])
        
        try:
            # Convert items to decision options format for evaluation
            options = []
            for i, item in enumerate(items):
                if isinstance(item, str):
                    option = DecisionOption(
                        option_id=f"item_{i}",
                        name=item,
                        description=item
                    )
                else:
                    option = DecisionOption(
                        option_id=item.get('id', f"item_{i}"),
                        name=item.get('name', f"Item {i}"),
                        description=item.get('description', ''),
                        metadata=item
                    )
                options.append(option)
            
            # Create criteria objects
            criteria_objects = []
            for criterion in criteria:
                if isinstance(criterion, str):
                    criteria_obj = DecisionCriteria(
                        name=criterion,
                        weight=1.0 / len(criteria),  # Equal weighting
                        description=f"Evaluation based on {criterion}",
                        measurement_method="subjective"
                    )
                else:
                    criteria_obj = self._dict_to_criteria(criterion)
                criteria_objects.append(criteria_obj)
            
            # Create temporary decision for prioritization
            temp_decision = Decision(
                decision_id='temp_prioritization',
                title='Prioritization',
                description=state.current_task,
                decision_type=DecisionType.TACTICAL,
                urgency=DecisionUrgency.MEDIUM,
                criteria=criteria_objects,
                options=options,
                evaluations=[]
            )
            
            # Perform prioritization using selected method
            if method in self.decision_frameworks:
                evaluations = await self.decision_frameworks[method](temp_decision)
            else:
                evaluations = await self._weighted_scoring_framework(temp_decision)
            
            # Sort by priority (highest score first)
            evaluations.sort(key=lambda e: e.total_score, reverse=True)
            
            # Create priority matrix if requested
            priority_matrix = None
            if context.get('create_priority_matrix', True):
                priority_matrix = await self._create_priority_matrix(evaluations, criteria)
            
            # Generate prioritization insights
            insights = await self._generate_prioritization_insights(evaluations)
            
            return {
                'success': True,
                'result': {
                    'prioritized_items': evaluations,
                    'priority_matrix': priority_matrix,
                    'insights': insights,
                    'total_items': len(items)
                },
                'message': f"Prioritized {len(items)} items using {method}",
                'tools_used': ['prioritization', 'priority_matrix']
            }
            
        except Exception as e:
            return {
                'success': False,
                'error': f"Prioritization failed: {str(e)}",
                'tools_used': ['prioritization']
            }
    
    async def _execute_action_recommendation(self, state: AgentState) -> Dict[str, Any]:
        """Execute action recommendation"""
        context = state.context
        situation = context.get('situation_context', {})
        constraints = context.get('constraints', [])
        objectives = context.get('objectives', [])
        
        try:
            # Analyze the situation
            situation_analysis = await self._analyze_situation(situation, constraints, objectives)
            
            # Generate alternative actions
            alternatives = []
            if context.get('generate_alternatives', True):
                alternatives = await self._generate_action_alternatives(situation_analysis)
            
            # Evaluate alternatives
            evaluations = await self._evaluate_action_alternatives(alternatives, objectives, constraints)
            
            # Select recommended action
            recommended_action = None
            if evaluations:
                recommended_action = max(evaluations, key=lambda e: e['score'])
            
            # Create implementation plan if requested
            implementation_plan = None
            if context.get('include_implementation_plan', True) and recommended_action:
                implementation_plan = await self._create_implementation_plan(recommended_action)
            
            return {
                'success': True,
                'result': {
                    'situation_analysis': situation_analysis,
                    'alternatives': alternatives,
                    'evaluations': evaluations,
                    'recommended_action': recommended_action,
                    'implementation_plan': implementation_plan
                },
                'message': f"Generated recommendation from {len(alternatives)} alternatives",
                'tools_used': ['situation_analysis', 'alternative_generation', 'action_evaluation']
            }
            
        except Exception as e:
            return {
                'success': False,
                'error': f"Action recommendation failed: {str(e)}",
                'tools_used': ['action_recommendation']
            }
    
    async def _execute_general_decision(self, state: AgentState) -> Dict[str, Any]:
        """Execute general decision task"""
        task = state.current_task
        
        # Use LLM for general decision advice
        prompt = SystemMessage(content=f"""
        You are a decision-making expert. Help with this decision task:
        {task}
        
        Consider:
        - Decision frameworks and methodologies
        - Risk assessment and mitigation
        - Stakeholder analysis
        - Option evaluation
        - Implementation considerations
        
        Provide structured decision guidance.
        """)
        
        try:
            response = await self.llm_manager.agenerate([prompt])
            
            return {
                'success': True,
                'result': {
                    'decision_advice': response.text,
                    'task': task
                },
                'message': "Generated decision advice for general task",
                'tools_used': ['llm_decision_advice']
            }
            
        except Exception as e:
            return {
                'success': False,
                'error': str(e),
                'tools_used': ['llm_decision_advice']
            }
    
    # Decision framework implementations
    async def _weighted_scoring_framework(self, decision: Decision) -> List[DecisionEvaluation]:
        """Weighted scoring decision framework"""
        evaluations = []
        
        for option in decision.options:
            criteria_scores = {}
            total_weighted_score = 0.0
            
            for criterion in decision.criteria:
                # Score each option on each criterion (0-10 scale)
                score = await self._score_option_on_criterion(option, criterion)
                criteria_scores[criterion.name] = score
                total_weighted_score += score * criterion.weight
            
            # Normalize to 0-1 scale
            normalized_score = total_weighted_score / 10.0
            
            # Generate rationale
            rationale = await self._generate_evaluation_rationale(option, criteria_scores)
            
            # Identify risks
            risks = await self._identify_option_risks(option)
            
            evaluation = DecisionEvaluation(
                option_id=option.option_id,
                criteria_scores=criteria_scores,
                total_score=normalized_score,
                confidence=self._calculate_evaluation_confidence(criteria_scores),
                rationale=rationale,
                risks=risks,
                dependencies=[]
            )
            
            evaluations.append(evaluation)
        
        return evaluations
    
    async def _cost_benefit_framework(self, decision: Decision) -> List[DecisionEvaluation]:
        """Cost-benefit analysis framework"""
        evaluations = []
        
        for option in decision.options:
            # Extract costs and benefits
            costs = await self._extract_option_costs(option)
            benefits = await self._extract_option_benefits(option)
            
            # Calculate cost-benefit ratio
            total_cost = sum(costs.values())
            total_benefit = sum(benefits.values())
            
            if total_cost > 0:
                cb_ratio = total_benefit / total_cost
                score = min(cb_ratio / 5.0, 1.0)  # Normalize, cap at 1.0
            else:
                score = 1.0 if total_benefit > 0 else 0.0
            
            evaluation = DecisionEvaluation(
                option_id=option.option_id,
                criteria_scores={'cost_benefit_ratio': cb_ratio},
                total_score=score,
                confidence=0.8,
                rationale=[f"Cost-benefit ratio: {cb_ratio:.2f}"],
                risks=[],
                dependencies=[]
            )
            
            evaluations.append(evaluation)
        
        return evaluations
    
    async def _risk_matrix_framework(self, decision: Decision) -> List[DecisionEvaluation]:
        """Risk-based decision framework"""
        evaluations = []
        
        for option in decision.options:
            # Assess risks for each option
            risks = await self._identify_option_risks(option)
            
            # Calculate overall risk score
            risk_scores = []
            for risk in risks:
                probability = risk.get('probability', 0.5)
                impact = risk.get('impact', 0.5)
                risk_score = probability * impact
                risk_scores.append(risk_score)
            
            avg_risk_score = sum(risk_scores) / len(risk_scores) if risk_scores else 0.5
            
            # Score is inverse of risk (lower risk = higher score)
            score = 1.0 - avg_risk_score
            
            evaluation = DecisionEvaluation(
                option_id=option.option_id,
                criteria_scores={'risk_score': avg_risk_score},
                total_score=score,
                confidence=0.7,
                rationale=[f"Risk-adjusted score based on {len(risks)} identified risks"],
                risks=[risk['description'] for risk in risks],
                dependencies=[]
            )
            
            evaluations.append(evaluation)
        
        return evaluations
    
    # Helper methods for decision making
    def _extract_decision_title(self, task: str) -> str:
        """Extract decision title from task description"""
        # Look for decision-making keywords and extract the subject
        import re
        
        patterns = [
            r'decide (?:on |about )?(.+)',
            r'choose (?:between |from )?(.+)',
            r'select (.+)',
            r'make (?:a )?decision (?:on |about )?(.+)'
        ]
        
        for pattern in patterns:
            match = re.search(pattern, task, re.IGNORECASE)
            if match:
                return match.group(1).strip()
        
        return task.strip()
    
    async def _generate_decision_criteria(self, decision: Decision) -> List[DecisionCriteria]:
        """Generate decision criteria based on decision context"""
        criteria = []
        
        # Common criteria by decision type
        type_criteria = {
            DecisionType.STRATEGIC: [
                ('alignment_with_strategy', 0.25, 'Strategic alignment'),
                ('long_term_impact', 0.20, 'Long-term impact'),
                ('competitive_advantage', 0.15, 'Competitive advantage'),
                ('risk_level', 0.20, 'Risk level'),
                ('resource_requirements', 0.20, 'Resource requirements')
            ],
            DecisionType.TACTICAL: [
                ('effectiveness', 0.30, 'Effectiveness'),
                ('efficiency', 0.25, 'Efficiency'), 
                ('implementation_ease', 0.20, 'Implementation ease'),
                ('cost', 0.25, 'Cost considerations')
            ],
            DecisionType.OPERATIONAL: [
                ('cost', 0.30, 'Cost'),
                ('time_to_implement', 0.25, 'Time to implement'),
                ('quality_impact', 0.20, 'Quality impact'),
                ('resource_availability', 0.25, 'Resource availability')
            ]
        }
        
        default_criteria = [
            ('cost', 0.30, 'Cost considerations'),
            ('benefit', 0.30, 'Expected benefits'),
            ('risk', 0.20, 'Risk level'),
            ('feasibility', 0.20, 'Implementation feasibility')
        ]
        
        criteria_set = type_criteria.get(decision.decision_type, default_criteria)
        
        for name, weight, description in criteria_set:
            criterion = DecisionCriteria(
                name=name,
                weight=weight,
                description=description,
                measurement_method="subjective"
            )
            criteria.append(criterion)
        
        return criteria
    
    async def _generate_decision_options(self, decision: Decision) -> List[DecisionOption]:
        """Generate decision options using LLM"""
        prompt = SystemMessage(content=f"""
        Generate decision options for this decision:
        Title: {decision.title}
        Description: {decision.description}
        Type: {decision.decision_type.value}
        
        Generate 3-5 distinct, viable options. For each option provide:
        - Name
        - Description
        - Key pros (3-4 points)
        - Key cons (2-3 points)
        - Estimated effort level (1-10)
        - Risk level (low/medium/high)
        
        Format as JSON array.
        """)
        
        try:
            response = await self.llm_manager.agenerate([prompt])
            import json
            options_data = json.loads(response.text)
            
            options = []
            for i, opt_data in enumerate(options_data):
                option = DecisionOption(
                    option_id=f"option_{i+1}",
                    name=opt_data.get('name', f'Option {i+1}'),
                    description=opt_data.get('description', ''),
                    pros=opt_data.get('pros', []),
                    cons=opt_data.get('cons', []),
                    effort=opt_data.get('effort', 5),
                    risk_level=self._parse_risk_level(opt_data.get('risk_level', 'medium')),
                    expected_outcome=opt_data.get('expected_outcome', '')
                )
                options.append(option)
            
            return options
            
        except Exception as e:
            # Fallback to generic options
            return [
                DecisionOption(
                    option_id="option_1",
                    name="Status Quo",
                    description="Continue with current approach",
                    pros=["Low risk", "No change required"],
                    cons=["May miss opportunities", "Problems persist"],
                    risk_level=0.3
                ),
                DecisionOption(
                    option_id="option_2", 
                    name="Moderate Change",
                    description="Make incremental improvements",
                    pros=["Manageable risk", "Gradual improvement"],
                    cons=["Slower progress", "May not address root causes"],
                    risk_level=0.5
                ),
                DecisionOption(
                    option_id="option_3",
                    name="Transformational Change",
                    description="Implement significant changes",
                    pros=["High potential impact", "Address root causes"],
                    cons=["High risk", "Significant resources required"],
                    risk_level=0.8
                )
            ]
    
    async def _score_option_on_criterion(self, option: DecisionOption, criterion: DecisionCriteria) -> float:
        """Score an option on a specific criterion (0-10 scale)"""
        # Simplified scoring based on option characteristics
        if criterion.name == 'cost':
            # Lower cost = higher score
            cost = option.cost or (option.effort * 100 if option.effort else 500)
            return max(0, 10 - (cost / 1000))  # Normalize cost to 0-10 scale
            
        elif criterion.name == 'risk' or criterion.name == 'risk_level':
            # Lower risk = higher score
            return (1.0 - option.risk_level) * 10
            
        elif criterion.name == 'effort' or criterion.name == 'implementation_ease':
            # Lower effort = higher score  
            effort = option.effort or 5
            return max(0, 10 - effort)
            
        elif criterion.name in ['benefit', 'effectiveness', 'impact']:
            # Score based on pros vs cons
            pros_score = len(option.pros) * 2
            cons_penalty = len(option.cons) * 1
            return min(10, max(0, pros_score - cons_penalty))
            
        else:
            # Default scoring
            return 6.0  # Neutral score
    
    async def _generate_evaluation_rationale(self, option: DecisionOption, scores: Dict[str, float]) -> List[str]:
        """Generate rationale for option evaluation"""
        rationale = []
        
        # Top scoring criteria
        top_criteria = sorted(scores.items(), key=lambda x: x[1], reverse=True)[:3]
        for criterion, score in top_criteria:
            if score > 7:
                rationale.append(f"Strong performance on {criterion} (score: {score:.1f})")
            elif score < 4:
                rationale.append(f"Weak performance on {criterion} (score: {score:.1f})")
        
        # Option characteristics
        if len(option.pros) > len(option.cons):
            rationale.append(f"More advantages ({len(option.pros)}) than disadvantages ({len(option.cons)})")
        
        if option.risk_level < 0.3:
            rationale.append("Low risk profile")
        elif option.risk_level > 0.7:
            rationale.append("High risk but potentially high reward")
        
        return rationale
    
    async def _identify_option_risks(self, option: DecisionOption) -> List[Dict[str, Any]]:
        """Identify risks associated with an option"""
        risks = []
        
        # Risk based on cons
        for con in option.cons:
            risk = {
                'description': con,
                'probability': 0.6,  # Moderate probability
                'impact': 0.5,       # Moderate impact
                'category': 'implementation'
            }
            risks.append(risk)
        
        # Risk based on effort level
        if option.effort and option.effort > 7:
            risks.append({
                'description': 'High effort requirements may lead to resource strain',
                'probability': 0.7,
                'impact': 0.6,
                'category': 'resource'
            })
        
        # Risk based on overall risk level
        if option.risk_level > 0.7:
            risks.append({
                'description': 'High inherent risk in this approach',
                'probability': 0.8,
                'impact': option.risk_level,
                'category': 'strategic'
            })
        
        return risks
    
    def _calculate_evaluation_confidence(self, scores: Dict[str, float]) -> float:
        """Calculate confidence in evaluation based on score distribution"""
        if not scores:
            return 0.5
        
        score_values = list(scores.values())
        
        # Higher confidence if scores are consistent (low variance)
        mean_score = sum(score_values) / len(score_values)
        variance = sum((s - mean_score) ** 2 for s in score_values) / len(score_values)
        
        # Convert variance to confidence (lower variance = higher confidence)
        confidence = max(0.3, min(0.9, 1.0 - (variance / 25)))  # Normalize variance
        
        return confidence
    
    def _calculate_decision_confidence(self, decision: Decision) -> float:
        """Calculate overall confidence in the decision"""
        if not decision.evaluations:
            return 0.3
        
        # Base confidence on evaluation confidence and score spread
        avg_confidence = sum(e.confidence for e in decision.evaluations) / len(decision.evaluations)
        
        # Score spread - larger gaps between options = higher confidence
        scores = [e.total_score for e in decision.evaluations]
        scores.sort(reverse=True)
        
        if len(scores) > 1:
            score_spread = scores[0] - scores[1]  # Gap between best and second-best
            spread_boost = min(0.2, score_spread)  # Max 20% boost
        else:
            spread_boost = 0.0
        
        return min(0.95, avg_confidence + spread_boost)
    
    def _get_recommended_option(self, decision: Decision) -> Optional[DecisionOption]:
        """Get the recommended option from decision"""
        if decision.recommended_option:
            for option in decision.options:
                if option.option_id == decision.recommended_option:
                    return option
        return None
    
    def _dict_to_option(self, opt_dict: Dict[str, Any]) -> DecisionOption:
        """Convert dictionary to DecisionOption"""
        return DecisionOption(
            option_id=opt_dict.get('id', str(uuid.uuid4())),
            name=opt_dict.get('name', 'Option'),
            description=opt_dict.get('description', ''),
            pros=opt_dict.get('pros', []),
            cons=opt_dict.get('cons', []),
            cost=opt_dict.get('cost'),
            effort=opt_dict.get('effort'),
            risk_level=opt_dict.get('risk_level', 0.5),
            expected_outcome=opt_dict.get('expected_outcome', ''),
            metadata=opt_dict
        )
    
    def _dict_to_criteria(self, crit_dict: Dict[str, Any]) -> DecisionCriteria:
        """Convert dictionary to DecisionCriteria"""
        return DecisionCriteria(
            name=crit_dict.get('name', 'Criteria'),
            weight=crit_dict.get('weight', 1.0),
            description=crit_dict.get('description', ''),
            measurement_method=crit_dict.get('method', 'subjective'),
            target_value=crit_dict.get('target_value')
        )
    
    def _parse_risk_level(self, risk_str: str) -> float:
        """Parse risk level string to float"""
        risk_map = {
            'low': 0.3,
            'medium': 0.5, 
            'high': 0.8,
            'critical': 0.9
        }
        return risk_map.get(risk_str.lower(), 0.5)
    
    # Override evaluate progress for decision-specific evaluation
    async def _evaluate_progress(self, state: AgentState) -> Dict[str, Any]:
        """Evaluate progress specific to decision tasks"""
        if state.result is not None:
            result = state.result
            task_type = state.context.get('task_type')
            
            success_indicators = {
                'make_decision': 'decision' in result and 'recommendation' in result,
                'evaluate_options': 'evaluations' in result,
                'analyze_tradeoffs': 'tradeoff_matrix' in result,
                'assess_risk': 'risk_assessments' in result,
                'prioritize_items': 'prioritized_items' in result,
                'recommend_action': 'recommended_action' in result
            }
            
            if task_type in success_indicators and success_indicators[task_type]:
                confidence = result.get('confidence', 0.7)
                quality = 'high' if confidence > 0.8 else 'good' if confidence > 0.6 else 'adequate'
                return {'complete': True, 'success': True, 'quality': quality, 'confidence': confidence}
            
            return {'complete': True, 'success': True}
        
        return await super()._evaluate_progress(state)
    
    # Public interface methods
    async def make_decision(self, title: str, description: str, 
                           decision_type: str = 'strategic', urgency: str = 'medium',
                           options: List[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Public method to make a decision"""
        context = {
            'decision_title': title,
            'decision_type': decision_type,
            'urgency': urgency,
            'options': options or [],
            'generate_options': options is None
        }
        
        return await self.execute(f"decide on {title}", context=context)
    
    async def evaluate_options(self, options: List[Dict[str, Any]], 
                             criteria: List[Dict[str, Any]] = None,
                             method: str = 'weighted_scoring') -> Dict[str, Any]:
        """Public method to evaluate options"""
        context = {
            'options': options,
            'criteria': criteria or [],
            'evaluation_method': method
        }
        
        return await self.execute("evaluate options", context=context)
    
    async def prioritize_items(self, items: List[Any], 
                              criteria: List[str] = None,
                              method: str = 'weighted_scoring') -> Dict[str, Any]:
        """Public method to prioritize items"""
        context = {
            'items': items,
            'criteria': criteria or ['impact', 'urgency', 'effort'],
            'prioritization_method': method
        }
        
        return await self.execute("prioritize items", context=context)
    
    def get_decision_history(self, limit: int = 10) -> List[Decision]:
        """Get recent decision history"""
        recent_decision_ids = self.decision_history[-limit:]
        return [self.decisions[decision_id] for decision_id in recent_decision_ids if decision_id in self.decisions]
    
    def get_decision_statistics(self) -> Dict[str, Any]:
        """Get decision-making statistics"""
        decisions = list(self.decisions.values())
        
        if not decisions:
            return {
                'total_decisions': 0,
                'avg_confidence': 0.0,
                'decision_types': {},
                'avg_options_per_decision': 0.0
            }
        
        return {
            'total_decisions': len(decisions),
            'avg_confidence': sum(self._calculate_decision_confidence(d) for d in decisions) / len(decisions),
            'decision_types': {dt.value: len([d for d in decisions if d.decision_type == dt]) for dt in DecisionType},
            'avg_options_per_decision': sum(len(d.options) for d in decisions) / len(decisions),
            'avg_criteria_per_decision': sum(len(d.criteria) for d in decisions) / len(decisions)
        }