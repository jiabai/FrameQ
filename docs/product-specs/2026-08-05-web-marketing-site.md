# FrameQ Web Marketing Site Spec

## Status

Draft。本 spec 定义 FrameQ 公开宣传独立站的产品边界、信息架构、技术栈、设计系统迁移、内容安全约束和验收门禁。它是 [`docs/design-docs/web-marketing-site-design.md`](../design-docs/web-marketing-site-design.md) 的下位实现规格：当二者冲突时，以 design-doc 与 `docs/DESIGN.md` 为上位约束，以本 spec 锁定具体技术决策与页面清单。

## Background

FrameQ 当前公开面只有 GitHub 仓库、release notes 和 server 端登录/dashboard 页。新访客没有一条受控路径去理解"FrameQ 是什么、为什么本地优先值得信任、怎么下载、支持哪些平台与视频来源"。[`docs/design-docs/web-marketing-site-design.md`](../design-docs/web-marketing-site-design.md) 已 Draft 定义了产品/体验/内容安全规范，[`design-system/`](../../design-system/) 提供了 token 种子与视觉参考，但二者均非运行时代码——宣传站目前是 0 实现。

本 spec 启动宣传站的首次实现：独立顶级目录 `site/`，静态优先技术栈 Astro，OKLCH token 系统从 `design-system/globals.css` 迁移升级，首版交付首页、下载页、隐私页三页。

## Goals

- 在仓库根目录新建 `site/` 顶级目录作为宣传站工程，与 `app/`（桌面客户端）、`server/`（后端）、`worker/`（Python worker）、`design-system/`（reference-only 设计参考）相互独立，无运行时跨目录 import。
- 采用 Astro 作为技术栈，静态站点生成（SSG）优先，零 JS by default，仅在必要交互组件（如下载平台检测、移动端导航开关）使用 islands hydration。
- 首版交付三个页面：首页 `/`、下载页 `/download`、隐私页 `/privacy`。首页信息架构对齐 design-doc § 信息架构：首屏、工作流、本地优先信任边界、输出物、支持来源、下载入口、FAQ。
- 建立 OKLCH 三层 token 系统（primitive → semantic → component，对齐 `ckm:design-system` 规范），从 `design-system/globals.css` 的 hex token（`#0066cc` 等）迁移升级，作为 `site/src/styles/tokens.css` 的正式 token；`design-system/globals.css` 保持 reference-only 不变。
- 视觉系统遵循 Hallmark 反 AI-slop 规范：OKLCH 颜色、4pt 间距、2+1 字体配对、8 状态交互组件、`prefers-reduced-motion` 支持、移动端 320/375/414/768 px 全部可读无横向滚动。
- 公开文案与 FrameQ 产品事实一致：本地优先隐私边界、ASR 模型首启按需下载（不内置安装包）、可选云端 AI 整理需用户确认、支持的视频来源范围与已知限制。
- 下载页 release metadata 来自 GitHub Releases 真实产物，不硬编码猜测值；对应平台安装包未验证前不宣称支持。
- 隐私页用普通语言解释数据流，与 [`docs/SECURITY.md`](../SECURITY.md) 和产品文档一致。

## Non-goals

- 不改变桌面客户端 `app/`、Tauri IPC 契约、worker、ASR 路径、server 后端、Prisma schema、store 或 LLM 配置。宣传站是纯静态前端，不调用任何 server API。
- 不在宣传站加载 analytics、追踪脚本、外部嵌入或第三方字体 CDN，直到独立的隐私决策与 cookie 同意流程落地。本 spec 显式排除 Google Analytics、Plausible、Cloudflare Web Analytics、Hotjar、Intercom、Drift、Tawk.to 等所有追踪/聊天嵌入。
- 不实现账号登录、激活码兑换、支付、dashboard 复刻或任何 server-side 交互。这些能力属于 `server/` 的 `/login` `/dashboard` `/admin` 面，宣传站只链接到它们，不实现它们。
- 不复刻桌面客户端 UI（macOS sheet、task monitor、高密度工作区）。宣传站是叙事性公开面，不是桌面端网页版。
- 不在首版实现博客、changelog 自动同步、多语言切换、暗色模式切换、RSS、邮件订阅、社区论坛或文档站。这些是后续迭代。
- 不在首版实现真实产品截图的自动化采集（截图来自手动截取并放入 `site/public/screenshots/`，标注版本与来源）。
- 不分配版本号。版本号（如 `v1.0.0-marketing`）由独立 release-prep plan 决定。
- 不创建新的 design-doc。本 spec 引用的 design-doc 已存在；视觉系统细节由 `site/src/styles/tokens.css` 和 Hallmark 输出承载。

