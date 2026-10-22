// One-off migration of the legacy nesselstauden.at sites into this repo.
// Usage: cd scripts && npm ci && node migrate.mjs [feuerwehr|sv-knudde|dorferneuerung|start]
// dorf-info/index.html was curated by hand from the 3 legacy frame pages and is not generated.
// Idempotent: downloaded files are skipped if present, Markdown is overwritten.
import * as cheerio from 'cheerio';
import { mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEAD = /members\.a1\.net|scifi\.pages\.at|Dokumente%20und%20Einstellungen|validator\.w3\.org|joomla\.org|techline\.de|Anmeldungsportal_11/i;
const KEEP_ATTR = { a: ['href'], img: ['src', 'alt', 'width', 'height'], td: ['colspan', 'rowspan'], th: ['colspan', 'rowspan'] };
const UNWRAP = 'font, span, u, center, o\\:p, st1\\:place, st1\\:city, small, big';
const DROP = 'script, style, noscript, meta, link, xml, map, form, input, iframe, object, embed, .article_separator, .buttonheading';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, encoding = 'utf-8') {
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (migration)' } });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`${res.status} ${url}`);
      return new TextDecoder(encoding).decode(await res.arrayBuffer());
    } catch (e) {
      if (i === 2) throw e;
      await sleep(1000 * (i + 1));
    }
  }
}

const exists = (p) => access(p).then(() => true, () => false);

async function download(url, dest) {
  if (await exists(dest)) return true;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (migration)' } });
  if (!res.ok) { console.warn(`  ! ${res.status} ${url}`); return false; }
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, Buffer.from(await res.arrayBuffer()));
  return true;
}

export function slugify(s) {
  return s.toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'seite';
}

// Phoca aliases can contain dots ("ball-2009-in-ma.-langegg"); drop them for folder and URL names
const galleryAlias = (alias) => alias?.replace(/\./g, '');

// Pure-function self-check (run: node migrate.mjs --test)
if (process.argv.includes('--test')) {
  console.assert(slugify('Übungs- und Ausbildungsplan 2012') === 'uebungs-und-ausbildungsplan-2012');
  console.assert(slugify('FF Fest 2026!') === 'ff-fest-2026');
  console.assert(slugify('???') === 'seite');
  console.assert(galleryAlias('ball-2009-in-ma.-langegg') === 'ball-2009-in-ma-langegg');
  console.log('self-check done');
  process.exit(0);
}

const yaml = (obj) => '---\n' + Object.entries(obj).filter(([, v]) => v != null)
  .map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join('\n') + '\n---\n';

/**
 * Sanitise legacy HTML down to structural tags and localise assets.
 * opts.pageUrl     absolute URL the HTML came from (to resolve relative links)
 * opts.assetDir    filesystem dir to store same-host images/files
 * opts.assetUrl    URL prefix written into src/href for stored assets
 * opts.mapLink(u)  returns a replacement href for internal page links, or undefined
 * opts.alt         fallback alt text for images that have none (legacy content never set it)
 */
