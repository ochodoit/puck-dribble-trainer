// 검색엔진·AI 검색용 정적 파일 만들기 (내용은 tools/site-content.mjs).
//   - index.html 의 <!-- seo:start --> ~ <!-- seo:end --> (제목·설명·canonical·hreflang·공유 미리보기·구조화 데이터·소유 확인)
//   - en/index.html : 영어 첫 화면. index.html 을 영어 사전(src/i18n-en.js)으로 미리 번역해 둔 것
//     (자바스크립트를 돌리지 않는 검색·AI 크롤러도 영어 내용을 본다. 앱은 주소로 언어를 정한다)
//   - guide/ games/ faq/ (+ en/…) 안내 페이지, sitemap.xml, robots.txt, llms.txt, 404.html, 구글 소유 확인 파일
// 사용: node tools/build-site.mjs          파일 쓰기
//       node tools/build-site.mjs --check  저장소의 파일이 최신인지 확인 (다르면 실패 — 테스트에서 씀)
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SITE, VERIFY, SAME_AS, DEF, NAME, HOME, GAMES, PAGES, UI } from './site-content.mjs';
import { icon, cameraDiagram, heightChart, puckSwatch } from './guide-art.mjs';

export const ROOT = normalize(join(fileURLToPath(import.meta.url), '..', '..'));
const LANGS = ['ko', 'en'];
const HANGUL = /[ㄱ-ㆎ가-힣]/;
const OG = { ko: '/icons/og-image.png', en: '/icons/og-image-en.png' };
const LOCALE = { ko: 'ko_KR', en: 'en_US' };
const SEO_START = '<!-- seo:start -->', SEO_END = '<!-- seo:end -->';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const unesc = (s) => String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, '\u00a0').replace(/&amp;/g, '&');
/** 글 안의 **굵게**, [글자](주소) */
const md = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>');
const plain = (s) => String(s).replace(/\*\*(.+?)\*\*/g, '$1').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

/** 언어별 경로: ko '/', '/guide/' · en '/en/', '/en/guide/' */
export const pathOf = (lang, slug = '') => (lang === 'en' ? '/en/' : '/') + (slug ? `${slug}/` : '');
const url = (p) => SITE + p;
const answer = (lang, a) => (a === '@DEF' ? DEF[lang] : a);

// ---------- <head> 검색 정보 ----------
function seoHead({ lang, slug = '', title, description, ogTitle, ld, extra = [] }) {
  const t = ogTitle || title;
  return [
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(description)}" />`,
    `<link rel="canonical" href="${url(pathOf(lang, slug))}" />`,
    ...LANGS.map((l) => `<link rel="alternate" hreflang="${l}" href="${url(pathOf(l, slug))}" />`),
    `<link rel="alternate" hreflang="x-default" href="${url(pathOf('ko', slug))}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="${esc(NAME[lang])}" />`,
    `<meta property="og:title" content="${esc(t)}" />`,
    `<meta property="og:description" content="${esc(description)}" />`,
    `<meta property="og:url" content="${url(pathOf(lang, slug))}" />`,
    `<meta property="og:image" content="${url(OG[lang])}" />`,
    '<meta property="og:image:width" content="1200" />',
    '<meta property="og:image:height" content="630" />',
    `<meta property="og:image:alt" content="${esc(NAME[lang])}" />`,
    `<meta property="og:locale" content="${LOCALE[lang]}" />`,
    `<meta property="og:locale:alternate" content="${LOCALE[lang === 'ko' ? 'en' : 'ko']}" />`,
    '<meta name="twitter:card" content="summary_large_image" />',
    `<meta name="twitter:title" content="${esc(t)}" />`,
    `<meta name="twitter:description" content="${esc(description)}" />`,
    `<meta name="twitter:image" content="${url(OG[lang])}" />`,
    ...extra,
    `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>`,
  ].join('\n  ');
}

