#!/usr/bin/env python3
"""
Reinforcement Learning from Human Feedback (RLHF) Trainer
Advanced RLHF implementation for continuous learning from user feedback
"""

import os
import json
import torch
import numpy as np
import logging
import sqlite3
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional, Tuple
from pathlib import Path
import asyncio
from dataclasses import dataclass
from transformers import (
    AutoTokenizer, AutoModelForCausalLM,
    TrainingArguments, Trainer
)
from torch.nn import CrossEntropyLoss
import torch.nn.functional as F
from collections import defaultdict

@dataclass
class RLHFConfig:
    """RLHF Training Configuration"""
    reward_model_lr: float = 1e-5
    policy_model_lr: float = 5e-6
    kl_penalty: float = 0.2
    cliprange: float = 0.2
    value_loss_coeff: float = 0.1
    entropy_coeff: float = 0.01
    gamma: float = 0.99
    lam: float = 0.95
    ppo_epochs: int = 4
    batch_size: int = 16
    gradient_accumulation_steps: int = 2

class RewardModel(torch.nn.Module):
    """Reward model for RLHF training"""
    
    def __init__(self, base_model_name: str):
        super().__init__()
        self.base_model = AutoModelForCausalLM.from_pretrained(
            base_model_name,
            torch_dtype=torch.float16
        )
        
        # Add reward head
        hidden_size = self.base_model.config.hidden_size
        self.reward_head = torch.nn.Linear(hidden_size, 1)
        
    def forward(self, input_ids, attention_mask=None):
        outputs = self.base_model(
            input_ids=input_ids,
            attention_mask=attention_mask,
            output_hidden_states=True
        )
        
        # Use last hidden state for reward prediction
        hidden_states = outputs.hidden_states[-1]
        
        # Pool the sequence dimension (mean pooling)
        if attention_mask is not None:
            masked_hidden = hidden_states * attention_mask.unsqueeze(-1)
            pooled = masked_hidden.sum(dim=1) / attention_mask.sum(dim=1, keepdim=True)
        else:
            pooled = hidden_states.mean(dim=1)
        
        reward = self.reward_head(pooled)
        return reward.squeeze(-1)

