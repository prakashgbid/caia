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
});
