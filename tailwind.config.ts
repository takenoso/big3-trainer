import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Primary palette
        navy: {
          50: "#f0f4ff",
          100: "#e0e9ff",
          500: "#1a2f5a",
          600: "#142448",
          700: "#0e1a36",
          800: "#0a1224",
          900: "#060c18",
        },
        lime: {
          400: "#a3e635",
          500: "#84cc16",
          600: "#65a30d",
        },
        // Rank colors
        bronze: "#cd7f32",
        silver: "#c0c0c0",
        gold: "#ffd700",
        platinum: "#e5e4e2",
      },
      fontFamily: {
        sans: ["var(--font-inter)", "system-ui", "sans-serif"],
      },
      animation: {
        "rank-up": "rankUp 0.6s ease-out",
        "pulse-lime": "pulseLime 2s infinite",
        "progress-fill": "progressFill 1s ease-out forwards",
        shimmer: "shimmer 2s linear infinite",
      },
      keyframes: {
        rankUp: {
          "0%": { transform: "scale(0.5)", opacity: "0" },
          "70%": { transform: "scale(1.1)" },
          "100%": { transform: "scale(1)", opacity: "1" },
        },
        pulseLime: {
          "0%, 100%": { boxShadow: "0 0 0 0 rgba(163, 230, 53, 0)" },
          "50%": { boxShadow: "0 0 20px 4px rgba(163, 230, 53, 0.4)" },
        },
        progressFill: {
          from: { width: "0%" },
          to: { width: "var(--progress-width)" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
      },
    },
  },
  plugins: [],
};
export default config;
