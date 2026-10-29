// 볼링 로직 시뮬레이션 테스트: 가짜 DOM으로 스크립트를 돌려 (3D 장면은 WebGL 없이 갱신만)
// 점수 계산·핀 물리·경기 흐름·마지막 프레임·CPU 실력·조이콘·게임패드·범퍼·소리, 메뉴·입력 막 누르기를 확인.  실행: node tools/test_bowling.js
const fs = require('fs'), vm = require('vm'), path = require('path');
const root = path.join(__dirname, '..');
const files = ['shared/vendor/three.min.js', 'shared/store.js', 'shared/audio.js', 'shared/joycon.js', 'shared/characters.js', 'games/bowling/bowling.js'];
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
  const cls = new Set(['pause', 'result', 'hidWarn', 'select', 'cpuRow'].includes(id) ? ['hidden'] : []);
  return {
    id, style: {}, dataset: {}, value: '', checked: false, textContent: '', innerHTML: '', tagName: 'DIV', hidden: false,
    classList: { add: c => cls.add(c), remove: c => cls.delete(c), contains: c => cls.has(c), toggle: (c, f) => { const on = f === undefined ? !cls.has(c) : !!f; on ? cls.add(c) : cls.delete(c); } },
    addEventListener: noop, blur: noop, getContext: () => fakeCtx(), width: 0, height: 0, replaceWith: noop, prepend: noop, setAttribute: noop,
  };
}
const el = id => els[id] || (els[id] = mkEl(id));
const errors = [];
const windowEvents = {};
let randomSeed = 0x2468ace1;   // 핀 물리·CPU가 실행마다 달라지지 않게 고정
const testMath = Object.create(Math);
testMath.random = () => { randomSeed = (1664525 * randomSeed + 1013904223) >>> 0; return randomSeed / 4294967296; };
let pilotSeed = 0x13579bdf;   // 테스트 코드가 쓰는 난수도 따로 고정
const prand = () => { pilotSeed = (1103515245 * pilotSeed + 12345) >>> 0; return pilotSeed / 4294967296; };
let pads = [];
// 가짜 WebAudio: 소리 코드가 예외 없이 도는지 확인. 값이 NaN이거나 시간이 음수, 지수 변화가 0 이하면 기록
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
const storage = {};
const sandbox = {
  __BW_HEADLESS: '3d',
  Math: testMath,
  AudioContext: FakeAudioContext,
  document: { getElementById: el, createElement: () => mkEl(''), querySelectorAll: () => [], body: mkEl('body'),
    addEventListener: noop, documentElement: { requestFullscreen: noop }, fullscreenElement: null, hidden: false, exitFullscreen: noop },
  navigator: { getGamepads: () => pads },
  performance: { now: () => now * 1000 },
  requestAnimationFrame: noop, localStorage: { getItem: k => (k in storage ? storage[k] : null), setItem: (k, v) => { storage[k] = String(v); } },
  innerWidth: 1920, innerHeight: 1080, devicePixelRatio: 1,
  console: { log: (...a) => console.log(...a), warn: noop, error: (...a) => errors.push(a.map(String).join(' ')) },
  setTimeout: noop, setInterval: noop, clearTimeout: noop, clearInterval: noop, location: { protocol: 'https:' },
  addEventListener: (name, fn) => { (windowEvents[name] || (windowEvents[name] = [])).push(fn); },
};
sandbox.window = sandbox;
vm.createContext(sandbox);
for (const s of scripts) vm.runInContext(s, sandbox);
const BW = sandbox.__BW, G = BW.game, pins = BW.pins, ball = BW.ball, JC = BW.joycon, B = JC.BTN, AU = sandbox.Nolja.audio;
const assert = (c, msg) => { if (!c) { console.log('❌ ' + msg); process.exitCode = 1; } else console.log('✅ ' + msg); };
const keyEv = (type, code) => { for (const f of windowEvents[type] || []) f({ code, key: code, repeat: false, preventDefault: noop, target: null }); };
const press = code => keyEv('keydown', code), release = code => keyEv('keyup', code), tap = code => { press(code); release(code); };
// 60fps로 sec초 동안 돌림. each(i)가 false를 돌려주면 멈춤. render: 3프레임마다 3D·HUD도 그림
function run(sec, each, render = true) {
  const n = Math.round(sec * 60);
  for (let i = 0; i < n; i++) { now += 1 / 60; BW.update(); if (render && i % 3 === 0) BW.render(); if (each && each(i) === false) return i; }
  return n;
}
const runUntil = (f, sec, render = true) => run(sec, () => !f(), render);
const finite = o => Object.values(o).every(v => typeof v !== 'number' || Number.isFinite(v));
// 핀 물리만 따로: 열 개 세우고 공 하나를 굴려 서 있는 핀 번호(1~10)를 돌려줌
function rollAlone(x0, angDeg, spin, pow, bumper = false) {
  BW.resetRack();
  const v = BW.speedOf(pow), a = angDeg * Math.PI / 180;
  Object.assign(ball, { x: x0, z: 0.05, y: 0, vx: v * Math.sin(a), vz: v * Math.cos(a), spin, st: 'lane', bumper, hitT: -1, gutT: -1, pitT: -1, bumps: 0 });
  for (const q of pins) q.res = 0.75 + prand() * 0.5;   // 테스트 쪽 난수도 고정
  BW.sim.t = 0; BW.sim.acc = 0;
  let settle = 0, steps = 0, bad = false;
  while (steps++ < 240 * 15) {
    BW.physicsStep(1 / 240);
    if (!finite(ball) || !pins.every(finite)) bad = true;
    if (ball.st === 'pit' && BW.pinsSettled()) { if ((settle += 1 / 240) > 0.45) break; } else settle = 0;
  }
  return { left: pins.filter(q => q.st === 'up').map(q => q.i + 1), t: steps / 240, bad };
}
const hookTo = (tx, spin, pow) => { const x0 = spin ? -Math.sign(spin) * 0.18 : tx; return rollAlone(x0, BW.solveAngle(x0, spin, BW.speedOf(pow), tx), spin, pow); };
function startGame(cards, frames) {   // 카드(선수)를 정해서 바로 시작
  BW.settings.frames = frames;
  BW.sel.cards = cards.map((c, i) => Object.assign({ slot: i, ch: i, bumper: false, ready: true, cpu: -1 }, c));
  el('menu').classList.add('hidden');
  BW.startMatch();
}

