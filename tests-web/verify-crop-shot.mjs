// 端到端验证「网页框选截图」：真实扩展页面 + CDP 模拟拖拽
// 用法：node verify-crop-shot.mjs   （需浏览器以 --remote-debugging-port=9333 启动并加载 edge/ 扩展）
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEBUG = process.env.CDP || "http://127.0.0.1:9333";
const PORT = 8899;
const FIXTURE = `http://127.0.0.1:${PORT}/fixture.html`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = { checks: {} };

class Session {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.nextId = 0;
    this.pending = new Map();
    this.ws.addEventListener("message", (event) => {
      const data = JSON.parse(event.data);
      if (data.id && this.pending.has(data.id)) {
        this.pending.get(data.id)(data);
        this.pending.delete(data.id);
      }
    });
  }
  async open() { await new Promise((r) => this.ws.addEventListener("open", r, { once: true })); }
  send(method, params) {
    const id = ++this.nextId;
    this.ws.send(JSON.stringify({ id, method, params: params || {} }));
    return new Promise((r) => this.pending.set(id, r));
  }
  async evaluate(expression) {
    const response = await this.send("Runtime.evaluate", {
      expression, returnByValue: true, awaitPromise: true,
    });
    if (response.error) return { __cdp: response.error.message };
    const detail = response.result?.exceptionDetails;
    if (detail) return { __error: (detail.exception?.description || detail.text || "").slice(0, 300) };
    return response.result?.result?.value ?? null;
  }
  close() { this.ws.close(); }
}

const list = async () => (await (await fetch(`${DEBUG}/json`)).json());
const closeTarget = async (id) => fetch(`${DEBUG}/json/close/${id}`).catch(() => {});

const fixtureHtml = await fs.readFile(path.join(HERE, "fixture.html"));
const server = http.createServer((_req, res) => {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(fixtureHtml);
});
await new Promise((resolve, reject) => {
  server.once("error", (err) => (err.code === "EADDRINUSE" ? resolve() : reject(err)));
  server.listen(PORT, "127.0.0.1", resolve);
});

const version = await (await fetch(`${DEBUG}/json/version`)).json();
const browser = new Session(version.webSocketDebuggerUrl);
await browser.open();
const createTab = async (url) => {
  const created = await browser.send("Target.createTarget", { url });
  const id = created.result?.targetId;
  for (let i = 0; i < 20; i += 1) {
    const target = (await list()).find((t) => t.id === id);
    if (target) return target;
    await sleep(200);
  }
  throw new Error(`创建标签失败：${url}`);
};

