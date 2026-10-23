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
};
const KEYS = { mode: 'tennis.mode', cpuLevel: 'tennis.cpuLevel', gamesToWin: 'tennis.gamesToWin', guide: 'tennis.guide',
  sensitivity: 'sensitivity', latencyMs: 'latencyMs', quality: 'quality', chars: 'chars' };
if (!Array.isArray(settings.chars) || settings.chars.length !== 2 || settings.chars.some(k => !Number.isInteger(k) || k < 0 || k >= CHARS.length)) settings.chars = [0, 1];
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
let pauseOffset = 0, pausedAt = 0;
const T = () => (game.paused ? pausedAt : realNow()) - pauseOffset;

// ---------- 코트 (단위: m, x=좌우, y=깊이 0이 P1쪽 베이스라인, z=높이) ----------
const C = { halfW: 4.115, dblHalfW: 5.485, len: 23.77, net: 11.885, netH: 0.914, svc: 6.40, g: 9.8 };
const BASE = [-0.9, C.len + 0.9];              // 기본 서는 깊이
const BACK_LIMIT = [-2.2, C.len + 2.2];        // 최대로 물러나는 깊이
const RACKET_SIDE = [1, -1];                   // 오른손잡이: 공이 몸 오른쪽에 오도록 (월드 x 기준)

// ---------- 선수 ----------
function makePlayer(i) {
  return { i, x: 0, y: BASE[i], tx: 0, ty: BASE[i], speed: 5.6, swingT: -9, anim: 'drive', lastPow: 0, lastPowT: -9, flash: '', flashT: -9 };
}
const players = [makePlayer(0), makePlayer(1)];
const isCPU = i => game.demo || (game.forceCPU ? !!game.forceCPU[i] : (settings.mode === 'cpu' && i === 1));
const nameOf = i => charOf(i).name;
const slotLabel = i => (!game.demo && settings.mode === 'cpu' && i === 1) ? 'CPU' : (i === 0 ? 'P1' : 'P2');
const powLabel = p => p < 0.25 ? '살살' : p > 0.7 ? '세게' : '보통';

// ============================================================
// 공 궤적
// ============================================================
function ballPos(s, t) {
  const g = C.g;
  const dt = Math.max(0, t - s.t0);
  if (dt < s.T1) return { x: s.x0 + s.vx * dt, y: s.y0 + s.vy * dt, z: s.z0 + s.vz0 * dt - 0.5 * g * dt * dt };
  let d = dt - s.T1, x = s.xb, y = s.yb, vx = s.vxb, vy = s.vyb, vz = s.vzb;
  for (let n = 0; n < 12; n++) {
    if (vz < 0.4) return { x: x + vx * d, y: y + vy * d, z: 0 };
    const tf = 2 * vz / g;
    if (d < tf) return { x: x + vx * d, y: y + vy * d, z: vz * d - 0.5 * g * d * d };
    x += vx * tf; y += vy * tf; d -= tf; vz *= 0.55; vx *= 0.8; vy *= 0.8;
  }
  return { x, y, z: 0 };
}

// 출발점 → 착지점을 flight초에 날아가는 샷. 네트에 걸리면 조금 느리게 띄움
function makeShot(hitter, from, to, flight, kind, special = false) {
  const g = C.g;
  let Tf = flight, vx = 0, vy = 0, vz0 = 0;
  for (let k = 0; k < 80; k++) {
    vx = (to.x - from.x) / Tf; vy = (to.y - from.y) / Tf;
    vz0 = (0.5 * g * Tf * Tf - from.z) / Tf;
    const tn = (C.net - from.y) / vy;
    if (tn > 0 && tn < Tf) {
      const zn = from.z + vz0 * tn - 0.5 * g * tn * tn;
      if (zn < C.netH + 0.22) { Tf += 0.025; continue; }
    }
    break;
  }
  const vzImpact = vz0 - g * Tf;
  const fr = kind === 'smash' ? 0.9 : 0.86;
  const s = {
    hitter, receiver: 1 - hitter, kind, special, t0: T(),
    x0: from.x, y0: from.y, z0: from.z, vx, vy, vz0, T1: Tf,
    xb: to.x, yb: to.y, vxb: vx * fr, vyb: vy * fr, vzb: -vzImpact * 0.72,
    out: Math.abs(to.x) > C.halfW + 0.03,
    resolved: false, miss: '', bounced: false, trail: [],
  };
  computeIntercept(s);
  return s;
}

