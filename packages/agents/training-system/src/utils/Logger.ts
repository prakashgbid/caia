/**
 * Logger - Structured logging for SATS
 */

export class Logger {
  private context: string;
  private logLevel: string;

  constructor(context: string) {
    this.context = context;
    this.logLevel = process.env.LOG_LEVEL || 'info';
  }

  info(message: string, meta?: any): void {
    if (this.shouldLog('info')) {
      this.log('INFO', message, meta);
    }
  }

  warn(message: string, meta?: any): void {
    if (this.shouldLog('warn')) {
      this.log('WARN', message, meta);
    }
  }

  error(message: string, error?: any): void {
    if (this.shouldLog('error')) {
      this.log('ERROR', message, error);
    }
  }

  debug(message: string, meta?: any): void {
    if (this.shouldLog('debug')) {
      this.log('DEBUG', message, meta);
    }
  }

  private shouldLog(level: string): boolean {
    const levels = { error: 0, warn: 1, info: 2, debug: 3 };
    return levels[level] <= levels[this.logLevel];
  }

  private log(level: string, message: string, meta?: any): void {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      level,
      context: this.context,
      message,
      ...(meta && { meta })
    };

    console.log(JSON.stringify(logEntry, null, 2));
  }
}