create type public.group_tier as enum (
  'family', 'neighborhood', 'city', 'county', 'township', 'state', 'regional'
);

create type public.group_privacy as enum ('public', 'private', 'invite');
create type public.member_role as enum ('member', 'moderator', 'host');

create table public.groups (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  slug text unique not null,
  tier_level public.group_tier not null,
  parent_group_id uuid references public.groups(id) on delete set null,
  description text,
  cover_image_url text,
  created_by uuid references public.profiles(id) on delete set null,
  member_count integer not null default 0,
  privacy public.group_privacy not null default 'public',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.groups enable row level security;

create unique index groups_slug_idx on public.groups (lower(slug));

create table public.group_memberships (
  id uuid primary key default uuid_generate_v4(),
  group_id uuid references public.groups(id) on delete cascade not null,
  user_id uuid references public.profiles(id) on delete cascade not null,
  role public.member_role not null default 'member',
  joined_at timestamptz not null default now(),
  unique (group_id, user_id)
);

alter table public.group_memberships enable row level security;

create index group_memberships_group_idx on public.group_memberships (group_id);
create index group_memberships_user_idx on public.group_memberships (user_id);

create or replace function public.update_group_member_count()
returns trigger language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    update public.groups set member_count = member_count + 1 where id = new.group_id;
  elsif tg_op = 'DELETE' then
    update public.groups set member_count = greatest(0, member_count - 1) where id = old.group_id;
  end if;
  return null;
end;
$$;

create trigger group_membership_count
  after insert or delete on public.group_memberships
  for each row execute procedure public.update_group_member_count();

create trigger groups_updated_at
  before update on public.groups
  for each row execute procedure public.update_updated_at();
