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
export declare function healthCheck(url: string, mustContain: string, timeoutMs?: number): Promise<HealthCheckResult>;
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
export declare function pollHealthCheck(url: string, mustContain: string, maxAttempts?: number, initialDelayMs?: number): Promise<HealthCheckResult>;
//# sourceMappingURL=health-check.d.ts.map