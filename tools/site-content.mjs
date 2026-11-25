// 검색엔진·AI 검색용 사이트 내용 (한국어 / English). tools/build-site.mjs 가 이 내용으로
// 첫 화면의 <head> 검색 정보, 영어 첫 화면(/en/), 안내 페이지(가이드·게임·FAQ), sitemap.xml, rss.xml, robots.txt, llms.txt, 404.html 을 만든다.
// 글 안의 표시: **굵게**, [글자](주소)

export const SITE = 'https://puck-trainer.com';

/**
 * 페이지마다 내용을 마지막으로 크게 바꾼 날 (YYYY-MM-DD). sitemap.xml 의 <lastmod>, rss.xml 의 <pubDate> 로 나간다.
 * 네이버·구글·Bing 이 바뀐 페이지를 먼저 다시 가져가게 하는 값이라, 페이지 내용을 바꾸면 이 날짜도 고친다. '' = 첫 화면
 */
export const UPDATED = { '': '2026-11-21', guide: '2026-11-20', games: '2026-11-19', faq: '2026-11-20' };

/** 검색엔진 소유 확인 (공개되는 값). 구글 서치 콘솔·Bing 웹마스터 도구·Daum 웹마스터도구·네이버 서치어드바이저에서 받은 값 */
export const VERIFY = {
  google: 'YQj_GaA3rFU0ha0gGZaFWCM3gz7MWWwLLTVLIjkQLMc',
  googleFile: 'google3d8a4c89a20c8fb9.html',
  bing: '5A21EE30137A77A9FB261F99EBCD09D8',
  daum: 'f5d13dd3f05e5ec61ca7aec976c7c0147c56bcc9cb1b9eb63c1c8269523507dd:LSr9wi71I6+MYd9iMzmuXg==', // robots.txt 맨 아래 #DaumWebMasterTool 줄
  naver: '0de5cc3fe08b89ef1da144a4243a24b07efd574f', // 네이버 서치어드바이저 (첫 화면 meta 태그)
  // IndexNow 키 (공개되는 값, 우리가 만든 임의의 32자). 사이트 루트의 <키>.txt 로 소유를 증명하고,
  // 배포 뒤 tools/indexnow.mjs 가 이 키로 바뀐 페이지를 네이버·Bing 에 알린다. 바꾸면 이전 키 파일은 더 이상 배포되지 않는다
  indexnow: 'adc596214f1816d3cd9de83acad9a56b',
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
    // 사용 가이드는 디자인된 한 장짜리 안내로 그린다 (tools/build-site.mjs guidePage). 글은 짧게, 자세한 내용은 펼쳐 보기
    ko: {
      nav: '사용 가이드',
      title: '집에서 하는 하키 스틱핸들링 훈련 가이드 | 퍽 드리블 트레이너',
      description: '휴대폰 카메라와 퍽(또는 공) 하나로 집에서 아이스하키 스틱핸들링을 훈련하는 방법. 카메라 높이·위치, 퍽 색 고르기, 큰 화면 연결, 처음 세팅, 주의사항, 15분 훈련 루틴까지 한눈에.',
      h1: '집에서 하는 하키 스틱핸들링 훈련 가이드',
      lead: '카메라 위치와 퍽 색만 잘 맞추면 대부분 바로 잘 잡힙니다.',
      howto: { name: '퍽 드리블 트레이너 처음 세팅하기', steps: ['기기 세우기', '카메라 시작', '영역 맞추기', '퍽 등록', '움직여 보기', '게임 시작'] },
      guide: {
        toc: '목차',
        glance: { id: 'glance', toc: '한눈에 보기', title: '한눈에 보기',
          steps: [['camera', '세우기', '1~1.5m 높이에서 바닥을 비스듬히'], ['area', '영역 맞추기', '네 모서리를 바닥에'], ['circle', '퍽 등록', '가운데 원에 3초'], ['play', '시작', '게임을 고르고 원에 3초']],
          rulesTitle: '꼭 지킬 3가지',
          rules: [['1~1.5m', '카메라 높이 (최소 80cm)'], ['퍽 ≠ 바닥', '바닥과 확실히 다른 색 퍽'], ['HDMI', '큰 화면은 선으로 연결']] },
        camera: { id: 'camera', toc: '카메라 위치', title: '카메라 위치',
          lead: '바닥을 비스듬히 내려다볼수록 퍽 위치가 정확합니다.',
          art: { height: '1~1.5m', min: '최소 80cm', tilt: '아래로 비스듬히', area: '플레이 영역', you: '선수' },
          artLabel: '카메라를 1~1.5m 높이의 삼각대에 두고 아래로 비스듬히 플레이 영역을 내려다보게 한 그림',
          chart: { title: '카메라 높이별 위치 오차', note: '2m×1.5m 바닥, 실제 크기 퍽으로 시험한 평균 오차', unit: 'cm', best: '추천',
            rows: [['2.2m', 1.2], ['1.6m', 2.1, null, true], ['1.2m', 3.4, null, true], ['80cm', 5.6], ['50cm', null, '먼 쪽에서 놓침'], ['25cm', null, '추적 실패']] },
          points: [
            '**1~1.5m**, 최소 80cm. 바닥 영역이 화면 세로의 **1/3 이상** 보이게 아래로 기울이세요.',
            '**너무 낮으면 인식이 어렵습니다.** 바닥에 내려놓으면 먼 쪽 바닥이 납작해져 퍽을 놓칩니다.',
            '노트북은 의자·상자 위에 올려 카메라를 **70cm 이상**에 두세요.',
            '카메라를 옮기면 **‘영역’ 버튼으로 다시 맞추기.** 역광은 피하고 바닥을 고르게 밝게.',
          ],
          tv: { title: 'TV를 보며 할 때 (화면을 가리지 않게)', items: [
            '**TV 위 가운데가 가장 좋아요** — 높고, 정면이고, 화면을 가리지 않습니다. 1.6m 높이에서 시험한 위치 오차는 약 2cm.',
            '**TV 옆도 괜찮아요** — 네 모서리만 맞추면 정확도가 정면과 거의 같습니다(옆으로 1m·약 30°에서 1.2m 높이 오차 3.6cm). 옆으로 45°보다 많이 가면 먼 쪽 퍽이 작아지니 TV에 붙여 두세요.',
            '옆에 두었을 때는 영역의 **‘앞’ 두 모서리를 TV(카메라) 쪽 바닥 끝**에 맞추세요. 그래야 TV 쪽으로 밀면 화면 위로 갑니다.',
            '**3/3 움직여 보기**가 끝나면 카메라 높이를 점검해 ‘더 높이 / 지금이 최소 / 좋아요 / 조금 낮춰도 돼요’로 알려 줍니다.',
          ] } },
        puck: { id: 'puck', toc: '퍽 고르기', title: '퍽 고르기',
          lead: '바닥과 색이 확실히 다를수록 정확하게 인식합니다.',
          cards: [
            [{ floor: 'light', puck: 'black', ok: true }, '흰 바닥 + 검정'],
            [{ floor: 'light', puck: 'orange', ok: true }, '흰 바닥 + 주황·빨강'],
            [{ floor: 'dark', puck: 'white', ok: true }, '어두운 매트 + 흰색·형광'],
            [{ floor: 'light', puck: 'twotone', ok: true }, '두 가지 색 퍽'],
            [{ floor: 'light', puck: 'white', ok: false }, '흰 바닥 + 흰 퍽'],
            [{ floor: 'light', puck: 'rainbow', ok: false }, '여러 색 공 (아직)'],
          ],
          note: '스케이트·신발과도 다른 색이면 더 좋습니다. 스틱 블레이드에는 퍽·바닥과 다른 색(주황·파랑) 테이프를 감으세요.',
          floors: { title: '바닥별 추천 (흰 바닥이 아니어도 됩니다)', note: '24곳으로 옮기며 시험한 결과 (검정 퍽 / 주황 공)', items: [
            ['장판·마루', '검정·색 공 모두 OK', '24/24 · 24/24', true],
            ['차고지 콘크리트', '주황·형광 공 추천 — 검정은 기름 얼룩·줄눈과 헷갈림', '9/24 · 24/24', false],
            ['옥상·야외 햇빛', '주황·형광 공 추천 — 검정은 몸 그림자와 헷갈림', '0/24 · 24/24', false],
            ['거친 바닥 전체', '스트리트 하키 공·롤러용 퍽이 잘 굴러가고 스틱도 덜 닳아요', '', true],
          ] } },
        screens: { id: 'screens', toc: '큰 화면 연결', title: '기기·큰 화면 연결 (추천순)',
          lead: '카메라와 화면을 따로 두고, 선으로 연결할수록 좋습니다. 휴대폰·태블릿만 쓰면 카메라를 바닥 쪽으로 기울이는 만큼 화면도 기울어 보기 불편해요.',
          howLabel: '연결 방법',
          options: [
            [['laptop', 'webcam', 'tv'], '노트북 + USB 웹캠 + HDMI', '가장 추천', '인식이 가장 정확 · 지연 거의 없음',
              '웹캠을 USB로 꽂고(필요하면 USB 연장선) 삼각대·선반에 1~1.5m로 세웁니다. 노트북과 TV를 HDMI 케이블로 연결합니다(맥은 USB-C→HDMI 어댑터). 윈도우는 Win+P로 ‘복제’, 맥은 디스플레이 설정에서 ‘미러링’. 앱의 설정 > 카메라에서 USB 웹캠을 고르고, F 키로 전체 화면.'],
            [['phone', 'cable', 'tv'], '휴대폰·아이패드 + HDMI 유선', '추천', '좋은 화질 · 지연 적음',
              '아이폰·아이패드: 라이트닝 디지털 AV 어댑터(라이트닝 모델) 또는 USB-C→HDMI 어댑터(USB-C 모델, 아이폰 15 이후). 안드로이드: USB-C→HDMI 어댑터 — 영상 출력을 지원하는 기종만 됩니다(삼성 갤럭시 S·노트·탭 S 시리즈 등, 설명서에서 ‘영상 출력’·‘DeX’ 확인). 3~5m HDMI 케이블과 충전 포트가 있는 어댑터를 쓰면 휴대폰을 1~1.5m 높이에 둘 수 있습니다.'],
            [['phone', 'wifi', 'tv'], '휴대폰·아이패드 + 무선 미러링', '간편', '선이 없음 · 0.1~0.3초 늦게 보일 수 있음',
              '아이폰·아이패드: 제어 센터 > ‘화면 미러링’ > Apple TV 또는 AirPlay 지원 TV(최근 삼성·LG 등), 맥(macOS Monterey 이후)도 됩니다. 안드로이드: 빠른 설정의 ‘Smart View’(삼성) 또는 ‘화면 전송’(크롬캐스트·구글 TV·미라캐스트 TV). 윈도우 노트북은 ‘이 PC로 프로젝션’(무선 디스플레이)으로 받습니다. 같은 Wi-Fi(가능하면 5GHz)에 연결하세요.'],
            [['laptop', 'cable', 'tv'], '노트북 내장 카메라 + HDMI로 TV', '', '큰 화면은 편함 · 인식은 가장 불리',
              '내장 카메라는 아래로 기울이기 어렵고 화질이 낮습니다. 노트북을 의자·상자 위에 올려 카메라를 70cm 이상에 두고 화면을 젖혀 바닥이 크게 보이게 하세요. TV에 연결하면 고개를 들고 보기 편합니다. 가능하면 1번처럼 USB 웹캠을 따로 세우세요.'],
            [['tablet'], '아이패드·태블릿 단독', '', '연결 없이 바로 · 화면 보기는 불편',
              '카메라가 바닥을 보게 아래로 기울이면 화면도 함께 아래를 향해, 서서 플레이하면 화면이 비스듬하고 작게 보입니다. 세팅과 가벼운 연습에 좋고, 제대로 할 때는 2·3번처럼 TV에 연결하세요. 단독으로 할 때는 1m 이상 높이에서, 영역이 화면 세로의 1/3쯤 보일 만큼만 기울이세요.'],
            [['phone'], '휴대폰 단독', '', '세팅·짧은 연습용 · 플레이 중 보기 어려움',
              '화면이 작고 바닥 쪽으로 기울어 플레이하면서 보기는 어렵습니다. 처음 세팅(영역·퍽 등록)과 짧은 연습에 쓰고, 플레이는 TV에 연결해서 하세요. 가로로 두세요.'],
          ],
          tips: ['TV를 보며 할 때는 화질 좋은 **후면 카메라**도 OK (좌우가 반대면 설정의 거울 모드)', '**충전기**를 꽂고 하세요', 'TV는 **게임 모드**로', '카메라·화면을 옮기면 **영역 다시**'] },
        setup: { id: 'setup', toc: '처음 세팅', title: '처음 세팅 (5분)',
          steps: [
            '**기기 세우기** — 1~1.5m 높이에서 바닥을 비스듬히 내려다보게 세웁니다.',
            '**카메라 시작** — 첫 화면의 ‘카메라 시작’(또는 ‘게스트로 시작’)을 누르고 카메라를 허용합니다.',
            '**1/3 영역 맞추기** — 네 모서리를 끌어 바닥에 맞춥니다. 원근(뒤쪽이 좁아 보임)도 여기서 보정됩니다. 바닥에 선이 없으면 모서리에 테이프·동전을 놓고 맞추세요.',
            '**2/3 퍽 등록** — 가운데 원(퍽의 약 2배 크기)에 퍽을 3초 두면 색과 크기를 익힙니다.',
            '**3/3 움직여 보기** — 네 모서리 표적에 퍽을 가져가 봅니다. 끝나면 카메라 높이가 괜찮은지 알려 줍니다.',
            '**게임 시작** — 게임·시간·난이도를 고르고 퍽을 원에 3초 두면 손대지 않고 시작합니다.',
          ] },
        routine: { id: 'routine', toc: '15분 루틴', title: '15분 훈련 루틴', lead: '주 3~4회, 짧게 자주 하는 것이 좋습니다.', unit: '분',
          items: [['와이드 드리블', 3, '좌우 끝까지 넓게 몸 풀기'], ['8자 드리블', 3, '방향을 바꿔 가며'], ['퀵 핸즈', 2, '박스 안에서 짧고 빠르게'], ['반응 타겟', 2, '보이는 순간 출발'], ['아케이드·퍽 피하기', 5, '퍽을 다루며 화면 전체 보기']] },
        headsup: { id: 'headsup', toc: '헤드업', title: '고개 들고 하기 (헤드업)',
          text: '설정의 **‘내 퍽 투명도’**를 조금씩 올리면 화면 속 내 퍽이 흐려지고, 100%에서는 손의 감각만으로 목표에 들어가야 합니다. 모드 화면의 **‘투명 모드’**는 기록이 따로 집계되는 도전입니다.' },
        cautions: { id: 'cautions', toc: '주의사항', title: '주의사항',
          items: [
            ['color', '퍽 색 ≠ 바닥 색', '비슷한 색이면 인식이 흔들립니다.'],
            ['skate', '같은 색 스케이트', '닿으면 퍽 모양만 떼어 내 따라가지만, 1.5초 넘게 붙어 있거나 밑에 깔리면 놓칠 수 있습니다.'],
            ['objects', '영역 안 물건', '퍽과 같은 색 물건(신발·물병·테이프)은 치우세요.'],
            ['stick', '스틱이 퍽을 덮으면', '최대 1.5초 흐리게 남고 그동안 판정은 하지 않습니다. 스틱 색을 등록하면 블레이드로 이어 줍니다.'],
            ['lift', '퍽을 들어 올리면', '잠시 뒤 사라지고, 다시 영역에 놓으면 바로 잡힙니다.'],
            ['safety', '안전', '가구·유리에서 떨어져, 미끄럽지 않은 바닥에서 하세요.'],
          ] },
        help: { id: 'help', toc: '보정·설정 도움말', title: '보정·설정 도움말',
          items: [
            ['퍽 다시 등록', '퍽을 바꿨거나 조명이 크게 바뀌었으면 보정에서 ‘원 안에 3초’로 다시 등록하세요. 허용 오차도 자동으로 다시 맞춰집니다.'],
            ['터치로 지정', '보정의 ‘터치로 지정’을 누르면 어느 게임에서든 카메라 영상이 보이고 게임은 멈춥니다. 퍽 근처를 눌러도 가장 가까운 물체에 붙습니다. 취소는 Esc.'],
            ['작은 퍽', '퍽이 화면에서 아주 작게 보이면 등록할 때 인식 해상도가 자동으로 ‘최고(400)’가 됩니다.'],
            ['인식 세부 조정', '설정에서 펼치면 실시간 미리보기가 나옵니다. 빨강이 퍽, 초록이 스틱입니다. 퍽만 빨가면 그대로 두세요. 퍽이 덜 칠해지면 허용 오차를 올리고, 신발·그림자까지 빨개지면 내립니다. 미리보기는 설정 창 안에만 보입니다.'],
            ['모드 창에서 설정', '모드 창 오른쪽 위 ‘설정’으로 바로 열고, 닫으면 모드 창으로 돌아옵니다.'],
            ['카메라가 막혀 있으면', '주소창 왼쪽의 자물쇠(카메라) 아이콘에서 ‘허용’으로 바꾼 뒤 새로 고침합니다.'],
            ['흰 바닥·선이 없다면', '장판·콘크리트도 됩니다(퍽 고르기의 바닥별 추천 참고). 선이 없으면 모서리 네 곳에 테이프·동전을 놓고 영역을 맞추세요 — 한 번 맞추면 선 없이도 플레이됩니다. 노트북 웹캠 앞이라면 네 모서리를 화면 끝까지 끌어 두어도 됩니다.'],
          ] },
      },
    },
    en: {
      nav: 'Guide',
      title: 'How to Train Hockey Stickhandling at Home | Puck Dribble Trainer',
      description: 'How to practice hockey stickhandling at home with a phone camera and a puck (or ball): camera height, picking a puck color, big screens, first setup, tips and a 15-minute routine at a glance.',
      h1: 'How to train hockey stickhandling at home',
      lead: 'Get the camera position and the puck color right and tracking usually just works.',
      howto: { name: 'Set up Puck Dribble Trainer', steps: ['Stand the device up', 'Start the camera', 'Fit the area', 'Register the puck', 'Test move', 'Start a game'] },
      guide: {
        toc: 'Contents',
        glance: { id: 'glance', toc: 'At a glance', title: 'At a glance',
          steps: [['camera', 'Stand it up', '1–1.5 m high, looking down at an angle'], ['area', 'Fit the area', 'Drag the four corners onto the floor'], ['circle', 'Register the puck', '3 s in the center circle'], ['play', 'Start', 'Pick a game, 3 s in the circle']],
          rulesTitle: 'The 3 rules',
          rules: [['1–1.5 m', 'Camera height (at least 80 cm)'], ['Puck ≠ floor', 'A puck that clearly differs from the floor'], ['HDMI', 'Use a cable for big screens']] },
        camera: { id: 'camera', toc: 'Camera position', title: 'Camera position',
          lead: 'The more the camera looks down at the floor at an angle, the more accurate the puck position.',
          art: { height: '1–1.5 m', min: 'at least 80 cm', tilt: 'tilted down', area: 'Play area', you: 'Player' },
          artLabel: 'A camera on a tripod 1–1.5 m high, tilted down at the play area',
          chart: { title: 'Position error by camera height', note: 'Average error on a 2 m × 1.5 m floor with a real-size puck', unit: 'cm', best: 'best',
            rows: [['2.2 m', 1.2], ['1.6 m', 2.1, null, true], ['1.2 m', 3.4, null, true], ['80 cm', 5.6], ['50 cm', null, 'lost on far side'], ['25 cm', null, 'tracking fails']] },
          points: [
            '**1–1.5 m**, at least 80 cm. Tilt it down so the floor area fills **a third of the screen height** or more.',
            '**Too low makes tracking hard.** On the floor, the far side looks squashed flat and the puck gets lost.',
            'Put a laptop on a chair or a box so its camera is **at least 70 cm** high.',
            'If you move the camera, **fit the area again** with the Area button. Avoid backlight and light the floor evenly.',
          ],
          tv: { title: 'Playing in front of a TV (without blocking it)', items: [
            '**On top of the TV, centered, is best** — high, straight on and out of the way of the screen. Tested at 1.6 m, the position error was about 2 cm.',
            '**Beside the TV works too** — once the four corners are fitted, accuracy is almost the same as straight on (1 m to the side, about 30°, at 1.2 m: 3.6 cm). Much more than 45° to the side makes the far puck small, so keep it close to the TV.',
            'With the camera beside the TV, put the area’s **two “front” corners on the floor edge nearest the TV (camera)**, so pushing toward the TV moves up on screen.',
            'After the **3/3 test move**, the app checks the camera height and tells you: raise it, this is the lowest to use, good, or you may lower it a little.',
          ] } },
        puck: { id: 'puck', toc: 'Picking a puck', title: 'Picking a puck',
          lead: 'The more the puck color differs from the floor, the more accurately it is tracked.',
          cards: [
            [{ floor: 'light', puck: 'black', ok: true }, 'White floor + black'],
            [{ floor: 'light', puck: 'orange', ok: true }, 'White floor + orange or red'],
            [{ floor: 'dark', puck: 'white', ok: true }, 'Dark mat + white or neon'],
            [{ floor: 'light', puck: 'twotone', ok: true }, 'Two-tone puck'],
            [{ floor: 'light', puck: 'white', ok: false }, 'White floor + white puck'],
            [{ floor: 'light', puck: 'rainbow', ok: false }, 'Multi-colored ball (not yet)'],
          ],
          note: 'A color that also differs from your skates and shoes is even better. Wrap the stick blade in tape that differs from the puck and the floor (orange, blue).',
          floors: { title: 'By floor type (no white floor needed)', note: 'Tested over 24 positions (black puck / orange ball)', items: [
            ['Vinyl or wood', 'Black or colored balls both work', '24/24 · 24/24', true],
            ['Garage concrete', 'Use an orange or neon ball — black gets mixed up with oil stains and joints', '9/24 · 24/24', false],
            ['Rooftop or outdoors in sun', 'Use an orange or neon ball — black gets mixed up with your shadow', '0/24 · 24/24', false],
            ['Any rough floor', 'A street hockey ball or a roller puck rolls better and wears the stick less', '', true],
          ] } },
        screens: { id: 'screens', toc: 'Big screens', title: 'Devices and big screens (best first)',
          lead: 'Place the camera and the screen separately, and connect by cable when you can. With a phone or tablet alone, tilting the camera toward the floor tilts the screen too, which makes it hard to watch.',
          howLabel: 'How to connect',
          options: [
            [['laptop', 'webcam', 'tv'], 'Laptop + USB webcam + HDMI', 'Best', 'Most accurate tracking · almost no delay',
              'Plug the webcam into USB (with an extension if needed) and stand it on a tripod or shelf at 1–1.5 m. Connect the laptop to the TV with HDMI (a USB-C to HDMI adapter on a Mac). Press Win+P and choose Duplicate on Windows, or Mirror in display settings on a Mac. Pick the USB webcam in Settings > Camera and press F for full screen.'],
            [['phone', 'cable', 'tv'], 'Phone or iPad + HDMI cable', 'Great', 'Sharp camera · low delay',
              'iPhone and iPad: the Lightning Digital AV Adapter (Lightning models) or a USB-C to HDMI adapter (USB-C models, iPhone 15 and later). Android: a USB-C to HDMI adapter, only on phones with video output (some Samsung Galaxy S, Note and Tab S models, for example; look for “video output” or “DeX” in the manual). A 3–5 m HDMI cable and an adapter with a charging port let the phone sit 1–1.5 m high.'],
            [['phone', 'wifi', 'tv'], 'Phone or iPad + wireless mirroring', 'Easy', 'No cables · may lag 0.1–0.3 s',
              'iPhone and iPad: Control Center > Screen Mirroring > an Apple TV or an AirPlay TV (recent Samsung, LG and others); a Mac with macOS Monterey or later works too. Android: Smart View (Samsung) or Cast screen (Chromecast, Google TV, Miracast TVs) in Quick Settings. A Windows laptop receives it with Projecting to this PC (Wireless Display). Keep both on the same Wi-Fi, 5 GHz if possible.'],
            [['laptop', 'cable', 'tv'], 'Laptop built-in camera + HDMI to a TV', '', 'Big screen is comfortable · hardest for tracking',
              'Built-in cameras can barely tilt down and have lower quality. Put the laptop on a chair or a box so the camera is at least 70 cm high and tilt the screen back so the floor looks large. Connecting a TV lets you watch with your head up. A separate USB webcam, as in option 1, is better if you can.'],
            [['tablet'], 'iPad or tablet on its own', '', 'No connecting · screen is awkward to watch',
              'Tilting it so the camera sees the floor tilts the screen down too, so standing players see it small and at an angle. Good for setting up and light practice; for real play connect a TV as in options 2 and 3. On its own, put it at least 1 m high and tilt it only enough for the area to fill about a third of the screen height.'],
            [['phone'], 'Phone on its own', '', 'For setup and short practice · hard to watch while playing',
              'The screen is small and tilted toward the floor, so it is hard to watch while playing. Use it for setting up (area and puck) and short practice, and connect a TV to play. Turn it sideways.'],
          ],
          tips: ['Watching a TV? The sharper **rear camera** works too (mirror mode in Settings if left and right feel swapped)', 'Keep it **charging**', 'Turn on **game mode** on the TV', 'Moved the camera or screen? **Fit the area again**'] },
        setup: { id: 'setup', toc: 'First setup', title: 'First setup (5 minutes)',
          steps: [
            '**Stand the device up** — 1–1.5 m high, looking down at the floor at an angle.',
            '**Start the camera** — press “Start camera” (or “Start as guest”) on the first screen and allow camera access.',
            '**1/3 Fit the area** — drag the four corners onto the floor. This also corrects the perspective (the far side looking narrower). No lines on the floor? Put tape or coins on the corners first.',
            '**2/3 Register the puck** — hold the puck in the center circle (about twice its size) for 3 seconds; it learns the color and size.',
            '**3/3 Test move** — take the puck to the four corner targets. When you finish, it tells you whether the camera height is right.',
            '**Start a game** — pick a game, time and difficulty, then hold the puck in the circle for 3 seconds to start hands-free.',
          ] },
        routine: { id: 'routine', toc: '15-min routine', title: 'A 15-minute routine', lead: '3–4 short sessions a week work better than one long one.', unit: 'min',
          items: [['Wide Dribble', 3, 'Warm up by reaching edge to edge'], ['Figure 8', 3, 'Switch directions'], ['Quick Hands', 2, 'Short, fast touches in the box'], ['Reaction Target', 2, 'Go the moment it appears'], ['Arcade or Dodge', 5, 'Handle the puck, watch the whole screen']] },
        headsup: { id: 'headsup', toc: 'Heads up', title: 'Keep your head up',
          text: 'Raise **“My puck transparency”** in Settings step by step: your puck fades on screen, and at 100% you reach the targets by feel alone. **Invisible mode** on the mode screen is a separate challenge with its own leaderboard.' },
        cautions: { id: 'cautions', toc: 'Things to know', title: 'Things to know',
          items: [
            ['color', 'Puck ≠ floor color', 'A puck close to the floor color is tracked unreliably.'],
            ['skate', 'Same-color skates', 'When they touch, the puck-shaped part is cut out and tracked, but it can be lost after 1.5 s of contact or when the puck is mostly under the skate.'],
            ['objects', 'Things in the area', 'Remove objects of the puck’s color (shoes, bottles, tape).'],
            ['stick', 'Stick covering the puck', 'The puck stays faded for up to 1.5 s and nothing is scored meanwhile. Register the stick color and it follows the blade.'],
            ['lift', 'Lifting the puck', 'It disappears after a moment and is picked up again as soon as you put it back.'],
            ['safety', 'Safety', 'Play away from furniture and glass, on a floor that is not slippery.'],
          ] },
        help: { id: 'help', toc: 'Calibration help', title: 'Calibration and settings help',
          items: [
            ['Register the puck again', 'If you changed pucks or the light changed a lot, register it again with “3 s in circle” in Calibrate. The tolerance is set again automatically.'],
            ['Set by tap', '“Set by tap” in Calibrate shows the camera view in every game and pauses the game. Tapping near the puck snaps to the nearest object. Esc cancels.'],
            ['Small puck', 'If the puck looks very small, the detection resolution switches to “Highest (400)” automatically when you register it.'],
            ['Detection fine-tuning', 'Open it in Settings for a live preview: red is the puck, green the stick. If only the puck is red, leave it. Raise the tolerance if the puck is only partly red; lower it if shoes or shadows turn red. The preview stays inside Settings.'],
            ['Settings from the mode window', 'The Settings button at the top right of the mode window opens Settings; closing it brings you back.'],
            ['Camera blocked', 'Allow it from the lock (camera) icon left of the address bar, then reload.'],
            ['No white floor or no lines', 'Vinyl and concrete work too (see “By floor type” under Picking a puck). With no lines, put tape or coins on the four corners and fit the area to them; once fitted, you can play without any lines. In front of a laptop webcam you can also drag the corners to the screen edges.'],
          ] },
      },
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
        ['장판·차고지·옥상 콘크리트처럼 흰 바닥이 아니어도 되나요?', '네. 앱은 흰 바닥이 필요 없고, 퍽을 등록할 때 둘레 바닥색을 그 자리에서 익힙니다. 다만 퍽 색이 바닥 바탕색뿐 아니라 바닥 위의 얼룩·줄눈·그림자와도 달라야 합니다. 24곳으로 옮기며 시험해 보니 장판에서는 검정 퍽·주황 공 모두 24곳을 다 잡았지만, 기름 얼룩·줄눈이 있는 차고지 콘크리트에서 검정 퍽은 9곳, 햇빛 아래 몸 그림자가 퍽 옆에 생기는 옥상에서는 0곳이었습니다. 주황 공은 세 바닥 모두 24곳을 다 잡았습니다. 콘크리트·야외에서는 주황·형광처럼 진한 색 공이나 퍽을 쓰고, 거친 바닥에서는 스트리트 하키 공이나 롤러용 퍽이 잘 굴러갑니다.'],
        ['바닥에 선이 없어도 되나요?', '네. 선은 영역 네 모서리를 맞출 때 기준으로만 쓰이고, 한 번 맞춰 두면 게임에는 필요 없습니다(다음에도 그대로 씁니다). 처음 맞출 때 모서리 네 곳에 테이프·동전을 놓으면 쉽고, 퍽과 다른 색이면 그대로 두어 경계 표시로 써도 됩니다. 카메라를 옮기면 영역을 다시 맞추세요.'],
        ['휴대폰이나 태블릿만으로도 할 수 있나요?', '할 수는 있지만 플레이하면서 화면을 보기는 불편합니다. 카메라가 바닥을 보게 기기를 아래로 기울이면 화면도 함께 아래를 향해, 서서 보면 비스듬하고 작게 보입니다. 세팅과 가벼운 연습에는 충분하고, 제대로 즐기려면 HDMI 케이블이나 무선 미러링으로 TV에 연결하세요. 이때는 화질 좋은 후면 카메라를 써도 됩니다.'],
        ['TV를 가리지 않게 카메라를 TV 옆에 두어도 되나요?', '네. 영역의 네 모서리만 바닥에 맞추면 옆에서 비스듬히 찍어도 원근이 보정되어, 정면과 정확도가 거의 같습니다(옆으로 1m·약 30°, 높이 1.2m에서 위치 오차 약 3.6cm). 가장 좋은 자리는 TV 위 가운데이고, 옆에 둘 때는 TV에 붙여 옆으로 45°를 넘지 않게 하세요. 영역의 ‘앞’ 두 모서리는 TV 쪽 바닥 끝에 맞춥니다. 3/3 움직여 보기가 끝나면 카메라를 더 높일지, 지금이 최소인지, 조금 낮춰도 되는지 알려 줍니다.'],
        ['어떤 퍽이나 공을 써야 잘 인식되나요?', '바닥과 색이 확실히 다른 단색 퍽·공이 가장 좋습니다(흰 바닥에는 검정·주황·빨강, 어두운 매트에는 흰색·형광색). 가운데 흰색·테두리 검정 같은 두 가지 색 퍽도 바닥과 다른 쪽 색으로 잘 따라갑니다. 무지개 공처럼 여러 색이 섞인 공은 아직 잘 잡히지 않습니다. 스케이트·신발과도 다른 색이면 더 좋습니다.'],
        ['스틱이나 스케이트가 퍽을 가리면 어떻게 되나요?', '퍽이 영역 안쪽에서 잠깐 가려지면 화면의 퍽이 최대 1.5초 동안 그 자리에 흐리게 남고, 그동안은 충돌·득점 판정을 하지 않습니다. 보정에서 스틱 색까지 등록하면 블레이드 옆에서 가려진 퍽을 블레이드 위치로 이어 줍니다. 검정 퍽이 검정 스케이트에 닿아도 퍽 모양 부분만 떼어 내 따라갑니다.'],
        ['몇 살부터 할 수 있나요?', '나이 제한은 없습니다. 랭킹은 U8부터 U18, 성인, 시니어까지 연령대별로 나뉩니다. 어린 선수는 보호자와 함께 시작하세요.'],
        ['인라인하키·롤러하키 연습에도 쓸 수 있나요?', '네. 스틱으로 퍽이나 공을 다루는 스틱핸들링 연습이라 인라인하키·롤러하키 연습에도 쓸 수 있습니다.'],
        ['랭킹에는 어떻게 오르나요?', '정회원으로 로그인한 채 게임을 끝까지 하면(자유 연습 제외) 최고 기록이 전체·국가·팀·연령대 랭킹에 오릅니다. 게스트로 한 기록은 랭킹에 오르지 않습니다.'],
        ['가입 코드는 어떻게 받나요?', '정회원 친구에게 초대 링크를 받으면 바로 가입할 수 있습니다(정회원 한 사람이 3명까지 초대). 또는 게스트로 한 판을 끝내면 결과 화면에 가입 방법이 나옵니다. 공개 가입 기간에는 결과 화면의 [정회원 가입하기]로 누구나 바로 가입할 수 있고, 그 밖에는 보호자가 공식 인스타그램 DM으로 가입 코드를 요청하면 됩니다. SNS에 영상을 올릴 필요는 없습니다.'],
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
        ['Does it work on vinyl, garage or rooftop concrete instead of a white floor?', 'Yes. The app needs no white floor; it learns the floor color around the puck when you register it. But the puck color must differ not only from the floor itself but also from stains, joints and shadows on it. Tested over 24 positions: on vinyl both a black puck and an orange ball were tracked at all 24, but on garage concrete with oil stains and joints the black puck managed 9, and on a sunny rooftop with your shadow next to the puck it managed 0. The orange ball was tracked at all 24 on every floor. On concrete or outdoors use a strongly colored ball or puck such as orange or neon; on rough floors a street hockey ball or a roller puck rolls better.'],
        ['Do I need lines on the floor?', 'No. Lines only help you place the four corners of the area; once fitted, the game does not need them, and the area is kept for next time. Putting tape or coins on the four corners makes fitting easy, and if they differ from the puck color you can leave them as boundary marks. If you move the camera, fit the area again.'],
        ['Can I play with just a phone or a tablet?', 'You can, but watching the screen while playing is awkward. Tilting the device so the camera sees the floor tilts the screen down too, so it looks small and slanted when you stand. It is fine for setting up and light practice; to really enjoy it, connect a TV with an HDMI cable or wireless mirroring. Then you can also use the sharper rear camera.'],
        ['Can I put the camera beside the TV so it does not block the screen?', 'Yes. Once the four corners of the area are fitted to the floor, an angled side view is corrected for perspective and accuracy is almost the same as straight on (1 m to the side, about 30°, 1.2 m high: about 3.6 cm). The best spot is on top of the TV, centered; beside the TV, keep it close and no more than 45° to the side. Put the two “front” corners of the area on the floor edge nearest the TV. After the 3/3 test move, the app tells you whether to raise the camera, that this is the lowest height, or that you may lower it a little.'],
        ['Which puck or ball is tracked best?', 'A single-color puck or ball that clearly differs from the floor (black, orange or red on a white floor; white or neon on a dark mat). A two-tone puck such as a white center with a black rim also works, by the color that differs from the floor. Multi-colored balls such as rainbow balls are not tracked well yet. A color that also differs from your skates and shoes is even better.'],
        ['What happens when the stick or a skate covers the puck?', 'If the puck is hidden for a moment inside the area, it stays on screen, faded, for up to 1.5 seconds, and no hits or points are counted meanwhile. Register the stick color in Calibrate too and a puck hidden next to the blade follows the blade. A black puck touching a black skate is cut out of the blob and tracked as well.'],
        ['What age is it for?', 'There is no age limit. Leaderboards are split by age group from U8 to U18, adult and senior. Young players should start with a parent.'],
        ['Can I use it for inline or roller hockey?', 'Yes. It trains stickhandling with a puck or a ball, so it works for inline and roller hockey practice too.'],
        ['How do I get on the leaderboard?', 'Finish a game (except Free Practice) while logged in as a member and your best score goes on the world, country, team and age-group leaderboards. Guest scores are not ranked.'],
        ['How do I get an invite code?', 'Get an invite link from a member friend (each member can invite up to 3 people). Or finish a game as a guest and the results screen shows how to join. During open sign-up periods anyone can join right away with the [Join as a member] button there; otherwise a parent or guardian can ask our official Instagram for a code by DM. You never need to post a video on social media.'],
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
