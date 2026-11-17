// 언어 전환 (한국어 ↔ English).
// 코드와 저장 데이터는 한국어 원문을 그대로 쓰고, 화면에 나가는 경계에서만 번역한다:
//  - DOM: 텍스트 노드와 placeholder/title/aria-label/data-label 속성을 MutationObserver로 따라가며 바꾼다
//  - 캔버스: theme.js 의 text()/pill() 이 tr() 을 거친다
// 사용자가 쓴 글(별명·팀·커뮤니티 글)은 data-ugc 속성 아래에 두면 번역하지 않는다.
import { EN } from './i18n-en.js';

const KEY = 'puck-trainer.lang.v1';
const HANGUL = /[ㄱ-ㆎ가-힣]/;
const ATTRS = ['placeholder', 'title', 'aria-label', 'data-label'];
export const LANGS = ['ko', 'en'];

/** 저장된 선택이 없으면 브라우저 언어를 따른다 (한국어 브라우저 = 한국어, 그 밖 = 영어) */
export function detectLang(saved, navLang) {
  if (LANGS.includes(saved)) return saved;
  return /^ko\b/i.test(String(navLang || '')) ? 'ko' : 'en';
}

function readSaved() { try { return localStorage.getItem(KEY); } catch { return null; } }

// ---- 언어별 주소: 한국어 = /, 영어 = /en/ (검색엔진이 언어마다 따로 색인하도록 화면 언어는 주소로 정한다) ----
/** 주소 경로 -> 화면 언어 */
export const pageLang = (path) => (/^\/en(\/|$)/.test(String(path || '')) ? 'en' : 'ko');
/** 그 언어의 첫 화면 주소 (초대 코드 같은 ?c=… 와 #… 는 그대로) */
export const langUrl = (l, loc = globalThis.location) => (l === 'en' ? '/en/' : '/') + (loc?.search || '') + (loc?.hash || '');
/** 직접 고른 언어 (없으면 null) */
export const savedLang = () => { const s = readSaved(); return LANGS.includes(s) ? s : null; };
/** 고른 언어를 기억만 한다 (다른 주소로 옮겨 가기 전에) */
export function rememberLang(l) { if (LANGS.includes(l)) try { localStorage.setItem(KEY, l); } catch { /* 사생활 보호 모드 */ } }

const here = typeof document !== 'undefined' ? globalThis.location : null;
let lang = here ? pageLang(here.pathname) : detectLang(readSaved(), globalThis.navigator?.language);
/**
 * 예전에 다른 언어를 직접 골랐으면 그 언어 주소로 옮긴다 (첫 화면 두 주소에서만. 검색 크롤러는 고른 기록이 없어 그대로)
 * true 면 main.js 가 앱을 시작하지 않는다
 */
export const redirecting = !!(here && savedLang() && savedLang() !== lang && /^\/(index\.html)?$|^\/en\/?(index\.html)?$/.test(here.pathname));
if (redirecting) here.replace(langUrl(savedLang(), here));

