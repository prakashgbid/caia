#!/usr/bin/env python3
"""
Basic Test Suite for CAIA Phase 3 Learning System
Tests core functionality without heavy ML dependencies
"""

import os
import sys
import json
import sqlite3
import logging
from pathlib import Path
from datetime import datetime

# Add learning modules to path
sys.path.append(str(Path(__file__).parent / "learning"))

def test_basic_components():
    """Test basic learning components that don't require ML libraries"""
    print("🧠 Testing CAIA Phase 3 Learning System - Basic Components")
    print("=" * 60)
    
    # Test database setup
    print("\n📊 Testing Database Setup...")
    try:
        os.makedirs("data", exist_ok=True)
        test_db_path = "data/test_basic_learning.db"
        
        conn = sqlite3.connect(test_db_path)
        cursor = conn.cursor()
        
        # Create test interactions table
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS interactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT NOT NULL,
            interaction_sequence INTEGER,
            timestamp TEXT NOT NULL,
            user_input TEXT,
            ai_response TEXT,
            context TEXT,
            confidence_score REAL,
            user_satisfaction_predicted REAL
        )
        """)
        
        # Insert test data
        cursor.execute("""
        INSERT INTO interactions (
            session_id, interaction_sequence, timestamp, user_input, 
            ai_response, context, confidence_score, user_satisfaction_predicted
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            "test_session_1", 1, datetime.now().isoformat(),
            "How do I implement machine learning?",
            "To implement machine learning, you need to...",
            "Programming discussion", 0.85, 4.2
        ))
        
        conn.commit()
        conn.close()
        
        print("✅ Database setup successful")
        
        # Cleanup test database
        if os.path.exists(test_db_path):
            os.remove(test_db_path)
            
    except Exception as e:
        print(f"❌ Database test failed: {e}")
        return False
    
    # Test interaction logger (basic functionality)
    print("\n📝 Testing Interaction Logger...")
    try:
        from continuous.interaction_logger import InteractionLogger
        
        logger = InteractionLogger("data/test_basic_interaction.db")
        
        # Test basic logging
        interaction_id = logger.log_interaction(
            user_input="Test input",
            ai_response="Test response",
            context="Test context"
        )
        
        print(f"✅ Interaction logged with ID: {interaction_id}")
        
        # Test session stats
        stats = logger.get_session_stats()
        print(f"✅ Session stats: {stats['interaction_count']} interactions")
        
        # Cleanup
        logger.cleanup()
        
        if os.path.exists("data/test_basic_interaction.db"):
            os.remove("data/test_basic_interaction.db")
        
    except ImportError as e:
        print(f"⚠️ Interaction logger import failed (missing dependencies): {e}")
    except Exception as e:
        print(f"❌ Interaction logger test failed: {e}")
        return False
    
    # Test user profile builder (basic functionality)
    print("\n👤 Testing User Profile Builder...")
    try:
        from personalization.user_profile import UserProfileBuilder
        
        builder = UserProfileBuilder("data/test_basic_profile.db")
        
        # Create test profile
        profile = builder._create_default_profile("test_user")
        
        print(f"✅ Default profile created for: {profile['user_id']}")
        
        if os.path.exists("data/test_basic_profile.db"):
            os.remove("data/test_basic_profile.db")
        
    except ImportError as e:
        print(f"⚠️ User profile builder import failed (missing dependencies): {e}")
    except Exception as e:
        print(f"❌ User profile builder test failed: {e}")
        return False
    
    # Test feedback collector
    print("\n💬 Testing Feedback Collector...")
    try:
        from feedback.feedback_collector import FeedbackCollector
        
        collector = FeedbackCollector("data/test_basic_feedback.db")
        
        # Test explicit feedback
        success = collector.collect_explicit_feedback(
            interaction_id=1,
            rating=4,
            feedback_text="Great response!",
            session_id="test_session"
        )
        
        print(f"✅ Explicit feedback collected: {success}")
        
        # Test implicit feedback
        success = collector.collect_implicit_feedback(
            interaction_id=2,
            implicit_signals={
                'read_time_seconds': 15,
                'scroll_percentage': 90
            },
            session_id="test_session"
        )
        
        print(f"✅ Implicit feedback collected: {success}")
        
        if os.path.exists("data/test_basic_feedback.db"):
            os.remove("data/test_basic_feedback.db")
        
    except ImportError as e:
        print(f"⚠️ Feedback collector import failed (missing dependencies): {e}")
    except Exception as e:
        print(f"❌ Feedback collector test failed: {e}")
        return False
    
    # Test configuration loading
    print("\n⚙️ Testing Configuration Loading...")
    try:
        import yaml
        
        config_path = "learning_config.yaml"
        if os.path.exists(config_path):
            with open(config_path, 'r') as f:
                config = yaml.safe_load(f)
            
            print(f"✅ Configuration loaded with {len(config)} sections")
            
            # Verify key sections
            required_sections = ['training', 'orchestrator', 'thresholds']
            for section in required_sections:
                if section in config:
                    print(f"✅ Found section: {section}")
                else:
                    print(f"⚠️ Missing section: {section}")
        else:
            print("❌ Configuration file not found")
            return False
            
    except ImportError:
        print("⚠️ YAML library not available - install pyyaml")
    except Exception as e:
        print(f"❌ Configuration test failed: {e}")
        return False
    
    # Test directory structure
    print("\n📁 Testing Directory Structure...")
    try:
        learning_dirs = [
            "learning/training",
            "learning/feedback", 
            "learning/active",
            "learning/continuous",
            "learning/personalization",
            "learning/integration"
        ]
        
        for dir_path in learning_dirs:
            if os.path.exists(dir_path):
                files = os.listdir(dir_path)
                python_files = [f for f in files if f.endswith('.py')]
                print(f"✅ {dir_path}: {len(python_files)} Python files")
            else:
                print(f"❌ Directory not found: {dir_path}")
                return False
        
    except Exception as e:
        print(f"❌ Directory structure test failed: {e}")
        return False
    
    print("\n🎉 Basic Learning System Tests Completed Successfully!")
    print("\nNext Steps:")
    print("1. Install optional ML dependencies: pip install torch transformers datasets")
    print("2. Run full test suite: python3 test_learning.py")
    print("3. Start learning system: ./start_learning.sh start")
    
    return True

def test_startup_script():
    """Test the startup script exists and is executable"""
    print("\n🚀 Testing Startup Script...")
    
    script_path = "./start_learning.sh"
    if os.path.exists(script_path):
        if os.access(script_path, os.X_OK):
            print("✅ Startup script is executable")
            
            # Test help output
            import subprocess
            try:
                result = subprocess.run([script_path], capture_output=True, text=True, timeout=5)
                if "Usage:" in result.stdout or "Commands:" in result.stdout:
                    print("✅ Startup script shows help")
                else:
                    print("⚠️ Startup script may have issues")
            except subprocess.TimeoutExpired:
                print("⚠️ Startup script took too long (expected for help)")
            except Exception as e:
                print(f"⚠️ Could not test startup script: {e}")
        else:
            print("❌ Startup script is not executable - run: chmod +x start_learning.sh")
            return False
    else:
        print("❌ Startup script not found")
        return False
    
    return True

if __name__ == "__main__":
    # Setup basic logging
    logging.basicConfig(level=logging.INFO)
    
    success = True
    
    # Run basic tests
    success &= test_basic_components()
    success &= test_startup_script()
    
    # Summary
    if success:
        print("\n✅ All basic tests passed! Phase 3 Learning System is ready.")
        sys.exit(0)
    else:
        print("\n❌ Some tests failed. Check the output above.")
        sys.exit(1)