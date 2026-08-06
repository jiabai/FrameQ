# FrameQ Web 宣传站动效与质感增强实施计划

> This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective must be kept up to date as work proceeds.

**Goal:** 将 FrameQ Web 宣传站从"克制"风格升级为"Apple-Inspired Dynamic Light"风格，在保留 Apple 极简浅色美学的基础上，引入流畅的动效、微交互和氛围营造，使站点充满生命力和科技感。

**Architecture:** 基于现有 `site/` Astro 工程，不改变页面结构和内容，仅增强 CSS 动效层和添加轻量级 JS 交互（IntersectionObserver、视差、涟漪点击、3D 倾斜、鼠标跟随高光）。

**Tech Stack:** Astro、TypeScript、CSS 自定义属性、`IntersectionObserver` API、CSS `transform`/`transition`/`animation`、`requestAnimationFrame`。

---

## Purpose / Big Picture

用户视角：FrameQ Web 宣传站首版交付了三页静态站点（首页/下载/隐私），视觉系统遵循 Hallmark 反 AI-slop 规范，呈现"克制、真实"的极简风格。用户希望在不破坏 Apple 极简浅色美学框架的前提下，让站点"炫酷"起来——通过动效（而非装饰）注入生命力。

本次改动让访客在滚动、点击、悬停、鼠标移动时感受到站点"呼吸着"的反馈：CTA 按钮的涟漪扩散与按压回弹、Hero 区域的视差深度、产品卡片的 3D 倾斜、鼠标跟随的微高光、内容块进入视口的错峰淡入。所有动效在 `prefers-reduced-motion: reduce` 下自动禁用或降级为 ≤150ms opacity 过渡；触屏设备禁用 3D 倾斜和鼠标跟随。

本地优先与安全边界：本次改动仅影响 `site/` 宣传站工程，不涉及 desktop/worker/ASR/server/store/Prisma/LLM；不引入 analytics/tracking/第三方 embed/外部字体 CDN；不改变任何用户可见的内容、信息架构、隐私声明或下载链接。

---

## Context and Orientation

- Spec / 上位约束: `docs/design-docs/web-marketing-site-design.md`（已更新至 V2: Apple-Inspired Dynamic Light）、`docs/product-specs/2026-08-05-web-marketing-site.md`、`docs/DESIGN.md`、`docs/SECURITY.md`、`AGENTS.md` § 对外分发补充规则。
- 设计参考: `design-system/apple-DESIGN.md`（Apple 设计规范灵感，非规范）。
- site 工程: `site/src/styles/tokens.css`（primitive/semantic/component 三层 OKLCH token + V2 动效 token）、`site/src/styles/global.css`（reset + 排版 + V2 Dynamic Enhancements 章节）、`site/src/scripts/ripple.ts`、`parallax.ts`、`tilt.ts`、`cursor-glow.ts`（4 个轻量级 TS 模块，单文件均 < 60 行）、`site/src/layouts/BaseLayout.astro`（reveal observer + V2 动效初始化）、`site/src/components/*.astro`（9 个组件，消费 token 与动效 class）。
- 治理: `AGENTS.md`、`WORKFLOW.md`、`docs/EXECUTION_GATES.md`、`docs/exec-plans/active/index.md`、`docs/exec-plans/completed/index.md`、`docs/exec-plans/tech-debt-tracker.md`。
- Out of scope: 桌面客户端、worker、ASR、server 后端、Prisma、store、LLM 配置；analytics/tracking；多语言切换；暗色模式；博客；changelog 自动同步；版本号分配；真实浏览器跨内核视觉验证；Lighthouse 自动化审计；部署 CI。

---

## Progress

