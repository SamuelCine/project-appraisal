import net from "node:net";
import { ProxyAgent, fetch as undiciFetch } from "undici";

/**
 * 代理感知 fetch。
 *
 * 背景：GDELT 等海外新闻源在部分网络环境不可直连，而本机常有代理软件在运行
 * （Clash 7897/7890、v2ray 10809/10808 等），Node 的全局 fetch 不会读 Windows 系统代理。
 * 解析顺序：
 * 1. NEWS_PROXY / HTTPS_PROXY / https_proxy 环境变量（显式配置永远优先）
 * 2. 自动探测常见本地代理端口（TCP 连通即采纳，结果缓存到进程生命周期）
 * 都没有则返回全局 fetch（直连）。
 */

const COMMON_PROXY_PORTS = [7897, 7890, 10809, 10808, 1080];

function probePort(port: number, timeoutMs = 800): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    const done = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
    socket.setTimeout(timeoutMs, () => done(false));
  });
}

let resolvedProxy: { at: number; url: string | null } | undefined;

export async function resolveProxyUrl(): Promise<string | null> {
  const explicit = process.env.NEWS_PROXY ?? process.env.HTTPS_PROXY ?? process.env.https_proxy;
  if (explicit) return explicit;
  if (resolvedProxy) return resolvedProxy.url;
  for (const port of COMMON_PROXY_PORTS) {
    if (await probePort(port)) {
      resolvedProxy = { at: Date.now(), url: `http://127.0.0.1:${port}` };
      return resolvedProxy.url;
    }
  }
  resolvedProxy = { at: Date.now(), url: null };
  return null;
}

const agents = new Map<string, ProxyAgent>();

/** 返回一个感知代理的 fetch；无代理可用时退化为全局 fetch。 */
export async function proxyAwareFetch(): Promise<typeof fetch> {
  const proxyUrl = await resolveProxyUrl();
  if (!proxyUrl) return fetch;
  let agent = agents.get(proxyUrl);
  if (!agent) {
    agent = new ProxyAgent(proxyUrl);
    agents.set(proxyUrl, agent);
  }
  return ((input: RequestInfo | URL, init?: RequestInit) =>
    undiciFetch(input as string, { ...(init as object), dispatcher: agent }) as unknown as Promise<Response>) as typeof fetch;
}

/** 测试用：清空代理解析缓存。 */
export function resetProxyCache() {
  resolvedProxy = undefined;
}
