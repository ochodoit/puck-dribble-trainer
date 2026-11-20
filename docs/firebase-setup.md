# Firebase 연결 안내 — headsuppuck 프로젝트

- 게임 주소: https://puck-trainer.com/ (GitHub 기본 주소 https://ochodoit.github.io/puck-dribble-trainer/ 는 이리로 넘어감, 예전 주소 `/semple/` 은 없어짐)
- Firebase 콘솔: https://console.firebase.google.com/project/headsuppuck/overview
- 소스 저장소: https://github.com/ochodoit/puck-dribble-trainer

사이트 주소는 Hosting.kr에서 산 `puck-trainer.com` 을 GitHub Pages에 연결한 것입니다.

## 콘솔에서 할 일 (순서대로)

### 1. 로그인 방식 켜기
빌드 > **Authentication** > 시작하기 > **로그인 방법** 탭 > **이메일/비밀번호** > 사용 설정 > 저장

게임은 "아이디 + 비밀번호(8자 이상, 영문+숫자)"로 로그인하고, 랭킹에 보이는 이름은 따로 정하는 별명입니다(2026-11-19부터. 별명은 공개되므로 로그인에 쓰지 않음). 내부적으로 아이디를 가상 이메일(`id.<아이디>@headsuppuck.firebaseapp.com`)로 바꿔 이메일/비밀번호 방식을 씁니다. 이 도메인은 아무도 메일을 받을 수 없어 비밀번호 재설정 메일로 계정을 뺏을 수 없습니다.

예전 계정(별명 + 숫자 6자리, 로그인 주소 `u-<별명 hex>@headsuppuck.firebaseapp.com`)은 예전처럼 별명과 숫자 6자리로 로그인하면 아이디와 새 비밀번호를 만드는 화면이 나옵니다. 만들기 전에는 로그인 전 상태입니다. 만든 뒤에는 아이디로만 로그인합니다. 앱은 로그인 주소도 아이디 주소로 바꿔 보는데, 프로젝트의 "이메일 열거 보호"가 켜져 있으면 바뀌지 않으므로 `ids/{아이디}` 문서에 적힌 예전 주소로 로그인합니다. 예전 주소(`u-xxxx@puck-trainer.app`) 계정은 2026-11-17에 모두 새 주소로 옮겼습니다.

### 2. 사이트 주소 등록
Authentication > **설정** 탭 > **승인된 도메인** > 도메인 추가 > `puck-trainer.com`, `ochodoit.github.io`

### 3. 데이터베이스 만들기
빌드 > **Firestore Database** > 데이터베이스 만들기
- 위치: **asia-northeast3 (서울)** — 나중에 바꿀 수 없음
- 모드: **프로덕션 모드**

### 4. 보안 규칙 붙여넣기
Firestore > **규칙** 탭 > 기존 내용을 모두 지우고 아래 내용을 붙여넣기 > **게시**

(이 내용은 저장소의 `firestore.rules` 와 같습니다. 규칙을 바꾸면 이 파일과 함께 고칩니다. 2026-11-18: 친구 초대 코드·3개월 이용권·의견 추첨, 순위 색인 칸 반영. 2026-11-19: 로그인 아이디(`ids`), 최고 기록일 때만 쓰고 판수는 모아서 쓰는 랭킹 기록, 임시 비밀번호 표시(`tempPw`) 지우기)

