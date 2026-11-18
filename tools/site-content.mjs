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
    ko: { name: '아케이드', what: '내려오는 검정 퍽을 좌우로 피하고 coin을 모읍니다. 퍽의 방향을 바꿀 때마다(터치) 점수가 오르고, 1·3·5분 동안의 점수로 겨룹니다.', skills: '좌우 스틱핸들링 · 퍽을 다루면서 주변 보기 · 순간 판단' },
    en: { name: 'Arcade', what: 'Dodge the black pucks falling down the lane and collect coins. Every change of direction (a touch) scores, and you compete on your score over 1, 3 or 5 minutes.', skills: 'Side-to-side stickhandling · seeing the play while handling the puck · quick decisions' } },
  { id: 'obstacle',
    ko: { name: '퍽 피하기', what: '경기장 네 변에서 날아오는 빨간 퍽을 피합니다. 시간이 갈수록 동시에 날아오는 퍽이 늘어납니다.', skills: '360° 퍽 컨트롤 · 급정지와 방향 전환 · 위험 읽기' },
    en: { name: 'Dodge', what: 'Avoid the red pucks flying in from all four sides of the field. More of them come at once as time goes on.', skills: '360° puck control · stops and changes of direction · reading danger' } },
  { id: 'wide',
    ko: { name: '와이드 드리블', what: '좌우 끝까지 넓게 움직이는 3가지 훈련(좌우 끝 · 양 끝 짧은 터치 · 양 끝과 가운데)을 이어서 합니다. 훈련마다 퍽을 가운데에 3초 두면 시작합니다.', skills: '넓은 스틱핸들링(와이드 핸들링) · 팔 뻗기 · 리듬' },
    en: { name: 'Wide Dribble', what: 'Three drills in a row that take the puck all the way to each side (edge to edge · short touches at both ends · both ends and the middle). Each drill starts when you hold the puck in the center for 3 seconds.', skills: 'Wide stickhandling · reach · rhythm' } },
  { id: 'figure8',
    ko: { name: '8자 드리블', what: '두 콘 사이를 8자로 돌며 게이트를 통과합니다. 먼저 갈 콘(왼쪽·오른쪽)과 시계·반시계 방향을 게임 화면에서 고릅니다.', skills: '포핸드·백핸드 전환 · 퍽 보호 · 돌면서 퍽 유지' },
    en: { name: 'Figure 8', what: 'Skate the puck through the gates in a figure 8 around two cones. Pick which cone comes first (left or right) and clockwise or counterclockwise on the game screen.', skills: 'Forehand–backhand transitions · protecting the puck · keeping control through turns' } },
  { id: 'quick',
    ko: { name: '퀵 핸즈', what: '가운데 박스 안에서 20초 동안 최대한 빠르게 좌우로 터치합니다. 박스 밖에서 한 터치는 세지 않습니다.', skills: '손목 속도 · 부드러운 손(소프트 핸즈) · 짧은 터치' },
    en: { name: 'Quick Hands', what: 'Touch the puck side to side as fast as you can inside the center box for 20 seconds. Touches outside the box do not count.', skills: 'Wrist speed · soft hands · short touches' } },
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
      description: '휴대폰 카메라와 퍽(또는 공) 하나로 집에서 아이스하키 스틱핸들링을 훈련하는 방법. 준비물, 카메라 세팅, 퍽 등록, 15분 훈련 루틴, 고개 들고 하기(헤드업)까지 정리했습니다.',
      h1: '집에서 하는 하키 스틱핸들링 훈련 가이드',
      lead: '처음 시작하는 선수와 부모님, 코치를 위한 사용 가이드입니다.',
      sections: [
        ['준비물', ['ul', [
          '**카메라가 있는 기기** — 아이패드·태블릿, 휴대폰, 노트북 웹캠 모두 됩니다.',
          '**거치대** — 기기를 바닥이 내려다보이게 세울 수 있으면 됩니다.',
          '**바닥** — 흰 연습판이나 밝은 단색 매트가 가장 잘 인식됩니다. 폭 1~2m면 충분합니다.',
          '**퍽** — 실제 퍽 대신 공·병뚜껑처럼 바닥과 색이 다른 물체도 됩니다.',
          '**하키 스틱** — 실내에서 쓰는 스틱이나 롤러용 블레이드가 좋습니다.',
        ]]],
        ['처음 세팅 (5분)', ['ol', [
          '**기기 세우기** — 1~1.5m 높이에서 바닥과 몸이 함께 보이게 세웁니다. 전면 카메라를 쓰면 화면을 보면서 할 수 있습니다.',
          '**카메라 시작** — 첫 화면 맨 위의 ‘카메라 시작’(또는 ‘게스트로 시작’)을 누르고 카메라 사용을 허용합니다.',
          '**1/3 영역 맞추기** — 네 모서리를 끌어 바닥 영역에 맞춥니다. 뒤쪽이 좁아 보이는 원근도 이 단계에서 보정되고, 다음부터는 맞춰 둔 영역을 그대로 씁니다.',
          '**2/3 퍽 등록** — 가운데 원 안에 퍽(또는 공)을 놓고 3초 기다리면 색과 크기를 스스로 익힙니다.',
          '**3/3 움직여 보기** — 바닥 네 모서리의 표적에 퍽을 가져가 끝까지 잘 잡히는지 확인합니다.',
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
        ['잘 인식되지 않을 때', ['ul', [
          '조명을 밝게 하고, 바닥에 퍽과 같은 색 물체를 두지 마세요.',
          '카메라가 막혀 있으면 주소창 왼쪽의 자물쇠(카메라) 아이콘에서 ‘허용’으로 바꾼 뒤 새로 고침합니다.',
          '퍽을 자주 놓치면 보정에서 ‘퍽 다시 등록’을 하거나 영역을 다시 맞춥니다.',
          '흰 바닥이 없어도 됩니다. 영역의 네 모서리를 화면 끝까지 끌어 두면 노트북 웹캠 앞에서도 할 수 있습니다.',
        ]]],
      ],
      howto: { name: '퍽 드리블 트레이너 처음 세팅하기', steps: ['기기 세우기', '카메라 시작', '영역 맞추기', '퍽 등록', '움직여 보기', '게임 시작'] },
    },
    en: {
      nav: 'Guide',
      title: 'How to Train Hockey Stickhandling at Home | Puck Dribble Trainer',
      description: 'How to practice ice hockey stickhandling at home with a phone camera and a puck (or a ball): what you need, camera setup, registering the puck, a 15-minute routine and heads-up practice.',
      h1: 'How to train hockey stickhandling at home',
      lead: 'A getting-started guide for players, parents and coaches.',
      sections: [
        ['What you need', ['ul', [
          '**A device with a camera** — an iPad or tablet, a phone or a laptop webcam.',
          '**A stand** — anything that holds the device so it looks down at the floor.',
          '**A floor** — a white shooting pad or a plain, light-colored mat works best. 1–2 m wide is enough.',
          '**A puck** — or any ball or bottle cap that stands out from the floor.',
          '**A hockey stick** — an indoor stick or a roller blade is ideal.',
        ]]],
        ['First setup (5 minutes)', ['ol', [
          '**Stand the device up** — at 1–1.5 m high so it sees the floor and you. With the front camera you can watch the screen while you play.',
          '**Start the camera** — press “Start camera” (or “Start as guest”) at the top of the first screen and allow camera access.',
          '**1/3 Fit the area** — drag the four corners onto your floor area. This also corrects the perspective when the far side looks narrower, and the saved area is reused next time.',
          '**2/3 Register the puck** — put the puck (or ball) in the center circle for 3 seconds and it learns its color and size.',
          '**3/3 Test move** — take the puck to the four corner targets to check it is tracked everywhere.',
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
        ['If tracking is unreliable', ['ul', [
          'Use bright light and keep objects of the same color as your puck off the floor.',
          'If the camera is blocked, allow it from the lock (camera) icon left of the address bar, then reload.',
          'If the puck keeps getting lost, use “Register puck again” in Calibrate or fit the area again.',
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
      lead: '모든 게임은 카메라가 실제 퍽(또는 공)의 움직임을 따라가며 판정합니다. 화면은 위에서 내려다본 평면 경기장으로 보이고, 퍽을 카메라 쪽으로 밀면 화면 위로 움직입니다.',
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
      lead: 'In every game the camera follows your real puck (or ball). The screen shows a flat, top-down field, and pushing the puck toward the camera moves it up the screen.',
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
        ['어떤 바닥에서 하면 좋나요?', '흰 연습판이나 밝은 단색 매트가 가장 잘 인식됩니다. 다른 바닥도 플레이 공간의 네 모서리를 맞추면 쓸 수 있습니다.'],
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
        ['What floor works best?', 'A white shooting pad or a plain, light-colored mat is tracked best. Other floors work once you fit the four corners of the play area.'],
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
