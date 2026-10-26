// BASE_URL-aware link helper: url('/news/') -> '/nesselstauden-at/<site>/news/'
export const url = (path = '/') => import.meta.env.BASE_URL.replace(/\/$/, '') + path;

// Markdown bodies use root-relative /img/... and /news/... links; prefix them with the site base
export const withBase = (html = '') => html.replace(/(src|href)="\/(?!\/)/g, `$1="${url('/')}`);

export const slugify = (s: string) =>
  s.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export const formatDate = (d: Date) => d.toLocaleDateString('de-AT', { day: '2-digit', month: 'long', year: 'numeric' });

// first image in a post body, used as card thumbnail
export const cover = (body = '') => body.match(/<img[^>]+src="([^"]+)"/)?.[1]?.replace(/^\/(?!\/)/, url('/'));

const entities: Record<string, string> = { nbsp: ' ', quot: '"', gt: '>', lt: '<', amp: '&' };

// plain-text teaser from a post's HTML body
export const excerpt = (body = '', len = 160) => {
  const text = body
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(nbsp|quot|gt|lt|amp);/g, (_, e) => entities[e])
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > len ? text.slice(0, text.lastIndexOf(' ', len)) + ' …' : text;
};
