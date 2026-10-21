# 페이지를 다시 열어도 Google 연결 유지하기

이 방식은 앱과 인증 서버를 같은 Cloudflare Workers 주소에 배포합니다. GitHub Pages에는 서버를 실행할 수 없으므로 **배포 후 새 주소로 접속**해야 합니다. 현재 저장소에는 서버 코드와 테스트가 준비되어 있지만 Cloudflare 계정과 Google 서버 설정을 입력하기 전에는 장기 로그인이 활성화되지 않습니다.

## 1. Cloudflare 계정 준비

[Cloudflare 가입](https://dash.cloudflare.com/sign-up) 후 이메일을 확인합니다. 이 구성은 Workers와 D1을 사용하며 무료 플랜으로 시작할 수 있습니다. 사용량 한도와 요금은 계정에서 확인하세요. 도메인 구매나 DNS 이전은 필요하지 않습니다.

Codex에서 배포를 진행하려면 Cloudflare의 **Account ID**와 해당 계정에 한정된 API 토큰이 필요합니다. API 토큰 권한은 **Account → Workers Scripts → Edit**, **Account → D1 → Edit**입니다. Cloudflare 기본 Workers 배포 템플릿을 사용할 경우 계정 조회 등 기본 권한을 유지하세요. 전역 API 키는 사용하지 않습니다.

API 토큰은 채팅·GitHub에 올리지 말고 Codex 환경 설정의 `CLOUDFLARE_API_TOKEN` 비밀 값에 입력합니다. Account ID는 `CLOUDFLARE_ACCOUNT_ID` 환경 변수에 입력합니다. 환경 설정 저장과 환경 게시는 별도 단계이며, 저장만으로 현재 실행 환경이나 앱이 배포되지는 않습니다.

직접 로컬 PC에서 배포한다면 `npx wrangler login`으로 브라우저 인증할 수도 있습니다. API 토큰 값을 명령줄 인자로 적지 마세요.

## 2. 데이터베이스와 첫 배포

저장소에서 Node.js 24와 설치된 의존성을 사용합니다.

```sh
npm ci
npx wrangler d1 create weekflow-auth
```

출력된 데이터베이스 ID를 `wrangler.jsonc`의 `d1_databases[0].database_id`에 입력합니다. 이 ID는 비밀번호가 아닙니다. 기존 바인딩 이름 `DB`와 마이그레이션 경로는 유지합니다.

```sh
npm run db:remote
npm run deploy:cloudflare
```

배포 결과의 실제 `https://weekflow.<계정 하위 도메인>.workers.dev` 주소를 기록합니다. 처음에는 인증 설정이 아직 없으므로 로그인되지 않는 것이 정상입니다. 배포 명령은 데이터베이스 ID가 기본 예제 값이면 중단합니다.

## 3. Google OAuth 설정

기존 Google Cloud 프로젝트에서 **Google Calendar API**, **Google Tasks API**를 활성화하고 웹 애플리케이션 유형의 OAuth 클라이언트를 사용합니다.

Google Cloud Console → Google Auth Platform → 클라이언트에서 기존 클라이언트를 열고 **승인된 리디렉션 URI**에 다음 주소를 정확히 추가합니다.

```text
https://<실제 Workers 호스트>/auth/google/callback
```

이 값은 경로까지 필요합니다. GitHub Pages용 JavaScript 원본은 기존 앱을 계속 사용할 경우 유지합니다. 새 서버 방식에는 JavaScript 토큰 팝업을 사용하지 않습니다. 테스트 중이라면 본인 Google 계정을 테스트 사용자로 등록합니다.

## 4. 서버 설정 입력

Cloudflare 대시보드 → **Workers & Pages → weekflow → Settings → Variables and Secrets**에서 아래 값을 입력하고 변경을 배포합니다. UI 이름은 계정 언어에 따라 다를 수 있습니다.

| 이름 | 종류 | 내용 |
| --- | --- | --- |
| `APP_ORIGIN` | Text | 실제 Workers 원본. 예: `https://weekflow.example.workers.dev` (끝 `/` 제외) |
| `GOOGLE_CLIENT_ID` | Text | 웹 OAuth 클라이언트의 공개 ID |
| `ALLOWED_EMAILS` | Text | 로그인할 본인 Google 이메일. 복수일 때 쉼표로 구분 |
| `GOOGLE_CLIENT_SECRET` | Secret | 위 OAuth 클라이언트의 클라이언트 보안 비밀번호 |
| `SESSION_ENCRYPTION_KEY` | Secret | `openssl rand -base64 32`로 만든 무작위 키 |

Google 보안 비밀번호와 암호화 키는 **Cloudflare Secret에만** 저장하고, `VITE_` 변수나 GitHub에 넣지 마세요. 암호화 키는 안전하게 보관하고 재배포 때 유지합니다. 바꾸면 기존 로그인 세션을 복구할 수 없어 다시 연결해야 합니다. `keep_vars: true`로 대시보드에서 설정한 일반 변수를 후속 CLI 배포에도 유지합니다.

## 5. 실제 연결 확인

새 Workers 주소에서 **Google 계정으로 연결**을 누르고 읽기 권한을 승인합니다. Google Tasks도 필요하면 체크합니다. 이후 새로고침, 탭 닫기, 브라우저 다시 열기 후 일정과 할 일이 자동으로 표시되는지 확인합니다. 공용 기기에서는 **연결 해제**를 사용합니다.

앱 로그인은 최대 30일 유지하며 Google 접근 토큰은 서버에서 자동 갱신합니다. Google OAuth 앱이 **외부·테스트 모드**이면 Calendar/Tasks용 갱신 토큰이 보통 **7일 후 만료**하므로 더 이른 재연결이 필요합니다. 장기 사용에는 Google의 게시 상태와 민감한 권한 검증 요건도 확인해야 합니다. 계정 권한 취소, 쿠키 삭제, 시크릿 모드, 서버 키 변경 시에도 다시 로그인해야 합니다.

Google 일정·Tasks는 다시 조회됩니다. **직접 입력한 브라우저 할 일은 주소별 localStorage에 저장되므로 새 주소로 자동 이동하지 않습니다.** 기존 주소의 설정에서 ‘할 일 백업’을 다운로드하고 새 주소에서 가져오세요. JSON에는 직접 입력한 할 일만 포함하며 로그인 정보와 Google 조회 결과는 포함하지 않습니다.

## 로컬 검증

```sh
npm run build
npm test
npm run test:browser
npm run test:server-browser
npm run db:local
npm run dev:cloudflare
```

마지막 명령은 8787 포트에서 Worker와 D1을 실행합니다. 설정 없이도 `/auth/session`에서 `configured: false` JSON 응답을 확인할 수 있습니다. 실제 로컬 Google 연결은 `.dev.vars.example`을 무시되는 `.dev.vars`로 복사해 설정하고 Google 리디렉션 URI에도 `http://localhost:8787/auth/google/callback`을 추가해야 합니다.

브라우저 자동 검사는 모의 Google 제공자로 인증·서버 토큰 갱신·탭 재접속·로그아웃을 검증합니다. 실제 Google 계정과 Cloudflare 배포 검증을 대신하지 않습니다. Google 토큰은 암호화된 D1 레코드에 저장하고, 브라우저에는 HttpOnly·Secure·SameSite 로그인 쿠키만 전달합니다. 세션 ID는 DB에 해시로 저장합니다.