## Directory and Tech Stack

### 目录放置

- 宣传站代码位于仓库根目录 `site/`，与 `app/` `server/` `worker/` `design-system/` `docs/` `scripts/` `deploy/` 并列。
- `site/` 是独立 npm 工程，拥有自己的 `package.json`、`astro.config.mjs`、`tsconfig.json`，不依赖 `app/` 或 `server/` 的依赖。
- `site/` 不从 `app/` `server/` `worker/` 任何目录 import 运行时代码。复用的设计资产（token、banner）通过构建期拷贝或手动迁移到 `site/`，不在运行时跨目录引用。
- `design-system/` 维持 reference-only 状态不变；`design-system/globals.css` 仍不被任何运行时加载。

### 预期 `site/` 结构

```
site/
├── src/
│   ├── pages/
│   │   ├── index.astro           # 首页
│   │   ├── download.astro        # 下载页
│   │   └── privacy.astro         # 隐私页
│   ├── components/
│   │   ├── Header.astro
│   │   ├── Hero.astro
│   │   ├── WorkflowSteps.astro
│   │   ├── TrustBoundary.astro
│   │   ├── OutputPreview.astro
│   │   ├── DownloadCard.astro
│   │   ├── FAQ.astro
│   │   ├── Footer.astro
│   │   └── LanguageHint.astro    # 仅提示中文为主，首版不切换
│   ├── content/
│   │   ├── faq/                  # FAQ markdown 条目
│   │   └── release-notes/        # 从 docs/releases/ 同步的摘要
│   ├── styles/
│   │   └── tokens.css            # OKLCH 三层 token 系统
│   └── consts.ts                 # 站点常量（产品名、品类、信任语、下载源 URL）
├── public/
│   ├── screenshots/              # 真实产品截图（标注版本）
│   ├── og/                        # Open Graph 图（复用 design-system/banners/og/）
│   └── favicon.svg
├── astro.config.mjs
├── package.json
├── tsconfig.json
└── README.md
```

### 技术栈

- **Astro**（最新稳定版）作为站点框架。SSG 模式，输出纯静态 HTML/CSS/最小 JS。
- **不使用** React/Vue/Svelte 作为主框架；交互组件用 Astro 原生 `<script>` 或 islands（仅当确实需要客户端状态时）。
- **不使用** Tailwind CSS。token 系统通过 CSS 自定义属性（`var(--color-*)`）直接消费，对齐 Hallmark token 规范与 `design-system/globals.css` 既有约定。
- **不使用** Next.js、Gatsby、SvelteKit、Remix 等替代框架。
- 字体：首版使用系统字体栈 + 一个开源 display 字体（具体字体在 ExecPlan 的 Hallmark theme 阶段确定，候选：Inter / Geist Mono / IBM Plex Sans / Source Han Sans），不加载 Google Fonts CDN；字体文件自托管在 `site/public/fonts/` 或使用 `@fontsource/*` npm 包。
- 部署目标：静态托管（GitHub Pages / Cloudflare Pages / Netlify 任一，在 ExecPlan 部署阶段确定），不依赖 server 端运行时。

## Design System Migration

- 从 `design-system/globals.css` 的 hex token（`#0066cc` `#1d1d1f` `#e5e5e5` 等）迁移到 `site/src/styles/tokens.css` 的 OKLCH 三层 token 系统。
- `#0066cc`（FrameQ 蓝）转换为 OKLCH 锚点（约 `oklch(56% 0.18 254)`），作为 `--color-accent` primitive token。
- 三层结构：
  - **Primitive** — 原始 OKLCH 值（`--color-blue-600: oklch(56% 0.18 254)`）。
  - **Semantic** — 语义别名（`--color-accent: var(--color-blue-600)` `--color-paper: var(--color-neutral-0)` `--color-ink: var(--color-neutral-900)`）。
  - **Component** — 组件级 token（`--button-bg: var(--color-accent)` `--hero-title-color: var(--color-ink)`）。
- `design-system/globals.css` 保持不变，仍作为 reference-only 历史种子。
- Hallmark 的 `tokens.css` 输出与本 spec 的 `site/src/styles/tokens.css` 是同一文件；Hallmark 在 Build 阶段直接产出此文件。

