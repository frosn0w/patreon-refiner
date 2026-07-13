#!/bin/bash
set -e

# 切换到脚本所在目录，确保无论从哪里执行都能找到 package.json / .env 等文件
cd "$(dirname "$0")"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

info()  { echo -e "${GREEN}>>> $1${NC}"; }
warn()  { echo -e "${YELLOW}>>> $1${NC}"; }
error() { echo -e "${RED}>>> [错误] $1${NC}"; exit 1; }

# ==============================================================================
# 检测运行环境
# ==============================================================================
if [ "$(uname -s)" = "Darwin" ]; then
    MODE="local"
    warn "检测到 macOS，以本地模式运行（无需 Docker）"
else
    MODE="vps"
    warn "检测到 Linux，以 VPS 部署模式运行"
fi

# ==============================================================================
# .env 文件检查（两种模式共用）
# ==============================================================================
if [ ! -f ".env" ]; then
    info "未检测到 .env，正在生成默认配置..."
    echo "ACCESS_TOKEN=refiner_default_pwd_888" > .env
    warn "已生成默认密码 'refiner_default_pwd_888'，请在 .env 中修改后重新运行"
fi

# ==============================================================================
# macOS 本地模式：直接用 Node.js 运行，无需 Docker
# ==============================================================================
if [ "$MODE" = "local" ]; then

    # 检查 Node.js
    if ! command -v node &>/dev/null; then
        error "未找到 Node.js，请先安装：\n  brew install node\n  或前往 https://nodejs.org/"
    fi
    NODE_MAJOR=$(node -e "console.log(parseInt(process.versions.node))")
    if [ "$NODE_MAJOR" -lt 20 ]; then
        error "Node.js 版本需 >= 20，当前为 $(node -v)，请升级后重试"
    fi

    # 安装 / 更新 npm 依赖
    info "安装依赖..."
    npm install

    # 安装 Playwright Chromium（首次或缺失时）
    info "检查 Playwright Chromium..."
    npx playwright install chromium 2>/dev/null || true

    # 加载 .env 并前台启动（Ctrl+C 停止）
    set -a; source .env; set +a
    info "启动服务，访问地址: http://localhost:3000"
    warn "按 Ctrl+C 停止服务"
    node server.js
    exit 0
fi

# ==============================================================================
# VPS 模式：Docker 部署，支持首次安装和升级
# ==============================================================================

# 1. 安装 Docker（首次）
if ! command -v docker &>/dev/null; then
    info "安装 Docker..."
    curl -fsSL https://get.docker.com | sh
fi

# 2. 确定 docker compose 命令（V2 优先，回退到 V1）
if docker compose version &>/dev/null 2>&1; then
    COMPOSE="docker compose"
elif command -v docker-compose &>/dev/null; then
    COMPOSE="docker-compose"
else
    info "安装 Docker Compose..."
    sudo curl -fsSL "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" \
        -o /usr/local/bin/docker-compose
    sudo chmod +x /usr/local/bin/docker-compose
    COMPOSE="docker-compose"
fi

# 3. 拉取最新代码（升级时）
if [ -d ".git" ]; then
    info "拉取最新代码..."
    git pull
fi

# 4. 构建镜像并启动（首次安装 & 升级均适用）
info "构建镜像并启动容器..."
$COMPOSE up -d --build --remove-orphans

# 5. 清理旧镜像（释放磁盘空间）
info "清理冗余镜像..."
docker image prune -f

# 6. 输出访问地址
SERVER_IP=$(curl -s --max-time 5 ifconfig.me 2>/dev/null \
    || curl -s --max-time 5 ipinfo.io/ip 2>/dev/null \
    || echo "YOUR_SERVER_IP")
info "部署成功！访问地址: http://${SERVER_IP}:10030"