#!/usr/bin/env python3

"""
CCO Auto-Detector
Detects when CCO should be used and suggests parallel implementation
"""

import re
from typing import List, Dict, Tuple

class CCOAutoDetector:
    def __init__(self):
        self.parallel_keywords = [
            "all", "every", "each", "multiple", "batch",
            "parallel", "concurrent", "simultaneous"
        ]
        
        self.parallel_patterns = [
            r"implement all \d+ configurations?",
            r"fix (all|every) packages?",
            r"update (all|every) files?",
            r"test (all|multiple) components?"
        ]
    
    def should_use_cco(self, task_description: str) -> Tuple[bool, str]:
        """Determine if CCO should be used"""
        task_lower = task_description.lower()
        
        # Check keywords
        for keyword in self.parallel_keywords:
            if keyword in task_lower:
                return True, f"Detected parallel keyword: '{keyword}'"
        
        # Check patterns
        for pattern in self.parallel_patterns:
            if re.search(pattern, task_lower):
                return True, f"Matched parallel pattern: '{pattern}'"
        
        # Check for multiple items
        if task_lower.count(',') >= 2:
            return True, "Multiple items detected (3+ comma-separated)"
        
        return False, "No parallel execution needed"
    
    def generate_cco_plan(self, task_description: str) -> Dict:
        """Generate CCO execution plan"""
        use_cco, reason = self.should_use_cco(task_description)
        
        if not use_cco:
            return {"use_cco": False, "reason": reason}
        
        return {
            "use_cco": True,
            "reason": reason,
            "suggested_config": {
                "maxInstances": 10,
                "taskTimeout": 30000,
                "retryAttempts": 2
            },
            "estimated_speedup": "10-20x faster",
            "command": "python3 ccu_config_orchestrator.py"
        }

# Test the detector
if __name__ == "__main__":
    import sys
    detector = CCOAutoDetector()
    
    if len(sys.argv) > 1:
        task = " ".join(sys.argv[1:])
        plan = detector.generate_cco_plan(task)
        
        if plan["use_cco"]:
            print(f"✅ USE CCO: {plan['reason']}")
            print(f"⚡ Speedup: {plan['estimated_speedup']}")
            print(f"🚀 Command: {plan['command']}")
        else:
            print(f"❌ Sequential execution: {plan['reason']}")