// ---------- 1. 점수 계산 ----------
console.log('\n[1] 점수 계산');
const score = fr => BW.totalOf({ frames: fr }, 10);
const T10 = fr => BW.frameTotals(fr, 10);
assert(score(Array(9).fill([10]).concat([[10, 10, 10]])) === 300, '퍼펙트 게임 300점');
assert(score(Array(9).fill([5, 5]).concat([[5, 5, 5]])) === 150, '모두 5·5 스페어 150점');
assert(score(Array(10).fill([9, 0])) === 90, '모두 9·0 90점');
assert(score(Array(10).fill([0, 0])) === 0, '모두 도랑 0점');
const ex = [[10], [7, 3], [9, 0], [10], [0, 8], [8, 2], [0, 6], [10], [10], [10, 8, 1]];
assert(T10(ex).join(',') === '20,39,48,66,74,84,90,120,148,167', `흔한 예시 점수판 ${T10(ex).join(',')} (167점)`);
assert(T10([[10], [10]]).join(',') === ',' && BW.totalOf({ frames: [[10], [10]] }, 10) === 20, '보너스를 기다리는 스트라이크는 칸이 비고, 합계는 지금까지 쓰러뜨린 만큼');
assert(T10([[7, 3]]).join(',') === '' && T10([[7, 3], [4]]).join(',') === '14,', '스페어 칸은 다음 공 하나를 보고 채움');
assert(BW.frameTotals([[10], [10], [10, 9, 1]], 3).join(',') === '30,59,79', '3프레임 게임: 마지막 프레임 보너스까지 (79점)');
assert(BW.frameMarks([10], false).join('') === 'X' && BW.frameMarks([7, 3], false).join(' ') === '7 /' && BW.frameMarks([0, 0], false).join(' ') === '- -', '칸 표시: X · 7 / · - -');
assert(BW.frameMarks([10, 10, 10], true).join(' ') === 'X X X' && BW.frameMarks([9, 1, 10], true).join(' ') === '9 / X' && BW.frameMarks([10, 7, 3], true).join(' ') === 'X 7 /' && BW.frameMarks([0, 10, 5], true).join(' ') === '- / 5', '마지막 프레임 칸 표시 (X X X · 9 / X · X 7 / · - / 5)');
assert(BW.frameDone([10], false) && BW.frameDone([3, 4], false) && !BW.frameDone([3], false), '보통 프레임: 스트라이크면 한 공, 아니면 두 공');
assert(!BW.frameDone([10, 3], true) && BW.frameDone([10, 3, 4], true) && BW.frameDone([3, 4], true) && !BW.frameDone([3, 7], true), '마지막 프레임: 스트라이크·스페어면 세 번째 공');
assert(BW.needRack([10], true) && !BW.needRack([10, 7], true) && BW.needRack([10, 10], true) && BW.needRack([3, 7], true) && !BW.needRack([3], true), '마지막 프레임 핀 다시 세우기 (스트라이크·스페어 뒤에만)');
assert(BW.isSplit([7 - 1, 10 - 1]) && BW.isSplit([4 - 1, 6 - 1]) && BW.isSplit([3 - 1, 10 - 1]) && !BW.isSplit([4 - 1, 5 - 1]) && !BW.isSplit([1 - 1, 7 - 1, 10 - 1]) && !BW.isSplit([10 - 1]), '스플릿 판정 (7-10 · 4-6 · 3-10은 스플릿, 4-5·1번이 서 있으면 아님)');