```
rules_version = '2';
// 온라인 랭킹·정회원용 Firestore 보안 규칙 (Firebase 콘솔 > Firestore > 규칙에 붙여넣기)
// 지키는 것
//  1) 칸 제한: 문서마다 정해진 칸만 쓸 수 있다 (정회원 유지·공식 글 같은 칸을 몰래 넣을 수 없음)
//  2) 사칭 금지: 랭킹·글·기록·의견의 별명·팀·나이·등번호는 내 프로필과 같아야 한다. 별명은 가입할 때 한 번만 정하고,
//     운영자·관리자·admin 같은 이름은 쓸 수 없다
//  3) 개인정보: 프로필(나이·가입 코드)은 본인과 운영자만 읽는다. 랭킹에는 화면에 보이는 칸만 남는다
//  4) 정리: 운영자는 글·도전 기록·랭킹 기록·의견을 지울 수 있다
//  5) 랭킹: 최고 기록은 내려가지 않고, 같은 모드는 2초에 한 번만 쓸 수 있다 (서버 시간). 순위 색인 칸은 점수·묶음과 맞아야 한다.
//     앱은 최고 기록이 오를 때만 쓰고 판수는 모아서 쓴다: 판수는 한 번에 1~50 늘고, 점수가 그대로면 기록 시각도 그대로
//  6) 정회원 기간: 무료 정회원은 베타 종료일까지. 그 뒤는 운영자가 유지(kept)했거나 이용권 기한(until)이 남은 계정만
//  7) 초대 코드: 정회원 한 사람당 하나, 3명까지, 추가 없음 (프로필의 invite 칸과 한 묶음으로 한 번만 만든다)
//  8) 로그인 아이디: 로그인은 아이디 + 비밀번호, 랭킹에 보이는 이름은 별명 (따로). 아이디는 ids/{아이디} 로 하나뿐이고,
//     새 가입은 로그인 주소가 그 아이디 주소(id.<아이디>@…)여야 한다. 예전 계정(별명 + 숫자 6자리)은 아이디를 한 번만 만든다
//  9) 임시 비밀번호: 운영자가 서버 도구(Admin SDK, 규칙을 거치지 않음)로 비밀번호를 바꾸고 users/{uid}.tempPw 를 적는다.
//     회원은 새 비밀번호를 정한 뒤 tempPw 를 지울 수만 있다 (스스로 만들거나 다른 칸과 섞어 바꿀 수 없음)
service cloud.firestore {
  match /databases/{database}/documents {
    // 운영자: admins/{uid} 문서가 있는 계정 (콘솔에서 직접 만든다)
    function isAdmin() {
      return request.auth != null && exists(/databases/$(database)/documents/admins/$(request.auth.uid));
    }
    // 내 프로필 (없으면 오류 = 거절)
    function me() {
      return get(/databases/$(database)/documents/users/$(request.auth.uid)).data;
    }
    function betaEnd() {
      let cp = /databases/$(database)/documents/config/site;
      return exists(cp) ? get(cp).data.get('betaEndsAt', null) : null;
    }
    // 정회원인가 (u = 내 프로필). 프로필은 가입 코드로만 만들 수 있다
    // 무료 정회원은 가입 경로(오픈베타·초대·1회용 코드)와 상관없이 베타 종료일(config/site.betaEndsAt)까지.
    // 그 뒤에는 운영자가 유지(kept)한 계정, 이용권 기한(until, 운영자가 줌)이 남은 계정만 정회원
    function activeMember(u) {
      return u.get('kept', false) == true
        || (u.get('until', null) is timestamp && request.time < u.until)
        || betaOpen();
    }
    function betaOpen() {
      let end = betaEnd();
      return end == null || request.time < end;
    }
    function isMember() {
      return request.auth != null && activeMember(me());
    }
    // 나이 -> 나이대 (account.js 의 ageGroupOf 와 같음)
    function ageGroupFor(a) {
      return a <= 7 ? 'U8' : (a <= 9 ? 'U10' : (a <= 11 ? 'U12' : (a <= 13 ? 'U14' : (a <= 15 ? 'U16' : (a <= 17 ? 'U18' : (a <= 39 ? '성인' : '시니어'))))));
    }
    // 등번호(선택): 없거나 null 이거나 0~99 정수
    function validNumber(d) {
      return !('number' in d) || d.number == null || (d.number is int && d.number >= 0 && d.number <= 99);
    }
    function validProfile(d) {
      return d.nick is string && d.nick.size() <= 12
        && d.team is string && d.team.size() <= 20
        && d.age is int && d.age >= 3 && d.age <= 99
        && (!('country' in d) || (d.country is string && d.country.size() <= 4))
        && (!('stick' in d) || d.stick in ['L', 'R'])
        && validNumber(d);
    }
    // 별명: 2~12자 (글자·숫자·_-. 와 가운데 띄어쓰기), 소문자 키가 맞고, 운영자로 보일 이름은 안 됨
    function validNick(d) {
      return d.nick is string && d.nick.matches('^[\\p{L}\\p{N}_.\\- ]{2,12}$') && !d.nick.matches('^ .*|.* $')
        && d.nickLower == d.nick.lower()
        && !d.nickLower.matches('.*(운영자|관리자|admin|official|퍽 ?트레이너|puck ?trainer).*');
    }
    // 화면에 보이는 글쓴이 칸이 내 프로필과 같은가 (사칭 금지)
    function sameAuthor(d, u) {
      return d.nick == u.nick
        && d.get('team', null) == u.get('team', null)
        && d.get('country', null) == u.get('country', null)
        && (!('number' in d) || d.number == u.get('number', null));
    }
    // 가입 코드를 지금 쓸 수 있는가: 꺼지지 않았고, 마감 전이고(서버 시간), 사용 횟수가 남았다 (maxUses 0 = 제한 없음)
    function codeOpen(c) {
      return c.off != true
        && (!('expiresAt' in c) || c.expiresAt == null || request.time < c.expiresAt)
        && (c.maxUses == 0 || c.uses < c.maxUses);
    }
    // 가입: 한 번에(트랜잭션) 코드 사용 횟수 +1, 회원 수 +1, 별명 등록을 함께 쓰고, 프로필에 그 코드와 번호를 남긴다
    function joinOk(d, uid) {
      let cp = /databases/$(database)/documents/codes/$(d.code);
      let mp = /databases/$(database)/documents/meta/members;
      let c = get(cp).data;
      return codeOpen(c)
        && getAfter(cp).data.uses == c.uses + 1
        && d.via == c.type
        && d.beta == (c.type == 'beta')
        && getAfter(mp).data.count == get(mp).data.count + 1
        && d.memberNo == getAfter(mp).data.count
        && getAfter(/databases/$(database)/documents/nicks/$(d.nickLower)).data.uid == uid;
    }
    // 같은 묶음에서 이 계정의 프로필이 처음 만들어지는가
    function joiningNow() {
      let up = /databases/$(database)/documents/users/$(request.auth.uid);
      return request.auth != null && !exists(up) && existsAfter(up);
    }
    // 마감(선택): 없거나 null 이거나 시각(timestamp)
    function validExpiry(d) {
      return !('expiresAt' in d) || d.expiresAt == null || d.expiresAt is timestamp;
    }

    // 프로필의 아이디: 별명과 다르고, 같은 묶음에서 ids/{아이디} 가 이 계정 것으로 생긴다
    function loginIdOk(d, uid) {
      return d.loginId is string && d.loginId != d.nickLower
        && getAfter(/databases/$(database)/documents/ids/$(d.loginId)).data.uid == uid;
    }

    match /admins/{uid} {
      allow get: if request.auth != null && request.auth.uid == uid;
    }
    // 내 초대 코드 만들기: 지금 정회원이고, 아직 초대 코드가 없고, 같은 묶음에서 내 프로필의 invite 칸이 이 코드를 가리킨다
    function inviteOwnerOk(d, code) {
      let u = me();
      return activeMember(u) && !('invite' in u) && d.nick == u.nick
        && getAfter(/databases/$(database)/documents/users/$(request.auth.uid)).data.get('invite', null) == code;
    }
    // 가입 코드: 코드를 아는 사람만 그 코드 하나를 읽을 수 있다 (목록은 운영자만)
    match /codes/{code} {
      allow get: if true;
      allow list, delete: if isAdmin();
      // 정회원: 내 초대 코드 (3명까지, 마감·메모 없음, 한 사람당 하나). 만든 뒤에는 운영자만 고친다
      allow create: if request.auth != null && code.matches('^[2-9A-HJKMNP-Z]{8}$')
        && request.resource.data.keys().hasOnly(['type', 'uses', 'maxUses', 'expiresAt', 'off', 'note', 'createdAt', 'by', 'nick'])
        && request.resource.data.type == 'invite' && request.resource.data.uses == 0 && request.resource.data.maxUses == 3
        && request.resource.data.off == false && request.resource.data.expiresAt == null && request.resource.data.note == ''
        && request.resource.data.createdAt is number && request.resource.data.by == request.auth.uid
        && inviteOwnerOk(request.resource.data, code);
      allow create: if isAdmin()
        && request.resource.data.keys().hasOnly(['type', 'uses', 'maxUses', 'expiresAt', 'off', 'note', 'createdAt', 'by'])
        && request.resource.data.type in ['beta', 'one']
        && request.resource.data.uses == 0 && request.resource.data.maxUses is int && request.resource.data.maxUses >= 0
        && validExpiry(request.resource.data);
      // 운영자: 메모·마감·꺼짐·한도 수정 (사용 횟수·종류는 그대로)
      allow update: if isAdmin()
        && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['off', 'note', 'expiresAt', 'maxUses'])
        && request.resource.data.maxUses is int && request.resource.data.maxUses >= 0 && validExpiry(request.resource.data);
      // 가입하는 사람: 내 프로필을 이 코드로 처음 만드는 묶음에서만 사용 횟수 +1
      allow update: if joiningNow() && codeOpen(resource.data)
        && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['uses', 'lastAt'])
        && request.resource.data.uses == resource.data.uses + 1
        && getAfter(/databases/$(database)/documents/users/$(request.auth.uid)).data.code == code;
    }
    // 회원 수 (정회원 번호를 차례로 매기는 데 씀). 처음 한 번은 운영자 화면의 '가입 준비'로 만든다
    match /meta/members {
      allow read: if true;
      allow write: if isAdmin();
      allow update: if joiningNow()
        && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['count'])
        && request.resource.data.count == resource.data.count + 1
        && getAfter(/databases/$(database)/documents/users/$(request.auth.uid)).data.memberNo == request.resource.data.count;
    }
    // 사이트 설정: site = 게스트 안내(공식 인스타 계정, 해시태그)·베타 종료일(betaEndsAt), lottery = 의견 추첨 결과(당첨자 별명·번호)
    match /config/{id} {
      allow read: if true;
      allow write: if isAdmin();
    }
    // 프로필 (= 정회원). 나이·가입 코드가 들어 있어 본인과 운영자만 읽는다
    match /users/{uid} {
      allow get: if request.auth != null && (request.auth.uid == uid || isAdmin());
      allow list: if isAdmin();
      allow create: if request.auth != null && request.auth.uid == uid
        && request.resource.data.keys().hasOnly(['loginId', 'nick', 'nickLower', 'number', 'country', 'team', 'age', 'ageGroup', 'createdAt', 'code', 'via', 'beta', 'memberNo', 'joinedAt', 'stick'])
        && validProfile(request.resource.data) && validNick(request.resource.data) && loginIdOk(request.resource.data, uid)
        && request.resource.data.ageGroup == ageGroupFor(request.resource.data.age)
        && request.resource.data.code is string && joinOk(request.resource.data, uid);
      // 본인: 등번호·국가·팀·나이만 고칠 수 있다 (별명·가입 정보·회원 번호·정회원 유지는 못 바꿈)
      allow update: if request.auth != null && request.auth.uid == uid && validProfile(request.resource.data)
        && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['number', 'country', 'team', 'age', 'ageGroup', 'stick'])
        && (!request.resource.data.diff(resource.data).affectedKeys().hasAny(['age', 'ageGroup'])
          || request.resource.data.ageGroup == ageGroupFor(request.resource.data.age));
      // 본인(예전 계정): 아이디를 처음 한 번 만든다 (새로 만드는 ids/{아이디} 문서와 같은 묶음, 바꾸거나 더 만들 수 없음)
      // 임시 비밀번호를 받은 예전 계정이면 같은 묶음에서 tempPw 도 지운다
      allow update: if request.auth != null && request.auth.uid == uid
        && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['loginId', 'tempPw'])
        && !('tempPw' in request.resource.data)
        && !('loginId' in resource.data) && loginIdOk(request.resource.data, uid);
      // 본인: 임시 비밀번호(운영자가 줌)를 새 비밀번호로 바꾼 뒤 tempPw 표시를 지운다 (지우기만)
      allow update: if request.auth != null && request.auth.uid == uid
        && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['tempPw'])
        && !('tempPw' in request.resource.data);
      // 본인: 내 초대 코드를 처음 한 번 연결 (새로 만드는 코드 문서와 같은 묶음, 바꾸거나 더 만들 수 없음)
      allow update: if request.auth != null && request.auth.uid == uid
        && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['invite'])
        && !('invite' in resource.data) && request.resource.data.invite is string
        && !exists(/databases/$(database)/documents/codes/$(request.resource.data.invite))
        && getAfter(/databases/$(database)/documents/codes/$(request.resource.data.invite)).data.by == uid;
      // 운영자: 기존 가입자 정리 (회원 번호·베타 표시), 베타가 끝나도 정회원 유지(kept), 이용권 기한(until)·종류(coupon)
      allow update: if isAdmin() && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['memberNo', 'beta', 'kept', 'until', 'coupon'])
        && (request.resource.data.get('until', null) == null || request.resource.data.until is timestamp);
      allow delete: if isAdmin();
    }
    // 개발자에게: 가입한 사람이 한 사람당 문서 하나. 본인과 운영자만 읽는다
    // 처음 보낸 시각(at)은 서버 시간으로 남고 고쳐도 바뀌지 않는다 (베타 종료일 전에 보냈는지 = 3개월 이용권 추첨 대상)
    function validFeedback(d, uid) {
      let u = me();
      return d.keys().hasOnly(['uid', 'nick', 'memberNo', 'good', 'fix', 'updatedAt', 'at'])
        && d.uid == uid && d.nick == u.nick
        && d.get('memberNo', null) == u.get('memberNo', null)
        && d.good is string && d.good.size() <= 500 && d.fix is string && d.fix.size() <= 500
        && (d.good.size() > 0 || d.fix.size() > 0)
        && d.updatedAt == request.time;
    }
    // 내 정보: 출석·최근 기록·누적 훈련 (activity.js). 본인만 읽고 쓰며 운영자는 지울 수 있다
    match /activity/{uid} {
      allow read: if request.auth != null && (request.auth.uid == uid || isAdmin());
      allow create, update: if request.auth != null && request.auth.uid == uid
        && request.resource.data.keys().hasOnly(['uid', 'days', 'totals', 'recent', 'updatedAt'])
        && request.resource.data.uid == uid
        && request.resource.data.days is map && request.resource.data.days.size() <= 3700
        && request.resource.data.totals is map && request.resource.data.recent is map && request.resource.data.recent.size() <= 40
        && request.resource.data.updatedAt is number;
      allow delete: if isAdmin();
    }
    match /feedback/{uid} {
      allow get: if request.auth != null && (request.auth.uid == uid || isAdmin());
      allow list: if isAdmin();
      allow create: if request.auth != null && request.auth.uid == uid
        && validFeedback(request.resource.data, uid) && request.resource.data.at == request.time;
      allow update: if request.auth != null && request.auth.uid == uid
        && validFeedback(request.resource.data, uid) && request.resource.data.at == resource.data.at;
      allow delete: if isAdmin();
    }
    // 별명 고유성: 가입하는 묶음에서 내 프로필의 별명(소문자)으로만 한 번 만든다. 고치거나 지울 수 없다
    match /nicks/{nick} {
      allow read: if true;
      allow create: if joiningNow()
        && request.resource.data.keys().hasOnly(['uid']) && request.resource.data.uid == request.auth.uid
        && getAfter(/databases/$(database)/documents/users/$(request.auth.uid)).data.nickLower == nick;
      allow delete: if isAdmin(); // 운영자가 베타 멤버를 지우면 별명도 다시 쓸 수 있게
    }
    // 로그인 아이디 고유성: 문서 이름 = 아이디(4~20자, 영문 소문자로 시작, 영문 소문자·숫자·_), 칸 = uid·로그인 주소.
    // 아이디를 아는 사람만 읽을 수 있다 (목록은 운영자만). 만들 수 있는 때는 두 가지이고, 고치거나 지울 수 없다
    //  - 가입하는 묶음: 로그인 주소가 이 아이디의 주소(id.<아이디>@…)일 때
    //  - 예전 계정(별명 + 숫자 6자리)이 아이디를 처음 만들 때: 로그인 주소는 예전 그대로일 수 있어 여기 적어 둔다
    match /ids/{id} {
      allow get: if true;
      allow list: if isAdmin();
      allow create: if request.auth != null && id.matches('[a-z][a-z0-9_]{3,19}')
        && request.resource.data.keys().hasOnly(['uid', 'email'])
        && request.resource.data.uid == request.auth.uid
        && request.resource.data.email == request.auth.token.email
        && getAfter(/databases/$(database)/documents/users/$(request.auth.uid)).data.get('loginId', null) == id
        && (joiningNow()
          ? request.auth.token.email.split('@')[0] == 'id.' + id
          : get(/databases/$(database)/documents/users/$(request.auth.uid)).data.get('loginId', null) == null);
      allow delete: if isAdmin(); // 운영자가 베타 멤버를 지우면 아이디도 다시 쓸 수 있게
    }

    // ---- 커뮤니티 ----
    // 코스 포인트 하나: 번호 1~10, 좌표 0~1
    function validPt(p) {
      return p is map && p.keys().hasOnly(['n', 'x', 'y']) && p.n is int && p.n >= 1 && p.n <= 10
        && p.x is number && p.x >= 0 && p.x <= 1 && p.y is number && p.y >= 0 && p.y <= 1;
    }
    function validCourse(c) {
      return c is list && c.size() >= 2 && c.size() <= 10 && validPt(c[0]) && validPt(c[1])
        && (c.size() < 3 || validPt(c[2])) && (c.size() < 4 || validPt(c[3])) && (c.size() < 5 || validPt(c[4]))
        && (c.size() < 6 || validPt(c[5])) && (c.size() < 7 || validPt(c[6])) && (c.size() < 8 || validPt(c[7]))
        && (c.size() < 9 || validPt(c[8])) && (c.size() < 10 || validPt(c[9]));
    }
    // 사이클 기록 (초): 평균·가장 빠른 사이클
    function validCycle(r) {
      return r is map && r.keys().hasOnly(['avg', 'best'])
        && r.avg is number && r.avg > 0 && r.avg < 3600 && r.best is number && r.best > 0 && r.best <= r.avg;
    }
    function validRef(r) {
      return r is map && r.keys().hasOnly(['id', 'title', 'nick', 'avg'])
        && r.id is string && r.id.size() <= 40 && r.title is string && r.title.size() <= 30
        && r.nick is string && r.nick.size() <= 12 && r.avg is number;
    }
    function postKeys() {
      return ['type', 'title', 'body', 'at', 'uid', 'nick', 'number', 'team', 'country', 'ageGroup', 'age',
        'modeId', 'seconds', 'score', 'invisible', 'course', 'cycles', 'record', 'ref'];
    }
    // 글 내용: 종류별로 칸과 값의 범위를 확인
    function validPost(d) {
      return d.type in ['course', 'record', 'beat']
        && d.title is string && d.title.size() > 0 && d.title.size() <= 30
        && d.body is string && d.body.size() <= 200
        && d.at is int
        && (d.type == 'record'
          ? (d.modeId is string && d.modeId.size() <= 40 && d.seconds is number && d.seconds >= 0 && d.seconds <= 3600
            && d.score is int && d.score >= 0 && d.score <= 1000000 && d.invisible is bool)
          : (validCourse(d.course) && d.cycles is int && d.cycles >= 10 && d.cycles <= 100 && d.cycles % 10 == 0
            && (d.get('record', null) == null || validCycle(d.record))
            && (d.type != 'beat' || validRef(d.ref))));
    }
    function newPostOk(d) {
      let u = me();
      return activeMember(u) && d.keys().hasOnly(postKeys()) && d.uid == request.auth.uid
        && sameAuthor(d, u) && d.get('age', null) == u.get('age', null) && d.get('ageGroup', null) == u.get('ageGroup', null)
        && validPost(d);
    }
    // 고치기(기록 자랑을 새 기록으로 바꾸기 포함)는 본인만. 글쓴이·별명·종류는 바꿀 수 없다
    function postUpdateOk(d, old) {
      let u = me();
      let changed = d.diff(old).affectedKeys();
      return activeMember(u) && old.uid == request.auth.uid
        && changed.hasOnly(postKeys().removeAll(['uid', 'nick', 'type']))
        && (!changed.hasAny(['team', 'country', 'number', 'age', 'ageGroup'])
          || (sameAuthor(d, u) && d.get('age', null) == u.get('age', null) && d.get('ageGroup', null) == u.get('ageGroup', null)))
        && validPost(d);
    }
    // 도전 기록 (한 사람당 문서 하나, 자기 것만)
    //  - 코스 글: 평균·가장 빠른 사이클 시간. 예시 코스(starter-*)는 글 문서가 없어도 됨
    //  - 기록 자랑 글: 점수. 글쓴이 본인은 안 되고, 글쓴이와 나이가 같거나 어린 선수만 (글에 나이가 없는 예전 글은 제한 없음)
    function recordOk(postId, uid, d) {
      let u = me();
      let path = /databases/$(database)/documents/posts/$(postId);
      let post = exists(path) ? get(path).data : null;
      return activeMember(u) && d.uid == uid && sameAuthor(d, u) && d.at is int
        && (post == null
          ? (postId.matches('starter-[a-z0-9-]+') && courseRow(d))
          : (post.type == 'record' ? scoreRow(d, post, u, uid) : courseRow(d)));
    }
    function courseRow(d) {
      return d.keys().hasOnly(['uid', 'nick', 'number', 'team', 'country', 'avg', 'best', 'at'])
        && d.avg is number && d.avg > 0 && d.avg < 3600 && d.best is number && d.best > 0 && d.best <= d.avg;
    }
    function scoreRow(d, post, u, uid) {
      return d.keys().hasOnly(['uid', 'nick', 'number', 'team', 'country', 'age', 'score', 'at'])
        && post.uid != uid
        && d.score is int && d.score >= 0 && d.score <= 1000000
        && d.get('age', null) == u.get('age', null)
        && (post.get('age', null) == null || u.age <= post.age);
    }
    // 글은 누구나 읽고, 정회원 본인만 쓰고 고친다. 지우기는 본인 또는 운영자
    match /posts/{id} {
      allow read: if true;
      allow create: if request.auth != null && newPostOk(request.resource.data);
      allow update: if request.auth != null && postUpdateOk(request.resource.data, resource.data);
      allow delete: if request.auth != null && (resource.data.uid == request.auth.uid || isAdmin());
      match /records/{uid} {
        allow read: if true;
        allow create, update: if request.auth != null && request.auth.uid == uid && recordOk(id, uid, request.resource.data);
        allow delete: if isAdmin();
      }
      // 응원: 한 사람당 하나 (누르면 생기고 다시 누르면 지워짐)
      match /cheers/{uid} {
        allow read: if true;
        allow create: if isMember() && request.auth.uid == uid
          && request.resource.data.keys().hasOnly(['at']) && request.resource.data.at is int
          && (id.matches('starter-[a-z0-9-]+') || exists(/databases/$(database)/documents/posts/$(id)));
        allow delete: if request.auth != null && (request.auth.uid == uid || isAdmin());
      }
    }

    // ---- 랭킹: scores_{모드키}/{uid} 모드별 최고 기록 (모드키 예: arcade@60, arcade@60-inv, wide) ----
    // 순위 색인 칸 (앱이 count 쿼리로 순위를 세는 데 씀, account.js rankIdx): '묶음|10자리 점수'
    //   ags = 연령대, cts = 국가, tms = 팀(소문자). 점수·묶음과 맞아야 한다 (남의 순위를 흔들 수 없게)
    function rankIdxOk(d) {
      let n = string(d.score + 1000000000);
      return (!('ags' in d) || d.ags == d.ageGroup + '|' + n)
        && (!('cts' in d) || d.cts == d.country + '|' + n)
        && (!('tms' in d) || d.tms == d.team.lower() + '|' + n);
    }
    // 예전에 쓴 내 기록에 순위 색인 칸만 채우는 수정
    function rankIdxOnly(d, old) {
      return d.diff(old.data).affectedKeys().hasOnly(['ags', 'cts', 'tms']) && rankIdxOk(d);
    }
    function scoreOk(col, uid, d, old) {
      let u = me();
      return activeMember(u)
        && d.keys().hasOnly(['uid', 'nick', 'number', 'country', 'team', 'age', 'ageGroup', 'mode', 'score', 'at', 'plays', 't', 'ags', 'cts', 'tms'])
        && rankIdxOk(d)
        && d.uid == uid && d.mode is string && col == 'scores_' + d.mode
        && sameAuthor(d, u) && d.get('age', null) == u.get('age', null) && d.get('ageGroup', null) == u.get('ageGroup', null)
        && d.score is int && d.score >= 0 && d.score <= 1000000 && d.at is int && d.plays is int
        && d.t == request.time
        && (old == null
          ? d.plays >= 1 && d.plays <= 50
          : (d.plays > old.data.get('plays', 1) && d.plays <= old.data.get('plays', 1) + 50
            && (d.score > old.data.score || (d.score == old.data.score && d.at == old.data.at))
            && request.time > old.data.get('t', timestamp.date(2000, 1, 1)) + duration.value(2, 's')));
    }
    match /{col}/{uid} {
      allow read: if col.matches('scores_[A-Za-z0-9@_-]{1,40}');
      allow create, update: if col.matches('scores_[A-Za-z0-9@_-]{1,40}') && request.auth != null && request.auth.uid == uid
        && (scoreOk(col, uid, request.resource.data, resource)
          || (resource != null && rankIdxOnly(request.resource.data, resource)));
      allow delete: if col.matches('scores_[A-Za-z0-9@_-]{1,40}') && request.auth != null && (request.auth.uid == uid || isAdmin());
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

### 6. 운영자 계정 지정 (가입 코드 기능)
운영자 화면(가입 준비·코드 만들기·게스트 안내)은 Firestore `admins/{uid}` 문서가 있는 계정에만 열립니다. 게임 화면에서는 운영자를 만들 수 없고 콘솔에서만 만듭니다.
1. 운영자로 쓸 별명으로 게임에 가입해 둠 (이미 가입한 계정이면 그대로)
2. Authentication > **사용자** 탭에서 그 계정의 **사용자 UID** 복사 (가상 이메일 `u-xxxx@…` 줄. `u-` 뒤는 별명을 16진수로 바꾼 것, 예: test123 → `u-74657374313233`)
3. Firestore > **데이터** 탭 > 컬렉션 시작 > 컬렉션 ID `admins` > 문서 ID에 복사한 UID > 필드 하나 아무거나 (예: `note` 문자열 `운영자`) > 저장
4. 게임에서 그 계정으로 다시 로그인하면 프로필 줄과 설정 창에 **운영자** 버튼이 보임

### 7. 가입 받기 시작
1. 운영자 화면 > **가입 준비** 를 한 번 누름 — 기존 가입자에게 가입 순서대로 번호를 매기고 베타 멤버로 표시, 회원 수 문서(`meta/members`)를 만듦. 이걸 누르기 전에는 새 가입이 되지 않음
2. **게스트 안내**에 공식 인스타 계정·해시태그를 넣고 저장 (게스트 결과 화면에 나옴, DM 버튼이 그 계정으로 열림)
3. **베타 기간**에 베타 종료일(2026-12-31)을 정해 저장 — 무료 정회원(오픈베타 링크·친구 초대·1회용 코드)은 모두 이 날까지. 정회원에게 "정회원 ○까지 · 의견 보내고 3개월 이용권 추첨" 안내가 뜸
4. **오픈베타 링크** 만들기 — 마감일 12월 31일, 인원 상한 100명으로 만들어 공유. 이 링크로 가입하면 바로 정회원
5. 정회원은 **내 정보 > 친구 초대**에서 자기 초대 링크를 받음(3명까지, 추가 코드 없음). 초대받아 가입한 친구도 자기 링크를 받음. 초대 코드는 베타 종료일에 마감
6. 게스트가 플레이 영상을 SNS에 올리고 그 링크를 공식 인스타 DM으로 보내면 **1회용 코드**를 만들어 코드(또는 링크)를 DM 답장으로 보냄 (한 사람만 쓸 수 있음)
7. 종료일 전에 커뮤니티 [개발자에게]로 의견을 보낸 회원은 **의견 추첨** 대상. 운영자 화면 > 의견 추첨에서 30명을 뽑고 **당첨 확정**을 누르면 당첨자는 베타 종료일(이미 지났으면 오늘)부터 3개월 동안 정회원(`users.until`). 회원 목록의 '3개월 이용권' 버튼으로 한 명씩 줄 수도 있고, '정회원 유지'는 기한 없이 남김
8. 종료일 다음부터는 '정회원 유지'·'3개월 이용권' 회원만 랭킹 등록·글쓰기 가능. 베타 뒤에는 구독형으로 바꿀 예정 (결제 웹훅에 Cloud Functions가 필요해 그때 Blaze 요금제로 전환)

### 8. 보안 겹 더하기 (권장)
1. **운영자 비밀번호**: 운영자 화면 > **운영자 비밀번호**에서 12자 이상으로 바꾸기 (숫자만 써도 됨)
2. **예전 로그인 도메인**: 예전 `@puck-trainer.app` 가상 이메일 계정은 2026-11-17에 모두 새 주소로 옮겨서 그 도메인을 사 둘 필요 없음. 예전 주소 계정이 다시 생기면: Authentication > 설정 > 사용자 작업 > **이메일 열거 보호**를 잠깐 끄고, 그 계정으로 한 번 로그인한 뒤 다시 켜기
3. (선택) **API 키 제한**: Google Cloud 콘솔 > API 및 서비스 > 사용자 인증 정보 > Browser key > 애플리케이션 제한 = HTTP 리퍼러, 허용: `https://puck-trainer.com/*`, `https://ochodoit.github.io/*`, `http://localhost/*`, `http://127.0.0.1/*` — 복사한 사이트는 로그인·가입을 못 함
4. (선택) **App Check**: Firebase 콘솔 > App Check > 웹 앱에 reCAPTCHA v3 등록 → 코드에 App Check 초기화를 넣은 뒤 Firestore·Authentication 적용(enforce). 스크립트·복사 사이트의 접근을 막음

