# 使用 Node.js 官方镜像作为基础
FROM node:20-slim

# 安装 Chromium 及其运行所需的系统依赖 (针对 ARM 适配)
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-ipafont-gothic \
    fonts-wqy-zenhei \
    fonts-thai-tlwg \
    fonts-kacst \
    fonts-freefont-ttf \
    libgbm-dev \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# 设置环境变量，强制 Playwright 使用系统安装的 Chromium
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV PLAYWRIGHT_CHROME_EXECUTABLE_PATH=/usr/bin/chromium

# 创建工作目录
WORKDIR /app

# 复制依赖配置并安装
COPY package.json ./
RUN npm install

# 复制核心代码
COPY server.js ./

# 暴露端口
EXPOSE 3000

# 启动程序
CMD ["npm", "start"]