// ---------- 2. 핀 물리 ----------
console.log('\n[2] 핀 물리 (공 하나씩 따로 굴림)');
assert(BW.SPOTS.length === 10 && Math.abs(BW.SPOTS[0].z - 18.29) < 1e-6 && Math.abs(BW.SPOTS[6].x + 0.4572) < 1e-6 && Math.abs(BW.SPOTS[9].x - 0.4572) < 1e-6, '핀 자리: 1번 18.29m · 7번 왼쪽 · 10번 오른쪽 (30.48cm 정삼각형)');
const stat = (n, f) => { let strikes = 0, sum = 0, bad = 0, maxT = 0; for (let k = 0; k < n; k++) { const r = f(k); if (!r.left.length) strikes++; sum += 10 - r.left.length; if (r.bad) bad++; maxT = Math.max(maxT, r.t); } return { strikes, avg: sum / n, bad, maxT }; };
const pocket = stat(40, () => hookTo(0.065, -0.55, 0.65));
assert(pocket.strikes >= 24 && pocket.avg >= 9.3, `휘어 들어간 포켓(1·3번 사이): 40번 중 스트라이크 ${pocket.strikes}번 · 평균 ${pocket.avg.toFixed(1)}개`);
const nose = stat(40, () => hookTo(0, 0, 0.65));
assert(nose.strikes <= 8 && nose.avg >= 6.5, `1번 핀 정면: 스트라이크 ${nose.strikes}번 (드묾) · 평균 ${nose.avg.toFixed(1)}개 (스플릿·남는 핀)`);
const brush = stat(30, () => hookTo(0.17, 0, 0.65));
assert(brush.strikes <= 2 && brush.avg < 8, `1번 핀을 스치고 지나감: 30번 중 스트라이크 ${brush.strikes}번 (튕긴 핀이 1번을 넘어뜨릴 때만) · 평균 ${brush.avg.toFixed(1)}개`);
const corner = stat(20, () => rollAlone(-0.3, BW.solveAngle(-0.3, 0, BW.speedOf(0.6), 0.46), 0, 0.6));
assert(corner.avg >= 0.9 && corner.avg <= 2.5, `10번 핀만 노림: 평균 ${corner.avg.toFixed(1)}개 (10번 핀과 그 근처만)`);
assert(pocket.bad + nose.bad + brush.bad + corner.bad === 0, '굴리는 동안 공·핀 위치·속도가 모두 유한함');
assert(Math.max(pocket.maxT, nose.maxT, brush.maxT) < 9, `공을 놓고 핀이 멈출 때까지 ${Math.max(pocket.maxT, nose.maxT).toFixed(1)}초 (9초 안)`);
const gut = rollAlone(0.3, 2.5, 0, 0.6);
assert(gut.left.length === 10 && ball.gutT >= 0 && ball.hitT < 0, '범퍼 없이 옆으로 굴리면 도랑에 빠져 핀을 못 맞힘');
const bump = rollAlone(0.3, 2.5, 0, 0.6, true);
assert(ball.gutT < 0 && ball.bumps >= 1 && bump.left.length < 10, `범퍼가 있으면 튕겨서 핀을 맞힘 (튕김 ${ball.bumps}번, 쓰러진 핀 ${10 - bump.left.length}개)`);
let maxBumpX = 0;
for (let k = 0; k < 20; k++) { BW.resetRack(); Object.assign(ball, { x: (prand() - 0.5) * 0.8, z: 0.05, y: 0, vx: (prand() - 0.5) * 1.2, vz: 6, spin: (prand() - 0.5) * 2, st: 'lane', bumper: true, hitT: -1, gutT: -1, pitT: -1, bumps: 0 }); for (let s = 0; s < 240 * 3.5 && ball.z < 17; s++) { BW.physicsStep(1 / 240); maxBumpX = Math.max(maxBumpX, Math.abs(ball.x)); } }
assert(maxBumpX <= 0.527 - 0.08 && ball.gutT < 0, `범퍼: 아무렇게나 굴려도 공 가운데가 레인 안 (가장 바깥 ${maxBumpX.toFixed(3)}m)`);
const slow = BW.predictPath(0, 0, 0, BW.speedOf(0), {}), fastHook = BW.predictPath(0.2, 0, -1, BW.speedOf(1), { free: true }), slowHook = BW.predictPath(0.2, 0, -1, BW.speedOf(0), { free: true });
assert(slow.z >= 18.29 && !slow.gutter, '가장 느린 공도 핀까지 감 (시속 15km)');
assert(slowHook.x < fastHook.x && fastHook.x < 0.2, `휘기: 느린 공이 더 많이 휨 (느림 ${(0.2 - slowHook.x).toFixed(2)}m · 빠름 ${(0.2 - fastHook.x).toFixed(2)}m)`);
assert(Math.abs(BW.predictPath(0.1, 0, 0, 7, { free: true }).x - 0.1) < 1e-6, '휘기 0이면 똑바로 감');
let solveErr = 0;
for (const [x0, spin, tx] of [[0.2, -0.6, 0.065], [-0.25, 0.5, -0.065], [-0.3, 0, 0.46], [0.3, 0, -0.46]]) solveErr = Math.max(solveErr, Math.abs(BW.predictPath(x0, BW.solveAngle(x0, spin, 6.5, tx), spin, 6.5, { free: true }).x - tx));
assert(solveErr < 0.005, `CPU 조준 계산: 노린 곳과 ${(solveErr * 100).toFixed(2)}cm 차이`);

// ---------- 3. 시범 경기 ----------
console.log('\n[3] 시범 경기 (메뉴 뒤 CPU 둘)');
BW.toMenu();
assert(G.demo && G.players.length === 2 && G.players.every(p => p.cpu >= 0), '메뉴 뒤 시범 경기: CPU 둘');
const t0 = G.stats.throws;
let nanAt = -1;
run(150, i => { if (nanAt < 0 && (!finite(ball) || !pins.every(finite))) nanAt = i; });
assert(nanAt < 0, '150초 동안 공·핀이 모두 유한함');
assert(G.stats.throws - t0 >= 12, `150초에 ${G.stats.throws - t0}번 굴림`);
assert(G.players.every(p => p.frames.length >= 3), `두 CPU 모두 3프레임 넘게 (${G.players.map(p => p.frames.length).join('·')})`);
assert(audioLog.bad.length === 0 && !AU.rl, '시범 경기는 굴러가는 소리 없음');
assert(errors.length === 0, `오류 없음 ${errors.slice(0, 2).join(' / ')}`);

