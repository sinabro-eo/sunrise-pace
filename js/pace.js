// 코스 모델, 출발 시각 계획, 실시간 페이스 판정.
// 화면(DOM)과 무관한 순수 계산이라 Node에서 그대로 시험할 수 있다.

const RAD = Math.PI / 180;
const EARTH_R = 6371000;
const M_PER_DEG = EARTH_R * RAD;

export function haversine(a, b) {
  const dLat = (b.lat - a.lat) * RAD;
  const dLon = (b.lon - a.lon) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.sqrt(h));
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// 표준 시간 배분 규칙(나이스미스 계열): 수평 1km에 12분 + 오르막 100m에 10분, 내리막은 100m에 2분.
// 합계는 코스의 공식 표준 시간에 맞춰 다시 비례 조정한다. 즉 이 규칙은 "어느 구간에 시간이 몰리는지"만 정한다.
const SEC_PER_M_FLAT = 0.72;
const SEC_PER_M_UP = 6;
const SEC_PER_M_DOWN = 1.2;

export function buildModel(course) {
  const pts = course.points.map(([lat, lon, ele]) => ({ lat, lon, ele }));
  const lat0 = pts[0].lat;
  const lon0 = pts[0].lon;
  const kx = M_PER_DEG * Math.cos(lat0 * RAD);
  const toXY = (p) => ({ x: (p.lon - lon0) * kx, y: (p.lat - lat0) * M_PER_DEG });
  pts[0].s = 0;
  for (let i = 1; i < pts.length; i++) pts[i].s = pts[i - 1].s + haversine(pts[i - 1], pts[i]);
  for (const p of pts) Object.assign(p, toXY(p));
  const model = { course, pts, toXY, totalDist: pts[pts.length - 1].s };

  if (course.eleFix) {
    const s0 = snap(model, course.eleFix.from.lat, course.eleFix.from.lon).s;
    const { startEle, endEle } = course.eleFix;
    for (const p of pts) {
      if (p.s >= s0) p.ele = startEle + (endEle - startEle) * (p.s - s0) / (model.totalDist - s0);
    }
  }

  const terrain = (course.terrain || []).map((t) => ({ s: snap(model, t.from.lat, t.from.lon).s, factor: t.factor }));
  const factorAt = (s) => terrain.reduce((f, t) => (s >= t.s ? t.factor : f), 1);

  pts[0].t = 0;
  let ascent = 0;
  for (let i = 1; i < pts.length; i++) {
    const d = pts[i].s - pts[i - 1].s;
    const dz = pts[i].ele - pts[i - 1].ele;
    if (dz > 0) ascent += dz;
    const w = d * SEC_PER_M_FLAT + Math.max(dz, 0) * SEC_PER_M_UP + Math.max(-dz, 0) * SEC_PER_M_DOWN;
    pts[i].t = pts[i - 1].t + w * factorAt((pts[i].s + pts[i - 1].s) / 2);
  }
  const scale = (course.standardMinutes * 60) / pts[pts.length - 1].t;
  for (const p of pts) p.t *= scale;
  model.totalSec = course.standardMinutes * 60;
  model.ascent = ascent;

  model.checkpoints = course.checkpoints.map((c) => {
    const hit = snap(model, c.lat, c.lon);
    return { ...c, s: hit.s, t: hit.t };
  });
  model.checkpoints[0].s = 0;
  model.checkpoints[0].t = 0;
  const last = model.checkpoints[model.checkpoints.length - 1];
  last.s = model.totalDist;
  last.t = model.totalSec;
  const lastShelter = model.checkpoints.find((c) => c.lastShelter);
  model.lastShelterS = lastShelter ? lastShelter.s : null;
  const caution = model.checkpoints.find((c) => c.caution);
  model.cautionS = caution ? caution.s : null;
  return model;
}

// 위치를 경로 선 위로 붙인다. hintS가 있으면 그 근처 구간만 본다(지그재그 구간에서 엉뚱한 곳으로 튀지 않게).
export function snap(model, lat, lon, hintS = null, back = 60, fwd = 200) {
  const { pts } = model;
  const { x, y } = model.toXY({ lat, lon });
  let best = null;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    if (hintS != null && (b.s < hintS - back || a.s > hintS + fwd)) continue;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const u = len2 ? clamp(((x - a.x) * dx + (y - a.y) * dy) / len2, 0, 1) : 0;
    const off = Math.hypot(x - a.x - u * dx, y - a.y - u * dy);
    if (!best || off < best.off) {
      best = { off, s: a.s + u * (b.s - a.s), t: (a.t ?? 0) + u * ((b.t ?? 0) - (a.t ?? 0)), i };
    }
  }
  return best;
}

