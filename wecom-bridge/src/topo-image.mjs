// 展示层（仅企微通道需要）：把核心 3789 返回的配单拓扑 SVG，用本机 Edge/Chrome 无头渲染成 PNG。
// 零 npm 依赖（只 spawn 系统浏览器）；找不到浏览器、超时、渲染失败一律返回 null，调用方静默降级为纯文字，
// 绝不能因为出图失败影响正常文字回复（与大模型回退同一原则：不成单点故障）。
import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const BROWSER_CANDIDATES = [
  process.env.WECOM_BROWSER_BIN, // 允许用环境变量显式指定浏览器可执行文件
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
].filter(Boolean);

let cachedBrowser; // 浏览器路径只探测一次（undefined=未探测，""=没有，字符串=命中）
async function findBrowser() {
  if (cachedBrowser !== undefined) return cachedBrowser;
  cachedBrowser = BROWSER_CANDIDATES.find((p) => existsSync(p)) || "";
  return cachedBrowser;
}

// 从 <svg width height> 解析 CSS 像素尺寸，缺省回退 viewBox，再缺省给一个安全默认值
function svgSize(svg) {
  const w = svg.match(/\bwidth="(\d+(?:\.\d+)?)"/);
  const h = svg.match(/\bheight="(\d+(?:\.\d+)?)"/);
  if (w && h) return { w: Math.ceil(Number(w[1])), h: Math.ceil(Number(h[1])) };
  const vb = svg.match(/viewBox="[\d.\s]+?([\d.]+)\s+([\d.]+)"/);
  if (vb) return { w: Math.ceil(Number(vb[1])), h: Math.ceil(Number(vb[2])) };
  return { w: 1000, h: 700 };
}

// Edge headless=new 在 Windows 上启动器进程可能先退出、真正写截图的进程稍后才落盘；
// 不能在 exit 瞬间读文件（会偶发 ENOENT 误判失败）。改为轮询等 PNG 出现且大小连续稳定。
function renderToPng(bin, args, pngPath, timeoutMs) {
  return new Promise((resolve) => {
    let done = false;
    let lastSize = -1, stable = 0, exited = false;
    let child = null;
    const sizeOf = () => { try { return existsSync(pngPath) ? statSync(pngPath).size : 0; } catch { return 0; } };
    const killTree = () => { try { spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" }); } catch {} };
    const finish = (ok) => {
      if (done) return;
      done = true;
      clearInterval(tick);
      clearTimeout(timer);
      if (ok) killTree(); // 截图已稳定落盘，收尾可能残留的浏览器进程组，释放临时 profile
      resolve(ok);
    };
    child = spawn(bin, args, { windowsHide: true, stdio: "ignore" });
    const timer = setTimeout(() => finish(false), timeoutMs);
    const tick = setInterval(() => {
      const size = sizeOf();
      if (size > 0) {
        if (size === lastSize) { stable++; if (stable >= 2) return finish(true); }
        else { stable = 0; lastSize = size; }
      } else if (exited) {
        return finish(false);
      }
    }, 150);
    child.on("error", () => finish(false));
    child.on("exit", () => {
      exited = true;
      // 启动器已退、落盘进程可能仍在跑：再给一点宽限，按文件是否真正写出定论
      setTimeout(() => { if (!done) finish(sizeOf() > 0); }, 1500);
    });
  });
}

/**
 * 把拓扑 SVG 渲染成 PNG Buffer。
 * @param {string} svg 核心返回的 topologySvg（UTF-8 字符串）
 * @param {{scale?:number, maxCssEdge?:number, timeoutMs?:number}} [opts]
 * @returns {Promise<Buffer|null>} PNG 缓冲；任何失败都返回 null
 */
export async function svgToPngBuffer(svg, { scale = 2, maxCssEdge = 1400, timeoutMs = 15000 } = {}) {
  if (!svg || !String(svg).includes("<svg")) return null;
  const bin = await findBrowser();
  if (!bin) return null;

  const { w, h } = svgSize(svg);
  // 保护：信息不全时核心可能只给一条很矮的占位条（非整屏面板，实测约 24px 高），这种不发图，
  // 避免企微收到一条残图；正常整屏面板含标题+屏体+图例，高度必然远大于此。
  if (h < 100) return null;
  // 倍率：常规/二维大图按最长边等比降倍（不超 maxCssEdge、窗口不失控）；
  // 超宽横条（宽高比 > 4，几十上百列但只有一两行卡）若也按最长边降倍，高度会被压没、卡面字糊，
  // 改为保输出高度（每张卡物理像素可读），再受总宽上限夹逼。
  let effScale;
  if (w / h > 4) {
    const MIN_OUT_H = 360, MAX_OUT_W = 8000;
    effScale = Math.min(scale, MIN_OUT_H / h, MAX_OUT_W / w);
  } else {
    effScale = Math.min(scale, maxCssEdge / Math.max(w, h));
  }
  const dir = await mkdtemp(path.join(os.tmpdir(), "xhj-topo-"));
  const svgPath = path.join(dir, "topo.svg");
  const pngPath = path.join(dir, "topo.png");
  const profileDir = path.join(dir, "profile"); // 独立用户目录，避免和用户正在开的浏览器抢实例
  try {
    await writeFile(svgPath, String(svg), "utf8");
    const fileUrl = "file:///" + svgPath.replace(/\\/g, "/");
    const ok = await renderToPng(bin, [
      "--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run",
      "--no-default-browser-check", `--user-data-dir=${profileDir}`,
      `--force-device-scale-factor=${effScale}`,
      // 窗口比 SVG 略大几像素，避免 deviceScaleFactor 取整时裁掉最底一行图例/最右尾卡（多余为白边）
      `--window-size=${w + 8},${h + 12}`,
      `--screenshot=${pngPath}`,
      fileUrl,
    ], pngPath, timeoutMs);
    if (!ok) return null;
    const buf = await readFile(pngPath);
    return buf && buf.length > 0 ? buf : null;
  } catch {
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {}); // 临时文件即用即清
  }
}
