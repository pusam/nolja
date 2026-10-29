/* ============================================================
 * 몬스터 볼링 — 조이콘을 아래에서 앞으로 휘둘러 굴리는 1~4인 볼링 (+ CPU 친구)
 *  - 차례대로 자리·방향·휘기(커브)를 정하고 휘두르면 굴러감. 세게 휘두를수록 빠르고, 느릴수록 더 휨
 *  - 핀 10개: 위에서 본 2D 물리 + 넘어지는 각도. 공·서 있는 핀·넘어지는 핀·누운 핀이 서로 부딪히고 옆 벽에 튕김
 *  - 정식 점수 (스트라이크는 다음 공 2개, 스페어는 다음 공 1개 보너스 · 마지막 프레임 보너스 공) · 3·5·10프레임
 *  - 아이용 범퍼(도랑 막이)는 선수마다 켜고 끔 · CPU 친구 쉬움·보통·어려움
 *  - 공용 모듈: shared/store.js · audio.js · joycon.js · characters.js
 * ============================================================ */
(() => {
'use strict';

const N = window.Nolja;
const NC = N.characters, JC = N.joycon, A = N.audio, S = N.store;
const B = JC.BTN;

// ---------- 유틸 ----------
const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
const smooth = u => { u = clamp(u, 0, 1); return u * u * (3 - 2 * u); };
const gauss = () => { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
const FONT = '"Pretendard","Malgun Gothic","Apple SD Gothic Neo","Noto Sans KR",sans-serif';
const HEADLESS = window.__BW_HEADLESS || '';   // 테스트용: '3d'면 WebGL 없이 3D 장면만 갱신
function mulberry32(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function rr(g, x, y, w, h, r) {
  g.beginPath();
  r = Math.max(0, Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2));
  g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
function circ(g, x, y, r) { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); }

const CHARS = NC.CHARS;
const COLORS = ['#3688ff', '#fb729b', '#25b37f', '#f59e2a', '#8b6cf0'];   // P1 파랑 · P2 분홍 · P3 초록 · P4 주황 · CPU 보라
const LEVELS = ['쉬움', '보통', '어려움'];

// ---------- 설정 (공용 설정 + 볼링 전용) ----------
const P0 = N.prefs();
const settings = {
  mode: S.get('bowling.mode', 'family'),     // 'family' 함께 치기 (2~4명 차례대로) | 'solo' 혼자 치기 (+ CPU 친구)
  count: S.get('bowling.count', 2),          // 함께 치기 인원
  cpu: S.get('bowling.cpu', 1),              // 혼자 치기의 CPU 친구: -1 없음 · 0 쉬움 · 1 보통 · 2 어려움
  frames: S.get('bowling.frames', 5),        // 3 · 5 · 10 프레임
  guide: S.get('bowling.guide', 'full'),     // 굴러갈 길 미리 보기: 'full' 핀까지 · 'short' 화살표까지 · 'off'
  chars: S.get('bowling.chars', null),       // 자리 1~4의 캐릭터
  bumpers: S.get('bowling.bumpers', [false, false, false, false]),
  sensitivity: P0.sensitivity,               // 이하 공용 (다른 게임과 같이 씀)
  quality: P0.quality,
};
const KEYS = { mode: 'bowling.mode', count: 'bowling.count', cpu: 'bowling.cpu', frames: 'bowling.frames', guide: 'bowling.guide',
  chars: 'bowling.chars', bumpers: 'bowling.bumpers', sensitivity: 'sensitivity', quality: 'quality' };
if (!['family', 'solo'].includes(settings.mode)) settings.mode = 'family';
if (![2, 3, 4].includes(settings.count)) settings.count = 2;
if (![-1, 0, 1, 2].includes(settings.cpu)) settings.cpu = 1;
if (![3, 5, 10].includes(settings.frames)) settings.frames = 5;
if (!['full', 'short', 'off'].includes(settings.guide)) settings.guide = 'full';
if (!Array.isArray(settings.chars) || settings.chars.length !== 4 || settings.chars.some(k => !Number.isInteger(k) || k < 0 || k >= CHARS.length)) {
  const shared = Array.isArray(P0.chars) ? P0.chars.filter(k => Number.isInteger(k) && k >= 0 && k < CHARS.length) : [];
  settings.chars = [...new Set([...shared, 0, 3, 1, 8, 2, 5])].slice(0, 4);   // 테니스·카트에서 고른 친구부터
}
settings.bumpers = Array.isArray(settings.bumpers) && settings.bumpers.length === 4 ? settings.bumpers.map(v => !!v) : [false, false, false, false];
const saveSettings = () => { for (const k in KEYS) S.set(KEYS[k], settings[k]); JC.sensitivity = settings.sensitivity; };
JC.sensitivity = settings.sensitivity;

// ---------- 게임 상태 ----------
const game = {
  state: 'turn',       // turn 차례 알림 · aim 조준 · throw 휘두르는 중 · roll 굴러감 · result 결과 보여줌 · sweep 핀 정리 · end · select
  demo: true,          // 메뉴 뒤에서 도는 CPU 시범 경기
  paused: false,
  players: [], F: 10,  // 선수들 · 프레임 수
  cur: 0, frame: 0,    // 지금 치는 선수 · 프레임 (0부터)
  stateT: 0, step: 0, same: false,   // step: 조준에서 고치는 것 0 자리 · 1 방향 · 2 휘기 / same: 같은 선수의 다음 공
  pow: 0.5, powKnown: false, throwT: -9, releaseT: -9,
  charge: null, cpuPlan: null,
  standing: [],        // 이번 공을 굴리기 전에 서 있던 핀 번호
  newRack: true, frameOver: false, lastKnock: 0,
  msg: null, winner: -1, resultShown: false, speedKmh: 0,
  forceCPU: false,     // 테스트용: 사람 자리도 CPU가 침
  padCount: 0,
  stats: { throws: 0, strikes: 0, spares: 0, gutters: 0, splits: 0, bumps: 0, timeouts: 0 },
};

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

// 효과음 (시범 경기는 조용히)
const quiet = () => game.demo;
const sfx = {
  init: () => A.init(),
  pin: p => { if (!quiet()) A.pin(p); },
  crash: n => { if (!quiet()) A.pinCrash(n); },
  bumper: p => { if (!quiet()) A.bumper(p); },
  gutter: () => { if (!quiet()) A.gutter(); },
  drop: () => { if (!quiet()) A.ballDrop(); },
  sweep: () => { if (!quiet()) A.sweep(); },
  strike: n => { if (!quiet()) { A.cheer(1.4 + 0.4 * Math.min(n, 3)); A.jingle(n >= 2); } },
  spare: () => { if (!quiet()) { A.applause(0.55); A.point(); } },
  groan: () => { if (!quiet()) A.groan(); },
  ooh: () => { if (!quiet()) A.ooh(); },
  applause: x => { if (!quiet()) A.applause(x); },
  whoosh: p => { if (!quiet()) A.whoosh(p); },
  tick: () => A.tick(), ready: () => A.ready(),
};

// ============================================================
// 레인 · 공 · 핀 (단위 m. x = 오른쪽 +, z = 파울 라인에서 핀 쪽으로 +. 3D에선 (x, 높이, -z))
//  - 레인 폭 1.054m (판자 39장), 파울 라인 ~ 1번 핀 18.29m, 양옆 도랑 23.5cm, 핀 데크 끝 19.16m
//  - 공 14파운드(6.4kg, 지름 21.6cm), 핀 1.55kg 높이 38.1cm (가장 굵은 곳 지름 12.1cm), 핀 사이 30.48cm 정삼각형
//  - 레인 앞쪽엔 기름이 발려 공이 미끄러지고(거의 똑바로), 뒤쪽 마른 곳에서 회전이 먹혀 휨
// ============================================================
const LANE = { half: 0.527, gutter: 0.235, len: 18.29, deck: 19.16, kick: 0.762, spacing: 1.7 };
const BALL_R = 0.108, BALL_M = 6.4;
const PIN = { h: 0.381, r: 0.06, rl: 0.05, m: 1.55, body: 0.33, com: 0.165, I: 1.55 * 0.381 * 0.381 / 12 };
// 핀 번호 1~10 (배열은 0~9): 1번이 맨 앞, 7번이 왼쪽 뒤 구석, 10번이 오른쪽 뒤 구석
const SPOTS = [[0, 0], [-1, 1], [1, 1], [-2, 2], [0, 2], [2, 2], [-3, 3], [-1, 3], [1, 3], [3, 3]].map(([c, r]) => ({ x: c * 0.1524, z: LANE.len + r * 0.2639 }));
const NEAR = SPOTS.map((a, i) => SPOTS.map((b, j) => i !== j && Math.hypot(a.x - b.x, a.z - b.z) < 0.32));   // 바로 붙은 핀
const DT = 1 / 240;
// 조준에서 고치는 것: 자리(파울 라인에서 놓는 곳) · 방향(도) · 휘기 (- 왼쪽으로 휨 · + 오른쪽으로 휨)
const AIM = [
  { key: 'x', lo: -0.4, hi: 0.4, rate: 0.3, nudge: 0.027, name: '자리' },
  { key: 'ang', lo: -3, hi: 3, rate: 2, nudge: 0.15, name: '방향' },
  { key: 'spin', lo: -1, hi: 1, rate: 1.1, nudge: 0.1, name: '휘기' },
];
const HOOK = 1.25;
const speedOf = pow => 4.3 + 4.6 * clamp(pow, 0, 1);   // 휘두른 세기 0~1 → 공 빠르기 (시속 15~32km)
const dryness = z => smooth((z - 8.5) / 7.5);           // 0 기름 · 1 마름
const BUMP_X = LANE.half + 0.02 - BALL_R;               // 범퍼가 있으면 공 가운데가 여기까지만

// 레인 위를 구르는 공 한 걸음 (핀·도랑은 따로): 마른 곳일수록 회전 쪽으로 휘고, 조금씩 느려짐
function laneStep(b, dt) {
  const v = Math.hypot(b.vx, b.vz) || 1e-6, dry = dryness(b.z);
  b.vx += b.spin * HOOK * (0.12 + 0.88 * dry) * (v / 7) * dt;
  const v2 = Math.max(0.6, v - (0.22 + 0.3 * dry) * dt), k = v2 / (Math.hypot(b.vx, b.vz) || 1e-6);
  b.vx *= k; b.vz *= k;
  b.x += b.vx * dt; b.z += b.vz * dt;
}
function bumperBounce(b) {   // 범퍼(도랑 막이)에 "퉁". 튕겼으면 true
  if (Math.abs(b.x) <= BUMP_X) return false;
  const s = Math.sign(b.x); b.x = s * BUMP_X;
  if (b.vx * s <= 0) return false;
  b.vx = -b.vx * 0.45; b.spin *= 0.4;
  return true;
}
// 핀이 없다고 치고 굴러갈 길 (가이드 선 · CPU 조준). free면 도랑·범퍼 없이 끝까지 (조준 계산용)
function predictPath(x0, angDeg, spin, v, opt = {}) {
  const a = angDeg * Math.PI / 180, b = { x: x0, z: 0, vx: v * Math.sin(a), vz: v * Math.cos(a), spin };
  const pts = opt.pts || null, toZ = opt.toZ || LANE.len, dt = 1 / 120;
  if (pts) { pts.length = 0; pts.push(b.x, b.z); }
  let gutter = false, n = 0;
  while (b.z < toZ && n++ < 3000) {
    laneStep(b, dt);
    if (opt.free) continue;
    if (opt.bumper) bumperBounce(b);
    else if (Math.abs(b.x) > LANE.half) { gutter = true; break; }
    if (pts && n % 6 === 0) pts.push(b.x, b.z);
  }
  if (pts) pts.push(b.x, b.z);
  return { x: b.x, z: b.z, gutter };
}

const ball = { x: 0, z: 0, y: 0, vx: 0, vz: 0, spin: 0, st: 'hold', bumper: false, hitT: -1, gutT: -1, pitT: -1, v0: 0, bumps: 0 };
const pins = [];
const sim = { t: 0, acc: 0, settle: 0, sndT: -9 };
// 핀 상태: up 서 있음 · fall 넘어지는 중 · down 누움 · gone 구덩이·도랑에 빠짐 (보이기만) · off 정리돼서 없음
function makePin(i) {   // 핀 세우는 기계도 몇 mm씩은 어긋나게 세움
  const s = SPOTS[i];
  return { i, x: s.x + (Math.random() - 0.5) * 0.008, z: s.z + (Math.random() - 0.5) * 0.008, vx: 0, vz: 0, st: 'up', th: 0, om: 0, dx: 0, dz: 1, yv: 0, wob: 0, wx: 0, wz: 1, wobT: 0, fallAt: -1, y: 0, vy: 0, res: 1, gut: false, lift: 0 };
}
function resetRack() { pins.length = 0; for (let i = 0; i < 10; i++) pins.push(makePin(i)); }
resetRack();

// 핀 몸통을 위에서 본 선분 [바닥 x, z, 머리 쪽 x, z, 굵기]. 서 있으면 점, 넘어갈수록 길어짐
const SA = [0, 0, 0, 0, 0], SB = [0, 0, 0, 0, 0];
function pinSeg(p, o) {
  o[0] = p.x; o[1] = p.z;
  if (p.st === 'up') { o[2] = p.x; o[3] = p.z; o[4] = PIN.r; return o; }
  const L = PIN.body * Math.sin(p.th);
  o[2] = p.x + p.dx * L; o[3] = p.z + p.dz * L;
  o[4] = PIN.rl + (PIN.r - PIN.rl) * Math.cos(p.th);
  return o;
}
// 두 선분 사이 가장 가까운 두 점 (Ericson, Real-Time Collision Detection 5.1.9) → CP = [s, t, 거리²]
const CP = [0, 0, 0];
function closest(ax, az, bx, bz, cx, cz, ex, ez) {
  const d1x = bx - ax, d1z = bz - az, d2x = ex - cx, d2z = ez - cz, rx = ax - cx, rz = az - cz;
  const a = d1x * d1x + d1z * d1z, e = d2x * d2x + d2z * d2z, f = d2x * rx + d2z * rz;
  let s = 0, t = 0;
  if (a > 1e-10 || e > 1e-10) {
    if (a <= 1e-10) t = clamp(f / e, 0, 1);
    else {
      const c = d1x * rx + d1z * rz;
      if (e <= 1e-10) s = clamp(-c / a, 0, 1);
      else {
        const bb = d1x * d2x + d1z * d2z, den = a * e - bb * bb;
        s = den > 1e-12 ? clamp((bb * f - c * e) / den, 0, 1) : 0;
        t = (bb * s + f) / e;
        if (t < 0) { t = 0; s = clamp(-c / a, 0, 1); } else if (t > 1) { t = 1; s = clamp((bb - c) / a, 0, 1); }
      }
    }
  }
  const px = ax + d1x * s - (cx + d2x * t), pz = az + d1z * s - (cz + d2z * t);
  CP[0] = s; CP[1] = t; CP[2] = px * px + pz * pz;
}
// 핀 선분 위 s 지점의 속도 (넘어지는 핀은 머리 쪽이 더 빠름, 누운 핀은 가운데를 축으로 돎)
const PV = [0, 0], PW = [0, 0];
function pinPointVel(p, s, out) {
  out[0] = p.vx; out[1] = p.vz;
  if (p.st === 'fall') { const w = p.om * Math.cos(p.th) * s * PIN.body; out[0] += p.dx * w; out[1] += p.dz * w; }
  else if (p.st === 'down' && p.yv) { const l = s * PIN.body - PIN.com; out[0] -= p.yv * p.dz * l; out[1] += p.yv * p.dx * l; }
}
function invMassAt(p, s, nx, nz) {   // 누운 핀은 끝을 맞으면 빙글 돌아서 덜 밀림
  if (p.st !== 'down') return 1 / PIN.m;
  const l = s * PIN.body - PIN.com, cr = p.dx * l * nz - p.dz * l * nx;
  return 1 / PIN.m + cr * cr / PIN.I;
}
function startFall(p, dx, dz, om) {
  if (p.st !== 'up') return;
  const d = Math.hypot(dx, dz) || 1;
  p.st = 'fall'; p.dx = dx / d; p.dz = dz / d; p.th = Math.max(p.th, 0.06); p.om = clamp(om, 1, 16); p.wob = 0; p.fallAt = -1;
}
// 서 있는 핀이 받은 속도 변화 → 세면 바로 넘어지고, 약하면 휘청 (많이 휘청이면 조금 뒤에 쓰러짐)
function knock(p, dvx, dvz, t) {
  const dv = Math.hypot(dvx, dvz); if (dv < 1e-4) return;
  const F = 0.42 * p.res;
  if (dv >= F) { p.vx += dvx * 0.85; p.vz += dvz * 0.85; startFall(p, p.vx, p.vz, 1.8 + dv * 4.2); return; }
  p.vx += dvx * 0.4; p.vz += dvz * 0.4;
  const w = 0.05 + 0.32 * dv / F;
  if (w > p.wob) { p.wob = w; p.wx = dvx / dv; p.wz = dvz / dv; p.wobT = t; }
  if (p.wob > 0.24 && p.fallAt < 0) p.fallAt = t + 0.3 + 0.35 * Math.random();
}
function applyImpulse(p, jx, jz, s, t) {
  if (p.st === 'up') { knock(p, jx / PIN.m, jz / PIN.m, t); return; }
  if (p.st === 'fall') { p.vx += jx / PIN.m * 0.4; p.vz += jz / PIN.m * 0.4; p.om *= 0.8; return; }   // 넘어지다 걸리면 조금 느려짐
  p.vx += jx / PIN.m; p.vz += jz / PIN.m;
  const l = s * PIN.body - PIN.com;
  p.yv = clamp(p.yv + (p.dx * l * jz - p.dz * l * jx) / PIN.I, -22, 22);
}
function hitSound(j) {   // 딱딱 소리: 너무 자주 겹치지 않게
  if (j < 0.8 || sim.t - sim.sndT < 0.03) return;
  sim.sndT = sim.t; sfx.pin(clamp(j / 12, 0.08, 1));
}
function collideBall(p, t) {
  if (p.st === 'gone' || p.st === 'off') return;
  pinSeg(p, SA);
  closest(ball.x, ball.z, ball.x, ball.z, SA[0], SA[1], SA[2], SA[3]);
  const R = BALL_R + SA[4];
  if (CP[2] >= R * R) return;
  const s = CP[1], qx = SA[0] + (SA[2] - SA[0]) * s, qz = SA[1] + (SA[3] - SA[1]) * s;
  let nx = qx - ball.x, nz = qz - ball.z; const d = Math.hypot(nx, nz);
  if (d < 1e-6) { nx = 0; nz = 1; } else { nx /= d; nz /= d; }
  const wb = 1 / BALL_M, wp = invMassAt(p, s, nx, nz), sum = wb + wp, pen = R - d;
  ball.x -= nx * pen * wb / sum; ball.z -= nz * pen * wb / sum;
  p.x += nx * pen * wp / sum; p.z += nz * pen * wp / sum;
  pinPointVel(p, s, PV);
  const vn = (PV[0] - ball.vx) * nx + (PV[1] - ball.vz) * nz;
  if (vn >= 0) return;
  // 핀은 공 앞에서 늘 똑같이 튀지 않음 (핀 모양·회전·미끄러짐 때문에 세기와 방향이 조금씩 다름)
  const j = -(1.55 + Math.random() * 0.17) * vn / sum, r = (Math.random() - 0.5) * 0.12, c = Math.cos(r), sn = Math.sin(r);
  const jx = j * (nx * c - nz * sn), jz = j * (nx * sn + nz * c);
  ball.vx -= jx * wb; ball.vz -= jz * wb;
  applyImpulse(p, jx, jz, s, t);
  if (ball.hitT < 0) { ball.hitT = t; sfx.crash(clamp(Math.hypot(ball.vx, ball.vz) / 8, 0.3, 1) * 10); }
  else hitSound(j);
}
function collidePins(a, b, t) {
  if (b.st === 'gone' || b.st === 'off') return;
  if (a.st === 'up' && b.st === 'up' && a.vx === 0 && a.vz === 0 && b.vx === 0 && b.vz === 0) return;
  pinSeg(a, SA); pinSeg(b, SB);
  const R = SA[4] + SB[4];
  if (Math.abs(SA[0] - SB[0]) > 0.9 || Math.abs(SA[1] - SB[1]) > 0.9) return;
  closest(SA[0], SA[1], SA[2], SA[3], SB[0], SB[1], SB[2], SB[3]);
  if (CP[2] >= R * R) return;
  const s = CP[0], u = CP[1];
  const ax = SA[0] + (SA[2] - SA[0]) * s, az = SA[1] + (SA[3] - SA[1]) * s, bx = SB[0] + (SB[2] - SB[0]) * u, bz = SB[1] + (SB[3] - SB[1]) * u;
  let nx = bx - ax, nz = bz - az, d = Math.hypot(nx, nz);
  if (d < 1e-6) { nx = b.x - a.x; nz = b.z - a.z; d = Math.hypot(nx, nz); if (d < 1e-6) { nx = 1; nz = 0; } else { nx /= d; nz /= d; } d = 0; }
  else { nx /= d; nz /= d; }
  const wa = invMassAt(a, s, nx, nz), wb = invMassAt(b, u, nx, nz), sum = wa + wb, pen = R - d;
  a.x -= nx * pen * wa / sum; a.z -= nz * pen * wa / sum; b.x += nx * pen * wb / sum; b.z += nz * pen * wb / sum;
  pinPointVel(a, s, PV); pinPointVel(b, u, PW);
  const vn = (PW[0] - PV[0]) * nx + (PW[1] - PV[1]) * nz;
  if (vn >= 0) return;
  const j = -(1.35 + Math.random() * 0.25) * vn / sum, r = (Math.random() - 0.5) * 0.16, c = Math.cos(r), sn = Math.sin(r);
  const jx = j * (nx * c - nz * sn), jz = j * (nx * sn + nz * c);
  applyImpulse(a, -jx, -jz, s, t);
  applyImpulse(b, jx, jz, u, t);
  hitSound(j * 1.6);
}

function ballStep(dt) {
  const b = ball;
  if (b.st === 'lane') {
    laneStep(b, dt);
    if (b.bumper) { if (bumperBounce(b)) { b.bumps++; game.stats.bumps++; sfx.bumper(clamp(Math.abs(b.vx) / 1.5, 0.2, 1)); } }
    else if (Math.abs(b.x) > LANE.half) { b.st = 'gutter'; b.gutT = sim.t; if (b.hitT < 0) { game.stats.gutters++; sfx.gutter(); } }
    if (b.z > LANE.deck + 0.05) { b.st = 'pit'; b.pitT = sim.t; }
  } else if (b.st === 'gutter') {   // 도랑 가운데로 떨어져 똑바로 굴러감 (핀은 못 맞힘)
    const gx = Math.sign(b.x) * (LANE.half + LANE.gutter / 2);
    b.x += (gx - b.x) * Math.min(1, dt * 10); b.vx = 0;
    b.vz = Math.max(1, b.vz - 0.3 * dt); b.z += b.vz * dt;
    b.y = Math.max(-0.075, b.y - dt * 0.8);
    if (b.z > LANE.deck + 0.05) { b.st = 'pit'; b.pitT = sim.t; }
  } else if (b.st === 'pit') {
    b.z = Math.min(b.z + b.vz * dt * 0.4, LANE.deck + 0.5); b.y = Math.max(-0.45, b.y - dt * 2.5);
  }
}
function pinStep(p, dt, t) {
  if (p.st === 'off') return;
  if (p.st === 'gone') {   // 구덩이로 떨어지거나 도랑에 누움 (보이기만 함)
    if (p.th < Math.PI / 2) p.th = Math.min(Math.PI / 2, p.th + dt * 7);
    if (p.gut) {
      p.y = Math.max(-0.07, p.y - dt * 0.6);
      p.x += (Math.sign(p.x) * (LANE.half + LANE.gutter / 2) - p.x) * Math.min(1, dt * 6);
      p.z += p.vz * dt; p.vz *= Math.max(0, 1 - 3 * dt);
    } else {
      p.vy -= 9.8 * dt; p.y = Math.max(-0.7, p.y + p.vy * dt);
      p.x += p.vx * dt * 0.5; p.z = Math.min(p.z + Math.max(p.vz, 0.3) * dt, LANE.deck + 0.45);
    }
    return;
  }
  let sp = Math.hypot(p.vx, p.vz);
  if (sp > 1e-6) {   // 미끄러짐 마찰: 서 있는 핀은 금방 멈추고, 누운 핀은 좀 미끄러짐
    const dec = (p.st === 'up' ? 9 : p.st === 'fall' ? (p.th < 0.5 ? 3 : 1.2) : 2.6) * dt;
    const k = Math.max(0, sp - dec) / sp; p.vx *= k; p.vz *= k; sp *= k;
    if (sp < 1e-4) { p.vx = 0; p.vz = 0; sp = 0; }
  }
  p.x += p.vx * dt; p.z += p.vz * dt;
  if (p.st === 'up') {
    if (p.wob > 0) p.wob = Math.max(0, p.wob - dt * 0.3);
    if (p.fallAt > 0 && t >= p.fallAt) startFall(p, p.wx, p.wz, 1.0);
  } else if (p.st === 'fall') {
    p.om += 38 * Math.sin(p.th) * dt; p.th += p.om * dt;
    if (p.th >= Math.PI / 2) { p.th = Math.PI / 2; p.st = 'down'; p.yv += (Math.random() - 0.5) * 1.5 * Math.min(1, p.om / 6); hitSound(1 + p.om * 0.4); p.om = 0; }
  } else if (p.st === 'down' && p.yv) {   // 누운 핀이 빙글 돎 (가운데를 축으로)
    const a = p.yv * dt, c = Math.cos(a), s = Math.sin(a), cx = p.x + p.dx * PIN.com, cz = p.z + p.dz * PIN.com;
    const ndx = p.dx * c - p.dz * s, ndz = p.dx * s + p.dz * c;
    p.dx = ndx; p.dz = ndz; p.x = cx - ndx * PIN.com; p.z = cz - ndz * PIN.com;
    p.yv *= Math.max(0, 1 - 2.2 * dt); if (Math.abs(p.yv) < 0.05) p.yv = 0;
  }
  if (p.z > LANE.len - 1.3) {   // 옆 벽(킥백)에 튕겨서 다시 핀 쪽으로
    pinSeg(p, SA);
    const ext = Math.max(Math.abs(SA[0]), Math.abs(SA[2])) + SA[4];
    if (ext > LANE.kick) {
      const s = Math.abs(SA[0]) >= Math.abs(SA[2]) ? Math.sign(SA[0]) : Math.sign(SA[2]);
      p.x -= s * (ext - LANE.kick);
      if (p.vx * s > 0) { const j = Math.abs(p.vx); p.vx = -p.vx * 0.45; if (p.st === 'down') p.yv = clamp(p.yv - s * p.vz * 3, -22, 22); hitSound(j * 2); }
    }
  }
  const lean = p.st === 'up' ? 0 : PIN.com * Math.sin(p.th), cx = p.x + p.dx * lean, cz = p.z + p.dz * lean;
  if (cz > LANE.deck + 0.03) { p.st = 'gone'; p.gut = false; p.vy = 0; }                                         // 뒤 구덩이로
  else if (Math.abs(cx) > LANE.half + 0.04 && sp < 1.5) { p.st = 'gone'; p.gut = true; if (!p.dx && !p.dz) p.dz = 1; }   // 옆 도랑으로 (빨리 날아가는 핀은 벽까지)
}
function physicsStep(dt) {
  sim.t += dt;
  const t = sim.t;
  ballStep(dt);
  for (const p of pins) pinStep(p, dt, t);
  if (ball.st === 'lane' && ball.z > LANE.len - 0.4) for (const p of pins) collideBall(p, t);
  for (let i = 0; i < 10; i++) {
    const a = pins[i];
    if (a.st === 'gone' || a.st === 'off') continue;
    for (let j = i + 1; j < 10; j++) collidePins(a, pins[j], t);
  }
}
function simulate(dt) {
  sim.acc += dt;
  let n = 0;
  while (sim.acc >= DT && n++ < 60) { sim.acc -= DT; physicsStep(DT); }
}
function pinsSettled() {
  for (const p of pins) {
    if (p.st === 'fall') return false;
    if (p.st === 'gone' || p.st === 'off') continue;
    if (Math.hypot(p.vx, p.vz) > 0.04) return false;
    if (p.st === 'up' && (p.wob > 0.05 || p.fallAt > 0)) return false;
    if (p.st === 'down' && Math.abs(p.yv) > 0.3) return false;
  }
  return true;
}

// ============================================================
// 점수 — 프레임마다 쓰러뜨린 핀 수 배열 [[7, 3], [10], ...]
// ============================================================
function frameDone(fr, last) {
  if (!last) return fr[0] === 10 || fr.length >= 2;
  return fr.length >= 3 || (fr.length === 2 && fr[0] + fr[1] < 10);
}
// 마지막 프레임에서 다음 공을 위해 핀 열 개를 새로 세우나
function needRack(fr, last) {
  if (!last) return false;
  if (fr.length === 1) return fr[0] === 10;
  if (fr.length === 2) return fr[0] === 10 ? fr[1] === 10 : fr[0] + fr[1] === 10;
  return true;
}
// 프레임마다 누적 점수 (보너스 공을 아직 기다리면 null)
function frameTotals(frames, F) {
  const rolls = [], starts = [];
  for (const fr of frames) { starts.push(rolls.length); rolls.push(...fr); }
  const out = []; let total = 0;
  for (let f = 0; f < frames.length; f++) {
    const fr = frames[f], i = starts[f];
    let v = null;
    if (f < F - 1) {
      if (fr[0] === 10) { if (rolls.length > i + 2) v = 10 + rolls[i + 1] + rolls[i + 2]; }
      else if (fr.length >= 2) v = fr[0] + fr[1] === 10 ? (rolls.length > i + 2 ? 10 + rolls[i + 2] : null) : fr[0] + fr[1];
    } else if (frameDone(fr, true)) v = fr.reduce((a, b) => a + b, 0);
    if (v === null || (out.length && out[out.length - 1] === null)) { out.push(null); continue; }
    total += v; out.push(total);
  }
  return out;
}
// 지금까지 확정된 점수 (보너스를 기다리는 프레임은 지금까지 쓰러뜨린 만큼만 더함)
function totalOf(p, F = game.F) {
  const t = frameTotals(p.frames, F);
  let sure = 0, k = 0;
  for (; k < t.length && t[k] !== null; k++) sure = t[k];
  for (let f = k; f < p.frames.length; f++) sure += p.frames[f].reduce((a, b) => a + b, 0);
  return sure;
}
// 점수판 칸 표시: X 스트라이크 · / 스페어 · - 0개
function frameMarks(fr, last) {
  const m = [];
  if (!last) {
    if (fr[0] === 10) return ['', 'X'];
    if (fr.length > 0) m.push(fr[0] === 0 ? '-' : String(fr[0]));
    if (fr.length > 1) m.push(fr[0] + fr[1] === 10 ? '/' : fr[1] === 0 ? '-' : String(fr[1]));
    return m;
  }
  let left = 10, fresh = true;
  for (const n of fr) {
    if (fresh && n === 10) m.push('X');
    else if (!fresh && n === left) { m.push('/'); fresh = true; left = 10; }
    else if (fresh) { m.push(n === 0 ? '-' : String(n)); fresh = false; left = 10 - n; }
    else { m.push(n === 0 ? '-' : String(n)); fresh = true; left = 10; }
  }
  return m;
}
// 스플릿: 1번 핀이 쓰러졌고, 남은 핀들이 서로 떨어진 두 무리 이상
function isSplit(up) {
  if (up.includes(0) || up.length < 2) return false;
  const seen = new Set([up[0]]), stack = [up[0]];
  while (stack.length) { const i = stack.pop(); for (const j of up) if (!seen.has(j) && NEAR[i][j]) { seen.add(j); stack.push(j); } }
  return seen.size < up.length;
}

// ============================================================
// 선수 · 경기 흐름
//  turn(차례 알림) → aim(조준) → throw(휘두름) → roll(굴러감) → result(쓰러진 핀) → sweep(핀 정리) → 다음 공 / 다음 선수
// ============================================================
const cur = () => game.players[game.cur];
const isCPU = p => !!p && (game.demo || game.forceCPU || p.cpu >= 0);
const labelOf = p => p.cpu >= 0 ? 'CPU' : 'P' + (p.slot + 1);
const nameOf = p => CHARS[p.ch].name;
function makePlayer(slot, ch, cpu = -1, bumper = false) {
  return { slot, ch, cpu, bumper, frames: [], x: 0.14, ang: -0.3, spin: 0, streak: 0, strikes: 0, spares: 0,
    color: cpu >= 0 ? COLORS[4] : COLORS[slot % 4], hand: Math.random() < 0.75 ? 1 : -1 };   // hand: CPU가 거는 휘기 (1 = 왼쪽으로 휘어 1·3번 사이로)
}
const THROW = { release: 0.36, dur: 0.95 };   // 휘두르기 시작 → 공을 놓는 순간 · 팔로스루 끝
const SWEEP_DUR = 1.75;

function newGame(t) {
  resetRack(); ball.st = 'hold'; ball.y = 0;
  game.cur = 0; game.frame = 0; game.winner = -1; game.tie = false; game.msg = null; game.resultShown = false; game.newRack = true; game.sweep = null;
  for (const p of game.players) { p.frames = []; p.streak = 0; p.strikes = 0; p.spares = 0; }
  enterTurn(t, false);
}
function enterTurn(t, same) {
  game.state = 'turn'; game.stateT = t; game.same = same; game.step = 0; game.charge = null; game.cpuPlan = null; game.motionThrow = false;
  ball.st = 'hold'; ball.y = 0; MO.mode = '';
  if (!same) popMonster(game.cur, t);
}
function enterAim(t) {
  game.state = 'aim'; game.stateT = t; game.charge = null;
  const p = cur();
  if (isCPU(p)) game.cpuPlan = planCPU(p, t);
}
function startThrow(pow, t = T(), known = true) {
  if (game.state !== 'aim' || game.paused) return false;
  game.state = 'throw'; game.stateT = t; game.throwT = t;
  game.pow = clamp(pow, 0, 1); game.powKnown = known; game.charge = null;
  sfx.whoosh(0.25 + 0.35 * game.pow);
  return true;
}
// mo: 조이콘 몸짓으로 굴렸을 때 손목 비틀기로 더하는 휘기(spin)와 휘두른 방향으로 더하는 방향(dAng, 도)
function release(t, mo = null) {
  const p = cur(), human = !isCPU(p);
  const v = speedOf(game.pow) * (1 + gauss() * 0.012);
  // 사람도 매번 똑같진 않게 조금 흔들림: 세게 굴릴수록 더 (빠른 공은 핀을 잘 쓰러뜨리지만 덜 정확). CPU는 계획에 이미 넣음
  const a = (p.ang + (mo ? mo.dAng : 0) + (human ? gauss() * (0.04 + 0.12 * game.pow * game.pow) : 0)) * Math.PI / 180;
  const spin = mo ? clamp(p.spin + mo.spin, -1, 1) : p.spin;
  Object.assign(ball, { x: p.x, z: 0.05, y: 0.06, vx: v * Math.sin(a), vz: v * Math.cos(a), spin, st: 'lane', bumper: !!p.bumper, hitT: -1, gutT: -1, pitT: -1, v0: v, bumps: 0 });
  game.standing = pins.filter(q => q.st === 'up').map(q => q.i);
  for (const q of pins) q.res = 0.75 + Math.random() * 0.5;   // 핀마다 버티는 힘이 조금씩 다름
  sim.t = 0; sim.acc = 0; sim.settle = 0; sim.sndT = -9;
  game.stats.throws++; game.speedKmh = Math.round(v * 3.6);
  game.state = 'roll'; game.stateT = t; game.releaseT = t;
  sfx.drop(); rumbleHuman(0.35, 70);
}
function updateRoll(dt, t) {
  simulate(dt);
  if (ball.st === 'pit' && pinsSettled()) { sim.settle += dt; if (sim.settle > 0.45) finishBall(t); }
  else sim.settle = 0;
  if (game.state === 'roll' && t - game.stateT > 14) { game.stats.timeouts++; finishBall(t); }   // 혹시 안 멈춰도 넘어감
}
function finishBall(t) {
  const p = cur(), last = game.frame === game.F - 1;
  const fr = p.frames[game.frame] || (p.frames[game.frame] = []);
  const fresh = game.standing.length === 10;
  const knocked = game.standing.filter(i => pins[i].st !== 'up').length;
  fr.push(knocked);
  const left = pins.filter(q => q.st === 'up').map(q => q.i);
  const gutterBall = ball.gutT >= 0 && ball.hitT < 0;
  let text, color = '#ffffff', sub = '', big = false;
  if (fresh && knocked === 10) {
    p.streak++; p.strikes++; game.stats.strikes++; big = true; color = '#ffd84d';
    text = p.streak >= 4 ? `${p.streak}연속 스트라이크!` : ['스트라이크!', '더블!', '터키!'][p.streak - 1];
    if (p.streak >= 2) sub = `스트라이크 ${p.streak}번 연속`;
    sfx.strike(p.streak); rumbleHuman(0.8, 320);
  } else if (!fresh && knocked === game.standing.length && knocked > 0) {
    p.spares++; game.stats.spares++; big = true; color = '#7ee0ff'; text = '스페어!';
    sfx.spare(); rumbleHuman(0.5, 180);
  } else {
    if (fresh) p.streak = 0;
    if (knocked === 0) { text = gutterBall ? '도랑에 빠졌어요' : '아깝다!'; color = '#d9d3ee'; sfx.groan(); }
    else { text = `${knocked}개!`; if (fresh && knocked >= 7) sfx.ooh(); }
    if (fresh && isSplit(left)) { sub = '스플릿!'; game.stats.splits++; }
    else if (fresh && left.length === 1) sub = `${left[0] + 1}번 핀 하나 남았어요`;
  }
  showMsg(text, color, sub, big);
  game.lastKnock = knocked;
  game.frameOver = frameDone(fr, last);
  game.newRack = game.frameOver || needRack(fr, last);
  game.state = 'result'; game.stateT = t;
}
function startSweep(t) {
  game.state = 'sweep'; game.stateT = t;
  game.sweep = { t0: t, keep: game.newRack ? [] : pins.filter(q => q.st === 'up').map(q => q.i) };
  sfx.sweep();
}
function afterSweep(t) {
  if (game.newRack) resetRack();
  else for (const q of pins) {
    if (q.st !== 'up') q.st = 'off';
    else Object.assign(q, { vx: 0, vz: 0, wob: 0, fallAt: -1, th: 0, lift: 0 });
  }
  game.sweep = null;
  if (game.frameOver) nextBowler(t); else enterTurn(t, true);
}
function nextBowler(t) {
  game.cur++;
  if (game.cur >= game.players.length) { game.cur = 0; game.frame++; }
  if (game.frame >= game.F) { endGame(t); return; }
  enterTurn(t, false);
}
function endGame(t) {
  game.state = 'end'; game.stateT = t; game.resultShown = false; game.msg = null;
  ball.st = 'hold';
  const tot = game.players.map(p => totalOf(p)), best = Math.max(...tot);
  game.winner = tot.indexOf(best); game.tie = tot.filter(v => v === best).length > 1;
  if (!game.demo) { A.jingle(true); A.cheer(2.2); }
}
function saveRecord(p, score) {   // 프레임 수마다 최고 기록 (사람만). 새 기록이면 예전 기록을, 아니면 -1
  if (p.cpu >= 0 || score <= 0) return -1;
  const rec = S.get('bowling.best', {}) || {}, prev = rec[game.F] && rec[game.F].score || 0;
  if (score <= prev) return -1;
  rec[game.F] = { score, ch: p.ch }; S.set('bowling.best', rec);
  return prev;
}
function showResult() {
  game.resultShown = true;
  const rows = game.players.map((p, i) => ({ p, i, score: totalOf(p) })).sort((a, b) => b.score - a.score);
  const humans = game.players.filter(p => p.cpu < 0), w = game.players[game.winner];
  let title;
  if (game.players.length === 1) title = `${totalOf(w)}점!`;
  else if (game.tie) title = '똑같은 점수, 무승부!';
  else if (humans.length === 1 && w.cpu >= 0) title = `CPU ${nameOf(w)}의 승리!`;
  else if (humans.length === 1) title = '내가 이겼어요!';
  else title = `${labelOf(w)} ${nameOf(w)} 우승!`;
  let record = '';
  for (const r of rows) {
    const prev = saveRecord(r.p, r.score);
    if (prev >= 0 && !record) record = `${labelOf(r.p)} ${nameOf(r.p)} 최고 기록! ${r.score}점${prev ? ` (전: ${prev}점)` : ''}`;
  }
  $('resEyebrow').textContent = `${game.F}프레임 끝!`;
  $('resTitle').textContent = title;
  $('resRecord').textContent = record;
  $('resRecord').classList.toggle('hidden', !record);
  $('resBody').innerHTML = `<ol class="bw-rank">${rows.map((r, k) => `<li${k === 0 && !game.tie ? ' class="win"' : ''}><span class="badge" style="background:${r.p.color}">${labelOf(r.p)}</span><b>${nameOf(r.p)}</b><strong>${r.score}점</strong><span>스트라이크 ${r.p.strikes} · 스페어 ${r.p.spares}</span></li>`).join('')}</ol>`;
  $('result').classList.remove('hidden');
}
function showMsg(text, color = '#fff', sub = '', big = false) { game.msg = { text, color, sub, big, t: T() }; }

// ---------- CPU: 처음 공은 1·3번 사이(포켓)로 휘어 들어가게, 남은 핀은 앞쪽 핀 위주로 똑바로 ----------
function solveAngle(x0, spin, v, tx) {   // 핀 줄(18.29m)에서 tx에 오도록 하는 방향 (반으로 나눠 찾기)
  let lo = -3, hi = 3;
  const f = a => predictPath(x0, a, spin, v, { free: true }).x - tx;
  if (f(lo) > 0) return lo;
  if (f(hi) < 0) return hi;
  for (let i = 0; i < 18; i++) { const m = (lo + hi) / 2; if (f(m) > 0) hi = m; else lo = m; }
  return (lo + hi) / 2;
}
function planCPU(p, t) {
  const lv = p.cpu >= 0 ? p.cpu : 2;
  const up = pins.filter(q => q.st === 'up'), fresh = up.length === 10;
  let spin, tx, pow, x0;
  if (fresh) {
    spin = -p.hand * [0.1, 0.45, 0.62][lv] * rand(0.85, 1.15);
    tx = p.hand * 0.065 + (lv === 0 ? rand(-0.1, 0.1) : 0);   // 쉬움은 포켓을 대충 노림
    pow = [rand(0.2, 0.55), rand(0.45, 0.8), rand(0.7, 0.9)][lv];
    x0 = p.hand * (0.1 + 0.2 * Math.abs(spin));
  } else {
    // 맨 앞 핀(키 핀)을 나머지 핀이 있는 쪽 옆구리로 맞힘 → 키 핀이 옆 핀을 넘어뜨림
    const key = up.reduce((a, q) => (q.z < a.z ? q : a), up[0] || { x: 0, z: LANE.len }), rest = up.filter(q => q !== key);
    const side = rest.length ? Math.sign(rest.reduce((a, q) => a + q.x, 0) / rest.length - key.x) : 0;
    tx = key.x + side * 0.06; spin = 0;
    pow = [rand(0.25, 0.6), rand(0.5, 0.8), rand(0.7, 0.9)][lv];
    x0 = clamp(-tx * 0.6, -0.32, 0.32);   // 구석 핀은 반대쪽에서 비스듬히 (도랑에 덜 빠짐)
  }
  let ang = solveAngle(x0, spin, speedOf(pow), tx) + gauss() * [0.95, 0.36, 0.08][lv];   // 핀 줄에서 쉬움 ±30cm · 보통 ±11cm · 어려움 ±2.6cm
  spin = clamp(spin + gauss() * [0.08, 0.04, 0.015][lv], -1, 1);   // 휘기·세기도 계획과 조금 다르게 (휘는 양이 달라짐)
  pow = clamp(pow + gauss() * [0.06, 0.04, 0.015][lv], 0, 1);
  return { x: x0, ang: clamp(ang, -3, 3), spin, pow, t0: t, at: t + (game.demo ? rand(1.0, 1.5) : rand(1.3, 2.1)), from: { x: p.x, ang: p.ang, spin: p.spin } };
}
function cpuAim(t) {   // 생각하는 동안 조준 표시가 천천히 움직이다가 굴림
  const P = game.cpuPlan, p = cur(); if (!P) return;
  const k = smooth((t - P.t0) / Math.max(0.3, (P.at - P.t0) * 0.8));
  p.x = lerp(P.from.x, P.x, k); p.ang = lerp(P.from.ang, P.ang, k); p.spin = lerp(P.from.spin, P.spin, k);
  game.step = k < 0.34 ? 0 : k < 0.67 ? 1 : 2;
  if (t >= P.at) { game.cpuPlan = null; startThrow(P.pow, t); }
}

// ---------- 조준 조작 ----------
function nudge(dir) {
  const p = cur(); if (!p || game.state !== 'aim' || isCPU(p)) return;
  const a = AIM[game.step];
  p[a.key] = clamp(Math.round((p[a.key] + dir * a.nudge) / a.nudge) * a.nudge, a.lo, a.hi);
  sfx.tick();
}
function stepBy(d) { if (game.state !== 'aim' || isCPU(cur())) return; game.step = (game.step + d + 3) % 3; sfx.tick(); }
function toggleBumperNow() {
  const p = cur(); if (!p || isCPU(p) || game.demo) return;
  p.bumper = !p.bumper;
  settings.bumpers[p.slot] = p.bumper;
  const c = sel.cards.find(x => x.slot === p.slot && x.cpu < 0); if (c) c.bumper = p.bumper;
  saveSettings(); sfx.tick();
  showToast(p.bumper ? '범퍼 켬 — 공이 도랑에 안 빠져요' : '범퍼 끔');
}
function chargeStart() { if (game.state !== 'aim' || game.paused || game.demo || isCPU(cur()) || game.charge) return; game.charge = { t0: realNow() }; }
function chargeEnd() { if (!game.charge) return; const pow = chargePow(); game.charge = null; if (game.state === 'aim') startThrow(pow); }
function chargePow() {   // 힘 막대: 0.15 ↔ 1 을 오르내림 (원하는 때 떼기)
  if (!game.charge) return 0;
  const u = ((realNow() - game.charge.t0) / 1.0) % 2;
  return 0.15 + 0.85 * (u < 1 ? u : 2 - u);
}
const held = new Set(), heldAt = {};
let joyAxis = 0, padAxis = 0;
function aimInput(dt) {
  const p = cur(); if (!p || isCPU(p) || game.state !== 'aim') return;
  let ax = joyAxis + padAxis;
  const now = realNow();
  if (held.has('ArrowLeft') && now - heldAt.ArrowLeft > 0.22) ax -= 1;    // 꾹 누르면 계속 (한 번 누르면 한 칸)
  if (held.has('ArrowRight') && now - heldAt.ArrowRight > 0.22) ax += 1;
  ax = clamp(ax, -1, 1);
  if (!ax) return;
  const a = AIM[game.step];
  p[a.key] = clamp(p[a.key] + ax * a.rate * dt, a.lo, a.hi);
}

// ============================================================
// 캐릭터 고르기 — 사람 수만큼 카드. 아직 준비 안 한 맨 앞 사람이 고르는 중
// ============================================================
const sel = { cards: [], startAt: 0 };
let rosterBuilt = false;
const selCurrent = () => sel.cards.find(c => c.cpu < 0 && !c.ready) || null;
function openSelect() {
  setDemoPaused(false);
  sfx.init(); saveSettings(); buildRoster();
  game.demo = false; game.paused = false; game.state = 'select'; game.stateT = T(); game.msg = null; game.winner = -1;
  hideOverlays('menu', 'result', 'pause');
  $('select').classList.remove('hidden');
  assignJoyCons();
  const humans = settings.mode === 'family' ? settings.count : 1;
  sel.cards = [];
  for (let i = 0; i < humans; i++) sel.cards.push({ slot: i, ch: settings.chars[i], bumper: settings.bumpers[i], ready: false, cpu: -1 });
  if (settings.mode === 'solo' && settings.cpu >= 0) {
    const used = sel.cards.map(c => c.ch), free = CHARS.map((c, k) => k).filter(k => !used.includes(k));
    sel.cards.push({ slot: 1, ch: free[Math.floor(Math.random() * free.length)], bumper: false, ready: true, cpu: settings.cpu });
  }
  sel.startAt = 0;
  game.players = sel.cards.map(c => makePlayer(c.slot, c.ch, c.cpu, c.bumper));   // 3D로 줄 세워 보여 주기용
  buildSelectCards(); rebuildMonsters(); renderSelect();
  const c = selCurrent(); if (c) revealRosterCharacter(c.ch);
}
function selSetChar(c, k) {
  c.ch = k; c.ready = false;
  settings.chars[c.slot] = k; saveSettings();
  const i = sel.cards.indexOf(c); if (game.players[i]) { game.players[i].ch = k; rebuildMonster(i); }
  sel.startAt = 0; sfx.tick(); renderSelect(); revealRosterCharacter(k);
}
function selMove(d, i = -1) {
  if (game.state !== 'select') return;
  const c = i >= 0 ? sel.cards[i] : selCurrent(); if (!c || c.cpu >= 0) return;
  selSetChar(c, (c.ch + d + CHARS.length) % CHARS.length);
}
function selPick(k) {   // 목록에서 친구를 누름 (같은 친구를 또 누르면 준비)
  if (game.state !== 'select') return;
  const c = selCurrent(); if (!c) return;
  if (c.ch === k) selReady(); else selSetChar(c, k);
}
function selBumper(i = -1) {
  if (game.state !== 'select') return;
  const c = i >= 0 ? sel.cards[i] : selCurrent(); if (!c || c.cpu >= 0) return;
  c.bumper = !c.bumper; settings.bumpers[c.slot] = c.bumper; saveSettings(); sfx.tick(); renderSelect();
}
function selReady(i = -1) {   // 카드 버튼(i)은 준비를 켜고 끔, 조이콘·키보드는 지금 고르는 사람 준비
  if (game.state !== 'select') return;
  const c = i >= 0 ? sel.cards[i] : selCurrent(); if (!c || c.cpu >= 0) return;
  c.ready = i >= 0 ? !c.ready : true;
  if (c.ready) sfx.ready(); else sel.startAt = 0;
  renderSelect(); checkSelectStart();
  const n = selCurrent(); if (n) revealRosterCharacter(n.ch);
}
function selUnready() {   // 마지막으로 준비한 사람을 다시 고르는 중으로
  if (game.state !== 'select') return;
  const list = sel.cards.filter(c => c.cpu < 0 && c.ready), c = list[list.length - 1]; if (!c) return;
  c.ready = false; sel.startAt = 0; sfx.tick(); renderSelect();
}
function checkSelectStart() { if (sel.cards.every(c => c.ready) && !sel.startAt) { sel.startAt = T() + 1.2; renderSelect(); } }
function revealRosterCharacter(k) {   // 목록 칸만 스크롤 (아래 카드는 그대로)
  const roster = $('roster');
  if (!roster || !roster.querySelector || !roster.getBoundingClientRect) return;
  const tile = roster.querySelector(`.tile[data-k="${k}"]`);
  if (!tile || !tile.getBoundingClientRect) return;
  const viewport = roster.getBoundingClientRect(), card = tile.getBoundingClientRect();
  if (card.top < viewport.top + 8) roster.scrollTop -= viewport.top + 8 - card.top;
  else if (card.bottom > viewport.bottom - 8) roster.scrollTop += card.bottom - viewport.bottom + 8;
}
function buildRoster() {
  if (rosterBuilt) return;
  rosterBuilt = true;
  const el = $('roster');
  el.innerHTML = CHARS.map((ch, k) => `<button type="button" class="tile" data-k="${k}" aria-label="${ch.name} 캐릭터 선택"><span class="bw-dots" aria-hidden="true"></span><canvas width="200" height="200" aria-hidden="true"></canvas><span class="tn">${ch.name}</span><span class="character-type">${ch.tag || '볼링 친구'}</span></button>`).join('');
  if (el.querySelectorAll) el.querySelectorAll('canvas').forEach((c, k) => NC.portrait(c, CHARS[k]));
  el.onclick = e => { const tl = e.target && e.target.closest ? e.target.closest('.tile') : null; if (tl) selPick(+tl.dataset.k); };
}
const cardColor = c => c.cpu >= 0 ? COLORS[4] : COLORS[c.slot % 4];
function buildSelectCards() {
  const box = $('selCards'); if (!box) return;
  box.innerHTML = sel.cards.map((c, i) => `<div class="selcard bw-card" id="bwc${i}"><div class="row"><span class="badge" style="background:${cardColor(c)}">${c.cpu >= 0 ? 'CPU' : 'P' + (c.slot + 1)}</span><b class="nm" id="bwn${i}"></b><span class="st" id="bws${i}"></span></div>`
    + (c.cpu >= 0 ? `<div class="row"><span class="small">CPU 실력 ${LEVELS[c.cpu]} · 범퍼 없이</span></div>`
      : `<div class="row"><button type="button" data-act="prev" data-i="${i}" aria-label="P${c.slot + 1} 이전 캐릭터">←</button><button type="button" data-act="next" data-i="${i}" aria-label="P${c.slot + 1} 다음 캐릭터">→</button><button type="button" class="bw-bump" data-act="bump" data-i="${i}" id="bwu${i}"></button><button type="button" data-act="ready" data-i="${i}">준비</button></div>`)
    + '</div>').join('');
  box.onclick = e => {
    const b = e.target && e.target.closest ? e.target.closest('button[data-act]') : null; if (!b) return;
    const i = +b.dataset.i, act = b.dataset.act;
    if (act === 'prev') selMove(-1, i); else if (act === 'next') selMove(1, i); else if (act === 'bump') selBumper(i); else selReady(i);
  };
}
function renderSelect() {
  const now = selCurrent();
  document.querySelectorAll('#roster .tile').forEach(tl => {
    const k = +tl.dataset.k;
    tl.classList.toggle('p1', !!now && now.ch === k);
    const dots = tl.querySelector ? tl.querySelector('.bw-dots') : null;
    if (dots) dots.innerHTML = sel.cards.filter(c => c.ch === k).map(c => `<i style="background:${cardColor(c)}"></i>`).join('');
  });
  sel.cards.forEach((c, i) => {
    $('bwn' + i).textContent = CHARS[c.ch].name;
    $('bws' + i).textContent = c.ready ? '준비 완료!' : c === now ? '고르는 중…' : '기다려요';
    const card = $('bwc' + i); card.classList.toggle('rd', c.ready); card.classList.toggle('bw-now', c === now);
    const bu = $('bwu' + i);
    if (bu && c.cpu < 0) { bu.textContent = c.bumper ? '범퍼 켬' : '범퍼 끔'; bu.setAttribute('aria-pressed', String(c.bumper)); bu.classList.toggle('on', c.bumper); }
  });
  $('selMsg').textContent = sel.startAt ? '모두 준비 완료! 곧 시작…' : now ? `P${now.slot + 1} 차례 — 친구를 고르고 휘두르면 준비!` : '';
}
function selKey(e) {
  if (e.code === 'Escape') { toMenu(); return; }
  if (e.code === 'ArrowLeft') selMove(-1);
  else if (e.code === 'ArrowRight') selMove(1);
  else if (e.code === 'ArrowUp' || e.code === 'ArrowDown' || e.code === 'KeyB') selBumper();
  else if (e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Space') { if (e.preventDefault) e.preventDefault(); selReady(); }
  else if (e.code === 'Backspace') selUnready();
}

// ---------- 경기 시작 · 메뉴 · 일시정지 ----------
function hideOverlays(...ids) { for (const id of ids) $(id).classList.add('hidden'); }
function startMatch() {
  if (!sel.cards.length) { openSelect(); return; }
  setDemoPaused(false);
  sfx.init(); saveSettings();
  game.demo = false; game.paused = false; sel.startAt = 0;
  game.players = sel.cards.map(c => makePlayer(c.slot, c.ch, c.cpu, c.bumper));
  game.F = settings.frames;
  game.stats = { throws: 0, strikes: 0, spares: 0, gutters: 0, splits: 0, bumps: 0, timeouts: 0 };
  hideOverlays('menu', 'result', 'pause', 'select');
  assignJoyCons(); rebuildMonsters();
  newGame(T());
}
function startDemo() {
  game.demo = true; game.paused = false;
  const a = Math.floor(Math.random() * CHARS.length); let b = Math.floor(Math.random() * (CHARS.length - 1)); if (b >= a) b++;
  game.players = [makePlayer(0, a, 2), makePlayer(1, b, 1)];
  game.F = 10;
  rebuildMonsters(); newGame(T());
}
function toMenu() {
  setDemoPaused(false);
  game.paused = false; sel.startAt = 0; game.msg = null;
  hideOverlays('pause', 'result', 'select');
  $('menu').classList.remove('hidden');
  startDemo(); syncMenu();
}
function pause() {
  if (game.paused || game.demo || game.state === 'select' || game.state === 'end') return;
  pausedAt = realNow(); game.paused = true; game.charge = null; held.clear();
  $('pause').classList.remove('hidden');
  $('pauseInfo').textContent = gfxInfoText();
  A.roll(null);
}
function resume() {
  if (!game.paused) return;
  pauseOffset += realNow() - pausedAt; game.paused = false; $('pause').classList.add('hidden');
}
const menuOpen = () => !$('menu').classList.contains('hidden');
const resultOpen = () => !$('result').classList.contains('hidden');
const selectOpen = () => !$('select').classList.contains('hidden');
function onConfirm() {
  if (resultOpen()) { startMatch(); return; }
  if (game.paused) { resume(); return; }
  if (menuOpen()) openSelect();
}

// ---------- 키보드 ----------
function aimKeyDown(code) {
  if (game.state !== 'aim' || isCPU(cur())) return;
  if (code === 'ArrowLeft') nudge(-1);
  else if (code === 'ArrowRight') nudge(1);
  else if (code === 'ArrowUp') stepBy(-1);
  else if (code === 'ArrowDown') stepBy(1);
  else if (code === 'Space' || code === 'Enter' || code === 'NumpadEnter') chargeStart();
  else if (code === 'KeyA') startThrow(0.25);
  else if (code === 'KeyS') startThrow(0.6);
  else if (code === 'KeyD') startThrow(0.92);
  else if (code === 'KeyB') toggleBumperNow();
}
window.addEventListener('keydown', e => {
  sfx.init();
  if (e.code === 'KeyF') { if (!e.repeat) toggleFull(); return; }
  // 목록 칸에 초점이 있으면 Enter·Space의 기본 클릭 동작을 씀
  if (e.target && e.target.closest && e.target.closest('#roster .tile') && ['Enter', 'NumpadEnter', 'Space'].includes(e.code)) return;
  if (selectOpen()) { if (!e.repeat) selKey(e); return; }
  if (e.code === 'Escape') {
    if (e.repeat) return;
    if (game.paused) resume(); else if (resultOpen()) toMenu(); else if (!game.demo) pause();
    return;
  }
  if (menuOpen() || resultOpen() || game.paused) {
    if ((e.code === 'Enter' || e.code === 'NumpadEnter') && !e.repeat) { if (e.preventDefault) e.preventDefault(); onConfirm(); }
    return;
  }
  if (game.demo) return;
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space'].includes(e.code) && e.preventDefault) e.preventDefault();
  if (e.repeat) return;
  held.add(e.code); heldAt[e.code] = realNow();
  aimKeyDown(e.code);
});
window.addEventListener('keyup', e => {
  held.delete(e.code);
  if (['Space', 'Enter', 'NumpadEnter'].includes(e.code)) chargeEnd();
});
window.addEventListener('blur', () => { held.clear(); game.charge = null; });

// ---------- 게임패드 (조이콘이 아닌 패드) ----------
const padPrev = {};
function pollGamepads() {
  padAxis = 0; game.padCount = 0;
  if (!navigator.getGamepads) return;
  let pads; try { pads = navigator.getGamepads() || []; } catch (e) { return; }
  for (const gp of pads) {
    if (!gp || !gp.connected || (JC.supported && /057e|joy-con|pro controller|nintendo/i.test(gp.id))) continue;   // PC에선 조이콘은 WebHID로 받음
    game.padCount++;
    const now = gp.buttons.map(b => b.pressed || b.value > 0.5), prev = padPrev[gp.index] || { b: [], sx: 0, sy: 0 };
    const rise = i => !!now[i] && !prev.b[i], fall = i => !now[i] && !!prev.b[i];
    const std = gp.mapping === 'standard', ax = gp.axes && gp.axes.length ? gp.axes[0] : 0, ay = gp.axes && gp.axes.length > 1 ? gp.axes[1] : 0;
    const dx = std ? (now[15] ? 1 : 0) - (now[14] ? 1 : 0) : 0, dy = std ? (now[13] ? 1 : 0) - (now[12] ? 1 : 0) : 0;
    const sx = dx || (ax > 0.6 ? 1 : ax < -0.6 ? -1 : 0), sy = dy || (ay > 0.6 ? 1 : ay < -0.6 ? -1 : 0);
    padPrev[gp.index] = { b: now, sx, sy };
    if (selectOpen()) {
      if (sx && sx !== prev.sx) selMove(sx);
      if (rise(0) || rise(9)) selReady();
      if (rise(1)) selUnready();
      if (rise(2) || rise(3)) selBumper();
      continue;
    }
    if (menuOpen() || resultOpen() || game.paused) { if (rise(0) || rise(9)) onConfirm(); continue; }
    if (game.demo) continue;
    if (rise(9)) { pause(); continue; }
    if (game.state !== 'aim' || isCPU(cur())) continue;
    if (Math.abs(ax) > 0.25) padAxis += (Math.abs(ax) - 0.25) / 0.75 * Math.sign(ax);
    if (sx && sx !== prev.sx) nudge(sx);
    if (sy && sy !== prev.sy) stepBy(sy);
    if (rise(0)) chargeStart();
    if (fall(0)) chargeEnd();
    if (rise(5) || rise(7)) startThrow(0.92);
    else if (rise(4) || rise(6)) startThrow(0.25);
    else if (rise(2)) startThrow(0.6);
    if (rise(3)) toggleBumperNow();
  }
  padAxis = clamp(padAxis, -1, 1);
}

// ---------- 조이콘 (공용 모듈 shared/joycon.js) ----------
// 차례대로 치니까 조이콘은 모두 '지금 치는 사람' 것 (하나를 돌려 써도, 여럿이 하나씩 쥐어도 됨)
function assignJoyCons() { JC.single = true; JC.assign(); }
function rumbleHuman(amp, ms) { if (!game.demo && !isCPU(cur())) JC.rumble(0, amp, ms); }
const jcPrev = new Map();
function pollJoy() {
  joyAxis = 0;
  for (const jc of JC.list) {
    if (!jc.ok || !jc.stick) continue;
    const ux = clamp((jc.stick.x - 2048) / 1400, -1, 1), uy = clamp((jc.stick.y - 2048) / 1400, -1, 1);
    const pr = jcPrev.get(jc) || { hold: 0, sx: 0, sy: 0 };
    if (Math.abs(ux) > 0.25) joyAxis += (Math.abs(ux) - 0.25) / 0.75 * Math.sign(ux);
    const sx = ux > 0.6 ? 1 : ux < -0.6 ? -1 : 0, sy = uy > 0.6 ? 1 : uy < -0.6 ? -1 : 0;
    const trig = (jc.hold || 0) & (B.SHOULDER | B.TRIGGER), was = pr.hold & (B.SHOULDER | B.TRIGGER);
    jcPrev.set(jc, { hold: jc.hold || 0, sx, sy });
    if (selectOpen()) {
      if (sx && sx !== pr.sx) selMove(sx);
      if (sy && sy !== pr.sy) selBumper();
      if (trig && !was) selReady();
      continue;
    }
    if (game.paused || game.demo) continue;
    if (sy && sy !== pr.sy) stepBy(-sy);   // 스틱 위 = 앞 칸, 아래 = 다음 칸
    if (motionJoy(jc)) { if (trig && !was && game.state === 'aim' && !isCPU(cur())) startMotion(jc, 'grip', T()); }   // R·ZR을 누르는 순간 공을 쥠 (아래 '조이콘 몸짓')
    else if (trig && !was) chargeStart();  // 자세를 모르는 조이콘: R·ZR (L·ZL)을 꾹 눌렀다 떼면 굴러감
    else if (!trig && was) chargeEnd();
  }
  joyAxis = clamp(joyAxis, -1, 1);
}
function onJoyButtons(m) {
  if (selectOpen()) {
    if (m & (B.Y | B.LEFT)) selMove(-1);
    else if (m & (B.A | B.RIGHT)) selMove(1);
    else if (m & (B.X | B.UP | B.B | B.DOWN)) selBumper();
    else if (m & B.PLUS) selReady();
    else if (m & B.MINUS) selUnready();
    return;
  }
  if (menuOpen() || resultOpen()) { onConfirm(); return; }
  if (game.paused) { resume(); return; }
  if (game.demo) return;
  if (m & (B.PLUS | B.MINUS)) { pause(); return; }
  if (game.state !== 'aim' || isCPU(cur())) return;
  if (m & (B.Y | B.LEFT)) nudge(-1);
  else if (m & (B.A | B.RIGHT)) nudge(1);
  else if (m & (B.X | B.UP)) stepBy(-1);
  else if (m & (B.B | B.DOWN)) stepBy(1);
}
// 자세를 모르는 조이콘(가속도가 아직 안 옴)만: 휘두르기 시작하자마자 팔을 뒤로 뺌 (세기는 0.09초 뒤 'swing'에서)
function onSwingStart(jc) {
  if (selectOpen() || menuOpen() || resultOpen() || game.paused || game.demo || motionJoy(jc)) return;
  if (game.state === 'aim' && !isCPU(cur())) startThrow(0.5, T(), false);
}
function onSwing(pow, jc) {
  if (selectOpen()) { selReady(); return; }
  if (menuOpen() || resultOpen() || game.paused || game.demo || motionJoy(jc)) return;
  if (game.state === 'throw' && !game.powKnown) { game.pow = clamp(pow, 0, 1); game.powKnown = true; return; }
  if (game.state === 'aim' && !isCPU(cur())) startThrow(pow, T(), true);
}
JC.on('swingstart', (pi, t, jc) => onSwingStart(jc));
JC.on('swing', (pi, pow, t, jc) => onSwing(pow, jc));
JC.on('buttons', (pi, m) => onJoyButtons(m));
JC.on('change', () => renderSlots());

// ============================================================
// 조이콘 몸짓 — 닌텐도 위 볼링처럼 화면 속 팔이 내 팔을 그대로 따라감
//  · R·ZR(왼쪽 조이콘은 L·ZL)을 누른 채 뒤로 → 앞으로 휘두르다 버튼을 놓으면 그 순간 공이 나감
//  · 버튼 없이 휘둘러도: 뒤로 크게 뺐다가 앞으로 맨 아래를 지날 때 저절로 나감
//  · 놓는 순간 팔이 도는 빠르기 = 공 빠르기 · 손목 비틀기 = 휘기(조준한 휘기에 더함) · 휘두른 쪽 = 방향(조금)
//  · 뒤로 빼는 중에 놓으면 공이 뒤로 툭 떨어지고 다시 (점수엔 안 들어감)
//  팔 각도 th: 어깨→손(jc.arm)이 아래에서 앞쪽으로 돈 각도 (0 아래 · + 앞 · - 뒤, 라디안)
//  앞: 조이콘을 가만히 앞으로 들고 있을 때 가리키는 가로 방향 (조준하며 스틱을 만질 때 저절로 맞춰짐)
// ============================================================
const MO = { jc: null, mode: '', t0: -9, th: 0, prev: 0, lo: 0, hi: 0, hist: [], relT: -9, last: null };
const MV = { A: { x: 0, y: 0, z: 0 }, W: { x: 0, y: 0, z: 0 } };
const motionJoy = jc => !!(jc && jc.ok && jc.q);
function armState(jc) {
  const A = JC.armWorld(jc, MV.A), W = JC.rateWorld(jc, MV.W), h = jc.bwH || (jc.bwH = { x: 1, y: 0 });
  const vx = W.y * A.z - W.z * A.y, vy = W.z * A.x - W.x * A.z;   // 손이 움직이는 방향 (ω × 팔)
  return {
    th: Math.atan2(A.x * h.x + A.y * h.y, -A.z),
    rate: W.x * h.y - W.y * h.x,                                   // 오른쪽 축 기준 회전: + 앞으로 휘두름
    twist: W.x * A.x + W.y * A.y + W.z * A.z,                      // 팔 축 기준: 팔이 아래일 때 + = 위에서 볼 때 시계
    dir: Math.atan2(vx * h.y - vy * h.x, vx * h.x + vy * h.y),     // 손이 나가는 쪽: + 오른쪽
    vx, vy,
  };
}
// 뒤로 빼는 손이 가는 쪽의 반대를 '앞'으로 다시 맞춤: 조준할 때 조이콘을 비스듬히 들고 있었어도 휘두르는 면을 기준으로
function alignToBackswing(jc, s) {
  const vh = Math.hypot(s.vx, s.vy), h = jc.bwH;
  if (s.rate > -1.5 || vh < 0.6 || s.th < -1.2) return;
  h.x += (-s.vx / vh - h.x) * 0.35; h.y += (-s.vy / vh - h.y) * 0.35;
  const n = Math.hypot(h.x, h.y) || 1; h.x /= n; h.y /= n;
}
function trackHeading(jc, dt) {
  const A = JC.armWorld(jc, MV.A), W = JC.rateWorld(jc, MV.W), flat = Math.hypot(A.x, A.y);
  if (flat < 0.55 || Math.hypot(W.x, W.y, W.z) > 1) return;   // 거의 아래·위를 가리키거나 움직이는 중이면 그대로
  const h = jc.bwH;
  if (!h) { jc.bwH = { x: A.x / flat, y: A.y / flat }; return; }
  const k = Math.min(1, dt / 0.4);
  h.x += (A.x / flat - h.x) * k; h.y += (A.y / flat - h.y) * k;
  const n = Math.hypot(h.x, h.y) || 1; h.x /= n; h.y /= n;
}
function startMotion(jc, mode, t) {
  if (game.state !== 'aim' || game.paused) return;
  if (mode === 'grip') {   // 쥐는 순간 조이콘을 앞으로 들고 있으면 그쪽이 앞
    const A = JC.armWorld(jc, MV.A), flat = Math.hypot(A.x, A.y);
    if (flat > 0.45) jc.bwH = { x: A.x / flat, y: A.y / flat };
  }
  const s = armState(jc);
  Object.assign(MO, { jc, mode, t0: t, th: s.th, prev: s.th, lo: s.th, hi: s.th, hist: [], last: null });
  game.state = 'throw'; game.stateT = t; game.throwT = t; game.charge = null; game.powKnown = false; game.motionThrow = true;
}
function endMotion(t, msg) {   // 굴리지 않고 조준으로
  MO.mode = ''; game.motionThrow = false; game.state = 'aim'; game.stateT = t;
  if (msg) showToast(msg);
}
function motionStep(t, dt) {
  for (const jc of JC.list) if (motionJoy(jc) && !(MO.mode && jc === MO.jc)) trackHeading(jc, dt);
  const p = cur(), st = game.state;
  if (!p || isCPU(p) || game.demo || game.paused) { MO.mode = ''; return; }
  if (st === 'aim') {   // 버튼 없이 뒤로 크게 빼면 시작
    for (const jc of JC.list) {
      if (!motionJoy(jc)) continue;
      const s = armState(jc);
      if (s.th < -0.55 && s.rate < -2) { startMotion(jc, 'auto', t); break; }
    }
  } else if (st === 'throw' && MO.mode) stepMotion(t);
  else if (game.motionThrow && (st === 'roll' || st === 'result') && t - MO.relT < 0.9 && motionJoy(MO.jc)) MO.th = armState(MO.jc).th;   // 팔로스루도 그대로
}
function stepMotion(t) {
  const jc = MO.jc;
  if (!motionJoy(jc)) { endMotion(t, ''); return; }
  let s = armState(jc);
  if (MO.hi - s.th < 2.2 && s.rate < -1.5) { alignToBackswing(jc, s); s = armState(jc); }   // 앞으로 휘두르기 전까지
  MO.prev = MO.th; MO.th = s.th; MO.lo = Math.min(MO.lo, s.th); MO.hi = Math.max(MO.hi, s.th);
  MO.hist.push({ t, rate: s.rate, twist: s.twist });
  while (MO.hist.length && t - MO.hist[0].t > 0.25) MO.hist.shift();
  const trig = !!((jc.hold || 0) & (B.SHOULDER | B.TRIGGER));
  if (MO.mode === 'auto' && trig) MO.mode = 'grip';
  if (MO.mode === 'grip') {
    if (trig) { if (t - MO.t0 > 10) endMotion(t, ''); return; }
    if (MO.hi - MO.lo < 0.45) { endMotion(t, '공을 쥔 채 뒤로 휘둘렀다가, 앞으로 휘두르면서 놓아요'); return; }
    if (s.th < 0.35 && recentRate(t, s) < 0.6) { dropBall(t, s.th < -0.3); return; }   // 앞으로 휘두르는 중이 아니면 손에서 툭
    releaseMotion(t, s);
    return;
  }
  if (MO.lo < -0.7 && MO.prev < 0.17 && s.th >= 0.17 && s.rate > 1.2) { releaseMotion(t, s); return; }   // 앞으로 맨 아래(+10°)를 지남
  if (t - MO.t0 > 2.5) endMotion(t, '');
}
const recentRate = (t, s) => MO.hist.reduce((a, h) => (t - h.t <= 0.12 ? Math.max(a, h.rate) : a), s.rate);   // 0.12초 안에 앞으로 가장 빨리 돈 빠르기
function releaseMotion(t, s) {
  const recent = MO.hist.filter(h => t - h.t <= 0.12);
  const twist = recent.reduce((a, h) => a + h.twist, s.twist) / (recent.length + 1);
  const dps = recentRate(t, s) * 180 / Math.PI * settings.sensitivity;
  const pow = clamp((dps - 100) / 400, 0, 1);                                                       // 초당 100° → 가장 느림, 500° → 가장 빠름
  const spin = Math.abs(twist) < 1.2 ? 0 : clamp((twist - Math.sign(twist) * 1.2) / 4.8, -1, 1);    // 초당 70° 안쪽은 그냥 흔들림, 340°면 가장 많이 휨
  const dirDeg = s.dir * 180 / Math.PI, dAng = Math.abs(dirDeg) < 3 ? 0 : clamp((dirDeg - Math.sign(dirDeg) * 3) * 0.12, -1.5, 1.5);
  game.pow = pow; game.powKnown = true;
  MO.last = { pow, spin, dAng, dps, th: s.th }; MO.mode = ''; MO.relT = t;
  release(t, { spin, dAng });
}
function dropBall(t, behind) {   // 뒤로 빼는 중이거나 멈춰서 놓음 → 공이 손에서 툭 (다시 해요)
  const H = G3.hold, p = cur();
  game.drop = { x: H ? H.x : p.x - 0.04, y: H ? H.y : 0.45, z: H ? H.z : 0.55, back: behind ? 0.45 : 0.12, t0: t };
  ball.st = 'drop'; MO.mode = ''; game.motionThrow = false;
  game.state = 'oops'; game.stateT = t;
  sfx.drop(); sfx.groan(); rumbleHuman(0.4, 120);
  showMsg(behind ? '앗, 공이 뒤로!' : '앗, 공을 떨어뜨렸어요!', '#ffd84d', '앞으로 휘두르면서 버튼을 놓아요');
}

// ============================================================
// 메뉴 UI
// ============================================================
const VOL = [['volMusic', 'music'], ['volSfx', 'sfx'], ['volCrowd', 'crowd']];   // 설정 화면 슬라이더 → 소리 줄기
function renderSlots() {
  const el = $('slots'); if (!el) return;
  const inputs = [...JC.list.map(j => j.name + (j.err ? ` ⚠ ${j.err}` : j.ok ? ' ✓' : ' (연결 중)')), game.padCount ? '게임패드' : '', '키보드'].filter(Boolean);
  el.innerHTML = `<div class="slot"><span class="badge b1">모두</span><div style="flex:1;min-width:0"><div style="font-size:15px">${inputs.join(' · ')}</div>`
    + `<div class="row" style="margin-top:6px;flex-wrap:nowrap"><div class="meter"><i id="m0"></i></div><span id="s0" class="small" style="min-width:118px"></span></div></div></div>`
    + '<p class="small">차례대로 치니까 조이콘·키보드·게임패드 무엇이든 지금 치는 사람이 써요.</p>';
}
function updateSlotMeters() {
  if (!menuOpen()) return;
  if (realNow() - gfx.infoT > 0.25) { gfx.infoT = realNow(); $('gfxInfo').textContent = gfxInfoText(); }
  const m = $('m0'), s = $('s0'); if (!m || !s) return;
  const g = JC.list.reduce((a, j) => Math.max(a, j.gyro || 0), 0);
  m.style.width = Math.min(100, g / 18) + '%';
  const last = JC.list.reduce((a, j) => j.lastSwingT > a.t ? { t: j.lastSwingT, pow: j.lastPow } : a, { t: -9, pow: 0 });
  const mj = JC.list.find(motionJoy);   // 자세를 아는 조이콘: 팔 각도를 그대로 보여 줌 (내리면 0°, 앞으로 들면 +, 뒤로 빼면 −)
  s.textContent = realNow() - last.t < 1.6 ? `휘둘렀어요! 세기 ${Math.round(last.pow * 100)}%`
    : mj ? `팔 각도 ${Math.round(armState(mj).th * 180 / Math.PI)}° (아래 0 · 앞 + · 뒤 −)` : (JC.list.length ? '휘둘러 보세요' : '');
}
function showWarn(text) { const w = $('hidWarn'); w.textContent = text; w.classList.toggle('hidden', !text); }
function bestText() {
  const rec = S.get('bowling.best', {}) || {}, r = rec[settings.frames];
  return r && r.score ? `${settings.frames}프레임 최고 기록 ${r.score}점 · ${CHARS[r.ch] ? CHARS[r.ch].name : ''}` : `${settings.frames}프레임 최고 기록은 아직 없어요 — 첫 기록에 도전!`;
}
function syncMenu() {
  const on = (q, f) => document.querySelectorAll(q).forEach(b => b.classList.toggle('on', f(b)));
  on('#modeRow button', b => b.dataset.mode === settings.mode);
  on('#countRow button', b => +b.dataset.count === settings.count);
  on('#cpuRow button', b => +b.dataset.cpu === settings.cpu);
  on('#frameRow button', b => +b.dataset.frames === settings.frames);
  on('#qRow button', b => b.dataset.q === settings.quality);
  on('#guideRow button', b => b.dataset.guide === settings.guide);
  const fam = settings.mode === 'family';
  $('countRow').classList.toggle('hidden', !fam); $('cpuRow').classList.toggle('hidden', fam);
  $('sens').value = settings.sensitivity; $('sensV').textContent = (+settings.sensitivity).toFixed(2) + '×';
  for (const [id, k] of VOL) { $(id).value = Math.round(A.vol[k] * 100); $(id + 'V').textContent = Math.round(A.vol[k] * 100) + '%'; }
  $('bestScore').textContent = bestText();
  $('gfxInfo').textContent = gfxInfoText();
  renderSlots();
}
function toggleFull() {
  try { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen(); } catch (e) { /* 무시 */ }
}

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
const VW = 1920, VH = 1080;   // HUD 가상 화면
const hud = $('hud'), hctx = hud.getContext('2d');
const view = { k: 1, ox: 0, oy: 0 };
const levelFor = q => q === 'auto' ? gfx.autoLevel : Q[q] ? q : 'lowest';   // 테니스의 '2D'는 볼링에선 '최저'
function resize() {
  const lv = Q[gfx.level] || Q.mid;
  const stage = $('laneStage');
  const cssW = Math.max(1, stage && stage.clientWidth || window.innerWidth), cssH = Math.max(1, stage && stage.clientHeight || window.innerHeight);
  // 캐릭터 고르기: 목록과 카드 사이 빈 곳 · 결과: 결과 창 위 빈 곳에 몬스터들이 오게 (레이아웃은 크기가 바뀔 때만 읽음)
  G3.selectFraming = null; G3.resultFraming = null;
  const selectScreen = $('select'), resultScreen = $('result');
  if (selectScreen && !selectScreen.classList.contains('hidden') && selectScreen.querySelector) {
    const top = selectScreen.querySelector('.selection-top'), bottom = selectScreen.querySelector('.selbottom');
    if (top && bottom && top.getBoundingClientRect && bottom.getBoundingClientRect) {
      const a = top.getBoundingClientRect().bottom + 12, b = bottom.getBoundingClientRect().top - 14;
      if (b - a > 90) G3.selectFraming = { height: (b - a) / cssH, center: (a + b) / (2 * cssH) };
    }
  }
  const panel = resultScreen && resultScreen.querySelector && resultScreen.querySelector('.result-panel');
  if (panel && !resultScreen.classList.contains('hidden') && panel.getBoundingClientRect) {
    const top = panel.getBoundingClientRect().top - 8;
    if (top > 100) G3.resultFraming = { height: top / cssH, center: top / (2 * cssH) };
  }
  const dpr = window.devicePixelRatio || 1;
  const pr = Math.max(0.25, Math.min(dpr, lv.maxW / cssW));   // 4K 화면이어도 렌더 해상도는 상한까지만
  hud.width = Math.max(1, Math.round(cssW * pr)); hud.height = Math.max(1, Math.round(cssH * pr));
  view.k = Math.min(hud.width / VW, hud.height / VH);
  view.ox = (hud.width - VW * view.k) / 2; view.oy = (hud.height - VH * view.k) / 2;
  G3.cssW = cssW; G3.cssH = cssH;
  if (G3.camera) { G3.camera.aspect = cssW / cssH; G3.camera.updateProjectionMatrix(); G3.camSnap = true; }
  if (G3.renderer) { G3.renderer.setPixelRatio(pr); G3.renderer.setSize(cssW, cssH, false); }
}
function applyQuality(level) {
  if (!G3.available) { gfx.note = '3D를 켤 수 없어요 (크롬 설정 > 시스템 > 그래픽 가속 사용 켜기)'; resize(); return; }
  ensureScene3D();
  const pr = Q[level];
  if (HEADLESS !== '3d' && (!G3.renderer || G3.aa !== pr.aa) && !initRenderer(pr.aa)) {
    G3.available = false;
    gfx.note = '3D를 켤 수 없어요 (크롬 설정 > 시스템 > 그래픽 가속 사용 켜기)';
    showWarn('이 컴퓨터에서 3D 그래픽을 켤 수 없어서 볼링을 할 수 없어요. 크롬 설정 > 시스템 > "그래픽 가속 사용"을 켜 주세요.');
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
// 자동 모드: 경기 중 2.5초마다 fps를 재서 47 미만이면 한 단계씩 낮춤
const AUTO_ORDER = ['mid', 'low', 'lowest'];
function trackPerf(dt) {
  if (!(dt > 0 && dt < 0.25)) return;
  gfx.dispAcc += dt; gfx.dispFrames++;
  if (gfx.dispAcc >= 0.5) { gfx.dispFps = gfx.dispFrames / gfx.dispAcc; gfx.dispAcc = 0; gfx.dispFrames = 0; }
  const playing = !game.demo && !game.paused && game.state !== 'select' && game.state !== 'end' && !menuOpen() && !resultOpen();
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
// 3D — three.js. 볼링장: 가운데가 우리 레인, 양옆에 레인 둘씩 (핀만 세워 둠)
// ============================================================
const G3 = { available: typeof THREE !== 'undefined', built: false, renderer: null, aa: null, lost: false, cssW: 1, cssH: 1,
  scene: null, camera: null, mons: [], pinMeshes: [], ballMats: {}, camSnap: true, lastT: 0, holdPos: null, relPos: null, info: { calls: 0, tris: 0 } };
let K3 = null;   // three.js 임시 객체 (THREE가 있을 때만 생성)
function k3() {
  if (K3) return K3;
  K3 = { v: new THREE.Vector3(), w: new THREE.Vector3(), axis: new THREE.Vector3(), q: new THREE.Quaternion(), q2: new THREE.Quaternion(), m: new THREE.Matrix4(),
    s: new THREE.Vector3(1, 1, 1), goalPos: new THREE.Vector3(), goalLook: new THREE.Vector3(), e: new THREE.Euler(), col: new THREE.Color() };
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
  if (prev) prev.replaceWith(canvas); else document.body.prepend(canvas);
  G3.renderer = r; G3.aa = aa; G3.lost = false;
  canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); if (G3.renderer === r) G3.lost = true; });
  canvas.addEventListener('webglcontextrestored', () => { if (G3.renderer === r) G3.lost = false; });
  const an = Math.min(8, r.capabilities.getMaxAnisotropy());
  for (const tex of [G3.laneTex, G3.apprTex]) if (tex) { tex.anisotropy = an; tex.needsUpdate = true; }
  return true;
}

// ---------- 그림(텍스처) ----------
function laneTexture() {   // 레인 한 줄: 아래가 파울 라인, 위가 핀 데크 끝
  return canvasTex(256, 2048, (g, w, h) => {
    const Z = z => h - z / LANE.deck * h, X = x => (x / (LANE.half * 2) + 0.5) * w;
    const rng = mulberry32(11), bw = w / 39;
    for (let i = 0; i < 39; i++) { g.fillStyle = `hsl(${30 + rng() * 6}, ${48 + rng() * 10}%, ${70 + rng() * 6}%)`; g.fillRect(i * bw, 0, bw + 1, h); }
    g.fillStyle = 'rgba(190,110,50,0.16)'; g.fillRect(0, Z(16), w, Z(4.6) - Z(16));   // 가운데는 소나무라 조금 붉음
    g.globalAlpha = 0.07; g.fillStyle = '#7a4a1c';
    for (let k = 0; k < 700; k++) g.fillRect(rng() * w, rng() * h, 1, 20 + rng() * 120);   // 나뭇결
    g.globalAlpha = 1;
    g.fillStyle = 'rgba(120,70,30,0.35)'; for (let i = 1; i < 39; i++) g.fillRect(Math.round(i * bw), 0, 1, h);   // 판자 이음매
    g.fillStyle = 'rgba(110,60,25,0.5)'; for (const z of [4.6, 16]) g.fillRect(0, Z(z), w, 2);
    g.fillStyle = '#5a3a1e';
    for (const b of [3, 5, 8, 11, 14]) for (const s of [-1, 1]) circ(g, X(s * (20 - b) * 0.027), Z(2.13), 3);   // 점 (7피트)
    for (let k = -3; k <= 3; k++) {   // 화살표 일곱 개 (V자)
      const x = X(k * 5 * 0.027), y = Z(4.57 - Math.abs(k) * 0.16);
      g.fillStyle = '#4a2a14'; g.beginPath(); g.moveTo(x, y - 26); g.lineTo(x - 5, y + 8); g.lineTo(x + 5, y + 8); g.closePath(); g.fill();
    }
    g.strokeStyle = 'rgba(90,50,20,0.5)'; g.lineWidth = 2;
    for (const s of SPOTS) { g.beginPath(); g.arc(X(s.x), Z(s.z), 5, 0, Math.PI * 2); g.stroke(); }   // 핀 자리
    g.fillStyle = '#231a28'; g.fillRect(0, h - 5, w, 5);   // 파울 라인
  });
}
function approachTexture() {   // 레인 하나 폭(1.7m) × 6m 어프로치. 위가 파울 라인
  return canvasTex(256, 512, (g, w, h) => {
    const rng = mulberry32(5), bw = w / 62, X = x => (x / LANE.spacing + 0.5) * w, Y = d => d / 6 * h;
    for (let i = 0; i < 62; i++) { g.fillStyle = `hsl(${33 + rng() * 5}, ${40 + rng() * 10}%, ${74 + rng() * 6}%)`; g.fillRect(i * bw, 0, bw + 1, h); }
    g.fillStyle = 'rgba(120,70,30,0.3)'; for (let i = 1; i < 62; i++) g.fillRect(Math.round(i * bw), 0, 1, h);
    g.fillStyle = 'rgba(70,40,30,0.55)'; g.fillRect(0, 0, X(-LANE.kick), h); g.fillRect(X(LANE.kick), 0, w - X(LANE.kick), h);
    g.fillStyle = '#5a3a1e';
    for (const d of [0.3, 3.66, 4.57]) for (const b of [-15, -10, -5, 0, 5, 10, 15]) circ(g, X(b * 0.027), Y(d), 3.5);
    g.fillStyle = '#231a28'; g.fillRect(0, 0, w, 6);
  });
}
function maskTexture() {   // 핀 위 가림판: 밤하늘 · 별 · 레인 번호 · 큰 핀과 공
  return canvasTex(2048, 360, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#2b1f63'); gr.addColorStop(1, '#5a3aa0');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    const rng = mulberry32(3);
    for (let i = 0; i < 160; i++) { g.fillStyle = `rgba(255,255,255,${0.3 + rng() * 0.6})`; circ(g, rng() * w, rng() * h, 1 + rng() * 2.5); }
    const lw = w / 5;
    for (let k = 0; k < 5; k++) {
      const cx = lw * (k + 0.5);
      g.fillStyle = ['#ffd84d', '#7ee0ff', '#ff8fb8', '#9cf08a', '#ffb070'][k];
      g.globalAlpha = 0.9; circ(g, cx - 120, 150, 54); g.globalAlpha = 1;   // 행성
      g.fillStyle = 'rgba(0,0,0,0.18)'; circ(g, cx - 108, 162, 54);
      g.fillStyle = '#fffaf0';   // 큰 핀
      g.beginPath(); g.ellipse(cx + 90, 210, 34, 60, 0, 0, Math.PI * 2); g.fill(); g.beginPath(); g.ellipse(cx + 90, 120, 20, 28, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#e03a3a'; g.fillRect(cx + 70, 146, 40, 8); g.fillRect(cx + 70, 160, 40, 8);
      g.fillStyle = '#ffffff'; g.font = `900 92px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(String(5 + k), cx, 290);
    }
    g.fillStyle = '#ffffff'; g.font = `900 60px ${FONT}`; g.textAlign = 'center';
    g.fillText('★ NOLJA LANES ★', w / 2, 60);
  });
}
function wallTexture() {   // 옆 벽 그림: 보라 밤하늘에 행성·별·핀
  const t = canvasTex(512, 256, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#22184d'); gr.addColorStop(1, '#3b2470');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    const rng = mulberry32(9);
    for (let i = 0; i < 70; i++) { g.fillStyle = `rgba(255,255,255,${0.25 + rng() * 0.6})`; circ(g, rng() * w, rng() * h, 0.8 + rng() * 1.8); }
    for (const [x, y, r, c] of [[90, 90, 46, '#ff8fb8'], [300, 150, 30, '#7ee0ff'], [430, 70, 22, '#ffd84d']]) { g.fillStyle = c; circ(g, x, y, r); g.strokeStyle = 'rgba(255,255,255,0.5)'; g.lineWidth = 4; g.beginPath(); g.ellipse(x, y, r * 1.6, r * 0.4, -0.3, 0, Math.PI * 2); g.stroke(); }
    g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(0, h - 26, w, 26);
  });
  t.wrapS = THREE.RepeatWrapping;
  return t;
}
function carpetTexture() {   // 뒤쪽 바닥 카펫: 남색에 형광 무늬
  const t = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#1d1840'; g.fillRect(0, 0, w, h);
    const rng = mulberry32(21), cols = ['#3fe0ff', '#ff5fb0', '#ffe14d', '#8b6cf0'];
    for (let i = 0; i < 40; i++) {
      g.strokeStyle = g.fillStyle = cols[i % 4]; g.lineWidth = 3; const x = rng() * w, y = rng() * h;
      if (i % 3 === 0) circ(g, x, y, 4); else if (i % 3 === 1) { g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + 10, y - 12, x + 20, y); g.stroke(); }
      else { g.beginPath(); g.moveTo(x, y - 6); g.lineTo(x + 6, y + 5); g.lineTo(x - 6, y + 5); g.closePath(); g.stroke(); }
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(5, 4);
  return t;
}
function screenTexture() {   // 머리 위 화면 (장식)
  return canvasTex(256, 144, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, w, h); gr.addColorStop(0, '#1a2b6b'); gr.addColorStop(1, '#5b2a8c');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.fillStyle = '#ffffff'; g.font = `900 34px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('MONSTER', w / 2, 46); g.fillStyle = '#ffd84d'; g.fillText('BOWLING', w / 2, 84);
    g.fillStyle = 'rgba(255,255,255,0.7)'; g.font = `700 20px ${FONT}`; g.fillText('NOLJA LANES', w / 2, 122);
  });
}
function ballTexture(color) {   // 공: 대리석 무늬 + 손가락 구멍 셋
  return canvasTex(256, 128, (g, w, h) => {
    g.fillStyle = color; g.fillRect(0, 0, w, h);
    let seed = 0; for (const ch of color) seed = seed * 31 + ch.charCodeAt(0);
    const rng = mulberry32(seed);
    for (let k = 0; k < 26; k++) {
      g.strokeStyle = rng() < 0.5 ? 'rgba(255,255,255,0.24)' : 'rgba(30,20,60,0.24)'; g.lineWidth = 3 + rng() * 9;
      let x = rng() * w, y = rng() * h; g.beginPath(); g.moveTo(x, y);
      for (let s = 0; s < 4; s++) { const nx = x + (rng() - 0.5) * 100, ny = y + (rng() - 0.5) * 50; g.bezierCurveTo(x + (rng() - 0.5) * 120, y + (rng() - 0.5) * 60, nx + (rng() - 0.5) * 120, ny + (rng() - 0.5) * 60, nx, ny); x = nx; y = ny; }
      g.stroke();
    }
    for (const [x, y, r] of [[128, 34, 7], [117, 18, 6], [139, 18, 6]]) {
      g.fillStyle = '#1b1426'; circ(g, x, y, r);
      g.strokeStyle = 'rgba(255,255,255,0.45)'; g.lineWidth = 1.5; g.beginPath(); g.arc(x, y, r + 1, 0, Math.PI * 2); g.stroke();
    }
  });
}
function ballMat(color) {
  if (!G3.ballMats[color]) G3.ballMats[color] = new THREE.MeshPhongMaterial({ map: ballTexture(color), shininess: 110, specular: 0x777777 });
  return G3.ballMats[color];
}
// 핀 모양: 실제 핀 단면(반지름, 높이)을 부드럽게 이어 돌림. 텍스처 v = 높이 → 목에 빨간 줄 두 개
function pinGeometry(seg, pts0 = 26) {
  const P = [[0.0, 0.0], [0.026, 0.0], [0.036, 0.02], [0.05, 0.055], [0.06, 0.11], [0.057, 0.15], [0.046, 0.19], [0.03, 0.235], [0.0225, 0.26], [0.026, 0.29], [0.032, 0.325], [0.029, 0.355], [0.018, 0.374], [0.0, 0.381]];
  const pts = new THREE.SplineCurve(P.map(([r, y]) => new THREE.Vector2(r, y))).getPoints(pts0);
  for (const p of pts) p.x = Math.max(0, p.x);
  pts[0].set(0, 0); pts[pts.length - 1].set(0, PIN.h);
  const geo = new THREE.LatheGeometry(pts, seg);
  const pos = geo.attributes.position, uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) uv.setY(i, pos.getY(i) / PIN.h);
  uv.needsUpdate = true;
  return geo;
}
function chevronTexture() {   // 반투명 띠 + 진한 화살 무늬 (흰색 → 선수 색을 곱함)
  const t = canvasTex(64, 64, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,255,255,0.38)'; g.fillRect(6, 0, w - 12, h);
    g.fillStyle = '#ffffff';
    g.beginPath(); g.moveTo(w / 2, 6); g.lineTo(w - 4, 38); g.lineTo(w - 18, 38); g.lineTo(w / 2, 22); g.lineTo(18, 38); g.lineTo(4, 38); g.closePath(); g.fill();
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function ensureScene3D() {
  if (G3.built || !G3.available) return;
  G3.built = true;
  const K = k3();
  const Sc = G3.scene = new THREE.Scene();
  Sc.background = new THREE.Color(0x171330);
  Sc.fog = new THREE.Fog(0x171330, 26, 56);
  G3.camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.05, 90);
  Sc.add(new THREE.HemisphereLight(0xfff1e2, 0x3a2f5e, 0.82));
  const key = new THREE.DirectionalLight(0xffffff, 0.55); key.position.set(1.5, 6, 5); key.target.position.set(0, 0, -8); Sc.add(key, key.target);
  const deck = new THREE.DirectionalLight(0xfff2dc, 0.5); deck.position.set(0, 3.5, -13); deck.target.position.set(0, 0, -19); Sc.add(deck, deck.target);
  const front = new THREE.DirectionalLight(0xfff4ec, 0.32); front.position.set(-1, 3, -6); front.target.position.set(0, 0.6, 2); Sc.add(front, front.target);   // 레인 쪽에서 비추는 빛 (줄 선 몬스터 얼굴)

  // 레인 다섯 줄 (가운데가 우리 레인)
  G3.laneTex = laneTexture();
  const laneMat = new THREE.MeshPhongMaterial({ map: G3.laneTex, shininess: 90, specular: 0x4a4038 });
  const laneGeo = new THREE.PlaneGeometry(LANE.half * 2, LANE.deck);
  const gutLen = LANE.deck + 0.4, gutGeo = new THREE.CylinderGeometry(LANE.gutter / 2, LANE.gutter / 2, gutLen, 12, 1, true, Math.PI / 2, Math.PI);
  const gutMat = new THREE.MeshPhongMaterial({ color: 0x8d93a6, shininess: 60, specular: 0x666666, side: THREE.DoubleSide });
  const capGeo = new THREE.BoxGeometry(LANE.spacing - 2 * LANE.kick, 0.04, LANE.deck), capMat = lam(0x3a2c4f);
  const kickGeo = new THREE.BoxGeometry(0.04, 0.42, 1.45), kickMat = lam(0x4a3a72);
  // 똑같은 모양은 다섯 줄을 한 번에 그림 ([x, y, z, x축 회전])
  const inst = (geo, mat, list) => {
    const m = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach(([x, y, z, rx = 0], i) => { K.q.setFromEuler(K.e.set(rx, 0, 0)); m.setMatrixAt(i, K.m.compose(K.v.set(x, y, z), K.q, K.s.set(1, 1, 1))); });
    m.instanceMatrix.needsUpdate = true; m.frustumCulled = false; Sc.add(m);
    return m;
  };
  const L5 = [-2, -1, 0, 1, 2].map(k => k * LANE.spacing), both = f => L5.flatMap(ox => [-1, 1].map(s => f(ox, s)));
  inst(laneGeo, laneMat, L5.map(ox => [ox, 0, -LANE.deck / 2, -Math.PI / 2]));
  inst(gutGeo, gutMat, both((ox, s) => [ox + s * (LANE.half + LANE.gutter / 2), 0, -gutLen / 2 + 0.2, -Math.PI / 2]));
  inst(kickGeo, kickMat, both((ox, s) => [ox + s * (LANE.kick + 0.02), 0.21, -(LANE.len + 0.3)]));
  inst(capGeo, capMat, L5.slice(0, 4).map(ox => [ox + LANE.spacing / 2, 0.02, -LANE.deck / 2]));
  // 어프로치 (파울 라인 뒤 6m) · 뒤쪽 카펫 · 옆 벽 · 천장
  G3.apprTex = approachTexture(); G3.apprTex.wrapS = THREE.RepeatWrapping; G3.apprTex.repeat.set(5, 1);
  const W = LANE.spacing * 5;
  const appr = new THREE.Mesh(new THREE.PlaneGeometry(W, 6), new THREE.MeshPhongMaterial({ map: G3.apprTex, shininess: 50, specular: 0x333333 }));
  appr.rotation.x = -Math.PI / 2; appr.position.set(0, 0, 3); Sc.add(appr);
  const carpet = new THREE.Mesh(new THREE.PlaneGeometry(W, 9), lam(0xffffff, { map: carpetTexture() }));
  carpet.rotation.x = -Math.PI / 2; carpet.position.set(0, -0.001, 10.5); Sc.add(carpet);
  const wallTex = wallTexture(); wallTex.repeat.set(5, 1);
  for (const s of [-1, 1]) {
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(36, 3.4), lam(0xffffff, { map: wallTex }));
    wall.rotation.y = -s * Math.PI / 2; wall.position.set(s * W / 2, 1.7, -4); Sc.add(wall);
  }
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(W, 36), lam(0x120f26)); ceil.rotation.x = Math.PI / 2; ceil.position.set(0, 3.3, -4); Sc.add(ceil);
  const neon = inst(new THREE.BoxGeometry(0.05, 0.03, 26), basic(0xffffff), [0, 1, 2, 3, 4, 5].map(k => [(k - 2.5) * LANE.spacing, 3.26, -6]));   // 천장 네온 줄
  [0x3fe0ff, 0xff5fb0, 0xffe14d, 0x8b6cf0, 0x5dff9a, 0xff8a3d].forEach((c, i) => neon.setColorAt(i, K.col.set(c)));
  neon.instanceColor.needsUpdate = true;
  // 핀 위 가림판 · 불빛 줄 · 뒤 커튼 · 구덩이
  const mask = new THREE.Mesh(new THREE.PlaneGeometry(W, 1.45), basic(0xffffff, { map: maskTexture() }));
  mask.position.set(0, 1.68, -(LANE.len - 0.9)); Sc.add(mask);
  const strip = new THREE.Mesh(new THREE.BoxGeometry(W, 0.05, 0.12), basic(0xfff3d6)); strip.position.set(0, 0.95, -(LANE.len - 0.85)); Sc.add(strip);
  const curtain = new THREE.Mesh(new THREE.PlaneGeometry(W, 1.0), basic(0x0b0914)); curtain.position.set(0, 0.45, -(LANE.deck + 0.6)); Sc.add(curtain);
  const pit = new THREE.Mesh(new THREE.PlaneGeometry(W, 0.65), basic(0x09070f)); pit.rotation.x = -Math.PI / 2; pit.position.set(0, -0.3, -(LANE.deck + 0.3)); Sc.add(pit);
  // 머리 위 화면 (장식)
  inst(new THREE.PlaneGeometry(1.15, 0.65), basic(0xffffff, { map: screenTexture() }), L5.map(ox => [ox, 2.92, -0.9, 0.22]));
  inst(new THREE.BoxGeometry(1.25, 0.75, 0.05), lam(0x1a1530), L5.map(ox => [ox, 2.92, -0.93, 0.22]));

  // 핀: 우리 레인 10개 + 옆 레인 핀은 한 번에 그림
  const seg = 16;
  G3.pinGeo = pinGeometry(seg);
  const pinTex = canvasTex(8, 256, (g, w, h) => {
    g.fillStyle = '#fbfaf6'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#d42a2a'; for (const [a, b] of [[0.229, 0.243], [0.25, 0.264]]) g.fillRect(0, (1 - b / PIN.h) * h, w, (b - a) / PIN.h * h);
  });
  G3.pinMat = new THREE.MeshPhongMaterial({ map: pinTex, shininess: 70, specular: 0x555555 });
  for (let i = 0; i < 10; i++) { const m = new THREE.Mesh(G3.pinGeo, G3.pinMat); Sc.add(m); G3.pinMeshes.push(m); }
  const others = new THREE.InstancedMesh(pinGeometry(10, 16), G3.pinMat, 40);   // 옆 레인 핀은 면을 줄여서
  let n = 0; const rng = mulberry32(17);
  for (const k of [-2, -1, 1, 2]) for (const s of SPOTS) {
    const up = rng() > 0.12;   // 옆 레인 몇 개는 쓰러진 채로
    K.q.identity(); if (!up) K.q.setFromAxisAngle(K.axis.set(rng() - 0.5, 0, rng() - 0.5).normalize(), Math.PI / 2);
    K.m.compose(K.v.set(k * LANE.spacing + s.x, up ? 0 : PIN.rl, -s.z), K.q, K.s.set(1, 1, 1));
    others.setMatrixAt(n++, K.m);
  }
  others.instanceMatrix.needsUpdate = true; Sc.add(others);
  const blobMat = basic(0x000000, { transparent: true, opacity: 0.22, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  G3.pinBlobs = new THREE.InstancedMesh(new THREE.CircleGeometry(0.075, 16), blobMat, 10);
  G3.pinBlobs.frustumCulled = false; Sc.add(G3.pinBlobs);
  // 핀 정리 기계: 위에서 내려오는 판 · 쓸어 가는 막대
  G3.table = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.08, 1.05), lam(0x3b3550)); G3.table.position.set(0, 1.05, -(LANE.len + 0.4)); Sc.add(G3.table);
  G3.bar = new THREE.Mesh(new THREE.BoxGeometry(1.08, 0.2, 0.035), lam(0xff9a3d)); G3.bar.position.set(0, 1.15, -(LANE.len - 0.35)); Sc.add(G3.bar);
  // 공 + 그림자
  G3.ball = new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 28, 18), ballMat(COLORS[0])); Sc.add(G3.ball);
  G3.ballBlob = new THREE.Mesh(new THREE.CircleGeometry(0.11, 20), blobMat); G3.ballBlob.rotation.x = -Math.PI / 2; Sc.add(G3.ballBlob);
  // 굴러갈 길 미리 보기 (화살 무늬 띠)
  const GN = 72, gg = new THREE.BufferGeometry();
  gg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(GN * 6), 3));
  gg.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(GN * 4), 2));
  const gi = []; for (let k = 0; k < GN - 1; k++) { const a = 2 * k; gi.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  gg.setIndex(gi);
  G3.guide = new THREE.Mesh(gg, basic(0xffffff, { map: chevronTexture(), transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide }));
  G3.guide.frustumCulled = false; G3.guide.visible = false; G3.guide.userData = { n: GN, pts: [] }; Sc.add(G3.guide);
  G3.marker = new THREE.Mesh(new THREE.RingGeometry(0.075, 0.105, 28), basic(0xffffff, { transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }));
  G3.marker.rotation.x = -Math.PI / 2; G3.marker.visible = false; Sc.add(G3.marker);
  G3.camPos = new THREE.Vector3(0, 1.45, 3); G3.camLook = new THREE.Vector3(0, 0.1, -10);
  rebuildMonsters();
}