function interp(model, key, value, out) {
  const { pts } = model;
  if (value <= pts[0][key]) return pts[0][out];
  for (let i = 1; i < pts.length; i++) {
    if (value <= pts[i][key]) {
      const a = pts[i - 1];
      const b = pts[i];
      const u = b[key] === a[key] ? 0 : (value - a[key]) / (b[key] - a[key]);
      return a[out] + u * (b[out] - a[out]);
    }
  }
  return pts[pts.length - 1][out];
}
export const tAtS = (model, s) => interp(model, 's', s, 't');
export const sAtT = (model, t) => interp(model, 't', t, 's');
export function posAtS(model, s) {
  return { lat: interp(model, 's', s, 'lat'), lon: interp(model, 's', s, 'lon') };
}

// 계획: 목표 도착 시각에서 거꾸로 계산한 출발 시각과 지점별 통과 시각.
// factor: 내 속도 계수(내 소요 시간 / 표준 시간). restMin: 계획에 넣을 휴식(분).
export function computePlan(model, { targetMs, factor, restMin = 0, entryOpenMs = null }) {
  const moveSec = model.totalSec * factor;
  const restSec = restMin * 60;
  const departMs = targetMs - (moveSec + restSec) * 1000;
  const restCp = restSec > 0
    ? (model.checkpoints.find((c) => c.lastShelter) || model.checkpoints[Math.floor(model.checkpoints.length / 2)])
    : null;
  const build = (startMs) => model.checkpoints.map((c) => {
    const afterRest = restCp && c.s > restCp.s ? restSec : 0;
    return {
      id: c.id,
      name: c.name,
      s: c.s,
      arriveMs: startMs + (c.t * factor + afterRest) * 1000,
      restMin: restCp && c.id === restCp.id ? restMin : 0,
    };
  });
  const plan = { targetMs, departMs, moveSec, restSec, factor, checkpoints: build(departMs), tooEarly: false };
  if (entryOpenMs != null && departMs < entryOpenMs) {
    plan.tooEarly = true;
    plan.entryOpenMs = entryOpenMs;
    plan.earliestArrivalMs = entryOpenMs + (moveSec + restSec) * 1000;
    plan.lateBySec = (plan.earliestArrivalMs - targetMs) / 1000;
  }
  return plan;
}

// 실시간 판정.
// 핵심 값은 slack(여유) = 목표 도착 시각 - 지금 페이스로 예상한 도착 시각.
// 쉬어도 되는 시간 = slack - reserve. reserve는 남은 구간 예측 오차를 대비해 묶어두는 시간으로,
// 초반에는 크게(남은 시간의 15%), 내 실제 속도가 확인될수록 작게(8%) 잡는다.
const AHEAD_SEC = 180;
const BEHIND_SEC = -180;

export class HikeSession {
  constructor(model, { targetMs, paceFactor, startMs }) {
    this.model = model;
    this.targetMs = targetMs;
    this.fPlan = paceFactor;
    this.startMs = startMs;
    this.s = 0;
    this.t = 0;
    this.lastFixMs = null;
    this.movingMs = 0;
    this.stoppedMs = 0;
    this.moving = true;
    this.stoppedSinceMs = null;
    this.history = [];
    this.offCount = 0;
    this.offRoute = false;
    this.acc = null;
    this.finishedMs = null;
    this.markS = 0; // 지금까지 가장 멀리 간 지점과 그 시각(멈춘 시점을 거슬러 찾는 데 쓴다)
    this.markMs = startMs;
    this.status = 'ontime';
    this.restOffer = false;
    this.mustGo = false;
    this.passes = { [model.checkpoints[0].id]: startMs };
  }

