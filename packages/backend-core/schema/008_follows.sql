create type public.relationship_kind as enum ('follow', 'mute', 'block');

create table public.user_relationships (
  id uuid primary key default uuid_generate_v4(),
  follower_id uuid references public.profiles(id) on delete cascade not null,
  following_id uuid references public.profiles(id) on delete cascade not null,
  kind public.relationship_kind not null default 'follow',
  created_at timestamptz not null default now(),
  unique (follower_id, following_id, kind),
  constraint no_self_relationship check (follower_id != following_id)
);

alter table public.user_relationships enable row level security;

create index user_relationships_follower_idx on public.user_relationships (follower_id, kind);
create index user_relationships_following_idx on public.user_relationships (following_id, kind);