## 설정값을 받은 뒤 Claude가 할 일
1. `src/firebase-config.js` 에 값을 넣고 배포
2. 가입 → 로그인 → 랭킹 등록 → 커뮤니티 글쓰기·기록 게시판을 실제로 확인하고, 문제가 있으면 수정
3. 첫 화면 아래 안내문이 "온라인 랭킹 — 모든 기기의 기록이 함께 집계됩니다."로 바뀌면 연결 완료

## 비밀번호를 잊은 회원 (운영자 재설정)
로그인 주소가 가상 이메일이라 비밀번호 찾기 메일은 보낼 수 없습니다. 대신 로그인 칸의 **비밀번호를 잊었어요**가 공식 인스타 DM으로 안내하고, 운영자가 임시 비밀번호를 줍니다. 비용은 들지 않습니다(무료 요금제 그대로).

**준비 (운영자 PC에서 한 번)**
1. Firebase 콘솔 > 프로젝트 설정(톱니) > **서비스 계정** > **새 비공개 키 생성** → JSON 파일을 **저장소 밖**(예: `C:\keys\`)에 저장. 이 키는 프로젝트 전체 권한이라 저장소에 넣거나 누구에게도 보내면 안 됩니다(실수로 넣어도 `.gitignore` 가 막지만, 처음부터 밖에 두세요). 키를 잃어버리거나 새어 나갔으면 같은 화면에서 그 키를 지우고 새로 만드세요.
2. Node 22 이상에서 `cd tools/admin` → `npm install` (firebase-admin 설치).

**회원이 DM을 보내면**
1. 확인만 하기: `node reset-password.mjs <아이디 또는 별명> --key C:\keys\키파일.json --check` → 회원 번호·팀·나이·스틱·가입한 날·마지막 로그인이 나옵니다. DM에 적힌 팀·나이·스틱·가입한 때와 맞는지 봅니다. 별명·팀·나이·등번호는 랭킹에서 보이니, 스틱(L/R)과 가입한 때(대략)까지 맞아야 본인으로 봅니다. 애매하면 더 묻고, 어린이 회원은 보호자와 이야기하세요.
2. 재설정: 같은 명령에서 `--check` 를 빼고 실행 → 한 번 더 묻고(y) 임시 비밀번호(`xxxx-xxxx-xxxx`)와 보낼 DM 문구를 보여 줍니다. 그 문구를 DM으로 보냅니다.
3. 회원이 임시 비밀번호로 로그인하면 게임이 바로 새 비밀번호(8자 이상, 영문+숫자. 운영자 계정은 12자 이상)를 정하게 하고, 정하기 전에는 들어갈 수 없습니다. 예전 별명 계정이면 아이디도 함께 만듭니다.

도구가 하는 일: 프로필에 `tempPw: true` 를 적고 → 비밀번호를 임시 비밀번호로 바꾸고 → 다른 기기의 로그인을 끊습니다(늦어도 1시간 안에). 아직 안 바꾼 회원은 운영자 화면 회원 목록의 아이디 칸에 **임시 비밀번호** 표시가 붙습니다. 운영자가 먼저 DM으로 비밀번호를 묻는 일은 없다고 로그인 안내에 적어 두었습니다(사칭 DM 방지).

## 알아 둘 점
- 지금은 무료 요금제(Spark)로 충분. 카드 등록 필요 없음. 하루 무료량(읽기 5만·쓰기 2만)과 유료 전환 기준은 README의 '운영 비용' 참고.
- 기존에 각 기기에 저장된 기록·글은 온라인으로 옮겨지지 않음 (온라인에서 새로 가입).
- 예전의 접속 코드(1234) 화면은 없앴습니다. 누구나 게스트로 플레이할 수 있고, 랭킹·글쓰기는 가입 코드로 가입한 정회원만 합니다. 보안은 위 규칙이 담당 (남의 기록·글은 고치거나 지울 수 없음, 코드 사용 횟수·회원 번호는 가입할 때 함께만 바뀜).
- 규칙을 새로 게시하기 전에 바뀐 게임을 배포하면 가입·랭킹 등록이 실패합니다. 규칙 게시 → 운영자 지정 → 가입 준비 순서로 하세요.
- 2026-11-19 (아이디 로그인·판수 모아 쓰기): **규칙을 먼저 게시한 뒤** 게임을 배포(main 에 푸시)하세요. 게시 전에 배포하면 가입(아이디 문서)과, 모아 둔 판수를 쓰는 랭킹 기록이 실패합니다. 예전 게임 화면이 열려 있던 사람은 새로고침하면 됩니다.
- 2026-11-19 (비밀번호 찾기·바꾸기): 이번에도 **규칙을 먼저 게시한 뒤** 배포하세요. 게시 전에 배포하면 임시 비밀번호를 받은 회원이 새 비밀번호를 정한 뒤 마무리(`tempPw` 지우기)가 실패해 다음 로그인 때 한 번 더 정하게 됩니다.
- 랭킹 기록 쓰기: 최고 기록이 오를 때만 기록 문서를 쓰고, 못 넘은 판은 판수만 기기에 모아 두었다가 10판마다·다음 최고 기록 때·화면을 떠날 때·로그아웃할 때 한 번에 씁니다(쓰기 횟수가 판 수만큼 들지 않음).
- (선택) Authentication > 설정 > **비밀번호 정책**에서 최소 8자·영문·숫자를 서버에서도 강제할 수 있습니다. 다만 "강제"로 켜면 아직 아이디를 만들지 않은 예전 계정(숫자 6자리)이 로그인하지 못하므로, 예전 회원이 모두 아이디를 만든 뒤에 켜세요.
- 랭킹 기록은 서버 시간 칸(`t`)이 있어야 써집니다(같은 모드는 2초에 한 번). 규칙을 게시하기 전의 게임 화면이 열려 있으면 새로고침하세요.
- 2026-11-21 (보안 정리 — 공개 문서의 정확한 나이 빼기, 별명 목록 막기, 글 시각 서버 기준, 랭킹 모드 키 허용 목록): **이번에는 순서가 상관없습니다.**
  새 규칙은 예전 게임이 쓰던 문서도 받고, 새 게임은 예전 규칙이 남아 있으면 그때만 나이를 넣어 한 번 더 씁니다(`writePublic`). 그래도 빨리 게시할수록 좋습니다.
  1. 저장소의 `firestore.rules` 전체를 콘솔 > Firestore > 규칙에 붙여넣고 **게시** (게시 전에 '규칙 놀이터'에서 오류가 없는지 확인)
  2. 이미 저장된 공개 문서의 나이 칸 지우기: `cd tools/admin && node cleanup.mjs age --key C:\keys\키파일.json` 로 개수 확인 → `--apply` 로 지우기 (나이대는 그대로, 프로필의 나이도 그대로)
  3. 아직 아이디를 만들지 않은 예전 계정(숫자 6자리 비밀번호) 확인: `node cleanup.mjs legacy --key ...` → 목록의 회원에게 `reset-password.mjs` 로 임시 비밀번호를 주거나, 오래 안 쓴 계정은 콘솔에서 사용 중지
  4. (선택, 일주일쯤 뒤) 예전 게임 화면이 모두 새로고침된 뒤에는 규칙의 `ageOk` 를 `!('age' in d)` 로 좁혀 공개 문서에 나이를 아예 못 쓰게 할 수 있습니다
  - 콘솔에서만 할 수 있는 것(아직 확인 안 됨): App Check(reCAPTCHA) 켜기, API 키를 puck-trainer.com 에서만 쓰게 제한, 예산 알림, 운영자 계정 2단계 인증
