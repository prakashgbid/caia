#!/usr/bin/env python3
"""
Intelligent AI Companion System
A self-learning system that remembers everything and continuously improves
"""

import os
import json
import sqlite3
import numpy as np
from datetime import datetime
from typing import Dict, List, Any, Optional
from dataclasses import dataclass, field
from pathlib import Path
import logging
import hashlib
import time

# AI/ML imports
try:
    import chromadb
    from chromadb.config import Settings
    import ollama
    from sentence_transformers import SentenceTransformer
    import redis
    import torch
    from transformers import pipeline, AutoTokenizer, AutoModelForSequenceClassification
    LIBRARIES_AVAILABLE = True
except ImportError as e:
    print(f"Warning: Some libraries not available: {e}")
    LIBRARIES_AVAILABLE = False

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# ============================================================================
# DATA STRUCTURES
# ============================================================================

@dataclass
class UserInput:
    """Represents a user input with all metadata"""
    text: str
    category: str
    timestamp: datetime
    project: str
    context: Dict[str, Any]
    embedding: Optional[np.ndarray] = None
    response: Optional[str] = None
    feedback: Optional[str] = None
    success: Optional[bool] = None
    tags: List[str] = field(default_factory=list)
    metadata: Dict[str, Any] = field(default_factory=dict)

@dataclass
class Memory:
    """Represents a memory unit"""
    id: str
    content: str
    type: str  # episodic, semantic, procedural
    importance: float
    timestamp: datetime
    associations: List[str] = field(default_factory=list)
    access_count: int = 0
    last_accessed: Optional[datetime] = None
    embedding: Optional[np.ndarray] = None

@dataclass
class LearningPattern:
    """Represents a learned pattern"""
    pattern: str
    frequency: int
    success_rate: float
    examples: List[str]
    learned_at: datetime
    last_used: Optional[datetime] = None
    confidence: float = 0.0

# ============================================================================
# INTELLIGENT INPUT CATEGORIZER
# ============================================================================

