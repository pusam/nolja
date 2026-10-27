/* ============================================================
 * 몬스터 카트 — 조이콘을 핸들처럼 기울여 달리는 카트 레이스 (1~2인 + CPU)
 *  - 몬스터 캐릭터 16종이 카트를 타고 경주. 2인이면 화면을 위아래로 나눔
 *  - 드리프트(꾹 누르고 꺾기) → 불꽃이 파랑·주황으로 커졌을 때 떼면 부스트
 *  - 아이템 상자(불꽃 대시 · 번개 구슬 · 물방울 함정) · 점프대(트릭) · 대시 판
 *  - 그래픽: three.js 3D (높음·보통·낮음·최저, 자동 조절). 캐릭터는 카트마다 한 덩어리로 합쳐 가볍게 그림
 *  - 공용 모듈: shared/store.js · audio.js · joycon.js · characters.js
 * ============================================================ */
(() => {
'use strict';

const N = window.Nolja;
const NC = N.characters, JC = N.joycon, A = N.audio, S = N.store;

// ---------- 유틸 ----------
const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
const smooth = u => { u = clamp(u, 0, 1); return u * u * (3 - 2 * u); };
const wrapA = a => { a = (a + Math.PI) % (2 * Math.PI); if (a < 0) a += 2 * Math.PI; return a - Math.PI; };
const FONT = '"Pretendard","Malgun Gothic","Apple SD Gothic Neo","Noto Sans KR",sans-serif';
const HEADLESS = window.__KT_HEADLESS || '';   // 테스트용: '3d'면 WebGL 없이 3D 장면만 갱신
function mulberry32(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function shuffle(arr) { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; }
function rr(g, x, y, w, h, r) {
  g.beginPath();
  r = Math.max(0, Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2));
  g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

const CHARS = NC.CHARS;
const COLORS = NC.PLAYER_COLORS;   // P1 파랑 · P2 분홍 (사람 카트 색)

// ---------- 설정 (공용 설정 + 카트 전용) ----------
const P0 = N.prefs();
const settings = {
  mode: S.get('kart.mode', '2p'),            // '2p' 둘이 함께 | '1p' 혼자 (CPU랑)
  cpuLevel: S.get('kart.cpuLevel', 1),       // 0 쉬움 · 1 보통 · 2 어려움
  laps: S.get('kart.laps', 3),               // 바퀴 수
  course: S.get('kart.course', 0),           // 0 몬스터 서킷 · 1 노을 바닷가 · 2 눈꽃 마을 · 3 하트 사탕 공원 · 4 용암 성 (도전)
  gp: S.get('kart.gp', false),               // 그랑프리: 코스 넷을 차례로 달리고 점수 합산 (켜져 있으면 course 대신)
  autoGas: S.get('kart.autoGas', true),      // 자동 가속: 브레이크만 안 누르면 계속 달림 (아이들과 할 때)
  assist: S.get('kart.assist', true),        // 핸들 보조: 길 밖으로 나가려 하면 살짝 돌려줌
  steerAngle: S.get('kart.steerAngle', 28),  // 조이콘을 이만큼(도) 기울이면 핸들 끝까지
  flip: S.get('kart.flip', [false, false]),  // P1·P2 조이콘 핸들 방향 반대로
  quality: P0.quality,                       // 이하 공용 (테니스와 같이 씀)
  chars: P0.chars,
};
const KEYS = { mode: 'kart.mode', cpuLevel: 'kart.cpuLevel', laps: 'kart.laps', course: 'kart.course', gp: 'kart.gp', autoGas: 'kart.autoGas', assist: 'kart.assist',
  steerAngle: 'kart.steerAngle', flip: 'kart.flip', quality: 'quality', chars: 'chars' };
if (!['2p', '1p'].includes(settings.mode)) settings.mode = '2p';
if (![0, 1, 2].includes(settings.cpuLevel)) settings.cpuLevel = 1;
if (![2, 3, 5].includes(settings.laps)) settings.laps = 3;
if (![0, 1, 2, 3, 4].includes(settings.course)) settings.course = 0;
settings.gp = settings.gp === true;
if (!(settings.steerAngle >= 15 && settings.steerAngle <= 45)) settings.steerAngle = 28;
settings.flip = Array.isArray(settings.flip) && settings.flip.length === 2 ? settings.flip.map(v => !!v) : [false, false];
if (!Array.isArray(settings.chars) || settings.chars.length !== 2 || settings.chars.some(k => !Number.isInteger(k) || k < 0 || k >= CHARS.length)) settings.chars = [0, 1];
const saveSettings = () => { for (const k in settings) S.set(KEYS[k], settings[k]); };
JC.sensitivity = P0.sensitivity;   // 점프대 트릭(휙 튕기기) 감지는 테니스 스윙 감도를 같이 씀

// ---------- 게임 상태 ----------
const game = {
  state: 'race',       // countdown · race · finish(사람이 다 들어옴, 잠깐 더 달림) · select · result
  demo: true,          // 메뉴 뒤에서 도는 CPU 시범 레이스
  paused: false,
  stateT: 0, goT: 0, laps: 3, cd: 4, resultAt: 0,
  finishOrder: [],
  msg: [null, null],   // 플레이어별 화면 가운데 문구
  shake: [0, 0],
  padCount: 0,
  demoCam: { kart: 0, shot: 0, until: 0 },
  forceCPU: null,      // 테스트용: true면 사람 자리도 CPU가 운전
  only: null,          // 테스트용: 카트 배열이면 그 카트들만 움직임 (나머지는 멈춤)
  stats: { rescues: 0, walls: 0, spins: 0, items: 0, boosts: 0, drifts: 0, tricks: 0, drafts: 0 },   // 테스트·균형 맞추기용 집계
  cutoffAt: 0,         // 먼저 들어온 사람이 있으면 남은 사람에게 주는 시간 제한 (게임 시계)
  placeFx: [{ place: 0, t: -9, dir: 0 }, { place: 0, t: -9, dir: 0 }],   // 등수가 바뀔 때 숫자 통통 + 화살표
};

// 효과음 (시범 레이스 중엔 조용히)
const sfx = (name, ...args) => { if (!game.demo && typeof A[name] === 'function') A[name](...args); };
const sfxInit = () => A.init();
// 화면에 맞춰 음악: 메뉴·캐릭터 선택·결과는 밝은 곡, 출발 신호부터 결승까지는 레이스 곡. 사람 카트는 엔진 소리
const snd = { music: undefined, amb: null, holdUntil: 0, tempo: 1 };   // tempo: 마지막 바퀴 빠르기 (일시정지 뒤 곡을 다시 틀어도 유지)
const VOL = [['volMusic', 'music'], ['volSfx', 'sfx'], ['volCrowd', 'crowd']];
const racingNow = () => !game.demo && ['countdown', 'race', 'finish'].includes(game.state);
function syncSound() {
  if (!A.ctx) return;   // 아직 클릭·키 입력 전이라 소리를 못 냄
  let m = null;
  if (menuOpen() || selectOpen() || (resultOpen() && T() > snd.holdUntil)) m = 'menu';
  else if (racingNow() && !game.paused) m = COURSE.song || 'race';
  if (m !== snd.music) { snd.music = m; if (m) { A.music(true, m); A.tempo(m !== 'menu' ? snd.tempo : 1); } else A.music(false); }
  const amb = (racingNow() && !game.paused) || resultOpen() ? COURSE.theme : null;   // 파도·바람·새… (메뉴·선택·일시정지는 조용히)
  if (amb !== snd.amb) { snd.amb = amb; A.nature(amb); }
  for (const p of [0, 1]) {
    const k = humanKart(p);
    if (!k || !racingNow() || game.paused) { A.engine('p' + p, null); continue; }
    const rev = game.state === 'countdown' ? (k.gasSince != null ? 0.55 + 0.15 * Math.sin(T() * 9) : 0.12) : Math.abs(k.v) / KART.VMAX;
    A.engine('p' + p, rev, k.boostT > 0 ? 1 : 0, k.drift && !k.air ? 0.4 + 0.3 * k.drift.level : 0);
  }
}

// ---------- 시계 (일시정지 시간을 뺀 게임 시간, 초) ----------
let realNow = () => performance.now() / 1000;
let pauseOffset = 0, pausedAt = 0, demoPauseAt = null;
const T = () => (game.paused ? pausedAt : demoPauseAt !== null ? demoPauseAt : realNow()) - pauseOffset;
function setDemoPaused(on) {
  if (on) {
    if (!game.demo || game.paused) return false;
    if (demoPauseAt === null) demoPauseAt = realNow();
  } else if (demoPauseAt !== null) {
    pauseOffset += realNow() - demoPauseAt;
    demoPauseAt = null;
  }
  return demoPauseAt !== null;
}

// ============================================================
// 트랙 — 컨트롤 포인트를 이은 닫힌 곡선(센트리페탈 캣멀롬)을 1m 간격으로 뽑아 둠
//  단위 m. 땅은 x·z 평면, y = 높이. 길 반폭 8m, 가운데에서 15m에 낮은 벽 (사이는 풀밭: 느려짐)
//  s = 출발선부터 길을 따라 간 거리, d = 가운데에서 오른쪽(+)·왼쪽(-)으로 떨어진 거리
// ============================================================
const TRACK = { halfW: 8, wall: 15 };
// 직선·원호로 그린 코스 → 컨트롤 포인트 (직선은 14m, 원호는 11m쯤마다). ['L', x, z] = 그 점까지 직선, ['A', cx, cz, r, 시작각, 끝각] = 원호(도)
function pathCps(start, segs) {
  const pts = [], at = start.slice(), rad = d => d * Math.PI / 180;
  for (const sg of segs) {
    if (sg[0] === 'L') { const [, x, z] = sg, n = Math.max(1, Math.round(Math.hypot(x - at[0], z - at[1]) / 14)); for (let i = 0; i < n; i++) pts.push([at[0] + (x - at[0]) * i / n, at[1] + (z - at[1]) * i / n]); at[0] = x; at[1] = z; }
    else { const [, cx, cz, r, a0, a1] = sg, n = Math.max(2, Math.round(Math.abs(rad(a1 - a0)) * r / 11)); for (let i = 0; i < n; i++) { const a = rad(a0 + (a1 - a0) * i / n); pts.push([cx + r * Math.cos(a), cz + r * Math.sin(a)]); } at[0] = cx + r * Math.cos(rad(a1)); at[1] = cz + r * Math.sin(rad(a1)); }
  }
  return pts.map(([x, z]) => [Math.round(x * 10) / 10, Math.round(z * 10) / 10]);
}
// 코스 목록. 모든 코스는 출발선 부근이 z = 0을 따라 +x로 가는 직선 (선택 화면·시상대·관중석이 그 자리에 있음)
//  theme: 분위기(하늘·나무·장식, 주변 소리) · song: 레이스 곡 · ramp: 점프대 · panels: 대시 판 s · boxRows: 아이템 상자 줄 s
//  zones: 길 위 구역 { s, len, d0, d1, type } — water 개울·mud 초콜릿 늪 (첨벙, 느려짐) · ice 얼음판 (핸들이 덜 먹고 미끄러짐) · lava 용암 (앗 뜨거, 빙글)
//  jets: 불기둥 { s, d, phase } — 정해진 박자로 솟고, 솟는 동안 닿으면 빙글
const COURSES = [
  { name: '몬스터 서킷', en: 'MONSTER CIRCUIT', fact: '드리프트 · 아이템 · 점프', lapSec: 30, theme: 'meadow', song: 'race',
    cps: [[-20, 0], [40, 0], [88, 4], [122, 26], [132, 64], [112, 96], [74, 104], [44, 88], [18, 70], [-10, 72],
      [-40, 86], [-72, 102], [-104, 114], [-130, 98], [-140, 64], [-114, 16], [-74, 2]],
    ramp: { s: 394, len: 11, h: 1.7 }, panels: [176, 364, 612], boxRows: [84, 330, 548], zones: [] },
  { name: '노을 바닷가', en: 'SUNSET BEACH', fact: '개울 점프 · 머리핀 · 모래 언덕', lapSec: 30, theme: 'beach', song: 'beach',
    cps: [[-40, 0], [30, 0], [100, 0], [150, 4], [180, 22], [184, 52], [162, 72], [124, 72], [88, 84], [50, 72], [12, 84],
      [-26, 72], [-66, 80], [-100, 62], [-108, 30], [-86, 6]],
    ramp: { s: 92, len: 12, h: 2.0 }, panels: [72, 300, 452, 650], boxRows: [56, 334, 584],
    zones: [{ s: 108, len: 11, d0: -43, d1: 43, type: 'water' }] },
  { name: '눈꽃 마을', en: 'SNOWFLAKE VILLAGE', fact: '스키 점프 · 미끄러운 얼음판 · 눈사람', lapSec: 35, theme: 'snow', song: 'snow',
    cps: [[-40, 0], [30, 0], [90, 0], [130, 18], [146, 52], [130, 86], [98, 100], [74, 126], [58, 158], [24, 178], [-14, 168],
      [-32, 138], [-38, 108], [-62, 84], [-98, 76], [-132, 56], [-134, 22], [-102, 3]],
    ramp: { s: 458, len: 13, h: 2.3 }, panels: [196, 335, 640], boxRows: [62, 300, 560],
    zones: [{ s: 372, len: 46, d0: -8.6, d1: 8.6, type: 'ice' }, { s: 600, len: 30, d0: -8.6, d1: 0, type: 'ice' }] },
  { name: '하트 사탕 공원', en: 'SWEETHEART PARK', fact: '왼쪽으로 도는 하트 · 초콜릿 늪', lapSec: 30, theme: 'candy', song: 'candy',
    cps: [[-40, 0], [20, 0], [41, 0], [63, -4], [81, -16], [94, -35], [98, -56], [94, -78], [82, -96], [64, -108], [43, -113],
      [31, -116], [22, -122], [16, -131], [13, -143], [8, -164], [-4, -182], [-22, -194], [-44, -198], [-65, -194], [-84, -181],
      [-96, -163], [-100, -141], [-100, -106], [-100, -70], [-100, -34], [-97, -21], [-90, -10], [-79, -3], [-66, 0]],
    ramp: { s: 500, len: 11, h: 1.8 }, panels: [120, 300, 570], boxRows: [60, 330, 450],
    zones: [{ s: 150, len: 34, d0: -8.6, d1: -3.5, type: 'mud' }, { s: 380, len: 34, d0: -8.6, d1: -3.5, type: 'mud' }, { s: 516, len: 10, d0: -43, d1: 43, type: 'mud' }] },
  // 도전 코스: 한 바퀴 1.4km 8자. 대각선 다리(2층)가 아래 길 위를 지나감 · 지그재그 머리핀 둘(안쪽엔 용암 웅덩이) · 불기둥 · 용암 강 점프
  { name: '용암 성', en: 'LAVA CASTLE', fact: '길고 어려운 도전 코스 · 2층 다리 · 머리핀 · 불기둥 · 용암 강 점프', lapSec: 65, theme: 'lava', song: 'lava', hard: true,
    cps: pathCps([-40, 0], [['L', 50, 0], ['A', 50, 45, 45, -90, 45], ['L', -60, 218.6], ['A', -38.8, 239.8, 30, -135, -270], ['L', 30, 269.8],
      ['A', 30, 295.8, 26, -90, 90], ['L', -40, 321.8], ['A', -40, 347.8, 26, -90, -270], ['L', 80, 373.8], ['A', 80, 338.8, 35, 90, 0], ['L', 115, 308.1],
      ['A', 80, 308.1, 35, 0, -45], ['L', -101.8, 76.8], ['A', -70, 45, 45, 135, 270], ['L', -40, 0]]),
    bridge: { s: 326, flat: 34, ramp: 60, h: 7 },   // 다리: s 326에서 s 1164 길 위를 7m 높이로 지나감 (앞뒤 34m 평평 + 60m 오르막·내리막)
    ramp: { s: 820, len: 12, h: 2.0 }, panels: [630, 805, 1030], boxRows: [60, 785, 1060],
    zones: [{ s: 556, len: 40, d0: 5.4, d1: 8.6, type: 'lava' }, { s: 707, len: 40, d0: -8.6, d1: -5.4, type: 'lava' }, { s: 836, len: 10, d0: -36, d1: 36, type: 'lava' }],
    jets: [{ s: 495, d: -3.6, phase: 0 }, { s: 515, d: 3.6, phase: 1.7 }, { s: 655, d: 0, phase: 0.9 }, { s: 1085, d: -4, phase: 2.4 }, { s: 1105, d: 4, phase: 0.6 }] },
];
const JET = { period: 3.6, warn: 0.7, on: 1.2, r: 2.3 };   // 불기둥: 3.6초마다 0.7초 빨갛게 달아올랐다가 1.2초 동안 솟음
const GP_COURSES = [0, 1, 2, 3];   // 그랑프리(몬스터 컵)에서 달리는 순서
const lobbyCourse = () => settings.gp ? GP_COURSES[0] : settings.course;   // 메뉴 뒤 시범 레이스 코스
let COURSE = COURSES[0], TR = null, L = 0, RAMP = null, ZONES = [], PANELS = [], BOX_ROWS = [], JETS = [], MAP = null;
function loadCourse(i) {
  COURSE = COURSES[i] || COURSES[0];
  TR = buildTrack(COURSE.cps); L = TR.len;
  const br = COURSE.bridge;   // 다리 높이: 1m마다 (가운데 평평 + 양쪽 코사인 오르막·내리막)
  if (br) for (let i = 0; i < TR.n; i++) { const u = Math.abs(sdiff(i * TR.step, br.s)) - br.flat; TR.py[i] = u <= 0 ? br.h : u < br.ramp ? br.h * (0.5 + 0.5 * Math.cos(Math.PI * u / br.ramp)) : 0; }
  RAMP = Object.assign({}, COURSE.ramp);
  ZONES = COURSE.zones.map(z => Object.assign({}, z));
  JETS = (COURSE.jets || []).map(j => Object.assign({}, j));
  PANELS = COURSE.panels.map(s => ({ s, len: 6, w: 5 }));
  for (const p of PANELS) { const c = curvSpan(p.s - 20, p.s + 30, true); p.d = Math.abs(c) > 0.004 ? Math.sign(c) * 3 : 0; }   // 굽은 곳이면 안쪽 길에
  BOX_ROWS = COURSE.boxRows.slice();
  MAP = mapBox();
}
function buildTrack(cps) {
  const cr = (p0, p1, p2, p3, t) => {   // 센트리페탈 캣멀롬 한 점
    const dd = (a, b) => Math.pow(Math.hypot(b[0] - a[0], b[1] - a[1]), 0.5) || 1e-4;
    const t1 = dd(p0, p1), t2 = t1 + dd(p1, p2), t3 = t2 + dd(p2, p3), u = t1 + (t2 - t1) * t;
    const mix = (a, b, ta, tb) => [((tb - u) * a[0] + (u - ta) * b[0]) / (tb - ta), ((tb - u) * a[1] + (u - ta) * b[1]) / (tb - ta)];
    const A1 = mix(p0, p1, 0, t1), A2 = mix(p1, p2, t1, t2), A3 = mix(p2, p3, t2, t3);
    const B1 = mix(A1, A2, 0, t2), B2 = mix(A2, A3, t1, t3);
    return mix(B1, B2, t1, t2);
  };
  const dense = [], m = cps.length;
  for (let i = 0; i < m; i++) {
    const p0 = cps[(i - 1 + m) % m], p1 = cps[i], p2 = cps[(i + 1) % m], p3 = cps[(i + 2) % m];
    for (let k = 0; k < 60; k++) dense.push(cr(p0, p1, p2, p3, k / 60));
  }
  const cum = [0];
  let len = 0;
  for (let i = 1; i <= dense.length; i++) { const a = dense[i - 1], b = dense[i % dense.length]; len += Math.hypot(b[0] - a[0], b[1] - a[1]); cum.push(len); }
  const n = Math.round(len), step = len / n;
  const px = new Float64Array(n), pz = new Float64Array(n), tx = new Float64Array(n), tz = new Float64Array(n), ang = new Float64Array(n), curv = new Float64Array(n);
  for (let i = 0, j = 0; i < n; i++) {
    const s = i * step;
    while (cum[j + 1] < s) j++;
    const a = dense[j], b = dense[(j + 1) % dense.length], u = (s - cum[j]) / Math.max(1e-9, cum[j + 1] - cum[j]);
    px[i] = a[0] + (b[0] - a[0]) * u; pz[i] = a[1] + (b[1] - a[1]) * u;
  }
  for (let i = 0; i < n; i++) {
    const a = (i - 1 + n) % n, b = (i + 1) % n, dx = px[b] - px[a], dz = pz[b] - pz[a], l = Math.hypot(dx, dz) || 1;
    tx[i] = dx / l; tz[i] = dz / l; ang[i] = Math.atan2(tx[i], tz[i]);   // 앞 방향 = (sin a, cos a)
  }
  for (let i = 0; i < n; i++) curv[i] = -wrapA(ang[(i + 3) % n] - ang[(i - 3 + n) % n]) / (6 * step);   // + = 오른쪽으로 굽음
  return { n, len, step, px, pz, tx, tz, ang, curv, py: new Float64Array(n) };
}
const wrapS = s => ((s % L) + L) % L;
const sdiff = (a, b) => { let d = (a - b) % L; if (d > L / 2) d -= L; if (d < -L / 2) d += L; return d; };   // a가 b보다 앞선 거리
const TP = { x: 0, y: 0, z: 0, tx: 0, tz: 1, nx: 1, nz: 0 };
function trackPoint(s, d = 0, out = TP) {   // 길 위 (s, d) → 월드 x·z·높이 y (+ 그 자리 앞 방향·오른쪽 방향)
  const f = wrapS(s) / TR.step, i = Math.floor(f) % TR.n, j = (i + 1) % TR.n, u = f - Math.floor(f);
  let tx = lerp(TR.tx[i], TR.tx[j], u), tz = lerp(TR.tz[i], TR.tz[j], u);
  const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
  out.tx = tx; out.tz = tz; out.nx = -tz; out.nz = tx;
  out.x = lerp(TR.px[i], TR.px[j], u) + out.nx * d; out.z = lerp(TR.pz[i], TR.pz[j], u) + out.nz * d; out.y = lerp(TR.py[i], TR.py[j], u);
  return out;
}
function elevAt(s) { const f = wrapS(s) / TR.step, i = Math.floor(f) % TR.n; return lerp(TR.py[i], TR.py[(i + 1) % TR.n], f - Math.floor(f)); }   // 길 높이 (다리 위면 그 높이, 아니면 0)
const LOC = { i: 0, s: 0, d: 0 };
function locate(x, z, hint = -1, out = LOC) {   // 월드 x·z → 가장 가까운 길 위치 (hint 근처부터 찾음. 다리와 아래 길이 겹치는 곳에선 hint가 있어야 제 층을 찾음)
  let best = -1, bd = Infinity;
  if (hint >= 0) {
    for (let o = -12; o <= 12; o++) {
      const i = (hint + o + TR.n) % TR.n, dd = (x - TR.px[i]) ** 2 + (z - TR.pz[i]) ** 2;
      if (dd < bd) { bd = dd; best = i; }
    }
  }
  if (best < 0 || bd > 26 * 26) {
    for (let i = 0; i < TR.n; i++) { const dd = (x - TR.px[i]) ** 2 + (z - TR.pz[i]) ** 2; if (dd < bd) { bd = dd; best = i; } }
  }
  const dx = x - TR.px[best], dz = z - TR.pz[best];
  out.i = best;
  out.s = wrapS(best * TR.step + clamp(dx * TR.tx[best] + dz * TR.tz[best], -TR.step, TR.step));
  out.d = -dx * TR.tz[best] + dz * TR.tx[best];
  return out;
}
function curvAt(s) { return TR.curv[Math.floor(wrapS(s) / TR.step) % TR.n]; }
function curvSpan(s0, s1, signed = false) {   // s0~s1 사이 곡률: 가장 센 값 (signed면 평균)
  let mx = 0, sum = 0, n = 0;
  for (let s = s0; s <= s1; s += 2) { const c = curvAt(s); sum += c; n++; if (Math.abs(c) > Math.abs(mx)) mx = c; }
  return signed ? (n ? sum / n : 0) : Math.abs(mx);
}

const BOX_D = [-6, -3, 0, 3, 6];
function groundAt(s, d) {   // 바닥 높이: 길 높이(다리) + 점프대
  const e = elevAt(s);
  if (Math.abs(d) > TRACK.halfW + 1) return e;
  const u = sdiff(s, RAMP.s);
  return e + (u >= 0 && u <= RAMP.len ? RAMP.h * u / RAMP.len : 0);
}
function zoneAt(s, d) {   // 이 자리의 구역 (없으면 null)
  for (const z of ZONES) { const u = sdiff(s, z.s); if (u >= 0 && u <= z.len && d >= z.d0 && d <= z.d1) return z; }
  return null;
}
const inCreek = (s, d) => { const z = zoneAt(s, d); return !!z && z.type !== 'ice'; };   // 물·늪·용암 강 (첨벙)
// 불기둥 상태: 1 = 솟는 중 (닿으면 빙글), 0~1 = 곧 솟음 (빨갛게 달아오름), 0 = 잠잠
function jetState(j, t) { const u = ((t + j.phase) % JET.period + JET.period) % JET.period; return u < JET.on ? 1 : u > JET.period - JET.warn ? (u - (JET.period - JET.warn)) / JET.warn * 0.99 : 0; }
function mapBox() {   // 미니맵: 트랙 모양을 0~1 상자에 맞춤
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let i = 0; i < TR.n; i++) { x0 = Math.min(x0, TR.px[i]); x1 = Math.max(x1, TR.px[i]); z0 = Math.min(z0, TR.pz[i]); z1 = Math.max(z1, TR.pz[i]); }
  return { x0, z0, w: x1 - x0, h: z1 - z0 };
}
loadCourse(lobbyCourse());

// ============================================================
// 카트 — 앞뒤 속도 v + 옆으로 밀리는 속도 vl, 방향 a (앞 = (sin a, cos a)).
//  핸들 +면 오른쪽으로 돎 (a가 줄어듦). 1/120초씩 나눠서 계산
// ============================================================
const KART = { R: 1.05, VMAX: 23, ACC: 17, COAST: 4.5, BRAKE: 22, REV: 6, TURN: 1.75, G: 17, BOOST: 1.36 };
const H = 1 / 120;
const ITEMS = { boost: { name: '불꽃 대시' }, triple: { name: '불꽃 대시 ×3' }, star: { name: '반짝 별' }, zap: { name: '번개 구슬' }, trap: { name: '물방울 함정' },
  shield: { name: '방울 보호막' }, magnet: { name: '자석' }, bolt: { name: '천둥 번개' }, ball: { name: '통통 공' }, paint: { name: '물감 폭탄' } };
const DRIFT = [   // 드리프트 불꽃 단계: 모은 양 · 부스트 시간 · 처음 속도 · 이름 · 색
  null,
  { charge: 1.0, dur: 0.7, kick: 1.06, name: '부스트!', color: '#5ec8ff', hex: 0x5ec8ff },
  { charge: 2.4, dur: 1.25, kick: 1.12, name: '슈퍼 부스트!', color: '#ffae3b', hex: 0xffae3b },
  { charge: 4.0, dur: 1.8, kick: 1.16, name: '울트라 부스트!', color: '#ff7ad9', hex: 0xff6bd6 },
];
// 쉬움 · 보통 · 어려움 (최고 속도 비율). 부스트·대시 판 덕에 실제 차이는 더 작아져서 간격을 넓게
//  아이처럼 흔들리며 달리는 운전(tools 시뮬레이션)이 쉬움에선 대부분 이기고, 보통은 해볼 만하게 맞춤
const CPU_SPEED = [0.78, 0.9, 0.98];
const CPU_CATCHUP = [0.04, 0.08, 0.1];   // 사람보다 많이 뒤처진 CPU가 빨라지는 최대 비율
const karts = [];
const boxes = [], shots = [], traps = [], balls = [];
function makeKart(slot, ch, human) {
  return { slot, ch, human, color: human >= 0 ? COLORS[human] : CHARS[ch].body,
    x: 0, y: 0, z: 0, a: 0, v: 0, vl: 0, vy: 0, vyG: 0, air: false, hop: false, rampAir: false, trick: false, trickT: -9,
    steer: 0, drift: null, driftArm: false, prevDrift: false, prevItem: false, boostT: 0, boostFx: 0, spinT: 0, spinAt: -9, immuneT: 0, panelT: 0,
    item: null, itemN: 0, item2: null, itemN2: 0, swapAt: -9, prevSwap: false, roulT: 0, roulTick: 0, lap: 0, s: 0, d: 0, seg: -1, prog: 0, place: 1, finished: false, finishT: 0,
    lapMax: 0, lapT0: 0, bestLap: 0, newLap: false, newRace: false,
    shieldT: 0, magnetT: 0, magnetTarget: null, paintT: 0, paintAt: -9, boltFx: -9,
    offroad: false, wrongT: 0, stuckT: 0, gasSince: null, speedMul: 1, bumpAt: -9, starT: 0, draft: 0, landT: -9,
    ai: { lane: rand(-3, 3), laneAt: 0, d: 0, itemAt: 0, drifting: false, driftSkill: 0 },
    ctl: { steer: 0, gas: false, brake: false, drift: false, item: false, swap: false, gasBtn: false }, mesh: null };
}
const humanKart = p => karts.find(k => k.human === p) || null;
const isAI = k => k.human < 0 || k.finished || !!game.forceCPU;
const nameOf = k => CHARS[k.ch].name;
const tagOf = k => k.human === 0 ? 'P1' : k.human === 1 ? 'P2' : 'CPU';

function setupRace(demo) {
  karts.length = 0; shots.length = 0; traps.length = 0; balls.length = 0;
  const humans = demo ? 0 : (settings.mode === '2p' ? 2 : 1);
  let chars = !demo && gp.on && gp.roster ? gp.roster.slice() : null;   // 그랑프리는 네 코스 내내 같은 6명 (자리 번호도 같게)
  if (!chars) {
    chars = [];
    for (let p = 0; p < humans; p++) chars.push(settings.chars[p]);
    const pool = shuffle(CHARS.map((_, k) => k).filter(k => !chars.includes(k)));
    while (chars.length < 6) chars.push(pool.pop());
    if (!demo && gp.on) gp.roster = chars.slice();
  }
  // 출발 칸: 2열 3줄. 사람은 가운데 줄 (앞질러 가는 재미 + 너무 뒤처지지 않게)
  const grid = humans === 2 ? [2, 3, 0, 1, 4, 5] : humans === 1 ? [3, 0, 1, 2, 4, 5] : [0, 1, 2, 3, 4, 5];
  chars.forEach((ch, i) => {
    const k = makeKart(i, ch, i < humans ? i : -1), g = grid[i], row = Math.floor(g / 2), col = g % 2;
    placeKart(k, L - 6 - row * 7, col ? 3.4 : -3.4);
    k.lap = 0;
    k.ai.driftSkill = demo ? 0.7 : [0, 0.55, 1][settings.cpuLevel];
    k.speedMul = k.ai.base = k.human >= 0 ? 1 : demo ? 0.94 + rand(-0.03, 0.03) : CPU_SPEED[settings.cpuLevel] + rand(-0.015, 0.015);   // CPU마다 조금씩 다른 빠르기 (고무줄은 이 값에 곱함)
    karts.push(k);
  });
  game.laps = demo ? Infinity : settings.laps;
  game.finishOrder = []; game.msg = [null, null]; game.resultAt = 0; game.cutoffAt = 0;
  boxes.length = 0;
  for (const s of BOX_ROWS) for (const d of BOX_D) { const p = trackPoint(s, d); boxes.push({ s, d, x: p.x, y: p.y, z: p.z, alive: true, at: 0 }); }
  rebuildKarts3D();
}
function placeKart(k, s, d) {
  const p = trackPoint(s, d);
  k.x = p.x; k.z = p.z; k.y = p.y; k.a = Math.atan2(p.tx, p.tz);
  k.v = 0; k.vl = 0; k.vy = 0; k.air = false;
  locate(k.x, k.z, Math.floor(wrapS(s) / TR.step) % TR.n); k.seg = LOC.i; k.s = LOC.s; k.d = LOC.d;   // 다리 위·아래 중 제 층에
  k.prog = (k.lap - 1) * L + k.s;   // 출발 전 등수도 줄 순서대로
}

// CPU 카트 급: 부스트도 실력만큼만 빨라짐 (쉬움 CPU가 부스트로 사람을 따라잡지 않게). 사람은 1
const kartClass = k => k.human >= 0 ? 1 : k.ai.base;
const turnRate = v => KART.TURN * clamp(Math.abs(v) / 5, 0, 1) * (1 - 0.22 * clamp(Math.abs(v) / KART.VMAX, 0, 1.4)) * (v < -0.2 ? -1 : 1);
function giveBoost(k, dur, kick = 1.08) {
  k.boostT = Math.max(k.boostT, dur); k.boostFx = T(); game.stats.boosts++;
  k.v = Math.max(k.v, KART.VMAX * kick * kartClass(k));
  if (k.human >= 0) { sfx('boost'); rumble(k.human, 0.35, 120); }
}
function endDrift(k, released) {
  const lv = k.drift ? k.drift.level : 0, D = DRIFT[lv];
  k.drift = null;
  if (released && D && !k.offroad) { game.stats.drifts++; giveBoost(k, D.dur, D.kick); if (k.human >= 0) showMsg(k.human, D.name, D.color); }
}
const HIT_MSG = { trap: '미끄덩!', zap: '찌릿!', ball: '통!', bolt: '번쩍!', star: '빙글!', lava: '앗 뜨거!', fire: '앗 뜨거!' };
// 맞으면 빙글: true. 별·무적이면 그냥 false, 보호막이 대신 터지면 'block'
function spinOut(k, why) {
  if (k.spinT > 0 || k.immuneT > 0 || k.starT > 0) return false;   // 반짝 별이면 아무것도 안 통함
  if (k.shieldT > 0) { popShield(k); return 'block'; }
  k.spinT = 1.25; k.spinAt = T(); k.immuneT = 2.6; k.v *= 0.35; k.vl = 0; k.drift = null; k.boostT = 0; k.trick = false; k.magnetT = 0; game.stats.spins++;   // 공중에서 맞으면 트릭 부스트도 없음
  burst(k.x, k.y + 1.2, k.z, 14, why === 'trap' ? [0x7dd3fc, 0xffffff] : why === 'ball' ? [0x6ee7a0, 0xffffff] : why === 'lava' || why === 'fire' ? [0xff6a2a, 0xffd166] : [0xfde047, 0xffffff], 6, 0.6);
  if (k.human >= 0) { sfx(why === 'trap' ? 'splash' : why === 'lava' || why === 'fire' ? 'fire' : 'crash'); if (why === 'trap') sfx('crash'); rumble(k.human, 0.9, 260); showMsg(k.human, HIT_MSG[why] || '찌릿!', why === 'lava' || why === 'fire' ? '#ff9a5a' : '#7dd3fc'); game.shake[k.human] = 0.6; }
  return true;
}
function popShield(k) {   // 보호막이 대신 맞고 "퐁" 터짐
  k.shieldT = 0;
  burst(k.x, k.y + 1, k.z, 18, [0x9be7ff, 0xffffff], 6, 0.5);
  if (k.human >= 0) { sfx('pop'); showMsg(k.human, '보호막이 막았어요!', '#9be7ff'); rumble(k.human, 0.3, 80); }
}
// 물감 폭탄·천둥 번개처럼 멀리서 오는 것: 별이면 안 통하고 보호막은 대신 터짐
function shrug(k) { if (k.starT > 0) return true; if (k.shieldT > 0) { popShield(k); return true; } return false; }
function doTrick(k) {
  if (!k.rampAir || k.trick || k.spinT > 0) return;   // 맞아서 빙글 도는 중엔 트릭 못 함
  k.trick = true; k.trickT = T(); game.stats.tricks++;
  if (k.human >= 0) { sfx('trick'); showMsg(k.human, '트릭!', '#facc15'); }
}

// 사람 카트 핸들 보조: 길 가장자리 밖으로 향하면 안쪽으로 살짝 돌려줌
function assistSteer(k, steer) {
  const lim = TRACK.halfW - 0.8, ad = Math.abs(k.d);
  if (ad < lim || k.v < 3) return steer;
  const rel = wrapA(k.a - TR.ang[k.seg]);   // + = 길 방향보다 왼쪽을 봄
  const outward = (k.d > 0 && rel < 0.05) || (k.d < 0 && rel > -0.05);
  if (!outward) return steer;
  const push = clamp((ad - lim) / 4, 0, 1) * 0.85;
  return clamp(steer + (k.d > 0 ? -push : push), -1, 1);
}

function driveKart(k, c, h) {
  k.boostT = Math.max(0, k.boostT - h); k.panelT = Math.max(0, k.panelT - h); k.immuneT = Math.max(0, k.immuneT - h); k.starT = Math.max(0, k.starT - h);
  k.shieldT = Math.max(0, k.shieldT - h); k.paintT = Math.max(0, k.paintT - h);
  if (k.roulT > 0) {
    k.roulT -= h;
    if (k.human >= 0 && T() >= k.roulTick) { k.roulTick = T() + 0.08; sfx('roulette'); }
    if (k.roulT <= 0) {
      k.roulT = 0;
      const it = rollItem(k), n = it === 'triple' ? 3 : 1;
      if (!k.item) { k.item = it; k.itemN = n; } else { k.item2 = it; k.itemN2 = n; }   // 굴리는 동안 첫 칸을 썼으면 첫 칸으로
      if (k.human >= 0) sfx('itemGet'); k.ai.itemAt = T() + rand(0.6, 2.2) + (2 - settings.cpuLevel) * 0.8;
    }
  }
  let steer = c.steer, gas = c.gas, brake = c.brake;
  if (k.spinT > 0) { k.spinT = Math.max(0, k.spinT - h); steer = 0; gas = false; brake = false; }
  if (k.human >= 0 && !k.finished && settings.assist && !game.forceCPU) steer = assistSteer(k, steer);
  k.steer += (steer - k.steer) * (1 - Math.exp(-h * 10));
  // 앞뒤 속도
  let vmax = KART.VMAX * k.speedMul;
  if ((k.offroad || k.wet) && k.boostT <= 0 && k.starT <= 0) vmax *= k.wet ? 0.6 : 0.5;
  if (k.starT > 0) vmax = Math.max(vmax, KART.VMAX * 1.2 * kartClass(k));   // 반짝 별: 풀밭도 그대로, 조금 더 빠르게
  if (k.magnetT > 0) vmax = Math.max(vmax, KART.VMAX * 1.2 * kartClass(k));
  if (k.paintT > 0 && k.human < 0) vmax *= 0.92;
  if (k.boostT > 0) vmax = KART.VMAX * KART.BOOST * kartClass(k);
  if (k.spinT > 0) k.v *= Math.exp(-h * 2.2);
  else if (k.air) { /* 공중에선 속도 그대로 */ }
  else if (brake && !(k.boostT > 0)) {
    if (k.v > 0.5) k.v -= KART.BRAKE * h;
    else k.v = Math.max(-KART.REV, k.v - 9 * h);
  } else if (gas || k.boostT > 0 || k.starT > 0 || k.magnetT > 0) {
    if (k.v < vmax) k.v = Math.min(vmax, k.v + (k.boostT > 0 || k.starT > 0 || k.magnetT > 0 ? 34 : KART.ACC * Math.max(0.15, 1 - Math.max(0, k.v) / vmax)) * h);
    else k.v = Math.max(vmax, k.v - (k.offroad ? 26 : 6) * h);
  } else {
    const dec = (k.offroad ? 14 : KART.COAST) * h;
    k.v = Math.abs(k.v) <= dec ? 0 : k.v - Math.sign(k.v) * dec;
  }
  // 드리프트: 버튼을 누른 채로 꺾으면 시작 (누르는 순간 살짝 뜀). 꺾는 쪽으로 더 꺾을수록 불꽃이 빨리 커짐
  const driftBtn = c.drift && k.spinT <= 0;
  if (driftBtn && !k.prevDrift && !k.air && k.v > 9) { k.vy = 2.0; k.air = true; k.hop = true; k.driftArm = true; }
  if (!driftBtn) k.driftArm = false;
  if (driftBtn && !k.drift && k.driftArm && Math.abs(c.steer) > 0.3 && k.v > 9 && !k.offroad) k.drift = { dir: Math.sign(c.steer), charge: 0, level: 0 };
  if (k.drift) {
    if (!driftBtn || k.v < 6 || k.spinT > 0) endDrift(k, !driftBtn);
    else if (!k.air && !k.offroad) {
      k.drift.charge += h * (1.0 + 0.6 * Math.max(0, k.steer * k.drift.dir));   // 파랑 0.6~1초 · 주황 1.5~2.4초 · 분홍 2.5~4초 (안쪽으로 꺾을수록 빨리)
      const lv = DRIFT.reduce((a, D, i) => D && k.drift.charge >= D.charge ? i : a, 0);
      if (lv > k.drift.level) { k.drift.level = lv; if (k.human >= 0) { sfx('spark', lv); rumble(k.human, 0.2, 60); } }
    }
  }
  k.prevDrift = driftBtn;
  // 방향
  // 드리프트: 핸들을 가운데 둬도 거의 끝까지 꺾은 만큼 돌고(1.1), 안쪽으로 꺾으면 더 날카롭게(1.85), 바깥으로 꺾으면 완만하게(0.25) — 반대로 살짝 꺾어도 휙 펴지지 않게
  const dsteer = k.drift ? clamp(k.steer * k.drift.dir, -1, 1) : 0;
  let yaw = k.drift ? k.drift.dir * (1.1 + dsteer * (dsteer > 0 ? 0.75 : 0.85)) : k.steer * turnRate(k.v);
  if (k.air) yaw *= k.hop ? 0.85 : 0.45;   // 드리프트 시작할 때 살짝 뛰는 동안은 거의 그대로 돎 (점프대에서 날 땐 덜)
  const icy = k.zone === 'ice' && k.starT <= 0;
  if (icy) yaw *= 0.75;   // 얼음판: 핸들이 덜 먹고
  if (k.spinT > 0) yaw = 0;
  const turn = -yaw * h;
  k.a = wrapA(k.a + turn);
  if (icy) k.vl += k.v * Math.sin(turn) * 0.45;   // 차는 돌아도 가던 쪽으로 계속 미끄러짐 (커브 바깥으로 밀림)
  if (k.drift && !k.air) k.vl -= k.drift.dir * 3 * h;   // 드리프트: 뒤가 빠지며 커브 바깥으로 살짝 미끄러짐 (초속 0.6m쯤)
  if (k.magnetT > 0) {
    k.magnetT = Math.max(0, k.magnetT - h);
    const o = k.magnetTarget, ds = o ? sdiff(o.s, k.s) : 0;
    if (o && (ds < 3.5 || ds > 220 || o.finished)) { k.magnetT = 0; if (ds < 3.5 && ds > -2) giveBoost(k, 0.6, 1.06); }   // 바로 뒤까지 끌려오면 휙 추월
    else if (o && k.spinT <= 0) { const p = trackPoint(k.s + Math.min(ds, 14), o.d), err = wrapA(Math.atan2(p.x - k.x, p.z - k.z) - k.a); k.a = wrapA(k.a + clamp(err, -0.6, 0.6) * 2.4 * h); }
  }
  // 움직이기 (앞 + 옆으로 밀림. 얼음판에선 옆으로 밀린 게 천천히 멈춤)
  k.vl *= Math.exp(-h * (icy ? 2 : 5));
  const fx = Math.sin(k.a), fz = Math.cos(k.a), ox = k.x, oz = k.z, oSeg = k.seg, oS = k.s, oD = k.d;
  k.x += (fx * k.v - fz * k.vl) * h;
  k.z += (fz * k.v + fx * k.vl) * h;
  const prevS = k.s;
  locate(k.x, k.z, k.seg); k.seg = LOC.i; k.s = LOC.s; k.d = LOC.d;
  // 높이: 점프대를 올라가다 끝나면 그 기울기 그대로 날아감
  let gy = groundAt(k.s, k.d);
  if (gy - k.y > 0.35) {   // 점프대 옆·뒤의 세로 면에 부딪힘: 한 번에 확 올라탈 순 없으니
    if (Math.abs(oD) > TRACK.halfW + 0.95 && Math.abs(k.d) < Math.abs(oD)) {   // 옆면: 옆으로만 막고 앞으로는 면을 따라 미끄러짐 (계속 꺾고 있어도 안 멈춤)
      const q = trackPoint(k.s, oD); k.x = q.x; k.z = q.z; k.d = oD;
      k.v *= 0.985; k.vl = 0;
    } else {   // 뒤쪽 세로 면: 제자리로 튕김
      k.x = ox; k.z = oz; k.seg = oSeg; k.s = oS; k.d = oD;
      k.v *= 0.6; k.vl *= -0.3;
    }
    const diff = wrapA(TR.ang[k.seg] - k.a);
    if (Math.abs(diff) < Math.PI / 2) k.a = wrapA(k.a + diff * 0.5);   // 길 방향으로 돌려서 옆면을 따라 지나가게
    gy = groundAt(k.s, k.d);
    if (k.human >= 0 && T() - k.bumpAt > 0.25) { k.bumpAt = T(); sfx('bump', 0.4); rumble(k.human, 0.4, 80); }
  }
  if (k.air) {
    k.vy -= KART.G * h; k.y += k.vy * h;
    if (k.y <= gy) land(k, gy);
  } else if (gy < k.y - 0.08) {
    k.air = true; k.vy = k.vyG; k.rampAir = k.vyG > 1.5; k.trick = false;
  } else { k.vyG = clamp((gy - k.y) / h, -6, 6); k.y = gy; }   // 점프대 기울기로 올라가는 빠르기 (최고 속도에서도 6m/s 안)
  // 길 밖 · 개울 · 벽
  k.offroad = !k.air && Math.abs(k.d) > TRACK.halfW + 0.6;
  const zone = k.air ? null : zoneAt(k.s, k.d), wet = !!zone && zone.type !== 'ice';
  if (zone && zone.type === 'lava' && zone.d1 - zone.d0 < 2 * TRACK.halfW && k.v > 1 && spinOut(k, 'lava') === true) { k.vy = 3.5; k.air = true; }   // 용암 웅덩이: 앗 뜨거! 빙글 돌며 살짝 튀어 오름
  if (wet && !k.wet && k.human >= 0 && k.v > 4) {   // 물·늪은 첨벙, 길을 가로지르는 용암 강은 앗 뜨거 (느려지기만)
    if (zone.type === 'lava') { sfx('fire'); if (k.spinT <= 0) showMsg(k.human, '앗 뜨거!', '#ff9a5a'); } else sfx('splash');
    rumble(k.human, 0.35, 90);
  }
  k.wet = wet; k.zone = zone ? zone.type : null;
  if (Math.abs(k.d) > TRACK.wall - KART.R) wallHit(k);
  // 바퀴 수: 출발선을 앞으로 지나면 +1, 거꾸로 지나면 -1
  if (prevS > L - 60 && k.s < 60) lapUp(k);
  else if (prevS < 60 && k.s > L - 60) k.lap--;
  k.prog = (k.lap - 1) * L + k.s;
  // 거꾸로 달림 · 벽에 끼임
  const rel = Math.abs(wrapA(k.a - TR.ang[k.seg]));
  k.wrongT = rel > 2.0 && k.v > 2 ? k.wrongT + h : 0;
  k.stuckT = !k.finished && k.spinT <= 0 && Math.abs(k.v) < 1.5 && (c.gas || isAI(k)) && !c.brake ? k.stuckT + h : 0;
  if (k.stuckT > 2.5 || (isAI(k) && k.wrongT > 1.5)) rescue(k);
}
function land(k, gy) {
  const hard = k.vy < -6;
  if (k.vy < -3) k.landT = T();   // 착지할 때 차체가 살짝 눌림 (보이는 것만)
  k.y = gy; k.vy = 0; k.air = false; k.hop = false;
  if (k.rampAir) {
    k.rampAir = false;
    if (k.human >= 0) { sfx('land'); rumble(k.human, hard ? 0.6 : 0.3, 90); if (hard) game.shake[k.human] = 0.35; }
    if (k.trick) { giveBoost(k, 0.9); if (k.human >= 0) showMsg(k.human, '트릭 성공!', '#facc15'); }
  }
  k.trick = false;
}
function wallHit(k) {
  const i = k.seg, nx = -TR.tz[i], nz = TR.tx[i], side = Math.sign(k.d), over = Math.abs(k.d) - (TRACK.wall - KART.R);
  k.x -= nx * side * over; k.z -= nz * side * over; k.d -= side * over;
  const fx = Math.sin(k.a), fz = Math.cos(k.a);
  const vx = fx * k.v - fz * k.vl, vz = fz * k.v + fx * k.vl, vn = (vx * nx + vz * nz) * side;   // + = 벽 쪽으로
  if (vn <= 0) return;
  const rvx = vx - 1.25 * vn * nx * side, rvz = vz - 1.25 * vn * nz * side;   // 벽에 튕김 (반발 0.25)
  k.v = (rvx * fx + rvz * fz) * 0.92; k.vl = -rvx * fz + rvz * fx;
  // 길 방향으로 조금 돌려서 벽을 따라 미끄러지게 (계속 박지 않게)
  const tang = TR.ang[i], diff = wrapA(tang - k.a);
  if (Math.abs(diff) < Math.PI / 2) k.a = wrapA(k.a + diff * 0.3);
  if (k.drift) endDrift(k, false);
  if (vn > 3 && T() - k.bumpAt > 0.25) {
    k.bumpAt = T(); game.stats.walls++;
    if (k.human >= 0) { sfx('bump', vn / 15); rumble(k.human, clamp(vn / 15, 0.2, 0.8), 100); game.shake[k.human] = Math.min(0.5, vn / 30); }
    burst(k.x + nx * side * KART.R, k.y + 0.5, k.z + nz * side * KART.R, 6, [0xffffff, 0xfde68a], 3, 0.3);
  }
}
// 끼었거나 거꾸로 가는 CPU는 길 가운데로 다시 세워 줌
function rescue(k) {
  placeKart(k, k.s, k.d * 0.3);
  k.stuckT = 0; k.wrongT = 0; k.immuneT = Math.max(k.immuneT, 1.2); k.drift = null; game.stats.rescues++;
  k.prog = (k.lap - 1) * L + k.s;
  if (k.human >= 0) showMsg(k.human, '다시 출발!', '#ffffff');
}
function lapUp(k) {
  k.lap++;
  let lapT = 0, rec = false;
  if (k.lap > k.lapMax) {   // 처음 넘는 줄에서만 바퀴 시간을 잼 (거꾸로 넘었다가 다시 넘은 건 안 셈)
    const now = T() - game.goT;
    if (k.lapMax >= 1) { lapT = now - k.lapT0; k.bestLap = k.bestLap ? Math.min(k.bestLap, lapT) : lapT; }
    k.lapMax = k.lap; k.lapT0 = now;
    if (lapT > 0 && recordable(k) && newRecord('lap', lapT)) rec = k.newLap = true;
  }
  if (k.lap > game.laps) { finishKart(k); return; }
  if (k.human < 0 || k.lap < 2) return;
  const sub = lapT > 0 ? `${rec ? '새 기록! ' : ''}이번 바퀴 ${fmtTime(lapT)}` : '';
  if (rec) sfx('itemGet');
  if (k.lap === game.laps) { showMsg(k.human, '마지막 바퀴!', '#f472b6', sub); sfx('finalLap'); if (karts.every(o => o.human < 0 || o.lap >= game.laps)) { snd.tempo = 1.12; A.tempo(snd.tempo); } }
  else showMsg(k.human, `${k.lap}바퀴째!`, '#ffffff', sub);
}
// ---------- 기록: 코스마다 가장 빠른 바퀴 · 바퀴 수마다 가장 빠른 완주, 그랑프리 최고 점수 (이 브라우저에 저장, 사람이 직접 달린 것만) ----------
const REC = (r => r && typeof r === 'object' && !Array.isArray(r) ? r : {})(S.get('kart.records', {}));
const courseRec = (c = COURSES.indexOf(COURSE)) => { const r = REC[c]; return r && typeof r === 'object' ? r : (REC[c] = { lap: 0, race: {} }); };
const recordable = k => k.human >= 0 && !game.demo && !game.forceCPU;
function newRecord(kind, t) {   // kind: 'lap' 바퀴 · 'race' 완주(지금 바퀴 수) · 'gp' 그랑프리 점수(클수록 좋음). 더 좋으면 저장하고 true
  const r = courseRec();
  if (!r.race || typeof r.race !== 'object') r.race = {};
  if (kind === 'gp') { if (REC.gp && REC.gp >= t) return false; REC.gp = t; }
  else if (kind === 'lap') { if (r.lap && r.lap <= t) return false; r.lap = t; }
  else { if (r.race[game.laps] && r.race[game.laps] <= t) return false; r.race[game.laps] = t; }
  S.set('kart.records', REC);
  return true;
}
function finishKart(k) {
  if (k.finished) return;
  k.finished = true; k.finishT = T() - game.goT; k.lap = game.laps + 1;
  game.finishOrder.push(k.slot);
  k.place = game.finishOrder.length;
  if (recordable(k) && newRecord('race', k.finishT)) k.newRace = true;
  if (k.human >= 0) {
    showMsg(k.human, k.place === 1 ? '1등! 골인!' : `${k.place}등 골인!`, k.place === 1 ? '#facc15' : '#ffffff', `${k.newRace ? '새 기록! ' : ''}${fmtTime(k.finishT)}`);
    if (k.place <= 3) { sfx('jingle', k.place === 1); sfx('cheer', k.place === 1 ? 2.4 : 1.4); } else sfx('applause', 0.4);
    rumble(k.human, 0.6, 200);
    confetti(k.x, k.y + 2.5, k.z);
  }
  if (game.demo || game.state !== 'race') return;
  if (karts.every(o => o.human < 0 || o.finished)) { game.state = 'finish'; game.resultAt = T() + 3.2; snd.holdUntil = T() + 6.5; game.cutoffAt = 0; return; }
  // 아직 안 들어온 사람이 있으면 시간 제한: 먼저 들어온 사람 뒤 45초, CPU가 다 들어오면 60초 (멈춰 있거나 한참 늦어도 경기가 끝나게)
  const limit = k.human >= 0 ? 45 : karts.every(o => o.human >= 0 || o.finished) ? 60 : 0;
  if (limit) game.cutoffAt = Math.min(game.cutoffAt || Infinity, T() + limit);
}
// 시간 제한이 끝나면 안 들어온 사람은 지금 자리 그대로 결과로
function cutoff() {
  game.cutoffAt = 0; game.state = 'finish'; game.resultAt = T() + 1.6; snd.holdUntil = T() + 5;
  for (const k of karts) if (k.human >= 0 && !k.finished) showMsg(k.human, '시간 끝!', '#ffffff', '다음엔 더 빨리 달려 봐요');
}
const fmtTime = t => { t = Math.max(0, t); const m = Math.floor(t / 60), s = t - m * 60; return `${m}:${s < 10 ? '0' : ''}${s.toFixed(1)}`; };

function collideKarts() {
  const R2 = (2 * KART.R) ** 2;
  for (let i = 0; i < karts.length; i++) for (let j = i + 1; j < karts.length; j++) {
    const a = karts[i], b = karts[j];
    if (Math.abs(a.y - b.y) > 1.3) continue;
    const dx = b.x - a.x, dz = b.z - a.z, d2 = dx * dx + dz * dz;
    if (d2 >= R2 || d2 < 1e-8) continue;
    const d = Math.sqrt(d2), nx = dx / d, nz = dz / d, over = 2 * KART.R - d;
    a.x -= nx * over / 2; a.z -= nz * over / 2; b.x += nx * over / 2; b.z += nz * over / 2;
    const va = worldVel(a), vax = va.x, vaz = va.z, vb = worldVel(b);
    const rel = (vb.x - vax) * nx + (vb.z - vaz) * nz;
    if (rel >= 0) continue;
    const imp = -1.4 * rel / 2;
    push(a, -imp * nx, -imp * nz); push(b, imp * nx, imp * nz);
    if ((a.starT > 0) !== (b.starT > 0)) spinOut(a.starT > 0 ? b : a, 'star');   // 반짝 별에 부딪히면 빙글
    if (-rel > 2.5 && T() - Math.max(a.bumpAt, b.bumpAt) > 0.3) {
      a.bumpAt = b.bumpAt = T();
      for (const k of [a, b]) if (k.human >= 0) { sfx('bump', -rel / 12); rumble(k.human, 0.4, 80); }
    }
  }
}
const WV = { x: 0, z: 0 }, BL = { i: 0, s: 0, d: 0 };   // BL: 통통 공 자리 찾기용
function worldVel(k) { const fx = Math.sin(k.a), fz = Math.cos(k.a); WV.x = fx * k.v - fz * k.vl; WV.z = fz * k.v + fx * k.vl; return WV; }
function push(k, dvx, dvz) { const fx = Math.sin(k.a), fz = Math.cos(k.a); k.v += dvx * fx + dvz * fz; k.vl += -dvx * fz + dvz * fx; }

// ============================================================
// 아이템: 상자를 지나가면 1초 동안 룰렛 → 등수에 따라 (앞이면 함정·보호막, 뒤면 부스트·별·자석·번개가 잘 나옴)
//  두 칸까지 들고 다니며 첫 칸부터 씀. 바꾸기 버튼으로 두 칸 순서를 바꿈
//  불꽃 대시 ×3은 세 번 나눠 쓰고, 반짝 별은 6초 동안 무적 + 조금 빠르게 (부딪힌 카트는 빙글)
//  방울 보호막은 한 번 막아 줌 · 자석은 바로 앞 카트에게 끌려감 · 천둥 번개는 내 앞 카트 모두 빙글
//  통통 공은 곧장 날아가 벽에 튕김 · 물감 폭탄은 앞 카트들 화면에 물감 (CPU는 휘청)
// ============================================================
const ITEM_KEYS = ['boost', 'triple', 'star', 'zap', 'trap', 'shield', 'magnet', 'bolt', 'ball', 'paint'];
function rollItem(k) {
  const f = karts.length > 1 ? (k.place - 1) / (karts.length - 1) : 0.5;   // 0 = 1등 · 1 = 꼴등
  const w = { boost: 0.1 + 0.35 * f, triple: 0.5 * Math.max(0, f - 0.35), star: 0.45 * Math.max(0, f - 0.6),
    zap: 0.3 + 0.1 * Math.sin(f * Math.PI), trap: 0.6 - 0.5 * f,
    shield: 0.3 - 0.2 * f, magnet: 0.4 * Math.max(0, f - 0.2), bolt: 0.3 * Math.max(0, f - 0.7), ball: 0.25, paint: 0.25 * Math.max(0, f - 0.3) };
  if (k.human < 0 && !game.demo && settings.cpuLevel === 0) w.zap = w.star = w.bolt = w.ball = w.paint = 0;   // 쉬움: CPU는 공격 아이템을 안 씀 (아이가 덜 맞게)
  let r = Math.random() * ITEM_KEYS.reduce((a, key) => a + w[key], 0);
  for (const key of ITEM_KEYS) { r -= w[key]; if (r <= 0) return key; }
  return 'boost';
}
const shiftItems = k => { k.item = k.item2; k.itemN = k.itemN2; k.item2 = null; k.itemN2 = 0; };   // 둘째 칸이 첫 칸으로
function swapItems(k) {   // 두 칸 순서 바꾸기 (룰렛 도는 중엔 안 됨)
  if (!k.item || !k.item2 || k.roulT > 0) return;
  [k.item, k.item2, k.itemN, k.itemN2] = [k.item2, k.item, k.itemN2, k.itemN];
  k.swapAt = T();
  if (k.human >= 0) sfx('tick');
}
// 바로 앞(같은 바퀴 기준 거리) 카트
function nextAhead(k, range) { let best = null, bd = range; for (const o of karts) { const ds = sdiff(o.s, k.s); if (o !== k && !o.finished && ds > 2 && ds < bd) { bd = ds; best = o; } } return best; }
function useItem(k) {
  const it = k.item;
  if (!it || k.spinT > 0) return;
  game.stats.items++; game.stats.used = game.stats.used || {}; game.stats.used[it] = (game.stats.used[it] || 0) + 1;
  if (it === 'triple' && --k.itemN > 0) { /* 아직 남음 */ } else shiftItems(k);
  if (it === 'boost' || it === 'triple') { giveBoost(k, it === 'triple' ? 1.2 : 1.5, 1.12); if (k.human >= 0) showMsg(k.human, it === 'triple' ? `불꽃 대시! ${k.itemN ? '×' + k.itemN + ' 남음' : ''}` : '불꽃 대시!', '#fb923c'); }
  else if (it === 'star') {
    k.starT = 6; k.v = Math.max(k.v, KART.VMAX * 1.1 * kartClass(k)); k.drift = null;
    if (k.human >= 0) { sfx('itemBox'); sfx('boost'); showMsg(k.human, '반짝 별!', '#ffe14d', '6초 동안 무적이에요'); rumble(k.human, 0.5, 160); }
  } else if (it === 'zap') {
    let target = null, best = 200;
    for (const o of karts) { const ds = sdiff(o.s, k.s); if (o !== k && ds > 2 && ds < best) { best = ds; target = o; } }
    const p = trackPoint(k.s + 2.6, k.d);
    shots.push({ owner: k, s: wrapS(k.s + 2.6), d: k.d, v: Math.max(0, k.v) + 20, life: 6.5, target, t0: T(), x: p.x, y: k.y + 0.7, z: p.z });
    if (k.human >= 0) sfx('zap');
  } else if (it === 'trap') {
    const s = wrapS(k.s - 2.8), p = trackPoint(s, k.d);
    traps.push({ x: p.x, y: groundAt(s, k.d), z: p.z, s, d: k.d, owner: k, t0: T() });
    if (traps.length > 14) traps.shift();
    if (k.human >= 0) sfx('plop');
  } else if (it === 'shield') {
    k.shieldT = 10;
    if (k.human >= 0) { sfx('shield'); showMsg(k.human, '방울 보호막!', '#9be7ff', '한 번 막아 줘요'); }
  } else if (it === 'magnet') {
    k.magnetT = 3.5; k.magnetTarget = nextAhead(k, 160); k.drift = null;
    if (k.human >= 0) { sfx('magnet'); showMsg(k.human, '자석!', '#ff8fa3', k.magnetTarget ? `${nameOf(k.magnetTarget)}에게 끌려가요` : ''); }
  } else if (it === 'bolt') {   // 내 앞 카트 모두 (보호막·별은 막음)
    let hit = 0;
    for (const o of karts) if (o !== k && !o.finished && o.prog > k.prog) { o.boltFx = T(); if (spinOut(o, 'bolt') === true) hit++; for (let y = 1; y < 11; y += 1.2) spark(o.x + rand(-0.3, 0.3), o.y + y, o.z + rand(-0.3, 0.3), 0xfff27a, 0.9, 0, -2, 0, 0.3); }
    sfx('thunder');
    if (k.human >= 0) showMsg(k.human, '천둥 번개!', '#ffe14d', hit ? `앞 친구 ${hit}명 번쩍!` : '');
  } else if (it === 'ball') {   // 곧장 날아가다 벽에 튕김
    const fx = Math.sin(k.a), fz = Math.cos(k.a), sp = Math.max(32, k.v + 15);
    balls.push({ owner: k, x: k.x + fx * 2.6, z: k.z + fz * 2.6, y: k.y + 0.6, vx: fx * sp, vz: fz * sp, life: 5, bounces: 0, t0: T(), seg: k.seg });
    if (balls.length > 12) balls.shift();
    sfx('boing');
  } else if (it === 'paint') {   // 앞쪽 150m 안 카트들 화면에 물감 (CPU는 3.5초 동안 휘청·조금 느리게)
    let hit = 0;
    for (const o of karts) { const ds = sdiff(o.s, k.s); if (o !== k && !o.finished && ds > 0 && ds < 150 && !shrug(o)) { o.paintT = 3.5; o.paintAt = T(); hit++; if (o.human >= 0) { sfx('splat'); showMsg(o.human, '물감 철퍽!', '#ff9ad5'); } } }
    burst(k.x, k.y + 2, k.z, 24, [0xff6fa8, 0xffd166, 0x7ad3ff, 0x86efac, 0xa78bfa], 7, 0.7);
    sfx('splat');
    if (k.human >= 0) showMsg(k.human, '물감 폭탄!', '#ff9ad5', hit ? `앞 친구 ${hit}명 철퍽!` : '');
  }
}
function updateItems(h) {
  const t = T();
  for (const b of boxes) if (!b.alive && t >= b.at) b.alive = true;
  for (const k of karts) {
    for (const b of boxes) {
      if (!b.alive || k.y - b.y > 3 || k.y < b.y - 2 || (k.x - b.x) ** 2 + (k.z - b.z) ** 2 > 2.1 * 2.1) continue;   // 높이 뛰었거나 다른 층이면 못 먹음
      b.alive = false; b.at = t + 2.6;
      burst(b.x, b.y + 1.2, b.z, 12, [0xf472b6, 0x60a5fa, 0xfacc15, 0x4ade80], 5, 0.5);
      if ((!k.item || !k.item2) && k.roulT <= 0) { k.roulT = 1.0; k.roulTick = 0; }   // 빈 칸이 있으면 룰렛
      if (k.human >= 0) { sfx('itemBox'); rumble(k.human, 0.25, 60); }
    }
    if (!k.air && k.panelT <= 0) {
      for (const p of PANELS) if (Math.abs(sdiff(k.s, p.s)) < p.len / 2 && Math.abs(k.d - p.d) < p.w / 2) { giveBoost(k, 1.0); k.panelT = 0.8; break; }
    }
  }
  for (let i = shots.length - 1; i >= 0; i--) {
    const sh = shots[i];
    sh.life -= h;
    let tg = sh.target;
    if (tg && sdiff(tg.s, sh.s) < -4) tg = sh.target = null;   // 앞질러 버렸으면 그냥 앞으로
    sh.s = wrapS(sh.s + sh.v * h);
    if (tg) sh.d += clamp(tg.d - sh.d, -9 * h, 9 * h); else sh.d *= Math.exp(-h * 0.4);
    sh.d = clamp(sh.d, -TRACK.halfW - 3, TRACK.halfW + 3);
    const p = trackPoint(sh.s, sh.d); sh.x = p.x; sh.z = p.z; sh.y = groundAt(sh.s, sh.d) + 0.75;
    if (Math.random() < 0.5) spark(sh.x, sh.y, sh.z, 0xfde047, 0.5);
    let gone = sh.life <= 0;
    for (const k of karts) {
      if (gone || (k === sh.owner && t - sh.t0 < 0.6)) continue;
      if ((k.x - sh.x) ** 2 + (k.z - sh.z) ** 2 < 1.8 * 1.8 && Math.abs(k.y + 0.6 - sh.y) < 1.8) {
        gone = true;   // 반짝 별이면 구슬만 깨지고 끝
        if (spinOut(k, 'zap') === true && sh.owner.human >= 0 && k !== sh.owner) showMsg(sh.owner.human, '맞혔다!', '#fde047');
      }
    }
    for (let j = traps.length - 1; j >= 0 && !gone; j--) {
      const tr = traps[j];
      if ((tr.x - sh.x) ** 2 + (tr.z - sh.z) ** 2 < 1.6 * 1.6 && Math.abs(tr.y - sh.y) < 2.5) { traps.splice(j, 1); gone = true; burst(tr.x, tr.y + 0.4, tr.z, 10, [0x7dd3fc, 0xffffff], 4, 0.4); }
    }
    if (gone) { burst(sh.x, sh.y, sh.z, 10, [0xfde047, 0xffffff], 5, 0.35); shots.splice(i, 1); }
  }
  for (let i = balls.length - 1; i >= 0; i--) {   // 통통 공: 곧장 날아가다 벽에서 튕김. 카트·함정에 맞거나 5초·네 번 튕기면 끝
    const b = balls[i];
    b.life -= h; b.x += b.vx * h; b.z += b.vz * h;
    locate(b.x, b.z, b.seg, BL); b.seg = BL.i;
    const lim = TRACK.wall - 0.6;
    if (Math.abs(BL.d) > lim) {
      const nx = -TR.tz[BL.i], nz = TR.tx[BL.i], side = Math.sign(BL.d), vn = (b.vx * nx + b.vz * nz) * side, over = Math.abs(BL.d) - lim;
      b.x -= nx * side * over; b.z -= nz * side * over;
      if (vn > 0) { b.vx -= 2 * vn * nx * side; b.vz -= 2 * vn * nz * side; b.bounces++; if (karts.some(o => o.human >= 0 && (o.x - b.x) ** 2 + (o.z - b.z) ** 2 < 1600)) sfx('boing'); }
    }
    b.y = groundAt(BL.s, BL.d) + 0.55 + Math.abs(Math.sin((t - b.t0) * 9)) * 0.35;
    let gone = b.life <= 0 || b.bounces > 4;
    for (const k of karts) {
      if (gone || (k === b.owner && t - b.t0 < 0.5)) continue;
      if ((k.x - b.x) ** 2 + (k.z - b.z) ** 2 < 1.7 * 1.7 && Math.abs(k.y + 0.6 - b.y) < 1.8) {
        gone = true;
        if (spinOut(k, 'ball') === true && b.owner.human >= 0 && k !== b.owner) showMsg(b.owner.human, '맞혔다!', '#86efac');
      }
    }
    for (let j = traps.length - 1; j >= 0 && !gone; j--) {
      const tr = traps[j];
      if ((tr.x - b.x) ** 2 + (tr.z - b.z) ** 2 < 1.6 * 1.6 && Math.abs(tr.y - b.y) < 2.5) { traps.splice(j, 1); gone = true; burst(tr.x, tr.y + 0.4, tr.z, 10, [0x7dd3fc, 0xffffff], 4, 0.4); }
    }
    if (gone) { burst(b.x, b.y, b.z, 12, [0x6ee7a0, 0xffffff], 5, 0.35); balls.splice(i, 1); }
  }
  for (const j of JETS) {   // 불기둥이 솟는 동안 가까이 있으면 앗 뜨거
    if (jetState(j, t) < 1) continue;
    for (const k of karts) if (!k.air && Math.abs(sdiff(k.s, j.s)) < JET.r && Math.abs(k.d - j.d) < JET.r) spinOut(k, 'fire');
  }
  for (let i = traps.length - 1; i >= 0; i--) {
    const tr = traps[i];
    if (t - tr.t0 > 45) { traps.splice(i, 1); continue; }
    for (const k of karts) {
      if (k.air || (k === tr.owner && t - tr.t0 < 1.0)) continue;
      if ((k.x - tr.x) ** 2 + (k.z - tr.z) ** 2 < 1.55 * 1.55 && Math.abs(k.y - tr.y) < 2 && (spinOut(k, 'trap') || k.starT > 0)) {   // 맞은 뒤 무적이면 그냥 지나감, 별이면 함정이 터짐
        traps.splice(i, 1); burst(tr.x, tr.y + 0.4, tr.z, 14, [0x7dd3fc, 0xffffff], 5, 0.5);
        break;
      }
    }
  }
}

// ============================================================
// CPU 운전: 앞쪽 길 위 한 점(자기 줄 + 커브 안쪽 + 상자·함정·앞차 피하기)을 향해 핸들,
//  급커브에선 속도를 줄이고, 잘하는 CPU는 커브에서 드리프트 → 부스트
// ============================================================
function aiControl(k, h) {
  const c = k.ctl, ai = k.ai, t = T();
  if (t > ai.laneAt) { ai.lane = rand(-3.8, 3.8); ai.laneAt = t + rand(3, 7); }
  const look = 6 + Math.max(0, k.v) * 0.45;
  let target = ai.lane + clamp(curvSpan(k.s + 6, k.s + 6 + look * 1.5, true) * 150, -4.5, 4.5);
  if ((!k.item || !k.item2) && k.roulT <= 0) {   // 빈 칸이 있으면 앞 상자 줄로
    for (const s of BOX_ROWS) {
      const ds = sdiff(s, k.s);
      if (ds > 3 && ds < 45) {
        let bd = 99, best = null;
        for (const b of boxes) if (b.s === s && b.alive && Math.abs(b.d - k.d) < bd) { bd = Math.abs(b.d - k.d); best = b.d; }
        if (best !== null) target = best;
      }
    }
  }
  for (const tr of traps) { const ds = sdiff(tr.s, k.s); if (ds > 0 && ds < 22 && Math.abs(tr.d - target) < 2.4) target = tr.d + (target >= tr.d ? 2.6 : -2.6); }
  let hotSide = 0;   // 앞 커브 안쪽에 웅덩이(용암·늪·물)가 있는 쪽 (+ 오른쪽): 그쪽으로는 드리프트를 시작하지 않음 (드리프트는 안쪽을 파고드니까)
  for (const z of ZONES) {   // 길 한쪽만 덮은 늪·얼음판·용암 웅덩이는 피해서 (길 전체를 덮은 건 어쩔 수 없음). 용암은 더 넉넉히
    const ds = sdiff(z.s, k.s), m = z.type === 'lava' ? 3 : 1.6;
    if (ds > -z.len && ds < 30 && z.d1 - z.d0 < 2 * TRACK.halfW && target > z.d0 - m + 0.4 && target < z.d1 + m - 0.4) target = z.d0 + z.d1 > 0 ? z.d0 - m : z.d1 + m;
    if (z.type !== 'ice' && ds > -z.len && ds < 40 && z.d1 - z.d0 < 2 * TRACK.halfW) hotSide = Math.sign(z.d0 + z.d1);
  }
  // 불기둥: 지나갈 무렵(앞뒤 조금 넉넉히) 솟거나 달아올라 있는 것들을 모두 비켜 가는 줄 중 가장 가까운 줄로 (없으면 가장 가까운 불기둥만)
  const hotJets = JETS.filter(j => { const ds = sdiff(j.s, k.s), at = t + ds / Math.max(6, k.v); return ds > -3 && ds < 50 && [-0.25, 0, 0.25, 0.5].some(u => jetState(j, at + u) > 0.2); });
  if (hotJets.length) {
    let best = null;
    for (const gap of [JET.r + 1.5, JET.r + 1]) {   // 넉넉히 비켜 갈 줄이 없으면 (불기둥 둘 사이) 조금 좁게
      const clear = d => hotJets.every(j => Math.abs(d - j.d) >= gap);
      if (clear(target)) { best = target; break; }
      for (let d = -TRACK.halfW + 1.6; d <= TRACK.halfW - 1.6; d += 0.2) if (clear(d) && (best === null || Math.abs(d - target) < Math.abs(best - target))) best = d;
      if (best !== null) break;
    }
    const j = hotJets.reduce((a, b) => sdiff(a.s, k.s) < sdiff(b.s, k.s) ? a : b);
    target = best !== null ? best : j.d + (k.d >= j.d ? JET.r + 2 : -JET.r - 2);
  }
  const dr = sdiff(RAMP.s, k.s);
  if (dr > -RAMP.len && dr < 35) target = clamp(target, -TRACK.halfW + 3, TRACK.halfW - 3);   // 점프대는 가운데로 타고 넘음 (커브 안쪽으로 붙다 옆면에 걸리지 않게)
  for (const o of karts) {
    if (o === k) continue;
    const ds = sdiff(o.s, k.s);
    if (ds > 0 && ds < 8 && Math.abs(o.d - k.d) < 2.2 && k.v > o.v + 0.5) target = o.d + (k.d >= o.d ? 2.8 : -2.8);
  }
  target = clamp(target, -TRACK.halfW + 1.6, TRACK.halfW - 1.6);
  ai.d += (target - ai.d) * (1 - Math.exp(-h * 2));
  const p = trackPoint(k.s + look, ai.d);
  const err = wrapA(Math.atan2(p.x - k.x, p.z - k.z) - k.a);
  c.steer = clamp(-err * 2.4, -1, 1);
  const kMax = curvSpan(k.s + 4, k.s + 8 + Math.max(0, k.v) * 1.1);
  const vSafe = kMax > 0.001 ? 1.5 / kMax : 99;
  c.gas = k.v < vSafe; c.brake = k.v > vSafe + 5;
  // 드리프트: 커브 들어갈 때 누르고, 커브가 끝나면 떼서 부스트
  const ahead = curvSpan(k.s + 4, k.s + 18, true);
  // 드리프트로 돌 만큼 급한 커브(필요한 회전이 초당 0.55 넘게)에서만 걸고, 앞이 거의 곧아지면(0.2 아래) 놓아서 부스트
  const need = Math.abs(ahead) * Math.max(0, k.v);
  if (ai.drifting) { if (!k.drift && !k.driftArm || need < 0.2 || Math.sign(ahead) !== (k.drift ? k.drift.dir : Math.sign(ahead)) || (hotSide && k.d * hotSide > 2)) ai.drifting = false; }
  else if (need > 0.55 && k.v > 15 && !k.air && !k.offroad && Math.sign(ahead) !== hotSide && Math.random() < ai.driftSkill * h * 6) { ai.drifting = true; c.steer = Math.sign(ahead); }
  c.drift = ai.drifting;
  // 아이템
  c.item = false;
  if (k.item && t > ai.itemAt) {
    const it = k.item, ahead = (a, b) => karts.some(o => o !== k && sdiff(o.s, k.s) > a && sdiff(o.s, k.s) < b);
    let want;
    if (it === 'boost' || it === 'triple') want = (curvSpan(k.s, k.s + 40) < 0.016 || t > ai.itemAt + 4) && k.boostT <= 0;
    else if (it === 'star' || it === 'shield' || it === 'bolt') want = it !== 'shield' || k.shieldT <= 0;
    else if (it === 'zap') want = ahead(3, 70) || t > ai.itemAt + 8;
    else if (it === 'magnet') want = ahead(15, 90) || t > ai.itemAt + 8;
    else if (it === 'ball') want = karts.some(o => o !== k && sdiff(o.s, k.s) > 5 && sdiff(o.s, k.s) < 40 && Math.abs(o.d - k.d) < 2.5) && curvSpan(k.s, k.s + 30) < 0.02 || t > ai.itemAt + 9;
    else if (it === 'paint') want = ahead(3, 100) || t > ai.itemAt + 8;
    else want = karts.some(o => o !== k && sdiff(k.s, o.s) > 2 && sdiff(k.s, o.s) < 25) || t > ai.itemAt + 6;   // 함정: 바로 뒤에 누가 오면
    c.item = !!want && !k.prevItem;   // 누를 때마다 하나씩 (두 칸 연달아 쓸 때도)
  }
  if (k.paintT > 0) c.steer = clamp(c.steer + Math.sin(t * 7 + k.slot * 1.7) * 0.45, -1, 1);   // 물감 맞으면 앞이 안 보여 휘청
  c.gasBtn = c.gas;
  return c;
}
// 고무줄: CPU가 사람보다 많이 앞서면 조금 느리게, 많이 뒤처지면 조금 빠르게 (같이 달리는 재미)
function rubberBand() {
  const hum = karts.filter(k => k.human >= 0 && !k.finished);
  if (!hum.length) return;
  const best = Math.max(...hum.map(k => k.prog)), worst = Math.min(...hum.map(k => k.prog));
  for (const k of karts) {
    if (k.human >= 0) continue;
    let rb = 1;
    if (k.prog > best + 50) rb = 1 - Math.min(0.12, (k.prog - best - 50) / 500);
    else if (k.prog < worst - 50) rb = 1 + Math.min(CPU_CATCHUP[settings.cpuLevel], (worst - 50 - k.prog) / 400);
    k.speedMul = k.ai.base * rb;
  }
}

// ============================================================
// 레이스 진행
// ============================================================
function showMsg(p, text, color = '#fff', sub = '') { if (p === 0 || p === 1) game.msg[p] = { text, color, sub, t: T() }; }
function rumble(p, amp, ms) { if (!game.demo && (p === 0 || p === 1)) JC.rumble(p, amp, ms); }
function updatePlaces() {
  const order = karts.slice().sort((a, b) => (b.finished ? 1e9 - b.place : b.prog) - (a.finished ? 1e9 - a.place : a.prog));
  order.forEach((k, i) => { if (!k.finished) k.place = i + 1; });
}
function step(h) {
  const racing = game.demo || game.state === 'race' || game.state === 'finish';
  for (const k of karts) {
    if (game.only && !game.only.includes(k)) continue;
    const c = isAI(k) ? aiControl(k, h) : k.ctl;
    if (!racing) { k.v = 0; k.vl = 0; continue; }   // 출발 신호 전
    const item = !!c.item, swap = !!c.swap;
    if (item && !k.prevItem) useItem(k);
    if (swap && !k.prevSwap) swapItems(k);
    k.prevItem = item; k.prevSwap = swap;
    if (k.rampAir && c.drift && !k.prevDrift && !k.trick) doTrick(k);
    driveKart(k, c, h);
    if (isAI(k) && k.rampAir && !k.trick && k.vy < 1 && Math.random() < (k.human >= 0 ? 1 : 0.3 + 0.3 * settings.cpuLevel) * h * 4) doTrick(k);
  }
  if (racing) { collideKarts(); slipstream(h); updateItems(h); }
}
// 슬립스트림: 빠르게 달리는 카트 바로 뒤(3~14m)에 1.3초 붙어 있으면 바람을 타고 부스트 (뒤처진 사람이 따라잡는 길)
function slipstream(h) {
  for (const k of karts) {
    if (game.only && !game.only.includes(k)) continue;
    if (k.human < 0 && !game.demo && settings.cpuLevel < 2) continue;   // CPU는 어려움에서만 (CPU끼리 줄줄이 빨라져 아이가 못 따라가지 않게)
    let behind = false;
    if (!k.air && k.spinT <= 0 && k.v > 15) {
      const fx = Math.sin(k.a), fz = Math.cos(k.a);
      for (const o of karts) {
        if (o === k || o.v < 12 || o.air || Math.abs(o.y - k.y) > 2) continue;   // 다리 위·아래는 따로
        const dx = o.x - k.x, dz = o.z - k.z, along = dx * fx + dz * fz;
        if (along > 2.6 && along < 14 && Math.abs(-dx * fz + dz * fx) < 1.7) { behind = true; break; }
      }
    }
    if (!behind) { k.draft = Math.max(0, k.draft - h * 1.5); continue; }
    k.draft += h;
    if (k.draft >= 1.3) {
      k.draft = 0; game.stats.drafts = (game.stats.drafts || 0) + 1;
      giveBoost(k, 0.9, 1.04);
      if (k.human >= 0) showMsg(k.human, '슬립스트림!', '#bfe7ff');
    }
  }
}
let lastT = 0, acc = 0;
function update() {
  const t = T();
  const dt = clamp(t - lastT, 0, 0.1); lastT = t;
  readInputs(t);
  syncSound();
  if (game.paused || demoPauseAt !== null) return;
  if (game.state === 'select') { if (selStartAt && t >= selStartAt) (settings.gp ? startGP : startRace)(); updateParticles(dt); return; }
  if (game.state === 'result') { updateParticles(dt); return; }
  if (game.state === 'countdown') countdown(t);
  acc += dt;
  let n = 0;
  while (acc >= H && n < 14) { step(H); acc -= H; n++; }
  if (n >= 14) acc = 0;
  updatePlaces();
  if (!game.demo) rubberBand();
  if (game.state === 'race' && game.cutoffAt && t >= game.cutoffAt) cutoff();
  if (game.state === 'finish' && t >= game.resultAt) showResult();
  for (const p of [0, 1]) game.shake[p] = Math.max(0, game.shake[p] - dt * 2);
  emitKartFx(dt);
  updateParticles(dt);
}
function countdown(t) {
  const left = game.goT - t, n = Math.ceil(left);
  for (const k of karts) if (k.human >= 0) { if (k.ctl.gasBtn) { if (k.gasSince == null) k.gasSince = t; } else k.gasSince = null; }
  if (n !== game.cd && n <= 3 && n >= 1) { game.cd = n; sfx('countdown', n); for (const p of [0, 1]) showMsg(p, String(n), '#ffffff'); }
  if (left > 0) return;
  game.state = 'race'; game.cd = 0; sfx('countdown', 0);
  for (const p of [0, 1]) showMsg(p, '출발!', '#facc15');
  for (const k of karts) {
    // 로켓 스타트: 출발 1초 전 ~ 0.25초 전 사이에 가속을 누르기 시작해 그대로 누르고 있으면
    if (k.human >= 0 && k.gasSince != null && t - k.gasSince >= 0.25 && t - k.gasSince <= 1.1) { giveBoost(k, 1.0); showMsg(k.human, '로켓 스타트!', '#facc15'); }
    else if (k.human < 0 && Math.random() < 0.25 * settings.cpuLevel) giveBoost(k, 0.8);
    k.gasSince = null;
  }
}

// ============================================================
// 입력 — 키보드 · 게임패드 · 조이콘(가로로 쥐고 핸들처럼 기울이기)
// ============================================================
const keys = new Set();
const KB = [
  { left: ['KeyA'], right: ['KeyD'], gas: ['KeyW'], brake: ['KeyS'], drift: ['Space', 'ShiftLeft'], item: ['ControlLeft', 'KeyE'], swap: ['KeyQ'] },
  { left: ['ArrowLeft', 'KeyJ'], right: ['ArrowRight', 'KeyL'], gas: ['ArrowUp', 'KeyI'], brake: ['ArrowDown', 'KeyK'], drift: ['ShiftRight', 'Slash', 'KeyU'], item: ['ControlRight', 'Period', 'KeyO'], swap: ['Comma', 'KeyP'] },
];
const GAME_KEYS = new Set(KB.flatMap(m => Object.values(m).flat()));
// 조이콘을 가로로 쥐었을 때(스틱이 왼쪽) 앞면 버튼 자리: 오른쪽 = 가속 · 아래 = 브레이크 · 위 = 드리프트 · 왼쪽 = 아이템. 레일의 SR = 드리프트 · SL = 아이템 · 스틱 누르기 = 아이템 바꾸기
const B = JC.BTN;
const JMAP = {
  R: { gas: B.X, brake: B.A, drift: B.Y | B.SR, item: B.B | B.SL, swap: B.STICK },
  L: { gas: B.DOWN, brake: B.LEFT, drift: B.RIGHT | B.SR, item: B.UP | B.SL, swap: B.STICK },
  pro: { gas: B.A, brake: B.B, drift: B.SHOULDER | B.Y, item: B.TRIGGER | B.X, swap: B.STICK },
};
const tilt = [{ v: 0, upright: false, angle: 0, joy: false }, { v: 0, upright: false, angle: 0, joy: false }];
// 조이콘 기울기 → 핸들 (-1 왼쪽 ~ +1 오른쪽). 긴 축(X, 어깨 버튼 쪽 +)이 수평에서 기운 각도로 봄
//  R을 가로로 쥐면 어깨 쪽이 오른쪽 → 오른쪽으로 꺾으면 X가 아래로(가속도 x < 0). L은 반대
function joySteer(p, jc) {
  const a = jc.accel, an = Math.hypot(a.x, a.y, a.z), st = tilt[p];
  if (jc.kind === 'pro') {   // 프로콘은 왼쪽 스틱
    const x = jc.stick ? (jc.stick.x - 2048) / 1400 : 0;
    return Math.abs(x) < 0.15 ? 0 : clamp(x, -1, 1);
  }
  if (jc.stick && jc.stick.y > 200 && jc.stick.y < 3900) {   // 가로로 쥔 조이콘 스틱도 핸들로 (세게 밀었을 때만: 가운데 값이 조이콘마다 조금 달라서)
    const y = (jc.stick.y - 2048) / 1300 * (jc.kind === 'L' ? -1 : 1);   // 스틱 방향은 정해져 있어서 '핸들 방향 반대로'와 상관없음
    if (Math.abs(y) > 0.5) return clamp(y, -1, 1);
  }
  if (an < 0.5 || an > 1.6) return st.v;   // 크게 흔드는 중엔 그대로
  const ax = clamp(a.x / an, -1, 1);
  st.upright = Math.abs(ax) > 0.86;   // 세로로 들고 있음 → 가로로 잡으라고 알려줌
  if (st.upright) return 0;
  let ang = Math.asin(ax) * 180 / Math.PI * (jc.kind === 'L' ? 1 : -1);
  if (settings.flip[p]) ang = -ang;
  st.angle = ang;
  const full = settings.steerAngle, dead = 3;
  return Math.sign(ang) * clamp((Math.abs(ang) - dead) / (full - dead), 0, 1);
}
const padPrev = {}, padSel = {}, padSlot = {};   // padSlot: 패드 번호 → 선수. 다른 패드가 빠져도 자리가 안 바뀜
const tiltSel = [{ dir: 0, at: 0 }, { dir: 0, at: 0 }];
function readInputs(t) {
  const out = [0, 1].map(() => ({ steer: 0, gas: false, brake: false, drift: false, item: false, swap: false, joySteer: null }));
  // 키보드
  const any = list => list.some(c => keys.has(c));
  for (const p of [0, 1]) {
    const maps = settings.mode === '1p' ? (p === 0 ? KB : []) : [KB[p]];
    for (const m of maps) {
      if (any(m.left)) out[p].steer -= 1;
      if (any(m.right)) out[p].steer += 1;
      out[p].gas = out[p].gas || any(m.gas); out[p].brake = out[p].brake || any(m.brake);
      out[p].drift = out[p].drift || any(m.drift); out[p].item = out[p].item || any(m.item); out[p].swap = out[p].swap || any(m.swap);
    }
  }
  pollGamepads(out);
  // 조이콘: 한 사람에게 여러 개면 가장 크게 기울인 것
  for (const p of [0, 1]) tilt[p].joy = false;
  for (const jc of JC.list) {
    if (!jc.ok || (jc.player !== 0 && jc.player !== 1)) continue;
    const p = jc.player, c = out[p], m = JMAP[jc.kind] || JMAP.R, hold = jc.hold || 0;
    c.gas = c.gas || !!(hold & m.gas); c.brake = c.brake || !!(hold & m.brake);
    c.drift = c.drift || !!(hold & m.drift); c.item = c.item || !!(hold & m.item); c.swap = c.swap || !!(hold & m.swap);
    const st = joySteer(p, jc);
    if (c.joySteer === null || Math.abs(st) > Math.abs(c.joySteer)) c.joySteer = st;
    tilt[p].joy = true;
  }
  for (const p of [0, 1]) {
    const c = out[p];
    if (c.joySteer !== null) { tilt[p].v += (c.joySteer - tilt[p].v) * 0.35; c.steer += tilt[p].v; }
    c.steer = clamp(c.steer, -1, 1);
    c.gasBtn = c.gas;
    if (settings.autoGas && !c.brake) c.gas = true;
    const k = humanKart(p);
    if (k) Object.assign(k.ctl, c);
    // 캐릭터 선택: 조이콘을 기울여서 고르기 (끝까지 기울이면 0.5초마다 한 칸 더)
    if (selectOpen() && tilt[p].joy && !sel[p].ready && !selCPU(p)) {
      const v = c.joySteer || 0, ts = tiltSel[p];
      if (Math.abs(v) < 0.25) ts.dir = 0;
      else if (Math.abs(v) > 0.55 && (ts.dir !== Math.sign(v) || t - ts.at > 0.5)) { ts.dir = Math.sign(v); ts.at = t; selMove(p, ts.dir); }
    }
  }
}
// 패드 자리: 다른 패드도 조이콘도 안 쓰는 자리로 (조이콘 P1 + 패드 하나면 패드는 P2). 한번 정하면 그대로
function padSlotFor(gp) {
  const others = Object.keys(padSlot).filter(k => k !== String(gp.index)).map(k => padSlot[k]);
  const joy = JC.list.filter(j => j.ok).map(j => j.player), cur = padSlot[gp.index];
  if (cur != null && !joy.includes(cur)) return cur;
  const free = [0, 1].find(p => !others.includes(p) && !joy.includes(p));
  if (free !== undefined) return free;
  return cur != null ? cur : !others.includes(0) ? 0 : !others.includes(1) ? 1 : gp.index % 2;
}
function pollGamepads(out) {
  if (!navigator.getGamepads) return;
  let pads; try { pads = navigator.getGamepads() || []; } catch (e) { return; }
  const live = pads.filter(gp => gp && gp.connected && !(JC.supported && /057e|joy-con|pro controller|nintendo/i.test(gp.id)));   // PC에선 조이콘은 WebHID로 받음
  for (const k in padSlot) if (!live.some(gp => String(gp.index) === k)) delete padSlot[k];
  game.padCount = 0;
  for (const gp of live) {
    padSlot[gp.index] = padSlotFor(gp);
    const pi = settings.mode === '1p' ? 0 : padSlot[gp.index];
    game.padCount++;
    const now = gp.buttons.map(b => b.pressed || b.value > 0.5);
    const prev = padPrev[gp.index] || [];
    const rise = i => !!now[i] && !prev[i];
    padPrev[gp.index] = now;
    const std = gp.mapping === 'standard', ax = gp.axes && gp.axes.length ? gp.axes[0] : 0;
    if (selectOpen()) {
      const left = (std && !!now[14]) || ax < -0.6, right = (std && !!now[15]) || ax > 0.6;
      const st = padSel[gp.index] || (padSel[gp.index] = { l: false, r: false });
      if (left && !st.l) selMove(pi, -1);
      if (right && !st.r) selMove(pi, 1);
      st.l = left; st.r = right;
      if (rise(0) || rise(9)) selReady(pi, true);
      if (rise(1)) selReady(pi, false);
      continue;
    }
    if (rise(9) && racingNow() && !game.paused) { pause(); continue; }
    if ((rise(0) || rise(9)) && (menuOpen() || resultOpen() || game.paused)) { onConfirm(); continue; }
    const c = out[pi];
    let st = Math.abs(ax) > 0.15 ? (ax - Math.sign(ax) * 0.15) / 0.85 : 0;
    if (std && now[14]) st = -1;
    if (std && now[15]) st = 1;
    c.steer += st;
    if (std) { c.gas = c.gas || !!(now[0] || now[7]); c.brake = c.brake || !!(now[1] || now[6]); c.drift = c.drift || !!(now[5] || now[2]); c.item = c.item || !!(now[4] || now[3]); c.swap = c.swap || !!(now[12] || now[13] || now[8]); }
    else { c.gas = c.gas || !!now[0]; c.brake = c.brake || !!now[1]; c.drift = c.drift || !!now[2]; c.item = c.item || !!now[3]; }
  }
}
window.addEventListener('keydown', e => {
  sfxInit();
  keys.add(e.code);
  if (e.repeat) return;
  if (e.code === 'KeyF') { toggleFull(); return; }
  // 선택 버튼에 초점이 있으면 Enter·Space의 기본 클릭 동작을 사용한다.
  if (e.target && e.target.closest && e.target.closest('#roster .tile') && ['Enter', 'NumpadEnter', 'Space'].includes(e.code)) return;
  if (selectOpen()) {
    if (e.code === 'Escape') { toMenu(); return; }
    if (e.code === 'Enter' || e.code === 'NumpadEnter') { e.preventDefault(); selReady(0, true); selReady(1, true); return; }
    const m = SELKEYS[e.code];
    if (m) {
      e.preventDefault();
      const p = settings.mode === '1p' ? 0 : m[0];
      if (m[1]) selMove(p, m[1]); else selReady(p, !sel[p].ready);
    }
    return;
  }
  if (e.code === 'Escape') {
    if (game.paused) resume(); else if (resultOpen()) toMenu(); else if (!game.demo) pause();
    return;
  }
  if (e.code === 'Enter' || e.code === 'NumpadEnter') { e.preventDefault(); onConfirm(); return; }
  if (racingNow() && (GAME_KEYS.has(e.code) || e.ctrlKey)) e.preventDefault();   // 경주 중엔 화면 스크롤·브라우저 단축키(파이어폭스 '/' 찾기 등)가 안 끼어들게
});
window.addEventListener('keyup', e => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());
const SELKEYS = { KeyA: [0, -1], KeyD: [0, 1], KeyW: [0, 0], KeyS: [0, 0], ArrowLeft: [1, -1], ArrowRight: [1, 1], ArrowUp: [1, 0], ArrowDown: [1, 0], KeyJ: [1, -1], KeyL: [1, 1], KeyI: [1, 0], KeyK: [1, 0] };

// ---------- 조이콘 (공용 모듈 shared/joycon.js) ----------
function assignJoyCons() { JC.single = settings.mode === '1p'; JC.assign(); }
function onJoyButtons(pi, m, jc) {
  if (selectOpen()) {
    const map = JMAP[jc && jc.kind] || JMAP.R;
    selReady(pi, !(m & map.brake));   // 브레이크 자리 = 준비 취소, 나머지 = 준비
    return;
  }
  if (racingNow() && !game.paused) { if (m & (B.PLUS | B.MINUS)) pause(); return; }
  onConfirm();
}
JC.on('buttons', (pi, m, jc) => onJoyButtons(pi, m, jc));
JC.on('swing', pi => { const k = humanKart(pi); if (k && k.rampAir && !k.trick) doTrick(k); });   // 점프대에서 휙 → 트릭
JC.on('change', () => renderSlots());

// ============================================================
// 메뉴 · 일시정지 · 결과
// ============================================================
function hideOverlays(...ids) { for (const id of ids) $(id).classList.add('hidden'); }
const menuOpen = () => !$('menu').classList.contains('hidden');
const resultOpen = () => !$('result').classList.contains('hidden');
const selectOpen = () => !$('select').classList.contains('hidden');
// ---------- 그랑프리 (몬스터 컵): 코스 넷을 차례로 달리고 등수 점수를 더해 종합 순위 ----------
const GP_POINTS = [10, 8, 6, 4, 2, 1];   // 1~6등 점수 (꼴찌도 1점)
const gp = { on: false, race: 0, roster: null, pts: [], places: [], scored: -1 };
const gpLast = () => gp.on && gp.race >= GP_COURSES.length - 1;
function startGP() {
  Object.assign(gp, { on: true, race: 0, roster: null, pts: [0, 0, 0, 0, 0, 0], places: [[], [], [], [], [], []], scored: -1 });
  startRace();
}
function gpScore(order) {   // 레이스가 끝나면 등수대로 점수 (같은 레이스를 두 번 세지 않게)
  if (!gp.on || gp.scored === gp.race) return;
  gp.scored = gp.race;
  order.forEach((k, i) => { gp.pts[k.slot] += GP_POINTS[i] || 0; gp.places[k.slot][gp.race] = i + 1; });
}
function gpStandings() {   // 종합 순위: 점수가 높은 순, 같으면 방금 레이스에서 앞선 순
  return karts.slice().sort((a, b) => gp.pts[b.slot] - gp.pts[a.slot] || gp.places[a.slot][gp.race] - gp.places[b.slot][gp.race]);
}
function resultNext() {   // 결과 화면 첫 버튼 · Enter · 조이콘 버튼: 그랑프리 다음 코스 / 그랑프리 다시 / 한 판 더
  if (gp.on && !gpLast()) { gp.race++; startRace(); }
  else if (gp.on) startGP();
  else startRace();
}
function startRace() {
  setDemoPaused(false);
  sfxInit(); saveSettings();
  game.demo = false; game.paused = false; selStartAt = 0;
  hideOverlays('menu', 'result', 'pause', 'select');
  switchCourse(gp.on ? GP_COURSES[gp.race] : settings.course);
  assignJoyCons();
  setupRace(false);
  game.state = 'countdown'; game.stateT = T(); game.goT = T() + 3.6; game.cd = 4;
  snd.tempo = 1; A.tempo(1);
  for (const p of [0, 1]) { const c = G3.camState[p]; if (c) c.snap = true; }
}
function toMenu() {
  setDemoPaused(false);
  game.demo = true; game.paused = false; selStartAt = 0; gp.on = false;   // 그랑프리 중이었으면 여기서 끝
  hideOverlays('pause', 'result', 'select');
  $('menu').classList.remove('hidden');
  switchCourse(lobbyCourse());   // 그랑프리 마지막 코스에 머물러 있지 않게 메뉴에서 고른 코스로
  setupRace(true);
  game.state = 'race'; game.goT = T();
  snd.tempo = 1; A.tempo(1); A.enginesOff();
  syncMenu();
}
function pause() {
  if (game.paused || !racingNow()) return;
  pausedAt = realNow(); game.paused = true; $('pause').classList.remove('hidden');
  $('pauseSub').textContent = gp.on ? `그랑프리 ${gp.race + 1}번째 코스예요. 나가면 그랑프리가 끝나요.` : '카트는 그대로 기다리고 있어요.';
  $('btnQuit').textContent = gp.on ? '그랑프리 그만두기' : '레이스 설정으로';
  A.enginesOff();
  $('pauseInfo').textContent = gfxInfoText();
}
function resume() {
  if (!game.paused) return;
  pauseOffset += realNow() - pausedAt; game.paused = false; $('pause').classList.add('hidden');
}
function onConfirm() {
  // 결과가 뜬 직후 1.5초는 무시: 경주 중에 버튼을 연타하던 아이가 순위를 보기도 전에 다시 출발하지 않게
  if (resultOpen()) { if (T() - game.stateT > 1.5) resultNext(); return; }
  if (game.paused) { resume(); return; }
  if (menuOpen()) openSelect();
}
function finalOrder() {
  return karts.slice().sort((a, b) => (b.finished ? 1e9 - b.place : b.prog) - (a.finished ? 1e9 - a.place : a.prog));
}
function showResult() {
  game.state = 'result'; game.stateT = T();
  const order = finalOrder();
  order.forEach((k, i) => { k.place = i + 1; });
  gpScore(order);
  const hum = order.filter(k => k.human >= 0), two = settings.mode === '2p' && hum.length === 2;
  const best = hum[0], who = k => two ? `${tagOf(k)} ${nameOf(k)} ` : '';
  let title, body, eyebrow = 'ACROSS THE FINISH LINE', podium = order.slice(0, 3);
  if (gp.on) {
    const st = gpStandings(), bestG = st.find(k => k.human >= 0), rank = st.indexOf(bestG) + 1;
    if (gpLast()) {   // 마지막 코스: 종합 순위로 시상대
      eyebrow = 'MONSTER CUP · FINAL'; podium = st.slice(0, 3);
      title = who(bestG) + (rank === 1 ? '그랑프리 우승!' : `종합 ${rank}위!`);
      for (let i = 0; i < 3; i++) confetti(6, 4.5 + i * 0.6, (i - 1) * 2.4);
    } else {
      eyebrow = `MONSTER CUP · RACE ${gp.race + 1} / ${GP_COURSES.length}`;
      title = `${who(best)}${best.place}등${best.finished ? ' 골인' : ''}! +${GP_POINTS[best.place - 1]}점`;
    }
    body = gpTable(st);
  } else {
    if (two) title = best.place === 1 ? `${tagOf(best)} ${nameOf(best)} 우승!` : `${tagOf(best)} ${nameOf(best)} 승리! · ${best.place}등`;   // 둘 중 앞선 사람
    else title = best && best.place === 1 ? '1등! 우승이에요!' : best ? `${best.place}등으로 골인!` : '레이스 끝!';
    body = '<ol class="result-list">' + order.map(k => `<li class="${k.human >= 0 ? 'me p' + (k.human + 1) : ''}"><b>${k.place}등</b><span class="who">${nameOf(k)}</span><span class="tag">${tagOf(k)}</span><span class="time">${k.finished ? fmtTime(k.finishT) : '—'}</span></li>`).join('') + '</ol>';
  }
  // 기록: 새 기록이면 축하하고, 아니면 이 코스 최고 기록을 다음 목표로 보여 줌
  const recs = [];
  for (const k of hum) {
    if (k.newLap) recs.push(`${who(k)}가장 빠른 바퀴 ${fmtTime(k.bestLap)}`);
    if (k.newRace) recs.push(`${who(k)}${game.laps}바퀴 ${fmtTime(k.finishT)}`);
  }
  if (gpLast() && hum.some(recordable)) { const top = Math.max(...hum.map(k => gp.pts[k.slot])); if (newRecord('gp', top)) recs.push(`그랑프리 ${top}점`); }
  const rc = courseRec(), mark = [rc.lap ? `바퀴 ${fmtTime(rc.lap)}` : '', rc.race && rc.race[game.laps] ? `${game.laps}바퀴 ${fmtTime(rc.race[game.laps])}` : ''].filter(Boolean);
  const recLine = recs.length ? `★ 새 기록! ${recs.join(' · ')}` : mark.length ? `${COURSE.name} 최고 기록 · ${mark.join(' · ')}` : '';
  $('resRecord').textContent = recLine;
  $('resRecord').classList.toggle('hidden', !recLine); $('resRecord').classList.toggle('new', recs.length > 0);
  $('resEyebrow').textContent = eyebrow;
  $('resTitle').textContent = title;
  $('resBody').innerHTML = body;
  // 첫 버튼: 그랑프리 중이면 다음 코스, 끝났으면 그랑프리 다시, 아니면 한 판 더. 그랑프리 중엔 레이서를 못 바꿈
  const mid = gp.on && !gpLast(), next = mid ? COURSES[GP_COURSES[gp.race + 1]] : null;
  $('btnAgain').innerHTML = mid ? `다음 코스 · ${next.name} <span aria-hidden="true">→</span>` : `${gp.on ? '그랑프리 다시!' : '한 판 더!'} <span aria-hidden="true">↗</span>`;
  $('btnReselect').classList.toggle('hidden', mid);
  $('btnMenu').textContent = mid ? '그랑프리 그만두기' : '레이스 설정';
  $('resHint').textContent = `조이콘 버튼 / Enter = ${mid ? '다음 코스' : gp.on ? '그랑프리 다시' : '다시 달리기'}`;
  $('result').classList.toggle('gp-result', gp.on);
  $('result').classList.remove('hidden');
  A.enginesOff(); A.tempo(1);
  snd.holdUntil = Math.max(snd.holdUntil, T() + 2);
  buildPodium(podium);
  G3.trophyOn = gpLast();
}
// 그랑프리 순위표: 종합 순위 · 이름 · 코스마다 등수 칸(금·은·동) · 점수 (+방금 얻은 점수)
function gpTable(st) {
  return '<ol class="result-list gp-list">' + st.map((k, i) => {
    const pl = gp.places[k.slot], got = GP_POINTS[pl[gp.race] - 1] || 0;
    const chips = GP_COURSES.map((_, r) => `<i class="${pl[r] ? 'm' + Math.min(pl[r], 4) : 'todo'}">${pl[r] || ''}</i>`).join('');
    const said = GP_COURSES.map((c, r) => pl[r] ? `${COURSES[c].name} ${pl[r]}등` : '').filter(Boolean).join(', ');
    return `<li class="${k.human >= 0 ? 'me p' + (k.human + 1) : ''}"><b>${i + 1}위</b><span class="who">${nameOf(k)}</span><span class="tag">${tagOf(k)}</span>`
      + `<span class="races" role="img" aria-label="${said}">${chips}</span><span class="pts">${gp.pts[k.slot]}점<small>+${got}</small></span></li>`;
  }).join('') + '</ol>';
}

// ============================================================
// 캐릭터 선택
// ============================================================
const sel = [{ idx: 0, ready: false }, { idx: 1, ready: false }];
let selStartAt = 0, rosterBuilt = false;
const selCPU = i => settings.mode === '1p' && i === 1;
function openSelect() {
  setDemoPaused(false);
  sfxInit(); saveSettings(); buildRoster();
  game.demo = false; game.paused = false; game.state = 'select'; game.stateT = T(); selStartAt = 0; gp.on = false;
  hideOverlays('menu', 'result', 'pause');
  $('select').classList.remove('hidden');
  assignJoyCons();
  for (const i of [0, 1]) { sel[i].idx = settings.chars[i]; sel[i].ready = selCPU(i); }
  karts.length = 0; shots.length = 0; traps.length = 0; balls.length = 0;
  rebuildKarts3D(); buildShowroom();
  renderSelect();
  revealRosterCharacter(sel[0].idx);
}
function selSet(i, k, force) {
  if (game.state !== 'select' || selCPU(i)) return;
  if (sel[i].idx === k && !force) { selReady(i, !sel[i].ready); return; }   // 같은 캐릭터를 또 고르면 준비 토글
  sel[i].idx = k; sel[i].ready = false;
  settings.chars[i] = k; saveSettings();
  selStartAt = 0;
  buildShowroom(i);
  sfx('tick'); renderSelect(); revealRosterCharacter(k);
}
function selMove(i, d, force) {
  if (game.state !== 'select' || selCPU(i)) return;
  if (sel[i].ready && !force) return;
  selSet(i, (sel[i].idx + d + CHARS.length) % CHARS.length, true);
}
function revealRosterCharacter(k) {
  const roster = $('roster');
  if (!roster || !roster.querySelector || !roster.getBoundingClientRect) return;
  const tile = roster.querySelector(`.tile[data-k="${k}"]`);
  if (!tile || !tile.getBoundingClientRect) return;
  const viewport = roster.getBoundingClientRect(), card = tile.getBoundingClientRect();
  if (card.top < viewport.top + 8) roster.scrollTop -= viewport.top + 8 - card.top;
  else if (card.bottom > viewport.bottom - 8) roster.scrollTop += card.bottom - viewport.bottom + 8;
}
function selReady(i, on) {
  if (game.state !== 'select' || selCPU(i) || sel[i].ready === on) return;
  sel[i].ready = on;
  if (on) sfx('ready'); else selStartAt = 0;
  renderSelect();
  if (sel[0].ready && sel[1].ready && !selStartAt) { selStartAt = T() + 1.2; renderSelect(); }
}
function buildRoster() {
  if (rosterBuilt) return;
  rosterBuilt = true;
  const el = $('roster');
  el.innerHTML = CHARS.map((ch, k) => `<button type="button" class="tile" data-k="${k}" aria-label="${ch.name} 캐릭터 선택"><span class="tg t1" aria-hidden="true">1P</span><span class="tg t2" aria-hidden="true">2P</span><canvas width="200" height="200" aria-hidden="true"></canvas><span class="tn">${ch.name}</span><span class="character-type">${ch.tag || '레이서'}</span></button>`).join('');
  if (el.querySelectorAll) el.querySelectorAll('canvas').forEach((c, k) => NC.portrait(c, CHARS[k]));
  const tileOf = e => (e.target && e.target.closest) ? e.target.closest('.tile') : null;
  el.onclick = e => { const tl = tileOf(e); if (tl) selSet(0, +tl.dataset.k); };
  el.oncontextmenu = e => { e.preventDefault(); const tl = tileOf(e); if (tl) { tl.blur(); selSet(settings.mode === '1p' ? 0 : 1, +tl.dataset.k); } };   // 포커스가 남으면 Enter가 P1 선택으로 눌림
}
function selHint(i) {
  if (tilt[i].joy) {
    if (tilt[i].upright) return '조이콘을 가로로 눕혀서 핸들처럼 잡아 주세요';
    const a = Math.round(tilt[i].angle), side = a > 2 ? `오른쪽 ${a}°` : a < -2 ? `왼쪽 ${-a}°` : '가운데';
    return `핸들 확인: ${side} · 기울여서 고르고, 버튼을 누르면 준비`;
  }
  return `키보드 ${i === 0 ? 'A·D로 고르고 W' : '←·→로 고르고 ↑'} = 준비 · 게임패드 A`;
}
function renderSelect() {
  document.querySelectorAll('#roster .tile').forEach(tl => {
    const k = +tl.dataset.k;
    tl.classList.toggle('p1', sel[0].idx === k); tl.classList.toggle('p2', !selCPU(1) && sel[1].idx === k);
  });
  $('selc1').classList.toggle('hidden', settings.mode === '1p');
  for (const i of [0, 1]) {
    $('seln' + i).textContent = CHARS[sel[i].idx].name;
    $('sels' + i).textContent = sel[i].ready ? '준비 완료!' : '고르는 중…';
    $('selc' + i).classList.toggle('rd', sel[i].ready);
    $('selh' + i).textContent = selHint(i);
  }
  $('selMsg').textContent = selStartAt ? '출발선으로 가요!' : (settings.mode === '1p' ? '준비되면 출발! CPU 5명과 달려요' : '둘 다 준비되면 출발!');
}
let selHintT = 0;
function updateSelectHints() {
  if (!selectOpen() || realNow() - selHintT < 0.15) return;
  selHintT = realNow();
  for (const i of [0, 1]) { const el = $('selh' + i), txt = selHint(i); if (el.textContent !== txt) el.textContent = txt; }
}

// ============================================================
// 메뉴 UI
// ============================================================
function inputLabel(pi) {
  const j = JC.list.find(j => j.player === pi);
  if (j) return j.name;
  if (game.padCount > (settings.mode === '1p' ? 0 : pi)) return '게임패드';
  return pi === 0 ? '키보드 W·A·S·D' : '키보드 방향키';
}
function renderSlots() {
  const el = $('slots'); if (!el) return;
  el.innerHTML = [0, 1].map(pi => {
    const solo = settings.mode === '1p' && pi === 1;
    const jcs = JC.list.filter(j => j.player === pi);
    const inputs = solo ? ['CPU 5명과 달리기'] : [...jcs.map(j => j.name + (j.err ? ` ⚠ ${j.err}` : j.ok ? ' ✓' : ' (연결 중)')), pi === 0 ? '키보드 W·A·S·D' : '키보드 방향키'];
    return `<div class="slot"><span class="badge b${pi + 1}">${pi === 0 ? 'P1' : solo ? 'CPU' : 'P2'}</span>
      <div style="flex:1;min-width:0"><div style="font-size:15px">${inputs.join(' · ')}</div>
      <div class="row" style="margin-top:6px;flex-wrap:nowrap"><div class="steer-meter"><i id="m${pi}"></i></div><span id="s${pi}" class="small" style="min-width:150px"></span></div></div></div>`;
  }).join('');
}
// 설정 화면: 조이콘을 기울이면 핸들 눈금이 움직임 (방향이 반대면 '핸들 방향 반대로'를 켜면 됨)
function updateSlotMeters() {
  if (!menuOpen()) return;
  if (realNow() - gfx.infoT > 0.25) { gfx.infoT = realNow(); $('gfxInfo').textContent = gfxInfoText(); }
  for (const pi of [0, 1]) {
    const m = $('m' + pi), s = $('s' + pi); if (!m || !s) continue;
    const v = tilt[pi].joy ? tilt[pi].v : 0;
    m.style.left = (50 + v * 46) + '%';
    let txt = '';
    if (tilt[pi].joy) txt = tilt[pi].upright ? '가로로 잡아 주세요' : `핸들 ${v > 0.05 ? '오른쪽' : v < -0.05 ? '왼쪽' : '가운데'} ${Math.round(Math.abs(tilt[pi].angle))}°`;
    if (s.textContent !== txt) s.textContent = txt;
  }
}
function showWarn(text) { const w = $('hidWarn'); w.textContent = text; w.classList.toggle('hidden', !text); }
// 로비 코스 버튼에 코스 모양 (게임 속 작은 지도와 같은 방향: 오른쪽 x · 아래 z, 주황 점 = 출발선) — 글을 못 읽어도 모양으로 고르게
function courseThumbs() {
  document.querySelectorAll('#courseRow button[data-course]').forEach(b => {
    if (!b.insertAdjacentHTML || b.querySelector('.course-thumb')) return;
    const tr = buildTrack(COURSES[+b.dataset.course].cps), W = 46, H = 32, pad = 3;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i < tr.n; i++) { x0 = Math.min(x0, tr.px[i]); x1 = Math.max(x1, tr.px[i]); z0 = Math.min(z0, tr.pz[i]); z1 = Math.max(z1, tr.pz[i]); }
    const sc = Math.min((W - 2 * pad) / (x1 - x0), (H - 2 * pad) / (z1 - z0)), ox = (W - (x1 - x0) * sc) / 2, oz = (H - (z1 - z0) * sc) / 2;
    const X = i => (ox + (tr.px[i] - x0) * sc).toFixed(1), Z = i => (oz + (tr.pz[i] - z0) * sc).toFixed(1);
    let d = '';
    for (let i = 0; i < tr.n; i += 5) d += `${i ? 'L' : 'M'}${X(i)} ${Z(i)}`;
    b.insertAdjacentHTML('afterbegin', `<svg class="course-thumb" viewBox="0 0 ${W} ${H}" aria-hidden="true"><path d="${d}Z"/><circle cx="${X(0)}" cy="${Z(0)}" r="2.8"/></svg>`);
  });
}
function syncMenu() {
  document.querySelectorAll('#modeRow button').forEach(b => b.classList.toggle('on', b.dataset.mode === settings.mode));
  document.querySelectorAll('#lvRow button').forEach(b => b.classList.toggle('on', +b.dataset.lv === settings.cpuLevel));
  document.querySelectorAll('#lapRow button').forEach(b => b.classList.toggle('on', +b.dataset.laps === settings.laps));
  document.querySelectorAll('#courseRow button').forEach(b => b.classList.toggle('on', b.dataset.gp ? settings.gp : !settings.gp && +b.dataset.course === settings.course));
  document.querySelectorAll('#qRow button').forEach(b => b.classList.toggle('on', b.dataset.q === settings.quality));
  // 시범 레이스 아래 코스 띠: 번호 · 이름 · 특징
  const c = COURSES[settings.course], setText = (id, v) => { const el = $(id); if (el && el.textContent !== v) el.textContent = v; };
  if (settings.gp) {   // 그랑프리: 코스 넷을 바퀴 수만큼씩 → 다 합친 시간
    const min = Math.round(GP_COURSES.reduce((a, i) => a + COURSES[i].lapSec, 0) * settings.laps / 60);
    setText('courseNo', 'GP'); setText('courseName', '몬스터 컵'); setText('courseEn', 'MONSTER CUP'); setText('courseFact', '코스 4개 연달아 · 등수 점수 합산');
    setText('lapHint', `그랑프리: 코스 4개 × ${settings.laps}바퀴 · 모두 약 ${min}분${REC.gp ? ` · 최고 ${REC.gp}점` : ''}`);
  } else {
    setText('courseNo', String(settings.course + 1).padStart(2, '0')); setText('courseName', c.name); setText('courseEn', c.en); setText('courseFact', c.fact);
    const r = REC[settings.course];
    setText('lapHint', `코스: ${c.name} · 한 바퀴 약 ${c.lapSec}초${r && r.lap ? ` · 최고 바퀴 ${fmtTime(r.lap)}` : ''}`);
  }
  $('steer').value = settings.steerAngle; $('steerV').textContent = settings.steerAngle + '°';
  $('autoGas').checked = !!settings.autoGas; $('assist').checked = !!settings.assist;
  for (const i of [0, 1]) $('flip' + i).checked = settings.flip[i];
  for (const [id, k] of VOL) { $(id).value = Math.round(A.vol[k] * 100); $(id + 'V').textContent = Math.round(A.vol[k] * 100) + '%'; }
  $('gfxInfo').textContent = gfxInfoText();
  renderSlots();
}
function toggleFull() {
  try {
    if (document.fullscreenElement) document.exitFullscreen();
    else {
      const p = document.documentElement.requestFullscreen();
      if (p && p.then && navigator.keyboard && navigator.keyboard.lock) p.then(() => navigator.keyboard.lock()).catch(() => {});   // Ctrl+W 같은 브라우저 단축키도 게임 키로 (Esc는 길게 눌러야 전체화면이 풀림)
    }
  } catch (e) { /* 무시 */ }
}
window.addEventListener('beforeunload', e => { if (racingNow()) { e.preventDefault(); e.returnValue = ''; } });

// ============================================================
// 그래픽 단계 · 화면 크기
// ============================================================
const Q = {
  high:   { label: '높음', maxW: 1920, aa: true },
  mid:    { label: '보통', maxW: 1600, aa: true },
  low:    { label: '낮음', maxW: 1280, aa: false },
  lowest: { label: '최저', maxW: 960,  aa: false },
};
const gfx = { level: 'mid', autoLevel: 'mid', locked: false, pending: null, prevFps: 0,
  acc: 0, frames: 0, dispAcc: 0, dispFrames: 0, dispFps: 0, ignoreUntil: 0, note: '', toast: null, lastReal: 0, infoT: 0 };
const hud = $('hud'), hctx = hud.getContext('2d');
const levelFor = q => q === 'auto' ? gfx.autoLevel : Q[q] ? q : 'lowest';   // 테니스의 '2D'는 카트에선 '최저'
function resize() {
  const lv = Q[gfx.level] || Q.mid;
  const stage = $('kartStage');
  const cssW = Math.max(1, stage && stage.clientWidth || window.innerWidth), cssH = Math.max(1, stage && stage.clientHeight || window.innerHeight);
  G3.selectFraming = null;
  const selectScreen = $('select');
  if (selectScreen && !selectScreen.classList.contains('hidden') && selectScreen.querySelector) {
    const top = selectScreen.querySelector('.selection-top'), bottom = selectScreen.querySelector('.selbottom');
    if (top && bottom && top.getBoundingClientRect && bottom.getBoundingClientRect) {
      const a = top.getBoundingClientRect().bottom + 12, b = bottom.getBoundingClientRect().top - 14;
      if (b - a > 90) G3.selectFraming = { height: (b - a) / cssH, center: (a + b) / (2 * cssH) };
    }
  }
  G3.resultFraming = null;   // 결과 창 위쪽 빈 곳 (시상대 자리)
  const resultScreen = $('result'), panel = resultScreen && resultScreen.querySelector && resultScreen.querySelector('.result-panel');
  if (panel && !resultScreen.classList.contains('hidden') && panel.getBoundingClientRect) {
    const top = panel.getBoundingClientRect().top - 8;
    if (top > 100) G3.resultFraming = { height: top / cssH, center: top / (2 * cssH) };
  }
  const dpr = window.devicePixelRatio || 1;
  const pr = Math.max(0.25, Math.min(dpr, lv.maxW / cssW));   // 4K 화면이어도 렌더 해상도는 상한까지만
  hud.width = Math.max(1, Math.round(cssW * pr)); hud.height = Math.max(1, Math.round(cssH * pr));
  G3.cssW = cssW; G3.cssH = cssH;
  if (G3.renderer) { G3.renderer.setPixelRatio(pr); G3.renderer.setSize(cssW, cssH, false); }
  for (const c of G3.camState) c.snap = true;
}
function applyQuality(level) {
  if (!G3.available) { gfx.note = '3D를 켤 수 없어요 (크롬 설정 > 시스템 > 그래픽 가속 사용 켜기)'; resize(); return; }
  ensureScene3D();
  const pr = Q[level];
  if (HEADLESS !== '3d' && (!G3.renderer || G3.aa !== pr.aa) && !initRenderer(pr.aa)) {
    G3.available = false;
    gfx.note = '3D를 켤 수 없어요 (크롬 설정 > 시스템 > 그래픽 가속 사용 켜기)';
    showWarn('이 컴퓨터에서 3D 그래픽을 켤 수 없어서 카트를 달릴 수 없어요. 크롬 설정 > 시스템 > "그래픽 가속 사용"을 켜 주세요.');
  }
  gfx.level = level;
  gfx.ignoreUntil = realNow() + 2.5; gfx.acc = 0; gfx.frames = 0;
  resize();
}
function gfxInfoText() {
  const lv = Q[gfx.level] || Q.mid;
  let s = `지금 ${lv.label}${settings.quality === 'auto' ? ' (자동)' : ''} · ${hud.width}×${hud.height} · ${Math.round(gfx.dispFps || 0)}fps`;
  if (gfx.note) s += ` — ${gfx.note}`;
  return s;
}
function showToast(text) { gfx.toast = { text, t: realNow() }; }
// 자동 모드: 경주 중 2.5초마다 fps를 재서 47 미만이면 한 단계씩 낮춤
const AUTO_ORDER = ['mid', 'low', 'lowest'];
function trackPerf(dt) {
  if (!(dt > 0 && dt < 0.25)) return;
  gfx.dispAcc += dt; gfx.dispFrames++;
  if (gfx.dispAcc >= 0.5) { gfx.dispFps = gfx.dispFrames / gfx.dispAcc; gfx.dispAcc = 0; gfx.dispFrames = 0; }
  const playing = racingNow() && !game.paused;
  if (settings.quality !== 'auto' || gfx.locked || !playing || realNow() < gfx.ignoreUntil || document.hidden) { gfx.acc = 0; gfx.frames = 0; return; }
  gfx.acc += dt; gfx.frames++;
  if (gfx.acc < 2.5) return;
  const fps = gfx.frames / gfx.acc; gfx.acc = 0; gfx.frames = 0;
  autoStep(fps);
}
function autoStep(fps) {
  if (gfx.pending) {
    const from = gfx.pending; gfx.pending = null;
    if (fps < gfx.prevFps * 1.12) {   // 낮췄는데도 그대로면 그래픽 탓이 아님 (화면 주사율 등) → 원래대로
      gfx.locked = true; gfx.autoLevel = from; applyQuality(from);
      gfx.note = '그래픽을 낮춰도 그대로라 원래대로 둠 (TV 출력이 30Hz면 1920×1080 60Hz로)';
      showToast('그래픽 문제는 아니라서 원래대로 — 화면 주사율을 확인해 보세요');
      return;
    }
  }
  if (fps < 47) {
    const i = AUTO_ORDER.indexOf(gfx.level);
    if (i >= 0 && i < AUTO_ORDER.length - 1) {
      gfx.pending = gfx.level; gfx.prevFps = fps;
      gfx.autoLevel = AUTO_ORDER[i + 1];
      applyQuality(gfx.autoLevel);
      showToast(`느려서 그래픽을 '${Q[gfx.autoLevel].label}'(으)로 낮췄어요`);
    }
  }
}

// ============================================================
// 3D — three.js. 정적인 것(길·벽·나무·관중)은 몇 덩어리로 합치고, 카트는 카트당 4번 그리기
// ============================================================
const G3 = { available: typeof THREE !== 'undefined', built: false, renderer: null, aa: null, lost: false, cssW: 1, cssH: 1,
  camState: [], karts: [], showroom: [], podium: [], selectFraming: null, lastT: 0, info: { calls: 0, tris: 0 } };
let K3 = null;   // three.js 임시 객체 (THREE가 있을 때만 생성)
function k3() {
  if (K3) return K3;
  K3 = { v: new THREE.Vector3(), w: new THREE.Vector3(), m: new THREE.Matrix4(), m3: new THREE.Matrix3(), col: new THREE.Color(), q: new THREE.Quaternion(), e: new THREE.Euler(), s: new THREE.Vector3(1, 1, 1) };
  return K3;
}
const lam = (color, extra) => new THREE.MeshLambertMaterial(Object.assign({ color }, extra || {}));
const basic = (color, extra) => new THREE.MeshBasicMaterial(Object.assign({ color }, extra || {}));
function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  return new THREE.CanvasTexture(c);
}
function initRenderer(aa) {
  const canvas = document.createElement('canvas');
  canvas.id = 'gl';
  let r;
  try {
    r = new THREE.WebGLRenderer({ canvas, antialias: aa, powerPreference: 'high-performance', stencil: false });
  } catch (e) {
    console.warn('WebGL을 만들 수 없음', e);
    return false;
  }
  const old = G3.renderer;
  if (old) { try { old.dispose(); old.forceContextLoss(); } catch (e) { /* 무시 */ } }
  const prev = $('gl');
  if (prev) prev.replaceWith(canvas); else $('kartStage').prepend(canvas);
  G3.renderer = r; G3.aa = aa; G3.lost = false;
  // 예전 렌더러를 버릴 때(forceContextLoss) 그 캔버스의 '잃음' 알림이 늦게 와도 지금 렌더러를 멈추지 않게
  canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); if (G3.renderer === r) G3.lost = true; });
  canvas.addEventListener('webglcontextrestored', () => { if (G3.renderer === r) G3.lost = false; });
  for (const t of G3.aniso || []) { t.anisotropy = Math.min(8, r.capabilities.getMaxAnisotropy()); t.needsUpdate = true; }
  return true;
}

