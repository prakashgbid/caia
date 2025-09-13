#!/usr/bin/env python3
"""
Comprehensive Test Suite for CAIA Phase 3 Learning System
Tests all learning components and integration
"""

import os
import sys
import json
import time
import asyncio
import sqlite3
import logging
from pathlib import Path
from datetime import datetime
import unittest
from unittest.mock import Mock, patch

# Add learning modules to path
sys.path.append(str(Path(__file__).parent / "learning"))

# Import learning components
from training.fine_tuner import LocalModelFineTuner
from feedback.rlhf_trainer import RLHFTrainer
from active.uncertainty_sampler import UncertaintySampler
from continuous.interaction_logger import InteractionLogger, get_interaction_logger
from personalization.user_profile import UserProfileBuilder
from integration.learning_orchestrator import LearningOrchestrator, get_learning_orchestrator

class LearningSystemTests(unittest.TestCase):
    """Comprehensive test suite for learning system"""
    
    @classmethod
    def setUpClass(cls):
        """Set up test environment"""
        cls.test_db_path = "data/test_learning_interactions.db"
        cls.setup_test_database()
        
        # Setup logging
        logging.basicConfig(level=logging.INFO)
        cls.logger = logging.getLogger(__name__)
        
    @classmethod
    def tearDownClass(cls):
        """Clean up test environment"""
        if os.path.exists(cls.test_db_path):
            os.remove(cls.test_db_path)
    
    @classmethod
    def setup_test_database(cls):
        """Setup test database with sample data"""
        # Ensure data directory exists
        os.makedirs("data", exist_ok=True)
        
        conn = sqlite3.connect(cls.test_db_path)
        cursor = conn.cursor()
        
        # Create sample interactions
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS interactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT NOT NULL,
            interaction_sequence INTEGER,
            timestamp TEXT NOT NULL,
            user_input TEXT,
            ai_response TEXT,
            context TEXT,
            conversation_turn INTEGER,
            input_tokens INTEGER,
            output_tokens INTEGER,
            response_time_ms REAL,
            confidence_score REAL,
            topic_category TEXT,
            intent_classification TEXT,
            sentiment_score REAL,
            complexity_score REAL,
            user_satisfaction_predicted REAL,
            system_metrics TEXT,
            metadata TEXT
        )
        """)
        
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS feedback (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            interaction_id INTEGER,
            session_id TEXT,
            feedback_type TEXT,
            rating INTEGER,
            feedback_text TEXT,
            timestamp TEXT,
            implicit_feedback TEXT
        )
        """)
        
        # Insert sample data
        sample_interactions = [
            ("session_1", "How do I implement a neural network?", "To implement a neural network...", "programming", 4, 0.8),
            ("session_1", "What about deep learning?", "Deep learning involves...", "ai_ml", 5, 0.9),
            ("session_2", "How to debug Python code?", "For debugging Python...", "programming", 3, 0.6),
            ("session_2", "What are best practices?", "Best practices include...", "general", 4, 0.7),
            ("session_3", "Explain machine learning", "Machine learning is...", "ai_ml", 5, 0.95),
        ]
        
        for i, (session, user_input, ai_response, topic, rating, confidence) in enumerate(sample_interactions):
            cursor.execute("""
            INSERT INTO interactions (
                session_id, interaction_sequence, timestamp, user_input, ai_response,
                topic_category, confidence_score, user_satisfaction_predicted
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                session, i+1, datetime.now().isoformat(), user_input, ai_response,
                topic, confidence, rating
            ))
            
            # Add feedback
            cursor.execute("""
            INSERT INTO feedback (interaction_id, session_id, feedback_type, rating, timestamp)
            VALUES (?, ?, 'explicit', ?, ?)
            """, (i+1, session, rating, datetime.now().isoformat()))
        
        conn.commit()
        conn.close()
    
    def test_interaction_logger(self):
        """Test interaction logging functionality"""
        self.logger.info("Testing Interaction Logger...")
        
        # Create logger with test database
        logger = InteractionLogger(self.test_db_path)
        
        # Test logging interaction
        interaction_id = logger.log_interaction(
            user_input="Test user input",
            ai_response="Test AI response",
            context="Test context",
            response_time_ms=150.5
        )
        
        self.assertIsInstance(interaction_id, int)
        self.logger.info("✅ Interaction logging works")
        
        # Test feedback logging
        logger.log_feedback(
            interaction_id=1,
            feedback_type="explicit",
            rating=4,
            feedback_text="Good response"
        )
        
        # Test session stats
        stats = logger.get_session_stats()
        self.assertIn('session_id', stats)
        self.logger.info("✅ Session stats work")
        
        # Cleanup
        logger.cleanup()
        
    def test_user_profile_builder(self):
        """Test user profile building"""
        self.logger.info("Testing User Profile Builder...")
        
        # Create profile builder with test database
        builder = UserProfileBuilder(self.test_db_path)
        
        # Test profile building
        user_id = "test_user_123"
        profile = builder.build_user_profile(user_id)
        
        self.assertIn('user_id', profile)
        self.assertIn('preferences', profile)
        self.assertIn('behavior_patterns', profile)
        self.logger.info("✅ User profile building works")
        
        # Test personalization context
        context = builder.get_personalization_context(user_id)
        self.assertIn('communication_style', context)
        self.logger.info("✅ Personalization context works")
    
    @patch('httpx.AsyncClient')
    async def test_uncertainty_sampler(self, mock_client):
        """Test uncertainty sampling"""
        self.logger.info("Testing Uncertainty Sampler...")
        
        # Mock the HTTP client for Ollama
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"models": [{"name": "test_model"}]}
        mock_client.return_value.__aenter__.return_value.get.return_value = mock_response
        
        # Create sampler with test database
        sampler = UncertaintySampler()
        sampler.db_path = self.test_db_path
        
        # Test uncertain interaction identification
        uncertain_interactions = sampler.identify_uncertain_interactions(days_back=30)
        self.assertIsInstance(uncertain_interactions, list)
        self.logger.info(f"✅ Found {len(uncertain_interactions)} uncertain interactions")
        
        # Test knowledge gap identification
        gaps = sampler.identify_knowledge_gaps()
        self.assertIsInstance(gaps, list)
        self.logger.info(f"✅ Found {len(gaps)} knowledge gaps")
        
        # Test question generation
        if uncertain_interactions:
            questions = sampler.generate_clarifying_questions(uncertain_interactions[:3])
            self.assertIsInstance(questions, list)
            self.logger.info(f"✅ Generated {len(questions)} clarifying questions")
    
    async def test_fine_tuner(self):
        """Test fine-tuning capabilities"""
        self.logger.info("Testing Fine Tuner...")
        
        # Create fine-tuner
        fine_tuner = LocalModelFineTuner()
        fine_tuner.db_path = self.test_db_path
        
        # Test data preparation
        dataset = fine_tuner.prepare_training_data(days_back=30)
        self.assertIsNotNone(dataset)
        self.logger.info(f"✅ Prepared dataset with {len(dataset)} samples")
        
        # Note: We skip actual fine-tuning in tests as it requires significant resources
        self.logger.info("✅ Fine-tuner data preparation works")
    
    async def test_rlhf_trainer(self):
        """Test RLHF trainer"""
        self.logger.info("Testing RLHF Trainer...")
        
        # Create RLHF trainer
        trainer = RLHFTrainer()
        trainer.db_path = self.test_db_path
        
        # Test feedback data loading
        feedback_data = trainer.load_feedback_data(days_back=30)
        self.assertIsInstance(feedback_data, list)
        self.logger.info(f"✅ Loaded {len(feedback_data)} feedback items")
        
        # Test preference pair preparation
        if feedback_data:
            pairs = trainer.prepare_reward_training_data(feedback_data)
            self.assertIsInstance(pairs, list)
            self.logger.info(f"✅ Created {len(pairs)} preference pairs")
    
    async def test_learning_orchestrator(self):
        """Test learning orchestrator"""
        self.logger.info("Testing Learning Orchestrator...")
        
        # Create orchestrator
        orchestrator = LearningOrchestrator()
        
        # Patch database path for all components
        orchestrator.interaction_logger.db_path = self.test_db_path
        orchestrator.profile_builder.db_path = self.test_db_path
        orchestrator.uncertainty_sampler.db_path = self.test_db_path
        orchestrator.fine_tuner.db_path = self.test_db_path
        orchestrator.rlhf_trainer.db_path = self.test_db_path
        
        # Test learning opportunities check
        opportunities = await orchestrator._check_learning_opportunities()
        self.assertIsInstance(opportunities, dict)
        self.logger.info(f"✅ Learning opportunities: {opportunities}")
        
        # Test status
        status = orchestrator.get_status()
        self.assertIn('is_running', status)
        self.logger.info("✅ Orchestrator status works")
    
    def test_database_schema(self):
        """Test database schema integrity"""
        self.logger.info("Testing Database Schema...")
        
        conn = sqlite3.connect(self.test_db_path)
        cursor = conn.cursor()
        
        # Check required tables exist
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
        tables = [row[0] for row in cursor.fetchall()]
        
        required_tables = ['interactions', 'feedback']
        for table in required_tables:
            self.assertIn(table, tables, f"Required table '{table}' not found")
        
        self.logger.info(f"✅ All required tables exist: {tables}")
        
        # Check sample data
        cursor.execute("SELECT COUNT(*) FROM interactions")
        interaction_count = cursor.fetchone()[0]
        self.assertGreater(interaction_count, 0, "No sample interactions found")
        
        cursor.execute("SELECT COUNT(*) FROM feedback")
        feedback_count = cursor.fetchone()[0]
        self.assertGreater(feedback_count, 0, "No sample feedback found")
        
        self.logger.info(f"✅ Sample data: {interaction_count} interactions, {feedback_count} feedback items")
        
        conn.close()
    
    def test_configuration_loading(self):
        """Test configuration loading"""
        self.logger.info("Testing Configuration Loading...")
        
        # Test if learning config exists
        config_path = "learning_config.yaml"
        self.assertTrue(os.path.exists(config_path), "Learning config file not found")
        
        # Test loading config in components
        fine_tuner = LocalModelFineTuner(config_path)
        self.assertIsNotNone(fine_tuner.config)
        self.assertIn('training', fine_tuner.config)
        
        self.logger.info("✅ Configuration loading works")
    
    async def test_integration(self):
        """Test component integration"""
        self.logger.info("Testing Component Integration...")
        
        # Test interaction logger to profile builder integration
        logger = InteractionLogger(self.test_db_path)
        builder = UserProfileBuilder(self.test_db_path)
        
        # Log an interaction
        interaction_id = logger.log_interaction(
            "Test integration input",
            "Test integration response"
        )
        
        # Build profile should include this interaction
        profile = builder.build_user_profile("integration_test_user", force_rebuild=True)
        self.assertIn('preferences', profile)
        
        self.logger.info("✅ Component integration works")
        
        # Cleanup
        logger.cleanup()

class LearningSystemBenchmark:
    """Performance benchmark for learning system"""
    
    def __init__(self):
        self.logger = logging.getLogger(__name__)
        
    async def run_benchmarks(self):
        """Run performance benchmarks"""
        self.logger.info("Running Learning System Benchmarks...")
        
        benchmarks = {
            "interaction_logging": await self.benchmark_interaction_logging(),
            "profile_building": await self.benchmark_profile_building(),
            "uncertainty_sampling": await self.benchmark_uncertainty_sampling(),
        }
        
        self.logger.info("Benchmark Results:")
        for benchmark, result in benchmarks.items():
            self.logger.info(f"  {benchmark}: {result}")
            
        return benchmarks
    
    async def benchmark_interaction_logging(self):
        """Benchmark interaction logging performance"""
        logger = InteractionLogger("data/test_benchmark.db")
        
        start_time = time.time()
        
        # Log 100 interactions
        for i in range(100):
            logger.log_interaction(
                f"Test input {i}",
                f"Test response {i}",
                f"Test context {i}"
            )
        
        end_time = time.time()
        
        logger.cleanup()
        
        # Cleanup
        if os.path.exists("data/test_benchmark.db"):
            os.remove("data/test_benchmark.db")
        
        throughput = 100 / (end_time - start_time)
        return f"{throughput:.2f} interactions/sec"
    
    async def benchmark_profile_building(self):
        """Benchmark profile building performance"""
        builder = UserProfileBuilder("data/test_learning_interactions.db")
        
        start_time = time.time()
        
        # Build 10 profiles
        for i in range(10):
            builder.build_user_profile(f"benchmark_user_{i}", force_rebuild=True)
        
        end_time = time.time()
        
        throughput = 10 / (end_time - start_time)
        return f"{throughput:.2f} profiles/sec"
    
    async def benchmark_uncertainty_sampling(self):
        """Benchmark uncertainty sampling performance"""
        sampler = UncertaintySampler()
        sampler.db_path = "data/test_learning_interactions.db"
        
        start_time = time.time()
        
        # Run uncertainty analysis
        uncertain_interactions = sampler.identify_uncertain_interactions(days_back=30)
        
        end_time = time.time()
        
        analysis_time = end_time - start_time
        return f"{analysis_time:.2f}s for {len(uncertain_interactions)} interactions"

async def run_all_tests():
    """Run all tests and benchmarks"""
    print("🧠 CAIA Phase 3 Learning System - Comprehensive Test Suite")
    print("=" * 60)
    
    # Run unit tests
    print("\n📋 Running Unit Tests...")
    test_suite = unittest.TestLoader().loadTestsFromTestCase(LearningSystemTests)
    test_runner = unittest.TextTestRunner(verbosity=2)
    test_result = test_runner.run(test_suite)
    
    # Run benchmarks
    print("\n⚡ Running Performance Benchmarks...")
    benchmark = LearningSystemBenchmark()
    await benchmark.run_benchmarks()
    
    # Summary
    print("\n📊 Test Summary:")
    print(f"  Tests run: {test_result.testsRun}")
    print(f"  Failures: {len(test_result.failures)}")
    print(f"  Errors: {len(test_result.errors)}")
    
    if test_result.wasSuccessful():
        print("\n✅ All tests passed! Learning system is ready.")
        return True
    else:
        print("\n❌ Some tests failed. Check the output above.")
        return False

if __name__ == "__main__":
    # Setup logging
    logging.basicConfig(
        level=logging.INFO,
        format='[%(name)s] %(asctime)s - %(levelname)s - %(message)s'
    )
    
    # Run tests
    success = asyncio.run(run_all_tests())
    
    # Exit with appropriate code
    sys.exit(0 if success else 1)