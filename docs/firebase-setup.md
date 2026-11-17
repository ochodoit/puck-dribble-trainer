# Firebase 연결 안내 — headsuppuck 프로젝트

- 게임 주소: https://ochodoit.github.io/semple/ (접속 코드 1234)
- Firebase 콘솔: https://console.firebase.google.com/project/headsuppuck/overview
- 소스 저장소: https://github.com/ochodoit/semple

사이트 주소를 새로 만들 필요는 없습니다. 지금 주소(ochodoit.github.io)를 그대로 연결합니다.

## 콘솔에서 할 일 (순서대로)

### 1. 로그인 방식 켜기
빌드 > **Authentication** > 시작하기 > **로그인 방법** 탭 > **이메일/비밀번호** > 사용 설정 > 저장

게임은 "별명 + 숫자 6자리"로 로그인하지만, 내부적으로 별명을 가상 이메일(`u-xxxx@puck-trainer.app`)로 바꿔 이메일/비밀번호 방식을 씁니다.

### 2. 사이트 주소 등록
Authentication > **설정** 탭 > **승인된 도메인** > 도메인 추가 > `ochodoit.github.io`

### 3. 데이터베이스 만들기
빌드 > **Firestore Database** > 데이터베이스 만들기
- 위치: **asia-northeast3 (서울)** — 나중에 바꿀 수 없음
- 모드: **프로덕션 모드**

### 4. 보안 규칙 붙여넣기
Firestore > **규칙** 탭 > 기존 내용을 모두 지우고 아래 내용을 붙여넣기 > **게시**

(정회원·추천코드·팀 기능을 만들 때 이 규칙은 다시 바뀝니다. 그때 새 내용을 드립니다.)

```
rules_version = '2';
// 온라인 랭킹용 Firestore 보안 규칙 (Firebase 콘솔 > Firestore > 규칙에 붙여넣기)
service cloud.firestore {
  match /databases/{database}/documents {
    // 등번호(선택): 없거나 null 이거나 0~99 정수
    function validNumber(d) {
      return !('number' in d) || d.number == null || (d.number is int && d.number >= 0 && d.number <= 99);
    }
    // 코스 도전 기록: 평균·가장 빠른 사이클 시간(초)
    function courseRecord(d) {
      return d.avg is number && d.avg > 0 && d.avg < 3600 && d.best is number && d.best > 0;
    }
    // 기록 자랑 도전 기록: 점수 + 나이 조건 (글쓴이와 같거나 어린 선수만, 글쓴이 본인 제외)
    function scoreRecord(postId, uid, d) {
      let post = get(/databases/$(database)/documents/posts/$(postId)).data;
      let me = get(/databases/$(database)/documents/users/$(uid)).data;
      return post.type == 'record' && post.uid != uid
        && d.score is int && d.score >= 0 && d.score <= 1000000
        && (!('age' in post) || post.age == null || me.age <= post.age);
    }
    match /users/{uid} {
      allow read: if true;
      allow create, update: if request.auth != null && request.auth.uid == uid
        && request.resource.data.nick is string && request.resource.data.nick.size() <= 12
        && request.resource.data.team is string && request.resource.data.team.size() <= 20
        && request.resource.data.age is int && request.resource.data.age >= 3 && request.resource.data.age <= 99
        && validNumber(request.resource.data);
    }
    match /nicks/{nick} {
      allow read: if true;
      allow create: if request.auth != null && request.resource.data.uid == request.auth.uid;
    }
    // 커뮤니티: 글은 누구나 읽고, 로그인한 본인만 쓰고 고치고 지운다
    match /posts/{id} {
      allow read: if true;
      allow create: if request.auth != null && request.resource.data.uid == request.auth.uid
        && request.resource.data.title is string && request.resource.data.title.size() > 0 && request.resource.data.title.size() <= 30
        && request.resource.data.body is string && request.resource.data.body.size() <= 200
        && request.resource.data.type in ['course', 'record', 'beat'];
      // 고치기(기록 자랑을 새 기록으로 바꾸기 포함)는 본인만, 글쓴이(uid)는 바꿀 수 없음
      allow update: if request.auth != null && resource.data.uid == request.auth.uid
        && request.resource.data.uid == resource.data.uid
        && request.resource.data.title is string && request.resource.data.title.size() > 0 && request.resource.data.title.size() <= 30
        && request.resource.data.body is string && request.resource.data.body.size() <= 200;
      allow delete: if request.auth != null && resource.data.uid == request.auth.uid;
      // 도전 기록: 한 사람당 문서 하나 (자기 것만 쓸 수 있음)
      //  - 코스 글: 평균·가장 빠른 사이클 시간
      //  - 기록 자랑 글: 점수. 글쓴이 본인은 안 되고, 글쓴이와 나이가 같거나 어린 선수만 (글에 나이가 없는 예전 글은 제한 없음)
      match /records/{uid} {
        allow read: if true;
        allow write: if request.auth != null && request.auth.uid == uid && request.resource.data.uid == uid
          && (courseRecord(request.resource.data) || scoreRecord(id, uid, request.resource.data));
      }
      match /cheers/{uid} {
        allow read: if true;
        allow write: if request.auth != null && request.auth.uid == uid;
      }
    }
    match /{col}/{uid} {
      allow read: if col.matches('scores_.*');
      allow write: if col.matches('scores_.*') && request.auth != null && request.auth.uid == uid
        && request.resource.data.uid == uid
        && request.resource.data.score is int && request.resource.data.score >= 0 && request.resource.data.score <= 1000000
        && validNumber(request.resource.data);
    }
  }
}
```

### 5. 웹 앱 등록 → 설정값 보내기
왼쪽 위 톱니바퀴 > **프로젝트 설정** > 일반 > 내 앱 > **`</>` (웹)** 아이콘
- 앱 이름: 아무거나 (예: `puck-trainer`)
- "Firebase 호스팅 설정"은 체크하지 않아도 됨
- 등록 후 나오는 아래 부분을 복사해서 Claude에게 보내기

```js
const firebaseConfig = {
  apiKey: "...",
  authDomain: "headsuppuck.firebaseapp.com",
  projectId: "headsuppuck",
  storageBucket: "...",
  messagingSenderId: "...",
  appId: "..."
};
```

이 값은 비밀번호가 아니라 원래 웹페이지에 공개로 들어가는 설정값이라 채팅에 붙여넣어도 됩니다.

## 설정값을 받은 뒤 Claude가 할 일
1. `src/firebase-config.js` 에 값을 넣고 배포
2. 가입 → 로그인 → 랭킹 등록 → 커뮤니티 글쓰기·기록 게시판을 실제로 확인하고, 문제가 있으면 수정
3. 첫 화면 아래 안내문이 "온라인 랭킹 — 모든 기기의 기록이 함께 집계됩니다."로 바뀌면 연결 완료

## 알아 둘 점
- 무료 요금제(Spark)로 충분. 카드 등록 필요 없음.
- 기존에 각 기기에 저장된 기록·글은 온라인으로 옮겨지지 않음 (온라인에서 새로 가입).
- 접속 코드 1234는 화면만 막는 장치. 보안은 위 규칙이 담당 (남의 기록·글은 고치거나 지울 수 없음).
