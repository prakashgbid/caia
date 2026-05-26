/**
 * @caia/ui — canonical shadcn/Tailwind primitives for CAIA apps.
 *
 * Operator-locked 2026-05-25 (PR C, ADR-065). Every UI primitive in @caia/*
 * apps must come from here, not from raw shadcn/Radix/Tailwind imports.
 * Semgrep rule `caia-no-raw-shadcn-import-outside-ui-package` enforces this.
 */

// Utilities
export { cn } from "./lib/utils.js";

// Primitives — stable public API. Underlying implementation may swap from
// pure-Tailwind to Radix-backed later without breaking consumers.
export * from "./components/ui/button.js";
export * from "./components/ui/card.js";
export * from "./components/ui/input.js";
export * from "./components/ui/badge.js";
export * from "./components/ui/progress.js";
export * from "./components/ui/accordion.js";
export * from "./components/ui/dialog.js";
export * from "./components/ui/sheet.js";
export * from "./components/ui/scroll-area.js";
export * from "./components/ui/tabs.js";
export * from "./components/ui/form.js";
