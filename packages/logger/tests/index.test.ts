import { describe, it, expect, vi } from 'vitest';
import { createLogger } from '../src/index.js';

describe('createLogger', () => {
  it('creates a logger with the given name', () => {
    const logger = createLogger({ name: 'test' });
    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe('function');
  });

  it('emits info lines to stdout', () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const logger = createLogger({ name: 'test', level: 'info' });
    logger.info('hello', { key: 'val' });
    expect(write).toHaveBeenCalledOnce();
    const line = JSON.parse(write.mock.calls[0]![0] as string);
    expect(line).toMatchObject({ level: 'info', name: 'test', msg: 'hello', key: 'val' });
    write.mockRestore();
  });

  it('suppresses levels below min', () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const logger = createLogger({ name: 'test', level: 'warn' });
    logger.debug('should not appear');
    expect(write).not.toHaveBeenCalled();
    write.mockRestore();
  });

  it('child logger merges bindings', () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const logger = createLogger({ name: 'test' });
    const child = logger.child({ reqId: '123' });
    child.info('child msg');
    const line = JSON.parse(write.mock.calls[0]![0] as string);
    expect(line.reqId).toBe('123');
    write.mockRestore();
  });

  it('trace level emits when level is trace', () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const logger = createLogger({ name: 'test', level: 'trace' });
    logger.trace('trace msg');
    expect(write).toHaveBeenCalled();
    const line = JSON.parse(write.mock.calls[0]![0] as string);
    expect(line.level).toBe('trace');
    write.mockRestore();
  });

  it('debug level emits when level is debug', () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const logger = createLogger({ name: 'test', level: 'debug' });
    logger.debug('debug msg');
    expect(write).toHaveBeenCalled();
    write.mockRestore();
  });

  it('warn level emits to stdout', () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const logger = createLogger({ name: 'test', level: 'warn' });
    logger.warn('warn msg');
    expect(write).toHaveBeenCalled();
    const line = JSON.parse(write.mock.calls[0]![0] as string);
    expect(line.level).toBe('warn');
    write.mockRestore();
  });

  it('error level emits to stdout (Pino always uses stdout by default)', () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const logger = createLogger({ name: 'test', level: 'error' });
    logger.error('error msg');
    expect(write).toHaveBeenCalled();
    const line = JSON.parse(write.mock.calls[0]![0] as string);
    expect(line.level).toBe('error');
    write.mockRestore();
  });

  it('fatal level emits to stdout with context', () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const logger = createLogger({ name: 'test', level: 'fatal' });
    logger.fatal('fatal msg', { critical: true });
    expect(write).toHaveBeenCalled();
    const line = JSON.parse(write.mock.calls[0]![0] as string);
    expect(line.level).toBe('fatal');
    expect(line.critical).toBe(true);
    write.mockRestore();
  });

  it('emits message without context', () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const logger = createLogger({ name: 'test' });
    logger.info('no context');
    expect(write).toHaveBeenCalled();
    const line = JSON.parse(write.mock.calls[0]![0] as string);
    expect(line.msg).toBe('no context');
    write.mockRestore();
  });

  it('nested child loggers work', () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const logger = createLogger({ name: 'test' });
    const child = logger.child({ service: 'auth' });
    const grandchild = child.child({ userId: 'u1' });
    grandchild.info('nested');
    const line = JSON.parse(write.mock.calls[0]![0] as string);
    expect(line.service).toBe('auth');
    expect(line.userId).toBe('u1');
    write.mockRestore();
  });
});
