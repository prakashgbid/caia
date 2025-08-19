import { createLogger as createBaseLogger } from '@caia/util-logger';
import winston from 'winston';
import path from 'path';

export class Logger {
  private logger: winston.Logger;

  constructor(component: string) {
    this.logger = createBaseLogger(component);
    this.logger.add(
      new winston.transports.File({
        filename: path.join(process.cwd(), 'logs', 'ccu.log'),
        maxsize: 10485760, // 10MB
        maxFiles: 5
      })
    );
  }

  info(message: string, meta?: any): void {
    this.logger.info(message, meta);
  }

  warn(message: string, meta?: any): void {
    this.logger.warn(message, meta);
  }

  error(message: string, error?: any): void {
    if (error instanceof Error) {
      this.logger.error(message, { error: error.message, stack: error.stack });
    } else {
      this.logger.error(message, error);
    }
  }

  debug(message: string, meta?: any): void {
    this.logger.debug(message, meta);
  }
}