## Information Architecture

首版三页结构对齐 [`docs/design-docs/web-marketing-site-design.md`](../design-docs/web-marketing-site-design.md) § 信息架构。

### 首页 `/`

按 DOM 顺序的 section 清单（最终宏结构在 ExecPlan 的 Hallmark macrostructure 阶段确定，候选：Stat-Led / Workbench / Marquee Hero）：

1. **Header** — 品牌 `FrameQ`、导航链接（首页/下载/隐私/GitHub）、主下载 CTA。
2. **Hero** — 产品名、品类描述 `视频转文字与 AI 整理桌面工具`、本地优先信任语、主下载按钮、次级"查看工作流"按钮、真实产品截图或忠实产品视觉。
3. **Workflow** — 4-5 个紧凑步骤：粘贴公开链接 → 提取本地媒体 → 本地转写 → 可选 AI 总结/灵感生成。每步带清晰状态标签。
4. **Trust Boundary** — 三栏：本地数据（视频/音频/文字稿）、可选云端数据（用户确认后的 AI 整理 LLM 调用）、绝不包含的数据（私有视频访问、Cookie 登录、安装包内置 ASR 权重/LLM key）。
5. **Output Preview** — 文字稿、Markdown 总结、Mermaid 思维导图文件、AI 灵感结果示例（标注为示例，非真实用户内容）。
6. **Supported Sources** — 当前支持的公开链接范围（抖音/B站/小红书/YouTube 公开视频）与已知限制（私有/会员/年龄限制视频不支持）。
7. **Download Entry** — 平台可用性提示（macOS Apple Silicon / macOS Intel / Windows）、版本号、首启模型下载说明、跳转 `/download` 的 CTA。
8. **FAQ** — 模型缓存、日志、网络失败、公开视频限制、联系路径。首版用简单列表或 accordion（问题足够简短时）。
9. **Footer** — release notes 入口、隐私页、GitHub 仓库、支持联系方式。

### 下载页 `/download`

- 仅展示真实存在的发行产物：macOS Apple Silicon、macOS Intel、Windows。对应平台未验证前不显示。
- 每个平台卡片包含：平台名、架构、版本号、文件类型、文件大小提示、下载链接（指向 GitHub Releases 真实 URL）、安装说明链接。
- 清楚说明 ASR 模型在首启按需下载，不内置在安装包中。
- release notes 摘要来自 `docs/releases/vX.Y.Z.md`，通过 content collections 同步。
- 不展示虚假版本号、虚假文件大小或未发布的平台。

### 隐私页 `/privacy`

- 用普通语言解释数据流：哪些数据留在本地（视频/音频/文字稿/模型缓存）、哪些数据可能离开本机（用户确认后的 AI 整理 LLM 调用，仅 prompt 文本）、何时需要用户确认。
- 与 [`docs/SECURITY.md`](../SECURITY.md) 和 [`docs/design-docs/core-beliefs.md`](../design-docs/core-beliefs.md) 一致。
- 说明不收集 analytics、不加载追踪脚本、不嵌入第三方内容（首版）。
- 说明激活码、账号、AI Credit 等服务端能力的隐私边界（由 server 端策略承载，宣传站仅描述）。

## Content Safety and Product Truth

对齐 [AGENTS.md](../../AGENTS.md) § 对外分发补充规则与 [docs/design-docs/web-marketing-site-design.md](../design-docs/web-marketing-site-design.md) § 内容安全与产品事实：

- 不得暗示 FrameQ 能访问私有、会员、登录、年龄限制或验证码保护的视频。
- 不得暗示安装包内置 ASR 权重、云端 LLM key、云端 LLM 模型或用户私有配置。
- 对应平台的安装包经过验证前，不得宣称该平台已支持。
- 公开文案必须区分本地转写与可选云端 AI 整理。
- 如展示 AI 生成结果，必须标注为示例，并避免使用真实用户内容。
- 真实产品截图必须反映当前已发布版本的实际界面，不得使用未发布功能的截图或伪造数据。
- release metadata 必须来自 GitHub Releases 真实产物，不硬编码猜测值。
- 下载链接必须指向正式发布流程的产物，不指向 ad-hoc 构建或未验证产物。

## Privacy, Analytics, and Tracking

