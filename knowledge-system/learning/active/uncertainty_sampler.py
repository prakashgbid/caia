#!/usr/bin/env python3
"""
Uncertainty Sampling for Active Learning
Identifies areas where the AI is most uncertain to guide learning
"""

import os
import json
import numpy as np
import logging
import sqlite3
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional, Tuple
from pathlib import Path
import asyncio
import torch
import torch.nn.functional as F
from transformers import AutoTokenizer, AutoModelForCausalLM
from scipy.stats import entropy
from sklearn.cluster import KMeans
from sklearn.metrics.pairwise import cosine_similarity
import re

class UncertaintySampler:
    """Advanced uncertainty sampling for active learning"""
    
    def __init__(self, config_path: str = "learning_config.yaml"):
        self.config = self._load_config(config_path)
        self.setup_logging()
        self.db_path = "data/learning_interactions.db"
        
        # Models and tokenizer
        self.model = None
        self.tokenizer = None
        self.embeddings = {}
        
        # Uncertainty metrics
        self.uncertainty_cache = {}
        self.question_templates = self._load_question_templates()
        
    def setup_logging(self):
        """Setup comprehensive logging"""
        logging.basicConfig(
            level=logging.INFO,
            format='[UNCERTAINTY_SAMPLER] %(asctime)s - %(levelname)s - %(message)s',
            handlers=[
                logging.FileHandler('learning/logs/uncertainty_sampler.log'),
                logging.StreamHandler()
            ]
        )
        self.logger = logging.getLogger(__name__)
    
    def _load_config(self, config_path: str) -> Dict:
        """Load configuration with defaults"""
        default_config = {
            "uncertainty": {
                "model_name": "microsoft/DialoGPT-medium",
                "max_sequence_length": 1024,
                "temperature": 1.0,
                "num_samples": 5,
                "threshold": 0.7,
                "diversity_weight": 0.3
            },
            "sampling": {
                "entropy_threshold": 2.0,
                "confidence_threshold": 0.6,
                "novelty_threshold": 0.8,
                "min_samples": 10
            }
        }
        
        if os.path.exists(config_path):
            import yaml
            with open(config_path, 'r') as f:
                user_config = yaml.safe_load(f)
            # Merge configs
            for key in default_config:
                if key in user_config:
                    default_config[key].update(user_config[key])
                    
        return default_config
    
    def _load_question_templates(self) -> List[str]:
        """Load templates for generating clarifying questions"""
        return [
            "Can you provide more details about {topic}?",
            "What would you prefer when {context}?",
            "How should I handle {situation}?",
            "What's the best approach for {task}?",
            "Could you clarify your preference regarding {aspect}?",
            "When you say '{statement}', do you mean {interpretation1} or {interpretation2}?",
            "How important is {factor} in this context?",
            "What additional information would help with {problem}?",
            "Should I prioritize {option1} or {option2}?",
            "What outcome are you expecting from {action}?"
        ]
    
    async def setup_model(self, model_name: str = None):
        """Setup model and tokenizer for uncertainty estimation"""
        if model_name is None:
            model_name = self.config["uncertainty"]["model_name"]
            
        self.logger.info(f"Setting up model: {model_name}")
        
        self.tokenizer = AutoTokenizer.from_pretrained(model_name)
        if self.tokenizer.pad_token is None:
            self.tokenizer.pad_token = self.tokenizer.eos_token
            
        self.model = AutoModelForCausalLM.from_pretrained(
            model_name,
            torch_dtype=torch.float16,
            device_map="auto"
        )
        
        self.model.eval()
        self.logger.info("Model setup complete")
    
    def compute_prediction_entropy(self, input_text: str, 
                                 num_samples: int = None) -> float:
        """Compute prediction entropy for uncertainty estimation"""
        if num_samples is None:
            num_samples = self.config["uncertainty"]["num_samples"]
            
        if self.model is None:
            asyncio.run(self.setup_model())
        
        device = next(self.model.parameters()).device
        
        # Tokenize input
        inputs = self.tokenizer(
            input_text,
            return_tensors="pt",
            truncation=True,
            max_length=self.config["uncertainty"]["max_sequence_length"]
        ).to(device)
        
        # Generate multiple samples
        all_responses = []
        
        with torch.no_grad():
            for _ in range(num_samples):
                outputs = self.model.generate(
                    **inputs,
                    max_new_tokens=100,
                    temperature=self.config["uncertainty"]["temperature"],
                    do_sample=True,
                    pad_token_id=self.tokenizer.eos_token_id
                )
                
                # Decode response
                response = self.tokenizer.decode(
                    outputs[0][len(inputs.input_ids[0]):],
                    skip_special_tokens=True
                )
                all_responses.append(response.strip())
        
        # Calculate diversity (entropy) of responses
        if not all_responses:
            return 0.0
            
        # Simple diversity measure: unique responses / total responses
        unique_responses = len(set(all_responses))
        diversity = unique_responses / len(all_responses)
        
        # Convert to entropy-like measure
        if diversity == 1.0:
            return np.log(num_samples)  # Maximum entropy
        elif diversity == 0.0:
            return 0.0  # Minimum entropy
        else:
            # Approximate entropy based on response diversity
            return -diversity * np.log(diversity) - (1-diversity) * np.log(1-diversity)
    
    def compute_semantic_uncertainty(self, input_text: str, 
                                   responses: List[str]) -> float:
        """Compute semantic uncertainty using response embeddings"""
        if len(responses) < 2:
            return 0.0
        
        # Simple semantic similarity using token overlap
        similarities = []
        for i in range(len(responses)):
            for j in range(i+1, len(responses)):
                tokens_i = set(responses[i].lower().split())
                tokens_j = set(responses[j].lower().split())
                
                if not tokens_i and not tokens_j:
                    similarity = 1.0
                elif not tokens_i or not tokens_j:
                    similarity = 0.0
                else:
                    intersection = len(tokens_i.intersection(tokens_j))
                    union = len(tokens_i.union(tokens_j))
                    similarity = intersection / union if union > 0 else 0.0
                
                similarities.append(similarity)
        
        # High uncertainty = low average similarity
        avg_similarity = np.mean(similarities) if similarities else 0.0
        return 1.0 - avg_similarity
    
    def identify_uncertain_interactions(self, days_back: int = 7) -> List[Dict]:
        """Identify interactions with high uncertainty"""
        self.logger.info(f"Identifying uncertain interactions from last {days_back} days")
        
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        # Get recent interactions without clear feedback
        query = """
        SELECT DISTINCT
            i.id,
            i.user_input,
            i.ai_response,
            i.context,
            i.timestamp,
            f.rating
        FROM interactions i
        LEFT JOIN feedback f ON i.id = f.interaction_id
        WHERE i.timestamp > datetime('now', '-{} days')
        ORDER BY i.timestamp DESC
        """.format(days_back)
        
        cursor.execute(query)
        rows = cursor.fetchall()
        conn.close()
        
        uncertain_interactions = []
        
        for row in rows:
            interaction_id, user_input, ai_response, context, timestamp, rating = row
            
            # Skip if already has clear positive feedback
            if rating and rating >= 4:
                continue
            
            # Compute uncertainty
            full_input = f"Context: {context or ''}\nUser: {user_input}"
            entropy_score = self.compute_prediction_entropy(full_input)
            
            # Analyze response characteristics
            response_uncertainty = self._analyze_response_uncertainty(ai_response)
            
            # Combined uncertainty score
            uncertainty_score = (entropy_score + response_uncertainty) / 2
            
            if uncertainty_score > self.config["sampling"]["entropy_threshold"]:
                uncertain_interactions.append({
                    'interaction_id': interaction_id,
                    'user_input': user_input,
                    'ai_response': ai_response,
                    'context': context or '',
                    'timestamp': timestamp,
                    'uncertainty_score': uncertainty_score,
                    'entropy_score': entropy_score,
                    'response_uncertainty': response_uncertainty
                })
        
        # Sort by uncertainty score
        uncertain_interactions.sort(key=lambda x: x['uncertainty_score'], reverse=True)
        
        self.logger.info(f"Found {len(uncertain_interactions)} uncertain interactions")
        return uncertain_interactions
    
    def _analyze_response_uncertainty(self, response: str) -> float:
        """Analyze response text for uncertainty indicators"""
        uncertainty_indicators = [
            r'\bI think\b', r'\bmaybe\b', r'\bperhaps\b', r'\bpossibly\b',
            r'\bmight\b', r'\bcould\b', r'\bI\'m not sure\b', r'\buncertain\b',
            r'\bprobably\b', r'\bI believe\b', r'\bseems like\b', r'\bappears\b',
            r'\bI guess\b', r'\bI assume\b', r'\bnot sure\b', r'\bconfused\b'
        ]
        
        uncertainty_count = 0
        total_words = len(response.split())
        
        for pattern in uncertainty_indicators:
            matches = re.findall(pattern, response, re.IGNORECASE)
            uncertainty_count += len(matches)
        
        # Normalize by response length
        uncertainty_ratio = uncertainty_count / max(total_words, 1)
        
        # Also check for question marks (indicating uncertainty)
        question_marks = response.count('?')
        question_ratio = question_marks / max(len(response), 1)
        
        return uncertainty_ratio + question_ratio
    
    def identify_knowledge_gaps(self) -> List[Dict]:
        """Identify areas where the system lacks knowledge"""
        self.logger.info("Identifying knowledge gaps")
        
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        # Find topics with consistently low ratings or high uncertainty
        query = """
        SELECT 
            i.context,
            i.user_input,
            AVG(f.rating) as avg_rating,
            COUNT(*) as interaction_count,
            i.topic_category
        FROM interactions i
        LEFT JOIN feedback f ON i.id = f.interaction_id
        WHERE i.timestamp > datetime('now', '-30 days')
        GROUP BY COALESCE(i.topic_category, SUBSTR(i.user_input, 1, 50))
        HAVING interaction_count >= 3
        ORDER BY avg_rating ASC, interaction_count DESC
        """
        
        cursor.execute(query)
        rows = cursor.fetchall()
        conn.close()
        
        knowledge_gaps = []
        for row in rows:
            context, sample_input, avg_rating, count, topic_category = row
            
            # Identify as knowledge gap if low rating or no ratings
            if avg_rating is None or avg_rating < 3.0:
                knowledge_gaps.append({
                    'topic': topic_category or self._extract_topic(sample_input),
                    'context': context or '',
                    'sample_input': sample_input,
                    'avg_rating': avg_rating,
                    'interaction_count': count,
                    'gap_type': 'low_performance' if avg_rating else 'no_feedback'
                })
        
        self.logger.info(f"Identified {len(knowledge_gaps)} knowledge gaps")
        return knowledge_gaps
    
    def _extract_topic(self, user_input: str) -> str:
        """Extract topic from user input"""
        # Simple keyword extraction
        words = user_input.lower().split()
        
        # Filter out common words
        stop_words = {'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by'}
        keywords = [word for word in words if word not in stop_words and len(word) > 2]
        
        # Return first few keywords as topic
        return ' '.join(keywords[:3]) if keywords else 'general'
    
    def generate_clarifying_questions(self, uncertain_interactions: List[Dict], 
                                    max_questions: int = 10) -> List[Dict]:
        """Generate clarifying questions for uncertain areas"""
        self.logger.info(f"Generating clarifying questions for {len(uncertain_interactions)} interactions")
        
        questions = []
        
        for interaction in uncertain_interactions[:max_questions]:
            user_input = interaction['user_input']
            context = interaction['context']
            topic = self._extract_topic(user_input)
            
            # Select appropriate question template
            template = np.random.choice(self.question_templates)
            
            # Fill template
            try:
                if '{topic}' in template:
                    question = template.format(topic=topic)
                elif '{context}' in template:
                    question = template.format(context=context or 'this situation')
                elif '{task}' in template:
                    question = template.format(task=topic)
                else:
                    question = template
                    
            except KeyError:
                question = f"Can you provide more details about your request: '{user_input[:100]}...'?"
            
            questions.append({
                'question': question,
                'original_interaction_id': interaction['interaction_id'],
                'topic': topic,
                'uncertainty_score': interaction['uncertainty_score'],
                'priority': self._calculate_question_priority(interaction),
                'generated_at': datetime.now().isoformat()
            })
        
        # Sort by priority
        questions.sort(key=lambda x: x['priority'], reverse=True)
        
        self.logger.info(f"Generated {len(questions)} clarifying questions")
        return questions
    
    def _calculate_question_priority(self, interaction: Dict) -> float:
        """Calculate priority for asking clarifying questions"""
        base_priority = interaction['uncertainty_score']
        
        # Boost priority for recent interactions
        timestamp = datetime.fromisoformat(interaction['timestamp'])
        hours_ago = (datetime.now() - timestamp).total_seconds() / 3600
        recency_boost = max(0, (24 - hours_ago) / 24)  # Boost for last 24 hours
        
        # Boost priority for interactions without feedback
        # (This would require checking the database)
        
        return base_priority + (recency_boost * 0.5)
    
    def sample_diverse_examples(self, interactions: List[Dict], 
                               n_samples: int = 20) -> List[Dict]:
        """Sample diverse examples for annotation"""
        if len(interactions) <= n_samples:
            return interactions
        
        self.logger.info(f"Sampling {n_samples} diverse examples from {len(interactions)} interactions")
        
        # Extract features for diversity sampling
        features = []
        for interaction in interactions:
            # Simple feature extraction: word counts, length, etc.
            user_input = interaction['user_input']
            feature_vector = [
                len(user_input.split()),  # Word count
                len(user_input),  # Character count
                user_input.count('?'),  # Question marks
                interaction.get('uncertainty_score', 0),  # Uncertainty score
            ]
            features.append(feature_vector)
        
        features = np.array(features)
        
        # Use k-means clustering for diversity
        if len(interactions) > n_samples:
            kmeans = KMeans(n_clusters=n_samples, random_state=42)
            cluster_labels = kmeans.fit_predict(features)
            
            # Select one example from each cluster
            selected_interactions = []
            for cluster_id in range(n_samples):
                cluster_indices = np.where(cluster_labels == cluster_id)[0]
                if len(cluster_indices) > 0:
                    # Select the one closest to cluster center
                    cluster_center = kmeans.cluster_centers_[cluster_id]
                    cluster_features = features[cluster_indices]
                    distances = np.linalg.norm(cluster_features - cluster_center, axis=1)
                    best_idx = cluster_indices[np.argmin(distances)]
                    selected_interactions.append(interactions[best_idx])
            
            return selected_interactions
        
        return interactions[:n_samples]
    
    def identify_outlier_responses(self, days_back: int = 7) -> List[Dict]:
        """Identify outlier responses that may need review"""
        self.logger.info(f"Identifying outlier responses from last {days_back} days")
        
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        query = """
        SELECT 
            i.id,
            i.user_input,
            i.ai_response,
            i.context,
            i.timestamp,
            LENGTH(i.ai_response) as response_length
        FROM interactions i
        WHERE i.timestamp > datetime('now', '-{} days')
        ORDER BY response_length DESC
        """.format(days_back)
        
        cursor.execute(query)
        rows = cursor.fetchall()
        conn.close()
        
        if not rows:
            return []
        
        # Calculate response length statistics
        lengths = [row[5] for row in rows]
        mean_length = np.mean(lengths)
        std_length = np.std(lengths)
        
        outliers = []
        for row in rows:
            interaction_id, user_input, ai_response, context, timestamp, response_length = row
            
            # Identify outliers (very long or very short responses)
            z_score = abs(response_length - mean_length) / (std_length + 1e-6)
            
            if z_score > 2.0:  # 2 standard deviations
                outlier_type = 'very_long' if response_length > mean_length else 'very_short'
                
                outliers.append({
                    'interaction_id': interaction_id,
                    'user_input': user_input,
                    'ai_response': ai_response,
                    'context': context or '',
                    'timestamp': timestamp,
                    'response_length': response_length,
                    'z_score': z_score,
                    'outlier_type': outlier_type
                })
        
        self.logger.info(f"Identified {len(outliers)} outlier responses")
        return outliers
    
    async def active_learning_cycle(self) -> Dict[str, Any]:
        """Run complete active learning cycle"""
        self.logger.info("Starting active learning cycle")
        
        # 1. Identify uncertain interactions
        uncertain_interactions = self.identify_uncertain_interactions(days_back=7)
        
        # 2. Identify knowledge gaps
        knowledge_gaps = self.identify_knowledge_gaps()
        
        # 3. Generate clarifying questions
        questions = self.generate_clarifying_questions(uncertain_interactions)
        
        # 4. Sample diverse examples for annotation
        diverse_samples = self.sample_diverse_examples(uncertain_interactions)
        
        # 5. Identify outliers
        outliers = self.identify_outlier_responses()
        
        # 6. Save results to database
        self._save_active_learning_results({
            'uncertain_interactions': uncertain_interactions,
            'knowledge_gaps': knowledge_gaps,
            'questions': questions,
            'diverse_samples': diverse_samples,
            'outliers': outliers
        })
        
        results = {
            'cycle_timestamp': datetime.now().isoformat(),
            'num_uncertain_interactions': len(uncertain_interactions),
            'num_knowledge_gaps': len(knowledge_gaps),
            'num_questions_generated': len(questions),
            'num_diverse_samples': len(diverse_samples),
            'num_outliers': len(outliers),
            'top_uncertain_topics': [gap['topic'] for gap in knowledge_gaps[:5]],
            'next_questions': [q['question'] for q in questions[:3]]
        }
        
        self.logger.info(f"Active learning cycle complete: {results}")
        return results
    
    def _save_active_learning_results(self, results: Dict):
        """Save active learning results to database"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        # Create table if not exists
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS active_learning_cycles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT NOT NULL,
            results_json TEXT NOT NULL
        )
        """)
        
        # Save results
        cursor.execute("""
        INSERT INTO active_learning_cycles (timestamp, results_json)
        VALUES (?, ?)
        """, (
            datetime.now().isoformat(),
            json.dumps(results, default=str)
        ))
        
        conn.commit()
        conn.close()

if __name__ == "__main__":
    async def main():
        sampler = UncertaintySampler()
        results = await sampler.active_learning_cycle()
        print(f"Active learning results: {results}")
    
    asyncio.run(main())