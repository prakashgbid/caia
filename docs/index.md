---
layout: home

hero:
  name: "CAIA"
  text: "Chief AI Agent"
  tagline: Foundational utilities, CLI, and templates for AI-driven application development.
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: View on GitHub
      link: https://github.com/prakashgbid/caia

features:
  - icon: 🪵
    title: Structured Logging
    details: Pino-backed logger with child contexts and zero-config JSON output.
  - icon: 📡
    title: Typed Event Bus
    details: In-process event bus with full TypeScript generics — subscribe, emit, once.
  - icon: 📊
    title: Metrics
    details: Prometheus-compatible counters, gauges, and histograms — expose at /metrics in one line.
  - icon: 🔍
    title: Tracing
    details: OpenTelemetry-compatible spans with withSpan helper — wrap any async operation.
  - icon: 🚨
    title: Typed Errors
    details: CaiaError hierarchy with codes, status codes, and serialise() — wire straight into HTTP handlers.
  - icon: ⚙️
    title: Config
    details: Schema-validated runtime config from env — throws ConfigurationError at startup, not at 2am.
  - icon: 🔐
    title: Secrets
    details: Adapter-based secret client — MemoryAdapter for tests, vault adapter for production.
  - icon: 🧪
    title: Test Kit
    details: createSpyLogger, createTestEventBus, waitFor — all the pieces you need to test CAIA apps.
---
