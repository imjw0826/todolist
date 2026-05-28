# 배포 가이드

프런트엔드 → **GitHub Pages** / 데이터 → **Firebase Realtime Database** (무료)

백엔드 서버 없음. 브라우저에서 Firebase에 직접 읽기/쓰기.

---

## STEP 1 — Firebase 프로젝트 만들기

### 1-1. 프로젝트 생성
1. https://console.firebase.google.com 접속 (Google 계정 로그인)
2. **프로젝트 추가** 클릭
3. 프로젝트 이름 입력 (예: `mindmap-todolist`) → 계속
4. Google Analytics: **사용 설정 안함** → **프로젝트 만들기**

### 1-2. Realtime Database 활성화
1. 왼쪽 메뉴 **빌드 → Realtime Database**
2. **데이터베이스 만들기** 클릭
3. 위치: `asia-southeast1 (싱가포르)` 선택 (한국에서 가장 가까움)
4. 보안 규칙: **테스트 모드에서 시작** 선택 → **사용 설정**

### 1-3. 보안 규칙 수정
Realtime Database → **규칙** 탭에서 아래 내용으로 교체 후 **게시**:

```json
{
  "rules": {
    ".read": true,
    ".write": true
  }
}
```

> 읽기/쓰기 모두 공개. 비밀번호 체크는 브라우저에서만 함.

### 1-4. 초기 데이터 입력
Realtime Database → **데이터** 탭 오른쪽 위 **⋮ → JSON 가져오기** 클릭 후 아래 파일 업로드:

`backend/data.json` 파일을 그대로 업로드하면 됩니다.

(data.json이 없다면 아래 내용을 JSON 파일로 저장해서 업로드)

```json
{
  "next_id": 6,
  "tree": {
    "id": 1,
    "parent_id": null,
    "title": "내 마인드맵",
    "category": null,
    "sort_order": 0,
    "children": [
      {"id": 2, "parent_id": 1, "title": "프로젝트", "category": "project", "sort_order": 0, "children": []},
      {"id": 3, "parent_id": 1, "title": "취미",     "category": "hobby",   "sort_order": 1, "children": []},
      {"id": 4, "parent_id": 1, "title": "공부",     "category": "study",   "sort_order": 2, "children": []},
      {"id": 5, "parent_id": 1, "title": "여행",     "category": "travel",  "sort_order": 3, "children": []}
    ]
  }
}
```

### 1-5. 앱 등록 & 설정값 복사
1. Firebase 콘솔 → **프로젝트 설정** (왼쪽 하단 ⚙️ 아이콘)
2. **내 앱** 섹션 → `</>` (웹) 아이콘 클릭
3. 앱 닉네임 입력 (예: `mindmap-web`) → **앱 등록**
4. 아래처럼 생긴 설정값이 나옴 → 복사해두기:

```js
const firebaseConfig = {
  apiKey: "AIzaSy...",
  authDomain: "mindmap-todolist.firebaseapp.com",
  databaseURL: "https://mindmap-todolist-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "mindmap-todolist",
  storageBucket: "mindmap-todolist.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abc123"
};
```

---

## STEP 2 — GitHub 저장소 만들기

### 2-1. GitHub에서 새 저장소 생성
1. https://github.com/new 접속
2. Repository name 입력 (예: `mindmap-todolist`)
3. **Public** 선택
4. **Create repository**

### 2-2. 로컬 프로젝트 연결
```bash
cd /Users/garden/Documents/project_todolist

git init
git add .
git commit -m "first commit"
git branch -M main
git remote add origin https://github.com/[내아이디]/[저장소명].git
git push -u origin main
```

---

## STEP 3 — GitHub Secrets 등록

저장소 → **Settings → Secrets and variables → Actions → New repository secret**

아래 항목을 하나씩 추가:

| Name | Value |
|---|---|
| `VITE_FIREBASE_API_KEY` | Firebase 설정의 `apiKey` 값 |
| `VITE_FIREBASE_AUTH_DOMAIN` | Firebase 설정의 `authDomain` 값 |
| `VITE_FIREBASE_DATABASE_URL` | Firebase 설정의 `databaseURL` 값 |
| `VITE_FIREBASE_PROJECT_ID` | Firebase 설정의 `projectId` 값 |
| `VITE_FIREBASE_STORAGE_BUCKET` | Firebase 설정의 `storageBucket` 값 |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | Firebase 설정의 `messagingSenderId` 값 |
| `VITE_FIREBASE_APP_ID` | Firebase 설정의 `appId` 값 |
| `VITE_ADMIN_PASSWORD` | 원하는 비밀번호 (예: `1234`) |

---

## STEP 4 — vite.config.ts에 base 추가

`frontend/vite.config.ts` 수정:

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "/[저장소명]/",   // ← 추가. 예: "/mindmap-todolist/"
  server: {
    port: 5173,
  },
});
```

수정 후 커밋·푸시:

```bash
git add .
git commit -m "Set base path for GitHub Pages"
git push
```

---

## STEP 5 — GitHub Pages 활성화

저장소 → **Settings → Pages**
- Source: **GitHub Actions** 선택

푸시하면 GitHub Actions가 자동으로 빌드·배포 (1~2분 소요).

---

## 완료 후 접속 주소

```
https://[내아이디].github.io/[저장소명]/
```

---

## 로컬 개발 방법

`.env.example`을 복사해서 `.env.local`로 만들고 Firebase 설정값 입력:

```bash
cp frontend/.env.example frontend/.env.local
# .env.local 열어서 값 채우기
```

```bash
cd frontend && npm run dev   # → http://localhost:5173
```

백엔드 서버는 더 이상 필요 없습니다.

---

## 업데이트 방법

코드 수정 후 `git push`만 하면 자동 재배포.
데이터는 Firebase 콘솔에서 직접 확인·수정 가능.
