-- MindNode MVP — initial schema.
--
-- Single-user personal app. No auth columns yet; a follow-up migration
-- will add user_id and RLS when authentication is introduced.
--
-- Invariants enforced at the DB layer:
--   * memory_entries are the immutable source of truth. Linked rows
--     cannot be deleted while a node still references them
--     (node_memory_links.memory_entry_id is ON DELETE RESTRICT).
--   * Every accepted suggestion ends up creating at least one
--     node_memory_link row, preserving the trail from a node back to
--     the raw thought it came from. (Application-level invariant; not
--     expressed as a constraint to keep the migration simple.)

create extension if not exists "pgcrypto";

-- Raw thoughts as the user typed them. Append-only by convention.
create table memory_entries (
  id          uuid primary key default gen_random_uuid(),
  content     text not null,
  source      text not null default 'chat',
  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

-- Processed concepts on the canvas. Derived from memory_entries.
create table nodes (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  summary     text not null default '',
  category    text not null default 'general',
  position_x  double precision not null default 0,
  position_y  double precision not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Directed relationships between nodes.
create table edges (
  id                uuid primary key default gen_random_uuid(),
  source_node_id    uuid not null references nodes(id) on delete cascade,
  target_node_id    uuid not null references nodes(id) on delete cascade,
  relationship_type text not null default 'related',
  label             text,
  strength          double precision not null default 1,
  created_at        timestamptz not null default now(),
  constraint edges_no_self_loop check (source_node_id <> target_node_id)
);

-- AI proposals. Stored whether or not they're accepted, so we keep a
-- record of how the graph evolved. The full structured payload lives
-- in suggestion_json; status tracks the user's decision.
create table ai_suggestions (
  id              uuid primary key default gen_random_uuid(),
  memory_entry_id uuid not null references memory_entries(id) on delete cascade,
  suggestion_json jsonb not null,
  status          text not null default 'pending'
    constraint ai_suggestions_status_check
    check (status in ('pending', 'accepted', 'rejected')),
  created_at      timestamptz not null default now(),
  accepted_at     timestamptz
);

-- Many-to-many between nodes and the memory entries that informed them.
-- ON DELETE RESTRICT on memory_entry_id keeps raw entries safe.
create table node_memory_links (
  id              uuid primary key default gen_random_uuid(),
  node_id         uuid not null references nodes(id) on delete cascade,
  memory_entry_id uuid not null references memory_entries(id) on delete restrict,
  created_at      timestamptz not null default now(),
  constraint node_memory_links_unique unique (node_id, memory_entry_id)
);

-- Indexes per docs/DATA_MODEL.md.
create index memory_entries_created_at_idx
  on memory_entries (created_at desc);
create index nodes_category_idx
  on nodes (category);
create index edges_source_node_id_idx
  on edges (source_node_id);
create index edges_target_node_id_idx
  on edges (target_node_id);
create index ai_suggestions_memory_entry_id_idx
  on ai_suggestions (memory_entry_id);
create index node_memory_links_node_id_idx
  on node_memory_links (node_id);
create index node_memory_links_memory_entry_id_idx
  on node_memory_links (memory_entry_id);

-- Keep nodes.updated_at fresh on UPDATE.
create or replace function mindnode_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger nodes_set_updated_at
  before update on nodes
  for each row
  execute function mindnode_set_updated_at();