async function clean(html, { pageUrl, assetDir, assetUrl, host, mapLink, alt = '' }) {
  const $ = cheerio.load(`<div id="__root">${html}</div>`, null, false);
  const root = $('#__root');
  // Flash YouTube embeds no longer play; keep the video as a plain link (no third-party cookies)
  root.find('object, embed, iframe').each((_, el) => {
    const id = $.html(el).match(/youtube(?:-nocookie)?\.com\/(?:v|embed)\/([\w-]{11})/)?.[1];
    if (id && !root.find(`a[href$="${id}"]`).length) $(el).replaceWith(`<p><a href="https://www.youtube.com/watch?v=${id}">Video auf YouTube ansehen</a></p>`);
  });
  root.find(DROP).remove();
  root.find('img[src*="spacer"], img[src*="PostHeaderIcon"], img[src*="mod_vvisit"]').remove();
  // unwrap repeatedly: FrontPage nests fonts deeply
  for (let i = 0; i < 5 && root.find(UNWRAP).length; i++) root.find(UNWRAP).each((_, el) => { $(el).replaceWith($(el).contents()); });
  // leaf divs become paragraphs; divs wrapping blocks are unwrapped (p can't hold tables)
  root.find('div').get().reverse().forEach((el) => { $(el).find('table, p, ul, ol, div, h1, h2, h3, h4').length ? $(el).replaceWith($(el).contents()) : (el.tagName = 'p'); });

  const jobs = [];
  root.find('*').each((_, el) => {
    const tag = el.tagName.toLowerCase();
    const keep = KEEP_ATTR[tag] ?? [];
    for (const name of Object.keys(el.attribs)) if (!keep.includes(name)) $(el).removeAttr(name);
    if (tag === 'img' && !$(el).attr('alt')?.trim()) $(el).attr('alt', alt);

    const attr = tag === 'img' ? 'src' : tag === 'a' ? 'href' : null;
    const raw = attr && $(el).attr(attr);
    if (!raw || /^(mailto:|tel:|#|javascript:)/i.test(raw)) return;
    let u;
    try { u = new URL(raw.trim(), pageUrl); } catch { $(el).removeAttr(attr); return; }
    // old mirror of the Dorferneuerung site
    if (u.hostname === 'nesselstauden.byto.de') u = new URL(u.pathname.slice(1), FP);
    if (DEAD.test(u.href)) { tag === 'a' ? $(el).replaceWith($(el).contents()) : $(el).remove(); return; }

    const sameHost = u.hostname.endsWith(host);
    const mapped = tag === 'a' && sameHost ? mapLink?.(u) : undefined;
    if (mapped !== undefined) { mapped ? $(el).attr('href', mapped) : $(el).replaceWith($(el).contents()); return; }

    const ext = extname(decodeURIComponent(u.pathname)).toLowerCase();
    if (u.hostname.endsWith('nesselstauden.at') && ext && !['.php', '.htm', '.html', ''].includes(ext)) {
      // localise asset: keep path below images/ (or full path) to avoid collisions
      const rel = decodeURIComponent(u.pathname).replace(/^.*?\/images\//i, '').replace(/^\/+/, '')
        .split('/').map((p) => p.replace(/[^\w.\-]+/g, '_')).join('/')
        .toLowerCase(); // legacy links mix IMAG0224/imag0224; Pages (Linux) is case-sensitive, macOS is not
      jobs.push(download(u.href, join(assetDir, rel)).then((ok) => {
        if (ok) $(el).attr(attr, `${assetUrl}/${rel}`);
        else if (tag === 'img') $(el).remove();
        else $(el).replaceWith($(el).contents());
      }));
    } else if (tag === 'img' && !sameHost) {
      $(el).attr(attr, u.href);
    } else if (tag === 'a') {
      $(el).attr(attr, u.href);
    }
  });
  await Promise.all(jobs);

  // some legacy mailto targets disagree with the address shown; the shown one is what readers see and copy
  root.find('a[href^="mailto:"]').each((_, el) => {
    const shown = $(el).text().trim();
    if (/^[\w.+-]+@[\w-]+(\.[\w-]+)+$/.test(shown)) $(el).attr('href', `mailto:${shown}`);
  });

  // drop empties left behind by FrontPage/Joomla
  for (let i = 0; i < 3; i++) root.find('p, b, i, strong, em').each((_, el) => {
    if (!$(el).text().replace(/ /g, ' ').trim() && !$(el).find('img, br, table').length) $(el).remove();
  });
  // one HTML block with no indentation/blank lines, so Markdown passes it through untouched
  return `<div class="legacy">\n${root.html().replace(/\r/g, '').replace(/[ \t]*\n\s*/g, '\n').trim()}\n</div>\n`;
}

async function pool(items, n, fn) {
  const out = []; let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } }));
  return out;
}

