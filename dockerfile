# 使用 Node 官方轻量版
FROM node:20-slim

# 设置工作目录
WORKDIR /app

# 1. 核心步骤：安装系统依赖、ARM版 Chromium 以及中文字体
# fonts-noto-cjk: 解决中文方块
# fonts-noto-color-emoji: 解决 Emoji 缺失
# dumb-init: 解决容器内僵尸进程，确保资源彻底释放
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-noto-cjk \
    fonts-noto-color-emoji \
    fontconfig \
    dumb-init \
    && rm -rf /var/lib/apt/lists/*

# 2. 刷新字体缓存
RUN fc-cache -fv

# 3. 设置 Playwright 环境变量，跳过其自带浏览器的下载
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PLAYWRIGHT_BROWSERS_PATH=0
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

# 4. 拷贝项目文件
COPY package*.json ./
RUN npm install --production
COPY . .

# 5. 暴露端口
EXPOSE 3000

# 使用 dumb-init 启动，确保浏览器关闭后资源被彻底回收
ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "server.js"]