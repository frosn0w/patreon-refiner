# Patreon Refiner

一个专为 ARM 架构 VPS 优化的内容清洗与 PDF 转换工具。采用流式鉴权、液态玻璃 UI 设计及 Playwright 渲染引擎。

## 🌟 初版更新
- **ARM 兼容**: 自动调用系统级 Chromium，完美支持 ARM64 架构。
- **中文字体支持**: 预装 Noto Sans CJK 与 Color Emoji，拒绝 PDF 方块。
- **资源优化**: 采用 `dumb-init` 管理进程，任务处理完即释放内存。
- **简易鉴权**: 环境变量控制的 Token 访问机制。
- **自动部署**: setup.sh