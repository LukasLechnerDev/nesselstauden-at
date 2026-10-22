import type { ImageMetadata } from 'astro';

// galleries are folders in src/assets/galerie/<slug>/; the folder name is the slug
const files = import.meta.glob<{ default: ImageMetadata }>('/src/assets/galerie/*/*.{jpg,JPG,jpeg,png}', { eager: true });

export const galleries = Object.entries(files).reduce<Record<string, ImageMetadata[]>>((acc, [path, mod]) => {
  const slug = path.split('/').at(-2)!;
  (acc[slug] ??= []).push(mod.default);
  return acc;
}, {});

export const galleryTitle = (slug: string) => slug.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
