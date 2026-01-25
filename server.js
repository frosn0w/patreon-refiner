/**
 * PATREON REFINER // SINGLE-FILE ARCHITECTURE (V2.4 FINAL)
 * * [功能增强]:
 * 1. 动态 REMAIN_DAYS: UI 可调，默认为 0 (仅限当天)。
 * 2. 增强型分页选择: 全长单页 / 自动帖子分页 / 自定义特征分页。
 * 3. 跨平台兼容: 增加 ARM Ubuntu 系统浏览器路径识别。
 * 4. 逻辑一致性: 确保贝乐斯更名与标题查重功能不受分页模式影响。
 */

const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");
const { chromium } = require("playwright");
const { PDFDocument } = require("pdf-lib");
const { JSDOM } = require("jsdom");

// =============================================================================
// 1. 配置与样式 (CONFIGURATION)
// =============================================================================
const CONFIG = {
  DIRS: { OUT: path.join(__dirname, "public_outputs") },
  SERVER: { PORT: 3000, HOST: "0.0.0.0" },
  INJECTED_STYLES: (vars) => `
        body > *:not(#cleaned-main-content) { display: none !important; }
        :root { --global-borderWidth-thin: 0px !important; }
        #cleaned-main-content {
            display: flex !important; flex-direction: column; align-items: center; width: 100%;
            padding-top: ${vars["top-dist"]}; background-color: ${vars["page-bg"]};
        }
        .TAI-title a, a.TAI-title-link { 
            font-size: ${vars["title-font-size"]} !important; 
            font-weight: bold; text-decoration: none; color: inherit; cursor: text !important;
        }
        div[data-tag="post-card"] { background-color: ${vars["card-bg"]} !important; width: 100%; max-width: 800px; margin: 0 auto !important; border-bottom: none !important;}
        .TAI-separator { height: 8px; background-color: ${vars["page-bg"]}; width: 100%; }
        .TAI-body div div { height: auto !important; }
        .TAI-body h3 { font-size: ${vars["subtitle-font-size"]} !important; }
        .TAI-comment { border-radius: 8px !important; }
        .TAI-comment div div { font-size: ${vars["comment-font-size"]} !important; }
    `,
  DEFAULTS: {
    DATE_TAG: 'a[data-tag="post-published-at"]',
    STYLE_VARS: {
      "top-dist": "0px",
      "page-bg": "#f1f1f1",
      "card-bg": "#ffffff",
      "title-font-size": "24px",
      "subtitle-font-size": "18px",
      "comment-font-size": "15px",
    },
  },
};

// =============================================================================
// 2. 工具模块 (UTILS)
// =============================================================================
const Utils = {
  initEnvironment: () => {
    if (fs.existsSync(CONFIG.DIRS.OUT))
      fs.rmSync(CONFIG.DIRS.OUT, { recursive: true, force: true });
    fs.mkdirSync(CONFIG.DIRS.OUT);
  },
  generateFilename: () => {
    const now = new Date();
    return `BLS${String(now.getFullYear()).slice(-2)}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}.pdf`;
  },
  safeRemove: (el, upLevel = 0) => {
    let target = el;
    for (let i = 0; i < upLevel; i++) {
      if (target?.parentElement) target = target.parentElement;
      else break;
    }
    target?.remove();
  },
  cleanMatch: (str) => {
    if (!str) return "";
    return str
      .replace(/\s+/g, "")
      .replace(/[^\w\u4e00-\u9fa5]/g, "")
      .toLowerCase();
  },
  DateHelper: {
    checkIsExpired: (dateStr, remainDays) => {
      if (!dateStr) return false;
      const now = new Date();
      now.setHours(0, 0, 0, 0);
      let targetDate = Utils.DateHelper._parseDate(dateStr, now);
      const diffDays = Math.floor((now - targetDate) / (1000 * 60 * 60 * 24));
      return diffDays > remainDays;
    },
    formatDateText: (txt) => {
      if (!txt || /^\d{1,2}月\d{1,2}日$/.test(txt.trim())) return txt?.trim();
      const targetDate = Utils.DateHelper._parseDate(txt.trim(), new Date());
      return `${targetDate.getMonth() + 1}月${targetDate.getDate()}日`;
    },
    _parseDate: (s, now) => {
      let target = new Date(now);
      if (s.includes("小时前") || s.includes("分钟前") || s === "今天") {
      } else if (s === "昨天") target.setDate(now.getDate() - 1);
      else if (s.includes("天前"))
        target.setDate(now.getDate() - parseInt(s.match(/\d+/)?.[0] || 0));
      else {
        const m = s.match(/(\d{4})?年?(\d{1,2})月(\d{1,2})日/);
        if (m)
          target = new Date(
            m[1] ? parseInt(m[1]) : now.getFullYear(),
            parseInt(m[2]) - 1,
            parseInt(m[3]),
          );
      }
      return target;
    },
  },
};

