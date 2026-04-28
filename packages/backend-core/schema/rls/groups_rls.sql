-- groups: public groups readable by all; private only by members
create policy "groups_public_read" on public.groups
  for select using (
    privacy = 'public' or
    exists (
      select 1 from public.group_memberships
      where group_id = id and user_id = auth.uid()
    )
  );

create policy "groups_auth_create" on public.groups
  for insert with check (auth.uid() = created_by and auth.uid() is not null);

create policy "groups_host_update" on public.groups
  for update using (
    exists (
      select 1 from public.group_memberships
      where group_id = id and user_id = auth.uid() and role in ('host', 'moderator')
    )
  );

-- memberships: members can see their group's membership list
create policy "memberships_group_read" on public.group_memberships
  for select using (
    user_id = auth.uid() or
    exists (
      select 1 from public.groups g
      where g.id = group_id and g.privacy = 'public'
    )
  );

create policy "memberships_self_join" on public.group_memberships
  for insert with check (auth.uid() = user_id);

create policy "memberships_self_leave" on public.group_memberships
  for delete using (auth.uid() = user_id);
