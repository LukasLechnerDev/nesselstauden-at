import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const pages = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/pages' }),
  // hidden: rendered, but not listed in the navigation
  schema: z.object({ title: z.string(), order: z.number().default(99), hidden: z.boolean().optional() }),
});

export const collections = { pages };