// ---- 사전 준비: {0} 자리표시자가 있는 키는 패턴으로 컴파일 (고정 글자가 많은 것부터 시도) ----
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// {0} = 아무 글자(단, 조각 구분자 ' · ', ' — ', 줄바꿈은 넘지 않음), {0#} = 숫자(소수점·쉼표 포함)만
const HOLE = /(\{\d#?\})/;
const PATTERNS = Object.keys(EN).filter((k) => HOLE.test(k))
  .map((k) => ({
    re: new RegExp('^' + k.split(HOLE).map((part) => (/^\{\d#\}$/.test(part) ? '(\\d[\\d.,]*)' : /^\{\d\}$/.test(part) ? '((?:(?! · | — |\\n).)+?)' : escRe(part))).join('') + '$'),
    order: [...k.matchAll(/\{(\d)#?\}/g)].map((m) => Number(m[1])),
    out: EN[k],
    weight: k.replace(/\{\d#?\}/g, '').length,
  }))
  .sort((a, b) => b.weight - a.weight);

const cache = new Map();
/** 번역하지 못한 문구 (테스트·점검용) */
export const missing = new Set();

export const getLang = () => lang;

/** 한국어 원문 -> 현재 언어. 사전에 없으면 원문 그대로 */
export function tr(s) {
  if (lang === 'ko' || typeof s !== 'string' || !HANGUL.test(s)) return s;
  let out = cache.get(s);
  if (out !== undefined) return out;
  out = translate(s);
  if (cache.size > 4000) cache.clear();
  cache.set(s, out);
  return out;
}

function translate(s) {
  const lead = /^\s*/.exec(s)[0], trail = /\s*$/.exec(s.slice(lead.length))[0];
  const core = s.slice(lead.length, s.length - trail.length);
  if (!core) return s;
  const hit = lookup(core);
  if (hit !== null) return lead + hit + trail;
  // 통째로 없으면 구분자(줄바꿈, ' · ', ' — ')로 나눠 조각별로
  const parts = s.split(/(\n| · | — )/);
  if (parts.length > 1) {
    return parts.map((p, i) => (i % 2 || !HANGUL.test(p) ? p : translate(p))).join('');
  }
  missing.add(core);
  return s;
}

function lookup(core) {
  if (Object.prototype.hasOwnProperty.call(EN, core)) return EN[core];
  for (const p of PATTERNS) {
    const m = p.re.exec(core);
    if (!m) continue;
    const args = [];
    p.order.forEach((n, i) => { args[n] = m[i + 1]; });
    return p.out.replace(/\{(\d)\}/g, (_, n) => arg(args[Number(n)] ?? ''));
  }
  return null;
}

/** 자리표시자에 들어온 값: 사전에 그대로 있으면 번역(모드 이름·연령대 등), 아니면 원문 유지(별명 등) */
function arg(v) {
  if (!HANGUL.test(v)) return v;
  const t = v.trim();
  if (Object.prototype.hasOwnProperty.call(EN, t)) return v.replace(t, EN[t]);
  const hit = lookup(t);
  return hit !== null ? v.replace(t, hit) : v;
}

// ---- DOM ----
const textState = new WeakMap(); // Text -> { src, out }
const attrState = new WeakMap(); // Element -> { [attr]: { src, out } }
let observer = null;

const skip = (el) => !el || el.closest?.('[data-ugc], script, style');

function applyText(node) {
  const cur = node.nodeValue;
  const st = textState.get(node);
  if (lang === 'ko') {
    if (st) { textState.delete(node); if (st.out === cur) node.nodeValue = st.src; }
    return;
  }
  if (st && st.out === cur) return;            // 우리가 바꿔 둔 그대로
  if (!HANGUL.test(cur) || skip(node.parentElement)) { if (st) textState.delete(node); return; }
  const out = tr(cur);
  if (out !== cur) { textState.set(node, { src: cur, out }); node.nodeValue = out; }
}

function applyAttrs(el) {
  let st = attrState.get(el);
  for (const a of ATTRS) {
    if (!el.hasAttribute(a)) continue;
    const cur = el.getAttribute(a);
    const s = st?.[a];
    if (lang === 'ko') { if (s) { delete st[a]; if (s.out === cur) el.setAttribute(a, s.src); } continue; }
    if (s && s.out === cur) continue;
    if (!HANGUL.test(cur) || skip(el)) continue;
    const out = tr(cur);
    if (out !== cur) { if (!st) { st = {}; attrState.set(el, st); } st[a] = { src: cur, out }; el.setAttribute(a, out); }
  }
}

function walk(root) {
  if (root.nodeType === 3) { applyText(root); return; }
  if (root.nodeType !== 1) return;
  applyAttrs(root);
  const it = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  for (let n = it.nextNode(); n; n = it.nextNode()) { if (n.nodeType === 3) applyText(n); else applyAttrs(n); }
}

function onMutations(list) {
  for (const m of list) {
    if (m.type === 'characterData') applyText(m.target);
    else if (m.type === 'attributes') applyAttrs(m.target);
    else for (const n of m.addedNodes) walk(n);
  }
}

/** 페이지 전체에 현재 언어를 적용하고, 이후 바뀌는 내용도 따라가며 번역한다 */
export function initI18n() {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = lang;
  walk(document.documentElement);
  if (!observer) {
    observer = new MutationObserver(onMutations);
    observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  }
  paintButtons();
}

export function setLang(next) {
  if (!LANGS.includes(next) || next === lang) { paintButtons(); return; }
  lang = next;
  cache.clear();
  try { localStorage.setItem(KEY, lang); } catch { /* 사생활 보호 모드 */ }
  if (typeof document === 'undefined') return;
  document.documentElement.lang = lang;
  walk(document.documentElement);
  paintButtons();
  for (const fn of listeners) fn(lang);
}

const listeners = new Set();
/** 언어가 바뀔 때 다시 그려야 하는 화면(입력값 등 DOM 텍스트가 아닌 곳)을 위한 알림 */
export function onLangChange(fn) { listeners.add(fn); }

/** [data-lang] 버튼·링크: 누르면 pick(언어) (기본은 그 자리에서 전환), 현재 언어에 active 표시 */
export function bindLangButtons(root = document, pick = setLang) {
  root.querySelectorAll('[data-lang]').forEach((b) => b.addEventListener('click', (e) => { if (b.tagName === 'A') e.preventDefault(); pick(b.dataset.lang); }));
  paintButtons();
}

function paintButtons() {
  if (typeof document === 'undefined') return;
  document.querySelectorAll('[data-lang]').forEach((b) => {
    const on = b.dataset.lang === lang;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
  });
}
