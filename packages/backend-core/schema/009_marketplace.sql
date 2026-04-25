-- Marketplace stub for future implementation
create type public.order_status as enum (
  'pending', 'confirmed', 'fulfilled', 'cancelled', 'refunded'
);

create table public.marketplace_listings (
  id uuid primary key default uuid_generate_v4(),
  seller_id uuid references public.profiles(id) on delete set null,
  title text not null,
  description text,
  price_cents integer not null default 0,
  currency text not null default 'usd',
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.marketplace_listings enable row level security;

create table public.marketplace_orders (
  id uuid primary key default uuid_generate_v4(),
  listing_id uuid references public.marketplace_listings(id) on delete set null,
  buyer_id uuid references public.profiles(id) on delete set null,
  status public.order_status not null default 'pending',
  price_cents integer not null,
  currency text not null default 'usd',
  metadata jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.marketplace_orders enable row level security;

create trigger marketplace_listings_updated_at before update on public.marketplace_listings for each row execute procedure public.update_updated_at();
create trigger marketplace_orders_updated_at before update on public.marketplace_orders for each row execute procedure public.update_updated_at();