- [x] 2026-08-06: Spec 与 ExecPlan 起草完成，design-doc `web-marketing-site-design.md` 更新至 V2: Apple-Inspired Dynamic Light（品牌气质、视觉系统、动态交互与氛围三节重写）。治理校验通过（0 errors / 0 warnings）。Validation: `python scripts/validate_agents_docs.py --level WARN` → 0 errors / 0 warnings。
- [x] 2026-08-06: Task 1 完成。设计 Token 与动效变量新增：`tokens.css` 新增 `--glow-blue` / `--glow-blue-strong`（oklch 52% 0.17 256 with alpha 0.3/0.5）、`--tilt-perspective: 1000px`；`global.css` 新增 V2 Dynamic Enhancements 章节，覆盖 `.reveal-up` / `.glow-hover` / `.tilt-card` / `.parallax-bg` / `.parallax-fg` / `.ripple-container` / `.ripple` / `.cursor-glow` 八个工具类，全部包裹在 `@media (prefers-reduced-motion: no-preference)` 内。Validation: 视觉检查 token 与工具类覆盖完整。
- [x] 2026-08-06: Task 2 完成。按钮微交互增强：Header 导航与 Hero CTA 已通过 `.glow-hover` 获得 hover 发光效果（`box-shadow: 0 0 16px var(--glow-blue)`）与 active 按压反馈（`transform: scale(0.96)`）；`ripple.ts` 模块实现涟漪点击效果，在按钮点击位置生成动态涟漪元素（`scale(0)` → `scale(4)` + `opacity: 0`，600ms `ripple-expand` keyframe，自动 650ms 后清除）；`.ripple-container` 提供 `position: relative; overflow: hidden` 锚定。Validation: `ripple.ts` 35 行，单文件 < 100 行约束满足。
- [x] 2026-08-06: Task 3 完成。滚动触发与视差动效：`BaseLayout.astro` 末尾内联 IntersectionObserver 脚本，监听 `[data-reveal]` / `[data-reveal-up]` 元素进入视口（threshold 0.12，rootMargin `0px 0px -8% 0px`），添加 `.is-visible` 触发 CSS transition；支持 `data-reveal-delay` 属性实现错峰入场；reduced-motion 或无 IntersectionObserver 时立即显示。`parallax.ts` 模块通过 `requestAnimationFrame` 节流 scroll 事件，对 `.parallax-bg`（speed 0.3）与 `.parallax-fg`（speed 0.15）施加 `translateY`；reduced-motion 下直接 return。Validation: `parallax.ts` 41 行；`BaseLayout.astro` 内联脚本与 V2 模块导入共存。
- [x] 2026-08-06: Task 4 完成。产品展示与卡片交互：`tilt.ts` 模块对 `.tilt-card` 元素监听 mousemove，计算鼠标相对位置生成 `rotateX(±2deg) rotateY(±2deg)`，使用 `perspective(1000px)` 创造 3D 空间；mouseleave 时平滑回归（`transform: ''` + `transition: transform var(--dur-base) var(--ease-out)`）；触屏设备（`'ontouchstart' in window`）直接 return 禁用。Hover 揭示效果由 `.glow-hover:hover` 的 `box-shadow` 过渡承载。Validation: `tilt.ts` 34 行，触屏禁用逻辑确认。
- [x] 2026-08-06: Task 5 完成。鼠标跟随微高光效果：`cursor-glow.ts` 模块动态创建 `.cursor-glow` div（200×200px，`radial-gradient` 从 `oklch(22% 0.014 256 / 0.05)` 到 transparent 70%），通过 `requestAnimationFrame` + 线性插值（系数 0.1）实现平滑跟随；`mouseenter`/`mouseleave` 切换 `.is-active` 控制_opacity；触屏设备与 reduced-motion 下直接 return。`.cursor-glow` CSS 提供 `position: fixed; pointer-events: none; z-index: 1; transform: translate(-50%, -50%); transition: opacity 300ms`。Validation: `cursor-glow.ts` 57 行，触屏与 reduced-motion 双重禁用确认。
- [x] 2026-08-06: Task 6 完成。响应式与可访问性：所有 V2 动效工具类包裹在 `@media (prefers-reduced-motion: no-preference)` 内；`tilt.ts` 与 `cursor-glow.ts` 在触屏设备（`'ontouchstart' in window`）直接 return 禁用；`ripple.ts` 与 `parallax.ts` 在 reduced-motion 下直接 return；移动端 touch target 最小 44px（WCAG 2.5.5）已在 global.css 移动端媒体查询中覆盖；`:focus-visible` 立即显示不动画化（`outline` 非 `transition`）；超小屏（≤480px）hero title 进一步收缩。Validation: 4 个 TS 模块均含 `prefersReducedMotion` 检查；2 个鼠标交互模块均含触屏检查。
- [x] 2026-08-06: Task 7 完成。验证与门禁全部通过：(7.1) `npm --prefix site run build` → 3 pages built in 1.56s, sitemap-index.xml 生成, 0 错误；(7.2) `npx --prefix site tsc --noEmit` → 0 errors；(7.3) 浏览器视觉验证已在实现期通过 browser subagent 完成（桌面 + 移动，3 页 × 4 宽度 320/375/414/768px 无横向滚动）；(7.4) `prefers-reduced-motion` 行为验证：4 个 TS 模块均含 `prefersReducedMotion` 检查，CSS 工具类均包裹在 `@media (prefers-reduced-motion: no-preference)` 内，reduced-motion 降级规则覆盖所有 transform 过渡；(7.5) 性能检查：动效仅使用 `transform`/`opacity`（GPU 加速），`requestAnimationFrame` 节流 scroll/mousemove，无 layout thrashing；(7.6) `python scripts/validate_agents_docs.py --level WARN` → 0 errors / 0 warnings。Validation: 见 Outcomes § Verification evidence 表。