// ---------- 몬스터 (공용 모델) ----------
const MON = 0.5;   // 몬스터 크기 (모델 키 약 2m → 1m)
function rebuildMonsters() {
  if (!G3.built) return;
  for (const m of G3.mons) if (m) { G3.scene.remove(m.root, m.blob); m.dispose(); }
  G3.mons = game.players.map(p => { const r = NC.build3D(CHARS[p.ch], p.color, {}); G3.scene.add(r.root, r.blob); r.popT = -9; return r; });
}
function rebuildMonster(i) {
  if (!G3.built || !game.players[i]) return;
  const old = G3.mons[i]; if (old) { G3.scene.remove(old.root, old.blob); old.dispose(); }
  const p = game.players[i], r = NC.build3D(CHARS[p.ch], p.color, {}); G3.scene.add(r.root, r.blob); r.popT = T();
  G3.mons[i] = r;
}
function popMonster(i, t) { const m = G3.mons[i]; if (m) m.popT = t; }
// 볼링 자세 (상체 기준 팔 방향). phi: 0 팔이 아래로 · + 앞쪽 위 · - 뒤쪽 위
function armDir(phi, side = 0.08) { return NC.nrm(side, -Math.cos(phi), -Math.sin(phi)); }
function bowlerPose(t) {
  const st = game.state, tt = t - game.throwT, nrm = NC.nrm;
  const holding = { dR: nrm(0.12, -0.5, -0.86), dL: nrm(-0.12, -0.52, -0.85), twist: 0, lean: 0, nod: 0.06 };
  if (st === 'turn' || st === 'aim') {
    const p = cur(), sway = game.charge ? 0.5 * chargePow() : 0;   // 힘 모으는 동안 팔을 뒤로
    return sway ? { dR: armDir(lerp(0.9, -1.1, sway)), dL: nrm(-0.8, -0.3, 0), twist: 0, lean: -0.1 * sway, nod: 0 } : Object.assign(holding, { twist: (p ? p.ang : 0) * 0.04 });
  }
  if (game.motionThrow && (st === 'throw' || ((st === 'roll' || st === 'result') && t - MO.relT < 0.9))) {   // 조이콘: 내 팔 각도 그대로
    const th = clamp(MO.th, -2.3, 2.7), low = clamp(1 - Math.abs(th) / 1.4, 0, 1);
    return { dR: armDir(th), dL: nrm(-0.85, -0.2, 0.15), twist: 0, lean: -0.3 * low, nod: 0.15 * low };
  }
  if (st === 'oops') return { dR: nrm(0.45, 0.75, -0.25), dL: nrm(-0.45, 0.75, -0.25), twist: 0, lean: 0.08, nod: -0.12 };   // 앗!
  if (st === 'throw' || ((st === 'roll' || st === 'result') && tt < THROW.dur + 0.7)) {
    let phi;
    if (tt < 0.2) phi = lerp(0.85, -1.25, smooth(tt / 0.2));
    else if (tt < THROW.release) { const u = (tt - 0.2) / (THROW.release - 0.2); phi = lerp(-1.25, 0.12, u * u); }
    else if (tt < THROW.dur) { const u = (tt - THROW.release) / (THROW.dur - THROW.release); phi = lerp(0.12, 1.85, 1 - (1 - u) * (1 - u)); }
    else phi = lerp(1.85, 0.6, smooth((tt - THROW.dur) / 0.7));
    const lean = -0.34 * clamp(1 - Math.abs(tt - THROW.release) / 0.45, 0, 1);
    return { dR: armDir(phi), dL: nrm(-0.85, -0.2, 0.15), twist: 0, lean, nod: -lean * 0.5 };
  }
  if (st === 'roll') {   // 공 쪽으로 몸을 기울이며 지켜봄
    const k = clamp(ball.x * 1.6, -0.6, 0.6);
    return { dR: nrm(0.4 + k * 0.5, 0.15, -0.5), dL: nrm(-0.4 + k * 0.5, 0.1, -0.5), twist: -k * 0.4, lean: -0.12, nod: 0 };
  }
  if (st === 'result' || st === 'sweep') {
    const m = game.msg, good = m && m.big, bad = game.lastKnock === 0;
    if (good) return NC.poses.celebrate(t);
    if (bad) return NC.poses.sad();
    return NC.poses.cheer(t);
  }
  return NC.poses.ready();
}
function applyPose(m, pose) {
  const SH = NC.shoulders();
  m.torso.rotation.set(pose.lean || 0, pose.twist || 0, 0);
  m.head.rotation.x = pose.nod || 0;
  NC.placeLimb(m.armR, SH.R, pose.dR);
  NC.placeLimb(m.armL, SH.L, pose.dL);
}
function pawWorld(m, dir, side, out) {   // 팔 끝(발) 위치 (월드)
  const SH = NC.shoulders(), s = side > 0 ? SH.R : SH.L, L = NC.ARM_L + 0.04;
  out.set(s.x + dir.x * L, s.y + dir.y * L, s.z + dir.z * L);
  m.torso.updateMatrixWorld(true);
  return m.torso.localToWorld(out);
}
function syncMonsters(t) {
  const K = k3(), st = game.state, n = game.players.length;
  G3.holdPos = null;
  game.players.forEach((p, i) => {
    const m = G3.mons[i]; if (!m) return;
    const ch = CHARS[p.ch];
    let show = false, x = 0, z = 0, lift = 0, pose = null, face = 0;
    if (st === 'select' || st === 'end') {   // 줄 서서 카메라를 봄
      show = true; x = -(i - (n - 1) / 2) * 0.78; z = 1.1; face = 0;   // 앞에서 보니까 P1이 화면 왼쪽에 오게 (월드 x는 반대)
      const win = st === 'end' && (i === game.winner || game.tie && totalOf(p) === totalOf(game.players[game.winner]));
      const ready = st === 'select' && sel.cards[i] && sel.cards[i].ready, now = st === 'select' && sel.cards[i] === selCurrent();
      pose = win ? NC.poses.celebrate(t) : st === 'end' ? NC.poses.cheer(t) : ready ? NC.poses.cheer(t) : NC.poses.ready();
      lift = win ? Math.abs(Math.sin(t * 6.5)) * 0.18 : ready ? Math.abs(Math.sin(t * 5 + i)) * 0.04 : now ? Math.abs(Math.sin(t * 8)) * 0.03 : 0;
    } else if (i === game.cur) {
      show = true; x = p.x - 0.2; z = 0.36;
      if (game.motionThrow && (st === 'throw' || st === 'roll' || st === 'result')) z -= 0.2 * smooth((t - game.throwT) / 0.9);   // 휘두르며 앞으로 걸어 나감
      pose = bowlerPose(t);
      if ((st === 'result' || st === 'sweep') && game.msg && game.msg.big) lift = Math.abs(Math.sin(t * 7)) * 0.12;
    }
    if (show && i === game.cur && (st === 'roll' || st === 'result' || st === 'sweep') && G3.camPos && G3.camPos.z < z + 1.1) show = false;   // 공을 따라가는 카메라가 선수를 지나감
    m.root.visible = m.blob.visible = show;
    if (!show) return;
    const pu = t - m.popT, pop = pu >= 0 && pu < 0.8 ? 1 + 0.22 * Math.exp(-7 * pu) * Math.sin(18 * pu) : 1;
    m.root.position.set(x, lift, z);
    m.root.rotation.y = face;
    m.root.scale.set(MON * ch.w * pop, MON * ch.h * pop, MON * ch.w * pop);
    m.blob.position.set(x, 0.006, z); m.blob.scale.setScalar(MON * ch.w);
    const step = st === 'throw' ? smooth((t - game.throwT) / (game.motionThrow ? 0.6 : THROW.release))
      : (st === 'roll' && (game.motionThrow ? t - MO.relT < 0.9 : t - game.throwT < THROW.dur + 0.7)) ? 1 : 0;
    m.legs[0].rotation.x = -0.55 * step; m.legs[1].rotation.x = 0.35 * step;   // 왼발 앞으로 내딛고 오른발은 뒤로
    applyPose(m, pose);
    if (i === game.cur && st !== 'select' && st !== 'end') {
      const H = G3.hold || (G3.hold = new THREE.Vector3());   // 공 자리 (임시 벡터는 뒤에서 다른 데 쓰니까 따로)
      if (st === 'turn' || st === 'aim') {   // 두 손으로 공을 허리 앞에 (힘 모으는 중이면 오른손에)
        if (game.charge) pawWorld(m, pose.dR, 1, H);
        else { H.copy(pawWorld(m, pose.dR, 1, K.v)).add(pawWorld(m, pose.dL, -1, K.w)).multiplyScalar(0.5); H.y -= 0.03; H.z -= 0.08; }
        G3.holdPos = H;
      } else if (st === 'throw') {
        pawWorld(m, pose.dR, 1, H); H.y -= 0.05; G3.holdPos = H;
      }
    }
  });
}

