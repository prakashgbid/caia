/**
 * Next.js instrumentation hook — wires `@chiefaia/tracing` at boot.
 *
 * Runs ONCE per Node process before any request is handled (Next.js
 * 15 stable instrumentation). The `register` function is the only
 * supported export.
 *
 * Reuse-first: this is the canonical OTel surface for the CAIA spine
 * (see `@chiefaia/tracing` README and ADR-065). We do NOT init the
 * NodeSDK directly here — we delegate to `initTracing` so all spine
 * services share one wiring path. Mirrors apps/dashboard/instrumentation.ts.
 *
 * `OTEL_EXPORTER_OTLP_ENDPOINT` is read from the env (set in the
 * chiefaia-site ConfigMap to the in-cluster Tempo OTLP-HTTP receiver
 * at http://tempo.chiefaia.svc.cluster.local:4318). Service name is
 * hard-coded to `chiefaia-site` per the B16 spec — it's what shows
 * up in Tempo's `service.name` index.
 *
 * Edge runtime is a no-op: tracing only runs in the Node runtime
 * because the OTel NodeSDK has Node-only deps.
 */

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  // Dynamic import keeps the OTel SDK out of edge-runtime bundles
  // and out of the build-time graph when tracing is not wanted.
  // The literal string argument means Next.js's tracer still includes
  // @chiefaia/tracing (and its transitive OTel deps) in the standalone
  // output — verified by the Dockerfile's build-time check.
  const { initTracing } = await import('@chiefaia/tracing');
  await initTracing({
    serviceName: 'chiefaia-site',
    // serviceVersion + otlpEndpoint + samplingRatio fall through to
    // the defaults in initTracing (NODE_ENV, OTEL_EXPORTER_OTLP_ENDPOINT,
    // 1.0 sampling). The ConfigMap sets OTEL_EXPORTER_OTLP_ENDPOINT
    // to `http://tempo.chiefaia.svc.cluster.local:4318`.
  });
}