try {
  // 找到加载了新版代码的扩展（sidepanel.js 里应包含 sp-crop-done）
  const panels = (await list()).filter((t) => t.type === "page" && /sidepanel\.html/.test(t.url));
  let extensionId = null;
  for (const target of panels) {
    const probe = new Session(target.webSocketDebuggerUrl);
    await probe.open().catch(() => null);
    const hit = await probe.evaluate(`(async () => {
      try {
        const [js, crop] = await Promise.all([
          fetch(chrome.runtime.getURL('sidepanel/sidepanel.js')).then((r) => r.text()),
          fetch(chrome.runtime.getURL('content/crop.js')).then((r) => r.ok),
        ]);
        return js.includes('sp-crop-done') && crop ? chrome.runtime.id : null;
      } catch { return null; }
    })()`);
    probe.close();
    if (typeof hit === "string" && hit) { extensionId = hit; break; }
  }
  out.extensionId = extensionId;
  if (!extensionId) throw new Error("没找到加载了新版代码的扩展，请重新加载 edge/ 目录后重试");

  const fixtureTarget = await createTab(FIXTURE);
  const panelTarget = await createTab(`chrome-extension://${extensionId}/sidepanel/sidepanel.html?full=1`);
  const fixture = new Session(fixtureTarget.webSocketDebuggerUrl);
  const panel = new Session(panelTarget.webSocketDebuggerUrl);
  await fixture.open();
  await panel.open();
  await sleep(3500);

  out.checks.newCodeLoaded = await panel.evaluate(`typeof cropShot === 'function' && typeof annotateImage === 'function' && typeof selectArea === 'function'`);
  const viewport = await fixture.evaluate(`({ w: innerWidth, h: innerHeight, dpr: devicePixelRatio })`);
  out.viewport = viewport;

  // 1. 点截图按钮 -> 网页里应出现框选遮罩
  await panel.evaluate(`els.btnShot.click()`);
  let overlay = false;
  for (let i = 0; i < 25; i += 1) {
    overlay = Boolean(await fixture.evaluate(`!!document.getElementById('sp-area-crop-host')`));
    if (overlay) break;
    await sleep(200);
  }
  out.checks.overlayShown = overlay;
  if (!overlay) throw new Error("框选遮罩没有注入到网页");

  // 2. 拖出一个 300 x 180 的选区
  const x1 = 80, y1 = 90, x2 = 380, y2 = 270;
  const mouse = (type, x, y, buttons) => fixture.send("Input.dispatchMouseEvent", {
    type, x, y, button: "left", buttons, clickCount: 1,
  });
  await mouse("mouseMoved", x1, y1, 0);
  await mouse("mousePressed", x1, y1, 1);
  await mouse("mouseMoved", x2, y2, 1);
  await mouse("mouseReleased", x2, y2, 0);
  await sleep(3200);

  // 3. 裁剪完成后应弹出标绘窗口，画一个矩形再确认插入
  out.annotate = await panel.evaluate(`(() => ({
    open: els.annotateDialog.open,
    tools: [...els.annotateDialog.querySelectorAll('[data-tool]')].map((b) => b.textContent),
    colors: els.annotateDialog.querySelectorAll('[data-color]').length,
    box: (() => {
      globalThis.__spAnnotationBefore = els.annotateCanvas.toDataURL('image/png');
      const r = els.annotateCanvas.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    })(),
  }))()`);
  out.checks.annotateShown = out.annotate?.open === true
    && JSON.stringify(out.annotate?.tools) === JSON.stringify(["矩形", "圆圈", "画笔", "马赛克"])
    && out.annotate?.colors === 7;

  const box = out.annotate?.box;
  if (box?.w > 20 && box?.h > 20) {
    const a = { x: box.x + box.w * 0.2, y: box.y + box.h * 0.2 };
    const b = { x: box.x + box.w * 0.7, y: box.y + box.h * 0.7 };
    const paint = (type, p, buttons) => panel.send("Input.dispatchMouseEvent", {
      type, x: p.x, y: p.y, button: "left", buttons, clickCount: 1,
    });
    await paint("mouseMoved", a, 0);
    await paint("mousePressed", a, 1);
    await paint("mouseMoved", b, 1);
    await paint("mouseReleased", b, 0);
    await sleep(300);
    out.annotateAfter = await panel.evaluate(`({
      changed: els.annotateCanvas.toDataURL('image/png') !== globalThis.__spAnnotationBefore,
      undoEnabled: !els.annotateUndo.disabled,
    })`);
    out.checks.annotateDrawWorks = out.annotateAfter?.changed === true && out.annotateAfter?.undoEnabled === true;
  }
  await panel.evaluate(`els.annotateConfirm.click()`);
  await sleep(1200);

  out.afterCrop = await panel.evaluate(`(async () => {
    const images = state.attachments.filter((a) => a.kind === 'image');
    const last = images[images.length - 1];
    let size = null;
    if (last) {
      const img = new Image(); img.src = last.dataUrl; await img.decode();
      size = { w: img.naturalWidth, h: img.naturalHeight };
    }
    return { status: els.status.textContent, count: images.length, name: last?.name || null, size };
  })()`);
  const dpr = Number(viewport?.dpr) || 1;
  const size = out.afterCrop?.size;
  out.checks.attachmentAdded = out.afterCrop?.count === 1 && /框选截图/.test(out.afterCrop?.name || "");
  out.checks.statusOk = out.afterCrop?.status === "已插入框选截图";
  out.checks.cropSizeOk = Boolean(size) && Math.abs(size.w - 300 * dpr) <= 4 && Math.abs(size.h - 180 * dpr) <= 4;
  out.checks.overlayRemoved = !(await fixture.evaluate(`!!document.getElementById('sp-area-crop-host')`));

  // 4. 再点一次，按 Esc 取消：附件不应增加
  await panel.evaluate(`els.btnShot.click()`);
  await sleep(900);
  const cancelledOverlay = Boolean(await fixture.evaluate(`!!document.getElementById('sp-area-crop-host')`));
  await fixture.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await fixture.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await sleep(1200);
  out.afterCancel = await panel.evaluate(`({ status: els.status.textContent, count: state.attachments.filter((a) => a.kind === 'image').length })`);
  out.checks.cancelOk = cancelledOverlay && out.afterCancel?.count === 1 && out.afterCancel?.status === "已取消框选截图";

  await closeTarget(panelTarget.id);
  await closeTarget(fixtureTarget.id);
  fixture.close();
  panel.close();
} catch (err) {
  out.error = String(err?.message || err);
} finally {
  browser.close();
  try { server.close(); } catch { /* 端口被别的服务占用时没有监听中的 server */ }
}

console.log(JSON.stringify(out, null, 2));
const failed = Object.entries(out.checks).filter(([, value]) => value !== true);
if (out.error || failed.length) {
  console.error("FAILED:", out.error || failed.map(([key]) => key).join(", "));
  process.exitCode = 1;
} else {
  console.log("PASS: 框选截图全链路验证通过");
}
