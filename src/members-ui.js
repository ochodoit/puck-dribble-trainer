// 운영자: 회원 현황 (팀·연령대·국가·상태·활동·가입 경로로 거르기, 정렬) + 회원 기록 창 (한 명의 출석·훈련·게임별 기록 한눈에).
// 데이터: 회원 목록(memberList) + 활동 기록(activityList)을 한 번 읽어 1분 동안 다시 쓰고('새로 고침'은 바로 다시 읽음),
// 회원 기록 창의 게임별 최고 기록만 그 회원의 기록 문서를 읽는다(memberScores). 계산은 stats.js (화면 없는 순수 계산).
// 남은 일수 = 정회원으로 쓸 수 있는 날 (베타 종료일·이용권 기한 중 늦은 날까지). 왼쪽 칸으로 회원을 골라 달력에서 고른 날까지 늘린다 (grantCoupon, 종류 EXT_PASS).
import { memberRows, memberDetail, filterMembers, sortMembers, membersSummary, teamsOf, extendPlan } from './stats.js';
import { monthGrid, dayKey, sparkPoints, hoursMinutes, keyInfo } from './activity.js';
import { addMonths, passName, EXT_PASS } from './account.js';
import { gameKeyTools } from './me-ui.js';
import { renderAbility } from './ability-ui.js';
import { shownScore } from './game.js';

const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
const STATE_LABEL = { beta: '베타 기간', kept: '유지', coupon: '이용권', lapsed: '종료' };
const TTL = 60 * 1000;

/**
 * deps: { $, $$, esc, tr, open, close, toast, app, MODES, PLAY_MINUTES, rankKey, timeLabel, levelLabel,
 *         AGE_GROUPS, countryLabel, jerseyLabel, memberBadge, stickLabel, memberNoLabel, joinLabel, shortDate }
 */
