# dsh-shorts-wall

> 仓库：<https://github.com/imkingjh999/dsh-shorts-wall> · Issues 欢迎

[English](README_EN.md) | 中文

**竖屏短视频墙** —— 默认以**贴边竖栏**形态运行的 DeepSeek Harness（DSH）竖屏短视频插件：可切换为可拖拽/缩放浮窗，也能关闭后从右下角按钮唤回。双源：**YouTube Shorts** + **B站竖屏**，滚轮/键盘/按钮逐条切换，播完自动下一条，到尾自动续批。

> 仅供个人观看。全部走匿名公开接口与官方播放通道：不登录、不破解、不伪造签名。请遵守对应平台服务条款。

## 功能

### 双源轮播

顶栏 `YT` / `B站` chip 一键切换（记住选择），切换时提示「切换中…」。

|          | YouTube Shorts              | B站竖屏                                                      |
| -------- | --------------------------- | ------------------------------------------------------------ |
| 播放方式 | 官方 iframe embed           | **原生 mp4 `<video>`**（经宿主代理，Range 可拖进度）         |
| 内容获取 | 匿名搜索页（shorts 过滤器） | 匿名搜索 + **竖屏预检**（并发 view 确认 9:16，横版自动过滤） |
| 自动连播 | 播完事件 + 看门狗双保险     | 原生事件（最稳）                                             |
| 续批     | 关键词重搜去重追加          | 分页续批                                                     |

### 关键词体系

- **当前关键词以 chip 显示**在顶栏（B站按钮右侧），点击弹出**关键词选择列表**，点选即切换加载
- **「换一批视频」**：同关键词重新取一批新视频（不是换词）
- **⚙ 关键词面板**：
  - **预设词库**（单击整组替换、＋追加去重）：KPOP 直拍 / 服饰穿搭 / 特色服饰 / 宠物萌宠 / 性别视角 / 沙滩泳装 / 舞台演出
  - **自定义**：地区 + 关键词逐条添加
  - 行内编辑 / 上移 / 删除 / 恢复默认，两源词表各自独立持久化（localStorage）

### 播放体验

- **窗口模式**：标题栏「浮动」toggle 开启为浮窗（拖拽移动 / 四角悬停出缩放光标），关闭为贴边竖栏（默认）；两种模式共用同一份尺寸记忆，「最小化」按钮统一位于窗口右下角
- **老板键**：窗口标题栏会显示「老板键 Alt+S」；在浮窗或贴边状态下按 `Alt+S` 一键最小化，再按一次还原到最小化前的浮窗/贴边状态与尺寸，播放器保持挂载不重载；最小化期间自动暂停播放（YT embed 与 B站原生视频一致），还原后自动继续
- **播放连续**：浮窗/贴边/最小化切换时播放器**保持挂载**不重载
- **9:16 锁定**：播放器按卡片实际尺寸计算内接竖屏矩形，宽高都不超视口，竖屏满幅
- **切换**：滚轮（防抖）/ `↑↓` / `j`·`k` / ‹ › 按钮；iframe 上有滚轮捕获层（滚轮切换不被吞），单击临时交给播放器操作（6 秒后盖回）
- **自动连播**：播完 → 下一条；到尾 → 自动续批；坏内容自动跳过（连跳 3 条刹车）；YT 平台级不可用时显示「YouTube 暂不可用」横幅 + 一键切 B站
- **声音**：「声音开/已静音」文字按钮（不用 emoji），偏好记住；也可用组合键 `Alt+M` 快速静音/开启声音
- **开局遮罩**：封面 1 秒掀开、标题 2 秒隐藏（悬停可看），不挡画面
- **多语言**：UI 跟随 DSH 宿主语言（中文 / English），实时切换

## 项目状态

当前 `review_audit` 综合评分：**91 / 100**（2026-08-16，v1.0.3 审查基线）。

### 审查标准

评分使用 DSH 的 `review_audit` 作为客观基线，再抽样复核入口、代理边界、窗口状态模块和生命周期测试。`review_audit` 不是安全认证；分数只说明当前可度量的工程健康度。

**综合分计算**

