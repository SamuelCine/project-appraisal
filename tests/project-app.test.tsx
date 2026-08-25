// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { ProjectApp } from "@/components/project-app";

vi.mock("gsap", () => ({
  gsap: {
    matchMedia: () => ({ add: () => undefined, revert: () => undefined }),
    context: (callback: () => void) => { callback(); return { revert: () => undefined }; },
    timeline: () => ({ from: () => ({ from: () => ({ from: () => undefined }) }) }),
    fromTo: () => ({ kill: () => undefined }),
  },
}));

beforeAll(() => {
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
  // 测试环境没有后端服务：fetch 立即失败，组件应回退到本地引擎计算
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("no server in tests")));
});

describe("ProjectApp", () => {
  it("starts with the six-stage appraisal guide", () => {
    render(<ProjectApp />);
    expect(screen.getByRole("heading", { name: "先把项目问清楚，再谈回报" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "01定义决策" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "06风险与决策" })).toBeInTheDocument();
  });

  it("opens the workbench and recalculates when a revenue driver changes", async () => {
    render(<ProjectApp />);
    fireEvent.click(screen.getByRole("button", { name: "载入示例并进入工作台" }));
    expect(screen.getByRole("heading", { name: "决策工作台" })).toBeInTheDocument();
    const before = screen.getByTestId("npv-value").textContent;
    fireEvent.change(screen.getByLabelText("潜在客户数"), { target: { value: "2000" } });
    // 评估经 200ms 防抖后异步更新
    await waitFor(() => expect(screen.getByTestId("npv-value").textContent).not.toBe(before), { timeout: 3000 });
    expect(screen.getByText("最低可行投入")).toBeInTheDocument();
    expect(screen.getByText("投资价值上限")).toBeInTheDocument();
  });
});