// 받는 선수가 칠 지점·시각(이상적인 타이밍)과 도달 가능 여부 계산
function computeIntercept(s) {
  const r = players[s.receiver], g = C.g, now = T();
  let hit = null, speed = 0;
  // 로브는 바운드 전에 높은 곳에서 받기(스매시 찬스)
  if (s.kind === 'lob') {
    const zH = 2.3, disc = s.vz0 * s.vz0 - 2 * g * (zH - s.z0);
    if (disc > 0) {
      const t1 = (s.vz0 + Math.sqrt(disc)) / g;
      if (t1 < s.T1) {
        const y = s.y0 + s.vy * t1;
        const okY = s.receiver === 1 ? (y > C.net + 4 && y < BACK_LIMIT[1]) : (y < C.net - 4 && y > BACK_LIMIT[0]);
        if (okY) {
          const cand = { t: s.t0 + t1, x: s.x0 + s.vx * t1, y, z: zH };
          const sx = cand.x - RACKET_SIDE[s.receiver] * 0.35;
          if (Math.hypot(sx - r.x, cand.y - r.y) <= r.speed * Math.max(0, cand.t - now - 0.12)) { hit = cand; speed = Math.hypot(s.vx, s.vy); }
        }
      }
    }
  }
  if (!hit) {
    // 바운드 후 1m 높이로 내려올 때(낮으면 최고점)에 치기, 너무 깊으면 물러날 수 있는 곳까지
    const vzb = s.vzb, apex = vzb * vzb / (2 * g);
    let tp = apex > 1.05 ? (vzb + Math.sqrt(vzb * vzb - 2 * g * 1.0)) / g : vzb / g;
    const lim = BACK_LIMIT[s.receiver], yAt = s.yb + s.vyb * tp;
    if ((s.receiver === 0 && yAt < lim) || (s.receiver === 1 && yAt > lim)) tp = (lim - s.yb) / s.vyb;
    tp = Math.max(0.08, tp);
    hit = { t: s.t0 + s.T1 + tp, x: s.xb + s.vxb * tp, y: s.yb + s.vyb * tp, z: Math.max(0.2, vzb * tp - 0.5 * g * tp * tp) };
    speed = Math.hypot(s.vxb, s.vyb);
  }
  s.hit = hit;
  const off = hit.z > 1.8 ? 0.35 : 0.7;
  s.stand = { x: hit.x - RACKET_SIDE[s.receiver] * off, y: hit.y };
  const dist = Math.hypot(s.stand.x - r.x, s.stand.y - r.y);
  s.reachable = !s.out && dist <= r.speed * Math.max(0, hit.t - now - 0.12) + 0.35;
  s.W = clamp(0.26 - speed * 0.0045, 0.13, 0.23);   // 판정 창(±초): 빠른 공일수록 좁음
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
  const s = makeShot(pi, from, to, lerp(1.15, 0.66, pow), 'serve');
  game.shot = s; game.state = 'rally'; game.stateT = T(); game.rally = 0;
  p.tx = 0; p.ty = BASE[pi]; p.anim = 'serve';
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
  game.cpuSwing = { player: r, at, pow };
}

// 모든 스윙 입력(조이콘·키보드·패드·CPU)이 모이는 곳. tSwing은 게임 시간
function doSwing(pi, pow, tSwing) {
  const p = players[pi], t = T();
  p.swingT = t; p.anim = 'drive'; p.lastPow = pow; p.lastPowT = t;
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
  if (Math.abs(d) <= s.W) { hitBall(pi, d / s.W, pow); return; }
  if (d < -s.W) { s.miss = '빠름!'; p.flash = '빠름!'; p.flashT = t; }
}

function hitBall(pi, u, pow) {
  const s = game.shot, p = players[pi], t = T();
  s.resolved = true;
  game.rally++;
  const perfect = Math.abs(u) < 0.22;
  const bp = ballPos(s, t);
  const from = { x: bp.x, y: bp.y, z: clamp(bp.z, 0.4, 3.2) };
  let kind = 'drive';
  if (from.z > 1.85 && pow >= 0.5) kind = 'smash';
  else if (pow < 0.25) kind = 'lob';
  p.anim = kind === 'smash' ? 'smash' : 'drive';
  const special = game.rally >= 8 && perfect && kind !== 'lob';
  // 방향: 일찍(u<0) → 치는 사람 기준 왼쪽, 늦게 → 오른쪽
  const dirSign = pi === 0 ? 1 : -1;
  const spread = kind === 'smash' ? 3.6 : kind === 'lob' ? 3.2 : 4.4;
  const tx = u * spread * dirSign;
  const depth = kind === 'lob' ? 0.88 : kind === 'smash' ? 0.6 : lerp(0.62, 0.88, pow);
  const ty = pi === 0 ? C.net + depth * C.net : C.net - depth * C.net;
  let flight = kind === 'lob' ? 1.7 : kind === 'smash' ? 0.6 : lerp(1.3, 0.8, pow);
  if (perfect && kind === 'drive') flight *= 0.9;
  flight *= Math.max(0.8, 1 - 0.012 * game.rally);   // 랠리가 길수록 빨라짐
  if (special) flight *= 0.78;
  const ns = makeShot(pi, from, { x: tx, y: ty }, flight, kind, special);
  game.shot = ns;
  p.tx = 0; p.ty = BASE[pi];                          // 친 사람은 가운데로 복귀
  let text = '', color = '#fff';
  if (special) { text = '필살 샷!'; color = '#fb923c'; game.shake = 1; }
  else if (kind === 'smash') { text = '스매시!'; game.shake = 0.8; }
  else if (perfect) { text = '나이스!'; game.nice[pi]++; }
  else if (kind === 'lob') { text = '로브'; }
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
  el.innerHTML = CHARS.map((ch, k) => `<div class="tile" data-k="${k}"><span class="tg t1">1P</span><span class="tg t2">2P</span><canvas width="152" height="152"></canvas><div class="tn">${ch.name}</div></div>`).join('');
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
  if (game.paused) return;
  for (const p of players) {
    const dx = p.tx - p.x, dy = p.ty - p.y, d = Math.hypot(dx, dy), step = p.speed * dt;
    if (d <= step) { p.x = p.tx; p.y = p.ty; } else { p.x += dx / d * step; p.y += dy / d * step; }
  }
  if (game.state === 'serve') {
    if (isCPU(game.server) && t >= game.cpuServeAt) doSwing(game.server, rand(0.45, game.demo ? 1 : [0.7, 0.85, 1][settings.cpuLevel]), t);
  } else if (game.state === 'rally') {
    updateRally(t);
  } else if (game.state === 'pointEnd') {
    if (game.shot) { const bp = ballPos(game.shot, t); game.shot.trail.push(bp); if (game.shot.trail.length > 14) game.shot.trail.shift(); }
    if (t - game.stateT > 1.9) afterPoint();
  } else if (game.state === 'select') {
    if (selStartAt && t >= selStartAt) startMatch();
  }
  game.shake = Math.max(0, game.shake - dt * 2.5);
  updateParticles(dt);
}

