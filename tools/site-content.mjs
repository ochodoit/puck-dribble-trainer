// 검색엔진·AI 검색용 사이트 내용 (한국어 / English). tools/build-site.mjs 가 이 내용으로
// 첫 화면의 <head> 검색 정보, 영어 첫 화면(/en/), 안내 페이지(가이드·게임·FAQ), sitemap.xml, robots.txt, llms.txt, 404.html 을 만든다.
// 글 안의 표시: **굵게**, [글자](주소)

export const SITE = 'https://puck-trainer.com';

/** 검색엔진 소유 확인 (공개되는 값). 구글 서치 콘솔·Bing 웹마스터 도구·Daum 웹마스터도구·네이버 서치어드바이저에서 받은 값 */
export const VERIFY = {
  google: 'YQj_GaA3rFU0ha0gGZaFWCM3gz7MWWwLLTVLIjkQLMc',
  googleFile: 'google3d8a4c89a20c8fb9.html',
  bing: '5A21EE30137A77A9FB261F99EBCD09D8',
  daum: 'f5d13dd3f05e5ec61ca7aec976c7c0147c56bcc9cb1b9eb63c1c8269523507dd:LSr9wi71I6+MYd9iMzmuXg==', // robots.txt 맨 아래 #DaumWebMasterTool 줄
  naver: '0de5cc3fe08b89ef1da144a4243a24b07efd574f', // 네이버 서치어드바이저 (첫 화면 meta 태그)
};

/** 공식 인스타그램 (운영자 화면의 게스트 안내에 설정된 계정) */
export const SAME_AS = ['https://www.instagram.com/puck_trainer/'];

/** 한 줄 정의 — 첫 화면·안내 페이지·구조화 데이터·llms.txt 에 똑같이 쓴다 (AI 검색이 인용하기 쉽게) */
export const DEF = {
  ko: '퍽 드리블 트레이너는 휴대폰·아이패드·노트북 카메라로 퍽과 스틱을 인식해, 집에서 아이스하키 스틱핸들링을 훈련하는 무료 웹 게임입니다. 앱 설치 없이 브라우저에서 바로 시작합니다.',
  en: 'Puck Dribble Trainer is a free web game that uses the camera on your phone, iPad or laptop to track your puck and stick, so you can train ice hockey stickhandling at home. There is no app to install: it runs in the browser.',
};

export const NAME = { ko: '퍽 드리블 트레이너', en: 'Puck Dribble Trainer' };

/** 첫 화면 (게임) */
export const HOME = {
  ko: {
    title: '퍽 드리블 트레이너 — 카메라로 하는 하키 스틱핸들링 훈련 게임',
    description: '휴대폰·아이패드·노트북 카메라가 퍽과 스틱을 인식하는 무료 하키 스틱핸들링 훈련 게임. 앱 설치 없이 브라우저에서 아케이드·8자 드리블·와이드 드리블 등 7가지 게임으로 집에서 연습하세요.',
    ogTitle: '퍽 드리블 트레이너 — 집에서 하는 하키 스틱핸들링 게임',
  },
  en: {
    title: 'Puck Dribble Trainer — Hockey Stickhandling Game With Your Camera',
    description: 'A free hockey stickhandling game that tracks your puck and stick with your phone, iPad or laptop camera. No app needed: practice at home with 7 games.',
    ogTitle: 'Puck Dribble Trainer — stickhandling practice at home',
  },
};

/** 7가지 게임 (게임 페이지·구조화 데이터·llms.txt) */
export const GAMES = [
  { id: 'arcade',
    ko: { name: '아케이드', what: '내려오는 빨간 퍽을 좌우로 피하고 coin을 모읍니다. 퍽의 방향을 바꿀 때마다(터치) 점수가 오르고, 1·3·5분 동안의 점수로 겨룹니다.', skills: '좌우 스틱핸들링 · 퍽을 다루면서 주변 보기 · 순간 판단' },
    en: { name: 'Arcade', what: 'Dodge the red pucks falling down the lane and collect coins. Every change of direction (a touch) scores, and you compete on your score over 1, 3 or 5 minutes.', skills: 'Side-to-side stickhandling · seeing the play while handling the puck · quick decisions' } },
  { id: 'obstacle',
    ko: { name: '퍽 피하기', what: '경기장 네 변에서 날아오는 빨간 퍽을 피합니다. 시간이 갈수록 동시에 날아오는 퍽이 늘어납니다.', skills: '360° 퍽 컨트롤 · 급정지와 방향 전환 · 위험 읽기' },
    en: { name: 'Dodge', what: 'Avoid the red pucks flying in from all four sides of the field. More of them come at once as time goes on.', skills: '360° puck control · stops and changes of direction · reading danger' } },
  { id: 'wide',
    ko: { name: '와이드 드리블', what: '좌우 끝까지 넓게 움직이는 3가지 훈련(좌우 끝 · 양 끝 짧은 터치 · 양 끝과 가운데)을 이어서 합니다. 빨간 구역이 카메라 화면 속 실제 바닥에 그려지고, 퍽 가운데가 구역에 들어가면 인정합니다. 훈련마다 퍽을 가운데에 3초 두면 시작합니다.', skills: '넓은 스틱핸들링(와이드 핸들링) · 팔 뻗기 · 리듬' },
    en: { name: 'Wide Dribble', what: 'Three drills in a row that take the puck all the way to each side (edge to edge · short touches at both ends · both ends and the middle). The red zones are drawn on the real floor in the camera view, and a touch counts when the center of the puck enters the zone. Each drill starts when you hold the puck in the center for 3 seconds.', skills: 'Wide stickhandling · reach · rhythm' } },
  { id: 'figure8',
    ko: { name: '8자 드리블', what: '두 콘 사이를 8자로 돌며 게이트를 통과합니다. 먼저 갈 콘(왼쪽·오른쪽)과 시계·반시계 방향을 게임 화면에서 고릅니다.', skills: '포핸드·백핸드 전환 · 퍽 보호 · 돌면서 퍽 유지' },
    en: { name: 'Figure 8', what: 'Skate the puck through the gates in a figure 8 around two cones. Pick which cone comes first (left or right) and clockwise or counterclockwise on the game screen.', skills: 'Forehand–backhand transitions · protecting the puck · keeping control through turns' } },
  { id: 'quick',
    ko: { name: '퀵 핸즈', what: '실제 바닥 가운데에 그려진 박스 안에서 20초 동안 최대한 빠르게 좌우로 터치합니다. 박스 밖에서 한 터치는 세지 않습니다.', skills: '손목 속도 · 부드러운 손(소프트 핸즈) · 짧은 터치' },
    en: { name: 'Quick Hands', what: 'Touch the puck side to side as fast as you can inside the box drawn on the middle of your floor for 20 seconds. Touches outside the box do not count.', skills: 'Wrist speed · soft hands · short touches' } },
  { id: 'reaction',
    ko: { name: '반응 타겟', what: '무작위로 나타나는 타겟으로 최대한 빨리 퍽을 가져갑니다. 반응 시간과 이동 시간을 따로 기록합니다.', skills: '반응 속도 · 첫 터치 · 방향 전환' },
    en: { name: 'Reaction Target', what: 'Get the puck to targets that pop up at random spots as fast as you can. Reaction time and travel time are recorded separately.', skills: 'Reaction speed · first touch · changing direction' } },
  { id: 'free',
    ko: { name: '자유 연습', what: '번호 포인트를 놓아 나만의 코스를 만들고, 한 바퀴(사이클)마다 시간을 잽니다. 만든 코스는 커뮤니티에 공유해 다른 선수와 기록을 겨룰 수 있습니다.', skills: '코치가 원하는 드릴 그대로 · 반복 기록' },
    en: { name: 'Free Practice', what: 'Place numbered points to build your own course and time every lap (cycle). Share a course in the community and race other players on it.', skills: 'Any drill a coach wants · timed repetitions' } },
];