  // fix: { lat, lon, acc(m), ms }
  update(fix) {
    if (this.finishedMs) return;
    this.acc = fix.acc;
    if (fix.acc != null && fix.acc > 60) return; // 너무 부정확한 위치는 버린다
    let hit = snap(this.model, fix.lat, fix.lon, this.lastFixMs == null ? null : this.s);
    const tolerance = Math.max(50, (fix.acc || 0) * 2);
    if (!hit || hit.off > tolerance) {
      this.offCount += 1;
      if (this.offCount >= 3) hit = snap(this.model, fix.lat, fix.lon); // 계속 벗어나 있으면 전체 경로에서 다시 찾는다
      this.offRoute = !hit || hit.off > tolerance;
      if (this.offRoute) { this.lastFixMs = this.lastFixMs ?? fix.ms; return; }
    }
    this.offCount = 0;
    this.offRoute = false;

    // GPS 흔들림을 줄이려고 경로상 위치를 완만하게 따라간다
    const s = this.lastFixMs == null ? hit.s : this.s + 0.3 * (hit.s - this.s);
    if (s > this.markS + 8) { this.markS = s; this.markMs = fix.ms; }

    this.history.push({ ms: fix.ms, s });
    while (this.history.length > 2 && fix.ms - this.history[0].ms > 120000) this.history.shift();
    const wasMoving = this.moving;
    const speed = this.recentSpeed();
    // 멈춤 판정: 1분에 3m도 못 나아가면 멈춤, 다시 1분에 6m 이상 나아가면 이동
    if (speed != null) this.moving = wasMoving ? speed >= 0.05 : speed >= 0.1;

    if (this.lastFixMs != null) {
      const dt = clamp(fix.ms - this.lastFixMs, 0, 120000);
      if (wasMoving) this.movingMs += dt; else this.stoppedMs += dt;
    }
    if (wasMoving && !this.moving) {
      // 멈춘 걸 알아채기까지 1~2분 걸린다. 그동안 '이동'으로 센 시간을 '정지'로 되돌린다.
      const lag = Math.min(clamp(fix.ms - this.markMs, 0, 180000), this.movingMs);
      this.movingMs -= lag;
      this.stoppedMs += lag;
      this.stoppedSinceMs = fix.ms - lag;
    }
    if (this.moving) { this.stoppedSinceMs = null; this.mustGo = false; }
    this.lastFixMs = fix.ms;
    this.s = s;
    this.t = tAtS(this.model, s);

    for (const c of this.model.checkpoints) {
      if (this.passes[c.id] == null && this.s >= c.s - 15) this.passes[c.id] = fix.ms;
    }
    const summit = this.model.pts[this.model.pts.length - 1];
    const nearTop = this.s >= this.model.totalDist - 60 && haversine(fix, summit) < 7;
    if (this.s >= this.model.totalDist - 6 || nearTop) {
      this.finishedMs = fix.ms;
      this.passes[this.model.checkpoints[this.model.checkpoints.length - 1].id] = fix.ms;
    }
  }

  // 브라우저가 페이지를 닫았다 다시 열어도 이어갈 수 있게 저장할 값
  snapshot() {
    const { targetMs, fPlan, startMs, s, t, lastFixMs, movingMs, stoppedMs, markS, markMs, finishedMs, passes } = this;
    return { targetMs, fPlan, startMs, s, t, lastFixMs, movingMs, stoppedMs, markS, markMs, finishedMs, passes };
  }
  static restore(model, snapData) {
    const session = new HikeSession(model, { targetMs: snapData.targetMs, paceFactor: snapData.fPlan, startMs: snapData.startMs });
    Object.assign(session, snapData);
    return session;
  }

  // 최근 2분의 진행 속도(m/s). GPS가 제자리에서 흔들리는 것을 걸러내려고
  // 구간의 앞쪽 1/3과 뒤쪽 1/3의 평균 위치를 비교한다.
  recentSpeed() {
    const h = this.history;
    if (h.length < 6 || h[h.length - 1].ms - h[0].ms < 45000) return null;
    const k = Math.max(2, Math.floor(h.length / 3));
    const avg = (arr) => arr.reduce((a, p) => ({ ms: a.ms + p.ms / arr.length, s: a.s + p.s / arr.length }), { ms: 0, s: 0 });
    const a = avg(h.slice(0, k));
    const b = avg(h.slice(-k));
    return (b.s - a.s) / ((b.ms - a.ms) / 1000);
  }

