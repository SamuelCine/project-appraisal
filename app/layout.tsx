import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "衡策 · 项目收益决策",
  description: "面向普通人的项目考察、收益预测与反向投资决策工具",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
