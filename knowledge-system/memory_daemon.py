#!/usr/bin/env python3
import time
import sys
import os
sys.path.append('/Users/MAC/Documents/projects/caia/knowledge-system')
from intelligent_companion import IntelligentCompanion

companion = IntelligentCompanion()
print("Memory consolidation daemon started")

while True:
    try:
        # Consolidate memories every hour
        time.sleep(3600)
        companion.consolidate_learning()
        print(f"Memories consolidated at {time.strftime('%Y-%m-%d %H:%M:%S')}")
    except KeyboardInterrupt:
        break
    except Exception as e:
        print(f"Error: {e}")
