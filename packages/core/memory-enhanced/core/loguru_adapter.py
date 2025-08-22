"""
Loguru adapter for WebSocket functionality
"""

from loguru import logger
import asyncio
import json

class WebSocketLogHandler:
    """Handler to send logs to WebSocket clients"""
    
    def __init__(self, websocket_manager=None):
        self.websocket_manager = websocket_manager
        
    def write(self, message):
        """Send log message to WebSocket clients"""
        if self.websocket_manager:
            asyncio.create_task(
                self.websocket_manager.broadcast(orjson.dumps({
                    "type": "log",
                    "message": message.strip().decode()
                }))
            )

# Add WebSocket handler to Loguru if needed
def setup_websocket_logging(websocket_manager):
    """Setup WebSocket logging handler"""
    handler = WebSocketLogHandler(websocket_manager)
    logger.add(handler, format="{message}")
    return logger
