// BASE_URL-aware link helper: url('/news/') -> '/nesselstauden-at/<site>/news/'
export const url = (path = '/') => import.meta.env.BASE_URL.replace(/\/$/, '') + path;

// Markdown bodies use root-relative /img/... and /news/... links; prefix them with the site base
export const withBase = (html = '') => html.replace(/(src|href)="\/(?!\/)/g, `$1="${url('/')}`);

export const slugify = (s: string) =>
  s.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export const formatDate = (d: Date) => d.toLocaleDateString('de-AT', { day: '2-digit', month: 'long', year: 'numeric' });