// ---------- 핀 · 공 · 정리 기계 ----------
function sweepVis(t) {   // 핀 정리: 판이 내려와 선 핀을 들고 → 막대가 쓰러진 핀을 쓸고 → 판이 핀을 다시 내려놓음
  const sw = game.sweep, u = sw ? t - sw.t0 : 99;
  let table = 1.05;
  if (u < 0.4) table = lerp(1.05, 0.45, smooth(u / 0.4));
  else if (u < 0.75) table = lerp(0.45, 0.9, smooth((u - 0.4) / 0.35));
  else if (u < 1.05) table = 0.9;
  else if (u < 1.4) table = lerp(0.9, 0.45, smooth((u - 1.05) / 0.35));
  else table = lerp(0.45, 1.05, smooth((u - 1.4) / 0.35));
  const barY = u < 0.3 ? 1.15 : u < 0.45 ? lerp(1.15, 0.1, smooth((u - 0.3) / 0.15)) : u < 1.05 ? 0.1 : lerp(0.1, 1.15, smooth((u - 1.05) / 0.3));
  const barZ = u < 0.45 ? LANE.len - 0.35 : u < 1.05 ? lerp(LANE.len - 0.35, LANE.deck + 0.3, smooth((u - 0.45) / 0.6)) : LANE.deck + 0.3;
  const lift = u > 0.4 && u < 1.4 ? table - 0.45 : 0;
  return { u, table, barY, barZ, lift, newPhase: game.newRack && u >= 1.05 };
}
function placePin(mesh, x, y, z, ang, ax, az) {
  const K = K3;
  mesh.position.set(x, y, -z);
  if (ang < 1e-4) mesh.quaternion.identity();
  else { K.axis.set(-az, 0, -ax); const l = K.axis.length(); if (l < 1e-6) K.axis.set(1, 0, 0); else K.axis.multiplyScalar(1 / l); mesh.quaternion.setFromAxisAngle(K.axis, ang); }
}
function syncPins(t) {
  const K = k3(), sweeping = game.state === 'sweep' && game.sweep, sw = sweeping ? sweepVis(t) : null;
  const hideAll = game.state === 'select' || game.state === 'end';
  for (let i = 0; i < 10; i++) {
    const p = pins[i], mesh = G3.pinMeshes[i];
    let vis = !hideAll && p.st !== 'off', x = p.x, y = p.y, z = p.z, ang = 0, ax = p.dx, az = p.dz, blob = vis && p.st === 'up';
    if (sw && sw.newPhase) { const s = SPOTS[i]; x = s.x; z = s.z; y = sw.table - 0.45; vis = true; blob = y < 0.05; }
    else if (sw && vis) {
      if (game.newRack || p.st !== 'up') {   // 쓸려 감
        if (sw.u > 0.45) { z = Math.max(z, sw.barZ + 0.07); if (z > LANE.deck + 0.05) vis = false; }
        blob = false;
      } else { y += sw.lift; blob = sw.lift < 0.02; }
    }
    if (vis && !(sw && sw.newPhase)) {
      if (p.st === 'up') { if (p.wob > 0.001) { ang = p.wob * Math.sin((sim.t - p.wobT) * 13); ax = p.wx; az = p.wz; if (ang < 0) { ang = -ang; ax = -ax; az = -az; } } }
      else { ang = p.th; y += PIN.rl * Math.sin(p.th) * (p.st === 'gone' ? 0.6 : 1); }
    }
    mesh.visible = vis;
    if (vis) placePin(mesh, x, y, z, ang, ax, az);
    K.m.compose(K.v.set(x, 0.002, -z), K.q.identity(), K.s.setScalar(blob ? 1 : 0));
    G3.pinBlobs.setMatrixAt(i, K.m);
  }
  G3.pinBlobs.instanceMatrix.needsUpdate = true;
  const tb = sw ? sw.table : 1.05, by = sw ? sw.barY : 1.15, bz = sw ? sw.barZ : LANE.len - 0.35;
  G3.table.position.y = tb; G3.bar.position.set(0, by, -bz);
}
function syncBall(t, dt) {
  const K = k3(), m = G3.ball, p = cur();
  if (p && m.material !== ballMat(p.color)) m.material = ballMat(p.color);
  let vis = false;
  if (ball.st === 'hold') {
    if (G3.holdPos && p) { vis = true; m.position.copy(G3.holdPos); G3.relPos = G3.relPos || new THREE.Vector3(); G3.relPos.copy(G3.holdPos); }
  } else if (ball.st === 'drop') {   // 뒤로 떨어뜨린 공: 툭 떨어져 몇 번 튀고 뒤로 조금 굴러감
    const D = game.drop, u = t - D.t0, fall = Math.sqrt(2 * Math.max(0.01, D.y - BALL_R) / 9.8);
    const y = u < fall ? D.y - 4.9 * u * u : BALL_R + 0.08 * Math.abs(Math.sin((u - fall) * 10)) * Math.exp(-(u - fall) * 5);
    m.position.set(D.x, y, D.z + D.back * (1 - Math.exp(-2 * u)));
    vis = true;
  } else {
    vis = ball.st !== 'pit' || ball.y > -0.4;
    m.position.set(ball.x, BALL_R + ball.y, -ball.z);
    const since = t - game.releaseT;
    if (G3.relPos && since < 0.14 && since >= 0) m.position.lerpVectors(G3.relPos, m.position, smooth(since / 0.14));   // 손에서 레인으로 부드럽게
    const v = Math.hypot(ball.vx, ball.vz);
    if (v > 0.05 && ball.st !== 'pit') {   // 굴러감: 바닥에 닿은 점이 멈춰 있게 돌림 + 휘는 공은 옆으로도 돎
      K.axis.set(ball.vz / v, 0, ball.vx / v);
      K.q.setFromAxisAngle(K.axis, -v * dt / BALL_R); m.quaternion.premultiply(K.q);
      if (ball.spin) { K.axis.set(ball.vx / v, 0, -ball.vz / v); K.q.setFromAxisAngle(K.axis, ball.spin * 5 * dt); m.quaternion.premultiply(K.q); }
    }
  }
  m.visible = vis && game.state !== 'select' && game.state !== 'end';
  G3.ballBlob.visible = m.visible && ball.st === 'lane';
  G3.ballBlob.position.set(m.position.x, 0.003, m.position.z);
}
function syncGuide(t) {
  const g = G3.guide, p = cur(), mk = G3.marker;
  const show = game.state === 'aim' && p && settings.guide !== 'off' && !game.paused;
  g.visible = mk.visible = !!show;
  if (!show) return;
  const D = g.userData, pts = D.pts;
  predictPath(p.x, p.ang, p.spin, speedOf(0.6), { pts, bumper: p.bumper, toZ: settings.guide === 'short' ? 6.2 : LANE.len - 0.15 });
  const pos = g.geometry.attributes.position, uv = g.geometry.attributes.uv, n = D.n, cnt = pts.length / 2;
  let total = 0; const seg = [0];
  for (let k = 1; k < cnt; k++) { total += Math.hypot(pts[2 * k] - pts[2 * k - 2], pts[2 * k + 1] - pts[2 * k - 1]); seg.push(total); }
  let j = 0;
  for (let k = 0; k < n; k++) {
    const d = total * k / (n - 1);
    while (j < cnt - 2 && seg[j + 1] < d) j++;
    const u = seg[j + 1] > seg[j] ? (d - seg[j]) / (seg[j + 1] - seg[j]) : 0;
    const x = lerp(pts[2 * j], pts[2 * j + 2], u), z = lerp(pts[2 * j + 1], pts[2 * j + 3], u);
    let tx = pts[2 * j + 2] - pts[2 * j], tz = pts[2 * j + 3] - pts[2 * j + 1]; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
    const hw = 0.06 * (1 - 0.3 * k / n);   // 멀수록 조금 가늘게
    pos.setXYZ(2 * k, x - tz * hw, 0.004, -(z + tx * hw)); pos.setXYZ(2 * k + 1, x + tz * hw, 0.004, -(z - tx * hw));
    uv.setXY(2 * k, 0, d / 0.45 - t * 1.4); uv.setXY(2 * k + 1, 1, d / 0.45 - t * 1.4);
  }
  pos.needsUpdate = true; uv.needsUpdate = true;
  g.material.color.set(p.color); g.material.opacity = 0.85 + 0.15 * Math.sin(t * 4);
  mk.position.set(p.x, 0.005, 0.12); mk.material.color.set(p.color);
}
// 카메라: 조준은 선수 뒤에서 레인 끝까지 · 굴러가면 공을 따라가다 핀 앞에서 멈춤 · 고르기·끝은 앞에서
function camGoal(t) {
  const K = K3, st = game.state, p = cur();
  let fov = 40;
  if (st === 'select' || st === 'end') {   // 줄 선 몬스터들(키 약 1.45m)을 앞에서. 메뉴 사이 빈 곳이 있으면 그 가운데로
    fov = 42;
    const fr = st === 'select' ? G3.selectFraming : resultOpen() ? G3.resultFraming : null;
    const tan = Math.tan(fov * Math.PI / 360), aspect = G3.cssW / G3.cssH, width = Math.max(1, game.players.length) * 0.78 + 0.6;
    const dist = clamp(Math.max(2.6, width / (2 * tan * aspect), fr ? 1.45 / (2 * tan * fr.height) : 0), 2.6, 9);
    const lookY = 0.62 + (fr ? (fr.center - 0.5) * 2 * dist * tan : 0);
    K.goalPos.set(0, lookY + 0.2, 1.1 - dist); K.goalLook.set(0, lookY, 1.1);
  }
  else if (st === 'roll' && ball.st === 'lane' && ball.z <= 3.2) aimCam(p);   // 처음 3m는 선수 뒤에서 그대로 (팔로스루가 보이게)
  else if (st === 'roll' && ball.st !== 'pit' && ball.z < 15.6) {
    const bz = Math.max(ball.z, 0);
    K.goalPos.set(ball.x * 0.7, 0.95 - 0.2 * smooth(bz / 15), -(bz - 2.7)); K.goalLook.set(ball.x * 0.5, 0.12, -Math.min(bz + 5.5, 18.75));
  } else if (st === 'roll' || st === 'result' || st === 'sweep') { K.goalPos.set(0, 0.8, -15.3); K.goalLook.set(0, 0.14, -18.75); fov = 38; }
  else aimCam(p);
  return fov;
}
function aimCam(p) { const K = K3, x = p ? p.x : 0; K.goalPos.set(x - 0.62, 1.62, 3.3); K.goalLook.set(x * 0.4 - 0.08, 0.02, -12); }   // 선수 왼쪽 뒤에서 (몬스터가 레인을 가리지 않게)
function syncCamera(t, dt) {
  const K = k3(), cam = G3.camera, fov = camGoal(t);
  const fast = game.state === 'roll' ? 9 : 4.5, k = G3.camSnap ? 1 : 1 - Math.exp(-dt * fast);
  G3.camPos.lerp(K.goalPos, k); G3.camLook.lerp(K.goalLook, k);
  if (Math.abs(cam.fov - fov) > 0.01 || G3.camSnap) { cam.fov = G3.camSnap ? fov : lerp(cam.fov, fov, k); cam.updateProjectionMatrix(); }
  G3.camSnap = false;
  cam.position.copy(G3.camPos); cam.lookAt(G3.camLook);
}
function sync3D() {
  if (!G3.built) return;
  const t = T(), dt = clamp(t - (G3.lastT || t), 0, 0.1); G3.lastT = t;
  syncMonsters(t); syncPins(t); syncBall(t, dt); syncGuide(t); syncCamera(t, dt);
}

