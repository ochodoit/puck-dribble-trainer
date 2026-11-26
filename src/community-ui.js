// 커뮤니티 화면: 글 목록(코스 공유 · 기록 자랑 · 기록 갱신), 글쓰기, 기록 게시판.
// 글을 누르면 오른쪽(좁은 화면은 글 아래)에 도전한 사람 수와 상위 5위 기록이 보인다.
// 저장은 community.js 의 저장소가 맡고, 게임 쪽 동작(코스 불러오기 등)은 host 콜백으로 넘긴다.
import { boardFor, challengerCount, postAge, bragKey, BOARD_TOP, TITLE_MAX, BODY_MAX } from './community.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sec = (v) => `${Number(v).toFixed(1)}s`;
/** 저장된 숫자 칸을 HTML에 넣을 때: 숫자가 아니면 0 (조작된 글로 HTML이 끼어들지 못하게) */
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/** 글 종류 꼬리표: 보기 버튼(코스 · 기록 자랑)과 같은 말 + 기록 갱신 */
export const postTag = (p) => (p.type === 'course' ? '코스' : p.type === 'beat' ? '기록 갱신' : '기록 자랑');

export function timeAgo(at, now = Date.now()) {
  const m = Math.floor((now - at) / 60000);
  if (m < 1) return '방금';
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  return `${Math.floor(h / 24)}일 전`;
}

/** 코스 미리보기 (번호 순서대로 선으로 잇고, 1번은 빨간 점) */
export function courseSvg(points, w = 132, h = 92) {
  const pts = [...(points || [])].sort((a, b) => a.n - b.n);
  const X = (p) => (10 + p.x * (w - 20)).toFixed(1), Y = (p) => (10 + p.y * (h - 20)).toFixed(1);
  const path = pts.length > 1 ? `<polygon class="cs-line" points="${pts.map((p) => `${X(p)},${Y(p)}`).join(' ')}" />` : '';
  const dots = pts.map((p, i) => `<circle class="cs-dot${i === 0 ? ' first' : ''}" cx="${X(p)}" cy="${Y(p)}" r="7.5" /><text class="cs-n${i === 0 ? ' first' : ''}" x="${X(p)}" y="${Y(p)}">${num(p.n)}</text>`).join('');
  return `<svg class="course-svg" viewBox="0 0 ${w} ${h}" role="img" aria-label="코스 미리보기"><rect class="cs-field" x="1" y="1" width="${w - 2}" height="${h - 2}" rx="8" />${path}${dots}</svg>`;
}

/**
 * host: {
 *   getUser(), blocked(): 막힌 이유 | null (베타 종료 등), getStore(): Promise<store>, toast(msg), modeName(id), countryLabel(code), modes: [{id, name}],
 *   shareDraft(): { course: {points, cycles, record}|null, result: {modeId, seconds, score, invisible}|null },
 *   onPractice(post), onChallengeMode(post), onOpen()
 * }
 */