// 여러 도형을 위치·색을 구워서 한 덩어리로 (그리기 횟수 줄이기). items: [{ geo, matrix, color }]
function mergeGeoms(items) {
  const K = k3();
  let nv = 0, ni = 0;
  for (const it of items) { nv += it.geo.attributes.position.count; ni += it.geo.index ? it.geo.index.count : it.geo.attributes.position.count; }
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), col = new Float32Array(nv * 3);
  const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
  let vo = 0, io = 0;
  for (const it of items) {
    const g = it.geo, P = g.attributes.position, Nn = g.attributes.normal, m = it.matrix, c = it.color;
    K.m3.getNormalMatrix(m);
    for (let k = 0; k < P.count; k++) {
      K.v.fromBufferAttribute(P, k).applyMatrix4(m);
      const o = (vo + k) * 3;
      pos[o] = K.v.x; pos[o + 1] = K.v.y; pos[o + 2] = K.v.z;
      if (Nn) { K.v.fromBufferAttribute(Nn, k).applyMatrix3(K.m3).normalize(); nor[o] = K.v.x; nor[o + 1] = K.v.y; nor[o + 2] = K.v.z; }
      col[o] = c.r; col[o + 1] = c.g; col[o + 2] = c.b;
    }
    const flip = m.determinant() < 0;   // 거울처럼 뒤집힌 부품은 면 방향도 뒤집어야 보임
    const n = g.index ? g.index.count : P.count, get = g.index ? q => g.index.getX(q) : q => q;
    for (let q = 0; q + 2 < n; q += 3) {
      const a = get(q) + vo, b = get(q + 1) + vo, d = get(q + 2) + vo;
      idx[io++] = a; idx[io++] = flip ? d : b; idx[io++] = flip ? b : d;
    }
    vo += P.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.setIndex(new THREE.BufferAttribute(idx.subarray(0, io), 1));
  out.computeBoundingSphere();
  return out;
}
// 공용 캐릭터 모델(부품 수십 개)을 빛 받는 것 · 안 받는 것(눈 등) 두 덩어리로 합침
function mergeRig(root) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert(), lit = [], unlit = [];
  root.traverse(o => {
    if (!o.isMesh || !o.visible) return;
    const item = { geo: o.geometry, matrix: new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld), color: o.material.color };
    (o.material.isMeshBasicMaterial ? unlit : lit).push(item);
  });
  return { lit: lit.length ? mergeGeoms(lit) : null, unlit: unlit.length ? mergeGeoms(unlit) : null };
}
const partM = (x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => { const K = k3(); K.e.set(rx, ry, rz); K.q.setFromEuler(K.e); return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), K.q.clone(), new THREE.Vector3(sx, sy, sz)); };
// 카트 몸통 (앞 = +Z). 색별로 한 번만 만들어 둠
const kartGeoCache = new Map();
function kartBodyGeo(tint) {
  if (kartGeoCache.has(tint)) return kartGeoCache.get(tint);
  const C = c => new THREE.Color(c), main = C(tint), dark = C(tint).multiplyScalar(0.66), seat = C('#293638'), cream = C('#fff5df'), metal = C('#a9bdc1'), tire = C('#252e32'), hub = C('#f7d772');
  const box = new THREE.BoxGeometry(1, 1, 1), cyl = new THREE.CylinderGeometry(1, 1, 1, 16), sphere = new THREE.SphereGeometry(1, 16, 10), torus = new THREE.TorusGeometry(0.17, 0.04, 6, 18);
  const P = [
    { geo: box, matrix: partM(0, 0.32, 0.05, 0, 0, 0, 1.36, 0.22, 2.2), color: dark },        // 낮은 섀시
    { geo: sphere, matrix: partM(0, 0.48, 0.62, 0, 0, 0, 0.66, 0.29, 0.76), color: main },    // 둥근 앞 덮개
    { geo: box, matrix: partM(0, 0.745, 0.63, -0.10, 0, 0, 0.16, 0.018, 0.64), color: cream }, // 레이싱 스트라이프
    { geo: sphere, matrix: partM(0.7, 0.44, 0.02, 0, 0, 0, 0.23, 0.21, 0.72), color: main }, // 옆 포드
    { geo: sphere, matrix: partM(-0.7, 0.44, 0.02, 0, 0, 0, 0.23, 0.21, 0.72), color: main },
    { geo: box, matrix: partM(0, 0.66, -0.92, 0.12, 0, 0, 0.82, 0.38, 0.14), color: seat },   // 등받이 (낮게: 뒤에서 캐릭터가 잘 보이게)
    { geo: box, matrix: partM(0, 0.53, -0.5, 0, 0, 0, 0.95, 0.12, 0.62), color: seat },        // 의자
    { geo: sphere, matrix: partM(0, 0.31, 1.2, 0, 0, 0, 0.82, 0.12, 0.2), color: cream },    // 둥근 범퍼
    { geo: box, matrix: partM(0, 0.36, -1.18, 0, 0, 0, 1.3, 0.2, 0.2), color: cream },
    { geo: box, matrix: partM(0, 0.6, -1.12, 0, 0, 0, 0.62, 0.34, 0.42), color: metal },      // 엔진
    { geo: cyl, matrix: partM(0.18, 0.66, -1.38, Math.PI / 2, 0, 0, 0.07, 0.36, 0.07), color: metal },   // 배기구
    { geo: cyl, matrix: partM(-0.18, 0.66, -1.38, Math.PI / 2, 0, 0, 0.07, 0.36, 0.07), color: metal },
    { geo: torus, matrix: partM(0, 0.86, -0.12, -0.6, 0, 0), color: seat },                   // 핸들
    { geo: box, matrix: partM(0, 0.86, -1.11, -0.12, 0, 0, 1.57, 0.10, 0.38), color: main }, // 리어 윙
  ];
  for (const sx of [-1, 1]) {
    P.push({ geo: box, matrix: partM(sx * 0.53, 0.63, -1.08, 0, 0, 0, 0.08, 0.42, 0.10), color: seat });
    P.push({ geo: box, matrix: partM(sx * 0.77, 0.88, -1.1, 0, 0, 0, 0.06, 0.20, 0.40), color: cream });
    P.push({ geo: sphere, matrix: partM(sx * 0.4, 0.48, 1.19, 0, 0, 0, 0.14, 0.08, 0.045), color: cream });
    P.push({ geo: box, matrix: partM(sx * 0.44, 0.44, -1.3, 0, 0, 0, 0.23, 0.075, 0.035), color: C('#fa7756') });
  }
  // 바퀴는 따로 (wheelGeo): 굴러가고 앞바퀴는 핸들 따라 꺾임
  const g = mergeGeoms(P);
  box.dispose(); cyl.dispose(); sphere.dispose(); torus.dispose();
  kartGeoCache.set(tint, g);
  return g;
}
// 바퀴 하나 (축 = X, 가운데 = 원점): 타이어 + 크림 휠 + 금색 허브 + 굴러가는 게 보이는 십자 살
const WHEEL = { x: 0.8, y: 0.36, z: 0.82, r: 0.36 };
let wheelGeoCache = null;
function wheelGeo() {
  if (wheelGeoCache) return wheelGeoCache;
  const C = c => new THREE.Color(c), cyl = new THREE.CylinderGeometry(1, 1, 1, 16), box = new THREE.BoxGeometry(1, 1, 1);
  wheelGeoCache = mergeGeoms([
    { geo: cyl, matrix: partM(0, 0, 0, 0, 0, Math.PI / 2, WHEEL.r, 0.32, WHEEL.r), color: C('#252e32') },
    { geo: cyl, matrix: partM(0, 0, 0, 0, 0, Math.PI / 2, 0.22, 0.34, 0.22), color: C('#fff5df') },
    { geo: cyl, matrix: partM(0, 0, 0, 0, 0, Math.PI / 2, 0.11, 0.35, 0.11), color: C('#f7d772') },
    { geo: box, matrix: partM(0, 0, 0, 0, 0, 0, 0.352, 0.05, 0.4), color: C('#293638') },
    { geo: box, matrix: partM(0, 0, 0, Math.PI / 2, 0, 0, 0.352, 0.05, 0.4), color: C('#293638') },
  ]);
  cyl.dispose(); box.dispose();
  return wheelGeoCache;
}
// 카트에 앉은 캐릭터: 다리는 앞으로 뻗고 두 손은 핸들 → 한 덩어리로.
//  가까이 볼 땐 매끈한 모델(hi), 멀리 있으면 면이 적은 모델(lo)로 바꿔 그림 (lodFor)
function buildRider(chIdx, tint, standing = false) {
  const ch = CHARS[chIdx] || CHARS[0], SH = NC.shoulders();
  if (standing) { const rig = NC.build3D(ch, tint, {}); return { rig, root: rig.root, dispose() { rig.dispose(); } }; }   // 시상대: 팔다리가 움직이는 원래 모델
  const root = new THREE.Group(), geos = [], lod = {};
  for (const low of [false, true]) {
    const rig = NC.build3D(ch, tint, { low });
    for (const leg of rig.legs) leg.rotation.x = Math.PI / 2 * 0.95;
    NC.placeLimb(rig.armR, SH.R, NC.nrm(-0.32, -0.3, -0.9));
    NC.placeLimb(rig.armL, SH.L, NC.nrm(0.32, -0.3, -0.9));
    rig.torso.rotation.x = 0.08;
    const m = mergeRig(rig.root);
    rig.dispose();
    const grp = new THREE.Group();
    for (const [geo, mat] of [[m.lit, G3.matLit], [m.unlit, G3.matUnlit]]) if (geo) { grp.add(new THREE.Mesh(geo, mat)); geos.push(geo); }
    root.add(grp); lod[low ? 'lo' : 'hi'] = grp;
  }
  lod.lo.visible = false;
  root.rotation.y = Math.PI;   // 모델은 -Z를 봄 → 카트 앞(+Z)으로
  const sc = 0.8;
  root.scale.set(sc * ch.w, sc * ch.h, sc * ch.w);
  root.position.set(0, 0.36, -0.48);
  return { root, hi: lod.hi, lo: lod.lo, dispose() { for (const g of geos) g.dispose(); } };
}
function lodFor(cam) {   // 내 카트(6~8m 뒤에서 봄)와 바로 옆 카트만 매끈하게. 출발선처럼 몰려 있으면 가까운 3대까지만
  const ms = G3.karts.concat(G3.showroom).map(m => ({ m, d2: m.group.visible ? cam.position.distanceToSquared(m.group.position) : Infinity }));
  ms.sort((a, b) => a.d2 - b.d2);
  ms.forEach(({ m, d2 }, i) => { const near = d2 < 10.5 * 10.5 && i < 3; m.rider.hi.visible = near; m.rider.lo.visible = !near; });
}
function buildKart3D(chIdx, tint) {
  const group = new THREE.Group(), body = new THREE.Group();
  group.add(body);
  body.add(new THREE.Mesh(kartBodyGeo(tint), G3.matLit));
  const rider = buildRider(chIdx, tint);
  const lean = new THREE.Group(); lean.add(rider.root); body.add(lean);
  const blob = new THREE.Mesh(G3.blobGeo, G3.blobMat); blob.rotation.x = -Math.PI / 2;
  G3.scene.add(group, blob);
  return { group, body, lean, blob, rider, dispose() { G3.scene.remove(group, blob); rider.dispose(); } };
}
function rebuildKarts3D() {
  if (!G3.built) return;
  for (const m of G3.karts) m.dispose();
  G3.karts = [];
  for (const k of karts) { k.mesh = buildKart3D(k.ch, k.color); G3.karts.push(k.mesh); }
}
// 캐릭터 선택: 출발선 앞에 P1(왼쪽)·P2(오른쪽) 카트를 세워 둠
function buildShowroom(only = -1) {   // only: 바뀐 사람 카트만 다시 만들기
  if (!G3.built) return;
  const n = settings.mode === '1p' ? 1 : 2, make = i => Object.assign(buildKart3D(sel[i].idx, COLORS[i]), { p: i, popT: T() });
  if (only >= 0 && G3.showroom.length === n && G3.showroom[only]) { G3.showroom[only].dispose(); G3.showroom[only] = make(only); return; }
  for (const m of G3.showroom) m.dispose();
  G3.showroom = [];
  for (let i = 0; i < n; i++) G3.showroom.push(make(i));
}
// 결과: 시상대 위에 1·2·3등 캐릭터 (팔다리가 움직이는 원래 모델로 만세)
function buildPodium(top3) {
  if (!G3.built) return;
  for (const m of G3.podium) m.dispose();
  G3.podium = top3.map((k, i) => {
    const r = buildRider(k.ch, k.color, true);
    G3.scene.add(r.root);
    return Object.assign(r, { place: i + 1, ch: CHARS[k.ch], dispose() { G3.scene.remove(r.root); r.rig.dispose(); } });
  });
}

