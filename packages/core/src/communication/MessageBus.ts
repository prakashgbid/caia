import { EventEmitter } from 'eventemitter3';
import { v4 as uuidv4 } from 'uuid';
import {
  Message,
  MessageType,
  MessageBusConfig,
  CAIAError
} from '../types/index.js';
import { Logger } from 'winston';

export interface MessageFilter {
  type?: MessageType;
  from?: string;
  to?: string;
  correlationId?: string;
}

export interface MessageHandler {
  (message: Message): Promise<void> | void;
}

export interface MessageSubscription {
  id: string;
  filter: MessageFilter;
  handler: MessageHandler;
  subscriberId: string;
}

export class MessageBus extends EventEmitter {
  private subscriptions: Map<string, MessageSubscription> = new Map();
  private messageHistory: Message[] = [];
  private pendingMessages: Map<string, Message> = new Map();
  private messageTimeouts: Map<string, NodeJS.Timeout> = new Map();
  private readonly config: MessageBusConfig;
  private readonly logger: Logger;
  private isShuttingDown = false;

  constructor(config: MessageBusConfig, logger: Logger) {
    super();
    this.config = config;
    this.logger = logger.child({ component: 'MessageBus' });
    
    // Set max listeners to prevent memory leaks
    this.setMaxListeners(config.maxListeners);
    
    this.logger.info('MessageBus initialized', { config });
  }

