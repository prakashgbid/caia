#!/usr/bin/env python3
"""
Automatic Log Trainer
Monitors CC interaction logs and trains CKS/CLS automatically
"""

import json
import time
import requests
from pathlib import Path
from datetime import datetime
import hashlib

class AutoLogTrainer:
    def __init__(self):
        self.log_dir = Path.home() / '.claude' / 'cc_interaction_logs'
        self.log_dir.mkdir(parents=True, exist_ok=True)
        self.processed_file = self.log_dir / '.processed_lines'
        self.trainer_url = 'http://localhost:5004/train'
        self.processed_hashes = self.load_processed()
        
    def load_processed(self):
        """Load set of already processed line hashes"""
        if self.processed_file.exists():
            with open(self.processed_file, 'r') as f:
                return set(line.strip() for line in f)
        return set()
        
    def save_processed(self, line_hash):
        """Save processed line hash"""
        with open(self.processed_file, 'a') as f:
            f.write(line_hash + '\n')
        self.processed_hashes.add(line_hash)
        
    def process_log_files(self):
        """Process all log files in directory"""
        stats = {'new': 0, 'skipped': 0, 'errors': 0}
        
        # Process all .jsonl files
        for log_file in sorted(self.log_dir.glob('interactions_*.jsonl')):
            stats_file = self.process_single_file(log_file)
            stats['new'] += stats_file['new']
            stats['skipped'] += stats_file['skipped']
            stats['errors'] += stats_file['errors']
            
        return stats
        
    def process_single_file(self, log_file):
        """Process a single log file"""
        stats = {'new': 0, 'skipped': 0, 'errors': 0}
        
        if not log_file.exists():
            return stats
            
        with open(log_file, 'r') as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                    
                # Check if already processed
                line_hash = hashlib.md5(line.encode()).hexdigest()
                if line_hash in self.processed_hashes:
                    stats['skipped'] += 1
                    continue
                    
                # Try to parse and train
                try:
                    entry = json.loads(line)
                    
                    # Skip entries without meaningful content
                    if not entry.get('user_prompt') and not entry.get('assistant_response'):
                        self.save_processed(line_hash)
                        stats['skipped'] += 1
                        continue
                        
                    # Send to trainer
                    response = requests.post(
                        self.trainer_url,
                        json=entry,
                        timeout=2
                    )
                    
                    if response.status_code == 200:
                        stats['new'] += 1
                        self.save_processed(line_hash)
                        result = response.json()
                        print(f"  ✅ Trained: {result.get('patterns_found', 0)} patterns")
                    else:
                        stats['errors'] += 1
                        
                except Exception as e:
                    stats['errors'] += 1
                    
        return stats
        
    def monitor_loop(self, interval=30):
        """Continuously monitor and process logs"""
        print(f"🔄 Starting automatic log trainer (checking every {interval}s)")
        print(f"📁 Monitoring: {self.log_dir}")
        print("=" * 50)
        
        while True:
            try:
                # Check if trainer is running
                try:
                    health = requests.get('http://localhost:5004/health', timeout=1)
                    if health.status_code != 200:
                        print("⚠️ Trainer not healthy, waiting...")
                        time.sleep(interval)
                        continue
                except:
                    print("⚠️ Trainer not running, waiting...")
                    time.sleep(interval)
                    continue
                    
                # Process logs
                stats = self.process_log_files()
                
                if stats['new'] > 0:
                    print(f"[{datetime.now().strftime('%H:%M:%S')}] "
                          f"Trained: {stats['new']} new, "
                          f"Skipped: {stats['skipped']}, "
                          f"Errors: {stats['errors']}")
                          
            except KeyboardInterrupt:
                print("\n👋 Stopping auto trainer")
                break
            except Exception as e:
                print(f"❌ Error: {e}")
                
            time.sleep(interval)
            
    def manual_process(self):
        """One-time processing of all logs"""
        print("📊 Processing all interaction logs...")
        stats = self.process_log_files()
        print(f"\n✅ Complete!")
        print(f"  • New interactions trained: {stats['new']}")
        print(f"  • Already processed: {stats['skipped']}")
        print(f"  • Errors: {stats['errors']}")
        
        # Show current totals
        try:
            response = requests.get('http://localhost:5004/stats')
            if response.status_code == 200:
                data = response.json()
                print(f"\n📈 Total in database:")
                print(f"  • Interactions: {data.get('total_interactions', 0)}")
                print(f"  • Patterns: {data.get('total_patterns', 0)}")
        except:
            pass

def main():
    import sys
    
    trainer = AutoLogTrainer()
    
    if len(sys.argv) > 1 and sys.argv[1] == 'once':
        # Process once and exit
        trainer.manual_process()
    else:
        # Monitor continuously
        trainer.monitor_loop()

if __name__ == '__main__':
    main()