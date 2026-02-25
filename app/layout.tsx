import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BIG3 TRAINER | パワーリフティング最適化AI",
  description: "科学的根拠に基づきBIG3を向上させるAIパーソナルトレーナー",
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
    ],
    shortcut: "/icon.svg",
    apple: "/icon.svg",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body className="min-h-screen bg-[#060c18] text-slate-50 antialiased">
        {children}
      </body>
    </html>
  );
}