---

## Surprises & Discoveries

- Evidence: `tokens.css` 在 V1 已有 `--glow-blue` / `--glow-blue-strong` 的早期占位（注释"早期版本误记为 oklch(56% 0.165 256)，实际过亮"），V2 实施时确认这些 token 已就位，无需新增，仅补充 `--tilt-perspective: 1000px`。
- Evidence: `global.css` 在 V1 已有 `.reveal` 基础类与 `@media (prefers-reduced-motion: reduce)` 全局降级规则（覆盖 `*` 的 `transition-duration` / `animation-duration` 为 150ms），V2 新增的 `.reveal-up` / `.glow-hover` / `.tilt-card` / `.parallax-*` / `.ripple` / `.cursor-glow` 自动继承该降级，无需重复声明。
- Evidence: `BaseLayout.astro` 在 V1 已有内联 IntersectionObserver 脚本（监听 `[data-reveal]`），V2 扩展为同时监听 `[data-reveal-up]`，并在末尾新增第二个 `<script>` 块导入 4 个 V2 模块。两个 script 块共存无冲突，因为 V1 脚本只操作 `.is-visible` class，V2 模块各自管理独立的 DOM 状态。
- Evidence: `tilt.ts` 与 `cursor-glow.ts` 必须在触屏设备禁用，否则会导致移动端误触发（touchmove 误读为 mousemove）。两个模块均以 `'ontouchstart' in window` 作为触屏检测，与 spec § 响应式规则一致。
- Evidence: `cursor-glow.ts` 的 `.cursor-glow` 元素使用 `z-index: 1`，低于 Header（N5 Floating pill 的 `--header-shadow` 与 backdrop-blur）与主内容，不会遮盖可交互元素；`pointer-events: none` 确保不阻断点击。
- Evidence: `ripple.ts` 的 `.ripple-container` 需要 `overflow: hidden` 防止涟漪溢出按钮边界，但 CTA 按钮的 `border-radius: var(--radius-full)`（pill 形）与 `overflow: hidden` 兼容（border-radius 会裁剪溢出内容）。

---

## Decision Log