// ============================================================
// HUD (점수판 · 핀 지도 · 조준 안내 · 문구) — 가상 1920x1080 좌표
// ============================================================
function outlined(g, text, x, y, fill, lw = 8) { g.lineJoin = 'round'; g.lineWidth = lw; g.strokeStyle = 'rgba(25,16,52,0.85)'; g.strokeText(text, x, y); g.fillStyle = fill; g.fillText(text, x, y); }
const PLAYING = ['turn', 'aim', 'throw', 'oops', 'roll', 'result', 'sweep'];
function drawBoard(g) {
  const F = game.F, ps = game.players, n = ps.length;
  if (!n) return;
  const cellW = F === 10 ? 78 : F === 5 ? 112 : 140, nameW = 230, totW = 104, rowH = 50, W = nameW + F * cellW + totW, X = (VW - W) / 2, Y = 14;
  g.save();
  g.globalAlpha = game.state === 'roll' ? 0.6 : 0.96;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = 'rgba(24,18,52,0.82)'; rr(g, X - 10, Y - 4, W + 20, 30 + rowH * n + 6, 18); g.fill();
  g.font = `700 15px ${FONT}`; g.fillStyle = 'rgba(255,255,255,0.65)';
  for (let f = 0; f < F; f++) g.fillText(String(f + 1), X + nameW + f * cellW + cellW / 2, Y + 11);
  g.fillText('합계', X + nameW + F * cellW + totW / 2, Y + 11);
  ps.forEach((p, i) => {
    const y = Y + 26 + i * rowH, now = i === game.cur && PLAYING.includes(game.state);
    g.fillStyle = now ? 'rgba(255,255,255,0.97)' : 'rgba(255,255,255,0.8)'; rr(g, X, y, W, rowH - 6, 10); g.fill();
    if (now) { g.strokeStyle = p.color; g.lineWidth = 4; rr(g, X, y, W, rowH - 6, 10); g.stroke(); }
    g.fillStyle = p.color; rr(g, X + 8, y + 9, 56, 26, 8); g.fill();
    g.fillStyle = '#ffffff'; g.font = `800 15px ${FONT}`; g.fillText(labelOf(p), X + 36, y + 22);
    g.textAlign = 'left'; g.fillStyle = '#3c3156'; g.font = `800 19px ${FONT}`;
    g.fillText(nameOf(p), X + 72, y + 22);
    if (p.bumper) { const w = g.measureText(nameOf(p)).width; g.fillStyle = '#25b37f'; rr(g, X + 78 + w, y + 12, 44, 20, 7); g.fill(); g.fillStyle = '#fff'; g.font = `800 12px ${FONT}`; g.fillText('범퍼', X + 86 + w, y + 22); }
    g.textAlign = 'center';
    const tots = frameTotals(p.frames, F);
    for (let f = 0; f < F; f++) {
      const cx = X + nameW + f * cellW, last = f === F - 1, fr = p.frames[f] || [];
      g.strokeStyle = 'rgba(60,49,86,0.22)'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(cx, y + 4); g.lineTo(cx, y + rowH - 10); g.stroke();
      if (now && f === game.frame) { g.fillStyle = 'rgba(255,216,77,0.38)'; g.fillRect(cx + 2, y + 2, cellW - 4, rowH - 10); }
      const marks = frameMarks(fr, last), boxes = last ? 3 : 2, bw = Math.min(26, (cellW - 8) / boxes);
      for (let k = 0; k < boxes; k++) {
        const bx = cx + cellW - (boxes - k) * bw - 3;
        g.strokeStyle = 'rgba(60,49,86,0.28)'; g.lineWidth = 1; g.strokeRect(bx, y + 4, bw, 20);
        const mk = marks[k]; if (!mk) continue;
        g.fillStyle = mk === 'X' ? '#e0457b' : mk === '/' ? '#2f8fd8' : '#3c3156';
        g.font = `900 16px ${FONT}`; g.fillText(mk, bx + bw / 2, y + 15);
      }
      if (tots[f] != null) { g.fillStyle = '#3c3156'; g.font = `800 18px ${FONT}`; g.fillText(String(tots[f]), cx + cellW / 2 - 2, y + 34); }
    }
    g.fillStyle = '#3c3156'; g.font = `900 25px ${FONT}`; g.fillText(String(totalOf(p)), X + nameW + F * cellW + totW / 2, y + 22);
  });
  g.restore();
}
function drawPinMap(g) {   // 오른쪽 위: 서 있는 핀 (1번 핀이 아래)
  if (!PLAYING.includes(game.state)) return;
  const cx = 1800, cy = 175 + game.players.length * 50, upN = pins.filter(q => q.st === 'up').length;
  g.save();
  g.fillStyle = 'rgba(24,18,52,0.78)'; rr(g, cx - 92, cy - 96, 184, 196, 18); g.fill();
  for (let i = 0; i < 10; i++) {
    const s = SPOTS[i], x = cx + s.x / 0.1524 * 24, y = cy + 40 - (s.z - LANE.len) / 0.2639 * 38, up = pins[i].st === 'up';
    g.globalAlpha = up ? 1 : 0.35;
    g.fillStyle = up ? '#fffdf6' : 'rgba(255,255,255,0.15)'; circ(g, x, y, 15);
    g.lineWidth = 3; g.strokeStyle = up ? '#e03a3a' : 'rgba(255,255,255,0.45)'; g.beginPath(); g.arc(x, y, 15, 0, Math.PI * 2); g.stroke();
    g.fillStyle = up ? '#3c3156' : 'rgba(255,255,255,0.6)'; g.font = `800 13px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(i + 1), x, y + 1);
  }
  g.globalAlpha = 1; g.fillStyle = '#ffffff'; g.font = `800 17px ${FONT}`; g.textAlign = 'center';
  g.fillText(`서 있는 핀 ${upN}개`, cx, cy + 82);
  g.restore();
}
const posText = x => Math.abs(x) < 0.015 ? '가운데' : `${x < 0 ? '왼쪽' : '오른쪽'} ${Math.round(Math.abs(x) * 100)}cm`;
const angText = a => Math.abs(a) < 0.08 ? '똑바로' : `${a < 0 ? '왼쪽' : '오른쪽'}으로 ${Math.abs(a).toFixed(1)}°`;
const spinText = s => Math.abs(s) < 0.05 ? '안 휨' : `${s < 0 ? '왼쪽' : '오른쪽'}으로 ${Math.round(Math.abs(s) * 100)}%`;
function hintText() {
  if (JC.list.some(motionJoy)) return '스틱 ↕ 고르기 · ↔ 바꾸기 · R(ZR)을 누른 채 뒤로 → 앞으로 휘두르며 놓아요 · 손목을 비틀면 휘어요';
  if (JC.list.some(j => j.ok)) return '스틱 ↕ 고르기 · ↔ 바꾸기 · 조이콘을 아래에서 앞으로 휘두르면 굴러가요 (R·ZR을 꾹 눌렀다 떼도 돼요)';
  if (game.padCount) return '스틱·방향 버튼 ↕ 고르기 · ↔ 바꾸기 · A를 꾹 눌렀다 떼면 굴러가요 · Y 범퍼';
  return '↑↓ 고르기 · ←→ 바꾸기 · Space를 꾹 눌렀다 떼면 굴러가요 · A 살살 · S 보통 · D 세게 · B 범퍼';
}
function drawAimPanel(g, t) {
  if (game.state !== 'aim' && game.state !== 'turn') return;
  const p = cur(); if (!p) return;
  const cpu = isCPU(p), W = 840, H = 158, X = (VW - W) / 2, Y = VH - H - 24;
  g.save();
  g.fillStyle = 'rgba(24,18,52,0.8)'; rr(g, X, Y, W, H, 22); g.fill();
  g.textAlign = 'center'; g.textBaseline = 'middle';
  const vals = [posText(p.x), angText(p.ang), spinText(p.spin)];
  for (let k = 0; k < 3; k++) {
    const bx = X + 18 + k * 270, by = Y + 14, bw = 264, bh = 92, on = k === game.step;
    g.fillStyle = on ? 'rgba(255,255,255,0.97)' : 'rgba(255,255,255,0.14)'; rr(g, bx, by, bw, bh, 14); g.fill();
    if (on) { g.strokeStyle = p.color; g.lineWidth = 4; rr(g, bx, by, bw, bh, 14); g.stroke(); }
    g.fillStyle = on ? p.color : 'rgba(255,255,255,0.75)'; g.font = `900 22px ${FONT}`; g.fillText(`${k + 1} ${AIM[k].name}`, bx + 50, by + 24);
    g.fillStyle = on ? '#3c3156' : '#ffffff'; g.font = `800 20px ${FONT}`; g.fillText(vals[k], bx + bw / 2 + 36, by + 24);
    const gx = bx + 24, gw = bw - 48, gy = by + 62;   // 작은 눈금: 가운데가 0
    g.fillStyle = on ? 'rgba(60,49,86,0.15)' : 'rgba(255,255,255,0.18)'; rr(g, gx, gy - 6, gw, 12, 6); g.fill();
    g.fillStyle = on ? 'rgba(60,49,86,0.35)' : 'rgba(255,255,255,0.35)'; g.fillRect(gx + gw / 2 - 1, gy - 10, 2, 20);
    const a = AIM[k], u = (p[a.key] - a.lo) / (a.hi - a.lo);
    g.fillStyle = p.color; circ(g, gx + gw * u, gy, 11);
    g.strokeStyle = '#ffffff'; g.lineWidth = 3; g.beginPath(); g.arc(gx + gw * u, gy, 11, 0, Math.PI * 2); g.stroke();
  }
  const hint = cpu ? `${labelOf(p)} ${nameOf(p)}가 조준하는 중…` : hintText();
  let fs = 19;   // 칸보다 길면 글자를 줄여서 맞춤
  g.font = `700 ${fs}px ${FONT}`;
  while (fs > 13 && g.measureText(hint).width > W - 36) g.font = `700 ${--fs}px ${FONT}`;
  g.fillStyle = '#ffffff'; g.fillText(hint, X + W / 2, Y + 132);
  if (game.charge) {   // 힘 막대
    const v = chargePow(), mx = X + W + 18, my = Y, mh = H;
    g.fillStyle = 'rgba(24,18,52,0.8)'; rr(g, mx, my, 46, mh, 14); g.fill();
    const grd = g.createLinearGradient(0, my + mh, 0, my); grd.addColorStop(0, '#7ee0ff'); grd.addColorStop(0.6, '#ffd84d'); grd.addColorStop(1, '#ff5f7a');
    g.fillStyle = grd; rr(g, mx + 8, my + 8 + (mh - 16) * (1 - v), 30, (mh - 16) * v, 8); g.fill();
    g.fillStyle = '#ffffff'; g.font = `800 15px ${FONT}`; g.fillText('힘', mx + 23, my - 14);
  }
  g.restore();
}
function drawTurn(g, t) {
  if (game.state !== 'turn' || !cur()) return;
  const p = cur(), age = t - game.stateT, dur = game.same ? 0.75 : 1.5;
  const a = clamp(age / 0.15, 0, 1) * clamp((dur - age) / 0.25, 0, 1);
  if (a <= 0) return;
  const fr = p.frames[game.frame] || [], last = game.frame === game.F - 1, up = pins.filter(q => q.st === 'up').length;
  const text = game.same ? (up === 10 ? '보너스 공!' : `${fr.length + 1}번째 공`) : `${labelOf(p)} ${nameOf(p)} 차례!`;
  const sub = game.same ? (up === 10 ? '핀을 새로 세웠어요' : `남은 핀 ${up}개 — 다 쓰러뜨리면 스페어!`) : `${game.frame + 1}프레임${last ? ' · 마지막 프레임' : ''}`;
  g.save(); g.globalAlpha = a; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = `900 64px ${FONT}`; const w = Math.max(520, g.measureText(text).width + 120);
  g.fillStyle = 'rgba(24,18,52,0.82)'; rr(g, VW / 2 - w / 2, 404, w, 150, 30); g.fill();
  g.fillStyle = p.color; rr(g, VW / 2 - w / 2, 404, w, 10, 5); g.fill();
  outlined(g, text, VW / 2, 462, '#ffffff', 6);
  g.font = `800 28px ${FONT}`; g.fillStyle = '#ffd84d'; g.fillText(sub, VW / 2, 518);
  g.restore();
}
function drawMsg(g, t) {
  const m = game.msg; if (!m) return;
  const age = t - m.t; if (age > 2.4 || age < 0) return;
  const sc = age < 0.18 ? lerp(1.5, 1, age / 0.18) : 1, alpha = age > 1.9 ? 1 - (age - 1.9) / 0.5 : 1;
  g.save(); g.globalAlpha = alpha; g.translate(VW / 2, 470); g.scale(sc, sc);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = `900 ${m.big ? 132 : 100}px ${FONT}`; outlined(g, m.text, 0, 0, m.color, 16);
  if (m.sub) { g.font = `800 46px ${FONT}`; outlined(g, m.sub, 0, 100, '#ffffff', 10); }
  g.restore();
}
function drawSpeed(g, t) {
  if (game.state === 'throw' && MO.mode) {   // 조이콘으로 휘두르는 중: 다음에 할 일
    const back = MO.lo < -0.5, text = MO.mode === 'grip' ? (back ? '앞으로 휘두르면서 버튼을 놓아요!' : '뒤로 휘둘러요') : (back ? '앞으로!' : '');
    if (text) { g.save(); g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `900 40px ${FONT}`; outlined(g, text, VW / 2, VH - 70, '#ffd84d', 8); g.restore(); }
    return;
  }
  if (game.state !== 'roll' || t - game.releaseT > 2.6) return;
  g.save(); g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `900 40px ${FONT}`;
  const spin = Math.abs(ball.spin) > 0.05 ? (ball.spin < 0 ? ' · 왼쪽으로 휘는 공' : ' · 오른쪽으로 휘는 공') : '';
  const wrist = MO.last && MO.relT === game.releaseT && Math.abs(MO.last.spin) > 0.05 ? ' (손목)' : '';
  outlined(g, `시속 ${game.speedKmh}km${spin}${wrist}`, VW / 2, VH - 70, '#ffffff', 8);
  g.restore();
}
function drawToast(g) {
  const tt = gfx.toast; if (!tt) return;
  const age = realNow() - tt.t; if (age > 3.5) { gfx.toast = null; return; }
  g.save(); g.globalAlpha = age > 3 ? (3.5 - age) / 0.5 : 1; g.font = `800 26px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
  const w = g.measureText(tt.text).width + 60;
  g.fillStyle = 'rgba(24,18,52,0.88)'; rr(g, VW / 2 - w / 2, 330, w, 56, 28); g.fill();
  g.fillStyle = '#ffffff'; g.fillText(tt.text, VW / 2, 358);
  g.restore();
}
function drawHUD() {
  const g = hctx, t = T();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, hud.width, hud.height);
  if (game.state === 'select') return;
  g.setTransform(view.k, 0, 0, view.k, view.ox, view.oy);
  if (!game.demo) { drawBoard(g); drawPinMap(g); drawAimPanel(g, t); drawSpeed(g, t); drawTurn(g, t); }
  drawMsg(g, t); drawToast(g);
}