function updateRally(t) {
  const s = game.shot; if (!s) return;
  const bp = ballPos(s, t);
  s.trail.push(bp); if (s.trail.length > 14) s.trail.shift();
  if (!s.bounced && t - s.t0 >= s.T1) {
    s.bounced = true; sfx.bounce(); spawnDust(s.xb, s.yb);
    if (s.out && !s.resolved) { s.resolved = true; endPoint(s.receiver, '아웃!', '#fbbf24'); return; }
  }
  if (game.cpuSwing && t >= game.cpuSwing.at) {
    const cs = game.cpuSwing; game.cpuSwing = null;
    doSwing(cs.player, cs.pow, cs.at + settings.latencyMs / 1000);
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
const inputFlash = [{ pow: 0, t: -9 }, { pow: 0, t: -9 }];
function flashInput(pi, pow) { inputFlash[pi] = { pow, t: realNow() }; }

// 사람 입력 → 게임. rawT는 performance 기준 초
function emitSwing(pi, pow, rawT) {
  if (pi == null || pi < 0 || game.paused || isCPU(pi)) return;
  doSwing(pi, pow, rawT - pauseOffset);
}

const KEYMAP = { KeyA: [0, 0.12], KeyS: [0, 0.55], KeyD: [0, 0.92], KeyJ: [1, 0.12], KeyK: [1, 0.55], KeyL: [1, 0.92] };
const SELKEYS = { KeyA: [0, -1], KeyD: [0, 1], KeyS: [0, 0], KeyJ: [1, -1], KeyL: [1, 1], KeyK: [1, 0] };
window.addEventListener('keydown', e => {
  sfx.init();
  if (e.repeat) return;
  if (e.code === 'KeyF') { toggleFull(); return; }
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
  const [pi, pow] = m;
  if (settings.mode === 'cpu' && pi === 1) return;
  flashInput(pi, pow);
  emitSwing(pi, pow, realNow());
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
    let swing = -1, confirm = false;
    if (gp.mapping === 'standard') {
      if (rise(0)) swing = 0.55;
      if (rise(2)) swing = 0.12;
      if (rise(3) || rise(5) || rise(7)) swing = 0.92;
      confirm = rise(0) || rise(9);
    } else {
      for (let i = 0; i < now.length; i++) if (rise(i)) { swing = 0.55; confirm = true; break; }
    }
    if (confirm && (menuOpen() || resultOpen() || game.paused)) { onConfirm(); continue; }
    if (swing >= 0) { flashInput(pi, swing); emitSwing(pi, swing, realNow()); }
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
JC.on('swing', (pi, pow, t) => emitSwing(pi, pow, t));
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
    for (const j of jcs) if (j.lastSwingT > last.t) last = { pow: j.lastPow, t: j.lastSwingT };
    const age = realNow() - last.t;
    const w = jcs.length ? Math.min(100, g / 18) : (age < 0.4 ? last.pow * 100 : 0);
    m.style.width = w + '%';
    s.textContent = age < 1.6 ? `스윙! ${powLabel(last.pow)} ${Math.round(last.pow * 100)}%` : (jcs.length ? '휘둘러 보세요' : '');
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
  const cssW = Math.max(1, window.innerWidth), cssH = Math.max(1, window.innerHeight);
  const dpr = window.devicePixelRatio || 1;
  const pr = Math.max(0.25, Math.min(dpr, lv.maxW / cssW));   // 4K 화면이어도 렌더 해상도는 상한까지만
  hud.width = Math.max(1, Math.round(cssW * pr)); hud.height = Math.max(1, Math.round(cssH * pr));
  view.k = Math.min(hud.width / VW, hud.height / VH);
  view.ox = (hud.width - VW * view.k) / 2; view.oy = (hud.height - VH * view.k) / 2;
  if (G3.camera) { G3.camera.aspect = cssW / cssH; G3.camera.updateProjectionMatrix(); }
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
function outlined(g, text, x, y, fill, lw = 7) { g.lineWidth = lw; g.strokeStyle = 'rgba(0,0,0,0.55)'; g.strokeText(text, x, y); g.fillStyle = fill; g.fillText(text, x, y); }
function pill(g, text, x, y, color, alpha) {
  const w = g.measureText(text).width + 40, h = 46;
  g.globalAlpha = alpha;
  g.fillStyle = 'rgba(6,14,32,0.8)'; rr(g, x - w / 2, y - h / 2, w, h, h / 2); g.fill();
  g.fillStyle = color; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, x, y + 1);
  g.globalAlpha = 1;
}
function drawScoreboard(g) {
  const W = 800, H = 92, X = (VW - W) / 2, Y = 16, cy = Y + H / 2;
  g.fillStyle = 'rgba(6,14,32,0.86)'; rr(g, X, Y, W, H, 20); g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.14)'; g.lineWidth = 2; rr(g, X, Y, W, H, 20); g.stroke();
  g.textBaseline = 'middle';
  for (const pi of [0, 1]) {
    const left = pi === 0, ex = left ? X + 30 : X + W - 30, nm = nameOf(pi);
    g.fillStyle = COLORS[pi]; g.beginPath(); g.arc(ex, cy, 9, 0, Math.PI * 2); g.fill();
    g.font = `800 34px ${FONT}`; g.textAlign = left ? 'left' : 'right';
    g.fillText(nm, ex + (left ? 20 : -20), cy);
    let w = g.measureText(nm).width;
    if (isCPU(pi)) {
      g.font = `700 16px ${FONT}`; g.fillStyle = '#94a3b8';
      g.fillText('CPU', ex + (left ? 26 + w : -26 - w), cy + 3);
      w += 6 + g.measureText('CPU').width;
    }
    if (game.server === pi) {
      const bx = left ? ex + 20 + w + 18 : ex - 20 - w - 18;
      g.fillStyle = '#e8ff3d'; g.beginPath(); g.arc(bx, cy, 8, 0, Math.PI * 2); g.fill();
    }
    g.textAlign = 'center'; g.fillStyle = '#cbd5e1'; g.font = `700 22px ${FONT}`;
    g.fillText(`게임 ${game.games[pi]}`, left ? X + 250 : X + W - 250, cy);
  }
  const pt = pointText();
  g.textAlign = 'center'; g.fillStyle = '#fff';
  if (pt.mid) { g.font = `900 28px ${FONT}`; g.fillText(pt.mid, VW / 2, cy); }
  else { g.font = `900 44px ${FONT}`; g.fillText(`${pt.l}  :  ${pt.r}`, VW / 2, cy + 2); }
}
function drawCards(g) {
  for (const pi of [0, 1]) {
    const W = 400, H = 84, X = pi === 0 ? 28 : VW - 28 - W, Y = VH - H - 24, p = players[pi];
    g.fillStyle = 'rgba(6,14,32,0.8)'; rr(g, X, Y, W, H, 16); g.fill();
    g.fillStyle = COLORS[pi]; rr(g, X + 14, Y + 13, 60, 30, 8); g.fill();
    g.textBaseline = 'middle'; g.textAlign = 'center'; g.fillStyle = '#fff'; g.font = `800 20px ${FONT}`;
    g.fillText(slotLabel(pi), X + 44, Y + 28);
    g.textAlign = 'left'; g.font = `600 19px ${FONT}`; g.fillStyle = '#cbd5e1';
    g.fillText(`${nameOf(pi)} · ${inputLabel(pi)}`, X + 86, Y + 28);
    const bx = X + 14, by = Y + 56, bw = W - 110, age = T() - p.lastPowT;
    g.fillStyle = 'rgba(255,255,255,0.1)'; rr(g, bx, by, bw, 12, 6); g.fill();
    if (age < 2.5) {
      g.globalAlpha = age < 1.5 ? 1 : clamp(2.5 - age, 0, 1);
      g.fillStyle = p.lastPow < 0.25 ? '#a78bfa' : p.lastPow > 0.7 ? '#f97316' : '#4ade80';
      rr(g, bx, by, Math.max(12, bw * p.lastPow), 12, 6); g.fill();
      g.fillStyle = '#e2e8f0'; g.font = `700 17px ${FONT}`; g.fillText(powLabel(p.lastPow), bx + bw + 14, by + 6);
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
    pill(g, `${nameOf(game.server)} 서브 — 휘두르면 서브!`, VW / 2, 140, '#fff', 0.75 + 0.25 * Math.sin(t * 6));
  } else if (game.state === 'rally' && game.rally >= 3) {
    g.font = `800 26px ${FONT}`;
    pill(g, `랠리 ${game.rally}`, VW / 2, 140, game.rally >= 8 ? '#fb923c' : '#e2e8f0', 1);
  }
  drawMsg(g);
  drawToast(g);
}
// 머리 위 이름표 · 판정 문구 (tag: 가상 좌표 + 1m당 픽셀 s)
function drawTag(g, p, tag, t) {
  const label = game.state === 'select' ? slotLabel(p.i) : nameOf(p.i);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = `800 ${Math.round(clamp(0.2 * tag.s, 15, 30))}px ${FONT}`;
  g.lineWidth = 4; g.strokeStyle = 'rgba(0,0,0,0.5)'; g.fillStyle = COLORS[p.i];
  g.strokeText(label, tag.x, tag.y); g.fillText(label, tag.x, tag.y);
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
  return { x: s.hit.x, y: s.hit.y, r: 0.3 + Math.max(0, dtv) * 1.7, inWin: Math.abs(dtv) <= s.W };
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
  const n = 14; g.strokeStyle = '#f8fafc'; g.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    const a = proj(lerp(x1, x2, i / n), lerp(y1, y2, i / n), 0), b = proj(lerp(x1, x2, (i + 1) / n), lerp(y1, y2, (i + 1) / n), 0);
    g.lineWidth = Math.max(1.3, w * (a.s + b.s) / 2);
    g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
  }
}
function buildCourt2D() {
  const c = makeLayer(), g = c.getContext('2d');
  const sky = g.createLinearGradient(0, 0, 0, VH);
  sky.addColorStop(0, '#071631'); sky.addColorStop(0.35, '#0c2550'); sky.addColorStop(1, '#0b2a4f');
  g.fillStyle = sky; g.fillRect(0, 0, VW, VH);
  const top = 0, bot = proj(0, C.len + 7, 2.6).y;
  const st = g.createLinearGradient(0, top, 0, bot);
  st.addColorStop(0, '#0f1b36'); st.addColorStop(1, '#1b2f57');
  g.fillStyle = st; g.fillRect(0, top, VW, bot - top);
  const rng = mulberry32(7), cols = ['#f87171', '#fbbf24', '#60a5fa', '#a78bfa', '#f472b6', '#e5e7eb', '#34d399', '#fb923c'];
  for (let i = 0; i < 2600; i++) {
    const y = top + 8 + rng() * (bot - top - 12), x = rng() * VW;
    g.globalAlpha = 0.45 + rng() * 0.4; g.fillStyle = cols[(rng() * cols.length) | 0];
    g.beginPath(); g.arc(x, y, 1.6 + (y - top) / (bot - top) * 2.4, 0, Math.PI * 2); g.fill();
  }
  g.globalAlpha = 1;
  for (const lx of [180, VW - 180]) {
    const rg = g.createRadialGradient(lx, 30, 0, lx, 30, 260);
    rg.addColorStop(0, 'rgba(255,255,230,0.55)'); rg.addColorStop(1, 'rgba(255,255,230,0)');
    g.fillStyle = rg; g.fillRect(lx - 260, 0, 520, 300);
  }
  poly(g, [[-40, C.len + 7, 0], [40, C.len + 7, 0], [40, C.len + 7, 2.6], [-40, C.len + 7, 2.6]], '#0e3b2c');
  poly(g, [[-40, -9], [40, -9], [40, C.len + 7], [-40, C.len + 7]], '#1d6a4a');
  poly(g, [[-C.dblHalfW - 1.2, -2.5], [C.dblHalfW + 1.2, -2.5], [C.dblHalfW + 1.2, C.len + 2.5], [-C.dblHalfW - 1.2, C.len + 2.5]], '#22785a');
  poly(g, [[-C.dblHalfW, 0], [C.dblHalfW, 0], [C.dblHalfW, C.len], [-C.dblHalfW, C.len]], '#2f63ad');
  poly(g, [[-C.halfW, 0], [C.halfW, 0], [C.halfW, C.len], [-C.halfW, C.len]], '#3170bf');
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
  g.closePath(); g.fillStyle = 'rgba(15,23,42,0.45)'; g.fill();
  g.strokeStyle = 'rgba(226,232,240,0.3)'; g.lineWidth = 1;
  for (let x = -px; x <= px + 1e-6; x += 0.3) { const a = proj(x, C.net, 0), b = proj(x, C.net, topZ(x)); g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke(); }
  for (let z = 0.12; z < ph; z += 0.12) {
    g.beginPath(); let pen = false;
    for (let x = -px; x <= px + 1e-6; x += 0.25) {
      if (z > topZ(x)) { pen = false; continue; }
      const p = proj(x, C.net, z); pen ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y); pen = true;
    }
    g.stroke();
  }
  g.strokeStyle = '#f8fafc'; g.lineWidth = 5; g.beginPath();
  [[-px, ph], [0, ch], [px, ph]].forEach(([x, z], i) => { const p = proj(x, C.net, z); i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y); });
  g.stroke();
  g.strokeStyle = '#334155'; g.lineWidth = 7;
  for (const x of [-px, px]) { const a = proj(x, C.net, 0), b = proj(x, C.net, ph + 0.06); g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke(); }
  return c;
}
let bgLayer = null, netLayer = null;

