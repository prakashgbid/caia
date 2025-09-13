"""
Communication Hub - Handles inter-agent message passing and coordination
"""

import asyncio
import uuid
import json
from typing import Dict, Any, List, Optional, Callable
from dataclasses import dataclass, field, asdict
from datetime import datetime
from enum import Enum
from collections import defaultdict
import logging

logger = logging.getLogger(__name__)

class MessageType(Enum):
    TASK_ASSIGNMENT = "task_assignment"
    TASK_RESULT = "task_result"
    COORDINATION = "coordination"
    STATUS_UPDATE = "status_update"
    RESOURCE_REQUEST = "resource_request"
    BROADCAST = "broadcast"
    DIRECT = "direct"

class MessagePriority(Enum):
    LOW = 1
    NORMAL = 2
    HIGH = 3
    URGENT = 4

@dataclass
class Message:
    """Represents a message between agents"""
    message_id: str
    sender_id: str
    recipient_id: str
    message_type: MessageType
    content: str
    priority: MessagePriority = MessagePriority.NORMAL
    metadata: Dict[str, Any] = field(default_factory=dict)
    timestamp: datetime = field(default_factory=datetime.now)
    expires_at: Optional[datetime] = None
    requires_response: bool = False
    response_to: Optional[str] = None  # message_id this is responding to

@dataclass
class MessageHandler:
    """Message handler registration"""
    handler_id: str
    agent_id: str
    message_types: List[MessageType]
    callback: Callable
    active: bool = True

