import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: {
          bg: "#0f1115",
          surface: "#15181f",
          border: "#262a33",
        },
      },
    },
  },
  plugins: [],
};

export default config;
