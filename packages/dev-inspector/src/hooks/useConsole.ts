import { useState, useEffect, useCallback } from 'react';

export interface ConsoleEntry {
  id: number;
  timestamp: string;
  level: 'error' | 'warn';
  message: string;
}

let entryCounter = 0;

export function useConsole() {
  const [entries, setEntries] = useState<ConsoleEntry[]>([]);

  useEffect(() => {
    const originalError = console.error.bind(console);
    const originalWarn = console.warn.bind(console);

    function capture(level: 'error' | 'warn', args: unknown[]): void {
      const message = args
        .map(a => (typeof a === 'string' ? a : JSON.stringify(a)))
        .join(' ');
      const entry: ConsoleEntry = {
        id: ++entryCounter,
        timestamp: new Date().toISOString(),
        level,
        message,
      };
      setEntries(prev => [...prev, entry]);
    }

    console.error = (...args: unknown[]) => {
      capture('error', args);
      originalError(...args);
    };

    console.warn = (...args: unknown[]) => {
      capture('warn', args);
      originalWarn(...args);
    };

    return () => {
      console.error = originalError;
      console.warn = originalWarn;
    };
  }, []);

  const clear = useCallback(() => setEntries([]), []);

  return { entries, clear };
}