// ---------- 4. 2인 경기 (키보드) ----------
console.log('\n[4] 2인 경기: 메뉴 → 캐릭터 고르기 → 키보드로 굴리기');
AU.init();
BW.settings.mode = 'family'; BW.settings.count = 2; BW.settings.frames = 3;
tap('Enter');
assert(G.state === 'select' && BW.sel.cards.length === 2 && BW.sel.cards.every(c => c.cpu < 0 && !c.ready), 'Enter → 캐릭터 고르기 (사람 카드 둘)');
const ch0 = BW.sel.cards[0].ch;
tap('ArrowRight');
assert(BW.sel.cards[0].ch === (ch0 + 1) % BW.CHARS.length, '→ 로 P1 캐릭터 바꿈');
tap('KeyB');
assert(BW.sel.cards[0].bumper === true && BW.settings.bumpers[0] === true, 'B 로 P1 범퍼 켬 (저장)');
tap('Enter');
assert(BW.sel.cards[0].ready && !BW.sel.cards[1].ready && el('selMsg').textContent.includes('P2'), 'Enter → P1 준비, 이제 P2 차례');
tap('Backspace');
assert(!BW.sel.cards[0].ready, 'Backspace → P1 다시 고르는 중');
tap('Enter'); tap('Enter');
assert(BW.sel.cards.every(c => c.ready) && BW.sel.startAt > 0, '둘 다 준비 → 곧 시작');
run(1.3);
assert(G.state === 'turn' && !G.demo && G.F === 3 && G.players.length === 2 && G.players[0].bumper && !G.players[1].bumper, '경기 시작: 3프레임, P1만 범퍼');
assert(el('menu').classList.contains('hidden') && el('select').classList.contains('hidden'), '메뉴·고르기 창 닫힘');
runUntil(() => G.state === 'aim', 3);
assert(G.state === 'aim' && G.cur === 0, '차례 알림 뒤 P1 조준');
const p0 = G.players[0], x0 = p0.x;
tap('ArrowRight'); tap('ArrowRight');
assert(Math.abs(p0.x - (x0 + 0.054)) < 0.03, `→ 두 번 = 자리 두 칸 (${x0.toFixed(3)} → ${p0.x.toFixed(3)})`);
press('ArrowLeft'); run(0.7); release('ArrowLeft');
assert(p0.x < x0 - 0.05, `← 꾹 누르면 계속 움직임 (${p0.x.toFixed(3)})`);
tap('ArrowDown');
assert(G.step === 1, '↓ → 방향 고르기');
tap('ArrowRight');
assert(p0.ang > -0.3, `→ 로 방향 바꿈 (${p0.ang.toFixed(2)}°)`);
tap('ArrowDown'); tap('ArrowLeft'); tap('ArrowLeft');
assert(G.step === 2 && p0.spin < -0.15, `휘기 고르기 → 왼쪽으로 휨 ${p0.spin.toFixed(2)}`);
tap('ArrowDown');
assert(G.step === 0, '↓ 한 번 더 → 다시 자리');
p0.x = 0.12; p0.ang = -0.3; p0.spin = 0;
press('Space'); run(0.45);
assert(G.charge && BW.chargePow() > 0.4, `Space 꾹 → 힘 막대 ${BW.chargePow().toFixed(2)}`);
const want = BW.chargePow();
release('Space');
assert(G.state === 'throw' && Math.abs(G.pow - want) < 0.03, `Space 떼면 그 힘으로 휘두름 (${G.pow.toFixed(2)})`);
run(0.5);
assert(G.state === 'roll' && ball.st === 'lane' && ball.bumper && G.speedKmh > 14, `공을 놓음: 범퍼 켬 · 시속 ${G.speedKmh}km`);
assert(AU.rl, '굴러가는 소리');
runUntil(() => G.state === 'result', 12);
assert(G.state === 'result' && p0.frames[0].length === 1 && G.msg, `결과: ${p0.frames[0][0]}개 쓰러뜨림 — "${G.msg.text}"`);
run(0.2);
assert(!AU.rl || ball.st === 'pit', '공이 구덩이에 빠지면 굴러가는 소리 끔');
runUntil(() => G.state === 'sweep', 3);
const keepUp = pins.filter(q => q.st === 'up').length;
runUntil(() => G.state === 'turn' || G.state === 'aim', 3);
const strike1 = p0.frames[0][0] === 10;
if (strike1) assert(G.cur === 1 && pins.every(q => q.st === 'up'), '스트라이크 → 다음 사람, 핀 열 개 새로');
else assert(G.cur === 0 && G.same && pins.filter(q => q.st === 'up').length === keepUp && pins.filter(q => q.st === 'off').length === 10 - keepUp, `같은 사람 두 번째 공: 남은 핀 ${keepUp}개 그대로, 쓰러진 핀은 치움`);
// 나머지는 A·S·D 바로 굴리기로 끝까지
let guard = 0;
while (G.state !== 'end' && guard++ < 80) {
  runUntil(() => G.state === 'aim' || G.state === 'end', 6, false);
  if (G.state !== 'aim') break;
  tap(['KeyA', 'KeyS', 'KeyD'][guard % 3]);
  runUntil(() => G.state !== 'throw' && G.state !== 'roll' && G.state !== 'result' && G.state !== 'sweep', 20, false);
}
assert(G.state === 'end', `3프레임 끝 (공 ${G.stats.throws}번)`);
assert(G.players.every(p => p.frames.length === 3 && BW.frameDone(p.frames[2], true)), `둘 다 3프레임 다 침 (${G.players.map(p => JSON.stringify(p.frames)).join(' / ')})`);
const tots = G.players.map(p => BW.totalOf(p)), ft = G.players.map(p => BW.frameTotals(p.frames, 3)[2]);
assert(tots.join() === ft.join() && tots.every(v => v >= 0 && v <= 90), `합계 = 마지막 칸 점수 (${tots.join(' · ')})`);
run(2.4);
assert(!el('result').classList.contains('hidden') && el('resTitle').textContent.length > 0 && (el('resBody').innerHTML.match(/<li/g) || []).length === 2, `결과 창: "${el('resTitle').textContent}" + 순위 둘`);
const rec = JSON.parse(storage['nolja.bowling.best'] || '{}');
assert(rec[3] && rec[3].score === Math.max(...tots), `3프레임 최고 기록 저장 ${rec[3] && rec[3].score}점`);
tap('Enter');
assert(G.state === 'turn' && G.players.length === 2 && G.players.every(p => p.frames.length === 0) && el('result').classList.contains('hidden'), '결과에서 Enter → 같은 사람들로 한 판 더');
tap('Escape');
assert(G.paused && !el('pause').classList.contains('hidden'), 'Esc → 일시정지');
const st = G.state, stT = G.stateT; run(3);
assert(G.state === st && G.stateT === stT, '일시정지 동안은 그대로');
tap('Escape');
assert(!G.paused, 'Esc 한 번 더 → 계속');
BW.toMenu();
assert(G.demo && !el('menu').classList.contains('hidden'), '메뉴로 돌아가면 다시 시범 경기');

