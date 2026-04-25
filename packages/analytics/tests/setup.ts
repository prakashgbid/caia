import "@testing-library/jest-dom";
import { afterEach, vi } from "vitest";

// Reset GA4 singleton between tests
afterEach(async () => {
  const { _resetForTesting } = await import("../src/integrations/ga4");
  _resetForTesting();
});
