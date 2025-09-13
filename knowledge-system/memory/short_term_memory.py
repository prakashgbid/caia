"""
Short-term Memory - Current session and conversation memory
"""

from typing import Dict, Any, List, Optional
from dataclasses import dataclass
from datetime import datetime, timedelta
from collections import deque

@dataclass
class ShortTermItem:
    content: str
    timestamp: datetime
    context: Dict[str, Any]
    importance: float = 0.5

class ShortTermMemory:
    \"\"\"Short-term memory for current session/conversation\"\"\"
    
    def __init__(self, max_items: int = 100, retention_minutes: int = 60):
        self.max_items = max_items
        self.retention_time = timedelta(minutes=retention_minutes)
        self.items: deque = deque(maxlen=max_items)
        self.session_start = datetime.now()
    
    def store(self, content: str, context: Dict[str, Any] = None, importance: float = 0.5):
        \"\"\"Store item in short-term memory\"\"\"
        item = ShortTermItem(
            content=content,
            timestamp=datetime.now(),
            context=context or {},
            importance=importance
        )
        self.items.append(item)
    
    def retrieve(self, query: str, limit: int = 10) -> List[ShortTermItem]:
        \"\"\"Retrieve items from short-term memory\"\"\"
        # Simple keyword matching
        query_words = query.lower().split()
        matches = []
        
        for item in self.items:
            if any(word in item.content.lower() for word in query_words):
                matches.append(item)
        
        # Sort by recency and importance
        matches.sort(key=lambda x: (x.timestamp, x.importance), reverse=True)
        return matches[:limit]
    
    def get_recent(self, minutes: int = 10) -> List[ShortTermItem]:
        \"\"\"Get recent items\"\"\"
        cutoff = datetime.now() - timedelta(minutes=minutes)
        return [item for item in self.items if item.timestamp >= cutoff]
    
    def clear_expired(self):
        \"\"\"Clear expired items\"\"\"
        cutoff = datetime.now() - self.retention_time
        while self.items and self.items[0].timestamp < cutoff:
            self.items.popleft()