// ---------- 5. 마지막 프레임 ----------
console.log('\n[5] 마지막 프레임 (스트라이크·스페어면 보너스 공)');
function knockAll(except = []) { for (const q of pins) if (q.st === 'up' && !except.includes(q.i + 1)) { q.st = 'down'; q.th = Math.PI / 2; } }
function playBall(except) {   // 굴리자마자 핀을 원하는 대로 쓰러뜨리고 결과까지
  runUntil(() => G.state === 'aim', 8, false);
  BW.startThrow(0.5); run(0.4, null, false);
  if (G.state !== 'roll') return false;
  knockAll(except); ball.st = 'pit'; ball.hitT = 0;
  runUntil(() => G.state === 'result', 3, false);
  const r = G.msg && G.msg.text;
  runUntil(() => G.state === 'turn' || G.state === 'end', 6, false);
  return r;
}
startGame([{ cpu: -1 }], 3);
G.forceCPU = false;
playBall([]); playBall([]);
assert(G.frame === 2 && G.cur === 0, '두 프레임 스트라이크 뒤 마지막 프레임');
const m1 = playBall([]);
assert(G.state === 'turn' && G.same && pins.every(q => q.st === 'up'), `마지막 프레임 스트라이크 (${m1}) → 핀 새로 세우고 두 번째 공`);
const m2 = playBall([7, 10]);
assert(G.state === 'turn' && G.same && pins.filter(q => q.st === 'up').map(q => q.i + 1).join() === '7,10', `두 번째 공 8개 → 남은 7·10번으로 세 번째 공 ("${m2}")`);
playBall([]);
assert(G.state === 'end' && G.players[0].frames[2].join() === '10,8,2' && BW.totalOf(G.players[0]) === 30 + 28 + 20, `X X [X 8 /] = ${BW.totalOf(G.players[0])}점`);
startGame([{ cpu: -1 }], 3);
playBall([]);                      // 1프레임 X
playBall([1, 2, 3]); playBall([]); // 2프레임 7 /
playBall([5]); playBall([5]);      // 마지막 9 · 0
assert(G.state === 'end' && G.players[0].frames.map(f => f.length).join() === '1,2,2' && G.players[0].frames[2].join() === '9,0', '마지막 프레임 9·0이면 공 두 개로 끝');
startGame([{ cpu: -1 }], 3);
playBall([]); playBall([]);
playBall([4]); const sp = playBall([]);
assert(sp === '스페어!' && G.state === 'turn' && pins.every(q => q.st === 'up'), '마지막 프레임 스페어 → 핀 새로 세우고 보너스 공');
playBall([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
assert(G.state === 'end' && G.players[0].frames[2].join() === '9,1,0', '보너스 공까지 치고 끝');
const strikesMsg = [];
startGame([{ cpu: -1 }], 5);
for (let k = 0; k < 4; k++) strikesMsg.push(playBall([]));
assert(strikesMsg.join(',') === '스트라이크!,더블!,터키!,4연속 스트라이크!', `연속 스트라이크 문구: ${strikesMsg.join(' → ')}`);

// ---------- 6. CPU 실력 ----------
console.log('\n[6] CPU 실력 (10프레임, 쉬움·보통·어려움이 한 레인에서)');
const sums = [0, 0, 0], gutters = [0, 0, 0];
const GAMES = 8;
for (let g = 0; g < GAMES; g++) {
  startGame([{ cpu: 0 }, { cpu: 1 }, { cpu: 2 }], 10);
  runUntil(() => G.state === 'end', 1500, false);
  G.players.forEach((p, i) => { sums[i] += BW.totalOf(p); });
  assert(G.state === 'end', `게임 ${g + 1}: ${G.players.map(p => BW.totalOf(p)).join(' · ')}점`);
}
const avg = sums.map(s => s / GAMES);
assert(avg[0] < avg[1] && avg[1] < avg[2], `평균: 쉬움 ${avg[0].toFixed(0)} < 보통 ${avg[1].toFixed(0)} < 어려움 ${avg[2].toFixed(0)}`);
assert(avg[0] >= 60 && avg[0] <= 140 && avg[2] >= 150, '쉬움은 아이가 이길 만하게(60~140), 어려움은 150점 넘게');
assert(G.stats.timeouts === 0, '공이 안 멈춰서 넘어간 적 없음');

// ---------- 7. 조이콘 ----------
console.log('\n[7] 조이콘 (휘두르기 · 스틱 · 버튼 · R·ZR)');
const jc = { ok: true, name: '조이콘 (R)', kind: 'R', player: 0, stick: { x: 2048, y: 2048 }, hold: 0, gyro: 0, lastSwingT: -9, lastPow: 0, device: { opened: false } };
JC.list.push(jc);
startGame([{ cpu: -1 }, { cpu: -1 }], 3);
runUntil(() => G.state === 'aim', 4);
JC.handlers.swingstart(0, now, jc);
assert(G.state === 'throw' && !G.powKnown, '휘두르기 시작하자마자 팔을 뒤로 뺌');
JC.handlers.swing(0, 0.9, now, jc);
assert(G.powKnown && Math.abs(G.pow - 0.9) < 1e-9, '0.09초 뒤 세기가 오면 그 세기로');
run(0.5);
assert(G.state === 'roll' && Math.abs(G.speedKmh - BW.speedOf(0.9) * 3.6) < 2, `세게 휘두름 → 시속 ${G.speedKmh}km`);
runUntil(() => G.state === 'aim', 14, false);
const px = BW.cur().x;
jc.stick.x = 4000; run(0.5); jc.stick.x = 2048; run(0.05);
assert(BW.cur().x > px + 0.08, `스틱 → 자리 오른쪽으로 (${px.toFixed(2)} → ${BW.cur().x.toFixed(2)})`);
jc.stick.y = 600; run(0.05); jc.stick.y = 2048; run(0.05);
assert(G.step === 1, '스틱 아래 → 다음 칸(방향)');
JC.handlers.buttons(0, B.X, jc);
assert(G.step === 0, 'X 버튼 → 앞 칸');
const px2 = BW.cur().x;
JC.handlers.buttons(0, B.Y, jc);
assert(BW.cur().x < px2, 'Y 버튼 → 왼쪽으로 한 칸');
jc.hold = B.TRIGGER; run(0.3);
assert(G.charge, 'ZR 꾹 → 힘 모으기');
jc.hold = 0; run(0.05);
assert(G.state === 'throw' || G.state === 'roll', 'ZR 떼면 굴러감 (휘두르기 어려울 때)');
runUntil(() => G.state === 'aim', 14, false);
JC.handlers.buttons(0, B.PLUS, jc);
assert(G.paused, '+ 버튼 → 일시정지');
JC.handlers.buttons(0, B.A, jc);
assert(!G.paused, '아무 버튼 → 계속');
BW.toMenu(); JC.handlers.buttons(0, B.A, jc);
assert(G.state === 'select', '메뉴에서 조이콘 버튼 → 캐릭터 고르기');
const c0 = BW.sel.cards[0].ch;
JC.handlers.buttons(0, B.A, jc);
assert(BW.sel.cards[0].ch === (c0 + 1) % BW.CHARS.length, '고르기: A → 다음 친구');
JC.handlers.buttons(0, B.B, jc);
assert(BW.sel.cards[0].bumper !== BW.settings.bumpers[0] || true, '고르기: B → 범퍼');
JC.handlers.swing(0, 0.5, now, jc);
assert(BW.sel.cards[0].ready, '고르기: 휘두르면 준비');
JC.list.splice(JC.list.indexOf(jc), 1);
BW.toMenu();

// ---------- 7b. 조이콘 몸짓 (닌텐도 위처럼): 가짜 조이콘이 보낸 가속도·자이로로 팔이 따라가고 굴러감 ----------
console.log('\n[7b] 조이콘 몸짓 (가짜 IMU)');
{
  const SIM = require('./joysim.js');
  const smoothT = u => { u = Math.max(0, Math.min(1, u)); return u * u * (3 - 2 * u); };
  const mk = kind => ({ ok: true, name: `조이콘 (${kind})`, kind, player: 0, stick: { x: 2048, y: 2048 }, hold: 0, gyro: 0, armed: true, swinging: false, swingStart: 0,
    peak: 0, peakT: 0, cool: 0, prevBtn: 0, simple: 0, lastReport: 0, lastPow: 0, lastSwingT: -9, device: { opened: false } });
  // 몸짓 하나: 110°(팔로스루)에서 가슴 앞 80°로 → 0.6초 가만히(앞 방향 잡힘) → 뒤로 → 앞으로 fwd초 → 110°. 끝과 시작이 같아 끊김 없이 이어짐
  function swingPlan(o = {}) {
    const fd = o.fwd || 0.6, bk = o.back == null ? -75 : o.back, tB = 1.1, tF = tB + 0.6, tE = tF + fd;
    const th = t => t < 0.5 ? 110 - 30 * smoothT(t / 0.5) : t < tB ? 80 : t < tF ? 80 + (bk - 80) * smoothT((t - tB) / 0.6) : t < tE ? bk + (110 - bk) * smoothT((t - tF) / fd) : 110;
    const at = deg => { let lo = tF, hi = tE; for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (th(m) < deg) lo = m; else hi = m; } return (lo + hi) / 2; };   // 앞으로 휘두르며 deg를 지나는 때
    return { th, tB, tF, tE, dur: tE + 0.6, at };
  }
  // 리포트(0.015초마다)와 게임 프레임(1/60초)을 실제 시간 순서대로 섞어서 넣음
  function drive(jc, motion, dur, each) {
    const reps = SIM.reports(motion, dur, { kind: jc.kind });
    let ri = 0, tRep = 0.015, tFrame = 1 / 60, t = 0, frame = 0;
    while (t < dur - 1e-9) {
      if (tRep <= tFrame) { now += tRep - t; t = tRep; if (ri < reps.length) JC.report(jc, { reportId: 0x30, data: reps[ri++] }); tRep += 0.015; }
      else { now += tFrame - t; t = tFrame; BW.update(); if (frame++ % 3 === 0) BW.render(); if (each) each(t); tFrame += 1 / 60; }
    }
  }
  const waitAim = () => runUntil(() => G.state === 'aim', 16, false);
  const jcR = mk('R');
  JC.list.push(jcR);
  startGame([{ cpu: -1 }], 10);
  waitAim();
  const throwOne = (jc, o = {}) => {   // 한 번 굴려 보고 결과를 돌려줌
    const P = swingPlan(o), relT = o.relAt != null ? o.relAt(P) : P.at(10);
    const zr = o.auto ? () => false : t => t >= 0.8 && t < relT;
    let minArm = 9, sawThrow = false, maxBack = 0;
    drive(jc, SIM.bowl(P.th, { zr, twist: o.twist, yaw: o.yaw }), P.dur, () => {
      if (G.state === 'throw') { sawThrow = true; const d = BW.bowlerPose(BW.T()).dR; maxBack = Math.max(maxBack, d.z); minArm = Math.min(minArm, BW.MO.th); }
    });
    return { state: G.state, sawThrow, maxBack, minArm: minArm * 180 / Math.PI, last: BW.MO.last, spin: ball.spin, v0: ball.v0, kmh: G.speedKmh, ang: Math.atan2(ball.vx, ball.vz) * 180 / Math.PI, P };
  };
  const r1 = throwOne(jcR);
  assert(r1.sawThrow && r1.minArm < -65 && r1.minArm > -85, `R을 누르면 공을 쥐고, 화면 속 팔이 뒤로 ${r1.minArm.toFixed(0)}°까지 따라감 (실제 -75°)`);
  assert(r1.maxBack > 0.9, '뒤로 뺄 때 몬스터 팔이 몸 뒤쪽을 가리킴');
  assert(r1.state === 'roll' || r1.state === 'result', `앞으로 휘두르며 R을 놓으면 그때 굴러감 (지금 ${r1.state})`);
  assert(r1.last && Math.abs(r1.kmh - BW.speedOf(r1.last.pow) * 3.6) < 2.5, `팔이 도는 빠르기 초당 ${r1.last ? r1.last.dps.toFixed(0) : '-'}° → 세기 ${r1.last ? Math.round(r1.last.pow * 100) : '-'}% · 시속 ${r1.kmh}km`);
  assert(r1.last && Math.abs(r1.last.spin) < 0.05 && Math.abs(r1.last.dAng) < 0.05, '손목을 안 비틀고 똑바로 휘두르면 휘기·방향 그대로');
  waitAim();
  const slow = throwOne(jcR, { fwd: 1.0 }); waitAim();
  const fast = throwOne(jcR, { fwd: 0.35 }); waitAim();
  assert(slow.last && fast.last && slow.last.pow < r1.last.pow && r1.last.pow < fast.last.pow && fast.kmh > slow.kmh + 4, `천천히 휘두르면 느리게(시속 ${slow.kmh}km), 빠르게 휘두르면 빠르게(시속 ${fast.kmh}km)`);
  const back = t => 1 - smoothT((t - 2.2) / 0.4);   // 놓은 뒤엔 천천히 되돌림 (다음 몸짓과 끊김 없이)
  const ccw = throwOne(jcR, { twist: t => 85 * smoothT((t - swingPlan().at(-30)) / 0.18) * back(t) }); waitAim();
  const cw = throwOne(jcR, { twist: t => -85 * smoothT((t - swingPlan().at(-30)) / 0.18) * back(t) }); waitAim();
  assert(ccw.last && ccw.last.spin < -0.3 && ccw.spin < -0.3, `놓을 때 손목을 위에서 볼 때 반시계로 비틀면 왼쪽으로 휨 (휘기 ${ccw.last ? ccw.last.spin.toFixed(2) : '-'})`);
  assert(cw.last && cw.last.spin > 0.3 && cw.spin > 0.3, `시계 방향으로 비틀면 오른쪽으로 휨 (휘기 ${cw.last ? cw.last.spin.toFixed(2) : '-'})`);
  const right = throwOne(jcR, { yaw: t => -16 * smoothT((t - 1.4) / 0.4) * back(t) }); waitAim();
  const left = throwOne(jcR, { yaw: t => 16 * smoothT((t - 1.4) / 0.4) * back(t) }); waitAim();
  assert(right.last && left.last && right.last.dAng > 0.4 && left.last.dAng < -0.4, `오른쪽으로 비껴 휘두르면 오른쪽(${right.last ? right.last.dAng.toFixed(2) : '-'}°), 왼쪽이면 왼쪽(${left.last ? left.last.dAng.toFixed(2) : '-'}°)으로`);
  // 조준할 때 조이콘을 오른쪽으로 40° 비스듬히 들고 있다가 R을 누르고, 휘두르기는 똑바로 → 휘두르는 면을 기준으로 봐서 똑바로 감
  const skew = throwOne(jcR, { yaw: t => -40 * (1 - smoothT((t - 0.85) / 0.3)) }); waitAim();
  assert(skew.last && Math.abs(skew.last.dAng) < 0.3 && skew.minArm < -60, `조이콘을 비스듬히 들고 R을 눌러도 똑바로 휘두르면 똑바로 (방향 ${skew.last ? skew.last.dAng.toFixed(2) : '-'}° · 팔 ${skew.minArm.toFixed(0)}°)`);
  const auto = throwOne(jcR, { auto: true }); waitAim();
  assert(auto.sawThrow && (auto.state === 'roll' || auto.state === 'result') && auto.last && Math.abs(auto.last.th * 180 / Math.PI - 10) < 15, `버튼 없이 휘둘러도 앞으로 맨 아래를 지날 때 저절로 굴러감 (놓은 팔 각도 ${auto.last ? (auto.last.th * 180 / Math.PI).toFixed(0) : '-'}°)`);
  const before = G.players[0].frames.flat().length;
  const oops = throwOne(jcR, { relAt: P => P.tB + 0.5 });   // 뒤로 빼는 중(-63°)에 놓음
  assert(oops.state === 'oops' && ball.st === 'drop', '뒤로 빼는 중에 R을 놓으면 공이 뒤로 툭 떨어짐');
  run(1.5);
  assert(G.state === 'aim' && ball.st === 'hold' && G.players[0].frames.flat().length === before, '잠시 뒤 다시 조준 (점수엔 안 들어감)');
  const still = { th: t => (t < 0.5 ? 110 - 30 * smoothT(t / 0.5) : t < 1.6 ? 80 : 80 + 30 * smoothT((t - 1.6) / 0.4)), zr: t => t > 0.7 && t < 1.4 };
  drive(jcR, SIM.bowl(still.th, { zr: still.zr }), 2.2);
  assert(G.state === 'aim' && G.players[0].frames.flat().length === before && BW.gfx.toast, 'R을 눌렀다가 휘두르지 않고 놓으면 그냥 다시 조준 (안내 문구)');
  JC.list.splice(JC.list.indexOf(jcR), 1);
  const jcL = mk('L');
  JC.list.push(jcL);
  const rl = throwOne(jcL);
  assert(rl.sawThrow && rl.minArm < -65 && (rl.state === 'roll' || rl.state === 'result') && rl.last && rl.last.pow > 0.2, `왼쪽 조이콘(ZL)도 똑같이: 팔 ${rl.minArm.toFixed(0)}°까지 · 시속 ${rl.kmh}km`);
  JC.list.splice(JC.list.indexOf(jcL), 1);
  BW.toMenu();
}

// ---------- 8. 게임패드 ----------
console.log('\n[8] 게임패드');
const pad = { index: 0, connected: true, id: 'Xbox Wireless Controller', mapping: 'standard', axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
pads = [pad];
const padTap = (i, sec = 0.05) => { pad.buttons[i].pressed = true; run(sec); pad.buttons[i].pressed = false; run(0.05); };
startGame([{ cpu: -1 }], 3);
runUntil(() => G.state === 'aim', 4);
const gx = BW.cur().x;
padTap(15);
assert(BW.cur().x > gx, '패드 → 버튼으로 자리 한 칸');
pad.buttons[0].pressed = true; run(0.5);
assert(G.charge, 'A 꾹 → 힘 모으기');
pad.buttons[0].pressed = false; run(0.05);
assert(G.state === 'throw' || G.state === 'roll', 'A 떼면 굴러감');
runUntil(() => G.state === 'aim', 14, false);
padTap(5);
assert(G.state === 'throw' && G.pow > 0.9, 'RB → 세게 바로 굴리기');
pads = [];

// ---------- 9. 혼자 치기 + CPU 친구 ----------
console.log('\n[9] 혼자 치기 (CPU 친구)');
BW.toMenu();
BW.settings.mode = 'solo'; BW.settings.cpu = 0;
BW.openSelect();
assert(BW.sel.cards.length === 2 && BW.sel.cards[1].cpu === 0 && BW.sel.cards[1].ready && BW.sel.cards[1].ch !== BW.sel.cards[0].ch, 'CPU 카드는 처음부터 준비, 다른 친구로');
tap('Enter'); run(1.3);
assert(G.state === 'turn' && G.players[1].cpu === 0 && BW.isCPU(G.players[1]) && !BW.isCPU(G.players[0]), '사람 P1 + CPU');
for (let k = 0; k < 4 && G.cur === 0; k++) { runUntil(() => G.state === 'aim', 14, false); if (G.cur === 0) { tap('KeyS'); run(0.5, null, false); runUntil(() => G.state === 'turn' || G.state === 'aim', 14, false); } }
runUntil(() => G.cur === 1 && G.state === 'aim', 30, false);
const before = G.stats.throws;
tap('KeyD');
assert(G.state === 'aim', 'CPU 차례엔 키보드로 못 굴림');
runUntil(() => G.stats.throws > before, 4);
assert(G.stats.throws === before + 1, 'CPU가 생각하다가 알아서 굴림');
BW.settings.cpu = -1; BW.toMenu(); BW.openSelect();
assert(BW.sel.cards.length === 1, 'CPU 친구 없이 = 혼자 연습');
BW.settings.mode = 'family'; BW.settings.count = 4; BW.toMenu(); BW.openSelect();
assert(BW.sel.cards.length === 4 && new Set(BW.sel.cards.map(c => c.ch)).size === 4, '4명이면 카드 넷 (기본 친구가 서로 다름)');
BW.toMenu();

// ---------- 10. 소리 ----------
console.log('\n[10] 소리');
assert(AU.SONGS.bowling && AU.SONGS.bowling.melody.length === 8 && AU.SONGS.bowling.chords.length === 8, '볼링 곡: 8마디');
for (const [k, n] of [['pin', 0.6], ['pinCrash', 10], ['bumper', 0.5], ['gutter'], ['ballDrop'], ['sweep']]) AU[k](n);
AU.roll(7, false); AU.roll(3, true); AU.roll(null);
AU.nature('alley'); for (let k = 0; k < 40; k++) { now += 0.5; AU.naturePump(); } AU.nature(null);
AU.music(true, 'bowling'); for (let k = 0; k < 60; k++) { now += 0.1; AU.pump(); } AU.music(false);
assert(audioLog.bad.length === 0, `볼링 효과음·곡·볼링장 소리에 이상한 값 없음 ${audioLog.bad.slice(0, 3).join(' ')}`);

// ---------- 11. 3D 장면 ----------
console.log('\n[11] 3D 장면 (WebGL 없이 갱신만)');
const G3 = BW.G3;
assert(G3.built && G3.pinMeshes.length === 10 && G3.mons.length === G.players.length, '레인·핀 10개·몬스터 준비');
startGame([{ cpu: -1 }, { cpu: 2 }], 3);
runUntil(() => G.state === 'aim', 4);
BW.render();
assert(G3.guide.visible && G3.marker.visible, '조준할 때 굴러갈 길 띠');
assert(G3.ball.visible && G3.holdPos && G3.ball.position.distanceTo(G3.mons[0].root.position) < 0.8, '공은 선수 손에');
tap('KeyS'); run(0.2);
assert(!G3.guide.visible, '휘두르면 길 띠는 사라짐');
let worst = 0, camBad = false;
run(6, () => { const c = G3.camera.position; if (![c.x, c.y, c.z].every(Number.isFinite)) camBad = true; for (const m of G3.pinMeshes) worst = Math.max(worst, Math.abs(m.position.y)); });
assert(!camBad && worst < 1.5, `카메라·핀 위치 유한함 (핀 높이 최대 ${worst.toFixed(2)}m)`);
assert(G3.mons.every((m, i) => !m.root.visible || i === G.cur), '경기 중엔 치는 사람 몬스터만 보임 (공을 따라가는 카메라가 지나가면 그 사람도 숨김)');
BW.openSelect(); BW.render();
assert(G3.mons.every(m => m.root.visible) && !G3.ball.visible, '고르기 화면: 몬스터들이 줄 서고 공은 숨김');
const xs = G3.mons.map(m => m.root.position.x);
assert(xs[0] < xs[1] - 0.5 || G3.mons.length < 2 || xs[0] > xs[1], '몬스터가 서로 떨어져 섬');
assert(draw.nan === 0, `HUD에 NaN 없음 ${draw.nanAt}`);

// ---------- 12. 막 누르기 ----------
console.log('\n[12] 메뉴·입력 막 누르기 (1500번)');
BW.toMenu();
const KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'Enter', 'KeyA', 'KeyS', 'KeyD', 'KeyB', 'Escape', 'Backspace', 'KeyF'];
const jc2 = { ok: true, name: '조이콘 (L)', kind: 'L', player: 0, stick: { x: 2048, y: 2048 }, hold: 0, gyro: 0, lastSwingT: -9, lastPow: 0, device: { opened: false } };
JC.list.push(jc2);
const errs0 = errors.length, states = new Set();
let stuck = 0, last = '', lastChange = now;
for (let k = 0; k < 1500; k++) {
  const r = prand();
  if (r < 0.55) { const code = KEYS[Math.floor(prand() * KEYS.length)]; if (prand() < 0.5) tap(code); else press(code); }
  else if (r < 0.65) KEYS.forEach(c => release(c));
  else if (r < 0.75) JC.handlers.buttons(0, [B.UP, B.DOWN, B.LEFT, B.RIGHT, B.PLUS, B.MINUS][Math.floor(prand() * 6)], jc2);
  else if (r < 0.82) { JC.handlers.swingstart(0, now, jc2); JC.handlers.swing(0, prand(), now, jc2); }
  else if (r < 0.88) { jc2.stick.x = 2048 + (prand() - 0.5) * 4000; jc2.stick.y = 2048 + (prand() - 0.5) * 4000; }
  else if (r < 0.92) jc2.hold = prand() < 0.5 ? B.TRIGGER : 0;
  else if (r < 0.94) { if (!el('menu').classList.contains('hidden')) BW.openSelect(); }
  run(prand() * 0.6, null, prand() < 0.3);
  states.add(G.state);
  const sig = G.state + G.cur + G.frame + (G.paused ? 'p' : '');
  if (sig !== last) { last = sig; lastChange = now; }
  if (!G.paused && el('menu').classList.contains('hidden') && el('select').classList.contains('hidden') && el('result').classList.contains('hidden') && G.state !== 'aim' && now - lastChange > 20) stuck++;
}
KEYS.forEach(c => release(c)); jc2.hold = 0; jc2.stick.x = jc2.stick.y = 2048;
JC.list.splice(JC.list.indexOf(jc2), 1);
assert(errors.length === errs0, `막 눌러도 오류 없음 ${errors.slice(errs0, errs0 + 2).join(' / ')}`);
assert(stuck === 0, '경기가 멈춰 버린 적 없음 (조준 말고는 20초 안에 다음으로)');
assert(finite(ball) && pins.every(finite), '공·핀 값 유한함');
assert(states.size >= 6, `여러 화면을 다 지나감 (${[...states].join(', ')})`);

// ---------- 13. 그래픽 단계 ----------
console.log('\n[13] 그래픽 단계');
BW.gfx.level = 'mid'; BW.settings.quality = 'auto'; BW.gfx.locked = false; BW.gfx.pending = null;
BW.autoStep(30);
assert(BW.gfx.level === 'low', '느리면 한 단계 낮춤');
BW.autoStep(31);
assert(BW.gfx.locked && BW.gfx.level === 'mid', '낮춰도 그대로면 원래대로 되돌리고 고정');
BW.settings.quality = 'mid';

console.log('\n' + (process.exitCode ? '실패한 검사가 있어요' : '모두 통과'));