// ============================================================
// 매 프레임 갱신
// ============================================================
const snd = { music: null, amb: null };
function syncSound() {   // 볼링장엔 늘 음악 (일시정지 땐 끔). 경기 중엔 볼링장 소리(멀리 핀 쓰러지는 소리·웅성거림)도
  if (!A.ctx) return;
  const m = !game.paused;
  if (m !== snd.music) { snd.music = m; A.music(m, 'bowling'); }
  const amb = !game.demo && !game.paused && !menuOpen() && !selectOpen() ? 'alley' : null;
  if (amb !== snd.amb) { snd.amb = amb; A.nature(amb); }
}
function rollSound() {
  if (!A.ctx) return;
  const rolling = !game.demo && !game.paused && (game.state === 'roll' || game.state === 'result') && (ball.st === 'lane' || ball.st === 'gutter');
  A.roll(rolling ? Math.hypot(ball.vx, ball.vz) : null, ball.st === 'gutter');
}
let lastT = 0;
function update() {
  const t = T();
  const dt = clamp(t - lastT, 0, 0.1); lastT = t;   // 느린 컴퓨터(10fps)에서도 실제 시간과 같게
  pollGamepads(); pollJoy();
  syncSound(); rollSound();
  if (game.paused) return;
  const st = game.state;
  if (st === 'select') { if (sel.startAt && t >= sel.startAt) startMatch(); return; }
  motionStep(t, dt);
  if (st === 'turn') { if (t - game.stateT > (game.same ? 0.75 : 1.5)) enterAim(t); }
  else if (st === 'aim') { aimInput(dt); if (isCPU(cur())) cpuAim(t); }
  else if (st === 'throw') { if (!game.motionThrow && t - game.stateT >= THROW.release) release(t); }
  else if (st === 'oops') { if (t - game.stateT > 1.3) { ball.st = 'hold'; game.state = 'aim'; game.stateT = t; } }
  else if (st === 'roll') updateRoll(dt, t);
  else if (st === 'result') { simulate(dt); if (t - game.stateT > 1.7) startSweep(t); }
  else if (st === 'sweep') { if (t - game.stateT > SWEEP_DUR) afterSweep(t); }
  else if (st === 'end') {
    if (game.demo) { if (t - game.stateT > 4) startDemo(); }
    else if (!game.resultShown && t - game.stateT > 2.2) showResult();
  }
}