  state(nowMs) {
    const m = this.model;
    const total = m.totalSec;
    const done = this.t;
    const progress = done / total;
    const movingSec = this.movingMs / 1000;
    const fObs = done > 180 && movingSec > 0 ? clamp(movingSec / done, 0.4, 2.5) : null;
    const conf = clamp(done / (0.3 * total), 0, 1);
    const f = fObs == null ? this.fPlan : this.fPlan + (fObs - this.fPlan) * conf;
    const remainSec = (total - done) * f;
    const clock = this.finishedMs ?? nowMs;
    const etaMs = clock + remainSec * 1000;
    const slackSec = (this.targetMs - etaMs) / 1000;
    const reserveSec = this.finishedMs ? 0 : remainSec * (0.15 - 0.07 * conf) + 60;
    const restSec = Math.max(0, slackSec - reserveSec);
    // 쉬는 대신 천천히 걸어서 맞추려면 지금보다 몇 % 느려도 되는지
    const fNeeded = total - done > 60 ? ((this.targetMs - clock) / 1000 - reserveSec) / (total - done) : f;
    const slowPct = fNeeded > f ? Math.round((1 - f / fNeeded) * 100) : 0;

    // 경계에서 문구가 깜빡이지 않게, 들어가는 기준과 나오는 기준을 다르게 둔다
    if (this.status === 'ahead') { if (slackSec < AHEAD_SEC - 60) this.status = 'ontime'; }
    else if (this.status === 'behind') { if (slackSec > BEHIND_SEC + 60) this.status = 'ontime'; }
    if (this.status === 'ontime') {
      if (slackSec >= AHEAD_SEC) this.status = 'ahead';
      else if (slackSec <= BEHIND_SEC) this.status = 'behind';
    }
    const status = this.status;
    if (restSec >= 180) this.restOffer = true;
    else if (restSec < 60) this.restOffer = false;
    if (!this.moving && this.stoppedSinceMs && restSec <= 0) this.mustGo = true;

    const next = m.checkpoints.find((c) => this.passes[c.id] == null) || null;
    const nextRest = m.checkpoints.find((c) => c.rest && c.s > this.s + 15) || null;
    return {
      finished: !!this.finishedMs,
      finishedMs: this.finishedMs,
      status,
      slackSec,
      restSec,
      restOffer: this.restOffer && status === 'ahead',
      slowPct,
      mustGo: this.mustGo,
      etaMs,
      targetMs: this.targetMs,
      progress,
      s: this.s,
      remainDist: m.totalDist - this.s,
      remainSec,
      factorObserved: fObs,
      factorUsed: f,
      moving: this.moving,
      stoppedSec: this.stoppedSinceMs ? (nowMs - this.stoppedSinceMs) / 1000 : 0,
      elapsedSec: (clock - this.startMs) / 1000,
      movingSec,
      offRoute: this.offRoute,
      acc: this.acc,
      next: next ? { ...next, dist: Math.max(0, next.s - this.s) } : null,
      nextRest: nextRest ? { ...nextRest, dist: nextRest.s - this.s } : null,
      pastLastShelter: m.lastShelterS != null && this.s > m.lastShelterS + 30,
      inCaution: m.cautionS != null && this.s >= m.cautionS - 15,
      passes: { ...this.passes },
    };
  }
}

const mins = (sec) => Math.max(0, Math.floor(Math.abs(sec) / 60));

