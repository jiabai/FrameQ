# FrameQ Web 宣传站动效与质感增强实施计划

**Goal:** 将 FrameQ Web 宣传站从"克制"风格升级为"Apple-Inspired Dynamic Light"风格，在保留 Apple 极简浅色美学的基础上，引入流畅的动效、微交互和氛围营造，使站点充满生命力和科技感。

**Architecture:** 基于现有 `site/` Astro 工程，不改变页面结构和内容，仅增强 CSS 动效层和添加轻量级 JS 交互（IntersectionObserver、视差、涟漪点击）。

**Tech Stack:** Astro、TypeScript、CSS 自定义属性、`IntersectionObserver` API、CSS `transform`/`transition`/`animation`。

---

## Context

- Design Spec: `docs/design-docs/web-marketing-site-design.md` (已更新至 V2)
- 设计参考: `design-system/apple-DESIGN.md` (Apple 设计规范)
- 目标: 在浅色极简框架内实现"炫酷"，通过动效（非装饰）提升质感

## Tasks

### Task 1 — 设计 Token 与动效变量

- [ ] 1.1 在 `site/src/styles/tokens.css` 中新增动效相关 CSS 自定义属性：
  ```css
  --motion-duration-fast: 150ms;
  --motion-duration-base: 300ms;
  --motion-duration-slow: 500ms;
  --motion-ease-out: cubic-bezier(0.25, 0.8, 0.25, 1);
  --motion-ease-in-out: cubic-bezier(0.65, 0, 0.35, 1);
  --glow-blue: rgba(0, 102, 204, 0.3);
  --glow-blue-strong: rgba(0, 102, 204, 0.5);
  ```

- [ ] 1.2 在 `site/src/styles/global.css` 中新增全局动效工具类：
  - `.reveal` - 滚动触发淡入动画基础类
  - `.reveal-up` - 向上滑动 + 缩放
  - `.parallax-bg` - 视差背景元素
  - `.parallax-fg` - 视差前景元素
  - `.glow-hover` - Hover 发光效果
  - `.tilt-card` - 3D 倾斜卡片

### Task 2 — 按钮微交互增强

- [ ] 2.1 为 Header 导航按钮添加 `hover` 发光效果：边框从透明变为 `--glow-blue`，背景色 `200ms` 平滑过渡
- [ ] 2.2 为主 CTA (Download Button) 添加涟漪点击效果 (Ripple Effect)
  - 创建 `site/src/scripts/ripple.ts` 轻量级模块
  - 在按钮点击时生成动态涟漪元素，600ms 后自动清除
- [ ] 2.3 为所有按钮添加 `active` 状态的 `transform: scale(0.96)` 按压反馈

### Task 3 — 滚动触发与视差动效

- [ ] 3.1 创建 `site/src/scripts/reveal.ts` 滚动触发模块
  - 使用 `IntersectionObserver` 监听元素进入视口
  - 为 `.reveal-up` 元素添加 `translateY(20px) scale(0.98)` → `translateY(0) scale(1)` 动画
  - 动画时长 500ms，使用 `cubic-bezier(0.25, 0.8, 0.25, 1)` 曲线
  - 依次出现，每个元素间隔 80ms

- [ ] 3.2 创建 `site/src/scripts/parallax.ts` 视差滚动模块
  - Hero 区域背景元素（标题、副标题）移动速度比前景产品截图慢 0.3x
  - 使用 `requestAnimationFrame` 优化性能
  - 在 `prefers-reduced-motion` 下禁用

- [ ] 3.3 在 `BaseLayout.astro` 中初始化 reveal 和 parallax 脚本

### Task 4 — 产品展示与卡片交互

- [ ] 4.1 为产品截图容器添加 3D 倾斜效果 (Tilt)
  - 创建 `site/src/scripts/tilt.ts` 模块
  - 鼠标移动时，卡片轻微 `rotateX(2deg) rotateY(-2deg)`
  - 使用 CSS `perspective: 1000px` 创造 3D 空间
  - 鼠标离开时平滑回归

- [ ] 4.2 为卡片添加 Hover 揭示效果
  - Hover 时，半透明提示文字从 `opacity: 0` → `opacity: 1` 淡入
  - 过渡时长 300ms

### Task 5 — 鼠标跟随微高光效果

- [ ] 5.1 创建 `site/src/scripts/cursor-glow.ts` 模块
  - 监听 `mousemove` 事件
  - 在鼠标位置创建/更新一个 100px 半径的径向渐变光晕
  - 光晕透明度极低（0.05），不分散注意力
  - 仅在非触屏设备上启用

- [ ] 5.2 创建对应的 CSS 样式
  - `.cursor-glow { position: fixed; pointer-events: none; z-index: 1; background: radial-gradient(circle, rgba(0,0,0,0.05) 0%, transparent 70%); transform: translate(-50%, -50%); transition: opacity 300ms; }`

### Task 6 — 响应式与可访问性

- [ ] 6.1 确保所有动效在 `prefers-reduced-motion: reduce` 下被禁用或简化
- [ ] 6.2 触屏设备禁用 3D 倾斜和鼠标跟随效果
- [ ] 6.3 移动端确保动效不过度影响性能
- [ ] 6.4 键盘聚焦状态仍清晰可见（focus-visible 样式不被动效遮盖）

### Task 7 — 验证与门禁

- [ ] 7.1 `npm --prefix site run build` 构建验证
- [ ] 7.2 TypeScript 类型检查 `npx --prefix site tsc --noEmit`
- [ ] 7.3 浏览器视觉验证（桌面 + 移动）
- [ ] 7.4 `prefers-reduced-motion` 行为验证
- [ ] 7.5 性能检查（动效不引起明显掉帧）
- [ ] 7.6 `python scripts/validate_agents_docs.py --level WARN` 治理校验

## 验证清单

| 项目 | 状态 |
|------|------|
| 构建成功 (3 pages) | ⬜ |
| TypeScript 零错误 | ⬜ |
| 所有动效流畅 (60fps) | ⬜ |
| reduced-motion 兼容 | ⬜ |
| 触屏设备兼容 | ⬜ |
| 对比度仍达标 | ⬜ |
| 治理校验通过 | ⬜ |

## 边界与约束

- **不改变** 现有页面结构和内容
- **不引入** 深色模式、霓虹色、粒子特效、动态网格
- **不使用** 多色渐变背景（仅 Apple 风格的纯色交替）
- **只允许** 一个强调色 `#0066cc` (Action Blue)
- 所有 JS 模块保持轻量，单文件不超过 100 行
- 尊重 `prefers-reduced-motion` 设置

## 交付清单

- [ ] 设计 Token 更新 (tokens.css)
- [ ] 全局动效工具类 (global.css)
- [ ] 按钮涟漪效果 (ripple.ts)
- [ ] 滚动触发动画 (reveal.ts)
- [ ] 视差滚动 (parallax.ts)
- [ ] 3D 倾斜卡片 (tilt.ts)
- [ ] 鼠标微高光 (cursor-glow.ts)
- [ ] BaseLayout 集成
- [ ] 验证门禁通过
