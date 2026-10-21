# Weekflow

일정, 할 일, 마감을 한눈에 보는 한국어 주간 대시보드입니다. React 19 + Vite로 만들었으며 별도 서버나 데이터베이스 없이 실행할 수 있습니다.

## 개발

Node.js 22.12 이상 또는 24를 사용합니다.

```sh
npm ci
npm run dev
```

기본 개발 포트는 5173입니다. 샘플 일정과 할 일이 제공되므로 Google 설정 없이도 사용할 수 있습니다. 주간 이동, 다음 주 일정, 할 일 추가·완료·삭제, 마감일 정렬을 지원합니다. 할 일은 현재 브라우저의 localStorage에 저장됩니다. 다른 기기나 Google Tasks와 동기화되지 않습니다. Google 연결 후에도 샘플 할 일은 남으므로 삭제하거나 실제 할 일로 교체하세요.

```sh
npm test
npm run build
npm run preview
```

## Google Calendar 연결

1. Google Cloud Console에서 프로젝트를 만들고 **Google Calendar API**를 활성화합니다.
2. Google Auth Platform에서 동의 화면을 설정하고 **웹 애플리케이션** 유형의 OAuth 클라이언트를 생성합니다. 테스트 모드라면 연결할 계정을 테스트 사용자로 추가합니다.
3. **승인된 JavaScript 원본**에 실제 접속하는 앱의 원본(프로토콜, 호스트, 포트)을 등록합니다. 로컬 개발에서는 `http://localhost:5173`을 사용할 수 있습니다. 배포 환경에는 HTTPS가 필요합니다. 이 앱은 Google Identity Services 토큰 팝업을 사용하므로 리디렉션 URI는 필요하지 않습니다.
4. 앱의 **설정 및 연동**에서 공개 클라이언트 ID를 입력하고 연결합니다. 또는 `.env.example`을 `.env.local`로 복사해 `VITE_GOOGLE_CLIENT_ID`를 설정한 후 개발 서버를 시작합니다. 클라이언트 보안 비밀번호는 사용하지 않습니다.
5. `calendar.readonly` 권한을 승인하면 **기본 캘린더**의 선택한 주와 그다음 주 일정을 조회합니다. 다른 캘린더와 Google Tasks는 현재 지원하지 않습니다. 여러 페이지의 이벤트와 종일·반복·여러 날 일정을 처리합니다.

토큰은 메모리에만 보관하며 새로고침 또는 만료 후 다시 연결해야 합니다. 연결 해제는 토큰 권한을 취소합니다. 일정 수정, 백그라운드 자동 동기화, 팀 공유는 포함되어 있지 않습니다. 연결 시 및 주 이동 시 일정을 조회하고, 새로고침 버튼으로 갱신할 수 있습니다. 로그인 팝업 허용이 필요합니다. 공개 서비스로 출시할 때는 Google의 OAuth 앱 검증 요건을 확인하세요.

접속이 필요한 외부 도메인: npm 설치는 `registry.npmjs.org`, Calendar 연결은 `accounts.google.com`, `www.googleapis.com`. 선택적 웹 폰트는 `fonts.googleapis.com`, `fonts.gstatic.com`이며 사용할 수 없으면 시스템 폰트를 사용합니다.

## 테스트 범위

`npm test`는 주 경계, 마감 날짜 계산, Google 종일 일정의 배타적 종료일, 자정을 넘는 일정과 취소 이벤트를 검증합니다. 실제 OAuth 연결은 본인 Google Cloud 프로젝트의 클라이언트 ID 및 브라우저 동의가 필요합니다.

## 무료 배포: GitHub Pages

저장소의 **Settings → Pages → Build and deployment → Source**를 **GitHub Actions**로 설정합니다. `.github/workflows/deploy.yml`은 `main` 푸시 또는 수동 실행 시 테스트와 빌드를 거쳐 `dist`를 배포합니다. Pages 사용 가능 여부는 저장소 공개 범위와 GitHub 요금제에 따라 달라집니다.

배포 성공 후 GitHub가 표시하는 실제 Pages 주소로 접속합니다. 프로젝트 하위 경로에서도 자산이 로드되도록 Vite의 `base`를 상대 경로로 설정했습니다. Google OAuth의 승인된 JavaScript 원본에는 이 주소의 **원본만** 등록해야 합니다. 예를 들어 `https://yskim7524-rgb.github.io/Scheduler/`에 배포했다면 `https://yskim7524-rgb.github.io`를 등록합니다. OAuth 설정이 없어도 샘플 데이터와 로컬 할 일 관리 기능은 동작합니다.