// 그랑프리 우승 트로피: 금색 컵 + 양쪽 손잡이 + 나무 받침 (결과 화면에서 1등 머리 위)
function buildTrophy() {
  const gold = new THREE.Color('#f5c542'), wood = new THREE.Color('#7a5230'), P = [];
  const cyl = new THREE.CylinderGeometry(1, 1, 1, 20), cup = new THREE.CylinderGeometry(0.42, 0.17, 0.5, 24), ring = new THREE.TorusGeometry(0.17, 0.045, 8, 16), sph = new THREE.SphereGeometry(1, 12, 8);
  P.push({ geo: cyl, matrix: partM(0, 0.06, 0, 0, 0, 0, 0.3, 0.12, 0.3), color: wood });
  P.push({ geo: cyl, matrix: partM(0, 0.21, 0, 0, 0, 0, 0.07, 0.2, 0.07), color: gold });
  P.push({ geo: sph, matrix: partM(0, 0.33, 0, 0, 0, 0, 0.14, 0.06, 0.14), color: gold });
  P.push({ geo: cup, matrix: partM(0, 0.6, 0, 0, 0, 0, 1, 1, 1), color: gold });
  for (const sx of [-1, 1]) P.push({ geo: ring, matrix: partM(sx * 0.42, 0.66, 0, 0, 0, 0, 1, 1.2, 1), color: gold });
  const m = new THREE.Mesh(mergeGeoms(P), new THREE.MeshLambertMaterial({ vertexColors: true, emissive: 0x4a3200 }));
  cyl.dispose(); cup.dispose(); ring.dispose(); sph.dispose();
  const g = new THREE.Group(); g.add(m); g.scale.setScalar(1.3); g.visible = false;
  return g;
}
// 코스 분위기: 하늘·안개·땅·벽·나무·언덕 색과 바다·야자수 같은 장식
const THEMES = {
  meadow: { sky: ['#68bdeb', '#c4e7ed', '#f4efd7'], fog: [0xd5e8df, 170, 620], hemi: [0xe5f4ff, 0x648b62], ground: '#83bd76', dots: 'rgba(40,90,40,0.07)',
    rough: 0x9bc685, curb: ['#ed734d', '#fff4d9'], wall: ['#fff3d6', '#ec7953', '#409f9c'], road: '#47565b', trees: 'round',
    greens: ['#41966c', '#6caf6e', '#4c9e79', '#9ac373', '#6db58b', '#b2ce78'], hills: ['#72bca3', '#96c9a1', '#73b4b1', '#accd97', '#8cbea1'],
    petals: ['#fff2c9', '#f5cd68', '#ed8968', '#e9b7cc'], stem: '#365458' },
  beach: { sky: ['#58a6dd', '#ffcf9a', '#ffe8c4'], fog: [0xf5ddc3, 190, 640], hemi: [0xfff2dd, 0xb99a62], ground: '#ecd6a2', dots: 'rgba(140,100,50,0.08)',
    rough: 0xe3c88f, curb: ['#e9643f', '#fff7e6'], wall: ['#fff7e8', '#f2a541', '#3d9fc6'], road: '#47565b', trees: 'palm',
    greens: ['#3f9a63', '#5fb06a', '#4ea477', '#7cbd62'], hills: ['#5ea98f', '#7cb98c', '#6aa59c', '#8fc29a'],
    petals: ['#ffd9e2', '#fff3e3', '#f6b8a2', '#eadfca'], stem: '#7a9a55', sea: '#3fa9d2', shoreZ: -42, decor: 'beach' },
  snow: { sky: ['#8fbfe6', '#dce9f5', '#f6f1ea'], fog: [0xe4edf5, 150, 560], hemi: [0xf4f8ff, 0xa3b6cb], ground: '#eef3f8', dots: 'rgba(120,150,190,0.10)',
    rough: 0xdde6f0, curb: ['#e5534b', '#ffffff'], wall: ['#ffffff', '#e5534b', '#4a7fb5'], road: '#4f5d68', trees: 'pine',
    hills: ['#a9bccf', '#97adc4', '#b8c8d9', '#8fa7bf'], peaks: true,
    petals: ['#ffffff', '#e9f3ff', '#d6e6f7'], stem: '#8a98a8', decor: 'snow' },
  candy: { sky: ['#f3a9cf', '#fbd6e7', '#fff1e0'], fog: [0xf8dfe9, 160, 600], hemi: [0xfff1f7, 0xd796b6], ground: '#c6ead4', dots: 'rgba(255,255,255,0.14)',
    sprinkles: ['#ff6fa8', '#ffd166', '#7ad3ff', '#a78bfa', '#ffffff'],
    rough: 0xb4e0c4, curb: ['#ff6fa8', '#ffffff'], wall: ['#ffffff', '#ff7eb6', '#7cc9f0'], road: '#6b5262', trees: 'lollipop',
    greens: ['#ff8fc2', '#ffd36e', '#8fd3ff', '#b9a2ff', '#7fe0b0', '#ff9f80'], hills: ['#ffd1e1', '#ffe3a8', '#d8c7ff', '#b8eed8'],
    petals: ['#ff7aa8', '#ffd166', '#7ad3ff', '#a78bfa', '#7fe0b0'], stem: '#ffffff', decor: 'candy' },
  lava: { sky: ['#3b2747', '#a8505a', '#f0a26b'], fog: [0x6a3a44, 150, 560], hemi: [0xffd9c2, 0x5a3434], ground: '#4a3b3d', dots: 'rgba(255,120,60,0.10)',
    rough: 0x6b5557, curb: ['#ff6a2a', '#f3e6d6'], wall: ['#d9cfc4', '#c4553a', '#6a5a72'], road: '#3e3742', trees: 'spire',
    hills: ['#5a4550', '#4d3c48', '#6a4f55', '#3f343f'], peaks: true, cap: '#ff7a3a',
    petals: ['#ff7a3a', '#ffb347', '#ffd166'], stem: '#3a2e30', decor: 'lava' },
};
function ensureScene3D() {
  if (G3.built || !G3.available) return;
  G3.built = true;
  k3();
  const Sc = new THREE.Scene(); G3.scene = Sc;
  G3.aniso = [];
  G3.matLit = new THREE.MeshLambertMaterial({ vertexColors: true });
  G3.matUnlit = new THREE.MeshBasicMaterial({ vertexColors: true });
  const shadow = canvasTex(64, 64, (g, w, h) => {
    const gradient = g.createRadialGradient(w / 2, h / 2, 4, w / 2, h / 2, w / 2);
    gradient.addColorStop(0, 'rgba(24,42,40,0.45)'); gradient.addColorStop(0.55, 'rgba(24,42,40,0.25)'); gradient.addColorStop(1, 'rgba(24,42,40,0)');
    g.fillStyle = gradient; g.fillRect(0, 0, w, h);
  });
  G3.blobGeo = new THREE.PlaneGeometry(3.8, 3.8);
  G3.blobMat = basic(0xffffff, { map: shadow, transparent: true, opacity: 0.85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
  for (let i = 0; i < 2; i++) { G3.camState.push({ cam: new THREE.PerspectiveCamera(52, 16 / 9, 0.25, 900), pos: new THREE.Vector3(), look: new THREE.Vector3(), yaw: 0, snap: true, fov: 52 }); }
  G3.hemi = new THREE.HemisphereLight(0xe5f4ff, 0x648b62, 0.75); Sc.add(G3.hemi);
  const sun = new THREE.DirectionalLight(0xfff0d0, 0.65); sun.position.set(-60, 100, 40); Sc.add(sun);
  buildItemsFx(Sc);
  G3.trophy = buildTrophy(); Sc.add(G3.trophy);
  buildCourse3D();
}
// 코스마다 바뀌는 것(하늘·땅·길·벽·점프대·나무·관중석…)은 한 그룹에: 코스를 바꾸면 통째로 버리고 다시 만듦
function buildCourse3D() {
  const Sc = G3.scene, th = THEMES[COURSE.theme] || THEMES.meadow;
  if (G3.course) { Sc.remove(G3.course); disposeTree(G3.course); }
  if (Sc.background) Sc.background.dispose();
  const grp = new THREE.Group(); G3.course = grp; G3.courseFor = COURSE; Sc.add(grp);
  G3.aniso = []; G3.seaTex = null; G3.zoneTex = []; G3.snowfall = null; G3.jets = [];
  Sc.background = canvasTex(4, 256, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, th.sky[0]); gr.addColorStop(0.65, th.sky[1]); gr.addColorStop(1, th.sky[2]);
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  });
  Sc.fog = new THREE.Fog(...th.fog);
  G3.hemi.color.set(th.hemi[0]); G3.hemi.groundColor.set(th.hemi[1]);
  buildGround(grp, th);
  buildRoad(grp, th);
  buildWalls(grp, th);
  if (COURSE.bridge) buildBridge(grp);
  buildRampAndPanels(grp);
  buildJets(grp);
  buildZones(grp);
  buildScenery(grp, th);
  buildTrackside(grp, th);
  if (G3.renderer) for (const t of G3.aniso) { t.anisotropy = Math.min(8, G3.renderer.capabilities.getMaxAnisotropy()); t.needsUpdate = true; }
}
function disposeTree(obj) {
  obj.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    for (const m of Array.isArray(o.material) ? o.material : o.material ? [o.material] : []) {
      if (m === G3.matLit || m === G3.matUnlit) continue;
      if (m.map) m.map.dispose();
      m.dispose();
    }
  });
}
// 메뉴에서 코스를 바꾸면: 길 다시 계산 + 장면 다시 만들기 (같은 코스면 그대로)
function switchCourse(i) {
  if (COURSES[i] === COURSE && (!G3.built || G3.courseFor === COURSE)) return false;
  loadCourse(i);
  if (G3.built) buildCourse3D();
  for (const c of G3.camState) c.snap = true;
  return true;
}
function buildGround(Sc, th) {
  const tex = canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = th.ground; g.fillRect(0, 0, w, h);
    const rng = mulberry32(7);
    for (let i = 0; i < 900; i++) { g.fillStyle = rng() < 0.5 ? 'rgba(255,255,255,0.06)' : th.dots; g.fillRect(rng() * w, rng() * h, 2, 3); }
    if (th.sprinkles) for (let i = 0; i < 70; i++) {   // 사탕 공원: 땅에 알록달록 스프링클
      g.save(); g.translate(rng() * w, rng() * h); g.rotate(rng() * Math.PI);
      g.fillStyle = th.sprinkles[i % th.sprinkles.length]; g.fillRect(-3, -1, 6, 2); g.restore();
    }
  });
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  if (!th.sea) {
    tex.repeat.set(160, 160);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(1600, 1600), lam(0xffffff, { map: tex }));
    ground.rotation.x = -Math.PI / 2; Sc.add(ground);
    return;
  }
  // 바닷가: 출발선 바깥(관중석 뒤)부터 바다. 모래밭 + 일렁이는 바다 + 하얀 파도 줄
  const land = 900, z0 = th.shoreZ;
  tex.repeat.set(160, land / 10);
  const sand = new THREE.Mesh(new THREE.PlaneGeometry(1600, land), lam(0xffffff, { map: tex }));
  sand.rotation.x = -Math.PI / 2; sand.position.set(0, 0, z0 + land / 2); Sc.add(sand);
  const seaTex = canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = th.sea; g.fillRect(0, 0, w, h);
    const rng = mulberry32(31);
    for (let i = 0; i < 70; i++) { g.fillStyle = `rgba(255,255,255,${0.12 + rng() * 0.18})`; g.fillRect(rng() * w, rng() * h, 10 + rng() * 22, 2); }
  });
  seaTex.wrapS = seaTex.wrapT = THREE.RepeatWrapping; seaTex.repeat.set(50, 25);
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(1600, 800), lam(0xffffff, { map: seaTex }));
  sea.rotation.x = -Math.PI / 2; sea.position.set(0, -0.05, z0 - 400); Sc.add(sea);
  G3.seaTex = seaTex;
  const foam = new THREE.Mesh(new THREE.PlaneGeometry(1600, 2.4), basic(0xffffff, { transparent: true, opacity: 0.8, polygonOffset: true, polygonOffsetFactor: -1 }));
  foam.rotation.x = -Math.PI / 2; foam.position.set(0, -0.02, z0 - 1); Sc.add(foam);
  G3.foam = foam;
}
// 길: 1m마다 왼쪽·오른쪽 끝 점을 이어 띠로. 무늬(가장자리 흰 선·가운데 점선)는 반복 텍스처
function stripGeo(d0, d1, y, vScale = 10) {
  const n = TR.n, pos = new Float32Array((n + 1) * 6), uv = new Float32Array((n + 1) * 4), idx = [];
  for (let i = 0; i <= n; i++) {
    const j = i % n, nx = -TR.tz[j], nz = TR.tx[j], o = i * 6;
    pos[o] = TR.px[j] + nx * d0; pos[o + 1] = y + TR.py[j]; pos[o + 2] = TR.pz[j] + nz * d0;   // 다리 위면 그 높이만큼 올림
    pos[o + 3] = TR.px[j] + nx * d1; pos[o + 4] = y + TR.py[j]; pos[o + 5] = TR.pz[j] + nz * d1;
    uv.set([0, i * TR.step / vScale, 1, i * TR.step / vScale], i * 4);
    if (i < n) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }   // 위를 보는 면
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}
function buildRoad(Sc, th) {
  const tex = canvasTex(128, 256, (g, w, h) => {
    g.fillStyle = th.road; g.fillRect(0, 0, w, h);
    const rng = mulberry32(11);
    for (let i = 0; i < 1400; i++) { g.fillStyle = rng() < 0.5 ? 'rgba(255,255,255,0.07)' : 'rgba(30,20,50,0.07)'; g.fillRect(rng() * w, rng() * h, 2, 2); }
    g.fillStyle = '#fbf7ee'; g.fillRect(3, 0, 5, h); g.fillRect(w - 8, 0, 5, h);       // 가장자리 선
    g.fillStyle = 'rgba(255,250,224,0.48)'; g.fillRect(w / 2 - 0.8, 0, 1.6, h * 0.32); // 가는 가운데 점선
  });
  tex.wrapS = THREE.ClampToEdgeWrapping; tex.wrapT = THREE.RepeatWrapping;
  G3.aniso.push(tex);
  const road = new THREE.Mesh(stripGeo(-TRACK.halfW, TRACK.halfW, 0.02), lam(0xffffff, { map: tex, polygonOffset: true, polygonOffsetFactor: -1 }));
  Sc.add(road);
  // 길과 벽 사이 거친 풀밭 (느려지는 곳)
  const rough = lam(th.rough, { polygonOffset: true, polygonOffsetFactor: -0.5 });
  Sc.add(new THREE.Mesh(stripGeo(TRACK.halfW, TRACK.wall, 0.01), rough), new THREE.Mesh(stripGeo(-TRACK.wall, -TRACK.halfW, 0.01), rough));
  // 커브엔 빨강·흰 연석 (2m마다 색이 바뀌는 칸)
  const pos = [], col = [], idx = [], red = new THREE.Color(th.curb[0]), white = new THREE.Color(th.curb[1]);
  for (const side of [-1, 1]) for (let i = 0; i < TR.n; i++) {
    if (Math.abs(curvSpan(i * TR.step - 6, i * TR.step + 6, true)) < 0.012) continue;
    const j = (i + 1) % TR.n, c = Math.floor(i * TR.step / 2) % 2 ? red : white, v0 = pos.length / 3;
    for (const q of [i, j]) for (const d of [TRACK.halfW, TRACK.halfW + 1.3]) pos.push(TR.px[q] - TR.tz[q] * d * side, 0.03 + TR.py[q], TR.pz[q] + TR.tx[q] * d * side);
    for (let r = 0; r < 4; r++) col.push(c.r, c.g, c.b);
    if (side > 0) idx.push(v0, v0 + 1, v0 + 2, v0 + 1, v0 + 3, v0 + 2); else idx.push(v0, v0 + 2, v0 + 1, v0 + 1, v0 + 2, v0 + 3);   // 둘 다 위를 보게
  }
  const cg = new THREE.BufferGeometry();
  cg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); cg.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  cg.setIndex(idx); cg.computeVertexNormals();
  Sc.add(new THREE.Mesh(cg, new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2 })));
  // 출발선 (체크 무늬): 긴 쪽이 길을 가로지르게
  const chk = canvasTex(256, 32, (g, w, h) => { for (let x = 0; x < 16; x++) for (let y = 0; y < 2; y++) { g.fillStyle = (x + y) % 2 ? '#2f2a3a' : '#fffaf2'; g.fillRect(x * w / 16, y * h / 2, w / 16, h / 2); } });
  const line = new THREE.Mesh(new THREE.PlaneGeometry(TRACK.halfW * 2, 2), lam(0xffffff, { map: chk, polygonOffset: true, polygonOffsetFactor: -3 }));
  const p0 = trackPoint(0, 0);
  line.rotation.set(-Math.PI / 2, 0, Math.atan2(-p0.tx, -p0.tz));
  line.position.set(p0.x, 0.035, p0.z);
  Sc.add(line);
  // 출발 칸 표시 (흰 ㄷ자)
  const gp = [], gi = [];
  for (let g = 0; g < 6; g++) {
    const row = Math.floor(g / 2), col2 = g % 2, s = L - 4.6 - row * 7, d = col2 ? 3.4 : -3.4;
    for (const [ds, dd, w2, l2] of [[0, 0, 2.2, 0.18]]) {
      const v0 = gp.length / 3;
      for (const [a, b] of [[-l2, -w2 / 2], [-l2, w2 / 2], [l2, -w2 / 2], [l2, w2 / 2]]) { const q = trackPoint(s + ds + a, d + dd + b); gp.push(q.x, 0.04, q.z); }
      gi.push(v0, v0 + 1, v0 + 2, v0 + 1, v0 + 3, v0 + 2, v0, v0 + 2, v0 + 1, v0 + 1, v0 + 2, v0 + 3);
    }
  }
  const gg = new THREE.BufferGeometry(); gg.setAttribute('position', new THREE.Float32BufferAttribute(gp, 3)); gg.setIndex(gi);
  Sc.add(new THREE.Mesh(gg, basic(0xfffaf0, { polygonOffset: true, polygonOffsetFactor: -3 })));
}
// 벽: 안쪽 면 · 윗면 · 바깥 면, 4m마다 흰색·빨강
function buildWalls(Sc, th) {
  const pos = [], col = [], idx = [], A1 = new THREE.Color(th.wall[0]), A2 = new THREE.Color(th.wall[1]), A3 = new THREE.Color(th.wall[2]);
  const H1 = 1.0, T1 = 0.7;
  for (const side of [-1, 1]) for (let i = 0; i < TR.n; i++) {
    const j = (i + 1) % TR.n, blk = Math.floor(i * TR.step / 4) % 2, c = blk ? (side > 0 ? A2 : A3) : A1;
    const pt = (q, d, y) => [TR.px[q] - TR.tz[q] * d * side, y + TR.py[q], TR.pz[q] + TR.tx[q] * d * side];
    const quad = (a, b, cc, dd) => { const v0 = pos.length / 3; pos.push(...a, ...b, ...cc, ...dd); for (let r = 0; r < 4; r++) col.push(c.r, c.g, c.b); idx.push(v0, v0 + 1, v0 + 2, v0 + 2, v0 + 1, v0 + 3); };   // 양면 재질로 그림
    const w0 = TRACK.wall, w1 = TRACK.wall + T1;
    quad(pt(i, w0, 0), pt(j, w0, 0), pt(i, w0, H1), pt(j, w0, H1));
    quad(pt(i, w0, H1), pt(j, w0, H1), pt(i, w1, H1), pt(j, w1, H1));
    quad(pt(i, w1, 0), pt(j, w1, 0), pt(i, w1, H1), pt(j, w1, H1));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx); g.computeVertexNormals();
  Sc.add(new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide })));
}
// 2층 다리: 위층 길 양옆을 땅까지 돌벽으로 막아 둑처럼 (아래 길이 지나가는 곳만 뚫어 굴다리로) + 다리 밑면 + 굴다리 안쪽 벽 + 다리 난간 위 성벽 톱니
function buildBridge(Sc) {
  const pos = [], col = [], idx = [], P = [], W1 = TRACK.wall + 0.7, n = TR.n;
  const stone = new THREE.Color('#6d6068'), dark = new THREE.Color('#4a4048'), beam = new THREE.Color('#8a7c84');
  const other = (x, z, i) => {   // 이 점 아래·위에 있는 다른 구간 (s가 60m 넘게 떨어진 곳 중 가장 가까운 점)
    let best = -1, bd = Infinity;
    for (let j = 0; j < n; j++) { if (Math.abs(sdiff(j * TR.step, i * TR.step)) < 60) continue; const dd = (x - TR.px[j]) ** 2 + (z - TR.pz[j]) ** 2; if (dd < bd) { bd = dd; best = j; } }
    return { j: best, dist: Math.sqrt(bd) };
  };
  const side = (i, sd, d = W1) => [TR.px[i] - TR.tz[i] * d * sd, TR.pz[i] + TR.tx[i] * d * sd];
  const quad = (a, b, c, d, color) => { const v0 = pos.length / 3; pos.push(...a, ...b, ...c, ...d); for (let r = 0; r < 4; r++) col.push(color.r, color.g, color.b); idx.push(v0, v0 + 1, v0 + 2, v0 + 2, v0 + 1, v0 + 3); };
  const box = new THREE.BoxGeometry(1, 1, 1);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n, yi = TR.py[i], yj = TR.py[j];
    if (yi > 0.02 || yj > 0.02) for (const sd of [-1, 1]) {   // 위층: 옆 돌벽 (아래 길 위에선 두께 1m 들보만)
      const [ax, az] = side(i, sd), [bx, bz] = side(j, sd), o = other(ax, az, i), open = o.dist < W1 + 0.5 && TR.py[o.j] < yi - 3;
      quad([ax, open ? yi - 1 : 0, az], [bx, open ? yj - 1 : 0, bz], [ax, yi, az], [bx, yj, bz], open ? beam : (Math.floor(i / 3) % 2 ? stone : dark));
      if (i % 3 === 0 && yi > 0.6) {   // 난간 위 톱니
        const [cx, cz] = side(i, sd, TRACK.wall + 0.35);
        P.push({ geo: box, matrix: partM(cx, yi + 1.3, cz, 0, TR.ang[i], 0, 0.8, 0.6, 1.1), color: beam });
      }
    }
    if (yi > 1.5 && yj > 1.5) {   // 다리 밑면 (아래 길에서 올려다봄)
      const [ax, az] = side(i, -1), [bx, bz] = side(j, -1), [cx, cz] = side(i, 1), [dx, dz] = side(j, 1);
      quad([ax, yi - 1, az], [bx, yj - 1, bz], [cx, yi - 1, cz], [dx, yj - 1, dz], dark);
    }
    if (yi < 0.02) for (const sd of [-1, 1]) {   // 아래층: 다리 밑을 지나는 동안 양옆 굴다리 벽
      const [ax, az] = side(i, sd), [bx, bz] = side(j, sd), o = other(ax, az, i), o2 = other(bx, bz, j);
      if (o.dist > W1 + 0.5 || o2.dist > W1 + 0.5 || TR.py[o.j] < 3 || TR.py[o2.j] < 3) continue;
      quad([ax, 0, az], [bx, 0, bz], [ax, TR.py[o.j] - 1, az], [bx, TR.py[o2.j] - 1, bz], Math.floor(i / 3) % 2 ? stone : dark);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx); g.computeVertexNormals();
  Sc.add(new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide })));
  if (P.length) Sc.add(new THREE.Mesh(mergeGeoms(P), G3.matLit));
  box.dispose();
}
// 불기둥: 길 위 검은 구멍 + 솟는 불꽃 (매 프레임 jetState에 맞춰 크기·색)
function buildJets(Sc) {
  if (!JETS.length) return;
  const vent = new THREE.CircleGeometry(1.5, 16), ring = new THREE.RingGeometry(1.5, 2.1, 16), flame = new THREE.CylinderGeometry(0.5, 1.3, 1, 10, 1, true), core = new THREE.CylinderGeometry(0.2, 0.7, 1, 8, 1, true);
  vent.rotateX(-Math.PI / 2); ring.rotateX(-Math.PI / 2); flame.translate(0, 0.5, 0); core.translate(0, 0.5, 0);
  for (const j of JETS) {
    const p = trackPoint(j.s, j.d), grp = new THREE.Group();
    grp.position.set(p.x, p.y, p.z);
    const hole = new THREE.Mesh(vent, basic(0x2a1a1e, { polygonOffset: true, polygonOffsetFactor: -4 })); hole.position.y = 0.05;
    const glow = new THREE.Mesh(ring, basic(0x5a3030, { polygonOffset: true, polygonOffsetFactor: -4 })); glow.position.y = 0.05;
    const fire = new THREE.Mesh(flame, basic(0xff7a2a, { transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    const hot = new THREE.Mesh(core, basic(0xffe08a, { transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    grp.add(hole, glow, fire, hot); Sc.add(grp);
    G3.jets.push({ j, grp, glow, fire, hot });
  }
}
function syncJets(t) {
  for (const J of G3.jets) {
    const st = jetState(J.j, t), up = st >= 1, u = ((t + J.j.phase) % JET.period + JET.period) % JET.period;
    J.glow.material.color.setRGB(0.35 + 0.65 * (up ? 1 : st), 0.19 + 0.3 * (up ? 1 : st), 0.19);
    J.fire.visible = J.hot.visible = up;
    if (!up) continue;
    const grow = Math.min(1, u / 0.18) * Math.min(1, (JET.on - u) / 0.25), flick = 1 + Math.sin(t * 40 + J.j.s) * 0.08;
    J.fire.scale.set(flick, 7 * grow + 0.01, flick); J.hot.scale.set(1, 5 * grow + 0.01, 1);
    if (Math.random() < 0.3) spark(J.grp.position.x + rand(-0.8, 0.8), J.grp.position.y + rand(1, 6) * grow, J.grp.position.z + rand(-0.8, 0.8), Math.random() < 0.5 ? 0xff8a3a : 0xffd166, 0.5, rand(-1, 1), rand(2, 5), rand(-1, 1), 0.5);
  }
}
// 점프대(노랑·검정 줄무늬 쐐기) · 대시 판(움직이는 화살표)
function buildRampAndPanels(Sc) {
  const pos = [], col = [], idx = [], Y = new THREE.Color('#ffd166'), K = new THREE.Color('#5b4a6b'), W = TRACK.halfW + 1;
  const tp = (s, d) => { const p = trackPoint(s, d); return { x: p.x, z: p.z }; };   // trackPoint는 같은 객체를 돌려주므로 복사
  const n = Math.round(RAMP.len / 0.5), e = elevAt(RAMP.s);
  for (let k = 0; k < n; k++) {
    const s0 = RAMP.s + k * 0.5, s1 = s0 + 0.5, h0 = e + RAMP.h * k / n, h1 = e + RAMP.h * (k + 1) / n, c = k % 2 ? Y : K, v0 = pos.length / 3;
    const a = tp(s0, -W), b = tp(s0, W), cpt = tp(s1, -W), d = tp(s1, W);
    pos.push(a.x, h0 + 0.04, a.z, b.x, h0 + 0.04, b.z, cpt.x, h1 + 0.04, cpt.z, d.x, h1 + 0.04, d.z);
    for (let r = 0; r < 4; r++) col.push(c.r, c.g, c.b);
    idx.push(v0, v0 + 1, v0 + 2, v0 + 1, v0 + 3, v0 + 2);
  }
  // 뒤쪽 세로 면 · 옆면
  const e0 = tp(RAMP.s + RAMP.len, -W), e1 = tp(RAMP.s + RAMP.len, W), v0 = pos.length / 3;
  pos.push(e0.x, e, e0.z, e1.x, e, e1.z, e0.x, e + RAMP.h + 0.04, e0.z, e1.x, e + RAMP.h + 0.04, e1.z);
  for (let r = 0; r < 4; r++) col.push(K.r, K.g, K.b);
  idx.push(v0, v0 + 1, v0 + 2, v0 + 2, v0 + 1, v0 + 3);
  for (const side of [-1, 1]) {
    const b0 = tp(RAMP.s, side * W), b1 = tp(RAMP.s + RAMP.len, side * W), u0 = pos.length / 3;
    pos.push(b0.x, e, b0.z, b1.x, e, b1.z, b1.x, e + RAMP.h + 0.04, b1.z);
    for (let r = 0; r < 3; r++) col.push(Y.r, Y.g, Y.b);
    idx.push(u0, u0 + 1, u0 + 2);
  }
  const rg = new THREE.BufferGeometry();
  rg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); rg.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  rg.setIndex(idx); rg.computeVertexNormals();
  Sc.add(new THREE.Mesh(rg, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide })));
  // 대시 판
  const tex = canvasTex(64, 128, (g, w, h) => {
    g.fillStyle = '#ff9b54'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#ffe17d';
    for (let y = 0; y < h; y += 64) { g.beginPath(); g.moveTo(6, y + 44); g.lineTo(w / 2, y + 12); g.lineTo(w - 6, y + 44); g.lineTo(w - 6, y + 60); g.lineTo(w / 2, y + 28); g.lineTo(6, y + 60); g.closePath(); g.fill(); }
  });
  tex.wrapT = THREE.RepeatWrapping;
  G3.panelTex = tex;
  const pp = [], pu = [], pi = [];
  for (const p of PANELS) {
    const v0 = pp.length / 3;
    for (const [ds, dd, u, v] of [[-p.len / 2, -p.w / 2, 0, 0], [-p.len / 2, p.w / 2, 1, 0], [p.len / 2, -p.w / 2, 0, 2], [p.len / 2, p.w / 2, 1, 2]]) { const q = trackPoint(p.s + ds, p.d + dd); pp.push(q.x, q.y + 0.045, q.z); pu.push(u, v); }
    pi.push(v0, v0 + 1, v0 + 2, v0 + 1, v0 + 3, v0 + 2);
  }
  const pg = new THREE.BufferGeometry();
  pg.setAttribute('position', new THREE.Float32BufferAttribute(pp, 3)); pg.setAttribute('uv', new THREE.Float32BufferAttribute(pu, 2)); pg.setIndex(pi);
  Sc.add(new THREE.Mesh(pg, basic(0xffffff, { map: tex, polygonOffset: true, polygonOffsetFactor: -3 })));
}
// 길 위 특수 바닥: 개울(물)·초콜릿(늪)·얼음판. 길을 가로지르는 건 벽 너머까지 흐르고 물가에 돌(사탕),
// 길 한쪽만 덮는 건 모서리가 둥근 웅덩이 + 테두리. 못 피하거나 못 뛰어넘으면 느려지거나(물·초콜릿) 미끄러짐(얼음)
const ZONE_LOOK = {
  water: { base: '#5bc0de', streak: '255,255,255', rim: '#e9dcc0', opacity: 0.9, flow: 0.6, rocks: ['#c9b48a', '#a99a80', '#d8c9a4'] },
  mud: { base: '#6e4330', streak: '178,118,86', rim: '#4a2a1d', opacity: 0.96, flow: 0.2, rocks: ['#ff8fc2', '#ffd36e', '#8fd3ff', '#b9a2ff', '#7fe0b0'] },
  ice: { base: '#cfe7f6', streak: '255,255,255', rim: '#f7fbff', opacity: 0.86, flow: 0 },
  lava: { base: '#ff5a1f', streak: '255,214,102', rim: '#2e2428', opacity: 0.98, flow: 0.35, rocks: ['#3a3036', '#4a3c40', '#2e262b'] },
};
function zoneTexture(type, flowing) {
  const look = ZONE_LOOK[type];
  const tex = canvasTex(64, 64, (g, w, h) => {
    g.fillStyle = look.base; g.fillRect(0, 0, w, h);
    const rng = mulberry32(5);
    if (type === 'ice') {   // 얼음: 가는 금 몇 줄 + 반짝이는 결
      g.strokeStyle = 'rgba(255,255,255,0.7)'; g.lineWidth = 1;
      for (let i = 0; i < 8; i++) {
        let x = 6 + rng() * 52, y = 6 + rng() * 52;
        g.beginPath(); g.moveTo(x, y);
        for (let k = 0; k < 3; k++) { x = clamp(x + (rng() - 0.5) * 24, 1, w - 1); y = clamp(y + (rng() - 0.5) * 24, 1, h - 1); g.lineTo(x, y); }
        g.stroke();
      }
      for (let i = 0; i < 14; i++) { g.fillStyle = `rgba(255,255,255,${0.15 + rng() * 0.25})`; g.fillRect(rng() * w, rng() * h, 6 + rng() * 10, 2); }
      return;
    }
    for (let i = 0; i < 26; i++) { g.fillStyle = `rgba(${look.streak},${0.2 + rng() * 0.3})`; g.fillRect(rng() * w, rng() * h, 2, 8 + rng() * 10); }
  });
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  if (flowing && look.flow) G3.zoneTex.push({ tex, flow: look.flow });
  return tex;
}
function buildZones(Sc) {
  const sets = new Map(), rng = mulberry32(17), sph = new THREE.SphereGeometry(1, 7, 5);
  // s0부터 len만큼, 옆으로 d0~d1인 띠 (rad > 0이면 네 모서리를 둥글게)
  const shape = (out, s0, len, d0, d1, rad, y) => {
    const n = Math.ceil(len * 3), v0 = out.pos.length / 3;
    for (let k = 0; k <= n; k++) {
      const u = len * k / n, e = Math.min(u, len - u), inset = e < rad ? rad - Math.sqrt(Math.max(0, rad * rad - (rad - e) ** 2)) : 0;
      for (const d of [d0 + inset, d1 - inset]) { const p = trackPoint(s0 + u, d); out.pos.push(p.x, p.y + y, p.z); out.uv.push(u / 4, (d - d0) / 8); }
      if (k < n) { const a = v0 + k * 2; out.idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
  };
  for (const z of ZONES) {
    const look = ZONE_LOOK[z.type] || ZONE_LOOK.water, full = z.d1 - z.d0 >= 2 * TRACK.wall, key = z.type + (full ? '~' : '');
    if (!sets.has(key)) sets.set(key, { look, full, type: z.type, fill: { pos: [], uv: [], idx: [] }, rim: { pos: [], uv: [], idx: [] }, rocks: [] });
    const set = sets.get(key);
    if (full) {
      shape(set.fill, z.s, z.len, z.d0, z.d1, 0, 0.045);
      for (let i = 0; i < 40; i++) {   // 물가 조약돌 (초콜릿 강가엔 동글동글 젤리 사탕)
        const edge = i % 2 ? z.s - 0.6 : z.s + z.len + 0.6, d = (rng() - 0.5) * 2 * Math.min(TRACK.wall + 26, z.d1);
        if (Math.abs(d) < TRACK.wall + 1) continue;
        const p = trackPoint(edge + (rng() - 0.5) * 1.5, d), r = 0.3 + rng() * 0.5;
        set.rocks.push({ geo: sph, matrix: partM(p.x, p.y + r * 0.4, p.z, 0, rng() * 3, 0, r, r * 0.6, r), color: new THREE.Color(look.rocks[i % look.rocks.length]) });
      }
    } else {
      const rad = Math.min(1.4, (z.d1 - z.d0) / 2), grow = 0.35;
      shape(set.rim, z.s - grow, z.len + grow * 2, z.d0 - grow, z.d1 + grow, rad + grow, 0.042);
      shape(set.fill, z.s, z.len, z.d0, z.d1, rad, 0.048);
    }
  }
  const geom = o => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(o.pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(o.uv, 2)); g.setIndex(o.idx);
    return g;
  };
  for (const set of sets.values()) {
    const tex = zoneTexture(set.type, set.full);
    Sc.add(new THREE.Mesh(geom(set.fill), basic(0xffffff, { map: tex, transparent: true, opacity: set.look.opacity, polygonOffset: true, polygonOffsetFactor: -4 })));
    if (set.rim.pos.length) Sc.add(new THREE.Mesh(geom(set.rim), basic(set.look.rim, { polygonOffset: true, polygonOffsetFactor: -3.5 })));
    if (set.rocks.length) Sc.add(new THREE.Mesh(mergeGeoms(set.rocks), G3.matLit));
  }
  sph.dispose();
}
// 길에서 이만큼 떨어진 곳인지 (나무·산 놓을 자리 고르기)
function distToTrack(x, z) { locate(x, z, -1); return Math.abs(LOC.d); }
// 야자수 하나 (줄기 마디 다섯 + 처진 잎 일곱 + 코코넛): 정점 색으로 한 덩어리 → 인스턴스로 여러 그루
function palmGeo() {
  const cyl = new THREE.CylinderGeometry(1, 1, 1, 6), cone = new THREE.ConeGeometry(1, 1, 4), sph = new THREE.SphereGeometry(1, 6, 4);
  const bark = new THREE.Color('#9c7650'), bark2 = new THREE.Color('#b68d5f'), leaf = new THREE.Color('#4f9a54'), leaf2 = new THREE.Color('#6db35a'), nut = new THREE.Color('#7a5534');
  const P = [];
  let x = 0, y = 0;
  for (let i = 0; i < 5; i++) {   // 살짝 휘어 올라가는 줄기
    const r = 0.34 - i * 0.03, nx = x + 0.18 + i * 0.05;
    P.push({ geo: cyl, matrix: partM((x + nx) / 2, y + 0.75, 0, 0, 0, -0.12 - i * 0.04, r, 1.55, r), color: i % 2 ? bark2 : bark });
    x = nx; y += 1.5;
  }
  for (let i = 0; i < 7; i++) {   // 우산처럼 처진 잎
    const a = i / 7 * Math.PI * 2;
    P.push({ geo: cone, matrix: partM(x + Math.cos(a) * 1.4, y - 0.35, Math.sin(a) * 1.4, Math.sin(a) * 1.25, 0, -Math.cos(a) * 1.25, 0.45, 3.2, 0.14), color: i % 2 ? leaf2 : leaf });
  }
  for (let i = 0; i < 3; i++) { const a = i * 2.1; P.push({ geo: sph, matrix: partM(x + Math.cos(a) * 0.3, y - 0.25, Math.sin(a) * 0.3, 0, 0, 0, 0.24, 0.24, 0.24), color: nut }); }
  const g = mergeGeoms(P);
  cyl.dispose(); cone.dispose(); sph.dispose();
  return g;
}
// 눈 덮인 전나무 (줄기 + 초록 원뿔 셋, 원뿔마다 끝에 흰 눈): 정점 색 한 덩어리 → 인스턴스
function pineParts(P, base, cyl, cone, tiers = 3) {
  const at = (x, y, z, rx, ry, rz, sx, sy, sz) => base.clone().multiply(partM(x, y, z, rx, ry, rz, sx, sy, sz));
  const snow = new THREE.Color('#f7fbff'), greens = ['#2f6f5a', '#3a7c62', '#2c6656', '#357460'].map(c => new THREE.Color(c));
  P.push({ geo: cyl, matrix: at(0, 0.9, 0, 0, 0, 0, 0.32, 1.8, 0.32), color: new THREE.Color('#7a5a43') });
  for (let i = 0; i < tiers; i++) {
    const f = i / tiers, r = 2.6 * (1 - f * 0.72), h = 3.0 * (1 - f * 0.45), y = 2.2 + i * 5.1 / tiers;
    P.push({ geo: cone, matrix: at(0, y, 0, 0, i * 0.4, 0, r, h, r), color: greens[i % greens.length] });
    P.push({ geo: cone, matrix: at(0, y + h * 0.28, 0, 0, i * 0.4 + 0.2, 0, r * 0.55, h * 0.45, r * 0.55), color: snow });   // 아래 원뿔보다 살짝 넓어서 눈이 덮인 듯
  }
}
function pineGeo() {
  const cyl = new THREE.CylinderGeometry(1, 1, 1, 6), cone = new THREE.ConeGeometry(1, 1, 8), P = [];
  pineParts(P, new THREE.Matrix4(), cyl, cone);
  const g = mergeGeoms(P);
  cyl.dispose(); cone.dispose();
  return g;
}
// 용암 성의 현무암 바위기둥 (어두운 뾰족 바위 둘 + 끝이 빨갛게 달아오름): 정점 색 한 덩어리 → 인스턴스
function spireGeo() {
  const cone = new THREE.ConeGeometry(1, 1, 6), P = [], C = c => new THREE.Color(c);
  P.push({ geo: cone, matrix: partM(0, 3.2, 0, 0, 0, 0, 1.6, 6.4, 1.6), color: C('#3a3036') });
  P.push({ geo: cone, matrix: partM(1.3, 1.8, 0.6, 0, 0.5, 0.15, 0.9, 3.6, 0.9), color: C('#4a3c40') });
  P.push({ geo: cone, matrix: partM(0, 6.1, 0, 0, 0, 0, 0.42, 0.9, 0.42), color: C('#ff7a3a') });
  const g = mergeGeoms(P);
  cone.dispose();
  return g;
}
// 코스 고리 안쪽인지 (길 가운데 선을 다각형으로 보고 반직선 검사)
function insideLoop(x, z) {
  let inside = false;
  for (let i = 0, j = TR.n - 1; i < TR.n; j = i++) {
    const xi = TR.px[i], zi = TR.pz[i], xj = TR.px[j], zj = TR.pz[j];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
// 코스 안쪽 들판에서 길과 가장 먼 자리들 (큰 장식 놓을 곳) → [x, z, 길까지 거리]
function infieldSpots(count, minGap) {
  const cand = [], out = [];
  for (let x = MAP.x0; x <= MAP.x0 + MAP.w; x += 6) for (let z = MAP.z0; z <= MAP.z0 + MAP.h; z += 6) {
    if (Math.hypot(x, z + 34) < 50 || !insideLoop(x, z)) continue;   // 관중석 자리 빼고
    cand.push([x, z, distToTrack(x, z)]);
  }
  cand.sort((a, b) => b[2] - a[2]);
  for (const c of cand) if (out.length < count && c[2] > TRACK.wall + 10 && out.every(o => Math.hypot(o[0] - c[0], o[1] - c[1]) > minGap)) out.push(c);
  return out;
}
function buildScenery(Sc, th) {
  const rng = mulberry32(21), K = k3(), sea = !!th.sea, cx = MAP.x0 + MAP.w / 2, cz = MAP.z0 + MAP.h / 2;
  const marks = th.decor === 'snow' ? infieldSpots(1, 0) : th.decor === 'candy' || th.decor === 'lava' ? infieldSpots(2, 60) : [];   // 코스 안쪽 큰 장식 자리
  // 나무: 둥근 머리 + 줄기 (인스턴스로 두 번에 그림) · 바닷가는 야자수, 눈 마을은 눈 덮인 전나무 (인스턴스 한 번) · 사탕 공원은 막대 사탕
  const spots = [];
  for (let tries = 0; spots.length < (sea ? 120 : 170) && tries < 6000; tries++) {
    const x = cx - 260 + rng() * 520, z = cz - 210 + rng() * 420;   // 코스 둘레로 넓게
    if (distToTrack(x, z) < TRACK.wall + 6 || Math.hypot(x - 0, z + 34) < 46) continue;   // 길 · 관중석 자리 비우기
    if (sea && z < th.shoreZ + 8 || marks.some(([mx, mz]) => Math.hypot(x - mx, z - mz) < 16)) continue;   // 바다 · 큰 장식 자리엔 안 심음
    spots.push([x, z, 0.8 + rng() * 0.7]);
  }
  if (th.trees === 'palm' || th.trees === 'pine' || th.trees === 'spire') {
    const trees = new THREE.InstancedMesh(th.trees === 'palm' ? palmGeo() : th.trees === 'pine' ? pineGeo() : spireGeo(), G3.matLit, spots.length);
    spots.forEach(([x, z, s], i) => { K.e.set(0, rng() * Math.PI * 2, 0); K.q.setFromEuler(K.e); K.m.compose(K.v.set(x, 0, z), K.q, K.w.set(s, s, s)); trees.setMatrixAt(i, K.m); });
    Sc.add(trees);
  } else if (th.trees === 'lollipop') {   // 막대 사탕: 하얀 막대 + 소용돌이 무늬 사탕 (사탕 색은 그루마다)
    const swirl = canvasTex(128, 128, (g, w, h) => {
      g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
      g.strokeStyle = 'rgba(70,20,60,0.24)'; g.lineWidth = 8; g.lineCap = 'round';
      g.beginPath();
      for (let a = 0; a < Math.PI * 8; a += 0.08) { const r = a / (Math.PI * 8) * w * 0.47; g.lineTo(w / 2 + Math.cos(a) * r, h / 2 + Math.sin(a) * r); }
      g.stroke();
    });
    const head = new THREE.CylinderGeometry(2, 2, 0.5, 24); head.rotateX(Math.PI / 2);
    const sticks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.16, 0.16, 4.2, 6), lam(0xfffaf4), spots.length);
    const heads = new THREE.InstancedMesh(head, lam(0xffffff, { map: swirl }), spots.length);
    spots.forEach(([x, z, s], i) => {
      K.m.compose(K.v.set(x, 2.1 * s, z), K.q.identity(), K.w.set(s, s, s)); sticks.setMatrixAt(i, K.m);
      K.e.set(0, rng() * Math.PI, (rng() - 0.5) * 0.3); K.q.setFromEuler(K.e);
      K.m.compose(K.v.set(x, 5.8 * s, z), K.q, K.w.set(s, s, s)); heads.setMatrixAt(i, K.m);
      heads.setColorAt(i, K.col.set(th.greens[Math.floor(rng() * th.greens.length)]));
    });
    Sc.add(sticks, heads);
  } else {
    const crowns = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(2.4, 1), lam(0xffffff), spots.length);
    const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.32, 0.45, 2.6, 6), lam(0x9b7653), spots.length);
    spots.forEach(([x, z, s], i) => {
      K.m.compose(K.v.set(x, 1.3 * s, z), K.q.identity(), K.w.set(s, s, s)); trunks.setMatrixAt(i, K.m);
      K.m.compose(K.v.set(x, (2.6 + 1.8) * s, z), K.q.identity(), K.w.set(s, s * 1.1, s)); crowns.setMatrixAt(i, K.m);
      crowns.setColorAt(i, K.col.set(th.greens[Math.floor(rng() * th.greens.length)]));
    });
    Sc.add(crowns, trunks);
  }
  // 장난감 공원처럼 둥근 언덕 (바닷가는 뒤쪽 땅에만 + 바다 위 작은 섬 · 눈 마을은 꼭대기가 하얀 뾰족산). 정적 지형은 한 덩어리로 그림.
  const mp = [], hill = new THREE.SphereGeometry(1, 16, 10), peak = new THREE.ConeGeometry(1, 1, 7), capWhite = new THREE.Color(th.cap || '#fbfdff');   // 눈 덮인 봉우리 · 용암 성은 불이 이글거리는 화산
  for (let i = 0; i < 18; i++) {
    const a = i / 18 * Math.PI * 2 + rng() * 0.2, r = 380 + rng() * 80, hgt = 60 + rng() * 90, w = 70 + rng() * 60, x = cx + Math.cos(a) * r, z = cz + 3 + Math.sin(a) * r;
    if (sea && z < 120) continue;
    const ry = rng() * 3, col = new THREE.Color(th.hills[i % th.hills.length]);
    if (th.peaks) {
      const top = hgt * 1.3 - 8;
      mp.push({ geo: peak, matrix: partM(x, top - hgt * 0.65, z, 0, ry, 0, w * 0.8, hgt * 1.3, w * 0.8), color: col });
      mp.push({ geo: peak, matrix: partM(x, top - hgt * 0.24 + 0.4, z, 0, ry, 0, w * 0.34, hgt * 0.48, w * 0.34), color: capWhite });
    } else mp.push({ geo: hill, matrix: partM(x, -8, z, 0, ry, 0, w, hgt * 0.75, w * 0.8), color: col });
  }
  if (sea) for (let i = 0; i < 6; i++) {   // 섬: 낮고 넓은 초록 언덕 + 모래 테두리
    const x = -300 + i * 120 + rng() * 40, z = th.shoreZ - 180 - rng() * 220, w = 30 + rng() * 40;
    mp.push({ geo: hill, matrix: partM(x, -2, z, 0, 0, 0, w * 1.2, 2, w * 1.2), color: new THREE.Color(th.ground) });
    mp.push({ geo: hill, matrix: partM(x, -3, z, 0, 0, 0, w, 14 + rng() * 18, w * 0.85), color: new THREE.Color(th.hills[i % th.hills.length]) });
  }
  Sc.add(new THREE.Mesh(mergeGeoms(mp), G3.matLit));
  if (th.decor === 'beach') buildBeachDecor(Sc, th, rng);
  else if (th.decor === 'snow') { buildSnowDecor(Sc, rng, marks); buildSnowfall(Sc); }
  else if (th.decor === 'candy') buildCandyDecor(Sc, rng, marks);
  else if (th.decor === 'lava') { buildLavaDecor(Sc, rng, marks); buildSnowfall(Sc, [1, 0.55, 0.2], -0.55); }   // 불티는 위로 날림
  // 구름
  const cp = [], sph = new THREE.SphereGeometry(1, 10, 7), white = new THREE.Color('#ffffff');
  for (let i = 0; i < 12; i++) {
    const a = rng() * Math.PI * 2, r = 160 + rng() * 220, x = cx + Math.cos(a) * r, z = cz + 3 + Math.sin(a) * r, y = 70 + rng() * 40, s = 8 + rng() * 8;
    for (let k = 0; k < 4; k++) cp.push({ geo: sph, matrix: partM(x + (k - 1.5) * s * 0.9, y + (k % 2) * s * 0.3, z + rng() * 4, 0, 0, 0, s * (0.9 + rng() * 0.5), s * 0.6, s * 0.8), color: white });
  }
  Sc.add(new THREE.Mesh(mergeGeoms(cp), basic(0xffffff, { vertexColors: true, fog: false })));
  // 관중석: 출발선 바깥쪽 계단 + 알록달록 관중
  const sp = [], box = new THREE.BoxGeometry(1, 1, 1), lav = new THREE.Color('#75aaa2'), cre = new THREE.Color('#fff4db'), roofC = new THREE.Color('#ed784f');
  for (let st = 0; st < 4; st++) sp.push({ geo: box, matrix: partM(-5, 0.6 * (st + 1), -24 - st * 2.6, 0, 0, 0, 72, 1.2 * (st + 1), 2.6), color: st % 2 ? lav : cre });
  sp.push({ geo: box, matrix: partM(-5, 9.2, -29, -0.18, 0, 0, 74, 0.3, 10), color: roofC });
  for (const x of [-40, -5, 30]) sp.push({ geo: box, matrix: partM(x, 4.6, -33.6, 0, 0, 0, 0.5, 9.2, 0.5), color: cre });
  Sc.add(new THREE.Mesh(mergeGeoms(sp), G3.matLit));
  const fans = [];
  for (let st = 0; st < 4; st++) for (let x = -38; x <= 28; x += 1.6) if (rng() < 0.82) fans.push([x + rng() * 0.6, 1.2 * (st + 1) + 0.45, -24 - st * 2.6 + rng() * 0.4]);
  const crowd = new THREE.InstancedMesh(new THREE.SphereGeometry(0.42, 8, 6), lam(0xffffff), fans.length);
  const fanCols = ['#f28b82', '#fbbc04', '#a7d1f0', '#c5a3e8', '#81c995', '#f6aea9', '#ffe08a', '#9fb4f2'];
  fans.forEach(([x, y, z], i) => { K.m.compose(K.v.set(x, y, z), K.q.identity(), K.w.set(1, 1.25, 1)); crowd.setMatrixAt(i, K.m); crowd.setColorAt(i, K.col.set(fanCols[Math.floor(rng() * fanCols.length)])); });
  G3.crowd = new THREE.Group(); G3.crowd.add(crowd); Sc.add(G3.crowd);
  // 출발 문 (기둥 둘 + 현수막)
  const banner = canvasTex(512, 64, (g, w, h) => {
    g.fillStyle = '#ed683a'; g.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 16) { g.fillStyle = (x / 16) % 2 ? '#2f2a3a' : '#fffaf2'; g.fillRect(x, 0, 16, 8); g.fillStyle = (x / 16) % 2 ? '#fffaf2' : '#2f2a3a'; g.fillRect(x, h - 8, 16, 8); }
    g.fillStyle = '#fffaf2'; g.font = `900 30px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('NOLJA  MONSTER  KART', w / 2, h / 2 + 1);
  });
  const p0 = trackPoint(0, 0), gate = new THREE.Group(), span = TRACK.halfW + 2;
  const pole = new THREE.CylinderGeometry(0.45, 0.55, 7.2, 10), poleMat = lam(0xfff4e4);
  for (const sd of [-1, 1]) { const m = new THREE.Mesh(pole, poleMat); m.position.set(sd * span, 3.6, 0); gate.add(m); }
  const bar = new THREE.Mesh(new THREE.BoxGeometry(span * 2 + 1.2, 1.8, 0.5), [lam(0xed683a), lam(0xed683a), lam(0xed683a), lam(0xed683a), lam(0xffffff, { map: banner }), lam(0xffffff, { map: banner })]);
  bar.position.set(0, 7.0, 0); gate.add(bar);
  gate.position.set(p0.x, 0, p0.z); gate.rotation.y = Math.atan2(p0.tx, p0.tz);
  Sc.add(gate);
  // 풍선
  const bp = [], bcols = ['#f6a5c0', '#a5d8f6', '#ffe08a', '#c5b3f2', '#9ee0b8'];
  for (let i = 0; i < 9; i++) {
    const x = -60 + i * 13 + rng() * 4, z = -40 - rng() * 8, y = 16 + rng() * 6;
    bp.push({ geo: sph, matrix: partM(x, y, z, 0, 0, 0, 1.6, 2.0, 1.6), color: new THREE.Color(bcols[i % bcols.length]) });
    bp.push({ geo: box, matrix: partM(x, y / 2, z, 0, 0, 0, 0.06, y - 1, 0.06), color: cre });
  }
  Sc.add(new THREE.Mesh(mergeGeoms(bp), G3.matLit));
  // 시상대 (결과 화면에서만 보임)
  const pd = new THREE.Group(), gold = lam(0xf6d36b), silver = lam(0xd6dbe6), bronze = lam(0xe2b08a);
  for (const [z, hgt, mat] of [[0, 1.1, gold], [-2.4, 0.75, silver], [2.4, 0.45, bronze]]) { const m = new THREE.Mesh(new THREE.BoxGeometry(2.2, hgt, 2.2), mat); m.position.set(0, hgt / 2, z); pd.add(m); }
  pd.position.set(6, 0, 0); pd.visible = false; Sc.add(pd); G3.podiumBase = pd;
  sph.dispose(); box.dispose(); hill.dispose(); peak.dispose();
}
// 바닷가 장식: 파라솔·돗자리, 바다 위 돛단배, 곶의 등대 (모두 한 덩어리)
function buildBeachDecor(Sc, th, rng) {
  const P = [], box = new THREE.BoxGeometry(1, 1, 1), cyl = new THREE.CylinderGeometry(1, 1, 1, 8), cone = new THREE.ConeGeometry(1, 1, 8), sph = new THREE.SphereGeometry(1, 8, 6);
  const C = c => new THREE.Color(c), cream = C('#fff8ec'), umb = ['#f2a541', '#e9643f', '#3d9fc6', '#f6c3d3', '#7fc8a9'];
  for (let i = 0; i < 14; i++) {   // 파라솔: 관중석 양옆 모래밭 (벽과 물가 사이)
    const x = i < 7 ? -150 + i * 15 + rng() * 5 : 40 + (i - 7) * 18 + rng() * 6, z = -24 - rng() * 12;
    if (z < th.shoreZ + 3) continue;
    const c = C(umb[i % umb.length]);
    P.push({ geo: cyl, matrix: partM(x, 1.3, z, 0, 0, 0.08, 0.06, 2.6, 0.06), color: cream });
    P.push({ geo: cone, matrix: partM(x + 0.1, 2.7, z, 0, rng(), 0, 1.9, 0.75, 1.9), color: c });
    P.push({ geo: box, matrix: partM(x + 1.4, 0.03, z + 0.4, 0, rng() * 0.6, 0, 1.0, 0.04, 1.9), color: i % 2 ? cream : c });
  }
  for (let i = 0; i < 6; i++) {   // 돛단배
    const x = -260 + i * 100 + rng() * 40, z = th.shoreZ - 60 - rng() * 200, a = rng() * Math.PI * 2;
    P.push({ geo: box, matrix: partM(x, 0.35, z, 0, a, 0, 1.6, 0.7, 4.2), color: i % 2 ? cream : C('#e9643f') });
    P.push({ geo: cyl, matrix: partM(x, 3.2, z, 0, 0, 0, 0.07, 5, 0.07), color: C('#8a6a4a') });
    P.push({ geo: cone, matrix: partM(x, 3.4, z, 0, a, 0, 1.5, 4.6, 0.12), color: i % 3 ? cream : C('#f2a541') });
  }
  const lx = 210, lz = th.shoreZ - 34;   // 등대: 바위 위 빨강·흰 줄무늬 탑
  for (let i = 0; i < 6; i++) P.push({ geo: sph, matrix: partM(lx + (rng() - 0.5) * 16, -1, lz + (rng() - 0.5) * 16, 0, rng(), 0, 6 + rng() * 4, 3 + rng() * 2, 6 + rng() * 4), color: C(i % 2 ? '#a99a80' : '#c2b28e') });
  for (let i = 0; i < 6; i++) P.push({ geo: cyl, matrix: partM(lx, 2.2 + i * 2.6, lz, 0, 0, 0, 2.2 - i * 0.16, 2.6, 2.2 - i * 0.16), color: i % 2 ? C('#e9643f') : cream });
  P.push({ geo: cyl, matrix: partM(lx, 18.4, lz, 0, 0, 0, 1.5, 2.2, 1.5), color: C('#ffe08a') });
  P.push({ geo: cone, matrix: partM(lx, 20.6, lz, 0, 0, 0, 1.9, 2.4, 1.9), color: C('#e9643f') });
  Sc.add(new THREE.Mesh(mergeGeoms(P), G3.matLit));
  box.dispose(); cyl.dispose(); cone.dispose(); sph.dispose();
}
// 길가 장식 자리: 길 옆 (s, 옆으로 몇 m) → 길을 바라보는 기준 행렬. 다른 길·관중석과 겹치면 null
function besideTrack(s, side, out, clear, scale = 1) {
  const p = { ...trackPoint(s, side * (TRACK.wall + out)) };
  if (distToTrack(p.x, p.z) < TRACK.wall + clear || Math.hypot(p.x, p.z + 34) < 46) return null;
  return partM(p.x, 0, p.z, 0, Math.atan2(-side * p.nx, -side * p.nz), 0, scale, scale, scale);   // 앞(+z)이 길 쪽
}
const partAt = (base, x, y, z, rx, ry, rz, sx, sy, sz) => base.clone().multiply(partM(x, y, z, rx, ry, rz, sx, sy, sz));
// 눈꽃 마을: 길가 눈사람, 지붕에 눈 쌓인 오두막 마을, 코스 안쪽의 큰 크리스마스트리
function buildSnowDecor(Sc, rng, marks) {
  const P = [], box = new THREE.BoxGeometry(1, 1, 1), cyl = new THREE.CylinderGeometry(1, 1, 1, 10), cone = new THREE.ConeGeometry(1, 1, 8), sph = new THREE.SphereGeometry(1, 10, 8);
  const C = c => new THREE.Color(c), snow = C('#fbfdff'), coal = C('#2b2f36'), carrot = C('#f08a3c'), scarves = ['#e5534b', '#4a7fb5', '#f2b33d', '#5fae7a'];
  for (let i = 0; i < 16; i++) {   // 눈사람: 몸 둘 + 머리, 당근 코, 숯 눈·단추, 목도리, 모자
    const side = i % 2 ? 1 : -1, b = besideTrack(L * (i + 0.5) / 16, side, 3.5 + rng() * 5, 3, 0.85 + rng() * 0.4);
    if (!b) continue;
    const sc = C(scarves[i % scarves.length]);
    P.push({ geo: sph, matrix: partAt(b, 0, 0.85, 0, 0, 0, 0, 1.0, 0.9, 1.0), color: snow });
    P.push({ geo: sph, matrix: partAt(b, 0, 2.1, 0, 0, 0, 0, 0.72, 0.68, 0.72), color: snow });
    P.push({ geo: sph, matrix: partAt(b, 0, 3.05, 0, 0, 0, 0, 0.5, 0.5, 0.5), color: snow });
    P.push({ geo: cone, matrix: partAt(b, 0, 3.02, 0.62, Math.PI / 2, 0, 0, 0.09, 0.5, 0.09), color: carrot });
    for (const x of [-0.17, 0.17]) P.push({ geo: sph, matrix: partAt(b, x, 3.2, 0.44, 0, 0, 0, 0.07, 0.07, 0.07), color: coal });
    for (const y of [1.95, 2.3]) P.push({ geo: sph, matrix: partAt(b, 0, y, 0.7, 0, 0, 0, 0.08, 0.08, 0.08), color: coal });
    P.push({ geo: cyl, matrix: partAt(b, 0, 2.66, 0, 0, 0, 0, 0.56, 0.2, 0.56), color: sc });
    P.push({ geo: box, matrix: partAt(b, 0.32, 2.35, 0.48, 0.2, 0, 0.15, 0.22, 0.6, 0.08), color: sc });
    P.push({ geo: cyl, matrix: partAt(b, 0, 3.5, 0, 0, 0, 0.08, 0.55, 0.06, 0.55), color: coal });
    P.push({ geo: cyl, matrix: partAt(b, 0, 3.78, 0, 0, 0, 0.08, 0.36, 0.55, 0.36), color: coal });
  }
  const walls = ['#b5523b', '#7a5a43', '#4a7fb5', '#c98b4a', '#5fae7a'];
  for (let i = 0; i < 10; i++) {   // 오두막: 몸통 + 삼각 박공 + 눈 덮인 지붕 두 장 + 굴뚝 · 창문 · 문
    const side = i % 3 ? -1 : 1, b = besideTrack(L * (i + 0.2) / 10, side, 12 + rng() * 14, 10, 0.9 + rng() * 0.3);
    if (!b) continue;
    const wc = C(walls[i % walls.length]);
    P.push({ geo: box, matrix: partAt(b, 0, 1.6, 0, 0, 0, 0, 5, 3.2, 4), color: wc });
    P.push({ geo: box, matrix: partAt(b, 0, 3.2, 0, Math.PI / 4, 0, 0, 4.9, 2.83, 2.83), color: wc });
    for (const sz of [-1, 1]) P.push({ geo: box, matrix: partAt(b, 0, 4.32, sz * 1.12, sz * Math.PI / 4, 0, 0, 5.8, 0.38, 3.4), color: snow });
    P.push({ geo: box, matrix: partAt(b, 1.5, 5.0, -0.9, 0, 0, 0, 0.6, 1.5, 0.6), color: C('#8c3b2e') });
    P.push({ geo: box, matrix: partAt(b, 1.5, 5.8, -0.9, 0, 0, 0, 0.75, 0.18, 0.75), color: snow });
    P.push({ geo: box, matrix: partAt(b, 0, 0.9, 2.02, 0, 0, 0, 1.0, 1.8, 0.1), color: C('#5a3d2c') });
    for (const x of [-1.6, 1.6]) P.push({ geo: box, matrix: partAt(b, x, 1.9, 2.02, 0, 0, 0, 0.9, 0.8, 0.1), color: C('#ffd36e') });
  }
  for (const [x, z] of marks) {   // 크리스마스트리: 큰 전나무 + 반짝이 공 (층마다 초록 아랫단에) + 꼭대기 별 + 선물 상자
    const b = partM(x, 0, z, 0, 0, 0, 2.6, 2.6, 2.6), orn = ['#e5534b', '#f2b33d', '#4a7fb5', '#ff8fc2', '#ffffff'];
    pineParts(P, b, cyl, cone, 4);
    for (let i = 0; i < 4; i++) {
      const f = i / 4, r = 2.6 * (1 - f * 0.72), h = 3.0 * (1 - f * 0.45), y0 = 2.2 + i * 5.1 / 4 - h / 2;   // pineParts와 같은 층 크기
      for (let k = 0; k < 7 - i; k++) {
        const u = 0.08 + rng() * 0.3, a = (k + rng() * 0.5) / (7 - i) * Math.PI * 2, rr = r * (1 - u) + 0.06;
        P.push({ geo: sph, matrix: partAt(b, Math.cos(a) * rr, y0 + h * u, Math.sin(a) * rr, 0, 0, 0, 0.17, 0.17, 0.17), color: C(orn[(i + k) % orn.length]) });
      }
    }
    P.push({ geo: sph, matrix: partAt(b, 0, 7.6, 0, 0, 0, Math.PI / 4, 0.4, 0.4, 0.12), color: C('#ffd84a') });
    for (let i = 0; i < 5; i++) {
      const a = i / 5 * Math.PI * 2 + 0.3, s = 0.5 + rng() * 0.3;
      P.push({ geo: box, matrix: partAt(b, Math.cos(a) * 3, s / 2, Math.sin(a) * 3, 0, a, 0, s, s, s), color: C(orn[(i + 1) % 4]) });
    }
  }
  Sc.add(new THREE.Mesh(mergeGeoms(P), G3.matLit));
  box.dispose(); cyl.dispose(); cone.dispose(); sph.dispose();
}
// 하트 사탕 공원: 길가 지팡이 사탕, 들판의 큰 도넛·컵케이크, 하트 안쪽의 3층 케이크와 아이스크림
function buildCandyDecor(Sc, rng, marks) {
  const P = [], cyl = new THREE.CylinderGeometry(1, 1, 1, 14), cup = new THREE.CylinderGeometry(1, 0.78, 1, 14), cone = new THREE.ConeGeometry(1, 1, 12), sph = new THREE.SphereGeometry(1, 12, 9);
  const hook = new THREE.TorusGeometry(0.9, 0.3, 6, 12, Math.PI), ring = new THREE.TorusGeometry(1.8, 0.85, 10, 22), rope = new THREE.TorusGeometry(1, 0.06, 6, 32);
  const C = c => new THREE.Color(c), red = C('#ff4f6d'), white = C('#fffafa'), frost = ['#ff8fc2', '#7a4a33', '#fff4f8', '#9be8c8', '#ffd36e'].map(C);
  for (let i = 0; i < 18; i++) {   // 지팡이 사탕: 빨강·흰 마디 + 위쪽 고리
    const side = i % 2 ? 1 : -1, b = besideTrack(L * (i + 0.25) / 18, side, 2.5 + rng() * 3, 2, 0.9 + rng() * 0.3);
    if (!b) continue;
    const t = partAt(b, 0, 0, 0, 0, rng() * Math.PI * 2, 0, 1, 1, 1);
    for (let k = 0; k < 6; k++) P.push({ geo: cyl, matrix: partAt(t, 0, 0.4 + k * 0.8, 0, 0, 0, 0, 0.3, 0.8, 0.3), color: k % 2 ? white : red });
    P.push({ geo: hook, matrix: partAt(t, -0.9, 4.8, 0, 0, 0, 0, 1, 1, 1), color: red });
  }
  for (let i = 0; i < 8; i++) {   // 큰 도넛 (누운 반죽 + 위에 바른 크림)
    const side = i % 2 ? -1 : 1, b = besideTrack(L * (i + 0.6) / 8, side, 9 + rng() * 10, 8, 1.6 + rng() * 0.8);
    if (!b) continue;
    P.push({ geo: ring, matrix: partAt(b, 0, 0.8, 0, Math.PI / 2, 0, 0, 1, 1, 0.9), color: C('#e2a865') });
    P.push({ geo: ring, matrix: partAt(b, 0, 1.15, 0, Math.PI / 2, 0, 0, 1.02, 1.02, 0.6), color: frost[i % frost.length] });
  }
  for (let i = 0; i < 8; i++) {   // 큰 컵케이크 (주름 컵 + 크림 + 체리)
    const side = i % 2 ? 1 : -1, b = besideTrack(L * (i + 0.1) / 8, side, 22 + rng() * 14, 18, 2.6 + rng() * 1.2);
    if (!b) continue;
    P.push({ geo: cup, matrix: partAt(b, 0, 0.6, 0, 0, 0, 0, 1, 1.2, 1), color: C(i % 2 ? '#ffb3c7' : '#a8d8ff') });
    P.push({ geo: sph, matrix: partAt(b, 0, 1.45, 0, 0, 0, 0, 1.12, 0.75, 1.12), color: frost[(i + 2) % frost.length] });
    P.push({ geo: cone, matrix: partAt(b, 0, 2.15, 0, 0, 0, 0, 0.62, 0.8, 0.62), color: frost[(i + 2) % frost.length] });
    P.push({ geo: sph, matrix: partAt(b, 0, 2.65, 0, 0, 0, 0, 0.24, 0.24, 0.24), color: C('#e5334b') });
  }
  if (marks[0]) {   // 3층 케이크 + 층마다 크림 테두리 + 초
    const [x, z] = marks[0], b = partM(x, 0, z, 0, 0, 0, 1, 1, 1);
    let y = 0;
    [[9, 4, '#ff9ec7'], [6.6, 3.4, '#fff4e8'], [4.2, 3, '#ff9ec7']].forEach(([r, h, c]) => {
      P.push({ geo: cyl, matrix: partAt(b, 0, y + h / 2, 0, 0, 0, 0, r, h, r), color: C(c) });
      P.push({ geo: rope, matrix: partAt(b, 0, y + h, 0, Math.PI / 2, 0, 0, r, r, r), color: white });
      y += h;
    });
    for (let i = 0; i < 6; i++) {
      const a = i / 6 * Math.PI * 2;
      P.push({ geo: cyl, matrix: partAt(b, Math.cos(a) * 2.6, y + 1, Math.sin(a) * 2.6, 0, 0, 0, 0.22, 2, 0.22), color: C(['#7ad3ff', '#ffd166', '#a78bfa'][i % 3]) });
      P.push({ geo: sph, matrix: partAt(b, Math.cos(a) * 2.6, y + 2.3, Math.sin(a) * 2.6, 0, 0, 0, 0.2, 0.36, 0.2), color: C('#ffb347') });
    }
  }
  if (marks[1]) {   // 아이스크림: 거꾸로 선 과자 콘 + 세 가지 맛
    const [x, z] = marks[1], b = partM(x, 0, z, 0, 0, 0, 1, 1, 1);
    P.push({ geo: cone, matrix: partAt(b, 0, 4.5, 0, Math.PI, 0, 0, 3.2, 9, 3.2), color: C('#e3b06d') });
    [['#ff9ec7', 9.6], ['#9be8c8', 12.6], ['#fff4e0', 15.2]].forEach(([c, y], i) => P.push({ geo: sph, matrix: partAt(b, 0, y, 0, 0, 0, 0, 3.4 - i * 0.5, 3 - i * 0.4, 3.4 - i * 0.5), color: C(c) }));
    P.push({ geo: sph, matrix: partAt(b, 0, 17.4, 0, 0, 0, 0, 0.7, 0.7, 0.7), color: C('#e5334b') });
  }
  Sc.add(new THREE.Mesh(mergeGeoms(P), G3.matLit));
  cyl.dispose(); cup.dispose(); cone.dispose(); sph.dispose(); hook.dispose(); ring.dispose(); rope.dispose();
}
// 용암 성: 코스 안쪽의 성(본성 + 탑 넷 + 깃발)과 용암 분수, 길가 횃불, 들판의 용암 웅덩이
function buildLavaDecor(Sc, rng, marks) {
  const P = [], F = [], box = new THREE.BoxGeometry(1, 1, 1), cyl = new THREE.CylinderGeometry(1, 1, 1, 12), cone = new THREE.ConeGeometry(1, 1, 12), sph = new THREE.SphereGeometry(1, 8, 6);
  const C = c => new THREE.Color(c), wallC = C('#8d8088'), wallD = C('#6d6068'), roof = C('#c4553a'), dark = C('#2a2026'), lava = C('#ff6a2a'), gold = C('#ffd166');
  if (marks[0]) {   // 성: 본성 + 톱니 + 문, 모서리 탑 넷 (빨간 고깔 지붕 + 깃발)
    const [x, z] = marks[0], b = partM(x, 0, z, 0, rng() * Math.PI, 0, 1, 1, 1);
    P.push({ geo: box, matrix: partAt(b, 0, 7, 0, 0, 0, 0, 18, 14, 18), color: wallC });
    for (let k = 0; k < 8; k++) for (const [sx, sz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const u = -7.9 + k * 2.25;
      P.push({ geo: box, matrix: partAt(b, sx ? sx * 8.6 : u, 14.6, sz ? sz * 8.6 : u, 0, 0, 0, 1.2, 1.2, 1.2), color: wallD });
    }
    P.push({ geo: box, matrix: partAt(b, 0, 3, 9.05, 0, 0, 0, 5, 6, 0.3), color: dark });
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        P.push({ geo: cyl, matrix: partAt(b, sx * 9, 10, sz * 9, 0, 0, 0, 3.2, 20, 3.2), color: wallD });
        P.push({ geo: cone, matrix: partAt(b, sx * 9, 23, sz * 9, 0, 0, 0, 4, 6, 4), color: roof });
        P.push({ geo: cyl, matrix: partAt(b, sx * 9, 28, sz * 9, 0, 0, 0, 0.12, 4, 0.12), color: dark });
        P.push({ geo: box, matrix: partAt(b, sx * 9 + 1.1, 29.2, sz * 9, 0, 0, 0, 2.2, 1.3, 0.08), color: gold });
        F.push({ geo: box, matrix: partAt(b, sx * 12.25, 14, sz * 9, 0, 0, 0, 0.2, 1.6, 1), color: gold });   // 탑 창문 불빛
      }
      F.push({ geo: box, matrix: partAt(b, sx * 5, 9, 9.05, 0, 0, 0, 1.4, 2.4, 0.3), color: gold });   // 본성 창문 불빛
    }
  }
  if (marks[1]) {   // 용암 분수: 둥근 돌 테두리 + 이글거리는 웅덩이 + 가운데 솟는 용암
    const [x, z] = marks[1], b = partM(x, 0, z, 0, 0, 0, 1, 1, 1);
    P.push({ geo: cyl, matrix: partAt(b, 0, 0.5, 0, 0, 0, 0, 9, 1, 9), color: wallD });
    F.push({ geo: cyl, matrix: partAt(b, 0, 1.02, 0, 0, 0, 0, 7.8, 0.1, 7.8), color: lava });
    F.push({ geo: cone, matrix: partAt(b, 0, 3, 0, 0, 0, 0, 1.4, 4.5, 1.4), color: C('#ffae3b') });
  }
  for (let i = 0; i < 28; i++) {   // 횃불: 길가 돌기둥 + 불꽃
    const side = i % 2 ? 1 : -1, s = L * (i + 0.4) / 28;
    if (elevAt(s) > 0.3) continue;
    const bm = besideTrack(s, side, 1.4, 1, 1);
    if (!bm) continue;
    P.push({ geo: box, matrix: partAt(bm, 0, 1.1, 0, 0, 0, 0, 0.45, 2.2, 0.45), color: wallD });
    P.push({ geo: cyl, matrix: partAt(bm, 0, 2.3, 0, 0, 0, 0, 0.45, 0.3, 0.45), color: dark });
    F.push({ geo: cone, matrix: partAt(bm, 0, 2.85, 0, 0, 0, 0, 0.36, 0.9, 0.36), color: lava });
    F.push({ geo: sph, matrix: partAt(bm, 0, 2.62, 0, 0, 0, 0, 0.3, 0.3, 0.3), color: gold });
  }
  for (let tries = 0, n = 0; n < 12 && tries < 400; tries++) {   // 들판의 용암 웅덩이
    const x = MAP.x0 - 60 + rng() * (MAP.w + 120), z = MAP.z0 - 20 + rng() * (MAP.h + 80), r = 3 + rng() * 5;
    if (distToTrack(x, z) < TRACK.wall + r + 4 || Math.hypot(x, z + 34) < 50 || marks.some(([mx, mz]) => Math.hypot(x - mx, z - mz) < 26)) continue;
    P.push({ geo: cyl, matrix: partM(x, 0.08, z, 0, 0, 0, r + 0.8, 0.16, r * 0.8 + 0.8), color: dark });
    F.push({ geo: cyl, matrix: partM(x, 0.18, z, 0, 0, 0, r, 0.06, r * 0.8), color: lava });
    n++;
  }
  Sc.add(new THREE.Mesh(mergeGeoms(P), G3.matLit));
  if (F.length) Sc.add(new THREE.Mesh(mergeGeoms(F), G3.matUnlit));   // 불·용암은 빛을 안 받고 늘 밝게
  box.dispose(); cyl.dispose(); cone.dispose(); sph.dispose();
}
// 눈꽃 마을의 내리는 눈: 점 3000개를 카메라 둘레 상자 안에서 돌려 씀 (화면마다 그 카메라 둘레로 · 셰이더에서 계산)
const SNOW_VS = `uniform float uTime; uniform float uScale; uniform float uFall; uniform vec3 uBox; attribute float aSeed; varying float vA;
void main(){
  vec3 p = position;
  p.y -= uTime * uFall * (1.4 + aSeed * 1.2);
  p.x += sin(uTime * 0.8 + aSeed * 6.28) * 1.2; p.z += cos(uTime * 0.6 + aSeed * 9.0) * 0.8;
  vec3 rel = mod(p - cameraPosition + uBox * 0.5, uBox) - uBox * 0.5;
  vec4 mv = viewMatrix * vec4(cameraPosition + rel, 1.0);
  vA = smoothstep(uBox.x * 0.5, uBox.x * 0.3, length(rel.xz));
  gl_PointSize = max(1.0, (0.06 + aSeed * 0.06) * uScale / max(0.5, -mv.z));
  gl_Position = projectionMatrix * mv;
}`;
const SNOW_FS = `uniform vec3 uColor; varying float vA; void main(){ float d = length(gl_PointCoord - vec2(0.5)); if (d > 0.5) discard; gl_FragColor = vec4(uColor, vA * 0.9 * smoothstep(0.5, 0.15, d)); }`;
function buildSnowfall(Sc, color = [1, 1, 1], fall = 1) {   // 용암 성에선 같은 셰이더로 위로 날리는 주황 불티
  const n = 3000, box = [80, 30, 80], pos = new Float32Array(n * 3), seed = new Float32Array(n), rng = mulberry32(77);
  for (let i = 0; i < n; i++) { for (let a = 0; a < 3; a++) pos[i * 3 + a] = rng() * box[a]; seed[i] = rng(); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  const pts = new THREE.Points(g, new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uScale: { value: 600 }, uFall: { value: fall }, uColor: { value: new THREE.Vector3(...color) }, uBox: { value: new THREE.Vector3(...box) } },
    vertexShader: SNOW_VS, fragmentShader: SNOW_FS, transparent: true, depthWrite: false,
  }));
  pts.frustumCulled = false;
  Sc.add(pts); G3.snowfall = pts;
}
// 서킷 브랜딩과 길가의 작은 정원. 표지판 전체가 텍스처 하나·그리기 한 번을 공유.
function buildTrackside(Sc, th) {
  const atlas = canvasTex(1024, 256, (g, w, h) => {
    const labels = ['NOLJA RACING', 'MONSTER CUP', 'LET’S GO!', 'PLAY TOGETHER'];
    const colors = ['#ed683a', '#286f70', '#f5d66d', '#263638'];
    for (let i = 0; i < 4; i++) {
      const x = i * 256;
      g.fillStyle = colors[i]; g.fillRect(x, 0, 256, h);
      g.fillStyle = i === 2 ? '#263638' : '#fff7e5';
      g.font = `900 27px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(labels[i], x + 128, 126, 236);
      for (let k = 0; k < 16; k++) for (let j = 0; j < 2; j++) {
        g.fillStyle = (k + j) % 2 ? '#fff7e5' : '#263638';
        g.fillRect(x + k * 16, 16 + j * 16, 16, 16); g.fillRect(x + k * 16, h - 48 + j * 16, 16, 16);
      }
    }
  });
  G3.aniso.push(atlas);
  const positions = [], uvs = [], indices = [], parts = [];
  const box = new THREE.BoxGeometry(1, 1, 1), flower = new THREE.IcosahedronGeometry(1, 0);
  const ink = new THREE.Color('#365458'), cream = new THREE.Color('#fff2cf'), rng = mulberry32(51);
  for (let i = 0; i < 12; i++) {
    const s = L * (i + 0.35) / 12, side = i % 2 ? -1 : 1;
    if (elevAt(s) > 0.3) continue;   // 다리 위엔 표지판·꽃·말뚝을 안 세움
    const p = { ...trackPoint(s, side * (TRACK.wall + 2.2)) };
    const angle = Math.atan2(p.tz * side, -p.tx * side), m = partM(p.x, 2.6, p.z, 0, angle);
    const v0 = positions.length / 3, point = new THREE.Vector3();
    for (const [x, y, u, v] of [[-4, -1.05, 0, 0], [4, -1.05, 1, 0], [-4, 1.05, 0, 1], [4, 1.05, 1, 1]]) {
      point.set(x, y, 0).applyMatrix4(m); positions.push(point.x, point.y, point.z);
      uvs.push(((i % 4) + 0.008 + u * 0.984) / 4, v);
    }
    indices.push(v0, v0 + 1, v0 + 2, v0 + 1, v0 + 3, v0 + 2);
    for (const x of [-3.2, 3.2]) {
      point.set(x, -1, 0).applyMatrix4(m);
      parts.push({ geo: box, matrix: partM(point.x, 0.85, point.z, 0, angle, 0, 0.12, 1.7, 0.16), color: ink });
    }
  }
  const signs = new THREE.BufferGeometry();
  signs.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  signs.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); signs.setIndex(indices); signs.computeVertexNormals();
  Sc.add(new THREE.Mesh(signs, lam(0xffffff, { map: atlas, side: THREE.DoubleSide })));
  const petals = th.petals, stem = new THREE.Color(th.stem);   // 초원은 꽃, 바닷가는 갯풀과 조개
  for (let i = 0; i < 90; i++) {
    const s = i * L / 90, side = i % 2 ? 1 : -1, p = { ...trackPoint(s, side * (TRACK.wall + 3 + rng() * 5)) };
    if (p.y > 0.3) continue;
    for (let j = 0; j < 3; j++) {
      const x = p.x + (rng() - 0.5) * 2, z = p.z + (rng() - 0.5) * 2, h = 0.25 + rng() * 0.3;
      parts.push({ geo: box, matrix: partM(x, h / 2, z, 0, 0, 0, 0.045, h, 0.045), color: stem });
      parts.push({ geo: flower, matrix: partM(x, h, z, 0, 0, 0, 0.18, 0.12, 0.18), color: new THREE.Color(petals[i % petals.length]) });
    }
  }
  // 낮은 트랙 바깥 마커는 코스 방향을 가리지 않으면서 리듬을 만듦.
  for (let i = 0; i < 40; i++) {
    const p = { ...trackPoint(i * L / 40, (i % 2 ? -1 : 1) * (TRACK.wall + 0.8)) };
    if (p.y > 0.3) continue;
    parts.push({ geo: box, matrix: partM(p.x, 0.7, p.z, 0, 0, 0, 0.15, 1.4, 0.15), color: cream });
  }
  Sc.add(new THREE.Mesh(mergeGeoms(parts), G3.matLit));
  box.dispose(); flower.dispose();
}
// 아이템 상자 · 번개 구슬 · 물방울 함정 · 불꽃(점 입자)
const PT_VS = `attribute float aSize; attribute float aAlpha; attribute vec3 aColor; uniform float uScale; varying float vA; varying vec3 vC;
void main(){ vA = aAlpha; vC = aColor; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = max(1.5, aSize * uScale / max(0.5, -mv.z)); gl_Position = projectionMatrix * mv; }`;
const PT_FS = `varying float vA; varying vec3 vC;
void main(){ float d = length(gl_PointCoord - vec2(0.5)); if (d > 0.5) discard; gl_FragColor = vec4(vC, vA * smoothstep(0.5, 0.32, d)); }`;
function makePoints(n, additive) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(n), 1));
  geo.setAttribute('aAlpha', new THREE.BufferAttribute(new Float32Array(n), 1));
  geo.setAttribute('aColor', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  geo.setDrawRange(0, 0);
  const mat = new THREE.ShaderMaterial({ uniforms: { uScale: { value: 1000 } }, vertexShader: PT_VS, fragmentShader: PT_FS,
    transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending });
  const pts = new THREE.Points(geo, mat); pts.frustumCulled = false; pts.userData.n = n;
  return pts;
}
function buildItemsFx(Sc) {
  const qTex = canvasTex(128, 128, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, w, h); gr.addColorStop(0, '#ffb3d1'); gr.addColorStop(0.5, '#ffe7a3'); gr.addColorStop(1, '#a8d8ff');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 10; g.strokeRect(5, 5, w - 10, h - 10);
    g.fillStyle = '#fffdf8'; g.font = `900 84px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.strokeStyle = 'rgba(120,90,170,0.55)'; g.lineWidth = 8; g.strokeText('?', w / 2, h / 2 + 4); g.fillText('?', w / 2, h / 2 + 4);
  });
  G3.boxes = new THREE.InstancedMesh(new THREE.BoxGeometry(1.25, 1.25, 1.25), lam(0xffffff, { map: qTex, transparent: true, opacity: 0.92 }), BOX_ROWS.length * BOX_D.length);
  Sc.add(G3.boxes);
  G3.shotMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.42, 12, 8), basic(0xfff27a), 12);
  G3.shotMesh.count = 0; Sc.add(G3.shotMesh);
  G3.trapMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), lam(0x7dc8f7, { transparent: true, opacity: 0.85, emissive: 0x16406a }), 16);
  G3.trapMesh.count = 0; Sc.add(G3.trapMesh);
  G3.ballMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.5, 14, 10), lam(0x6ee7a0, { emissive: 0x1d5c3a }), 12);
  G3.ballMesh.count = 0; Sc.add(G3.ballMesh);
  G3.shieldMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 20, 14), basic(0x9be7ff, { transparent: true, opacity: 0.3, depthWrite: false, blending: THREE.AdditiveBlending }), 10);
  G3.magnetMesh = new THREE.InstancedMesh(new THREE.TorusGeometry(1.7, 0.1, 8, 28), basic(0xff8fa3, { transparent: true, opacity: 0.75, depthWrite: false }), 10);
  for (const m of [G3.shieldMesh, G3.magnetMesh]) { m.count = 0; m.frustumCulled = false; Sc.add(m); }
  G3.ptsAdd = makePoints(700, true); G3.ptsNorm = makePoints(420, false);
  Sc.add(G3.ptsAdd, G3.ptsNorm);
  // 모든 카트의 바퀴를 한 번에 (카트 10대 × 4)
  G3.wheels = new THREE.InstancedMesh(wheelGeo(), G3.matLit, 40);
  G3.wheels.count = 0; G3.wheels.frustumCulled = false; Sc.add(G3.wheels);
  G3.wheelEuler = new THREE.Euler(0, 0, 0, 'YXZ');   // 꺾고(Y) → 굴림(X)
}

// ---------- 입자 (불꽃·연기·흙먼지·별) ----------
const parts = [];
function spark(x, y, z, color, size = 0.4, vx = 0, vy = 0, vz = 0, life = 0.35, add = true, grav = 0) {
  if (parts.length > 1000) parts.shift();
  parts.push({ x, y, z, vx, vy, vz, life, max: life, size, color, add, grav });
}
function burst(x, y, z, n, colors, speed, life) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, e = Math.random() * 1.2, sp = speed * (0.5 + Math.random() * 0.6);
    spark(x, y, z, colors[i % colors.length], 0.45, Math.cos(a) * Math.cos(e) * sp, Math.sin(e) * sp + 1, Math.sin(a) * Math.cos(e) * sp, life * (0.7 + Math.random() * 0.6), true, 6);
  }
}
// 골인 꽃가루: 알록달록한 조각이 천천히 떨어짐
const CONFETTI = [0xed683a, 0xf3d572, 0x5ec8ff, 0xff7ad9, 0x7fd18b, 0xfff9ed];
function confetti(x, y, z) {
  for (let i = 0; i < 90; i++) {
    const a = Math.random() * Math.PI * 2, sp = 2 + Math.random() * 5;
    spark(x, y, z, CONFETTI[i % CONFETTI.length], 0.42, Math.cos(a) * sp, 4 + Math.random() * 5, Math.sin(a) * sp, 1.6 + Math.random() * 1.2, false, 5);
  }
}
function updateParticles(dt) {
  for (let i = parts.length - 1; i >= 0; i--) {
    const q = parts[i];
    q.life -= dt;
    if (q.life <= 0) { parts.splice(i, 1); continue; }
    q.vy -= q.grav * dt;
    q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt;
  }
}
// 드리프트 불꽃 · 부스트 불길 · 풀밭 흙먼지 (카트 뒤쪽에서)
function emitKartFx(dt) {
  const chance = clamp(dt * 60, 0, 2);
  for (const k of karts) {
    if (!k.mesh || Math.abs(k.v) < 2 && k.boostT <= 0) continue;
    const fx = Math.sin(k.a), fz = Math.cos(k.a), rx = -fz, rz = fx;
    const back = (side, dist, up) => [k.x - fx * dist + rx * side, k.y + up, k.z - fz * dist + rz * side];
    if (k.drift && !k.air) {
      const lv = k.drift.level, col = lv ? DRIFT[lv].hex : 0xffffff;
      for (const side of [-0.8, 0.8]) if (Math.random() < chance * 0.9) {
        const [x, y, z] = back(side, 0.9, 0.15);
        if (lv) spark(x, y, z, col, 0.34 + lv * 0.08, rand(-1, 1) - fx * 2, rand(1, 3), rand(-1, 1) - fz * 2, 0.25, true, 9);
        else spark(x, y, z, col, 0.7, -fx * 1.5, 0.8, -fz * 1.5, 0.4, false);
      }
    }
    if (k.draft > 0.25 && Math.random() < chance * 0.8) {   // 슬립스트림: 카트 옆으로 흘러가는 바람 줄기
      const [x, y, z] = back(rand(-1.3, 1.3), rand(-0.6, 0.4), rand(0.4, 1.4));
      spark(x, y, z, 0xeaf6ff, 0.28, -fx * 9, 0, -fz * 9, 0.18, true);
    }
    if (k.starT > 0) for (let i = 0; i < 2; i++) if (Math.random() < chance) {   // 반짝 별: 무지개 반짝이
      const a = Math.random() * Math.PI * 2;
      spark(k.x + Math.cos(a) * 1.2, k.y + rand(0.3, 1.8), k.z + Math.sin(a) * 1.2, CONFETTI[Math.floor(Math.random() * 5)], 0.5, rand(-1, 1), rand(0.5, 2), rand(-1, 1), 0.35, true);
    }
    if (k.boostT > 0) for (const side of [-0.18, 0.18]) if (Math.random() < chance) {
      const [x, y, z] = back(side, 1.55, 0.66);
      spark(x, y, z, Math.random() < 0.5 ? 0xff9b3b : 0xffe27a, 0.55, -fx * 4 + rand(-0.5, 0.5), rand(0, 1), -fz * 4 + rand(-0.5, 0.5), 0.22, true);
    }
    if (k.offroad && Math.abs(k.v) > 5 && Math.random() < chance * 0.5) {
      const [x, y, z] = back(rand(-0.8, 0.8), 0.9, 0.2);
      spark(x, y, z, COURSE.theme === 'beach' ? 0xe8cf98 : 0xb59b72, 0.8, -fx * 2, 1.2, -fz * 2, 0.5, false, 2);
    }
    if (k.wet && Math.abs(k.v) > 3) for (let i = 0; i < 2; i++) if (Math.random() < chance) {   // 개울·늪: 물보라 (늪은 초콜릿색)
      const [x, y, z] = back(rand(-0.9, 0.9), 0.7, 0.2), mud = k.zone === 'mud';
      spark(x, y, z, mud ? (Math.random() < 0.5 ? 0x7a4a33 : 0xa8704e) : (Math.random() < 0.5 ? 0x8fd8f2 : 0xffffff), 0.5, rand(-2, 2) - fx * 1.5, rand(2.5, 4.5), rand(-2, 2) - fz * 1.5, 0.5, false, 9);
    }
    if (k.zone === 'ice' && Math.abs(k.v) > 5 && Math.random() < chance * 0.6) {   // 얼음판: 반짝이는 얼음 가루
      const [x, y, z] = back(rand(-0.9, 0.9), 0.8, 0.1);
      spark(x, y, z, 0xeaf6ff, 0.35, rand(-1, 1), rand(0.5, 1.5), rand(-1, 1), 0.4, true);
    }
  }
}

// ---------- 카메라 ----------
// 사람마다 뒤에서 따라가는 카메라. 방향은 카트 진행 방향을 살짝 늦게 따라감 (드리프트하면 카트 옆모습이 보임)
function chaseCam(cs, k, dt, two) {
  const K = K3, f = cs.snap ? 1 : 1 - Math.exp(-dt * 4.5);
  let yaw = k.a;
  const t = T();
  if (game.state === 'countdown' && !game.demo) {   // 출발 전: 앞에서 비추다가 뒤로 돌아감
    const u = smooth(1 - (game.goT - t - 0.6) / 2.6);
    yaw = k.a + Math.PI * (1 - u);
  }
  cs.yaw = cs.snap ? yaw : cs.yaw + wrapA(yaw - cs.yaw) * f;
  let dist = 6.4 + (k.boostT > 0 ? 0.9 : 0), hgt = two ? 2.9 : 2.6;
  if (k.finished) { cs.yaw += dt * 0.5; dist = 7.5; hgt = 2.6; }
  const fx = Math.sin(cs.yaw), fz = Math.cos(cs.yaw), e = elevAt(k.s);   // 점프한 높이만 덜 따라감 (다리 위에선 다리 높이 그대로)
  K.v.set(k.x - fx * dist, e + (k.y - e) * 0.6 + hgt, k.z - fz * dist);
  K.w.set(k.x + fx * 5, e + (k.y - e) * 0.8 + 1.0, k.z + fz * 5);
  if (cs.snap) { cs.pos.copy(K.v); cs.look.copy(K.w); }
  else { cs.pos.lerp(K.v, 1 - Math.exp(-dt * 9)); cs.look.lerp(K.w, 1 - Math.exp(-dt * 12)); }
  const fov = (two ? 38 : 54) + (k.boostT > 0 ? 7 : 0) + clamp(k.v / KART.VMAX, 0, 1.4) * 4;
  cs.fov += (fov - cs.fov) * (cs.snap ? 1 : 1 - Math.exp(-dt * 3));
  cs.snap = false;
}
function placeCam(cs, aspect, shake) {
  const cam = cs.cam;
  cam.position.copy(cs.pos);
  if (shake > 0) cam.position.add(K3.v.set((Math.random() - 0.5) * shake * 0.5, (Math.random() - 0.5) * shake * 0.35, (Math.random() - 0.5) * shake * 0.5));
  cam.lookAt(cs.look);
  if (Math.abs(cam.fov - cs.fov) > 0.01 || Math.abs(cam.aspect - aspect) > 0.001) { cam.fov = cs.fov; cam.aspect = aspect; cam.updateProjectionMatrix(); }
  cam.updateMatrixWorld();
}
// 시범 레이스 카메라: 7초마다 바꿔 가며 (뒤따라가기 · 길가에서 지켜보기)
function demoCam(cs, dt) {
  const t = T(), dc = game.demoCam;
  if (t > dc.until || !karts[dc.kart]) { dc.shot = (dc.shot + 1) % 3; dc.kart = Math.floor(Math.random() * karts.length); dc.until = t + 7; cs.snap = true; if (dc.shot === 1) { const k = karts[dc.kart]; dc.s = wrapS(k.s + 60); dc.side = Math.random() < 0.5 ? -1 : 1; } }
  const k = karts[dc.kart]; if (!k) return;
  if (dc.shot === 1) {   // 길가 고정 카메라가 지나가는 카트를 따라 고개를 돌림
    const p = trackPoint(dc.s, dc.side * (TRACK.wall + 4));
    cs.pos.set(p.x, p.y + 3.2, p.z); cs.look.lerp(K3.v.set(k.x, k.y + 0.8, k.z), cs.snap ? 1 : 1 - Math.exp(-dt * 6));
    cs.fov = 40; cs.snap = false;
    if (sdiff(k.s, dc.s) > 25) dc.until = Math.min(dc.until, t + 0.5);
  } else chaseCam(cs, k, dt, false);
}
function selectCam(cs) {   // 캐릭터 선택: 출발선 앞 카트를 정면에서 (위·아래 메뉴 사이에 오게)
  const cam = cs.cam, fr = G3.selectFraming, tan = Math.tan(cam.fov * Math.PI / 360), aspect = G3.cssW / G3.cssH;
  const n = settings.mode === '1p' ? 1 : 2, width = n === 2 ? 7.4 : 4.2;
  const dist = Math.max(5.2, width / (2 * tan * aspect), fr ? 3.0 / (2 * tan * fr.height) : 0);
  const lookY = 0.95 + (fr ? (fr.center - 0.5) * 2 * dist * tan : 0);
  cs.pos.set(-dist, lookY + 0.9, 0); cs.look.set(0, lookY, 0); cs.fov = 42;
}
// 결과: 시상대(높이 약 3.8m, 너비 7.4m)를 결과 창 위 빈 곳 가운데에 오게
function podiumCam(cs) {
  const fr = G3.resultFraming || { height: 0.5, center: 0.27 }, tan = Math.tan(20 * Math.PI / 180), aspect = G3.cssW / G3.cssH;
  const H = G3.trophyOn ? 5.3 : 3.9;   // 1등이 뛰어오르는 높이까지 (그랑프리 우승이면 머리 위 트로피까지)
  const dist = Math.max(8, H / (2 * tan * fr.height), 7.6 / (2 * tan * aspect));
  const lookY = H * 0.487 + (fr.center - 0.5) * 2 * dist * tan;
  cs.pos.set(6 - dist, lookY + 0.5, 0); cs.look.set(6, lookY, 0); cs.fov = 40;
}

// ---------- 매 프레임 3D 갱신 ----------
function syncKart3D(m, k, t, dt) {
  m.group.visible = m.blob.visible = true;
  m.group.position.set(k.x, k.y, k.z);
  let yaw = k.a;
  const driftYaw = k.drift ? k.drift.dir * (0.3 + 0.18 * clamp(k.steer * k.drift.dir, -1, 1)) : 0;   // 드리프트: 코가 커브 안쪽을 봄
  m.driftYaw = lerp(m.driftYaw || 0, driftYaw, 1 - Math.exp(-dt * 9));   // 홱 꺾이지 않고 부드럽게 기울었다 돌아옴
  yaw -= m.driftYaw;
  if (k.spinT > 0) yaw += (1 - k.spinT / 1.25) * Math.PI * 4;
  m.group.rotation.y = yaw;
  // 서스펜션: 가속하면 코가 들리고 브레이크면 숙임, 착지하면 살짝 눌렸다 펴짐
  const acc = dt > 0 ? (k.v - (m.lastV == null ? k.v : m.lastV)) / dt : 0;
  m.lastV = k.v; m.pitch = lerp(m.pitch || 0, clamp(-acc * 0.006, -0.07, 0.07), 1 - Math.exp(-dt * 8));
  const tu = (t - k.trickT) / 0.5, lu = (t - k.landT) / 0.3;
  m.body.rotation.set(k.air ? clamp(-k.vy * 0.03, -0.3, 0.3) : m.pitch, tu >= 0 && tu < 1 ? smooth(tu) * Math.PI * 2 : 0, k.steer * 0.06 * clamp(k.v / KART.VMAX, 0, 1));
  const squash = lu >= 0 && lu < 1 ? Math.sin(lu * Math.PI) * 0.14 : 0;
  m.body.scale.set(1 + squash * 0.4, 1 - squash, 1 + squash * 0.4);
  m.body.position.y = !k.air && Math.abs(k.v) > 1 ? Math.abs(Math.sin(t * 22 + k.slot)) * 0.03 : 0;
  m.steer = k.steer; m.spinRate = k.air ? (m.spinRate || 0) : k.v / WHEEL.r;
  m.lean.rotation.z = -k.steer * 0.16;
  m.lean.position.y = k.spinT > 0 ? 0 : Math.abs(Math.sin(t * 9 + k.slot * 2)) * 0.02;
  m.group.visible = !(k.immuneT > 0 && k.spinT <= 0 && Math.floor(t * 12) % 2 === 1);   // 맞은 뒤 무적일 땐 깜빡
  const gy = groundAt(k.s, k.d);
  m.blob.position.set(k.x, gy + 0.05, k.z);
  m.blob.scale.setScalar(clamp(1 - (k.y - gy) * 0.15, 0.4, 1));
}
function sync3D(dt) {
  const t = T();
  const raceView = !['select', 'result'].includes(game.state);
  for (const m of G3.karts) m.group.visible = m.blob.visible = false;
  if (raceView) karts.forEach(k => { if (k.mesh) syncKart3D(k.mesh, k, t, dt); });
  // 캐릭터 선택 쇼룸
  G3.showroom.forEach((m, i) => {
    const show = game.state === 'select';
    m.group.visible = m.blob.visible = show;
    if (!show) return;
    const z = G3.showroom.length === 2 ? (i ? 2.5 : -2.5) : 0, ready = sel[m.p].ready, pu = t - m.popT;
    const pop = pu >= 0 && pu < 0.8 ? 1 + 0.2 * Math.exp(-7 * pu) * Math.sin(18 * pu) : 1;
    m.group.position.set(0, ready ? Math.abs(Math.sin(t * 6)) * 0.18 : 0, z);
    m.group.rotation.y = -Math.PI / 2 + Math.sin(t * 0.8 + i) * 0.45;
    m.group.scale.setScalar(pop);
    m.body.rotation.set(0, 0, 0); m.lean.rotation.z = Math.sin(t * 2.2 + i) * 0.08;
    m.blob.position.set(0, 0.05, z);
    m.steer = Math.sin(t * 1.3 + i) * 0.6; m.spinRate = 0;   // 선택 화면: 앞바퀴를 좌우로 꺾어 보임
  });
  syncWheels(dt);
  // 시상대
  G3.podiumBase.visible = game.state === 'result';
  G3.podium.forEach(r => {
    const show = game.state === 'result';
    r.root.visible = show;
    if (!show) return;
    const z = r.place === 1 ? 0 : r.place === 2 ? -2.4 : 2.4, top = r.place === 1 ? 1.1 : r.place === 2 ? 0.75 : 0.45;
    r.root.position.set(6, top + (r.place === 1 ? Math.abs(Math.sin(t * 6.5)) * 0.3 : 0), z);
    r.root.rotation.y = Math.PI / 2;
    r.root.scale.set(r.ch.w, r.ch.h, r.ch.w);
    const pose = r.place === 1 ? NC.poses.celebrate(t) : NC.poses.cheer(t + r.place), SH = NC.shoulders();
    r.rig.torso.rotation.set(pose.lean || 0, pose.twist, 0); r.rig.head.rotation.x = pose.nod || 0;
    NC.placeLimb(r.rig.armR, SH.R, pose.dR); NC.placeLimb(r.rig.armL, SH.L, pose.dL);
  });
  // 그랑프리 우승 트로피: 1등 머리 위에서 빙글빙글
  const win = G3.podium.find(r => r.place === 1), tw = G3.trophy;
  tw.visible = game.state === 'result' && !!G3.trophyOn && !!win;
  if (tw.visible) { tw.position.set(6, win.root.position.y + 2.05 * win.ch.h + 0.3 + Math.sin(t * 2.2) * 0.08, 0); tw.rotation.y = t * 1.6; }
  // 아이템 상자 (빙글빙글 · 무지개빛)
  const K = K3, bm = G3.boxes;
  boxes.forEach((b, i) => {
    const sc = b.alive ? 1 : 0;
    K.e.set(t * 0.9 + i, t * 1.3 + i * 0.7, 0.4); K.q.setFromEuler(K.e);
    K.m.compose(K.v.set(b.x, b.y + 1.25 + Math.sin(t * 2.4 + i) * 0.15, b.z), K.q, K.w.set(sc, sc, sc));
    bm.setMatrixAt(i, K.m);
    bm.setColorAt(i, K.col.setHSL((t * 0.25 + i * 0.13) % 1, 0.75, 0.82));
  });
  bm.instanceMatrix.needsUpdate = true; if (bm.instanceColor) bm.instanceColor.needsUpdate = true;
  bm.visible = raceView;
  G3.shotMesh.count = raceView ? Math.min(shots.length, 12) : 0;
  for (let i = 0; i < G3.shotMesh.count; i++) { const s = shots[i], k = 1 + Math.sin(t * 30 + i) * 0.15; K.m.compose(K.v.set(s.x, s.y, s.z), K.q.identity(), K.w.set(k, k, k)); G3.shotMesh.setMatrixAt(i, K.m); }
  G3.shotMesh.instanceMatrix.needsUpdate = true;
  G3.trapMesh.count = raceView ? Math.min(traps.length, 16) : 0;
  for (let i = 0; i < G3.trapMesh.count; i++) { const tr = traps[i], k = 1 + Math.sin(t * 4 + i) * 0.06; K.m.compose(K.v.set(tr.x, tr.y + 0.03, tr.z), K.q.identity(), K.w.set(0.95 * k, 0.35, 0.95 * k)); G3.trapMesh.setMatrixAt(i, K.m); }
  G3.trapMesh.instanceMatrix.needsUpdate = true;
  G3.ballMesh.count = raceView ? Math.min(balls.length, 12) : 0;
  for (let i = 0; i < G3.ballMesh.count; i++) { const b = balls[i]; K.e.set(t * 7 + i, t * 5, 0); K.q.setFromEuler(K.e); K.m.compose(K.v.set(b.x, b.y, b.z), K.q, K.w.set(1, 1, 1)); G3.ballMesh.setMatrixAt(i, K.m); }
  G3.ballMesh.instanceMatrix.needsUpdate = true;
  // 보호막: 카트를 감싼 방울 (끝나기 2초 전부터 깜빡) · 자석: 카트 둘레를 도는 고리
  let ns = 0, nmg = 0;
  if (raceView) for (const k of karts) {
    if (!k.mesh || !k.mesh.group.visible) continue;
    if (k.shieldT > 0 && ns < 10 && (k.shieldT > 2 || Math.floor(t * 8) % 2 === 0)) { const sc = 1.85 + Math.sin(t * 6 + k.slot) * 0.06; K.m.compose(K.v.set(k.x, k.y + 0.95, k.z), K.q.identity(), K.w.set(sc, sc * 0.82, sc)); G3.shieldMesh.setMatrixAt(ns++, K.m); }
    if (k.magnetT > 0 && nmg < 10) { K.e.set(Math.PI / 2, 0, t * 6); K.q.setFromEuler(K.e); const sc = 1 + Math.sin(t * 14) * 0.12; K.m.compose(K.v.set(k.x, k.y + 0.6, k.z), K.q, K.w.set(sc, sc, sc)); G3.magnetMesh.setMatrixAt(nmg++, K.m); }
  }
  G3.shieldMesh.count = ns; G3.magnetMesh.count = nmg;
  G3.shieldMesh.instanceMatrix.needsUpdate = true; G3.magnetMesh.instanceMatrix.needsUpdate = true;
  if (G3.panelTex) G3.panelTex.offset.y = -(t * 1.6) % 1;
  if (G3.seaTex) { G3.seaTex.offset.set((t * 0.004) % 1, (t * 0.01) % 1); G3.foam.material.opacity = 0.55 + 0.3 * Math.sin(t * 1.3); }   // 일렁이는 바다 · 들락날락하는 파도
  for (const z of G3.zoneTex) z.tex.offset.y = (t * z.flow) % 1;   // 개울·초콜릿 강은 흐르고, 얼음은 가만히
  if (G3.snowfall) G3.snowfall.material.uniforms.uTime.value = t % 1000;
  syncJets(t);
  G3.crowd.position.y = Math.abs(Math.sin(t * 7)) * (game.state === 'finish' || game.state === 'result' ? 0.25 : 0.04);
  syncPoints();
}
// 보이는 카트마다 바퀴 4개: 차체를 따라가고, 굴러가고(속도/반지름), 앞바퀴는 핸들만큼 꺾임
function syncWheels(dt) {
  const W = G3.wheels, K = K3, E = G3.wheelEuler, cap = W.instanceMatrix.count;
  let n = 0;
  for (const m of G3.karts.concat(G3.showroom)) {
    if (!m.group.visible) continue;
    m.spin = ((m.spin || 0) + (m.spinRate || 0) * dt) % (Math.PI * 2);
    m.group.updateMatrixWorld(true);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      if (n >= cap) break;
      E.set(m.spin, sz > 0 ? -(m.steer || 0) * 0.42 : 0, 0); K.q.setFromEuler(E);
      K.m.compose(K.v.set(sx * WHEEL.x, WHEEL.y, sz * WHEEL.z), K.q, K.w.set(1, 1, 1)).premultiply(m.body.matrixWorld);
      W.setMatrixAt(n++, K.m);
    }
  }
  W.count = n; W.instanceMatrix.needsUpdate = true;
}
function syncPoints() {
  let na = 0, nn = 0;
  const A2 = G3.ptsAdd.geometry.attributes, N2 = G3.ptsNorm.geometry.attributes, K = K3;
  for (const q of parts) {
    const k = q.life / q.max, tgt = q.add ? A2 : N2, i = q.add ? na : nn;
    if (i >= (q.add ? G3.ptsAdd : G3.ptsNorm).userData.n) continue;
    tgt.position.setXYZ(i, q.x, q.y, q.z); tgt.aSize.setX(i, q.size * (q.add ? 1 : 1.6 - 0.6 * k)); tgt.aAlpha.setX(i, q.add ? k : k * 0.55);
    K.col.set(q.color); tgt.aColor.setXYZ(i, K.col.r, K.col.g, K.col.b);
    if (q.add) na++; else nn++;
  }
  for (const [pts, n] of [[G3.ptsAdd, na], [G3.ptsNorm, nn]]) {
    const ga = pts.geometry.attributes;
    for (const key of ['position', 'aSize', 'aAlpha', 'aColor']) ga[key].needsUpdate = true;
    pts.geometry.setDrawRange(0, n);
  }
}
// 화면 나누기: 혼자면 전체, 둘이면 위(P1)·아래(P2). 메뉴·선택·결과는 카메라 하나
function views() {
  const humansN = karts.filter(k => k.human >= 0).length;
  if (game.demo || !racingNow() || humansN < 1) return [{ p: -1, x: 0, y: 0, w: 1, h: 1 }];
  if (humansN === 1) return [{ p: 0, x: 0, y: 0, w: 1, h: 1 }];
  return [{ p: 0, x: 0, y: 0.5, w: 1, h: 0.5 }, { p: 1, x: 0, y: 0, w: 1, h: 0.5 }];   // y는 아래에서부터 (WebGL)
}
function renderFrame() {
  if (!G3.built) return;
  const t = T(), dt = clamp(t - G3.lastT, 0, 0.1); G3.lastT = t;
  sync3D(dt);   // 시범 레이스를 멈춰 둬도 매번 맞춤 (시계가 멈춰 있어서 그대로 서 있음. 새로 만든 카트·시상대 자리도 바로 반영)
  const vs = views(), cw = G3.cssW, ch = G3.cssH;
  for (const v of vs) {
    const cs = G3.camState[Math.max(0, v.p)], aspect = (v.w * cw) / Math.max(1, v.h * ch);
    if (game.state === 'select') selectCam(cs);
    else if (game.state === 'result') podiumCam(cs);
    else if (v.p < 0) { if (demoPauseAt === null || cs.snap) demoCam(cs, dt); }
    else { const k = humanKart(v.p); if (k) chaseCam(cs, k, dt, vs.length > 1); }
    placeCam(cs, aspect, v.p >= 0 ? game.shake[v.p] : 0);
    v.cs = cs;
  }
  const r = G3.renderer;
  if (r && !G3.lost) {
    r.setScissorTest(vs.length > 1);
    let calls = 0, tris = 0;
    for (const v of vs) {
      r.setViewport(v.x * cw, v.y * ch, v.w * cw, v.h * ch);
      if (vs.length > 1) r.setScissor(v.x * cw, v.y * ch, v.w * cw, v.h * ch);
      const focal = (v.h * ch * r.getPixelRatio()) / (2 * Math.tan(v.cs.cam.fov * Math.PI / 360));
      G3.ptsAdd.material.uniforms.uScale.value = focal; G3.ptsNorm.material.uniforms.uScale.value = focal;
      if (G3.snowfall) G3.snowfall.material.uniforms.uScale.value = focal;
      lodFor(v.cs.cam);
      r.render(G3.scene, v.cs.cam);
      calls += r.info.render.calls; tris += r.info.render.triangles;
    }
    G3.info.calls = calls; G3.info.tris = tris;
  }
  renderHUD(vs);
}

// ============================================================
// HUD — 2D 캔버스 (화면별: 아이템 칸 · 바퀴 · 시간 · 등수 · 문구 + 가운데 작은 지도)
// ============================================================
const HUD ={ ink: '#263132', cream: '#fff9ed', orange: '#ed683a', muted: '#d3d7cf', panel: 'rgba(30,42,43,0.88)' };
function outlined(g, text, x, y, fill, lw) { g.lineJoin = 'round'; g.lineWidth = lw; g.strokeStyle = 'rgba(25,36,37,0.9)'; g.strokeText(text, x, y); g.fillStyle = fill; g.fillText(text, x, y); }
function hudPanel(g, x, y, w, h, u) {
  g.save();
  g.shadowColor = 'rgba(16,27,28,0.18)'; g.shadowBlur = 20 * u; g.shadowOffsetY = 5 * u;
  g.fillStyle = HUD.panel; rr(g, x, y, w, h, 18 * u); g.fill();
  g.shadowBlur = 0; g.shadowOffsetY = 0;
  g.strokeStyle = 'rgba(255,249,237,0.18)'; g.lineWidth = 1.5 * u; g.stroke();
  g.restore();
}
function hudLabel(g, text, x, y, u) {
  g.font = `800 ${20 * u}px ${FONT}`; g.fillStyle = HUD.muted; g.fillText(text, x, y);
}
function drawItemIcon(g, kind, x, y, s) {
  g.save(); g.translate(x, y); g.scale(s / 100, s / 100); g.lineJoin = 'round';
  if (kind === 'boost' || kind === 'triple') {
    g.fillStyle = '#ff8a3d'; g.beginPath(); g.moveTo(0, -46); g.bezierCurveTo(30, -10, 40, 10, 30, 30); g.bezierCurveTo(20, 50, -20, 50, -30, 30); g.bezierCurveTo(-40, 10, -20, -6, 0, -46); g.fill();
    g.fillStyle = '#ffe27a'; g.beginPath(); g.moveTo(0, -8); g.bezierCurveTo(16, 10, 20, 22, 14, 32); g.bezierCurveTo(8, 42, -8, 42, -14, 32); g.bezierCurveTo(-20, 22, -12, 10, 0, -8); g.fill();
  } else if (kind === 'star') {   // 반짝 별: 노랑~주황 별 + 반짝 점
    const gr = g.createLinearGradient(0, -46, 0, 46); gr.addColorStop(0, '#fff3a0'); gr.addColorStop(1, '#ffb13b');
    g.fillStyle = gr; g.strokeStyle = '#9a5a12'; g.lineWidth = 5;
    g.beginPath();
    for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rad = i % 2 ? 20 : 46; g.lineTo(Math.cos(a) * rad, Math.sin(a) * rad + 4); }
    g.closePath(); g.fill(); g.stroke();
    g.fillStyle = '#5a3a12'; g.beginPath(); g.ellipse(-8, 2, 3.5, 6, 0, 0, Math.PI * 2); g.ellipse(8, 2, 3.5, 6, 0, 0, Math.PI * 2); g.fill();
  } else if (kind === 'zap') {
    g.fillStyle = '#ffe14d'; g.strokeStyle = '#8a6a12'; g.lineWidth = 6;
    g.beginPath(); g.moveTo(10, -46); g.lineTo(-26, 6); g.lineTo(-2, 6); g.lineTo(-12, 46); g.lineTo(28, -8); g.lineTo(4, -8); g.closePath(); g.fill(); g.stroke();
  } else if (kind === 'trap') {
    g.fillStyle = '#6cc3f5'; g.strokeStyle = '#2f6f9b'; g.lineWidth = 5;
    g.beginPath(); g.moveTo(0, -44); g.bezierCurveTo(14, -20, 34, 0, 34, 18); g.arc(0, 18, 34, 0, Math.PI); g.bezierCurveTo(-34, 0, -14, -20, 0, -44); g.closePath(); g.fill(); g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.85)'; g.beginPath(); g.ellipse(-12, 14, 7, 12, 0.4, 0, Math.PI * 2); g.fill();
  } else if (kind === 'shield') {   // 방울 보호막: 하늘색 방울 + 반짝
    const gr = g.createRadialGradient(-12, -14, 4, 0, 0, 44); gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.45, '#bdefff'); gr.addColorStop(1, '#5cc8f0');
    g.fillStyle = gr; g.strokeStyle = '#2f86ad'; g.lineWidth = 5;
    g.beginPath(); g.arc(0, 0, 42, 0, Math.PI * 2); g.fill(); g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.9)'; g.beginPath(); g.ellipse(-15, -17, 9, 5, -0.6, 0, Math.PI * 2); g.fill();
  } else if (kind === 'magnet') {   // 자석: 빨간 말굽 + 은색 끝
    g.lineCap = 'butt'; g.strokeStyle = '#e5484d'; g.lineWidth = 22;
    g.beginPath(); g.arc(0, -4, 26, Math.PI, 0); g.lineTo(26, 26); g.moveTo(-26, -4); g.lineTo(-26, 26); g.stroke();
    g.fillStyle = '#e8eef5'; g.fillRect(-37, 22, 22, 16); g.fillRect(15, 22, 22, 16);
    g.strokeStyle = '#7a2a2d'; g.lineWidth = 3; g.strokeRect(-37, 22, 22, 16); g.strokeRect(15, 22, 22, 16);
  } else if (kind === 'bolt') {   // 천둥 번개: 회색 구름 + 노란 번개
    g.fillStyle = '#b8c2d6'; g.beginPath(); g.arc(-16, -14, 18, 0, Math.PI * 2); g.arc(6, -22, 22, 0, Math.PI * 2); g.arc(24, -10, 16, 0, Math.PI * 2); g.fill();
    g.fillRect(-30, -12, 56, 16);
    g.fillStyle = '#ffe14d'; g.strokeStyle = '#8a6a12'; g.lineWidth = 4;
    g.beginPath(); g.moveTo(6, -2); g.lineTo(-14, 26); g.lineTo(0, 26); g.lineTo(-8, 48); g.lineTo(18, 16); g.lineTo(4, 16); g.lineTo(14, -2); g.closePath(); g.fill(); g.stroke();
  } else if (kind === 'ball') {   // 통통 공: 초록 공 + 하얀 줄무늬 + 튀는 선
    g.fillStyle = '#5fd690'; g.strokeStyle = '#1e7a48'; g.lineWidth = 5;
    g.beginPath(); g.arc(0, -4, 34, 0, Math.PI * 2); g.fill(); g.stroke();
    g.strokeStyle = '#f2fff6'; g.lineWidth = 6; g.beginPath(); g.arc(0, -4, 34, -2.4, -0.7); g.stroke(); g.beginPath(); g.arc(0, -4, 34, 0.7, 2.4); g.stroke();
    g.strokeStyle = '#1e7a48'; g.lineWidth = 4; g.beginPath(); g.moveTo(-20, 42); g.lineTo(-8, 34); g.moveTo(20, 42); g.lineTo(8, 34); g.stroke();
  } else if (kind === 'paint') {   // 물감 폭탄: 동그란 폭탄 + 알록달록 물감 방울
    g.fillStyle = '#4b3f72'; g.beginPath(); g.arc(-4, 8, 30, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#8a6a12'; g.lineWidth = 5; g.beginPath(); g.moveTo(14, -16); g.quadraticCurveTo(26, -34, 36, -30); g.stroke();
    for (const [x, y, r, c] of [[-14, 0, 9, '#ff6fa8'], [8, 12, 8, '#ffd166'], [-6, 22, 7, '#7ad3ff'], [10, -6, 6, '#86efac'], [36, -32, 7, '#ffd166']]) { g.fillStyle = c; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); }
  }
  g.restore();
}
// 물감 폭탄을 맞은 사람 화면: 알록달록 물감 자국 (3.5초, 마지막에 흐려짐)
function paintSplats(g, r, u, k, t) {
  const rng = mulberry32(Math.floor(k.paintAt * 1000)), a = clamp(k.paintT / 0.8, 0, 1), cols = ['#ff6fa8', '#ffd166', '#7ad3ff', '#86efac', '#a78bfa'];
  g.save(); g.globalAlpha = 0.88 * a;
  for (let i = 0; i < 7; i++) {
    const x = r.x + r.w * (0.12 + rng() * 0.76), y = r.y + r.h * (0.18 + rng() * 0.6), rad = (110 + rng() * 120) * u;
    g.fillStyle = cols[i % cols.length];
    g.beginPath(); g.arc(x, y, rad, 0, Math.PI * 2); g.fill();
    for (let j = 0; j < 6; j++) { const an = rng() * Math.PI * 2, d = rad * (0.9 + rng() * 0.5); g.beginPath(); g.arc(x + Math.cos(an) * d, y + Math.sin(an) * d, rad * (0.12 + rng() * 0.18), 0, Math.PI * 2); g.fill(); }
    g.fillRect(x - rad * 0.12, y, rad * 0.24, rad * (0.9 + rng() * 0.6));   // 흘러내리는 물감
  }
  g.restore();
}
function renderHUD(vs) {
  const g = hctx, W = hud.width, Hh = hud.height, t = T();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, W, Hh);
  if (game.demo || !racingNow() && game.state !== 'countdown') { drawToast(g, W, Hh); return; }
  for (const v of vs) if (v.p >= 0) drawView(g, { x: v.x * W, y: (1 - v.y - v.h) * Hh, w: v.w * W, h: v.h * Hh }, v.p, v.cs, vs.length > 1, t);
  // 공유 지도는 구분선 위에 그려 선이 지도를 가로지르지 않게 한다.
  if (vs.length > 1) { g.fillStyle = HUD.ink; g.fillRect(0, Hh / 2 - Math.max(1, Hh * 0.002), W, Math.max(2, Hh * 0.004)); }
  drawMinimap(g, W, Hh, vs.length > 1);
  drawToast(g, W, Hh);
}
// 속도선: 부스트·반짝 별일 때 화면 가장자리에서 가운데로 흘러드는 흰 줄
function speedLines(g, r, u, k, t) {
  const amt = Math.max(k.boostT > 0 ? 1 : 0, k.starT > 0 ? 0.8 : 0, clamp((k.v - KART.VMAX * 1.02) / 4, 0, 1) * 0.6);
  if (amt <= 0) return;
  const cx = r.x + r.w / 2, cy = r.y + r.h * 0.48, R = Math.hypot(r.w, r.h) / 2, rng = mulberry32(Math.floor(t * 30));
  g.save(); g.lineCap = 'round';
  for (let i = 0; i < 26; i++) {
    const a = rng() * Math.PI * 2, r0 = R * (0.62 + rng() * 0.25), len = R * (0.12 + rng() * 0.2);
    g.strokeStyle = `rgba(255,252,240,${(0.16 + rng() * 0.22) * amt})`; g.lineWidth = (2 + rng() * 4) * u;
    g.beginPath(); g.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0 * 0.7); g.lineTo(cx + Math.cos(a) * (r0 + len), cy + Math.sin(a) * (r0 + len) * 0.7); g.stroke();
  }
  g.restore();
}
// 출발 신호등: 3 · 2 · 1에 빨간 불이 하나씩, 출발하면 모두 초록
function startLights(g, cx, y, u, t) {
  const left = game.goT - t;
  if (left < -1 || left > 3.6) return;
  const lit = left <= 0 ? 3 : left <= 1 ? 3 : left <= 2 ? 2 : left <= 3 ? 1 : 0, go = left <= 0;
  const w = 196 * u, h = 70 * u;
  g.save(); g.globalAlpha = left < 0 ? clamp(1 + left, 0, 1) : 1;
  hudPanel(g, cx - w / 2, y, w, h, u);
  for (let i = 0; i < 3; i++) {
    const x = cx + (i - 1) * 58 * u, on = i < lit;
    g.fillStyle = on ? (go ? '#5fe08a' : '#ff5a4a') : 'rgba(255,249,237,0.14)';
    if (on) { g.shadowColor = go ? '#5fe08a' : '#ff5a4a'; g.shadowBlur = 18 * u; }
    g.beginPath(); g.arc(x, y + h / 2, 21 * u, 0, Math.PI * 2); g.fill(); g.shadowBlur = 0;
  }
  g.restore();
}
// 그랑프리: 출발 신호등 아래에 몇 번째 코스인지와 코스 이름
function gpBanner(g, cx, y, u, t) {
  const left = game.goT - t, w = 330 * u, h = 64 * u;
  g.save(); g.globalAlpha = left < 0 ? clamp(1 + left, 0, 1) : 1;
  hudPanel(g, cx - w / 2, y, w, h, u);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = `800 ${17 * u}px ${FONT}`; g.fillStyle = HUD.orange; g.fillText(`MONSTER CUP · RACE ${gp.race + 1} / ${GP_COURSES.length}`, cx, y + 20 * u);
  g.font = `900 ${26 * u}px ${FONT}`; g.fillStyle = HUD.cream; g.fillText(COURSE.name, cx, y + 45 * u);
  g.restore();
}
function drawView(g, r, p, cs, two, t) {
  const k = humanKart(p); if (!k) return;
  const u = Math.min(r.w / 1920, r.h / (two ? 620 : 1080)), pad = 28 * u;
  g.save(); g.beginPath(); g.rect(r.x, r.y, r.w, r.h); g.clip();
  speedLines(g, r, u, k, t);
  g.textBaseline = 'middle'; g.textAlign = 'left';
  // 플레이어와 아이템을 한 카드에 묶어 주행 중에도 빠르게 읽을 수 있게 한다.
  if (k.paintT > 0) paintSplats(g, r, u, k, t);
  const bolt = t - k.boltFx;
  if (bolt >= 0 && bolt < 0.35) { g.fillStyle = `rgba(255,252,220,${0.65 * (1 - bolt / 0.35)})`; g.fillRect(r.x, r.y, r.w, r.h); }   // 천둥 번개 번쩍
  const bx = r.x + pad, by = r.y + pad, iw = 392 * u, ih = 132 * u;
  hudPanel(g, bx, by, iw, ih, u);
  g.fillStyle = COLORS[p]; rr(g, bx + 16 * u, by + 17 * u, 44 * u, 28 * u, 7 * u); g.fill();
  g.textAlign = 'center'; g.font = `900 ${20 * u}px ${FONT}`; g.fillStyle = HUD.cream;
  g.fillText(`P${p + 1}`, bx + 38 * u, by + 31 * u);
  g.textAlign = 'left'; g.font = `800 ${24 * u}px ${FONT}`; g.fillText(nameOf(k), bx + 74 * u, by + 31 * u);
  // 아이템 두 칸: 큰 칸 = 다음에 쓸 것, 작은 칸 = 그다음 (바꾸기 버튼으로 순서를 바꿈)
  const ix = bx + 54 * u, iy = by + 88 * u, jx = bx + 122 * u, jy = by + 92 * u;
  g.fillStyle = 'rgba(255,249,237,0.1)'; rr(g, bx + 16 * u, by + 54 * u, 76 * u, 62 * u, 12 * u); g.fill();
  g.fillStyle = 'rgba(255,249,237,0.07)'; rr(g, bx + 100 * u, by + 70 * u, 44 * u, 44 * u, 10 * u); g.fill();
  const rolling = k.roulT > 0 ? (k.item ? 2 : 1) : 0, spin = ITEM_KEYS[Math.floor(t * 14) % ITEM_KEYS.length];
  const it1 = rolling === 1 ? spin : k.item, it2 = rolling === 2 ? spin : k.item2;
  const swp = t - k.swapAt, swPop = swp >= 0 && swp < 0.25 ? 1 + 0.25 * Math.sin(swp / 0.25 * Math.PI) : 1;   // 바꾸면 통통
  if (it1) drawItemIcon(g, it1, ix, iy, 52 * u * swPop);
  else { g.textAlign = 'center'; g.fillStyle = HUD.muted; g.font = `800 ${36 * u}px ${FONT}`; g.fillText('?', ix, iy); }
  if (it2) drawItemIcon(g, it2, jx, jy, 30 * u * swPop);
  const badge = (x, y, n, rad) => { g.fillStyle = HUD.orange; g.beginPath(); g.arc(x, y, rad, 0, Math.PI * 2); g.fill(); g.textAlign = 'center'; g.font = `900 ${rad * 1.2}px ${FONT}`; g.fillStyle = HUD.cream; g.fillText(`×${n}`, x, y); };
  if (rolling !== 1 && it1 === 'triple') badge(bx + 82 * u, by + 108 * u, k.itemN, 14 * u);   // 남은 개수 배지
  if (rolling !== 2 && it2 === 'triple') badge(bx + 138 * u, by + 110 * u, k.itemN2, 10 * u);
  g.textAlign = 'left'; hudLabel(g, k.roulT > 0 ? 'ITEM ROULETTE' : it2 ? 'ITEM  ⇄' : 'ITEM', bx + 160 * u, by + 65 * u, u);
  g.font = `800 ${24 * u}px ${FONT}`; g.fillStyle = HUD.cream;
  g.fillText(rolling === 1 ? '아이템 고르는 중' : it1 === 'triple' ? `불꽃 대시 ×${k.itemN}` : it1 ? ITEMS[it1].name : '상자를 지나 보세요', bx + 160 * u, by + 98 * u, 220 * u);
  // 바퀴와 시간: 동일한 카드 안에서 작은 라벨과 큰 숫자로 구분.
  const rw = 350 * u, rx = r.x + r.w - pad - rw;
  hudPanel(g, rx, by, rw, ih, u);
  hudLabel(g, 'LAP', rx + 23 * u, by + 29 * u, u);
  hudLabel(g, 'RACE TIME', rx + 154 * u, by + 29 * u, u);
  g.strokeStyle = 'rgba(255,249,237,0.16)'; g.lineWidth = u;
  g.beginPath(); g.moveTo(rx + 132 * u, by + 24 * u); g.lineTo(rx + 132 * u, by + 108 * u); g.stroke();
  const lap = clamp(k.lap, 1, game.laps);
  g.font = `900 ${58 * u}px ${FONT}`; g.fillStyle = HUD.cream; g.fillText(`${lap}`, rx + 22 * u, by + 82 * u);
  g.font = `700 ${28 * u}px ${FONT}`; g.fillStyle = HUD.muted; g.fillText(`/ ${game.laps}`, rx + 64 * u, by + 91 * u);
  const el = game.state === 'countdown' ? 0 : (k.finished ? k.finishT : t - game.goT);
  g.font = `800 ${43 * u}px ${FONT}`; g.fillStyle = HUD.cream; g.fillText(fmtTime(el), rx + 153 * u, by + 83 * u);
  // 실제 주행 단위(m/s)를 표시하고, 부스트 중에는 속도 막대를 주황색으로 강조.
  const sw = 332 * u, sh = 132 * u, sx = r.x + r.w - pad - sw, sy = r.y + r.h - pad - sh;
  hudPanel(g, sx, sy, sw, sh, u);
  hudLabel(g, 'SPEED', sx + 23 * u, sy + 27 * u, u);
  hudLabel(g, 'POSITION', sx + 196 * u, sy + 27 * u, u);
  g.font = `900 ${52 * u}px ${FONT}`; g.fillStyle = k.boostT > 0 ? '#ffab7e' : HUD.cream;
  g.fillText(Math.abs(k.v).toFixed(1), sx + 21 * u, sy + 76 * u);
  g.font = `700 ${20 * u}px ${FONT}`; g.fillStyle = HUD.muted; g.fillText('m/s', sx + 133 * u, sy + 88 * u);
  g.fillStyle = 'rgba(255,249,237,0.18)'; rr(g, sx + 24 * u, sy + 109 * u, 140 * u, 5 * u, 2.5 * u); g.fill();
  const speedW = 140 * u * clamp(Math.abs(k.v) / (KART.VMAX * KART.BOOST), 0, 1);
  if (speedW > 0) { g.fillStyle = HUD.orange; rr(g, sx + 24 * u, sy + 109 * u, speedW, 5 * u, 2.5 * u); g.fill(); }
  g.strokeStyle = 'rgba(255,249,237,0.16)'; g.lineWidth = u;
  g.beginPath(); g.moveTo(sx + 182 * u, sy + 24 * u); g.lineTo(sx + 182 * u, sy + 108 * u); g.stroke();
  const place = k.place, pf = game.placeFx[p];
  if (pf.place !== place) { if (pf.place && racingNow() && game.state !== 'countdown') { pf.dir = Math.sign(pf.place - place); pf.t = t; } pf.place = place; }   // 등수가 바뀌면 통통 + ↑↓
  const pa = t - pf.t, pop = pa >= 0 && pa < 0.45 ? 1 + 0.35 * Math.sin(pa / 0.45 * Math.PI) : 1;
  g.save(); g.translate(sx + 220 * u, sy + 84 * u); g.scale(pop, pop);
  g.font = `900 ${82 * u}px ${FONT}`; g.fillStyle = place === 1 ? '#ffab7e' : HUD.cream; g.textAlign = 'center';
  g.fillText(`${place}`, 0, 0);
  g.restore(); g.textAlign = 'left';
  if (pa >= 0 && pa < 1.2 && pf.dir) { g.font = `900 ${30 * u}px ${FONT}`; g.fillStyle = pf.dir > 0 ? '#7fe3a0' : '#ff8f7a'; g.fillText(pf.dir > 0 ? '▲' : '▼', sx + 251 * u, sy + 52 * u); }
  g.font = `700 ${24 * u}px ${FONT}`; g.fillStyle = HUD.muted; g.fillText('등', sx + 251 * u, sy + 91 * u);
  g.font = `700 ${17 * u}px ${FONT}`; g.fillText(`/ ${karts.length}`, sx + 285 * u, sy + 93 * u);
  // 드리프트 충전: 불꽃 색 세 칸(파랑·주황·분홍)과 라벨로 단계를 함께 전달.
  if (k.drift) {
    const dy = by + ih + 12 * u, dc = k.drift.level ? DRIFT[k.drift.level].color : HUD.muted;
    hudPanel(g, bx, dy, 236 * u, 46 * u, u);
    hudLabel(g, 'DRIFT', bx + 17 * u, dy + 24 * u, u);
    for (let i = 0; i < 3; i++) {
      g.fillStyle = i < k.drift.level ? dc : 'rgba(255,249,237,0.2)';
      rr(g, bx + (104 + i * 40) * u, dy + 17 * u, 31 * u, 12 * u, 4 * u); g.fill();
    }
  }
  if (game.state === 'countdown' || t - game.goT < 1) {   // 위쪽 가운데 일시정지 버튼 아래
    startLights(g, r.x + r.w / 2, by + 46 * u, u, t);
    if (gp.on) gpBanner(g, r.x + r.w / 2, by + 128 * u, u, t);
  }
  if (game.cutoffAt && !k.finished && game.state === 'race') {   // 시간 제한 마지막 10초
    const left = Math.ceil(game.cutoffAt - t);
    if (left <= 10) { g.textAlign = 'center'; g.font = `900 ${40 * u}px ${FONT}`; outlined(g, `${left}초 남았어요!`, r.x + r.w / 2, by + ih + 40 * u, '#ffcf6b', 8 * u); g.textAlign = 'left'; }
  }
  // 가운데 문구 (카운트다운 · 부스트 · 골인 …)
  g.textAlign = 'center';
  const m = game.msg[p], cx = r.x + r.w / 2, cy = r.y + r.h * (two ? 0.42 : 0.36);
  if (m) {
    const age = t - m.t, dur = m.sub ? 3 : 1.15;
    if (age < dur) {
      const s = age < 0.12 ? 0.7 + age / 0.12 * 0.3 : 1, a = clamp((dur - age) / 0.3, 0, 1);
      g.globalAlpha = a;
      const size = (/^[0-9]$/.test(m.text) ? 150 : 76) * u * s;
      g.font = `900 ${size}px ${FONT}`; outlined(g, m.text, cx, cy, m.color, 12 * u);
      if (m.sub) { g.font = `800 ${36 * u}px ${FONT}`; outlined(g, m.sub, cx, cy + size * 0.7, '#ffffff', 7 * u); }
      g.globalAlpha = 1;
    }
  }
  if (k.wrongT > 1.2 && !k.finished) { g.font = `900 ${56 * u}px ${FONT}`; outlined(g, '↺ 반대 방향이에요!', cx, cy + 110 * u, '#ff8fa3', 10 * u); }
  if (tilt[p].joy && tilt[p].upright && !k.finished) { g.font = `800 ${34 * u}px ${FONT}`; outlined(g, '조이콘을 가로로 잡아 주세요', cx, r.y + r.h - pad - (two ? 116 : 30) * u, HUD.cream, 7 * u); }
  if (k.finished && game.state !== 'countdown') {
    g.font = `900 ${52 * u}px ${FONT}`; outlined(g, `${k.place}등 · ${fmtTime(k.finishT)}`, cx, r.y + r.h * 0.78, '#ffffff', 9 * u);
  }
  // 다른 사람 카트 위에 P 표시
  for (const o of karts) {
    if (o.human < 0 || o.human === p) continue;
    const q = proj(cs.cam, o.x, o.y + 2.3, o.z, r);
    if (!q) continue;
    g.font = `900 ${28 * u}px ${FONT}`; outlined(g, `P${o.human + 1}`, q.x, q.y, COLORS[o.human], 6 * u);
  }
  g.restore();
}
function proj(cam, x, y, z, r) {
  const K = K3;
  cam.getWorldDirection(K.v);
  if ((x - cam.position.x) * K.v.x + (y - cam.position.y) * K.v.y + (z - cam.position.z) * K.v.z < 0.5) return null;   // 카메라 뒤
  K.w.set(x, y, z).project(cam);
  if (Math.abs(K.w.x) > 1.1 || Math.abs(K.w.y) > 1.1) return null;
  return { x: r.x + (K.w.x + 1) / 2 * r.w, y: r.y + (1 - K.w.y) / 2 * r.h };
}
function drawMinimap(g, W, Hh, two) {   // 둘이 달릴 때는 구분선을 덮는 작은 공유 지도.
  const u = Math.min(W / 1920, Hh / 1080), mw = (two ? 190 : 242) * u, mh = mw * MAP.h / MAP.w;
  const pw = mw + 44 * u, ph = mh + 66 * u;
  const px = two ? W / 2 - pw / 2 : 28 * u, py = two ? Hh / 2 - ph / 2 : Hh - ph - 28 * u;
  const x0 = px + 22 * u, y0 = py + 43 * u;
  g.save(); g.textAlign = 'left'; g.textBaseline = 'middle';
  hudPanel(g, px, py, pw, ph, u);
  g.font = `800 ${(two ? 17 : 19) * u}px ${FONT}`;
  let titleW = mw;
  if (gp.on) {   // 그랑프리: 오른쪽 끝에 몇 번째 코스인지 (코스 이름은 남은 너비에 맞춤)
    const tag = `GP ${gp.race + 1}/${GP_COURSES.length}`, tw = g.measureText(tag).width;
    g.fillStyle = HUD.orange; g.textAlign = 'right'; g.fillText(tag, x0 + mw, py + 21 * u); g.textAlign = 'left';
    titleW = mw - tw - 12 * u;
  }
  g.fillStyle = HUD.muted; g.fillText(COURSE.en, x0, py + 21 * u, titleW);
  const X = x => x0 + (x - MAP.x0) / MAP.w * mw, Y = z => y0 + (z - MAP.z0) / MAP.h * mh;
  g.lineJoin = 'round'; g.lineCap = 'round';
  g.beginPath();
  for (let i = 0; i <= TR.n; i += 4) { const j = i % TR.n; if (i === 0) g.moveTo(X(TR.px[j]), Y(TR.pz[j])); else g.lineTo(X(TR.px[j]), Y(TR.pz[j])); }
  g.closePath();
  g.strokeStyle = 'rgba(255,249,237,0.18)'; g.lineWidth = 15 * u; g.stroke();
  g.strokeStyle = HUD.cream; g.lineWidth = 6 * u; g.stroke();
  const p0 = trackPoint(0, 0);
  g.fillStyle = HUD.orange; g.fillRect(X(p0.x) - 2 * u, Y(p0.z) - 7 * u, 4 * u, 14 * u);
  for (const k of karts.slice().sort((a, b) => (a.human >= 0) - (b.human >= 0))) {
    const hu = k.human >= 0, rad = (hu ? 8 : 5) * u;
    g.beginPath(); g.arc(X(k.x), Y(k.z), rad, 0, Math.PI * 2);
    g.fillStyle = hu ? COLORS[k.human] : HUD.muted; g.fill();
    g.lineWidth = (hu ? 3 : 2) * u; g.strokeStyle = hu ? HUD.cream : HUD.ink; g.stroke();
  }
  g.restore();
}
function drawToast(g, W, Hh) {
  const tt = gfx.toast; if (!tt) return;
  const age = realNow() - tt.t; if (age > 3.5) { gfx.toast = null; return; }
  const u = Math.min(W / 1920, Hh / 1080);
  g.globalAlpha = clamp((3.5 - age) / 0.4, 0, 1);
  g.font = `700 ${26 * u}px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
  const w = g.measureText(tt.text).width + 40 * u;
  hudPanel(g, W / 2 - w / 2, Hh - 90 * u, w, 48 * u, u);
  g.fillStyle = HUD.cream; g.fillText(tt.text, W / 2, Hh - 66 * u);
  g.globalAlpha = 1;
}

