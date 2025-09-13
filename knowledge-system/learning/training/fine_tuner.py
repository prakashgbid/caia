#!/usr/bin/env python3
"""
Advanced Fine-Tuner for Local Models
Implements LoRA/QLoRA fine-tuning with Ollama integration
"""

import os
import json
import time
import torch
import logging
import sqlite3
from datetime import datetime
from typing import List, Dict, Any, Optional, Tuple
from pathlib import Path
import asyncio
import httpx
from datasets import Dataset
from transformers import (
    AutoTokenizer, AutoModelForCausalLM, 
    TrainingArguments, Trainer,
    DataCollatorForLanguageModeling
)
from peft import LoraConfig, get_peft_model, TaskType
import bitsandbytes as bnb

class LocalModelFineTuner:
    """Advanced fine-tuning system for local models"""
    
    def __init__(self, config_path: str = "learning_config.yaml"):
        self.config = self._load_config(config_path)
        self.setup_logging()
        self.db_path = "data/learning_interactions.db"
        self.models_path = Path("learning/models")
        self.models_path.mkdir(exist_ok=True)
        
        # Ollama integration
        self.ollama_base_url = "http://localhost:11434"
        
        # Current model tracking
        self.current_model = None
        self.tokenizer = None
        
    def setup_logging(self):
        """Setup comprehensive logging"""
        logging.basicConfig(
            level=logging.INFO,
            format='[FINE_TUNER] %(asctime)s - %(levelname)s - %(message)s',
            handlers=[
                logging.FileHandler('learning/logs/fine_tuner.log'),
                logging.StreamHandler()
            ]
        )
        self.logger = logging.getLogger(__name__)
        
    def _load_config(self, config_path: str) -> Dict:
        """Load configuration with defaults"""
        default_config = {
            "training": {
                "batch_size": 4,
                "gradient_accumulation_steps": 4,
                "learning_rate": 5e-5,
                "num_epochs": 3,
                "warmup_steps": 100,
                "save_steps": 500,
                "eval_steps": 500,
                "logging_steps": 50,
                "max_seq_length": 2048
            },
            "lora": {
                "r": 16,
                "alpha": 32,
                "dropout": 0.1,
                "bias": "none",
                "target_modules": ["q_proj", "v_proj", "k_proj", "o_proj"]
            },
            "model": {
                "base_model": "microsoft/DialoGPT-medium",
                "quantization": "4bit",
                "device_map": "auto"
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
    
    async def get_ollama_models(self) -> List[str]:
        """Get available Ollama models"""
        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(f"{self.ollama_base_url}/api/tags")
                if response.status_code == 200:
                    data = response.json()
                    return [model["name"] for model in data.get("models", [])]
                return []
        except Exception as e:
            self.logger.error(f"Failed to get Ollama models: {e}")
            return []
    
    def prepare_training_data(self, days_back: int = 7) -> Dataset:
        """Prepare training data from recent interactions"""
        self.logger.info(f"Preparing training data from last {days_back} days")
        
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        # Get recent interactions with feedback
        query = """
        SELECT 
            i.user_input,
            i.ai_response,
            i.context,
            f.rating,
            f.feedback_text,
            i.timestamp
        FROM interactions i
        LEFT JOIN feedback f ON i.id = f.interaction_id
        WHERE i.timestamp > datetime('now', '-{} days')
        ORDER BY i.timestamp DESC
        """.format(days_back)
        
        cursor.execute(query)
        rows = cursor.fetchall()
        conn.close()
        
        # Convert to training format
        training_data = []
        for row in rows:
            user_input, ai_response, context, rating, feedback_text, timestamp = row
            
            # Create conversational format
            conversation = self._format_conversation(
                user_input, ai_response, context, rating, feedback_text
            )
            training_data.append({"text": conversation})
        
        self.logger.info(f"Prepared {len(training_data)} training examples")
        return Dataset.from_list(training_data)
    
    def _format_conversation(self, user_input: str, ai_response: str, 
                           context: str, rating: Optional[int], 
                           feedback_text: Optional[str]) -> str:
        """Format conversation for training"""
        conversation = f"<|system|>You are a helpful AI assistant learning from interactions.\n"
        
        if context:
            conversation += f"<|context|>{context}\n"
            
        conversation += f"<|user|>{user_input}\n"
        conversation += f"<|assistant|>{ai_response}\n"
        
        # Include feedback for RLHF-style training
        if rating is not None:
            conversation += f"<|rating|>{rating}\n"
        if feedback_text:
            conversation += f"<|feedback|>{feedback_text}\n"
            
        conversation += "<|endoftext|>"
        return conversation
    
    def setup_model_and_tokenizer(self, model_name: str):
        """Setup model and tokenizer with LoRA"""
        self.logger.info(f"Setting up model: {model_name}")
        
        # Load tokenizer
        self.tokenizer = AutoTokenizer.from_pretrained(model_name)
        if self.tokenizer.pad_token is None:
            self.tokenizer.pad_token = self.tokenizer.eos_token
        
        # Load model with quantization
        if self.config["model"]["quantization"] == "4bit":
            quantization_config = bnb.BitsAndBytesConfig(
                load_in_4bit=True,
                bnb_4bit_compute_dtype=torch.float16,
                bnb_4bit_use_double_quant=True,
                bnb_4bit_quant_type="nf4"
            )
        else:
            quantization_config = None
        
        model = AutoModelForCausalLM.from_pretrained(
            model_name,
            quantization_config=quantization_config,
            device_map=self.config["model"]["device_map"],
            torch_dtype=torch.float16
        )
        
        # Apply LoRA
        lora_config = LoraConfig(
            task_type=TaskType.CAUSAL_LM,
            r=self.config["lora"]["r"],
            lora_alpha=self.config["lora"]["alpha"],
            lora_dropout=self.config["lora"]["dropout"],
            bias=self.config["lora"]["bias"],
            target_modules=self.config["lora"]["target_modules"]
        )
        
        self.current_model = get_peft_model(model, lora_config)
        self.logger.info("Model and LoRA setup complete")
    
    def tokenize_data(self, dataset: Dataset) -> Dataset:
        """Tokenize dataset for training"""
        def tokenize_function(examples):
            return self.tokenizer(
                examples["text"],
                truncation=True,
                padding="max_length",
                max_length=self.config["training"]["max_seq_length"],
                return_tensors="pt"
            )
        
        return dataset.map(tokenize_function, batched=True)
    
    async def fine_tune_model(self, dataset: Dataset, 
                            model_name: str = None) -> str:
        """Fine-tune model with the prepared dataset"""
        if model_name is None:
            model_name = self.config["model"]["base_model"]
            
        self.logger.info(f"Starting fine-tuning process for {model_name}")
        
        # Setup model if not already done
        if self.current_model is None:
            self.setup_model_and_tokenizer(model_name)
        
        # Tokenize data
        tokenized_dataset = self.tokenize_data(dataset)
        
        # Split dataset
        train_size = int(0.9 * len(tokenized_dataset))
        train_dataset = tokenized_dataset.select(range(train_size))
        eval_dataset = tokenized_dataset.select(range(train_size, len(tokenized_dataset)))
        
        # Training arguments
        training_args = TrainingArguments(
            output_dir=f"learning/models/fine_tuned_{int(time.time())}",
            overwrite_output_dir=True,
            num_train_epochs=self.config["training"]["num_epochs"],
            per_device_train_batch_size=self.config["training"]["batch_size"],
            per_device_eval_batch_size=self.config["training"]["batch_size"],
            gradient_accumulation_steps=self.config["training"]["gradient_accumulation_steps"],
            learning_rate=self.config["training"]["learning_rate"],
            warmup_steps=self.config["training"]["warmup_steps"],
            save_steps=self.config["training"]["save_steps"],
            eval_steps=self.config["training"]["eval_steps"],
            logging_steps=self.config["training"]["logging_steps"],
            evaluation_strategy="steps",
            save_strategy="steps",
            load_best_model_at_end=True,
            metric_for_best_model="eval_loss",
            greater_is_better=False,
            remove_unused_columns=False,
            dataloader_pin_memory=False,
            fp16=True
        )
        
        # Data collator
        data_collator = DataCollatorForLanguageModeling(
            tokenizer=self.tokenizer,
            mlm=False
        )
        
        # Trainer
        trainer = Trainer(
            model=self.current_model,
            args=training_args,
            train_dataset=train_dataset,
            eval_dataset=eval_dataset,
            data_collator=data_collator,
            tokenizer=self.tokenizer
        )
        
        # Train
        self.logger.info("Starting training...")
        trainer.train()
        
        # Save model
        model_path = training_args.output_dir
        trainer.save_model(model_path)
        self.tokenizer.save_pretrained(model_path)
        
        self.logger.info(f"Fine-tuning complete. Model saved to: {model_path}")
        
        # Log training metrics
        self._log_training_metrics(trainer, model_path)
        
        return model_path
    
    def _log_training_metrics(self, trainer, model_path: str):
        """Log training metrics to database"""
        metrics = trainer.state.log_history[-1] if trainer.state.log_history else {}
        
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        cursor.execute("""
        INSERT OR REPLACE INTO training_runs 
        (timestamp, model_path, train_loss, eval_loss, learning_rate, epoch)
        VALUES (?, ?, ?, ?, ?, ?)
        """, (
            datetime.now().isoformat(),
            model_path,
            metrics.get("train_loss", 0),
            metrics.get("eval_loss", 0),
            metrics.get("learning_rate", 0),
            metrics.get("epoch", 0)
        ))
        
        conn.commit()
        conn.close()
    
    async def convert_to_ollama(self, model_path: str, 
                              model_name: str) -> bool:
        """Convert fine-tuned model to Ollama format"""
        try:
            self.logger.info(f"Converting model to Ollama format: {model_name}")
            
            # Create Modelfile
            modelfile_content = f"""
FROM {model_path}
TEMPLATE \"\"\"
<|system|>{{{{ .System }}}}
<|user|>{{{{ .Prompt }}}}
<|assistant|>
\"\"\"
PARAMETER temperature 0.7
PARAMETER top_p 0.9
PARAMETER stop "<|endoftext|>"
PARAMETER stop "<|user|>"
PARAMETER stop "<|system|>"
"""
            
            modelfile_path = Path(model_path) / "Modelfile"
            with open(modelfile_path, 'w') as f:
                f.write(modelfile_content)
            
            # Create model in Ollama
            async with httpx.AsyncClient(timeout=300.0) as client:
                response = await client.post(
                    f"{self.ollama_base_url}/api/create",
                    json={
                        "name": model_name,
                        "modelfile": modelfile_content
                    }
                )
                
                if response.status_code == 200:
                    self.logger.info(f"Model {model_name} created in Ollama")
                    return True
                else:
                    self.logger.error(f"Failed to create Ollama model: {response.text}")
                    return False
                    
        except Exception as e:
            self.logger.error(f"Error converting to Ollama: {e}")
            return False
    
    async def incremental_training(self, min_interactions: int = 50):
        """Perform incremental training when enough new data is available"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        # Check for new interactions since last training
        cursor.execute("""
        SELECT COUNT(*) FROM interactions 
        WHERE timestamp > COALESCE(
            (SELECT MAX(timestamp) FROM training_runs), 
            datetime('now', '-7 days')
        )
        """)
        
        new_interactions = cursor.fetchone()[0]
        conn.close()
        
        if new_interactions >= min_interactions:
            self.logger.info(f"Found {new_interactions} new interactions, starting incremental training")
            
            # Prepare data and train
            dataset = self.prepare_training_data(days_back=1)  # Only recent data
            model_path = await self.fine_tune_model(dataset)
            
            # Convert to Ollama
            timestamp = int(time.time())
            ollama_model_name = f"caia_learned_{timestamp}"
            success = await self.convert_to_ollama(model_path, ollama_model_name)
            
            if success:
                self.logger.info(f"Incremental training complete: {ollama_model_name}")
                return ollama_model_name
            
        return None
    
    async def evaluate_model(self, model_path: str) -> Dict[str, float]:
        """Evaluate model performance"""
        self.logger.info(f"Evaluating model: {model_path}")
        
        # Load test data
        test_dataset = self.prepare_training_data(days_back=30)
        test_dataset = test_dataset.select(range(min(100, len(test_dataset))))
        
        # Setup model if needed
        if self.current_model is None:
            self.setup_model_and_tokenizer(model_path)
        
        # Tokenize test data
        tokenized_test = self.tokenize_data(test_dataset)
        
        # Evaluate
        trainer = Trainer(
            model=self.current_model,
            tokenizer=self.tokenizer
        )
        
        results = trainer.evaluate(eval_dataset=tokenized_test)
        
        self.logger.info(f"Evaluation results: {results}")
        return results

# Initialize database tables
def init_training_tables():
    """Initialize training-related database tables"""
    conn = sqlite3.connect("data/learning_interactions.db")
    cursor = conn.cursor()
    
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS training_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL,
        model_path TEXT NOT NULL,
        train_loss REAL,
        eval_loss REAL,
        learning_rate REAL,
        epoch INTEGER,
        performance_metrics TEXT
    )
    """)
    
    conn.commit()
    conn.close()

if __name__ == "__main__":
    # Initialize tables
    init_training_tables()
    
    # Run fine-tuning
    async def main():
        fine_tuner = LocalModelFineTuner()
        
        # Prepare data
        dataset = fine_tuner.prepare_training_data(days_back=7)
        
        if len(dataset) > 10:
            # Fine-tune model
            model_path = await fine_tuner.fine_tune_model(dataset)
            
            # Convert to Ollama
            timestamp = int(time.time())
            ollama_name = f"caia_custom_{timestamp}"
            await fine_tuner.convert_to_ollama(model_path, ollama_name)
            
            print(f"Fine-tuning complete! New model: {ollama_name}")
        else:
            print("Not enough training data available")
    
    asyncio.run(main())