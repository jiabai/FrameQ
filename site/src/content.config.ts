/**
 * Astro 5 Content Layer 配置。
 *
 * 两个集合：
 * - faq: 常见问题，markdown body 为答案，frontmatter 含 question + order
 * - release-notes: 发布说明摘要，从 docs/releases/vX.Y.Z.md 手动同步
 *
 * 见 docs/product-specs/2026-08-05-web-marketing-site.md § Information Architecture。
 */
import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const faq = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/faq' }),
  schema: z.object({
    question: z.string(),
    order: z.number(),
  }),
});

const releaseNotes = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/release-notes' }),
  schema: z.object({
    version: z.string(),
    date: z.string(),
    title: z.string(),
  }),
});

export const collections = { faq, releaseNotes };