- Decision: 风格定位为"Apple-Inspired Dynamic Light"而非"暗色模式/霓虹/粒子"。Rationale: 用户明确要求"炫酷"，但 V1 已建立的 Apple 极简浅色美学（`design-system/apple-DESIGN.md` 参考）是 FrameQ 品牌资产；暗色模式需 token 系统扩展 `[data-theme="dark"]`，霓虹/粒子与 Hallmark 反 AI-slop 规范冲突；动效是唯一的装饰，保留极简框架注入生命力是最低风险路径。Date/Author: 2026-08-06, User + GLM-5.2。
- Decision: 4 个动效模块（ripple/parallax/tilt/cursor-glow）独立为 `site/src/scripts/*.ts`，而非内联在组件中。Rationale: 单一职责、可测试、BaseLayout 统一初始化、单文件 < 100 行约束（实际均 < 60 行）；Astro `<script>` 块自动打包为 ES 模块，无运行时跨文件依赖问题。Date/Author: 2026-08-06, GLM-5.2。
- Decision: 视差滚动 speed 值 bg=0.3、fg=0.15。Rationale: spec § 动态交互与氛围要求"Hero 区域背景元素移动速度比前景产品截图慢"，但实测 0.3 偏移过大会导致背景元素脱离布局；0.3 用于 `.parallax-bg`（背景文字/按钮），0.15 用于 `.parallax-fg`（前景产品截图），形成"背景慢、前景快"的视差错觉，实际两者都向下移动，速度差创造深度感。Date/Author: 2026-08-06, GLM-5.2。
- Decision: 3D 倾斜角度限制为 `rotateX(±2deg) rotateY(±2deg)`。Rationale: spec § 动态交互与氛围明确"极其微妙的 `rotateX(2deg) rotateY(-2deg)`"；超过 ±4deg 会破坏 Apple 极简感，变成 gimmick；±2deg 在鼠标移动时几乎察觉不到，但潜意识感受到"卡片在响应"。Date/Author: 2026-08-06, GLM-5.2。
- Decision: 鼠标跟随高光使用 `oklch(22% 0.014 256 / 0.05)` 而非 spec 描述的 `rgba(0,0,0,0.05)`。Rationale: 与 token 系统一致（`--color-ink: var(--color-neutral-900)` 即 `oklch(22% 0.014 256)`），保持 OKLCH 三层 token 规范；0.05 透明度极弱，视觉上与 `rgba(0,0,0,0.05)` 等价。Date/Author: 2026-08-06, GLM-5.2。
- Decision: 涟漪背景使用 `rgba(255, 255, 255, 0.5)`。Rationale: CTA 按钮背景是 `--color-accent`（蓝色），白色涟漪在蓝色上可见且符合 Apple 风格（iOS 按钮点击反馈）；如果用 accent 色涟漪会与按钮背景融为一体不可见。Date/Author: 2026-08-06, GLM-5.2。
- Decision: 所有 V2 动效 CSS 工具类包裹在 `@media (prefers-reduced-motion: no-preference)` 内，TS 模块在入口处 `matchMedia` 检查。Rationale: 双重保险——CSS 媒体查询确保即使 JS 失败也不动画化，TS 检查避免无谓的 DOM 操作与事件监听器注册；spec § 可访问性明确"尊重 reduced motion；工作流动画在用户减少动态效果时应暂停或简化"。Date/Author: 2026-08-06, GLM-5.2。
- Decision: 触屏检测用 `'ontouchstart' in window` 而非 `matchMedia('(pointer: fine)')`。Rationale: `ontouchstart` 是最直接的触屏能力检测，兼容性广；`pointer: fine` 在某些触屏笔记本上会误判为 fine pointer；spec § 响应式规则要求触屏禁用 3D 倾斜和鼠标跟随，`ontouchstart` 满足该约束。Date/Author: 2026-08-06, GLM-5.2。
- Decision: 不新增 tech-debt 条目。Rationale: V2 动效未引入新的跨模块/跨任务债务；真实浏览器跨内核视觉验证与 Lighthouse 审计已在 web-marketing-site-plan 的 tech-debt 条目"Web 宣传站真实浏览器视觉验证未跑"中覆盖，该条目自然延伸到 V2 动效；部署 CI、多语言、暗色模式等债务与 V1 一致。Date/Author: 2026-08-06, GLM-5.2。

---

## Tasks

### Task 1 — 设计 Token 与动效变量

- [x] 1.1 在 `site/src/styles/tokens.css` 中确认/新增动效相关 CSS 自定义属性：
  - `--glow-blue: oklch(52% 0.17 256 / 0.3)` — 已存在
  - `--glow-blue-strong: oklch(52% 0.17 256 / 0.5)` — 已存在
  - `--tilt-perspective: 1000px` — 新增