export function initCommunity(host) {
  const $ = (s) => document.querySelector(s);
  const panel = $('#panel-community'), list = $('#comm-list'), detail = $('#comm-detail'), form = $('#comm-form'), note = $('#comm-note');
  const state = { filter: 'all', mode: '', sort: 'recent', selected: null, draft: null, posts: [], origins: new Map() };

  // 모드 거르기: 모든 모드 + 게임 모드 (코스 글은 자유 연습)
  const modeSel = $('#comm-mode');
  modeSel.innerHTML = '<option value="">모든 모드</option>' + host.modes.map((m) => `<option value="${esc(m.id)}">${esc(m.name)}</option>`).join('');

  /** 기록 자랑의 모드 표시: 아케이드 · 1분 · 투명 */
  const stagesOf = (id) => host.modes.find((m) => m.id === id)?.stages || 0;
  const minLabel = (p) => (stagesOf(p.modeId) ? `${Math.round(p.seconds / 60)}분 × ${stagesOf(p.modeId)}` : `${Math.round(p.seconds / 60)}분`);
  const modeLabel = (p) => [host.modeName(p.modeId), p.seconds ? minLabel(p) : '', p.invisible ? '투명' : ''].filter(Boolean).join(' · ');
  const jersey = (n) => (Number.isInteger(n) ? `<span class="jersey">#${n}</span>` : '');

  const who = (p) => {
    if (p.official) return '<b>Puck Trainer</b><span class="tag">예시 코스</span>';
    const bits = [p.team ? `<span data-ugc>${esc(p.team)}</span>` : '', p.country ? `<span>${esc(host.countryLabel(p.country))}</span>` : '', p.ageGroup ? `<span>${esc(p.ageGroup)}</span>` : ''].filter(Boolean).join('<i>·</i>');
    return `<b data-ugc>${esc(p.nick)}</b>${jersey(p.number)}${bits ? `<span class="who-more">${bits}</span>` : ''}<time>${timeAgo(p.at)}</time>`;
  };

  /** 기록 갱신 글은 원본 코스 글의 게시판을 보여준다 (목록에 없으면 따로 불러와 둔다) */
  const boardPost = (p) => (p.type === 'beat' && p.ref ? state.posts.find((x) => x.id === p.ref.id) || state.origins.get(p.ref.id) || null : p);

  /** 카드 아래 한 줄 요약: 도전 인원 + 1위 (누르면 상위 5위) */
  function summaryHtml(p) {
    const bp = boardPost(p);
    if (!bp) return '<p class="post-sum"><span>원본 코스 기록 보기</span><i>›</i></p>';
    const rows = boardFor(bp), n = challengerCount(bp);
    const top = rows[0];
    const lead = top ? `<span>1위</span> <b data-ugc>${esc(top.nick)}</b> <strong>${bp.type === 'record' ? `${num(top.score)}점` : `평균 ${sec(top.avg)}`}</strong>` : '<span>아직 기록 없음</span>';
    const limit = bp.type === 'record' ? postAge(bp) : null;
    return `<p class="post-sum"><span class="cnt">도전 ${n}명</span>${lead}${limit !== null ? `<span class="age">${num(limit)}세 이하 기록</span>` : ''}<i>상위 ${BOARD_TOP}위 ›</i></p>`;
  }

  /** 상위 5위 기록 (글을 눌렀을 때) */
  function detailHtml(p) {
    if (!p) return `<p class="detail-empty">글을 누르면 도전한 사람 수와 상위 ${BOARD_TOP}위 기록이 여기에 보입니다.</p>`;
    const bp = boardPost(p);
    const me = host.getUser();
    const tag = postTag(p);
    const sub = p.type === 'record' ? modeLabel(p) : bp?.course ? `${num(bp.course.length)} 포인트 · ${num(bp.cycles)} 사이클` : '';
    const head = `<div class="detail-head"><span class="post-tag">${tag}</span><h4${p.official ? '' : ' data-ugc'}>${esc(bp && bp !== p ? bp.title : p.title)}</h4>${sub ? `<small>${esc(sub)}</small>` : ''}</div>`;
    if (!bp) return `${head}<p class="post-empty">원본 코스 글을 찾을 수 없습니다 (지워졌을 수 있습니다)</p>`;
    const rows = boardFor(bp), n = challengerCount(bp);
    const limit = bp.type === 'record' ? postAge(bp) : null;
    const ruleText = limit !== null ? `${limit}세 이하만 기록이 올라갑니다 — 글쓴이와 나이가 같거나 어린 선수. 나이가 많아도 연습은 할 수 있습니다.` : '누구나 기록이 올라갑니다.';
    const rule = bp.type === 'record' ? `<p class="detail-rule">${ruleText}</p>` : '';
    const items = rows.slice(0, BOARD_TOP).map((r) => `<li class="${r.rank === 1 ? 'holder' : ''}${me && r.uid === me.id ? ' me' : ''}">
      <span class="rk">${r.rank}</span><b data-ugc>${esc(r.nick)}</b>${jersey(r.number)}${r.author ? '<em>글쓴이</em>' : '<em class="sp"></em>'}${bp.type === 'record'
        ? `<span class="t">${num(r.score)}점</span><small></small>`
        : `<span class="t">평균 ${sec(r.avg)}</span><small>최고 ${sec(r.best)}</small>`}</li>`).join('');
    const board = rows.length ? `<ol class="detail-board">${items}</ol>` : '<p class="post-empty">아직 기록이 없습니다 — 첫 기록의 주인공이 되어 보세요</p>';
    const top = rows[0];
    const taken = bp.type !== 'record' && top && !top.author && bp.record ? `<p class="post-taken"><span>글쓴이의 기록이 깨졌습니다 — 현재 1위</span> <b data-ugc>${esc(top.nick)}</b></p>` : '';
    const act = p.type === 'record'
      ? '<button type="button" class="btn btn-primary" data-act="mode">나도 연습하기</button>'
      : '<button type="button" class="btn btn-primary" data-act="practice">이 코스 연습하기</button>';
    return `${head}<p class="detail-count"><b>${n}</b><span>명 도전</span></p>${rule}<small class="board-title">Top ${BOARD_TOP}</small>${board}${taken}<div class="detail-act">${act}</div>`;
  }

  function postHtml(p) {
    const me = host.getUser();
    const mine = me && p.uid === me.id && !p.official;
    const ugc = p.official ? '' : ' data-ugc';
    const cheers = (p.cheers || []).length, cheered = me && (p.cheers || []).includes(me.id);
    const tag = postTag(p);
    let main = '';
    if (p.type === 'record') {
      main = `<div class="post-score"><b>${Number(p.score)}</b><span>${esc(modeLabel(p))}</span></div>`;
    } else {
      const beat = p.type === 'beat' && p.ref
        ? `<p class="beat-line"><span>갈아치운 기록</span> <b data-ugc>${esc(p.ref.nick)}</b><strong>평균 ${sec(p.ref.avg)} → ${sec(p.record.avg)}</strong></p>` : '';
      main = `<div class="course-box">${courseSvg(p.course)}<div class="post-meta"><span class="post-size">${num(p.course.length)} 포인트 · ${num(p.cycles)} 사이클</span>${beat}</div></div>`;
    }
    const act = p.type === 'record'
      ? '<button type="button" class="btn btn-primary" data-act="mode">나도 연습하기</button>'
      : '<button type="button" class="btn btn-primary" data-act="practice">이 코스 연습하기</button>';
    const sel = state.selected === p.id;
    return `<article class="post post-${p.type}${sel ? ' selected' : ''}" data-id="${esc(p.id)}" tabindex="0" aria-selected="${sel}">
      <div class="post-head"><span class="post-tag">${tag}</span>${who(p)}</div>
      <h3${ugc}>${esc(p.title)}</h3>
      ${p.body ? `<p class="post-body"${ugc}>${esc(p.body)}</p>` : ''}
      ${main}
      ${summaryHtml(p)}
      <div class="post-foot">${act}
        <button type="button" class="btn btn-ghost cheer${cheered ? ' on' : ''}" data-act="cheer" aria-label="응원">👏 <span>${cheers}</span></button>
        ${mine ? '<button type="button" class="btn btn-ghost" data-act="delete">삭제</button>' : ''}
      </div>
      ${sel ? `<div class="post-detail">${detailHtml(p)}</div>` : ''}
    </article>`;
  }

  function paintBar() {
    document.querySelectorAll('#comm-filter button').forEach((b) => b.classList.toggle('active', b.dataset.filter === state.filter));
    document.querySelectorAll('#comm-sort button').forEach((b) => b.classList.toggle('active', b.dataset.sort === state.sort));
    modeSel.value = state.mode;
  }

  function paintList() {
    list.innerHTML = state.posts.length ? state.posts.map(postHtml).join('') : '<p class="muted comm-empty">아직 글이 없습니다. 첫 글을 올려 보세요.</p>';
    detail.innerHTML = detailHtml(state.posts.find((p) => p.id === state.selected) || null);
  }

  async function refresh() {
    const store = await host.getStore();
    const u = host.getUser();
    note.innerHTML = `<span>${store.kind === 'firebase'
      ? '온라인 커뮤니티 — 모든 기기의 글과 기록이 함께 보입니다.'
      : '아직 온라인 연결 전이라 글과 기록은 이 기기에만 저장됩니다 — 이 기기를 함께 쓰는 선수들끼리 볼 수 있어요.'}</span>${
      u ? '' : ' <span>글쓰기·기록 등록은 로그인 후 가능합니다 (첫 화면에서 로그인).</span>'}`;
    paintBar();
    try {
      state.posts = await store.list({ type: state.filter, mode: state.mode, sort: state.sort });
      if (state.selected && !state.posts.some((p) => p.id === state.selected)) state.selected = null;
      paintList();
      // 기록 갱신 글의 원본 코스가 목록에 없으면 불러와서 요약·게시판을 채운다
      const missing = [...new Set(state.posts.filter((p) => p.type === 'beat' && p.ref && !state.posts.some((x) => x.id === p.ref.id) && !state.origins.has(p.ref.id)).map((p) => p.ref.id))];
      if (missing.length) {
        await Promise.all(missing.map(async (id) => { try { const o = await store.get(id); if (o) state.origins.set(id, o); } catch { /* 지워진 글 */ } }));
        paintList();
      }
    } catch (err) {
      list.innerHTML = `<p class="error">글을 불러오지 못했습니다: ${esc(err.message || err)}</p>`;
      detail.innerHTML = '';
    }
  }

  function select(id, scroll = false) {
    state.selected = state.selected === id && !scroll ? null : id;
    paintList();
    if (scroll && state.selected) list.querySelector(`.post[data-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest' });
  }

  // ---- 글쓰기 ----
  function paintForm() {
    const d = state.draft;
    if (!d) { form.classList.add('hidden'); return; }
    form.classList.remove('hidden');
    document.querySelectorAll('#comm-type button').forEach((b) => b.classList.toggle('active', b.dataset.type === (d.type === 'beat' ? 'course' : d.type)));
    $('#comm-type').classList.toggle('hidden', d.type === 'beat');
    const pv = $('#comm-preview');
    let ok = true;
    $('#comm-submit').textContent = '올리기';
    if (d.type === 'record') {
      if (d.result) {
        const old = d.existing;
        // 기록 자랑은 모드(모드·시간·투명)마다 하나: 이미 있으면 그 글이 새 기록으로 바뀐다
        const replace = old ? `<p class="replace-note"><span>이 모드의 내 자랑 글이 이미 있습니다</span> <b data-ugc>${esc(old.title)}</b> <strong>${Number(old.score)}점</strong> <span>— 올리면 그 글이 이 기록으로 바뀝니다 (응원·도전 기록은 그대로)</span></p>` : '';
        pv.innerHTML = `<div class="post-score"><b>${Number(d.result.score)}</b><span>${esc(modeLabel(d.result))}</span></div>${replace}`;
        if (old) $('#comm-submit').textContent = '자랑 글 바꾸기';
      } else { ok = false; pv.innerHTML = '<p class="muted">자랑할 기록이 아직 없습니다. 게임을 끝까지 플레이하면 결과 화면에서 바로 자랑할 수 있습니다.</p>'; }
      $('#comm-body').placeholder = '한마디 (예: 드디어 1000점 돌파!)';
    } else {
      const c = d.course;
      if (c && c.points.length >= 2) {
        const rec = c.record ? `<span class="t">내 기록 · 평균 ${sec(c.record.avg)} · 최고 ${sec(c.record.best)}</span>`
          : '<span class="muted">완주 기록이 아직 없습니다 — 자유 연습에서 이 코스를 끝까지 돌면 기록이 함께 올라갑니다.</span>';
        const beat = d.type === 'beat' && d.ref ? `<p class="beat-line"><span>갈아치운 기록</span> <b data-ugc>${esc(d.ref.nick)}</b><strong>평균 ${sec(d.ref.avg)} → ${sec(c.record.avg)}</strong></p>` : '';
        pv.innerHTML = `<div class="course-box">${courseSvg(c.points)}<div class="post-meta"><span class="post-size">${c.points.length} 포인트 · ${c.cycles} 사이클</span>${beat || rec}</div></div>`;
      } else { ok = false; pv.innerHTML = '<p class="muted">공유할 코스가 없습니다. 자유 연습에서 번호를 2개 이상 놓아 코스를 만든 뒤 다시 열어 주세요.</p>'; }
      $('#comm-body').placeholder = d.type === 'beat' ? '한마디 (예: 다음 도전자 기다립니다!)' : '이 코스를 연습하면 뭐가 좋아지나요? (예: 백핸드 쪽 넓은 컨트롤, 빠른 방향 전환)';
    }
    $('#comm-submit').disabled = !ok;
    $('#comm-count').textContent = `${$('#comm-body').value.length}/${BODY_MAX}`;
  }

  /** 기록 자랑 초안이면 이 모드로 이미 올린 내 글을 찾아 둔다 (모드마다 하나) */
  async function findExisting() {
    const d = state.draft;
    if (!d || d.type !== 'record' || !d.result) { if (d) d.existing = null; return; }
    try {
      const store = await host.getStore();
      const found = await store.myBrag(host.getUser(), bragKey(d.result));
      if (state.draft === d) { d.existing = found; paintForm(); }
    } catch { /* 찾지 못하면 새 글로 */ }
  }

  /** 글쓰기 열기. preset: { type, title, ref, course, result } (없으면 현재 코스/최근 결과로) */
  function compose(preset = {}) {
    if (!host.getUser()) { host.toast('글을 쓰려면 로그인하세요 (첫 화면에서 로그인)'); return false; }
    const why = host.blocked?.();
    if (why) { host.toast(why); return false; }
    const base = host.shareDraft();
    state.draft = {
      type: preset.type || (base.course ? 'course' : base.result ? 'record' : 'course'),
      course: preset.course || base.course, result: preset.result || base.result, ref: preset.ref || null, existing: null,
    };
    $('#comm-title').value = preset.title || '';
    $('#comm-body').value = '';
    $('#comm-error').classList.add('hidden');
    paintForm();
    findExisting();
    panel.classList.remove('hidden');
    host.onOpen?.();
    refresh();
    form.scrollIntoView({ block: 'nearest' });
    $('#comm-title').focus();
    return true;
  }

  async function submit(e) {
    e.preventDefault();
    const d = state.draft, u = host.getUser();
    if (!d) return;
    const data = { type: d.type, title: $('#comm-title').value, body: $('#comm-body').value };
    if (d.type === 'record') Object.assign(data, d.result || {});
    else Object.assign(data, { course: d.course?.points, cycles: d.course?.cycles, record: d.course?.record, ref: d.ref });
    const err = $('#comm-error');
    try {
      const store = await host.getStore();
      const post = await store.create(u, data);
      state.draft = null; state.filter = 'all'; state.mode = ''; state.sort = 'recent'; state.selected = post.id;
      paintForm();
      await refresh();
      host.toast(post.replaced ? '자랑 글을 새 기록으로 바꿨습니다' : '글을 올렸습니다');
    } catch (ex) {
      err.textContent = ex.message || String(ex);
      err.classList.remove('hidden');
    }
  }

  async function onListClick(e) {
    const btn = e.target.closest('[data-act]');
    const card = e.target.closest('.post');
    if (!btn) {
      // 글을 누르면 상위 5위 (글 안의 링크·입력은 제외)
      if (card && !e.target.closest('a, input, textarea, select, .post-detail')) select(card.dataset.id);
      return;
    }
    const id = btn.closest('.post')?.dataset.id || state.selected;
    const post = state.posts.find((p) => p.id === id);
    if (!post) return;
    const store = await host.getStore();
    const u = host.getUser();
    try {
      if (btn.dataset.act === 'practice') {
        // 기록 갱신 글은 원본 코스 글로 이어서 기록 게시판을 하나로 유지 (원본이 지워졌으면 이 글의 코스로)
        const origin = post.type === 'beat' && post.ref ? await store.get(post.ref.id) : null;
        host.onPractice(origin && origin.course ? origin : post);
      } else if (btn.dataset.act === 'mode') host.onChallengeMode(post);
      else if (btn.dataset.act === 'cheer') {
        if (!u) { host.toast('응원하려면 로그인하세요 (첫 화면에서 로그인)'); return; }
        const why = host.blocked?.();
        if (why) { host.toast(why); return; }
        await store.cheer(u, id);
        await refresh();
      } else if (btn.dataset.act === 'delete') {
        if (btn.dataset.sure !== '1') { btn.dataset.sure = '1'; btn.textContent = '정말 삭제'; return; } // 한 번 더 눌러야 삭제
        await store.remove(u, id);
        if (state.selected === id) state.selected = null;
        await refresh();
        host.toast('글을 지웠습니다');
      }
    } catch (ex) { host.toast(ex.message || String(ex)); }
  }

  // ---- 연결 ----
  document.querySelectorAll('#comm-filter button').forEach((b) => b.addEventListener('click', () => { state.filter = b.dataset.filter; refresh(); }));
  document.querySelectorAll('#comm-sort button').forEach((b) => b.addEventListener('click', () => { state.sort = b.dataset.sort; refresh(); }));
  modeSel.addEventListener('change', () => { state.mode = modeSel.value; refresh(); });
  document.querySelectorAll('#comm-type button').forEach((b) => b.addEventListener('click', () => { if (state.draft) { state.draft.type = b.dataset.type; paintForm(); findExisting(); } }));
  $('#comm-write').addEventListener('click', () => compose());
  $('#comm-cancel').addEventListener('click', () => { state.draft = null; paintForm(); });
  $('#comm-body').addEventListener('input', () => { $('#comm-count').textContent = `${$('#comm-body').value.length}/${BODY_MAX}`; });
  $('#comm-title').maxLength = TITLE_MAX; $('#comm-body').maxLength = BODY_MAX;
  form.addEventListener('submit', submit);
  list.addEventListener('click', onListClick);
  detail.addEventListener('click', onListClick);
  list.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target.classList?.contains('post')) { e.preventDefault(); select(e.target.dataset.id); } });

  return {
    /** opts: 'course' | 'record' (종류) 또는 { filter, mode, select: 글 id } */
    async open(opts) {
      const o = typeof opts === 'string' ? { filter: opts } : opts || {};
      if (o.filter) state.filter = o.filter;
      if (o.mode !== undefined) state.mode = o.mode;
      if (o.select) state.selected = o.select;
      state.draft = null; paintForm(); panel.classList.remove('hidden'); host.onOpen?.();
      await refresh();
      if (o.select) select(o.select, true);
    },
    compose, refresh,
  };
}
