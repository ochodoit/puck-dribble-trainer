// 게임 시계: 설정·운영자 같은 옵션 창이 떠 있는 동안은 흐르지 않는다.
// main 의 loop 가 멈춘 시간만큼 offset 을 늘리고, 게임·아케이드는 performance.now() 대신 clockNow() 를 쓴다.
export const clock = { offset: 0, pausedAt: null };
export const clockNow = () => performance.now() - clock.offset;