  /**
   * Send a message through the bus
   */
  async send(message: Omit<Message, 'id' | 'timestamp'>): Promise<string> {
    if (this.isShuttingDown) {
      throw new CAIAError('MessageBus is shutting down', 'MESSAGE_BUS_SHUTDOWN');
    }

    const fullMessage: Message = {
      ...message,
      id: uuidv4(),
      timestamp: new Date()
    };

    try {
      this.logger.debug('Sending message', { 
        messageId: fullMessage.id, 
        type: fullMessage.type, 
        from: fullMessage.from, 
        to: fullMessage.to 
      });

      // Store message in history
      this.addToHistory(fullMessage);

      // Set timeout for message if configured
      if (this.config.messageTimeout > 0) {
        const timeoutHandle = setTimeout(() => {
          this.handleMessageTimeout(fullMessage.id);
        }, this.config.messageTimeout);
        this.messageTimeouts.set(fullMessage.id, timeoutHandle);
      }

      // Emit message event for tracing
      if (this.config.enableTracing) {
        this.emit('messageSent', fullMessage);
      }

      // Deliver message to subscribers
      await this.deliverMessage(fullMessage);

      return fullMessage.id;
    } catch (error) {
      this.logger.error('Failed to send message', { 
        messageId: fullMessage.id, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
      throw new CAIAError(
        `Failed to send message: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'MESSAGE_SEND_FAILED',
        { messageId: fullMessage.id, originalError: error }
      );
    }
  }

  /**
   * Send a request and wait for a response
   */
  async request<T = unknown>(
    message: Omit<Message, 'id' | 'timestamp' | 'correlationId'>,
    timeout: number = 5000
  ): Promise<T> {
    const correlationId = uuidv4();
    const requestMessage = {
      ...message,
      correlationId
    };

    return new Promise<T>((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        this.removeSubscription(subscriptionId);
        reject(new CAIAError(
          `Request timeout after ${timeout}ms`,
          'REQUEST_TIMEOUT',
          { correlationId, timeout }
        ));
      }, timeout);

      // Subscribe to response
      const subscriptionId = this.subscribe(
        { correlationId, type: MessageType.TASK_RESULT },
        message.to || 'system',
        async (responseMessage) => {
          clearTimeout(timeoutHandle);
          this.removeSubscription(subscriptionId);
          
          if (responseMessage.payload.error) {
            reject(new CAIAError(
              responseMessage.payload.error as string,
              'REQUEST_ERROR',
              { correlationId }
            ));
          } else {
            resolve(responseMessage.payload.result as T);
          }
        }
      );

      // Send the request
      this.send(requestMessage).catch(error => {
        clearTimeout(timeoutHandle);
        this.removeSubscription(subscriptionId);
        reject(error);
      });
    });
  }

  /**
   * Subscribe to messages matching a filter
   */
  subscribe(
    filter: MessageFilter,
    subscriberId: string,
    handler: MessageHandler
  ): string {
    const subscription: MessageSubscription = {
      id: uuidv4(),
      filter,
      handler,
      subscriberId
    };

    this.subscriptions.set(subscription.id, subscription);

    this.logger.debug('Message subscription created', { 
      subscriptionId: subscription.id, 
      subscriberId, 
      filter 
    });

    return subscription.id;
  }

  /**
   * Unsubscribe from messages
   */
  unsubscribe(subscriptionId: string): boolean {
    const removed = this.subscriptions.delete(subscriptionId);
    
    if (removed) {
      this.logger.debug('Message subscription removed', { subscriptionId });
    }
    
    return removed;
  }

  /**
   * Remove all subscriptions for a subscriber
   */
  unsubscribeAll(subscriberId: string): number {
    let removedCount = 0;
    
    for (const [id, subscription] of this.subscriptions.entries()) {
      if (subscription.subscriberId === subscriberId) {
        this.subscriptions.delete(id);
        removedCount++;
      }
    }
    
    this.logger.debug('Removed all subscriptions for subscriber', { 
      subscriberId, 
      removedCount 
    });
    
    return removedCount;
  }

  /**
   * Broadcast a message to all subscribers
   */
  async broadcast(message: Omit<Message, 'id' | 'timestamp' | 'to'>): Promise<string> {
    return this.send({
      ...message,
      to: undefined // Broadcast to all
    });
  }

  /**
   * Get message history
   */
  getMessageHistory(filter?: Partial<MessageFilter>, limit?: number): Message[] {
    let filtered = this.messageHistory;

    if (filter) {
      filtered = this.messageHistory.filter(message => {
        if (filter.type && message.type !== filter.type) return false;
        if (filter.from && message.from !== filter.from) return false;
        if (filter.to && message.to !== filter.to) return false;
        if (filter.correlationId && message.correlationId !== filter.correlationId) return false;
        return true;
      });
    }

    if (limit && limit > 0) {
      return filtered.slice(-limit);
    }

    return filtered;
  }

  /**
   * Get pending messages count
   */
  getPendingMessagesCount(): number {
    return this.pendingMessages.size;
  }

  /**
   * Get active subscriptions count
   */
  getSubscriptionsCount(): number {
    return this.subscriptions.size;
  }

  /**
   * Get statistics
   */
  getStats(): {
    totalMessages: number;
    pendingMessages: number;
    activeSubscriptions: number;
    subscriptionsByType: Record<string, number>;
  } {
    const subscriptionsByType: Record<string, number> = {};
    
    for (const subscription of this.subscriptions.values()) {
      const type = subscription.filter.type || 'any';
      subscriptionsByType[type] = (subscriptionsByType[type] || 0) + 1;
    }

    return {
      totalMessages: this.messageHistory.length,
      pendingMessages: this.pendingMessages.size,
      activeSubscriptions: this.subscriptions.size,
      subscriptionsByType
    };
  }

  /**
   * Clear message history
   */
  clearHistory(): void {
    this.messageHistory = [];
    this.logger.debug('Message history cleared');
  }

  /**
   * Shutdown the message bus
   */
  async shutdown(): Promise<void> {
    this.isShuttingDown = true;
    
    this.logger.info('Shutting down MessageBus');

    // Clear all timeouts
    for (const timeout of this.messageTimeouts.values()) {
      clearTimeout(timeout);
    }
    this.messageTimeouts.clear();

    // Clear all subscriptions
    this.subscriptions.clear();

    // Clear pending messages
    this.pendingMessages.clear();

    // Remove all listeners
    this.removeAllListeners();

    this.logger.info('MessageBus shutdown completed');
  }

  // Private methods

  private async deliverMessage(message: Message): Promise<void> {
    const matchingSubscriptions = this.findMatchingSubscriptions(message);
    
    if (matchingSubscriptions.length === 0) {
      this.logger.debug('No subscribers for message', { 
        messageId: message.id, 
        type: message.type, 
        to: message.to 
      });
      return;
    }

    const deliveryPromises = matchingSubscriptions.map(async (subscription) => {
      try {
        await subscription.handler(message);
        
        if (this.config.enableTracing) {
          this.emit('messageDelivered', { message, subscriptionId: subscription.id });
        }
      } catch (error) {
        this.logger.error('Message delivery failed', {
          messageId: message.id,
          subscriptionId: subscription.id,
          subscriberId: subscription.subscriberId,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
        
        this.emit('messageDeliveryFailed', {
          message,
          subscriptionId: subscription.id,
          error
        });
      }
    });

    await Promise.allSettled(deliveryPromises);
  }

  private findMatchingSubscriptions(message: Message): MessageSubscription[] {
    const matching: MessageSubscription[] = [];

    for (const subscription of this.subscriptions.values()) {
      if (this.messageMatchesFilter(message, subscription.filter)) {
        matching.push(subscription);
      }
    }

    return matching;
  }

  private messageMatchesFilter(message: Message, filter: MessageFilter): boolean {
    // Check message type
    if (filter.type && message.type !== filter.type) {
      return false;
    }

    // Check sender
    if (filter.from && message.from !== filter.from) {
      return false;
    }

    // Check recipient (undefined means broadcast, so it matches)
    if (filter.to && message.to && message.to !== filter.to) {
      return false;
    }

    // Check correlation ID
    if (filter.correlationId && message.correlationId !== filter.correlationId) {
      return false;
    }

    return true;
  }

  private addToHistory(message: Message): void {
    this.messageHistory.push(message);
    
    // Keep history size manageable (last 1000 messages)
    if (this.messageHistory.length > 1000) {
      this.messageHistory = this.messageHistory.slice(-1000);
    }
  }

  private handleMessageTimeout(messageId: string): void {
    this.pendingMessages.delete(messageId);
    this.messageTimeouts.delete(messageId);
    
    this.logger.warn('Message timeout', { messageId });
    this.emit('messageTimeout', { messageId });
  }

  private removeSubscription(subscriptionId: string): void {
    this.subscriptions.delete(subscriptionId);
  }
}