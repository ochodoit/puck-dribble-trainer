// 내 정보 화면: 프로필(수정)·회원 등급, 친구 초대(내 초대 코드 3명), 출석 달력, 누적 훈련, 게임별 기록(최고·플레이 수·순위·최근 10판), 커뮤니티 활동.
// 데이터는 계정 저장소(account.js / account-firebase.js)의 getActivity·myScores·rankSummary 와 커뮤니티 저장소에서.
import { attendanceSummary, monthGrid, dayKey, keyInfo, sparkPoints, hoursMinutes } from './activity.js';

const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
const STATE_LABEL = { kept: '정회원 (운영자 유지)', lapsed: '베타 종료 · 정회원 기간 끝남' };

/**
 * 게임(랭킹 키) 도구: 내 정보와 운영자 회원 기록 창이 같이 쓴다. deps: { MODES, PLAY_MINUTES, rankKey, timeLabel, levelLabel }
 * KEYS = 확인할 랭킹 키 (시간제 모드는 1·3·5분, 모두 일반/투명), keyLabel = 보이는 이름, keyOrder = 정렬 순서
 */
export function gameKeyTools(deps) {
  const KEYS = [];
  for (const m of deps.MODES.filter((x) => x.id !== 'free')) {
    for (const inv of [false, true]) for (const sec of m.timed ? deps.PLAY_MINUTES.map((n) => n * 60) : [0]) KEYS.push(deps.rankKey(m.id, sec, inv));
  }
  const keyLabel = (key) => {
    const k = keyInfo(key), m = deps.MODES.find((x) => x.id === k.modeId);
    return [m ? m.name : k.modeId, m?.timed ? deps.timeLabel(m, k.seconds) : '', k.level !== 'normal' ? deps.levelLabel(k.level) : '', k.invisible ? '투명' : ''].filter(Boolean).join(' · ');
  };
  const LV_ORDER = { easy: 0, normal: 1, hard: 2 };
  const keyOrder = (key) => { const k = keyInfo(key); return deps.MODES.findIndex((x) => x.id === k.modeId) * 100000 + k.seconds * 10 + (k.invisible ? 5 : 0) + LV_ORDER[k.level]; };
  return { KEYS, keyLabel, keyOrder };
}

/**
 * deps: { $, $$, esc, tr, open, close, toast, app, MODES, PLAY_MINUTES, rankKey, timeLabel, levelLabel,
 *         COUNTRIES, countryLabel, jerseyLabel, memberBadge, stickLabel, boardOf, shortDate, refreshAuthUI, openLogin,
 *         codeLabel, inviteLink, copyText }
 */