class IntelligentInputCategorizer:
    """Categorizes and stores all user inputs intelligently"""
    
    CATEGORIES = {
        "future_features": ["feature", "add", "implement", "build", "create", "want", "need"],
        "ccu_updates": ["ccu", "claude code", "cc", "configuration", "optimize"],
        "caia_updates": ["caia", "agent", "ai", "framework", "architecture"],
        "corrections": ["fix", "wrong", "error", "mistake", "correct", "bug"],
        "preferences": ["prefer", "like", "want", "style", "always", "never"],
        "instructions": ["do", "make", "should", "must", "need to", "have to"],
        "feedback": ["good", "bad", "better", "worse", "great", "terrible"],
        "questions": ["what", "how", "why", "when", "where", "can you"],
        "decisions": ["decided", "choose", "select", "option", "going with"],
        "learnings": ["learned", "realized", "discovered", "found out", "understood"]
    }
    
    def __init__(self, db_path: str = "/Users/MAC/Documents/projects/caia/knowledge-system/data/companion.db"):
        self.db_path = db_path
        self.embedder = None
        self.llm = None
        
        # Initialize components
        self._init_database()
        self._init_embedder()
        self._init_local_llm()
        
        logger.info("Intelligent Input Categorizer initialized")
    
    def _init_database(self):
        """Initialize SQLite database for storing inputs"""
        os.makedirs(os.path.dirname(self.db_path), exist_ok=True)
        
        self.conn = sqlite3.connect(self.db_path, check_same_thread=False)
        self.cursor = self.conn.cursor()
        
        # Create tables
        self.cursor.execute("""
            CREATE TABLE IF NOT EXISTS user_inputs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                text TEXT NOT NULL,
                category TEXT NOT NULL,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                project TEXT,
                context TEXT,
                embedding BLOB,
                response TEXT,
                feedback TEXT,
                success BOOLEAN,
                tags TEXT,
                metadata TEXT
            )
        """)
        
        self.cursor.execute("""
            CREATE TABLE IF NOT EXISTS learning_patterns (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                pattern TEXT NOT NULL,
                frequency INTEGER DEFAULT 1,
                success_rate REAL DEFAULT 0.0,
                examples TEXT,
                learned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                last_used DATETIME,
                confidence REAL DEFAULT 0.0
            )
        """)
        
        self.cursor.execute("""
            CREATE TABLE IF NOT EXISTS memories (
                id TEXT PRIMARY KEY,
                content TEXT NOT NULL,
                type TEXT NOT NULL,
                importance REAL DEFAULT 0.5,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                associations TEXT,
                access_count INTEGER DEFAULT 0,
                last_accessed DATETIME,
                embedding BLOB
            )
        """)
        
        self.conn.commit()
    
    def _init_embedder(self):
        """Initialize embedding model"""
        if LIBRARIES_AVAILABLE:
            try:
                self.embedder = SentenceTransformer('all-MiniLM-L6-v2')
                logger.info("Embedder initialized")
            except Exception as e:
                logger.error(f"Failed to initialize embedder: {e}")
    
    def _init_local_llm(self):
        """Initialize local LLM for categorization"""
        if LIBRARIES_AVAILABLE:
            try:
                # Check if Ollama is available
                models = ollama.list()
                if models:
                    self.llm = "phi"  # Use small, fast model for categorization
                    logger.info(f"Local LLM initialized with {self.llm}")
            except Exception as e:
                logger.warning(f"Ollama not available: {e}")
    
    def categorize(self, text: str, context: Dict[str, Any] = None) -> str:
        """Categorize user input intelligently"""
        # Simple keyword-based categorization first
        text_lower = text.lower()
        
        for category, keywords in self.CATEGORIES.items():
            if any(keyword in text_lower for keyword in keywords):
                return category
        
        # Use local LLM if available
        if self.llm:
            try:
                prompt = f"""Categorize this input into one of these categories:
                {', '.join(self.CATEGORIES.keys())}
                
                Input: {text}
                
                Category:"""
                
                response = ollama.generate(model=self.llm, prompt=prompt)
                category = response['response'].strip().lower()
                
                if category in self.CATEGORIES:
                    return category
            except Exception as e:
                logger.warning(f"LLM categorization failed: {e}")
        
        # Default category
        return "instructions"
    
    def store_input(self, text: str, context: Dict[str, Any] = None, 
                    response: str = None, project: str = "caia") -> UserInput:
        """Store user input with all metadata"""
        # Categorize input
        category = self.categorize(text, context)
        
        # Generate embedding
        embedding = None
        if self.embedder:
            embedding = self.embedder.encode(text)
        
        # Create UserInput object
        user_input = UserInput(
            text=text,
            category=category,
            timestamp=datetime.now(),
            project=project,
            context=context or {},
            embedding=embedding,
            response=response
        )
        
        # Store in database
        self.cursor.execute("""
            INSERT INTO user_inputs 
            (text, category, project, context, embedding, response, tags, metadata)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            user_input.text,
            user_input.category,
            user_input.project,
            json.dumps(user_input.context),
            embedding.tobytes() if embedding is not None else None,
            user_input.response,
            json.dumps(user_input.tags),
            json.dumps(user_input.metadata)
        ))
        self.conn.commit()
        
        logger.info(f"Stored input in category: {category}")
        
        # Learn from this input
        self._learn_from_input(user_input)
        
        return user_input
    
    def _learn_from_input(self, user_input: UserInput):
        """Learn patterns from user input"""
        # Extract patterns (simple n-gram approach)
        words = user_input.text.split()
        
        for i in range(len(words) - 2):
            pattern = " ".join(words[i:i+3])
            
            # Check if pattern exists
            self.cursor.execute(
                "SELECT * FROM learning_patterns WHERE pattern = ?",
                (pattern,)
            )
            existing = self.cursor.fetchone()
            
            if existing:
                # Update frequency
                self.cursor.execute("""
                    UPDATE learning_patterns 
                    SET frequency = frequency + 1, last_used = CURRENT_TIMESTAMP
                    WHERE pattern = ?
                """, (pattern,))
            else:
                # Create new pattern
                self.cursor.execute("""
                    INSERT INTO learning_patterns (pattern, examples)
                    VALUES (?, ?)
                """, (pattern, json.dumps([user_input.text])))
            
            self.conn.commit()
    
    def search_similar_inputs(self, query: str, limit: int = 5) -> List[UserInput]:
        """Search for similar past inputs"""
        if not self.embedder:
            return []
        
        # Generate query embedding
        query_embedding = self.embedder.encode(query)
        
        # Get all inputs with embeddings
        self.cursor.execute("""
            SELECT text, category, project, embedding 
            FROM user_inputs 
            WHERE embedding IS NOT NULL
        """)
        
        results = []
        for row in self.cursor.fetchall():
            stored_embedding = np.frombuffer(row[3], dtype=np.float32)
            
            # Calculate similarity
            similarity = np.dot(query_embedding, stored_embedding) / (
                np.linalg.norm(query_embedding) * np.linalg.norm(stored_embedding)
            )
            
            results.append((similarity, row[0], row[1], row[2]))
        
        # Sort by similarity and return top results
        results.sort(reverse=True)
        
        return results[:limit]
    
    def get_category_stats(self) -> Dict[str, int]:
        """Get statistics for each category"""
        self.cursor.execute("""
            SELECT category, COUNT(*) as count 
            FROM user_inputs 
            GROUP BY category
        """)
        
        return dict(self.cursor.fetchall())
    
    def get_frequent_patterns(self, min_frequency: int = 3) -> List[LearningPattern]:
        """Get frequently occurring patterns"""
        self.cursor.execute("""
            SELECT * FROM learning_patterns 
            WHERE frequency >= ? 
            ORDER BY frequency DESC
        """, (min_frequency,))
        
        patterns = []
        for row in self.cursor.fetchall():
            patterns.append(LearningPattern(
                pattern=row[1],
                frequency=row[2],
                success_rate=row[3],
                examples=json.loads(row[4]) if row[4] else [],
                learned_at=datetime.fromisoformat(row[5]),
                last_used=datetime.fromisoformat(row[6]) if row[6] else None,
                confidence=row[7]
            ))
        
        return patterns

# ============================================================================
# MEMORY MANAGEMENT SYSTEM
# ============================================================================

class IntelligentMemorySystem:
    """Advanced memory system with multiple memory types"""
    
    def __init__(self, db_path: str = None, use_redis: bool = True):
        self.db_path = db_path or "/Users/MAC/Documents/projects/caia/knowledge-system/data/companion.db"
        self.redis_client = None
        self.chroma_client = None
        self.embedder = None
        
        # Initialize components
        self._init_database()
        self._init_redis(use_redis)
        self._init_chroma()
        self._init_embedder()
        
        logger.info("Intelligent Memory System initialized")
    
    def _init_database(self):
        """Initialize SQLite for long-term memory"""
        self.conn = sqlite3.connect(self.db_path, check_same_thread=False)
        self.cursor = self.conn.cursor()
    
    def _init_redis(self, use_redis: bool):
        """Initialize Redis for working memory"""
        if use_redis and LIBRARIES_AVAILABLE:
            try:
                self.redis_client = redis.Redis(host='localhost', port=6379, db=0)
                self.redis_client.ping()
                logger.info("Redis connected for working memory")
            except Exception as e:
                logger.warning(f"Redis not available: {e}")
    
    def _init_chroma(self):
        """Initialize ChromaDB for semantic memory"""
        self.collection = None
        if LIBRARIES_AVAILABLE:
            try:
                self.chroma_client = chromadb.PersistentClient(
                    path="/Users/MAC/Documents/projects/caia/knowledge-system/data/chromadb"
                )
                self.collection = self.chroma_client.get_or_create_collection(
                    name="companion_memory"
                )
                logger.info("ChromaDB initialized for semantic memory")
            except Exception as e:
                logger.error(f"ChromaDB initialization failed: {e}")
    
    def _init_embedder(self):
        """Initialize embedding model"""
        if LIBRARIES_AVAILABLE:
            try:
                self.embedder = SentenceTransformer('all-MiniLM-L6-v2')
            except Exception as e:
                logger.error(f"Embedder initialization failed: {e}")
    
    def store_memory(self, content: str, memory_type: str = "semantic", 
                     importance: float = 0.5) -> Memory:
        """Store a memory with importance rating"""
        memory_id = hashlib.md5(content.encode()).hexdigest()
        
        # Generate embedding
        embedding = None
        if self.embedder:
            embedding = self.embedder.encode(content)
        
        # Create memory object
        memory = Memory(
            id=memory_id,
            content=content,
            type=memory_type,
            importance=importance,
            timestamp=datetime.now(),
            embedding=embedding
        )
        
        # Store in SQLite (long-term)
        self.cursor.execute("""
            INSERT OR REPLACE INTO memories 
            (id, content, type, importance, embedding)
            VALUES (?, ?, ?, ?, ?)
        """, (
            memory.id,
            memory.content,
            memory.type,
            memory.importance,
            embedding.tobytes() if embedding is not None else None
        ))
        self.conn.commit()
        
        # Store in ChromaDB (semantic search)
        if self.collection and embedding is not None:
            self.collection.add(
                embeddings=[embedding.tolist()],
                documents=[content],
                ids=[memory_id],
                metadatas=[{
                    "type": memory_type,
                    "importance": importance,
                    "timestamp": memory.timestamp.isoformat()
                }]
            )
        
        # Store in Redis (working memory) if important
        if self.redis_client and importance > 0.7:
            self.redis_client.setex(
                f"memory:{memory_id}",
                3600,  # 1 hour TTL for working memory
                json.dumps({
                    "content": content,
                    "type": memory_type,
                    "importance": importance
                })
            )
        
        logger.info(f"Stored {memory_type} memory with importance {importance}")
        return memory
    
    def recall_memory(self, query: str, memory_type: str = None, 
                      limit: int = 5) -> List[Memory]:
        """Recall relevant memories based on query"""
        memories = []
        
        # First check working memory (Redis)
        if self.redis_client:
            for key in self.redis_client.scan_iter("memory:*"):
                memory_data = json.loads(self.redis_client.get(key))
                if memory_type is None or memory_data['type'] == memory_type:
                    if query.lower() in memory_data['content'].lower():
                        memories.append(Memory(
                            id=key.decode().split(':')[1],
                            content=memory_data['content'],
                            type=memory_data['type'],
                            importance=memory_data['importance'],
                            timestamp=datetime.now()
                        ))
        
        # Then search semantic memory (ChromaDB)
        if self.collection and self.embedder:
            query_embedding = self.embedder.encode(query)
            
            results = self.collection.query(
                query_embeddings=[query_embedding.tolist()],
                n_results=limit,
                where={"type": memory_type} if memory_type else None
            )
            
            for i, doc in enumerate(results['documents'][0]):
                metadata = results['metadatas'][0][i]
                memories.append(Memory(
                    id=results['ids'][0][i],
                    content=doc,
                    type=metadata['type'],
                    importance=metadata['importance'],
                    timestamp=datetime.fromisoformat(metadata['timestamp'])
                ))
        
        # Update access counts
        for memory in memories:
            self.cursor.execute("""
                UPDATE memories 
                SET access_count = access_count + 1, 
                    last_accessed = CURRENT_TIMESTAMP
                WHERE id = ?
            """, (memory.id,))
        self.conn.commit()
        
        return memories[:limit]
    
    def consolidate_memories(self):
        """Consolidate and strengthen important memories"""
        # Get frequently accessed memories
        self.cursor.execute("""
            SELECT * FROM memories 
            WHERE access_count > 5 
            ORDER BY importance DESC, access_count DESC
            LIMIT 100
        """)
        
        for row in self.cursor.fetchall():
            memory_id = row[0]
            importance = row[3]
            access_count = row[6]
            
            # Increase importance based on access
            new_importance = min(1.0, importance + (access_count * 0.01))
            
            self.cursor.execute("""
                UPDATE memories 
                SET importance = ? 
                WHERE id = ?
            """, (new_importance, memory_id))
        
        self.conn.commit()
        logger.info("Memory consolidation completed")
    
    def forget_unimportant(self, threshold: float = 0.2, days_old: int = 30):
        """Forget unimportant old memories to save space"""
        self.cursor.execute("""
            DELETE FROM memories 
            WHERE importance < ? 
            AND julianday('now') - julianday(timestamp) > ?
            AND access_count < 2
        """, (threshold, days_old))
        
        deleted = self.cursor.rowcount
        self.conn.commit()
        
        logger.info(f"Forgot {deleted} unimportant memories")

# ============================================================================
# CONTINUOUS LEARNING SYSTEM
# ============================================================================

class ContinuousLearningSystem:
    """System that learns continuously from all interactions"""
    
    def __init__(self):
        self.categorizer = IntelligentInputCategorizer()
        self.memory = IntelligentMemorySystem()
        self.learning_rate = 0.01
        self.patterns = {}
        self.preferences = {}
        
        logger.info("Continuous Learning System initialized")
    
    def learn_from_interaction(self, user_input: str, cc_response: str, 
                                feedback: Optional[str] = None):
        """Learn from a complete interaction"""
        # Store the input
        stored_input = self.categorizer.store_input(
            text=user_input,
            response=cc_response
        )
        
        # Store as episodic memory
        self.memory.store_memory(
            content=f"User: {user_input}\nCC: {cc_response}",
            memory_type="episodic",
            importance=0.6
        )
        
        # Extract patterns
        self._extract_patterns(user_input, cc_response)
        
        # Learn preferences if feedback provided
        if feedback:
            self._learn_preference(user_input, cc_response, feedback)
        
        # Update success metrics
        if feedback and ("good" in feedback.lower() or "correct" in feedback.lower()):
            self._update_success_metrics(stored_input.category, True)
        elif feedback and ("bad" in feedback.lower() or "wrong" in feedback.lower()):
            self._update_success_metrics(stored_input.category, False)
    
    def _extract_patterns(self, user_input: str, response: str):
        """Extract and learn patterns from interactions"""
        # Simple pattern extraction (can be made more sophisticated)
        input_words = user_input.split()
        
        # Look for command patterns
        if len(input_words) >= 2:
            command_pattern = f"{input_words[0]} {input_words[1]}"
            
            if command_pattern not in self.patterns:
                self.patterns[command_pattern] = {
                    'count': 0,
                    'responses': [],
                    'success_rate': 0.0
                }
            
            self.patterns[command_pattern]['count'] += 1
            self.patterns[command_pattern]['responses'].append(response[:100])
        
        # Store as semantic memory
        if len(self.patterns) % 10 == 0:
            self.memory.store_memory(
                content=f"Learned patterns: {json.dumps(self.patterns)}",
                memory_type="procedural",
                importance=0.7
            )
    
    def _learn_preference(self, user_input: str, response: str, feedback: str):
        """Learn user preferences from feedback"""
        preference_key = f"{user_input[:50]}"
        
        self.preferences[preference_key] = {
            'preferred_response_style': response[:100],
            'feedback': feedback,
            'learned_at': datetime.now().isoformat()
        }
        
        # Store as preference memory
        self.memory.store_memory(
            content=f"Preference: {preference_key} -> {feedback}",
            memory_type="semantic",
            importance=0.8
        )
    
    def _update_success_metrics(self, category: str, success: bool):
        """Update success metrics for categories"""
        self.categorizer.cursor.execute("""
            UPDATE user_inputs 
            SET success = ? 
            WHERE category = ? 
            ORDER BY timestamp DESC 
            LIMIT 1
        """, (success, category))
        self.categorizer.conn.commit()
    
    def suggest_based_on_learning(self, current_input: str) -> Optional[str]:
        """Suggest actions based on learned patterns"""
        # Search for similar past inputs
        similar_inputs = self.categorizer.search_similar_inputs(current_input, limit=3)
        
        if similar_inputs:
            # Recall relevant memories
            memories = self.memory.recall_memory(current_input, limit=3)
            
            # Generate suggestion based on patterns and memories
            suggestion = self._generate_suggestion(similar_inputs, memories)
            
            return suggestion
        
        return None
    
    def _generate_suggestion(self, similar_inputs: List, memories: List[Memory]) -> str:
        """Generate intelligent suggestion"""
        if not similar_inputs and not memories:
            return None
        
        suggestion = "Based on your history:\n"
        
        if similar_inputs:
            suggestion += f"- Similar to: {similar_inputs[0][1]}\n"
        
        if memories:
            suggestion += f"- Related memory: {memories[0].content[:100]}\n"
        
        # Look for patterns
        for pattern, data in self.patterns.items():
            if pattern.lower() in similar_inputs[0][1].lower():
                if data['success_rate'] > 0.7:
                    suggestion += f"- This pattern usually works well\n"
                break
        
        return suggestion

# ============================================================================
# MAIN COMPANION SYSTEM
# ============================================================================

class IntelligentCompanion:
    """Main intelligent companion system orchestrator"""
    
    def __init__(self):
        self.learning_system = ContinuousLearningSystem()
        self.is_learning = True
        
        logger.info("Intelligent Companion System activated")
    
    def process_input(self, user_input: str, context: Dict[str, Any] = None) -> Dict[str, Any]:
        """Process user input and learn from it"""
        # Get suggestions based on learning
        suggestion = self.learning_system.suggest_based_on_learning(user_input)
        
        # Store input
        stored_input = self.learning_system.categorizer.store_input(
            text=user_input,
            context=context
        )
        
        # Prepare response
        response = {
            'category': stored_input.category,
            'suggestion': suggestion,
            'similar_inputs': self.learning_system.categorizer.search_similar_inputs(user_input),
            'relevant_memories': self.learning_system.memory.recall_memory(user_input),
            'stats': self.learning_system.categorizer.get_category_stats()
        }
        
        return response
    
    def learn_from_response(self, user_input: str, cc_response: str, feedback: str = None):
        """Learn from CC response and optional feedback"""
        self.learning_system.learn_from_interaction(user_input, cc_response, feedback)
    
    def get_insights(self) -> Dict[str, Any]:
        """Get insights from learned data"""
        return {
            'category_stats': self.learning_system.categorizer.get_category_stats(),
            'frequent_patterns': self.learning_system.categorizer.get_frequent_patterns(),
            'learned_preferences': self.learning_system.preferences,
            'memory_count': len(self.learning_system.memory.recall_memory("", limit=1000))
        }
    
    def consolidate_learning(self):
        """Consolidate and optimize learned knowledge"""
        self.learning_system.memory.consolidate_memories()
        self.learning_system.memory.forget_unimportant()
        logger.info("Learning consolidated")

# ============================================================================
# CLI INTERFACE
# ============================================================================

def main():
    """CLI interface for testing the companion system"""
    companion = IntelligentCompanion()
    
    print("🤖 Intelligent Companion System")
    print("=" * 50)
    print("Commands:")
    print("  'quit' - Exit")
    print("  'stats' - Show statistics")
    print("  'insights' - Show learning insights")
    print("  'consolidate' - Consolidate memories")
    print("=" * 50)
    
    while True:
        try:
            user_input = input("\nYou: ").strip()
            
            if user_input.lower() == 'quit':
                break
            elif user_input.lower() == 'stats':
                stats = companion.learning_system.categorizer.get_category_stats()
                print("\n📊 Category Statistics:")
                for category, count in stats.items():
                    print(f"  {category}: {count}")
            elif user_input.lower() == 'insights':
                insights = companion.get_insights()
                print("\n🧠 Learning Insights:")
                print(f"  Total inputs: {sum(insights['category_stats'].values())}")
                print(f"  Patterns learned: {len(insights['learned_preferences'])}")
                print(f"  Memories stored: {insights['memory_count']}")
            elif user_input.lower() == 'consolidate':
                companion.consolidate_learning()
                print("✅ Memories consolidated")
            else:
                # Process normal input
                response = companion.process_input(user_input)
                
                print(f"\n📝 Category: {response['category']}")
                
                if response['suggestion']:
                    print(f"\n💡 Suggestion:\n{response['suggestion']}")
                
                if response['similar_inputs']:
                    print(f"\n🔍 Similar past inputs:")
                    for sim in response['similar_inputs'][:3]:
                        print(f"  - {sim[1][:50]}...")
                
                # Simulate CC response
                cc_response = "I'll help you with that..."
                companion.learn_from_response(user_input, cc_response)
                
                print(f"\n🤖 CC: {cc_response}")
        
        except KeyboardInterrupt:
            print("\n\nGoodbye!")
            break
        except Exception as e:
            print(f"Error: {e}")

if __name__ == "__main__":
    main()