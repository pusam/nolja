// 카트 로직 시뮬레이션 테스트: 가짜 DOM으로 스크립트를 돌려 (3D 장면은 WebGL 없이 갱신만)
// 트랙·주행·드리프트·아이템·점프·바퀴 수·CPU 완주·조이콘 핸들·소리를 확인.  실행: node tools/test_kart.js
const fs = require('fs'), vm = require('vm'), path = require('path');
const root = path.join(__dirname, '..');
const files = ['shared/vendor/three.min.js', 'shared/store.js', 'shared/audio.js', 'shared/joycon.js', 'shared/characters.js', 'games/kart/kart.js'];
const scripts = files.map(f => fs.readFileSync(path.join(root, f), 'utf8'));
for (const s of scripts) new vm.Script(s);
console.log('문법 OK');

let now = 1.0;
const noop = () => {};
const draw = { calls: 0, nan: 0, nanAt: '' };
function fakeCtx() {
  const t = {};
  return new Proxy(t, {
    get(o, k) {
      if (k in o) return o[k];
      if (k === 'measureText') return () => ({ width: 60 });
      if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => ({ addColorStop: noop });
      return (...args) => {
        draw.calls++;
        for (const a of args) if (typeof a === 'number' && !Number.isFinite(a)) { draw.nan++; draw.nanAt = String(k); }
      };
    },
    set(o, k, v) { o[k] = v; return true; },
  });
}
const els = {};
function mkEl(id) {
  const cls = new Set(['pause', 'result', 'hidWarn', 'select'].includes(id) ? ['hidden'] : []);
  return {
    id, style: {}, dataset: {}, value: '', checked: false, textContent: '', innerHTML: '', tagName: 'DIV',
    classList: { add: c => cls.add(c), remove: c => cls.delete(c), contains: c => cls.has(c), toggle: (c, f) => { const on = f === undefined ? !cls.has(c) : !!f; on ? cls.add(c) : cls.delete(c); } },
    addEventListener: noop, blur: noop, getContext: () => fakeCtx(), width: 0, height: 0, replaceWith: noop, prepend: noop,
  };
}
const el = id => els[id] || (els[id] = mkEl(id));
const errors = [];
const windowEvents = {};
let randomSeed = 0x2468ace1;   // CPU 주행·아이템이 실행마다 달라지지 않게 고정
const testMath = Object.create(Math);
testMath.random = () => { randomSeed = (1664525 * randomSeed + 1013904223) >>> 0; return randomSeed / 4294967296; };
let pilotSeed = 0x13579bdf;   // 테스트 코드(아이 운전 흉내 등)가 쓰는 난수도 따로 고정 → 실행할 때마다 똑같이
const prand = () => { pilotSeed = (1103515245 * pilotSeed + 12345) >>> 0; return pilotSeed / 4294967296; };
let pads = [];
// 가짜 WebAudio: 소리 코드가 예외 없이 도는지 확인. 브라우저처럼 값이 NaN이거나 시간이 음수, 지수 변화가 0 이하면 기록
const audioLog = { nodes: 0, starts: 0, bad: [] };
function fakeParam(name) {
  const p = { value: 0, cancelScheduledValues: () => p };
  const check = kind => (v, t) => { if (!Number.isFinite(v) || !Number.isFinite(t) || t < 0 || (kind === 'exp' && v <= 0)) audioLog.bad.push(`${name}.${kind}(${v}, ${t})`); return p; };
  p.setValueAtTime = check('set'); p.linearRampToValueAtTime = check('lin'); p.exponentialRampToValueAtTime = check('exp'); p.setTargetAtTime = check('target');
  return p;
}
function fakeNode(params = []) {
  audioLog.nodes++;
  const n = { connect: x => x, disconnect: noop,
    start: (t = 0) => { audioLog.starts++; if (!Number.isFinite(t) || t < 0) audioLog.bad.push('start ' + t); },
    stop: (t = 0) => { if (!Number.isFinite(t) || t < 0) audioLog.bad.push('stop ' + t); } };
  for (const k of params) n[k] = fakeParam(k);
  return n;
}
class FakeAudioContext {
  constructor() { this.sampleRate = 8000; this.state = 'running'; this.destination = fakeNode(); this.t0 = now; }
  get currentTime() { return Math.max(0, now - this.t0); }
  createGain() { return fakeNode(['gain']); }
  createOscillator() { return fakeNode(['frequency', 'detune']); }
  createBiquadFilter() { return fakeNode(['frequency', 'Q', 'gain']); }
  createBufferSource() { return fakeNode(['playbackRate']); }
  createDynamicsCompressor() { return fakeNode(['threshold', 'ratio', 'attack', 'release', 'knee']); }
  createBuffer(ch, len, rate) { const d = new Float32Array(len); return { length: len, sampleRate: rate, duration: len / rate, getChannelData: () => d }; }
  resume() { this.state = 'running'; return Promise.resolve(); }
  suspend() { this.state = 'suspended'; return Promise.resolve(); }
}
const sandbox = {
  __KT_HEADLESS: '3d',
  Math: testMath,
  AudioContext: FakeAudioContext,
  document: { getElementById: el, createElement: () => mkEl(''), querySelectorAll: () => [], body: mkEl('body'),
    addEventListener: noop, documentElement: { requestFullscreen: noop }, fullscreenElement: null, hidden: false, exitFullscreen: noop },
  navigator: { getGamepads: () => pads },
  performance: { now: () => now * 1000 },
  requestAnimationFrame: noop, localStorage: { getItem: () => null, setItem: noop },
  innerWidth: 1920, innerHeight: 1080, devicePixelRatio: 1,
  console: { log: (...a) => console.log(...a), warn: noop, error: (...a) => errors.push(a.map(String).join(' ')) },
  setTimeout: noop, setInterval: noop, clearTimeout: noop, clearInterval: noop, location: { protocol: 'https:' },
  addEventListener: (name, fn) => { (windowEvents[name] || (windowEvents[name] = [])).push(fn); },
};
sandbox.window = sandbox;
vm.createContext(sandbox);
for (const s of scripts) vm.runInContext(s, sandbox);
const KT = sandbox.__KT, G = KT.game, G3 = KT.G3, TR = KT.TR, karts = KT.karts, KART = KT.KART, JC = KT.joycon, B = JC.BTN, AU = sandbox.Nolja.audio;
const assert = (c, msg) => { if (!c) { console.log('❌ ' + msg); process.exitCode = 1; } else console.log('✅ ' + msg); };
const keyEv = (type, code) => { for (const f of windowEvents[type] || []) f({ code, key: code, repeat: false, preventDefault: noop, target: null }); };
const press = code => keyEv('keydown', code), release = code => keyEv('keyup', code);
const finite = k => [k.x, k.y, k.z, k.a, k.v, k.vl, k.vy, k.s, k.d].every(Number.isFinite);
const wrapA = a => { a = (a + Math.PI) % (2 * Math.PI); if (a < 0) a += 2 * Math.PI; return a - Math.PI; };
// 60fps로 sec초 동안 돌림. each(i)가 false를 돌려주면 멈춤
function run(sec, each) {
  const n = Math.round(sec * 60);
  for (let i = 0; i < n; i++) { now += 1 / 60; KT.update(); if (i % 3 === 0) KT.render(); if (each && each(i) === false) return i; }
  return n;
}
// 카트를 길 위 (s, d)에 길 방향(back이면 반대)으로 세움
function placeK(k, s, d, v = 0, back = false) {
  const p = KT.trackPoint(s, d);
  Object.assign(k, { x: p.x, z: p.z, y: p.y, a: Math.atan2(p.tx, p.tz) + (back ? Math.PI : 0), v, vl: 0, vy: 0, vyG: 0, air: false, rampAir: false, trick: false, hop: false,
    drift: null, driftArm: false, spinT: 0, frozenT: 0, immuneT: 0, boostT: 0, roulT: 0, item: null, stuckT: 0, wrongT: 0, steer: 0, cut: -1,
    ghostT: 0, planeT: 0, cloudT: 0, tinyT: 0, flatT: 0, ufoT: 0, bubbleT: 0 });
  const q = KT.locate(k.x, k.z, Math.floor(((s % KT.L) + KT.L) % KT.L / KT.TR.step) % KT.TR.n); k.seg = q.i; k.s = q.s; k.d = q.d;   // 다리 위·아래 중 제 층으로 (s 근처부터 찾음)
  k.prog = (k.lap - 1) * KT.L + k.s;   // 앞뒤(등수)도 바로 맞춤 (멈춰 둔 카트는 갱신이 안 되니까)
}
function startRace(mode, forceCPU = null) {
  KT.settings.mode = mode; G.forceCPU = forceCPU; G.only = null;
  KT.openSelect(); KT.selReady(0, true); KT.selReady(1, true);
  run(1.3);
  return G.state;
}
const skipCountdown = () => run(3.8);

// ---------- 1. 트랙 ----------
console.log('\n[1] 트랙');
assert(TR.len > 600 && TR.len < 760, `한 바퀴 길이 ${TR.len.toFixed(0)}m (600~760)`);
const p0 = KT.trackPoint(0, 0);
assert(Math.hypot(p0.x + 20, p0.z) < 0.5, '출발선은 첫 컨트롤 포인트 (-20, 0)');
let worstS = 0, worstD = 0;
for (let i = 0; i < 300; i++) {
  const s = prand() * TR.len, d = (prand() - 0.5) * 2 * KT.TRACK.halfW, p = KT.trackPoint(s, d), q = KT.locate(p.x, p.z, -1);
  worstS = Math.max(worstS, Math.abs(KT.sdiff(q.s, s))); worstD = Math.max(worstD, Math.abs(q.d - d));
}
assert(worstS < 0.8 && worstD < 0.35, `길 위 (s,d) → 좌표 → (s,d) 되돌리기 오차 s ${worstS.toFixed(2)}m · d ${worstD.toFixed(2)}m`);
let minR = Infinity; for (let i = 0; i < TR.n; i++) minR = Math.min(minR, 1 / Math.max(1e-6, Math.abs(TR.curv[i])));
assert(minR > 17, `가장 급한 커브 반지름 ${minR.toFixed(1)}m — 최고 속도에서도 핸들로 돌 수 있음 (>17m)`);
let minGap = Infinity;
for (let a = 0; a < TR.n; a += 2) for (let b = a + 2; b < TR.n; b += 2) { const ds = Math.min(b - a, TR.n - (b - a)); if (ds > 90) minGap = Math.min(minGap, Math.hypot(TR.px[a] - TR.px[b], TR.pz[a] - TR.pz[b])); }
assert(minGap > 2 * KT.TRACK.wall + 4, `서로 다른 구간끼리 벽이 겹치지 않음 (가장 가까운 구간 ${minGap.toFixed(0)}m)`);
assert(KT.groundAt(KT.RAMP.s + KT.RAMP.len / 2, 0) > 0.5 && KT.groundAt(KT.RAMP.s - 2, 0) === 0 && KT.groundAt(KT.RAMP.s + KT.RAMP.len + 1, 0) === 0, '점프대 위만 높음');
assert(KT.boxes.length === 15, '아이템 상자 3줄 × 5개');
assert(KT.PANELS.every(p => Math.abs(p.d) <= KT.TRACK.halfW - p.w / 2), '대시 판은 모두 길 안');

// ---------- 2. 시범 레이스 ----------
console.log('\n[2] 시범 레이스 (CPU 6대)');
assert(G.demo && karts.length === 6 && karts.every(k => k.human < 0), '메뉴 뒤 시범 레이스: CPU 6대');
assert(new Set(karts.map(k => k.ch)).size === 6, '시범 레이스 캐릭터가 서로 다름');
const lap0 = karts.map(k => k.lap);
let nanAt = -1;
run(110, i => { if (nanAt < 0 && !karts.every(finite)) nanAt = i; });
assert(nanAt < 0, '110초 동안 모든 카트 위치·속도가 유한함');
assert(karts.every(k => k.lap - lap0[k.slot] >= 3), `110초에 모든 CPU가 3바퀴 이상 (바퀴: ${karts.map(k => k.lap).join(',')})`);
assert(karts.every(k => Math.abs(k.d) <= KT.TRACK.wall), '벽 밖으로 나간 카트 없음');
console.log('   집계:', JSON.stringify(G.stats));
assert(G.stats.rescues <= 2, `CPU가 끼여서 다시 세운 횟수 ${G.stats.rescues} (2 이하)`);
assert(G.stats.items > 5 && G.stats.drifts > 3 && G.stats.tricks > 2, `CPU가 아이템 ${G.stats.items} · 드리프트 부스트 ${G.stats.drifts} · 트릭 ${G.stats.tricks}번`);
assert(audioLog.bad.length === 0 && !AU.eng, '시범 레이스는 조용함 (엔진 소리 없음)');

// ---------- 3. 2인 레이스 완주 → 결과 ----------
console.log('\n[3] 2인 레이스 (사람 자리도 CPU가 운전)');
AU.init();
assert(startRace('2p', true) === 'countdown', '둘 다 준비하면 1.2초 뒤 출발 신호 시작');
const hum = karts.filter(k => k.human >= 0);
assert(karts.length === 6 && hum.length === 2 && hum[0].ch === KT.settings.chars[0] && hum[1].ch === KT.settings.chars[1], '사람 2 + CPU 4, 고른 캐릭터로');
assert(hum.every(k => k.place >= 3 && k.place <= 4), '사람은 가운데 줄에서 출발 (3·4등)');
assert(KT.views().length === 2, '화면 위아래 둘로 나눔');
run(2);
assert(karts.every(k => k.v === 0 && k.lap === 0), '출발 신호 전엔 아무도 안 움직임');
assert(AU.eng && AU.eng.p0 && AU.eng.p1 && AU.mus && AU.mus.name === 'race', '출발 신호 때부터 레이스 곡 + 사람 카트 엔진 소리');
skipCountdown();
assert(G.state === 'race' && karts.some(k => k.v > 5), '출발!');
let resultAt = -1;
run(330, i => { if (G.state === 'result') { resultAt = i; return false; } });
assert(resultAt > 0, `3바퀴 뒤 결과 화면 (${(resultAt / 60).toFixed(0)}초)`);
assert(hum.every(k => k.finished) && G.finishOrder.length >= 2, '사람 둘 다 골인');
assert(new Set(karts.map(k => k.place)).size === 6 && karts.every(k => k.place >= 1 && k.place <= 6), '등수 1~6이 겹치지 않음');
assert(!el('result').classList.contains('hidden') && el('resTitle').textContent.length > 0 && (el('resBody').innerHTML.match(/<li/g) || []).length === 6, '결과 창: 제목 + 6명 순위표');
assert(G3.podium.length === 3 && G3.podium[0].place === 1, '시상대에 1·2·3등');
assert(hum.every(k => k.finishT > 60 && k.finishT < 200), `완주 시간 ${hum.map(k => k.finishT.toFixed(1)).join(' / ')}초`);
const cpuMul = karts.filter(k => k.human < 0).map(k => k.ai.base);
assert(new Set(cpuMul.map(v => v.toFixed(4))).size > 1, 'CPU마다 빠르기가 조금씩 다름 (고무줄이 덮어쓰지 않음)');
const fakeJc = { ok: true, player: 0, kind: 'R', accel: { x: 0, y: 0, z: 1 }, hold: 0 };
JC.handlers.buttons(0, B.B, fakeJc);
assert(G.state === 'result', '결과가 뜬 직후 버튼을 연타해도 바로 다시 출발하지 않음');
run(1);
assert(!AU.eng || (!AU.eng.p0 && !AU.eng.p1), '결과 화면에선 엔진 소리 끔');
run(3.5);
assert(AU.mus && AU.mus.name === 'menu', '축하 음악이 끝나면 다시 메뉴 곡');
JC.handlers.buttons(0, B.B, fakeJc);
assert(G.state === 'countdown' && el('result').classList.contains('hidden'), '조금 지나서 누르면 한 판 더');
assert(errors.length === 0, '레이스 중 예외 없음' + (errors.length ? ': ' + errors[0] : ''));

