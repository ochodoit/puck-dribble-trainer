// 커뮤니티 화면: 글 목록(코스 공유 · 기록 자랑 · 기록 갱신), 글쓰기, 코스 기록 게시판.
// 저장은 community.js 의 저장소가 맡고, 게임 쪽 동작(코스 불러오기 등)은 host 콜백으로 넘긴다.
import { boardOf, TITLE_MAX, BODY_MAX } from './community.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sec = (v) => `${Number(v).toFixed(1)}s`;

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
  const dots = pts.map((p, i) => `<circle class="cs-dot${i === 0 ? ' first' : ''}" cx="${X(p)}" cy="${Y(p)}" r="7.5" /><text class="cs-n${i === 0 ? ' first' : ''}" x="${X(p)}" y="${Y(p)}">${p.n}</text>`).join('');
  return `<svg class="course-svg" viewBox="0 0 ${w} ${h}" role="img" aria-label="코스 미리보기"><rect class="cs-field" x="1" y="1" width="${w - 2}" height="${h - 2}" rx="8" />${path}${dots}</svg>`;
}

/**
 * host: {
 *   getUser(), getStore(): Promise<store>, toast(msg), modeName(id), countryLabel(code),
 *   shareDraft(): { course: {points, cycles, record}|null, result: {modeId, seconds, score}|null },
 *   onPractice(post), onChallengeMode(post), onOpen()
 * }
 */
