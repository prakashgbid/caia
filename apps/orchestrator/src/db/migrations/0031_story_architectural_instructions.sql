-- Migration 0031: ARCH-006 — story-level architecturalInstructions[].
--
-- The EA Agent now runs AFTER BA enrichment (per the 2026-04-28 pipeline
-- reorder) and produces per-tech-sub-domain architectural instructions
-- grounded in the AKG (architecture-registry). Each instruction is
-- `reuse | enhance | create | no_op` and references arch_artifacts.id
-- rows where applicable.
--
-- Stored as JSON-stringified array (mirrors links_to_json shape from
-- migration 0029 + the rest of the JSON-encoded story columns) so the
-- ticket-template Zod schema is the source of truth and SQL stays simple.

ALTER TABLE `stories`
  ADD COLUMN `architectural_instructions_json` text NOT NULL DEFAULT '[]';
--> statement-breakpoint

-- Index on the EA-decomposed timestamp so the dashboard can list stories
-- in EA-runtime order.
ALTER TABLE `stories`
  ADD COLUMN `ea_decomposed_at` integer;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS `story_ea_decomposed_idx` ON `stories` (`ea_decomposed_at`);