// ============================================================
// 메뉴 그림: 공을 든 친구들과 핀 (2D, 그림 파일 없이 그려서 넣음)
// ============================================================
function drawPin2D(g, x, y, s) {   // x: 가운데, y: 바닥, s: 높이(px)
  g.save(); g.translate(x, y); g.scale(s / 100, s / 100);
  g.fillStyle = '#fffdf6'; g.strokeStyle = '#4b3b5c'; g.lineWidth = 3.4; g.lineJoin = 'round';
  g.beginPath(); g.moveTo(-7, 0); g.bezierCurveTo(-18, -20, -17, -42, -9, -58); g.bezierCurveTo(-6, -66, -7, -72, -8, -80);
  g.bezierCurveTo(-9, -92, -4, -100, 0, -100); g.bezierCurveTo(4, -100, 9, -92, 8, -80); g.bezierCurveTo(7, -72, 6, -66, 9, -58);
  g.bezierCurveTo(17, -42, 18, -20, 7, 0); g.closePath(); g.fill(); g.stroke();
  g.fillStyle = '#e03a3a'; g.fillRect(-7, -67, 14, 4); g.fillRect(-7, -61, 14, 4);
  g.restore();
}
function drawBowlArt() {
  const img = $('bowlArt'); if (!img || typeof document.createElement !== 'function') return;
  const c = document.createElement('canvas'); c.width = 960; c.height = 640;
  const g = c.getContext && c.getContext('2d'); if (!g || !g.ellipse) return;
  // 오른쪽 뒤에 핀 열 개 (뒷줄부터)
  for (let r = 3; r >= 0; r--) for (let k = 0; k <= r; k++) {
    const x = 760 + (k - r / 2) * 58 + r * 14, y = 330 - r * 34, s = 150 - r * 12;
    g.fillStyle = 'rgba(80,60,110,0.12)'; g.beginPath(); g.ellipse(x, y, s * 0.16, s * 0.05, 0, 0, Math.PI * 2); g.fill();
    drawPin2D(g, x, y, s);
  }
  const picks = [[0, 210, 560, 1.12, COLORS[0]], [3, 430, 590, 1.0, COLORS[1]], [8, 640, 600, 0.92, COLORS[2]]];
  for (const [ci, x, y, s, col] of picks) {
    g.save(); g.translate(x, y); g.scale(s, s);
    g.fillStyle = 'rgba(80,60,110,0.16)'; g.beginPath(); g.ellipse(0, 6, 120, 18, 0, 0, Math.PI * 2); g.fill();
    NC.drawMonster2D(g, CHARS[ci], 0, -250, 250, true);
    const bg = g.createRadialGradient(-22, -84, 8, 0, -64, 62); bg.addColorStop(0, '#ffffff'); bg.addColorStop(0.25, col); bg.addColorStop(1, '#2a1d4a');
    g.fillStyle = bg; g.strokeStyle = '#4b3b5c'; g.lineWidth = 5; g.beginPath(); g.arc(0, -66, 56, 0, Math.PI * 2); g.fill(); g.stroke();
    g.fillStyle = '#1b1426'; for (const [hx, hy] of [[-12, -86], [6, -92], [-2, -72]]) circ(g, hx, hy, 6);
    g.restore();
  }
  try { img.src = c.toDataURL('image/png'); img.hidden = false; } catch (e) { /* 무시 */ }
}