// ---------- Joomla 1.5 ----------
async function joomla({ origin, dir, menu, maxId, overrides = {} }) {
  const host = new URL(origin).hostname;
  const site = join(ROOT, dir);
  const assetDir = join(site, 'public/img');

  // 1. dates + categories from every feed we can find (feeds are capped at 10 → page with limitstart)
  const meta = new Map();
  const feeds = [`${origin}/index.php?format=feed&type=rss`];
  for (let id = 1; id <= 12; id++) {
    feeds.push(`${origin}/index.php?option=com_content&view=category&id=${id}&format=feed&type=rss`);
    feeds.push(`${origin}/index.php?option=com_content&view=section&id=${id}&format=feed&type=rss`);
  }
  await pool(feeds, 4, async (feed) => {
    for (let start = 0; start < 1000; start += 10) {
      const xml = await get(`${feed}&limitstart=${start}`);
      if (!xml) return;
      const $ = cheerio.load(xml, { xml: true });
      const items = $('item');
      if (!items.length) return;
      let fresh = 0;
      items.each((_, it) => {
        const link = $(it).find('link').text();
        const m = link.match(/[?&]id=(\d+)(?::([\w-]+))?/);
        if (!m) return;
        if (!meta.has(+m[1])) fresh++;
        // feeds are fetched in parallel; a real category must win over the frontpage pseudo-category
        const cat = $(it).find('category').first().text();
        const prev = meta.get(+m[1]);
        meta.set(+m[1], { alias: m[2], date: new Date($(it).find('pubDate').text()).toISOString().slice(0, 10), ...prev, category: prev?.category ?? (cat && cat !== 'frontpage' ? cat : undefined) });
      });
      if (!fresh && start > 0) return; // Joomla returns the last page again past the end
    }
  });
  console.log(`  feeds: ${meta.size} dated articles`);

  // 2. every article id, clean component view
  const menuIds = new Map(Object.entries(menu).map(([title, id]) => [id, title]));
  const raw = (await pool(Array.from({ length: maxId }, (_, i) => i + 1), 4, async (id) => {
    const html = await get(`${origin}/index.php?option=com_content&view=article&id=${id}&tmpl=component`);
    if (!html) return null;
    const $ = cheerio.load(html);
    const title = ($('.contentheading').first().text() || $('h2').first().text() || $('title').text()).trim();
    // body = the contentpaneopen table that is not the heading table; Knudde template uses .article
    let body = $('.contentpaneopen').filter((_, t) => !$(t).find('.contentheading').length).first().find('td').first();
    if (!body.length) body = $('.article').first();
    if (!title || !body.length || /404|Artikel nicht gefunden|Zugriff/i.test(title)) return null;
    body.find('.contentheading, .createdate, .modifydate, .small, .PostMetadataHeader, .PostHeaderIcon-wrapper').remove();
    return { id, title, html: body.html() ?? '' };
  })).filter(Boolean);

  // 3. slugs & link map
  const used = new Set();
  const entries = raw.map((a) => {
    const isPage = menuIds.has(a.id);
    const m = meta.get(a.id) ?? {};
    let slug = isPage ? slugify(menuIds.get(a.id)) : (m.alias || slugify(a.title));
    while (used.has(slug)) slug += '-' + a.id;
    used.add(slug);
    return { ...a, ...m, isPage, slug, title: isPage ? menuIds.get(a.id) : a.title, ...overrides[a.id] };
  });
  // Feuerwehr reuses article 1 for two menu items; menu titles that share an id are aliased
  const byId = new Map(entries.map((e) => [e.id, e]));
  const mapLink = (u) => {
    const id = u.searchParams.get('id')?.split(':')[0];
    const view = u.searchParams.get('view');
    if (view === 'article' && byId.has(+id)) { const e = byId.get(+id); return e.isPage ? `/${e.slug}/` : `/news/${e.slug}/`; }
    if (u.searchParams.get('option') === 'com_phocagallery') { const alias = id && galleryAlias(u.searchParams.get('id').split(':')[1]); return alias ? `/galerie/${alias}/` : '/galerie/'; }
    if (view === 'category' || view === 'section') return '/news/';
    if (u.pathname === '/' || u.pathname === '/index.php') return '/';
    return undefined;
  };

  // undated articles: Joomla ids are sequential, so borrow the nearest dated neighbour's date
  const dated = entries.filter((e) => e.date).sort((a, b) => a.id - b.id);
  for (const e of entries) if (!e.isPage && !e.date && dated.length) {
    const near = dated.reduce((best, d) => Math.abs(d.id - e.id) < Math.abs(best.id - e.id) ? d : best);
    e.date = near.date; e.estimated = true;
  }

  // 4. write
  let news = 0, pages = 0, undated = [];
  for (const e of entries) {
    const html = await clean(e.html, { pageUrl: origin + '/', assetDir, assetUrl: '/img', host, mapLink, alt: e.title });
    if (e.isPage) {
      await mkdir(join(site, 'src/content/pages'), { recursive: true });
      await writeFile(join(site, 'src/content/pages', `${e.slug}.md`), yaml({ title: e.title, order: Object.keys(menu).indexOf(e.title) }) + '\n' + html);
      pages++;
    } else {
      if (e.estimated) undated.push(`${e.id} ${e.date} ${e.title}`);
      await mkdir(join(site, 'src/content/news'), { recursive: true });
      await writeFile(join(site, 'src/content/news', `${e.slug}.md`), yaml({ title: e.title, date: e.date, category: e.category }) + '\n' + html);
      news++;
    }
  }
  console.log(`  wrote ${news} news, ${pages} pages`);
  if (undated.length) console.log(`  date estimated from neighbouring article ids:\n    ${undated.join('\n    ')}`);
}