export function initMembers(deps) {
  const { $, $$, esc, tr, app } = deps;
  const list = $('#panel-members'), card = $('#panel-member');
  const { KEYS, keyLabel, keyOrder } = gameKeyTools(deps);
  const view = { data: null, f: {}, sort: 'no', uid: null, y: 0, m: 0, detail: null, sel: new Set(), shown: [] };
  const dotYmd = (k) => (k ? k.replace(/-/g, '.') : '-');
  const hm = (sec) => { const t = hoursMinutes(sec); return t.h ? `${t.h}시간 ${t.m}분` : `${t.m}분`; };
  const ago = (idle) => (idle == null ? '없음' : idle === 0 ? '오늘' : idle === 1 ? '어제' : `${idle}일 전`);
  const tile = (v, label, sub) => `<div class="me-stat"><b>${v}</b><span>${label}</span>${sub ? `<small>${sub}</small>` : ''}</div>`;
  const modeName = (id) => deps.MODES.find((m) => m.id === id)?.name || id;
  const stateHtml = (r) => {
    const tags = [];
    // 베타 기간 중에도 유지·이용권 표시는 보이게 (등급은 베타가 끝난 뒤에 바뀜)
    if (r.u.kept && r.state !== 'kept') tags.push('<span class="mem-tag">유지</span>');
    if (r.u.until && r.state !== 'coupon' && Number(r.u.until) > Date.now()) {
      const md5 = dotYmd(dayKey(r.u.until)).slice(5);
      tags.push(r.u.coupon === EXT_PASS ? `<span class="mem-tag">연장 ~${md5}</span>` : `<span class="mem-tag">이용권 ~${md5}</span>`);
    }
    if (r.u.tempPw) tags.push('<span class="chip-temp">임시 비밀번호</span>');
    if (!r.u.loginId) tags.push('<span class="mem-tag">아이디 없음</span>');
    return `${STATE_LABEL[r.state] || ''}${tags.length ? ' ' + tags.join(' ') : ''}`;
  };
  // 남은 일수 칸: 무기한(유지) · 미정(베타 종료일 안 정함) · 종료 · 오늘까지 · N일 (7일 안이면 빨강) + 마지막 날
  const md = (k) => k.slice(5).replace('-', '.');
  const leftHtml = (a) => {
    if (a.kind === 'forever') return '<span class="mem-left">무기한</span>';
    if (a.kind === 'open') return '<span class="muted">미정</span>';
    if (a.kind === 'ended') return '<span class="muted">종료</span>';
    const soon = a.left <= 7 ? ' soon' : '';
    const n = a.left ? `${a.left}일` : '오늘까지';
    return `<span class="mem-left${soon}">${n}</span> <small class="muted">~${md(a.lastDay)}</small>`;
  };
  /** 회원 기록 창의 이용 기간 한 줄 */
  const leftText = (a) => {
    if (a.kind === 'forever') return '이용 기간 기한 없음 (유지)';
    if (a.kind === 'open') return '이용 기간: 베타 종료일 미정';
    if (a.kind === 'ended') return `이용 기간 끝남 (${dotYmd(a.lastDay)})`;
    const n = a.left ? `${a.left}일 남음` : '오늘까지';
    return `이용 기간 ${dotYmd(a.lastDay)}까지 · ${n}`;
  };

  // ---- 거르기·정렬 칸 ----
  const FIELDS = { q: '#mem-q', team: '#mem-team', ageGroup: '#mem-age', country: '#mem-country', state: '#mem-state', activity: '#mem-act', via: '#mem-via' };
  const readFilters = () => { for (const [k, sel] of Object.entries(FIELDS)) view.f[k] = $(sel).value; view.sort = $('#mem-sort').value; };
  for (const sel of Object.values(FIELDS)) $(sel).addEventListener(sel === '#mem-q' ? 'input' : 'change', () => { readFilters(); renderList(); });
  $('#mem-sort').addEventListener('change', () => { readFilters(); renderList(); });
  $('#mem-reset').addEventListener('click', () => {
    for (const sel of Object.values(FIELDS)) $(sel).value = '';
    $('#mem-sort').value = 'no';
    readFilters(); renderList();
  });
  $('#mem-refresh').addEventListener('click', () => load(true));
  // 회원 줄을 누르면(또는 Enter) 그 회원의 기록 창
  const rows = $('#mem-rows');
  rows.addEventListener('click', (e) => { if (e.target.closest('.mem-pick')) return; const row = e.target.closest('tr[data-uid]'); if (row) openMember(row.dataset.uid); });
  rows.addEventListener('keydown', (e) => { if (e.target.closest('.mem-pick')) return; const row = e.target.closest('tr[data-uid]'); if (row && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openMember(row.dataset.uid); } });
  // ---- 고르기 + 이용 기간 연장 (달력) ----
  rows.addEventListener('change', (e) => {
    const box = e.target.closest('.mem-pick input'); if (!box) return;
    const uid = box.closest('tr[data-uid]').dataset.uid;
    if (box.checked) view.sel.add(uid); else view.sel.delete(uid);
    box.closest('tr').classList.toggle('picked', box.checked);
    renderPick();
  });
  $('#mem-all').addEventListener('change', (e) => {
    for (const r of view.shown) { if (e.target.checked) view.sel.add(r.id); else view.sel.delete(r.id); }
    renderList();
  });
  $('#mem-ext-date').addEventListener('input', renderPick);
  $('#mem-ext-go').addEventListener('click', extendPicked);
  $('#mm-back').addEventListener('click', () => deps.close(card));
  $('#mm-prev').addEventListener('click', () => { if (--view.m < 1) { view.m = 12; view.y--; } renderCalendar(); });
  $('#mm-next').addEventListener('click', () => {
    const t = new Date();
    if (view.y > t.getFullYear() || (view.y === t.getFullYear() && view.m >= t.getMonth() + 1)) return;
    if (++view.m > 12) { view.m = 1; view.y++; }
    renderCalendar();
  });

  /** 선택 칸 채우기 (지금 고른 값은 남아 있으면 그대로) */
  function fillSelect(sel, opts, allLabel) {
    const el = $(sel), keep = el.value;
    el.innerHTML = `<option value="">${esc(allLabel)}</option>` + opts.map(([v, label]) => `<option value="${esc(v)}">${esc(label)}</option>`).join('');
    el.value = opts.some(([v]) => v === keep) ? keep : '';
  }

  async function load(force = false) {
    const err = $('#mem-error');
    err.classList.add('hidden');
    if (!force && view.data && Date.now() - view.data.at < TTL) { renderList(); return; }
    $('#mem-rows').innerHTML = `<tr><td colspan="11" class="muted">${esc(tr('불러오는 중…'))}</td></tr>`;
    const date = $('#mem-ext-date'), today = dayKey();
    date.min = today;
    if (!date.value || date.value < today) date.value = dayKey(addMonths(Date.now(), 1));
    try {
      const [members, acts] = await Promise.all([app.account.memberList(), app.account.activityList()]);
      view.data = { at: Date.now(), members, acts, byUid: new Map(acts.map((a) => [a.uid, a])) };
      app.adminActs = { at: view.data.at, rows: acts }; // 운영자 통계도 같은 기록을 쓴다 (다시 읽지 않게)
      const ms = view.data.members;
      const teams = teamsOf(ms).map(([k, name, n]) => [k, `${name} (${n})`]);
      const ages = deps.AGE_GROUPS.filter((g) => ms.some((u) => u.ageGroup === g)).map((g) => [g, `${g} (${ms.filter((u) => u.ageGroup === g).length})`]);
      const cs = [...new Set(ms.map((u) => u.country).filter(Boolean))].map((c) => [c, `${deps.countryLabel(c)} (${ms.filter((u) => u.country === c).length})`]);
      fillSelect('#mem-team', teams, '모든 팀');
      fillSelect('#mem-age', ages, '모든 연령대');
      fillSelect('#mem-country', cs, '모든 국가');
      readFilters();
      renderList();
    } catch (e) {
      err.textContent = `${tr('회원 현황을 불러오지 못했습니다')}: ${e.message || e}`;
      err.classList.remove('hidden');
      $('#mem-rows').innerHTML = '';
    }
  }

  function currentRows() {
    const d = view.data, end = app.site?.betaEndsAt ?? null;
    return d ? memberRows(d.members, d.acts, Date.now(), end) : [];
  }

  function renderList() {
    const all = currentRows();
    const shown = sortMembers(filterMembers(all, view.f), view.sort);
    view.shown = shown;
    // 보이지 않는 회원은 고른 목록에서 뺀다 (거르기로 숨긴 회원이 모르게 연장되지 않게)
    const ids = new Set(shown.map((r) => r.id));
    for (const id of [...view.sel]) if (!ids.has(id)) view.sel.delete(id);
    const s = membersSummary(shown);
    $('#mem-sum').innerHTML = [
      tile(`${s.n}명`, '회원', s.n === all.length ? '' : `전체 ${all.length}명 중`),
      tile(`${s.today}명`, '오늘 출석', `7일 안 ${s.d7}명`),
      tile(`${s.rate30}%`, '평균 출석률', '최근 30일'),
      tile(`${s.games}판`, '플레이', hm(s.sec)),
    ].join('');
    $('#mem-count').textContent = shown.length === all.length ? `회원 ${all.length}명` : `${shown.length}명 / 전체 ${all.length}명`;
    rows.innerHTML = shown.length ? shown.map((r) => {
      const u = r.u, jersey = u.number != null ? ` <span class="jersey">${deps.jerseyLabel(u.number)}</span>` : '';
      const on = view.sel.has(u.id);
      return `<tr data-uid="${esc(u.id)}" data-nick="${esc(u.nick)}" tabindex="0" class="${[r.state === 'lapsed' ? 'dim' : '', on ? 'picked' : ''].filter(Boolean).join(' ')}">`
        + `<td class="mem-pick"><input type="checkbox" aria-label="${esc(u.nick)}"${on ? ' checked' : ''} /></td>`
        + `<td class="mem-no">${deps.memberNoLabel(u.memberNo)}</td><td><b data-ugc>${esc(u.nick)}</b>${jersey}</td><td data-ugc>${esc(u.team || '-')}</td><td>${esc(u.ageGroup || '-')}</td>`
        + `<td>${stateHtml(r)}</td><td class="num">${leftHtml(r.access)}</td><td>${esc(ago(r.idle))}</td><td class="num">${r.att30}/${r.span30}일 · ${r.rate30}%</td>`
        + `<td class="num">${r.games}판</td><td class="num">${esc(hm(r.sec))}</td></tr>`;
    }).join('') : `<tr><td colspan="11" class="muted">${esc(tr('조건에 맞는 회원이 없습니다'))}</td></tr>`;
    renderPick();
  }

  /** 고른 회원 수 · 모두 고르기 칸 · 연장 버튼 */
  function renderPick() {
    const n = view.sel.size, all = $('#mem-all');
    $('#mem-sel').textContent = n ? `${n}명 선택` : '선택한 회원 없음';
    $('#mem-sel').classList.toggle('on', n > 0);
    all.checked = n > 0 && n === view.shown.length;
    all.indeterminate = n > 0 && n < view.shown.length;
    $('#mem-ext-go').disabled = !n || !$('#mem-ext-date').value;
  }

  /** 고른 회원들의 이용 기간을 달력에서 고른 날까지 늘린다 (줄이지 않음, 유지 회원은 그대로) */
  async function extendPicked() {
    const key = $('#mem-ext-date').value;
    if (!key || !view.sel.size) return;
    const picked = view.shown.filter((r) => view.sel.has(r.id));
    const plan = extendPlan(picked, key, app.site?.betaEndsAt ?? null);
    const day = key.replace(/-/g, '.');
    // 그대로 두는 회원 안내 (한 줄씩: 번역이 줄 단위로 된다)
    const skip = [];
    if (plan.later.length) skip.push(`이미 그 뒤까지인 ${plan.later.length}명은 그대로입니다.`);
    if (plan.kept.length) skip.push(`유지 회원 ${plan.kept.length}명은 기한이 없어 그대로입니다.`);
    if (!plan.apply.length) { deps.toast?.(tr(['늘릴 회원이 없습니다.', ...skip].join('\n')), 4000); return; }
    const ask = [`${plan.apply.length}명의 이용 기간을 ${day}까지로 늘립니다.`, ...skip, '진행할까요?'].join('\n');
    if (!window.confirm(tr(ask))) return;
    const go = $('#mem-ext-go'), err = $('#mem-error');
    go.disabled = true; err.classList.add('hidden');
    let done = 0;
    try {
      for (const r of plan.apply) { await app.account.grantCoupon(r.id, plan.until, EXT_PASS); done++; }
      view.sel.clear();
      deps.toast?.(`${done}명의 이용 기간을 ${day}까지 늘렸습니다`, 3500);
    } catch (e) {
      err.textContent = `${tr('이용 기간을 늘리지 못했습니다')} (${done}/${plan.apply.length}): ${e.message || e}`;
      err.classList.remove('hidden');
    }
    await load(true);
  }

  // ---- 회원 기록 창 ----
  async function openMember(uid) {
    const d = view.data;
    const u = d?.members.find((x) => x.id === uid);
    if (!u) return;
    view.uid = uid;
    view.detail = memberDetail(u, d.byUid.get(uid), Date.now(), app.site?.betaEndsAt ?? null);
    const t = new Date();
    view.y = t.getFullYear(); view.m = t.getMonth() + 1;
    renderProfile(); renderAttendance(); renderTraining();
    deps.open(card);
    card.querySelector('.modal-card').scrollTop = 0;
    renderScores();
  }

  function renderProfile() {
    const r = view.detail, u = r.u;
    const jersey = u.number != null ? ` <span class="jersey">${deps.jerseyLabel(u.number)}</span>` : '';
    const facts = [esc(deps.countryLabel(u.country)), esc(`${u.ageGroup} (${u.age}세)`), u.stick ? deps.stickLabel(u.stick) : ''].filter(Boolean).join(' · ');
    const end = app.site?.betaEndsAt;
    const state = r.state === 'beta' && end ? `정회원 · ${deps.shortDate(end)}까지` : r.state === 'coupon' && u.until ? `${passName(u)} · ${deps.shortDate(u.until)}까지` : STATE_LABEL[r.state] || '';
    const joined = u.joinedAt || u.createdAt ? `가입 ${dotYmd(dayKey(u.joinedAt || u.createdAt))}` : '';
    $('#mm-card').innerHTML = `<div class="me-id"><b data-ugc>${esc(u.nick)}</b>${jersey} <span class="member-badge">${esc(deps.memberBadge(u))}</span></div>
      <p class="me-facts"><span data-ugc>${esc(u.team)}</span> · ${facts}</p>
      <p class="me-facts muted">${[joined, esc(deps.joinLabel(u)), esc(state)].filter(Boolean).join(' · ')}</p>
      <p class="me-facts mm-left">${esc(leftText(r.access))}</p>
      <p class="me-facts muted">${u.loginId ? `로그인 아이디 <b data-ugc>${esc(u.loginId)}</b>` : '<span class="mem-tag">아이디 없음</span>'}${u.tempPw ? ' <span class="chip-temp">임시 비밀번호</span>' : ''}${u.feedbackAt ? ` · 의견 보냄 ${dotYmd(dayKey(u.feedbackAt))}` : ''}</p>`;
  }

  function renderAttendance() {
    const r = view.detail;
    $('#mm-att').innerHTML = [
      tile(`${r.rate}%`, '출석률 (가입 후)', `${r.days}일 / ${r.since}일`),
      tile(`${r.rate30}%`, '최근 30일 출석률', `${r.att30}일 / ${r.span30}일`),
      tile(`${r.att.streak}일`, '연속 출석', `이번 달 ${r.att.month}일`),
      tile(esc(ago(r.idle)), '마지막 출석', r.lastDay ? dotYmd(r.lastDay) : ''),
    ].join('');
    renderCalendar();
  }

  function renderCalendar() {
    const days = view.detail?.rawDays || {}, today = dayKey();
    $('#mm-month').textContent = `${view.y}년 ${view.m}월`;
    const t = new Date();
    $('#mm-next').disabled = view.y > t.getFullYear() || (view.y === t.getFullYear() && view.m >= t.getMonth() + 1);
    const head = '<tr>' + WEEK.map((w) => '<th>' + w + '</th>').join('') + '</tr>';
    const cell = (k) => {
      if (!k) return '<td></td>';
      const d = days[k], n = d ? d.n : 0;
      const lv = !d ? '' : n >= 5 ? 'lv3' : n >= 2 ? 'lv2' : 'lv1';
      const tip = d && n ? `${n}판 · ${Math.max(1, Math.round(d.s / 60))}분` : d ? tr('출석') : '';
      const cls = [d ? 'on' : '', lv, k === today ? 'today' : ''].filter(Boolean).join(' ');
      return '<td class="' + cls + '"' + (tip ? ' title="' + esc(tip) + '"' : '') + '><span>' + Number(k.slice(8)) + '</span></td>';
    };
    $('#mm-cal').innerHTML = `<table><thead>${head}</thead><tbody>${monthGrid(view.y, view.m).map((w) => '<tr>' + w.map(cell).join('') + '</tr>').join('')}</tbody></table>`;
  }

  function renderTraining() {
    const r = view.detail, t = r.totals;
    const dist = t.dist >= 1000 ? `${(t.dist / 1000).toFixed(1)}km` : `${Math.round(t.dist)}m`;
    $('#mm-totals').innerHTML = [
      tile(`${t.games}판`, '플레이', `최근 7일 ${r.games7}판`),
      tile(esc(hm(t.sec)), '훈련 시간', `최근 7일 ${hm(r.sec7)}`),
      tile(`${r.playDays}일`, '훈련한 날', r.playDays ? `하루 평균 ${hm(r.secPerDay)} · ${r.gamesPerDay}판` : ''),
      tile(dist, '이동 거리', `터치 ${t.touches}회`),
    ].join('');
    $('#mm-chart').innerHTML = dailyChart(r.daily);
    $('#mm-modes').innerHTML = r.modes.length
      ? '<p class="adm-line"><b class="adm-line-h">게임별 판 수</b> ' + r.modes.map(([m, n]) => `<span class="adm-chip"><span>${esc(modeName(m))}</span> <b>${n}</b></span>`).join(' ') + '</p>'
      : '';
  }

  /** 최근 28일 막대 (SVG): 막대 = 그날 판 수, 판 없이 출석만 한 날은 바닥에 작은 점 */
  function dailyChart(daily) {
    const W = 300, H = 96, top = 14, base = 72, step = W / daily.length, bw = Math.min(8, step * 0.62);
    const max = Math.max(1, ...daily.map((d) => d.n));
    const bars = daily.map((d, i) => {
      const x = i * step + (step - bw) / 2, h = d.n ? Math.max(2, ((base - top) * d.n) / max) : 0, cx = i * step + step / 2;
      const label = (daily.length - 1 - i) % 7 === 0 ? '<text class="ax" x="' + cx + '" y="' + (H - 6) + '">' + Number(d.day.slice(5, 7)) + '/' + Number(d.day.slice(8)) + '</text>' : '';
      const tip = d.n ? `<title>${d.day} · ${d.n}판 · ${Math.max(1, Math.round(d.s / 60))}분</title>` : '';
      const dot = !d.n && d.on ? '<circle cx="' + cx + '" cy="' + (base - 3) + '" r="2.2"/>' : '';
      return '<rect x="' + x.toFixed(1) + '" y="' + (base - h).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + h.toFixed(1) + '" rx="1.5">' + tip + '</rect>' + dot + label;
    }).join('');
    const cap = tr('최근 28일: 막대 = 판 수, 점 = 출석만 한 날');
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(cap) + '"><line x1="0" x2="' + W + '" y1="' + base + '" y2="' + base + '"/>' + bars + '</svg>'
      + '<p class="adm-legend muted">' + esc(cap) + '</p>';
  }

  const spark = (vals) => {
    if (!vals?.length) return '<span class="muted">-</span>';
    const pts = sparkPoints(vals), [lx, ly] = pts[pts.length - 1];
    const label = esc(tr('최근 기록'));
    return `<svg class="spark" viewBox="0 0 120 28" role="img" aria-label="${label}"><title>${vals.join(', ')}</title>`
      + (pts.length > 1 ? `<polyline points="${pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')}" />` : '')
      + `<circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="2.6" /></svg>`;
  };

  async function renderScores() {
    const body = $('#mm-scores'), uid = view.uid, recent = view.detail.recent || {};
    body.innerHTML = `<tr><td colspan="4" class="muted">${esc(tr('불러오는 중…'))}</td></tr>`;
    const extra = Object.keys(recent).filter((k) => !KEYS.includes(k));
    let best = [];
    try { best = await app.account.memberScores(uid, [...KEYS, ...extra]); } catch { best = []; }
    if (view.uid !== uid) return; // 그새 다른 회원을 열었음
    renderAbility($('#mm-ability'), { store: app.account, act: view.data.byUid.get(uid), best, ageGroup: view.detail.u.ageGroup, esc, tr, gameName: modeName });
    const keys = [...new Set([...best.map((b) => b.mode), ...Object.keys(recent)])].filter((k) => keyInfo(k).modeId !== 'free').sort((a, b) => keyOrder(a) - keyOrder(b));
    body.innerHTML = keys.length ? keys.map((k) => {
      const b = best.find((x) => x.mode === k), vals = (recent[k] || []).map((x) => x.s);
      return `<tr><td>${esc(keyLabel(k))}</td><td class="num">${b ? shownScore(k, b.score) : '-'}</td><td class="num">${b ? b.plays : vals.length}</td><td>${spark(vals)}</td></tr>`;
    }).join('') : `<tr><td colspan="4" class="muted">${esc(tr('아직 게임 기록이 없습니다'))}</td></tr>`;
  }

  function openList() {
    deps.open(list);
    load(false);
  }

  return { open: openList, openMember };
}
