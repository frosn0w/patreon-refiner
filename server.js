/**
 * PATREON REFINER // SPLIT ARCHITECTURE (V3.0.1 - STABLE VIA VPS)
 * Server Side
 */

const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");
const { chromium } = require("playwright");
const { PDFDocument } = require("pdf-lib");
const cheerio = require("cheerio");

// =============================================================================
// 1. 配置与样式 (CONFIGURATION)
// =============================================================================
const GLOBAL_TOKEN = process.env.ACCESS_TOKEN;
const CONFIG = {
  DIRS: { OUT: path.join(__dirname, "public_outputs") },
  SERVER: { PORT: 3000, HOST: "0.0.0.0" },
  INJECTED_STYLES: (vars, useSysFont = false) => `
        body > *:not(#cleaned-main-content) { display: none !important; }
        :root { --global-borderWidth-thin: 0px !important; --global-borderWidth-thick: 0px !important; }
        ${useSysFont ? `
        * {
            font-family: "PingFang SC", "Helvetica Neue", Arial, sans-serif !important;
            font-weight: 400 !important;
        }
        h1, h2, h3, h4, h5, h6, strong, b, th {
            font-weight: 600 !important;
        }
        ` : `
        * {
            font-family: "Noto Sans CJK SC", "PingFang SC", "Helvetica Neue", Arial, sans-serif !important;
        }
        `}
        #cleaned-main-content {
            display: block !important;
            width: 100%;
            padding-top: ${vars["top-dist"]};
            background-color: ${vars["page-bg"]};
        }
        .TAI-separator { height: 8px; background-color: ${vars["page-bg"]}; width: 100%; }
        .TAI-title a { 
            font-size: ${vars["title-font-size"]} !important; 
        }
        div[data-tag="post-card"] { background-color: ${vars["card-bg"]} !important; width: 100%; }
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
  safeRemove: ($el, upLevel = 0) => {
    let target = $el;
    for (let i = 0; i < upLevel; i++) {
      const parent = target.parent();
      if (parent.length) target = parent;
      else break;
    }
    target.remove();
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
      const cleanStr = dateStr.trim();
      const match = cleanStr.match(/(\d{1,2})月(\d{1,2})日/);
      if (!match) return false;

      const m = parseInt(match[1], 10);
      const d = parseInt(match[2], 10);

      const now = new Date();
      const curM = now.getMonth() + 1;
      const curYear = now.getFullYear();
      const year = m > curM ? curYear - 1 : curYear;

      const postDate = new Date(year, m - 1, d);
      const today = new Date(curYear, now.getMonth(), now.getDate());

      const diffTime = today - postDate;
      const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

      return diffDays > remainDays;
    },
    formatDateText: (txt) => {
      return txt ? txt.trim() : "";
    }
  },
};

// =============================================================================
// 2.5 并发控制 (CONCURRENCY CONTROL)
// =============================================================================
class TaskQueue {
  constructor() {
    this.queue = [];
    this.running = false;
  }
  async add(task) {
    return new Promise((resolve, reject) => {
      this.queue.push({ task, resolve, reject });
      this.runNext();
    });
  }
  async runNext() {
    if (this.running || this.queue.length === 0) return;
    this.running = true;
    const { task, resolve, reject } = this.queue.shift();
    try {
      const result = await task();
      resolve(result);
    } catch (err) {
      reject(err);
    } finally {
      this.running = false;
      this.runNext();
    }
  }
}
const globalQueue = new TaskQueue();

let sharedBrowser = null;
let browserTimer = null;
const IDLE_TIMEOUT = 20 * 60 * 1000;

const getBrowser = async () => {
  if (sharedBrowser) {
    if (browserTimer) clearTimeout(browserTimer);
    resetBrowserTimer();
    return sharedBrowser;
  }

  const isArmUbuntu = process.platform === "linux" && process.arch === "arm64";
  const ubuntuChrome = "/usr/bin/chromium";
  const hasLocalChrome = fs.existsSync(ubuntuChrome);

  sharedBrowser = await chromium.launch({
    executablePath: (isArmUbuntu && hasLocalChrome) ? ubuntuChrome : undefined,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });

  console.log(`[${new Date().toLocaleTimeString()}] Browser Instance Started`);
  resetBrowserTimer();
  return sharedBrowser;
};

const resetBrowserTimer = () => {
  if (browserTimer) clearTimeout(browserTimer);
  browserTimer = setTimeout(async () => {
    if (sharedBrowser) {
      await sharedBrowser.close();
      sharedBrowser = null;
      console.log(`[${new Date().toLocaleTimeString()}] Browser Closed due to inactivity (20min idle)`);
    }
  }, IDLE_TIMEOUT);
};

// =============================================================================
// 3. 清洗与DOM处理模块 (REFINER)
// =============================================================================
const Refiner = {
  process: async (htmlContent, options = {}) => {
    const $ = cheerio.load(htmlContent);
    const cards = $('div[data-tag="post-card"]');
    if (cards.length === 0) return htmlContent;

    const remainDays = parseInt(options.remainDays) || 0;
    const paginationMode = options.paginationMode || "auto_card";
    const enableLinks = options.enableLinks === "true";
    const qualityVal = parseFloat(options.quality) || 0.7;

    // --- 在 DOM 清洗阶段提前在 Node 层压缩图片 ---
    if (qualityVal < 1.0) {
      let sharp;
      try {
        sharp = require("sharp");
      } catch (err) {
        console.error("⛔ [Fatal] 无法加载 sharp 模块:", err.message);
      }

      if (sharp) {
        const jpegQuality = Math.round(qualityVal * 100);
        const imgElements = $('img').toArray();
        let successCount = 0;

        for (const el of imgElements) {
          const $img = $(el);
          const src = $img.attr('src');
          if (src && src.startsWith('data:image')) {
            try {
              const base64Data = src.replace(/^data:image\/\w+;base64,/, "");
              const buf = Buffer.from(base64Data, "base64");
              const outBuf = await sharp(buf)
                .jpeg({ quality: jpegQuality, mozjpeg: false })
                .toBuffer();
              $img.attr('src', `data:image/jpeg;base64,${outBuf.toString("base64")}`);
              successCount++;
            } catch (err) {
              console.error(`⚠️ [Sharp Exception] 压缩 HTML 图片失败:`, err.message);
            }
          }
        }
        console.log(`ℹ️ [Sharp Worker] 节点层处理完毕，成功压缩 ${successCount} 张图片。`);
      }
    }

    const wrapper = $('<div id="cleaned-main-content"></div>');
    let pageIdx = 0;

    cards.each((i, el) => {
      const card = $(el);
      const dateEl = card.find(CONFIG.DEFAULTS.DATE_TAG);
      const dateTxt = dateEl.text().trim();

      if (Utils.DateHelper.checkIsExpired(dateTxt, remainDays)) {
        return;
      }

      if (i !== 0 && paginationMode === "auto_card") {
        pageIdx++;
      }

      const targetPage = pageIdx;
      card.attr("data-pdf-page", targetPage);

      if (dateEl.length) {
        dateEl.text(Utils.DateHelper.formatDateText(dateTxt));
      }

      card.removeAttr("id");
      card.find("[id]").removeAttr("id");

      if (!enableLinks) {
        card.find("a").each((_, a) => {
          const $a = $(a);
          $a.removeAttr("href");
          $a.removeAttr("onclick");
          $a.css({ "pointer-events": "none", cursor: "default" });
        });
      }

      Refiner._refineCard(card, $);
      wrapper.append(card);

      const sep = $('<div class="TAI-separator"></div>');
      sep.attr("data-pdf-page", targetPage);
      wrapper.append(sep);
    });

    $("body").empty().append(wrapper);
    const useSysFont = process.platform === "darwin";
    $("head").append(
      `<style>${CONFIG.INJECTED_STYLES(CONFIG.DEFAULTS.STYLE_VARS, useSysFont)}</style>`,
    );

    return $.html();
  },

  _refineCard: (card, $) => {
    card.find("*").each((_, node) => {
      const $node = $(node);
      const txt = $node.text().trim();
      const dTag = $node.attr("data-tag");
      const tag = node.tagName.toLowerCase();

      if (tag === "span" && dTag === "post-title") {
        $node.addClass("TAI-title");
      }
      if (tag === "div" && dTag === "comment-body")
        $node.parent().addClass("TAI-comment");
      if (tag === "button" && ["展开", "收起"].includes(txt)) {
        const targetBody = $node.closest("div").parent().parent();
        if (targetBody.length) {
          targetBody.addClass("TAI-body");
          const titleEl = card.find(".TAI-title").length > 0
            ? card.find(".TAI-title")
            : card.find('span[data-tag="post-title"]');
          if (titleEl.length) {
            const cleanT = Utils.cleanMatch(titleEl.text());
            targetBody.find("h3, p").each((_, p) => {
              const $p = $(p);
              if (Utils.cleanMatch($p.text()) === cleanT) Utils.safeRemove($p);
            });
          }
        }
      }
      if (tag === "button" && dTag === "commenter-name" && txt.includes("贝乐斯 ")) {
        $node.text("贝乐斯");
      } 
      if (tag === "a" && dTag === "comment-avatar-wrapper") {
        Utils.safeRemove($node, 2);
      } else if (tag === "img" && dTag === "comment-send-avatar") {
        Utils.safeRemove($node, 7);
      } else if (
        tag === "div" &&
        ["chip-container", "post-details", "comment-actions"].includes(dTag)
      ) {
        if (dTag === "chip-container") {
          Utils.safeRemove($node, 2);
        } else {
          Utils.safeRemove($node);
        }
      } else if (
        tag === "button" &&
        (["展开", "收起", "加载更多留言", "加载回复", "收起回复"].includes(txt) ||
          dTag === "comment-more-actions")
      ) {
        Utils.safeRemove($node);
      }
    });
  },
};

// =============================================================================
// 4. 转换模块 (CONVERTER)
// =============================================================================
const Converter = {
  execute: async (htmlContent, outputPath, options = {}) => {
    let context = null;

    try {
      const browser = await getBrowser();
      context = await browser.newContext({
        viewport: { width: 414, height: 800 },
        deviceScaleFactor: 2,
      });
      const page = await context.newPage();
      
      // 此时得到的 htmlContent 已经是内部被 Sharp 压缩过图源的 HTML
      await page.setContent(htmlContent, { waitUntil: "networkidle" });
      await page.waitForTimeout(500);

      const isSinglePage = options.paginationMode === "single";
      const mergedPdf = await PDFDocument.create(); 

      if (isSinglePage) {
        const totalHeight = await page.evaluate(() => document.body.scrollHeight);
        const buf = await page.pdf({
          width: "414px",
          height: `${totalHeight}px`,
          printBackground: true,
        });
        const doc = await PDFDocument.load(buf);
        const [p] = await mergedPdf.copyPages(doc, [0]);
        mergedPdf.addPage(p);
      } else {
        const pagesCount = await page.evaluate(() => document.querySelectorAll('.TAI-separator').length);

        for (let i = 0; i < pagesCount; i++) {
          await page.evaluate((idx) => {
            const allCards = document.querySelectorAll('[data-pdf-page]');
            allCards.forEach(el => {
              el.style.display = (el.getAttribute('data-pdf-page') == idx) ? "block" : "none";
            });
          }, i);
          
          await page.waitForTimeout(60);
          const height = await page.evaluate(() => {
            const rect = document.getElementById('cleaned-main-content').getBoundingClientRect();
            return Math.ceil(rect.height);
          });

          if (height < 20) continue;
          
          const pageBuf = await page.pdf({
            width: "414px",
            height: `${height}px`,
            printBackground: true,
            pageRanges: "1",
            margin: { top: 0, right: 0, bottom: 0, left: 0 }
          });

          const tempDoc = await PDFDocument.load(pageBuf);
          const [copiedPage] = await mergedPdf.copyPages(tempDoc, [0]);
          mergedPdf.addPage(copiedPage);
        }
      }

      const finalPdfBytes = await mergedPdf.save();
      await fs.promises.writeFile(outputPath, finalPdfBytes);

      return { success: true };
    } catch (e) {
      console.error("CONVERSION_ERROR:", e);
      return { success: false, error: e.message };
    } finally {
      if (context) await context.close();
      resetBrowserTimer();
    }
  },
};

// =============================================================================
// 5. 服务器 (FASTIFY)
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

  const UI_PATH = path.join(__dirname, "ui.html");

  fastify.get("/", async (req, reply) => {
    if (fs.existsSync(UI_PATH)) {
      const html = fs.readFileSync(UI_PATH, "utf8");
      reply.type("text/html; charset=utf-8").send(html);
    } else {
      reply.send("Error: ui.html not found.");
    }
  });

  fastify.addHook('onRequest', async (request, reply) => {
    if (request.url === '/upload' && request.method === 'POST') {
      const token = request.headers['x-access-token'];
      if (!token || token !== GLOBAL_TOKEN) {
        reply.code(401).send({ success: false, error: "鉴权失败：Token 无效或缺失" });
        return reply;
      }
    }
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
        } else {
          options[part.fieldname] = part.value;
        }
      }

      if (!fs.existsSync(tempPath)) {
        throw new Error("文件上传失败，未找到临时文件");
      }
      const rawHtml = fs.readFileSync(tempPath, "utf8");

      const result = await globalQueue.add(async () => {
        const refinedHtml = await Refiner.process(rawHtml, options);
        const finalName = Utils.generateFilename();
        const outputPath = path.join(CONFIG.DIRS.OUT, finalName);
        const convResult = await Converter.execute(refinedHtml, outputPath, options);

        return convResult.success
          ? { success: true, url: `/outputs/${finalName}`, name: finalName }
          : convResult;
      });

      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
      return result;

    } catch (e) {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
      console.error("Upload Error:", e);
      return { success: false, error: e.message };
    }
  });

  fastify.listen({ port: CONFIG.SERVER.PORT, host: CONFIG.SERVER.HOST }).then(() => {
    console.log(`> Patreon Refiner ONLINE @ http://localhost:${CONFIG.SERVER.PORT}`);
  });
};

(function main() {
  Utils.initEnvironment();
  startServer();
})();