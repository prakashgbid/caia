-- 0046_stripe_integration — extend subscriptions table with Stripe billing fields.
-- Adds stripe_customer_id, stripe_subscription_id, and stripe_price_id so the
-- local subscription record stays in sync with Stripe via webhook events.
ALTER TABLE `subscriptions` ADD COLUMN `stripe_customer_id` text;
ALTER TABLE `subscriptions` ADD COLUMN `stripe_subscription_id` text;
ALTER TABLE `subscriptions` ADD COLUMN `stripe_price_id` text;

CREATE UNIQUE INDEX IF NOT EXISTS `subscriptions_stripe_customer_idx` ON `subscriptions` (`stripe_customer_id`);
CREATE UNIQUE INDEX IF NOT EXISTS `subscriptions_stripe_subscription_idx` ON `subscriptions` (`stripe_subscription_id`);
