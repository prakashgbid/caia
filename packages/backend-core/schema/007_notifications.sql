create type public.notification_channel as enum ('in_app', 'email', 'push');

create table public.notification_preferences (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references public.profiles(id) on delete cascade not null unique,
  channels public.notification_channel[] not null default array['in_app']::public.notification_channel[],
  new_reply boolean not null default true,
  new_follower boolean not null default true,
  group_activity boolean not null default true,
  event_reminder boolean not null default true,
  mention boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table public.notification_preferences enable row level security;

create table public.delivered_notifications (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references public.profiles(id) on delete cascade not null,
  kind text not null,
  title text not null,
  body text,
  action_url text,
  metadata jsonb,
  is_read boolean not null default false,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.delivered_notifications enable row level security;

create index delivered_notifications_user_idx on public.delivered_notifications (user_id, created_at desc);
create index delivered_notifications_unread_idx on public.delivered_notifications (user_id) where is_read = false;

create trigger notification_preferences_updated_at
  before update on public.notification_preferences
  for each row execute procedure public.update_updated_at();