// ---------- 4. 키보드 조작 (혼자) ----------
console.log('\n[4] 키보드 조작');
startRace('1p');
assert(karts.filter(k => k.human >= 0).length === 1 && KT.views().length === 1 && el('selc1').classList.contains('hidden'), '혼자: 사람 1 + CPU 5, 화면 하나, P2 카드 숨김');
skipCountdown();
const me = KT.humanKart(0);
G.only = [me];
placeK(me, 20, 0, 0);
run(2.5);
assert(me.v > 18, `자동 가속: 버튼 없이 ${me.v.toFixed(1)}m/s까지`);
placeK(me, 20, 0, 18);
const a0 = me.a;
press('KeyD'); run(0.5); release('KeyD');
assert(wrapA(me.a - a0) < -0.2 && me.d > 0.5, `D = 오른쪽으로 돎 (방향 ${wrapA(me.a - a0).toFixed(2)}, 오른쪽 ${me.d.toFixed(1)}m)`);
placeK(me, 20, 0, 18);
press('KeyA'); run(0.5); release('KeyA');
assert(wrapA(me.a - a0) > 0.2 && me.d < -0.5, 'A = 왼쪽으로 돎');
placeK(me, 20, 0, 0);
press('ArrowRight'); run(0.4); release('ArrowRight');
assert(me.d > 0.1, '혼자면 방향키도 P1');
placeK(me, 20, 0, 20);
press('KeyS'); run(1); release('KeyS');
assert(me.v < 3, `S = 브레이크 (${me.v.toFixed(1)}m/s)`);
KT.settings.autoGas = false;
placeK(me, 20, 0, 0); run(1);
assert(me.v === 0, '자동 가속을 끄면 버튼 없인 안 감');
press('KeyW'); run(1.5); release('KeyW');
assert(me.v > 12, 'W = 가속');
KT.settings.autoGas = true;
// 길 밖 풀밭은 느림
placeK(me, 30, 11, 20); run(1.5);
assert(me.offroad && me.v < 13, `풀밭에선 느려짐 (${me.v.toFixed(1)}m/s)`);
// 벽
placeK(me, 30, 8, 22); me.a -= 0.9; const w0 = G.stats.walls;
run(1.5);
assert(Math.abs(me.d) <= KT.TRACK.wall - KART.R + 0.01 && G.stats.walls > w0, `벽을 뚫지 않고 튕김 (d ${me.d.toFixed(2)})`);
// 거꾸로 달리면 경고
placeK(me, 300, 0, 0, true); run(2.5);
assert(me.wrongT > 1.2, '거꾸로 달리면 "반대 방향" 경고');

// ---------- 5. 드리프트 ----------
console.log('\n[5] 드리프트');
placeK(me, 20, -5, 20);
press('Space'); run(0.05); press('KeyD'); run(0.03);
assert(me.drift && me.drift.dir === 1 && me.y > 0, '드리프트 버튼 + 오른쪽 = 오른쪽 드리프트 (살짝 뜀)');
release('KeyD'); press('KeyA');   // 반대로 꺾어 버티며 불꽃 모으기 (길을 따라 거의 곧게)
run(1.6);
release('KeyA');
assert(me.drift && me.drift.level >= 1 && !me.offroad, `반대로 버티기만 해도 1.6초면 파란 불꽃 (단계 ${me.drift && me.drift.level})`);
release('Space'); run(0.05);
assert(me.boostT > 0.5 && !me.drift, `버튼을 떼면 부스트 ${me.boostT.toFixed(2)}초`);
placeK(me, 20, 0, 20);
press('Space'); run(0.05); press('KeyD'); run(0.2); release('KeyD'); release('Space'); run(0.05);
assert(!me.drift && me.boostT === 0, '불꽃이 생기기 전에 떼면 부스트 없음');
{
  // 손맛: 같은 속도로 직선에서 꺾어 보고 얼마나 도는지 (보통 꺾기 vs 드리프트)
  const turned = (keysDown, sec, after = null) => {
    placeK(me, 20, 0, 22); me.speedMul = 1; const a0 = me.a;
    for (const k of keysDown) press(k);
    run(0.2); if (after) { after(); } run(sec - 0.2);
    const deg = Math.abs(wrapA(me.a - a0)) * 180 / Math.PI, drifting = !!me.drift;
    for (const k of ['KeyA', 'KeyD', 'Space']) release(k); run(0.3);
    return { deg, drifting };
  };
  const normalQ = turned(['KeyD'], 0.25).deg, driftQ = turned(['KeyD', 'Space'], 0.25).deg;
  const normal1 = turned(['KeyD'], 1).deg, neutral = turned(['KeyD', 'Space'], 1, () => release('KeyD'));
  const counter = turned(['KeyD', 'Space'], 1, () => { release('KeyD'); press('KeyA'); });
  assert(driftQ > normalQ * 1.2, `드리프트를 걸면 처음 0.25초에도 그냥 꺾기보다 빨리 돎 (${driftQ.toFixed(0)}° > ${normalQ.toFixed(0)}°)`);
  assert(neutral.drifting && neutral.deg > normal1 * 0.85, `드리프트 중 핸들을 가운데 둬도 그냥 끝까지 꺾은 만큼은 돎 (${neutral.deg.toFixed(0)}° · 보통 ${normal1.toFixed(0)}°)`);
  assert(counter.drifting && counter.deg > 20, `드리프트 중 반대로 꺾어도 직진으로 펴지지 않고 완만하게 돎 (${counter.deg.toFixed(0)}°)`);
  // 보이는 것: 드리프트를 걸면 차체가 한 번에 꺾이지 않고 부드럽게 기울어짐
  placeK(me, 20, 0, 22); press('KeyD'); press('Space'); run(0.12); KT.render();
  const early = Math.abs(me.mesh.driftYaw || 0); run(0.5); KT.render();
  const later = Math.abs(me.mesh.driftYaw || 0);
  release('KeyD'); release('Space'); run(0.3);
  assert(early > 0 && early < later && later > 0.3, `드리프트 차체 각도가 부드럽게 커짐 (${early.toFixed(2)} → ${later.toFixed(2)})`);
}

// ---------- 6. 점프대 · 트릭 · 대시 판 ----------
console.log('\n[6] 점프대 · 트릭 · 대시 판');
placeK(me, KT.RAMP.s - 30, 0, 22);
let flew = false, maxY = 0, tricked = false;
run(4, () => { maxY = Math.max(maxY, me.y); if (me.rampAir && !tricked) { flew = true; press('Space'); tricked = true; run(0.05); release('Space'); } if (flew && !me.air) return false; });
assert(flew && maxY > 1.5, `점프대에서 날아감 (최고 ${maxY.toFixed(2)}m)`);
assert(me.boostT > 0.4, '공중에서 드리프트 버튼 = 트릭 → 착지하며 부스트');
placeK(me, KT.RAMP.s - 30, 0, 22);
run(4, () => { if (me.rampAir && !me.trick) { press('Space'); run(0.05); release('Space'); KT.spinOut(me, 'zap'); } if (me.trick === false && me.spinT > 0 && !me.air) return false; });
assert(me.boostT === 0, '트릭 뒤 공중에서 맞으면 착지 부스트 없음');
// 점프대 옆·뒤로 들어가도 하늘로 튕겨 나가지 않음 (옆면은 벽처럼)
let worstY = 0;
for (let trial = 0; trial < 60; trial++) {
  const side = trial % 2 ? 1 : -1, s0 = KT.RAMP.s + 1 + (trial * 7 % 10), d0 = side * (9.4 + (trial % 5) * 0.6);
  placeK(me, s0, d0, 8 + (trial % 4) * 5);
  me.a += side * (Math.PI / 2 - 0.3 + (trial % 3) * 0.3);   // 길 방향에서 점프대 쪽으로 꺾어서
  run(2, () => { worstY = Math.max(worstY, me.y); });
}
assert(worstY < 2.6, `점프대 옆면으로 들어가도 높이 ${worstY.toFixed(2)}m 안 (위로 튕겨 나가지 않음)`);
placeK(me, KT.PANELS[1].s - 15, KT.PANELS[1].d, 18); run(1.2);
assert(me.boostT > 0, '대시 판을 밟으면 부스트');

// ---------- 7. 아이템 ----------
console.log('\n[7] 아이템');
const cpu = karts.find(k => k.human < 0);
G.only = [me, cpu];
const row = 84, box = KT.boxes.find(b => b.s === row && b.d === 0);
placeK(me, row - 12, 0, 15); placeK(cpu, 200, 0, 0);
run(1.2);
assert(!box.alive && (me.roulT > 0 || me.item), '상자를 지나가면 룰렛');
run(1.2);
assert(KT.ITEM_KEYS.includes(me.item), `룰렛이 멈추면 아이템: ${me.item}`);
const useKey = () => { press('KeyE'); run(0.05); release('KeyE'); run(0.05); };   // 아이템은 누르는 순간 한 번
me.item = 'boost'; placeK(me, 40, 0, 15); me.item = 'boost';
useKey();
assert(me.boostT > 1.3 && me.v > KART.VMAX, 'E = 불꽃 대시');
placeK(me, 40, 0, 15); me.item = 'zap'; placeK(cpu, 75, 2, 12);
const spins0 = G.stats.spins;
useKey();
run(3);
assert(G.stats.spins > spins0 && cpu.spinAt > 0, '번개 구슬이 앞 카트를 따라가서 맞힘');
G.only = [me];
placeK(me, 120, 2, 10); me.item = 'trap';
useKey();
assert(KT.traps.length > 0 && KT.traps[KT.traps.length - 1].owner === me, '물방울 함정을 뒤에 놓음');
const tr = KT.traps[KT.traps.length - 1];
run(1.1);   // 놓은 사람도 1초 뒤부턴 밟으면 미끄러짐
placeK(me, tr.s - 12, tr.d, 12);
const spins1 = G.stats.spins;
run(2);
assert(G.stats.spins > spins1 && !KT.traps.includes(tr), '함정을 밟으면 빙글 돌고 함정은 사라짐');
const before = G.stats.spins; KT.spinOut(me, 'zap');
assert(G.stats.spins === before, '맞은 직후엔 잠깐 무적');

// ---------- 8. 바퀴 수 ----------
console.log('\n[8] 바퀴 수');
G.only = [me];
placeK(me, KT.L - 4, 0, 12); me.lap = 1;
run(1);
assert(me.lap === 2, '출발선을 앞으로 지나면 한 바퀴');
placeK(me, 4, 0, 0, true); me.lap = 2;
run(1.5);
assert(me.lap === 1, '거꾸로 지나면 다시 빼서 꼼수 방지');

// ---------- 9. 로켓 스타트 · 일시정지 ----------
console.log('\n[9] 로켓 스타트 · 일시정지');
startRace('1p'); G.only = null;
run(2.95);   // 출발 0.65초 전
press('KeyW'); run(0.8); release('KeyW');
const me2 = KT.humanKart(0);
assert(G.state === 'race' && me2.boostT > 0, '출발 직전에 가속을 누르고 있으면 로켓 스타트');
let prevented = false;
for (const f of windowEvents.keydown) f({ code: 'Slash', key: '/', repeat: false, preventDefault: () => { prevented = true; }, target: null });
release('Slash');
assert(prevented, "경주 중엔 게임 키('/' 등)의 브라우저 기본 동작을 막음");
G.only = [me2]; placeK(me2, KT.L - 3, 0, 15); me2.lap = G.laps - 1;
run(0.6);
assert(me2.lap === G.laps && AU.mus && AU.mus.rate > 1.1, '마지막 바퀴면 곡이 빨라짐');
press('Escape');
assert(G.paused && !el('pause').classList.contains('hidden'), 'Esc = 일시정지');
const tP = KT.T(); run(1);
assert(Math.abs(KT.T() - tP) < 1e-9, '일시정지 동안 시간 멈춤');
press('Escape');
assert(!G.paused, 'Esc = 계속');
run(0.2);
assert(AU.mus && AU.mus.name === 'race' && AU.mus.rate > 1.1, '일시정지했다 돌아와도 마지막 바퀴 빠르기 그대로');
G.only = null;

// ---------- 10. 조이콘 핸들 ----------
console.log('\n[10] 조이콘 핸들');
const deg = d => Math.sin(d * Math.PI / 180);
const jcR = { ok: true, player: 0, kind: 'R', accel: { x: -deg(30), y: 0, z: Math.cos(30 * Math.PI / 180) }, hold: 0, stick: { x: 2048, y: 2048 } };
assert(KT.joySteer(0, jcR) > 0.95, 'R 조이콘을 가로로 쥐고 오른쪽으로 30° = 핸들 오른쪽 끝');
jcR.accel = { x: deg(15), y: 0, z: Math.cos(15 * Math.PI / 180) };
const half = KT.joySteer(0, jcR);
assert(half < -0.4 && half > -0.6, `왼쪽으로 15° = 왼쪽 반쯤 (${half.toFixed(2)})`);
const jcL = { ok: true, player: 1, kind: 'L', accel: { x: deg(30), y: 0, z: Math.cos(30 * Math.PI / 180) }, hold: 0, stick: { x: 2048, y: 2048 } };
assert(KT.joySteer(1, jcL) > 0.95, 'L 조이콘은 축이 반대: 오른쪽으로 30° = 오른쪽 끝');
KT.settings.flip[1] = true;
assert(KT.joySteer(1, jcL) < -0.95, "'핸들 방향 반대로'를 켜면 반대");
KT.settings.flip[1] = false;
jcR.accel = { x: 0.97, y: 0.2, z: 0.1 };
assert(KT.joySteer(0, jcR) === 0 && KT.tilt[0].upright, '세로로 들고 있으면 핸들 0 + 가로로 잡으라는 안내');
jcR.accel = { x: deg(2), y: 0, z: 1 };
assert(KT.joySteer(0, jcR) === 0, '3° 안쪽 흔들림은 무시');
jcR.stick = { x: 2048, y: 2048 + 1100 };
assert(KT.joySteer(0, jcR) > 0.8, 'R 스틱을 오른쪽(가로로 쥐었을 때)으로 세게 밀어도 핸들');
KT.settings.flip[0] = true;
assert(KT.joySteer(0, jcR) > 0.8, "'핸들 방향 반대로'는 기울기에만 (스틱은 그대로)");
KT.settings.flip[0] = false;
jcR.stick = { x: 2048, y: 2048 };
const pro = { ok: true, player: 0, kind: 'pro', accel: { x: 0, y: 0, z: 1 }, hold: 0, stick: { x: 2048 - 1000, y: 2048 } };
assert(KT.joySteer(0, pro) < -0.6, '프로콘은 왼쪽 스틱');
// 조이콘을 연결한 것처럼: 기울기 + 버튼이 카트로
G.only = [me2]; placeK(me2, 30, 0, 15);
jcR.accel = { x: -deg(20), y: 0, z: Math.cos(20 * Math.PI / 180) }; jcR.hold = B.X | B.SR;
JC.list.push(jcR);
run(0.3);
assert(me2.ctl.steer > 0.4 && me2.ctl.gasBtn && me2.ctl.drift, `조이콘 기울기·버튼이 카트로 (핸들 ${me2.ctl.steer.toFixed(2)})`);
jcR.hold = B.SL; run(0.05);
assert(me2.ctl.item, 'SL = 아이템');
jcR.hold = 0; JC.list.length = 0; run(0.1);

// ---------- 11. 캐릭터 선택 (조이콘 · 패드) ----------
console.log('\n[11] 캐릭터 선택');
KT.toMenu(); KT.settings.mode = '2p'; KT.openSelect();
const i0 = KT.sel[0].idx;
jcR.accel = { x: -deg(25), y: 0, z: Math.cos(25 * Math.PI / 180) }; JC.list.push(jcR);
run(0.1);
assert(KT.sel[0].idx === (i0 + 1) % KT.CHARS.length, '조이콘을 오른쪽으로 기울이면 다음 캐릭터');
run(0.7);
assert(KT.sel[0].idx === (i0 + 2) % KT.CHARS.length, '계속 기울이고 있으면 0.5초마다 한 칸 더');
jcR.accel = { x: 0, y: 0, z: 1 }; run(0.1);
JC.handlers.buttons(0, B.X, jcR);
assert(KT.sel[0].ready, '조이콘 버튼 = 준비');
jcR.accel = { x: -deg(25), y: 0, z: Math.cos(25 * Math.PI / 180) }; const iReady = KT.sel[0].idx; run(0.3);
assert(KT.sel[0].idx === iReady, '준비하면 기울여도 안 바뀜');
JC.handlers.buttons(0, B.A, jcR);
assert(!KT.sel[0].ready, '브레이크 자리 버튼 = 준비 취소');
JC.list.length = 0;
pads = [{ index: 0, id: 'Xbox', connected: true, mapping: 'standard', axes: [0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) }];
pads[0].buttons[15].pressed = true; run(0.05); pads[0].buttons[15].pressed = false; run(0.05);
assert(KT.sel[0].idx === (iReady + 1) % KT.CHARS.length, '게임패드 → 다음 캐릭터');
pads = [];

// 2인: 조이콘 하나(P1) + 게임패드 하나면 패드는 P2
startRace('2p'); skipCountdown();
jcR.accel = { x: 0, y: 0, z: 1 }; jcR.hold = 0; JC.list.push(jcR);
pads = [{ index: 0, id: 'Xbox', connected: true, mapping: 'standard', axes: [1, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) }];
run(0.1);
assert(KT.humanKart(1).ctl.steer > 0.9 && Math.abs(KT.humanKart(0).ctl.steer) < 0.1, '조이콘 P1 + 게임패드면 패드는 P2를 조종');
pads = []; JC.list.length = 0;

