/* ============================================================
 * 스윙 테니스 — 조이콘(WebHID) 스윙으로 치는 2인 테니스
 *  - 캐릭터 8명 중 골라서 2인 대결 (또는 CPU)
 *  - 그래픽: three.js 3D(높음·보통·낮음) + 2D(가장 가벼움), 자동 조절
 *    2018년형 노트북 내장그래픽(인텔 UHD 620)에서 돌아가도록 가볍게 구성
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
const gauss = () => { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
const FONT = '"Pretendard","Malgun Gothic","Apple SD Gothic Neo","Noto Sans KR",sans-serif';
const HEADLESS = window.__ST_HEADLESS || '';   // 테스트용: '3d'면 WebGL 없이 3D 장면만 갱신
function mulberry32(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function rr(g, x, y, w, h, r) {
  g.beginPath();
  r = Math.max(0, Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2));
  g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
function circ(g, x, y, r) { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); }

const CHARS = NC.CHARS;
const COLORS = NC.PLAYER_COLORS;   // P1 파랑 · P2 빨강 (라켓·이름표)

// ---------- 설정 (공용 설정 + 테니스 전용) ----------
const P0 = N.prefs();
const settings = {
  mode: S.get('tennis.mode', '2p'),          // '2p' 2인 대전 | 'cpu' 1인
  cpuLevel: S.get('tennis.cpuLevel', 1),     // 0 쉬움 · 1 보통 · 2 어려움
  gamesToWin: S.get('tennis.gamesToWin', 2), // 먼저 이기는 게임 수
  guide: S.get('tennis.guide', true),
  sensitivity: P0.sensitivity,               // 이하 공용 (홈 화면과 같이 씀)
  latencyMs: P0.latencyMs,
  quality: P0.quality,
  chars: P0.chars,
  lefty: S.get('tennis.lefty', [false, false]),   // P1·P2 왼손잡이: 조이콘 포핸드·백핸드 방향을 반대로 봄
};
const KEYS = { mode: 'tennis.mode', cpuLevel: 'tennis.cpuLevel', gamesToWin: 'tennis.gamesToWin', guide: 'tennis.guide',
  sensitivity: 'sensitivity', latencyMs: 'latencyMs', quality: 'quality', chars: 'chars', lefty: 'tennis.lefty' };
if (!Array.isArray(settings.chars) || settings.chars.length !== 2 || settings.chars.some(k => !Number.isInteger(k) || k < 0 || k >= CHARS.length)) settings.chars = [0, 1];
settings.lefty = Array.isArray(settings.lefty) && settings.lefty.length === 2 ? settings.lefty.map(v => !!v) : [false, false];
const saveSettings = () => { for (const k in settings) S.set(KEYS[k], settings[k]); JC.sensitivity = settings.sensitivity; };
const charOf = i => CHARS[settings.chars[i]] || CHARS[0];
JC.sensitivity = settings.sensitivity;

// ---------- 게임 상태 ----------
const game = {
  state: 'serve',      // serve · rally · pointEnd · matchEnd · select
  demo: true,          // 메뉴 뒤에서 도는 CPU 데모
  paused: false,
  server: 0, serveSide: 1, points: [0, 0], games: [0, 0],
  rally: 0, longest: 0, nice: [0, 0],
  stateT: 0, shot: null, cpuSwing: null, cpuServeAt: 0,
  msg: null, shake: 0, padCount: 0, gameWon: -1, winner: -1, crowdT: -9,
  forceCPU: null,      // 테스트용: [true, true]면 둘 다 CPU
  log: [],
};

// 효과음 (데모 중엔 조용히)
const sfx = {
  init: () => A.init(),
  hit: p => { if (!game.demo) A.hit(p); },
  bounce: () => { if (!game.demo) A.bounce(); },
  whoosh: p => { if (!game.demo) A.whoosh(p); },
  point: () => { if (!game.demo) A.point(); },
  tick: () => A.tick(), ready: () => A.ready(), cheer: len => A.cheer(len),
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

// ---------- 코트 (단위: m, x=좌우, y=깊이 0이 P1쪽 베이스라인, z=높이) ----------
const C = { halfW: 4.115, dblHalfW: 5.485, len: 23.77, net: 11.885, netH: 0.914, svc: 6.40, g: 9.8 };
const BASE = [-0.9, C.len + 0.9];              // 기본 서는 깊이
const BACK_LIMIT = [-2.2, C.len + 2.2];        // 최대로 물러나는 깊이
const RACKET_SIDE = [1, -1];                   // 오른손잡이: 공이 몸 오른쪽에 오도록 (월드 x 기준)

// ---------- 선수 ----------
function makePlayer(i) {
  return { i, x: 0, y: BASE[i], tx: 0, ty: BASE[i], speed: 5.0, swingT: -9, anim: 'drive', lastPow: 0, lastPowT: -9, flash: '', flashT: -9,
    lastSpin: 0.5, swingSpin: 0.5, lastSpeed: 0, lastSpeedT: -9, motion: null, motionJc: null, motionT: -9, swingLive: false };
}
const players = [makePlayer(0), makePlayer(1)];
const isCPU = i => game.demo || (game.forceCPU ? !!game.forceCPU[i] : (settings.mode === 'cpu' && i === 1));
const nameOf = i => charOf(i).name;
const slotLabel = i => (!game.demo && settings.mode === 'cpu' && i === 1) ? 'CPU' : (i === 0 ? 'P1' : 'P2');
const powLabel = p => p < 0.25 ? '살살' : p > 0.7 ? '세게' : '보통';

// ============================================================
// 공 물리 — 공기저항 · 마그누스(스핀 양력) · 스핀에 따라 달라지는 바운드
//  - 친 순간 궤적 전체를 1/240초 간격으로 미리 계산해 두고, 그리는 동안엔 보간만 함
//  - spin: +1 강한 탑스핀(약 3000rpm) · 0 플랫 · -1 강한 슬라이스(약 2200rpm 백스핀)
//  - 테니스공 57g · 반지름 3.35cm, 하드코트 (세로 반발 0.75 안팎, 마찰 0.62)
// ============================================================
const BALL = { R: 0.0335, K: 1.2 * Math.PI * 0.0335 * 0.0335 / (2 * 0.057), INERT: 0.55, MU: 0.62, DT: 1 / 240, WALL_X: 10, WALL_Y: 6.2 };
const spinRate = sp => (sp >= 0 ? 314 : 230) * sp;                                // rad/s
const spinLabel = sp => sp >= 0.3 ? '탑스핀' : sp <= -0.25 ? '슬라이스' : '플랫';
const autoSpin = pow => pow < 0.25 ? 0.35 : pow > 0.7 ? 0.15 : 0.5;   // 방향을 모를 때(키보드 등): 로브·보통은 탑스핀, 세게는 플랫

// 공기 힘(항력 + 마그누스)까지 더한 가속도 → ACC. w: 탑스핀(+)·백스핀(-) 회전 속도 rad/s
const ACC = { x: 0, y: 0, z: 0 };
function ballAcc(vx, vy, vz, w) {
  const v = Math.hypot(vx, vy, vz), vh = Math.hypot(vx, vy), vs = Math.abs(w) * BALL.R;
  let cd = 0.508, cl = 0;   // 회전할수록 항력·양력 계수가 커짐 (테니스공 풍동 실험식)
  if (vs > 1e-3 && v > 1e-3) { const q = v / vs; cd += 1 / Math.pow(22.503 + 4.196 * Math.pow(q, 2.5), 0.4); cl = 1 / (2.022 + 0.981 * q); }
  const kd = BALL.K * cd * v;
  ACC.x = -kd * vx; ACC.y = -kd * vy; ACC.z = -C.g - kd * vz;
  if (cl > 0 && vh > 1e-3) {   // 진행 방향에 수직: 탑스핀은 아래로 눌러 뚝 떨어지고, 백스핀은 떠오름
    const kl = BALL.K * cl * v * Math.sign(w);
    ACC.x += kl * vx / vh * vz; ACC.y += kl * vy / vh * vz; ACC.z -= kl * vh;
  }
}
function stepBall(b, dt) {   // 중점법 한 걸음
  ballAcc(b.vx, b.vy, b.vz, b.w);
  const mx = b.vx + ACC.x * dt / 2, my = b.vy + ACC.y * dt / 2, mz = b.vz + ACC.z * dt / 2;
  ballAcc(mx, my, mz, b.w);
  b.x += mx * dt; b.y += my * dt; b.z += mz * dt;
  b.vx += ACC.x * dt; b.vy += ACC.y * dt; b.vz += ACC.z * dt;
  b.w *= 1 - 0.02 * dt;      // 공중에선 회전이 아주 조금씩 줄어듦
}
// 바운드: 세로는 반발계수, 가로는 바닥 마찰. 닿는 면이 미끄러지는 동안 마찰로 느려지며 탑스핀이 붙고,
// 구르기 시작하면 마찰이 멈춤 → 탑스핀은 덜 느려지고 높게 튀며(킥), 슬라이스는 낮게 미끄러짐
function bounceBall(b) {
  const vin = -b.vz, e = clamp(0.81 - 0.0085 * vin, 0.62, 0.8), vh = Math.hypot(b.vx, b.vy);
  if (vh > 1e-3) {
    const vc = vh - BALL.R * b.w;   // 바닥에 닿는 점의 미끄럼 속도
    const dv = Math.sign(vc) * Math.min(BALL.MU * (1 + e) * vin, BALL.INERT * Math.abs(vc) / (1 + BALL.INERT));
    const k = (vh - dv) / vh;
    b.vx *= k; b.vy *= k; b.w += dv / (BALL.INERT * BALL.R);
  }
  b.vz = e * vin;
}

// from → to(바닥)에 T초 뒤 떨어지는 초속도. 중력만 있을 때 값에서 출발해 빗나간 만큼 고치기를 반복
function aimBall(from, to, T, w, guess) {
  const n = Math.max(1, Math.ceil(T / BALL.DT)), dt = T / n, b = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, w: 0 };
  let vx, vy, vz, netZ = 99;
  if (guess) { vx = guess.x; vy = guess.y; vz = guess.z; }
  else { vx = (to.x - from.x) / T; vy = (to.y - from.y) / T; vz = (0.5 * C.g * T * T - from.z) / T; }
  for (let it = 0; it < 30; it++) {
    b.x = from.x; b.y = from.y; b.z = from.z; b.vx = vx; b.vy = vy; b.vz = vz; b.w = w; netZ = 99;
    for (let i = 0; i < n; i++) {
      const py = b.y, pz = b.z;
      stepBall(b, dt);
      if ((py - C.net) * (b.y - C.net) < 0) netZ = pz + (b.z - pz) * (C.net - py) / (b.y - py);
    }
    const ex = to.x - b.x, ey = to.y - b.y, ez = -b.z;
    vx += ex / T; vy += ey / T; vz += ez / T;
    if (ex * ex + ey * ey + ez * ez < 1e-4) break;
  }
  return { x: vx, y: vy, z: vz, netZ };
}

// 궤적 전체 기록 (바운드 · 구르기 · 코트 둘레 펜스)
function traceBall(s, from, v, w, dur) {
  const dt = BALL.DT, n = Math.ceil(dur / dt), P = new Float32Array(3 * (n + 1)), bounces = [];
  const b = { x: from.x, y: from.y, z: from.z, vx: v.x, vy: v.y, vz: v.z, w };
  const WY0 = -BALL.WALL_Y, WY1 = C.len + BALL.WALL_Y;
  let rolling = false;
  P[0] = b.x; P[1] = b.y; P[2] = b.z;
  for (let i = 1; i <= n; i++) {
    if (rolling) {
      const vh = Math.hypot(b.vx, b.vy), k = vh > 1e-3 ? Math.max(0, vh - 1.2 * dt) / vh : 0;
      b.vx *= k; b.vy *= k; b.x += b.vx * dt; b.y += b.vy * dt;
    } else {
      const px = b.x, py = b.y, pz = b.z, pvx = b.vx, pvy = b.vy, pvz = b.vz;
      stepBall(b, dt);
      if (b.z <= 0 && b.vz < 0) {   // 바닥에 닿은 순간으로 되돌려 바운드
        const f = pz / (pz - b.z);
        b.x = px + (b.x - px) * f; b.y = py + (b.y - py) * f; b.z = 0;
        b.vx = pvx + (b.vx - pvx) * f; b.vy = pvy + (b.vy - pvy) * f; b.vz = pvz + (b.vz - pvz) * f;
        bounces.push({ t: (i - 1 + f) * dt, x: b.x, y: b.y });
        bounceBall(b);
        if (b.vz < 0.5) { b.vz = 0; rolling = true; }
        const rest = (1 - f) * dt;
        b.x += b.vx * rest; b.y += b.vy * rest; b.z += b.vz * rest;
      }
    }
    if (b.y < WY0 || b.y > WY1) { b.y = clamp(b.y, WY0, WY1); b.vy *= -0.3; b.vx *= 0.6; }
    if (Math.abs(b.x) > BALL.WALL_X) { b.x = clamp(b.x, -BALL.WALL_X, BALL.WALL_X); b.vx *= -0.3; b.vy *= 0.6; }
    P[3 * i] = b.x; P[3 * i + 1] = b.y; P[3 * i + 2] = b.z;
  }
  const b0 = bounces[0] || { t: dur, x: b.x, y: b.y };
  s.path = P; s.n = n; s.bounces = bounces; s.T1 = b0.t; s.xb = b0.x; s.yb = b0.y;
}

function ballPos(s, t) {
  const f = clamp((t - s.t0) / BALL.DT, 0, s.n), i = Math.min(s.n - 1, Math.floor(f)), u = f - i, P = s.path, o = 3 * i;
  return { x: P[o] + (P[o + 3] - P[o]) * u, y: P[o + 1] + (P[o + 4] - P[o + 1]) * u, z: P[o + 2] + (P[o + 5] - P[o + 2]) * u };
}

// 출발점 → 착지점을 flight초에 날아가는 궤적 (선수 상태는 안 건드림). 네트에 걸리면 조금 느리게(높게) 띄움
function planShot(from, to, flight, spin) {
  const w = spinRate(spin);
  let Tf = flight, v = null;
  for (let k = 0; k < 40; k++) {
    v = aimBall(from, to, Tf, w, v);
    if (v.netZ >= C.netH + 0.22) break;
    Tf += 0.035;
  }
  const s = { spin, speed: Math.hypot(v.x, v.y, v.z) * 3.6 };   // 친 순간 속도 km/h
  traceBall(s, from, v, w, Tf + 3.5);
  return s;
}

function makeShot(hitter, from, to, flight, kind, special = false, spin = 0) {
  const s = Object.assign(planShot(from, to, flight, spin), {
    hitter, receiver: 1 - hitter, kind, special, t0: T(),
    out: Math.abs(to.x) > C.halfW + 0.03,
    resolved: false, miss: '', bounced: false, nb: 0, trail: [],
  });
  computeIntercept(s);
  return s;
}

// 받는 선수가 칠 지점·시각(이상적인 타이밍)과 도달 가능 여부 계산
function computeIntercept(s) {
  const r = players[s.receiver], now = T(), P = s.path, dt = BALL.DT, REACT = 0.26;   // 공을 보고 움직이기 시작하는 데 걸리는 시간 (스플릿 스텝 포함)
  const at = i => ({ t: s.t0 + i * dt, x: P[3 * i], y: P[3 * i + 1], z: P[3 * i + 2] });
  const hSpeed = i => { const a = Math.max(0, i - 1), b = Math.min(s.n, i + 1); return Math.hypot(P[3 * b] - P[3 * a], P[3 * b + 1] - P[3 * a + 1]) / ((b - a) * dt); };
  const i1 = Math.min(s.n, Math.ceil(s.T1 / dt));                                              // 첫 바운드 직후
  const i2 = s.bounces.length > 1 ? Math.min(s.n, Math.floor(s.bounces[1].t / dt)) : s.n;       // 두 번째 바운드 전
  let hit = null, speed = 0;
  // 로브는 바운드 전 2.3m로 내려올 때 받기(스매시 찬스)
  if (s.kind === 'lob') {
    let i = 1;
    while (i < i1 && !(P[3 * i + 2] <= 2.3 && P[3 * i + 2] < P[3 * i - 1])) i++;
    if (i < i1) {
      const cand = at(i);
      const okY = s.receiver === 1 ? (cand.y > C.net + 4 && cand.y < BACK_LIMIT[1]) : (cand.y < C.net - 4 && cand.y > BACK_LIMIT[0]);
      const sx = cand.x - RACKET_SIDE[s.receiver] * 0.35;
      if (okY && Math.hypot(sx - r.x, cand.y - r.y) <= r.speed * Math.max(0, cand.t - now - REACT)) { hit = cand; speed = hSpeed(i); }
    }
  }
  if (!hit) {
    // 바운드 뒤 1m 높이로 내려올 때(낮게 튀면 최고점)에 치기, 너무 깊으면 물러날 수 있는 곳까지
    let ia = i1;
    for (let i = i1 + 1; i < i2; i++) if (P[3 * i + 2] > P[3 * ia + 2]) ia = i;
    let ih = ia;
    if (P[3 * ia + 2] > 1.05) while (ih < i2 - 1 && P[3 * ih + 2] > 1.0) ih++;
    const lim = BACK_LIMIT[s.receiver], deep = i => (s.receiver === 0 ? P[3 * i + 1] < lim : P[3 * i + 1] > lim);
    if (deep(ih)) { let i = i1; while (i < ih && !deep(i)) i++; ih = i; }
    ih = Math.min(s.n, Math.max(ih, i1 + Math.round(0.08 / dt)));
    hit = at(ih); hit.z = Math.max(0.2, hit.z); speed = hSpeed(ih);
  }
  s.hit = hit;
  // 포핸드·백핸드: 지금 선 자리에서 공이 라켓 쪽(오른쪽)으로 오면 포핸드, 반대쪽이면 백핸드. 높은 공은 머리 위로
  s.side = hit.z > 1.8 || (hit.x - r.x) * RACKET_SIDE[s.receiver] > -0.3 ? 'fh' : 'bh';
  const off = hit.z > 1.8 ? 0.35 : 0.7;
  s.stand = { x: hit.x - RACKET_SIDE[s.receiver] * off * (s.side === 'fh' ? 1 : -1), y: hit.y };
  const dist = Math.hypot(s.stand.x - r.x, s.stand.y - r.y);
  s.reachable = !s.out && dist <= r.speed * Math.max(0, hit.t - now - REACT) + 0.35;
  s.W = clamp(0.26 - speed * 0.0076, 0.13, 0.23);   // 판정 창(±초): 빠른 공일수록 좁음 (speed = 타점에서 공의 수평 속도 m/s)
  if (!s.out) { r.tx = s.stand.x; r.ty = s.stand.y; }
}

// ============================================================
// 경기 진행
// ============================================================
function showMsg(text, color = '#fff', sub = '') { game.msg = { text, color, sub, t: T() }; }

function startServe() {
  game.state = 'serve'; game.stateT = T(); game.shot = null; game.cpuSwing = null; game.rally = 0;
  game.serveSide = (game.points[0] + game.points[1]) % 2 === 0 ? 1 : -1;   // 1=듀스 코트(서버 기준 오른쪽)
  const sv = game.server, rc = 1 - sv;
  const right = i => (i === 0 ? 1 : -1);      // 각 선수 기준 오른쪽의 월드 x 방향
  const a = players[sv], b = players[rc];
  a.x = a.tx = game.serveSide * right(sv) * 0.9; a.y = a.ty = BASE[sv];
  b.x = b.tx = game.serveSide * right(rc) * 2.0; b.y = b.ty = BASE[rc];
  if (isCPU(sv)) game.cpuServeAt = T() + rand(0.9, 1.4);
}

function serve(pi, pow) {
  const p = players[pi];
  const right = pi === 0 ? 1 : -1;
  const sign = -game.serveSide * right;       // 대각선 반대편 서비스 박스
  const to = { x: sign * rand(0.7, 3.5), y: pi === 0 ? C.net + rand(3.6, 6.0) : C.net - rand(3.6, 6.0) };
  const from = { x: p.x + RACKET_SIDE[pi] * 0.3, y: p.y, z: 2.7 };
  const s = makeShot(pi, from, to, lerp(1.15, 0.66, pow), 'serve', false, lerp(0.5, 0.1, pow));   // 살살 넣으면 탑스핀 서브, 세게는 플랫
  game.shot = s; game.state = 'rally'; game.stateT = T(); game.rally = 0;
  p.tx = 0; p.ty = BASE[pi]; p.anim = 'serve';
  p.lastSpin = s.spin; p.lastSpeed = s.speed; p.lastSpeedT = T();
  sfx.hit(pow); spawnSparks(from, '#fde68a', 8); rumblePlayer(pi, 0.5, 60);
  scheduleCPU(s);
}

// CPU가 받을 차례면 스윙 시각을 미리 정해둠 (실력별 오차)
function scheduleCPU(s) {
  game.cpuSwing = null;
  const r = s.receiver;
  if (!isCPU(r) || s.out || !s.reachable) return;
  const lv = game.demo ? 2 : settings.cpuLevel;
  const sigma = [0.11, 0.075, 0.05][lv];
  let aim = 0;
  if (Math.random() < [0.25, 0.4, 0.55][lv]) aim = (Math.random() < 0.5 ? -1 : 1) * rand(0.35, 0.75) * s.W;   // 각도 노리기
  const at = s.hit.t + aim + gauss() * sigma;
  let pow = rand(0.32, [0.7, 0.85, 1.0][lv]);
  if (s.hit.z > 1.9 && lv >= 1 && Math.random() < 0.8) pow = rand(0.6, 1);
  else if (Math.random() < 0.08) pow = rand(0.05, 0.22);   // 가끔 로브
  // 스핀: 대부분 탑스핀, 낮게 깔린 공이나 가끔은 슬라이스, 세게 칠 땐 플랫도
  let spin = rand(0.3, 0.85);
  if ((s.hit.z < 0.35 && Math.random() < 0.5) || Math.random() < [0.1, 0.14, 0.18][lv]) spin = -rand(0.35, 0.9);
  else if (pow > 0.8 && Math.random() < 0.5) spin = rand(0, 0.25);
  game.cpuSwing = { player: r, at, pow, spin };
}

// 스윙 동작 종류: 서브·스매시는 머리 위, 그 밖엔 휘두른 쪽(모르면 공이 오는 쪽) 포핸드·백핸드
function swingAnim(pi, side) {
  if (game.state === 'serve' && game.server === pi) return 'serve';
  const s = game.shot, incoming = game.state === 'rally' && s && s.receiver === pi && !s.resolved;
  if (incoming && s.hit.z > 1.85) return 'smash';
  return (side || (incoming ? s.side : 'fh')) === 'bh' ? 'backhand' : 'drive';
}
const handSide = (pi, side) => side && settings.lefty[pi] ? (side === 'fh' ? 'bh' : 'fh') : side;   // 왼손잡이는 반대로

// 조이콘 스윙은 휘두르기 시작한 순간 화면 속 라켓도 바로 움직이고, 실제로 돈 각도만큼 따라감
const SWING_ARC = 150;   // 이만큼(도) 돌리면 화면 스윙이 끝까지 감
function motionStart(pi, jc) {
  if (pi == null || pi < 0 || game.paused || isCPU(pi) || !jc.motion) return;
  const p = players[pi], t = T();
  p.motion = jc.motion; p.motionJc = jc; p.motionT = t;
  p.swingT = t; p.swingLive = true; p.anim = swingAnim(pi, null);
}
function followMotion(t) {
  for (const p of players) {
    const m = p.motion;
    if (!m) continue;
    const d = JC.swingDir(p.motionJc), side = handSide(p.i, d.side);
    if (side && (p.anim === 'drive' || p.anim === 'backhand')) p.anim = side === 'bh' ? 'backhand' : 'drive';
    if (d.spin != null) p.swingSpin = d.spin;
    p.swingT = t - Math.min(1, m.angle / SWING_ARC) * SWING_DUR;   // 끝나면 그 자리부터 원래 속도로 마저 휘두름
    if (!m.active || t - p.motionT > 1.5) p.motion = null;
  }
}

// 모든 스윙 입력(조이콘·키보드·패드·CPU)이 모이는 곳. tSwing은 게임 시간
// spin·side는 휘두른 방향으로 정한 스핀과 포핸드('fh')·백핸드('bh') (모르면 null)
function doSwing(pi, pow, tSwing, spin, side = null) {
  const p = players[pi], t = T();
  if (spin == null) spin = autoSpin(pow);
  if (t - p.motionT >= 0.4) { p.swingT = t; p.swingLive = false; p.anim = swingAnim(pi, side); }   // 조이콘이면 이미 휘두르는 중
  else if (side && (p.anim === 'drive' || p.anim === 'backhand')) p.anim = side === 'bh' ? 'backhand' : 'drive';
  p.lastPow = pow; p.lastPowT = t; p.lastSpin = p.swingSpin = spin;
  if (!isCPU(pi)) sfx.whoosh(pow);
  if (game.state === 'select') { selReady(pi, true); return; }   // 캐릭터 선택 화면: 휘두르면 준비
  if (game.state === 'serve') {
    if (game.server === pi && t - game.stateT > 0.45) serve(pi, pow);
    return;
  }
  if (game.state !== 'rally') return;
  const s = game.shot;
  if (!s || s.resolved || s.receiver !== pi || s.out || s.miss) return;
  const d = (tSwing - settings.latencyMs / 1000) - s.hit.t;
  if (d < -0.75) return;            // 공이 아직 멀리 있음 → 무시
  if (!s.reachable) return;         // 못 따라가는 공
  if (Math.abs(d) <= s.W) { hitBall(pi, d / s.W, pow, spin, side); return; }
  if (d < -s.W) { s.miss = '빠름!'; p.flash = '빠름!'; p.flashT = t; }
}

function hitBall(pi, u, pow, spin, side) {
  const s = game.shot, p = players[pi], t = T();
  s.resolved = true;
  game.rally++;
  const bp = ballPos(s, t);
  const from = { x: bp.x, y: bp.y, z: clamp(bp.z, 0.4, 3.2) };
  // 공은 백핸드 쪽인데 포핸드로 휘두르는 등 반대로 치면: 맞기는 하지만 힘없고 방향이 흔들림
  const wrong = !!(side && side !== s.side && from.z <= 1.85);
  if (wrong) pow = Math.min(pow, 0.3);
  const perfect = !wrong && Math.abs(u) < 0.22;
  let kind = 'drive';
  if (from.z > 1.85 && pow >= 0.5) kind = 'smash';
  else if (pow < 0.25) kind = 'lob';
  const sp = kind === 'smash' ? 0.1 : spin;
  if (kind === 'smash') p.anim = 'smash';
  const special = game.rally >= 8 && perfect && kind !== 'lob';
  // 방향: 일찍(u<0) → 치는 사람 기준 왼쪽, 늦게 → 오른쪽
  const dirSign = pi === 0 ? 1 : -1;
  const spread = (kind === 'smash' ? 3.6 : kind === 'lob' ? 3.2 : 4.4) * (wrong ? 1.3 : 1);
  const tx = u * spread * dirSign;
  const depth = kind === 'lob' ? 0.88 : kind === 'smash' ? 0.6 : lerp(0.62, 0.88, pow);
  const ty = pi === 0 ? C.net + depth * C.net : C.net - depth * C.net;
  let flight = kind === 'lob' ? 1.7 : kind === 'smash' ? 0.6 : lerp(1.3, 0.8, pow);
  if (perfect && kind === 'drive') flight *= 0.9;
  flight *= Math.max(0.8, 1 - 0.012 * game.rally);   // 랠리가 길수록 빨라짐
  if (special) flight *= 0.78;
  if (sp < 0) flight *= 1 - 0.12 * sp;               // 슬라이스는 떠서 느리게 감
  const ns = makeShot(pi, from, { x: tx, y: ty }, Math.max(0.55, flight), kind, special, sp);
  game.shot = ns;
  p.tx = 0; p.ty = BASE[pi];                          // 친 사람은 가운데로 복귀
  p.lastSpin = sp; p.lastSpeed = ns.speed; p.lastSpeedT = t;
  let text = '', color = '#fff';
  if (wrong) { text = '반대쪽!'; }
  else if (special) { text = '필살 샷!'; color = '#fb923c'; game.shake = 1; }
  else if (kind === 'smash') { text = '스매시!'; game.shake = 0.8; }
  else if (perfect) { text = '나이스!'; game.nice[pi]++; }
  else if (kind === 'lob') { text = '로브'; }
  else if (Math.abs(sp) >= 0.6) { text = spinLabel(sp); }
  if (text) { p.flash = text; p.flashT = t; }
  if (special) showMsg('필살 샷!', color);
  sfx.hit(kind === 'smash' || special ? 1 : pow);
  spawnSparks(from, special ? '#fb923c' : '#fde68a', special ? 24 : 10);
  rumblePlayer(pi, special || kind === 'smash' ? 0.9 : 0.5, 70);
  scheduleCPU(ns);
}

function endPoint(winner, text, color) {
  game.state = 'pointEnd'; game.stateT = T(); game.cpuSwing = null; game.crowdT = T();
  game.longest = Math.max(game.longest, game.rally);
  game.log.push({ winner, text, rally: game.rally, kind: game.shot ? game.shot.kind : '' });
  if (game.log.length > 2000) game.log.shift();
  const pts = game.points; pts[winner]++;
  game.gameWon = -1;
  if (pts[winner] >= 4 && pts[winner] - pts[1 - winner] >= 2) {
    game.games[winner]++; game.points = [0, 0]; game.gameWon = winner;
    game.server = 1 - game.server;
  }
  showMsg(text, color || '#fff', game.gameWon >= 0 ? `${nameOf(winner)} 게임!` : '');
  sfx.point(); rumblePlayer(winner, 0.35, 120);
}

function afterPoint() {
  if (game.gameWon >= 0) {
    if (!game.demo && game.games[game.gameWon] >= settings.gamesToWin) { finishMatch(game.gameWon); return; }
    if (game.demo && game.games[game.gameWon] >= 3) game.games = [0, 0];
  }
  startServe();
}

function finishMatch(w) {
  game.state = 'matchEnd'; game.stateT = T(); game.winner = w; game.cpuSwing = null; game.crowdT = T();
  // 이긴 사람은 앞으로 나와서 세리머니, 진 사람은 뒤에서 풀 죽음
  const W = players[w], L = players[1 - w];
  W.x = W.tx = 0; W.y = W.ty = 2.3; L.x = L.tx = 1.75; L.y = L.ty = 4.4;
  W.swingT = L.swingT = -9; W.flash = L.flash = '';
  $('resTitle').textContent = `${nameOf(w)} 승리! 🏆`;
  $('resTitle').style.color = COLORS[w];
  $('resBody').innerHTML = `${slotLabel(0)} ${nameOf(0)} ${game.games[0]} : ${game.games[1]} ${nameOf(1)} ${slotLabel(1)}<br>최장 랠리 ${game.longest}회 · 나이스 샷 ${game.nice[0]} / ${game.nice[1]}`;
  $('result').classList.remove('hidden');
  sfx.cheer(2.2);
}

function hideOverlays(...ids) { for (const id of ids) $(id).classList.add('hidden'); }

function startMatch() {
  setDemoPaused(false);
  sfx.init(); saveSettings();
  game.demo = false; game.paused = false;
  game.points = [0, 0]; game.games = [0, 0]; game.rally = 0; game.longest = 0; game.nice = [0, 0];
  game.server = 0; game.msg = null; game.winner = -1; selStartAt = 0;
  hideOverlays('menu', 'result', 'pause', 'select');
  assignJoyCons();
  for (const p of players) { p.swingT = -9; p.flash = ''; }
  startServe();
  showMsg('경기 시작!', '#facc15');
}

function toMenu() {
  setDemoPaused(false);
  game.demo = true; game.paused = false; game.winner = -1; selStartAt = 0;
  hideOverlays('pause', 'result', 'select');
  $('menu').classList.remove('hidden');
  game.points = [0, 0]; game.games = [0, 0]; game.msg = null;
  syncMenu(); startServe();
}

function pause() {
  if (game.paused || game.demo || game.state === 'matchEnd' || game.state === 'select') return;
  pausedAt = realNow(); game.paused = true; $('pause').classList.remove('hidden');
  $('pauseInfo').textContent = gfxInfoText();
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

// ============================================================
// 캐릭터 선택
// ============================================================
const sel = [{ idx: 0, ready: false }, { idx: 1, ready: false }];
let selStartAt = 0, rosterBuilt = false;

function openSelect() {
  setDemoPaused(false);
  sfx.init(); saveSettings(); buildRoster();
  game.demo = false; game.paused = false; game.state = 'select'; game.stateT = T();
  game.shot = null; game.cpuSwing = null; game.msg = null; game.winner = -1; selStartAt = 0;
  hideOverlays('menu', 'result', 'pause');
  $('select').classList.remove('hidden');
  assignJoyCons();
  for (const i of [0, 1]) { sel[i].idx = settings.chars[i]; sel[i].ready = false; }
  if (settings.mode === 'cpu') {
    if (sel[1].idx === sel[0].idx) { sel[1].idx = (sel[0].idx + 1 + Math.floor(Math.random() * (CHARS.length - 1))) % CHARS.length; settings.chars[1] = sel[1].idx; }
    sel[1].ready = true;
  }
  const P = [[-0.95, 2.2], [0.95, 2.2]];
  players.forEach((p, i) => { p.x = p.tx = P[i][0]; p.y = p.ty = P[i][1]; p.swingT = -9; p.flash = ''; });
  rebuildPlayer3D(0); rebuildPlayer3D(1);
  renderSelect();
}
const selCPU = i => settings.mode === 'cpu' && i === 1;
function selSet(i, k, force) {
  if (game.state !== 'select') return;
  if (selCPU(i) && !force) return;
  if (sel[i].idx === k && !selCPU(i)) { selReady(i, !sel[i].ready); return; }   // 같은 캐릭터를 또 고르면 준비 토글
  sel[i].idx = k; sel[i].ready = selCPU(i);
  settings.chars[i] = k; saveSettings();
  selStartAt = 0;
  rebuildPlayer3D(i);
  sfx.tick(); renderSelect(); checkSelectStart();
}
function selMove(i, d, force) {
  if (game.state !== 'select') return;
  selSet(i, (sel[i].idx + d + CHARS.length) % CHARS.length, force);
}
function selReady(i, on) {
  if (game.state !== 'select' || selCPU(i) || sel[i].ready === on) return;
  sel[i].ready = on;
  if (on) sfx.ready(); else selStartAt = 0;
  renderSelect(); checkSelectStart();
}
function checkSelectStart() {
  if (sel[0].ready && sel[1].ready && !selStartAt) { selStartAt = T() + 1.5; renderSelect(); }
}
function buildRoster() {
  if (rosterBuilt) return;
  rosterBuilt = true;
  const el = $('roster');
  el.innerHTML = CHARS.map((ch, k) => `<button type="button" class="tile" data-k="${k}" aria-label="${ch.name} 캐릭터 선택"><span class="tg t1" aria-hidden="true">1P</span><span class="tg t2" aria-hidden="true">2P</span><canvas width="200" height="200" aria-hidden="true"></canvas><span class="tn">${ch.name}</span><span class="character-type">${ch.tag || '테니스 메이트'}</span></button>`).join('');
  if (el.querySelectorAll) el.querySelectorAll('canvas').forEach((c, k) => NC.portrait(c, CHARS[k]));
  const tileOf = e => (e.target && e.target.closest) ? e.target.closest('.tile') : null;
  el.onclick = e => { const tl = tileOf(e); if (tl) selSet(0, +tl.dataset.k); };
  el.oncontextmenu = e => { e.preventDefault(); const tl = tileOf(e); if (tl) selSet(1, +tl.dataset.k, true); };
}
function renderSelect() {
  document.querySelectorAll('#roster .tile').forEach(tl => {
    const k = +tl.dataset.k;
    tl.classList.toggle('p1', sel[0].idx === k); tl.classList.toggle('p2', sel[1].idx === k);
  });
  for (const i of [0, 1]) {
    const cpu = selCPU(i);
    $('selb' + i).textContent = i === 0 ? 'P1' : (cpu ? 'CPU' : 'P2');
    $('seln' + i).textContent = CHARS[sel[i].idx].name;
    $('sels' + i).textContent = sel[i].ready ? '준비 완료!' : '고르는 중…';
    $('selc' + i).classList.toggle('rd', sel[i].ready);
    $('selh' + i).textContent = cpu ? 'CPU · 우클릭이나 ◀ ▶로 바꾸기'
      : `휘두르면 준비 · 조이콘 Y·A 또는 ◀▶ · 키보드 ${i === 0 ? 'A·D, S' : 'J·L, K'}`;
  }
  $('selMsg').textContent = selStartAt ? '둘 다 준비 완료! 곧 시작…' : (settings.mode === 'cpu' ? '준비되면 휘두르기!' : '둘 다 휘두르면 시작!');
}

// ---------- 매 프레임 갱신 ----------
let lastT = 0;
function update() {
  const t = T();
  const dt = clamp(t - lastT, 0, 0.1); lastT = t;   // 느린 컴퓨터(10fps)에서도 이동 속도가 실제 시간과 같게
  pollGamepads();
  if (game.paused || demoPauseAt !== null) return;
  followMotion(t);
  for (const p of players) {
    const dx = p.tx - p.x, dy = p.ty - p.y, d = Math.hypot(dx, dy), step = p.speed * dt;
    if (d <= step) { p.x = p.tx; p.y = p.ty; } else { p.x += dx / d * step; p.y += dy / d * step; }
  }
  if (game.state === 'serve') {
    if (isCPU(game.server) && t >= game.cpuServeAt) doSwing(game.server, rand(0.45, game.demo ? 1 : [0.7, 0.85, 1][settings.cpuLevel]), t);
  } else if (game.state === 'rally') {
    updateRally(t);
  } else if (game.state === 'pointEnd') {
    if (game.shot) { const bp = ballPos(game.shot, t); game.shot.trail.push(bp); if (game.shot.trail.length > 14) game.shot.trail.shift(); ballEvents(game.shot, t); }
    if (t - game.stateT > 1.9) afterPoint();
  } else if (game.state === 'select') {
    if (selStartAt && t >= selStartAt) startMatch();
  }
  game.shake = Math.max(0, game.shake - dt * 2.5);
  updateParticles(dt);
}

// 바운드 소리·먼지 (아무도 못 친 공은 두세 번 더 튀다가 굴러감)
function ballEvents(s, t) {
  while (s.nb < s.bounces.length && t - s.t0 >= s.bounces[s.nb].t) {
    const b = s.bounces[s.nb++];
    if (s.nb > 1 && b.t - s.bounces[s.nb - 2].t < 0.15) continue;   // 굴러가기 직전 자잘한 바운드는 조용히
    sfx.bounce(); spawnDust(b.x, b.y);
  }
}

function updateRally(t) {
  const s = game.shot; if (!s) return;
  const bp = ballPos(s, t);
  s.trail.push(bp); if (s.trail.length > 14) s.trail.shift();
  ballEvents(s, t);
  if (!s.bounced && t - s.t0 >= s.T1) {
    s.bounced = true;
    if (s.out && !s.resolved) { s.resolved = true; endPoint(s.receiver, '아웃!', '#fbbf24'); return; }
  }
  if (game.cpuSwing && t >= game.cpuSwing.at) {
    const cs = game.cpuSwing; game.cpuSwing = null;
    doSwing(cs.player, cs.pow, cs.at + settings.latencyMs / 1000, cs.spin, s.side);
    if (game.state !== 'rally') return;
  }
  if (s.resolved || game.shot !== s) return;
  // 판정 창이 지났는데 못 침 (스윙 감지 지연 여유 0.12초)
  if (t > s.hit.t + s.W + 0.12) {
    s.resolved = true;
    let text, color = '#fca5a5';
    if (s.miss) text = s.miss;
    else if (!s.reachable) { text = s.kind === 'serve' ? '에이스!' : s.special ? '필살 샷!' : '위너!'; color = '#facc15'; }
    else text = '늦음!';
    endPoint(s.hitter, text, color);
  }
}

// ---------- 파티클 (월드 좌표, 2D·3D 공용) ----------
const parts = [];
function spawnSparks(w, color, n) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, sp = rand(1.2, 3.6);
    parts.push({ kind: 'spark', x: w.x, y: w.y, z: w.z, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.6, vz: rand(0.8, 3.2), life: 0, max: rand(0.25, 0.5), color, r: rand(0.025, 0.05) });
  }
  while (parts.length > 120) parts.shift();
}
function spawnDust(x, y) { parts.push({ kind: 'dust', x, y, z: 0, life: 0, max: 0.4 }); }
function updateParticles(dt) {
  for (let i = parts.length - 1; i >= 0; i--) {
    const q = parts[i]; q.life += dt;
    if (q.life >= q.max) { parts.splice(i, 1); continue; }
    if (q.kind === 'spark') { q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt; q.vz -= 9.8 * dt; }
  }
}

// ============================================================
// 입력: 키보드 · 게임패드 · 조이콘
// ============================================================
const inputFlash = [{ pow: 0, t: -9, spin: null }, { pow: 0, t: -9, spin: null }];
function flashInput(pi, pow, spin = null) { inputFlash[pi] = { pow, t: realNow(), spin }; }

// 사람 입력 → 게임. rawT는 performance 기준 초, spin·side는 휘두른 방향으로 정한 스핀과 포핸드·백핸드(모르면 null)
function emitSwing(pi, pow, rawT, spin = null, side = null) {
  if (pi == null || pi < 0 || game.paused || isCPU(pi)) return;
  doSwing(pi, pow, rawT - pauseOffset, spin, side);
}

// [선수, 세기, 스핀] — S·K 바로 아래 X·쉼표는 깎아 치기(슬라이스)
const KEYMAP = { KeyA: [0, 0.12], KeyS: [0, 0.55], KeyD: [0, 0.92], KeyX: [0, 0.55, -0.7], KeyJ: [1, 0.12], KeyK: [1, 0.55], KeyL: [1, 0.92], Comma: [1, 0.55, -0.7] };
const SELKEYS = { KeyA: [0, -1], KeyD: [0, 1], KeyS: [0, 0], KeyJ: [1, -1], KeyL: [1, 1], KeyK: [1, 0] };
window.addEventListener('keydown', e => {
  sfx.init();
  if (e.repeat) return;
  if (e.code === 'KeyF') { toggleFull(); return; }
  // 선택 버튼에 초점이 있으면 Enter·Space의 기본 클릭 동작을 사용한다.
  if (e.target && e.target.closest && e.target.closest('#roster .tile') && ['Enter', 'NumpadEnter', 'Space'].includes(e.code)) return;
  if (selectOpen()) {
    if (e.code === 'Escape') { toMenu(); return; }
    if (e.code === 'Enter' || e.code === 'NumpadEnter') { e.preventDefault(); selReady(0, true); selReady(1, true); return; }
    const m = SELKEYS[e.code];
    if (m) { if (m[1]) selMove(m[0], m[1]); else selReady(m[0], !sel[m[0]].ready); }
    return;
  }
  if (e.code === 'Escape') {
    if (game.paused) resume(); else if (resultOpen()) toMenu(); else if (!game.demo) pause();
    return;
  }
  if (e.code === 'Enter' || e.code === 'NumpadEnter') { e.preventDefault(); onConfirm(); return; }
  const m = KEYMAP[e.code];
  if (!m) return;
  const [pi, pow, spin = null] = m;
  if (settings.mode === 'cpu' && pi === 1) return;
  flashInput(pi, pow, spin);
  emitSwing(pi, pow, realNow(), spin);
});

const padPrev = {}, padSel = {};
function pollGamepads() {
  if (!navigator.getGamepads) return;
  let pads; try { pads = navigator.getGamepads() || []; } catch (e) { return; }
  let slot = 0;
  game.padCount = 0;
  for (const gp of pads) {
    if (!gp || !gp.connected) continue;
    if (JC.supported && /057e|joy-con|pro controller|nintendo/i.test(gp.id)) continue;   // PC에선 조이콘은 WebHID로 받음
    const pi = settings.mode === 'cpu' ? 0 : (slot++ % 2);
    game.padCount++;
    const now = gp.buttons.map(b => b.pressed || b.value > 0.5);
    const prev = padPrev[gp.index] || [];
    const rise = i => !!now[i] && !prev[i];
    padPrev[gp.index] = now;
    if (selectOpen()) {
      const ax = gp.axes && gp.axes.length ? gp.axes[0] : 0, std = gp.mapping === 'standard';
      const left = (std && !!now[14]) || ax < -0.6, right = (std && !!now[15]) || ax > 0.6;
      const st = padSel[gp.index] || (padSel[gp.index] = { l: false, r: false });
      if (left && !st.l) selMove(pi, -1);
      if (right && !st.r) selMove(pi, 1);
      st.l = left; st.r = right;
      if (rise(0) || rise(9)) selReady(pi, true);
      if (rise(1)) selReady(pi, false);
      continue;
    }
    let swing = -1, spin = null, confirm = false;
    if (gp.mapping === 'standard') {
      if (rise(0)) swing = 0.55;
      if (rise(1)) { swing = 0.55; spin = -0.7; }   // B = 슬라이스
      if (rise(2)) swing = 0.12;
      if (rise(3) || rise(5) || rise(7)) swing = 0.92;
      confirm = rise(0) || rise(9);
    } else {
      for (let i = 0; i < now.length; i++) if (rise(i)) { swing = 0.55; confirm = true; break; }
    }
    if (confirm && (menuOpen() || resultOpen() || game.paused)) { onConfirm(); continue; }
    if (swing >= 0) { flashInput(pi, swing, spin); emitSwing(pi, swing, realNow(), spin); }
  }
}

// ---------- 조이콘 (공용 모듈 shared/joycon.js) ----------
function assignJoyCons() { JC.single = settings.mode === 'cpu'; JC.assign(); }
function rumblePlayer(pi, amp, ms) { if (!game.demo) JC.rumble(pi, amp, ms); }
function onJoyButtons(pi, m) {
  if (selectOpen()) {
    if (JC.isPrev(m)) selMove(pi, -1);          // Y · ←
    else if (JC.isNext(m)) selMove(pi, 1);      // A · →
    else selReady(pi, true);                    // 그 밖의 버튼 = 준비
    return;
  }
  onConfirm();
}
JC.on('swingstart', (pi, t, jc) => motionStart(pi, jc));
JC.on('swing', (pi, pow, t, jc) => emitSwing(pi, pow, t, jc ? jc.lastSpin : null, jc ? handSide(pi, jc.lastSide) : null));
JC.on('buttons', (pi, m) => onJoyButtons(pi, m));
JC.on('change', () => renderSlots());

// ============================================================
// 메뉴 UI
// ============================================================
function inputLabel(pi) {
  if (isCPU(pi)) return `CPU 실력 ${['쉬움', '보통', '어려움'][settings.cpuLevel]}`;
  const j = JC.list.find(j => j.player === pi);
  if (j) return j.name;
  if (game.padCount > (settings.mode === 'cpu' ? 0 : pi)) return '게임패드';
  return pi === 0 ? '키보드 A·S·D' : '키보드 J·K·L';
}
function renderSlots() {
  const el = $('slots'); if (!el) return;
  el.innerHTML = [0, 1].map(pi => {
    const cpu = settings.mode === 'cpu' && pi === 1;
    const jcs = JC.list.filter(j => j.player === pi);
    const inputs = cpu ? ['CPU'] : [...jcs.map(j => j.name + (j.err ? ` ⚠ ${j.err}` : j.ok ? ' ✓' : ' (연결 중)')), pi === 0 ? '키보드 A·S·D' : '키보드 J·K·L'];
    return `<div class="slot"><span class="badge b${pi + 1}">${pi === 0 ? 'P1' : cpu ? 'CPU' : 'P2'}</span>
      <div style="flex:1;min-width:0"><div style="font-size:15px">${inputs.join(' · ')}</div>
      <div class="row" style="margin-top:6px;flex-wrap:nowrap"><div class="meter"><i id="m${pi}"></i></div><span id="s${pi}" class="small" style="min-width:118px"></span></div></div></div>`;
  }).join('');
}
function updateSlotMeters() {
  if (!menuOpen()) return;
  if (realNow() - gfx.infoT > 0.25) { gfx.infoT = realNow(); $('gfxInfo').textContent = gfxInfoText(); }
  for (const pi of [0, 1]) {
    const m = $('m' + pi), s = $('s' + pi); if (!m || !s) continue;
    const jcs = JC.list.filter(j => j.player === pi);
    const g = jcs.reduce((a, j) => Math.max(a, j.gyro), 0);
    let last = inputFlash[pi];
    for (const j of jcs) if (j.lastSwingT > last.t) last = { pow: j.lastPow, t: j.lastSwingT, spin: j.lastSpin, path: j.lastPath };
    const age = realNow() - last.t;
    const w = jcs.length ? Math.min(100, g / 18) : (age < 0.4 ? last.pow * 100 : 0);
    m.style.width = w + '%';
    // 조이콘이면 라켓 머리가 지나간 각도도 보여줌 (↗ 올려 치기 · ↘ 깎아 치기)
    const ang = last.path == null ? '' : ` ${last.path >= 0 ? '↗' : '↘'}${Math.round(Math.abs(Math.asin(last.path)) * 180 / Math.PI)}°`;
    const spinTxt = spinLabel(last.spin == null ? autoSpin(last.pow) : last.spin) + ang;
    s.textContent = age < 1.6 ? `스윙! ${powLabel(last.pow)} ${Math.round(last.pow * 100)}% · ${spinTxt}` : (jcs.length ? '휘둘러 보세요' : '');
  }
}
function showWarn(text) { const w = $('hidWarn'); w.textContent = text; w.classList.toggle('hidden', !text); }
function syncMenu() {
  document.querySelectorAll('#modeRow button').forEach(b => b.classList.toggle('on', b.dataset.mode === settings.mode));
  document.querySelectorAll('#lvRow button').forEach(b => b.classList.toggle('on', +b.dataset.lv === settings.cpuLevel));
  document.querySelectorAll('#gwRow button').forEach(b => b.classList.toggle('on', +b.dataset.gw === settings.gamesToWin));
  document.querySelectorAll('#qRow button').forEach(b => b.classList.toggle('on', b.dataset.q === settings.quality));
  $('lvRow').style.opacity = settings.mode === 'cpu' ? 1 : 0.45;
  $('sens').value = settings.sensitivity; $('sensV').textContent = (+settings.sensitivity).toFixed(2) + '×';
  $('lat').value = settings.latencyMs; $('latV').textContent = settings.latencyMs + 'ms';
  $('guide').checked = !!settings.guide;
  for (const i of [0, 1]) $('lefty' + i).checked = settings.lefty[i];
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
  high:   { label: '높음', maxW: 1920, aa: true,  shadows: true },
  mid:    { label: '보통', maxW: 1920, aa: true,  shadows: false },
  low:    { label: '낮음', maxW: 1280, aa: false, shadows: false },
  lowest: { label: '최저', maxW: 960,  aa: false, shadows: false },
  '2d':   { label: '2D',   maxW: 1920, aa: false, shadows: false },
};
const gfx = { level: '2d', mode3d: false, autoLevel: 'mid', locked: false, pending: null, prevFps: 0,
  acc: 0, frames: 0, dispAcc: 0, dispFrames: 0, dispFps: 0, ignoreUntil: 0, note: '', toast: null, lastReal: 0, infoT: 0 };
const VW = 1920, VH = 1080;                    // HUD 가상 화면
const hud = $('hud'), hctx = hud.getContext('2d');
const view = { k: 1, ox: 0, oy: 0 };

function resize() {
  const lv = Q[gfx.level] || Q.mid;
  const stage = $('courtStage');
  const cssW = Math.max(1, stage && stage.clientWidth || window.innerWidth), cssH = Math.max(1, stage && stage.clientHeight || window.innerHeight);
  // Frame the partners inside the gap between the roster and player controls.
  // Reading only on resize keeps layout work out of the animation loop.
  G3.selectFraming = null;
  const selectScreen = $('select');
  if (selectScreen && !selectScreen.classList.contains('hidden') && selectScreen.querySelector) {
    const top = selectScreen.querySelector('.selection-top'), bottom = selectScreen.querySelector('.selbottom');
    if (top && bottom && top.getBoundingClientRect && bottom.getBoundingClientRect) {
      const a = top.getBoundingClientRect().bottom + 12, b = bottom.getBoundingClientRect().top - 14;
      if (b - a > 90) G3.selectFraming = { height: (b - a) / cssH, center: (a + b) / (2 * cssH) };
    }
  }
  const dpr = window.devicePixelRatio || 1;
  const pr = Math.max(0.25, Math.min(dpr, lv.maxW / cssW));   // 4K 화면이어도 렌더 해상도는 상한까지만
  hud.width = Math.max(1, Math.round(cssW * pr)); hud.height = Math.max(1, Math.round(cssH * pr));
  view.k = Math.min(hud.width / VW, hud.height / VH);
  view.ox = (hud.width - VW * view.k) / 2; view.oy = (hud.height - VH * view.k) / 2;
  if (G3.camera) { G3.camera.aspect = cssW / cssH; G3.camera.updateProjectionMatrix(); G3.camSnap = true; }
  if (G3.renderer && gfx.mode3d) { G3.renderer.setPixelRatio(pr); G3.renderer.setSize(cssW, cssH, false); }
  const bufH = gfx.mode3d && G3.renderer ? G3.renderer.domElement.height : hud.height;
  G3.focal = bufH / (2 * Math.tan(42 * Math.PI / 360));
}

function applyQuality(level) {
  if (level !== '2d') {
    if (!G3.available) level = '2d';
    else {
      ensureScene3D();
      const pr = Q[level];
      if (HEADLESS !== '3d' && (!G3.renderer || G3.aa !== pr.aa) && !initRenderer(pr.aa)) {
        level = '2d';
        gfx.note = '3D를 켤 수 없어서 2D로 실행 중 (크롬 설정 > 시스템 > 그래픽 가속 사용 켜기)';
      }
    }
  }
  gfx.level = level;
  gfx.mode3d = level !== '2d';
  if (gfx.mode3d) applyShadows(!!Q[level].shadows);
  const glc = $('gl'); if (glc) glc.style.display = gfx.mode3d ? 'block' : 'none';
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
const AUTO_ORDER = ['mid', 'low', 'lowest', '2d'];
function trackPerf(dt) {
  if (!(dt > 0 && dt < 0.25)) return;
  gfx.dispAcc += dt; gfx.dispFrames++;
  if (gfx.dispAcc >= 0.5) { gfx.dispFps = gfx.dispFrames / gfx.dispAcc; gfx.dispAcc = 0; gfx.dispFrames = 0; }
  const playing = !game.demo && !game.paused && game.state !== 'select' && game.state !== 'matchEnd' && !menuOpen() && !resultOpen();
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
// HUD (점수판·문구) — 2D·3D 공용, 가상 1920x1080 좌표
// ============================================================
function pointText() {
  const [a, b] = game.points, NN = ['0', '15', '30', '40'];
  if (a >= 3 && b >= 3) return a === b ? { mid: '듀스' } : { mid: `어드밴티지 ${nameOf(a > b ? 0 : 1)}` };
  return { l: NN[Math.min(a, 3)], r: NN[Math.min(b, 3)] };
}
function outlined(g, text, x, y, fill, lw = 7) { g.lineWidth = lw; g.strokeStyle = 'rgba(18,53,43,0.8)'; g.strokeText(text, x, y); g.fillStyle = fill; g.fillText(text, x, y); }
function pill(g, text, x, y, color, alpha) {
  const w = g.measureText(text).width + 48, h = 50;
  g.globalAlpha = alpha;
  g.fillStyle = 'rgba(23,65,51,0.94)'; rr(g, x - w / 2, y - h / 2, w, h, h / 2); g.fill();
  g.strokeStyle = 'rgba(255,248,224,0.24)'; g.lineWidth = 1; g.stroke();
  g.fillStyle = color; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, x, y + 1);
  g.globalAlpha = 1;
}
function drawScoreboard(g) {
  const W = 920, H = 108, X = (VW - W) / 2, Y = 22;
  g.fillStyle = 'rgba(22,54,43,0.12)'; rr(g, X, Y + 6, W, H, 24); g.fill();
  g.fillStyle = 'rgba(255,251,237,0.97)'; rr(g, X, Y, W, H, 24); g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.7)'; g.lineWidth = 2; g.stroke();
  g.strokeStyle = 'rgba(32,76,59,0.14)'; g.lineWidth = 1;
  for (const sx of [X + 310, X + W - 310]) { g.beginPath(); g.moveTo(sx, Y + 22); g.lineTo(sx, Y + H - 22); g.stroke(); }
  g.textBaseline = 'middle';
  for (const pi of [0, 1]) {
    const left = pi === 0, ex = left ? X + 30 : X + W - 30, tx = ex + (left ? 24 : -24);
    g.fillStyle = COLORS[pi]; circ(g, ex, Y + 40, 7);
    g.font = `800 31px ${FONT}`; g.textAlign = left ? 'left' : 'right'; g.fillStyle = '#173e30';
    g.fillText(nameOf(pi), tx, Y + 40);
    g.font = `700 18px ${FONT}`; g.fillStyle = '#6f8072';
    g.fillText(`${slotLabel(pi)}  ·  ${game.games[pi]} 게임`, tx, Y + 78);
    if (game.server === pi) {
      const bx = left ? X + 276 : X + W - 276;
      g.fillStyle = '#d2df62'; circ(g, bx, Y + 40, 9);
      g.strokeStyle = '#8e9a35'; g.lineWidth = 1.5; g.beginPath(); g.arc(bx - 3, Y + 40, 7, -1.1, 1.1); g.stroke();
    }
  }
  const pt = pointText();
  g.textAlign = 'center'; g.fillStyle = '#7e8b77'; g.font = `800 14px ${FONT}`;
  g.fillText('NOLJA MONSTER RALLY', VW / 2, Y + 26);
  g.fillStyle = '#173e30';
  if (pt.mid) { g.font = `900 26px ${FONT}`; g.fillText(pt.mid, VW / 2, Y + 69); }
  else { g.font = `900 49px ${FONT}`; g.fillText(`${pt.l}   ${pt.r}`, VW / 2, Y + 71); }
}
function drawCards(g) {
  for (const pi of [0, 1]) {
    const W = 400, H = 84, X = pi === 0 ? 28 : VW - 28 - W, Y = VH - H - 24, p = players[pi];
    g.fillStyle = 'rgba(255,251,237,0.95)'; rr(g, X, Y, W, H, 18); g.fill();
    g.strokeStyle = 'rgba(24,66,48,0.1)'; g.lineWidth = 1; g.stroke();
    g.fillStyle = COLORS[pi]; rr(g, X + 14, Y + 13, 60, 30, 8); g.fill();
    g.textBaseline = 'middle'; g.textAlign = 'center'; g.fillStyle = '#fff'; g.font = `800 20px ${FONT}`;
    g.fillText(slotLabel(pi), X + 44, Y + 28);
    g.textAlign = 'left'; g.font = `700 19px ${FONT}`; g.fillStyle = '#315542';
    g.fillText(`${nameOf(pi)} · ${inputLabel(pi)}`, X + 86, Y + 28);
    const bx = X + 14, by = Y + 56, bw = W - 180, age = T() - p.lastPowT, sAge = T() - p.lastSpeedT;
    g.fillStyle = '#e5e8d7'; rr(g, bx, by, bw, 12, 6); g.fill();
    if (age < 2.5) {
      g.globalAlpha = age < 1.5 ? 1 : clamp(2.5 - age, 0, 1);
      g.fillStyle = p.lastPow < 0.25 ? '#9880b5' : p.lastPow > 0.7 ? '#da8257' : '#6c9770';
      rr(g, bx, by, Math.max(12, bw * p.lastPow), 12, 6); g.fill();
      g.fillStyle = '#315542'; g.font = `700 17px ${FONT}`; g.fillText(`${powLabel(p.lastPow)} · ${spinLabel(p.lastSpin)}`, bx + bw + 14, by + 6);
      g.globalAlpha = 1;
    }
    if (sAge < 2.5) {   // 방금 친 공의 속도 (중계 화면처럼)
      g.globalAlpha = sAge < 1.5 ? 1 : clamp(2.5 - sAge, 0, 1);
      g.textAlign = 'right'; g.font = `800 19px ${FONT}`; g.fillStyle = '#6f8072';
      g.fillText(`${Math.round(p.lastSpeed)} km/h`, X + W - 16, Y + 28);
      g.globalAlpha = 1;
    }
  }
}
function drawMsg(g) {
  const m = game.msg; if (!m) return;
  const age = T() - m.t; if (age > 1.7) return;
  const sc = age < 0.15 ? lerp(1.4, 1, age / 0.15) : 1, alpha = age > 1.25 ? 1 - (age - 1.25) / 0.45 : 1;
  g.save(); g.globalAlpha = clamp(alpha, 0, 1); g.translate(VW / 2, VH * 0.43); g.scale(sc, sc);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = `900 110px ${FONT}`; outlined(g, m.text, 0, 0, m.color, 14);
  if (m.sub) { g.font = `800 50px ${FONT}`; outlined(g, m.sub, 0, 96, '#fff', 9); }
  g.restore();
}
function drawToast(g) {
  const tt = gfx.toast; if (!tt) return;
  const age = realNow() - tt.t; if (age > 4) { gfx.toast = null; return; }
  g.font = `700 24px ${FONT}`;
  pill(g, tt.text, VW / 2, VH - 160, '#fde68a', age > 3.4 ? clamp((4 - age) / 0.6, 0, 1) : 1);
}
function drawHUD(g) {
  if (game.demo || game.state === 'select') return;
  const t = T();
  if (game.state !== 'matchEnd') { drawScoreboard(g); drawCards(g); }
  if (game.state === 'serve' && !isCPU(game.server) && t - game.stateT > 0.45) {
    g.font = `800 30px ${FONT}`;
    pill(g, `${nameOf(game.server)} 서브 · 휘둘러 시작하세요`, VW / 2, 169, '#fff9e8', 0.9 + 0.1 * Math.sin(t * 4));
  } else if (game.state === 'rally' && game.rally >= 3) {
    g.font = `800 26px ${FONT}`;
    pill(g, `랠리 ${game.rally}`, VW / 2, 169, game.rally >= 8 ? '#f4d28c' : '#fff9e8', 1);
  }
  drawMsg(g);
  drawToast(g);
}
// 머리 위 이름표 · 판정 문구 (tag: 가상 좌표 + 1m당 픽셀 s)
function drawTag(g, p, tag, t) {
  if (game.demo) return;
  const label = game.state === 'select' ? slotLabel(p.i) : nameOf(p.i);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = `800 ${Math.round(clamp(0.2 * tag.s, 15, 30))}px ${FONT}`;
  const tw = g.measureText(label).width + 26, th = clamp(0.28 * tag.s, 26, 40);
  g.fillStyle = 'rgba(255,251,237,0.94)'; rr(g, tag.x - tw / 2, tag.y - th / 2, tw, th, th / 2); g.fill();
  g.fillStyle = '#214c38'; g.fillText(label, tag.x, tag.y + 1);
  g.lineWidth = 4; g.strokeStyle = 'rgba(22,54,43,0.75)';
  const fa = t - p.flashT;
  if (p.flash && fa < 0.9) {
    const fy = tag.y - 22 - fa * 18;
    g.globalAlpha = 1 - fa / 0.9;
    g.font = `900 ${Math.round(clamp(0.32 * tag.s, 24, 42))}px ${FONT}`;
    g.lineWidth = 6; g.strokeText(p.flash, tag.x, fy); g.fillStyle = '#fff'; g.fillText(p.flash, tag.x, fy);
    g.globalAlpha = 1;
  }
}
const isMoving = p => Math.hypot(p.tx - p.x, p.ty - p.y) > 0.08;

function currentBall(t) {
  if (game.state === 'select' || game.state === 'matchEnd') return null;
  if (game.state === 'serve') {   // 서브 전 공 튀기기
    const p = players[game.server];
    return { x: p.x + RACKET_SIDE[game.server] * 0.45, y: p.y + (game.server === 0 ? -0.15 : -0.25), z: Math.abs(Math.sin(t * 3.2)) * 1.0 };
  }
  return game.shot ? ballPos(game.shot, t) : null;
}

// 타이밍 가이드 표시 조건 (2D·3D 공용)
function guideInfo(t) {
  if (!settings.guide || game.demo || game.state !== 'rally') return null;
  const s = game.shot;
  if (!s || s.resolved || s.out || !s.reachable || s.miss || isCPU(s.receiver)) return null;
  const dtv = s.hit.t - t;
  if (dtv > 1.1 || dtv < -s.W) return null;
  return { x: s.hit.x, y: s.hit.y, r: 0.3 + Math.max(0, dtv) * 1.7, inWin: Math.abs(dtv) <= s.W, side: s.side, high: s.hit.z > 1.85, pi: s.receiver };
}
// 가이드 원 위에 어느 쪽으로 칠지 알려줌 (pt = 원 중심의 화면 좌표). P2는 카메라를 보고 서서 좌우가 반대
function drawSideCue(g, gi, pt) {
  if (!pt) return;
  const name = gi.high ? '스매시' : gi.side === 'bh' ? '백핸드' : '포핸드';
  const left = !gi.high && (gi.side === 'bh') === (gi.pi === 0);
  g.font = `800 22px ${FONT}`;
  pill(g, gi.high ? name : left ? `← ${name}` : `${name} →`, pt.x, pt.y - clamp(1.1 * pt.s, 40, 90), '#fff9e8', gi.inWin ? 1 : 0.85);
}

// ============================================================
// 2D 그리기 (가장 가벼운 모드 · WebGL이 안 될 때)
// ============================================================
const CAM = (() => {
  const p = { x: 0, y: -12, z: 8 }, t = { x: 0, y: 14, z: 0 };
  let fy = t.y - p.y, fz = t.z - p.z; const fl = Math.hypot(fy, fz); fy /= fl; fz /= fl;
  return { p, fy, fz, uy: -fz, uz: fy, F: 1405, CY: 402 };
})();
function proj(x, y, z) {
  const dx = x - CAM.p.x, dy = y - CAM.p.y, dz = z - CAM.p.z;
  const Y = dy * CAM.uy + dz * CAM.uz;
  const Z = Math.max(0.5, dy * CAM.fy + dz * CAM.fz);
  const s = CAM.F / Z;
  return { x: VW / 2 + dx * s, y: CAM.CY - Y * s, s };
}
const makeLayer = () => { const c = document.createElement('canvas'); c.width = VW; c.height = VH; return c; };
function poly(g, pts, fill) {
  g.beginPath();
  pts.forEach(([x, y, z = 0], i) => { const p = proj(x, y, z); i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y); });
  g.closePath(); g.fillStyle = fill; g.fill();
}
function groundLine(g, x1, y1, x2, y2, w = 0.06) {
  const n = 14; g.strokeStyle = '#fff7df'; g.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    const a = proj(lerp(x1, x2, i / n), lerp(y1, y2, i / n), 0), b = proj(lerp(x1, x2, (i + 1) / n), lerp(y1, y2, (i + 1) / n), 0);
    g.lineWidth = Math.max(1.3, w * (a.s + b.s) / 2);
    g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
  }
}
function buildCourt2D() {
  const c = makeLayer(), g = c.getContext('2d');
  const sky = g.createLinearGradient(0, 0, 0, VH);
  sky.addColorStop(0, '#cbdaf5'); sky.addColorStop(0.38, '#eee5f1'); sky.addColorStop(1, '#fff0d9');
  g.fillStyle = sky; g.fillRect(0, 0, VW, VH);
  g.fillStyle = '#fff4c9'; circ(g, 1490, 62, 40);
  g.fillStyle = 'rgba(255,255,242,0.55)';
  for (const [x, y, rx] of [[320, 60, 150], [1150, 29, 95], [1640, 102, 120]]) { g.beginPath(); g.ellipse(x, y, rx, 14, 0, 0, Math.PI * 2); g.fill(); }
  const rng = mulberry32(7), cols = ['#d7b274', '#f1e7d2', '#76988c', '#c88870', '#8d9a66', '#e3bd9c'];
  // 수목과 테라스는 한 번만 그려 두어 2D 모드도 가볍게 유지한다.
  for (let x = -80; x < VW + 100; x += 75) {
    const y = 155 + rng() * 20;
    g.fillStyle = '#65816a'; circ(g, x, y, 70 + rng() * 30);
    g.fillStyle = '#7f9979'; circ(g, x + 25, y - 26, 49 + rng() * 20);
  }
  for (let row = 0; row < 4; row++) {
    const y = 151 + row * 21;
    g.fillStyle = row % 2 ? '#d2c6e2' : '#e7dff1'; g.fillRect(0, y, VW, 22);
    g.fillStyle = 'rgba(92,92,59,0.17)'; g.fillRect(0, y + 19, VW, 3);
    for (let x = 22; x < VW; x += 22 + rng() * 20) {
      if (rng() < 0.25) continue;
      g.fillStyle = cols[(rng() * cols.length) | 0]; rr(g, x - 5, y + 6, 10, 12, 4); g.fill();
      g.fillStyle = ['#e8bb91', '#d09a74', '#8d614b'][(rng() * 3) | 0]; circ(g, x, y + 4, 4);
    }
  }
  poly(g, [[-40, C.len + 7, 0], [40, C.len + 7, 0], [40, C.len + 7, 2.6], [-40, C.len + 7, 2.6]], '#605788');
  const club = proj(0, C.len + 6.95, 1.4);
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `800 25px ${FONT}`; g.fillStyle = '#f6edd2';
  g.fillText('NOLJA  /  MONSTER RALLY', club.x, club.y);
  poly(g, [[-40, -9], [40, -9], [40, C.len + 7], [-40, C.len + 7]], '#91a27b');
  poly(g, [[-9, -6.1], [9, -6.1], [9, C.len + 6.1], [-9, C.len + 6.1]], '#b8a0cf');
  poly(g, [[-C.dblHalfW - 0.12, -0.12], [C.dblHalfW + 0.12, -0.12], [C.dblHalfW + 0.12, C.len + 0.12], [-C.dblHalfW - 0.12, C.len + 0.12]], '#e7d8b2');
  poly(g, [[-C.dblHalfW, 0], [C.dblHalfW, 0], [C.dblHalfW, C.len], [-C.dblHalfW, C.len]], '#427c75');
  for (let d = 0; d < C.len; d += C.len / 8) {
    if (Math.round(d / (C.len / 8)) % 2 === 0) poly(g, [[-C.dblHalfW, d], [C.dblHalfW, d], [C.dblHalfW, d + C.len / 8], [-C.dblHalfW, d + C.len / 8]], '#4c887d');
  }
  const L = (x1, y1, x2, y2) => groundLine(g, x1, y1, x2, y2);
  L(-C.dblHalfW, 0, C.dblHalfW, 0); L(-C.dblHalfW, C.len, C.dblHalfW, C.len);
  L(-C.dblHalfW, 0, -C.dblHalfW, C.len); L(C.dblHalfW, 0, C.dblHalfW, C.len);
  L(-C.halfW, 0, -C.halfW, C.len); L(C.halfW, 0, C.halfW, C.len);
  L(-C.halfW, C.net - C.svc, C.halfW, C.net - C.svc); L(-C.halfW, C.net + C.svc, C.halfW, C.net + C.svc);
  L(0, C.net - C.svc, 0, C.net + C.svc);
  L(0, 0, 0, 0.3); L(0, C.len, 0, C.len - 0.3);
  return c;
}
function buildNet2D() {
  const c = makeLayer(), g = c.getContext('2d');
  const px = C.dblHalfW + 0.914, ph = 1.07, ch = C.netH;
  const topZ = x => lerp(ch, ph, Math.abs(x) / px);
  poly(g, [[-px, C.net + 0.05], [px, C.net + 0.05], [px, C.net + 0.7], [-px, C.net + 0.7]], 'rgba(0,0,0,0.16)');
  g.beginPath();
  [[-px, 0], [px, 0], [px, ph], [0, ch], [-px, ph]].forEach(([x, z], i) => { const p = proj(x, C.net, z); i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y); });
  g.closePath(); g.fillStyle = 'rgba(21,47,33,0.38)'; g.fill();
  g.strokeStyle = 'rgba(255,247,223,0.34)'; g.lineWidth = 1;
  for (let x = -px; x <= px + 1e-6; x += 0.3) { const a = proj(x, C.net, 0), b = proj(x, C.net, topZ(x)); g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke(); }
  for (let z = 0.12; z < ph; z += 0.12) {
    g.beginPath(); let pen = false;
    for (let x = -px; x <= px + 1e-6; x += 0.25) {
      if (z > topZ(x)) { pen = false; continue; }
      const p = proj(x, C.net, z); pen ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y); pen = true;
    }
    g.stroke();
  }
  g.strokeStyle = '#fff7df'; g.lineWidth = 5; g.beginPath();
  [[-px, ph], [0, ch], [px, ph]].forEach(([x, z], i) => { const p = proj(x, C.net, z); i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y); });
  g.stroke();
  g.strokeStyle = '#244b38'; g.lineWidth = 7;
  for (const x of [-px, px]) { const a = proj(x, C.net, 0), b = proj(x, C.net, ph + 0.06); g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke(); }
  return c;
}
let bgLayer = null, netLayer = null;

function groundShadow(g, x, y, r, a) {
  const p = proj(x, y, 0);
  g.fillStyle = `rgba(0,0,0,${a})`; g.beginPath(); g.ellipse(p.x, p.y, r * p.s, r * p.s * 0.38, 0, 0, Math.PI * 2); g.fill();
}

function drawPlayer2D(g, p) {
  const t = T(), ch = charOf(p.i);
  const front = p.i === 1 || game.state === 'select' || game.state === 'matchEnd';   // 카메라를 바라봄
  const hand = front ? -1 : 1;            // 화면에서 라켓 손 방향
  const moving = isMoving(p);
  const won = game.state === 'matchEnd' && p.i === game.winner;
  const bob = won ? Math.abs(Math.sin(t * 6.5)) * 0.3 : moving ? Math.abs(Math.sin(t * 13)) * 0.06 : 0;
  const foot = proj(p.x, p.y, 0), s = foot.s * ch.h;
  const sh = proj(p.x, p.y, (0.9 + bob) * ch.h), top = proj(p.x, p.y, (1.78 + bob) * ch.h), bottom = proj(p.x, p.y, bob * ch.h);
  const skin = ch.skin, accent = COLORS[p.i];
  NC.drawMonster2D(g, ch, foot.x, top.y, Math.max(1, bottom.y - top.y), front);
  g.lineCap = 'round'; g.lineJoin = 'round';
  const shY = sh.y + 0.03 * s;
  g.strokeStyle = skin; g.lineWidth = 0.16 * s;
  g.beginPath(); g.moveTo(sh.x - hand * 0.25 * s, shY); g.lineTo(sh.x - hand * 0.36 * s, shY + (won ? -0.22 : 0.16) * s); g.stroke();
  const k = (t - p.swingT) / SWING_DUR, swinging = k >= 0 && k < 1;
  const prep = !swinging && prepFor(p, t);
  const side = hand * ((swinging ? p.anim === 'backhand' : prep && prep.anim === 'backhand') ? -1 : 1);   // 백핸드는 몸 반대쪽으로
  const a = swinging ? lerp(-1.3, 1.95, p.swingLive ? k : 1 - Math.pow(1 - k, 3)) : won ? -1.4 : 0.3;
  const shX = sh.x + hand * 0.26 * s;
  const tilt = swinging ? (k - 0.5) * 0.3 * (p.swingSpin || 0) : 0;   // 탑스핀은 아래→위, 슬라이스는 위→아래
  const hx = shX + side * Math.cos(a) * 0.33 * s, hy = shY + (0.18 - Math.sin(a) * 0.06 - tilt) * s - (won ? 0.4 * s : 0);
  g.beginPath(); g.moveTo(shX, shY); g.lineTo(hx, hy); g.stroke();
  if (swinging) {
    g.strokeStyle = `rgba(255,255,255,${0.35 * (1 - k)})`; g.lineWidth = 0.12 * s; g.beginPath();
    for (let j = 0; j <= 10; j++) { const aa = lerp(-1.3, a, j / 10), x = shX + side * Math.cos(aa) * 0.9 * s, y = shY + (0.05 - Math.sin(aa) * 0.1) * s; j ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.stroke();
  }
  let ux = side * Math.cos(a + 0.6), uy = -0.8; const ul = Math.hypot(ux, uy); ux /= ul; uy /= ul;
  g.strokeStyle = '#1f2937'; g.lineWidth = 0.045 * s;
  g.beginPath(); g.moveTo(hx, hy); g.lineTo(hx + ux * 0.3 * s, hy + uy * 0.3 * s); g.stroke();
  g.save(); g.translate(hx + ux * 0.5 * s, hy + uy * 0.5 * s); g.rotate(Math.atan2(uy, ux) + Math.PI / 2);
  g.fillStyle = 'rgba(255,255,255,0.28)'; g.strokeStyle = accent; g.lineWidth = 0.04 * s;
  g.beginPath(); g.ellipse(0, 0, 0.12 * s, 0.16 * s, 0, 0, Math.PI * 2); g.fill(); g.stroke();
  g.restore();
  drawTag(g, p, proj(p.x, p.y, (1.92 + bob) * ch.h), t);
}

function drawBall2D(g, b) {
  const s = game.state === 'serve' ? null : game.shot;
  if (s && s.trail.length > 1) {
    const n = s.trail.length;
    for (let i = 0; i < n; i++) {
      const q = s.trail[i], pp = proj(q.x, q.y, q.z), k = i / n;
      g.globalAlpha = k * (s.special ? 0.6 : 0.22);
      g.fillStyle = s.special ? (i % 2 ? '#f97316' : '#facc15') : '#e8ff3d';
      g.beginPath(); g.arc(pp.x, pp.y, Math.max(3, 0.1 * pp.s) * (s.special ? 1.5 : 1) * (0.4 + 0.6 * k), 0, Math.PI * 2); g.fill();
    }
    g.globalAlpha = 1;
  }
  const p = proj(b.x, b.y, b.z), r = Math.max(5, 0.1 * p.s);
  if (s && s.special) { g.fillStyle = 'rgba(249,115,22,0.35)'; g.beginPath(); g.arc(p.x, p.y, r * 2.3, 0, Math.PI * 2); g.fill(); }
  g.fillStyle = '#e8ff3d'; g.beginPath(); g.arc(p.x, p.y, r, 0, Math.PI * 2); g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.75)'; g.lineWidth = Math.max(1, r * 0.2);
  g.beginPath(); g.arc(p.x + r * 0.35, p.y, r * 0.7, Math.PI * 0.6, Math.PI * 1.4); g.stroke();
}
function drawGuide2D(g) {
  const gi = guideInfo(T()); if (!gi) return;
  const p = proj(gi.x, gi.y, 0);
  const ring = (rad, color, w) => { g.strokeStyle = color; g.lineWidth = w; g.beginPath(); g.ellipse(p.x, p.y, rad * p.s, rad * p.s * 0.38, 0, 0, Math.PI * 2); g.stroke(); };
  ring(0.3, 'rgba(255,255,255,0.4)', 3);
  ring(gi.r, gi.inWin ? '#4ade80' : 'rgba(255,255,255,0.9)', 4);
}
function drawParticles2D(g) {
  for (const q of parts) {
    const k = 1 - q.life / q.max, p = proj(q.x, q.y, q.z);
    if (q.kind === 'dust') {
      g.strokeStyle = `rgba(255,255,255,${0.5 * k})`; g.lineWidth = 2; g.beginPath();
      g.ellipse(p.x, p.y, (0.1 + (1 - k) * 0.5) * p.s, (0.04 + (1 - k) * 0.19) * p.s, 0, 0, Math.PI * 2); g.stroke();
    } else {
      g.globalAlpha = k; g.fillStyle = q.color; g.beginPath(); g.arc(p.x, p.y, Math.max(2, q.r * p.s), 0, Math.PI * 2); g.fill(); g.globalAlpha = 1;
    }
  }
}

function render2D() {
  if (!bgLayer) { bgLayer = buildCourt2D(); netLayer = buildNet2D(); }
  const g = hctx, t = T();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.fillStyle = '#abc4b5'; g.fillRect(0, 0, hud.width, hud.height);
  if (game.state === 'select') {
    const cover = Math.max(hud.width / VW, hud.height / VH);
    g.drawImage(bgLayer, (hud.width - VW * cover) / 2, (hud.height - VH * cover) / 2, VW * cover, VH * cover);
    const framing = G3.selectFraming || { height: 0.42, center: 0.53 };
    const size = Math.min(hud.height * framing.height * 0.94, hud.width * 0.46);
    const y = hud.height * framing.center - size / 2;
    for (const i of [0, 1]) {
      const x = hud.width * (i === 0 ? 0.29 : 0.71);
      g.fillStyle = '#4f42631c'; g.beginPath(); g.ellipse(x, y + size * 0.94, size * 0.24, size * 0.04, 0, 0, Math.PI * 2); g.fill();
      NC.drawMonster2D(g, charOf(i), x, y, size, true);
    }
    return;
  }
  const sx = game.shake > 0 && demoPauseAt === null ? (Math.random() - 0.5) * 14 * game.shake : 0;
  const sy = game.shake > 0 && demoPauseAt === null ? (Math.random() - 0.5) * 10 * game.shake : 0;
  g.setTransform(view.k, 0, 0, view.k, view.ox + sx * view.k, view.oy + sy * view.k);
  g.drawImage(bgLayer, 0, 0);
  const bp = currentBall(t);
  for (const p of players) groundShadow(g, p.x, p.y, 0.3 * charOf(p.i).w, 0.32);
  if (bp) groundShadow(g, bp.x, bp.y, 0.12, clamp(0.45 - bp.z * 0.07, 0.1, 0.45));
  drawGuide2D(g);
  const items = [{ y: C.net, f: () => g.drawImage(netLayer, 0, 0) }];
  for (const p of players) items.push({ y: p.y, f: () => drawPlayer2D(g, p) });
  if (bp) items.push({ y: bp.y - 0.01, f: () => drawBall2D(g, bp) });
  items.sort((a, b) => b.y - a.y);
  for (const it of items) it.f();
  drawParticles2D(g);
  const gi = guideInfo(t);
  if (gi) drawSideCue(g, gi, proj(gi.x, gi.y, 0));
  drawHUD(g);
}

// ============================================================
// 3D 그리기 (three.js)
//  - 캐릭터는 공용 모듈(단순 도형 조합), 코트 선은 텍스처 한 장, 관중은 그림 한 장
//  - 렌더 해상도 상한 1080p, 실시간 그림자는 '높음'에서만
// ============================================================
const G3 = { available: typeof THREE !== 'undefined', built: false, renderer: null, aa: null, lost: false,
  scene: null, camera: null, sun: null, stands: null, players: [], info: { calls: 0, tris: 0 }, focal: 1000, sway: 0, lastT: 0, camSnap: true };
let K3 = null;   // three.js 임시 객체 (THREE가 있을 때만 생성)
function k3() {
  if (K3) return K3;
  K3 = { v: new THREE.Vector3(), w: new THREE.Vector3(), fwd: new THREE.Vector3(0, 0, -1), col: new THREE.Color(),
    camPos: new THREE.Vector3(0, 8, 12), camLook: new THREE.Vector3(0, 0, -7.1), tgtPos: new THREE.Vector3(), tgtLook: new THREE.Vector3(),
    cBall: new THREE.Color(0xe8ff3d), cOrange: new THREE.Color(0xf97316), cYellow: new THREE.Color(0xfacc15) };
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
  canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); G3.lost = true; });
  canvas.addEventListener('webglcontextrestored', () => { G3.lost = false; });
  if (G3.courtTex) { G3.courtTex.anisotropy = Math.min(8, r.capabilities.getMaxAnisotropy()); G3.courtTex.needsUpdate = true; }
  return true;
}

function applyShadows(on) {
  for (const pl of G3.players) { pl.blob.visible = !on; for (const m of pl.cast) m.castShadow = on; }
  const r = G3.renderer;
  if (!r) return;
  if (r.shadowMap.enabled !== on) {
    r.shadowMap.enabled = on; r.shadowMap.type = THREE.PCFSoftShadowMap;
    G3.scene.traverse(o => { if (o.material) o.material.needsUpdate = true; });
  }
  G3.sun.castShadow = on;
}

function ensureScene3D() {
  if (G3.built || !G3.available) return;
  G3.built = true;
  k3();
  const Sc = new THREE.Scene(); G3.scene = Sc;
  Sc.background = canvasTex(4, 256, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, '#cbdaf5'); gr.addColorStop(0.58, '#eee5f1'); gr.addColorStop(1, '#fff0d9');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  });
  Sc.fog = new THREE.Fog(0xf0e6e0, 48, 130);
  G3.camera = new THREE.PerspectiveCamera(42, 16 / 9, 0.3, 260);
  // 따뜻한 낮빛과 부드러운 보조광. 동적 조명 수는 기존과 동일하다.
  Sc.add(new THREE.HemisphereLight(0xf8f5dc, 0x60734d, 0.88));
  const sun = new THREE.DirectionalLight(0xffedc5, 0.6);
  sun.position.set(-7, 22, 6); sun.target.position.set(0, 0, -12);
  Sc.add(sun, sun.target);
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -15, right: 15, top: 24, bottom: -24, near: 2, far: 75 });
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.02;
  G3.sun = sun;
  const fill = new THREE.DirectionalLight(0xf6f2dd, 0.28);
  fill.position.set(0, 6, 16); fill.target.position.set(0, 1, -4);
  Sc.add(fill, fill.target);
  // 바닥 · 코트
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(160, 160), lam(0xb0c3a5));
  ground.rotation.x = -Math.PI / 2; ground.position.set(0, -0.02, -12); ground.receiveShadow = true; Sc.add(ground);
  G3.courtTex = buildCourtTex();
  const court = new THREE.Mesh(new THREE.PlaneGeometry(18, 36), lam(0xffffff, { map: G3.courtTex }));
  court.rotation.x = -Math.PI / 2; court.position.set(0, 0, -C.net); court.receiveShadow = true; Sc.add(court);
  buildNet3D(Sc);
  buildStadium3D(Sc);
  G3.players = [buildPlayer3D(0), buildPlayer3D(1)];
  for (const pl of G3.players) Sc.add(pl.root, pl.blob, pl.swoosh);
  buildBall3D(Sc);
  buildFx3D(Sc);
}

// 코트 텍스처: 18m x 36m 판에 선을 그림 (윗변 = 먼 쪽)
function buildCourtTex() {
  const W = 1024, H = 2048, ppm = W / 18, d1 = C.net + 18;
  const X = x => (x + 9) * ppm, Y = d => (d1 - d) * ppm;
  return canvasTex(W, H, g => {
    g.fillStyle = '#b8a0cf'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#e5d4ad'; g.fillRect(X(-C.dblHalfW - 0.12), Y(C.len + 0.12), (2 * C.dblHalfW + 0.24) * ppm, (C.len + 0.24) * ppm);
    g.fillStyle = '#427c75'; g.fillRect(X(-C.dblHalfW), Y(C.len), 2 * C.dblHalfW * ppm, C.len * ppm);
    for (let band = 0; band < 8; band += 2) {
      g.fillStyle = '#4c887d'; g.fillRect(X(-C.dblHalfW), Y((band + 1) * C.len / 8), 2 * C.dblHalfW * ppm, C.len / 8 * ppm);
    }
    // 코트 밖 클럽 이름도 같은 텍스처에 담아 추가 메시를 만들지 않는다.
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = 'rgba(255,247,223,0.66)'; g.font = `700 25px ${FONT}`;
    g.fillText('N O L J A   M O N S T E R   R A L L Y', W / 2, Y(-3.25));
    g.save(); g.translate(W / 2, Y(C.len + 3.25)); g.rotate(Math.PI); g.fillText('N O L J A   M O N S T E R   R A L L Y', 0, 0); g.restore();
    const rng = mulberry32(3);   // 표면 질감 (아주 옅은 점)
    for (let i = 0; i < 9000; i++) { g.fillStyle = rng() < 0.5 ? 'rgba(255,255,255,0.025)' : 'rgba(0,0,0,0.035)'; g.fillRect(rng() * W, rng() * H, 2, 2); }
    const lw = Math.max(3, 0.065 * ppm);
    g.fillStyle = '#fff7df';
    const hl = (x1, x2, d, w = lw) => g.fillRect(X(x1) - w / 2, Y(d) - w / 2, (x2 - x1) * ppm + w, w);
    const vl = (x, da, db, w = lw) => g.fillRect(X(x) - w / 2, Y(db) - w / 2, w, (db - da) * ppm + w);
    hl(-C.dblHalfW, C.dblHalfW, 0, lw * 1.5); hl(-C.dblHalfW, C.dblHalfW, C.len, lw * 1.5);
    vl(-C.dblHalfW, 0, C.len); vl(C.dblHalfW, 0, C.len); vl(-C.halfW, 0, C.len); vl(C.halfW, 0, C.len);
    hl(-C.halfW, C.halfW, C.net - C.svc); hl(-C.halfW, C.halfW, C.net + C.svc);
    vl(0, C.net - C.svc, C.net + C.svc); vl(0, 0, 0.3); vl(0, C.len - 0.3, C.len);
  });
}

function beam(a, b, t, mat) {
  const d = new THREE.Vector3().subVectors(b, a), len = d.length();
  const m = new THREE.Mesh(new THREE.BoxGeometry(len, t, t * 0.6), mat);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), d.normalize());
  return m;
}
function buildNet3D(Sc) {
  const px = C.dblHalfW + 0.914, ph = 1.07;
  const netTex = canvasTex(64, 64, (g, w, h) => {
    g.fillStyle = 'rgba(22,44,28,0.46)'; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,247,223,0.58)'; g.fillRect(0, 0, w, 6); g.fillRect(0, 0, 6, h);
  });
  netTex.wrapS = netTex.wrapT = THREE.RepeatWrapping; netTex.repeat.set(2 * px / 0.12, ph / 0.12);
  const geo = new THREE.PlaneGeometry(2 * px, ph, 24, 1);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setY(i, pos.getY(i) > 0 ? lerp(C.netH, ph, Math.abs(pos.getX(i)) / px) : 0);   // 가운데가 처진 네트
  pos.needsUpdate = true; geo.computeBoundingSphere();
  const net = new THREE.Mesh(geo, basic(0xffffff, { map: netTex, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
  net.position.z = -C.net; Sc.add(net);
  const tape = lam(0xfff7df);
  for (const sx of [-1, 1]) Sc.add(beam(new THREE.Vector3(sx * px, ph, -C.net), new THREE.Vector3(0, C.netH, -C.net), 0.055, tape));
  const postMat = lam(0x244b38), postGeo = new THREE.CylinderGeometry(0.05, 0.05, ph + 0.08, 10);
  for (const sx of [-1, 1]) { const p = new THREE.Mesh(postGeo, postMat); p.position.set(sx * px, (ph + 0.08) / 2, -C.net); p.castShadow = true; Sc.add(p); }
  const strap = new THREE.Mesh(new THREE.PlaneGeometry(0.05, C.netH), basic(0xfff7df)); strap.position.set(0, C.netH / 2, -C.net + 0.01); Sc.add(strap);
  const sh = new THREE.Mesh(new THREE.PlaneGeometry(2 * px, 0.7), basic(0x000000, { transparent: true, opacity: 0.16, depthWrite: false }));
  sh.rotation.x = -Math.PI / 2; sh.position.set(0, 0.006, -(C.net + 0.4)); Sc.add(sh);
}

function buildStadium3D(Sc) {
  // 둥근 나무 실루엣은 투명 텍스처 세 장으로 표현한다.
  const treeTex = canvasTex(1024, 256, (g, w, h) => {
    const rng = mulberry32(21);
    for (let x = -40; x < w + 50; x += 38) {
      const y = 100 + rng() * 48, r = 45 + rng() * 32;
      g.fillStyle = '#506e50'; g.fillRect(x - 4, y + r * 0.5, 8, h);
      g.fillStyle = ['#8bb6a2', '#b4c697', '#89aa9c', '#b8accd'][(rng() * 4) | 0];
      g.beginPath(); g.ellipse(x, y, r * 0.78, r, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(209,220,161,0.16)'; g.beginPath(); g.ellipse(x - r * 0.15, y - r * 0.22, r * 0.48, r * 0.62, -0.3, 0, Math.PI * 2); g.fill();
    }
  });
  const treesMat = basic(0xffffff, { map: treeTex, transparent: true, alphaTest: 0.05, side: THREE.DoubleSide });
  const backTrees = new THREE.Mesh(new THREE.PlaneGeometry(105, 23), treesMat);
  backTrees.position.set(0, 10, -(C.len + 24)); Sc.add(backTrees);
  for (const sx of [-1, 1]) {
    const trees = new THREE.Mesh(new THREE.PlaneGeometry(70, 22), treesMat);
    trees.rotation.y = sx * Math.PI / 2; trees.position.set(sx * 29, 9, -13); Sc.add(trees);
  }
  const crowd = canvasTex(1024, 512, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#e7dff1'); gr.addColorStop(1, '#bcb4cf');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    const rows = 10, rh = h / rows;
    for (let r = 0; r < rows; r++) {
      g.fillStyle = 'rgba(73,73,40,0.16)'; g.fillRect(0, r * rh + rh * 0.84, w, rh * 0.16);
      g.fillStyle = 'rgba(255,248,220,0.23)'; g.fillRect(0, r * rh, w, 3);
    }
    const rng = mulberry32(7), cols = ['#d7b274', '#f1e7d2', '#76988c', '#c88870', '#8d9a66', '#e3bd9c', '#8bafae'];
    const skins = ['#f1c9a5', '#e3b086', '#8d5524', '#f7d7bd'];
    for (let r = 0; r < rows; r++) for (let x = 12; x < w; x += rng() * 18 + 20) {
      if (rng() < 0.25) continue;
      const cy = r * rh + rh * 0.5 + (rng() - 0.5) * 6, rad = 5 + rng() * 2.5;
      g.fillStyle = cols[(rng() * cols.length) | 0]; rr(g, x - rad, cy - rad * 0.2, rad * 2, rad * 1.8, rad * 0.5); g.fill();
      g.fillStyle = skins[(rng() * skins.length) | 0]; circ(g, x, cy - rad * 0.6, rad * 0.75);
    }
  });
  const crowdMat = rep => { const t = crowd.clone(); t.wrapS = THREE.RepeatWrapping; t.repeat.set(rep, 1); t.needsUpdate = true; return basic(0xffffff, { map: t }); };
  const stands = new THREE.Group(); Sc.add(stands); G3.stands = stands;
  const back = new THREE.Mesh(new THREE.PlaneGeometry(80, 9), crowdMat(5));
  back.rotation.x = -0.82; back.position.set(0, 3.4, -(C.len + 13)); stands.add(back);
  for (const sx of [-1, 1]) {
    const side = new THREE.Mesh(new THREE.PlaneGeometry(56, 9), crowdMat(3.5));
    side.rotation.order = 'YXZ'; side.rotation.y = sx < 0 ? Math.PI / 2 : -Math.PI / 2; side.rotation.x = -0.82;
    side.position.set(sx * 18.5, 3.4, -14); stands.add(side);
  }
  // 광고판
  const ad = canvasTex(512, 64, (g, w, h) => {
    g.fillStyle = '#605788'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#c4b987'; g.fillRect(0, h - 3, w, 3); g.fillRect(0, 0, w, 3);
    g.fillStyle = '#f6edd2'; g.font = `700 25px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('NOLJA  /  MONSTER RALLY', w / 2, h / 2);
  });
  const adMat = len => { const t = ad.clone(); t.wrapS = THREE.RepeatWrapping; t.repeat.set(len / 7, 1); t.needsUpdate = true; return basic(0xffffff, { map: t }); };
  const backAd = new THREE.Mesh(new THREE.PlaneGeometry(35, 1), adMat(35)); backAd.position.set(0, 0.5, -(C.len + 6.3)); Sc.add(backAd);
  for (const sx of [-1, 1]) {
    const a = new THREE.Mesh(new THREE.PlaneGeometry(42, 1), adMat(42));
    a.rotation.y = sx < 0 ? Math.PI / 2 : -Math.PI / 2; a.position.set(sx * 11.5, 0.5, -12); Sc.add(a);
  }
  // 낮 경기장의 조명과 이펙트용 빛 텍스처
  G3.glowTex = canvasTex(128, 128, (g, w, h) => {
    const rg = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    rg.addColorStop(0, 'rgba(255,250,225,1)'); rg.addColorStop(0.25, 'rgba(255,245,210,0.55)'); rg.addColorStop(1, 'rgba(255,240,200,0)');
    g.fillStyle = rg; g.fillRect(0, 0, w, h);
  });
  const poleMat = lam(0x365342), lampMat = lam(0xf1e4bf), poleGeo = new THREE.CylinderGeometry(0.12, 0.18, 15, 8), lampGeo = new THREE.BoxGeometry(2.2, 0.6, 0.3);
  for (const [x, d] of [[-17, 35], [17, 35], [-21, 18], [21, 18]]) {
    const pole = new THREE.Mesh(poleGeo, poleMat); pole.position.set(x, 7.5, -d); Sc.add(pole);
    const lamp = new THREE.Mesh(lampGeo, lampMat); lamp.position.set(x, 15, -d); lamp.lookAt(0, 0, -12); Sc.add(lamp);
  }
}

// ---------- 3D 캐릭터 (공용 모델 + 테니스 전용 스윙 궤적) ----------
const SWING_DUR = 0.3;
function buildPlayer3D(i) {
  const rig = NC.build3D(charOf(i), COLORS[i], { racket: true });
  const N2 = 18, sg = new THREE.BufferGeometry();   // 스윙 궤적 리본
  sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N2 * 6), 3));
  const idx = []; for (let k = 0; k < N2 - 1; k++) { const a = 2 * k; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  sg.setIndex(idx);
  const swoosh = new THREE.Mesh(sg, basic(0xffffff, { transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }));
  swoosh.frustumCulled = false; swoosh.visible = false;
  const baseDispose = rig.dispose;
  return Object.assign(rig, { swoosh, N: N2, hist: [], dispose() { baseDispose(); sg.dispose(); swoosh.material.dispose(); } });
}
function rebuildPlayer3D(i) {
  if (!G3.built) return;
  const old = G3.players[i];
  if (old) { G3.scene.remove(old.root, old.blob, old.swoosh); old.dispose(); }
  const pl = buildPlayer3D(i);
  G3.players[i] = pl; G3.scene.add(pl.root, pl.blob, pl.swoosh);
  const on = !!(G3.renderer && G3.renderer.shadowMap.enabled);
  pl.blob.visible = !on; for (const m of pl.cast) m.castShadow = on;
  pl.popT = T();
}

// 테니스 스윙 자세 (상체 기준 방향 벡터). sp: 탑스핀이면 아래→위로, 슬라이스면 위→아래로 휘두름
// linear: 조이콘이 실제로 돈 각도를 따라갈 땐 따로 감속을 넣지 않음 (진짜 팔 움직임에 이미 들어 있음)
function swingPose(anim, k, sp = 0, linear = false) {
  const e = linear ? clamp(k, 0, 1) : 1 - Math.pow(1 - clamp(k, 0, 1), 3), nrm = NC.nrm;
  if (anim === 'serve' || anim === 'smash') {      // 머리 위로 내려치기
    const b = lerp(-0.8, 2.5, e);
    const dR = nrm(0.3, Math.cos(b), -Math.sin(b));
    return { dR, dL: nrm(-0.25, lerp(0.7, -0.75, e), -0.45), r: nrm(dR.x, dR.y + 0.15, dR.z - 0.15), n: new THREE.Vector3(0, -Math.sin(b), -Math.cos(b)), twist: lerp(-0.4, 0.5, e), lean: 0, nod: 0 };
  }
  // 라켓 면: 탑스핀은 살짝 덮고, 슬라이스는 열어서 받침
  const lift = 0.35 + Math.max(0, -sp) * 0.3;
  if (anim === 'backhand') {   // 한 손 백핸드: 왼쪽 뒤로 뺐다가 몸 앞을 지나 오른쪽 위로 (몸 기준 방향 → 꼬인 상체 기준으로 바꿈)
    const f = lerp(2.22, 5.18, e), tw = lerp(0.6, -0.3, e), c = Math.cos(tw), s = Math.sin(tw);
    const E = lerp(-0.2 - 0.35 * sp, -0.2 + 0.45 * sp, e) + 0.3 * Math.sin(k * Math.PI);
    const wx = Math.cos(f) * Math.cos(E), wz = Math.sin(f) * Math.cos(E), vx = -Math.sin(f), vz = Math.cos(f);
    const dR = new THREE.Vector3(wx * c - wz * s, Math.sin(E), wx * s + wz * c);
    return { dR, dL: nrm(lerp(-0.25, -0.7, e), lerp(-0.25, -0.5, e), lerp(-0.6, 0.4, e)), r: nrm(dR.x, dR.y + lift, dR.z), n: nrm(vx * c - vz * s, -0.3 * sp, vx * s + vz * c), twist: tw, lean: 0, nod: 0 };
  }
  const a = lerp(-1.5, 1.9, e);                     // 포핸드: 뒤 → 앞으로 크게
  const E = lerp(-0.25 - 0.35 * sp, -0.25 + 0.45 * sp, e) + 0.3 * Math.sin(k * Math.PI);
  const dR = new THREE.Vector3(Math.cos(a) * Math.cos(E), Math.sin(E), -Math.sin(a) * Math.cos(E));
  return { dR, dL: nrm(lerp(-0.35, 0.05, e), -0.62, lerp(-0.55, -0.2, e)), r: nrm(dR.x, dR.y + lift, dR.z), n: nrm(-Math.sin(a), -0.3 * sp, -Math.cos(a)), twist: lerp(-0.7, 0.8, e), lean: 0, nod: 0 };
}
// 공이 나한테 오는 중이면 칠 때 0.95초 전부터 라켓을 그쪽(포핸드·백핸드·머리 위)으로 빼고 기다림
function prepFor(p, t) {
  const s = game.shot;
  if (game.state !== 'rally' || !s || s.receiver !== p.i || s.resolved || s.out || !s.reachable) return null;
  const u = smooth((0.95 - (s.hit.t - t)) / 0.5);
  return u > 0 ? { u, anim: s.hit.z > 1.85 ? 'smash' : s.side === 'bh' ? 'backhand' : 'drive' } : null;
}
function armPose(p, t, f) {
  const k = (t - p.swingT) / SWING_DUR;
  if (k >= 0 && k < 1) return swingPose(p.anim, k, p.swingSpin, p.swingLive);
  let base = NC.poses.ready();
  if (f.won) base = NC.poses.celebrate(t);
  else if (f.lost) base = NC.poses.sad();
  else if (f.ready) base = NC.poses.cheer(t);
  const prep = prepFor(p, t);
  if (prep) base = NC.mixPose(base, swingPose(prep.anim, 0), prep.u * 0.85);
  if (k >= 1 && k < 1.7) return NC.mixPose(swingPose(p.anim, 1, p.swingSpin, p.swingLive), base, smooth((k - 1) / 0.7));
  return base;
}

function syncPlayer3D(p, t) {
  const pl = G3.players[p.i]; if (!pl) return;
  const ch = pl.ch, st = game.state, SH = NC.shoulders();
  const faceCam = st === 'select' || st === 'matchEnd';
  const won = st === 'matchEnd' && p.i === game.winner, lost = st === 'matchEnd' && p.i !== game.winner;
  const ready = st === 'select' && sel[p.i].ready;
  const moving = isMoving(p), ph = t * 13;
  let lift = moving ? Math.abs(Math.sin(ph)) * 0.05 : 0;
  if (won) lift = Math.abs(Math.sin(t * 6.5)) * 0.32;
  else if (ready) lift = Math.abs(Math.sin(t * 5)) * 0.07;
  pl.root.position.set(p.x, lift, -p.y);
  pl.root.rotation.y = faceCam ? Math.PI : (p.i === 0 ? 0 : Math.PI);
  const pu = t - pl.popT, pop = pu >= 0 && pu < 0.8 ? 1 + 0.22 * Math.exp(-7 * pu) * Math.sin(18 * pu) : 1;
  pl.root.scale.set(ch.w * pop, ch.h * pop, ch.w * pop);
  const stride = moving ? Math.sin(ph) * 0.55 : 0;
  pl.legs[0].rotation.x = stride; pl.legs[1].rotation.x = -stride;
  const pose = armPose(p, t, { won, lost, ready });
  pl.torso.rotation.set(pose.lean || 0, pose.twist, 0);
  pl.head.rotation.x = pose.nod || 0;
  NC.placeLimb(pl.armR, SH.R, pose.dR);
  NC.placeLimb(pl.armL, SH.L, pose.dL);
  NC.placeProp(pl.prop, pose);
  pl.blob.position.set(p.x, 0.012, -p.y); pl.blob.scale.setScalar(ch.w);
  // 스윙 궤적 (라켓 끝이 지나간 자리)
  const k = (t - p.swingT) / SWING_DUR;
  pl.root.updateMatrixWorld(true);
  if (k >= 0 && k < 1) pl.hist.push({ tip: pl.prop.localToWorld(new THREE.Vector3(0, 0.55, 0)), thr: pl.prop.localToWorld(new THREE.Vector3(0, 0.24, 0)), t });
  while (pl.hist.length && (t - pl.hist[0].t > 0.11 || pl.hist.length > pl.N)) pl.hist.shift();
  const n = pl.hist.length;
  pl.swoosh.visible = n >= 2;
  if (n >= 2) {
    const arr = pl.swoosh.geometry.attributes.position.array;
    for (let j = 0; j < n; j++) { const h = pl.hist[j], o = j * 6; arr[o] = h.tip.x; arr[o + 1] = h.tip.y; arr[o + 2] = h.tip.z; arr[o + 3] = h.thr.x; arr[o + 4] = h.thr.y; arr[o + 5] = h.thr.z; }
    pl.swoosh.geometry.attributes.position.needsUpdate = true;
    pl.swoosh.geometry.setDrawRange(0, (n - 1) * 6);
    pl.swoosh.material.opacity = 0.42 * clamp(1 - k, 0, 1);
  }
}

// ---------- 공 · 효과 ----------
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
function buildBall3D(Sc) {
  G3.ball = new THREE.Mesh(new THREE.SphereGeometry(0.1, 16, 12), lam(0xe8ff3d, { emissive: 0x485500 }));
  Sc.add(G3.ball);
  G3.ballShadow = new THREE.Mesh(new THREE.CircleGeometry(0.13, 16), basic(0x000000, { transparent: true, opacity: 0.4, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 }));
  G3.ballShadow.rotation.x = -Math.PI / 2; Sc.add(G3.ballShadow);
  G3.ballGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: G3.glowTex, color: 0xfb923c, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  G3.ballGlow.visible = false; Sc.add(G3.ballGlow);
}
function buildFx3D(Sc) {
  G3.trail = makePoints(16, false); Sc.add(G3.trail);
  G3.sparks = makePoints(128, true); Sc.add(G3.sparks);
  const ringGeo = new THREE.RingGeometry(0.86, 1, 40);
  const ringMat = () => basic(0xffffff, { transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4 });
  G3.guideA = new THREE.Mesh(ringGeo, ringMat()); G3.guideB = new THREE.Mesh(ringGeo, ringMat());
  G3.dust = [];
  for (let k = 0; k < 8; k++) G3.dust.push(new THREE.Mesh(ringGeo, ringMat()));
  for (const r of [G3.guideA, G3.guideB, ...G3.dust]) { r.rotation.x = -Math.PI / 2; r.visible = false; Sc.add(r); }
}
function syncBall3D(bp) {
  const b = G3.ball, tr = G3.trail;
  if (!bp) { b.visible = G3.ballShadow.visible = G3.ballGlow.visible = false; tr.geometry.setDrawRange(0, 0); return; }
  b.visible = G3.ballShadow.visible = true;
  b.position.set(bp.x, Math.max(0, bp.z) + 0.07, -bp.y);
  // 멀리 있어도 잘 보이도록 최소 크기 보장
  const depth = Math.max(0.5, K3.v.copy(b.position).sub(G3.camera.position).dot(K3.fwd));
  const sc = clamp(4.5 / (0.1 * G3.focal / depth), 1, 2.6);
  b.scale.setScalar(sc);
  G3.ballShadow.position.set(bp.x, 0.013, -bp.y); G3.ballShadow.scale.setScalar(sc);
  G3.ballShadow.material.opacity = clamp(0.45 - bp.z * 0.07, 0.1, 0.45);
  const s = game.state === 'serve' ? null : game.shot;
  G3.ballGlow.visible = !!(s && s.special);
  if (G3.ballGlow.visible) { G3.ballGlow.position.copy(b.position); G3.ballGlow.scale.setScalar(0.9 * sc); }
  const ga = tr.geometry.attributes, pts = s ? s.trail : [], n = Math.min(pts.length, tr.userData.n);
  for (let j = 0; j < n; j++) {
    const q = pts[pts.length - n + j], kk = j / n, c = s.special ? (j % 2 ? K3.cOrange : K3.cYellow) : K3.cBall;
    ga.position.setXYZ(j, q.x, Math.max(0, q.z) + 0.07, -q.y);
    ga.aSize.setX(j, 0.2 * sc * (s.special ? 1.5 : 1) * (0.4 + 0.6 * kk));
    ga.aAlpha.setX(j, kk * (s.special ? 0.6 : 0.25));
    ga.aColor.setXYZ(j, c.r, c.g, c.b);
  }
  for (const key of ['position', 'aSize', 'aAlpha', 'aColor']) ga[key].needsUpdate = true;
  tr.geometry.setDrawRange(0, n);
  tr.material.uniforms.uScale.value = G3.focal;
}
function syncFx3D(t) {
  const gi = guideInfo(t);
  G3.guideA.visible = G3.guideB.visible = !!gi;
  if (gi) {
    G3.guideA.position.set(gi.x, 0.015, -gi.y); G3.guideA.scale.setScalar(0.3); G3.guideA.material.opacity = 0.45;
    G3.guideB.position.set(gi.x, 0.016, -gi.y); G3.guideB.scale.setScalar(gi.r);
    G3.guideB.material.color.set(gi.inWin ? 0x4ade80 : 0xffffff); G3.guideB.material.opacity = 0.95;
  }
  const sp = G3.sparks, ga = sp.geometry.attributes;
  let n = 0, dn = 0;
  for (const q of parts) {
    const k = 1 - q.life / q.max;
    if (q.kind === 'spark' && n < sp.userData.n) {
      ga.position.setXYZ(n, q.x, q.z, -q.y); ga.aSize.setX(n, q.r * 2); ga.aAlpha.setX(n, k);
      K3.col.set(q.color); ga.aColor.setXYZ(n, K3.col.r, K3.col.g, K3.col.b); n++;
    } else if (q.kind === 'dust' && dn < G3.dust.length) {
      const r = G3.dust[dn++]; r.visible = true; r.position.set(q.x, 0.014, -q.y); r.scale.setScalar(0.12 + (1 - k) * 0.55); r.material.opacity = 0.55 * k;
    }
  }
  for (let j = dn; j < G3.dust.length; j++) G3.dust[j].visible = false;
  for (const key of ['position', 'aSize', 'aAlpha', 'aColor']) ga[key].needsUpdate = true;
  sp.geometry.setDrawRange(0, n);
  sp.material.uniforms.uScale.value = G3.focal;
}

// 카메라: 경기 중엔 P1 뒤 높은 곳, 캐릭터 선택·시상 때는 가까이
function sync3D() {
  if (!G3.built) return;
  const t = T(), K = K3, cam = G3.camera;
  const dt = clamp(t - G3.lastT, 0, 0.1); G3.lastT = t;
  const bp = currentBall(t);
  G3.sway = lerp(G3.sway, bp ? clamp(bp.x, -4, 4) * 0.14 : 0, 1 - Math.exp(-dt * 2.5));
  const portraitDistance = clamp(1.2 / cam.aspect, 1, 2.6);
  if (game.state === 'select') {
    const framing = G3.selectFraming;
    if (framing) {
      const tan = Math.tan(cam.fov * Math.PI / 360);
      const distance = Math.max(4.9, 2.2 / (2 * tan * framing.height), 2 / (tan * cam.aspect));
      const lookY = 1.05 + (framing.center - 0.5) * 2 * distance * tan;
      K.tgtPos.set(0, lookY + 0.45, -2.2 + distance); K.tgtLook.set(0, lookY, -2.2);
    } else { K.tgtPos.set(0, 1.5, -2.2 + 4.9 * portraitDistance); K.tgtLook.set(0, 1.0, -2.2); }
  }
  else if (game.state === 'matchEnd') { K.tgtPos.set(0, 1.7, -2.3 + 6.7 * portraitDistance); K.tgtLook.set(0, 1.3, -2.3); }
  else if (game.demo) { K.tgtPos.set(2.6 + G3.sway * 0.45, 13.5, 15.8); K.tgtLook.set(0, 0, -10.5); }
  else { K.tgtPos.set(G3.sway, 8, 12); K.tgtLook.set(G3.sway * 1.2, 0, -7.1); }
  const f = G3.camSnap ? 1 : 1 - Math.exp(-dt * 4.5); G3.camSnap = false;
  K.camPos.lerp(K.tgtPos, f); K.camLook.lerp(K.tgtLook, f);
  cam.position.copy(K.camPos);
  const sh = game.shake;
  if (sh > 0) cam.position.add(K.v.set((Math.random() - 0.5) * 0.25 * sh, (Math.random() - 0.5) * 0.18 * sh, 0));
  cam.lookAt(K.camLook);
  cam.updateMatrixWorld();
  cam.getWorldDirection(K.fwd);
  for (const p of players) syncPlayer3D(p, t);
  syncBall3D(bp);
  syncFx3D(t);
  const ct = t - game.crowdT;   // 점수 나면 관중 들썩
  G3.stands.position.y = ct >= 0 && ct < 1.4 ? Math.abs(Math.sin(ct * 16)) * 0.18 * (1 - ct / 1.4) : 0;
}

// 3D 위치 → HUD 가상 좌표
function proj3(x, y, z) {
  const K = K3, cam = G3.camera;
  K.w.set(x, z, -y);
  const depth = K.v.copy(K.w).sub(cam.position).dot(K.fwd);
  if (depth < 0.3) return null;
  K.w.project(cam);
  const px = (K.w.x + 1) / 2 * hud.width, py = (1 - K.w.y) / 2 * hud.height;
  return { x: (px - view.ox) / view.k, y: (py - view.oy) / view.k, s: (hud.height / (2 * Math.tan(cam.fov * Math.PI / 360))) / depth / view.k };
}
function renderHUD3D() {
  const g = hctx, t = T();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, hud.width, hud.height);
  g.setTransform(view.k, 0, 0, view.k, view.ox, view.oy);
  if (G3.built) for (const p of players) {
    const pl = G3.players[p.i];
    const top = pl ? pl.root.position.y + 2.12 * pl.ch.h : 2.1;
    const tag = proj3(p.x, p.y, top);
    if (tag) drawTag(g, p, tag, t);
  }
  const gi = G3.built && guideInfo(t);
  if (gi) drawSideCue(g, gi, proj3(gi.x, gi.y, 0));
  drawHUD(g);
}

// ============================================================
// 시작
// ============================================================
function bindMenu() {
  document.querySelectorAll('#modeRow button').forEach(b => { b.onclick = () => { settings.mode = b.dataset.mode; assignJoyCons(); syncMenu(); saveSettings(); }; });
  document.querySelectorAll('#lvRow button').forEach(b => { b.onclick = () => { settings.cpuLevel = +b.dataset.lv; syncMenu(); saveSettings(); }; });
  document.querySelectorAll('#gwRow button').forEach(b => { b.onclick = () => { settings.gamesToWin = +b.dataset.gw; syncMenu(); saveSettings(); }; });
  document.querySelectorAll('#qRow button').forEach(b => {
    b.onclick = () => {
      settings.quality = b.dataset.q; saveSettings();
      gfx.locked = false; gfx.pending = null; gfx.note = '';
      applyQuality(settings.quality === 'auto' ? 'mid' : settings.quality);
      syncMenu();
    };
  });
  $('sens').oninput = e => { settings.sensitivity = +e.target.value; syncMenu(); saveSettings(); };
  $('lat').oninput = e => { settings.latencyMs = +e.target.value; syncMenu(); saveSettings(); };
  $('guide').onchange = e => { settings.guide = e.target.checked; saveSettings(); };
  for (const i of [0, 1]) $('lefty' + i).onchange = e => { settings.lefty[i] = e.target.checked; saveSettings(); };
  $('btnSwap').onclick = () => { JC.swapped = !JC.swapped; S.set('swapped', JC.swapped); assignJoyCons(); };
  $('btnStart').onclick = openSelect;
  $('btnHome').onclick = () => { location.href = '../../index.html'; };
  $('btnFull').onclick = toggleFull;
  $('btnResume').onclick = resume; $('btnQuit').onclick = toMenu;
  $('btnAgain').onclick = startMatch; $('btnReselect').onclick = openSelect; $('btnMenu').onclick = toMenu;
  $('btnSelBack').onclick = toMenu;
  document.querySelectorAll('#select [data-p]').forEach(b => {
    b.onclick = () => {
      const i = +b.dataset.p;
      if (b.dataset.d) selMove(i, +b.dataset.d, true); else selReady(i, !sel[i].ready);
    };
  });
  $('btnConnect').onclick = async () => {
    sfx.init();
    const r = await JC.connect();
    showWarn(r.error || '');
  };
  document.addEventListener('click', e => { if (e.detail > 0 && e.target && e.target.closest) { const b = e.target.closest('button'); if (b) b.blur(); } });
  window.addEventListener('pointerdown', () => sfx.init());
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
  window.addEventListener('resize', resize);
}

function renderFrame() {
  if (gfx.mode3d) {
    if (demoPauseAt === null || G3.camSnap) sync3D();
    if (G3.renderer && !G3.lost) {
      G3.renderer.render(G3.scene, G3.camera);
      G3.info.calls = G3.renderer.info.render.calls; G3.info.tris = G3.renderer.info.render.triangles;
    }
    renderHUD3D();
  } else render2D();
}
function frame() {
  const nowR = realNow(), dtR = gfx.lastReal ? nowR - gfx.lastReal : 0;
  gfx.lastReal = nowR;
  try { update(); renderFrame(); updateSlotMeters(); } catch (e) { console.error(e); }
  trackPerf(dtR);
  requestAnimationFrame(frame);
}

bindMenu();
applyQuality(settings.quality === 'auto' ? 'mid' : settings.quality);
syncMenu();
if (!JC.supported) showWarn('이 브라우저는 조이콘 직접 연결을 지원하지 않아요. PC의 크롬이나 엣지로 열어주세요. (키보드·게임패드는 사용 가능)');
else if (location.protocol === 'file:') showWarn('파일로 열면 조이콘 연결이 막혀요. 키보드 테스트는 OK — 조이콘은 인터넷 주소나 start-game.bat으로 열어주세요.');
assignJoyCons();
JC.start();
startServe();
requestAnimationFrame(frame);

// 테스트용 훅
window.__ST = { game, players, settings, T, update, render: renderFrame, startMatch, toMenu, openSelect, selMove, selReady, selSet, sel,
  doSwing, emitSwing, startServe, isCPU, ballPos, planShot, spinLabel, handSide, C, gfx, G3, Q, applyQuality, parts, CHARS, autoStep, joycon: JC, setDemoPaused,
  setClock: f => { realNow = f; } };
})();