// ---------- 구조화 데이터 (schema.org) ----------
const ORG = { '@type': 'Organization', '@id': `${SITE}/#org`, name: NAME.en, alternateName: NAME.ko, url: `${SITE}/`, logo: `${SITE}/icons/icon-512.png`, sameAs: SAME_AS };
const appLd = (lang) => ({
  '@type': 'WebApplication', '@id': `${url(pathOf(lang))}#app`, name: NAME[lang], alternateName: lang === 'ko' ? [NAME.en, 'Puck Trainer'] : [NAME.ko, 'Puck Trainer'],
  url: url(pathOf(lang)), description: DEF[lang], inLanguage: lang, availableLanguage: ['ko', 'en'],
  applicationCategory: 'SportsApplication', applicationSubCategory: lang === 'ko' ? '아이스하키 스틱핸들링 훈련 게임' : 'Ice hockey stickhandling training game',
  operatingSystem: 'Web browser (iPadOS, iOS, Android, Windows, macOS)', browserRequirements: lang === 'ko' ? '카메라와 최신 웹 브라우저' : 'A camera and a modern web browser',
  isAccessibleForFree: true, offers: { '@type': 'Offer', price: '0', priceCurrency: 'KRW' },
  image: url(OG[lang]), screenshot: url(OG[lang]), featureList: GAMES.map((g) => g[lang].name),
  publisher: { '@id': `${SITE}/#org` }, copyrightHolder: { '@type': 'Organization', name: 'ochodoit' },
});
const homeLd = (lang) => ({
  '@context': 'https://schema.org',
  '@graph': lang === 'ko'
    ? [ORG, { '@type': 'WebSite', '@id': `${SITE}/#website`, url: `${SITE}/`, name: NAME.ko, alternateName: [NAME.en, 'Puck Trainer'], inLanguage: 'ko', publisher: { '@id': `${SITE}/#org` } }, appLd('ko')]
    : [ORG, appLd('en')],
});
const crumbLd = (lang, page) => ({ '@type': 'BreadcrumbList', itemListElement: [
  { '@type': 'ListItem', position: 1, name: UI[lang].home, item: url(pathOf(lang)) },
  { '@type': 'ListItem', position: 2, name: page[lang].nav, item: url(pathOf(lang, page.slug)) },
] });
function pageLd(lang, page) {
  const p = page[lang];
  const graph = [{ '@type': 'WebPage', '@id': `${url(pathOf(lang, page.slug))}#page`, url: url(pathOf(lang, page.slug)), name: p.h1, description: p.description, inLanguage: lang,
    isPartOf: { '@id': `${SITE}/#website` }, about: { '@id': `${url(pathOf(lang))}#app` }, publisher: { '@id': `${SITE}/#org` } }, crumbLd(lang, page)];
  if (p.faq) graph.push({ '@type': 'FAQPage', mainEntity: p.faq.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: plain(answer(lang, a)) } })) });
  if (p.howto) {
    const ol = p.guide?.setup?.steps || p.sections?.find(([, b]) => Array.isArray(b) && b[0] === 'ol')?.[1][1] || [];
    graph.push({ '@type': 'HowTo', name: p.howto.name, step: p.howto.steps.map((name, i) => ({ '@type': 'HowToStep', position: i + 1, name, text: plain(ol[i] || name).replace(/^[^—]*—\s*/, '') })) });
  }
  if (page.slug === 'games') graph.push({ '@type': 'ItemList', name: p.gamesTitle, itemListElement: GAMES.map((g, i) => ({ '@type': 'ListItem', position: i + 1, name: g[lang].name, description: g[lang].what })) });
  return { '@context': 'https://schema.org', '@graph': [ORG, ...graph] };
}

// ---------- 첫 화면: index.html 검색 정보 + 영어판 ----------
const verifyTags = [
  `<meta name="google-site-verification" content="${VERIFY.google}" />`,
  `<meta name="msvalidate.01" content="${VERIFY.bing}" />`,
  `<meta name="naver-site-verification" content="${VERIFY.naver}" />`,
];