// ============================================================
// 메뉴 그림: 카트 탄 친구들 (2D, 그림 파일 없이 그려서 넣음)
// ============================================================
function drawKartArt() {
  const img = $('kartArt'); if (!img || typeof document.createElement !== 'function') return;
  const c = document.createElement('canvas'); c.width = 960; c.height = 640;
  const g = c.getContext && c.getContext('2d'); if (!g || !g.ellipse) return;
  // 앞(왼쪽 아래, 크게) → 뒤(오른쪽 위, 작게)로 줄지어 달리는 네 친구. 뒤에서부터 그림
  const picks = [[0, 250, 488, 1.5], [5, 500, 410, 1.28], [3, 700, 330, 1.08], [4, 846, 252, 0.9]];
  g.strokeStyle = 'rgba(129,118,219,0.2)'; g.lineCap = 'round';
  for (const [, x, y, s] of picks) for (let i = 0; i < 3; i++) {   // 속도선
    g.lineWidth = (5 + i * 3) * s; g.beginPath(); g.moveTo(x - 330 * s + i * 40, y - (60 - i * 40) * s); g.lineTo(x - 150 * s, y - (60 - i * 40) * s); g.stroke();
  }
  picks.slice().reverse().forEach(([ci, x, y, s]) => {
    const n = picks.findIndex(p => p[0] === ci), ch = CHARS[ci];
    g.save(); g.translate(x, y); g.scale(s, s);
    g.fillStyle = 'rgba(80,60,110,0.16)'; g.beginPath(); g.ellipse(0, 70, 150, 22, 0, 0, Math.PI * 2); g.fill();
    NC.drawMonster2D(g, ch, 0, -150, 210, true);
    const col = n === 0 ? COLORS[0] : n === 1 ? COLORS[1] : ch.body;
    g.lineWidth = 6; g.strokeStyle = '#4b3b5c';
    g.fillStyle = col; rr(g, -120, -10, 240, 74, 30); g.fill(); g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.35)'; rr(g, -100, -2, 200, 18, 9); g.fill();
    for (const wx of [-86, 86]) { g.fillStyle = '#3a3346'; g.beginPath(); g.arc(wx, 66, 30, 0, Math.PI * 2); g.fill(); g.fillStyle = '#fff4dc'; g.beginPath(); g.arc(wx, 66, 12, 0, Math.PI * 2); g.fill(); }
    g.restore();
  });
  try { img.src = c.toDataURL('image/png'); } catch (e) { /* 무시 */ }
}

