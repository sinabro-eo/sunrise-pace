# sunrise-pace

일출·일몰 시각에 맞춰 정상에 도착하도록 출발 시각을 계산하고, 산행 중에는 GPS로 페이스를 판정해 "쉬어도 돼 / 딱 맞아 / 늦어"를 알려주는 웹 시험판.

- 지금 들어 있는 코스: 북한산 도선사 코스 (백운대탐방지원센터 → 백운대), 북악산 창의문 코스 (창의문안내소 → 백악마루)
- 안드로이드 앱: https://github.com/sinabro-eo/sunrise-pace/releases/latest/download/sunrise-pace.apk
  화면을 꺼도 추적하고, 안내는 잠금화면 알림과 진동으로 온다.
- 웹: https://sinabro-eo.github.io/sunrise-pace/ (저장소 Settings → Pages에서 main 브랜치를 켜야 열린다)
  화면을 켜둔 동안만 추적한다.

## 구조

- `js/courses.js` 산·코스 데이터 (경로 좌표, 지점, 표준 시간)
- `js/sun.js` 일출·일몰 계산
- `js/pace.js` 출발 시각 계획과 실시간 페이스 판정
- `js/app.js` 화면
- `test/run.mjs` 계산 점검 (`npm test`)
- `android/` 웹 코드를 감싸는 안드로이드 프로젝트 (Capacitor). `scripts/build-web.mjs`가 웹 파일을 `dist/`에 모으고 앱 전용 연결부(`scripts/native-entry.js`)를 끼워 넣는다.
- `.github/workflows/android.yml` main에 올릴 때마다 APK를 만들어 Releases에 올린다.

`android/app/sunrise-pace.keystore`는 시험용 서명 키다. 같은 키로 서명해야 재설치 없이 업데이트되기 때문에 저장소에 넣어 두었고, 비밀이 아니다. 스토어에 올릴 때는 새 키를 만들어 저장소 밖에 보관해야 한다.

## 데이터 출처

- 경로 좌표: OpenStreetMap 등산로를 BRouter로 이은 선. © OpenStreetMap contributors (ODbL)
- 표준 시간: 서울관광재단 북한산 백운대 코스 안내 (1.9km, 약 1시간 30분)
- 북악산 창의문 코스는 구간만의 공식 시간이 없어, 북한산 코스에서 구한 비율로 추정한다 (`STANDARD_SCALE`)
- 구간별 시간 배분은 거리와 오르막으로 추정한 값이고 실측이 아니다.
