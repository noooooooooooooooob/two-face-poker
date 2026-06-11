# 인터넷 공개 배포 가이드 (Render 무료)

한 번만 해두면 누구나 `https://___.onrender.com` 주소로 바로 접속해서 플레이할 수 있습니다.
코딩 지식 불필요, 전부 웹에서 클릭으로 진행. 약 10분 소요.

## 1단계. GitHub에 코드 올리기

1. https://github.com 가입/로그인
2. 우측 상단 **+** → **New repository** → 이름 `two-face-poker` 입력 → **Create repository**
3. 만들어진 페이지에서 **uploading an existing file** 링크 클릭
4. `two-face-poker` 폴더 안의 파일들을 전부 드래그해서 업로드
   - ⚠️ `node_modules` 폴더는 **올리지 마세요** (용량만 크고 불필요)
   - 올릴 것: `server.js`, `package.json`, `render.yaml`, `public` 폴더(안의 `index.html` 포함), `README.md`
   - `public/index.html`은 폴더 구조 유지가 필요하므로, 웹 업로드 시 폴더째 드래그하면 됩니다
5. **Commit changes** 클릭

## 2단계. Render에 배포

1. https://render.com 접속 → **Get Started** → GitHub 계정으로 가입/로그인
2. 대시보드에서 **New +** → **Web Service**
3. 방금 만든 `two-face-poker` 저장소 선택 (**Connect**)
4. 설정은 자동 인식됨. 확인할 것:
   - Runtime: **Node**
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Instance Type: **Free**
5. **Deploy Web Service** 클릭 → 1~3분 후 빌드 완료

## 3단계. 플레이

- 상단에 표시되는 `https://two-face-poker-xxxx.onrender.com` 주소가 게임 주소입니다
- 이 주소를 친구에게 보내면 어디서든 접속 가능 — 한 명이 방 만들기, 다른 한 명이 코드로 입장

## 참고

- **무료 플랜 특성**: 15분간 접속이 없으면 서버가 잠듭니다. 다시 접속하면 첫 로딩에 30초~1분 걸린 후 정상 작동합니다.
- 코드를 수정하면 GitHub에 다시 업로드 → Render가 자동으로 재배포합니다.
- 주소를 바꾸고 싶으면 Render 대시보드 → Settings → Name 변경.
