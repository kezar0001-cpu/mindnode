-- MindNode — document ingestion: source documents, chunks, AI-generated notes.
-- Additive only. Extends nodes.origin CHECK with 'document_ai'.

-- 1. Extend nodes.origin CHECK
alter table nodes drop constraint nodes_origin_check;
alter table nodes add constraint nodes_origin_check
  check (origin in ('manual', 'memory', 'ai_pinned', 'imported', 'document_ai'));

-- 2. source_documents
create table source_documents (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  filename          text not null,
  original_filename text not null,
  mime_type         text not null,
  file_size_bytes   bigint not null,
  storage_path      text not null,
  status            text not null default 'uploaded'
    constraint source_documents_status_check
    check (status in ('uploaded','extracting','extracted','processing','processed','failed')),
  error_message     text,
  extracted_text    text,
  text_char_count   integer,
  metadata          jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- 3. document_chunks
create table document_chunks (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  document_id     uuid not null references source_documents(id) on delete cascade,
  chunk_index     integer not null,
  content         text not null,
  token_estimate  integer,
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  constraint document_chunks_unique unique (document_id, chunk_index)
);

-- 4. document_notes
create table document_notes (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  document_id     uuid not null references source_documents(id) on delete cascade,
  chunk_id        uuid references document_chunks(id) on delete set null,
  node_id         uuid references nodes(id) on delete set null,
  title           text not null,
  summary         text not null,
  category        text not null default 'document',
  source_excerpt  text,
  confidence      numeric,
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);

-- 5. Indexes
create index source_documents_user_created_idx on source_documents (user_id, created_at desc);
create index source_documents_user_status_idx on source_documents (user_id, status);
create index document_chunks_doc_idx on document_chunks (user_id, document_id, chunk_index);
create index document_notes_doc_idx on document_notes (user_id, document_id);
create index document_notes_node_idx on document_notes (user_id, node_id);

-- 6. updated_at trigger for source_documents
create trigger source_documents_set_updated_at
  before update on source_documents
  for each row
  execute function mindnode_set_updated_at();

-- 7. RLS
alter table source_documents enable row level security;
alter table document_chunks enable row level security;
alter table document_notes enable row level security;

-- source_documents policies
create policy source_documents_select_own on source_documents for select using (auth.uid() = user_id);
create policy source_documents_insert_own on source_documents for insert with check (auth.uid() = user_id);
create policy source_documents_update_own on source_documents for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy source_documents_delete_own on source_documents for delete using (auth.uid() = user_id);

-- document_chunks policies
create policy document_chunks_select_own on document_chunks for select using (auth.uid() = user_id);
create policy document_chunks_insert_own on document_chunks for insert with check (auth.uid() = user_id);
create policy document_chunks_update_own on document_chunks for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy document_chunks_delete_own on document_chunks for delete using (auth.uid() = user_id);

-- document_notes policies
create policy document_notes_select_own on document_notes for select using (auth.uid() = user_id);
create policy document_notes_insert_own on document_notes for insert with check (auth.uid() = user_id);
create policy document_notes_update_own on document_notes for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy document_notes_delete_own on document_notes for delete using (auth.uid() = user_id);

-- 8. Storage bucket (private) + per-user folder policies
insert into storage.buckets (id, name, public) values ('mindnode-documents', 'mindnode-documents', false)
  on conflict (id) do nothing;

create policy "mindnode_documents_user_select"
  on storage.objects for select
  using (bucket_id = 'mindnode-documents' and auth.uid()::text = (storage.foldername(name))[1]);
create policy "mindnode_documents_user_insert"
  on storage.objects for insert
  with check (bucket_id = 'mindnode-documents' and auth.uid()::text = (storage.foldername(name))[1]);
create policy "mindnode_documents_user_update"
  on storage.objects for update
  using (bucket_id = 'mindnode-documents' and auth.uid()::text = (storage.foldername(name))[1])
  with check (bucket_id = 'mindnode-documents' and auth.uid()::text = (storage.foldername(name))[1]);
create policy "mindnode_documents_user_delete"
  on storage.objects for delete
  using (bucket_id = 'mindnode-documents' and auth.uid()::text = (storage.foldername(name))[1]);