class RLHFTrainer:
    """Advanced RLHF trainer with PPO and reward modeling"""
    
    def __init__(self, config: RLHFConfig = None):
        self.config = config or RLHFConfig()
        self.setup_logging()
        self.db_path = "data/learning_interactions.db"
        
        # Models
        self.reward_model = None
        self.policy_model = None
        self.reference_model = None
        self.tokenizer = None
        
        # Training state
        self.training_history = []
        self.reward_history = []
        
    def setup_logging(self):
        """Setup comprehensive logging"""
        logging.basicConfig(
            level=logging.INFO,
            format='[RLHF_TRAINER] %(asctime)s - %(levelname)s - %(message)s',
            handlers=[
                logging.FileHandler('learning/logs/rlhf_trainer.log'),
                logging.StreamHandler()
            ]
        )
        self.logger = logging.getLogger(__name__)
    
    def load_feedback_data(self, days_back: int = 30) -> List[Dict]:
        """Load feedback data for training"""
        self.logger.info(f"Loading feedback data from last {days_back} days")
        
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        # Get interactions with explicit feedback
        query = """
        SELECT 
            i.id,
            i.user_input,
            i.ai_response,
            i.context,
            f.rating,
            f.feedback_text,
            f.feedback_type,
            i.timestamp
        FROM interactions i
        INNER JOIN feedback f ON i.id = f.interaction_id
        WHERE i.timestamp > datetime('now', '-{} days')
        AND f.rating IS NOT NULL
        ORDER BY i.timestamp DESC
        """.format(days_back)
        
        cursor.execute(query)
        rows = cursor.fetchall()
        conn.close()
        
        feedback_data = []
        for row in rows:
            interaction_id, user_input, ai_response, context, rating, feedback_text, feedback_type, timestamp = row
            
            feedback_data.append({
                'interaction_id': interaction_id,
                'user_input': user_input,
                'ai_response': ai_response,
                'context': context or "",
                'rating': rating,
                'feedback_text': feedback_text or "",
                'feedback_type': feedback_type,
                'timestamp': timestamp
            })
        
        self.logger.info(f"Loaded {len(feedback_data)} feedback examples")
        return feedback_data
    
    def prepare_reward_training_data(self, feedback_data: List[Dict]) -> List[Tuple]:
        """Prepare data for reward model training"""
        training_pairs = []
        
        # Group by user input to create preference pairs
        input_groups = defaultdict(list)
        for item in feedback_data:
            key = item['user_input']
            input_groups[key].append(item)
        
        # Create preference pairs
        for user_input, responses in input_groups.items():
            if len(responses) < 2:
                continue
                
            # Sort by rating
            responses.sort(key=lambda x: x['rating'], reverse=True)
            
            # Create pairs: higher rated vs lower rated
            for i in range(len(responses)):
                for j in range(i + 1, len(responses)):
                    if responses[i]['rating'] > responses[j]['rating']:
                        training_pairs.append((
                            {
                                'input': user_input,
                                'response': responses[i]['ai_response'],
                                'context': responses[i]['context']
                            },
                            {
                                'input': user_input,
                                'response': responses[j]['ai_response'],
                                'context': responses[j]['context']
                            },
                            1  # First is preferred
                        ))
        
        self.logger.info(f"Created {len(training_pairs)} preference pairs")
        return training_pairs
    
    def setup_models(self, model_name: str = "microsoft/DialoGPT-medium"):
        """Setup reward and policy models"""
        self.logger.info(f"Setting up models: {model_name}")
        
        # Tokenizer
        self.tokenizer = AutoTokenizer.from_pretrained(model_name)
        if self.tokenizer.pad_token is None:
            self.tokenizer.pad_token = self.tokenizer.eos_token
        
        # Reward model
        self.reward_model = RewardModel(model_name)
        
        # Policy model (for generation)
        self.policy_model = AutoModelForCausalLM.from_pretrained(
            model_name,
            torch_dtype=torch.float16
        )
        
        # Reference model (frozen copy for KL penalty)
        self.reference_model = AutoModelForCausalLM.from_pretrained(
            model_name,
            torch_dtype=torch.float16
        )
        
        # Freeze reference model
        for param in self.reference_model.parameters():
            param.requires_grad = False
    
    def train_reward_model(self, preference_pairs: List[Tuple], 
                          epochs: int = 3) -> float:
        """Train reward model on preference pairs"""
        self.logger.info(f"Training reward model for {epochs} epochs")
        
        if not preference_pairs:
            self.logger.warning("No preference pairs available for reward training")
            return 0.0
        
        device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        self.reward_model.to(device)
        
        optimizer = torch.optim.AdamW(
            self.reward_model.parameters(),
            lr=self.config.reward_model_lr
        )
        
        total_loss = 0.0
        batch_size = self.config.batch_size
        
        for epoch in range(epochs):
            epoch_loss = 0.0
            
            # Shuffle pairs
            np.random.shuffle(preference_pairs)
            
            for i in range(0, len(preference_pairs), batch_size):
                batch = preference_pairs[i:i + batch_size]
                
                # Prepare batch
                chosen_inputs = []
                rejected_inputs = []
                
                for chosen, rejected, _ in batch:
                    chosen_text = f"Context: {chosen['context']}\nUser: {chosen['input']}\nAssistant: {chosen['response']}"
                    rejected_text = f"Context: {rejected['context']}\nUser: {rejected['input']}\nAssistant: {rejected['response']}"
                    
                    chosen_inputs.append(chosen_text)
                    rejected_inputs.append(rejected_text)
                
                # Tokenize
                chosen_tokens = self.tokenizer(
                    chosen_inputs,
                    padding=True,
                    truncation=True,
                    max_length=512,
                    return_tensors="pt"
                ).to(device)
                
                rejected_tokens = self.tokenizer(
                    rejected_inputs,
                    padding=True,
                    truncation=True,
                    max_length=512,
                    return_tensors="pt"
                ).to(device)
                
                # Forward pass
                chosen_rewards = self.reward_model(
                    chosen_tokens.input_ids,
                    chosen_tokens.attention_mask
                )
                
                rejected_rewards = self.reward_model(
                    rejected_tokens.input_ids,
                    rejected_tokens.attention_mask
                )
                
                # Loss: chosen should have higher reward than rejected
                loss = -torch.log(torch.sigmoid(chosen_rewards - rejected_rewards)).mean()
                
                # Backward pass
                optimizer.zero_grad()
                loss.backward()
                optimizer.step()
                
                epoch_loss += loss.item()
            
            avg_epoch_loss = epoch_loss / (len(preference_pairs) // batch_size)
            total_loss += avg_epoch_loss
            
            self.logger.info(f"Epoch {epoch + 1}, Loss: {avg_epoch_loss:.4f}")
        
        avg_loss = total_loss / epochs
        self.logger.info(f"Reward model training complete. Average loss: {avg_loss:.4f}")
        return avg_loss
    
    def compute_advantages(self, rewards: torch.Tensor, 
                          values: torch.Tensor) -> torch.Tensor:
        """Compute GAE advantages"""
        advantages = torch.zeros_like(rewards)
        last_gae_lambda = 0
        
        for t in reversed(range(len(rewards))):
            if t == len(rewards) - 1:
                next_non_terminal = 0
                next_values = 0
            else:
                next_non_terminal = 1
                next_values = values[t + 1]
            
            delta = rewards[t] + self.config.gamma * next_values * next_non_terminal - values[t]
            advantages[t] = last_gae_lambda = delta + self.config.gamma * self.config.lam * next_non_terminal * last_gae_lambda
        
        return advantages
    
    def ppo_update(self, states: List[str], actions: List[str], 
                   old_log_probs: torch.Tensor, advantages: torch.Tensor,
                   returns: torch.Tensor) -> Dict[str, float]:
        """Perform PPO update"""
        device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        self.policy_model.to(device)
        
        optimizer = torch.optim.AdamW(
            self.policy_model.parameters(),
            lr=self.config.policy_model_lr
        )
        
        metrics = {'policy_loss': 0, 'value_loss': 0, 'kl_div': 0}
        
        for epoch in range(self.config.ppo_epochs):
            # Tokenize current batch
            full_texts = [f"{state}\n{action}" for state, action in zip(states, actions)]
            tokens = self.tokenizer(
                full_texts,
                padding=True,
                truncation=True,
                max_length=512,
                return_tensors="pt"
            ).to(device)
            
            # Forward pass
            outputs = self.policy_model(**tokens)
            logits = outputs.logits
            
            # Compute log probabilities
            log_probs = F.log_softmax(logits, dim=-1)
            action_log_probs = torch.gather(log_probs, -1, tokens.input_ids.unsqueeze(-1)).squeeze(-1)
            action_log_probs = action_log_probs.sum(dim=1)  # Sum over sequence length
            
            # Compute ratio
            ratio = torch.exp(action_log_probs - old_log_probs)
            
            # Clipped surrogate loss
            surr1 = ratio * advantages
            surr2 = torch.clamp(ratio, 1 - self.config.cliprange, 1 + self.config.cliprange) * advantages
            policy_loss = -torch.min(surr1, surr2).mean()
            
            # KL penalty with reference model
            with torch.no_grad():
                ref_outputs = self.reference_model(**tokens)
                ref_logits = ref_outputs.logits
                ref_log_probs = F.log_softmax(ref_logits, dim=-1)
                ref_action_log_probs = torch.gather(ref_log_probs, -1, tokens.input_ids.unsqueeze(-1)).squeeze(-1)
                ref_action_log_probs = ref_action_log_probs.sum(dim=1)
            
            kl_div = (action_log_probs - ref_action_log_probs).mean()
            
            # Total loss
            total_loss = policy_loss + self.config.kl_penalty * kl_div
            
            # Update
            optimizer.zero_grad()
            total_loss.backward()
            torch.nn.utils.clip_grad_norm_(self.policy_model.parameters(), 1.0)
            optimizer.step()
            
            # Metrics
            metrics['policy_loss'] += policy_loss.item()
            metrics['kl_div'] += kl_div.item()
        
        # Average over epochs
        for key in metrics:
            metrics[key] /= self.config.ppo_epochs
        
        return metrics
    
    async def rlhf_training_step(self, feedback_data: List[Dict]) -> Dict[str, Any]:
        """Perform one RLHF training step"""
        self.logger.info("Starting RLHF training step")
        
        # 1. Train reward model
        preference_pairs = self.prepare_reward_training_data(feedback_data)
        if preference_pairs:
            reward_loss = self.train_reward_model(preference_pairs)
        else:
            reward_loss = 0.0
        
        # 2. Generate rollouts and compute rewards
        rollouts = self.generate_rollouts(feedback_data[:10])  # Use subset for efficiency
        
        # 3. PPO update
        if rollouts:
            ppo_metrics = self.ppo_update(**rollouts)
        else:
            ppo_metrics = {}
        
        # 4. Log metrics
        step_metrics = {
            'timestamp': datetime.now().isoformat(),
            'reward_loss': reward_loss,
            'num_preference_pairs': len(preference_pairs),
            'num_rollouts': len(rollouts) if rollouts else 0,
            **ppo_metrics
        }
        
        self.training_history.append(step_metrics)
        self.logger.info(f"RLHF step complete: {step_metrics}")
        
        return step_metrics
    
    def generate_rollouts(self, feedback_data: List[Dict]) -> Dict:
        """Generate rollouts for PPO training"""
        if not feedback_data or self.policy_model is None:
            return {}
        
        device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        self.policy_model.to(device)
        self.reward_model.to(device)
        
        states = []
        actions = []
        rewards = []
        log_probs = []
        
        for item in feedback_data[:5]:  # Limit for efficiency
            state = f"Context: {item['context']}\nUser: {item['user_input']}\nAssistant:"
            
            # Generate response
            input_ids = self.tokenizer.encode(state, return_tensors="pt").to(device)
            
            with torch.no_grad():
                outputs = self.policy_model.generate(
                    input_ids,
                    max_new_tokens=100,
                    do_sample=True,
                    temperature=0.7,
                    pad_token_id=self.tokenizer.eos_token_id,
                    return_dict_in_generate=True,
                    output_scores=True
                )
            
            generated_ids = outputs.sequences[0][len(input_ids[0]):]
            action = self.tokenizer.decode(generated_ids, skip_special_tokens=True)
            
            # Compute reward
            full_text = state + action
            reward_input = self.tokenizer(
                full_text,
                return_tensors="pt",
                truncation=True,
                max_length=512
            ).to(device)
            
            with torch.no_grad():
                reward = self.reward_model(
                    reward_input.input_ids,
                    reward_input.attention_mask
                ).item()
            
            # Compute log probability (simplified)
            log_prob = -len(generated_ids) * 0.1  # Placeholder
            
            states.append(state)
            actions.append(action)
            rewards.append(reward)
            log_probs.append(log_prob)
        
        if not states:
            return {}
        
        # Convert to tensors
        rewards_tensor = torch.tensor(rewards, dtype=torch.float32)
        log_probs_tensor = torch.tensor(log_probs, dtype=torch.float32)
        
        # Compute advantages (simplified)
        advantages = rewards_tensor - rewards_tensor.mean()
        returns = rewards_tensor
        
        return {
            'states': states,
            'actions': actions,
            'old_log_probs': log_probs_tensor,
            'advantages': advantages,
            'returns': returns
        }
    
    def save_models(self, checkpoint_dir: str):
        """Save trained models"""
        checkpoint_path = Path(checkpoint_dir)
        checkpoint_path.mkdir(parents=True, exist_ok=True)
        
        # Save reward model
        torch.save(
            self.reward_model.state_dict(),
            checkpoint_path / "reward_model.pt"
        )
        
        # Save policy model
        self.policy_model.save_pretrained(checkpoint_path / "policy_model")
        
        # Save tokenizer
        self.tokenizer.save_pretrained(checkpoint_path / "tokenizer")
        
        # Save training history
        with open(checkpoint_path / "training_history.json", 'w') as f:
            json.dump(self.training_history, f, indent=2)
        
        self.logger.info(f"Models saved to {checkpoint_path}")
    
    async def continuous_rlhf_training(self, check_interval: int = 3600):
        """Run continuous RLHF training"""
        self.logger.info("Starting continuous RLHF training")
        
        while True:
            try:
                # Check for new feedback
                feedback_data = self.load_feedback_data(days_back=7)
                
                if len(feedback_data) >= 10:  # Minimum threshold
                    # Setup models if needed
                    if self.policy_model is None:
                        self.setup_models()
                    
                    # Perform training step
                    metrics = await self.rlhf_training_step(feedback_data)
                    
                    # Save periodically
                    if len(self.training_history) % 5 == 0:
                        checkpoint_dir = f"learning/models/rlhf_checkpoint_{int(datetime.now().timestamp())}"
                        self.save_models(checkpoint_dir)
                
                # Wait before next check
                await asyncio.sleep(check_interval)
                
            except Exception as e:
                self.logger.error(f"Error in continuous training: {e}")
                await asyncio.sleep(300)  # Wait 5 minutes on error

if __name__ == "__main__":
    async def main():
        trainer = RLHFTrainer()
        
        # Load feedback data
        feedback_data = trainer.load_feedback_data(days_back=30)
        
        if len(feedback_data) >= 5:
            # Setup models
            trainer.setup_models()
            
            # Perform training step
            metrics = await trainer.rlhf_training_step(feedback_data)
            print(f"Training complete: {metrics}")
            
            # Save models
            trainer.save_models("learning/models/rlhf_latest")
        else:
            print("Not enough feedback data for RLHF training")
    
    asyncio.run(main())