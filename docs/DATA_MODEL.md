# Data Model

All identifiers are UUIDs. All tables have `created_at` and `updated_at` timestamps unless noted. Single user for MVP — `user_id` is included for future-proofing and RLS.

## Core Entities

### `memory_entries`

The raw, unprocessed thought as the user typed it. Never deleted, never overwritten.

| Column      | Type        | Notes                                  |
| ----------- | ----------- | -------------------------------------- |
| id          | uuid (PK)   |                                        |
| user_id     | uuid        | references `auth.users`                |
| content     | text        | the raw input, exactly as typed        |
| source      | text        | `chat` for MVP; later: `voice`, `import` |
| created_at  | timestamptz |                                        |

### `nodes`

A processed concept in the graph. Always derived from one or more memory entries.

| Column      | Type        | Notes                                       |
| ----------- | ----------- | ------------------------------------------- |
| id          | uuid (PK)   |                                             |
| user_id     | uuid        |                                             |
| title       | text        | short label shown on the canvas             |
| summary     | text        | AI-written summary; never replaces raw text |
| category    | text        | e.g. `idea`, `goal`, `reflection`           |
| position_x  | float8      | canvas coordinate                           |
| position_y  | float8      | canvas coordinate                           |
| created_at  | timestamptz |                                             |
| updated_at  | timestamptz |                                             |

### `edges`

A directed or undirected relationship between two nodes.

| Column      | Type        | Notes                                |
| ----------- | ----------- | ------------------------------------ |
| id          | uuid (PK)   |                                      |
| user_id     | uuid        |                                      |
| source_id   | uuid (FK)   | references `nodes.id`                |
| target_id   | uuid (FK)   | references `nodes.id`                |
| relation    | text        | e.g. `related`, `supports`, `blocks` |
| created_at  | timestamptz |                                      |

### `ai_suggestions`

One row per AI proposal. Stored regardless of whether it's accepted, so we keep a record of how the graph evolved.

| Column         | Type        | Notes                                                    |
| -------------- | ----------- | -------------------------------------------------------- |
| id             | uuid (PK)   |                                                          |
| user_id        | uuid        |                                                          |
| memory_entry_id| uuid (FK)   | the entry that triggered the suggestion                  |
| action         | text        | `create_node` / `update_node` / `link_nodes` / `no_change` |
| payload        | jsonb       | full validated suggestion JSON                           |
| status         | text        | `pending` / `accepted` / `rejected`                      |
| created_at     | timestamptz |                                                          |
| resolved_at    | timestamptz | when accepted or rejected                                |

### `node_memory_links`

Many-to-many: a node can be backed by multiple memory entries (e.g. when an update merges a new thought in), and a memory entry could in principle inform more than one node.

| Column          | Type        | Notes                          |
| --------------- | ----------- | ------------------------------ |
| id              | uuid (PK)   |                                |
| node_id         | uuid (FK)   | references `nodes.id`          |
| memory_entry_id | uuid (FK)   | references `memory_entries.id` |
| created_at      | timestamptz |                                |

## Invariants

- Every `nodes` row has at least one `node_memory_links` row.
- `memory_entries` rows are never deleted by application code.
- Accepting an AI suggestion writes to `nodes` / `edges` / `node_memory_links` and updates the suggestion's `status` in the same transaction.

## RLS

For MVP all tables filter on `user_id = auth.uid()`. The service role key is used server-side for the AI suggestion pipeline.

## Future

- `node_embeddings` (pgvector) for semantic related-node lookup.
- `tags` if categories aren't enough.
- Soft archive flag on nodes; raw entries still never deleted.
