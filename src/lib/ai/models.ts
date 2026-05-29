import "server-only";

// Per-task model selection. Each task can be overridden via an env var; a
// generic AI_PROVIDER_MODEL is the final fallback before a sensible default.

export type AiTask =
  | "document_graph"
  | "document_graph_fast"
  | "ghost_explore"
  | "deep_explore";

const DEFAULTS: Record<AiTask, string> = {
  document_graph: "gpt-4.1",
  document_graph_fast: "gpt-4o-mini",
  ghost_explore: "gpt-4o-mini",
  deep_explore: "gpt-4.1",
};

const ENV_BY_TASK: Record<AiTask, string> = {
  document_graph: "AI_MODEL_DOCUMENT_GRAPH",
  document_graph_fast: "AI_MODEL_DOCUMENT_GRAPH_FAST",
  ghost_explore: "AI_MODEL_GHOST_EXPLORE",
  deep_explore: "AI_MODEL_DEEP_EXPLORE",
};

export function modelForTask(task: AiTask): string {
  const taskEnv = process.env[ENV_BY_TASK[task]];
  if (taskEnv && taskEnv.trim()) return taskEnv.trim();
  const generic = process.env.AI_PROVIDER_MODEL;
  if (generic && generic.trim()) return generic.trim();
  return DEFAULTS[task];
}