// =============================================================================
// 3. 清洗与DOM处理模块 (REFINER)
// =============================================================================
const Refiner = {
  process: async (htmlContent, options = {}) => {
    const dom = new JSDOM(htmlContent);
    const { document } = dom.window;
    const cards = Array.from(
      document.querySelectorAll('div[data-tag="post-card"]'),
    );
    if (cards.length === 0) return htmlContent;

    const wrapper = document.createElement("div");
    wrapper.id = "cleaned-main-content";

    const remainDays = parseInt(options.remainDays) || 0;
    const paginationMode = options.paginationMode || "auto_card";
    const enableLinks = options.enableLinks === "true";

    // 第一阶段：分析边界 (Read & Compute)
    const cardMeta = new Map();
    let pageIdx = 0;

    // 预构造选择器
    let featureSelector = "";
    if (paginationMode === "custom") {
      const prefix =
        options.selAttr === "class" ? "." : options.selAttr === "id" ? "#" : "";
      featureSelector =
        (options.selTag || "div").trim() +
        (options.selAttr === "data"
          ? `[${options.selVal}]`
          : `${prefix}${options.selVal}`);
    }

    for (let i = 0; i < cards.length; i++) {
      const card = cards[i];
      const dateEl = card.querySelector(CONFIG.DEFAULTS.DATE_TAG);

      // 时效性过滤
      if (Utils.DateHelper.checkIsExpired(dateEl?.textContent, remainDays)) {
        cardMeta.set(card, { isExpired: true });
        continue;
      }

      // 分页逻辑计算
      if (i !== 0) {
        if (paginationMode === "auto_card") {
          pageIdx++; // 遇到新卡片即分页
        } else if (paginationMode === "custom") {
          const hasInner = !!card.querySelector(featureSelector);
          const isSelf = card.matches(featureSelector);
          let hasSibling = false;
          let prev = card.previousElementSibling;
          while (prev && prev.getAttribute("data-tag") !== "post-card") {
            if (
              prev.matches(featureSelector) ||
              prev.querySelector(featureSelector)
            ) {
              hasSibling = true;
              break;
            }
            prev = prev.previousElementSibling;
          }
          if (hasInner || isSelf || hasSibling) pageIdx++;
        }
        // single 模式下 pageIdx 保持 0
      }

      cardMeta.set(card, { isExpired: false, pageIndex: pageIdx });
    }

    // 第二阶段：写入执行 (Execute & Move)
    for (let i = 0; i < cards.length; i++) {
      const card = cards[i];
      const meta = cardMeta.get(card);
      if (!meta || meta.isExpired) continue;

      const targetPage = meta.pageIndex;
      card.setAttribute("data-pdf-page", targetPage);

      const dateEl = card.querySelector(CONFIG.DEFAULTS.DATE_TAG);
      if (dateEl)
        dateEl.textContent = Utils.DateHelper.formatDateText(
          dateEl.textContent,
        );

      card.removeAttribute("id");
      card.querySelectorAll("[id]").forEach((el) => el.removeAttribute("id"));

      if (!enableLinks) {
        card.querySelectorAll("a").forEach((a) => {
          a.removeAttribute("href");
          a.removeAttribute("onclick");
          a.style.pointerEvents = "none";
          a.style.cursor = "default";
        });
      }

      // 执行标记与清理
      Refiner._applyTagging(card);
      Refiner._applyCleaning(card);

      wrapper.appendChild(card);

      // 注入视觉分割线
      const sep = document.createElement("div");
      sep.className = "TAI-separator";
      sep.setAttribute("data-pdf-page", targetPage);
      wrapper.appendChild(sep);
    }

    document.body.innerHTML = "";
    document.body.appendChild(wrapper);
    const style = document.createElement("style");
    style.textContent = CONFIG.INJECTED_STYLES(CONFIG.DEFAULTS.STYLE_VARS);
    document.head.appendChild(style);

    const result = dom.serialize();
    dom.window.close();
    return result;
  },

  _applyTagging: (card) => {
    card.querySelectorAll("*").forEach((node) => {
      const txt = node.textContent.trim();
      const tag = node.tagName.toLowerCase();
      const dTag = node.dataset?.tag;

      // 功能 1: 贝乐斯更名
      if (
        tag === "button" &&
        dTag === "commenter-name" &&
        txt.includes("贝乐斯 ")
      ) {
        node.textContent = "贝乐斯";
      }

      // 功能 2: 标题重复查重与 TAI-body 标记
      if (tag === "button" && ["展开", "收起"].includes(txt)) {
        const targetBody = node.closest("div")?.parentElement?.parentElement;
        if (targetBody) {
          targetBody.classList.add("TAI-body");
          const titleEl =
            card.querySelector(".TAI-title") ||
            card.querySelector('span[data-tag="post-title"]');
          if (titleEl) {
            const cleanT = Utils.cleanMatch(titleEl.textContent);
            targetBody.querySelectorAll("h3, p").forEach((p) => {
              if (Utils.cleanMatch(p.textContent) === cleanT) p.remove();
            });
          }
        }
      }

      if (tag === "span" && node.getAttribute("data-tag") === "post-title") {
        node.classList.add("TAI-title");
        if (node.parentElement.tagName === "A")
          node.parentElement.classList.add("TAI-title-link");
      }
      if (tag === "div" && dTag === "comment-body")
        node.parentElement?.classList.add("TAI-comment");
    });
  },

  _applyCleaning: (card) => {
    card.querySelectorAll("*").forEach((node) => {
      const txt = node.textContent.trim();
      const tag = node.tagName.toLowerCase();
      const dTag = node.dataset?.tag;

      if (tag === "a" && dTag === "comment-avatar-wrapper")
        Utils.safeRemove(node, 2);
      if (tag === "img" && dTag === "comment-send-avatar")
        Utils.safeRemove(node, 7);
      if (
        tag === "div" &&
        ["chip-container", "post-details", "comment-actions"].includes(dTag)
      ) {
        Utils.safeRemove(node, dTag === "chip-container" ? 2 : 0);
      }
      if (
        tag === "button" &&
        (["展开", "收起", "加载更多留言", "加载回复", "收起回复"].includes(
          txt,
        ) ||
          dTag === "comment-more-actions")
      ) {
        node.remove();
      }
    });
  },
};

