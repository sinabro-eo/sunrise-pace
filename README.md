# sunrise-pace

일출·일몰 시각에 맞춰 정상에 도착하도록 출발 시각을 계산하고, 산행 중에는 GPS로 페이스를 판정해 "쉬어도 돼 / 딱 맞아 / 늦어"를 알려주는 웹 시험판.

- 폰에서 열기: https://sinabro-eo.github.io/sunrise-pace/ (저장소 Settings → Pages에서 main 브랜치를 켜야 열린다)
- 지금 들어 있는 코스: 북한산 도선사 코스 (백운대탐방지원센터 → 백운대)
- 화면을 켜둔 동안만 추적한다. 주머니에 넣을 때는 "화면 어둡게"를 쓴다.

## 구조

- `js/courses.js` 산·코스 데이터 (경로 좌표, 지점, 표준 시간)
- `js/sun.js` 일출·일몰 계산
- `js/pace.js` 출발 시각 계획과 실시간 페이스 판정
- `js/app.js` 화면
- `test/run.mjs` 계산 점검 (`node test/run.mjs`)

## 데이터 출처

- 경로 좌표: OpenStreetMap 등산로를 BRouter로 이은 선. © OpenStreetMap contributors (ODbL)
- 표준 시간: 서울관광재단 북한산 백운대 코스 안내 (1.9km, 약 1시간 30분)
- 구간별 시간 배분은 거리와 오르막으로 추정한 값이고 실측이 아니다.