// ============================================================
// 시작
// ============================================================
function bindMenu() {
  document.querySelectorAll('#modeRow button').forEach(b => { b.onclick = () => { settings.mode = b.dataset.mode; assignJoyCons(); syncMenu(); saveSettings(); }; });
  document.querySelectorAll('#lvRow button').forEach(b => { b.onclick = () => { settings.cpuLevel = +b.dataset.lv; syncMenu(); saveSettings(); }; });
  document.querySelectorAll('#lapRow button').forEach(b => { b.onclick = () => { settings.laps = +b.dataset.laps; syncMenu(); saveSettings(); }; });
  document.querySelectorAll('#courseRow button').forEach(b => {
    b.onclick = () => {   // 코스를 바꾸면 메뉴 뒤 시범 레이스도 그 코스로 (그랑프리는 첫 코스)
      settings.gp = !!b.dataset.gp;
      if (!settings.gp) settings.course = +b.dataset.course;
      saveSettings();
      if (switchCourse(lobbyCourse()) && game.demo) { setupRace(true); game.goT = T(); }
      syncMenu();
    };
  });
  document.querySelectorAll('#qRow button').forEach(b => {
    b.onclick = () => {
      settings.quality = b.dataset.q; saveSettings();
      gfx.locked = false; gfx.pending = null; gfx.note = '';
      if (settings.quality === 'auto') gfx.autoLevel = 'mid';
      applyQuality(levelFor(settings.quality));
      syncMenu();
    };
  });
  $('steer').oninput = e => { settings.steerAngle = +e.target.value; syncMenu(); saveSettings(); };
  $('autoGas').onchange = e => { settings.autoGas = e.target.checked; saveSettings(); };
  $('assist').onchange = e => { settings.assist = e.target.checked; saveSettings(); };
  for (const i of [0, 1]) $('flip' + i).onchange = e => { settings.flip[i] = e.target.checked; saveSettings(); };
  for (const [id, k] of VOL) {   // 소리 크기: 움직이는 대로 바로 바꾸고, 놓으면 들려줌
    $(id).oninput = e => { sfxInit(); A.setVolume(k, e.target.value / 100); $(id + 'V').textContent = e.target.value + '%'; };
    $(id).onchange = () => { if (k === 'sfx') A.boost(); else if (k === 'crowd') A.applause(0.35); };
  }
  $('btnSwap').onclick = () => { JC.swapped = !JC.swapped; S.set('swapped', JC.swapped); assignJoyCons(); };
  $('btnStart').onclick = openSelect;
  $('btnHome').onclick = () => { location.href = '../../index.html'; };
  $('btnFull').onclick = toggleFull;
  $('btnResume').onclick = resume; $('btnQuit').onclick = toMenu;
  $('btnRestart').onclick = () => { resume(); startRace(); };   // 이 코스를 처음부터 (그랑프리면 같은 코스, 점수는 그대로)
  $('btnAgain').onclick = resultNext; $('btnReselect').onclick = openSelect; $('btnMenu').onclick = toMenu;
  $('btnSelBack').onclick = toMenu;
  document.querySelectorAll('#select [data-p]').forEach(b => {
    b.onclick = () => {
      const i = +b.dataset.p;
      if (b.dataset.d) selMove(i, +b.dataset.d, true); else selReady(i, !sel[i].ready);
    };
  });
  $('btnConnect').onclick = async () => {
    sfxInit();
    const r = await JC.connect();
    showWarn(r.error || '');
  };
  // 마우스로 누른 버튼·체크박스·슬라이더·펼침 제목은 포커스를 풀어서 Enter·F 같은 게임 키가 막히지 않게
  document.addEventListener('click', e => {
    const a = document.activeElement;
    if (e.detail > 0 && a && a.matches && a.matches('button, summary, input[type=checkbox], input[type=range]')) a.blur();
  });
  // 전체화면에서 Esc를 누르면 크롬이 전체화면만 풀고 키는 안 넘겨줌 → 경주 중이면 일시정지
  document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement) pause(); });
  window.addEventListener('pointerdown', () => sfxInit());
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
  window.addEventListener('resize', resize);
}
function frame() {
  const nowR = realNow(), dtR = gfx.lastReal ? nowR - gfx.lastReal : 0;
  gfx.lastReal = nowR;
  try { update(); renderFrame(); updateSlotMeters(); updateSelectHints(); } catch (e) { console.error(e); }
  trackPerf(dtR);
  requestAnimationFrame(frame);
}

