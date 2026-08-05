// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// 部署目标首版未定（GitHub Pages / Cloudflare Pages / Netlify 任一）。
// site URL 用于生成 sitemap.xml 与 canonical URL；占位为当前已知 FrameQ 服务域名，
// 在 ExecPlan 部署阶段确认实际宣传站域名后更新。
// 见 docs/exec-plans/active/2026-08-05-web-marketing-site-plan.md Task 7。
export default defineConfig({
  site: 'https://frameq.8xf.pro',
  integrations: [sitemap()],
  build: {
    // SSG 模式：输出纯静态 HTML/CSS/最小 JS。
    format: 'directory',
    inlineStylesheets: 'auto',
  },
  compressHTML: true,
});
