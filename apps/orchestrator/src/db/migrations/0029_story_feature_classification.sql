-- Migration 0029: FREG-006 — story feature_registry classification metadata.
--
-- The PO Agent now queries @chiefaia/feature-registry before persisting
-- a story's lifecycle. When the top match clears the enhance threshold,
-- PO sets lifecycle='enhance' and writes the matched feature_registry.id
-- to links_to_json. The cosine similarity score is also stored so the
-- dashboard / VAL-### track / human reviewers can see the basis for the
-- classification.
--
-- Companion taxonomy:
--   feature_classification:
--     null     — PO did not query the registry (registry/embedder unavailable
--                or feature flag off).
--     enhance  — top match cosine >= ENHANCE threshold; lifecycle override applied.
--     ambiguous — top match in 0.78-0.85 range; lifecycle still set to 'enhance'
--                 but flag for BA / Validator review.
--     new      — no match cleared the ambiguous threshold; lifecycle kept as
--                whatever classifyLifecycle returned.

ALTER TABLE `stories` ADD COLUMN `links_to_json` text NOT NULL DEFAULT '[]';
--> statement-breakpoint
ALTER TABLE `stories` ADD COLUMN `feature_classification` text;
--> statement-breakpoint
ALTER TABLE `stories` ADD COLUMN `feature_classification_score` real;
--> statement-breakpoint
ALTER TABLE `stories` ADD COLUMN `feature_classification_at` integer;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS `story_feature_classification_idx` ON `stories` (`feature_classification`);
