# 마인드맵 투두리스트

진행 중인 프로젝트 · 취미 · 공부 · 여행을 한 화면에서 마인드맵으로 관리.
왼쪽에서 오른쪽으로 뻗어 나가는 잉크 가지 스타일.

- **읽기**: 누구나 가능
- **편집**: 관리자 비밀번호 입력 후 활성화

## 구조

```
project_todolist/
├── frontend/       React + Vite + TypeScript + D3 + Firebase SDK
└── DEPLOY.md       배포 가이드
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
- **🔒 → 비밀번호**: 관리자 모드 → 호버 시 `＋` `✎` `🗑` 버튼

## 배포

`DEPLOY.md` 참고.

## 참고
비밀번호는 누군가 무심코 수정하지 않도록 하는 목적입니다. 보안 기능이 아니므로 필요에 따라 변경하세요.
