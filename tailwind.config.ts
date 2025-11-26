import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}"
  ],
  theme: {
    extend: {
      fontFamily: {
        display: ["'Space Grotesk'", "Inter", "ui-sans-serif", "system-ui"],
        body: ["'Space Grotesk'", "Inter", "ui-sans-serif", "system-ui"]
      },
      colors: {
        board: {
          bg: "#0f172a",
          line: "#1f2937"
        }
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(255,255,255,0.05), 0 10px 50px rgba(0,0,0,0.35)"
      }
    }
  },
  plugins: []
};

export default config;
