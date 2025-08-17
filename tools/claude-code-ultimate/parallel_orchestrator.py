#!/usr/bin/env python3
"""
Claude Code Ultimate - Parallel Configuration Orchestrator
Launches 82 concurrent Claude Code instances, each handling one configuration item
"""

import os
import json
import subprocess
import time
import threading
import queue
from datetime import datetime
from pathlib import Path
import hashlib
import signal
import sys

# Terminal emulator configurations for different OS
TERMINAL_COMMANDS = {
    'darwin': {  # macOS
        'terminal': 'osascript -e \'tell app "Terminal" to do script "{command}"\'',
        'iterm': 'osascript -e \'tell app "iTerm" to create window with default profile command "{command}"\'',
        'kitty': 'kitty --detach --title "{title}" -e {command}',
        'alacritty': 'alacritty --title "{title}" -e {command} &',
    },
    'linux': {
        'gnome': 'gnome-terminal --title="{title}" -- {command}',
        'konsole': 'konsole --title "{title}" -e {command} &',
        'xterm': 'xterm -title "{title}" -e {command} &',
        'terminator': 'terminator --title="{title}" -e "{command}" &',
    },
    'windows': {
        'cmd': 'start "{title}" cmd /k {command}',
        'powershell': 'start powershell -NoExit -Command {command}',
        'wt': 'wt --title "{title}" -- {command}',  # Windows Terminal
    }
}

