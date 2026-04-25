-- profiles: anyone can read, only owner can write
create policy "profiles_public_read" on public.profiles
  for select using (true);

create policy "profiles_owner_insert" on public.profiles
  for insert with check (auth.uid() = id);

create policy "profiles_owner_update" on public.profiles
  for update using (auth.uid() = id);
