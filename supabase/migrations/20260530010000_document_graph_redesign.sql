-- MindNode — document graph redesign: structure-aware ingestion.
-- Adds document root + section nodes, typed relationships, diagnostics.
-- Additive only.

-- 1. Extend nodes.origin CHECK
alter table nodes drop constraint nodes_origin_check;
alter table nodes add constraint nodes_origin_check
  check (origin in ('manual', 'memory', 'ai_pinned', 'imported',
                    'document_ai', 'document_root', 'document_section'));

-- 2. Extend edges.origin CHECK
alter table edges drop constraint edges_origin_check;
alter table edges add constraint edges_origin_check
  check (origin in ('manual', 'auto_keyword', 'ai_pinned', 'ai_suggested',
                    'document_ai', 'document_structure'));

-- 3. Extend source_documents.status CHECK
alter table source_documents drop constraint source_documents_status_check;
alter table source_documents add constraint source_documents_status_check
  check (status in ('uploaded','extracting','extracted','processing',
                    'processed','processed_with_warnings','failed'));

-- 4. source_documents new columns
alter table source_documents
  add column document_root_node_id uuid references nodes(id) on delete set null,
  add column section_count integer not null default 0,
  add column chunk_count integer not null default 0,
  add column nodes_created integer not null default 0,
  add column edges_created integer not null default 0,
  add column diagnostics jsonb not null default '{}'::jsonb,
  add column warnings jsonb not null default '[]'::jsonb;

-- 5. document_chunks new columns (nullable for old chunks)
alter table document_chunks
  add column section_id uuid,
  add column section_title text,
  add column section_level integer,
  add column section_index integer;

-- 6. document_sections (new table)
create table document_sections (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  document_id     uuid not null references source_documents(id) on delete cascade,
  section_index   integer not null,
  title           text not null,
  level           integer not null default 1,
  char_count      integer not null default 0,
  word_count      integer not null default 0,
  start_offset    integer,
  end_offset      integer,
  node_id         uuid references nodes(id) on delete set null,
  summary         text,
  created_at      timestamptz not null default now(),
  constraint document_sections_unique unique (document_id, section_index)
);

-- 7. document_chunks.section_id FK (after document_sections exists)
alter table document_chunks
  add constraint document_chunks_section_fk
  foreign key (section_id) references document_sections(id) on delete set null;

-- 8. document_notes new columns
alter table document_notes
  add column node_type text,
  add column source_section_title text,
  add column importance numeric,
  add column stable_key text,
  add column tags text[];

-- 9. Indexes
create index document_sections_user_doc_idx on document_sections (user_id, document_id, section_index);
create index document_chunks_section_idx on document_chunks (section_id);
create index source_documents_root_node_idx on source_documents (user_id, document_root_node_id);

-- 10. RLS for document_sections
alter table document_sections enable row level security;
create policy document_sections_select_own on document_sections for select using (auth.uid() = user_id);
create policy document_sections_insert_own on document_sections for insert with check (auth.uid() = user_id);
create policy document_sections_update_own on document_sections for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy document_sections_delete_own on document_sections for delete using (auth.uid() = user_id);