- **首版不加载任何 analytics 或追踪脚本。** 不加载 Google Analytics、Plausible、Cloudflare Web Analytics、Hotjar、Mixpanel、Segment、PostHog 等。
- **不加载第三方字体 CDN。** 字体自托管或使用 `@fontsource/*` npm 包。
- **不嵌入第三方内容。** 不嵌入 YouTube、Vimeo、Loom、Twitter、LinkedIn 等第三方 embed。产品视频（如有）自托管在 `site/public/` 或使用 `<video>` 标签指向自有资源。
- **不设置任何 cookie。** 首版无语言切换、无主题切换、无同意 banner——因为没有追踪，无需同意。
- **不调用任何 server API。** 宣传站是纯静态站点，不向 `server/` 发起任何请求。
- 未来引入 analytics、cookie 或第三方嵌入前，必须先更新本 spec 并建立独立的隐私决策与同意流程。

## SEO and Accessibility

### SEO

- 每页有清晰的 `<title>`、`<meta name="description">`、Open Graph 图（复用 `design-system/banners/og/` 已有产物）、结构化内容标题（H1-H3 语义化顺序）。
- 站点根 `sitemap.xml` 由 Astro `@astrojs/sitemap` 集成自动生成。
- `robots.txt` 允许全站爬取，不引用任何追踪脚本。
- Open Graph 图标注产品名与版本，不使用虚假截图。
- 首页结构化数据（JSON-LD）描述产品为 SoftwareApplication，包含 name、applicationCategory、operatingSystem、offers（免费）字段。

### Accessibility

- 正文、说明文字和 disabled 状态保持 WCAG AA 对比度（4.5:1 正文、3:1 大文本）。
- 标题层级使用语义化顺序（H1 → H2 → H3，不跳级）。
- 按钮和链接有可见 `:focus-visible` 状态（≥3:1 对比度环），明确 accessible name。
- 产品截图旁必须有文字解释，不依赖图片内文字传达关键信息（`<figure>` + `<figcaption>`）。
- 尊重 `prefers-reduced-motion: reduce`；工作流动画在减少动态效果时暂停或简化为 opacity 过渡。
- 移动端 320/375/414/768 px 全部可读，无横向滚动（除代码块/表格等明确可滚动内容）。
- 键盘导航可达所有交互元素，Tab 顺序符合视觉顺序。

## Responsive Design

对齐 [docs/design-docs/web-marketing-site-design.md](../design-docs/web-marketing-site-design.md) § 响应式规则：

- 桌面端使用受控内容宽度（max-width token，候选 `--content-max: 72rem`），仅当对比能提升理解时使用双列区块。
- 平板端（768-1024px）在产品视觉变拥挤时，将视觉堆叠到文案下方。
- 移动端（<768px）保持 CTA 可见、产品截图可检查、导航稳定紧凑。
- 导航不把关键下载/支持动作隐藏在非典型手势里；移动端导航开关是普通按钮，不是隐藏抽屉。
- Hallmark 移动端硬约束：根 `overflow-x: clip`（不是 `hidden`）；图片栅格用 `minmax(0, 1fr)`；display header 用 `overflow-wrap: anywhere; min-width: 0`；section head 在移动端折叠为单列。

## Component Inventory

首版使用少而稳定的组件，对齐 design-doc § 组件：

| 组件 | 文件 | 状态覆盖 |
|---|---|---|
| Header | `Header.astro` | default · hover · focus-visible · active |
| Hero | `Hero.astro` | default（首屏无 hover 态，CTA 按钮 8 状态） |
| WorkflowSteps | `WorkflowSteps.astro` | default · hover · focus-visible |
| TrustBoundary | `TrustBoundary.astro` | default（静态信息卡片） |
| OutputPreview | `OutputPreview.astro` | default · hover（标签切换若有） |
| DownloadCard | `DownloadCard.astro` | default · hover · focus-visible · active · disabled（平台未就绪时） |
| FAQ | `FAQ.astro` | default · hover · focus-visible · active（accordion 展开时） |
| Footer | `Footer.astro` | default · hover · focus-visible |
| LanguageHint | `LanguageHint.astro` | default（静态提示，不切换） |

不在产品和商业面未定义前加入聊天浮窗、紧迫感横幅、虚假证言或价格承诺。

## Acceptance Criteria

