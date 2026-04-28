import { useState, useEffect, useCallback } from 'react';

export interface NetworkEntry {
  id: number;
  timestamp: string;
  method: string;
  url: string;
  status: number | 'error';
}

let networkCounter = 0;

export function useNetwork() {
  const [entries, setEntries] = useState<NetworkEntry[]>([]);

  useEffect(() => {
    const originalFetch = window.fetch.bind(window);
    const OriginalXHR = window.XMLHttpRequest;

    function addEntry(entry: Omit<NetworkEntry, 'id'>): void {
      setEntries(prev => [...prev, { id: ++networkCounter, ...entry }]);
    }

    // Patch fetch
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = (init?.method ?? 'GET').toUpperCase();
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const timestamp = new Date().toISOString();

      try {
        const response = await originalFetch(input, init);
        if (!response.ok) {
          addEntry({ timestamp, method, url, status: response.status });
        }
        return response;
      } catch (err) {
        addEntry({ timestamp, method, url, status: 'error' });
        throw err;
      }
    };

    // Patch XHR — cast through unknown to sidestep overload signature mismatch
    const PatchedXHR = class extends OriginalXHR {
      private _method = 'GET';
      private _url = '';

      open(method: string, url: string, async?: boolean, user?: string | null, password?: string | null): void {
        this._method = method.toUpperCase();
        this._url = url.toString();
        if (async !== undefined) {
          super.open(method, url, async, user ?? null, password ?? null);
        } else {
          super.open(method, url);
        }
      }

      send(body?: Document | XMLHttpRequestBodyInit | null): void {
        this.addEventListener('loadend', () => {
          if (this.status === 0 || this.status >= 400) {
            addEntry({
              timestamp: new Date().toISOString(),
              method: this._method,
              url: this._url,
              status: this.status === 0 ? 'error' : this.status,
            });
          }
        });
        super.send(body);
      }
    };
    window.XMLHttpRequest = PatchedXHR as unknown as typeof XMLHttpRequest;

    return () => {
      window.fetch = originalFetch;
      window.XMLHttpRequest = OriginalXHR;
    };
  }, []);

  const clear = useCallback(() => setEntries([]), []);

  return { entries, clear };
}
