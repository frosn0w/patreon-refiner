# Patreon Refiner

将 Patreon 页面 HTML 清洗并导出为 PDF 的本地/服务器工具。支持 macOS 本地直接运行与 ARM VPS Docker 部署两种模式。

## ✨ 主要功能

- **HTML 清洗**：自动提取帖子卡片，移除头像、按钮、多余元素
- **PDF 导出**：每张卡片独立分页，精准适配内容高度，无多余空白
- **图片压缩**：可调节质量，压缩后等待渲染完成再截图，避免图片空白
- **时效过滤**：按天数过滤过期帖子
- **分页模式**：自动分页 / 全长单页
- **macOS 字体优化**：本地运行时自动使用 PingFang SC，字重与渲染均已优化
- **ARM VPS 兼容**：自动调用系统 Chromium，完美支持 ARM64

---

## 🚀 使用方式

### 方式一：macOS 本地运行（无需 Docker）

**前置要求**：Node.js >= 20（`brew install node` 或 [nodejs.org](https://nodejs.org/)）

```bash
git clone https://github.com/frosn0w/Patreon_Refiner
cd patreon-refiner
chmod +x setup.sh
./setup.sh
```

脚本会自动安装依赖、下载 Playwright Chromium，并启动服务。  
访问地址：**http://localhost:3000**  
按 `Ctrl+C` 停止服务。

---

### 方式二：VPS 部署（Docker）

#### 首次安装

```bash
git clone https://github.com/frosn0w/Patreon_Refiner
cd patreon-refiner
chmod +x setup.sh
./setup.sh
```

#### 升级更新

在项目目录下直接重新执行：

```bash
./setup.sh
```

脚本会自动 `git pull` 拉取最新代码，重新构建镜像并重启容器，`.env` 保持不变。

---

## ⚙️ 配置密码

首次运行会自动生成 `.env`，默认密码为 `refiner_default_pwd_888`。  
**请务必修改：**

```bash
vi .env
```

```
ACCESS_TOKEN=你的自定义密码
```

修改后重新运行 `./setup.sh` 使其生效。

---

## 🛠 端口说明

| 模式 | 访问地址 |
|------|----------|
| macOS 本地 | http://localhost:3000 |
| VPS Docker | http://你的服务器IP:10030 |

VPS 端口可在 `docker-compose.yml` 中修改左侧的 `10030`。
