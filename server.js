/**
 * PATREON REFINER // SPLIT ARCHITECTURE (V3.0)
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
const CONFIG = {
  DIRS: { OUT: path.join(__dirname, "public_outputs") },
  SERVER: { PORT: 3000, HOST: "0.0.0.0" },
  // 保持原有样式注入逻辑不变
  INJECTED_STYLES: (vars) => `
        body > *:not(#cleaned-main-content) { display: none !important; }
        :root { --global-borderWidth-thin: 0px !important; }
        #cleaned-main-content {
            display: flex !important; flex-direction: column; align-items: center; width: 100%;
            padding-top: ${vars["top-dist"]}; background-color: ${vars["page-bg"]};
        }
        .TAI-title a, a.TAI-title-link { 
            font-size: ${vars["title-font-size"]} !important; 
        }
        div[data-tag="post-card"] { background-color: ${vars["card-bg"]} !important; width: 100%; }
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
    // 简化后的核心判定逻辑
    checkIsExpired: (dateStr, remainDays) => {
      if (!dateStr) return false;
      const cleanStr = dateStr.trim();

      // 提取 mm 和 dd
      const match = cleanStr.match(/(\d{1,2})月(\d{1,2})日/);
      if (!match) return false; // 格式不符合的日期均保留

      const m = parseInt(match[1], 10);
      const d = parseInt(match[2], 10);

      const now = new Date();
      const curM = now.getMonth() + 1;
      const curYear = now.getFullYear();

      // 年份推断逻辑：如果帖子月份大于当前月份，说明是去年的帖子
      // (例如：现在1月，帖子是12月，则帖子是去年的)
      const year = m > curM ? curYear - 1 : curYear;

      // 构造日期对象进行纯天数计算
      const postDate = new Date(year, m - 1, d);
      const today = new Date(curYear, now.getMonth(), now.getDate()); // 归零时分秒

      const diffTime = today - postDate;
      const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

      return diffDays > remainDays;
    },
    // 仅用于格式化显示
    formatDateText: (txt) => {
      // 原样返回或简单清理，不再进行复杂重构，保持 DOM 清洗的纯粹性
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

    const wrapper = $('<div id="cleaned-main-content"></div>');
    let pageIdx = 0;

    cards.each((i, el) => {
      const card = $(el);
      const dateEl = card.find(CONFIG.DEFAULTS.DATE_TAG);
      const dateTxt = dateEl.text().trim();

      // 时效性过滤 (调用简化的日期逻辑)
      if (Utils.DateHelper.checkIsExpired(dateTxt, remainDays)) {
        return;
      }

      // 分页逻辑
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

      Refiner._applyTagging(card, $);
      Refiner._applyCleaning(card, $);

      wrapper.append(card);

      const sep = $('<div class="TAI-separator"></div>');
      sep.attr("data-pdf-page", targetPage);
      wrapper.append(sep);
    });

    $("body").empty().append(wrapper);
    $("head").append(
      `<style>${CONFIG.INJECTED_STYLES(CONFIG.DEFAULTS.STYLE_VARS)}</style>`,
    );

    return $.html();
  },

  // 样式注入与整理
  _applyTagging: (card, $) => {
    card.find("*").each((_, node) => {
      const $node = $(node);
      const txt = $node.text().trim();
      const tag = node.tagName.toLowerCase();
      const dTag = $node.attr("data-tag");

      if (tag === "button" && dTag === "commenter-name" && txt.includes("贝乐斯 ")) {
        $node.text("贝乐斯");
      }

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
              if (Utils.cleanMatch($p.text()) === cleanT) $p.remove();
            });
          }
        }
      }

      if (tag === "span" && dTag === "post-title") {
        $node.addClass("TAI-title");
        if ($node.parent().prop("tagName") === "A")
          $node.parent().addClass("TAI-title-link");
      }
      if (tag === "div" && dTag === "comment-body")
        $node.parent().addClass("TAI-comment");
    });
  },

  // 清除无关内容
  _applyCleaning: (card, $) => {
    card.find("*").each((_, node) => {
      const $node = $(node);
      const txt = $node.text().trim();
      const tag = node.tagName.toLowerCase();
      const dTag = $node.attr("data-tag");

      if (tag === "a" && dTag === "comment-avatar-wrapper") {
        $node.parent().parent().remove();
      } else if (tag === "img" && dTag === "comment-send-avatar") {
        let t = $node;
        for (let i = 0; i < 7; i++) t = t.parent();
        t.remove();
      } else if (
        tag === "div" &&
        ["chip-container", "post-details", "comment-actions"].includes(dTag)
      ) {
        if (dTag === "chip-container") {
          $node.parent().parent().remove();
        } else {
          $node.remove();
        }
      } else if (
        tag === "button" &&
        (["展开", "收起", "加载更多留言", "加载回复", "收起回复"].includes(txt) ||
          dTag === "comment-more-actions")
      ) {
        $node.remove();
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
      const isArmUbuntu = process.platform === "linux" && process.arch === "arm64";
      const ubuntuChrome = "/usr/bin/chromium";

      browser = await chromium.launch({
        executablePath: isArmUbuntu && fs.existsSync(ubuntuChrome) ? ubuntuChrome : undefined,
        args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
      });

      const context = await browser.newContext({
        viewport: { width: 414, height: 800 },
        deviceScaleFactor: 2,
      });
      const page = await context.newPage();
      await page.setContent(htmlContent, { waitUntil: "networkidle" });
      await page.waitForTimeout(500);

      // 压缩图像
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
            } catch (err) { }
          }
        }, qualityVal);
      }
      // 分页
      const totalPages = await page.evaluate(() => {
        const pages = Array.from(document.querySelectorAll("[data-pdf-page]"))
          .map((el) => parseInt(el.getAttribute("data-pdf-page")) || 0);
        return pages.length > 0 ? Math.max(...pages) + 1 : 1;
      });

      const pdfBuffers = [];
      for (let i = 0; i < totalPages; i++) {
        const metrics = await page.evaluate((idx) => {
          const all = document.querySelectorAll("[data-pdf-page]");
          let hasContent = false;
          all.forEach((el) => {
            const isT = el.getAttribute("data-pdf-page") == String(idx);
            el.style.setProperty("display", isT ? "block" : "none", "important");
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
      // 合并 PDF
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

  // 读取分离的 UI 文件
  const UI_PATH = path.join(__dirname, "ui.html");

  fastify.get("/", async (req, reply) => {
    if (fs.existsSync(UI_PATH)) {
      const html = fs.readFileSync(UI_PATH, "utf8");
      reply.type("text/html; charset=utf-8").send(html);
    } else {
      reply.send("Error: ui.html not found.");
    }
  });

  fastify.post("/upload", async (req, reply) => {
    const EXPECTED_TOKEN = process.env.ACCESS_TOKEN || "";
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

      // 1. 鉴权校验
      if (EXPECTED_TOKEN && options.password !== EXPECTED_TOKEN) {
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
        return { success: false, error: "鉴权失败：Access Token 无效" };
      }

      // 2. 读取临时文件内容并定义 rawHtml
      if (!fs.existsSync(tempPath)) {
        throw new Error("文件上传失败，未找到临时文件");
      }
      const rawHtml = fs.readFileSync(tempPath, "utf8"); // 确保这一行存在

      // 3. 进入处理队列
      const result = await globalQueue.add(async () => {
        // 这里的 rawHtml 现在已经有定义了
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