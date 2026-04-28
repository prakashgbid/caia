import * as http from 'http';
import * as https from 'https';

export interface ProbeResult {
  url: string;
  status: number;
  ok: boolean;
  error?: string;
}

/** HTTP GET probe with a 15-second timeout. */
export function probe(targetUrl: string, timeoutMs = 15_000): Promise<ProbeResult> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (result: ProbeResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    let parsed: URL;
    try {
      parsed = new URL(targetUrl);
    } catch {
      settle({ url: targetUrl, status: 0, ok: false, error: 'Invalid URL' });
      return;
    }

    const client = parsed.protocol === 'https:' ? https : http;

    const req = client.request(
      { method: 'HEAD', hostname: parsed.hostname, port: parsed.port || undefined, path: parsed.pathname + parsed.search },
      (res) => {
        res.resume();
        const status = res.statusCode ?? 0;
        settle({ url: targetUrl, status, ok: status >= 200 && status < 400 });
      },
    );

    req.setTimeout(timeoutMs, () => {
      req.destroy();
      settle({ url: targetUrl, status: 0, ok: false, error: 'timeout' });
    });

    req.on('error', (err) => {
      settle({ url: targetUrl, status: 0, ok: false, error: err.message });
    });

    req.end();
  });
}

/** Probe a list of URLs concurrently with a concurrency cap. */
export async function probeAll(
  urls: string[],
  concurrency = 10,
  timeoutMs = 15_000,
): Promise<ProbeResult[]> {
  const results: ProbeResult[] = [];
  const queue = [...urls];

  async function worker() {
    while (queue.length > 0) {
      const url = queue.shift()!;
      results.push(await probe(url, timeoutMs));
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, urls.length) }, worker));
  return results;
}