// =============================================================================
// 4. 转换模块 (CONVERTER)
// =============================================================================
const Converter = {
  execute: async (htmlContent, outputPath, options = {}) => {
    let browser = null;
    const qualityVal = parseFloat(options.quality) || 0.7;

    try {
      // 兼容 ARM Ubuntu 路径
      const isArmUbuntu =
        process.platform === "linux" && process.arch === "arm64";
      const ubuntuChrome = "/usr/bin/chromium-browser";

      browser = await chromium.launch({
        executablePath:
          isArmUbuntu && fs.existsSync(ubuntuChrome) ? ubuntuChrome : undefined,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu",
        ],
      });

      const context = await browser.newContext({
        viewport: { width: 414, height: 800 },
        deviceScaleFactor: 2,
      });
      const page = await context.newPage();
      await page.setContent(htmlContent, { waitUntil: "networkidle" });
      await page.waitForTimeout(500);

      // 图片压缩逻辑
      if (qualityVal < 1.0) {
        await page.evaluate(async (q) => {
          for (const img of document.querySelectorAll("img")) {
            try {
              const canvas = document.createElement("canvas");
              const ctx = canvas.getContext("2d");
              if (!img.complete || img.naturalWidth === 0) continue;
              canvas.width = img.naturalWidth;
              canvas.height = img.naturalHeight;
              ctx.fillStyle = "#FFFFFF";
              ctx.fillRect(0, 0, canvas.width, canvas.height);
              ctx.drawImage(img, 0, 0);
              img.src = canvas.toDataURL("image/jpeg", q);
            } catch (err) {}
          }
        }, qualityVal);
      }

      const totalPages = await page.evaluate(() => {
        const pages = Array.from(
          document.querySelectorAll("[data-pdf-page]"),
        ).map((el) => parseInt(el.getAttribute("data-pdf-page")) || 0);
        return pages.length > 0 ? Math.max(...pages) + 1 : 1;
      });

      const pdfBuffers = [];
      for (let i = 0; i < totalPages; i++) {
        const metrics = await page.evaluate((idx) => {
          const all = document.querySelectorAll("[data-pdf-page]");
          let hasContent = false;
          all.forEach((el) => {
            const isT = el.getAttribute("data-pdf-page") == String(idx);
            el.style.setProperty(
              "display",
              isT ? "block" : "none",
              "important",
            );
            if (isT) hasContent = true;
          });
          return { height: document.body.scrollHeight, hasContent };
        }, i);

        if (!metrics.hasContent || metrics.height < 20) continue;
        pdfBuffers.push(
          await page.pdf({
            width: "414px",
            height: `${metrics.height}px`,
            printBackground: true,
            pageRanges: "1",
          }),
        );
      }

      const mergedPdf = await PDFDocument.create();
      for (const buf of pdfBuffers) {
        const doc = await PDFDocument.load(buf);
        const [p] = await mergedPdf.copyPages(doc, [0]);
        mergedPdf.addPage(p);
      }
      fs.writeFileSync(outputPath, await mergedPdf.save());
      return { success: true };
    } catch (e) {
      console.error("CONVERSION_ERROR:", e);
      return { success: false, error: e.message };
    } finally {
      if (browser) await browser.close();
    }
  },
};

