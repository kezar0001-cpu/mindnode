-- MindNode — add per-user ownership and Row Level Security.
--
-- Pre-condition: the five core tables (memory_entries, nodes, edges,
-- ai_suggestions, node_memory_links) created by
-- 20260528000000_initial_schema.sql exist and are empty. If they
-- contain rows, this migration's NOT NULL adds will fail; backfill
-- user_id first or wipe the tables before applying.
--
-- After this migration:
--   * Every row in the five core tables belongs to exactly one
--     auth.users row.
--   * Deleting a user cascades and removes their data.
--   * RLS is enabled with per-user select/insert/update/delete
--     policies on all five tables. The anon role cannot read or
--     write anything; the service_role bypasses RLS as usual and
--     is reserved for server-side admin tasks.

-- 1. Add user_id columns + FK to auth.users.
alter table memory_entries
  add column user_id uuid not null
  references auth.users(id) on delete cascade;

alter table nodes
  add column user_id uuid not null
  references auth.users(id) on delete cascade;

alter table edges
  add column user_id uuid not null
  references auth.users(id) on delete cascade;

alter table ai_suggestions
  add column user_id uuid not null
  references auth.users(id) on delete cascade;

alter table node_memory_links
  add column user_id uuid not null
  references auth.users(id) on delete cascade;

-- 2. Indexes for filtering by owner.
create index memory_entries_user_id_idx on memory_entries (user_id);
create index nodes_user_id_idx on nodes (user_id);
create index edges_user_id_idx on edges (user_id);
create index ai_suggestions_user_id_idx on ai_suggestions (user_id);
create index node_memory_links_user_id_idx on node_memory_links (user_id);

-- 3. Enable RLS on all five core tables.
alter table memory_entries enable row level security;
alter table nodes enable row level security;
alter table edges enable row level security;
alter table ai_suggestions enable row level security;
alter table node_memory_links enable row level security;

-- 4. Per-table CRUD policies, keyed on auth.uid() = user_id.
-- memory_entries
create policy memory_entries_select_own
  on memory_entries for select
  using (auth.uid() = user_id);
create policy memory_entries_insert_own
  on memory_entries for insert
  with check (auth.uid() = user_id);
create policy memory_entries_update_own
  on memory_entries for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
create policy memory_entries_delete_own
  on memory_entries for delete
  using (auth.uid() = user_id);

-- nodes
create policy nodes_select_own
  on nodes for select
  using (auth.uid() = user_id);
create policy nodes_insert_own
  on nodes for insert
  with check (auth.uid() = user_id);
create policy nodes_update_own
  on nodes for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
create policy nodes_delete_own
  on nodes for delete
  using (auth.uid() = user_id);

-- edges
create policy edges_select_own
  on edges for select
  using (auth.uid() = user_id);
create policy edges_insert_own
  on edges for insert
  with check (auth.uid() = user_id);
create policy edges_update_own
  on edges for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
create policy edges_delete_own
  on edges for delete
  using (auth.uid() = user_id);

-- ai_suggestions
create policy ai_suggestions_select_own
  on ai_suggestions for select
  using (auth.uid() = user_id);
create policy ai_suggestions_insert_own
  on ai_suggestions for insert
  with check (auth.uid() = user_id);
create policy ai_suggestions_update_own
  on ai_suggestions for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
create policy ai_suggestions_delete_own
  on ai_suggestions for delete
  using (auth.uid() = user_id);

-- node_memory_links
create policy node_memory_links_select_own
  on node_memory_links for select
  using (auth.uid() = user_id);
create policy node_memory_links_insert_own
  on node_memory_links for insert
  with check (auth.uid() = user_id);
create policy node_memory_links_update_own
  on node_memory_links for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
create policy node_memory_links_delete_own
  on node_memory_links for delete
  using (auth.uid() = user_id);
