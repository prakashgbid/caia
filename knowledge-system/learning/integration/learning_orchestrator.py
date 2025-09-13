#!/usr/bin/env python3
"""
Learning System Orchestrator
Coordinates all learning components for continuous improvement
"""

import os
import json
import time
import asyncio
import logging
import sqlite3
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional, Callable
from pathlib import Path
import threading
import queue
from concurrent.futures import ThreadPoolExecutor
import schedule

# Import learning components
import sys
sys.path.append(str(Path(__file__).parent.parent))

from training.fine_tuner import LocalModelFineTuner
from feedback.rlhf_trainer import RLHFTrainer
from active.uncertainty_sampler import UncertaintySampler
from continuous.interaction_logger import InteractionLogger
from personalization.user_profile import UserProfileBuilder

class LearningOrchestrator:
    """Main orchestrator for all learning systems"""
    
    def __init__(self, config_path: str = "learning_config.yaml"):
        self.config = self._load_config(config_path)
        self.setup_logging()
        
        # Initialize components
        self.fine_tuner = LocalModelFineTuner(config_path)
        self.rlhf_trainer = RLHFTrainer()
        self.uncertainty_sampler = UncertaintySampler(config_path)
        self.interaction_logger = InteractionLogger()
        self.profile_builder = UserProfileBuilder()
        
        # Orchestration state
        self.is_running = False
        self.learning_tasks = {}
        self.performance_metrics = {}
        self.last_learning_cycle = None
        
        # Task queue
        self.task_queue = queue.PriorityQueue()
        self.executor = ThreadPoolExecutor(max_workers=4)
        
        # Event system
        self.event_handlers = {}
        
    def setup_logging(self):
        """Setup comprehensive logging"""
        logging.basicConfig(
            level=logging.INFO,
            format='[LEARNING_ORCHESTRATOR] %(asctime)s - %(levelname)s - %(message)s',
            handlers=[
                logging.FileHandler('learning/logs/orchestrator.log'),
                logging.StreamHandler()
            ]
        )
        self.logger = logging.getLogger(__name__)
        
    def _load_config(self, config_path: str) -> Dict:
        """Load orchestrator configuration"""
        default_config = {
            "orchestrator": {
                "learning_cycle_interval": 3600,  # 1 hour
                "fine_tuning_threshold": 100,  # minimum interactions
                "rlhf_threshold": 50,  # minimum feedback items
                "active_learning_interval": 1800,  # 30 minutes
                "profile_update_interval": 900,  # 15 minutes
                "max_concurrent_tasks": 4,
                "auto_start": True
            },
            "triggers": {
                "new_interactions": 10,
                "feedback_received": 5,
                "uncertainty_detected": 3,
                "performance_drop": 0.1
            },
            "thresholds": {
                "min_confidence": 0.6,
                "max_uncertainty": 0.8,
                "satisfaction_threshold": 3.5,
                "engagement_threshold": 0.4
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
    
    async def start(self):
        """Start the learning orchestrator"""
        if self.is_running:
            self.logger.warning("Orchestrator already running")
            return
            
        self.logger.info("Starting Learning Orchestrator")
        self.is_running = True
        
        # Start component health monitoring
        await self._start_health_monitoring()
        
        # Schedule periodic tasks
        self._schedule_periodic_tasks()
        
        # Start event processing
        self._start_event_processing()
        
        # Initial learning cycle
        await self._initial_learning_cycle()
        
        # Start main orchestration loop
        await self._main_orchestration_loop()
        
    async def _start_health_monitoring(self):
        """Start monitoring component health"""
        self.logger.info("Starting component health monitoring")
        
        # Check database connectivity
        try:
            conn = sqlite3.connect("data/learning_interactions.db")
            conn.close()
            self.logger.info("Database connectivity: OK")
        except Exception as e:
            self.logger.error(f"Database connectivity: FAILED - {e}")
            
        # Check model availability
        try:
            models = await self.fine_tuner.get_ollama_models()
            self.logger.info(f"Available models: {len(models)}")
        except Exception as e:
            self.logger.warning(f"Model availability check failed: {e}")
    
    def _schedule_periodic_tasks(self):
        """Schedule periodic learning tasks"""
        config = self.config["orchestrator"]
        
        # Main learning cycle
        schedule.every(config["learning_cycle_interval"]).seconds.do(
            lambda: self._queue_task("learning_cycle", priority=1)
        )
        
        # Active learning cycle
        schedule.every(config["active_learning_interval"]).seconds.do(
            lambda: self._queue_task("active_learning", priority=2)
        )
        
        # Profile updates
        schedule.every(config["profile_update_interval"]).seconds.do(
            lambda: self._queue_task("profile_update", priority=3)
        )
        
        # Performance evaluation
        schedule.every().hour.do(
            lambda: self._queue_task("performance_evaluation", priority=2)
        )
        
        self.logger.info("Periodic tasks scheduled")
    
    def _start_event_processing(self):
        """Start processing learning events"""
        threading.Thread(target=self._event_processor_worker, daemon=True).start()
        self.logger.info("Event processing started")
    
    def _event_processor_worker(self):
        """Worker thread for processing events"""
        while self.is_running:
            try:
                # Process scheduled tasks
                schedule.run_pending()
                
                # Process queued tasks
                if not self.task_queue.empty():
                    priority, task_name, task_data = self.task_queue.get(timeout=1)
                    asyncio.create_task(self._execute_task(task_name, task_data))
                
                time.sleep(1)
                
            except queue.Empty:
                continue
            except Exception as e:
                self.logger.error(f"Error in event processor: {e}")
    
    def _queue_task(self, task_name: str, priority: int = 5, task_data: Dict = None):
        """Queue a learning task"""
        try:
            self.task_queue.put((priority, task_name, task_data or {}))
            self.logger.debug(f"Queued task: {task_name} (priority: {priority})")
        except queue.Full:
            self.logger.warning(f"Task queue full, dropping task: {task_name}")
    
    async def _execute_task(self, task_name: str, task_data: Dict):
        """Execute a learning task"""
        self.logger.info(f"Executing task: {task_name}")
        start_time = time.time()
        
        try:
            if task_name == "learning_cycle":
                await self._learning_cycle()
            elif task_name == "active_learning":
                await self._active_learning_cycle()
            elif task_name == "profile_update":
                await self._profile_update_cycle()
            elif task_name == "performance_evaluation":
                await self._performance_evaluation()
            elif task_name == "fine_tuning":
                await self._fine_tuning_cycle()
            elif task_name == "rlhf_training":
                await self._rlhf_training_cycle()
            else:
                self.logger.warning(f"Unknown task: {task_name}")
                return
            
            execution_time = time.time() - start_time
            self.logger.info(f"Task {task_name} completed in {execution_time:.2f}s")
            
        except Exception as e:
            self.logger.error(f"Task {task_name} failed: {e}")
    
    async def _initial_learning_cycle(self):
        """Perform initial learning setup"""
        self.logger.info("Performing initial learning cycle")
        
        # Build initial user profiles
        await self._profile_update_cycle()
        
        # Run initial active learning
        await self._active_learning_cycle()
        
        # Check for immediate learning opportunities
        await self._check_learning_opportunities()
        
        self.last_learning_cycle = datetime.now()
        self.logger.info("Initial learning cycle complete")
    
    async def _main_orchestration_loop(self):
        """Main orchestration loop"""
        self.logger.info("Starting main orchestration loop")
        
        while self.is_running:
            try:
                # Monitor system health
                await self._monitor_system_health()
                
                # Check for urgent learning triggers
                await self._check_urgent_triggers()
                
                # Update performance metrics
                await self._update_performance_metrics()
                
                # Sleep between cycles
                await asyncio.sleep(30)
                
            except Exception as e:
                self.logger.error(f"Error in orchestration loop: {e}")
                await asyncio.sleep(60)  # Wait longer on error
    
    async def _learning_cycle(self):
        """Complete learning cycle"""
        self.logger.info("Starting learning cycle")
        
        # 1. Check learning opportunities
        opportunities = await self._check_learning_opportunities()
        
        # 2. Execute learning based on opportunities
        if opportunities.get("fine_tuning_ready"):
            await self._fine_tuning_cycle()
        
        if opportunities.get("rlhf_ready"):
            await self._rlhf_training_cycle()
        
        # 3. Update user profiles
        await self._profile_update_cycle()
        
        # 4. Active learning
        await self._active_learning_cycle()
        
        # 5. Evaluate performance
        await self._performance_evaluation()
        
        self.last_learning_cycle = datetime.now()
        self.logger.info("Learning cycle complete")
    
    async def _check_learning_opportunities(self) -> Dict[str, bool]:
        """Check for learning opportunities"""
        opportunities = {
            "fine_tuning_ready": False,
            "rlhf_ready": False,
            "active_learning_needed": False,
            "profile_updates_needed": False
        }
        
        conn = sqlite3.connect("data/learning_interactions.db")
        cursor = conn.cursor()
        
        # Check for fine-tuning opportunities
        cursor.execute("""
        SELECT COUNT(*) FROM interactions 
        WHERE timestamp > COALESCE(
            (SELECT MAX(timestamp) FROM training_runs),
            datetime('now', '-7 days')
        )
        """)
        new_interactions = cursor.fetchone()[0]
        
        if new_interactions >= self.config["orchestrator"]["fine_tuning_threshold"]:
            opportunities["fine_tuning_ready"] = True
        
        # Check for RLHF opportunities
        cursor.execute("""
        SELECT COUNT(*) FROM feedback 
        WHERE timestamp > datetime('now', '-7 days')
        AND rating IS NOT NULL
        """)
        new_feedback = cursor.fetchone()[0]
        
        if new_feedback >= self.config["orchestrator"]["rlhf_threshold"]:
            opportunities["rlhf_ready"] = True
        
        # Check for active learning needs
        cursor.execute("""
        SELECT AVG(confidence_score) FROM interactions 
        WHERE timestamp > datetime('now', '-1 days')
        """)
        result = cursor.fetchone()
        avg_confidence = result[0] if result and result[0] else 1.0
        
        if avg_confidence < self.config["thresholds"]["min_confidence"]:
            opportunities["active_learning_needed"] = True
        
        conn.close()
        
        self.logger.info(f"Learning opportunities: {opportunities}")
        return opportunities
    
    async def _fine_tuning_cycle(self):
        """Execute fine-tuning cycle"""
        self.logger.info("Starting fine-tuning cycle")
        
        try:
            # Prepare data
            dataset = self.fine_tuner.prepare_training_data(days_back=7)
            
            if len(dataset) >= 10:
                # Fine-tune model
                model_path = await self.fine_tuner.fine_tune_model(dataset)
                
                # Convert to Ollama
                timestamp = int(time.time())
                model_name = f"caia_learned_{timestamp}"
                success = await self.fine_tuner.convert_to_ollama(model_path, model_name)
                
                if success:
                    self.logger.info(f"Fine-tuning complete: {model_name}")
                    
                    # Log learning event
                    self.interaction_logger.log_learning_event(
                        "fine_tuning_completed",
                        {
                            "model_name": model_name,
                            "model_path": model_path,
                            "training_samples": len(dataset)
                        },
                        importance_score=0.9
                    )
                else:
                    self.logger.error("Failed to convert model to Ollama")
            else:
                self.logger.info("Insufficient data for fine-tuning")
                
        except Exception as e:
            self.logger.error(f"Fine-tuning cycle failed: {e}")
    
    async def _rlhf_training_cycle(self):
        """Execute RLHF training cycle"""
        self.logger.info("Starting RLHF training cycle")
        
        try:
            # Load feedback data
            feedback_data = self.rlhf_trainer.load_feedback_data(days_back=7)
            
            if len(feedback_data) >= 5:
                # Perform RLHF training
                metrics = await self.rlhf_trainer.rlhf_training_step(feedback_data)
                
                self.logger.info(f"RLHF training complete: {metrics}")
                
                # Log learning event
                self.interaction_logger.log_learning_event(
                    "rlhf_training_completed",
                    {
                        "metrics": metrics,
                        "feedback_samples": len(feedback_data)
                    },
                    importance_score=0.8
                )
            else:
                self.logger.info("Insufficient feedback data for RLHF")
                
        except Exception as e:
            self.logger.error(f"RLHF training cycle failed: {e}")
    
    async def _active_learning_cycle(self):
        """Execute active learning cycle"""
        self.logger.info("Starting active learning cycle")
        
        try:
            results = await self.uncertainty_sampler.active_learning_cycle()
            
            self.logger.info(f"Active learning results: {results}")
            
            # Log learning event
            self.interaction_logger.log_learning_event(
                "active_learning_completed",
                results,
                importance_score=0.6
            )
            
        except Exception as e:
            self.logger.error(f"Active learning cycle failed: {e}")
    
    async def _profile_update_cycle(self):
        """Execute profile update cycle"""
        self.logger.info("Starting profile update cycle")
        
        try:
            # Get recent sessions
            conn = sqlite3.connect("data/learning_interactions.db")
            cursor = conn.cursor()
            
            cursor.execute("""
            SELECT DISTINCT session_id FROM interactions 
            WHERE timestamp > datetime('now', '-1 days')
            """)
            sessions = [row[0] for row in cursor.fetchall()]
            conn.close()
            
            # Update profiles for active sessions
            for session_id in sessions:
                user_id = self.profile_builder.identify_user(session_id)
                profile = self.profile_builder.build_user_profile(user_id, force_rebuild=True)
                self.logger.debug(f"Updated profile for user: {user_id}")
            
            self.logger.info(f"Updated profiles for {len(sessions)} users")
            
        except Exception as e:
            self.logger.error(f"Profile update cycle failed: {e}")
    
    async def _performance_evaluation(self):
        """Evaluate system performance"""
        self.logger.info("Starting performance evaluation")
        
        try:
            conn = sqlite3.connect("data/learning_interactions.db")
            cursor = conn.cursor()
            
            # Calculate recent performance metrics
            cursor.execute("""
            SELECT 
                AVG(confidence_score) as avg_confidence,
                AVG(user_satisfaction_predicted) as avg_satisfaction,
                AVG(response_time_ms) as avg_response_time,
                COUNT(*) as interaction_count
            FROM interactions 
            WHERE timestamp > datetime('now', '-1 days')
            """)
            
            row = cursor.fetchone()
            
            if row and row[3] > 0:  # If we have interactions
                metrics = {
                    'timestamp': datetime.now().isoformat(),
                    'avg_confidence': row[0] or 0.0,
                    'avg_satisfaction': row[1] or 0.0,
                    'avg_response_time': row[2] or 0.0,
                    'interaction_count': row[3],
                    'period': '24h'
                }
                
                self.performance_metrics['recent'] = metrics
                
                # Check for performance issues
                if metrics['avg_confidence'] < self.config["thresholds"]["min_confidence"]:
                    self._queue_task("active_learning", priority=1)
                
                if metrics['avg_satisfaction'] < self.config["thresholds"]["satisfaction_threshold"]:
                    self._queue_task("rlhf_training", priority=1)
                
                self.logger.info(f"Performance metrics: {metrics}")
                
                # Log performance event
                self.interaction_logger.log_learning_event(
                    "performance_evaluation",
                    metrics,
                    importance_score=0.5
                )
            
            conn.close()
            
        except Exception as e:
            self.logger.error(f"Performance evaluation failed: {e}")
    
    async def _monitor_system_health(self):
        """Monitor overall system health"""
        health_status = {
            'timestamp': datetime.now().isoformat(),
            'orchestrator_status': 'running',
            'components': {}
        }
        
        # Check component health
        try:
            # Check database
            conn = sqlite3.connect("data/learning_interactions.db")
            conn.close()
            health_status['components']['database'] = 'healthy'
        except:
            health_status['components']['database'] = 'unhealthy'
        
        # Check model availability
        try:
            models = await self.fine_tuner.get_ollama_models()
            health_status['components']['models'] = f'healthy ({len(models)} available)'
        except:
            health_status['components']['models'] = 'unhealthy'
        
        # Log health status periodically (every 10 minutes)
        current_time = datetime.now()
        if not hasattr(self, '_last_health_log') or \
           (current_time - self._last_health_log).seconds > 600:
            
            self.interaction_logger.log_learning_event(
                "system_health_check",
                health_status,
                importance_score=0.3
            )
            self._last_health_log = current_time
    
    async def _check_urgent_triggers(self):
        """Check for urgent learning triggers"""
        triggers = self.config["triggers"]
        
        # Check for recent interactions spike
        conn = sqlite3.connect("data/learning_interactions.db")
        cursor = conn.cursor()
        
        cursor.execute("""
        SELECT COUNT(*) FROM interactions 
        WHERE timestamp > datetime('now', '-10 minutes')
        """)
        recent_interactions = cursor.fetchone()[0]
        
        if recent_interactions >= triggers["new_interactions"]:
            self.logger.info(f"Interaction spike detected: {recent_interactions}")
            self._queue_task("profile_update", priority=2)
        
        # Check for negative feedback spike
        cursor.execute("""
        SELECT COUNT(*) FROM feedback 
        WHERE timestamp > datetime('now', '-30 minutes')
        AND rating <= 2
        """)
        negative_feedback = cursor.fetchone()[0]
        
        if negative_feedback >= triggers["feedback_received"]:
            self.logger.warning(f"Negative feedback spike: {negative_feedback}")
            self._queue_task("active_learning", priority=1)
            self._queue_task("rlhf_training", priority=1)
        
        conn.close()
    
    async def _update_performance_metrics(self):
        """Update running performance metrics"""
        # This would update real-time performance tracking
        # For now, we'll just log that we're monitoring
        pass
    
    def register_event_handler(self, event_type: str, handler: Callable):
        """Register event handler for learning events"""
        if event_type not in self.event_handlers:
            self.event_handlers[event_type] = []
        self.event_handlers[event_type].append(handler)
        
    def trigger_learning_event(self, event_type: str, event_data: Dict):
        """Trigger a learning event"""
        self.logger.info(f"Learning event triggered: {event_type}")
        
        # Execute registered handlers
        if event_type in self.event_handlers:
            for handler in self.event_handlers[event_type]:
                try:
                    handler(event_data)
                except Exception as e:
                    self.logger.error(f"Event handler failed: {e}")
        
        # Queue appropriate learning task
        if event_type == "low_confidence_detected":
            self._queue_task("active_learning", priority=1)
        elif event_type == "negative_feedback_received":
            self._queue_task("rlhf_training", priority=1)
        elif event_type == "new_user_detected":
            self._queue_task("profile_update", priority=2)
    
    async def stop(self):
        """Stop the learning orchestrator"""
        self.logger.info("Stopping Learning Orchestrator")
        self.is_running = False
        
        # Shutdown executor
        self.executor.shutdown(wait=True)
        
        # Cleanup components
        if hasattr(self.interaction_logger, 'cleanup'):
            self.interaction_logger.cleanup()
        
        self.logger.info("Learning Orchestrator stopped")
    
    def get_status(self) -> Dict[str, Any]:
        """Get orchestrator status"""
        return {
            'is_running': self.is_running,
            'last_learning_cycle': self.last_learning_cycle.isoformat() if self.last_learning_cycle else None,
            'task_queue_size': self.task_queue.qsize(),
            'performance_metrics': self.performance_metrics,
            'component_status': {
                'fine_tuner': 'active',
                'rlhf_trainer': 'active',
                'uncertainty_sampler': 'active',
                'interaction_logger': 'active',
                'profile_builder': 'active'
            }
        }

# Global orchestrator instance
_global_orchestrator = None

def get_learning_orchestrator() -> LearningOrchestrator:
    """Get global learning orchestrator instance"""
    global _global_orchestrator
    if _global_orchestrator is None:
        _global_orchestrator = LearningOrchestrator()
    return _global_orchestrator

if __name__ == "__main__":
    async def main():
        orchestrator = LearningOrchestrator()
        
        try:
            await orchestrator.start()
        except KeyboardInterrupt:
            await orchestrator.stop()
    
    asyncio.run(main())