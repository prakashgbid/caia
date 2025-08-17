#!/usr/bin/env python3
"""
Claude Code Ultimate - Results Aggregator
Aggregates results from parallel execution and updates ENHANCEMENT_MATRIX.md
"""

import json
import os
from pathlib import Path
from datetime import datetime
import shutil

class ResultsAggregator:
    def __init__(self):
        self.project_root = Path(__file__).parent
        self.results_dir = self.project_root / 'parallel_results'
        self.matrix_file = self.project_root / 'ENHANCEMENT_MATRIX.md'
        self.backup_dir = self.project_root / 'backups'
        
        # Create backup directory
        self.backup_dir.mkdir(exist_ok=True)
        
        # Load results
        self.results = {}
        self.load_results()
        
    def load_results(self):
        """Load all result files"""
        if not self.results_dir.exists():
            print("❌ No results directory found")
            return
            
        result_files = list(self.results_dir.glob('result_*.json'))
        print(f"📊 Found {len(result_files)} result files")
        
        for result_file in result_files:
            try:
                with open(result_file, 'r') as f:
                    result = json.load(f)
                    task_id = result.get('task_id', '')
                    if task_id:
                        self.results[task_id] = result
                        print(f"  ✅ Loaded {task_id}: {result['status']}")
            except Exception as e:
                print(f"  ❌ Error loading {result_file}: {e}")
    
    def backup_matrix(self):
        """Create backup of current matrix file"""
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        backup_file = self.backup_dir / f"ENHANCEMENT_MATRIX_{timestamp}.md"
        shutil.copy2(self.matrix_file, backup_file)
        print(f"📁 Backed up matrix to: {backup_file}")
        return backup_file
    
    def update_matrix(self):
        """Update ENHANCEMENT_MATRIX.md with results"""
        # Read current matrix
        with open(self.matrix_file, 'r') as f:
            lines = f.readlines()
        
        updated_lines = []
        updates_made = 0
        current_section = None
        
        for line in lines:
            # Track current section
            if line.startswith('## ') and any(f'{i}.' in line for i in range(1, 13)):
                current_section = line.strip()
                # Update section header with counts
                if '[' in line and ']' in line:
                    # Count completed items in this section
                    section_completed = 0
                    section_total = 0
                    
                    # Look ahead to count items
                    for future_line in lines[lines.index(line)+1:]:
                        if future_line.startswith('## '):
                            break
                        if '|' in future_line and any(status in future_line for status in ['⬜', '✅', '🟨', '❌', '🔄']):
                            section_total += 1
                            parts = future_line.split('|')
                            if len(parts) > 1:
                                task_id = parts[1].strip()
                                if task_id in self.results and self.results[task_id]['status'] == 'completed':
                                    section_completed += 1
                    
                    # Update section header
                    section_name = line.split('[')[0].strip('# ')
                    line = f"{section_name}[{section_completed}/{section_total}]\n"
            
            # Update task lines
            if '|' in line and '⬜ TODO' in line:
                parts = line.split('|')
                if len(parts) >= 6:
                    task_id = parts[1].strip()
                    
                    if task_id in self.results:
                        result = self.results[task_id]
                        status = result['status']
                        
                        # Update status emoji
                        if status == 'completed':
                            line = line.replace('⬜ TODO', '✅ COMPLETED')
                            updates_made += 1
                        elif status == 'failed':
                            line = line.replace('⬜ TODO', '❌ FAILED')
                            updates_made += 1
                        elif status == 'blocked':
                            line = line.replace('⬜ TODO', '⚠️ BLOCKED')
                            updates_made += 1
                        
                        # Add notes if present
                        if result.get('notes') and len(parts) > 5:
                            parts[5] = f" {result['notes'][:50]}... "
                            line = '|'.join(parts)
            
            # Update overall progress
            if line.startswith('## 📊 Overall Progress:'):
                total_completed = sum(1 for r in self.results.values() if r['status'] == 'completed')
                total_items = 82
                percentage = (total_completed / total_items) * 100
                line = f"## 📊 Overall Progress: {total_completed}/{total_items} items ({percentage:.1f}%)\n"
            
            updated_lines.append(line)
        
        # Add session log entry
        session_log_marker = "## 📋 Implementation Sessions Log"
        session_index = None
        
        for i, line in enumerate(updated_lines):
            if session_log_marker in line:
                session_index = i
                break
        
        if session_index:
            # Add new session entry
            timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
            session_entry = f"""
### Session {timestamp} - Parallel Execution
- **Started**: All 82 items in parallel
- **Completed**: {sum(1 for r in self.results.values() if r['status'] == 'completed')} items
- **Failed**: {sum(1 for r in self.results.values() if r['status'] == 'failed')} items
- **Blocked**: {sum(1 for r in self.results.values() if r['status'] == 'blocked')} items
- **Notes**: Parallel execution using {len(self.results)} Claude Code instances

"""
            # Find where to insert (after the marker and any existing text)
            insert_index = session_index + 1
            while insert_index < len(updated_lines) and not updated_lines[insert_index].startswith('###'):
                insert_index += 1
            
            updated_lines.insert(insert_index, session_entry)
        
        # Write updated matrix
        with open(self.matrix_file, 'w') as f:
            f.writelines(updated_lines)
        
        print(f"✅ Updated {updates_made} items in ENHANCEMENT_MATRIX.md")
        
    def generate_summary_report(self):
        """Generate detailed summary report"""
        report_file = self.project_root / 'PARALLEL_EXECUTION_REPORT.md'
        
        # Calculate statistics
        stats = {
            'total': len(self.results),
            'completed': sum(1 for r in self.results.values() if r['status'] == 'completed'),
            'failed': sum(1 for r in self.results.values() if r['status'] == 'failed'),
            'blocked': sum(1 for r in self.results.values() if r['status'] == 'blocked'),
            'timestamp': datetime.now().isoformat()
        }
        
        # Group by category
        categories = {}
        for task_id, result in self.results.items():
            # Extract category from task_id (e.g., "1.1" -> "1")
            category_num = task_id.split('.')[0] if '.' in task_id else '0'
            if category_num not in categories:
                categories[category_num] = {'completed': 0, 'failed': 0, 'blocked': 0, 'total': 0}
            
            categories[category_num]['total'] += 1
            categories[category_num][result['status']] = categories[category_num].get(result['status'], 0) + 1
        
        # Generate report
        report = f"""# Claude Code Ultimate - Parallel Execution Report

Generated: {stats['timestamp']}

## Executive Summary

Successfully executed **{stats['total']} parallel Claude Code instances** to configure the Claude Code Ultimate enhancement system.

### Overall Results
- ✅ **Completed**: {stats['completed']}/{stats['total']} ({stats['completed']/stats['total']*100:.1f}%)
- ❌ **Failed**: {stats['failed']}/{stats['total']} ({stats['failed']/stats['total']*100:.1f}%)
- ⚠️ **Blocked**: {stats['blocked']}/{stats['total']} ({stats['blocked']/stats['total']*100:.1f}%)

## Category Breakdown

| Category | Completed | Failed | Blocked | Total | Success Rate |
|----------|-----------|--------|---------|-------|--------------|
"""
        
        category_names = {
            '1': 'Core Configuration Files',
            '2': 'Memory & Context Management',
            '3': 'Performance Optimizations',
            '4': 'Agent & Orchestration Systems',
            '5': 'MCP Server Ecosystem',
            '6': 'Automation & Hooks',
            '7': 'CI/CD & DevOps Integration',
            '8': 'Advanced Intelligence Features',
            '9': 'Speed & Efficiency Configurations',
            '10': 'Security & Compliance',
            '11': 'Project Management Integration',
            '12': 'Testing & Quality Assurance'
        }
        
        for cat_num in sorted(categories.keys()):
            cat_data = categories[cat_num]
            cat_name = category_names.get(cat_num, f"Category {cat_num}")
            success_rate = (cat_data['completed'] / cat_data['total'] * 100) if cat_data['total'] > 0 else 0
            
            report += f"| {cat_name} | {cat_data['completed']} | {cat_data.get('failed', 0)} | {cat_data.get('blocked', 0)} | {cat_data['total']} | {success_rate:.1f}% |\n"
        
        # Add detailed results
        report += """

## Detailed Task Results

### ✅ Completed Tasks
"""
        for task_id, result in sorted(self.results.items()):
            if result['status'] == 'completed':
                report += f"- **{task_id}**: {result.get('notes', 'Successfully configured')}\n"
        
        report += """

### ❌ Failed Tasks
"""
        for task_id, result in sorted(self.results.items()):
            if result['status'] == 'failed':
                report += f"- **{task_id}**: {result.get('notes', 'Configuration failed')}\n"
        
        report += """

### ⚠️ Blocked Tasks
"""
        for task_id, result in sorted(self.results.items()):
            if result['status'] == 'blocked':
                report += f"- **{task_id}**: {result.get('notes', 'Blocked by dependencies')}\n"
        
        # Add recommendations
        report += f"""

## Recommendations

Based on the parallel execution results:

1. **Priority Items**: Focus on completing the {stats['failed'] + stats['blocked']} non-completed items
2. **Dependencies**: Resolve blocked items by addressing their dependencies
3. **Retry Strategy**: Failed items may succeed with adjusted parameters
4. **Next Phase**: With {stats['completed']/stats['total']*100:.1f}% completion, consider moving to integration testing

## Files Generated

- Configuration files created in: `configs/`
- Test scripts created in: `tests/`
- Documentation updated in: `docs/`
- Logs available in: `parallel_logs/`

## Next Steps

1. Review failed and blocked items
2. Run integration tests on completed configurations
3. Deploy to development environment
4. Begin performance benchmarking

---
*Report generated by Claude Code Ultimate Parallel Orchestrator*
"""
        
        # Write report
        with open(report_file, 'w') as f:
            f.write(report)
        
        print(f"📄 Generated detailed report: {report_file}")
        
        return stats