// 화면과 음성에 쓸 문구. key가 바뀔 때만 알림을 울린다.
export function advise(st) {
  if (st.finished) {
    const d = st.slackSec;
    const tail = Math.abs(d) < 60 ? '목표 시각에 딱 맞춰 도착했어.' : d > 0 ? `목표보다 ${mins(d)}분 일찍 도착했어.` : `목표보다 ${mins(d)}분 늦게 도착했어.`;
    return { key: 'finished', headline: '정상 도착', detail: tail };
  }
  if (st.offRoute) return { key: 'offroute', headline: '경로 확인 중', detail: '등산로에서 벗어났거나 GPS가 흔들리고 있어. 페이스 판정을 잠시 멈췄어.' };

  const early = mins(st.slackSec);
  if (!st.moving && st.mustGo) {
    return { key: 'go', headline: '이제 출발', detail: st.status === 'behind' ? `이미 ${early}분 늦는 페이스야.` : '더 쉬면 목표 시각에 못 맞출 수 있어.' };
  }
  if (!st.moving && st.status !== 'behind' && st.restSec >= 30) {
    return { key: 'resting', headline: `쉬는 중 · ${Math.ceil(st.restSec / 60)}분 뒤 출발`, detail: `지금 바로 출발하면 ${early}분 일찍 도착해.` };
  }
  if (st.status === 'ahead') {
    if (st.restOffer) {
      let where = '';
      if (st.pastLastShelter) where = ' 정상은 바람이 세니 올라가기 전에 쉬는 게 나아.';
      else if (st.nextRest && st.nextRest.lastShelter) where = ` ${st.nextRest.name}이 정상 전 마지막으로 쉬기 좋은 곳이야(${Math.round(st.nextRest.dist)}m 앞).`;
      else if (st.nextRest) where = ` 다음 쉴 곳은 ${st.nextRest.name}(${Math.round(st.nextRest.dist)}m 앞).`;
      const slow = st.slowPct >= 5 ? ` 쉬지 않고 지금보다 ${st.slowPct}% 느리게 걸어도 맞아.` : '';
      return { key: 'ahead-rest', headline: `${early}분 빠름 · ${mins(st.restSec)}분 쉬어도 돼`, detail: `이 페이스면 목표보다 ${early}분 일찍 도착해.${slow}${where}` };
    }
    return { key: 'ahead', headline: `${early}분 빠름`, detail: '조금 천천히 가도 돼. 쉴 만큼의 여유는 아니야.' };
  }
  if (st.status === 'behind') {
    const late = mins(st.slackSec);
    if (st.inCaution) return { key: 'behind-caution', headline: `${late}분 늦는 페이스`, detail: '암릉 구간이야. 시간을 맞추려고 서두르지 말고 안전하게 올라가.' };
    return { key: 'behind', headline: `${late}분 늦는 페이스`, detail: `이대로면 목표보다 ${late}분 늦게 도착해. 쉬는 시간을 줄이거나 속도를 조금 올려야 맞출 수 있어.` };
  }
  return { key: 'ontime', headline: '딱 맞는 페이스', detail: '지금 속도를 유지하면 돼.' };
}

// 가상 등산객. 시험과 화면의 "가상 산행"에서 같이 쓴다.
// trueFactor: 실제 속도 계수. followAdvice: 앱이 쉬라고 하면 쉴 곳에서 쉰다.
export class SimHiker {
  constructor(model, { trueFactor, startMs, followAdvice = true, noise = 5, seed = 7 }) {
    this.model = model;
    this.f = trueFactor;
    this.ms = startMs;
    this.t = 0; // 표준 시간 축에서의 진행(초)
    this.followAdvice = followAdvice;
    this.noise = noise;
    this.seed = seed;
    this.resting = false;
    this.restedSec = 0;
  }
  rand() { // 재현 가능한 난수
    this.seed = (this.seed * 1664525 + 1013904223) % 4294967296;
    return this.seed / 4294967296;
  }
  gauss() { return Math.sqrt(-2 * Math.log(this.rand() + 1e-12)) * Math.cos(2 * Math.PI * this.rand()); }

  // dtSec만큼 시간을 보내고 그 시점의 GPS 위치를 돌려준다. st: 직전 판정 결과.
  step(dtSec, st) {
    const m = this.model;
    const s = sAtT(m, this.t);
    if (this.followAdvice && st && !st.finished) {
      const atRestSpot = m.checkpoints.some((c) => c.rest && Math.abs(c.s - s) < 12);
      if (!this.resting && atRestSpot && st.restOffer) this.resting = true;
      else if (this.resting && (st.mustGo || st.restSec < 20)) this.resting = false;
    }
    if (this.resting) this.restedSec += dtSec;
    else this.t = Math.min(m.totalSec, this.t + dtSec / this.f);
    this.ms += dtSec * 1000;
    const p = posAtS(m, sAtT(m, this.t));
    const dLat = (this.gauss() * this.noise) / M_PER_DEG;
    const dLon = (this.gauss() * this.noise) / (M_PER_DEG * Math.cos(p.lat * RAD));
    return { lat: p.lat + dLat, lon: p.lon + dLon, acc: this.noise * 1.5 + 3, ms: this.ms };
  }
  get arrived() { return this.t >= this.model.totalSec; }
}
