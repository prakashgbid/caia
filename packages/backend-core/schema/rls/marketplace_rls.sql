create policy "listings_public_read" on public.marketplace_listings
  for select using (is_active = true or auth.uid() = seller_id);

create policy "listings_seller_manage" on public.marketplace_listings
  for all using (auth.uid() = seller_id)
  with check (auth.uid() = seller_id);

create policy "orders_participant_read" on public.marketplace_orders
  for select using (auth.uid() = buyer_id);

create policy "orders_buyer_create" on public.marketplace_orders
  for insert with check (auth.uid() = buyer_id);
