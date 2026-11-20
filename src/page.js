// 안내 페이지(가이드·게임·FAQ)용: 방문 통계만 켠다 (공식 주소에서만, 개인정보 없이). 게임 코드는 불러오지 않는다
import { initAnalytics } from './analytics.js';

initAnalytics();

// 사용 가이드의 목차: 지금 읽는 절을 표시한다. 넓은 화면은 왼쪽에 따라다니는 목차, 휴대폰·태블릿은 위에 붙는 가로 띠 —
// 가로 띠는 지금 칸이 보이게 옆으로 민다
const toc = document.querySelector('.toc');
if (toc) {
  const list = toc.querySelector('ol');
  const links = [...toc.querySelectorAll('a[href^="#"]')];
  const secs = links.map((a) => document.getElementById(decodeURIComponent(a.hash.slice(1))));
  const wideMq = matchMedia('(min-width: 1040px)');
  let cur = -1, ticking = false;
  const mark = () => {
    ticking = false;
    const wide = wideMq.matches;
    const line = wide ? 140 : toc.getBoundingClientRect().bottom + 30; // 이 높이를 지난 마지막 절이 지금 절
    let i = 0;
    secs.forEach((s, k) => { if (s && s.getBoundingClientRect().top <= line) i = k; });
    if (innerHeight + scrollY >= document.documentElement.scrollHeight - 4) i = secs.length - 1; // 맨 아래면 마지막 절
    if (i === cur) return;
    cur = i;
    links.forEach((a, k) => {
      a.classList.toggle('on', k === i);
      if (k === i) a.setAttribute('aria-current', 'location'); else a.removeAttribute('aria-current');
    });
    if (!wide && list.scrollWidth > list.clientWidth) {
      const a = links[i];
      list.scrollTo({ left: Math.max(0, a.offsetLeft - (list.clientWidth - a.offsetWidth) / 2), behavior: 'smooth' });
    }
  };
  addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(mark); } }, { passive: true });
  addEventListener('resize', () => { cur = -1; mark(); });
  mark();
}
