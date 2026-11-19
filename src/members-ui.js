// 운영자: 회원 현황 (팀·연령대·국가·상태·활동·가입 경로로 거르기, 정렬) + 회원 기록 창 (한 명의 출석·훈련·게임별 기록 한눈에).
// 데이터: 회원 목록(memberList) + 활동 기록(activityList)을 한 번 읽어 1분 동안 다시 쓰고('새로 고침'은 바로 다시 읽음),
// 회원 기록 창의 게임별 최고 기록만 그 회원의 기록 문서를 읽는다(memberScores). 계산은 stats.js (화면 없는 순수 계산).
import { memberRows, memberDetail, filterMembers, sortMembers, membersSummary, teamsOf } from './stats.js';
import { monthGrid, dayKey, sparkPoints, hoursMinutes, keyInfo } from './activity.js';
import { gameKeyTools } from './me-ui.js';

const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
const STATE_LABEL = { beta: '베타 기간', kept: '유지', coupon: '이용권', lapsed: '종료' };
const TTL = 60 * 1000;

/**
 * deps: { $, $$, esc, tr, open, close, app, MODES, PLAY_MINUTES, rankKey, timeLabel, levelLabel,
 *         AGE_GROUPS, countryLabel, jerseyLabel, memberBadge, stickLabel, memberNoLabel, joinLabel, shortDate }
 */
export function initMembers(deps) {
  const { $, $$, esc, tr, app } = deps;
  const list = $('#panel-members'), card = $('#panel-member');
  const { KEYS, keyLabel, keyOrder } = gameKeyTools(deps);
  const view = { data: null, f: {}, sort: 'no', uid: null, y: 0, m: 0, detail: null };
  const dotYmd = (k) => (k ? k.replace(/-/g, '.') : '-');
  const hm = (sec) => { const t = hoursMinutes(sec); return t.h ? `${t.h}시간 ${t.m}분` : `${t.m}분`; };
  const ago = (idle) => (idle == null ? '없음' : idle === 0 ? '오늘' : idle === 1 ? '어제' : `${idle}일 전`);
  const tile = (v, label, sub) => `<div class="me-stat"><b>${v}</b><span>${label}</span>${sub ? `<small>${sub}</small>` : ''}</div>`;
  const modeName = (id) => deps.MODES.find((m) => m.id === id)?.name || id;
  const stateHtml = (r) => {
    const tags = [];
    // 베타 기간 중에도 유지·이용권 표시는 보이게 (등급은 베타가 끝난 뒤에 바뀜)
    if (r.u.kept && r.state !== 'kept') tags.push('<span class="mem-tag">유지</span>');
    if (r.u.until && r.state !== 'coupon' && Number(r.u.until) > Date.now()) tags.push(`<span class="mem-tag">이용권 ~${dotYmd(dayKey(r.u.until)).slice(5)}</span>`);
    if (r.u.tempPw) tags.push('<span class="chip-temp">임시 비밀번호</span>');
    if (!r.u.loginId) tags.push('<span class="mem-tag">아이디 없음</span>');
    return `${STATE_LABEL[r.state] || ''}${tags.length ? ' ' + tags.join(' ') : ''}`;
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
  rows.addEventListener('click', (e) => { const row = e.target.closest('tr[data-uid]'); if (row) openMember(row.dataset.uid); });
  rows.addEventListener('keydown', (e) => { const row = e.target.closest('tr[data-uid]'); if (row && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openMember(row.dataset.uid); } });
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
    $('#mem-rows').innerHTML = `<tr><td colspan="9" class="muted">${esc(tr('불러오는 중…'))}</td></tr>`;
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
      return `<tr data-uid="${esc(u.id)}" data-nick="${esc(u.nick)}" tabindex="0" class="${r.state === 'lapsed' ? 'dim' : ''}">`
        + `<td>${deps.memberNoLabel(u.memberNo)}</td><td><b data-ugc>${esc(u.nick)}</b>${jersey}</td><td data-ugc>${esc(u.team || '-')}</td><td>${esc(u.ageGroup || '-')}</td>`
        + `<td>${stateHtml(r)}</td><td>${esc(ago(r.idle))}</td><td class="num">${r.att30}/${r.span30}일 · ${r.rate30}%</td>`
        + `<td class="num">${r.games}판</td><td class="num">${esc(hm(r.sec))}</td></tr>`;
    }).join('') : `<tr><td colspan="9" class="muted">${esc(tr('조건에 맞는 회원이 없습니다'))}</td></tr>`;
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
    const state = r.state === 'beta' && end ? `정회원 · ${deps.shortDate(end)}까지` : r.state === 'coupon' && u.until ? `3개월 이용권 · ${deps.shortDate(u.until)}까지` : STATE_LABEL[r.state] || '';
    const joined = u.joinedAt || u.createdAt ? `가입 ${dotYmd(dayKey(u.joinedAt || u.createdAt))}` : '';
    $('#mm-card').innerHTML = `<div class="me-id"><b data-ugc>${esc(u.nick)}</b>${jersey} <span class="member-badge">${esc(deps.memberBadge(u))}</span></div>
      <p class="me-facts"><span data-ugc>${esc(u.team)}</span> · ${facts}</p>
      <p class="me-facts muted">${[joined, esc(deps.joinLabel(u)), esc(state)].filter(Boolean).join(' · ')}</p>
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
    const keys = [...new Set([...best.map((b) => b.mode), ...Object.keys(recent)])].filter((k) => keyInfo(k).modeId !== 'free').sort((a, b) => keyOrder(a) - keyOrder(b));
    body.innerHTML = keys.length ? keys.map((k) => {
      const b = best.find((x) => x.mode === k), vals = (recent[k] || []).map((x) => x.s);
      return `<tr><td>${esc(keyLabel(k))}</td><td class="num">${b ? b.score : '-'}</td><td class="num">${b ? b.plays : vals.length}</td><td>${spark(vals)}</td></tr>`;
    }).join('') : `<tr><td colspan="4" class="muted">${esc(tr('아직 게임 기록이 없습니다'))}</td></tr>`;
  }

  function openList() {
    deps.open(list);
    load(false);
  }

  return { open: openList, openMember };
}