// ---------- 12. 난이도 (아이 운전 흉내) ----------
console.log('\n[12] 난이도');
// 조이콘 기울기로 운전하는 아이: 0.3초 늦게 보고, 손이 흔들리고, 길 가운데 ±3m를 왔다갔다, 가끔 0.6초 딴짓
function kidRace(level, seed, laps = 3) {
  randomSeed = seed >>> 0; pilotSeed = (seed ^ 0x5bd1e995) >>> 0;
  KT.settings.cpuLevel = level; KT.settings.laps = laps; JC.list.length = 0;
  const jc = { ok: true, player: 0, kind: 'R', accel: { x: 0, y: 0, z: 1 }, hold: 0, stick: { x: 2048, y: 2048 } };
  startRace('1p'); JC.list.push(jc);
  const me = KT.humanKart(0), hist = [], st = { wander: 0, wanderAt: 0, idle: 0, noise: 0 };
  let zaps = 0;
  run(300, () => {
    if (G.state === 'result') return false;
    if (G.state !== 'race' || me.finished) return;
    for (const k of karts) if (k.human < 0 && k.item === 'zap') zaps++;
    hist.push({ x: me.x, z: me.z, a: me.a, s: me.s, v: me.v }); if (hist.length > 18) hist.shift();
    const seen = hist[0], t = KT.T();
    if (t > st.wanderAt) { st.wander = (prand() - 0.5) * 6; st.wanderAt = t + 2 + prand() * 3; }
    if (t > st.idle && prand() < 1 / 480) st.idle = t + 0.6;
    if (t < st.idle) return;
    const q = KT.trackPoint(seen.s + 9 + seen.v * 0.3, st.wander);
    const err = wrapA(Math.atan2(q.x - seen.x, q.z - seen.z) - seen.a);
    st.noise += ((prand() - 0.5) * 0.9 - st.noise) * 0.08;
    const steer = Math.max(-1, Math.min(1, -err * 1.6 + st.noise)), ang = (3 + Math.abs(steer) * 25) * Math.sign(steer) * Math.PI / 180;
    jc.accel = { x: -Math.sin(ang), y: 0, z: Math.cos(ang) };
    jc.hold = me.item && prand() < 0.02 ? B.B : 0;
  });
  JC.list.length = 0;
  return { place: me.place, zaps };
}
const easy = [kidRace(0, 1000), kidRace(0, 1077), kidRace(0, 1154)], hard = [1026, 1103, 1180, 1257, 1334].map(seed => kidRace(2, seed));   // 어려움은 운에 덜 휘둘리게 다섯 판
const avgPlace = rs => rs.reduce((a, r) => a + r.place, 0) / rs.length;
assert(avgPlace(easy) <= 2, `쉬움: 아이처럼 흔들리며 달려도 평균 ${avgPlace(easy).toFixed(1)}등 (2등 안)`);
assert(easy.every(r => r.zaps === 0), '쉬움 CPU는 번개 구슬을 안 씀');
assert(avgPlace(hard) >= 2.5 && hard.filter(r => r.place === 1).length <= 1, `어려움: 같은 운전이면 평균 ${avgPlace(hard).toFixed(1)}등 · 1등 ${hard.filter(r => r.place === 1).length}/5 (쉽게 못 이김, 등수 ${hard.map(r => r.place).join(',')})`);
{
  startRace('1p'); KT.settings.cpuLevel = 0; skipCountdown();
  const cpuK = karts.find(k => k.human < 0), meK = KT.humanKart(0);
  G.only = [cpuK, meK]; cpuK.ai.base = cpuK.speedMul = 0.78;
  placeK(cpuK, 20, -4, 15); placeK(meK, 20, 4, 15); cpuK.boostT = meK.boostT = 2; run(1.2);
  assert(cpuK.v < meK.v - 3, `CPU 부스트도 실력만큼만 빨라짐 (쉬움 CPU ${cpuK.v.toFixed(1)} · 사람 ${meK.v.toFixed(1)}m/s)`);
  G.only = null; KT.settings.cpuLevel = 1;
}

// ---------- 13. 새 손맛: 드리프트 3단계 · 슬립스트림 · 새 아이템 · 시간 제한 · 바퀴 ----------
console.log('\n[13] 드리프트 3단계 · 슬립스트림 · 새 아이템 · 시간 제한');
KT.settings.cpuLevel = 1; startRace('1p'); skipCountdown();
{
  const me = KT.humanKart(0), cpu = karts.find(k => k.human < 0);
  G.only = [me];
  placeK(me, 20, -5, 20);
  press('Space'); run(0.05); press('KeyD'); run(0.03); release('KeyD'); press('KeyA');
  run(0.4); me.drift.charge = KT.DRIFT[3].charge - 0.2;   // 길이 짧아 3초를 다 버틸 수 없으니 거의 다 모은 것으로
  run(0.4); release('KeyA');
  assert(me.drift && me.drift.level === 3, `오래 버티면 분홍 불꽃 3단계 (단계 ${me.drift && me.drift.level})`);
  release('Space'); run(0.05);
  assert(me.boostT > 1.6, `3단계에서 떼면 울트라 부스트 ${me.boostT.toFixed(2)}초`);
  // 슬립스트림: 앞 카트 바로 뒤에 붙어 달리면 부스트
  G.only = [me, cpu]; placeK(cpu, 60, 0, 21); placeK(me, 52, 0, 21); cpu.speedMul = cpu.ai.base = 1; me.draft = 0;
  const b0 = G.stats.boosts; let drafted = false;
  run(2.5, () => { if (me.boostT > 0 && G.stats.boosts > b0) { drafted = true; return false; } });
  assert(drafted, '앞 카트 바로 뒤에 1.3초 붙어 있으면 슬립스트림 부스트');
  // 불꽃 대시 ×3: 세 번 나눠 씀
  G.only = [me]; placeK(me, 40, 0, 15); me.item = 'triple'; me.itemN = 3;
  const useE = () => { press('KeyE'); run(0.05); release('KeyE'); run(0.05); };
  useE(); assert(me.item === 'triple' && me.itemN === 2 && me.boostT > 1, '불꽃 대시 ×3: 한 번 쓰면 ×2 남음');
  useE(); useE();
  assert(me.item === null && me.itemN === 0, '세 번 다 쓰면 끝');
  // 반짝 별: 무적 + 부딪힌 카트는 빙글
  G.only = [me, cpu]; placeK(me, 40, 0, 15); placeK(cpu, 47, 0, 5); me.item = 'star';
  const s0 = G.stats.spins; useE();
  assert(me.starT > 5, '반짝 별: 6초 동안');
  run(1.2);
  assert(G.stats.spins > s0 && cpu.spinAt > 0 && me.spinT === 0, '반짝 별로 부딪히면 상대만 빙글');
  assert(!KT.spinOut(me, 'zap'), '반짝 별이면 번개 구슬도 함정도 안 통함');
  G.only = null;
}
{
  // 시간 제한: 2인에서 한 명이 멈춰 있어도 먼저 들어온 사람 뒤 45초면 결과
  startRace('2p', true); skipCountdown();
  const p2 = KT.humanKart(1);
  G.only = karts.filter(k => k !== p2);
  let shown = -1;
  run(330, i => { if (G.state === 'result') { shown = i; return false; } });
  assert(shown > 0 && !p2.finished && KT.humanKart(0).finished, `안 움직이는 사람이 있어도 시간 제한으로 결과 (${(shown / 60).toFixed(0)}초)`);
  assert(karts.filter(k => k.human >= 0).every(k => k.place >= 1), '안 들어온 사람도 지금 자리로 등수');
  G.only = null; G.forceCPU = null;
}
{
  // 바퀴: 보이는 카트마다 4개, 굴러감
  startRace('1p'); skipCountdown(); run(1);
  const vis = G3.karts.filter(m => m.group.visible).length;
  assert(G3.wheels.count === vis * 4, `바퀴 ${G3.wheels.count}개 = 보이는 카트 ${vis}대 × 4`);
  const m0 = KT.humanKart(0).mesh, sp0 = m0.spin; run(0.2);
  assert(m0.spin !== sp0, '달리면 바퀴가 굴러감');
}

// ---------- 14. 코스 넷: 바닷가 · 눈꽃 마을 · 사탕 공원 ----------
console.log('\n[14] 기본 코스 넷');
assert(KT.COURSES.length === 10 && KT.COURSES.every(c => c.cps[0][1] === 0 && c.cps[1][1] === 0) && KT.COURSES.filter(c => c.hard).length === 6 && KT.COURSES.filter(c => c.big).length === 2, '코스 10개 (도전 코스 넷 · 아주 큰 맵 둘) · 모두 출발선이 z=0 직선');
assert(KT.CUPS.map(c => c.courses.join()).join(' | ') === '0,1,2,3 | 4,5,6,7', '그랑프리 컵 둘: 몬스터 컵은 기본 코스 넷, 도전 컵은 도전 코스 넷');
// (s, d)가 든 바닥 구역 (kart.js zoneAt과 같은 규칙)
const zoneOf = (s, d) => KT.ZONES.find(z => { const u = KT.sdiff(s, z.s); return u >= 0 && u <= z.len && d >= z.d0 && d <= z.d1; }) || null;
const halfRoad = z => z.d1 - z.d0 < 2 * KT.TRACK.halfW;
function checkCourse(i) {
  KT.settings.course = i; KT.toMenu(); KT.switchCourse(i); KT.toMenu();
  const C = KT.COURSES[i], T2 = KT.TR, nm = C.name;
  assert(KT.COURSE === C && G3.courseFor === C, `${nm}: 코스를 바꾸면 길과 장면을 새로 만듦`);
  assert(T2.len > 600 && T2.len < 800, `${nm}: 한 바퀴 ${T2.len.toFixed(0)}m`);
  let r2 = Infinity; for (let j = 0; j < T2.n; j++) r2 = Math.min(r2, 1 / Math.max(1e-6, Math.abs(T2.curv[j])));
  assert(r2 > 17, `${nm}: 가장 급한 커브 반지름 ${r2.toFixed(1)}m`);
  let g2 = Infinity;
  for (let a = 0; a < T2.n; a += 2) for (let b = a + 2; b < T2.n; b += 2) { const ds = Math.min(b - a, T2.n - (b - a)); if (ds > 90) g2 = Math.min(g2, Math.hypot(T2.px[a] - T2.px[b], T2.pz[a] - T2.pz[b])); }
  assert(g2 > 2 * KT.TRACK.wall + 4, `${nm}: 구간끼리 벽이 안 겹침 (${g2.toFixed(0)}m)`);
  const p20 = { ...KT.trackPoint(20, 0) }, p40 = { ...KT.trackPoint(40, 0) };   // trackPoint는 같은 객체를 돌려줌
  assert(Math.abs(p20.z) < 1 && Math.abs(p40.z) < 1 && p40.x > p20.x, `${nm}: 출발선 부근은 +x 직선 (선택 화면·시상대 자리)`);
  const onZone = s => KT.ZONES.some(z => { const u = KT.sdiff(s, z.s); return u > -2 && u < z.len + 2; });
  assert(!KT.PANELS.some(p => onZone(p.s)) && !KT.BOX_ROWS.some(onZone) && !onZone(KT.RAMP.s) && KT.boxes.length === 15, `${nm}: 대시 판·상자·점프대는 물·늪·얼음과 안 겹침 · 상자 15개`);
  const lapB = karts.map(k => k.lap), r0 = G.stats.rescues;
  let bad = -1, puddleT = 0;
  run(75, j => {
    if (bad < 0 && !karts.every(finite)) bad = j;
    for (const k of karts) { const z = zoneOf(k.s, k.d); if (z && halfRoad(z) && z.type !== 'ice') puddleT += 1 / 60; }
  });
  assert(bad < 0 && karts.every(k => k.lap - lapB[k.slot] >= 2), `${nm} 시범 레이스: 75초에 모두 2바퀴 이상 (${karts.map(k => k.lap).join(',')})`);
  assert(G.stats.rescues - r0 <= 2, `${nm}: 끼여서 다시 세운 횟수 ${G.stats.rescues - r0}`);
  return puddleT;
}
// 점프대를 빠르게 타면 바로 뒤 물길(개울·초콜릿 강)을 뛰어넘음, 천천히 들어가면 첨벙
function jumpOver(label) {
  const me = KT.humanKart(0), river = KT.ZONES.find(z => !halfRoad(z));
  placeK(me, river.s - 6, 0, 8);   // 점프대 옆이 아니라 물길 바로 앞에서 천천히
  let wet = false, minV = 99;
  run(1.6, () => { if (me.wet) { wet = true; minV = Math.min(minV, me.v); } });
  assert(wet && minV < KT.KART.VMAX * 0.65, `천천히 ${label}에 들어가면 첨벙 (느려짐 ${minV.toFixed(1)}m/s)`);
  placeK(me, KT.RAMP.s - 30, 0, 23); wet = false; let flew = false;
  run(3, () => { if (me.rampAir) flew = true; if (me.wet) wet = true; });
  assert(flew && !wet, `빠르게 점프대를 타면 ${label}을 뛰어넘음`);
}
{
  checkCourse(1);
  const creek = KT.ZONES.find(z => z.type === 'water');
  assert(creek && KT.inCreek(creek.s + 3, 0) && !KT.inCreek(creek.s - 3, 0) && KT.sdiff(creek.s, KT.RAMP.s) > 0, '바닷가: 개울은 점프대 바로 뒤');
  startRace('1p'); skipCountdown(); G.only = [KT.humanKart(0)];
  assert(KT.COURSE.name === '노을 바닷가', '레이스도 고른 코스에서');
  jumpOver('개울');
  G.only = null;
}
{
  checkCourse(2);
  const ice = KT.ZONES.find(z => z.type === 'ice' && !halfRoad(z));
  assert(ice && !KT.inCreek(ice.s + 3, 0) && G3.snowfall, '눈꽃 마을: 길 전체 얼음판 (물 아님) · 내리는 눈');
  startRace('1p'); skipCountdown();
  const me = KT.humanKart(0); G.only = [me];
  const steerTest = s => {   // 같은 속도로 0.6초 동안 오른쪽 끝까지 꺾기
    placeK(me, s, 0, 18); press('KeyD'); const a0 = me.a; let vl = 0;
    run(0.6, () => { vl = Math.max(vl, Math.abs(me.vl)); });
    release('KeyD'); run(0.05);
    return { turn: Math.abs(wrapA(me.a - a0)), vl, zone: me.zone, v: me.v };
  };
  const road = steerTest(ice.s - 60), slick = steerTest(ice.s + 4);
  assert(slick.zone === 'ice' && slick.turn < road.turn * 0.8, `얼음판에선 핸들이 덜 먹음 (${slick.turn.toFixed(2)} < ${road.turn.toFixed(2)} rad)`);
  assert(slick.vl > road.vl * 1.5, `얼음판에선 옆으로 미끄러짐 (${slick.vl.toFixed(1)} > ${road.vl.toFixed(1)} m/s)`);
  assert(slick.v > KT.KART.VMAX * 0.7, '얼음판은 느려지진 않음');
  G.only = null;
}
{
  const puddleT = checkCourse(3);
  assert(puddleT < 8, `사탕 공원: CPU는 길 한쪽 초콜릿 늪을 피해 감 (모두 합쳐 ${puddleT.toFixed(1)}초)`);
  startRace('1p'); skipCountdown();
  const me = KT.humanKart(0); G.only = [me];
  const mud = KT.ZONES.find(z => z.type === 'mud' && halfRoad(z));
  placeK(me, mud.s + 2, (mud.d0 + mud.d1) / 2, 20); let wet = false, slowV = 99;
  run(1.2, () => { if (me.wet) { wet = true; slowV = Math.min(slowV, me.v); } });
  assert(wet && slowV < KT.KART.VMAX * 0.7, `초콜릿 늪에 빠지면 느려짐 (${slowV.toFixed(1)}m/s)`);
  placeK(me, mud.s + 2, mud.d1 + 2.5, 20); wet = false;
  run(1.2, () => { if (me.wet) wet = true; });
  assert(!wet, '늪 옆 길로 비켜 가면 괜찮음');
  jumpOver('초콜릿 강');
  G.only = null;
}
KT.settings.course = 0; KT.toMenu(); KT.switchCourse(0); KT.toMenu();
assert(KT.COURSE.name === '몬스터 서킷' && !G3.snowfall, '다시 몬스터 서킷으로 (내리는 눈도 사라짐)');

