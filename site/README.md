# FrameQ Web Marketing Site

FrameQ 公开宣传独立站。独立顶级目录，与 `app/`（桌面客户端）、`server/`（后端）、`worker/`（Python worker）、`design-system/`（reference-only 设计参考）并列，无运行时跨目录 import。

## 约束

- 纯静态站点（Astro SSG），不调用任何 server API。
- 不加载 analytics、追踪脚本、第三方 embed 或外部字体 CDN。
- 不设置任何 cookie（首版无语言切换、无主题切换、无同意 banner）。
- 公开文案与 FrameQ 产品事实一致：本地优先隐私边界、ASR 模型首启按需下载、可选云端 AI 整理需用户确认。
- release metadata 来自 GitHub Releases 真实产物，不硬编码猜测值。

## 开发

```bash
npm install
npm run dev      # 本地开发服务器
npm run build    # 构建静态产物到 dist/
npm run preview  # 预览构建产物
```

`site/.env` 持久化 `ASTRO_TELEMETRY_DISABLED=1`（已通过 `.gitignore` 的 `!.env` 例外纳入版本控制），避免 Astro telemetry 在沙箱环境写入用户目录失败导致 build 中断。该文件不含敏感配置。

## 部署

构建产物输出到 `site/dist/`，为纯静态 HTML/CSS/自托管字体/最小 JS，可直接托管在任意静态站点服务（GitHub Pages / Cloudflare Pages / Netlify 等）。首版未定 CI 集成；部署目标域名在确认后更新 `astro.config.mjs` 的 `site` 字段（当前占位 `https://frameq.8xf.pro`）。

## 目录结构

```
site/
├── src/
│   ├── pages/           # 首页、下载、隐私
│   ├── components/      # Hallmark 组件
│   ├── content/         # FAQ、release notes markdown
│   ├── styles/
│   │   └── tokens.css   # OKLCH 三层 token 系统
│   └── consts.ts        # 站点常量（产品名、下载源 URL）
├── public/              # 静态资产（截图、OG 图、favicon）
├── astro.config.mjs
├── package.json
└── tsconfig.json
```

## Token 系统

`src/styles/tokens.css` 采用三层 OKLCH token（primitive → semantic → component），从 `design-system/globals.css` 的 hex token 迁移升级。`design-system/globals.css` 保持 reference-only 不变，后续 token 演进只发生在 `site/`。

文件首行盖 Hallmark stamp，记录本次设计的宏结构（macrostructure）、调性（genre/theme）、accent 锚点色相、nav/footer archetype、pre-emit 自评六轴分数、slop test 通过数等，供下次 Hallmark 运行读取以避免重复同一结构指纹（diversification 约束）。`.hallmark/log.json` 同步记录跨次运行的宏结构与主题轴。

## 设计来源

- 上位约束：`docs/design-docs/web-marketing-site-design.md`
- 产品规格：`docs/product-specs/2026-08-05-web-marketing-site.md`
- 实现计划：`docs/exec-plans/active/2026-08-05-web-marketing-site-plan.md`
- Token 种子：`design-system/globals.css`（reference-only）
- 视觉规范：Hallmark 反 AI-slop 设计技能 + ckm:design-system 三层 token 架构