bindMenu();
courseThumbs();
if (settings.quality !== 'auto' && !Q[settings.quality]) gfx.note = '테니스의 2D 설정이라 카트는 가장 가벼운 3D로 달려요';
applyQuality(levelFor(settings.quality));
drawKartArt();
syncMenu();
if (!JC.supported) showWarn('이 브라우저는 조이콘 직접 연결을 지원하지 않아요. PC의 크롬이나 엣지로 열어주세요. (키보드·게임패드는 사용 가능)');
else if (location.protocol === 'file:') showWarn('파일로 열면 조이콘 연결이 막혀요. 키보드 테스트는 OK — 조이콘은 인터넷 주소나 start-game.bat으로 열어주세요.');
assignJoyCons();
JC.start();
setupRace(true); game.goT = T();
requestAnimationFrame(frame);

// 테스트용 훅
window.__KT = { game, karts, settings, T, update, render: renderFrame, startRace, toMenu, openSelect, selMove, selReady, selSet, sel, pause, resume,
  TRACK, boxes, shots, traps, KART, trackPoint, locate, groundAt, sdiff, useItem, spinOut, joySteer, tilt, readInputs, keys, inCreek,
  gfx, G3, Q, applyQuality, autoStep, parts, CHARS, joycon: JC, setDemoPaused, showResult, mergeGeoms, views, humanKart, levelFor,
  COURSES, switchCourse, DRIFT, ITEM_KEYS, gp, GP_COURSES, GP_POINTS, resultNext, REC, lodFor, rollItem, balls, JET, jetState,
  get JETS() { return JETS; },
  get TR() { return TR; }, get L() { return L; }, get RAMP() { return RAMP; }, get PANELS() { return PANELS; }, get ZONES() { return ZONES; },
  get COURSE() { return COURSE; }, get BOX_ROWS() { return BOX_ROWS; },
  setClock: f => { realNow = f; } };
})();
