/**
 * Health check for a deployed site.
 * Polls an HTTP endpoint and verifies the response contains expected content.
 */

export interface HealthCheckResult {
  ok: boolean;
  statusCode?: number;
  responseTime?: number;
  error?: string;
}

/**
 * Perform a health check on a site.
 * Makes an HTTP GET request to the health endpoint and checks:
 * 1. HTTP status is 200
 * 2. Response body contains the expected string
 *
 * @param url - Full URL to check (e.g., http://localhost:5173/)
 * @param mustContain - String that must appear in the response body
 * @param timeoutMs - Timeout in milliseconds (default 10000)
 * @returns Health check result
 */
export async function healthCheck(
  url: string,
  mustContain: string,
  timeoutMs: number = 10000
): Promise<HealthCheckResult> {
  const startTime = Date.now();

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal
    });

    clearTimeout(timeoutId);
    const elapsed = Date.now() - startTime;

    if (response.status !== 200) {
      return {
        ok: false,
        statusCode: response.status,
        responseTime: elapsed,
        error: `HTTP ${response.status}`
      };
    }

    const body = await response.text();
    if (!body.includes(mustContain)) {
      return {
        ok: false,
        statusCode: response.status,
        responseTime: elapsed,
        error: `Response does not contain expected content: "${mustContain}"`
      };
    }

    return {
      ok: true,
      statusCode: 200,
      responseTime: elapsed
    };
  } catch (error) {
    const elapsed = Date.now() - startTime;
    const msg = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      responseTime: elapsed,
      error: `Health check failed: ${msg}`
    };
  }
}

/**
 * Poll for a healthy site with exponential backoff.
 * Retries up to maxAttempts times with increasing delays.
 *
 * @param url - Full URL to check
 * @param mustContain - String that must appear in response
 * @param maxAttempts - Max number of attempts (default 30)
 * @param initialDelayMs - Initial delay between attempts (default 333ms = 10s total for 30 attempts)
 * @returns Health check result from final attempt
 */
export async function pollHealthCheck(
  url: string,
  mustContain: string,
  maxAttempts: number = 30,
  initialDelayMs: number = 333
): Promise<HealthCheckResult> {
  let lastResult: HealthCheckResult = {
    ok: false,
    error: 'Not attempted'
  };

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    lastResult = await healthCheck(url, mustContain, 5000);

    if (lastResult.ok) {
      return lastResult;
    }

    if (attempt < maxAttempts) {
      // Exponential backoff: delay increases with each attempt
      const delay = initialDelayMs * Math.pow(1.1, attempt - 1);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  return lastResult;
}