function homeSeo(lang) {
  const h = HOME[lang];
  return seoHead({ lang, title: h.title, description: h.description, ogTitle: h.ogTitle, ld: homeLd(lang), extra: lang === 'ko' ? verifyTags : [] });
}

function replaceSeo(html, block) {
  const a = html.indexOf(SEO_START), b = html.indexOf(SEO_END);
  if (a < 0 || b < a) throw new Error('index.html: <!-- seo:start --> / <!-- seo:end --> 표시가 없습니다');
  return html.slice(0, a + SEO_START.length) + '\n  ' + block + '\n  ' + html.slice(b);
}

/**
 * 정적 HTML의 글자·속성(placeholder·title·aria-label·data-label·alt)을 번역한다 — 화면의 i18n.js 가 하는 일과 같다.
 * script·style·주석과 data-ugc 아래(사용자 글·언어 버튼)는 그대로 둔다
 */
export function translateHtml(html, tr) {
  const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
  // 주석 · <!doctype> · script/style · 태그 · 글자 · (그 밖의 '<' 한 글자) — 모든 글자가 어느 하나에 걸려 빠지지 않게
  const re = /<!--[\s\S]*?-->|<![^>]*>|<(script|style)\b[\s\S]*?<\/\1>|<\/?[a-zA-Z][^>]*>|[^<]+|</g;
  const stack = [];
  let skip = -1, out = '';
  for (const m of html.matchAll(re)) {
    let t = m[0];
    if (t.startsWith('<!') || t === '<' || /^<(script|style)\b/i.test(t)) { out += t; continue; }
    if (t[0] === '<') {
      const name = (/^<\/?([a-zA-Z0-9-]+)/.exec(t) || [])[1]?.toLowerCase();
      if (t[1] === '/') {
        const i = stack.lastIndexOf(name);
        if (i >= 0) stack.length = i;
        if (skip >= 0 && stack.length < skip) skip = -1;
        out += t; continue;
      }
      const ugc = /\sdata-ugc(?=[\s=>/])/.test(t);
      if (skip < 0 && !ugc) {
        t = t.replace(/(\s(?:placeholder|title|aria-label|data-label|alt)=")([^"]*)"/g, (all, pre, v) => (HANGUL.test(v) ? `${pre}${esc(tr(unesc(v)))}"` : all));
      }
      if (!VOID.has(name) && !t.endsWith('/>')) { stack.push(name); if (ugc && skip < 0) skip = stack.length; }
      out += t; continue;
    }
    if (skip < 0 && HANGUL.test(t)) {
      const lead = /^\s*/.exec(t)[0], trail = /\s*$/.exec(t.slice(lead.length))[0];
      const core = unesc(t.slice(lead.length, t.length - trail.length)).replace(/\s+/g, ' ');
      out += lead + esc(tr(core)).replace(/&quot;/g, '"') + trail;
    } else out += t;
  }
  return out;
}

async function englishHome(koHtml) {
  const { tr, setLang } = await import('../src/i18n.js');
  setLang('en');
  let h = replaceSeo(koHtml, homeSeo('en'));
  h = h.replace('<html lang="ko">', '<html lang="en">');
  // 영어판은 /en/ 아래에 있으므로 상대 주소(style.css, src/…, icons/…)가 첫 화면과 같은 곳을 가리키게
  h = h.replace('<meta charset="UTF-8" />', '<meta charset="UTF-8" />\n  <base href="/" />');
  h = translateHtml(h, tr);
  // 안내 페이지 링크는 영어판으로, 언어 안내는 한국어 쪽으로
  for (const p of PAGES) h = h.split(`href="${pathOf('ko', p.slug)}"`).join(`href="${pathOf('en', p.slug)}"`);
  h = h.replace('<a href="/en/" data-lang="en" lang="en">English version →</a>', '<a href="/" data-lang="ko" lang="ko">한국어로 보기 →</a>');
  setLang('ko');
  return h;
}

// ---------- 안내 페이지 ----------
const PAGE_CSP = "default-src 'self'; script-src 'self' https://www.googletagmanager.com; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: https://*.google-analytics.com https://*.googletagmanager.com; connect-src 'self' https://*.google-analytics.com https://*.analytics.google.com https://*.googletagmanager.com; object-src 'none'; base-uri 'self'; form-action 'self'";
const FONTS = 'https://fonts.googleapis.com/css2?family=Caveat:wght@700&family=Fraunces:opsz,wght@9..144,700..900&family=Noto+Sans+KR:wght@400;500;700&family=Noto+Serif+KR:wght@700;900&family=Poppins:wght@400;500;600&display=swap';

function block(b) {
  if (typeof b === 'string') return `<p>${md(b)}</p>`;
  const [tag, items] = b;
  return `<${tag}>${items.map((x) => `<li>${md(x)}</li>`).join('')}</${tag}>`;
}

function shell(lang, { head, body, slug = '', wide = false }) {
  const u = UI[lang], other = u.otherLang;
  const nav = PAGES.map((q) => `<a href="${pathOf(lang, q.slug)}"${q.slug === slug ? ' aria-current="page"' : ''}>${esc(q[lang].nav)}</a>`).join('');
  return `<!doctype html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${PAGE_CSP}" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="theme-color" content="#F4F1EA" />
  ${head}
  <link rel="icon" href="/favicon.ico" sizes="48x48" />
  <link rel="icon" href="/icons/icon.svg" type="image/svg+xml" />
  <link rel="icon" href="/icons/icon-192.png" sizes="192x192" type="image/png" />
  <link rel="apple-touch-icon" href="/icons/icon-180.png" />
  <link rel="manifest" href="/manifest.webmanifest" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="${FONTS}" rel="stylesheet" />
  <link href="/pages.css" rel="stylesheet" />
  <script type="module" src="/src/page.js"></script>
</head>
<body${wide ? ' class="wide"' : ''}>
  <header class="top">
    <a class="brand" href="${pathOf(lang)}">Puck Dribble <span>Trainer</span></a>
    <nav class="links" aria-label="${esc(u.navLabel)}">${nav}<a class="lang" href="${pathOf(other, slug)}" hreflang="${other}" lang="${other}" data-ugc>${esc(u.other)}</a></nav>
  </header>
  <main class="doc${wide ? ' guide-doc' : ''}">
${body}
  </main>
  <footer class="foot">
    <nav aria-label="${esc(u.navLabel)}"><a href="${pathOf(lang)}">${esc(u.home)}</a>${nav}</nav>
    <p>${esc(u.analytics)}</p>
    <p>${esc(u.copyright)}</p>
  </footer>
</body>
</html>
`;
}

/**
 * 사용 가이드: 디자인된 한 장짜리 안내. 왼쪽(휴대폰·태블릿은 위쪽)에 스크롤을 따라다니는 목차,
 * 핵심은 그림·카드로 짧게, 자세한 내용은 펼쳐 보기(details). 그림은 tools/guide-art.mjs, 모양은 pages.css
 */
function guidePage(lang, page) {
  const p = page[lang], g = p.guide, u = UI[lang];
  const secs = [g.glance, g.camera, g.puck, g.screens, g.setup, g.routine, g.headsup, g.cautions, g.help];
  const no = (i) => String(i + 1).padStart(2, '0');
  const head = (s, i) => `<h2><span class="g-no">${no(i)}</span>${esc(s.title)}</h2>`;
  const lead = (s) => (s.lead ? `<p class="g-lead">${md(s.lead)}</p>` : '');
  const html = {
    glance: (s) => `<ol class="g-steps">${s.steps.map(([ic, t, d], i) => `<li><span class="g-step-no">${i + 1}</span>${icon(ic)}<b>${esc(t)}</b><span>${esc(d)}</span></li>`).join('')}</ol>
      <div class="g-rules"><p class="g-rules-h">${esc(s.rulesTitle)}</p><ul>${s.rules.map(([big, small]) => `<li><b>${esc(big)}</b><span>${esc(small)}</span></li>`).join('')}</ul></div>`,
    camera: (s) => `<div class="g-two"><figure class="g-fig">${cameraDiagram(s.art, s.artLabel)}</figure>
      <figure class="g-fig"><figcaption><b>${esc(s.chart.title)}</b><span>${esc(s.chart.note)}</span></figcaption>${heightChart(s.chart.rows, s.chart)}</figure></div>
      <ul class="g-points">${s.points.map((x) => `<li>${md(x)}</li>`).join('')}</ul>${s.tv ? `
      <div class="g-tv">${icon('tv')}<div><h3>${esc(s.tv.title)}</h3><ul class="g-points">${s.tv.items.map((x) => `<li>${md(x)}</li>`).join('')}</ul></div></div>` : ''}`,
    puck: (s) => `<ul class="g-swatches">${s.cards.map(([sw, label]) => `<li class="${sw.ok ? 'ok' : 'no'}">${puckSwatch(sw)}<span>${esc(label)}</span></li>`).join('')}</ul>
      <p class="g-note">${md(s.note)}</p>${s.floors ? `
      <div class="g-floors"><h3>${esc(s.floors.title)}</h3><p class="g-floors-note">${esc(s.floors.note)}</p><ul>${s.floors.items.map(([f, tip, score, ok]) => `<li class="${ok ? 'ok' : 'warn'}"><b>${esc(f)}</b><span>${esc(tip)}</span>${score ? `<em>${esc(score)}</em>` : ''}</li>`).join('')}</ul></div>` : ''}`,
    screens: (s) => `<ol class="g-screens">${s.options.map(([icons, title, tag, pros, how], i) => `<li class="g-screen${i === 0 ? ' g-first' : ''}">
        <div class="g-screen-head"><span class="g-rank">${i + 1}</span><span class="g-icons">${icons.map((n) => icon(n)).join('<i aria-hidden="true">+</i>')}</span>${tag ? `<em class="g-tag">${esc(tag)}</em>` : ''}</div>
        <h3>${esc(title)}</h3><p class="g-pros">${esc(pros)}</p>
        <details><summary>${esc(s.howLabel)}</summary><p>${md(how)}</p></details></li>`).join('')}</ol>
      <ul class="g-chips">${s.tips.map((x) => `<li>${md(x)}</li>`).join('')}</ul>`,
    setup: (s) => `<ol class="g-setup">${s.steps.map((x) => `<li>${md(x)}</li>`).join('')}</ol>`,
    routine: (s) => `<div class="g-bar" aria-hidden="true">${s.items.map(([, m], i) => `<span class="m${m} c${i + 1}">${m}</span>`).join('')}</div>
      <ol class="g-routine">${s.items.map(([n, m, d], i) => `<li class="c${i + 1}"><b>${esc(n)}</b><span class="g-min">${m}${esc(s.unit)}</span><span>${esc(d)}</span></li>`).join('')}</ol>`,
    headsup: (s) => `<div class="g-headsup">${icon('eye')}<p>${md(s.text)}</p></div>`,
    cautions: (s) => `<ul class="g-cautions">${s.items.map(([ic, t, d]) => `<li>${icon(ic)}<b>${esc(t)}</b><span>${esc(d)}</span></li>`).join('')}</ul>`,
    help: (s) => `<div class="g-help">${s.items.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${md(a)}</p></details>`).join('')}</div>`,
  };
  const keys = ['glance', 'camera', 'puck', 'screens', 'setup', 'routine', 'headsup', 'cautions', 'help'];
  const body = [
    '    <div class="guide">',
    `      <div class="g-hero"><nav class="crumb" aria-label="${esc(u.crumbLabel)}"><a href="${pathOf(lang)}">${esc(u.home)}</a> › <span>${esc(p.nav)}</span></nav>`,
    `      <h1>${esc(p.h1)}</h1>`,
    `      <p class="lead">${esc(DEF[lang])} ${esc(p.lead)}</p></div>`,
    `      <nav class="toc" aria-label="${esc(g.toc)}"><p class="toc-h">${esc(g.toc)}</p><ol>${secs.map((s, i) => `<li><a href="#${s.id}"><span class="toc-no">${no(i)}</span>${esc(s.toc)}</a></li>`).join('')}</ol></nav>`,
    '      <div class="g-body">',
    ...keys.map((k, i) => `      <section class="g-sec gs-${k}" id="${secs[i].id}">${head(secs[i], i)}${lead(secs[i])}\n      ${html[k](secs[i])}</section>`),
    `      <p class="cta"><a class="btn" href="${pathOf(lang)}">${esc(u.start)}</a></p>`,
    '      </div>',
    '    </div>',
  ].join('\n');
  const headTags = seoHead({ lang, slug: page.slug, title: p.title, description: p.description, ld: pageLd(lang, page) });
  return shell(lang, { head: headTags, body, slug: page.slug, wide: true });
}

function contentPage(lang, page) {
  if (page[lang].guide) return guidePage(lang, page);
  const p = page[lang], u = UI[lang];
  const parts = [
    `    <nav class="crumb" aria-label="${esc(u.crumbLabel)}"><a href="${pathOf(lang)}">${esc(u.home)}</a> › <span>${esc(p.nav)}</span></nav>`,
    `    <h1>${esc(p.h1)}</h1>`,
    `    <p class="lead">${esc(DEF[lang])} ${esc(p.lead)}</p>`,
  ];
  if (page.slug === 'games') {
    parts.push(`    <h2>${esc(p.gamesTitle)}</h2>`);
    parts.push('    <div class="games">' + GAMES.map((g, i) => `<article class="game" id="${g.id}"><span class="no">${String(i + 1).padStart(2, '0')}</span><h3>${esc(g[lang].name)}</h3><p>${md(g[lang].what)}</p><p class="skills"><b>${esc(p.skillsLabel)}</b> ${esc(g[lang].skills)}</p></article>`).join('') + '</div>');
  }
  for (const [h, ...blocks] of p.sections || []) parts.push(`    <h2>${esc(h)}</h2>`, ...blocks.map((b) => `    ${block(b)}`));
  if (p.faq) parts.push('    <div class="faq">' + p.faq.map(([q, a]) => `<section class="qa"><h2>${esc(q)}</h2><p>${md(answer(lang, a))}</p></section>`).join('') + '</div>');
  parts.push(`    <p class="cta"><a class="btn" href="${pathOf(lang)}">${esc(u.start)}</a></p>`);
  const head = seoHead({ lang, slug: page.slug, title: p.title, description: p.description, ld: pageLd(lang, page) });
  return shell(lang, { head, body: parts.join('\n'), slug: page.slug });
}

function notFound() {
  const head = '<meta name="robots" content="noindex" />\n  <title>페이지를 찾을 수 없습니다 · Page not found — 퍽 드리블 트레이너</title>';
  const body = `    <h1>페이지를 찾을 수 없습니다</h1>
    <p>주소가 바뀌었거나 없는 페이지입니다.</p>
    <p class="cta"><a class="btn" href="/">${esc(NAME.ko)} 첫 화면으로</a></p>
    <h2 lang="en">Page not found</h2>
    <p lang="en">This address has moved or does not exist.</p>
    <p class="cta" lang="en"><a class="btn" href="/en/">Go to ${esc(NAME.en)}</a></p>`;
  return shell('ko', { head, body });
}

// ---------- sitemap·robots·llms ----------
function sitemap() {
  const slugs = ['', ...PAGES.map((p) => p.slug)];
  const rows = [];
  for (const slug of slugs) for (const lang of LANGS) {
    rows.push(`  <url>
    <loc>${url(pathOf(lang, slug))}</loc>
${LANGS.map((l) => `    <xhtml:link rel="alternate" hreflang="${l}" href="${url(pathOf(l, slug))}" />`).join('\n')}
    <xhtml:link rel="alternate" hreflang="x-default" href="${url(pathOf('ko', slug))}" />
  </url>`);
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${rows.join('\n')}
</urlset>
`;
}

const robots = () => `# Puck Dribble Trainer (puck-trainer.com)
# All search engines and AI search / answer crawlers (Googlebot, Bingbot, Yeti, GPTBot, OAI-SearchBot,
# ChatGPT-User, ClaudeBot, Claude-SearchBot, PerplexityBot, Google-Extended, ...) may crawl everything.
User-agent: *
Allow: /

Sitemap: ${SITE}/sitemap.xml
${VERIFY.daum ? `
#DaumWebMasterTool:${VERIFY.daum}
` : ''}`;

function llms() {
  const link = (lang, slug, label) => `[${label}](${url(pathOf(lang, slug))})`;
  return `# ${NAME.en} (${NAME.ko})

> ${DEF.en}

${DEF.ko}

## Key facts
- Price: free to play. Members (joined with an invite code) also get leaderboards and community posting.
- Devices: iPad and tablets, iPhone and Android phones, laptops with a webcam. Runs in a modern browser; can be added to the home screen.
- Privacy: the camera video is processed on the device only. It is never saved or uploaded. Visits and plays are counted with Google Analytics without personal details.
- Any object can be the puck: a puck, a ball or a bottle cap that stands out from the floor. A white pad or a plain mat works best.
- Languages: Korean (${SITE}/) and English (${SITE}/en/).
- Leaderboards: world, country, team and age group (U8–U18, adult, senior).

## The 7 games
${GAMES.map((g) => `- **${g.en.name}** (${g.ko.name}): ${g.en.what} Trains: ${g.en.skills}.`).join('\n')}

## Pages
- ${link('en', '', 'Play (English)')} · ${link('ko', '', '플레이 (한국어)')}
${PAGES.map((p) => `- ${link('en', p.slug, p.en.h1)} · ${link('ko', p.slug, p.ko.h1)}`).join('\n')}
`;
}

// ---------- 모으기 ----------
/** 만들 파일 전부: { 저장소 기준 경로: 내용 } */
export async function buildSite(root = ROOT) {
  const files = {};
  const koHtml = replaceSeo(await readFile(join(root, 'index.html'), 'utf8'), homeSeo('ko'));
  files['index.html'] = koHtml;
  files['en/index.html'] = await englishHome(koHtml);
  for (const page of PAGES) for (const lang of LANGS) files[`${pathOf(lang, page.slug).slice(1)}index.html`] = contentPage(lang, page);
  files['sitemap.xml'] = sitemap();
  files['robots.txt'] = robots();
  files['llms.txt'] = llms();
  files['404.html'] = notFound();
  files[VERIFY.googleFile] = `google-site-verification: ${VERIFY.googleFile}`;
  return files;
}

/** 저장소의 파일과 다른 것 목록 (없으면 최신) */
export async function staleFiles(root = ROOT) {
  const files = await buildSite(root);
  const out = [];
  for (const [p, content] of Object.entries(files)) {
    let cur = null;
    try { cur = (await readFile(join(root, p), 'utf8')).replace(/\r\n/g, '\n'); } catch { /* 없음 */ }
    if (cur !== content) out.push(p);
  }
  return out;
}

if (process.argv[1] && normalize(process.argv[1]) === normalize(fileURLToPath(import.meta.url))) {
  if (process.argv.includes('--check')) {
    const stale = await staleFiles();
    for (const p of stale) console.log(`STALE ${p}`);
    console.log(stale.length ? 'FAIL site files are out of date: run node tools/build-site.mjs' : 'PASS site files are up to date');
    process.exit(stale.length ? 1 : 0);
  }
  const files = await buildSite();
  for (const [p, content] of Object.entries(files)) {
    await mkdir(dirname(join(ROOT, p)), { recursive: true });
    await writeFile(join(ROOT, p), content, 'utf8');
  }
  console.log(`wrote ${Object.keys(files).length} files: ${Object.keys(files).join(', ')}`);
}
