create policy "notification_prefs_owner" on public.notification_preferences
  for all using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "delivered_notifications_owner" on public.delivered_notifications
  for all using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
