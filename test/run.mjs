// node test/run.mjs — 계산 로직 점검
import { MOUNTAINS } from '../js/courses.js';
import { sunTimes } from '../js/sun.js';
import { buildModel, computePlan, HikeSession, SimHiker, advise, snap, STANDARD_SCALE } from '../js/pace.js';

let failed = 0;
const check = (name, ok, info = '') => {
  if (!ok) failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`);
};
const kst = (ms) => new Date(ms + 9 * 3600000).toISOString().slice(11, 16);
const course = MOUNTAINS[0].courses[0];
const model = buildModel(course);
const defaultModel = model;

// 1) 경로 데이터 옮겨 적기 오류 점검: 원본(BRouter)에서 받은 누적 거리와 비교
const srcCum = [0, 26, 41, 54, 144, 161, 189, 201, 210, 247, 266, 293, 312, 329, 354, 440, 480, 493, 505, 516, 538, 569, 602, 626, 629, 666, 678, 689, 747, 766, 814, 852, 903, 927, 941, 953, 968, 1003, 1016, 1053, 1067, 1097, 1112, 1200, 1242, 1272, 1289, 1309, 1348, 1374, 1401, 1424, 1435, 1452, 1463, 1477, 1479, 1490, 1503, 1515, 1541, 1576, 1604, 1629, 1642, 1665, 1696, 1706, 1713, 1730, 1742, 1766, 1816, 1829, 1862, 1898, 1916, 1928, 1940];
check('경로 점 개수', model.pts.length === srcCum.length, `${model.pts.length}개`);
// 좌표를 줄여 옮겼으므로 구간 직선거리는 원본 구간 길이보다 조금 짧을 수는 있어도 길 수는 없다
let worst = 0;
let over = 0;
for (let i = 1; i < model.pts.length; i++) {
  const mine = model.pts[i].s - model.pts[i - 1].s;
  const src = srcCum[i] - srcCum[i - 1];
  worst = Math.max(worst, src - mine);
  over = Math.max(over, mine - src);
}
check('구간 길이가 원본과 일치(짧게 6m, 길게 1.5m 이내)', worst <= 6 && over <= 1.5, `최대 -${worst.toFixed(1)}m / +${over.toFixed(1)}m, 총 ${model.totalDist.toFixed(0)}m (원본 1940m)`);
check('총 거리가 공식 1.9km와 맞음', Math.abs(model.totalDist - 1900) < 80);
check('정상 고도 보정', Math.abs(model.pts.at(-1).ele - 836) < 1, `누적 오르막 ${model.ascent.toFixed(0)}m`);

console.log('\n지점별 표준 통과 시간(표준 90분 기준)');
for (const c of model.checkpoints) console.log(`  ${c.name.padEnd(10)} ${String(Math.round(c.s)).padStart(5)}m  ${(c.t / 60).toFixed(1).padStart(5)}분`);
const ammun = model.checkpoints.find((c) => c.id === 'ammun');
const lastLeg = (model.totalSec - ammun.t) / 60;
check('암문→정상 구간이 "20여 분" 안내와 비슷', lastLeg > 17 && lastLeg < 27, `${lastLeg.toFixed(1)}분`);

// 2) 일출·일몰: 서울 기준 알려진 값과 비교(±2분)
const near = (ms, hhmm, tol = 2) => {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date(ms + 9 * 3600000);
  return Math.abs(d.getUTCHours() * 60 + d.getUTCMinutes() + d.getUTCSeconds() / 60 - (h * 60 + m)) <= tol;
};
const seoul = [37.5665, 126.978];
const jan = sunTimes(2026, 1, 1, ...seoul);
const jun = sunTimes(2026, 6, 21, ...seoul);
check('서울 1월 1일 일출 07:47', near(jan.sunrise, '07:47'), kst(jan.sunrise));
check('서울 1월 1일 일몰 17:24', near(jan.sunset, '17:24'), kst(jan.sunset));
check('서울 6월 21일 일출 05:11', near(jun.sunrise, '05:11'), kst(jun.sunrise));
check('서울 6월 21일 일몰 19:57', near(jun.sunset, '19:57'), kst(jun.sunset));
const nov = sunTimes(2026, 11, 14, course.summit.lat, course.summit.lon, course.summit.ele);
console.log(`  백운대 2026-11-14: 여명 ${kst(nov.dawn)}, 일출 ${kst(nov.sunrise)} (고도 반영 최대 ${kst(nov.sunriseEarliest)}), 일몰 ${kst(nov.sunset)}`);

// 3) 계획
const target = nov.sunrise - 15 * 60000;
const plan = computePlan(model, { targetMs: target, factor: 1, restMin: 0, entryOpenMs: Date.UTC(2026, 10, 13, 19, 0) });
check('출발 시각 = 목표 - 90분', plan.departMs === target - 90 * 60000, `출발 ${kst(plan.departMs)} → 목표 ${kst(target)}`);
const planRest = computePlan(model, { targetMs: target, factor: 0.8, restMin: 10 });
check('휴식 10분·계수 0.8 계획', Math.abs((target - planRest.departMs) / 60000 - 82) < 0.01 && Math.abs(planRest.checkpoints.at(-1).arriveMs - target) < 1000);
const summer = sunTimes(2026, 6, 21, course.summit.lat, course.summit.lon);
const sp = computePlan(model, { targetMs: summer.sunrise - 15 * 60000, factor: 1, entryOpenMs: Date.UTC(2026, 5, 20, 19, 0) });
check('하지 일출은 입산 04:00 제한에 걸림', sp.tooEarly && sp.lateBySec > 0, `필요 출발 ${kst(sp.departMs)}, 04:00 출발 시 ${Math.round(sp.lateBySec / 60)}분 늦음`);

// 4) 가상 산행
function run({ trueFactor, planFactor, followAdvice, restMin = 0, label, model: useModel }) {
  const model = useModel || defaultModel;
  const p = computePlan(model, { targetMs: target, factor: planFactor, restMin });
  const session = new HikeSession(model, { targetMs: target, paceFactor: planFactor, startMs: p.departMs });
  const hiker = new SimHiker(model, { trueFactor, startMs: p.departMs, followAdvice });
  let st = session.state(p.departMs);
  const log = [];
  let lastKey = '';
  let firstBehind = null;
  let guard = 0;
  let arriveMs = null;
  while (guard++ < 5000) {
    const fix = hiker.step(5, st);
    session.update(fix);
    st = session.state(fix.ms);
    const a = advise(st);
    if (a.key !== lastKey) { log.push(`    ${kst(fix.ms)} ${(st.progress * 100).toFixed(0).padStart(3)}%  ${a.headline}`); lastKey = a.key; }
    if (st.status === 'behind' && firstBehind == null) firstBehind = st.progress;
    if (hiker.arrived && arriveMs == null) arriveMs = fix.ms;
    if (arriveMs != null && (st.finished || fix.ms - arriveMs > 90000)) break;
  }
  const diffMin = (target - arriveMs) / 60000;
  const detectLag = st.finished ? (st.finishedMs - arriveMs) / 1000 : null;
  console.log(`\n${label}\n${log.join('\n')}\n    → 실제 도착 ${kst(arriveMs)} (목표 ${kst(target)}, ${diffMin >= 0 ? diffMin.toFixed(1) + '분 일찍' : (-diffMin).toFixed(1) + '분 늦게'}), 쉰 시간 ${(hiker.restedSec / 60).toFixed(1)}분, 알림 ${log.length}회, 도착 감지 오차 ${detectLag == null ? '미감지' : detectLag.toFixed(0) + '초'}`);
  return { diffMin, st, firstBehind, rested: hiker.restedSec / 60, finished: st.finished && Math.abs(detectLag) <= 90, alerts: log.length };
}

const base = run({ trueFactor: 0.75, planFactor: 1, followAdvice: false, label: '[A] 계획보다 25% 빠른 사람, 안내 무시(지금까지의 상황)' });
check('A: 안내 없이는 20분 넘게 일찍 도착', base.finished && base.diffMin > 20, `${base.diffMin.toFixed(1)}분`);
const guided = run({ trueFactor: 0.75, planFactor: 1, followAdvice: true, label: '[B] 같은 사람, 앱이 쉬라고 할 때 쉼' });
check('B: 안내대로 쉬면 목표 0~6분 전 도착', guided.finished && guided.diffMin >= 0 && guided.diffMin <= 6, `${guided.diffMin.toFixed(1)}분 일찍`);
const onpace = run({ trueFactor: 1, planFactor: 1, followAdvice: true, restMin: 10, label: '[C] 계획대로 걷는 사람, 휴식 10분 포함 계획' });
check('C: 계획 휴식을 쓰고 목표 0~5분 전 도착', onpace.finished && onpace.diffMin >= 0 && onpace.diffMin <= 5, `${onpace.diffMin.toFixed(1)}분 일찍, 쉰 시간 ${onpace.rested.toFixed(1)}분`);
const slow = run({ trueFactor: 1.25, planFactor: 1, followAdvice: true, label: '[D] 계획보다 25% 느린 사람' });
check('D: 늦는 페이스를 코스 절반 전에 알림', slow.firstBehind != null && slow.firstBehind < 0.5, `진행 ${(slow.firstBehind * 100).toFixed(0)}% 지점`);
check('D: 늦을 때는 쉬라고 하지 않음', slow.rested < 1);
check('알림이 깜빡이지 않음(산행당 12회 이하)', [base, guided, onpace, slow].every((r) => r.alerts <= 12), [base, guided, onpace, slow].map((r) => r.alerts).join(', '));

// 5) 경로 붙이기: 정상 부근 지그재그에서 엉뚱한 구간으로 튀지 않는지
const pk = model.pts[model.pts.length - 4];
const hit = snap(model, pk.lat, pk.lon, pk.s - 5);
check('정상부 위치 붙이기', Math.abs(hit.s - pk.s) < 3, `오차 ${Math.abs(hit.s - pk.s).toFixed(1)}m`);


// 6) 북악산 창의문 코스
const bugak = MOUNTAINS.find((m) => m.id === 'bugaksan').courses[0];
const bm = buildModel(bugak);
check('보정값이 북한산 공식 시간에서 나온 값과 일치', Math.abs(model.rawScale - STANDARD_SCALE) / STANDARD_SCALE < 0.005, `북한산 ${model.rawScale.toFixed(4)} vs ${STANDARD_SCALE}`);
const bSrc = [0, 5, 11, 27, 102, 177, 246, 257, 311, 361, 402, 430, 439, 457, 506, 526, 536, 562, 624, 647, 653, 690, 698, 726, 740, 749, 757, 778, 796];
let bShort = 0;
let bOver = 0;
check('북악산 경로 점 개수', bm.pts.length === bSrc.length, `${bm.pts.length}개`);
for (let i = 1; i < bm.pts.length; i++) {
  const mine = bm.pts[i].s - bm.pts[i - 1].s;
  const src = bSrc[i] - bSrc[i - 1];
  bShort = Math.max(bShort, src - mine);
  bOver = Math.max(bOver, mine - src);
}
check('북악산 구간 길이가 원본과 일치', bShort <= 6 && bOver <= 1.5, `최대 -${bShort.toFixed(1)}m / +${bOver.toFixed(1)}m, 총 ${bm.totalDist.toFixed(0)}m (원본 796m)`);
check('북악산 정상 고도 342m, 표준 시간 30~40분', Math.abs(bm.pts.at(-1).ele - 342) < 1 && bm.standardMinutes >= 30 && bm.standardMinutes <= 40, `표준 ${bm.standardMinutes}분, 오르막 ${bm.ascent.toFixed(0)}m`);
const bPlan = computePlan(bm, { targetMs: target, factor: 1, restMin: 0, entryOpenMs: null });
check('북악산은 입산 시간 제한 없이 계획', !bPlan.tooEarly && bPlan.departMs === target - bm.standardMinutes * 60000, `출발 ${kst(bPlan.departMs)}`);
const bA = run({ model: bm, trueFactor: 0.75, planFactor: 1, followAdvice: false, label: '[북악산 A] 계획보다 25% 빠른 사람, 안내 무시' });
const bB = run({ model: bm, trueFactor: 0.75, planFactor: 1, followAdvice: true, label: '[북악산 B] 같은 사람, 안내대로 쉼' });
check('북악산 B: 안내대로 쉬면 안내 없을 때보다 덜 일찍, 늦지는 않게 도착', bB.finished && bB.diffMin >= 0 && bB.diffMin < bA.diffMin, `안내 없이 ${bA.diffMin.toFixed(1)}분 일찍 → 안내대로 ${bB.diffMin.toFixed(1)}분 일찍`);
const bD = run({ model: bm, trueFactor: 1.25, planFactor: 1, followAdvice: true, label: '[북악산 D] 계획보다 25% 느린 사람' });
check('북악산 D: 늦는 페이스를 도착 전에 알림', bD.firstBehind != null && bD.firstBehind < 0.8, bD.firstBehind == null ? '알림 없음' : `진행 ${(bD.firstBehind * 100).toFixed(0)}% 지점`);

console.log(failed ? `\n${failed}개 실패` : '\n전부 통과');
process.exit(failed ? 1 : 0);