// ---------- Phoca gallery ----------
async function phoca(origin, dir) {
  const $ = cheerio.load(await get(`${origin}/index.php?option=com_phocagallery&view=categories`));
  const cats = [...new Set($('a').map((_, a) => $(a).attr('href')).get().filter((h) => /view=category&(amp;)?id=\d+:/.test(h)))];
  // real titles (aliases lost their umlauts), in Phoca's chronological listing order
  const titles = {};
  $('a').each((_, a) => {
    const alias = galleryAlias(($(a).attr('href') || '').match(/view=category&(?:amp;)?id=\d+:([\w.-]+)/)?.[1]);
    const text = $(a).text().split('»').pop().trim();
    if (alias && text) titles[alias] = text;
  });
  await mkdir(join(ROOT, dir, 'src/assets/galerie'), { recursive: true });
  await writeFile(join(ROOT, dir, 'src/assets/galerie/titles.json'), JSON.stringify(titles, null, 2) + '\n');
  for (const href of cats) {
    const alias = galleryAlias(href.match(/id=\d+:([\w.-]+)/)[1]);
    const imgs = new Set();
    for (let start = 0; start < 2000; start += 20) {
      const page = cheerio.load(await get(new URL(href, origin).href + `&limitstart=${start}`));
      const before = imgs.size;
      page('a').each((_, a) => { const h = page(a).attr('href') || ''; if (/phoca_thumb_l_/.test(h)) imgs.add(new URL(h, origin).href); });
      if (imgs.size === before) break;
    }
    await pool([...imgs], 4, (u) => download(u, join(ROOT, dir, 'src/assets/galerie', alias, u.split('phoca_thumb_l_')[1])));
    console.log(`  galerie ${alias}: ${imgs.size} images`);
  }
}

// ---------- FrontPage ----------
const FP = 'http://www.nesselstauden.at/Dorferneuerung/html/Dorferneuerung/';

