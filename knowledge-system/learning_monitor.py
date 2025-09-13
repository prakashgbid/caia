#!/usr/bin/env python3
"""
CC Learning Monitor - Real-time monitoring and verification
Shows that learning is actively happening
"""

import sqlite3
import time
import os
from datetime import datetime
from pathlib import Path
import json
import sys

class LearningMonitor:
    def __init__(self):
        self.base_dir = Path(__file__).parent
        self.data_dir = self.base_dir / "data"
        self.logs_dir = self.base_dir / "logs"
        self.last_interaction_count = 0
        self.last_pattern_count = 0
        self.session_id = None
        
    def check_services(self):
        """Check if learning services are running"""
        import subprocess
        
        services = {
            'CKS API (5555)': 'curl -s http://localhost:5555/health',
            'CLS API (5003)': 'curl -s http://localhost:5003/health'
        }
        
        status = {}
        for service, cmd in services.items():
            try:
                result = subprocess.run(cmd, shell=True, capture_output=True, timeout=2)
                status[service] = result.returncode == 0
            except:
                status[service] = False
                
        return status
        
    def get_stats(self):
        """Get current learning statistics"""
        stats = {}
        
        # Chat history stats
        try:
            conn = sqlite3.connect(self.data_dir / 'chat_history.db')
            cursor = conn.cursor()
            
            cursor.execute("SELECT COUNT(*) FROM interactions")
            stats['total_interactions'] = cursor.fetchone()[0]
            
            cursor.execute("SELECT COUNT(DISTINCT session_id) FROM interactions")
            stats['total_sessions'] = cursor.fetchone()[0]
            
            cursor.execute("""
                SELECT session_id, COUNT(*) as count 
                FROM interactions 
                GROUP BY session_id 
                ORDER BY session_id DESC 
                LIMIT 1
            """)
            result = cursor.fetchone()
            if result:
                stats['current_session'] = result[0]
                stats['current_session_interactions'] = result[1]
            
            conn.close()
        except Exception as e:
            stats['error'] = str(e)
            
        # Pattern stats
        try:
            conn = sqlite3.connect(self.data_dir / 'patterns.db')
            cursor = conn.cursor()
            
            cursor.execute("SELECT COUNT(*) FROM user_behavior")
            stats['behavior_patterns'] = cursor.fetchone()[0]
            
            cursor.execute("SELECT COUNT(*) FROM behavior_patterns")
            stats['learned_patterns'] = cursor.fetchone()[0]
            
            conn.close()
        except:
            pass
            
        return stats
        
    def detect_learning(self, stats):
        """Detect if active learning is happening"""
        learning_active = False
        
        # Check if interactions are increasing
        current_interactions = stats.get('total_interactions', 0)
        if current_interactions > self.last_interaction_count:
            learning_active = True
            self.last_interaction_count = current_interactions
            
        # Check if patterns are being captured
        current_patterns = stats.get('learned_patterns', 0)
        if current_patterns > self.last_pattern_count:
            learning_active = True
            self.last_pattern_count = current_patterns
            
        return learning_active
        
    def display_status(self):
        """Display current learning status"""
        os.system('clear' if os.name == 'posix' else 'cls')
        
        print("="*60)
        print("🧠 CC LEARNING MONITOR - REAL-TIME STATUS")
        print("="*60)
        print(f"Time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        print()
        
        # Check services
        print("📡 SERVICES:")
        services = self.check_services()
        for service, running in services.items():
            status = "✅ Running" if running else "❌ Not Running"
            print(f"  {service}: {status}")
        print()
        
        # Get stats
        stats = self.get_stats()
        
        # Display stats
        print("📊 STATISTICS:")
        print(f"  Total Interactions: {stats.get('total_interactions', 0)}")
        print(f"  Total Sessions: {stats.get('total_sessions', 0)}")
        print(f"  Behavior Patterns: {stats.get('behavior_patterns', 0)}")
        print(f"  Learned Patterns: {stats.get('learned_patterns', 0)}")
        print()
        
        # Current session
        if 'current_session' in stats:
            print("🔄 CURRENT SESSION:")
            print(f"  ID: {stats['current_session']}")
            print(f"  Interactions: {stats['current_session_interactions']}")
            print()
        
        # Learning status
        learning = self.detect_learning(stats)
        if learning:
            print("⚡ LEARNING STATUS: 🟢 ACTIVE")
            print("  New data is being captured!")
        else:
            print("⚡ LEARNING STATUS: 🟡 WAITING")
            print("  No new data in this cycle")
        print()
        
        # Recent patterns
        try:
            conn = sqlite3.connect(self.data_dir / 'patterns.db')
            cursor = conn.cursor()
            cursor.execute("""
                SELECT pattern_type, pattern_data, confidence
                FROM behavior_patterns
                ORDER BY last_seen DESC
                LIMIT 3
            """)
            recent = cursor.fetchall()
            
            if recent:
                print("🔍 RECENT PATTERNS LEARNED:")
                for pattern_type, data, confidence in recent:
                    print(f"  • {pattern_type}: {data[:50]}... (confidence: {confidence:.0%})")
            conn.close()
        except:
            pass
            
        print()
        print("="*60)
        print("Press Ctrl+C to exit | Updates every 5 seconds")
        
    def monitor_loop(self):
        """Main monitoring loop"""
        print("Starting CC Learning Monitor...")
        print("This will show real-time learning activity...")
        time.sleep(2)
        
        try:
            while True:
                self.display_status()
                time.sleep(5)
        except KeyboardInterrupt:
            print("\n\n✅ Monitor stopped")
            print(f"Final stats: {self.last_interaction_count} interactions captured")

if __name__ == "__main__":
    monitor = LearningMonitor()
    monitor.monitor_loop()