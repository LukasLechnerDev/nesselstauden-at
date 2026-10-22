import type { ImageMetadata } from 'astro';
import titles from './assets/galerie/titles.json';

// galleries are folders in src/assets/galerie/<slug>/; titles.json holds their names in chronological order
const files = import.meta.glob<{ default: ImageMetadata }>('/src/assets/galerie/*/*.{jpg,JPG,jpeg,png}', { eager: true });

const bySlug = Object.entries(files).reduce<Record<string, ImageMetadata[]>>((acc, [path, mod]) => {
  const slug = path.split('/').at(-2)!;
  (acc[slug] ??= []).push(mod.default);
  return acc;
}, {});

const order = Object.keys(titles);
// newest first; folders missing from titles.json go last
export const galleries = Object.fromEntries(
  Object.entries(bySlug).sort(([a], [b]) => ((order.indexOf(b) + 1 || -1) - (order.indexOf(a) + 1 || -1))),
);

export const galleryTitle = (slug: string) =>
  (titles as Record<string, string>)[slug] ?? slug.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
