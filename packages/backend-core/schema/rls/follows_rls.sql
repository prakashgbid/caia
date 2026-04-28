create policy "relationships_public_follows_read" on public.user_relationships
  for select using (
    kind = 'follow' or
    follower_id = auth.uid() or
    following_id = auth.uid()
  );

create policy "relationships_self_manage" on public.user_relationships
  for all using (auth.uid() = follower_id)
  with check (auth.uid() = follower_id);
