# dsh-shorts-wall

> 仓库：<https://github.com/imkingjh999/dsh-shorts-wall> · Issues 欢迎

[English](README_EN.md) | 中文

在 [dsh-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar) 侧边栏里刷 **YouTube Shorts** 的 DeepSeek Harness（DSH）插件：全幅竖屏短视频轮播——滚轮/方向键/按钮逐条切换，播完自动下一条，搜索词可自定义（默认「美女 跳舞」）。

> 仅供个人观看使用。走 YouTube 匿名搜索页 + 官方 embed 播放器；不登录、不破解。请遵守 YouTube 服务条款。

## 功能

- **双源竖滑轮播**：顶栏 `YT` / `B站` 一键切换（记住选择）。
  - **YouTube Shorts**：多语言关键词轮换（⚙ 可自定义）；iframe 播放 + 滚轮捕获层 + 看门狗保底。
  - **B站竖屏**：与 YT 同款关键词词表（⚙ 面板增删改、轮换、记住；默认 美女舞蹈/美女翻唱/COS小姐姐），竖屏预检（并发 view 确认 9:16），**原生 mp4 直播**（原生播完/错误事件，自动连播最稳），分页续批。
- **9:16 锁定**：播放器容器按卡片实际尺寸计算内接竖屏矩形，满幅不变形
- **多语言**：UI 跟随 DSH 宿主语言（中文 / English），实时切换
- **关键词管理**：⚙ 面板支持 **预设词库**（KPOP 直拍 / 颜值小姐姐 / COS 扮装 / 沙滩泳装 / 舞台演出——单击整组替换、＋追加去重）与**自定义**（逐条添加 / 批量粘贴 `关键词 | 地区` 导入），两源各自持久化
- **滚轮/`↑↓`/`jk`/‹ ›** 切换；播完自动下一条；播放失败显示重试（不自动乱跳）
- **iframe 滚轮捕获层**：滚轮=切换；单击临时把控制权交给播放器（暂停/进度/音量），6 秒后自动盖回
- **多地区轮换**：「🌐 换一批」按词表循环（默认 🇨🇳沙滩 比基尼 / 🇯🇵ビーチ ビキニ / 🇰🇷beach bikini korea），按钮旁显示当前地区徽标；「⚙」面板可自行增删改地区+关键词（localStorage 持久化，可恢复默认）
- **声音**：顶栏 🔊 切换、记住偏好；静音时卡片上有「点此开启」提示
- **缩略图代理**：`/bilibili/proxy` 仅白名单 `ytimg.com`

## 安装

前置：DSH ≥ 0.1.0 的 web profile，且已安装 dsh-better-sidebar。

```bash
dsh plugin --profile web add dsh-better-sidebar   # 若未装
cd ~/.dsh/profiles/web
pnpm add link:~/projects/dsh-plugins/dsh-shorts-wall
# package.json 的 dsh.profile.bundles 里追加 "dsh-shorts-wall"
pnpm install
# 重启 dsh web，浏览器硬刷新（⌘⇧R）
```

侧边栏 `+` 菜单里出现「Shorts」tab。

## 配置（可选）

profile 的 `cordis.patch.yml`：

```yaml
- id: bilibili-sidebar
  config:
    extraAllowSuffixes: [cdn.example.com]  # 代理白名单追加域名后缀
    resolveProxyUrl: http://127.0.0.1:7890 # 可选：搜索抓取走个人代理（大陆网络访问 YouTube 时通时断；播放 iframe 仍走浏览器）
```

## 架构

- **宿主半**（`src/index.ts`）：`POST /bilibili/api/feed`（source=youtube，shorts 搜索）+ `GET /bilibili/proxy`（浏览器信任围栏 + ytimg 白名单）。
- **解析器**（`src/youtube.ts`）：匿名搜索页 `ytInitialData` 的 `shortsLockupViewModel`（兼容旧 `reelItemRenderer`）→ videoId/标题/竖屏缩略图。
- **client 半**（`src/client/index.tsx`）：运行时软依赖注入 better-sidebar（缺席时休眠）；9:16 自适应的 ShortsCard + 官方 iframe API（end→下一条，error→重试）+ 滚轮捕获层。

## 已知限制

- 需要本机能访问 YouTube（大陆网络时通时断；可配 `resolveProxyUrl` 走个人代理，播放仍需浏览器可达）。
- 匿名搜索无分页：每批约 15 条；刷完改个搜索词再来一批，或点重试。

## 开发

```bash
pnpm install
pnpm test        # vitest（shorts 解析 + 白名单）
pnpm typecheck
pnpm run build   # tsdown：宿主 ESM + 两个 client CJS 工厂
node tests/smoke-client.mjs && node tests/e2e-client.mjs
```

## License

MIT
