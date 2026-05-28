// Hand-written Database type for the Supabase client.
// Kept in sync with the migrations in supabase/migrations/.
// Regenerate later via `supabase gen types typescript --linked`
// once the schema stops moving.

import type {
  AISuggestionPayload,
  AISuggestionStatus,
} from "@/types";

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
          suggestion_json: AISuggestionPayload;
          status: AISuggestionStatus;
          created_at: string;
          accepted_at: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          memory_entry_id: string;
          suggestion_json: AISuggestionPayload;
          status?: AISuggestionStatus;
          created_at?: string;
          accepted_at?: string | null;
        };
        Update: {
          id?: string;
          user_id?: string;
          memory_entry_id?: string;
          suggestion_json?: AISuggestionPayload;
          status?: AISuggestionStatus;
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