async function frontpageMenu(menuUrl) {
  const $ = cheerio.load(await get(menuUrl, 'windows-1252'));
  return $('a').map((_, a) => ({ href: $(a).attr('href'), text: $(a).text().replace(/\s+/g, ' ').trim(), alt: $(a).find('img').attr('alt') })).get()
    .filter((l) => l.href && /\.htm$/i.test(l.href) && !DEAD.test(l.href) && !/^\.\.\//.test(l.href) && !/index\.htm$/i.test(l.href));
}

async function frontpagePage(url, assetDir, assetUrl, mapLink, alt) {
  const html = await get(url, 'windows-1252');
  if (!html) return null;
  const $ = cheerio.load(html);
  // sub-sections are framesets too: migrate their content frame
  if ($('frameset').length) {
    const frame = $('frame[name=Hauptframe]').attr('src') ?? $('frame').last().attr('src');
    return frame ? frontpagePage(new URL(frame, url).href, assetDir, assetUrl, mapLink, alt) : null;
  }
  return { url, title: $('title').text().replace(/\s+/g, ' ').trim(), html: await clean($('body').html() ?? '', { pageUrl: url, assetDir, assetUrl, host: 'nesselstauden.at', mapLink, alt }) };
}

// menu titles whose umlauts are already lost ('?') in the legacy source
// (plus sub-pages whose only "title" is a file name like indexgast.htm)
const DE_TITLES = {
  'aktion-bluehendes-noe': 'Blühendes NÖ', ortsankuender: 'Ortsankünder', buchpraesentation: 'Chronikpräsentation', buch: 'Chronik', 'muellinsel-und-parkplatz': 'Müllinsel und Parkplatz',
  'dorfchronik-buchteil1': 'Chronik – Teil 1', 'dorfchronik-buchteil2': 'Chronik – Teil 2', 'dorfchronik-buchteil3': 'Chronik – Teil 3', 'dorfchronik-buchteil4': 'Chronik – Teil 4',
  'schulema-indexma': 'Mittelalter-Projekt der Schule Maria Langegg', 'schulema-darbietung': 'Darbietung',
  'steinkreis-fotoausstellung-indexfoto': 'Steinkreis – Fotoausstellung', 'steinkreis-gaestebuch-indexgast': 'Steinkreis – Gästebuch', 'steinkreis-link-indexlink': 'Steinkreis – Links',
};

async function dorferneuerung() {
  const site = join(ROOT, 'dorferneuerung');
  const fpPath = new URL(FP).pathname.toLowerCase();
  const keyOf = (u) => decodeURIComponent(u.pathname).toLowerCase();
  const fileOf = (u) => decodeURIComponent(u.pathname).replace(/\.htm$/i, '');
  // menu pages keep their file name as slug; linked sub-pages get their path below FP
  const pages = new Map();
  const add = (u, menuTitle, order) => {
    const k = keyOf(u);
    if (!pages.has(k)) {
      const slug = /Begruessung/i.test(k) ? 'startseite'
        : slugify(menuTitle != null ? fileOf(u).split('/').pop() : fileOf(u).slice(fpPath.length));
      pages.set(k, { url: u.href, slug, menuTitle, order });
    }
    return pages.get(k);
  };
  for (const [i, l] of (await frontpageMenu(FP + 'Inhalt.htm')).entries()) {
    const u = new URL(l.href, FP);
    add(u, DE_TITLES[slugify(fileOf(u).split('/').pop())] ?? (l.text || l.alt || '').replace(/^\W+|\W+$/g, ''), i);
  }
  const mapLink = (u) => {
    if (/dorfinfo/i.test(u.pathname)) return '/../dorf-info/'; // withBase() turns this into <base>/../dorf-info/
    if (!/\.htm$/i.test(u.pathname) || !keyOf(u).startsWith(fpPath)) return undefined;
    const p = add(u);
    return p.slug === 'startseite' ? '/' : `/${p.slug}/`;
  };

  // Map iteration also visits pages that mapLink adds while we crawl
  let n = 0;
  const missing = [];
  for (const p of pages.values()) {
    const res = await frontpagePage(p.url, join(site, 'public/img'), '/img', mapLink, p.menuTitle ?? undefined);
    if (!res) { missing.push(p); continue; }
    const generic = !res.title || /^(neue seite|untitled|ohne titel)/i.test(res.title);
    const title = DE_TITLES[p.slug] ?? (p.menuTitle || (generic ? fileOf(new URL(p.url)).split('/').pop().replace(/_+/g, ' ') : res.title));
    const nav = p.menuTitle != null && p.slug !== 'startseite';
    await mkdir(join(site, 'src/content/pages'), { recursive: true });
    await writeFile(join(site, 'src/content/pages', `${p.slug}.md`), yaml({ title, order: p.order ?? 99, hidden: nav ? undefined : true }) + '\n' + res.html.replace(/alt=""/g, `alt="${title.replace(/"/g, '')}"`));
    n++;
  }
  // links to pages that could not be fetched must not point into the void
  for (const p of missing) {
    console.warn(`  ! missing ${p.url}`);
    for (const f of [...pages.values()].filter((x) => !missing.includes(x))) {
      const file = join(site, 'src/content/pages', `${f.slug}.md`);
      const src = await readFile(file, 'utf8');
      const out = src.replace(new RegExp(`<a href="/${p.slug}/">([\\s\\S]*?)</a>`, 'g'), '$1');
      if (out !== src) await writeFile(file, out);
    }
  }
  console.log(`  wrote ${n} pages (${n - [...pages.values()].filter((p) => p.menuTitle != null).length + missing.length} linked sub-pages)`);
}

async function start() {
  for (const f of ['ff_start.gif', 'haeuser.gif', 'dorfwappen_start.gif', 'knudde.gif'])
    await download(`https://www.nesselstauden.at/images/${f}`, join(ROOT, 'images', f));
  console.log('  startpage icons downloaded');
}

const jobs = {
  feuerwehr: () => joomla({
    origin: 'http://feuerwehr.nesselstauden.at', dir: 'feuerwehr', maxId: 200,
    menu: { Feuerwehr: 1, Info: 4, Feuerwehrhaus: 6, Fahrzeuge: 7, Mannschaft: 8, Erfolge: 23, Links: 9 },
    // the legacy articles are literally titled "Veranstaltungen"; 169 was filed under Einsätze
    overrides: { 165: { title: 'Kabarettabend am 29.09.2023' }, 167: { title: 'Oktoberfest 2023' }, 169: { title: 'Feuerwehrfest 2024 mit Bezirksbewerb', category: 'Veranstaltungen' } },
  }).then(() => phoca('http://feuerwehr.nesselstauden.at', 'feuerwehr')),
  'sv-knudde': async () => {
    await joomla({ origin: 'http://svknudde.nesselstauden.at', dir: 'sv-knudde', maxId: 80, menu: { Termine: 8, Vorstand: 5, Mannschaft: 6, 'Torschützenliste': 7, Vereinsgeschichte: 4 } });
    await phoca('http://svknudde.nesselstauden.at', 'sv-knudde');
  },
  dorferneuerung,
  start,
};

const only = process.argv[2];
for (const [name, fn] of Object.entries(jobs)) {
  if (only && only !== name) continue;
  console.log(`== ${name}`);
  await fn();
}
