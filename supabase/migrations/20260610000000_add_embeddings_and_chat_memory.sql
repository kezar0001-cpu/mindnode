-- MindNode — Phase D: retrieval depth.
--
-- Adds pgvector embeddings for nodes and document chunks (hybrid retrieval
-- in the chat brain), and a rolling summary on chat conversations so prior
-- chats become retrievable memory.
--
-- Vector dimension is fixed at 1536 (OpenAI text-embedding-3-* with
-- dimensions=1536). Additive only.

-- 1. pgvector
create extension if not exists vector;

-- 2. Embedding columns
alter table nodes add column embedding vector(1536);
alter table document_chunks add column embedding vector(1536);

-- 3. Chat memory
alter table chat_conversations add column summary text;

-- 4. ANN indexes (HNSW, cosine)
create index nodes_embedding_idx
  on nodes using hnsw (embedding vector_cosine_ops);
create index document_chunks_embedding_idx
  on document_chunks using hnsw (embedding vector_cosine_ops);

-- 5. Match functions — SECURITY INVOKER (default), so RLS applies; the
-- explicit auth.uid() filter keeps results user-scoped even under RLS.
create or replace function match_nodes(
  query_embedding vector(1536),
  match_count int default 16
)
returns table (
  id uuid,
  title text,
  summary text,
  category text,
  origin text,
  similarity double precision
)
language sql stable
as $$
  select
    n.id, n.title, n.summary, n.category, n.origin,
    1 - (n.embedding <=> query_embedding) as similarity
  from nodes n
  where n.user_id = auth.uid()
    and n.embedding is not null
  order by n.embedding <=> query_embedding
  limit least(greatest(match_count, 1), 50);
$$;

create or replace function match_document_chunks(
  query_embedding vector(1536),
  match_count int default 16
)
returns table (
  id uuid,
  document_id uuid,
  content text,
  section_title text,
  similarity double precision
)
language sql stable
as $$
  select
    c.id, c.document_id, c.content, c.section_title,
    1 - (c.embedding <=> query_embedding) as similarity
  from document_chunks c
  where c.user_id = auth.uid()
    and c.embedding is not null
  order by c.embedding <=> query_embedding
  limit least(greatest(match_count, 1), 50);
$$;
