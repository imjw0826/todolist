# 마인드맵 투두리스트

진행 중인 프로젝트 · 취미 · 공부 · 여행을 한 화면에서 마인드맵으로 관리.
왼쪽에서 오른쪽으로 뻗어 나가는 잉크 가지 스타일.

- **읽기**: 누구나 가능
- **편집**: 관리자 비밀번호 입력 후 활성화

## 구조

```
project_todolist/
├── frontend/       React + Vite + TypeScript + D3 + Firebase SDK
```

데이터는 **Firebase Realtime Database**에 저장됩니다. 별도 백엔드 서버 없음.

## 로컬 실행

```bash
cd frontend
cp .env.example .env.local
# .env.local 열어서 Firebase 설정값 입력

npm install
npm run dev    # → http://localhost:5173
```

## 사용법
- **마우스 휠**: 확대/축소
- **드래그**: 화면 이동
- **노드 클릭**: 하위 노드 펼치기/접기
- **🔒 → 비밀번호**: 관리자 모드 → 호버(터치 화면은 노드를 탭) 시 `＋` `✎` `×` 버튼

## Jev 자동 추가

화면 맨 위 입력창에 항목을 적고 Enter를 누르면 [TypeSafe AI의 Jev](https://typesafe.ai)가
지금 마인드맵에서 어느 노드 밑에 들어가야 하는지 골라 그 아래에 새 노드로 추가합니다.

- 관리자 모드에서만 사용 가능
- 처음 한 번 `⚙`에서 TypeSafe API 키 입력 — 그 기기의 브라우저(localStorage)에만 저장되고 빌드에 포함되지 않음
- Jev는 부모 노드를 고르기만 하고, 기존 노드를 바꾸거나 옮기지 않음
- Jev 호출이 실패하면 그 자리에서 위치를 직접 골라 추가 가능
