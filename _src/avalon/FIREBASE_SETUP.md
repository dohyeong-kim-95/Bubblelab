# Firebase 프로젝트 설정 지시서

## 프로젝트 개요

"The Resistance: Avalon" 웹 기반 멀티플레이어 보드게임의 백엔드로 사용할 Firebase 프로젝트를 설정해야 합니다.

- **용도**: 5~10명이 각자의 기기에서 실시간으로 아발론 보드게임을 플레이
- **아키텍처**: 서버리스 (GitHub Pages 정적 호스팅 + Firebase BaaS)
- **클라이언트**: Vite + Vanilla JS SPA

---

## 1. 필요한 Firebase 서비스

아래 **2개 서비스만** 활성화해 주세요. 다른 서비스(Firestore, Storage, Functions 등)는 사용하지 않습니다.

### 1-1. Authentication (인증)

- **익명 인증(Anonymous Authentication)만 활성화**해 주세요.
- 이메일/비밀번호, Google, 기타 소셜 로그인은 불필요합니다.
- 용도: 각 플레이어에게 고유 UID를 발급하여 방 참가, 투표, 미션 카드 제출 시 본인 확인에 사용합니다.

### 1-2. Realtime Database (실시간 데이터베이스)

- **Realtime Database를 생성**해 주세요. (Firestore가 아닙니다)
- 리전: **asia-southeast1 (싱가포르)** 권장 (한국 사용자 대상)
- 요금제: **Spark (무료)** 플랜으로 충분합니다.

---

## 2. Realtime Database 보안 규칙

데이터베이스 생성 후, 아래 보안 규칙을 **그대로** 적용해 주세요.

이 규칙의 핵심 원칙:
- 방에 참가한 플레이어만 방 데이터를 읽을 수 있음
- 각 플레이어는 자신의 데이터만 쓸 수 있음
- 게임 상태(gameState)는 방장만 갱신 가능
- 비공개 데이터(privateData)는 해당 플레이어만 읽기 가능
- 투표/미션 카드는 1회만 제출 가능 (`!data.exists()` 조건)

```json
{
  "rules": {
    "rooms": {
      "$roomCode": {
        "meta": {
          ".read": "root.child('rooms/' + $roomCode + '/players/' + auth.uid).exists()",
          ".write": "data.child('hostId').val() === auth.uid || !data.exists()"
        },
        "players": {
          "$playerId": {
            ".read": "root.child('rooms/' + $roomCode + '/players/' + auth.uid).exists()",
            ".write": "$playerId === auth.uid"
          }
        },
        "gameState": {
          ".read": "root.child('rooms/' + $roomCode + '/players/' + auth.uid).exists()",
          ".write": "root.child('rooms/' + $roomCode + '/meta/hostId').val() === auth.uid"
        },
        "privateData": {
          "$playerId": {
            ".read": "$playerId === auth.uid",
            ".write": "root.child('rooms/' + $roomCode + '/meta/hostId').val() === auth.uid"
          }
        },
        "actions": {
          "votes": {
            "$playerId": {
              ".read": "$playerId === auth.uid || root.child('rooms/' + $roomCode + '/gameState/phase').val() !== 'voting'",
              ".write": "$playerId === auth.uid && !data.exists()"
            }
          },
          "missionCards": {
            "$playerId": {
              ".read": "root.child('rooms/' + $roomCode + '/meta/hostId').val() === auth.uid",
              ".write": "$playerId === auth.uid && !data.exists()"
            }
          },
          "assassination": {
            ".read": "root.child('rooms/' + $roomCode + '/players/' + auth.uid).exists()",
            ".write": "root.child('rooms/' + $roomCode + '/meta/hostId').val() === auth.uid || root.child('rooms/' + $roomCode + '/privateData/' + auth.uid + '/role').val() === 'assassin'"
          },
          "readyPlayers": {
            "$playerId": {
              ".read": "root.child('rooms/' + $roomCode + '/players/' + auth.uid).exists()",
              ".write": "$playerId === auth.uid"
            }
          }
        }
      }
    }
  }
}
```

---

## 3. 웹 앱 등록

Firebase 프로젝트에 **웹 앱**을 1개 등록하고, 설정값을 제공해 주세요.

필요한 설정값 4가지:
- `apiKey`
- `authDomain`
- `databaseURL`
- `projectId`

이 값들은 클라이언트 코드의 환경변수로 사용됩니다:

```
VITE_FIREBASE_API_KEY=<apiKey>
VITE_FIREBASE_AUTH_DOMAIN=<authDomain>
VITE_FIREBASE_DATABASE_URL=<databaseURL>
VITE_FIREBASE_PROJECT_ID=<projectId>
```

---

## 4. 승인된 도메인 설정

Authentication > Settings > 승인된 도메인(Authorized domains)에 다음을 추가해 주세요:

- `localhost` (개발용, 기본 포함)
- `<username>.github.io` (GitHub Pages 배포 도메인)

---

## 4-1. GitHub Actions Secrets

이 저장소는 GitHub Pages 배포 시 아래 repository secrets를 사용하도록 되어 있습니다.

- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_DATABASE_URL`
- `VITE_FIREBASE_PROJECT_ID`

경로:

- GitHub repo > Settings > Secrets and variables > Actions > New repository secret

주의:

- 로컬 `.env` 값과 동일한 값을 넣으면 됩니다.
- `.env`를 계속 git에 올려두는 방식보다 이 구성이 안전합니다.

---

## 5. 데이터 구조 참고

이 프로젝트의 데이터베이스 구조는 다음과 같습니다. 별도의 인덱스 설정은 필요하지 않습니다.

```
/rooms/{roomCode}
  /meta          — 방 설정 (hostId, status, roleConfig, createdAt)
  /players/{id}  — 참가자 정보 (name, online, joinedAt, order)
  /gameState     — 게임 공개 상태 (phase, missionResults, playerOrder 등)
  /privateData/{id} — 비공개 역할 정보 (role, team, visibleInfo)
  /actions
    /votes/{id}        — 팀 투표 (approve/reject)
    /missionCards/{id} — 미션 카드 (success/fail)
    /assassination     — 암살 대상 (targetId)
    /readyPlayers/{id} — 준비 완료 플래그
```

---

## 6. 설정 불필요 항목 (하지 않아도 되는 것들)

- Firestore → 사용 안 함
- Cloud Functions → 사용 안 함
- Cloud Storage → 사용 안 함
- Firebase Hosting → 사용 안 함 (GitHub Pages 사용)
- Analytics → 선택 사항 (필수 아님)
- App Check → 선택 사항 (필수 아님)
- Remote Config → 사용 안 함
- Cloud Messaging → 사용 안 함

---

## 7. 무료 플랜(Spark) 제한 참고

| 항목 | 제한 |
|------|------|
| 동시 연결 | 100 |
| 저장 용량 | 1GB |
| 다운로드 | 10GB/월 |

한 방에 최대 10명이므로 동시 연결 100은 약 10개 방 동시 운영 가능합니다.

---

## 요약 체크리스트

- [ ] Firebase 프로젝트 생성
- [ ] Authentication > 익명 인증 활성화
- [ ] Realtime Database 생성 (asia-southeast1)
- [ ] 보안 규칙 적용 (위 JSON 그대로)
- [ ] 웹 앱 등록 후 설정값 4개 확인
- [ ] 승인된 도메인에 GitHub Pages 도메인 추가