// =============================================================================
// 5. 服务器与界面 (FASTIFY & UI)
// =============================================================================
const startServer = () => {
  const fastify = require("fastify")({ logger: false });
  fastify.register(require("@fastify/static"), {
    root: CONFIG.DIRS.OUT,
    prefix: "/outputs/",
  });
  fastify.register(require("@fastify/multipart"), {
    limits: { fileSize: 150 * 1024 * 1024 },
  });

  fastify.get("/", async (req, reply) => {
    reply.type("text/html; charset=utf-8").send(FRONTEND_TEMPLATE);
  });

  fastify.post("/upload", async (req, reply) => {
    const tempPath = path.join(__dirname, `temp_${Date.now()}.html`);
    let options = {};
    try {
      const parts = req.parts();
      for await (const part of parts) {
        if (part.type === "file") {
          const w = fs.createWriteStream(tempPath);
          await new Promise((res) => part.file.pipe(w).on("finish", res));
        } else options[part.fieldname] = part.value;
      }
      const rawHtml = fs.readFileSync(tempPath, "utf8");
      const refinedHtml = await Refiner.process(rawHtml, options);
      const finalName = Utils.generateFilename();
      const outputPath = path.join(CONFIG.DIRS.OUT, finalName);
      const result = await Converter.execute(refinedHtml, outputPath, options);
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
      return result.success
        ? { success: true, url: `/outputs/${finalName}`, name: finalName }
        : result;
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  fastify
    .listen({ port: CONFIG.SERVER.PORT, host: CONFIG.SERVER.HOST })
    .then(() => {
      console.log(
        `> Patreon Refiner ONLINE @ http://localhost:${CONFIG.SERVER.PORT}`,
      );
      exec(
        `${process.platform === "win32" ? "start" : "open"} http://localhost:${CONFIG.SERVER.PORT}`,
      );
    });
};

const FRONTEND_TEMPLATE = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Patreon_Refiner // CONTROL_CENTER</title>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Share+Tech+Mono&display=swap');
        :root { --bg: #050505; --panel: #0a0a0a; --neon: #00f3ff; --neon-dim: rgba(0, 243, 255, 0.15); --alert: #ff0055; --success: #00ff66; --border: #333; }
        body { background-color: var(--bg); color: var(--neon); font-family: 'Share Tech Mono', monospace; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; background-image: linear-gradient(rgba(0, 243, 255, 0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(0, 243, 255, 0.03) 1px, transparent 1px); background-size: 20px 20px; }
        .interface { width: 540px; border: 1px solid var(--neon); background: var(--panel); box-shadow: 0 0 25px var(--neon-dim); }
        .header { background: var(--neon-dim); padding: 12px 20px; display: flex; justify-content: space-between; border-bottom: 1px solid var(--neon); letter-spacing: 2px; }
        .content { padding: 25px; }
        .control-group { margin-bottom: 20px; border: 1px solid var(--border); padding: 15px; background: rgba(255,255,255,0.02); position: relative; }
        .control-label { position: absolute; top: -9px; left: 10px; background: var(--panel); padding: 0 5px; font-size: 10px; color: #888; }
        input, select { background: transparent; border: none; color: #fff; font-family: inherit; font-size: 13px; outline: none; width: 100%; }
        .flex-row { display: flex; gap: 8px; align-items: center; }
        #console { background: #000; border: 1px solid #333; height: 140px; overflow-y: auto; padding: 10px; font-size: 11px; margin-bottom: 20px; color: #00ccff; }
        button { width: 100%; background: transparent; color: var(--neon); border: 1px solid var(--neon); padding: 15px; cursor: pointer; font-weight: bold; }
        button:hover { background: var(--neon); color: #000; }
        .download-zone { margin-top: 15px; display: none; }
    </style>
</head>
<body>
    <div class="interface">
        <div class="header"><span>PATREON_REFINER // V2.4 FINAL</span><div style="width:8px;height:8px;background:var(--neon);border-radius:50%"></div></div>
        <div class="content">
            <div class="flex-row" style="margin-bottom:20px;">
                <div class="control-group" style="flex:1; margin-bottom:0">
                    <span class="control-label">IMG_QUALITY [图片压缩权重 10-100]</span>
                    <input type="number" id="quality" value="70" min="10" max="100" 
                           style="text-align:center; font-size: 16px; color: #fff;">
                </div>
                <div class="control-group" style="flex:1; margin-bottom:0">
                    <span class="control-label">REMAIN_DAYS [保留天数]</span>
                    <input type="number" id="remainDays" value="0" min="0" 
                           style="text-align:center; font-size: 16px; color: var(--neon);">
                </div>
            </div>

            <div class="control-group">
                <span class="control-label">PAGINATION_STRATEGY [分页策略]</span>
                <select id="paginationMode" onchange="updateUI()">
                    <option value="auto_card">AUTO_CARD [按帖子自动分页]</option>
                    <option value="single">TOTAL_FLAT [全长单页模式]</option>
                    <option value="custom">CUSTOM_FEATURE [自定义特征模式]</option>
                </select>
            </div>

            <div id="feature-box" class="control-group" style="display:none">
                <span class="control-label">CUSTOM_SELECTOR [自定义特征]</span>
                <div class="flex-row">
                    <input type="text" id="selTag" value="div" style="width:20%; border-bottom:1px solid #333">
                    <select id="selAttr" style="width:30%">
                        <option value="class">CLASS (.)</option>
                        <option value="id">ID (#)</option>
                        <option value="data">DATA ([])</option>
                    </select>
                    <input type="text" id="selVal" value="TAI-separator" style="flex:1; border-bottom:1px solid #333">
                </div>
            </div>
            
            <div class="control-group">
                <span class="control-label">LINK_POLICY</span>
                <select id="enableLinks">
                    <option value="false">DEACTIVATE [链接失效化]</option>
                    <option value="true">KEEP_ACTIVE [保留原链接]</option>
                </select>
            </div>
            <div id="feature-box" class="control-group" style="display:none">
                <span class="control-label">CUSTOM_SELECTOR [自定义特征]</span>
                <div class="flex-row">
                    <input type="text" id="selTag" value="div" style="width:20%; border-bottom:1px solid #333">
                    <select id="selAttr" style="width:30%">
                        <option value="class">CLASS (.)</option>
                        <option value="id">ID (#)</option>
                        <option value="data">DATA ([])</option>
                    </select>
                    <input type="text" id="selVal" value="TAI-separator" style="flex:1; border-bottom:1px solid #333">
                </div>
            </div>
            <div id="console"></div>
            <input type="file" id="fi" accept=".html" style="display:none" onchange="run()">
            <button id="btn" onclick="document.getElementById('fi').click()">[ START_CONSTRUCTION ]</button>
            <div id="downloadZone" class="download-zone"><button id="dlBtn" onclick="executeDownload()" style="border-color:var(--success); color:var(--success)">[ DOWNLOAD_ARTIFACT ]</button></div>
        </div>
    </div>
    <script>
        const term = document.getElementById('console');
        let currentUrl = null, currentName = "";
        function updateUI() { document.getElementById('feature-box').style.display = (document.getElementById('paginationMode').value === 'custom') ? 'block' : 'none'; }
        function log(msg, type='') { const d = document.createElement('div'); d.className = type; d.innerHTML = "[" + new Date().toLocaleTimeString() + "] " + msg; term.appendChild(d); term.scrollTop = term.scrollHeight; }
        async function run() {
            const fi = document.getElementById('fi'); if(!fi.files[0]) return;
            document.getElementById('downloadZone').style.display = 'none';
            log("INITIATING: " + fi.files[0].name.toUpperCase());
            const fd = new FormData();
            fd.append('htmlFile', fi.files[0]);
            ['quality', 'remainDays', 'enableLinks', 'paginationMode', 'selTag', 'selAttr', 'selVal'].forEach(id => fd.append(id, document.getElementById(id).value));
            try {
                const res = await fetch('/upload', { method: 'POST', body: fd });
                const data = await res.json();
                if(data.success) {
                    currentUrl = data.url; currentName = data.name;
                    document.getElementById('downloadZone').style.display = 'block';
                    log("CONSTRUCTION SUCCESSFUL.", 'success');
                } else throw new Error(data.error);
            } catch(e) { log("ERROR: " + e.message, 'error'); }
        }
        function executeDownload() { if(!currentUrl) return; const a = document.createElement('a'); a.href = currentUrl; a.download = currentName; a.click(); }
        log("KERNEL READY.");
    </script>
</body>
</html>
`;

(function main() {
  Utils.initEnvironment();
  startServer();
})();
