-- threads: readable if group is public or user is member
create policy "threads_read" on public.threads
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

create policy "threads_author_create" on public.threads
  for insert with check (auth.uid() = author_id);

create policy "threads_author_update" on public.threads
  for update using (auth.uid() = author_id);

create policy "threads_author_delete" on public.threads
  for delete using (auth.uid() = author_id);

-- replies
create policy "replies_read" on public.replies
  for select using (
    exists (
      select 1 from public.threads t
      where t.id = thread_id and (
        t.group_id is null or
        exists (
          select 1 from public.groups g
          where g.id = t.group_id and (
            g.privacy = 'public' or
            exists (select 1 from public.group_memberships where group_id = g.id and user_id = auth.uid())
          )
        )
      )
    )
  );

create policy "replies_author_create" on public.replies
  for insert with check (auth.uid() = author_id);

create policy "replies_author_update" on public.replies
  for update using (auth.uid() = author_id);

create policy "replies_author_delete" on public.replies
  for delete using (auth.uid() = author_id);

-- reactions: readable by all, writable by authenticated
create policy "reactions_read" on public.reactions
  for select using (true);

create policy "reactions_auth_create" on public.reactions
  for insert with check (auth.uid() = user_id);

create policy "reactions_owner_delete" on public.reactions
  for delete using (auth.uid() = user_id);