def main():
    """Main execution"""
    print("""
╔══════════════════════════════════════════════════════════════╗
║         CLAUDE CODE ULTIMATE - RESULTS AGGREGATOR           ║
╚══════════════════════════════════════════════════════════════╝
    """)
    
    aggregator = ResultsAggregator()
    
    if not aggregator.results:
        print("❌ No results to aggregate. Run parallel execution first.")
        return
    
    print(f"\n📊 Processing {len(aggregator.results)} results...")
    
    # Backup current matrix
    print("\n📁 Creating backup...")
    aggregator.backup_matrix()
    
    # Update matrix
    print("\n📝 Updating ENHANCEMENT_MATRIX.md...")
    aggregator.update_matrix()
    
    # Generate report
    print("\n📄 Generating summary report...")
    stats = aggregator.generate_summary_report()
    
    # Display summary
    print("\n" + "=" * 60)
    print("✨ AGGREGATION COMPLETE")
    print("=" * 60)
    print(f"✅ Completed: {stats['completed']}/{stats['total']}")
    print(f"❌ Failed: {stats['failed']}/{stats['total']}")
    print(f"⚠️  Blocked: {stats['blocked']}/{stats['total']}")
    print(f"📊 Success Rate: {stats['completed']/stats['total']*100:.1f}%")
    print("\n📄 Reports generated:")
    print("  - ENHANCEMENT_MATRIX.md (updated)")
    print("  - PARALLEL_EXECUTION_REPORT.md")
    print("\n✨ All results aggregated successfully!")

if __name__ == "__main__":
    main()