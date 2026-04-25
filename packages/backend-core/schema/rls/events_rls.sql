create policy "events_read" on public.events
  for select using (
    group_id is null or
    exists (
      select 1 from public.groups g
      where g.id = group_id and (
        g.privacy = 'public' or
        exists (select 1 from public.group_memberships where group_id = g.id and user_id = auth.uid())
      )
    )
  );

create policy "events_host_create" on public.events
  for insert with check (auth.uid() = created_by);

create policy "events_host_update" on public.events
  for update using (auth.uid() = created_by);

create policy "rsvps_read" on public.rsvps
  for select using (
    user_id = auth.uid() or
    exists (
      select 1 from public.events e
      join public.groups g on g.id = e.group_id
      where e.id = event_id and (
        g.privacy = 'public' or
        exists (select 1 from public.group_memberships where group_id = g.id and user_id = auth.uid())
      )
    )
  );

create policy "rsvps_self_manage" on public.rsvps
  for all using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