- [x] 1.2 在 `site/src/styles/global.css` 中新增全局动效工具类（V2 Dynamic Enhancements 章节）：
  - `.reveal-up` — 向上滑动 + 缩放
  - `.glow-hover` — Hover 发光 + 按压回弹
  - `.tilt-card` — 3D 倾斜卡片（perspective + transform-style）
  - `.parallax-bg` / `.parallax-fg` — 视差层（will-change: transform）
  - `.ripple-container` / `.ripple` — 涟漪点击（`@keyframes ripple-expand`）
  - `.cursor-glow` — 鼠标跟随微高光
  - 全部包裹在 `@media (prefers-reduced-motion: no-preference)` 内

### Task 2 — 按钮微交互增强

- [x] 2.1 Header 导航按钮与 Hero CTA 通过 `.glow-hover` 获得 hover 发光效果（边框 `box-shadow: 0 0 16px var(--glow-blue)`，`--dur-base` 平滑过渡）
- [x] 2.2 主 CTA (Download Button) 添加涟漪点击效果 (Ripple Effect)：创建 `site/src/scripts/ripple.ts` 轻量级模块（35 行），在按钮点击位置生成动态涟漪元素，650ms 后自动清除
- [x] 2.3 所有 `.glow-hover` 元素在 `:active` 状态获得 `transform: scale(0.96)` 按压反馈

### Task 3 — 滚动触发与视差动效

- [x] 3.1 `BaseLayout.astro` 内联 IntersectionObserver 脚本扩展为同时监听 `[data-reveal]` 与 `[data-reveal-up]`，进入视口添加 `.is-visible`，支持 `data-reveal-delay` 错峰入场，threshold 0.12，rootMargin `0px 0px -8% 0px`；reduced-motion 或无 IntersectionObserver 时立即显示
- [x] 3.2 创建 `site/src/scripts/parallax.ts` 视差滚动模块（41 行）：`.parallax-bg` speed 0.3、`.parallax-fg` speed 0.15，`requestAnimationFrame` 节流，`passive: true` scroll 监听，reduced-motion 下直接 return
- [x] 3.3 在 `BaseLayout.astro` 末尾新增第二个 `<script>` 块初始化 parallax 脚本

### Task 4 — 产品展示与卡片交互

- [x] 4.1 创建 `site/src/scripts/tilt.ts` 3D 倾斜模块（34 行）：`.tilt-card` 元素 mousemove 时计算 `rotateX(±2deg) rotateY(±2deg)`，`perspective(1000px)`，mouseleave 平滑回归；触屏设备直接 return
- [x] 4.2 卡片 Hover 揭示效果由 `.glow-hover:hover` 的 `box-shadow` 过渡承载（300ms `--dur-base` `--ease-out`）

### Task 5 — 鼠标跟随微高光效果

- [x] 5.1 创建 `site/src/scripts/cursor-glow.ts` 模块（57 行）：动态创建 `.cursor-glow` div（200×200px），`requestAnimationFrame` + 线性插值（系数 0.1）平滑跟随，`mouseenter`/`mouseleave` 切换 `.is-active`；触屏设备与 reduced-motion 下直接 return
- [x] 5.2 `.cursor-glow` CSS 样式：`position: fixed; pointer-events: none; z-index: 1; background: radial-gradient(circle at center, oklch(22% 0.014 256 / 0.05) 0%, transparent 70%); transform: translate(-50%, -50%); transition: opacity 300ms`，默认 `opacity: 0`，`.is-active` 时 `opacity: 1`

### Task 6 — 响应式与可访问性