// ============================================================
// 시작
// ============================================================
function bindMenu() {
  const each = (q, f) => document.querySelectorAll(q).forEach(b => { b.onclick = () => { f(b); syncMenu(); saveSettings(); }; });
  each('#modeRow button', b => { settings.mode = b.dataset.mode; });
  each('#countRow button', b => { settings.count = +b.dataset.count; });
  each('#cpuRow button', b => { settings.cpu = +b.dataset.cpu; });
  each('#frameRow button', b => { settings.frames = +b.dataset.frames; });
  each('#guideRow button', b => { settings.guide = b.dataset.guide; });
  document.querySelectorAll('#qRow button').forEach(b => {
    b.onclick = () => {
      settings.quality = b.dataset.q; saveSettings();
      gfx.locked = false; gfx.pending = null; gfx.note = '';
      applyQuality(levelFor(settings.quality));
      syncMenu();
    };
  });
  $('sens').oninput = e => { settings.sensitivity = +e.target.value; syncMenu(); saveSettings(); };
  for (const [id, k] of VOL) {   // 소리 크기: 움직이는 대로 바로 바꾸고, 놓으면 핀 소리·박수로 들려줌
    $(id).oninput = e => { sfx.init(); A.setVolume(k, e.target.value / 100); $(id + 'V').textContent = e.target.value + '%'; };
    $(id).onchange = () => { if (k === 'sfx') A.pinCrash(8); else if (k === 'crowd') A.applause(0.35); };
  }
  $('btnStart').onclick = openSelect;
  $('btnHome').onclick = () => { location.href = '../../index.html'; };
  $('btnFull').onclick = toggleFull;
  $('btnResume').onclick = resume; $('btnRestart').onclick = () => { resume(); startMatch(); }; $('btnQuit').onclick = toMenu;
  $('btnAgain').onclick = startMatch; $('btnReselect').onclick = openSelect; $('btnMenu').onclick = toMenu;
  $('btnSelBack').onclick = toMenu;
  $('btnConnect').onclick = async () => {
    sfx.init();
    const r = await JC.connect();
    showWarn(r.error || '');
  };
  // 마우스로 누른 버튼·체크박스·슬라이더·펼침 제목은 포커스를 풀어서 Enter·F 같은 게임 키가 막히지 않게
  document.addEventListener('click', e => {
    const a = document.activeElement;
    if (e.detail > 0 && a && a.matches && a.matches('button, summary, input[type=checkbox], input[type=range]')) a.blur();
  });
  // 전체화면에서 Esc를 누르면 크롬이 전체화면만 풀고 키는 안 넘겨줌 → 경기 중이면 일시정지
  document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement) pause(); });
  window.addEventListener('pointerdown', () => sfx.init());
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
  window.addEventListener('resize', resize);
}
function renderFrame() {
  sync3D();
  if (G3.renderer && !G3.lost) {
    G3.renderer.render(G3.scene, G3.camera);
    G3.info.calls = G3.renderer.info.render.calls; G3.info.tris = G3.renderer.info.render.triangles;
  }
  drawHUD();
}
function frame() {
  const nowR = realNow(), dtR = gfx.lastReal ? nowR - gfx.lastReal : 0;
  gfx.lastReal = nowR;
  try { update(); renderFrame(); updateSlotMeters(); } catch (e) { console.error(e); }
  trackPerf(dtR);
  requestAnimationFrame(frame);
}