export function initMe(deps) {
  const { $, $$, esc, tr, open, close, toast, app } = deps;
  const panel = $('#panel-me');
  const now = new Date();
  const view = { y: now.getFullYear(), m: now.getMonth() + 1, act: null, editStick: null };
  const ymd = (ms) => dayKey(ms).replace(/-/g, '.');

  const { KEYS, keyLabel, keyOrder } = gameKeyTools(deps);

  // 프로필 수정 칸 (국가 목록·스틱 버튼)
  const sel = $('#me-country');
  deps.COUNTRIES.forEach(([code, label]) => { const o = document.createElement('option'); o.value = code; o.textContent = label; sel.appendChild(o); });
  const setStick = (s) => {
    view.editStick = s;
    $$('#me-stick button').forEach((b) => { const on = b.dataset.stick === s; b.classList.toggle('active', on); b.setAttribute('aria-checked', String(on)); });
  };
  $$('#me-stick button').forEach((b) => b.addEventListener('click', () => setStick(b.dataset.stick)));
  $('#me-edit-toggle').addEventListener('click', () => {
    const f = $('#me-edit');
    if (f.classList.contains('hidden')) fillEdit();
    f.classList.toggle('hidden');
    $('#me-pw').classList.add('hidden');
  });
  // 비밀번호 바꾸기: 지금 비밀번호를 확인하고 새 비밀번호로 (회원 8자 이상 영문+숫자, 운영자는 12자 이상)
  const pwForm = $('#me-pw');
  const clearPw = () => { ['#me-pw-cur', '#me-pw-new', '#me-pw-new2'].forEach((s) => { $(s).value = ''; }); $('#me-pw-msg').classList.add('hidden'); };
  $('#me-pw-toggle').addEventListener('click', () => {
    const show = pwForm.classList.contains('hidden');
    clearPw();
    if (show) {
      const u = app.account.current();
      $('#me-pw-user').value = u?.loginId || '';
      $('#me-pw-new').placeholder = u?.admin ? '12자 이상, 영문+숫자' : '8자 이상, 영문+숫자';
    }
    pwForm.classList.toggle('hidden', !show);
    $('#me-edit').classList.add('hidden');
    if (show) $('#me-pw-cur').focus();
  });
  $('#me-pw-cancel').addEventListener('click', () => { clearPw(); pwForm.classList.add('hidden'); });
  pwForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = $('#me-pw-msg'), btn = $('#me-pw-save');
    const fail = (t) => { msg.textContent = t; msg.classList.remove('hidden'); };
    msg.classList.add('hidden');
    if ($('#me-pw-new').value !== $('#me-pw-new2').value) { fail('새 비밀번호가 서로 다릅니다'); return; }
    btn.disabled = true;
    try {
      await app.account.changePassword($('#me-pw-cur').value, $('#me-pw-new').value);
      clearPw();
      pwForm.classList.add('hidden');
      toast('비밀번호를 바꿨습니다. 다음부터 새 비밀번호로 로그인하세요', 4000);
    } catch (err) {
      fail(err.message || String(err));
    } finally { btn.disabled = false; }
  });
  $('#me-edit-cancel').addEventListener('click', () => $('#me-edit').classList.add('hidden'));
  $('#me-edit').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = $('#me-edit-msg'), btn = $('#me-edit-save');
    msg.classList.add('hidden');
    btn.disabled = true;
    try {
      await app.account.updateProfile({ country: sel.value, team: $('#me-team').value, age: $('#me-age').value, number: $('#me-number').value, stick: view.editStick || undefined });
      $('#me-edit').classList.add('hidden');
      deps.refreshAuthUI();
      renderProfile();
      toast('프로필을 저장했습니다');
    } catch (err) {
      msg.textContent = err.message || String(err); msg.classList.remove('hidden');
    } finally { btn.disabled = false; }
  });
  $('#me-login').addEventListener('click', () => { close(panel); deps.openLogin(); });
  $('#me-prev').addEventListener('click', () => { if (--view.m < 1) { view.m = 12; view.y--; } renderCalendar(); });
  $('#me-next').addEventListener('click', () => {
    const t = new Date();
    if (view.y > t.getFullYear() || (view.y === t.getFullYear() && view.m >= t.getMonth() + 1)) return;
    if (++view.m > 12) { view.m = 1; view.y++; }
    renderCalendar();
  });

  function fillEdit() {
    const u = app.account.current();
    sel.value = u.country || ''; $('#me-team').value = u.team || ''; $('#me-age').value = u.age ?? ''; $('#me-number').value = u.number ?? '';
    setStick(u.stick || null);
    $('#me-edit-msg').classList.add('hidden');
  }

  function renderProfile() {
    const u = app.account.current();
    const st = app.account.memberState ? app.account.memberState() : 'beta';
    const end = app.site?.betaEndsAt;
    const state = st === 'beta' ? (end ? `정회원 · ${deps.shortDate(end)}까지` : '정회원')
      : st === 'coupon' ? `3개월 이용권 · ${deps.shortDate(u.until)}까지` : STATE_LABEL[st] || '';
    const jersey = u.number != null ? ' <span class="jersey">' + deps.jerseyLabel(u.number) + '</span>' : '';
    const age = `${u.ageGroup} (${u.age}세)`;
    const facts = [esc(deps.countryLabel(u.country)), esc(age), u.stick ? deps.stickLabel(u.stick) : ''].filter(Boolean).join(' · ');
    const joined = u.joinedAt ? `가입 ${ymd(u.joinedAt)}` : '';
    $('#me-card').innerHTML = `<div class="me-id"><b data-ugc>${esc(u.nick)}</b>${jersey} <span class="member-badge">${esc(deps.memberBadge(u))}</span></div>
      <p class="me-facts"><span data-ugc>${esc(u.team)}</span> · ${facts}</p>
      <p class="me-facts muted">${[joined, esc(state)].filter(Boolean).join(' · ')}</p>
      ${u.loginId ? `<p class="me-facts muted">로그인 아이디 <b data-ugc>${esc(u.loginId)}</b> (나만 보여요)</p>` : ''}`;
  }

  function renderAttendance() {
    const days = view.act?.days || {};
    const s = attendanceSummary(days);
    $('#me-att-sum').innerHTML = [['연속 출석', s.streak], ['이번 달', s.month], ['전체 출석', s.total]]
      .map(([k, v]) => `<div class="me-stat"><b>${v}일</b><span>${k}</span></div>`).join('');
    renderCalendar();
  }

  function renderCalendar() {
    const days = view.act?.days || {}, today = dayKey();
    $('#me-month').textContent = `${view.y}년 ${view.m}월`;
    const t = new Date();
    $('#me-next').disabled = view.y > t.getFullYear() || (view.y === t.getFullYear() && view.m >= t.getMonth() + 1);
    const head = '<tr>' + WEEK.map((w) => '<th>' + w + '</th>').join('') + '</tr>';
    const cell = (k) => {
      if (!k) return '<td></td>';
      const d = days[k], n = d ? d.n : 0;
      const lv = !d ? '' : n >= 5 ? 'lv3' : n >= 2 ? 'lv2' : 'lv1';
      let tip = '';
      if (d && n) tip = `${n}판 · ${Math.max(1, Math.round(d.s / 60))}분`;
      else if (d) tip = tr('출석');
      const cls = [d ? 'on' : '', lv, k === today ? 'today' : ''].filter(Boolean).join(' ');
      const titleAttr = tip ? ' title="' + esc(tip) + '"' : '';
      return '<td class="' + cls + '"' + titleAttr + '><span>' + Number(k.slice(8)) + '</span></td>';
    };
    const rows = monthGrid(view.y, view.m).map((week) => '<tr>' + week.map(cell).join('') + '</tr>').join('');
    $('#me-cal').innerHTML = `<table><thead>${head}</thead><tbody>${rows}</tbody></table>`;
  }

  function renderTotals() {
    const t = view.act?.totals || { games: 0, sec: 0, dist: 0, touches: 0 };
    const hm = hoursMinutes(t.sec);
    const dist = t.dist >= 1000 ? `${(t.dist / 1000).toFixed(1)}km` : `${Math.round(t.dist)}m`;
    $('#me-totals').innerHTML = [['플레이', `${t.games}판`], ['훈련 시간', hm.h ? `${hm.h}시간 ${hm.m}분` : `${hm.m}분`], ['이동 거리', dist], ['터치', `${t.touches}회`]]
      .map(([k, v]) => `<div class="me-stat"><b>${v}</b><span>${k}</span></div>`).join('');
  }

  const spark = (list) => {
    if (!list?.length) return '<span class="muted">-</span>';
    const vals = list.map((r) => r.s), pts = sparkPoints(vals);
    const [lx, ly] = pts[pts.length - 1];
    const label = esc(tr('최근 기록'));
    return `<svg class="spark" viewBox="0 0 120 28" role="img" aria-label="${label}"><title>${vals.join(', ')}</title>`
      + (pts.length > 1 ? `<polyline points="${pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')}" />` : '')
      + `<circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="2.6" /></svg>`;
  };

  async function renderScores() {
    const body = $('#me-scores');
    body.innerHTML = `<tr><td colspan="5" class="muted">${esc(tr('불러오는 중…'))}</td></tr>`;
    let best = [];
    const recent = view.act?.recent || {};
    // 쉬움·어려움 기록은 해 본 게임만 읽는다 (최근 기록에 있는 키). 모든 난이도를 늘 읽으면 읽기 수가 두 배가 된다
    const extra = Object.keys(recent).filter((k) => !KEYS.includes(k) && keyInfo(k).level !== 'normal' && deps.MODES.some((m) => m.id === keyInfo(k).modeId && m.levels));
    try { best = await app.account.myScores([...KEYS, ...extra]); } catch { best = []; }
    const keys = [...new Set([...best.map((b) => b.mode), ...Object.keys(recent)])].filter((k) => keyInfo(k).modeId !== 'free').sort((a, b) => keyOrder(a) - keyOrder(b));
    if (!keys.length) { body.innerHTML = '<tr><td colspan="5" class="muted">아직 기록이 없습니다. 게임을 끝까지 하면 여기에 쌓입니다</td></tr>'; return; }
    body.innerHTML = keys.map((k) => {
      const b = best.find((x) => x.mode === k);
      return `<tr data-key="${esc(k)}"><td>${esc(keyLabel(k))}</td><td class="num">${b ? b.score : '-'}</td><td class="num">${b ? b.plays : (recent[k]?.length || 0)}</td>
        <td class="me-rank">${b ? '…' : '-'}</td><td>${spark(recent[k])}</td></tr>`;
    }).join('');
    // 순위는 게임마다 따로 불러와 채운다 (전체·내 국가·내 팀)
    for (const k of keys.filter((x) => best.some((b) => b.mode === x))) {
      app.account.rankSummary(k).then((r) => {
        const cell = body.querySelector(`tr[data-key="${CSS.escape(k)}"] .me-rank`);
        if (!cell) return;
        if (!r) { cell.textContent = '-'; return; }
        cell.textContent = [`전체 ${r.world.rank}위/${r.world.total}명`, r.country ? `국가 ${r.country.rank}위` : '', r.team ? `팀 ${r.team.rank}위` : ''].filter(Boolean).join(' · ');
      }).catch(() => { const cell = body.querySelector(`tr[data-key="${CSS.escape(k)}"] .me-rank`); if (cell) cell.textContent = '-'; });
    }
  }

  async function renderCommunity() {
    const box = $('#me-comm');
    box.innerHTML = `<p class="muted">${esc(tr('불러오는 중…'))}</p>`;
    const u = app.account.current();
    let posts = [];
    try { const store = await app.communityStore; posts = store ? await store.list('all') : []; } catch { box.innerHTML = '<p class="muted">커뮤니티를 불러오지 못했습니다</p>'; return; }
    const mine = posts.filter((p) => p.uid === u.id);
    const tried = posts.filter((p) => p.course && p.uid !== u.id && (p.records || []).some((r) => r.uid === u.id));
    const tag = (p) => (p.type === 'course' ? 'Course' : p.type === 'beat' ? 'New record' : 'Record');
    const mineRow = (p) => {
      const info = [p.at ? ymd(p.at) : '', `응원 ${(p.cheers || []).length}`].filter(Boolean).join(' · ');
      return `<li><span class="tag">${tag(p)}</span> <b data-ugc>${esc(p.title)}</b> <span class="muted">${info}</span></li>`;
    };
    const mineHtml = mine.length ? '<ul class="me-list">' + mine.map(mineRow).join('') + '</ul>' : '<p class="muted">아직 쓴 글이 없습니다</p>';
    const triedRow = (p) => {
      const board = deps.boardOf(p), me = board.find((r) => r.uid === u.id);
      const info = me ? `${me.rank}위/${board.length}명 · 평균 ${me.avg.toFixed(1)}s · 최고 ${me.best.toFixed(1)}s` : '';
      return `<li><b data-ugc>${esc(p.title)}</b> <span class="muted">${info}</span></li>`;
    };
    const triedHtml = tried.length ? '<ul class="me-list">' + tried.map(triedRow).join('') + '</ul>' : '<p class="muted">아직 도전한 코스가 없습니다</p>';
    box.innerHTML = `<h4>내가 쓴 글 ${mine.length}</h4>${mineHtml}<h4>도전한 코스 ${tried.length}</h4>${triedHtml}`;
  }

  /** 친구 초대: 내 초대 코드(3명까지, 추가 없음). 처음 열 때 만든다 (정회원만) */
  async function renderInvite() {
    const box = $('#me-invite');
    box.innerHTML = '<p class="muted">' + esc(tr('불러오는 중…')) + '</p>';
    let inv = null, err = null;
    try { inv = app.account.myInvite ? await app.account.myInvite() : null; } catch (e) { err = e.message || String(e); }
    if (err) { box.innerHTML = '<p class="error">' + esc(err) + '</p>'; return; }
    if (!inv) { box.innerHTML = '<p class="muted">' + esc(tr('베타 기간이 끝나 초대 코드를 만들 수 없어요')) + '</p>'; return; }
    const left = Math.max(0, inv.maxUses - inv.uses), link = deps.inviteLink(inv.code);
    const state = inv.status === 'ok' ? `${inv.uses}/${inv.maxUses}명 가입 · 남은 자리 ${left}명`
      : inv.status === 'full' ? `${inv.maxUses}명 모두 가입했어요` : '베타 기간이 끝나 쓸 수 없는 코드예요';
    box.innerHTML = `<div class="me-invite-code"><b>${esc(deps.codeLabel(inv.code))}</b> <span class="${inv.status === 'ok' ? '' : 'muted'}">${esc(state)}</span></div>`
      + (inv.status === 'ok' ? `<div class="adm-out"><input type="text" readonly value="${esc(link)}" aria-label="초대 링크" />`
        + '<button type="button" class="btn" data-inv="link">링크 복사</button><button type="button" class="btn" data-inv="code">코드 복사</button>'
        + (navigator.share ? '<button type="button" class="btn btn-primary" data-inv="share">공유</button>' : '') + '</div>' : '');
    box.querySelector('input')?.addEventListener('focus', (e) => e.target.select());
    box.querySelector('[data-inv="link"]')?.addEventListener('click', () => deps.copyText(link));
    box.querySelector('[data-inv="code"]')?.addEventListener('click', () => deps.copyText(deps.codeLabel(inv.code), '코드를 복사했습니다'));
    box.querySelector('[data-inv="share"]')?.addEventListener('click', () => {
      navigator.share({ title: tr('퍽 드리블 트레이너'), text: tr('퍽 드리블 트레이너 정회원 초대 링크예요. 이 링크로 가입하면 바로 정회원!'), url: link }).catch(() => {});
    });
  }

  async function render() {
    const u = app.account?.current();
    $('#me-guest').classList.toggle('hidden', !!u);
    $('#me-body').classList.toggle('hidden', !u);
    if (!u) return;
    $('#me-edit').classList.add('hidden');
    clearPw(); pwForm.classList.add('hidden');
    renderProfile();
    renderInvite();
    view.act = null;
    renderAttendance(); renderTotals();
    try { view.act = await app.account.getActivity(); } catch { view.act = null; }
    renderAttendance(); renderTotals();
    renderScores();
    renderCommunity();
  }

  return {
    open() { const t = new Date(); view.y = t.getFullYear(); view.m = t.getMonth() + 1; open(panel); render(); },
    render,
  };
}
