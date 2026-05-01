-- 0043_subscriptions — lightweight subscription inbox for the orchestrator.
-- Stores email subscriptions with plan, status, and soft-delete (cancelled_at).
CREATE TABLE IF NOT EXISTS `subscriptions` (
  `id` text PRIMARY KEY,
  `email` text NOT NULL,
  `plan` text NOT NULL DEFAULT 'free',
  `status` text NOT NULL DEFAULT 'active',
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  `cancelled_at` text
);

CREATE INDEX IF NOT EXISTS `subscriptions_email_idx` ON `subscriptions` (`email`);
CREATE INDEX IF NOT EXISTS `subscriptions_status_idx` ON `subscriptions` (`status`);
