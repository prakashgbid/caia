#!/usr/bin/env python3
"""
Claude Code Ultimate - Real-time Monitoring Dashboard
Monitors progress of 82 parallel configuration tasks
"""

import os
import json
import time
import curses
from pathlib import Path
from datetime import datetime, timedelta
import threading
import queue

class MonitorDashboard:
    def __init__(self, stdscr):
        self.stdscr = stdscr
        self.project_root = Path(__file__).parent
        self.results_dir = self.project_root / 'parallel_results'
        self.logs_dir = self.project_root / 'parallel_logs'
        self.tasks_dir = self.project_root / 'parallel_tasks'
        
        # Load configuration items
        self.load_matrix()
        
        # Task status tracking
        self.task_status = {item['id']: 'pending' for item in self.config_items}
        self.task_progress = {}
        self.start_time = datetime.now()
        
        # Colors
        curses.start_color()
        curses.init_pair(1, curses.COLOR_GREEN, curses.COLOR_BLACK)   # Completed
        curses.init_pair(2, curses.COLOR_YELLOW, curses.COLOR_BLACK)  # In Progress
        curses.init_pair(3, curses.COLOR_RED, curses.COLOR_BLACK)     # Failed
        curses.init_pair(4, curses.COLOR_CYAN, curses.COLOR_BLACK)    # Info
        curses.init_pair(5, curses.COLOR_WHITE, curses.COLOR_BLACK)   # Default
        curses.init_pair(6, curses.COLOR_MAGENTA, curses.COLOR_BLACK) # Priority
        
        # UI settings
        self.selected_row = 0
        self.scroll_offset = 0
        self.view_mode = 'overview'  # overview, details, logs
        self.selected_task = None
        
    def load_matrix(self):
        """Load configuration items from ENHANCEMENT_MATRIX.md"""
        matrix_file = self.project_root / 'ENHANCEMENT_MATRIX.md'
        self.config_items = []
        self.categories = {}
        
        with open(matrix_file, 'r') as f:
            lines = f.readlines()
            
        current_category = None
        item_count = 0
        
        for line in lines:
            if line.startswith('## ') and any(f'{i}.' in line for i in range(1, 13)):
                current_category = line.strip('# ').split('[')[0].strip()
                self.categories[current_category] = []
                
            elif '⬜ TODO' in line and line.startswith('|'):
                parts = line.split('|')
                if len(parts) >= 6:
                    item_count += 1
                    config_id = parts[1].strip()
                    config_name = parts[2].strip()
                    priority = 'CRITICAL' if '🔴' in parts[4] else 'HIGH' if '🟡' in parts[4] else 'MEDIUM'
                    
                    item = {
                        'id': config_id,
                        'name': config_name,
                        'category': current_category,
                        'priority': priority,
                        'number': item_count
                    }
                    
                    self.config_items.append(item)
                    if current_category:
                        self.categories[current_category].append(item)
    
    def check_task_status(self):
        """Check status of all tasks"""
        # Check for result files
        for item in self.config_items:
            task_id = item['id'].replace('.', '_')
            result_file = self.results_dir / f"result_{task_id}.json"
            log_file = self.logs_dir / f"log_{task_id}.txt"
            
            if result_file.exists():
                try:
                    with open(result_file, 'r') as f:
                        result = json.load(f)
                        self.task_status[item['id']] = result.get('status', 'completed')
                        self.task_progress[item['id']] = {
                            'result': result,
                            'completed_at': result.get('timestamp', '')
                        }
                except:
                    self.task_status[item['id']] = 'error'
                    
            elif log_file.exists():
                # Check if task is running
                try:
                    mtime = os.path.getmtime(log_file)
                    if time.time() - mtime < 60:  # Modified in last minute
                        self.task_status[item['id']] = 'running'
                    else:
                        self.task_status[item['id']] = 'stalled'
                except:
                    pass
    
    def draw_header(self):
        """Draw dashboard header"""
        height, width = self.stdscr.getmaxyx()
        
        # Title
        title = "🚀 CLAUDE CODE ULTIMATE - PARALLEL EXECUTION DASHBOARD"
        self.stdscr.attron(curses.color_pair(4) | curses.A_BOLD)
        self.stdscr.addstr(0, (width - len(title)) // 2, title)
        self.stdscr.attroff(curses.color_pair(4) | curses.A_BOLD)
        
        # Stats bar
        elapsed = datetime.now() - self.start_time
        elapsed_str = str(elapsed).split('.')[0]
        
        stats = {
            'completed': sum(1 for s in self.task_status.values() if s == 'completed'),
            'running': sum(1 for s in self.task_status.values() if s == 'running'),
            'failed': sum(1 for s in self.task_status.values() if s in ['failed', 'error']),
            'pending': sum(1 for s in self.task_status.values() if s == 'pending'),
        }
        
        total = len(self.config_items)
        progress = (stats['completed'] / total) * 100 if total > 0 else 0
        
        # Progress bar
        bar_width = 50
        filled = int(bar_width * stats['completed'] / total) if total > 0 else 0
        bar = '█' * filled + '░' * (bar_width - filled)
        
        self.stdscr.addstr(2, 2, f"[{bar}] {progress:.1f}%")
        
        # Stats line
        stats_str = f"✅ {stats['completed']} | 🔄 {stats['running']} | ❌ {stats['failed']} | ⏳ {stats['pending']} | ⏱️  {elapsed_str}"
        self.stdscr.addstr(3, 2, stats_str)
        
        # Separator
        self.stdscr.addstr(4, 0, "─" * width)
    
    def draw_task_list(self):
        """Draw scrollable task list"""
        height, width = self.stdscr.getmaxyx()
        list_height = height - 10  # Reserve space for header and footer
        
        # Column headers
        headers = f"{'#':<4} {'ID':<6} {'Status':<12} {'Priority':<10} {'Name':<50}"
        self.stdscr.attron(curses.A_BOLD)
        self.stdscr.addstr(5, 2, headers)
        self.stdscr.attroff(curses.A_BOLD)
        
        # Task rows
        visible_items = self.config_items[self.scroll_offset:self.scroll_offset + list_height]
        
        for idx, item in enumerate(visible_items):
            row = 6 + idx
            if row >= height - 3:
                break
                
            status = self.task_status.get(item['id'], 'pending')
            
            # Status emoji and color
            status_display = {
                'completed': ('✅', 1),
                'running': ('🔄', 2),
                'failed': ('❌', 3),
                'error': ('⚠️', 3),
                'stalled': ('⏸️', 2),
                'pending': ('⏳', 5)
            }.get(status, ('❓', 5))
            
            # Priority color
            priority_color = {
                'CRITICAL': 3,
                'HIGH': 2,
                'MEDIUM': 5
            }.get(item['priority'], 5)
            
            # Highlight selected row
            if self.scroll_offset + idx == self.selected_row:
                self.stdscr.attron(curses.A_REVERSE)
            
            # Draw row
            row_text = f"{item['number']:<4} {item['id']:<6} "
            self.stdscr.addstr(row, 2, row_text)
            
            # Status with color
            self.stdscr.attron(curses.color_pair(status_display[1]))
            self.stdscr.addstr(f"{status_display[0]} {status:<10} ")
            self.stdscr.attroff(curses.color_pair(status_display[1]))
            
            # Priority with color
            self.stdscr.attron(curses.color_pair(priority_color))
            self.stdscr.addstr(f"{item['priority']:<10} ")
            self.stdscr.attroff(curses.color_pair(priority_color))
            
            # Name (truncated if needed)
            name_display = item['name'][:50] if len(item['name']) > 50 else item['name']
            self.stdscr.addstr(name_display)
            
            if self.scroll_offset + idx == self.selected_row:
                self.stdscr.attroff(curses.A_REVERSE)
    
    def draw_category_summary(self):
        """Draw category progress summary"""
        height, width = self.stdscr.getmaxyx()
        
        start_row = height - 8
        self.stdscr.addstr(start_row, 2, "📊 Category Progress:")
        
        row = start_row + 1
        for category, items in list(self.categories.items())[:6]:  # Show first 6 categories
            completed = sum(1 for item in items if self.task_status.get(item['id']) == 'completed')
            total = len(items)
            percentage = (completed / total * 100) if total > 0 else 0
            
            # Mini progress bar
            bar_width = 10
            filled = int(bar_width * completed / total) if total > 0 else 0
            bar = '▓' * filled + '░' * (bar_width - filled)
            
            cat_display = f"{category[:25]:<25} [{bar}] {completed}/{total}"
            
            if percentage == 100:
                self.stdscr.attron(curses.color_pair(1))
            elif percentage > 0:
                self.stdscr.attron(curses.color_pair(2))
                
            self.stdscr.addstr(row, 4, cat_display)
            
            if percentage > 0:
                self.stdscr.attroff(curses.color_pair(1) if percentage == 100 else curses.color_pair(2))
            
            row += 1
    
    def draw_footer(self):
        """Draw footer with controls"""
        height, width = self.stdscr.getmaxyx()
        
        controls = "↑↓: Navigate | Enter: View Details | L: View Logs | R: Refresh | Q: Quit"
        self.stdscr.attron(curses.color_pair(4))
        self.stdscr.addstr(height - 1, (width - len(controls)) // 2, controls)
        self.stdscr.attroff(curses.color_pair(4))
    
    def draw_task_details(self):
        """Draw detailed view of selected task"""
        if self.selected_row >= len(self.config_items):
            return
            
        task = self.config_items[self.selected_row]
        height, width = self.stdscr.getmaxyx()
        
        self.stdscr.clear()
        
        # Header
        self.stdscr.attron(curses.A_BOLD | curses.color_pair(4))
        self.stdscr.addstr(1, 2, f"Task Details: {task['id']} - {task['name']}")
        self.stdscr.attroff(curses.A_BOLD | curses.color_pair(4))
        
        # Task info
        info_lines = [
            f"Category: {task['category']}",
            f"Priority: {task['priority']}",
            f"Status: {self.task_status.get(task['id'], 'pending')}",
            "",
            "Progress Information:"
        ]
        
        for idx, line in enumerate(info_lines):
            self.stdscr.addstr(3 + idx, 4, line)
        
        # If we have results
        if task['id'] in self.task_progress:
            result = self.task_progress[task['id']].get('result', {})
            
            result_lines = [
                f"Test Result: {result.get('test_result', 'N/A')}",
                f"Completed At: {result.get('timestamp', 'N/A')}",
                f"Files Created: {len(result.get('files_created', []))}",
                "",
                "Notes:",
                result.get('notes', 'No notes available')
            ]
            
            for idx, line in enumerate(result_lines):
                self.stdscr.addstr(9 + idx, 4, line)
        
        # Log preview
        task_id = task['id'].replace('.', '_')
        log_file = self.logs_dir / f"log_{task_id}.txt"
        
        if log_file.exists():
            self.stdscr.addstr(16, 4, "Recent Log Output:")
            try:
                with open(log_file, 'r') as f:
                    lines = f.readlines()[-10:]  # Last 10 lines
                    for idx, line in enumerate(lines):
                        if 18 + idx < height - 2:
                            self.stdscr.addstr(18 + idx, 6, line[:width-8].strip())
            except:
                self.stdscr.addstr(18, 6, "Could not read log file")
        
        # Footer
        self.stdscr.addstr(height - 1, 2, "Press ESC to return to list | L to view full logs")
    
    def refresh_display(self):
        """Refresh the entire display"""
        self.stdscr.clear()
        
        if self.view_mode == 'details':
            self.draw_task_details()
        else:
            self.draw_header()
            self.draw_task_list()
            self.draw_category_summary()
            self.draw_footer()
        
        self.stdscr.refresh()
    
    def handle_input(self):
        """Handle keyboard input"""
        key = self.stdscr.getch()
        height, width = self.stdscr.getmaxyx()
        list_height = height - 10
        
        if key == ord('q') or key == ord('Q'):
            return False
            
        elif key == curses.KEY_UP:
            if self.selected_row > 0:
                self.selected_row -= 1
                if self.selected_row < self.scroll_offset:
                    self.scroll_offset = self.selected_row
                    
        elif key == curses.KEY_DOWN:
            if self.selected_row < len(self.config_items) - 1:
                self.selected_row += 1
                if self.selected_row >= self.scroll_offset + list_height:
                    self.scroll_offset = self.selected_row - list_height + 1
                    
        elif key == ord('\n'):  # Enter
            self.view_mode = 'details' if self.view_mode == 'overview' else 'overview'
            
        elif key == 27:  # ESC
            self.view_mode = 'overview'
            
        elif key == ord('r') or key == ord('R'):
            self.check_task_status()
            
        elif key == ord('l') or key == ord('L'):
            # Open log file in external viewer
            if self.selected_row < len(self.config_items):
                task = self.config_items[self.selected_row]
                task_id = task['id'].replace('.', '_')
                log_file = self.logs_dir / f"log_{task_id}.txt"
                if log_file.exists():
                    os.system(f"less {log_file}")
        
        return True
    
    def run(self):
        """Main dashboard loop"""
        self.stdscr.nodelay(True)  # Non-blocking input
        self.stdscr.keypad(True)   # Enable special keys
        curses.curs_set(0)         # Hide cursor
        
        last_refresh = time.time()
        
        while True:
            # Auto-refresh every 5 seconds
            if time.time() - last_refresh > 5:
                self.check_task_status()
                last_refresh = time.time()
            
            self.refresh_display()
            
            # Handle input (non-blocking)
            try:
                if not self.handle_input():
                    break
            except:
                pass
            
            time.sleep(0.1)  # Small delay to reduce CPU usage

def main(stdscr):
    """Main entry point"""
    dashboard = MonitorDashboard(stdscr)
    dashboard.check_task_status()
    dashboard.run()

if __name__ == "__main__":
    try:
        curses.wrapper(main)
    except KeyboardInterrupt:
        print("\n👋 Dashboard closed.")
    except Exception as e:
        print(f"Error: {e}")
        import traceback
        traceback.print_exc()