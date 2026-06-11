import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      // Match the tsconfig "@/*" path alias.
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // Next's server-only guard is a no-op in the Node test environment.
      "server-only": fileURLToPath(new URL("./test/stubs/empty.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
