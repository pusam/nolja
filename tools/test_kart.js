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
  Object.assign(k, { x: p.x, z: p.z, y: 0, a: Math.atan2(p.tx, p.tz) + (back ? Math.PI : 0), v, vl: 0, vy: 0, vyG: 0, air: false, rampAir: false, trick: false, hop: false,
    drift: null, driftArm: false, spinT: 0, immuneT: 0, boostT: 0, roulT: 0, item: null, stuckT: 0, wrongT: 0, steer: 0 });
  const q = KT.locate(k.x, k.z, -1); k.seg = q.i; k.s = q.s; k.d = q.d;
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
  const s = Math.random() * TR.len, d = (Math.random() - 0.5) * 2 * KT.TRACK.halfW, p = KT.trackPoint(s, d), q = KT.locate(p.x, p.z, -1);
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
assert(['boost', 'zap', 'trap'].includes(me.item), `룰렛이 멈추면 아이템: ${me.item}`);
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
function kidRace(level, seed) {
  randomSeed = seed >>> 0;
  KT.settings.cpuLevel = level; KT.settings.laps = 3; JC.list.length = 0;
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
    if (t > st.wanderAt) { st.wander = (Math.random() - 0.5) * 6; st.wanderAt = t + 2 + Math.random() * 3; }
    if (t > st.idle && Math.random() < 1 / 480) st.idle = t + 0.6;
    if (t < st.idle) return;
    const q = KT.trackPoint(seen.s + 9 + seen.v * 0.3, st.wander);
    const err = wrapA(Math.atan2(q.x - seen.x, q.z - seen.z) - seen.a);
    st.noise += ((Math.random() - 0.5) * 0.9 - st.noise) * 0.08;
    const steer = Math.max(-1, Math.min(1, -err * 1.6 + st.noise)), ang = (3 + Math.abs(steer) * 25) * Math.sign(steer) * Math.PI / 180;
    jc.accel = { x: -Math.sin(ang), y: 0, z: Math.cos(ang) };
    jc.hold = me.item && Math.random() < 0.02 ? B.B : 0;
  });
  JC.list.length = 0;
  return { place: me.place, zaps };
}
const easy = [kidRace(0, 1000), kidRace(0, 1077), kidRace(0, 1154)], hard = [kidRace(2, 1026), kidRace(2, 1103), kidRace(2, 1180)];
const avgPlace = rs => rs.reduce((a, r) => a + r.place, 0) / rs.length;
assert(avgPlace(easy) <= 2, `쉬움: 아이처럼 흔들리며 달려도 평균 ${avgPlace(easy).toFixed(1)}등 (2등 안)`);
assert(easy.every(r => r.zaps === 0), '쉬움 CPU는 번개 구슬을 안 씀');
assert(avgPlace(hard) >= 3, `어려움: 같은 운전이면 평균 ${avgPlace(hard).toFixed(1)}등 (쉽게 못 이김)`);
{
  startRace('1p'); KT.settings.cpuLevel = 0; skipCountdown();
  const cpuK = karts.find(k => k.human < 0), meK = KT.humanKart(0);
  G.only = [cpuK, meK]; cpuK.ai.base = cpuK.speedMul = 0.78;
  placeK(cpuK, 20, -4, 15); placeK(meK, 20, 4, 15); cpuK.boostT = meK.boostT = 2; run(1.2);
  assert(cpuK.v < meK.v - 3, `CPU 부스트도 실력만큼만 빨라짐 (쉬움 CPU ${cpuK.v.toFixed(1)} · 사람 ${meK.v.toFixed(1)}m/s)`);
  G.only = null; KT.settings.cpuLevel = 1;
}

// ---------- 13. 그 밖 ----------
console.log('\n[13] 그 밖');
KT.toMenu(); KT.setDemoPaused(true); KT.render();
assert(karts.every(k => k.mesh.group.position.distanceTo(new sandbox.THREE.Vector3(k.x, k.y, k.z)) < 0.01) && !G3.podiumBase.visible && G3.showroom.every(m => !m.group.visible),
  '시범 레이스를 멈춰 둬도 카트가 제자리에 그려지고 시상대·선택 화면 카트는 숨김');
KT.setDemoPaused(false);
assert(KT.levelFor('2d') === 'lowest' && KT.levelFor('high') === 'high', "테니스의 '2D' 설정은 카트에선 가장 가벼운 3D");
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
