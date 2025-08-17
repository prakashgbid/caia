/**
 * Simple Logger for CC Orchestrator
 */

export class Logger {
  private component: string;

  constructor(component: string) {
    this.component = component;
  }

  info(message: string, meta?: any): void {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [${this.component}] INFO: ${message}`, meta || '');
  }

  warn(message: string, meta?: any): void {
    const timestamp = new Date().toISOString();
    console.warn(`[${timestamp}] [${this.component}] WARN: ${message}`, meta || '');
  }

  error(message: string, error?: any): void {
    const timestamp = new Date().toISOString();
    if (error instanceof Error) {
      console.error(`[${timestamp}] [${this.component}] ERROR: ${message}`, error.message);
    } else {
      console.error(`[${timestamp}] [${this.component}] ERROR: ${message}`, error || '');
    }
  }

  debug(message: string, meta?: any): void {
    if (process.env.DEBUG || process.env.CCO_DEBUG) {
      const timestamp = new Date().toISOString();
      console.log(`[${timestamp}] [${this.component}] DEBUG: ${message}`, meta || '');
    }
  }
}