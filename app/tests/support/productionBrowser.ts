import react from "@vitejs/plugin-react";
import { build, preview, type PreviewServer } from "vite";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createServer, type AddressInfo } from "node:net";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

type CdpTarget = { id: string; webSocketDebuggerUrl: string };
type CdpEvent = { method: string; params: unknown };
type RuntimeResult<T> = { result: { value: T }; exceptionDetails?: { text: string; exception?: { description: string } } };
export type CdpPage = Awaited<ReturnType<typeof connectToCdp>>;

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const artifactsRoot = resolve(appRoot, "..", "build", "browser-acceptance");
const pages = new Set<CdpPage>();
let runDir = "";
let appUrl = "";
let cdpPort = 0;
let server: PreviewServer | null = null;
let chrome: ChildProcess | null = null;
let chromeStderr = "";

export async function startProductionBrowser(): Promise<void> {
  mkdirSync(artifactsRoot, { recursive: true });
  runDir = mkdtempSync(join(artifactsRoot, "production-"));
  const outDir = join(runDir, "dist");
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    await build({ root: appRoot, configFile: false, plugins: [react()], mode: "production", logLevel: "error", build: { outDir, emptyOutDir: true } });
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
  }
  server = await preview({ root: appRoot, configFile: false, logLevel: "error", build: { outDir }, preview: { host: "127.0.0.1", port: 0, strictPort: false } });
  const address = server.httpServer.address() as AddressInfo;
  appUrl = `http://127.0.0.1:${address.port}/`;
  cdpPort = await findFreePort();
  chrome = spawn(findChromeExecutable(), [
    "--headless=new", `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${join(runDir, "chrome-profile")}`,
    "--no-first-run", "--no-default-browser-check", "--no-sandbox", "--disable-gpu",
    "--disable-gpu-compositing", "--disable-3d-apis", "--disable-dev-shm-usage",
    "--disable-background-networking", "--lang=en-US", "about:blank",
  ], { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
  chrome.stderr?.on("data", (chunk) => { chromeStderr = `${chromeStderr}${String(chunk)}`.slice(-4000); });
  await waitForChrome();
}

export async function closePages(): Promise<CdpEvent[]> {
  const opened = [...pages];
  await Promise.all(opened.map((page) => page.close()));
  return opened.flatMap((page) => page.events);
}

export async function stopProductionBrowser(): Promise<void> {
  await closePages();
  if (chrome && chrome.exitCode === null && chrome.signalCode === null) {
    const exiting = new Promise<void>((done) => chrome!.once("exit", () => done()));
    const endpoint = await requestJson<{ webSocketDebuggerUrl: string }>("/json/version");
    const socket = new WebSocket(endpoint.webSocketDebuggerUrl);
    await new Promise<void>((done, reject) => {
      socket.addEventListener("open", () => done(), { once: true });
      socket.addEventListener("error", reject, { once: true });
    });
    socket.send(JSON.stringify({ id: 1, method: "Browser.close" }));
    await Promise.race([exiting, delay(5000)]);
    socket.close();
    if (chrome.exitCode === null && chrome.signalCode === null) {
      chrome.kill();
      await Promise.race([exiting, delay(2000)]);
    }
  }
  if (server) await new Promise<void>((done, reject) => server!.httpServer.close((error) => error ? reject(error) : done()));
  if (runDir) {
    const target = resolve(runDir);
    if (!target.startsWith(`${artifactsRoot}${sep}`)) throw new Error("Browser artifacts must stay inside the workspace build directory");
    rmSync(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

export async function openPage(width = 1180, height = 760): Promise<CdpPage> {
  const target = await requestJson<CdpTarget>(`/json/new?${encodeURIComponent("about:blank")}`, "PUT");
  const page = await connectToCdp(target.webSocketDebuggerUrl, target.id);
  pages.add(page);
  await page.send("Page.enable");
  await page.send("Runtime.enable");
  await page.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
  await page.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  await page.send("Page.navigate", { url: appUrl });
  await waitFor(page, `document.documentElement.lang === 'en-US' && Boolean(document.querySelector('.data-storage-recovery [role="status"]'))`);
  return page;
}

async function connectToCdp(url: string, targetId: string) {
  const socket = new WebSocket(url);
  const events: CdpEvent[] = [];
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  let nextId = 0;
  let closing: Promise<void> | null = null;
  socket.addEventListener("message", (message) => {
    const data = JSON.parse(String(message.data));
    const callback = pending.get(data.id);
    if (callback) {
      pending.delete(data.id);
      clearTimeout(callback.timer);
      if (data.error) callback.reject(new Error(JSON.stringify(data.error)));
      else callback.resolve(data.result);
    } else if (data.method) events.push({ method: data.method, params: data.params });
  });
  socket.addEventListener("close", () => {
    for (const callback of pending.values()) { clearTimeout(callback.timer); callback.reject(new Error(`CDP connection closed. Chrome exit=${chrome?.exitCode}, stderr=${chromeStderr}`)); }
    pending.clear();
  });
  await new Promise<void>((done, reject) => {
    socket.addEventListener("open", () => done(), { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  const page = {
    events,
    send: <T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> => {
      const id = ++nextId;
      return new Promise<T>((done, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP command timed out: ${method}`)); }, 10_000);
        pending.set(id, { resolve: (value) => done(value as T), reject, timer });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    close: (): Promise<void> => {
      closing ??= (async () => {
        try { await requestJson(`/json/close/${targetId}`); }
        finally { pages.delete(page); socket.close(); }
      })();
      return closing;
    },
  };
  return page;
}

export async function evaluate<T>(page: CdpPage, expression: string): Promise<T> {
  const result = await page.send<RuntimeResult<T>>("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  return result.result.value;
}

export async function waitFor(page: CdpPage, condition: string, timeoutMs = 8000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await evaluate<boolean>(page, `Boolean(${condition})`)) return;
    await delay(25);
  }
  const state = await evaluate(page, `({text:document.body.innerText.slice(-3000),active:document.activeElement?.outerHTML})`);
  throw new Error(`Browser condition did not become true: ${condition}. State: ${JSON.stringify(state)}`);
}

export async function click(page: CdpPage, selector: string): Promise<void> {
  await clickExpression(page, `document.querySelector(${JSON.stringify(selector)})`);
}

export async function clickText(page: CdpPage, selector: string, text: string): Promise<void> {
  await clickExpression(page, `[...document.querySelectorAll(${JSON.stringify(selector)})].find(element => element.textContent.trim() === ${JSON.stringify(text)})`);
}

async function clickExpression(page: CdpPage, expression: string): Promise<void> {
  const point = await evaluate<{ x: number; y: number }>(page, `(async () => {
    const element = ${expression};
    if (!element || element.disabled || element.closest('[inert]')) throw new Error('Requested button is unavailable');
    element.scrollIntoView({block:'nearest', inline:'nearest', behavior:'instant'});
    let previous = element.getBoundingClientRect();
    let stableFrames = 0;
    for (let frame = 0; frame < 60; frame += 1) {
      await new Promise(requestAnimationFrame);
      if (!element.isConnected || element !== (${expression})) throw new Error('Requested button was replaced before input');
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const hit = document.elementFromPoint(x, y);
      const stable = ['left', 'top', 'width', 'height'].every(key => Math.abs(rect[key] - previous[key]) < 0.1);
      const reachable = rect.width > 0 && rect.height > 0 && !element.disabled &&
        !element.closest('[inert]') && style.visibility === 'visible' && Number(style.opacity) > 0 &&
        hit && (hit === element || element.contains(hit));
      stableFrames = stable && reachable ? stableFrames + 1 : 0;
      if (stableFrames >= 2) return { x, y };
      previous = rect;
    }
    throw new Error('Requested button did not reach a stable visible layout');
  })()`);
  await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...point, button: "none", buttons: 0 });
  await page.send("Input.dispatchMouseEvent", { type: "mousePressed", ...point, button: "left", buttons: 1, clickCount: 1 });
  await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...point, button: "left", buttons: 0, clickCount: 1 });
}

export async function focus(page: CdpPage, selector: string): Promise<void> {
  await evaluate(page, `document.querySelector(${JSON.stringify(selector)}).focus()`);
}

export async function fill(page: CdpPage, selector: string, value: string): Promise<void> {
  await focus(page, selector);
  await page.send("Input.dispatchKeyEvent", { type: "keyDown", key: "a", code: "KeyA", modifiers: 2, windowsVirtualKeyCode: 65 });
  await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: "a", code: "KeyA", modifiers: 2, windowsVirtualKeyCode: 65 });
  await page.send("Input.insertText", { text: value });
}

export async function press(page: CdpPage, key: string): Promise<void> {
  const codes: Record<string, number> = { Escape: 27, Enter: 13, ArrowDown: 40, ArrowUp: 38, Tab: 9 };
  await page.send("Input.dispatchKeyEvent", { type: "keyDown", key, code: key, windowsVirtualKeyCode: codes[key], ...(key === "Enter" ? { text: "\r" } : {}) });
  await page.send("Input.dispatchKeyEvent", { type: "keyUp", key, code: key, windowsVirtualKeyCode: codes[key] });
}

async function requestJson<T>(path: string, method = "GET"): Promise<T> {
  const response = await fetch(`http://127.0.0.1:${cdpPort}${path}`, { method });
  if (!response.ok) throw new Error(`Chrome endpoint returned ${response.status}: ${path}`);
  const body = await response.text();
  if (path.startsWith("/json/close/")) return undefined as T;
  return JSON.parse(body) as T;
}

async function waitForChrome(): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (chrome?.exitCode !== null || chrome?.signalCode !== null) throw new Error(`Chrome exited: ${chromeStderr}`);
    try { await requestJson("/json/version"); return; }
    catch { await delay(100); }
  }
  throw new Error(`Chrome DevTools endpoint did not become ready: ${chromeStderr}`);
}

function findFreePort(): Promise<number> {
  return new Promise((done, reject) => {
    const socket = createServer();
    socket.on("error", reject);
    socket.listen(0, "127.0.0.1", () => {
      const address = socket.address() as AddressInfo;
      socket.close((error) => error ? reject(error) : done(address.port));
    });
  });
}

function findChromeExecutable(): string {
  const candidates = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser",
  ];
  const executable = candidates.find(existsSync);
  if (!executable) throw new Error("Chrome or Edge executable was not found for production browser acceptance");
  return executable;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((done) => setTimeout(done, milliseconds));
}