- `site/` 目录存在，包含 `package.json`、`astro.config.mjs`、`tsconfig.json`、`src/pages/index.astro`、`src/pages/download.astro`、`src/pages/privacy.astro`、`src/styles/tokens.css`。
- `npm --prefix site run build` 成功生成静态产物到 `site/dist/`，无 TypeScript 错误。
- 首页 `/` 渲染：Header、Hero（含产品名 `FrameQ`、品类、信任语、CTA）、Workflow、TrustBoundary、OutputPreview、Supported Sources、Download Entry、FAQ、Footer 九个 section。
- 下载页 `/download` 仅展示真实存在的发行产物；release metadata 来自 GitHub Releases 真实 URL，不硬编码。
- 隐私页 `/privacy` 用普通语言解释数据流，与 `docs/SECURITY.md` 一致。
- `site/src/styles/tokens.css` 包含三层 OKLCH token（primitive / semantic / component），FrameQ 蓝 `#0066cc` 已迁移为 OKLCH primitive。
- 移动端 320/375/414/768 px 全部可读，无横向滚动；桌面端 1024/1440/1920 px 内容受控且无溢出。
- 键盘 Tab 可达所有交互元素，`:focus-visible` 可见。
- `prefers-reduced-motion: reduce` 时动画暂停或简化为 opacity 过渡。
- 页面无 analytics、追踪脚本、第三方 embed、外部字体 CDN、cookie。
- `<title>`、`<meta description>`、Open Graph 图、JSON-LD 结构化数据齐全。
- `python scripts/validate_agents_docs.py --level WARN` 通过。

## Test Plan

- **构建验证**：`npm --prefix site run build` 成功；`site/dist/` 包含 `index.html` `download/index.html` `privacy/index.html`。
- **类型检查**：`npx tsc --noEmit` 在 `site/` 无错误。
- **HTML 校验**：每页 HTML 通过基础结构检查（H1 唯一、img 有 alt、form label 关联、button 有 accessible name）。
- **链接校验**：站内链接无 404；外部链接（GitHub Releases、docs/releases/、docs/SECURITY.md）可达。
- **对比度校验**：自动跑 axe-core 或 Lighthouse CLI，确认 WCAG AA 通过。
- **移动端校验**：在 320/375/414/768 px 截图，确认无横向滚动、CTA 可见、导航可用。
- **reduced-motion 校验**：在 `prefers-reduced-motion: reduce` 下截图，确认动画暂停。
- **追踪脚本校验**：构建产物 HTML 中无 `<script src="*google-analytics*">` `<script src="*plausible*">` `<script src="*cloudflareinsights*">` 等；无 `<link rel="stylesheet" href="*fonts.googleapis.com*">`。
- **release metadata 校验**：下载页每个平台卡片的下载链接指向真实 GitHub Releases URL，版本号与 `docs/releases/` 一致。
- **治理校验**：`python scripts/validate_agents_docs.py --level WARN` 通过。

## Residual Risks

- **release metadata 时效性。** 下载页链接到 GitHub Releases 真实产物，但当新版本发布后宣传站需要重新构建同步。首版采用构建期硬编码（来自 `site/src/consts.ts`），未来迭代可考虑 CI 自动从 GitHub API 拉取最新 release 版本号注入。
- **真实产品截图维护。** 截图来自手动截取，当桌面端 UI 变化后需要手动更新。首版不实现自动化截图采集。
- **多语言缺失。** 首版仅中文文案，英文访客体验受限。多语言切换是后续迭代，需要先建立翻译审阅流程（对齐 `docs/DESIGN.md` 简繁中文审阅规则）。
- **暗色模式缺失。** 首版仅亮色主题。暗色模式需要 token 系统扩展 `[data-theme="dark"]` 覆盖，是后续迭代。
- **博客/changelog 自动同步缺失。** 首版 release notes 通过 content collections 手动从 `docs/releases/` 同步摘要，不自动拉取。
- **部署目标未定。** 首版构建产物在 `site/dist/`，但部署到 GitHub Pages / Cloudflare Pages / Netlify 的 CI 集成在 ExecPlan 部署阶段确定。
- **字体授权未定。** display 字体的最终选择（Inter / Geist Mono / IBM Plex Sans / Source Han Sans）与授权确认在 ExecPlan 的 Hallmark theme 阶段确定。
- **未跑真实浏览器视觉验证。** 单元/集成测试可断言 HTML 结构与 token 使用，但真实浏览器的视觉一致性需要手动在 Chromium / Firefox / Safari 截图确认。
- **版本号未分配。** 本 spec 不分配版本号；release-prep 由独立 plan 决定。