// ---------- 15. 그랑프리 ----------
console.log('\n[15] 그랑프리 (몬스터 컵)');
{
  const GP = KT.gp, txt = id => els[id] ? els[id].textContent : '', html = id => els[id] ? els[id].innerHTML : '';
  KT.settings.gp = 1; KT.settings.laps = 1; KT.settings.cpuLevel = 1;
  KT.toMenu();
  assert(KT.COURSE === KT.COURSES[KT.GP_COURSES[0]] && !GP.on, '그랑프리를 고르면 메뉴 뒤 시범 레이스는 첫 코스');
  startRace('1p', true);   // 사람 카트도 CPU처럼 달리게
  assert(GP.on && GP.race === 0 && KT.COURSE === KT.COURSES[KT.GP_COURSES[0]], '레이서를 고르면 첫 코스부터 그랑프리 시작');
  const roster = karts.map(k => k.ch).join(','), me = KT.humanKart(0).ch;
  let sameRoster = true, coursesOk = true, pointsOk = true, midUi = true;
  for (let r = 0; r < 4; r++) {
    if (r > 0) { run(1.6); press('Enter'); release('Enter'); }   // 결과가 뜨고 1.5초 뒤 Enter = 다음 코스
    coursesOk = coursesOk && GP.race === r && KT.COURSE === KT.COURSES[KT.GP_COURSES[r]];
    sameRoster = sameRoster && karts.map(k => k.ch).join(',') === roster;
    skipCountdown();
    run(240, () => { if (G.state === 'result') return false; });
    const sum = GP.pts.reduce((a, b) => a + b, 0), perRace = KT.GP_POINTS.reduce((a, b) => a + b, 0);
    pointsOk = pointsOk && G.state === 'result' && GP.scored === r && sum === perRace * (r + 1) && GP.places.every(pl => pl.length === r + 1);
    if (r < 3) midUi = midUi && html('btnAgain').includes('다음 코스') && els.btnReselect.classList.contains('hidden') && txt('resEyebrow') === `MONSTER CUP · RACE ${r + 1} / 4` && txt('btnMenu') === '그랑프리 그만두기';
  }
  assert(coursesOk, '코스 네 개를 차례로 (1 → 2 → 3 → 4)');
  assert(sameRoster && KT.humanKart(0).ch === me, '네 코스 내내 같은 레이서 6명');
  assert(pointsOk, `레이스마다 등수대로 점수 (10·8·6·4·2·1, 모두 합 ${GP.pts.reduce((a, b) => a + b, 0)}점)`);
  assert(midUi, '중간 결과: 다음 코스 버튼 · 레이서 바꾸기 숨김 · 몇 번째 레이스인지');
  // 마지막: 종합 순위표 · 종합 시상대 · 트로피
  const st = karts.slice().sort((a, b) => GP.pts[b.slot] - GP.pts[a.slot] || GP.places[a.slot][3] - GP.places[b.slot][3]);
  KT.render();
  const podium = G3.podium.slice().sort((a, b) => a.place - b.place).map(r => r.ch.name).join(','), want = st.slice(0, 3).map(k => KT.CHARS[k.ch].name).join(',');
  assert(txt('resEyebrow') === 'MONSTER CUP · FINAL' && /그랑프리 우승!|종합 \d위!/.test(txt('resTitle')), `마지막 결과는 종합 (${txt('resTitle')})`);
  assert(podium === want, `종합 시상대는 점수 1·2·3위 (${podium})`);
  assert(G3.trophy.visible && G3.trophy.position.y > 3, '1위 머리 위에 트로피');
  const rows = (html('resBody').match(/<li/g) || []).length, chips = (html('resBody').match(/<i class="m/g) || []).length;
  assert(rows === 6 && chips === 24 && html('resBody').includes('점<small>+'), '순위표: 6명 × 코스 4개 등수 칸 · 점수');
  assert(html('btnAgain').includes('그랑프리 다시') && !els.btnReselect.classList.contains('hidden'), '끝나면 그랑프리 다시 · 레이서 바꾸기');
  run(1.6); press('Enter'); release('Enter');
  assert(GP.on && GP.race === 0 && GP.pts.every(v => v === 0) && KT.COURSE === KT.COURSES[KT.GP_COURSES[0]] && KT.humanKart(0).ch === me, '그랑프리 다시: 점수 0점에서 첫 코스부터');
  skipCountdown(); run(2);
  KT.pause();
  assert(txt('btnQuit') === '그랑프리 그만두기' && txt('pauseSub').includes('그랑프리'), '그랑프리 중 일시정지: 나가면 끝난다고 알려 줌');
  KT.toMenu();
  assert(!GP.on && !G3.trophy.visible, '메뉴로 나가면 그랑프리 끝');
  // 도전 컵: 도전 코스 넷 (용암 성부터), 화면 글씨도 도전 컵
  KT.settings.gp = 2; KT.toMenu();
  assert(KT.COURSE === KT.COURSES[4] && txt('courseName') === '도전 컵' && txt('lapHint').startsWith('그랑프리 도전 컵: 코스 4개'), `도전 컵을 고르면 메뉴 뒤는 용암 성 (${txt('lapHint')})`);
  startRace('1p', true); skipCountdown();
  run(240, () => { if (G.state === 'result') return false; });
  assert(GP.on && GP.cup === 1 && KT.COURSE === KT.COURSES[4] && txt('resEyebrow') === 'CHALLENGE CUP · RACE 1 / 4' && html('btnAgain').includes('다음 코스 · 구름다리 숲'), `도전 컵 첫 레이스: 용암 성 → 다음은 구름다리 숲 (${txt('resEyebrow')})`);
  KT.toMenu();
  // 그랑프리를 끄면 예전처럼 한 판
  KT.settings.gp = 0; KT.settings.course = 1; KT.toMenu();
  startRace('1p', true); skipCountdown();
  run(240, () => { if (G.state === 'result') return false; });
  assert(!GP.on && KT.COURSE === KT.COURSES[1] && txt('resEyebrow') === 'ACROSS THE FINISH LINE' && html('btnAgain').includes('한 판 더') && !G3.trophyOn, '그랑프리를 끄면 고른 코스 한 판 · 한 판 더');
  KT.settings.laps = 3; KT.settings.course = 0; G.forceCPU = null; KT.toMenu();
}

// ---------- 16. 바퀴 시간 · 기록 · 처음부터 다시 ----------
console.log('\n[16] 바퀴 시간 · 기록 · 처음부터 다시');
{
  const txt = id => els[id] ? els[id].textContent : '';
  KT.settings.gp = 0; KT.settings.course = 0; KT.settings.laps = 3; KT.toMenu();
  startRace('1p'); skipCountdown();
  KT.lodFor(G3.camState[0].cam);   // (WebGL 없이 도는 테스트라 직접 고름)
  const hi = G3.karts.filter(m => m.rider.hi.visible).length;
  assert(hi <= 3 && hi >= 1, `출발선에 몰려 있어도 매끈한 모델은 가까운 3대까지만 (${hi}대)`);
  const me = KT.humanKart(0), L0 = KT.L;
  G.only = [me];
  const cross = () => { placeK(me, L0 - 3, 0, 20); run(0.4); };   // 출발선 바로 앞에서 넘기
  cross();
  assert(me.lap === 1 && me.lapMax === 1 && !me.bestLap, '출발선을 처음 넘으면 1바퀴째 (바퀴 시간은 아직)');
  run(0.6); cross();
  const m = G.msg[0], lap1 = me.bestLap;
  assert(me.lap === 2 && lap1 > 0.5 && lap1 < 2 && me.newLap && /새 기록! 이번 바퀴 0:01/.test(m.sub) && KT.REC[0].lap === lap1, `한 바퀴 돌면 바퀴 시간 · 처음이면 새 기록 (${m.sub})`);
  placeK(me, 2, 0, 15, true); run(0.4);   // 거꾸로 출발선을 넘었다가
  assert(me.lap === 1, '거꾸로 넘으면 바퀴 하나 뺌');
  cross();
  assert(me.lap === 2 && me.bestLap === lap1 && me.lapMax === 2, '다시 넘어도 이미 센 바퀴는 바퀴 시간으로 안 셈');
  run(0.4); cross(); run(0.4); cross();
  assert(me.finished && me.newRace && KT.REC[0].race[3] === me.finishT, `3바퀴를 다 돌면 완주 기록 (${me.finishT.toFixed(1)}초)`);
  run(5, () => { if (G.state === 'result') return false; });
  assert(G.state === 'result' && txt('resRecord').startsWith('★ 새 기록!') && !els.resRecord.classList.contains('hidden') && els.resRecord.classList.contains('new'), `결과 화면에 새 기록 (${txt('resRecord')})`);
  KT.toMenu();
  assert(txt('lapHint').endsWith(`최고 바퀴 0:0${KT.REC[0].lap.toFixed(1)}`), `메뉴에 이 코스 최고 바퀴 (${txt('lapHint')})`);
  // 일시정지 → 처음부터 다시: 같은 코스를 새로 출발 (그랑프리면 같은 코스·같은 레이서, 점수는 그대로)
  KT.settings.gp = 1; KT.toMenu(); startRace('1p', true); skipCountdown();
  run(240, () => { if (G.state === 'result') return false; });
  KT.resultNext(); skipCountdown(); run(3);
  const pts = KT.gp.pts.join(','), roster = karts.map(k => k.ch).join(','), course = KT.COURSE;
  KT.pause(); els.btnRestart.onclick();
  assert(!G.paused && G.state === 'countdown' && KT.gp.on && KT.gp.race === 1 && KT.COURSE === course && karts.map(k => k.ch).join(',') === roster && KT.gp.pts.join(',') === pts && karts.every(k => k.lap === 0),
    '일시정지에서 처음부터 다시: 그랑프리 같은 코스 · 같은 레이서 · 점수 그대로');
  KT.settings.gp = 0; G.only = null; G.forceCPU = null; KT.toMenu();
}

// ---------- 17. 코스마다 레이스 곡 · 주변 소리 ----------
console.log('\n[17] 코스마다 레이스 곡 · 주변 소리');
{
  const songs = [], ambs = [];
  let menuQuiet = true;
  for (let c = 0; c < KT.COURSES.length; c++) {
    KT.settings.course = c; KT.settings.gp = 0; KT.toMenu(); run(0.2);
    menuQuiet = menuQuiet && !AU.nat;
    startRace('1p', true); skipCountdown(); run(0.5);
    songs.push(AU.mus && AU.mus.name); ambs.push(AU.nat && AU.nat.kind);
    for (let i = 0; i < 120; i++) { run(0.1); AU.pump(); AU.naturePump(); }   // 테스트엔 타이머가 없어서 곡·주변 소리를 직접 12초 돌림 (파도·갈매기·바람·풍경·새까지)
  }
  assert(songs.join(',') === KT.COURSES.map(c => c.song).join(',') && new Set(songs).size === 10, `코스마다 다른 레이스 곡 (${songs.join(', ')})`);
  assert(ambs.join(',') === 'meadow,beach,snow,candy,lava,meadow,beach,candy,canyon,city' && menuQuiet, `코스마다 주변 소리 (새 코스는 비슷한 곳 소리), 메뉴에선 없음 (${ambs.join(', ')})`);
  KT.pause(); run(0.1);
  const pausedQuiet = !AU.nat;
  KT.resume(); run(0.1);
  assert(pausedQuiet && AU.nat && AU.nat.kind === 'city', '일시정지면 주변 소리를 끄고, 다시 달리면 켬');
  KT.toMenu(); run(0.1);
  assert(!AU.nat && AU.mus && AU.mus.name === 'menu', '메뉴로 나가면 주변 소리 없이 메뉴 곡');
  const S = AU.SONGS, okSong = k => S[k] && S[k].chords.length === 8 && S[k].melody.length === 8 && S[k].melody.every(bar => bar.every(([at, n, len]) => at >= 0 && at + len <= 16 && n >= 60 && n <= 96));
  assert(['beach', 'snow', 'candy', 'lava', 'forest', 'coast', 'coaster', 'canyon', 'city'].every(okSong), '코스 곡 악보: 8마디 · 음 위치·높이가 정상');
  G.forceCPU = null; KT.settings.course = 0;
}

// ---------- 18. 아이템 두 칸 · 새 아이템 ----------
console.log('\n[18] 아이템 두 칸 · 새 아이템');
{
  KT.settings.course = 0; KT.settings.gp = 0; KT.settings.cpuLevel = 1; KT.toMenu();
  startRace('1p'); skipCountdown();
  const me = KT.humanKart(0), cpus = karts.filter(k => k.human < 0), [c1, c2] = cpus;
  const tap = code => { press(code); run(0.05); release(code); run(0.05); };
  const clear = k => Object.assign(k, { item: null, itemN: 0, item2: null, itemN2: 0, roulT: 0, shieldT: 0, magnetT: 0, paintT: 0, spinT: 0, immuneT: 0, starT: 0 });
  const keepPlace = (k, s, d, v) => { const keep = { item: k.item, itemN: k.itemN, item2: k.item2, itemN2: k.itemN2 }; placeK(k, s, d, v); Object.assign(k, keep); };   // placeK는 첫 칸을 비우니 아이템은 그대로 두고 옮김
  const park = list => list.forEach((k, i) => placeK(k, 300 + i * 9, 0, 0));   // 테스트에 안 쓰는 카트는 멀리 세워 둠
  G.only = [me]; clear(me);
  // 두 칸: 상자 줄을 두 번 지나면 두 칸이 차고, 쓰면 둘째 칸이 앞으로
  const row = KT.BOX_ROWS[0], box = KT.boxes.find(b => b.s === row && b.d === 0);
  keepPlace(me, row - 6, 0, 14); run(1.6);
  const first = me.item;
  for (const b of KT.boxes) b.alive = true;
  keepPlace(me, row - 6, 0, 14); run(1.6);
  assert(first && me.item === first && me.item2 && box, `상자 두 번이면 두 칸 (${me.item} · ${me.item2})`);
  const hint = G.msg[0];
  assert(hint && hint.text === '아이템 두 칸!' && hint.sub.includes('Q · R'), `두 칸이 처음 차면 바꾸는 키를 알려 줌 (${hint && hint.sub})`);
  me.item = 'ball'; me.itemN = 1; me.item2 = 'shield'; me.itemN2 = 1;
  tap('KeyQ');
  assert(me.item === 'shield' && me.item2 === 'ball', 'Q로 두 칸 순서 바꾸기');
  tap('KeyR'); const byR = me.item === 'ball' && me.item2 === 'shield'; tap('KeyR');
  assert(byR && me.item === 'shield', 'R로도 바꿈 (아이템 E 바로 옆)');
  keepPlace(me, 40, 0, 15); tap('ControlLeft');
  assert(me.shieldT > 9 && me.item === 'ball' && !me.item2, '왼쪽 Ctrl로 첫 칸을 쓰면 둘째 칸이 앞으로');
  me.item = 'triple'; me.itemN = 2; me.item2 = 'zap'; me.itemN2 = 1; tap('KeyQ');
  assert(me.item === 'zap' && me.item2 === 'triple' && me.itemN2 === 2, '불꽃 대시 ×3은 남은 개수째로 자리를 바꿈');
  clear(me); me.item = 'boost'; me.itemN = 1; tap('ControlRight');
  assert(!me.item && me.boostT > 0, '혼자 할 땐 오른쪽 Ctrl도 아이템');
  // 방울 보호막: 한 번 막아 줌 (번개 구슬·함정)
  clear(me); me.shieldT = 10;
  const blocked = KT.spinOut(me, 'zap');
  assert(blocked === 'block' && me.spinT === 0 && me.shieldT === 0, '보호막이 번개 구슬을 한 번 막고 터짐');
  me.shieldT = 10; placeK(me, 40, 0, 10); KT.traps.length = 0;
  { const p = KT.trackPoint(44, 0); KT.traps.push({ x: p.x, y: p.y, z: p.z, s: 44, d: 0, owner: c1, t0: KT.T() - 5 }); }
  run(1);
  assert(KT.traps.length === 0 && me.spinT === 0 && me.shieldT === 0, '보호막이 함정도 막음 (함정은 터짐)');
  // 자석: 앞 카트에게 빠르게 끌려가다 바로 뒤에서 휙
  clear(me); G.only = [me]; placeK(me, 40, -3, 15); placeK(c1, 100, 3, 0);
  me.item = 'magnet'; me.itemN = 1; tap('ControlLeft');
  let maxV = 0, endT = -1; const d0 = KT.sdiff(c1.s, me.s);
  run(4, i => { maxV = Math.max(maxV, me.v); if (endT < 0 && me.magnetT === 0) endT = i / 60; });
  assert(me.magnetTarget === c1 && maxV > KT.KART.VMAX * 1.1 && endT > 0 && endT < 3.5 && KT.sdiff(c1.s, me.s) < 5, `자석: ${d0.toFixed(0)}m 앞 카트에게 ${endT.toFixed(1)}초 만에 (최고 ${maxV.toFixed(1)}m/s)`);
  // 천둥 번개: 내 앞 카트만 빙글 (보호막이 있으면 보호막만 터짐)
  clear(me); clear(c1); clear(c2); const c3 = cpus[2]; clear(c3);
  G.only = [me, c1, c2, c3]; for (const k of G.only) k.lap = 1;   // 앞뒤는 등수(바퀴 수 포함)로 정하니 같은 바퀴에서
  placeK(me, 60, 0, 10); placeK(c1, 120, 0, 10); placeK(c2, 30, 0, 10); placeK(c3, 140, 0, 10); c3.shieldT = 10; run(0.1);
  me.item = 'bolt'; me.itemN = 1; tap('ControlLeft');
  assert(c1.spinT > 0 && c2.spinT === 0 && c3.spinT === 0 && c3.shieldT === 0 && me.spinT === 0, `천둥 번개: 앞 카트는 빙글, 뒤 카트는 그대로, 보호막은 대신 터짐 (앞 ${c1.spinT.toFixed(2)} 뒤 ${c2.spinT.toFixed(2)} 보호막 ${c3.spinT.toFixed(2)}/${c3.shieldT} 나 ${me.spinT.toFixed(2)})`);
  // 통통 공: 곧장 날아가 벽에서 튕기고, 맞으면 빙글
  clear(me); clear(c1); G.only = [me, c1];
  placeK(me, 20, 0, 0); me.a += 0.55; placeK(c1, 400, 0, 0);
  me.item = 'ball'; me.itemN = 1; tap('ControlLeft');
  let bounced = 0; run(1.2, () => { if (KT.balls[0]) bounced = Math.max(bounced, KT.balls[0].bounces); });
  assert(bounced >= 1, `통통 공이 벽에서 튕김 (${bounced}번)`);
  KT.balls.length = 0; clear(c1); park(cpus.slice(1));
  placeK(me, 20, 0, 0); placeK(c1, 34, 0, 0);
  me.item = 'ball'; me.itemN = 1; tap('ControlLeft'); run(1);
  assert(c1.spinT > 0 || c1.spinAt > KT.T() - 1.2, '통통 공이 앞 카트에 맞으면 빙글');
  // 물감 폭탄: 앞쪽 카트들 화면에 물감, CPU는 휘청
  clear(me); clear(c1); clear(c2); G.only = [me, c1, c2];
  placeK(me, 40, 0, 10); placeK(c1, 100, 0, 10); placeK(c2, 20, 0, 10);
  me.item = 'paint'; me.itemN = 1; tap('ControlLeft');
  assert(c1.paintT > 3 && c2.paintT === 0, '물감 폭탄: 앞 카트만 물감');
  me.paintT = 3.5; me.paintAt = KT.T(); KT.render();
  G.only = null;
  // 쉬움 CPU는 공격 아이템을 못 받음 · 꼴등은 번개·자석도 나옴
  KT.settings.cpuLevel = 0; c1.place = 6;
  const got = new Set(); for (let i = 0; i < 3000; i++) got.add(KT.rollItem(c1));
  const attack = ['zap', 'star', 'bolt', 'ball', 'paint'].filter(x => got.has(x));
  KT.settings.cpuLevel = 1; me.place = 6;
  const gotMe = new Set(); for (let i = 0; i < 3000; i++) gotMe.add(KT.rollItem(me));
  assert(attack.length === 0 && ['bolt', 'magnet', 'star', 'paint', 'ball'].every(x => gotMe.has(x)), `쉬움 CPU는 공격 아이템 없음 · 꼴등은 새 아이템이 다 나옴 (${[...gotMe].join(',')})`);
  // 경주 중엔 탭을 닫으려 하면 한 번 물어봄 (Ctrl+W 실수)
  const ev = { preventDefault: noop, returnValue: undefined };
  for (const f of windowEvents.beforeunload || []) f(ev);
  assert(ev.returnValue === '', '경주 중 탭을 닫으려 하면 붙잡음');
  KT.toMenu();
  const ev2 = { preventDefault: noop, returnValue: undefined };
  for (const f of windowEvents.beforeunload || []) f(ev2);
  assert(ev2.returnValue === undefined, '메뉴에선 그냥 닫힘');
}
{
  // CPU도 새 아이템을 씀 (보통, 사람도 CPU처럼). 앞 테스트가 바뀌어도 같은 판이 되게 난수를 다시 맞춤
  randomSeed = 0x2468ace1; pilotSeed = 0x13579bdf;
  KT.settings.cpuLevel = 1; G.stats.used = {};
  startRace('1p', true); skipCountdown(); run(150);
  const used = Object.keys(G.stats.used || {});
  assert(['shield', 'magnet', 'ball', 'paint'].filter(x => used.includes(x)).length >= 3, `CPU가 새 아이템을 씀 (${used.join(', ')})`);
  G.forceCPU = null; KT.toMenu();
}

// ---------- 20. 도전 코스: 용암 성 (2층 다리 · 머리핀 · 불기둥 · 용암 강) ----------
console.log('\n[20] 도전 코스: 용암 성');
{
  KT.settings.course = 4; KT.settings.gp = 0; KT.settings.cpuLevel = 1; KT.settings.laps = 3; KT.toMenu(); KT.switchCourse(4); KT.toMenu();
  const C = KT.COURSE, T2 = KT.TR, BR = C.bumps[0];
  assert(C.name === '용암 성' && C.hard && G3.courseFor === C && els.courseName.textContent === '용암 성', '용암 성을 고르면 길·장면·메뉴 띠가 바뀜');
  assert(T2.len > 1300 && T2.len < 1500, `한 바퀴 ${T2.len.toFixed(0)}m (다른 코스의 두 배쯤)`);
  let r2 = Infinity, sharp = 0;
  for (let j = 0; j < T2.n; j++) { const r = 1 / Math.max(1e-6, Math.abs(T2.curv[j])); r2 = Math.min(r2, r); if (r < 30) sharp++; }
  assert(r2 > 17 && sharp > 120, `가장 급한 커브 반지름 ${r2.toFixed(1)}m · 반지름 30m 안쪽 급커브 ${sharp}m (머리핀)`);
  let g2 = Infinity, cross = 0;   // 높이가 4.5m 넘게 다르면 다리 위·아래라 겹쳐도 됨
  for (let a = 0; a < T2.n; a += 2) for (let b = a + 2; b < T2.n; b += 2) {
    const ds = Math.min(b - a, T2.n - (b - a)); if (ds <= 90) continue;
    const gap = Math.hypot(T2.px[a] - T2.px[b], T2.pz[a] - T2.pz[b]);
    if (Math.abs(T2.py[a] - T2.py[b]) >= 4.5) { if (gap < 2 * KT.TRACK.wall) cross++; continue; }
    g2 = Math.min(g2, gap);
  }
  assert(g2 > 2 * KT.TRACK.wall + 4 && cross > 0, `같은 층 구간끼리 벽이 안 겹침 (${g2.toFixed(0)}m) · 2층 다리에서만 길이 겹침`);
  const p20 = { ...KT.trackPoint(20, 0) }, p40 = { ...KT.trackPoint(40, 0) };
  assert(Math.abs(p20.z) < 1 && Math.abs(p40.z) < 1 && p40.x > p20.x && p20.y === 0, '출발선 부근은 +x 평지 직선');
  const top = { ...KT.trackPoint(BR.s, 0) };
  let far = 0, fd = Infinity; for (let j = 0; j < T2.n; j++) { const dd = Math.hypot(T2.px[j] - top.x, T2.pz[j] - top.z); if (Math.abs(KT.sdiff(j * T2.step, BR.s)) > 100 && dd < fd) { fd = dd; far = j; } }
  const under = { ...KT.locate(top.x, top.z, far) }, below = KT.sdiff(under.s, BR.s);
  assert(Math.abs(top.y - 7) < 0.01 && Math.abs(below) > 300 && KT.groundAt(under.s, under.d) === 0, `다리 위는 7m, 바로 아래 (s ${under.s.toFixed(0)})는 땅 높이`);
  let steep = 0; for (let s = BR.s - 120; s < BR.s + 120; s += 0.5) steep = Math.max(steep, Math.abs(KT.groundAt(s + 0.5, 0) - KT.groundAt(s, 0)) / 0.5);
  assert(steep < 0.2 && KT.groundAt(BR.s + 98, 14) === 0, `다리 오르막·내리막 기울기 ${(steep * 100).toFixed(0)}% 안 · 다리가 끝나면 땅`);
  const onZone = s => KT.ZONES.some(z => { const u = KT.sdiff(s, z.s); return u > -2 && u < z.len + 2; }), onJet = s => KT.JETS.some(j => Math.abs(KT.sdiff(s, j.s)) < 6);
  assert(!KT.PANELS.some(p => onZone(p.s) || onJet(p.s)) && !KT.BOX_ROWS.some(s => onZone(s) || onJet(s)) && !onZone(KT.RAMP.s) && KT.boxes.length === 15, '대시 판·상자·점프대는 용암·불기둥과 안 겹침 · 상자 15개');
  const river = KT.ZONES.find(z => !halfRoad(z)), pools = KT.ZONES.filter(z => halfRoad(z) && z.type === 'lava');
  assert(river && river.type === 'lava' && KT.sdiff(river.s, KT.RAMP.s) > 0 && KT.sdiff(river.s, KT.RAMP.s) < KT.RAMP.len + 6, '점프대 바로 뒤에 길을 가로지르는 용암 강');
  assert(pools.length === 2 && pools.every(z => Math.sign(z.d0 + z.d1) === Math.sign(T2.curv[Math.floor((z.s + z.len / 2) / T2.step)]) && Math.abs(T2.curv[Math.floor((z.s + z.len / 2) / T2.step)]) > 0.03), '용암 웅덩이 둘은 머리핀 커브 안쪽');
  assert(KT.JETS.length >= 4 && G3.jets.length === KT.JETS.length && G3.snowfall, `불기둥 ${KT.JETS.length}개 · 날리는 불티`);
  // 시범 레이스: 다리 위에선 다리 높이, 아래 길에선 땅 높이로 (층이 섞이지 않음)
  const lapB = karts.map(k => k.lap), r0 = G.stats.rescues, prevSpin = karts.map(() => 0);
  let bad = -1, layerBad = 0, upT = 0, downT = 0, jetHits = 0, jetPass = 0, puddleT = 0;
  const prevS = karts.map(k => k.s);
  run(150, j => {
    if (bad < 0 && !karts.every(finite)) bad = j;
    karts.forEach((k, i) => {
      if (!k.air && Math.abs(KT.sdiff(k.s, BR.s)) < 25) { upT += 1 / 60; if (Math.abs(k.y - 7) > 0.2) layerBad++; }
      if (!k.air && Math.abs(KT.sdiff(k.s, under.s)) < 25) { downT += 1 / 60; if (k.y > 0.2) layerBad++; }
      const z = zoneOf(k.s, k.d); if (z && halfRoad(z)) puddleT += 1 / 60;
      if (k.spinT > prevSpin[i] + 0.5 && KT.JETS.some(q => Math.abs(KT.sdiff(k.s, q.s)) < 4)) jetHits++;
      for (const q of KT.JETS) if (KT.sdiff(prevS[i], q.s) < 0 && KT.sdiff(k.s, q.s) >= 0 && Math.abs(KT.sdiff(k.s, q.s)) < 30) jetPass++;   // 불기둥을 지나감
      prevSpin[i] = k.spinT; prevS[i] = k.s;
    });
  });
  assert(bad < 0 && karts.every(k => k.lap - lapB[k.slot] >= 2), `시범 레이스: 150초에 모두 2바퀴 이상 (${karts.map((k, i) => k.lap - lapB[i]).join(',')})`);
  assert(G.stats.rescues - r0 <= 2, `끼여서 다시 세운 횟수 ${G.stats.rescues - r0}`);
  assert(layerBad === 0 && upT > 10 && downT > 10, `다리 위 ${upT.toFixed(0)}초는 7m, 굴다리 ${downT.toFixed(0)}초는 땅에서 (층이 안 섞임)`);
  assert(puddleT < 4 && jetHits <= jetPass * 0.1, `CPU는 머리핀 안쪽 용암 웅덩이(${puddleT.toFixed(1)}초)와 불기둥(${jetPass}번 지나며 빙글 ${jetHits}번)을 피해 감`);
  // 직접 달려 보기
  startRace('1p'); skipCountdown();
  const me = KT.humanKart(0); G.only = [me];
  assert(KT.COURSE === C, '레이스도 용암 성에서');
  placeK(me, BR.s, 2, 0); const q = KT.locate(me.x, me.z, me.seg);
  assert(Math.abs(KT.sdiff(q.s, BR.s)) < 1 && me.y === 7, '다리 위에 세운 카트는 다리 높이 · 아래 길로 잘못 잡히지 않음');
  jumpOver('용암 강');
  // 불기둥: 솟을 때 닿으면 빙글, 잠잠할 때는 그냥 지나감
  const jet = KT.JETS[0], clockAt = st => { for (let t = 0; t < KT.JET.period * 2; t += 0.02) if (KT.jetState(jet, KT.T() + t) === st && KT.jetState(jet, KT.T() + t + 0.5) === st) return t; return 0; };
  const quiet = clockAt(0); run(quiet + 0.05);
  placeK(me, jet.s - 1, jet.d, 6); me.immuneT = 0; run(0.25);
  assert(me.spinT === 0, '불기둥이 잠잠할 때 지나가면 괜찮음');
  const fire = clockAt(1); run(fire + 0.1);
  placeK(me, jet.s, jet.d, 6); me.immuneT = 0; run(0.1);
  assert(me.spinT > 0, '불기둥이 솟을 때 닿으면 앗 뜨거! 빙글');
  // 용암 웅덩이: 빙글 + 살짝 튀어 오름, 강은 빙글 없이 느려지기만
  const pool = pools[0];
  placeK(me, pool.s + 3, (pool.d0 + pool.d1) / 2, 12); me.immuneT = 0; let hopped = false;
  run(0.3, () => { if (me.y > 0.3) hopped = true; });
  assert(me.spinT > 0 && hopped, '용암 웅덩이에 닿으면 빙글 돌며 튀어 오름');
  placeK(me, river.s + 1, 0, 10); me.immuneT = 0; run(0.3);
  assert(me.wet && me.spinT === 0, '용암 강에 빠지면 빙글 없이 느려짐');
  // 2층: 다리 위에 놓은 함정은 아래 길 카트가 안 밟음, 아래 길의 카트끼리만 부딪힘
  const other = karts.find(k => k.human < 0); G.only = [me, other];
  const tp = { ...KT.trackPoint(BR.s, 0) };
  placeK(me, BR.s + 40, 0, 0);
  KT.traps.length = 0; KT.traps.push({ x: tp.x, y: tp.y, z: tp.z, s: BR.s, d: 0, owner: other, t0: KT.T() });
  placeK(other, under.s - 3, under.d, 8);
  run(0.6);
  assert(KT.traps.length === 1 && other.spinT === 0 && other.y < 0.2, '다리 위 함정은 굴다리로 지나가는 카트와 상관없음');
  placeK(me, BR.s - 3, 0, 8); run(0.6);
  assert(KT.traps.length === 0 && me.spinT > 0, '다리 위 카트는 다리 위 함정을 밟음');
  KT.traps.length = 0; G.only = null;
  // 쉬움: 아이처럼 흔들리며 달려도 이김 (2바퀴)
  const kids = [kidRace(0, 1000, 2), kidRace(0, 1077, 2)];
  assert(avgPlace(kids) <= 2, `용암 성 쉬움: 아이처럼 달려도 평균 ${avgPlace(kids).toFixed(1)}등`);
  KT.settings.course = 0; KT.settings.laps = 3; KT.settings.cpuLevel = 1; G.forceCPU = null; KT.toMenu(); KT.switchCourse(0); KT.toMenu();
  assert(KT.COURSE.name === '몬스터 서킷' && !G3.snowfall && G3.jets.length === 0, '다시 몬스터 서킷으로 (불티·불기둥도 사라짐)');
}

// ---------- 21. 새 도전 코스: 구름다리 숲 · 소라 해안 · 사탕 롤러코스터 ----------
console.log('\n[21] 새 도전 코스: 구름다리 숲 · 소라 해안 · 사탕 롤러코스터');
{
  for (const ci of [5, 6, 7]) {
    KT.settings.course = ci; KT.settings.gp = 0; KT.settings.cpuLevel = 1; KT.settings.laps = 3; KT.toMenu(); KT.switchCourse(ci); KT.toMenu();
    const C = KT.COURSE, T2 = KT.TR, nm = C.name, bridges = C.bumps.filter(b => b.h >= 6);
    assert(C.hard && G3.courseFor === C && els.courseName.textContent === nm && T2.len > 1300 && T2.len < 1600, `${nm}: 도전 코스 · 한 바퀴 ${T2.len.toFixed(0)}m`);
    let r2 = Infinity, g2 = Infinity, cross = 0;
    for (let j = 0; j < T2.n; j++) r2 = Math.min(r2, 1 / Math.max(1e-6, Math.abs(T2.curv[j])));
    for (let a = 0; a < T2.n; a += 2) for (let b = a + 2; b < T2.n; b += 2) {
      const ds = Math.min(b - a, T2.n - (b - a)); if (ds <= 90) continue;
      const gap = Math.hypot(T2.px[a] - T2.px[b], T2.pz[a] - T2.pz[b]);
      if (Math.abs(T2.py[a] - T2.py[b]) >= 4.5) { if (gap < 2 * KT.TRACK.wall) cross++; continue; }
      g2 = Math.min(g2, gap);
    }
    assert(r2 > 17 && g2 > 2 * KT.TRACK.wall + 4 && cross > 0, `${nm}: 가장 급한 커브 반지름 ${r2.toFixed(1)}m · 같은 층 길끼리 ${g2.toFixed(0)}m 떨어짐 · 다리에서만 길이 겹침`);
    const p20 = { ...KT.trackPoint(20, 0) }, p40 = { ...KT.trackPoint(40, 0) };
    assert(Math.abs(p20.z) < 1 && Math.abs(p40.z) < 1 && p40.x > p20.x && p20.y === 0, `${nm}: 출발선 부근은 +x 평지 직선`);
    const unders = bridges.map(b => {   // 다리 꼭대기 바로 아래를 지나는 길 (s가 100m 넘게 떨어진 곳)
      const top = { ...KT.trackPoint(b.s, 0) };
      let far = 0, fd = Infinity; for (let j = 0; j < T2.n; j++) { const dd = Math.hypot(T2.px[j] - top.x, T2.pz[j] - top.z); if (Math.abs(KT.sdiff(j * T2.step, b.s)) > 100 && dd < fd) { fd = dd; far = j; } }
      const u = { ...KT.locate(top.x, top.z, far) };
      return { b, s: u.s, ok: Math.abs(top.y - b.h) < 0.01 && fd < 4 && KT.groundAt(u.s, u.d) === 0 };
    });
    assert(bridges.length >= 1 && unders.every(u => u.ok), `${nm}: 다리 ${bridges.length}개 · 꼭대기는 ${bridges.map(b => b.h).join('·')}m, 바로 아래 길 (s ${unders.map(u => u.s.toFixed(0)).join('·')})은 땅 높이`);
    const onZone = s => KT.ZONES.some(z => { const u = KT.sdiff(s, z.s); return u > -2 && u < z.len + 2; });
    assert(!KT.PANELS.some(p => onZone(p.s)) && !KT.BOX_ROWS.some(onZone) && !onZone(KT.RAMP.s) && KT.boxes.length === 15, `${nm}: 대시 판·상자·점프대는 물·늪과 안 겹침 · 상자 15개`);
    const pools = KT.ZONES.filter(z => halfRoad(z)), river = KT.ZONES.find(z => !halfRoad(z));
    assert(pools.length >= 1 && pools.every(z => { const c = T2.curv[Math.floor((z.s + z.len / 2) / T2.step)]; return Math.sign(z.d0 + z.d1) === Math.sign(c) && Math.abs(c) > 0.02; }), `${nm}: 웅덩이 ${pools.length}개는 커브 안쪽`);
    assert(river && KT.sdiff(river.s, KT.RAMP.s) > 0 && KT.sdiff(river.s, KT.RAMP.s) < KT.RAMP.len + 6 && G3.jets.length === 0, `${nm}: 점프대 바로 뒤에 길을 가로지르는 물길`);
    // 시범 레이스: 끝까지 잘 돌고, 다리 위에선 다리 높이 · 아래 길에선 땅 높이 (층이 섞이지 않음), 웅덩이는 피해 감
    const lapB = karts.map(k => k.lap), r0 = G.stats.rescues;
    let bad = -1, layerBad = 0, upT = 0, downT = 0, puddleT = 0;
    run(150, j => {
      if (bad < 0 && !karts.every(finite)) bad = j;
      for (const k of karts) {
        for (const u of unders) {
          if (!k.air && Math.abs(KT.sdiff(k.s, u.b.s)) < 15) { upT += 1 / 60; if (Math.abs(k.y - u.b.h) > 0.2) layerBad++; }
          if (!k.air && Math.abs(KT.sdiff(k.s, u.s)) < 15) { downT += 1 / 60; if (k.y > 0.2) layerBad++; }
        }
        const z = zoneOf(k.s, k.d); if (z && halfRoad(z)) puddleT += 1 / 60;
      }
    });
    assert(bad < 0 && karts.every(k => k.lap - lapB[k.slot] >= 2), `${nm} 시범 레이스: 150초에 모두 2바퀴 이상 (${karts.map((k, i) => k.lap - lapB[i]).join(',')})`);
    assert(G.stats.rescues - r0 <= 2, `${nm}: 끼여서 다시 세운 횟수 ${G.stats.rescues - r0}`);
    assert(layerBad === 0 && upT > 5 && downT > 5, `${nm}: 다리 위 ${upT.toFixed(0)}초는 다리 높이, 아래 길 ${downT.toFixed(0)}초는 땅에서 (층이 안 섞임)`);
    assert(puddleT < 4, `${nm}: CPU는 커브 안쪽 웅덩이를 피해 감 (${puddleT.toFixed(1)}초)`);
  }
  // 롤러코스터 언덕: 빠르게 넘으면 꼭대기에서 붕 떠서 트릭 → 착지하며 부스트, 천천히 넘으면 붙어서 넘음
  KT.settings.course = 7; KT.toMenu(); startRace('1p'); skipCountdown();
  const me = KT.humanKart(0), hill = KT.COURSE.bumps.find(b => b.h < 6); G.only = [me];
  assert(KT.COURSE.name === '사탕 롤러코스터' && hill && hill.ramp <= 25, '사탕 롤러코스터: 짧고 가파른 언덕');
  placeK(me, hill.s - hill.flat - hill.ramp - 15, 0, KT.KART.VMAX); me.immuneT = 0;
  let flew = false, tricked = false, boosted = false, top = 0;
  run(2.5, () => {
    top = Math.max(top, me.y - KT.groundAt(me.s, me.d));
    if (me.hillAir && !flew) { flew = true; press('Space'); }
    if (me.trick) tricked = true;
    if (flew && !me.air && me.boostT > 0) boosted = true;
  });
  release('Space');
  assert(flew && tricked && boosted && top > 0.8, `빠르게 언덕을 넘으면 붕 떠서 (${top.toFixed(1)}m) 트릭 → 착지 부스트`);
  me.speedMul = 0.6; placeK(me, hill.s - hill.flat - hill.ramp - 10, 0, 13); let slowAir = false, passed = false;   // 최고 속도를 60%로 묶고
  run(6, () => { if (me.hillAir) slowAir = true; if (KT.sdiff(me.s, hill.s) > hill.flat + hill.ramp) passed = true; });   // (언덕 뒤 점프대에서 뜨는 건 빼고)
  me.speedMul = 1;
  assert(passed && !slowAir, '천천히 넘으면 언덕에 붙어서 넘음');
  // 다리(7m, 완만)는 부스트로 달려도 붕 뜨지 않음
  const br = KT.COURSE.bumps.find(b => b.h >= 6);
  G.forceCPU = true;   // 다리 앞 커브는 CPU처럼 돌아서
  placeK(me, br.s - br.flat - br.ramp - 5, 0, KT.KART.VMAX); me.boostT = 3; let brAir = false, crossed = false;
  run(4, () => { if (me.hillAir) brAir = true; if (KT.sdiff(me.s, br.s) > br.flat) crossed = true; });
  G.forceCPU = null;
  assert(crossed && !brAir, '완만한 다리는 부스트로 달려도 붕 뜨지 않음');
  G.only = null;
  // 쉬움: 아이처럼 흔들리며 달려도 이김 (새 코스마다 2바퀴)
  const kids = [5, 6, 7].map(ci => { KT.settings.course = ci; KT.toMenu(); return kidRace(0, 1000 + ci * 7, 2); });
  assert(avgPlace(kids) <= 2, `새 도전 코스 쉬움: 아이처럼 달려도 평균 ${avgPlace(kids).toFixed(1)}등 (${kids.map(r => r.place).join(',')})`);
  KT.settings.course = 0; KT.settings.laps = 3; KT.settings.cpuLevel = 1; G.forceCPU = null; KT.toMenu(); KT.switchCourse(0); KT.toMenu();
  assert(KT.COURSE.name === '몬스터 서킷' && !G3.snowfall, '다시 몬스터 서킷으로');
}

// ---------- 22. 아주 큰 맵 · 지름길 ----------
console.log('\n[22] 아주 큰 맵 · 지름길: 모래 협곡 광산 · 빌딩 고가도로');
{
  const placeCut = (k, C, cs, d, v = 0) => {   // 카트를 지름길 위 (cs, d)에 길 방향으로
    placeK(k, C.from, 0, v);
    const p = { ...KT.pathPoint(C.P, cs, d) };
    Object.assign(k, { x: p.x, z: p.z, y: 0, a: Math.atan2(p.tx, p.tz), cut: C.idx, cs, cd: d, d, cseg: Math.round(cs / C.P.step) });
  };
  const autoGas0 = KT.settings.autoGas;
  for (const ci of [8, 9]) {
    KT.settings.course = ci; KT.settings.gp = 0; KT.settings.cpuLevel = 1; KT.settings.laps = 3; KT.toMenu(); KT.switchCourse(ci); KT.toMenu();
    const C0 = KT.COURSE, T2 = KT.TR, CUTS = KT.CUTS, nm = C0.name;
    assert(C0.hard && C0.big && G3.courseFor === C0 && els.courseName.textContent === nm && T2.len > 1800 && T2.len < 2500 && CUTS.length >= 1, `${nm}: 아주 큰 맵 · 한 바퀴 ${T2.len.toFixed(0)}m · 지름길 ${CUTS.length}개`);
    let r2 = Infinity, g2 = Infinity, cross = 0;
    for (let j = 0; j < T2.n; j++) r2 = Math.min(r2, 1 / Math.max(1e-6, Math.abs(T2.curv[j])));
    for (let a = 0; a < T2.n; a += 2) for (let b = a + 2; b < T2.n; b += 2) {
      const ds = Math.min(b - a, T2.n - (b - a)); if (ds <= 90) continue;
      const gap = Math.hypot(T2.px[a] - T2.px[b], T2.pz[a] - T2.pz[b]);
      if (Math.abs(T2.py[a] - T2.py[b]) >= 4.5) { if (gap < 2 * KT.TRACK.wall) cross++; continue; }
      g2 = Math.min(g2, gap);
    }
    assert(r2 > 17 && g2 > 2 * KT.TRACK.wall + 4 && cross > 0, `${nm}: 가장 급한 커브 반지름 ${r2.toFixed(1)}m · 같은 층 길끼리 ${g2.toFixed(0)}m 떨어짐 · 높은 길이 아래 길 위를 지나감`);
    const p20 = { ...KT.trackPoint(20, 0) }, p40 = { ...KT.trackPoint(40, 0) };
    assert(Math.abs(p20.z) < 1 && Math.abs(p40.z) < 1 && p40.x > p20.x && p20.y === 0, `${nm}: 출발선 부근은 +x 평지 직선`);
    // 지름길: 본 길보다 짧고, 가운데는 본 길 벽과 떨어져 있고 (갈림·합류에서만 이어짐), 너무 급한 커브 없음
    for (const C of CUTS) {
      let mid = Infinity, rC = Infinity;
      for (let cs = C.e0 + 8; cs <= C.P.len - C.e1 - 8; cs += 2) {
        const p = { ...KT.pathPoint(C.P, cs, 0) };
        for (let j = 0; j < T2.n; j++) if (Math.abs(T2.py[j]) < 4.5) mid = Math.min(mid, Math.hypot(T2.px[j] - p.x, T2.pz[j] - p.z));
      }
      for (let j = 3; j < C.P.n - 3; j++) rC = Math.min(rC, 1 / Math.max(1e-6, Math.abs(C.P.curv[j])));
      assert(C.span - C.P.len > 20 && mid > KT.TRACK.wall + 0.7 + C.wall + 0.8 && rC > 9 && C.e0 > 10 && C.e1 > 10,
        `${nm} '${C.name}': ${C.P.len.toFixed(0)}m (본 길 ${C.span.toFixed(0)}m보다 ${(C.span - C.P.len).toFixed(0)}m 짧음) · 가운데는 본 길과 ${mid.toFixed(0)}m 떨어짐 · 가장 급한 커브 ${rC.toFixed(1)}m`);
    }
    const cutBoxes = CUTS.reduce((a, C) => a + C.boxes.length, 0) * 3;
    assert(KT.boxes.length === 15 + cutBoxes && KT.boxes.filter(b => b.cut >= 0).length === cutBoxes && cutBoxes > 0, `${nm}: 상자 15개 + 지름길 상자 ${cutBoxes}개`);
    // 시범 레이스 200초: CPU도 지름길을 끝까지 타고 본 길로 돌아옴. 끼이거나 등수(진행 거리)가 튀지 않음
    const lapB = karts.map(k => k.lap), r0 = G.stats.rescues, w0 = G.stats.walls, used = CUTS.map(() => 0), onCut = karts.map(() => -1), maxCs = karts.map(() => 0), prev = karts.map(k => k.prog);
    let bad = -1, jumps = 0;
    run(200, j => {
      if (bad < 0 && !karts.every(finite)) bad = j;
      karts.forEach((k, i) => {
        if (Math.abs(k.prog - prev[i]) > 3) jumps++;
        prev[i] = k.prog;
        if (k.cut >= 0) { if (onCut[i] !== k.cut) { onCut[i] = k.cut; maxCs[i] = 0; } maxCs[i] = Math.max(maxCs[i], k.cs); }
        else if (onCut[i] >= 0) { const Cq = CUTS[onCut[i]]; if (maxCs[i] > Cq.P.len - Cq.e1 - 4) used[onCut[i]]++; onCut[i] = -1; }   // 합류 구간까지 가서 큰길로 옮겨 탔으면 다 탄 것
      });
    });
    assert(bad < 0 && karts.every(k => k.lap - lapB[k.slot] >= 2), `${nm} 시범 레이스: 200초에 모두 2바퀴 이상 (${karts.map((k, i) => k.lap - lapB[i]).join(',')})`);
    assert(used.every(n => n >= 2), `${nm}: CPU가 지름길을 끝까지 타고 나옴 (${CUTS.map((C, i) => `${C.name} ${used[i]}번`).join(' · ')})`);
    assert(G.stats.rescues - r0 <= 2 && G.stats.walls - w0 <= 6 && jumps === 0, `${nm}: 다시 세움 ${G.stats.rescues - r0}번 · 벽 ${G.stats.walls - w0}번 · 진행 거리가 튀지 않음`);
    // CPU에게 지름길로 / 본 길로 가라고 정해 주면 그대로 가서 본 길로 돌아옴 (벽에 안 부딪힘)
    startRace('1p', true); skipCountdown();
    const me = KT.humanKart(0), tgt = karts.find(k => k.human < 0); G.only = [me];
    for (const C of CUTS) for (const go of [true, false]) {
      placeK(me, C.from - 90, 0, 20); me.ai.cutLap = {}; me.ai.cutGo = {};
      let mid = false, back = false; const wb = G.stats.walls;
      run(25, () => {
        if (me.ai.cutLap[C.idx] !== undefined) me.ai.cutGo[C.idx] = go;
        if (me.cut === C.idx && me.cs > C.e0 + 10 && me.cs < C.P.len - C.e1 - 10) mid = true;
        if (me.cut < 0 && KT.sdiff(me.s, C.to) > 30) { back = true; return false; }
      });
      assert(mid === go && back && G.stats.walls === wb, `${nm} '${C.name}': CPU가 ${go ? '지름길로 들어갔다가' : '본 길로 지나쳐'} 본 길로 돌아옴 · 벽에 안 부딪힘`);
    }
    // 사람: 본 길 가운데로 달리면 그대로, 지름길 쪽으로 꺾으면 지름길로
    G.forceCPU = null; KT.settings.autoGas = true;
    const drive = aim => {
      const q = aim(), err = wrapA(Math.atan2(q.x - me.x, q.z - me.z) - me.a), st = -err * 1.6;
      if (st > 0.1) { press('KeyD'); release('KeyA'); } else if (st < -0.1) { press('KeyA'); release('KeyD'); } else { release('KeyA'); release('KeyD'); }
    };
    for (const C of CUTS) {
      placeK(me, C.from - 40, 0, 20); let leftMain = false;
      run(9, () => { drive(() => KT.trackPoint(me.s + 12, 0)); if (me.cut >= 0) leftMain = true; });
      placeK(me, C.from - 40, 0, 20); let mid = false, back = false; const wb = G.stats.walls;
      run(30, () => {
        drive(() => me.cut === C.idx ? KT.pathPoint(C.P, me.cs + 12, 0) : KT.sdiff(me.s, C.from) < C.e0 ? KT.pathPoint(C.P, Math.max(0, KT.sdiff(me.s, C.from)) + 12, 0) : KT.trackPoint(me.s + 12, 0));
        if (me.cut === C.idx && me.cs > C.e0 + 10 && me.cs < C.P.len - C.e1 - 10) mid = true;
        if (mid && me.cut < 0 && KT.sdiff(me.s, C.to) > 20) { back = true; return false; }
      });
      release('KeyA'); release('KeyD');
      assert(!leftMain && mid && back && G.stats.walls - wb <= 1, `${nm} '${C.name}': 사람이 본 길로 달리면 그대로 · 지름길 쪽으로 꺾으면 지름길을 지나 본 길로 돌아옴`);
    }
    KT.settings.autoGas = autoGas0;
    // 지름길 위 아이템: 번개 구슬·눈덩이는 지름길 안 앞 카트를 맞힘, 본 길에서 쏜 구슬도 지름길 카트에게 날아감, 통통 공은 지름길 벽에서 튕김
    const C = CUTS[0], tap = code => { press(code); run(0.05); release(code); run(0.05); };
    const clearK = k => Object.assign(k, { item: null, itemN: 0, item2: null, itemN2: 0, roulT: 0, shieldT: 0, magnetT: 0, starT: 0, spinT: 0, frozenT: 0, immuneT: 0, paintT: 0 });
    const shoot = (it, setup, check, sec = 2.5) => {
      KT.shots.length = 0; KT.snowballs.length = 0; KT.balls.length = 0; clearK(me); clearK(tgt); setup();
      me.item = it; me.itemN = 1; tap('ControlLeft');
      let ok = false; run(sec, () => { if (check()) ok = true; });
      return ok;
    };
    G.only = [me];
    const zapCut = shoot('zap', () => { placeCut(me, C, C.e0 + 14, 0, 6); placeCut(tgt, C, C.e0 + 45, 1.5, 0); }, () => tgt.spinT > 0);
    const snowCut = shoot('snow', () => { placeCut(me, C, C.e0 + 14, 0, 6); placeCut(tgt, C, C.e0 + 40, 0, 0); }, () => tgt.frozenT > 0);
    const zapFree = shoot('zap', () => { placeK(me, C.from - 10, 0, 10); placeCut(tgt, C, C.e0 + 20, 0, 0); }, () => tgt.spinT > 0, 6);
    let ballOut = 0, ballBounce = 0;
    shoot('ball', () => { placeCut(me, C, (C.e0 + C.P.len - C.e1) / 2, 0, 0); me.a += 0.7; placeK(tgt, C.from - 200, 0, 0); }, () => {
      const b = KT.balls[0]; if (!b) return false;
      ballBounce = Math.max(ballBounce, b.bounces);
      if (b.cut === C.idx && Math.abs(b.d) > C.wall + 0.3) ballOut++;
      return false;
    }, 1.5);
    assert(zapCut && snowCut && zapFree && ballBounce >= 1 && ballOut === 0, `${nm} 지름길 아이템: 구슬 ${zapCut} · 눈덩이 ${snowCut} · 본 길→지름길 구슬 ${zapFree} · 통통 공 ${ballBounce}번 튕김, 벽 밖으로 안 나감`);
    G.only = null; G.forceCPU = null;
  }
  // 쉬움: 아이처럼 흔들리며 달려도 이김 (큰 맵은 한 바퀴만)
  const kids = [8, 9].flatMap(ci => [0, 1, 2].map(j => { KT.settings.course = ci; KT.toMenu(); return kidRace(0, 2000 + ci * 7 + j * 31, 1); }));   // 장애물 자리가 시각마다 달라서 세 판씩
  assert(avgPlace(kids) <= 2, `큰 맵 쉬움: 아이처럼 달려도 평균 ${avgPlace(kids).toFixed(1)}등 (${kids.map(r => r.place).join(',')})`);
  KT.settings.course = 0; KT.settings.laps = 3; KT.settings.cpuLevel = 1; G.forceCPU = null; KT.toMenu(); KT.switchCourse(0); KT.toMenu();
  assert(KT.COURSE.name === '몬스터 서킷' && KT.CUTS.length === 0, '다시 몬스터 서킷으로 (지름길 없음)');
}

// ---------- 23. 새 아이템 다섯 · 맞힌 카메라 ----------
console.log('\n[23] 새 아이템 다섯 · 맞힌 카메라');
{
  KT.settings.course = 0; KT.settings.gp = 0; KT.settings.cpuLevel = 1; KT.toMenu();
  startRace('1p'); skipCountdown();
  const me = KT.humanKart(0), cpus = karts.filter(k => k.human < 0), [c1, c2, c3] = cpus;
  const tap = code => { press(code); run(0.05); release(code); run(0.05); };
  const clear = k => Object.assign(k, { item: null, itemN: 0, item2: null, itemN2: 0, roulT: 0, shieldT: 0, magnetT: 0, paintT: 0, spinT: 0, immuneT: 0, starT: 0, frozenT: 0 });
  const park = list => list.forEach((k, i) => { k.lap = 0; placeK(k, 300 + i * 9, 0, 0); });   // 안 쓰는 카트는 한 바퀴 뒤로 쳐서 세워 둠 (1등으로 안 잡히게)
  const use = it => { me.item = it; me.itemN = 1; tap('ControlLeft'); };
  // 추적 로켓: 멀리 앞선 1등에게 날아가 꽝 → 내 화면 왼쪽 위에 맞힌 카메라
  for (const k of karts) { clear(k); k.lap = 1; }
  G.only = [me, c1, c2]; park(cpus.slice(2));
  placeK(me, 40, 0, 15); placeK(c1, 200, 2, 15); placeK(c2, 120, -2, 15); run(0.1);
  G.hitCam[0] = null; use('rocket');
  let rocketAt = -1, cam = null; run(9, i => { if (c1.spinT > 0 && rocketAt < 0) { rocketAt = i / 60; cam = G.hitCam[0] && { ...G.hitCam[0] }; } });
  assert(rocketAt > 0 && c2.spinT === 0 && KT.rockets.length === 0, `추적 로켓: 2등은 지나치고 1등을 맞힘 (${rocketAt.toFixed(1)}초)`);
  assert(cam && cam.k === c1 && cam.why === 'rocket' && KT.T() - G.hitCam[0].t > KT.HITCAM, '맞힌 사람 화면에 노린 카트를 비추는 카메라가 떴다가 2.6초 뒤 사라짐');
  // 회오리 바람: 앞 카트 셋을 차례로 따라가 쓸어 감
  for (const k of karts) clear(k);
  G.only = [me]; park(cpus.slice(3));
  placeK(me, 40, 0, 10); placeK(c1, 80, -3, 0); placeK(c2, 100, 3, 0); placeK(c3, 70, 0, 0);
  use('tornado');
  run(5);
  assert([c1, c2, c3].every(k => k.spinAt > KT.T() - 5) && KT.tornados.length === 0 && me.spinT === 0, '회오리 바람: 앞 카트 셋을 따라가 모두 빙글 (나는 안 맞음)');
  // 눈덩이: 앞 카트를 꽁꽁 (멈췄다가 다시 달림)
  for (const k of karts) clear(k);
  G.only = [me, c1]; park(cpus.slice(1));
  placeK(me, 40, 0, 12); placeK(c1, 70, 0, 6);
  use('snow');
  let froze = false, minV = 99; run(4, () => { if (c1.frozenT > 0) { froze = true; minV = Math.min(minV, c1.v); } });
  assert(froze && minV < 0.5 && c1.frozenT === 0 && c1.v > 3, `눈덩이: 앞 카트가 꽁꽁 멈췄다가 (${minV.toFixed(1)}m/s) 녹으면 다시 달림`);
  // 꽝 폭탄: 떨어진 자리 둘레 카트만 빙글, 던진 나는 안 맞음
  for (const k of karts) clear(k);
  G.only = [me]; park(cpus.slice(3));
  placeK(me, 40, 0, 18); placeK(c1, 75, -2, 0); placeK(c2, 78, 3, 0); placeK(c3, 95, 0, 0);
  use('bomb');
  run(4);
  const boomed = k => k.spinAt > KT.T() - 4;
  assert(boomed(c1) && boomed(c2) && !boomed(c3) && me.spinT === 0 && KT.bombs.length === 0, '꽝 폭탄: 떨어진 자리 둘레 카트만 빙글, 멀리 있거나 던진 나는 그대로');
  // 통통 스프링: 높이 뛰고, 공중에서 트릭하면 착지 부스트
  for (const k of karts) clear(k);
  G.only = [me]; placeK(me, 40, 0, 18);
  use('spring');
  let maxY = 0, airT = 0, tricked = false, boosted = false;
  run(2, () => { maxY = Math.max(maxY, me.y); if (me.air) airT += 1 / 60; if (me.air && !tricked && me.vy < 2) { press('Space'); tricked = true; } if (tricked && !me.air && me.boostT > 0) boosted = true; });
  release('Space');
  assert(maxY > 2 && airT > 0.8 && boosted, `통통 스프링: ${maxY.toFixed(1)}m 높이 · ${airT.toFixed(2)}초 공중 · 트릭 → 착지 부스트`);
  // 맞힌 카메라 그리기
  G.only = null;
  G.hitCam[0] = { k: c1, why: 'zap', t: KT.T(), snap: true }; KT.render(); run(0.5);
  assert(errors.length === 0 && draw.nan === 0, '맞힌 카메라 창을 그려도 예외·NaN 없음');
  // 아이템 고르기: 쉬움 CPU는 공격 아이템 없음 · 꼴등은 15가지 다 · 1등은 로켓이 안 나옴
  KT.settings.cpuLevel = 0; c1.place = 6;
  const got = new Set(); for (let i = 0; i < 4000; i++) got.add(KT.rollItem(c1));
  KT.settings.cpuLevel = 1; me.place = 6;
  const gotLast = new Set(); for (let i = 0; i < 4000; i++) gotLast.add(KT.rollItem(me));
  me.place = 1;
  const gotFirst = new Set(); for (let i = 0; i < 4000; i++) gotFirst.add(KT.rollItem(me));
  assert(!KT.ATTACK.some(x => got.has(x)) && KT.ITEM_KEYS.length === 27 && KT.ITEM_KEYS.every(x => gotLast.has(x)) && !['rocket', 'ufo', 'barricade', 'plane'].some(x => gotFirst.has(x)),
    `쉬움 CPU는 공격 아이템 없음 · 꼴등은 27가지 다 나옴 · 1등은 로켓·UFO·바리케이드·비행기 없음 (${[...gotFirst].join(',')})`);
  KT.toMenu();
}
{
  // CPU도 새 아이템 다섯을 씀
  randomSeed = 0x2468ace1; pilotSeed = 0x13579bdf;
  KT.settings.cpuLevel = 1; G.stats.used = {};
  startRace('1p', true); skipCountdown(); run(150);
  const used = Object.keys(G.stats.used || {});
  const fresh = ['fake', 'trap3', 'horn', 'ufo', 'ghost', 'plane', 'boomerang', 'cloud', 'shrink', 'barricade', 'pow', 'water'], nf = fresh.filter(x => used.includes(x)).length;
  assert(used.length >= 14 && nf >= 5, `CPU가 여러 가지 아이템을 씀 (${used.length}가지 · 새 아이템 ${nf}가지: ${used.join(', ')})`);
  G.forceCPU = null; KT.toMenu();
}

// ---------- 24. 새 아이템 열두 가지 ----------
console.log('\n[24] 새 아이템 열두 가지 (카트라이더·마리오카트 느낌)');
{
  KT.settings.course = 0; KT.settings.gp = 0; KT.settings.cpuLevel = 1; KT.toMenu();
  startRace('1p'); skipCountdown();
  const me = KT.humanKart(0), cpus = karts.filter(k => k.human < 0), [c1, c2, c3] = cpus;
  const tap = code => { press(code); run(0.05); release(code); run(0.05); };
  const clear = k => Object.assign(k, { item: null, itemN: 0, item2: null, itemN2: 0, roulT: 0, shieldT: 0, magnetT: 0, paintT: 0, spinT: 0, immuneT: 0, starT: 0, frozenT: 0,
    ghostT: 0, planeT: 0, cloudT: 0, cloudBy: null, tinyT: 0, flatT: 0, ufoT: 0, bubbleT: 0 });
  const park = list => list.forEach((k, i) => { k.lap = 0; placeK(k, 600 + i * 9, 0, 0); });   // 안 쓰는 카트는 한 바퀴 뒤로 쳐서 멀리
  const use = (it, n = 1) => { me.item = it; me.itemN = n; tap('ControlLeft'); };
  const reset = () => {
    for (const k of karts) { clear(k); k.lap = 1; k.ai.lane = 0; k.ai.laneAt = 1e9; k.ai.itemAt = 1e9; }
    for (const a of [KT.traps, KT.shots, KT.balls, KT.rockets, KT.snowballs, KT.ufos, KT.boomerangs, KT.waters, KT.pows]) a.length = 0;
  };
  // 가짜 상자: 진짜 상자처럼 생겨서 보통 CPU는 속아서 밟음
  reset(); G.only = [me, c1]; park(cpus.slice(1));
  placeK(me, 60, 0, 14); placeK(c1, 30, 0, 14);
  use('fake');
  let fakeHit = false; run(3, () => { if (c1.spinT > 0) fakeHit = true; });
  assert(fakeHit && KT.traps.length === 0, '가짜 상자: 뒤 CPU(보통)는 속아서 밟고 빙글');
  // 줄줄이 함정: 첫 칸에 들고 있으면 카트 뒤에 달려서 뒤에서 온 번개 구슬을 막고, 누를 때마다 하나씩 놓음
  reset(); G.only = [me, c1]; park(cpus.slice(1));
  placeK(me, 80, 0, 10); placeK(c1, 50, 0, 10);
  me.item = 'trap3'; me.itemN = 3; c1.item = 'zap'; c1.itemN = 1; KT.useItem(c1);
  let trailSpun = false; run(2, () => { if (me.spinT > 0) trailSpun = true; });
  assert(!trailSpun && me.itemN === 2 && KT.shots.length === 0, '줄줄이 함정: 뒤에서 온 번개 구슬을 하나가 대신 막음 (3 → 2)');
  tap('ControlLeft');
  assert(me.itemN === 1 && KT.traps.length === 1 && KT.itemLabel('trap3', 1) === '줄줄이 함정 ×1', '누를 때마다 하나씩 뒤에 놓음 (남은 개수 표시)');
  // 빵빵 나팔: 나를 노린 로켓을 부수고, 바로 옆 카트는 빙글 돌며 밀려남
  reset(); G.only = [me, c1, c2]; park(cpus.slice(2));
  placeK(me, 200, 0, 12); placeK(c1, 100, 0, 12);
  c1.item = 'rocket'; c1.itemN = 1; KT.useItem(c1);
  let honked = false; run(8, () => {
    const r = KT.rockets[0];
    if (r && !honked && (r.x - me.x) ** 2 + (r.z - me.z) ** 2 < 8 * 8) { honked = true; const v = me.v; placeK(c2, me.s - 3, me.d + 2.5, v); me.v = v; me.item = 'horn'; me.itemN = 1; KT.useItem(me); }   // 나팔이 닿는 9m 안으로 들어오면
  });
  assert(honked && KT.rockets.length === 0 && me.spinAt < KT.T() - 8 && c2.spinAt > KT.T() - 8, `빵빵 나팔: 날아오던 로켓을 부수고 옆 카트는 빙글 [${honked} ${KT.rockets.length} ${(KT.T() - me.spinAt).toFixed(1)} ${(KT.T() - c2.spinAt).toFixed(1)}]`);
  // 외계인 UFO: 멀리 앞선 1등 머리 위에서 3초 동안 끌어당겨 느리게 (보호막으로는 못 막음)
  reset(); G.only = [me, c1]; park(cpus.slice(1));
  placeK(me, 40, 0, 15); placeK(c1, 220, 0, 20); c1.shieldT = 30;
  use('ufo');
  let beamT = 0, beamMin = 99, cam = null; run(14, () => { if (c1.ufoT > 0) { beamT += 1 / 60; beamMin = Math.min(beamMin, c1.v); if (!cam && G.hitCam[0]) cam = G.hitCam[0].why; } });
  assert(beamT > 2.5 && beamT < 3.6 && beamMin < KT.KART.VMAX * 0.6 && c1.shieldT > 0 && KT.ufos.length === 0 && cam === 'ufo', `외계인 UFO: 1등을 ${beamT.toFixed(1)}초 동안 끌어당김 (${beamMin.toFixed(1)}m/s까지 느려짐) · 보호막은 그대로 · 맞힌 카메라`);
  // 꼬마 유령: 앞 카트의 아이템을 훔쳐 오고, 4초 동안 아무것도 안 맞음
  reset(); G.only = [me, c1, c2]; park(cpus.slice(2));
  placeK(me, 40, 0, 10); placeK(c1, 120, 0, 10); placeK(c2, 20, 0, 12); c1.item = 'star'; c1.itemN = 1;
  use('ghost');
  const stole = me.item === 'star' && !c1.item;
  c2.item = 'zap'; c2.itemN = 1; KT.useItem(c2);
  let ghostHit = false; run(2, () => { if (me.spinT > 0) ghostHit = true; });
  assert(stole && !ghostHit && me.ghostT > 0, '꼬마 유령: 앞 카트의 반짝 별을 훔쳐 오고 번개 구슬도 지나감');
  // 꼬마 비행기: 손을 놓아도 저절로 아주 빠르게 날아가고, 앞을 막은 카트는 튕겨 냄
  reset(); G.only = [me]; park(cpus.slice(1));
  KT.settings.autoGas = false; placeK(me, 40, 0, 15);
  use('plane'); run(0.6); placeK(c1, me.s + 22, me.d, 0);
  let planeTop = 0, planeHit = false; const ps0 = me.prog, pw0 = G.stats.walls;
  run(4, () => { planeTop = Math.max(planeTop, me.v); if (c1.spinT > 0) planeHit = true; });
  KT.settings.autoGas = true;
  assert(planeTop > KT.KART.VMAX * 1.4 && me.prog - ps0 > 110 && planeHit && G.stats.walls === pw0 && me.planeT === 0, `꼬마 비행기: 저절로 ${planeTop.toFixed(1)}m/s로 ${(me.prog - ps0).toFixed(0)}m · 앞 카트를 튕겨 냄 · 벽에 안 부딪힘`);
  // 부메랑: 앞으로 날아가 앞 카트를 맞히고 돌아옴 (세 번)
  reset(); G.only = [me]; park(cpus.slice(1));
  placeK(me, 40, 0, 6); placeK(c1, 62, 0.5, 0);
  use('boomerang', 3);
  let boomHit = false, boomBack = false; run(3, () => { if (c1.spinT > 0) boomHit = true; if (KT.boomerangs.length === 0) boomBack = true; });
  assert(boomHit && boomBack && me.item === 'boomerang' && me.itemN === 2, '부메랑: 앞 카트를 맞히고 돌아옴 · 세 번 중 두 번 남음');
  // 천둥 먹구름: 부딪혀서 넘기고, 시간이 다 되면 들고 있던 카트가 작아지며 빙글
  reset(); G.only = [me, c1]; park(cpus.slice(1));
  placeK(me, 40, 0, 16); placeK(c1, 52, 0, 4);
  use('cloud');
  let passed = false; run(9.5, () => { if (c1.cloudT > 0) passed = true; });
  const struck = [me, c1].filter(k => k.tinyT > 0);
  assert(passed && struck.length === 1 && me.cloudT === 0 && c1.cloudT === 0, `천둥 먹구름: 부딪혀 넘기고 8초 뒤 들고 있던 카트(${struck.map(k => k === me ? '나' : 'CPU').join(',')})에 번개`);
  // 작아져라 광선: 앞 카트 모두 작아지고, 큰 카트에 밟히면 납작
  reset(); G.only = [me, c1, c2]; park(cpus.slice(2));
  placeK(me, 40, 0, 20); placeK(c1, 60, 0, 3); placeK(c2, 90, 4, 3);
  use('shrink');
  const bothTiny = c1.tinyT > 0 && c2.tinyT > 0 && me.tinyT === 0;
  let flat = false; run(2.5, () => { if (c1.flatT > 0) flat = true; });
  assert(bothTiny && flat, '작아져라 광선: 앞 카트 모두 작아지고, 큰 카트에 밟히면 납작');
  // 바리케이드: 1등 36m 앞에 길을 가로질러 셋 (사이 틈으로 빠져나감), 9초 뒤 사라짐
  reset(); G.only = [me, c1]; park(cpus.slice(1));
  me.lap = 0; placeK(me, KT.L - 120, 0, 10); placeK(c1, 6, 0, 16);
  use('barricade');
  const bars = KT.traps.filter(t => t.kind === 'barricade');
  assert(bars.length === 3 && bars.every(b => Math.abs(KT.sdiff(b.s, c1.s) - 36) < 3) && bars.map(b => b.d).join() === '-6,0,6', `바리케이드: 1등 앞 ${bars.map(b => KT.sdiff(b.s, c1.s).toFixed(0)).join('·')}m에 길을 가로질러 셋`);
  let barHit = false; run(3, () => { if (c1.spinT > 0) barHit = true; });
  run(6.5);
  assert(!barHit && KT.traps.filter(t => t.kind === 'barricade').length === 0, '보통 CPU는 사이 틈으로 빠져나가고, 9초 뒤 사라짐');
  // 쿵 블록: 떨어질 때 땅에 붙어 있으면 빙글, 점프하면 피함 (사람도 드리프트 버튼으로)
  reset(); G.only = [me, c1, c2]; park(cpus.slice(2));
  for (const k of [c1, c2]) k.ai.driftSkill = 0;
  placeK(me, 40, 0, 15); placeK(c1, 120, 0, 15); placeK(c2, 160, 0, 15);
  c3.lap = 0; placeK(c3, KT.L - 100, 0, 0); G.only = [me, c1, c2];   // 쿵 블록은 맨 뒤 CPU가 씀 → 나머지 셋이 맞을 차례
  c3.item = 'pow'; c3.itemN = 1; KT.useItem(c3);
  const pw = KT.pows[0]; pw.hop.set(c1, true); pw.hop.set(c2, false);
  let meSpin = false, c1spin = false, c2spin = false, jumped = false;
  run(2.2, () => {
    if (!jumped && KT.pows.length && KT.pows[0].at - KT.T() < 0.12) { jumped = true; press('Space'); }
    if (me.spinT > 0) meSpin = true; if (c1.spinT > 0) c1spin = true; if (c2.spinT > 0) c2spin = true;
  });
  release('Space');
  assert([me, c1, c2].every(k => pw.targets.includes(k)) && jumped && !meSpin && !c1spin && c2spin, `쿵 블록: 떨어질 때 점프한 사람·CPU는 피하고, 안 뛴 CPU는 빙글 [${jumped} ${meSpin} ${c1spin} ${c2spin}]`);
  for (const k of [c1, c2]) k.ai.driftSkill = 0.55;
  // 물풍선 폭탄: 떨어진 자리에 물방울 돔 → 안에 있던 카트는 물방울에 갇힘 (던진 사람은 안 갇힘)
  reset(); G.only = [me]; park(cpus.slice(3));
  placeK(me, 40, 0, 18); placeK(c1, 76, -2, 0); placeK(c2, 75, 1.5, 0); placeK(c3, 100, 0, 0);
  use('water');
  let bub = { c1: false, c2: false, c3: false, me: false }; run(3, () => { for (const [n, k] of [['c1', c1], ['c2', c2], ['c3', c3], ['me', me]]) if (k.bubbleT > 0) bub[n] = true; });
  assert(bub.c1 && bub.c2 && !bub.c3 && !bub.me, `물풍선 폭탄: 떨어진 자리 둘레 카트만 물방울에 갇힘 [${JSON.stringify(bub)}]`);
  // 아이템 칸 그림 27가지 · 화면 효과 (먹구름 · 쿵 블록 경고 · UFO 빛 · 물방울)
  G.only = null; reset();
  for (const it of KT.ITEM_KEYS) { me.item = it; me.itemN = KT.ITEMS[it].n || 1; KT.render(); }
  me.item = null; me.cloudT = 5; me.ufoT = 1; me.bubbleT = 1; me.ghostT = 1; KT.pows.push({ owner: c1, at: KT.T() + 1, t0: KT.T(), targets: [me], hop: new Map() }); KT.render();
  reset();
  assert(errors.length === 0 && draw.nan === 0, '아이템 칸 그림 27가지와 화면 효과를 그려도 예외·NaN 없음');
  KT.toMenu();
}

// ---------- 25. 코스 장애물 ----------
console.log('\n[25] 코스 장애물: 쿵쿵 돌 · 흔들 통나무 · 꽃게 · 사탕 공 · 광산 수레 · 자동차');
{
  const expect = { 4: [['stomp'], 3, '쿵쿵 돌'], 5: [['swing'], 3, '흔들 통나무'], 6: [['crab'], 6, '꽃게'], 7: [['gum'], 6, '사탕 공'], 8: [['cart'], 3, '광산 수레'], 9: [['car', 'bus', 'truck'], 8, '자동차·버스·트럭'] };
  const autoGas0 = KT.settings.autoGas;
  let demoHits = 0;
  for (const ci of [4, 5, 6, 7, 8, 9]) {
    KT.settings.course = ci; KT.settings.gp = 0; KT.settings.cpuLevel = 1; KT.settings.laps = 3; KT.toMenu(); KT.switchCourse(ci); KT.toMenu();
    const H = KT.HAZ, [types, n, nm] = expect[ci], cname = KT.COURSE.name;
    assert(H.length === n && H.every(z => types.includes(z.type)) && types.every(ty => G3.haz[ty] && G3.haz[ty].count === H.filter(z => z.type === ty).length), `${cname}: ${nm} ${n}개 (3D도)`);
    // 시범 레이스 80초: 끼이지 않고 잘 돎 (CPU도 가끔 맞음)
    G.stats.haz = {}; const r0 = G.stats.rescues, lapB = karts.map(k => k.lap);
    let bad = -1; run(80, j => { if (bad < 0 && !karts.every(finite)) bad = j; });
    const hits = types.reduce((a, ty) => a + (G.stats.haz[ty] || 0), 0); demoHits += hits;
    assert(bad < 0 && G.stats.rescues - r0 <= 2 && karts.every((k, i) => k.lap - lapB[i] >= 1), `${cname} 시범 80초: 끼이지 않고 돎 · CPU가 ${nm}에 ${hits}번 맞음`);
  }
  assert(demoHits > 10, `CPU도 장애물에 가끔 맞음 (모두 ${demoHits}번)`);
  // 장애물 규칙 하나하나 (멈춰 선 사람 카트로)
  KT.settings.autoGas = false;
  const at = (ci, f) => { KT.settings.course = ci; KT.toMenu(); KT.switchCourse(ci); startRace('1p'); skipCountdown(); const me = KT.humanKart(0); G.only = [me]; return f(me, KT.HAZ); };
  const waitFor = (sec, cond) => { let ok = false; run(sec, () => { if (cond()) { ok = true; return false; } }); return ok; };
  const stillHit = (me, sec) => { me.immuneT = 0; return waitFor(sec, () => me.spinT > 0); };
  // 쿵쿵 돌: 올라가 있을 때 그 밑에 서 있으면 내려찍혀 납작, 옆 줄은 괜찮음
  at(4, (me, H) => {
    const z = H[1];
    waitFor(4, () => KT.hazAt(z, KT.T()).y > 5.5);
    placeK(me, z.s, z.d, 0);
    const hit = stillHit(me, 3.5), flat = me.flatT > 0;
    waitFor(4, () => KT.hazAt(z, KT.T()).y > 5.5);
    placeK(me, z.s, z.d + 4.6, 0);
    const side = stillHit(me, 3.5);
    assert(hit && flat && !side, '쿵쿵 돌: 밑에 있으면 내려찍혀 납작 · 옆 줄은 괜찮음');
  });
  // 흔들 통나무: 길 가운데에 서 있으면 맞고 옆으로 튕겨 남, 길 가장자리는 통나무가 높이 지나가서 괜찮음
  at(5, (me, H) => {
    const z = H[0];
    placeK(me, z.s, 0, 0);
    const hit = stillHit(me, 3.2), pushed = waitFor(0.8, () => Math.abs(me.d) > 1.5);
    placeK(me, z.s, 7.6, 0);
    const edge = stillHit(me, 3.2);
    assert(hit && pushed && !edge, `흔들 통나무: 가운데는 맞고 옆으로 튕겨 남 · 길 가장자리는 높이 지나감 [${hit} ${pushed} ${edge}]`);
  });
  // 꽃게: 서 있으면 걸어와서 꼬집, 점프 중이면 넘어감
  at(6, (me, H) => {
    const z = H[0];
    placeK(me, z.s, 0, 0);
    const hit = stillHit(me, 6);
    waitFor(12, () => Math.abs(KT.hazAt(z, KT.T()).d) < 0.4 && KT.HZ.vd > 0 && me.immuneT <= 0);
    placeK(me, z.s, 0, 0); me.air = true; me.vy = 6; me.y += 1.0;
    const over = !stillHit(me, 0.25);
    assert(hit && over, '꽃게: 길을 건너다 닿으면 꼬집 · 점프 중이면 넘어감');
  });
  // 사탕 공 · 광산 수레(광산 굴 안) · 자동차(뒤에서 와서 들이받음)
  at(7, (me, H) => { placeK(me, H[0].s, 0, 0); assert(stillHit(me, 7), '사탕 공: 길을 굴러 건너다 닿으면 빙글'); });
  at(8, (me, H) => {
    const z = H.find(q => q.cut >= 0), C = KT.CUTS[z.cut], p = { ...KT.pathPoint(C.P, z.cs, 0) };
    placeK(me, C.from, 0, 0); Object.assign(me, { x: p.x, z: p.z, y: 0, a: Math.atan2(p.tx, p.tz), cut: z.cut, cs: z.cs, cd: 0, d: 0, cseg: Math.round(z.cs / C.P.step) });
    assert(stillHit(me, 9.5) && me.cut === z.cut, '광산 수레: 광산 굴 안 선로를 건너다 닿으면 덜컹');
  });
  at(9, (me, H) => {
    const z = H.find(q => { KT.hazAt(q, KT.T()); return q.b - KT.HZ.s > 120 && KT.HZ.s - q.a > 20; });   // 길 중간을 달리는 차
    KT.hazAt(z, KT.T());
    const s = KT.HZ.s + 30, lane = z.d;
    placeK(me, s, lane, 0);
    const hit = stillHit(me, 5), side = waitFor(0.8, () => Math.abs(me.d - lane) > 1.8);   // 차 옆으로 비켜날 만큼
    assert(hit && side, `${({ car: '자동차', bus: '버스', truck: '트럭' })[z.type]}: 같은 줄에 서 있으면 뒤에서 와서 들이받고 옆으로 튕겨 냄`);
  });
  KT.settings.autoGas = autoGas0; G.only = null;
  KT.settings.course = 0; KT.settings.laps = 3; KT.toMenu(); KT.switchCourse(0); KT.toMenu();
  assert(KT.HAZ.length === 0 && Object.keys(G3.haz || {}).length === 0, '기본 코스엔 장애물 없음');
}

// ---------- 26. 코스 모양 ----------
console.log('\n[26] 코스 모양: 긴 직선을 줄이고 꼬불꼬불하게');
{
  const shapes = [];
  for (const ci of [4, 5, 6, 7, 8, 9]) {
    KT.settings.course = ci; KT.toMenu(); KT.switchCourse(ci); KT.toMenu();
    const T2 = KT.TR;
    let straight = 0, longest = 0, st = -1, turn = 0;
    for (let i = 0; i <= T2.n; i++) {
      const flat = i < T2.n && Math.abs(T2.curv[i]) < 0.006;
      if (flat && st < 0) st = i;
      if (!flat && st >= 0) { const len = (i - st) * T2.step; straight += len; longest = Math.max(longest, len); st = -1; }
      if (i < T2.n) turn += Math.abs(T2.curv[i]) * T2.step;
    }
    shapes.push({ nm: KT.COURSE.name, straight: straight / T2.len, longest, turn: turn * 180 / Math.PI / T2.len * 100 });
  }
  assert(shapes.every(q => q.straight <= 0.41 && q.longest <= 150 && q.turn >= 78),
    `도전 코스·큰 맵: 직선 41% 아래 · 가장 긴 직선 150m 아래 · 100m마다 78° 넘게 꺾임 (${shapes.map(q => `${q.nm} ${(q.straight * 100).toFixed(0)}%·${q.longest.toFixed(0)}m·${q.turn.toFixed(0)}°`).join(' / ')})`);
  KT.settings.course = 0; KT.toMenu(); KT.switchCourse(0); KT.toMenu();
}

// ---------- 19. 그 밖 ----------
console.log('\n[19] 그 밖');
KT.toMenu(); KT.setDemoPaused(true); KT.render();
assert(karts.every(k => k.mesh.group.position.distanceTo(new sandbox.THREE.Vector3(k.x, k.y, k.z)) < 0.01) && !G3.podiumBase.visible && G3.showroom.every(m => !m.group.visible),
  '시범 레이스를 멈춰 둬도 카트가 제자리에 그려지고 시상대·선택 화면 카트는 숨김');
KT.setDemoPaused(false);
assert(KT.levelFor('2d') === 'lowest' && KT.levelFor('high') === 'high', "테니스의 '2D' 설정은 카트에선 가장 가벼운 3D");
assert(['0:05.0', '0:10.0', '1:10.0', '2:05.3'].join() === [5.04, 9.96, 69.96, 125.3].map(KT.fmtTime).join(), `시간 표시: 9.96초도 '0:10.0' (${[5.04, 9.96, 69.96, 125.3].map(KT.fmtTime).join(' · ')})`);
// 거울처럼 뒤집힌 부품도 면 방향이 바깥을 봄
const THREE = sandbox.THREE, bx = new THREE.BoxGeometry(1, 1, 1);
const mg = KT.mergeGeoms([{ geo: bx, matrix: new THREE.Matrix4().makeScale(-1, 1, 1), color: new THREE.Color(1, 0, 0) }]);
const P = mg.attributes.position, Nn = mg.attributes.normal, I = mg.index;
let okFaces = 0;
for (let q = 0; q < I.count; q += 3) {
  const a = new THREE.Vector3().fromBufferAttribute(P, I.getX(q)), b = new THREE.Vector3().fromBufferAttribute(P, I.getX(q + 1)), c = new THREE.Vector3().fromBufferAttribute(P, I.getX(q + 2));
  const fn = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)), vn = new THREE.Vector3().fromBufferAttribute(Nn, I.getX(q));
  if (fn.dot(vn) > 0) okFaces++;
}
assert(okFaces === I.count / 3, '부품을 합칠 때 뒤집힌 부품도 면이 바깥을 봄');
assert(draw.nan === 0, 'HUD 그리기에 NaN 없음' + (draw.nan ? ' (' + draw.nanAt + ')' : ''));
assert(audioLog.bad.length === 0, '소리 값·시간이 모두 정상' + (audioLog.bad.length ? ': ' + audioLog.bad.slice(0, 3).join(', ') : ''));
assert(errors.length === 0, '전체 예외 없음' + (errors.length ? ': ' + errors[0] : ''));
console.log('\n' + (process.exitCode ? '실패 있음' : '모두 통과'));
