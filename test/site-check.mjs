// 검색엔진·AI 검색용 파일 검사: tools/build-site.mjs 로 만든 파일이 최신인지, 페이지마다 검색 정보가 빠짐없는지.
// 사용: node test/site-check.mjs  (run.mjs 에서도 호출)
import { readFile, access } from 'node:fs/promises';
import { join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = normalize(join(fileURLToPath(import.meta.url), '..', '..'));
const HANGUL = /[ㄱ-ㆎ가-힣]/;

export async function checkSite() {
  const { staleFiles, translateHtml, pathOf } = await import('../tools/build-site.mjs');
  const { SITE, PAGES, DEF, VERIFY, UPDATED } = await import('../tools/site-content.mjs');
  const logs = [];
  let ok = true;
  const check = (name, cond, detail) => { logs.push(`${cond ? 'PASS' : 'FAIL'} ${name}${detail ? ' ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : ''}`); if (!cond) ok = false; };

  const stale = await staleFiles();
  check('SEO1 generated site files are up to date (node tools/build-site.mjs)', stale.length === 0, stale);

  const pages = [];
  for (const lang of ['ko', 'en']) for (const slug of ['', ...PAGES.map((p) => p.slug)]) pages.push({ lang, slug, file: `${pathOf(lang, slug).slice(1)}index.html`, url: SITE + pathOf(lang, slug) });
  const bad = [];
  for (const p of pages) {
    const h = await readFile(join(ROOT, p.file), 'utf8');
    const get = (re) => (re.exec(h) || [])[1];
    const title = get(/<title>([^<]+)<\/title>/), desc = get(/<meta name="description" content="([^"]+)"/);
    const canon = get(/<link rel="canonical" href="([^"]+)"/), og = get(/<meta property="og:image" content="([^"]+)"/);
    const alts = [...h.matchAll(/<link rel="alternate" hreflang="([^"]+)" href="([^"]+)"/g)].map((m) => `${m[1]}=${m[2]}`);
    let ld = null; try { ld = JSON.parse(get(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)); } catch { /* 아래에서 실패 */ }
    let ogFile = false; try { await access(join(ROOT, og.replace(SITE + '/', ''))); ogFile = true; } catch { /* 없음 */ }
    const problems = [];
    if (!h.startsWith('<!doctype html>\n') || !new RegExp(`<html lang="${p.lang}">`).test(h)) problems.push('doctype/lang');
    if (!title || title.length < 10 || title.length > 70) problems.push(`title(${title?.length})`);
    if (!desc || desc.length < 50 || desc.length > 200) problems.push(`description(${desc?.length})`);
    if (canon !== p.url) problems.push(`canonical ${canon}`);
    if (alts.join() !== [`ko=${SITE}${pathOf('ko', p.slug)}`, `en=${SITE}${pathOf('en', p.slug)}`, `x-default=${SITE}${pathOf('ko', p.slug)}`].join()) problems.push(`hreflang ${alts.join()}`);
    if (!ogFile) problems.push(`og:image ${og}`);
    if (!ld || !Array.isArray(ld['@graph'])) problems.push('json-ld');
    if (p.lang === 'en') { const left = []; translateHtml(h.replace(/<title>[^<]*<\/title>/, ''), (s) => { left.push(s); return s; }); if (left.length) problems.push(`korean text: ${left.slice(0, 3).join(' | ')}`); }
    if (!h.includes(DEF[p.lang])) problems.push('one-line definition');
    if (problems.length) bad.push(`${p.file}: ${problems.join(', ')}`);
  }
  check(`SEO2 ${pages.length} pages: title, description, canonical, hreflang pairs, share image, JSON-LD, definition; English pages have no Korean text`, bad.length === 0, bad);

  const home = await readFile(join(ROOT, 'index.html'), 'utf8');
  const faq = JSON.parse(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(await readFile(join(ROOT, 'faq/index.html'), 'utf8'))[1]);
  const faqPage = faq['@graph'].find((x) => x['@type'] === 'FAQPage');
  const app = JSON.parse(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(home)[1])['@graph'].find((x) => x['@type'] === 'WebApplication');
  check('SEO3 structured data: free web app (price 0) with 7 games, FAQ page answers every question', app?.offers?.price === '0' && app?.featureList?.length === 7 && app?.isAccessibleForFree === true
    && faqPage?.mainEntity?.length === PAGES.find((p) => p.slug === 'faq').ko.faq.length && faqPage.mainEntity.every((q) => q.acceptedAnswer.text.length > 20), { app: app?.name, faq: faqPage?.mainEntity?.length });
  check('SEO4 search engine ownership tags on the home page and the Google file', home.includes(`name="google-site-verification" content="${VERIFY.google}"`) && home.includes(`name="msvalidate.01" content="${VERIFY.bing}"`) && home.includes(`name="naver-site-verification" content="${VERIFY.naver}"`)
    && (await readFile(join(ROOT, VERIFY.googleFile), 'utf8')).trim() === `google-site-verification: ${VERIFY.googleFile}`);

  const sm = await readFile(join(ROOT, 'sitemap.xml'), 'utf8'), robots = await readFile(join(ROOT, 'robots.txt'), 'utf8'), llms = await readFile(join(ROOT, 'llms.txt'), 'utf8');
  const locs = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  check('SEO5 sitemap lists every page once with hreflang; robots allows all crawlers and points to the sitemap; llms.txt summarizes the site', locs.length === pages.length && pages.every((p) => locs.includes(p.url))
    && /User-agent: \*\nAllow: \/\n/.test(robots) && !/Disallow/.test(robots) && robots.includes(`Sitemap: ${SITE}/sitemap.xml`) && robots.trimEnd().endsWith(`#DaumWebMasterTool:${VERIFY.daum}`) && llms.startsWith('# Puck Dribble Trainer') && llms.includes(DEF.en) && llms.includes(DEF.ko), { locs: locs.length });

  // 네이버 서치어드바이저용: 사이트맵 날짜(lastmod) + RSS 피드. 페이지마다 날짜가 있고, RSS 에 모든 페이지가 한 번씩, 모든 페이지 head 가 RSS 를 알린다
  const lastmods = [...sm.matchAll(/<url>\s*<loc>([^<]+)<\/loc>\s*<lastmod>(\d{4}-\d{2}-\d{2})<\/lastmod>/g)].map((m) => m[1]);
  const feed = await readFile(join(ROOT, 'rss.xml'), 'utf8');
  const items = [...feed.matchAll(/<item>[\s\S]*?<link>([^<]+)<\/link>[\s\S]*?<pubDate>([^<]+)<\/pubDate>[\s\S]*?<\/item>/g)];
  const dates = Object.values(UPDATED);
  const rssLink = `<link rel="alternate" type="application/rss+xml" href="${SITE}/rss.xml" />`;
  const noRssLink = [];
  for (const p of pages) if (!(await readFile(join(ROOT, p.file), 'utf8')).includes(rssLink)) noRssLink.push(p.file);
  check('SEO6 sitemap has a lastmod for every page; rss.xml (RSS 2.0) lists every page once with a valid date; every page links the feed', lastmods.length === pages.length
    && dates.every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d)))
    && feed.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"') && feed.includes(`<link>${SITE}/</link>`)
    && items.length === pages.length && pages.every((p) => items.some((m) => m[1] === p.url)) && items.every((m) => !Number.isNaN(Date.parse(m[2])))
    && noRssLink.length === 0, { lastmods: lastmods.length, items: items.length, noRssLink });

  const yml = await readFile(join(ROOT, '.github/workflows/pages.yml'), 'utf8');
  const need = ['en', 'guide', 'games', 'faq', 'pages.css', 'robots.txt', 'sitemap.xml', 'rss.xml', 'llms.txt', '404.html', VERIFY.googleFile, `${VERIFY.indexnow}.txt`];
  check('SEO7 deploy copies the generated files', need.every((f) => new RegExp(`cp -r [^\\n]*\\b${f.replace('.', '\\.')}\\b`).test(yml)), need.filter((f) => !yml.includes(f)));

  // IndexNow: 키 파일 = 키, 바뀐 파일 → 알릴 주소 고르기, 배포 뒤 알림 작업
  const { urlsForFiles, payload, pageFiles } = await import('../tools/indexnow.mjs');
  let keyFile = null; try { keyFile = await readFile(join(ROOT, `${VERIFY.indexnow}.txt`), 'utf8'); } catch { /* 없음 */ }
  const picked = urlsForFiles(['guide/index.html', 'en/faq/index.html', 'src/app.js', 'sitemap.xml', 'index.html']);
  const body = payload(picked);
  check('SEO8 IndexNow: key file holds the key; changed page files map to their URLs (others ignored); every page has a URL; the deploy notifies after the site is live',
    /^[0-9a-f]{32}$/.test(VERIFY.indexnow) && keyFile === VERIFY.indexnow
    && picked.join() === [`${SITE}/`, `${SITE}/guide/`, `${SITE}/en/faq/`].join() && urlsForFiles(['src/app.js', 'README.md']).length === 0
    && pageFiles().size === pages.length && pages.every((p) => pageFiles().get(p.file) === p.url)
    && body.host === new URL(SITE).host && body.key === VERIFY.indexnow && body.keyLocation === `${SITE}/${VERIFY.indexnow}.txt`
    && /\n {2}indexnow:\n {4}needs: deploy\n/.test(yml) && /node tools\/indexnow\.mjs --all/.test(yml) && /node tools\/indexnow\.mjs \$\(git diff --name-only/.test(yml),
    { picked, keyFile });
  return { ok, logs };
}

if (process.argv[1] && normalize(process.argv[1]) === normalize(fileURLToPath(import.meta.url))) {
  const { ok, logs } = await checkSite();
  logs.forEach((l) => console.log(l));
  process.exit(ok ? 0 : 1);
}