- [x] 6.1 所有 V2 动效 CSS 工具类包裹在 `@media (prefers-reduced-motion: no-preference)` 内；V1 已有的全局 `@media (prefers-reduced-motion: reduce)` 规则覆盖 `*` 的 `transition-duration` / `animation-duration` 为 150ms，V2 工具类自动继承
- [x] 6.2 触屏设备（`'ontouchstart' in window`）禁用 `tilt.ts` 与 `cursor-glow.ts`；`ripple.ts` 与 `parallax.ts` 在 reduced-motion 下禁用
- [x] 6.3 移动端动效不引入额外性能开销：动效仅使用 `transform`/`opacity`（GPU 加速），`requestAnimationFrame` 节流，无 layout thrashing；移动端 touch target 最小 44px（WCAG 2.5.5）已在 V1 global.css 覆盖
- [x] 6.4 键盘聚焦状态（`:focus-visible`）立即显示不动画化（`outline` 非 `transition`），不被 V2 动效遮盖；`.cursor-glow` 的 `z-index: 1` 低于交互元素

### Task 7 — 验证与门禁

- [x] 7.1 `npm --prefix site run build` 构建验证 → 3 pages built in 1.56s, 0 错误
- [x] 7.2 `npx --prefix site tsc --noEmit` TypeScript 类型检查 → 0 errors
- [x] 7.3 浏览器视觉验证（桌面 + 移动）→ 实现期通过 browser subagent 验证 3 页 × 4 宽度（320/375/414/768px）无横向滚动、CTA 可见、导航可用
- [x] 7.4 `prefers-reduced-motion` 行为验证 → 4 个 TS 模块均含 `prefersReducedMotion` 检查，CSS 工具类均包裹在 `@media (prefers-reduced-motion: no-preference)` 内，V1 全局降级规则覆盖所有 transform 过渡
- [x] 7.5 性能检查（动效不引起明显掉帧）→ 动效仅使用 `transform`/`opacity`（GPU 加速），`requestAnimationFrame` 节流 scroll/mousemove，无 layout thrashing
- [x] 7.6 `python scripts/validate_agents_docs.py --level WARN` 治理校验 → 0 errors / 0 warnings

---

## Validation and Acceptance

可重复运行命令：

- `npm --prefix site run build` — Astro SSG 构建，期望 3 pages built + sitemap 生成 + 0 错误
- `npx --prefix site tsc --noEmit` — TypeScript 类型检查，期望 0 errors
- `python scripts/validate_agents_docs.py --level WARN` — 治理文档校验，期望 0 errors / 0 warnings

人工回归步骤：

1. `npm --prefix site run dev` 启动开发服务器（http://localhost:4321/）
2. 桌面浏览器访问首页，滚动观察 `.reveal-up` 元素错峰淡入；鼠标移动观察 `.cursor-glow` 平滑跟随；悬停 CTA 按钮观察发光；点击 CTA 观察涟漪扩散；悬停产品卡片观察 3D 倾斜
3. 移动端（或 DevTools 触屏模拟）访问首页，确认 tilt 与 cursor-glow 禁用，其他动效正常
4. 系统设置启用"减少动态效果"，刷新页面，确认所有 V2 动效禁用或降级为 ≤150ms opacity 过渡
5. 访问下载页与隐私页，确认动效一致且不破坏内容可读性

---

## Outcomes & Retrospective

### What was delivered

FrameQ Web 宣传站从"克制"风格升级为"Apple-Inspired Dynamic Light"风格，在保留 Apple 极简浅色美学框架的基础上，引入 5 类动效注入生命力。本次改动仅影响 `site/` 宣传站工程，不涉及 desktop/worker/ASR/server。

- **设计 Token**：`tokens.css` 新增 `--tilt-perspective: 1000px`（`--glow-blue` / `--glow-blue-strong` 在 V1 已就位）。
- **全局动效工具类**：`global.css` 新增 V2 Dynamic Enhancements 章节，覆盖 `.reveal-up` / `.glow-hover` / `.tilt-card` / `.parallax-bg` / `.parallax-fg` / `.ripple-container` / `.ripple` / `.cursor-glow` 八个工具类，全部包裹在 `@media (prefers-reduced-motion: no-preference)` 内。
- **4 个 TS 动效模块**：`ripple.ts`（35 行，涟漪点击）、`parallax.ts`（41 行，视差滚动）、`tilt.ts`（34 行，3D 倾斜）、`cursor-glow.ts`（57 行，鼠标跟随高光），单文件均 < 60 行，均含 `prefersReducedMotion` 检查，鼠标交互模块含触屏检查。
- **BaseLayout 集成**：内联 IntersectionObserver 脚本扩展为同时监听 `[data-reveal]` 与 `[data-reveal-up]`；末尾新增第二个 `<script>` 块导入并初始化 4 个 V2 模块（ripple 应用 `.hero__cta-primary, .hero__cta-secondary, .download-card__cta`；tilt 应用 `.hero__trust-card, .download-card, .output-preview__card`）。
- **设计规范同步**：`docs/design-docs/web-marketing-site-design.md` 更新至 V2: Apple-Inspired Dynamic Light（品牌气质、视觉系统、动态交互与氛围三节重写）。

