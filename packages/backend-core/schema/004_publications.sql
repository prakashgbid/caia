create type public.publication_status as enum (
  'draft', 'submitted', 'under_review', 'published', 'rejected'
);

create type public.peer_review_state as enum (
  'pending', 'in_review', 'approved', 'needs_revision', 'rejected'
);

create table public.articles (
  id uuid primary key default uuid_generate_v4(),
  author_id uuid references public.profiles(id) on delete set null,
  title text not null,
  slug text unique not null,
  body_md text not null,
  excerpt text,
  hero_image_url text,
  tags text[] not null default '{}',
  status public.publication_status not null default 'draft',
  published_at timestamptz,
  view_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.articles enable row level security;

create index articles_author_idx on public.articles (author_id);
create index articles_status_idx on public.articles (status, published_at desc);
create index articles_tags_idx on public.articles using gin (tags);

create table public.research_papers (
  id uuid primary key default uuid_generate_v4(),
  author_id uuid references public.profiles(id) on delete set null,
  title text not null,
  slug text unique not null,
  body_md text not null,
  excerpt text,
  hero_image_url text,
  tags text[] not null default '{}',
  status public.publication_status not null default 'draft',
  peer_review_state public.peer_review_state not null default 'pending',
  reviewers uuid[] not null default '{}',
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.research_papers enable row level security;

create index research_papers_author_idx on public.research_papers (author_id);
create index research_papers_status_idx on public.research_papers (status, published_at desc);

create table public.editorial_reviews (
  id uuid primary key default uuid_generate_v4(),
  reviewer_id uuid references public.profiles(id) on delete set null,
  paper_id uuid references public.research_papers(id) on delete cascade,
  article_id uuid references public.articles(id) on delete cascade,
  verdict public.peer_review_state not null,
  feedback_md text,
  created_at timestamptz not null default now(),
  constraint review_target_check check (
    (paper_id is not null) != (article_id is not null)
  )
);

alter table public.editorial_reviews enable row level security;

create trigger articles_updated_at before update on public.articles for each row execute procedure public.update_updated_at();
create trigger research_papers_updated_at before update on public.research_papers for each row execute procedure public.update_updated_at();
