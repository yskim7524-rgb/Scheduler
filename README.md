# Weekflow

일정, 할 일, 마감을 한눈에 보는 한국어 주간 대시보드입니다. React 19 + Vite로 만들었으며 별도 서버나 데이터베이스 없이 실행할 수 있습니다.

## 개발

Node.js 22.12 이상 또는 24를 사용합니다.

```sh
npm ci
npm run dev
```

기본 개발 포트는 5173입니다. 샘플 일정과 할 일이 제공되므로 Google 설정 없이도 사용할 수 있습니다. 주간 이동, 다음 주 일정, 할 일 추가·수정·완료·삭제와 마감 분류를 지원합니다. 할 일은 현재 브라우저의 localStorage에 저장됩니다. 다른 기기나 Google Tasks와 동기화되지 않습니다. Google 연결 후에도 샘플 할 일은 남으므로 수정하거나 실제 할 일로 교체하세요.

## 대시보드 사용

- **할 일 수정:** 연필 버튼으로 제목·마감일·우선순위·분류를 수정합니다. 오늘 또는 지난 마감의 화살표 버튼은 마감일을 내일로 변경합니다. 완료 상태는 수정 후에도 유지됩니다.
- **일정 보기:** 주간 표와 날짜순 목록을 전환할 수 있습니다. 휴대폰에서는 목록이 기본이고, 데스크톱에서는 주간 표가 기본입니다. 직접 선택한 보기 방식은 현재 접속 중 유지됩니다.
- **마감 구분:** 완료하지 않은 할 일을 오늘 마감·지난 마감·다가오는 마감으로 나눕니다. 대시보드의 마감 항목을 누르면 바로 수정할 수 있습니다.
- **연결 상태:** 마지막 정상 갱신 날짜와 시각, 연결 만료 시각, 조회 실패와 재연결 필요 여부를 표시합니다. Google 연결 후 새로고침·만료·연결 해제가 발생해도 실제 일정 대신 샘플을 자동 표시하지 않습니다. 샘플로 돌아가려면 명시적으로 **샘플 보기**를 선택하세요.

기존 `weekflow.tasks.v1` 저장 데이터를 계속 사용하므로 업데이트로 기존 할 일을 초기화하지 않습니다. 날짜는 기기의 현지 시간을 따릅니다.

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
5. `calendar.readonly` 권한을 승인하면 **기본 캘린더**의 선택한 주와 그다음 주 일정을 조회합니다. 다른 캘린더는 현재 지원하지 않습니다. 여러 페이지의 이벤트와 종일·반복·여러 날 일정을 처리합니다.

토큰은 메모리에만 보관하며 새로고침 또는 만료 후 다시 연결해야 합니다. 연결 해제는 토큰 권한을 취소합니다. 일정 수정, 백그라운드 자동 동기화, 팀 공유는 포함되어 있지 않습니다. 연결 시 및 주 이동 시 일정을 조회하고, 새로고침 버튼으로 갱신할 수 있습니다. 로그인 팝업 허용이 필요합니다. 공개 서비스로 출시할 때는 Google의 OAuth 앱 검증 요건을 확인하세요.

접속이 필요한 외부 도메인: npm 설치는 `registry.npmjs.org`, Calendar 연결은 `accounts.google.com`, `www.googleapis.com`, Google Tasks 조회는 `tasks.googleapis.com`. 선택적 웹 폰트는 `fonts.googleapis.com`, `fonts.gstatic.com`이며 사용할 수 없으면 시스템 폰트를 사용합니다.

## Google Tasks의 할 일이 보이지 않을 때

Google Calendar 화면의 원 모양 체크 표시가 있는 ‘할 일’은 Calendar 일정과 별개로 **Google Tasks API**에서 조회해야 합니다.

