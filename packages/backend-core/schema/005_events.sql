create type public.event_kind as enum (
  'online_tournament', 'local_meetup', 'venue_event', 'webinar', 'workshop'
);

create type public.rsvp_status as enum ('yes', 'no', 'maybe');

create table public.events (
  id uuid primary key default uuid_generate_v4(),
  group_id uuid references public.groups(id) on delete cascade,
  created_by uuid references public.profiles(id) on delete set null,
  kind public.event_kind not null,
  title text not null,
  description text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  location_text text,
  location_lat double precision,
  location_lng double precision,
  capacity integer,
  rsvp_count integer not null default 0,
  is_cancelled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint valid_date_range check (ends_at > starts_at)
);

alter table public.events enable row level security;

create index events_group_idx on public.events (group_id, starts_at asc);
create index events_starts_at_idx on public.events (starts_at asc);

create table public.rsvps (
  id uuid primary key default uuid_generate_v4(),
  event_id uuid references public.events(id) on delete cascade not null,
  user_id uuid references public.profiles(id) on delete cascade not null,
  status public.rsvp_status not null default 'yes',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, user_id)
);

alter table public.rsvps enable row level security;

create index rsvps_event_idx on public.rsvps (event_id, status);
create index rsvps_user_idx on public.rsvps (user_id);

create or replace function public.update_rsvp_count()
returns trigger language plpgsql
as $$
begin
  if tg_op = 'INSERT' and new.status = 'yes' then
    update public.events set rsvp_count = rsvp_count + 1 where id = new.event_id;
  elsif tg_op = 'DELETE' and old.status = 'yes' then
    update public.events set rsvp_count = greatest(0, rsvp_count - 1) where id = old.event_id;
  elsif tg_op = 'UPDATE' then
    if new.status = 'yes' and old.status != 'yes' then
      update public.events set rsvp_count = rsvp_count + 1 where id = new.event_id;
    elsif new.status != 'yes' and old.status = 'yes' then
      update public.events set rsvp_count = greatest(0, rsvp_count - 1) where id = old.event_id;
    end if;
  end if;
  return null;
end;
$$;

create trigger rsvp_count_trigger
  after insert or update or delete on public.rsvps
  for each row execute procedure public.update_rsvp_count();

create trigger events_updated_at before update on public.events for each row execute procedure public.update_updated_at();
create trigger rsvps_updated_at before update on public.rsvps for each row execute procedure public.update_updated_at();
