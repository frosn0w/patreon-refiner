#!/bin/bash

# 定义颜色输出
GREEN='\033[0;32m'
NC='\033[0m'

echo -e "${GREEN}>>> 启动 Patreon Refiner 部署/更新程序...${NC}"

# 1. 检查并安装 Docker 依赖 (仅在缺失时执行)
if ! [ -x "$(command -v docker)" ]; then
    echo "安装 Docker..."
    curl -fsSL https://get.docker.com | sh
fi

if ! [ -x "$(command -v docker-compose)" ]; then
    echo "安装 Docker Compose..."
    sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
    sudo chmod +x /usr/local/bin/docker-compose
fi

# 2. 检查代码更新
if [ -d ".git" ]; then
    echo "检测到现有代码，正在拉取最新版本..."
    git pull
else
    echo "首次安装，跳过 Git 拉取。"
fi

# 3. 检查并生成示例 .env 文件
if [ ! -f ".env" ]; then
    echo "未检测到 .env 文件，正在创建默认配置..."
    echo "ACCESS_TOKEN=refiner_default_pwd_888" > .env
    echo -e "${GREEN}警告: 已创建默认密码 'refiner_default_pwd_888'，请稍后在 .env 中修改${NC}"
fi

# 4. 核心：构建并重启服务
# --build: 强制重新构建镜像以应用代码更改
# --remove-orphans: 清理旧版本可能残留的容器
echo "正在构建镜像并启动容器 (ARM 架构优化)..."
docker-compose up -d --build --remove-orphans

# 5. 清理虚悬镜像 (释放 ARM VPS 宝贵的磁盘空间)
echo "清理冗余镜像资源..."
docker image prune -f

echo -e "${GREEN}>>> 部署成功!${NC}"
echo -e "${GREEN}>>> 访问地址: http://你的服务器IP:10030${NC}"