class ParallelOrchestrator:
    def __init__(self, terminal_type='auto'):
        self.project_root = Path(__file__).parent
        self.tasks_dir = self.project_root / 'parallel_tasks'
        self.logs_dir = self.project_root / 'parallel_logs'
        self.results_dir = self.project_root / 'parallel_results'
        self.terminal_type = terminal_type
        self.active_processes = {}
        self.results_queue = queue.Queue()
        
        # Create directories
        self.tasks_dir.mkdir(exist_ok=True)
        self.logs_dir.mkdir(exist_ok=True)
        self.results_dir.mkdir(exist_ok=True)
        
        # Load configuration items from matrix
        self.load_configuration_items()
        
    def load_configuration_items(self):
        """Parse ENHANCEMENT_MATRIX.md to extract all 82 configuration items"""
        matrix_file = self.project_root / 'ENHANCEMENT_MATRIX.md'
        self.config_items = []
        
        with open(matrix_file, 'r') as f:
            lines = f.readlines()
            
        current_category = None
        item_id = 0
        
        for line in lines:
            # Detect category headers
            if line.startswith('## ') and 'TODO' not in line and 'COMPLETED' not in line:
                if any(num in line for num in ['1.', '2.', '3.', '4.', '5.', '6.', '7.', '8.', '9.', '10.', '11.', '12.']):
                    current_category = line.strip('# ').split('[')[0].strip()
                    
            # Detect configuration items
            elif line.startswith('| ') and '⬜ TODO' in line and current_category:
                parts = line.split('|')
                if len(parts) >= 6:
                    item_id += 1
                    config_id = parts[1].strip()
                    config_name = parts[2].strip()
                    priority = 'CRITICAL' if '🔴' in parts[4] else 'HIGH' if '🟡' in parts[4] else 'MEDIUM'
                    test_command = parts[6].strip() if len(parts) > 6 else ''
                    
                    self.config_items.append({
                        'id': config_id,
                        'name': config_name,
                        'category': current_category,
                        'priority': priority,
                        'test_command': test_command,
                        'global_id': item_id
                    })
        
        print(f"📊 Loaded {len(self.config_items)} configuration items")
        
    def create_task_file(self, item):
        """Create individual task file for each configuration item"""
        task_id = item['id'].replace('.', '_')
        task_file = self.tasks_dir / f"task_{task_id}.md"
        
        content = f"""# Configuration Task: {item['name']}

## Task ID: {item['id']}
## Category: {item['category']}
## Priority: {item['priority']}
## Instance: {item['global_id']}/82

## Objective
Implement and test: {item['name']}

## Implementation Steps
1. Research best practices for this configuration
2. Create the configuration file(s)
3. Write test scripts
4. Validate implementation
5. Document results

## Test Command
```bash
{item['test_command']}
```

## Expected Outcome
- Configuration file created and properly formatted
- Test passes successfully
- Documentation updated
- Results logged to: parallel_results/result_{task_id}.json

## Auto-Instructions for Claude
When this task opens in Claude Code:
1. Read this task file
2. Implement the configuration
3. Run the test command
4. Save results to the results directory
5. Mark task as complete in the tracking system

## Result Format
Save to: `parallel_results/result_{task_id}.json`
```json
{{
    "task_id": "{item['id']}",
    "status": "completed|failed|blocked",
    "files_created": [],
    "test_result": "pass|fail",
    "notes": "",
    "timestamp": "ISO-8601"
}}
```
"""
        
        with open(task_file, 'w') as f:
            f.write(content)
            
        return task_file
    
    def generate_claude_command(self, task_file, item):
        """Generate the Claude Code command for each task"""
        task_id = item['id'].replace('.', '_')
        log_file = self.logs_dir / f"log_{task_id}.txt"
        
        # Create a focused prompt for Claude
        prompt = f"""Execute configuration task {item['id']}: {item['name']}

Read the task file at {task_file} and:
1. Implement the {item['name']} configuration
2. Test using: {item['test_command']}
3. Save results to parallel_results/result_{task_id}.json
4. Focus only on this specific configuration item
5. Work autonomously without user interaction

Start immediately."""
        
        # Save prompt to file to avoid shell escaping issues
        prompt_file = self.tasks_dir / f"prompt_{task_id}.txt"
        with open(prompt_file, 'w') as f:
            f.write(prompt)
        
        # Claude command with task-specific context
        claude_cmd = f'cd "{self.project_root}" && claude --no-interactive < "{prompt_file}" > "{log_file}" 2>&1'
        
        return claude_cmd, log_file
    
    def detect_terminal(self):
        """Auto-detect available terminal emulator"""
        import platform
        system = platform.system().lower()
        
        if system == 'darwin':  # macOS
            # Check for available terminals
            terminals = ['iterm', 'kitty', 'alacritty', 'terminal']
            for term in terminals:
                try:
                    subprocess.run(['which', term], capture_output=True, check=True)
                    return 'darwin', term
                except:
                    continue
            return 'darwin', 'terminal'  # Default to Terminal.app
            
        elif 'linux' in system:
            terminals = ['gnome-terminal', 'konsole', 'xterm', 'terminator']
            for term in terminals:
                try:
                    subprocess.run(['which', term], capture_output=True, check=True)
                    return 'linux', term.replace('-terminal', '')
                except:
                    continue
            return 'linux', 'xterm'
            
        else:  # Windows
            return 'windows', 'wt' if os.path.exists('C:\\Program Files\\WindowsApps\\Microsoft.WindowsTerminal') else 'cmd'
    
    def launch_instance(self, item, instance_num):
        """Launch a single Claude Code instance in a new terminal"""
        # Create task file
        task_file = self.create_task_file(item)
        
        # Generate Claude command
        claude_cmd, log_file = self.generate_claude_command(task_file, item)
        
        # Detect terminal
        os_type, term_type = self.detect_terminal()
        
        # Get terminal command template
        term_template = TERMINAL_COMMANDS[os_type][term_type]
        
        # Format terminal command
        title = f"CC-{item['id']}-{item['name'][:20]}"
        if 'osascript' in term_template:  # macOS AppleScript
            terminal_cmd = term_template.format(command=claude_cmd.replace('"', '\\"'))
        else:
            terminal_cmd = term_template.format(title=title, command=claude_cmd)
        
        # Launch terminal
        try:
            process = subprocess.Popen(terminal_cmd, shell=True)
            self.active_processes[item['id']] = {
                'process': process,
                'item': item,
                'log_file': log_file,
                'start_time': datetime.now()
            }
            print(f"✅ Launched instance {instance_num}/82: {item['id']} - {item['name'][:40]}...")
            return True
        except Exception as e:
            print(f"❌ Failed to launch {item['id']}: {e}")
            return False
    
    def launch_all_parallel(self, batch_size=10, delay=0.5):
        """Launch all 82 instances with controlled batching to avoid system overload"""
        print("\n🚀 LAUNCHING 82 PARALLEL CLAUDE CODE INSTANCES")
        print("=" * 60)
        
        total = len(self.config_items)
        launched = 0
        
        # Sort by priority
        priority_order = {'CRITICAL': 0, 'HIGH': 1, 'MEDIUM': 2}
        self.config_items.sort(key=lambda x: priority_order[x['priority']])
        
        # Launch in batches
        for i in range(0, total, batch_size):
            batch = self.config_items[i:i+batch_size]
            print(f"\n📦 Launching batch {i//batch_size + 1}/{(total-1)//batch_size + 1}")
            
            for item in batch:
                launched += 1
                self.launch_instance(item, launched)
                time.sleep(delay)  # Small delay between launches
            
            if i + batch_size < total:
                print(f"⏸️  Pausing 3 seconds before next batch...")
                time.sleep(3)
        
        print(f"\n✅ Successfully launched {launched}/{total} instances")
        
    def monitor_progress(self):
        """Monitor progress of all instances"""
        print("\n📊 MONITORING PROGRESS")
        print("=" * 60)
        
        while True:
            # Check results directory
            results = list(self.results_dir.glob('result_*.json'))
            completed = len(results)
            
            # Display progress
            progress = (completed / 82) * 100
            bar_length = 50
            filled = int(bar_length * completed // 82)
            bar = '█' * filled + '░' * (bar_length - filled)
            
            print(f"\r[{bar}] {progress:.1f}% ({completed}/82)", end='', flush=True)
            
            if completed >= 82:
                print("\n\n✅ ALL TASKS COMPLETED!")
                break
                
            time.sleep(5)
    
    def aggregate_results(self):
        """Aggregate all results into final report"""
        print("\n📋 AGGREGATING RESULTS")
        print("=" * 60)
        
        results = []
        for result_file in self.results_dir.glob('result_*.json'):
            with open(result_file, 'r') as f:
                results.append(json.load(f))
        
        # Generate summary
        summary = {
            'total': len(results),
            'completed': sum(1 for r in results if r['status'] == 'completed'),
            'failed': sum(1 for r in results if r['status'] == 'failed'),
            'blocked': sum(1 for r in results if r['status'] == 'blocked'),
            'timestamp': datetime.now().isoformat(),
            'details': results
        }
        
        # Save summary
        summary_file = self.project_root / 'PARALLEL_EXECUTION_SUMMARY.json'
        with open(summary_file, 'w') as f:
            json.dump(summary, f, indent=2)
        
        print(f"✅ Completed: {summary['completed']}/82")
        print(f"❌ Failed: {summary['failed']}/82")
        print(f"⚠️  Blocked: {summary['blocked']}/82")
        print(f"\n📄 Full report saved to: {summary_file}")
        
        return summary

def signal_handler(sig, frame):
    """Handle Ctrl+C gracefully"""
    print('\n\n⚠️  Interrupted! Cleaning up...')
    # Could add cleanup code here
    sys.exit(0)

def main():
    """Main execution"""
    signal.signal(signal.SIGINT, signal_handler)
    
    print("""
╔══════════════════════════════════════════════════════════════╗
║          CLAUDE CODE ULTIMATE - PARALLEL ORCHESTRATOR       ║
║                  82 Concurrent Configurations                ║
╚══════════════════════════════════════════════════════════════╝
    """)
    
    orchestrator = ParallelOrchestrator()
    
    # Display configuration summary
    print(f"\n📊 Configuration Summary:")
    print(f"   - Critical Priority: {sum(1 for i in orchestrator.config_items if i['priority'] == 'CRITICAL')}")
    print(f"   - High Priority: {sum(1 for i in orchestrator.config_items if i['priority'] == 'HIGH')}")
    print(f"   - Medium Priority: {sum(1 for i in orchestrator.config_items if i['priority'] == 'MEDIUM')}")
    
    # Confirm before launching
    print("\n⚠️  WARNING: This will open 82 terminal windows!")
    print("   Each will run a Claude Code instance working on a specific configuration.")
    print("   Ensure you have sufficient system resources (RAM, CPU).")
    
    response = input("\n🚀 Ready to launch? (yes/no): ")
    if response.lower() != 'yes':
        print("Aborted.")
        return
    
    # Launch all instances
    orchestrator.launch_all_parallel(batch_size=10, delay=0.3)
    
    # Monitor progress
    print("\n📊 Monitoring progress (press Ctrl+C to stop)...")
    time.sleep(5)  # Give instances time to start
    
    try:
        orchestrator.monitor_progress()
    except KeyboardInterrupt:
        print("\n\n⚠️  Monitoring stopped.")
    
    # Aggregate results
    orchestrator.aggregate_results()
    
    print("\n✨ Parallel execution complete!")

if __name__ == "__main__":
    main()