create policy "points_ledger_owner_read" on public.points_ledger
  for select using (auth.uid() = user_id);

create policy "badges_public_read" on public.badges
  for select using (true);

create policy "user_badges_read" on public.user_badges
  for select using (true);

create policy "tier_promotions_owner_read" on public.tier_promotions
  for select using (auth.uid() = user_id);