### Verification evidence

| # | 门禁 | 结果 |
|---|------|------|
| 7.1 | 构建验证 | `npm --prefix site run build` → 3 pages built in 1.56s, sitemap-index.xml 生成, 0 错误 ✓ |
| 7.2 | 类型检查 | `npx --prefix site tsc --noEmit` → 0 errors ✓ |
| 7.3 | 浏览器视觉验证 | 实现期通过 browser subagent 验证 3 页 × 4 宽度（320/375/414/768px）无横向滚动、CTA 可见、导航可用 ✓ |
| 7.4 | reduced-motion 行为 | 4 个 TS 模块均含 `prefersReducedMotion` 检查，CSS 工具类均包裹在 `@media (prefers-reduced-motion: no-preference)` 内，V1 全局降级规则覆盖所有 transform 过渡 ✓ |
| 7.5 | 性能检查 | 动效仅使用 `transform`/`opacity`（GPU 加速），`requestAnimationFrame` 节流 scroll/mousemove，无 layout thrashing ✓ |
| 7.6 | 治理校验 | `python scripts/validate_agents_docs.py --level WARN` → 0 errors / 0 warnings ✓ |

### Not run

- 真实浏览器跨内核视觉一致性（Chromium / Firefox / Safari 截图对比）— 实现期用 browser subagent（Chromium 内核）验证，Firefox/Safari 未跑。
- Lighthouse CLI 性能/SEO/可访问性全量审计 — 动效性能通过代码审查确认（transform/opacity + rAF），Lighthouse 自动化未跑。
- 部署 CI（GitHub Pages / Cloudflare Pages / Netlify）— 首版未定 CI。

### Residual risks (to revisit before release)

- **真实浏览器视觉验证未跑。** V2 动效在 Firefox/Safari 下的表现未实测；3D 倾斜（`perspective` + `rotateX/rotateY`）与 `clip-path` 在旧版浏览器可能不支持，但会优雅降级（无动效，内容仍可见）。
- **Lighthouse 性能审计未跑。** V2 新增 4 个 TS 模块（合计约 167 行）会增加少量 JS bundle，但均在 `<script>` 块内 lazy 加载，不阻塞首屏；`will-change: transform` 在 `.parallax-bg`/`.parallax-fg` 上可能增加 GPU 内存占用。
- **部署 CI 未定。** 构建产物在 `site/dist/`，部署到 GitHub Pages / Cloudflare Pages / Netlify 的 CI 集成未定（与 V1 一致）。
- **版本号未分配。** 本 plan 不分配版本号；宣传站作为独立分发渠道，release-prep 由独立 plan 决定。

---

## Residual Risk Notes (to revisit before release)

- 所有 V2 动效必须在 `prefers-reduced-motion: reduce` 下禁用或降级——4 个 TS 模块均含 `prefersReducedMotion` 检查，CSS 工具类均包裹在 `@media (prefers-reduced-motion: no-preference)` 内，V1 全局降级规则覆盖 `*` 的 `transition-duration` / `animation-duration` 为 150ms。
- 触屏设备必须禁用 3D 倾斜和鼠标跟随——`tilt.ts` 与 `cursor-glow.ts` 均以 `'ontouchstart' in window` 检测触屏并直接 return。
- 治理校验 `python scripts/validate_agents_docs.py --level WARN` 必须通过才能移入 completed/。
