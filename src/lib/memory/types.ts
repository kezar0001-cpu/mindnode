export const MAX_MEMORY_LENGTH = 5000;

export type CreateMemoryEntryState =
  | { status: "idle" }
  | { status: "success" }
  | { status: "error"; error: string };

export const initialCreateMemoryEntryState: CreateMemoryEntryState = {
  status: "idle",
};
