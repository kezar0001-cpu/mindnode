-- MindNode — add origin tracking for nodes and edges, and AI reason on nodes.
--
-- Purpose: surface where each node and edge came from (manual capture,
-- promoted raw memory, AI exploration pin, future import) so the UI can
-- explain provenance and the insight layer can reason about graph growth.
--
-- Backfill rules:
--   * nodes.origin = 'memory' for any node already linked to a memory
--     entry via node_memory_links; otherwise 'manual'.
--   * nodes.ai_reason starts null for all existing rows.
--   * edges.origin = 'manual' for all existing rows (we cannot
--     retroactively distinguish keyword-auto from manual edges).
--
-- All additions are NULL-safe with DEFAULTs so deployed code continues
-- to work before the application is updated to set these fields.

-- 1. nodes.origin
alter table nodes
  add column origin text not null default 'manual'
  constraint nodes_origin_check
  check (origin in ('manual', 'memory', 'ai_pinned', 'imported'));

-- 2. nodes.ai_reason (nullable — only set when origin = 'ai_pinned')
alter table nodes
  add column ai_reason text;

-- 3. edges.origin
alter table edges
  add column origin text not null default 'manual'
  constraint edges_origin_check
  check (origin in ('manual', 'auto_keyword', 'ai_pinned', 'ai_suggested'));

-- 4. Backfill nodes.origin = 'memory' where a memory link exists.
update nodes
  set origin = 'memory'
  where id in (select node_id from node_memory_links);

-- 5. Indexes for filtering by origin (cheap; expected cardinality is
--    small, but helps the insight layer.)
create index nodes_origin_idx on nodes (origin);
create index edges_origin_idx on edges (origin);