bindMenu();
applyQuality(levelFor(settings.quality));
if (!JC.supported) showWarn('이 브라우저는 조이콘 직접 연결을 지원하지 않아요. PC의 크롬이나 엣지로 열어주세요. (키보드·게임패드는 사용 가능)');
else if (location.protocol === 'file:') showWarn('파일로 열면 조이콘 연결이 막혀요. 키보드 테스트는 OK — 조이콘은 인터넷 주소나 start-game.bat으로 열어주세요.');
assignJoyCons();
JC.start();
drawBowlArt();
startDemo();
syncMenu();
requestAnimationFrame(frame);

// 테스트용 훅
window.__BW = { game, settings, pins, ball, sim, sel, LANE, PIN, SPOTS, BALL_R, AIM, CHARS, T, update, render: renderFrame,
  startMatch, toMenu, openSelect, startDemo, selMove, selReady, selUnready, selBumper, selPick, startThrow, release, finishBall,
  physicsStep, simulate, resetRack, predictPath, solveAngle, planCPU, speedOf, laneStep, frameTotals, frameMarks, totalOf, frameDone, needRack, isSplit,
  pinsSettled, onSwing, onSwingStart, onJoyButtons, nudge, stepBy, chargeStart, chargeEnd, chargePow, toggleBumperNow, pause, resume, isCPU, cur,
  gfx, G3, Q, applyQuality, autoStep, joycon: JC, setDemoPaused, setClock: f => { realNow = f; }, MO, armState, motionJoy, bowlerPose };
})();
