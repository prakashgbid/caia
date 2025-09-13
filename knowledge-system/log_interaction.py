#!/usr/bin/env python3
"""
Manual CC Interaction Logger
Run this to log the current/recent interaction for training
"""

import json
import sys
from datetime import datetime
from pathlib import Path

class InteractionLogger:
    def __init__(self):
        self.log_dir = Path.home() / '.claude' / 'cc_interaction_logs'
        self.log_dir.mkdir(parents=True, exist_ok=True)
        self.log_file = self.log_dir / f'interactions_{datetime.now().strftime("%Y%m%d")}.jsonl'
        
    def log_interaction(self, prompt, response, tools=None):
        """Log a single interaction"""
        entry = {
            'timestamp': datetime.utcnow().isoformat() + 'Z',
            'session_id': f'manual_{datetime.now().strftime("%Y%m%d_%H%M%S")}',
            'user_prompt': prompt,
            'assistant_response': response,
            'tools_used': tools or [],
            'source': 'manual'
        }
        
        # Append to log file
        with open(self.log_file, 'a') as f:
            f.write(json.dumps(entry) + '\n')
            
        print(f"✅ Logged interaction to {self.log_file}")
        return entry
        
    def log_current(self):
        """Interactive logging of current interaction"""
        print("📝 Manual Interaction Logger")
        print("=" * 40)
        
        # Get user prompt
        print("Enter your prompt (or 'last' for previous):")
        prompt = input("> ").strip()
        
        if not prompt:
            print("❌ No prompt provided")
            return
            
        # Get assistant response
        print("\nEnter CC's response summary (or key points):")
        response = input("> ").strip()
        
        if not response:
            print("❌ No response provided")
            return
            
        # Get tools used (optional)
        print("\nTools used (comma-separated, or press Enter to skip):")
        tools_input = input("> ").strip()
        tools = [t.strip() for t in tools_input.split(',')] if tools_input else []
        
        # Log it
        entry = self.log_interaction(prompt, response, tools)
        
        # Send to trainer immediately
        self.train_from_entry(entry)
        
    def train_from_entry(self, entry):
        """Send entry to trainer"""
        import requests
        
        try:
            response = requests.post(
                'http://localhost:5004/train',
                json=entry,
                timeout=2
            )
            if response.status_code == 200:
                result = response.json()
                print(f"✅ Trained immediately: {result.get('patterns_found', 0)} patterns found")
            else:
                print(f"⚠️ Training failed: {response.status_code}")
        except Exception as e:
            print(f"⚠️ Could not train immediately: {e}")
            print("   Entry saved to log for later processing")
            
    def process_log_file(self):
        """Process entire log file for training"""
        if not self.log_file.exists():
            print(f"❌ No log file found at {self.log_file}")
            return
            
        print(f"📊 Processing {self.log_file}")
        
        import requests
        trained = 0
        errors = 0
        
        with open(self.log_file, 'r') as f:
            for line in f:
                try:
                    entry = json.loads(line.strip())
                    response = requests.post(
                        'http://localhost:5004/train',
                        json=entry,
                        timeout=2
                    )
                    if response.status_code == 200:
                        trained += 1
                    else:
                        errors += 1
                except:
                    errors += 1
                    
        print(f"✅ Trained: {trained} interactions")
        if errors > 0:
            print(f"⚠️ Errors: {errors}")

def main():
    logger = InteractionLogger()
    
    if len(sys.argv) > 1:
        if sys.argv[1] == 'process':
            # Process existing log file
            logger.process_log_file()
        elif sys.argv[1] == 'quick' and len(sys.argv) >= 4:
            # Quick log: python log_interaction.py quick "prompt" "response" 
            prompt = sys.argv[2]
            response = sys.argv[3]
            tools = sys.argv[4].split(',') if len(sys.argv) > 4 else []
            entry = logger.log_interaction(prompt, response, tools)
            logger.train_from_entry(entry)
        else:
            print("Usage:")
            print("  python log_interaction.py          # Interactive mode")
            print("  python log_interaction.py process  # Process log file")
            print('  python log_interaction.py quick "prompt" "response" [tools]')
    else:
        # Interactive mode
        logger.log_current()

if __name__ == '__main__':
    main()