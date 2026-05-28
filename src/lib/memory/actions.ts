"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/supabase/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import {
  MAX_MEMORY_LENGTH,
  type CreateMemoryEntryState,
} from "./types";

export async function createMemoryEntryAction(
  _prevState: CreateMemoryEntryState,
  formData: FormData,
): Promise<CreateMemoryEntryState> {
  const content = String(formData.get("content") ?? "").trim();

  if (!content) {
    return {
      status: "error",
      error: "Please write something before saving.",
    };
  }
  if (content.length > MAX_MEMORY_LENGTH) {
    return {
      status: "error",
      error: `Thoughts must be ${MAX_MEMORY_LENGTH.toLocaleString()} characters or fewer (yours is ${content.length.toLocaleString()}).`,
    };
  }

  const user = await requireUser();
  const supabase = await createSupabaseServerClient();

  const { error } = await supabase.from("memory_entries").insert({
    user_id: user.id,
    content,
    source: "manual",
    metadata: {},
  });

  if (error) {
    return {
      status: "error",
      error: "Could not save the thought. Please try again.",
    };
  }

  revalidatePath("/");
  return { status: "success" };
}