class CommunicationHub:
    """
    Central communication hub for inter-agent messaging
    Handles message routing, queuing, and delivery
    """
    
    def __init__(self, config: Dict[str, Any] = None):
        self.config = config or {}
        
        # Message storage and queues
        self.messages: Dict[str, Message] = {}
        self.agent_queues: Dict[str, asyncio.Queue] = defaultdict(asyncio.Queue)
        self.broadcast_queue: asyncio.Queue = asyncio.Queue()
        
        # Message handlers
        self.handlers: Dict[str, MessageHandler] = {}
        self.type_handlers: Dict[MessageType, List[str]] = defaultdict(list)
        
        # Routing and delivery
        self.routing_table: Dict[str, str] = {}  # agent_id -> queue_name
        self.delivery_confirmations: Dict[str, bool] = {}
        self.pending_responses: Dict[str, Message] = {}
        
        # Configuration
        self.max_queue_size = self.config.get('max_queue_size', 1000)
        self.message_ttl_hours = self.config.get('message_ttl_hours', 24)
        self.enable_persistence = self.config.get('enable_persistence', True)
        self.enable_encryption = self.config.get('enable_encryption', False)
        
        # Statistics
        self.stats = {
            'messages_sent': 0,
            'messages_delivered': 0,
            'messages_failed': 0,
            'broadcasts_sent': 0,
            'response_time_avg': 0.0,
            'queue_sizes': {}
        }
        
        # Background tasks
        self._running = False
        self._cleanup_task = None
        self._delivery_task = None
    
    async def start(self):
        """Start the communication hub"""
        if self._running:
            return
        
        self._running = True
        
        # Start background tasks
        self._cleanup_task = asyncio.create_task(self._cleanup_expired_messages())
        self._delivery_task = asyncio.create_task(self._process_message_delivery())
        
        logger.info("Communication hub started")
    
    async def stop(self):
        """Stop the communication hub"""
        self._running = False
        
        # Cancel background tasks
        if self._cleanup_task:
            self._cleanup_task.cancel()
        if self._delivery_task:
            self._delivery_task.cancel()
        
        logger.info("Communication hub stopped")
    
    async def send_message(self, message: Message) -> bool:
        """Send a message to an agent or broadcast"""
        try:
            # Validate message
            if not self._validate_message(message):
                logger.error(f"Invalid message: {message.message_id}")
                return False
            
            # Store message
            self.messages[message.message_id] = message
            
            # Route message
            if message.recipient_id == "broadcast":
                await self._broadcast_message(message)
            else:
                await self._route_message(message)
            
            # Update statistics
            self.stats['messages_sent'] += 1
            if message.recipient_id == "broadcast":
                self.stats['broadcasts_sent'] += 1
            
            logger.debug(f"Message sent: {message.message_id} from {message.sender_id} to {message.recipient_id}")
            return True
            
        except Exception as e:
            logger.error(f"Failed to send message {message.message_id}: {e}")
            self.stats['messages_failed'] += 1
            return False
    
    async def receive_message(self, agent_id: str, timeout: float = None) -> Optional[Message]:
        """Receive a message for an agent"""
        try:
            if agent_id not in self.agent_queues:
                return None
            
            if timeout:
                message = await asyncio.wait_for(
                    self.agent_queues[agent_id].get(),
                    timeout=timeout
                )
            else:
                message = await self.agent_queues[agent_id].get()
            
            # Mark as delivered
            self.delivery_confirmations[message.message_id] = True
            self.stats['messages_delivered'] += 1
            
            logger.debug(f"Message received by {agent_id}: {message.message_id}")
            return message
            
        except asyncio.TimeoutError:
            return None
        except Exception as e:
            logger.error(f"Failed to receive message for {agent_id}: {e}")
            return None
    
    async def send_response(self, original_message: Message, response_content: str, 
                           metadata: Dict[str, Any] = None) -> bool:
        """Send a response to a message"""
        response_message = Message(
            message_id=str(uuid.uuid4()),
            sender_id=original_message.recipient_id,
            recipient_id=original_message.sender_id,
            message_type=MessageType.DIRECT,
            content=response_content,
            metadata=metadata or {},
            response_to=original_message.message_id
        )
        
        return await self.send_message(response_message)
    
    def register_handler(self, agent_id: str, message_types: List[MessageType], 
                        callback: Callable) -> str:
        """Register a message handler for an agent"""
        handler_id = str(uuid.uuid4())
        
        handler = MessageHandler(
            handler_id=handler_id,
            agent_id=agent_id,
            message_types=message_types,
            callback=callback
        )
        
        self.handlers[handler_id] = handler
        
        # Update type handlers
        for msg_type in message_types:
            self.type_handlers[msg_type].append(handler_id)
        
        logger.info(f"Registered handler {handler_id} for agent {agent_id}")
        return handler_id
    
    def unregister_handler(self, handler_id: str) -> bool:
        """Unregister a message handler"""
        if handler_id not in self.handlers:
            return False
        
        handler = self.handlers[handler_id]
        
        # Remove from type handlers
        for msg_type in handler.message_types:
            if handler_id in self.type_handlers[msg_type]:
                self.type_handlers[msg_type].remove(handler_id)
        
        # Remove handler
        del self.handlers[handler_id]
        
        logger.info(f"Unregistered handler {handler_id}")
        return True
    
    async def broadcast_message(self, sender_id: str, message_type: MessageType, 
                               content: str, metadata: Dict[str, Any] = None) -> bool:
        """Broadcast a message to all agents"""
        broadcast_message = Message(
            message_id=str(uuid.uuid4()),
            sender_id=sender_id,
            recipient_id="broadcast",
            message_type=message_type,
            content=content,
            metadata=metadata or {}
        )
        
        return await self.send_message(broadcast_message)
    
    def get_queue_status(self, agent_id: str) -> Dict[str, Any]:
        """Get status of an agent's message queue"""
        if agent_id not in self.agent_queues:
            return {'queue_size': 0, 'exists': False}
        
        queue = self.agent_queues[agent_id]
        return {
            'queue_size': queue.qsize(),
            'exists': True,
            'full': queue.qsize() >= self.max_queue_size
        }
    
    def get_message_history(self, agent_id: str, limit: int = 100) -> List[Message]:
        """Get message history for an agent"""
        agent_messages = [
            msg for msg in self.messages.values()
            if msg.sender_id == agent_id or msg.recipient_id == agent_id
        ]
        
        # Sort by timestamp (newest first)
        agent_messages.sort(key=lambda m: m.timestamp, reverse=True)
        
        return agent_messages[:limit]
    
    def get_pending_responses(self, agent_id: str) -> List[Message]:
        """Get messages waiting for response from an agent"""
        pending = [
            msg for msg in self.messages.values()
            if msg.recipient_id == agent_id and msg.requires_response and 
               msg.message_id not in [r.response_to for r in self.messages.values() if r.response_to]
        ]
        
        return pending
    
    async def _validate_message(self, message: Message) -> bool:
        """Validate message before sending"""
        # Basic validation
        if not message.message_id or not message.sender_id:
            return False
        
        if not message.recipient_id or message.recipient_id == message.sender_id:
            return False
        
        if not message.content and message.message_type != MessageType.STATUS_UPDATE:
            return False
        
        # Check queue capacity
        if message.recipient_id != "broadcast":
            if message.recipient_id in self.agent_queues:
                if self.agent_queues[message.recipient_id].qsize() >= self.max_queue_size:
                    logger.warning(f"Queue full for agent {message.recipient_id}")
                    return False
        
        return True
    
    async def _route_message(self, message: Message):
        """Route message to appropriate queue"""
        recipient_id = message.recipient_id
        
        # Add to agent queue
        if recipient_id not in self.agent_queues:
            self.agent_queues[recipient_id] = asyncio.Queue(maxsize=self.max_queue_size)
        
        await self.agent_queues[recipient_id].put(message)
        
        # Trigger registered handlers
        await self._trigger_handlers(message)
    
    async def _broadcast_message(self, message: Message):
        """Broadcast message to all registered agents"""
        # Add to broadcast queue
        await self.broadcast_queue.put(message)
        
        # Add to all agent queues
        for agent_id in self.agent_queues.keys():
            if agent_id != message.sender_id:  # Don't send to sender
                try:
                    # Create copy for each recipient
                    broadcast_copy = Message(
                        message_id=f"{message.message_id}_{agent_id}",
                        sender_id=message.sender_id,
                        recipient_id=agent_id,
                        message_type=message.message_type,
                        content=message.content,
                        priority=message.priority,
                        metadata=message.metadata.copy(),
                        timestamp=message.timestamp
                    )
                    
                    await self.agent_queues[agent_id].put(broadcast_copy)
                    
                except asyncio.QueueFull:
                    logger.warning(f"Failed to broadcast to {agent_id}: queue full")
        
        # Trigger broadcast handlers
        await self._trigger_handlers(message)
    
    async def _trigger_handlers(self, message: Message):
        """Trigger registered message handlers"""
        handler_ids = self.type_handlers.get(message.message_type, [])
        
        for handler_id in handler_ids:
            if handler_id in self.handlers:
                handler = self.handlers[handler_id]
                
                if handler.active and (
                    handler.agent_id == message.recipient_id or 
                    message.recipient_id == "broadcast"
                ):
                    try:
                        # Call handler callback
                        if asyncio.iscoroutinefunction(handler.callback):
                            await handler.callback(message)
                        else:
                            handler.callback(message)
                            
                    except Exception as e:
                        logger.error(f"Handler {handler_id} failed: {e}")
    
    async def _cleanup_expired_messages(self):
        """Background task to clean up expired messages"""
        while self._running:
            try:
                now = datetime.now()
                expired_messages = []
                
                for message_id, message in self.messages.items():
                    # Check TTL
                    message_age = now - message.timestamp
                    if message_age.total_seconds() > (self.message_ttl_hours * 3600):
                        expired_messages.append(message_id)
                    
                    # Check explicit expiration
                    elif message.expires_at and now > message.expires_at:
                        expired_messages.append(message_id)
                
                # Remove expired messages
                for message_id in expired_messages:
                    del self.messages[message_id]
                    self.delivery_confirmations.pop(message_id, None)
                
                if expired_messages:
                    logger.info(f"Cleaned up {len(expired_messages)} expired messages")
                
                # Update queue size statistics
                self.stats['queue_sizes'] = {
                    agent_id: queue.qsize() 
                    for agent_id, queue in self.agent_queues.items()
                }
                
                # Sleep for cleanup interval
                await asyncio.sleep(self.config.get('cleanup_interval_seconds', 300))  # 5 minutes
                
            except Exception as e:
                logger.error(f"Message cleanup failed: {e}")
                await asyncio.sleep(60)  # Wait 1 minute on error
    
    async def _process_message_delivery(self):
        """Background task to process message delivery confirmations"""
        while self._running:
            try:
                # Process delivery confirmations
                undelivered_count = 0
                
                for message_id, message in list(self.messages.items()):
                    if message_id not in self.delivery_confirmations:
                        # Check if message should have been delivered by now
                        message_age = datetime.now() - message.timestamp
                        if message_age.total_seconds() > 300:  # 5 minutes
                            undelivered_count += 1
                
                if undelivered_count > 0:
                    logger.debug(f"{undelivered_count} messages undelivered")
                
                # Calculate average response time
                response_times = []
                for message_id, message in self.messages.items():
                    if message.response_to:
                        original_message = self.messages.get(message.response_to)
                        if original_message:
                            response_time = (message.timestamp - original_message.timestamp).total_seconds()
                            response_times.append(response_time)
                
                if response_times:
                    self.stats['response_time_avg'] = sum(response_times) / len(response_times)
                
                await asyncio.sleep(30)  # Check every 30 seconds
                
            except Exception as e:
                logger.error(f"Delivery processing failed: {e}")
                await asyncio.sleep(60)
    
    def get_communication_stats(self) -> Dict[str, Any]:
        """Get communication hub statistics"""
        return {
            **self.stats,
            'active_agents': len(self.agent_queues),
            'registered_handlers': len(self.handlers),
            'total_messages': len(self.messages),
            'pending_responses': len(self.pending_responses),
            'delivery_rate': (
                self.stats['messages_delivered'] / max(self.stats['messages_sent'], 1)
            ) if self.stats['messages_sent'] > 0 else 0.0
        }
    
    def create_agent_channel(self, agent_id: str) -> str:
        """Create a dedicated communication channel for an agent"""
        if agent_id not in self.agent_queues:
            self.agent_queues[agent_id] = asyncio.Queue(maxsize=self.max_queue_size)
            logger.info(f"Created communication channel for agent {agent_id}")
        
        return agent_id
    
    def remove_agent_channel(self, agent_id: str) -> bool:
        """Remove an agent's communication channel"""
        if agent_id in self.agent_queues:
            # Clear any remaining messages
            while not self.agent_queues[agent_id].empty():
                try:
                    self.agent_queues[agent_id].get_nowait()
                except asyncio.QueueEmpty:
                    break
            
            del self.agent_queues[agent_id]
            logger.info(f"Removed communication channel for agent {agent_id}")
            return True
        
        return False
    
    async def wait_for_response(self, message_id: str, timeout: float = 30.0) -> Optional[Message]:
        """Wait for a response to a specific message"""
        start_time = datetime.now()
        
        while (datetime.now() - start_time).total_seconds() < timeout:
            # Check for response
            for msg in self.messages.values():
                if msg.response_to == message_id:
                    return msg
            
            await asyncio.sleep(0.1)  # Check every 100ms
        
        return None  # Timeout
    
    async def shutdown(self):
        """Shutdown the communication hub"""
        await self.stop()
        
        # Clear all queues
        for queue in self.agent_queues.values():
            while not queue.empty():
                try:
                    queue.get_nowait()
                except asyncio.QueueEmpty:
                    break
        
        # Clear all data
        self.messages.clear()
        self.agent_queues.clear()
        self.handlers.clear()
        self.type_handlers.clear()
        self.delivery_confirmations.clear()
        self.pending_responses.clear()
        
        logger.info("Communication hub shutdown complete")