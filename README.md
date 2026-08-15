# dsh-shorts-wall

> 仓库：<https://github.com/imkingjh999/dsh-shorts-wall> · Issues 欢迎

[English](README_EN.md) | 中文

**竖屏短视频墙** —— 在 [dsh-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar) 侧边栏里刷竖屏短视频的 DeepSeek Harness（DSH）插件。双源：**YouTube Shorts** + **B站竖屏**，滚轮/键盘/按钮逐条切换，播完自动下一条，到尾自动续批。

> 仅供个人观看。全部走匿名公开接口与官方播放通道：不登录、不破解、不伪造签名。请遵守对应平台服务条款。

## 功能

### 双源轮播

顶栏 `YT` / `B站` chip 一键切换（记住选择），切换时提示「切换中…」。

| | YouTube Shorts | B站竖屏 |
|---|---|---|
| 播放方式 | 官方 iframe embed | **原生 mp4 `<video>`**（经宿主代理，Range 可拖进度） |
| 内容获取 | 匿名搜索页（shorts 过滤器） | 匿名搜索 + **竖屏预检**（并发 view 确认 9:16，横版自动过滤） |
| 自动连播 | 播完事件 + 看门狗双保险 | 原生事件（最稳） |
| 续批 | 关键词重搜去重追加 | 分页续批 |

### 关键词体系

- **当前关键词以 chip 显示**在顶栏（B站按钮右侧），点击弹出**关键词选择列表**，点选即切换加载
- **「换一批视频」**：同关键词重新取一批新视频（不是换词）
- **⚙ 关键词面板**：
  - **预设词库**（单击整组替换、＋追加去重）：KPOP 直拍 / 服饰穿搭 / 特色服饰 / 宠物萌宠 / 性别视角 / 沙滩泳装 / 舞台演出
  - **自定义**：逐条添加，或批量粘贴 `关键词 | 地区` 每行一条导入
  - 行内编辑 / 上移 / 删除 / 恢复默认，两源词表各自独立持久化（localStorage）

### 播放体验

- **9:16 锁定**：播放器按卡片实际尺寸计算内接竖屏矩形，宽高都不超视口，竖屏满幅
- **切换**：滚轮（防抖）/ `↑↓` / `j`·`k` / ‹ › 按钮；iframe 上有滚轮捕获层（滚轮切换不被吞），单击临时交给播放器操作（6 秒后盖回）
- **自动连播**：播完 → 下一条；到尾 → 自动续批；坏内容自动跳过（连跳 3 条刹车）；YT 平台级不可用时显示「YouTube 暂不可用」横幅 + 一键切 B站
- **声音**：「声音开/已静音」文字按钮（不用 emoji），偏好记住；静音时卡片上有提示 pill
- **开局遮罩**：封面 1 秒掀开、标题 2 秒隐藏（悬停可看），不挡画面
- **多语言**：UI 跟随 DSH 宿主语言（中文 / English），实时切换

## 安装

前置：DSH ≥ 0.1.0 的 web profile，且已安装 dsh-better-sidebar。

```bash
dsh plugin --profile web add dsh-better-sidebar        # 若未装
dsh plugin --profile web add github:imkingjh999/dsh-shorts-wall
# 重启 dsh web，浏览器硬刷新（⌘⇧R / Ctrl+Shift+R）
```

侧边栏 `+` 菜单里出现「Shorts」tab。

<details>
<summary>本地开发安装（link 方式）</summary>

```bash
cd ~/.dsh/profiles/web
pnpm add link:~/projects/dsh-plugins/dsh-shorts-wall
# package.json 的 dsh.profile.bundles 里追加 "dsh-shorts-wall"
pnpm install && pnpm run build   # 在插件目录
```
</details>

## 配置（可选）

profile 的 `cordis.patch.yml`：

```yaml
- id: shorts-wall
  config:
    extraAllowSuffixes: [cdn.example.com]   # 代理白名单追加域名后缀
    resolveProxyUrl: http://127.0.0.1:7890  # 可选：搜索抓取走个人代理（YT 搜索在部分网络不稳时用）
```

## 架构

- **宿主半**（`src/index.ts`）：`POST /shorts/api/feed`（youtube shorts 搜索 · bilibili 竖屏搜索）+ `POST /shorts/api/play`（bilibili mp4 取流）+ `GET /shorts/proxy`（浏览器信任围栏 + CDN 白名单 + Range 直通）。旧 `/bilibili/*` 前缀保留兼容。
- **解析器**（`src/youtube.ts`、`src/bilibili-shorts.ts`）：YT 匿名搜索页 `shortsLockupViewModel`（兼容 `reelItemRenderer`）；B站搜索 + 并发 view 竖屏预检 + html5 mp4 playurl。
- **client 半**（`src/client/`）：薄渲染组件 + 三个行为 hook——`embed-events`（YT 播放器事件/看门狗）、`feed-state`（双源批次/续批/关键词）、`card-timers`（封面/标题时序）+ `i18n`（zh/en）。运行时软依赖注入 better-sidebar（缺席时休眠，不拖垮 GUI）。

## 已知限制

- **YouTube 源**需要本机浏览器能访问 YouTube；平台风控（bot 验证墙）期间该源不可用——插件会显示明确提示并可一键切到 B站；B站源不受影响。
- 匿名档画质：YT 由官方 embed 决定；B站约 480p/720p（更高需登录，超出范围）。
- YT 匿名搜索无分页：每批约 15-30 条，续批靠同词重搜去重。

## 开发

```bash
pnpm install
pnpm test        # vitest：解析器 / 生命周期(jsdom) / i18n 词典
pnpm typecheck
pnpm run build   # tsdown：宿主 ESM + 双通道 client CJS 工厂
node tests/smoke-client.mjs && node tests/e2e-client.mjs   # 无头冒烟 + jsdom 渲染端到端
```

## License

MIT