/** 안내 페이지. sections: [h2, 블록...] 블록 = 'p 글' | ['ul', [...]] | ['ol', [...]] */
export const PAGES = [
  {
    slug: 'guide',
    ko: {
      nav: '사용 가이드',
      title: '집에서 하는 하키 스틱핸들링 훈련 가이드 | 퍽 드리블 트레이너',
      description: '휴대폰 카메라와 퍽(또는 공) 하나로 집에서 아이스하키 스틱핸들링을 훈련하는 방법. 준비물, 카메라 높이·위치, 퍽 색 고르기, 퍽 등록, 주의사항, 15분 훈련 루틴, 헤드업까지 정리했습니다.',
      h1: '집에서 하는 하키 스틱핸들링 훈련 가이드',
      lead: '처음 시작하는 선수와 부모님, 코치를 위한 사용 가이드입니다. 카메라 위치와 퍽 색만 잘 맞추면 대부분 바로 잘 잡힙니다.',
      sections: [
        ['준비물', ['ul', [
          '**카메라가 있는 기기** — 아이패드·태블릿, 휴대폰, 노트북 웹캠 모두 됩니다.',
          '**거치대** — 기기를 80cm 이상 높이에서 바닥이 내려다보이게 세울 수 있으면 됩니다 (삼각대, 의자·선반 위 등).',
          '**바닥** — 흰 연습판이나 밝은 단색 매트가 가장 잘 인식됩니다. 폭 1~2m면 충분합니다.',
          '**퍽** — **바닥과 색이 확실히 다른 퍽(또는 공)**을 쓰세요. 바닥과 색이 다를수록 정확하게 인식합니다. 흰 바닥에는 검정·주황·빨강, 어두운 매트에는 흰색·형광색이 좋습니다.',
          '**하키 스틱** — 실내에서 쓰는 스틱이나 롤러용 블레이드가 좋습니다. 블레이드에 퍽·바닥과 다른 색 테이프(주황·파랑)를 감으면 스틱도 인식합니다.',
        ]]],
        ['카메라 위치 (가장 중요)', '카메라가 바닥을 비스듬히 내려다볼수록 퍽 위치가 정확합니다. 같은 2m×1.5m 바닥에서 카메라 높이만 바꿔 시험해 보니, 1.6m에서는 위치 오차가 약 2cm, 1.2m에서 약 3cm, 80cm에서 약 6cm였고, 50cm 이하에서는 먼 쪽에서 퍽을 놓치기 시작했습니다.', ['ul', [
          '**높이 1~1.5m가 가장 좋습니다.** 최소 80cm 이상에 두세요.',
          '**아래로 기울여** 바닥 영역이 화면 세로의 1/3 이상을 차지하게 합니다. 영역 네 모서리가 모두 화면 안에 들어오는 범위에서 최대한 크게 보이게 하세요.',
          '**너무 낮으면 인식이 어렵습니다.** 기기를 바닥에 내려놓으면(50cm 이하) 먼 쪽 바닥이 납작하게 눌려 보여서 퍽이 몇 픽셀로 작아지고, 먼 쪽에서 퍽을 놓치거나 위치가 10cm 넘게 틀어지며, 스틱 인식도 크게 흔들립니다.',
          '**노트북 웹캠**은 아래로 많이 기울일 수 없으니 노트북을 의자·상자 위에 올려 카메라를 70cm 이상 높이로 두세요.',
          '**카메라를 옮기거나 각도를 바꾸면** ‘영역’ 버튼으로 네 모서리를 다시 맞추세요. 원근(뒤쪽이 좁아 보이는 것)은 영역을 맞출 때 자동으로 보정됩니다.',
          '창문을 등지고 찍는 역광은 피하고, 바닥 전체가 고르게 밝게 해 주세요.',
        ]]],
        ['기기·큰 화면 연결 방법 (추천순)', '카메라는 1~1.5m 높이에서 바닥을 비스듬히 내려다보게, 화면은 플레이하면서 고개를 들면 보이는 정면 눈높이에 두는 것이 가장 좋습니다. 카메라와 화면을 따로 둘 수 있을수록, 그리고 선으로 연결할수록(화면이 늦게 보이지 않음) 즐기기 좋습니다.', ['ol', [
          '**노트북(PC) + USB 웹캠 + HDMI로 TV·모니터 (가장 추천)** — 웹캠을 삼각대·선반에 1~1.5m 높이로 따로 세울 수 있어 인식이 가장 정확하고, 유선이라 지연이 거의 없습니다. 웹캠을 USB로 꽂고(필요하면 USB 연장선), 노트북과 TV를 HDMI 케이블로 연결합니다(맥은 USB-C→HDMI 어댑터). 윈도우는 Win+P로 ‘복제’, 맥은 디스플레이 설정에서 ‘미러링’을 고르고, 설정 > 카메라에서 USB 웹캠을 선택합니다. F 키로 전체 화면.',
          '**휴대폰·아이패드 + HDMI 유선으로 TV** — 휴대폰 카메라는 화질이 좋고, 유선이라 지연이 적습니다. 아이폰·아이패드는 라이트닝 디지털 AV 어댑터(라이트닝 모델) 또는 USB-C→HDMI 어댑터(USB-C 모델, 아이폰 15 이후)를 씁니다. 안드로이드는 USB-C→HDMI 어댑터로 되는데, 영상 출력을 지원하는 기종만 됩니다(삼성 갤럭시 S·노트·탭 S 시리즈 등 — 설명서에서 ‘영상 출력’·‘DeX’를 확인). 휴대폰을 1~1.5m 높이에 둘 수 있게 3~5m짜리 HDMI 케이블과 충전 포트가 있는 어댑터를 쓰세요.',
          '**휴대폰·아이패드 + 무선 미러링으로 TV** — 선이 없어 두기 편하지만 화면이 0.1~0.3초쯤 늦게 보일 수 있어 반응 타겟·아케이드에서는 조금 느껴집니다. 아이폰·아이패드는 제어 센터 > ‘화면 미러링’에서 Apple TV나 AirPlay를 지원하는 TV(최근 삼성·LG 등)를 고르고, 맥(macOS Monterey 이후)으로도 보낼 수 있습니다. 안드로이드는 빠른 설정의 ‘Smart View’(삼성)나 ‘화면 전송’(크롬캐스트·구글 TV, 미라캐스트 TV)을 쓰고, 윈도우 노트북으로는 ‘이 PC로 프로젝션’(무선 디스플레이)으로 받습니다. 같은 Wi-Fi(가능하면 5GHz)에 연결하세요.',
          '**아이패드·태블릿 단독** — 화면이 커서 따로 연결하지 않아도 충분합니다. 거치대로 1m 이상 높이에 전면 카메라로 세웁니다.',
          '**노트북 내장 카메라 (+ HDMI로 TV)** — 장비 없이 바로 되지만, 내장 카메라는 아래로 기울이기 어렵고 화질이 낮아 인식에 가장 불리합니다. 노트북을 의자·상자 위에 올려 카메라를 70cm 이상에 두고 화면을 젖혀 바닥이 크게 보이게 하세요. 가능하면 1번처럼 USB 웹캠을 따로 세우는 것을 추천합니다.',
          '**휴대폰 단독** — 화면이 작아 플레이 중에 보기는 어렵지만, 처음 세팅과 짧은 연습에는 충분합니다. 가로로 두세요.',
        ]], ['ul', [
          '**후면 카메라** — TV를 보며 할 때는 휴대폰 화질이 더 좋은 후면 카메라를 써도 됩니다(화면 오른쪽 위 카메라 전환 버튼). 좌우가 반대로 느껴지면 설정에서 ‘좌우 반전(거울 모드)’을 켜세요.',
          '**충전기 연결** — 카메라와 화면 전송을 함께 쓰면 배터리가 빨리 닳습니다. 앱이 화면 꺼짐을 막지만(지원 브라우저), 저전력 모드에서는 꺼질 수 있으니 충전하면서 하세요.',
          '**TV는 ‘게임 모드’** — TV 화질 설정의 게임 모드를 켜면 화면 지연이 줄어듭니다. 소리도 TV로 나옵니다.',
          '**카메라나 화면 위치를 바꾸면** ‘영역’ 버튼으로 네 모서리를 다시 맞추세요.',
        ]]],
        ['처음 세팅 (5분)', ['ol', [
          '**기기 세우기** — 1~1.5m 높이에서 바닥을 비스듬히 내려다보게 세웁니다. 전면 카메라를 쓰면 화면을 보면서 할 수 있습니다.',
          '**카메라 시작** — 첫 화면 맨 위의 ‘카메라 시작’(또는 ‘게스트로 시작’)을 누르고 카메라 사용을 허용합니다.',
          '**1/3 영역 맞추기** — 네 모서리를 끌어 바닥 영역에 맞춥니다. 뒤쪽이 좁아 보이는 원근도 이 단계에서 보정되고, 다음부터는 맞춰 둔 영역을 그대로 씁니다.',
          '**2/3 퍽 등록** — 가운데 원(퍽 지름의 약 2배 크기) 안에 퍽(또는 공)을 놓고 3초 기다리면 색과 크기를 스스로 익힙니다.',
          '**3/3 움직여 보기** — 바닥 네 모서리의 표적에 퍽을 가져가 끝까지 잘 잡히는지 확인합니다. 먼 쪽 표적에서 자꾸 놓치면 카메라를 더 높이 두세요.',
          '**게임 시작** — 게임·시간·난이도를 고른 뒤 등록된 퍽을 원 안에 3초 두면 손대지 않고 시작합니다. 휴대폰을 가로로 두고 TV에 미러링해도 됩니다.',
        ]]],
        ['15분 훈련 루틴 예시', '주 3~4회, 짧게 자주 하는 것이 좋습니다.', ['ol', [
          '**와이드 드리블 3분** — 좌우 끝까지 넓게 몸을 풉니다.',
          '**8자 드리블 3분** — 왼쪽·오른쪽, 시계·반시계 방향을 바꿔 가며 합니다.',
          '**퀵 핸즈 2분** — 박스 안에서 짧고 빠르게 터치합니다.',
          '**반응 타겟 2분** — 타겟이 보이는 순간 출발합니다.',
          '**아케이드 또는 퍽 피하기 5분** — 퍽을 다루면서 화면 전체를 보는 연습입니다.',
        ]]],
        ['고개 들고 하기 (헤드업)', '실전에서는 퍽을 내려다보지 않고 다뤄야 합니다. 설정의 ‘내 퍽 투명도’를 조금씩 올리면 화면 속 내 퍽이 흐려지고, 100%에서는 손의 감각만으로 목표에 들어가야 합니다. 모드 화면의 ‘투명 모드’는 기록이 일반 랭킹과 따로 집계되는 별도 도전입니다.'],
        ['주의사항 — 원활하게 즐기려면', ['ul', [
          '**퍽 색은 바닥과 달라야 합니다.** 바닥과 비슷한 색이면 인식이 불안정합니다. 스케이트·신발과도 다른 색이면 더 좋습니다.',
          '**검정 퍽 + 검정 스케이트**처럼 같은 색이 닿으면 한 덩어리로 보입니다. 붙은 부분에서 퍽 모양만 떼어 내 따라가지만, 붙은 채 1.5초가 넘거나 퍽 대부분이 스케이트 밑에 들어가면 놓칠 수 있습니다.',
          '**여러 색이 섞인 공**(무지개 공 등)은 아직 잘 잡히지 않습니다. 단색 퍽·공이나, 가운데 흰색·테두리 검정처럼 한쪽 색이 바닥과 확실히 다른 두 가지 색 퍽을 쓰세요.',
          '**영역 안에 퍽과 같은 색 물건**(신발, 물병, 테이프 조각)을 두지 마세요.',
          '**스틱이 퍽을 덮으면** 화면의 퍽이 최대 1.5초 동안 흐리게 남습니다. 보정에서 스틱 색까지 등록하면 블레이드에 붙어 가려진 퍽을 블레이드 위치로 이어 줘서 더 자연스럽습니다.',
          '흐리게 남은 동안은 충돌·득점 판정을 하지 않으니 억울한 판정은 없습니다.',
          '퍽을 들어 올리거나 영역 밖으로 보내면 잠시 뒤 사라지는 것이 정상입니다. 다시 영역 안에 놓으면 바로 잡힙니다.',
          '어린 선수는 주변 가구·유리에서 떨어진 곳에서, 미끄럽지 않은 바닥 위에서 하세요.',
        ]]],
        ['보정·설정 도움말', ['ul', [
          '**퍽 다시 등록** — 퍽을 바꿨거나 조명이 크게 바뀌었으면 보정에서 ‘원 안에 3초’로 다시 등록하세요. 허용 오차도 자동으로 다시 맞춰집니다.',
          '**터치로 지정** — 보정의 ‘터치로 지정’을 누르면 어느 게임에서든 게임 화면 대신 카메라 영상이 보이고, 진행 중인 게임은 멈춥니다. 퍽 근처를 눌러도 가장 가까운 물체에 자동으로 붙습니다. 취소는 Esc.',
          '**작은 퍽** — 퍽이 화면에서 아주 작게 보이면 등록할 때 인식 해상도가 자동으로 ‘최고(400)’로 올라갑니다.',
          '**인식 세부 조정** — 설정에서 펼치면 실시간 미리보기가 나옵니다. 빨간색이 퍽, 초록색이 스틱으로 인식되는 곳입니다. 퍽만 빨갛게 칠해지면 그대로 두세요. 퍽이 덜 칠해지면 허용 오차를 올리고, 신발·그림자까지 빨개지면 내립니다. 미리보기는 설정 창 안에만 보이고 게임 화면은 가리지 않습니다.',
          '**설정은 모드 창에서도** — 모드 창 오른쪽 위 ‘설정’을 누르면 바로 열리고, 닫으면 모드 창으로 돌아옵니다.',
          '카메라가 막혀 있으면 주소창 왼쪽의 자물쇠(카메라) 아이콘에서 ‘허용’으로 바꾼 뒤 새로 고침합니다.',
          '흰 바닥이 없어도 됩니다. 영역의 네 모서리를 화면 끝까지 끌어 두면 노트북 웹캠 앞에서도 할 수 있습니다.',
        ]]],
      ],
      howto: { name: '퍽 드리블 트레이너 처음 세팅하기', steps: ['기기 세우기', '카메라 시작', '영역 맞추기', '퍽 등록', '움직여 보기', '게임 시작'] },
    },
    en: {
      nav: 'Guide',
      title: 'How to Train Hockey Stickhandling at Home | Puck Dribble Trainer',
      description: 'How to practice hockey stickhandling at home with a phone camera and a puck (or ball): what you need, camera height, picking a puck color, registering the puck, tips and a 15-minute routine.',
      h1: 'How to train hockey stickhandling at home',
      lead: 'A getting-started guide for players, parents and coaches. Get the camera position and the puck color right and tracking usually just works.',
      sections: [
        ['What you need', ['ul', [
          '**A device with a camera** — an iPad or tablet, a phone or a laptop webcam.',
          '**A stand** — anything that holds the device at least 80 cm high, looking down at the floor (a tripod, a chair or a shelf).',
          '**A floor** — a white shooting pad or a plain, light-colored mat works best. 1–2 m wide is enough.',
          '**A puck** — **use a puck (or ball) whose color clearly differs from the floor.** The more it stands out, the more accurately it is tracked. Black, orange or red on a white floor; white or neon on a dark mat.',
          '**A hockey stick** — an indoor stick or a roller blade is ideal. Wrap the blade in tape whose color differs from both the puck and the floor (orange, blue) and the stick is tracked too.',
        ]]],
        ['Camera position (the most important part)', 'The more the camera looks down at the floor at an angle, the more accurate the puck position. On the same 2 m × 1.5 m floor, changing only the camera height gave a position error of about 2 cm at 1.6 m, about 3 cm at 1.2 m and about 6 cm at 80 cm; at 50 cm and below the puck started to get lost on the far side.', ['ul', [
          '**1–1.5 m high is best.** Keep it at least 80 cm high.',
          '**Tilt it down** so the floor area fills at least a third of the screen height. Make the area as large as possible while all four corners stay on screen.',
          '**Too low makes tracking hard.** With the device on the floor (50 cm or lower) the far side of the floor looks squashed flat, the puck shrinks to a few pixels, gets lost or is off by more than 10 cm on the far side, and stick tracking becomes unreliable.',
          '**Laptop webcams** cannot tilt down much, so put the laptop on a chair or a box to get the camera at least 70 cm high.',
          '**If you move the camera or change its angle**, fit the four corners again with the Area button. Perspective (the far side looking narrower) is corrected automatically when you fit the area.',
          'Avoid shooting toward a bright window, and light the whole floor evenly.',
        ]]],
        ['Devices and big screens (best first)', 'The camera works best 1–1.5 m high, looking down at the floor at an angle, and the screen works best straight ahead at eye level, where you see it when you lift your head. The more you can place the camera and the screen separately, and the more you connect by cable (no screen delay), the better it plays.', ['ol', [
          '**Laptop (PC) + USB webcam + HDMI to a TV or monitor (best)** — the webcam stands on its own tripod or shelf at 1–1.5 m, so tracking is the most accurate, and the cable means almost no delay. Plug the webcam into USB (with a USB extension if needed) and connect the laptop to the TV with an HDMI cable (a USB-C to HDMI adapter on a Mac). On Windows press Win+P and choose Duplicate; on a Mac choose Mirror in display settings. Pick the USB webcam in Settings > Camera. F toggles full screen.',
          '**Phone or iPad + HDMI cable to a TV** — phone cameras are sharp and the cable keeps the delay low. iPhone and iPad use the Lightning Digital AV Adapter (Lightning models) or a USB-C to HDMI adapter (USB-C models, iPhone 15 and later). Android works with a USB-C to HDMI adapter only on phones with video output (some Samsung Galaxy S, Note and Tab S models, for example — look for “video output” or “DeX” in the manual). Use a 3–5 m HDMI cable and an adapter with a charging port so the phone can sit 1–1.5 m high.',
          '**Phone or iPad + wireless mirroring to a TV** — no cables, so it is easy to place, but the picture may lag 0.1–0.3 s, which you can feel in Reaction Target and Arcade. On iPhone or iPad open Control Center > Screen Mirroring and pick an Apple TV or an AirPlay TV (recent Samsung, LG and others); a Mac (macOS Monterey or later) can receive it too. On Android use Smart View (Samsung) or Cast screen (Chromecast, Google TV, Miracast TVs) in Quick Settings; a Windows laptop can receive it with “Projecting to this PC” (Wireless Display). Keep both on the same Wi-Fi, 5 GHz if possible.',
          '**iPad or tablet on its own** — the screen is big enough without connecting anything. Put it on a stand at least 1 m high with the front camera.',
          '**Laptop built-in camera (+ HDMI to a TV)** — works with no extra gear, but built-in cameras can barely tilt down and have lower quality, so tracking is the hardest. Put the laptop on a chair or a box so the camera is at least 70 cm high and tilt the screen back so the floor looks large. A separate USB webcam, as in option 1, is recommended if you can.',
          '**Phone on its own** — the screen is small to watch while playing, but fine for setting up and short practice. Turn it sideways.',
        ]], ['ul', [
          '**Rear camera** — when you watch a TV, you can use the sharper rear camera of the phone (the camera switch button at the top right). If left and right feel swapped, turn on “Mirror left/right” in Settings.',
          '**Keep it charging** — the camera plus screen mirroring drains the battery fast. The app keeps the screen awake (in supported browsers), but low power mode may still turn it off, so play while charging.',
          '**Game mode on the TV** — turn on the game mode in the TV picture settings to cut the display delay. Sound plays through the TV as well.',
          '**If you move the camera or the screen**, fit the four corners again with the Area button.',
        ]]],
        ['First setup (5 minutes)', ['ol', [
          '**Stand the device up** — 1–1.5 m high, looking down at the floor at an angle. With the front camera you can watch the screen while you play.',
          '**Start the camera** — press “Start camera” (or “Start as guest”) at the top of the first screen and allow camera access.',
          '**1/3 Fit the area** — drag the four corners onto your floor area. This also corrects the perspective when the far side looks narrower, and the saved area is reused next time.',
          '**2/3 Register the puck** — put the puck (or ball) in the center circle (about twice the puck’s size) for 3 seconds and it learns its color and size.',
          '**3/3 Test move** — take the puck to the four corner targets to check it is tracked everywhere. If the far targets keep losing it, raise the camera.',
          '**Start a game** — pick a game, time and difficulty, then hold the registered puck in the circle for 3 seconds to start hands-free. You can also turn your phone sideways and mirror it to a TV.',
        ]]],
        ['A 15-minute routine', '3–4 short sessions a week work better than one long one.', ['ol', [
          '**Wide Dribble, 3 min** — warm up by reaching edge to edge.',
          '**Figure 8, 3 min** — switch between left/right first and clockwise/counterclockwise.',
          '**Quick Hands, 2 min** — short, fast touches inside the box.',
          '**Reaction Target, 2 min** — go the moment a target appears.',
          '**Arcade or Dodge, 5 min** — handle the puck while watching the whole screen.',
        ]]],
        ['Keep your head up', 'In a game you have to handle the puck without looking down at it. Raise “My puck transparency” in Settings step by step: your puck fades on screen, and at 100% you have to reach the targets by feel alone. Invisible mode on the mode screen is a separate challenge with its own leaderboard.'],
        ['Tips for smooth play', ['ul', [
          '**The puck color must differ from the floor.** A puck close to the floor color is tracked unreliably. A color that also differs from your skates and shoes is even better.',
          '**A black puck touching black skates** looks like one blob. The app cuts the puck-shaped part out and keeps tracking it, but it can lose the puck if they stay together for more than 1.5 seconds or the puck is mostly under the skate.',
          '**Multi-colored balls** (rainbow balls and the like) are not tracked well yet. Use a single-color puck or ball, or a two-tone puck where one color clearly differs from the floor, such as a white center with a black rim.',
          '**Keep objects of the same color as the puck** (shoes, water bottles, bits of tape) out of the area.',
          '**When the stick covers the puck**, the puck stays on screen, faded, for up to 1.5 seconds. Register the stick color in Calibrate too and a puck hidden right next to the blade follows the blade, which looks more natural.',
          'While it is faded, no hits or points are counted, so you are never penalized for it.',
          'Lifting the puck or sending it out of the area makes it disappear after a moment. Put it back in the area and it is picked up right away.',
          'Young players should play away from furniture and glass, on a floor that is not slippery.',
        ]]],
        ['Calibration and settings help', ['ul', [
          '**Register the puck again** — if you changed pucks or the light changed a lot, register it again with “3 s in circle” in Calibrate. The tolerance is set again automatically.',
          '**Set by tap** — “Set by tap” in Calibrate shows the camera view instead of the game screen in every game, and pauses a game in progress. Tapping near the puck snaps to the nearest object. Press Esc to cancel.',
          '**Small puck** — if the puck looks very small on screen, the detection resolution is raised to “Highest (400)” automatically when you register it.',
          '**Detection fine-tuning** — open it in Settings for a live preview: red is what is detected as the puck, green as the stick. If only the puck is red, leave it. Raise the tolerance if the puck is only partly red; lower it if shoes or shadows turn red too. The preview stays inside the Settings window and never covers the game screen.',
          '**Settings from the mode window** — the Settings button at the top right of the mode window opens Settings; closing it brings you back to the modes.',
          'If the camera is blocked, allow it from the lock (camera) icon left of the address bar, then reload.',
          'No white floor needed. Drag the area corners to the screen edges to play in front of a laptop webcam.',
        ]]],
      ],
      howto: { name: 'Set up Puck Dribble Trainer', steps: ['Stand the device up', 'Start the camera', 'Fit the area', 'Register the puck', 'Test move', 'Start a game'] },
    },
  },
  {
    slug: 'games',
    ko: {
      nav: '7가지 게임',
      title: '7가지 하키 스틱핸들링 게임 — 무엇을 훈련하나 | 퍽 드리블 트레이너',
      description: '아케이드, 퍽 피하기, 와이드 드리블, 8자 드리블, 퀵 핸즈, 반응 타겟, 자유 연습. 퍽 드리블 트레이너의 7가지 게임이 각각 어떤 스틱핸들링 기술을 키우는지 소개합니다.',
      h1: '7가지 스틱핸들링 게임',
      lead: '모든 게임은 카메라가 실제 퍽(또는 공)의 움직임을 따라가며 판정합니다. 와이드 드리블·퀵 핸즈는 카메라 화면 속 실제 바닥에 구역을 그려 내 퍽이 영상 속 퍽과 똑같이 움직이고, 나머지 게임은 영역 전체를 위에서 내려다본 평면 판으로 보여 주며 퍽을 카메라 쪽으로 밀면 화면 위로 움직입니다.',
      gamesTitle: '게임별 훈련 효과',
      skillsLabel: '키우는 기술',
      sections: [
        ['기록과 랭킹', '아케이드·퍽 피하기·와이드 드리블은 1·3·5분 중에서 시간을 고릅니다. 가입 코드로 가입한 정회원은 게임을 끝까지 하면(자유 연습 제외) 최고 기록이 전체·국가·팀·연령대 랭킹에 오르고, 내 정보에서 출석과 게임별 최근 기록을 볼 수 있습니다.'],
      ],
    },
    en: {
      nav: 'The 7 games',
      title: '7 Stickhandling Games and What They Train | Puck Dribble Trainer',
      description: 'Arcade, Dodge, Wide Dribble, Figure 8, Quick Hands, Reaction Target and Free Practice: what each of the 7 Puck Dribble Trainer games trains in your stickhandling.',
      h1: 'The 7 stickhandling games',
      lead: 'In every game the camera follows your real puck (or ball). Wide Dribble and Quick Hands draw their zones on the real floor in the camera view, so your puck moves exactly like the puck on video. The other games show the whole area as a flat, top-down field, where pushing the puck toward the camera moves it up the screen.',
      gamesTitle: 'What each game trains',
      skillsLabel: 'Skills',
      sections: [
        ['Scores and leaderboards', 'Arcade, Dodge and Wide Dribble let you pick 1, 3 or 5 minutes. Members who joined with an invite code get their best score on the world, country, team and age-group leaderboards when they finish a game (except Free Practice), and can see their attendance and recent scores in My info.'],
      ],
    },
  },
  {
    slug: 'faq',
    ko: {
      nav: '자주 묻는 질문',
      title: '자주 묻는 질문 | 퍽 드리블 트레이너',
      description: '퍽 드리블 트레이너는 무료인가요? 앱 설치가 필요한가요? 카메라 영상은 저장되나요? 기기·바닥·나이·랭킹·가입 코드에 대한 답을 모았습니다.',
      h1: '자주 묻는 질문',
      lead: '퍽 드리블 트레이너를 처음 쓰는 분들이 많이 묻는 질문입니다.',
      faq: [
        ['퍽 드리블 트레이너는 무엇인가요?', '@DEF'],
        ['무료인가요?', '네. 누구나 무료로 플레이할 수 있습니다. 랭킹 등록과 커뮤니티 글쓰기는 가입 코드로 가입한 정회원만 할 수 있습니다.'],
        ['앱을 설치해야 하나요?', '아니요. Safari·Chrome 같은 브라우저에서 puck-trainer.com을 열면 바로 됩니다. 홈 화면에 추가하면 앱처럼 전체 화면으로 열립니다.'],
        ['어떤 기기에서 할 수 있나요?', '카메라가 있는 아이패드·태블릿, 아이폰·안드로이드 휴대폰, 노트북에서 됩니다. 기기를 거치대에 세워 바닥이 보이게 두면 됩니다.'],
        ['카메라 영상이 저장되거나 어딘가로 보내지나요?', '아니요. 영상은 기기 안에서 퍽과 스틱의 위치를 찾는 데만 쓰이고, 저장하거나 서버로 보내지 않습니다. 저장되는 것은 점수·기록·설정 같은 정보뿐입니다.'],
        ['퍽이 없어도 되나요?', '네. 공이나 병뚜껑처럼 바닥과 색이 다른 물체를 가운데 원 안에 3초 두면 그 물체를 퍽으로 익힙니다.'],
        ['어떤 바닥에서 하면 좋나요?', '흰 연습판이나 밝은 단색 매트가 가장 잘 인식됩니다. 다른 바닥도 플레이 공간의 네 모서리를 맞추면 쓸 수 있습니다. 어떤 바닥이든 퍽 색이 바닥과 확실히 달라야 정확하게 인식합니다.'],
        ['카메라는 어디에, 얼마나 높이 두나요?', '1~1.5m 높이에서 바닥을 비스듬히 내려다보게 두고, 바닥 영역이 화면 세로의 1/3 이상을 차지하게 하세요. 최소 80cm 이상이 좋습니다. 기기를 바닥에 내려놓는 것처럼 너무 낮으면(50cm 이하) 먼 쪽 바닥이 납작하게 보여 퍽이 아주 작아지고, 먼 쪽에서 퍽을 놓치거나 위치가 크게 틀어집니다. 카메라를 옮겼으면 영역을 다시 맞추세요.'],
        ['TV나 노트북처럼 큰 화면으로 볼 수 있나요?', '네. 가장 좋은 방법은 노트북에 USB 웹캠을 연결해 웹캠을 1~1.5m 높이에 따로 세우고, 노트북을 HDMI로 TV에 연결하는 것입니다. 휴대폰·아이패드는 HDMI 어댑터로 유선 연결하거나(지연이 적음), AirPlay·Smart View·크롬캐스트 같은 무선 미러링으로 TV에 띄울 수 있습니다(0.1~0.3초 늦게 보일 수 있음). 자세한 방법은 사용 가이드의 ‘기기·큰 화면 연결 방법’에 추천순으로 정리했습니다.'],
        ['어떤 퍽이나 공을 써야 잘 인식되나요?', '바닥과 색이 확실히 다른 단색 퍽·공이 가장 좋습니다(흰 바닥에는 검정·주황·빨강, 어두운 매트에는 흰색·형광색). 가운데 흰색·테두리 검정 같은 두 가지 색 퍽도 바닥과 다른 쪽 색으로 잘 따라갑니다. 무지개 공처럼 여러 색이 섞인 공은 아직 잘 잡히지 않습니다. 스케이트·신발과도 다른 색이면 더 좋습니다.'],
        ['스틱이나 스케이트가 퍽을 가리면 어떻게 되나요?', '퍽이 영역 안쪽에서 잠깐 가려지면 화면의 퍽이 최대 1.5초 동안 그 자리에 흐리게 남고, 그동안은 충돌·득점 판정을 하지 않습니다. 보정에서 스틱 색까지 등록하면 블레이드 옆에서 가려진 퍽을 블레이드 위치로 이어 줍니다. 검정 퍽이 검정 스케이트에 닿아도 퍽 모양 부분만 떼어 내 따라갑니다.'],
        ['몇 살부터 할 수 있나요?', '나이 제한은 없습니다. 랭킹은 U8부터 U18, 성인, 시니어까지 연령대별로 나뉩니다. 어린 선수는 보호자와 함께 시작하세요.'],
        ['인라인하키·롤러하키 연습에도 쓸 수 있나요?', '네. 스틱으로 퍽이나 공을 다루는 스틱핸들링 연습이라 인라인하키·롤러하키 연습에도 쓸 수 있습니다.'],
        ['랭킹에는 어떻게 오르나요?', '정회원으로 로그인한 채 게임을 끝까지 하면(자유 연습 제외) 최고 기록이 전체·국가·팀·연령대 랭킹에 오릅니다. 게스트로 한 기록은 랭킹에 오르지 않습니다.'],
        ['가입 코드는 어떻게 받나요?', '정회원 친구에게 초대 링크를 받으면 바로 가입할 수 있습니다(정회원 한 사람이 3명까지 초대). 또는 게스트로 한 판을 끝내면 결과 화면에 방법이 나옵니다. 플레이 영상을 SNS에 올리고 그 링크를 공식 인스타그램 DM으로 보내면, 확인 후 가입 코드를 보내 드립니다.'],
        ['영어로도 되나요?', '네. 첫 화면의 한국어 | English 버튼으로 바꾸거나 영어 주소(puck-trainer.com/en/)로 들어오면 됩니다.'],
        ['개인정보는 어떻게 다루나요?', '가입할 때 별명·국가·팀·나이·스틱 방향을 받습니다. 방문·플레이 통계를 위해 Google 애널리틱스를 쓰지만, 별명이나 나이 같은 개인정보는 보내지 않습니다.'],
      ],
    },
    en: {
      nav: 'FAQ',
      title: 'FAQ | Puck Dribble Trainer',
      description: 'Is Puck Dribble Trainer free? Do I need to install an app? Is the camera video saved? Answers about devices, floors, ages, leaderboards and invite codes.',
      h1: 'Frequently asked questions',
      lead: 'The questions new players ask most about Puck Dribble Trainer.',
      faq: [
        ['What is Puck Dribble Trainer?', '@DEF'],
        ['Is it free?', 'Yes. Anyone can play for free. Leaderboards and posting in the community are for members who joined with an invite code.'],
        ['Do I need to install an app?', 'No. Open puck-trainer.com in a browser such as Safari or Chrome and play. Add it to your home screen and it opens full screen like an app.'],
        ['Which devices does it work on?', 'Any iPad or tablet, iPhone or Android phone, or laptop with a camera. Put the device on a stand so it can see the floor.'],
        ['Is the camera video saved or sent anywhere?', 'No. The video is used on your device only, to find the puck and the stick. It is never saved or uploaded. Only things like scores, records and settings are stored.'],
        ['Do I need a real puck?', 'No. Hold a ball, a bottle cap or anything that stands out from the floor in the center circle for 3 seconds, and it learns that object as your puck.'],
        ['What floor works best?', 'A white shooting pad or a plain, light-colored mat is tracked best. Other floors work once you fit the four corners of the play area. On any floor, the puck color must clearly differ from the floor for accurate tracking.'],
        ['Where and how high should the camera be?', 'Put it 1–1.5 m high, looking down at the floor at an angle, so the floor area fills at least a third of the screen height. At least 80 cm is best. Too low, such as a device lying on the floor (50 cm or lower), squashes the far side of the floor flat: the puck becomes tiny and gets lost or is placed far off on the far side. If you move the camera, fit the area again.'],
        ['Can I play on a big screen like a TV or a laptop?', 'Yes. The best setup is a USB webcam on a laptop: stand the webcam on its own at 1–1.5 m high and connect the laptop to the TV with HDMI. A phone or iPad can connect by cable with an HDMI adapter (low delay) or mirror wirelessly with AirPlay, Smart View or Chromecast (may lag 0.1–0.3 s). The guide lists every option, best first, under “Devices and big screens”.'],
        ['Which puck or ball is tracked best?', 'A single-color puck or ball that clearly differs from the floor (black, orange or red on a white floor; white or neon on a dark mat). A two-tone puck such as a white center with a black rim also works, by the color that differs from the floor. Multi-colored balls such as rainbow balls are not tracked well yet. A color that also differs from your skates and shoes is even better.'],
        ['What happens when the stick or a skate covers the puck?', 'If the puck is hidden for a moment inside the area, it stays on screen, faded, for up to 1.5 seconds, and no hits or points are counted meanwhile. Register the stick color in Calibrate too and a puck hidden next to the blade follows the blade. A black puck touching a black skate is cut out of the blob and tracked as well.'],
        ['What age is it for?', 'There is no age limit. Leaderboards are split by age group from U8 to U18, adult and senior. Young players should start with a parent.'],
        ['Can I use it for inline or roller hockey?', 'Yes. It trains stickhandling with a puck or a ball, so it works for inline and roller hockey practice too.'],
        ['How do I get on the leaderboard?', 'Finish a game (except Free Practice) while logged in as a member and your best score goes on the world, country, team and age-group leaderboards. Guest scores are not ranked.'],
        ['How do I get an invite code?', 'Get an invite link from a member friend (each member can invite up to 3 people). Or finish a game as a guest and the results screen shows how: post your play on social media and DM the link to our official Instagram, and we will send you a code.'],
        ['Is it available in English?', 'Yes. Switch with the language buttons (Korean | English) on the first screen, or open the English address, puck-trainer.com/en/.'],
        ['How is my personal data handled?', 'When you join we ask for a nickname, country, team, age and stick side. We use Google Analytics to count visits and plays, but no personal details such as nicknames or ages are sent.'],
      ],
    },
  },
];

/** 안내 페이지 공통 글자 */
export const UI = {
  ko: { home: '홈', start: '지금 무료로 시작하기', other: 'English', otherLang: 'en', navLabel: '안내 페이지', crumbLabel: '현재 위치', copyright: '© 2026 ochodoit · Puck Dribble Trainer · 무단 복제·배포 금지', analytics: '방문·플레이 통계를 위해 Google 애널리틱스를 씁니다. 별명·나이 같은 개인정보는 보내지 않습니다.' },
  en: { home: 'Home', start: 'Start free now', other: '한국어', otherLang: 'ko', navLabel: 'Guide pages', crumbLabel: 'You are here', copyright: '© 2026 ochodoit · Puck Dribble Trainer · All rights reserved', analytics: 'We use Google Analytics to count visits and plays. No personal details such as nicknames or ages are sent.' },
};
