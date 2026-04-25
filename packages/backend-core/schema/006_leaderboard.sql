create table public.points_ledger (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references public.profiles(id) on delete cascade not null,
  reason text not null,
  delta integer not null,
  metadata jsonb,
  created_at timestamptz not null default now()
);

alter table public.points_ledger enable row level security;

create index points_ledger_user_idx on public.points_ledger (user_id, created_at desc);
create index points_ledger_reason_idx on public.points_ledger (reason);

create table public.badges (
  id uuid primary key default uuid_generate_v4(),
  slug text unique not null,
  name text not null,
  description text,
  icon_url text,
  points_required integer,
  created_at timestamptz not null default now()
);

alter table public.badges enable row level security;

create table public.user_badges (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references public.profiles(id) on delete cascade not null,
  badge_id uuid references public.badges(id) on delete cascade not null,
  awarded_at timestamptz not null default now(),
  unique (user_id, badge_id)
);

alter table public.user_badges enable row level security;

create table public.tier_promotions (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references public.profiles(id) on delete cascade not null,
  from_tier text not null,
  to_tier text not null,
  points_at_promotion bigint not null,
  promoted_at timestamptz not null default now()
);

alter table public.tier_promotions enable row level security;

create or replace function public.sync_profile_points()
returns trigger language plpgsql
as $$
declare
  total_points bigint;
begin
  select coalesce(sum(delta), 0) into total_points
  from public.points_ledger
  where user_id = new.user_id;

  update public.profiles
  set lifetime_points = total_points
  where id = new.user_id;

  return new;
end;
$$;

create trigger sync_points_after_insert
  after insert on public.points_ledger
  for each row execute procedure public.sync_profile_points();