function groundShadow(g, x, y, r, a) {
  const p = proj(x, y, 0);
  g.fillStyle = `rgba(0,0,0,${a})`; g.beginPath(); g.ellipse(p.x, p.y, r * p.s, r * p.s * 0.38, 0, 0, Math.PI * 2); g.fill();
}

function drawPlayer2D(g, p) {
  const t = T(), ch = charOf(p.i), st = ch.style;
  const front = p.i === 1 || game.state === 'select' || game.state === 'matchEnd';   // 카메라를 바라봄
  const hand = front ? -1 : 1;            // 화면에서 라켓 손 방향
  const moving = isMoving(p);
  const won = game.state === 'matchEnd' && p.i === game.winner;
  const bob = won ? Math.abs(Math.sin(t * 6.5)) * 0.3 : moving ? Math.abs(Math.sin(t * 13)) * 0.06 : 0;
  const foot = proj(p.x, p.y, 0), s = foot.s * ch.h;
  const hip = proj(p.x, p.y, (0.86 + bob) * ch.h), sh = proj(p.x, p.y, (1.36 + bob) * ch.h), hd = proj(p.x, p.y, (1.62 + bob) * ch.h);
  const col = ch.shirt, skin = ch.skin, accent = COLORS[p.i], wf = ch.w;
  const stride = moving ? Math.sin(t * 13) * 0.14 : 0;
  g.lineCap = 'round'; g.lineJoin = 'round';
  g.strokeStyle = skin; g.lineWidth = 0.11 * s;
  for (const sd of [-1, 1]) { g.beginPath(); g.moveTo(hip.x + sd * 0.09 * s, hip.y); g.lineTo(foot.x + (sd * 0.12 + sd * stride) * s, foot.y - 0.05 * s); g.stroke(); }
  g.fillStyle = '#f8fafc';
  for (const sd of [-1, 1]) { g.beginPath(); g.ellipse(foot.x + (sd * 0.12 + sd * stride) * s, foot.y - 0.03 * s, 0.085 * s, 0.045 * s, 0, 0, Math.PI * 2); g.fill(); }
  g.fillStyle = ch.shorts; rr(g, hip.x - 0.19 * s * wf, hip.y - 0.1 * s, 0.38 * s * wf, 0.22 * s, 0.05 * s); g.fill();
  g.fillStyle = col; rr(g, sh.x - 0.21 * s * wf, sh.y - 0.05 * s, 0.42 * s * wf, hip.y - sh.y + 0.02 * s, 0.1 * s); g.fill();
  const shY = sh.y + 0.03 * s;
  g.strokeStyle = skin; g.lineWidth = 0.085 * s;
  g.beginPath(); g.moveTo(sh.x - hand * 0.17 * s, shY); g.lineTo(sh.x - hand * 0.27 * s, shY + (won ? -0.35 : 0.3) * s); g.stroke();
  const k = (t - p.swingT) / 0.3, swinging = k >= 0 && k < 1;
  const a = swinging ? lerp(-1.3, 1.95, 1 - Math.pow(1 - k, 3)) : won ? -1.4 : 0.3;
  const shX = sh.x + hand * 0.17 * s;
  const hx = shX + hand * Math.cos(a) * 0.4 * s, hy = shY + (0.24 - Math.sin(a) * 0.06) * s - (won ? 0.5 * s : 0);
  g.beginPath(); g.moveTo(shX, shY); g.lineTo(hx, hy); g.stroke();
  if (swinging) {
    g.strokeStyle = `rgba(255,255,255,${0.35 * (1 - k)})`; g.lineWidth = 0.12 * s; g.beginPath();
    for (let j = 0; j <= 10; j++) { const aa = lerp(-1.3, a, j / 10), x = shX + hand * Math.cos(aa) * 0.9 * s, y = shY + (0.05 - Math.sin(aa) * 0.1) * s; j ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.stroke();
  }
  let ux = hand * Math.cos(a + 0.6), uy = -0.8; const ul = Math.hypot(ux, uy); ux /= ul; uy /= ul;
  g.strokeStyle = '#1f2937'; g.lineWidth = 0.045 * s;
  g.beginPath(); g.moveTo(hx, hy); g.lineTo(hx + ux * 0.3 * s, hy + uy * 0.3 * s); g.stroke();
  g.save(); g.translate(hx + ux * 0.5 * s, hy + uy * 0.5 * s); g.rotate(Math.atan2(uy, ux) + Math.PI / 2);
  g.fillStyle = 'rgba(255,255,255,0.28)'; g.strokeStyle = accent; g.lineWidth = 0.04 * s;
  g.beginPath(); g.ellipse(0, 0, 0.12 * s, 0.16 * s, 0, 0, Math.PI * 2); g.fill(); g.stroke();
  g.restore();
  // 머리
  const hr = 0.17 * s;
  if (st === 'afro') { g.fillStyle = ch.hair; circ(g, hd.x, hd.y - 0.06 * s, hr * 1.4); }
  g.fillStyle = skin; circ(g, hd.x, hd.y, hr);
  if (st === 'cap') { g.fillStyle = ch.cap || '#0f766e'; g.beginPath(); g.arc(hd.x, hd.y - 0.02 * s, hr * 1.03, Math.PI, Math.PI * 2); g.fill(); }
  else if (st !== 'bald' && st !== 'afro') {
    g.fillStyle = ch.hair;
    if (front) { g.beginPath(); g.arc(hd.x, hd.y - 0.01 * s, hr * 1.02, Math.PI * 1.05, Math.PI * 1.95); g.fill(); }
    else circ(g, hd.x, hd.y + 0.01 * s, hr * 0.94);
    if (st === 'bun') circ(g, hd.x, hd.y - hr * 1.05, hr * 0.38);
    if (st === 'ponytail' && !front) { g.beginPath(); g.ellipse(hd.x, hd.y + hr * 0.9, hr * 0.28, hr * 0.5, 0, 0, Math.PI * 2); g.fill(); }
  }
  if (front) {
    g.fillStyle = '#1f2937';
    for (const ex of [-0.055, 0.055]) circ(g, hd.x + ex * s, hd.y + 0.015 * s, 0.02 * s);
  }
  if (ch.band) { g.fillStyle = accent; rr(g, hd.x - 0.165 * s, hd.y - 0.08 * s, 0.33 * s, 0.05 * s, 0.02 * s); g.fill(); }
  drawTag(g, p, proj(p.x, p.y, (2.02 + bob) * ch.h), t);
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
  g.fillStyle = '#06122a'; g.fillRect(0, 0, hud.width, hud.height);
  const sx = game.shake > 0 ? (Math.random() - 0.5) * 14 * game.shake : 0;
  const sy = game.shake > 0 ? (Math.random() - 0.5) * 10 * game.shake : 0;
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
    gr.addColorStop(0, '#040b1e'); gr.addColorStop(0.55, '#0b2348'); gr.addColorStop(1, '#12345f');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  });
  Sc.fog = new THREE.Fog(0x0e2a52, 55, 130);
  G3.camera = new THREE.PerspectiveCamera(42, 16 / 9, 0.3, 260);
  // 조명: 하늘빛 + 경기장 조명 + 카메라 쪽 보조광 (얼굴이 어둡지 않게)
  Sc.add(new THREE.HemisphereLight(0xe0ecff, 0x1d3a2a, 0.82));
  const sun = new THREE.DirectionalLight(0xffffff, 0.62);
  sun.position.set(-7, 22, 6); sun.target.position.set(0, 0, -12);
  Sc.add(sun, sun.target);
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -15, right: 15, top: 24, bottom: -24, near: 2, far: 75 });
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.02;
  G3.sun = sun;
  const fill = new THREE.DirectionalLight(0xffffff, 0.34);
  fill.position.set(0, 6, 16); fill.target.position.set(0, 1, -4);
  Sc.add(fill, fill.target);
  // 바닥 · 코트
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(160, 160), lam(0x1b5e45));
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
    g.fillStyle = '#1f6f52'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#22785a'; g.fillRect(X(-C.dblHalfW - 1.6), Y(C.len + 3), (2 * C.dblHalfW + 3.2) * ppm, (C.len + 6) * ppm);
    g.fillStyle = '#2f63ad'; g.fillRect(X(-C.dblHalfW), Y(C.len), 2 * C.dblHalfW * ppm, C.len * ppm);
    g.fillStyle = '#3170bf'; g.fillRect(X(-C.halfW), Y(C.len), 2 * C.halfW * ppm, C.len * ppm);
    const rng = mulberry32(3);   // 표면 질감 (아주 옅은 점)
    for (let i = 0; i < 9000; i++) { g.fillStyle = rng() < 0.5 ? 'rgba(255,255,255,0.025)' : 'rgba(0,0,0,0.035)'; g.fillRect(rng() * W, rng() * H, 2, 2); }
    const lw = Math.max(3, 0.065 * ppm);
    g.fillStyle = '#f8fafc';
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
    g.fillStyle = 'rgba(12,20,38,0.5)'; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(226,232,240,0.55)'; g.fillRect(0, 0, w, 6); g.fillRect(0, 0, 6, h);
  });
  netTex.wrapS = netTex.wrapT = THREE.RepeatWrapping; netTex.repeat.set(2 * px / 0.12, ph / 0.12);
  const geo = new THREE.PlaneGeometry(2 * px, ph, 24, 1);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setY(i, pos.getY(i) > 0 ? lerp(C.netH, ph, Math.abs(pos.getX(i)) / px) : 0);   // 가운데가 처진 네트
  pos.needsUpdate = true; geo.computeBoundingSphere();
  const net = new THREE.Mesh(geo, basic(0xffffff, { map: netTex, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
  net.position.z = -C.net; Sc.add(net);
  const tape = lam(0xf8fafc);
  for (const sx of [-1, 1]) Sc.add(beam(new THREE.Vector3(sx * px, ph, -C.net), new THREE.Vector3(0, C.netH, -C.net), 0.055, tape));
  const postMat = lam(0x334155), postGeo = new THREE.CylinderGeometry(0.05, 0.05, ph + 0.08, 10);
  for (const sx of [-1, 1]) { const p = new THREE.Mesh(postGeo, postMat); p.position.set(sx * px, (ph + 0.08) / 2, -C.net); p.castShadow = true; Sc.add(p); }
  const strap = new THREE.Mesh(new THREE.PlaneGeometry(0.05, C.netH), basic(0xf8fafc)); strap.position.set(0, C.netH / 2, -C.net + 0.01); Sc.add(strap);
  const sh = new THREE.Mesh(new THREE.PlaneGeometry(2 * px, 0.7), basic(0x000000, { transparent: true, opacity: 0.16, depthWrite: false }));
  sh.rotation.x = -Math.PI / 2; sh.position.set(0, 0.006, -(C.net + 0.4)); Sc.add(sh);
}

function buildStadium3D(Sc) {
  const crowd = canvasTex(1024, 512, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#0d1730'); gr.addColorStop(1, '#1d3360');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    const rows = 14, rh = h / rows;
    for (let r = 0; r < rows; r++) { g.fillStyle = 'rgba(0,0,0,0.22)'; g.fillRect(0, r * rh + rh * 0.78, w, rh * 0.22); }
    const rng = mulberry32(7), cols = ['#f87171', '#fbbf24', '#60a5fa', '#a78bfa', '#f472b6', '#e5e7eb', '#34d399', '#fb923c'];
    const skins = ['#f1c9a5', '#e3b086', '#8d5524', '#f7d7bd'];
    for (let r = 0; r < rows; r++) for (let x = 6; x < w; x += rng() * 14 + 10) {
      if (rng() < 0.12) continue;
      const cy = r * rh + rh * 0.5 + (rng() - 0.5) * 6, rad = 4 + rng() * 2.5;
      g.fillStyle = cols[(rng() * cols.length) | 0]; g.fillRect(x - rad, cy - rad * 0.2, rad * 2, rad * 1.8);
      g.fillStyle = skins[(rng() * skins.length) | 0]; circ(g, x, cy - rad * 0.6, rad * 0.75);
    }
  });
  const crowdMat = rep => { const t = crowd.clone(); t.wrapS = THREE.RepeatWrapping; t.repeat.set(rep, 1); t.needsUpdate = true; return basic(0xffffff, { map: t }); };
  const stands = new THREE.Group(); Sc.add(stands); G3.stands = stands;
  const back = new THREE.Mesh(new THREE.PlaneGeometry(80, 14), crowdMat(5));
  back.rotation.x = -0.82; back.position.set(0, 5.8, -(C.len + 13)); stands.add(back);
  for (const sx of [-1, 1]) {
    const side = new THREE.Mesh(new THREE.PlaneGeometry(56, 14), crowdMat(3.5));
    side.rotation.order = 'YXZ'; side.rotation.y = sx < 0 ? Math.PI / 2 : -Math.PI / 2; side.rotation.x = -0.82;
    side.position.set(sx * 18.5, 5.8, -14); stands.add(side);
  }
  // 광고판
  const ad = canvasTex(512, 64, (g, w, h) => {
    g.fillStyle = '#0f2a5c'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#facc15'; g.fillRect(0, h - 6, w, 6);
    g.fillStyle = '#ffffff'; g.font = `900 34px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('NOLJA TENNIS', w / 2, h / 2 - 2);
  });
  const adMat = len => { const t = ad.clone(); t.wrapS = THREE.RepeatWrapping; t.repeat.set(len / 7, 1); t.needsUpdate = true; return basic(0xffffff, { map: t }); };
  const backAd = new THREE.Mesh(new THREE.PlaneGeometry(35, 1), adMat(35)); backAd.position.set(0, 0.5, -(C.len + 6.3)); Sc.add(backAd);
  for (const sx of [-1, 1]) {
    const a = new THREE.Mesh(new THREE.PlaneGeometry(42, 1), adMat(42));
    a.rotation.y = sx < 0 ? Math.PI / 2 : -Math.PI / 2; a.position.set(sx * 11.5, 0.5, -12); Sc.add(a);
  }
  // 조명탑
  G3.glowTex = canvasTex(128, 128, (g, w, h) => {
    const rg = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    rg.addColorStop(0, 'rgba(255,250,225,1)'); rg.addColorStop(0.25, 'rgba(255,245,210,0.55)'); rg.addColorStop(1, 'rgba(255,240,200,0)');
    g.fillStyle = rg; g.fillRect(0, 0, w, h);
  });
  const poleMat = lam(0x334155), lampMat = basic(0xfffbe6), poleGeo = new THREE.CylinderGeometry(0.22, 0.32, 24, 8), lampGeo = new THREE.BoxGeometry(3.4, 1.7, 0.35);
  for (const [x, d] of [[-17, 35], [17, 35], [-21, 18], [21, 18]]) {
    const pole = new THREE.Mesh(poleGeo, poleMat); pole.position.set(x, 12, -d); Sc.add(pole);
    const lamp = new THREE.Mesh(lampGeo, lampMat); lamp.position.set(x, 24, -d); lamp.lookAt(0, 0, -12); Sc.add(lamp);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: G3.glowTex, color: 0xfff3cf, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
    glow.scale.set(11, 11, 1); glow.position.set(x, 24, -d); Sc.add(glow);
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

// 테니스 스윙 자세 (상체 기준 방향 벡터)
function swingPose(anim, k) {
  const e = 1 - Math.pow(1 - clamp(k, 0, 1), 3), nrm = NC.nrm;
  if (anim === 'serve' || anim === 'smash') {      // 머리 위로 내려치기
    const b = lerp(-0.8, 2.5, e);
    const dR = nrm(0.3, Math.cos(b), -Math.sin(b));
    return { dR, dL: nrm(-0.25, lerp(0.7, -0.75, e), -0.45), r: nrm(dR.x, dR.y + 0.15, dR.z - 0.15), n: new THREE.Vector3(0, -Math.sin(b), -Math.cos(b)), twist: lerp(-0.4, 0.5, e), lean: 0, nod: 0 };
  }
  const a = lerp(-1.5, 1.9, e), E = -0.25 + 0.3 * Math.sin(k * Math.PI);   // 포핸드: 뒤 → 앞으로 크게
  const dR = new THREE.Vector3(Math.cos(a) * Math.cos(E), Math.sin(E), -Math.sin(a) * Math.cos(E));
  return { dR, dL: nrm(lerp(-0.35, 0.05, e), -0.62, lerp(-0.55, -0.2, e)), r: nrm(dR.x, dR.y + 0.35, dR.z), n: new THREE.Vector3(-Math.sin(a), 0, -Math.cos(a)), twist: lerp(-0.7, 0.8, e), lean: 0, nod: 0 };
}
function armPose(p, t, f) {
  const k = (t - p.swingT) / SWING_DUR;
  if (k >= 0 && k < 1) return swingPose(p.anim, k);
  let base = NC.poses.ready();
  if (f.won) base = NC.poses.celebrate(t);
  else if (f.lost) base = NC.poses.sad();
  else if (f.ready) base = NC.poses.cheer(t);
  if (k >= 1 && k < 1.7) return NC.mixPose(swingPose(p.anim, 1), base, smooth((k - 1) / 0.7));
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
  if (game.state === 'select') { K.tgtPos.set(0, 1.5, 2.7); K.tgtLook.set(0, 1.0, -2.2); }
  else if (game.state === 'matchEnd') { K.tgtPos.set(0, 1.7, 4.4); K.tgtLook.set(0, 1.3, -2.3); }
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
  document.addEventListener('click', e => { if (e.target && e.target.tagName === 'BUTTON') e.target.blur(); });
  window.addEventListener('pointerdown', () => sfx.init());
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
  window.addEventListener('resize', resize);
}

function renderFrame() {
  if (gfx.mode3d) {
    sync3D();
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
  doSwing, emitSwing, startServe, isCPU, ballPos, gfx, G3, Q, applyQuality, parts, CHARS, autoStep, joycon: JC,
  setClock: f => { realNow = f; } };
})();
