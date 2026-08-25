import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "衡策 · 项目考察与反向投资决策系统",
    short_name: "衡策",
    description: "本地优先的项目资本预算与商业验证工具：现金流、NPV、反向估值与决策审计。",
    lang: "zh-CN",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f3efe7",
    theme_color: "#a35f2c",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
  };
}
