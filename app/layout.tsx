import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FitLog | AIフィットネストレーカー",
  description: "トレーニング・食事・体重をAIと一緒に記録・分析するフィットネスアプリ",
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
