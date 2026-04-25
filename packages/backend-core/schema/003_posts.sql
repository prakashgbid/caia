create table public.threads (
  id uuid primary key default uuid_generate_v4(),
  group_id uuid references public.groups(id) on delete cascade,
  author_id uuid references public.profiles(id) on delete set null,
  title text not null,
  body_md text not null,
  tags text[] not null default '{}',
  reaction_counts jsonb not null default '{}',
  reply_count integer not null default 0,
  is_pinned boolean not null default false,
  is_locked boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.threads enable row level security;

create index threads_group_idx on public.threads (group_id, created_at desc);
create index threads_author_idx on public.threads (author_id);
create index threads_tags_idx on public.threads using gin (tags);

create table public.replies (
  id uuid primary key default uuid_generate_v4(),
  thread_id uuid references public.threads(id) on delete cascade not null,
  parent_reply_id uuid references public.replies(id) on delete set null,
  author_id uuid references public.profiles(id) on delete set null,
  body_md text not null,
  reactions jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.replies enable row level security;

create index replies_thread_idx on public.replies (thread_id, created_at asc);
create index replies_parent_idx on public.replies (parent_reply_id);

create table public.reactions (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references public.profiles(id) on delete cascade not null,
  target_type text not null check (target_type in ('thread', 'reply', 'article')),
  target_id uuid not null,
  emoji text not null,
  created_at timestamptz not null default now(),
  unique (user_id, target_type, target_id, emoji)
);

alter table public.reactions enable row level security;

create index reactions_target_idx on public.reactions (target_type, target_id);

create or replace function public.update_reply_count()
returns trigger language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    update public.threads set reply_count = reply_count + 1 where id = new.thread_id;
  elsif tg_op = 'DELETE' then
    update public.threads set reply_count = greatest(0, reply_count - 1) where id = old.thread_id;
  end if;
  return null;
end;
$$;

create trigger thread_reply_count
  after insert or delete on public.replies
  for each row execute procedure public.update_reply_count();

create trigger threads_updated_at before update on public.threads for each row execute procedure public.update_updated_at();
create trigger replies_updated_at before update on public.replies for each row execute procedure public.update_updated_at();
