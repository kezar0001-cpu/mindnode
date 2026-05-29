// Hand-written Database type for the Supabase client.
// Kept in sync with the migrations in supabase/migrations/.
// Regenerate later via `supabase gen types typescript --linked`
// once the schema stops moving.

type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Database {
  public: {
    Tables: {
      memory_entries: {
        Row: {
          id: string;
          user_id: string;
          content: string;
          source: string;
          metadata: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          content: string;
          source?: string;
          metadata?: Json;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          content?: string;
          source?: string;
          metadata?: Json;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "memory_entries_user_id_fkey";
            columns: ["user_id"];
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      nodes: {
        Row: {
          id: string;
          user_id: string;
          title: string;
          summary: string;
          category: string;
          position_x: number;
          position_y: number;
          // "manual" | "memory" | "ai_pinned" | "imported" | "document_ai"
          // — enforced by DB CHECK constraint.
          origin: string;
          ai_reason: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          title: string;
          summary?: string;
          category?: string;
          position_x?: number;
          position_y?: number;
          origin?: string;
          ai_reason?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          title?: string;
          summary?: string;
          category?: string;
          position_x?: number;
          position_y?: number;
          origin?: string;
          ai_reason?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "nodes_user_id_fkey";
            columns: ["user_id"];
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      edges: {
        Row: {
          id: string;
          user_id: string;
          source_node_id: string;
          target_node_id: string;
          relationship_type: string;
          label: string | null;
          strength: number;
          origin: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          source_node_id: string;
          target_node_id: string;
          relationship_type?: string;
          label?: string | null;
          strength?: number;
          origin?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          source_node_id?: string;
          target_node_id?: string;
          relationship_type?: string;
          label?: string | null;
          strength?: number;
          origin?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "edges_source_node_id_fkey";
            columns: ["source_node_id"];
            referencedRelation: "nodes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "edges_target_node_id_fkey";
            columns: ["target_node_id"];
            referencedRelation: "nodes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "edges_user_id_fkey";
            columns: ["user_id"];
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      ai_suggestions: {
        Row: {
          id: string;
          user_id: string;
          memory_entry_id: string;
          // Parsed via Zod at read time; DB enforces no schema at this layer.
          suggestion_json: Json;
          // "pending" | "accepted" | "rejected" — enforced by DB CHECK constraint.
          status: string;
          created_at: string;
          accepted_at: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          memory_entry_id: string;
          suggestion_json: Json;
          status?: string;
          created_at?: string;
          accepted_at?: string | null;
        };
        Update: {
          id?: string;
          user_id?: string;
          memory_entry_id?: string;
          suggestion_json?: Json;
          status?: string;
          created_at?: string;
          accepted_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "ai_suggestions_memory_entry_id_fkey";
            columns: ["memory_entry_id"];
            referencedRelation: "memory_entries";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ai_suggestions_user_id_fkey";
            columns: ["user_id"];
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      source_documents: {
        Row: {
          id: string;
          user_id: string;
          filename: string;
          original_filename: string;
          mime_type: string;
          file_size_bytes: number;
          storage_path: string;
          // "uploaded" | "extracting" | "extracted" | "processing" | "processed" | "processed_with_warnings" | "failed"
          status: string;
          error_message: string | null;
          extracted_text: string | null;
          text_char_count: number | null;
          metadata: Json;
          document_root_node_id: string | null;
          section_count: number;
          chunk_count: number;
          nodes_created: number;
          edges_created: number;
          diagnostics: Json;
          warnings: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          filename: string;
          original_filename: string;
          mime_type: string;
          file_size_bytes: number;
          storage_path: string;
          status?: string;
          error_message?: string | null;
          extracted_text?: string | null;
          text_char_count?: number | null;
          metadata?: Json;
          document_root_node_id?: string | null;
          section_count?: number;
          chunk_count?: number;
          nodes_created?: number;
          edges_created?: number;
          diagnostics?: Json;
          warnings?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          filename?: string;
          original_filename?: string;
          mime_type?: string;
          file_size_bytes?: number;
          storage_path?: string;
          status?: string;
          error_message?: string | null;
          extracted_text?: string | null;
          text_char_count?: number | null;
          metadata?: Json;
          document_root_node_id?: string | null;
          section_count?: number;
          chunk_count?: number;
          nodes_created?: number;
          edges_created?: number;
          diagnostics?: Json;
          warnings?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "source_documents_user_id_fkey";
            columns: ["user_id"];
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      document_chunks: {
        Row: {
          id: string;
          user_id: string;
          document_id: string;
          chunk_index: number;
          content: string;
          token_estimate: number | null;
          metadata: Json;
          section_id: string | null;
          section_title: string | null;
          section_level: number | null;
          section_index: number | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          document_id: string;
          chunk_index: number;
          content: string;
          token_estimate?: number | null;
          metadata?: Json;
          section_id?: string | null;
          section_title?: string | null;
          section_level?: number | null;
          section_index?: number | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          document_id?: string;
          chunk_index?: number;
          content?: string;
          token_estimate?: number | null;
          metadata?: Json;
          section_id?: string | null;
          section_title?: string | null;
          section_level?: number | null;
          section_index?: number | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "document_chunks_document_id_fkey";
            columns: ["document_id"];
            referencedRelation: "source_documents";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "document_chunks_user_id_fkey";
            columns: ["user_id"];
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      document_sections: {
        Row: {
          id: string;
          user_id: string;
          document_id: string;
          section_index: number;
          title: string;
          level: number;
          char_count: number;
          word_count: number;
          start_offset: number | null;
          end_offset: number | null;
          node_id: string | null;
          summary: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          document_id: string;
          section_index: number;
          title: string;
          level?: number;
          char_count?: number;
          word_count?: number;
          start_offset?: number | null;
          end_offset?: number | null;
          node_id?: string | null;
          summary?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          document_id?: string;
          section_index?: number;
          title?: string;
          level?: number;
          char_count?: number;
          word_count?: number;
          start_offset?: number | null;
          end_offset?: number | null;
          node_id?: string | null;
          summary?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "document_sections_document_id_fkey";
            columns: ["document_id"];
            referencedRelation: "source_documents";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "document_sections_node_id_fkey";
            columns: ["node_id"];
            referencedRelation: "nodes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "document_sections_user_id_fkey";
            columns: ["user_id"];
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      document_notes: {
        Row: {
          id: string;
          user_id: string;
          document_id: string;
          chunk_id: string | null;
          node_id: string | null;
          title: string;
          summary: string;
          category: string;
          source_excerpt: string | null;
          confidence: number | null;
          metadata: Json;
          node_type: string | null;
          source_section_title: string | null;
          importance: number | null;
          stable_key: string | null;
          tags: string[] | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          document_id: string;
          chunk_id?: string | null;
          node_id?: string | null;
          title: string;
          summary: string;
          category?: string;
          source_excerpt?: string | null;
          confidence?: number | null;
          metadata?: Json;
          node_type?: string | null;
          source_section_title?: string | null;
          importance?: number | null;
          stable_key?: string | null;
          tags?: string[] | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          document_id?: string;
          chunk_id?: string | null;
          node_id?: string | null;
          title?: string;
          summary?: string;
          category?: string;
          source_excerpt?: string | null;
          confidence?: number | null;
          metadata?: Json;
          node_type?: string | null;
          source_section_title?: string | null;
          importance?: number | null;
          stable_key?: string | null;
          tags?: string[] | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "document_notes_document_id_fkey";
            columns: ["document_id"];
            referencedRelation: "source_documents";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "document_notes_chunk_id_fkey";
            columns: ["chunk_id"];
            referencedRelation: "document_chunks";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "document_notes_node_id_fkey";
            columns: ["node_id"];
            referencedRelation: "nodes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "document_notes_user_id_fkey";
            columns: ["user_id"];
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      chat_conversations: {
        Row: {
          id: string;
          user_id: string;
          title: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          title?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          title?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "chat_conversations_user_id_fkey";
            columns: ["user_id"];
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      chat_messages: {
        Row: {
          id: string;
          conversation_id: string;
          user_id: string;
          // "user" | "assistant" — enforced by DB CHECK constraint.
          role: string;
          content: string;
          citations_json: Json;
          used_context_json: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          conversation_id: string;
          user_id: string;
          role: string;
          content: string;
          citations_json?: Json;
          used_context_json?: Json;
          created_at?: string;
        };
        Update: {
          id?: string;
          conversation_id?: string;
          user_id?: string;
          role?: string;
          content?: string;
          citations_json?: Json;
          used_context_json?: Json;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "chat_messages_conversation_id_fkey";
            columns: ["conversation_id"];
            referencedRelation: "chat_conversations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "chat_messages_user_id_fkey";
            columns: ["user_id"];
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      chat_graph_suggestions: {
        Row: {
          id: string;
          conversation_id: string;
          message_id: string | null;
          user_id: string;
          suggestion_json: Json;
          // "pending" | "applied" | "dismissed" — enforced by DB CHECK constraint.
          status: string;
          created_at: string;
          applied_at: string | null;
        };
        Insert: {
          id?: string;
          conversation_id: string;
          message_id?: string | null;
          user_id: string;
          suggestion_json: Json;
          status?: string;
          created_at?: string;
          applied_at?: string | null;
        };
        Update: {
          id?: string;
          conversation_id?: string;
          message_id?: string | null;
          user_id?: string;
          suggestion_json?: Json;
          status?: string;
          created_at?: string;
          applied_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "chat_graph_suggestions_conversation_id_fkey";
            columns: ["conversation_id"];
            referencedRelation: "chat_conversations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "chat_graph_suggestions_message_id_fkey";
            columns: ["message_id"];
            referencedRelation: "chat_messages";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "chat_graph_suggestions_user_id_fkey";
            columns: ["user_id"];
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      node_memory_links: {
        Row: {
          id: string;
          user_id: string;
          node_id: string;
          memory_entry_id: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          node_id: string;
          memory_entry_id: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          node_id?: string;
          memory_entry_id?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "node_memory_links_node_id_fkey";
            columns: ["node_id"];
            referencedRelation: "nodes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "node_memory_links_memory_entry_id_fkey";
            columns: ["memory_entry_id"];
            referencedRelation: "memory_entries";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "node_memory_links_user_id_fkey";
            columns: ["user_id"];
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
