// 일출·일몰 계산 (NOAA 태양 위치 알고리즘).
// 날짜는 한국 달력 날짜(연, 월, 일)로 받고, 결과는 UTC 기준 ms 타임스탬프.

const RAD = Math.PI / 180;
const EARTH_R = 6371000;

function julianDay(y, m, d) {
  if (m <= 2) { y -= 1; m += 12; }
  const A = Math.floor(y / 100);
  const B = 2 - A + Math.floor(A / 4);
  return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + d + B - 1524.5;
}

function solar(jd) {
  const T = (jd - 2451545) / 36525;
  const L0 = (280.46646 + T * (36000.76983 + T * 0.0003032)) % 360;
  const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
  const C = Math.sin(M * RAD) * (1.914602 - T * (0.004817 + 0.000014 * T))
    + Math.sin(2 * M * RAD) * (0.019993 - 0.000101 * T)
    + Math.sin(3 * M * RAD) * 0.000289;
  const omega = 125.04 - 1934.136 * T;
  const lambda = L0 + C - 0.00569 - 0.00478 * Math.sin(omega * RAD);
  const eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * Math.cos(omega * RAD);
  const decl = Math.asin(Math.sin(eps * RAD) * Math.sin(lambda * RAD)) / RAD;
  const y = Math.tan((eps / 2) * RAD) ** 2;
  const eot = 4 / RAD * (y * Math.sin(2 * L0 * RAD) - 2 * e * Math.sin(M * RAD)
    + 4 * e * y * Math.sin(M * RAD) * Math.cos(2 * L0 * RAD)
    - 0.5 * y * y * Math.sin(4 * L0 * RAD) - 1.25 * e * e * Math.sin(2 * M * RAD));
  return { decl, eot };
}

// 태양 고도가 alt(도)가 되는 시각. rising=true면 오전 쪽. 해당 날짜 0시(UTC) 기준 분 단위.
function eventMinutes(jd0, lat, lon, alt, rising) {
  let minutes = 720 - 4 * lon;
  for (let i = 0; i < 3; i++) {
    const { decl, eot } = solar(jd0 + minutes / 1440);
    const cosH = (Math.sin(alt * RAD) - Math.sin(lat * RAD) * Math.sin(decl * RAD))
      / (Math.cos(lat * RAD) * Math.cos(decl * RAD));
    if (cosH < -1 || cosH > 1) return null;
    const H = Math.acos(cosH) / RAD;
    minutes = 720 - 4 * (lon + (rising ? H : -H)) - eot;
  }
  return minutes;
}

// y, m, d: 현지(한국) 날짜. eleM: 관측 지점 고도(m).
export function sunTimes(y, m, d, lat, lon, eleM = 0) {
  const jd0 = julianDay(y, m, d);
  const base = Date.UTC(y, m - 1, d);
  const at = (alt, rising) => {
    const min = eventMinutes(jd0, lat, lon, alt, rising);
    return min == null ? null : base + Math.round(min * 60000);
  };
  // 높은 곳에서는 수평선이 내려가 보여서 해가 조금 일찍 뜬다(바다 수평선 기준의 이론상 최대치).
  const dip = Math.acos(EARTH_R / (EARTH_R + Math.max(0, eleM))) / RAD;
  return {
    sunrise: at(-0.833, true),
    sunset: at(-0.833, false),
    dawn: at(-6, true), // 시민박명 시작(여명)
    dusk: at(-6, false),
    sunriseEarliest: at(-0.833 - dip, true),
    sunsetLatest: at(-0.833 - dip, false),
  };
}
