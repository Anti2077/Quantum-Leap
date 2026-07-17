import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.tsx"],
  theme: {
    extend: {
      boxShadow: {
        glass: "0 24px 80px rgba(0, 0, 0, 0.35)",
        glow: "0 0 50px rgba(110, 231, 255, 0.18)"
      },
      colors: {
        ink: {
          950: "#050816"
        }
      },
      borderRadius: {
        "4xl": "2rem"
      }
    }
  },
  plugins: []
} satisfies Config;