1. 기존 OAuth 클라이언트 ID를 만든 동일한 프로젝트에서 [Google Tasks API](https://console.cloud.google.com/apis/library/tasks.googleapis.com)를 활성화합니다.
2. 앱을 새로고침하고 **Google Tasks 연결**을 누릅니다. 기존 클라이언트 ID를 그대로 사용합니다.
3. 같은 Google 계정으로 로그인해 추가되는 **할 일 읽기 권한**(`tasks.readonly`)을 허용합니다. 테스트 모드에서는 해당 계정이 OAuth 테스트 사용자여야 합니다.
4. Google Tasks 영역에서 **모든 목록** 또는 원하는 목록을 선택합니다. 완료 항목은 **Google 완료 항목 보기**를 켜면 표시됩니다.

모든 목록과 모든 페이지를 조회하며, 마감일 없는 할 일·숨겨진 완료 항목·할당된 할 일도 포함합니다. 삭제된 항목은 표시하지 않습니다. 미완료 항목에 마감일이 있으면 주간 표와 모바일 일정 목록에도 **할 일 · 마감일**로 표시합니다. Tasks API는 날짜만 제공하므로 실제 Google 화면의 예약 시각을 재현하지 않습니다. 마감일 없는 항목은 날짜별 일정에 넣지 않고 Google Tasks 목록에 표시합니다.

Google 항목은 읽기 전용이며 수정·완료 처리는 **Google에서 관리** 링크에서 합니다. 직접 추가·수정하는 브라우저 할 일은 별도 기능입니다. Google의 할 일 내용과 접근 토큰은 브라우저 메모리에만 유지하고 localStorage에 복사하지 않습니다. 새로고침·연결 만료 후에는 다시 연결해야 합니다. Google Tasks API 접근 실패는 별도 영역에 표시하며 Calendar 연결이나 기존 브라우저 할 일을 삭제하지 않습니다.

## 테스트 범위

`npm test`는 주 경계, 마감 날짜 계산, Google 종일 일정의 배타적 종료일, 자정을 넘는 일정과 취소 이벤트, 마감 분류를 검증합니다.

기존 할 일 보존, 수정·취소·미루기, 완료·저장, 날짜 변경, 모바일 목록, Google 모의 연결의 재시도·만료·샘플 분리는 다음 브라우저 검사로 검증합니다.

```sh
# 시스템 Chromium이 없으면 한 번 설치합니다.
npx playwright install chromium
npm run build
npm run test:browser
```

브라우저 검사는 별도 포트 4197의 프로덕션 미리보기와 독립된 브라우저 저장 공간을 사용합니다. `PLAYWRIGHT_CHROMIUM_EXECUTABLE`로 Chromium 경로를 지정할 수 있습니다. 공개 배포 파일을 대상으로 검사하려면 `WEEKFLOW_TEST_URL=https://yskim7524-rgb.github.io/Scheduler/ npm run test:browser`를 사용하세요. 공개 검사에서는 인증서 검증을 유지하는 시스템 curl로 받은 파일을 브라우저에서 렌더링합니다. Google 계정 동의는 모의 응답으로 검사하며, 실제 OAuth 연결은 본인 Google Cloud 프로젝트의 클라이언트 ID 및 브라우저 동의가 필요합니다.

## 무료 배포: GitHub Pages

저장소의 **Settings → Pages → Build and deployment → Source**를 **GitHub Actions**로 설정합니다. `.github/workflows/deploy.yml`은 `main` 푸시 또는 수동 실행 시 테스트와 빌드를 거쳐 `dist`를 배포합니다. Pages 사용 가능 여부는 저장소 공개 범위와 GitHub 요금제에 따라 달라집니다.

배포 성공 후 GitHub가 표시하는 실제 Pages 주소로 접속합니다. 프로젝트 하위 경로에서도 자산이 로드되도록 Vite의 `base`를 상대 경로로 설정했습니다. Google OAuth의 승인된 JavaScript 원본에는 이 주소의 **원본만** 등록해야 합니다. 예를 들어 `https://yskim7524-rgb.github.io/Scheduler/`에 배포했다면 `https://yskim7524-rgb.github.io`를 등록합니다. OAuth 설정이 없어도 샘플 데이터와 로컬 할 일 관리 기능은 동작합니다.
