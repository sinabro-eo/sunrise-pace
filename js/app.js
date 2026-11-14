import { MOUNTAINS, findCourse } from './courses.js';
import { sunTimes } from './sun.js';
import { buildModel, computePlan, HikeSession, SimHiker, advise } from './pace.js';

const $ = (id) => document.getElementById(id);
const KST = 9 * 3600000;
const hhmm = (ms) => new Date(ms + KST).toISOString().slice(11, 16);
const dur = (sec) => {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${String(m).padStart(2, '0')}` : `${m}:${String(s % 60).padStart(2, '0')}`;
};
// 안드로이드 앱(APK) 안에서만 존재한다. 있으면 화면이 꺼져도 도는 추적과 잠금화면 알림을 쓴다.
const native = window.NativeBridge || null;
const store = {
  get(key, fallback) { try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); } catch { return fallback; } },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* 저장 불가 환경이면 그냥 넘어간다 */ } },
  del(key) { try { localStorage.removeItem(key); } catch { /* 무시 */ } },
};

// ---------- 계획 화면 ----------
const saved = store.get('settings', {});
const tomorrow = new Date(Date.now() + KST + 86400000).toISOString().slice(0, 10);
const settings = {
  mountainId: saved.mountainId || 'bukhansan',
  courseId: saved.courseId || null,
  date: tomorrow,
  targetType: saved.targetType || 'sunrise',
  customTime: saved.customTime || '09:00',
  bufferMin: saved.bufferMin ?? 15,
  restMin: saved.restMin ?? 0,
  factor: saved.factor || 1, // 내 속도 계수 = 내 소요 시간 / 표준 시간
};
let model = null;
let plan = null;

function fillMountains() {
  $('mountain').innerHTML = MOUNTAINS.map((m) => `<option value="${m.id}" ${m.courses.length ? '' : 'disabled'}>${m.name}${m.courses.length ? '' : ' (준비 중)'}</option>`).join('');
  $('mountain').value = settings.mountainId;
  fillCourses();
}
function fillCourses() {
  const mountain = MOUNTAINS.find((m) => m.id === settings.mountainId) || MOUNTAINS[0];
  $('course').innerHTML = mountain.courses.map((c) => `<option value="${c.id}">${c.name}</option>`).join('');
  if (!mountain.courses.some((c) => c.id === settings.courseId)) settings.courseId = mountain.courses[0]?.id || null;
  $('course').value = settings.courseId;
  model = settings.courseId ? buildModel(findCourse(settings.courseId).course) : null;
  $('myMinutes').value = model ? Math.round(model.course.standardMinutes * settings.factor) : '';
}

function targetInfo() {
  const [y, mo, d] = settings.date.split('-').map(Number);
  const { summit } = model.course;
  const sun = sunTimes(y, mo, d, summit.lat, summit.lon, summit.ele);
  let eventMs;
  let label;
  if (settings.targetType === 'sunrise') { eventMs = sun.sunrise; label = '일출'; }
  else if (settings.targetType === 'sunset') { eventMs = sun.sunset; label = '일몰'; }
  else {
    const [h, mi] = settings.customTime.split(':').map(Number);
    eventMs = Date.UTC(y, mo - 1, d, h, mi) - KST;
    label = '도착 목표';
  }
  const [oh, om] = (model.course.entry?.open || '00:00').split(':').map(Number);
  const entryOpenMs = model.course.entry ? Date.UTC(y, mo - 1, d, oh, om) - KST : null;
  return { sun, eventMs, label, entryOpenMs, targetMs: eventMs - settings.bufferMin * 60000 };
}

function renderPlan() {
  store.set('settings', { ...settings, date: undefined });
  for (const b of $('targetType').children) b.setAttribute('aria-checked', String(b.dataset.v === settings.targetType));
  $('customWrap').hidden = settings.targetType !== 'custom';
  if (!model) return;
  const { course } = model;
  const info = targetInfo();
  plan = computePlan(model, { targetMs: info.targetMs, factor: settings.factor, restMin: settings.restMin, entryOpenMs: info.entryOpenMs });
  plan.info = info;

  $('departWhere').textContent = `· ${model.checkpoints[0].name}`;
  $('departTime').textContent = hhmm(plan.departMs);
  const buffer = settings.bufferMin ? ` ${settings.bufferMin}분 전` : '';
  $('targetLine').textContent = settings.targetType === 'custom'
    ? `정상 도착 ${hhmm(plan.targetMs)}${settings.bufferMin ? ` (목표 ${hhmm(info.eventMs)}${buffer})` : ''} · 등산 ${Math.round(plan.moveSec / 60)}분${settings.restMin ? ` + 휴식 ${settings.restMin}분` : ''}`
    : `정상 도착 ${hhmm(plan.targetMs)} (${info.label} ${hhmm(info.eventMs)}${buffer}) · 등산 ${Math.round(plan.moveSec / 60)}분${settings.restMin ? ` + 휴식 ${settings.restMin}분` : ''}`;
  const early = Math.round((info.sun.sunrise - info.sun.sunriseEarliest) / 60000);
  $('sunLine').textContent = settings.targetType === 'sunset'
    ? `일몰 ${hhmm(info.sun.sunset)} · 완전히 어두워지는 시각 ${hhmm(info.sun.dusk)}쯤. 하산은 헤드랜턴이 필요해.`
    : `여명 ${hhmm(info.sun.dawn)} · 일출 ${hhmm(info.sun.sunrise)}. 정상은 높아서 지형에 따라 최대 ${early}분쯤 일찍 보일 수 있어.`;

  const warn = [];
  if (plan.tooEarly) warn.push(`입산은 ${course.entry.open}부터라 이 출발 시각은 불가능해. ${course.entry.open}에 출발하면 정상 도착은 ${hhmm(plan.earliestArrivalMs)}, 목표보다 ${Math.ceil(plan.lateBySec / 60)}분 늦어.`);
  if (plan.departMs < Date.now() && plan.targetMs > Date.now()) warn.push('계획한 출발 시각이 이미 지났어. 지금 출발하면 늦는 페이스로 시작해.');
  if (plan.targetMs < Date.now()) warn.push('목표 시각이 이미 지난 날짜야.');
  $('warn').hidden = !warn.length;
  $('warn').textContent = warn.join(' ');

  $('planCps').innerHTML = plan.checkpoints.map((c) => `<li><span class="n">${c.name}${c.restMin ? ` · 휴식 ${c.restMin}분` : ''}</span><span class="t">${hhmm(c.arriveMs)}</span><span class="x">${(c.s / 1000).toFixed(2)}km</span></li>`).join('');
  const pct = Math.round(settings.factor * 100);
  $('paceHint').textContent = `표준 ${course.standardMinutes}분 기준 ${pct}% 속도로 계산해. 한 번 다녀오면 실제 기록으로 자동 보정할 수 있어.`;
  $('courseSource').textContent = `표준 시간 출처: ${course.standardSource}. ${course.entry ? course.entry.note + '.' : ''} 방문 전 국립공원공단 공지를 확인해.`;
  $('resumeBtn').hidden = !store.get('active', null);
}

function bindPlan() {
  $('mountain').addEventListener('change', (e) => { settings.mountainId = e.target.value; fillCourses(); renderPlan(); });
  $('course').addEventListener('change', (e) => { settings.courseId = e.target.value; fillCourses(); renderPlan(); });
  $('date').value = settings.date;
  $('date').addEventListener('change', (e) => { if (e.target.value) { settings.date = e.target.value; renderPlan(); } });
  $('targetType').addEventListener('click', (e) => {
    const v = e.target.closest('button')?.dataset.v;
    if (v) { settings.targetType = v; renderPlan(); }
  });
  $('customTime').value = settings.customTime;
  $('customTime').addEventListener('change', (e) => { if (e.target.value) { settings.customTime = e.target.value; renderPlan(); } });
  $('buffer').value = String(settings.bufferMin);
  $('buffer').addEventListener('change', (e) => { settings.bufferMin = Number(e.target.value); renderPlan(); });
  $('rest').value = String(settings.restMin);
  $('rest').addEventListener('change', (e) => { settings.restMin = Number(e.target.value); renderPlan(); });
  $('myMinutes').addEventListener('change', (e) => {
    const v = Number(e.target.value);
    if (model && v >= 20 && v <= 600) { settings.factor = v / model.course.standardMinutes; renderPlan(); }
  });
  $('startBtn').addEventListener('click', () => startHike({ sim: false }));
  $('simBtn').addEventListener('click', () => { $('simOpts').hidden = !$('simOpts').hidden; });
  $('simGo').addEventListener('click', () => startHike({ sim: true }));
  $('resumeBtn').addEventListener('click', resumeHike);
}

// ---------- 산행 화면 ----------
const SIM_SPEED = 40;
let hike = null; // { session, sim, hiker, watchId, timer, lastKey, lastAlertMs, voice, state, planCps }
let wakeLock = null;

async function keepAwake() {
  try { if ('wakeLock' in navigator && !wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); } } catch { /* 지원 안 되면 화면이 꺼질 수 있다 */ }
}
document.addEventListener('visibilitychange', () => { if (hike && document.visibilityState === 'visible') keepAwake(); });

function show(view) {
  for (const id of ['planView', 'hikeView', 'doneView']) $(id).hidden = id !== view;
  window.scrollTo(0, 0);
}

function startHike({ sim }) {
  if (!model || !plan) return;
  if (!sim && !native && !('geolocation' in navigator)) { alertBox('이 브라우저는 위치 추적을 지원하지 않아.'); return; }
  const startMs = sim ? plan.departMs : Date.now();
  const session = new HikeSession(model, { targetMs: plan.targetMs, paceFactor: settings.factor, startMs });
  hike = { session, sim, lastKey: '', lastAlertMs: 0, voice: false, planCps: plan.checkpoints, simNow: startMs, courseId: settings.courseId };
  if (sim) {
    hike.hiker = new SimHiker(model, { trueFactor: settings.factor * Number($('simSpeed').value), startMs, followAdvice: $('simFollow').checked });
  }
  beginTracking();
}

function resumeHike() {
  const active = store.get('active', null);
  const found = active && findCourse(active.courseId);
  if (!found) { store.del('active'); renderPlan(); return; }
  model = buildModel(found.course);
  const session = HikeSession.restore(model, active.snapshot);
  hike = { session, sim: false, lastKey: '', lastAlertMs: 0, voice: false, planCps: active.planCps, courseId: active.courseId };
  beginTracking();
}

function beginTracking() {
  $('hikeCourse').textContent = model.course.short;
  $('simBadge').hidden = !hike.sim;
  $('barTicks').innerHTML = model.checkpoints.slice(1, -1).map((c) => `<i style="left:${(c.t / model.totalSec) * 100}%"></i>`).join('');
  $('voiceBtn').textContent = '음성 안내 켜기';
  $('arriveBtn').hidden = hike.sim;
  $('voiceBtn').hidden = hike.sim || !('speechSynthesis' in window);
  $('dimBtn').hidden = hike.sim || !!native; // 앱에서는 그냥 화면을 끄면 된다
  show('hikeView');
  if (!hike.sim && native) {
    startNativeWatch();
  } else if (!hike.sim) {
    keepAwake();
    hike.watchId = navigator.geolocation.watchPosition(onFix, onGeoError, { enableHighAccuracy: true, maximumAge: 2000, timeout: 30000 });
  }
  hike.timer = setInterval(tick, 1000);
  tick();
}

// 앱: 백그라운드 위치 서비스로 추적한다. 화면을 꺼도 위치가 계속 들어온다.
async function startNativeWatch() {
  const current = hike;
  try {
    await native.notifications.requestPermissions();
    await native.notifications.createChannel({ id: 'pace', name: '페이스 안내', description: '쉬어도 될 때, 출발할 때, 늦을 때 알림', importance: 4, vibration: true, visibility: 1 });
  } catch { /* 알림을 못 써도 추적은 계속한다 */ }
  if (hike !== current) return;
  try {
    const id = await native.geo.addWatcher(
      { backgroundTitle: '산행 페이스 추적 중', backgroundMessage: '화면을 꺼도 페이스를 계속 확인하고 있어.', requestPermissions: true, stale: false, distanceFilter: 0 },
      (loc, err) => {
        if (hike !== current) return;
        if (err || !loc) {
          hike.geoError = err && err.code === 'NOT_AUTHORIZED' ? '위치 권한이 꺼져 있어. 설정에서 이 앱의 위치 사용을 허용해줘.' : 'GPS 신호를 못 잡고 있어. 하늘이 트인 곳에서 잠시 기다려줘.';
          return;
        }
        hike.geoError = null;
        hike.session.update({ lat: loc.latitude, lon: loc.longitude, acc: loc.accuracy, ms: loc.time || Date.now() });
        // 화면이 꺼지면 타이머가 느려지므로, 위치가 들어올 때마다 직접 판정한다
        if (Date.now() - (hike.pulseMs || 0) >= 3000) { hike.pulseMs = Date.now(); tick(); }
      },
    );
    if (hike === current) hike.nativeWatchId = id; else native.geo.removeWatcher({ id });
  } catch {
    if (hike === current) hike.geoError = '위치 추적을 시작하지 못했어. 위치 권한을 확인해줘.';
  }
}

function onFix(pos) {
  if (!hike) return;
  hike.geoError = null;
  hike.session.update({ lat: pos.coords.latitude, lon: pos.coords.longitude, acc: pos.coords.accuracy, ms: pos.timestamp || Date.now() });
}
function onGeoError(err) {
  if (!hike) return;
  hike.geoError = err.code === 1 ? '위치 권한이 꺼져 있어. 브라우저 설정에서 이 사이트의 위치 사용을 허용해줘.' : 'GPS 신호를 못 잡고 있어. 하늘이 트인 곳에서 잠시 기다려줘.';
}

function tick() {
  if (!hike) return;
  let now = Date.now();
  if (hike.sim) {
    for (let i = 0; i < SIM_SPEED / 5 && !hike.session.finishedMs; i++) {
      const fix = hike.hiker.step(5, hike.state);
      hike.session.update(fix);
      hike.state = hike.session.state(fix.ms);
      hike.simNow = fix.ms;
      notify(advise(hike.state));
    }
    now = hike.simNow;
  }
  const st = hike.session.state(now);
  hike.state = st;
  const waiting = !hike.sim && hike.session.lastFixMs == null;
  const advice = waiting
    ? { key: 'waiting', headline: 'GPS 신호 기다리는 중', detail: hike.geoError || '등산로 입구에서 잠시만 기다려줘.' }
    : advise(st);
  if (!waiting) notify(advice);
  renderHike(st, advice, now, waiting);
  if (!hike.sim && now - (hike.savedMs || 0) > 15000) {
    hike.savedMs = now;
    store.set('active', { courseId: hike.courseId, snapshot: hike.session.snapshot(), planCps: hike.planCps });
  }
  if (st.finished) finishHike(st);
}

function notify(advice) {
  if (advice.key === hike.lastKey) return;
  const first = hike.lastKey === '';
  hike.lastKey = advice.key;
  if (first && advice.key === 'ontime') return;
  if (hike.sim) return; // 가상 산행은 화면으로만 보여준다
  const urgent = advice.key === 'go' || advice.key === 'finished';
  if (!urgent && Date.now() - hike.lastAlertMs < 20000) return;
  hike.lastAlertMs = Date.now();
  if (native) {
    // 같은 번호로 올리면 이전 알림을 덮어써서, 잠금화면에는 항상 최신 안내 하나만 남는다
    native.notifications.schedule({ notifications: [{ id: 1, title: advice.headline, body: advice.detail, channelId: 'pace', smallIcon: 'ic_stat_pace' }] }).catch(() => {});
  } else {
    try { navigator.vibrate?.(urgent ? [400, 150, 400, 150, 400] : [200, 100, 200]); } catch { /* 진동 미지원 */ }
  }
  if (hike.voice && 'speechSynthesis' in window) {
    const u = new SpeechSynthesisUtterance(`${advice.headline}. ${advice.detail}`);
    u.lang = 'ko-KR';
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  }
}

function cpRows(st, planCps) {
  const nextId = st.next?.id;
  return planCps.map((c) => {
    const actual = st.passes[c.id];
    let extra = '';
    if (actual != null && c.id !== planCps[0].id) {
      const diff = Math.round((actual - c.arriveMs) / 60000);
      extra = diff === 0 ? '계획대로' : diff < 0 ? `${-diff}분 빠름` : `${diff}분 늦음`;
    }
    const cls = actual != null ? 'passed' : c.id === nextId ? 'nextUp' : '';
    return `<li class="${cls}"><span class="n">${c.name}</span><span class="t">${hhmm(actual ?? c.arriveMs)}</span><span class="x">${actual != null ? extra : '계획'}</span></li>`;
  }).join('');
}

function renderHike(st, advice, now, waiting) {
  $('headline').textContent = advice.headline;
  $('detail').textContent = advice.detail;
  $('statusBox').className = `status ${waiting || st.offRoute ? '' : st.status}`;
  $('barFill').style.width = `${Math.min(100, st.progress * 100)}%`;
  $('nextLine').textContent = st.next ? `다음 ${st.next.name} · ${Math.round(st.next.dist)}m 남음` : '';
  $('eta').textContent = waiting ? '--:--' : hhmm(st.etaMs);
  $('target').textContent = hhmm(st.targetMs);
  $('elapsed').textContent = dur(st.elapsedSec);
  $('remain').textContent = st.remainDist >= 1000 ? `${(st.remainDist / 1000).toFixed(2)}km` : `${Math.round(st.remainDist)}m`;
  $('liveCps').innerHTML = cpRows(st, hike.planCps);
  const used = Math.round(st.factorUsed * 100);
  $('gps').textContent = hike.sim
    ? `가상 산행 ${SIM_SPEED}배속 · 지금 시각 ${hhmm(now)} · 판정에 쓰는 속도 ${used}%`
    : hike.geoError || (st.acc == null ? '' : `GPS 오차 ±${Math.round(st.acc)}m · 판정에 쓰는 속도 표준의 ${used}%${native ? ' · 화면을 꺼도 추적돼' : wakeLock ? '' : ' · 화면이 꺼지면 추적이 멈춰'}`);
  if (!$('dim').hidden) {
    $('dimHeadline').textContent = advice.headline;
    $('dimClock').textContent = `${hhmm(now)} · 도착 예상 ${waiting ? '--:--' : hhmm(st.etaMs)}`;
  }
}

function stopTracking() {
  if (!hike) return;
  clearInterval(hike.timer);
  if (hike.watchId != null) navigator.geolocation.clearWatch(hike.watchId);
  if (hike.nativeWatchId != null) native.geo.removeWatcher({ id: hike.nativeWatchId }).catch(() => {});
  try { wakeLock?.release(); } catch { /* 무시 */ }
  $('dim').hidden = true;
}

function finishHike(st) {
  const done = hike;
  stopTracking();
  hike = null;
  const finishedMs = st.finishedMs;
  const diff = Math.round((st.targetMs - finishedMs) / 60000);
  $('doneTitle').textContent = done.sim ? '가상 산행 끝' : '정상 도착';
  $('doneSub').textContent = diff === 0 ? `목표 ${hhmm(st.targetMs)}에 딱 맞춰 도착했어.` : diff > 0 ? `${hhmm(finishedMs)} 도착. 목표 ${hhmm(st.targetMs)}보다 ${diff}분 일찍.` : `${hhmm(finishedMs)} 도착. 목표 ${hhmm(st.targetMs)}보다 ${-diff}분 늦게.`;
  $('doneCps').innerHTML = cpRows(st, done.planCps);
  const stopped = st.elapsedSec - st.movingSec;
  $('doneTimes').textContent = `전체 ${dur(st.elapsedSec)} · 걸은 시간 ${dur(st.movingSec)} · 쉰 시간 ${dur(stopped)}`;
  const factor = st.movingSec / model.totalSec;
  const usable = !done.sim && factor > 0.4 && factor < 2.5;
  $('donePace').textContent = done.sim
    ? '가상 산행이라 기록은 저장하지 않았어.'
    : `이번 걸은 시간은 표준 ${model.course.standardMinutes}분의 ${Math.round(factor * 100)}%야. 반영하면 다음 출발 시각이 이 속도로 계산돼.`;
  $('applyPace').hidden = !usable;
  $('applyPace').onclick = () => { settings.factor = factor; fillCourses(); renderPlan(); show('planView'); };
  if (!done.sim) {
    store.del('active');
    const records = store.get('records', []);
    records.push({ courseId: done.courseId, startMs: done.session.startMs, finishedMs, movingSec: Math.round(st.movingSec), passes: st.passes });
    store.set('records', records.slice(-30));
  }
  show('doneView');
}

function alertBox(text) {
  $('warn').hidden = false;
  $('warn').textContent = text;
}

function bindHike() {
  $('voiceBtn').addEventListener('click', () => {
    if (!hike) return;
    hike.voice = !hike.voice;
    $('voiceBtn').textContent = hike.voice ? '음성 안내 끄기' : '음성 안내 켜기';
    if (hike.voice && 'speechSynthesis' in window) {
      const u = new SpeechSynthesisUtterance('음성 안내를 켰어.');
      u.lang = 'ko-KR';
      speechSynthesis.speak(u);
    }
  });
  $('arriveBtn').addEventListener('click', () => {
    if (!hike) return;
    hike.session.finishedMs = Date.now();
    hike.session.passes[model.checkpoints[model.checkpoints.length - 1].id] = hike.session.finishedMs;
    tick();
  });
  $('quitBtn').addEventListener('click', () => {
    if (!hike) return;
    if (!hike.sim) store.del('active');
    stopTracking();
    hike = null;
    renderPlan();
    show('planView');
  });
  $('backBtn').addEventListener('click', () => { renderPlan(); show('planView'); });

  // 주머니에서 잘못 눌리지 않게: 검은 화면으로 덮고, 길게 눌러야 풀린다
  $('dimBtn').addEventListener('click', () => { $('dim').hidden = false; tick(); });
  let hold = null;
  const release = () => { clearTimeout(hold); hold = null; };
  $('dim').addEventListener('pointerdown', () => { hold = setTimeout(() => { $('dim').hidden = true; }, 1200); });
  $('dim').addEventListener('pointerup', release);
  $('dim').addEventListener('pointercancel', release);
  $('dim').addEventListener('contextmenu', (e) => e.preventDefault());
}

fillMountains();
bindPlan();
bindHike();
renderPlan();
if (native) {
  $('startBtn').textContent = '산행 시작 (화면 꺼도 추적)';
} else if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