export function initCommunity(host) {
  const $ = (s) => document.querySelector(s);
  const panel = $('#panel-community'), list = $('#comm-list'), form = $('#comm-form'), note = $('#comm-note');
  const state = { filter: 'all', draft: null, posts: [] };

  const who = (p) => {
    if (p.official) return '<b>Puck Trainer</b><span class="tag">예시 코스</span>';
    const bits = [p.team ? `<span data-ugc>${esc(p.team)}</span>` : '', p.country ? `<span>${esc(host.countryLabel(p.country))}</span>` : '', p.ageGroup ? `<span>${esc(p.ageGroup)}</span>` : ''].filter(Boolean).join('<i>·</i>');
    return `<b data-ugc>${esc(p.nick)}</b>${bits ? `<span class="who-more">${bits}</span>` : ''}<time>${timeAgo(p.at)}</time>`;
  };

  function boardHtml(p) {
    const rows = boardOf(p);
    if (!rows.length) return '<p class="post-empty">아직 기록이 없습니다 — 첫 기록의 주인공이 되어 보세요</p>';
    const me = host.getUser();
    const items = rows.slice(0, 5).map((r) => `<li class="${r.rank === 1 ? 'holder' : ''}${me && r.uid === me.id ? ' me' : ''}">
      <span class="rk">${r.rank}</span><b data-ugc>${esc(r.nick)}</b>${r.author ? '<em>글쓴이</em>' : ''}<span class="t">평균 ${sec(r.avg)}</span><small>최고 ${sec(r.best)}</small></li>`).join('');
    const top = rows[0];
    const taken = !top.author && p.record ? `<p class="post-taken"><span>글쓴이의 기록이 깨졌습니다 — 현재 1위</span> <b data-ugc>${esc(top.nick)}</b></p>` : '';
    return `<div class="post-board"><small class="board-title">Record board</small><ol>${items}</ol>${taken}</div>`;
  }

  function postHtml(p) {
    const me = host.getUser();
    const mine = me && p.uid === me.id && !p.official;
    const ugc = p.official ? '' : ' data-ugc';
    const cheers = (p.cheers || []).length, cheered = me && (p.cheers || []).includes(me.id);
    const tag = p.type === 'course' ? 'Course' : p.type === 'beat' ? 'New record' : 'Record';
    let main = '';
    if (p.type === 'record') {
      const m = p.seconds ? `${host.modeName(p.modeId)} · ${Math.round(p.seconds / 60)}분` : host.modeName(p.modeId);
      main = `<div class="post-score"><b>${Number(p.score)}</b><span>${esc(m)}</span></div>`;
    } else {
      const beat = p.type === 'beat' && p.ref
        ? `<p class="beat-line"><span>갈아치운 기록</span> <b data-ugc>${esc(p.ref.nick)}</b><strong>평균 ${sec(p.ref.avg)} → ${sec(p.record.avg)}</strong></p>` : '';
      main = `<div class="course-box">${courseSvg(p.course)}<div class="post-meta"><span class="post-size">${p.course.length} 포인트 · ${p.cycles} 사이클</span>${beat}${p.type === 'beat' ? '' : boardHtml(p)}</div></div>`;
    }
    const act = p.type === 'record'
      ? `<button type="button" class="btn btn-primary" data-act="mode">나도 도전</button>`
      : `<button type="button" class="btn btn-primary" data-act="practice">이 코스 연습하기</button>`;
    return `<article class="post post-${p.type}" data-id="${esc(p.id)}">
      <div class="post-head"><span class="post-tag">${tag}</span>${who(p)}</div>
      <h3${ugc}>${esc(p.title)}</h3>
      ${p.body ? `<p class="post-body"${ugc}>${esc(p.body)}</p>` : ''}
      ${main}
      <div class="post-foot">${act}
        <button type="button" class="btn btn-ghost cheer${cheered ? ' on' : ''}" data-act="cheer" aria-label="응원">👏 <span>${cheers}</span></button>
        ${mine ? '<button type="button" class="btn btn-ghost" data-act="delete">삭제</button>' : ''}
      </div>
    </article>`;
  }

  async function refresh() {
    const store = await host.getStore();
    const u = host.getUser();
    note.innerHTML = `<span>${store.kind === 'firebase'
      ? '온라인 커뮤니티 — 모든 기기의 글과 기록이 함께 보입니다.'
      : '아직 온라인 연결 전이라 글과 기록은 이 기기에만 저장됩니다 — 이 기기를 함께 쓰는 선수들끼리 볼 수 있어요.'}</span>${
      u ? '' : ' <span>글쓰기·기록 등록은 로그인 후 가능합니다 (첫 화면에서 로그인).</span>'}`;
    document.querySelectorAll('#comm-filter button').forEach((b) => b.classList.toggle('active', b.dataset.filter === state.filter));
    try {
      state.posts = await store.list(state.filter);
      list.innerHTML = state.posts.length ? state.posts.map(postHtml).join('') : '<p class="muted comm-empty">아직 글이 없습니다. 첫 글을 올려 보세요.</p>';
    } catch (err) {
      list.innerHTML = `<p class="error">글을 불러오지 못했습니다: ${esc(err.message || err)}</p>`;
    }
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
    if (d.type === 'record') {
      if (d.result) pv.innerHTML = `<div class="post-score"><b>${Number(d.result.score)}</b><span>${esc(d.result.seconds ? `${host.modeName(d.result.modeId)} · ${Math.round(d.result.seconds / 60)}분` : host.modeName(d.result.modeId))}</span></div>`;
      else { ok = false; pv.innerHTML = '<p class="muted">자랑할 기록이 아직 없습니다. 게임을 끝까지 플레이하면 결과 화면에서 바로 자랑할 수 있습니다.</p>'; }
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

  /** 글쓰기 열기. preset: { type, title, ref, course, result } (없으면 현재 코스/최근 결과로) */
  function compose(preset = {}) {
    if (!host.getUser()) { host.toast('글을 쓰려면 로그인하세요 (첫 화면에서 로그인)'); return false; }
    const base = host.shareDraft();
    state.draft = {
      type: preset.type || (base.course ? 'course' : base.result ? 'record' : 'course'),
      course: preset.course || base.course, result: preset.result || base.result, ref: preset.ref || null,
    };
    $('#comm-title').value = preset.title || '';
    $('#comm-body').value = '';
    $('#comm-error').classList.add('hidden');
    paintForm();
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
      await store.create(u, data);
      state.draft = null; state.filter = 'all';
      paintForm();
      await refresh();
      host.toast('글을 올렸습니다');
    } catch (ex) {
      err.textContent = ex.message || String(ex);
      err.classList.remove('hidden');
    }
  }

  async function onListClick(e) {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const id = btn.closest('.post')?.dataset.id;
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
        await store.cheer(u, id);
        await refresh();
      } else if (btn.dataset.act === 'delete') {
        if (btn.dataset.sure !== '1') { btn.dataset.sure = '1'; btn.textContent = '정말 삭제'; return; } // 한 번 더 눌러야 삭제
        await store.remove(u, id);
        await refresh();
        host.toast('글을 지웠습니다');
      }
    } catch (ex) { host.toast(ex.message || String(ex)); }
  }

  // ---- 연결 ----
  document.querySelectorAll('#comm-filter button').forEach((b) => b.addEventListener('click', () => { state.filter = b.dataset.filter; refresh(); }));
  document.querySelectorAll('#comm-type button').forEach((b) => b.addEventListener('click', () => { if (state.draft) { state.draft.type = b.dataset.type; paintForm(); } }));
  $('#comm-write').addEventListener('click', () => compose());
  $('#comm-cancel').addEventListener('click', () => { state.draft = null; paintForm(); });
  $('#comm-body').addEventListener('input', () => { $('#comm-count').textContent = `${$('#comm-body').value.length}/${BODY_MAX}`; });
  $('#comm-title').maxLength = TITLE_MAX; $('#comm-body').maxLength = BODY_MAX;
  form.addEventListener('submit', submit);
  list.addEventListener('click', onListClick);

  return {
    open(filter) { if (filter) state.filter = filter; state.draft = null; paintForm(); panel.classList.remove('hidden'); host.onOpen?.(); return refresh(); },
    compose, refresh,
  };
}