- 8 个维度等权平均后四舍五入
- 及格线：**60 分**
- 本仓库发布目标：**≥ 90 分**
- 任一维度低于 40 分视为需要优先整改

**维度与扣分规则**

| 维度 | 当前分 | 计分口径 |
| --- | ---: | --- |
| 结构 | 88 | 基线 88；每个超过 500 行的源码文件扣 6 分，无目录结构扣 15 分 |
| 可维护性 | 90 | 基线 90；每个含遗留标记的文件扣 2 分，每个超大文件扣 4 分，每 40 行超过 120 字符的长行扣 1 分（最多扣 30） |
| 一致性 | 90 | 基线 90；每个混用 Tab/空格缩进的文件扣 8 分，项目级 Tab/空格混用另扣 15 分 |
| 健壮性 | 85 | 基线 85；每个空 `catch` 扣 5 分，每个调试输出残留扣 2 分 |
| 测试 | 100 | 测试全部通过时为 `60 + min(40, 测试文件数 × 10)`；测试失败记 20 分 |
| 文档 | 100 | README 40 分、LICENSE 25 分、`.gitignore` 20 分、README 内容完整性 15 分 |
| 性能 | 84 | 基线 85；每个超大文件扣 3 分，每 10 个依赖扣 4 分（最多扣 20），代码超过 2 万行另扣 15 分 |
| 安全 | 87 | 基线 90；按依赖数扣分（最多 25），调试残留与空 `catch` 另扣分；启用依赖审计时按高危/严重漏洞追加扣分 |

**人工复核最低要求**

- 运行 `pnpm typecheck`、`pnpm test`、`pnpm run build`
- 运行 `node tests/smoke-client.mjs` 与 `node tests/e2e-client.mjs`
- 抽样阅读宿主入口、媒体代理、浮窗状态、feed 生命周期和最近变更文件
- 确认无空 `catch`、无调试残留、无未解释的错误吞并
- 代理与权限边界必须有明确允许列表和失败路径

### 运行截图

| 浮窗模式 | 贴边模式 | 最小化 |
| --- | --- | --- |
| ![浮窗模式](docs/screenshot-float.png) | ![贴边模式](docs/screenshot-stick.png) | ![最小化](docs/screenshot-minimized.png) |

## 安装

前置：DSH ≥ 0.1.0 的 web profile。better-sidebar 不再需要。

```bash
dsh plugin --profile web add github:imkingjh999/dsh-shorts-wall
# 重启 dsh web，浏览器硬刷新（⌘⇧R / Ctrl+Shift+R）
```

页面右下角会出现「Shorts」浮窗入口。

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
    extraAllowSuffixes: [cdn.example.com] # 代理白名单追加域名后缀
    resolveProxyUrl: http://127.0.0.1:7890 # 可选：YouTube 抓取/缩略图走个人代理（HTTP CONNECT）
```

`resolveProxyUrl` 未配置时自动回退读 `HTTPS_PROXY` / `HTTP_PROXY`（等）环境变量（仅 `http://` 代理；Node fetch 不读这些变量，WSL 桌面环境常见）。无论哪种来源，**只有 YouTube 系域名**（youtube.com / ytimg.com 等）走隧道，B 站 API 与视频 CDN 始终直连。

## 架构

- **宿主半**（`src/index.ts`）：`POST /shorts/api/feed`（youtube shorts 搜索 · bilibili 竖屏搜索）+ `POST /shorts/api/play`（bilibili mp4 取流）+ `GET /shorts/proxy`（浏览器信任围栏 + CDN 白名单 + Range 直通）。旧 `/bilibili/*` 前缀保留兼容。
- **解析器**（`src/youtube.ts`、`src/bilibili-shorts.ts`）：YT 匿名搜索页 `shortsLockupViewModel`（兼容 `reelItemRenderer`）；B站搜索 + 并发 view 竖屏预检 + html5 mp4 playurl。
- **client 半**（`src/client/`）：浮窗渲染组件 + 三个行为 hook——`embed-events`（YT 播放器事件/看门狗）、`feed-state`（双源批次/续批/关键词）、`card-timers`（封面/标题时序）+ `i18n`（zh/en）。不再依赖 better-sidebar。

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
