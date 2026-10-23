// 테니스 로직 시뮬레이션 테스트: 가짜 DOM으로 스크립트를 돌려 (3D 장면은 WebGL 없이 갱신만)
// 데모·대전·캐릭터 선택·조이콘 입력·그래픽 자동 조절을 확인.  실행: node tools/test_tennis.js
const fs = require('fs'), vm = require('vm'), path = require('path');
const root = path.join(__dirname, '..');
const files = ['shared/vendor/three.min.js', 'shared/store.js', 'shared/audio.js', 'shared/joycon.js', 'shared/characters.js', 'games/tennis/tennis.js'];
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
// CPU 랠리 길이 때문에 테스트 결과가 실행마다 달라지지 않도록 고정한다.
let randomSeed = 0x12345678;
const testMath = Object.create(Math);
testMath.random = () => { randomSeed = (1664525 * randomSeed + 1013904223) >>> 0; return randomSeed / 4294967296; };
let pads = [];
const sandbox = {
  __ST_HEADLESS: '3d',
  Math: testMath,
  document: { getElementById: el, createElement: () => mkEl(''), querySelectorAll: () => [], body: mkEl('body'),
    addEventListener: noop, documentElement: { requestFullscreen: noop }, fullscreenElement: null, hidden: false, exitFullscreen: noop },
  navigator: { getGamepads: () => pads },
  performance: { now: () => now * 1000 },
  requestAnimationFrame: noop, localStorage: { getItem: () => null, setItem: noop },
  innerWidth: 1920, innerHeight: 1080, devicePixelRatio: 1,
  console: { log: (...a) => console.log(...a), warn: noop, error: (...a) => errors.push(a.map(String).join(' ')) },
  setTimeout: noop, setInterval: noop, location: { protocol: 'https:' },
  addEventListener: (name, fn) => { (windowEvents[name] || (windowEvents[name] = [])).push(fn); },
};
sandbox.window = sandbox;
vm.createContext(sandbox);
for (const s of scripts) vm.runInContext(s, sandbox);
const ST = sandbox.__ST, G = ST.game, G3 = ST.G3;
const lat = () => ST.settings.latencyMs / 1000;
const assert = (c, msg) => { if (!c) { console.log('❌ ' + msg); process.exitCode = 1; } else console.log('✅ ' + msg); };
const charCount = ST.CHARS.length;
assert(charCount === 16, '캐릭터 16명 제공');
assert(new Set(ST.CHARS.map(ch => ch.kind)).size === charCount && new Set(ST.CHARS.map(ch => ch.name)).size === charCount && ST.CHARS.every(ch => ch.kind && ch.name), '캐릭터 종류·이름이 모두 고유함');
assert(ST.CHARS.every(ch => Number.isFinite(ch.h) && ch.h > 0 && Number.isFinite(ch.w) && ch.w > 0), '모든 캐릭터의 모델 크기가 유효함');
const savedKinds = ['pikachu', 'eevee', 'charmander', 'squirtle', 'jigglypuff', 'agumon', 'patamon', 'gatomon', 'bulbasaur', 'snorlax', 'togepi', 'terriermon'];
assert(savedKinds.every((kind, i) => ST.CHARS[i] && ST.CHARS[i].kind === kind), '기존 12명 순서를 유지해 저장된 캐릭터 선택과 호환됨');
const addedDigimon = [['gabumon', '파피몬'], ['tentomon', '텐타몬'], ['palmon', '팔몬'], ['gomamon', '쉬라몬']];
assert(addedDigimon.every(([kind, name], i) => ST.CHARS[savedKinds.length + i] && ST.CHARS[savedKinds.length + i].kind === kind && ST.CHARS[savedKinds.length + i].name === name), '추가 디지몬 4종을 마지막 순서에 제공');

// 3D 장면의 모든 물체 위치·회전·크기가 유한한지
function sceneFinite() {
  let bad = 0, n = 0, where = '';
  G3.scene.traverse(o => {
    n++;
    for (const v of [o.position.x, o.position.y, o.position.z, o.quaternion.x, o.quaternion.y, o.quaternion.z, o.quaternion.w, o.scale.x, o.scale.y, o.scale.z]) {
      if (!Number.isFinite(v)) { bad++; where = o.type + ' ' + (o.name || ''); }
    }
    const pos = o.geometry && o.geometry.attributes && o.geometry.attributes.position;
    if (pos && o.geometry.drawRange && o.geometry.drawRange.count !== Infinity) {
      const cnt = Math.min(pos.count, o.geometry.drawRange.count * (o.isPoints ? 1 : 1));
      for (let i = 0; i < Math.min(cnt * 3, pos.array.length); i++) if (!Number.isFinite(pos.array[i])) { bad++; where = 'buffer ' + o.type; break; }
    }
  });
  return { bad, n, where };
}
function step(sec, { render = true, each } = {}) {
  const n = Math.round(sec * 60);
  for (let i = 0; i < n; i++) { now += 1 / 60; if (each) each(); ST.update(); if (render) ST.render(); }
}
function summarize(log, label) {
  const by = {}; let sum = 0, max = 0;
  for (const e of log) { by[e.text] = (by[e.text] || 0) + 1; sum += e.rally; max = Math.max(max, e.rally); }
  console.log(`[${label}] 포인트 ${log.length}개 · 평균 랠리 ${(sum / Math.max(1, log.length)).toFixed(1)} · 최장 ${max}`);
  console.log('   결과:', JSON.stringify(by));
}

assert(ST.gfx.mode3d && G3.built, `3D 장면 생성 (단계 ${ST.gfx.level})`);
let meshCount = 0; G3.scene.traverse(o => { if (o.isMesh || o.isPoints || o.isSprite) meshCount++; });
console.log('   그릴 물체 수(메시·점·스프라이트):', meshCount);

// 처음부터 모션을 끈 경우에도 첫 프레임과 그래픽 전환은 정지 장면을 그린다.
ST.setDemoPaused(true); ST.render();
assert(G3.camera.position.z > 10 && G3.ball.visible, '첫 프레임 전에 데모를 정지해도 카메라와 공을 초기화해 표시함');
const initialPauseT = ST.T();
ST.applyQuality('2d'); ST.render(); ST.applyQuality('mid'); ST.render();
assert(G3.camera.position.z > 10 && G3.ball.visible && ST.T() === initialPauseT, '정지 중 2D에서 3D로 바꿔도 시간이 흐르지 않고 장면이 표시됨');
ST.setDemoPaused(false);

// 메뉴 미리보기 정지: 경기 일시정지와 분리하고 시계·장면을 함께 멈춘다.
step(0.5);
const demoPauseT = ST.T(), demoPauseState = G.state;
const demoPausePositions = JSON.stringify(G3.players.map(p => p.root.position.toArray()));
assert(ST.setDemoPaused(true) && !G.paused, '데모 정지는 경기 일시정지 상태를 바꾸지 않음');
step(1); ST.setDemoPaused(true); step(2);
assert(ST.T() === demoPauseT && G.state === demoPauseState, '데모 정지 중 시간이 흐르거나 CPU가 서브하지 않음');
assert(JSON.stringify(G3.players.map(p => p.root.position.toArray())) === demoPausePositions, '정지된 데모를 다시 그려도 선수 위치가 움직이지 않음');
assert(!ST.setDemoPaused(false) && Math.abs(ST.T() - demoPauseT) < 1e-8, '중복 정지 호출 후 재생해도 게임 시간이 뛰지 않음');
step(0.5);
assert(Math.abs(ST.T() - demoPauseT - 0.5) < 1e-8, '데모 재생 시 멈춘 시점부터 시간이 다시 흐름');
ST.setDemoPaused(true); step(2);
ST.toMenu(); const menuResumeT = ST.T(); step(0.25);
assert(Math.abs(ST.T() - menuResumeT - 0.25) < 1e-8, '메뉴로 돌아가면 데모 정지가 자동 해제됨');

// 1) 메뉴 뒤 데모 (CPU vs CPU) 10분, 3D 갱신 포함
step(120);
step(8 * 60, { each: null });
summarize(G.log, '데모 10분');
assert(G.log.length > 20, '데모에서 포인트가 계속 진행됨');
assert(errors.length === 0, '데모 중 예외 없음' + (errors[0] ? ' — ' + errors[0] : ''));
let fin = sceneFinite();
assert(fin.bad === 0, `3D 물체 ${fin.n}개 좌표 모두 정상` + (fin.bad ? ' — ' + fin.where : ''));
assert(draw.nan === 0, `HUD 그리기 좌표에 NaN 없음 (${draw.calls}회 호출)`);

// 2) 캐릭터 선택 → 2인 대결
ST.settings.mode = '2p';
ST.setDemoPaused(true); step(2);
const selectResumeT = ST.T();
for (const fn of windowEvents.keydown || []) fn({ code: 'Enter', preventDefault: noop });
assert(G.state === 'select' && !el('select').classList.contains('hidden'), '캐릭터 선택 화면 열림');
assert(!G.paused, '정지된 데모에서도 Enter로 캐릭터 선택 화면을 열 수 있음');
let rosterEnterPrevented = false;
for (const fn of windowEvents.keydown || []) fn({ code: 'Enter', target: { closest: s => s === '#roster .tile' }, preventDefault: () => { rosterEnterPrevented = true; } });
assert(!rosterEnterPrevented && !ST.sel[0].ready && !ST.sel[1].ready, '캐릭터 버튼의 Enter는 전체 준비 단축키와 충돌하지 않음');
const before = ST.settings.chars.slice();
ST.selMove(0, 1); ST.selMove(1, -1); ST.selMove(1, -1);
assert(ST.settings.chars[0] === (before[0] + 1) % charCount && ST.settings.chars[1] === (before[1] + charCount - 2) % charCount, `캐릭터 바꾸기 → P1 ${ST.CHARS[ST.settings.chars[0]].name}, P2 ${ST.CHARS[ST.settings.chars[1]].name}`);
step(0.5);
assert(Math.abs(ST.T() - selectResumeT - 0.5) < 1e-8, '정지된 데모에서 선택 화면을 열면 시간이 정상 진행됨');
assert(G3.players[0].ch === ST.CHARS[ST.settings.chars[0]] && G3.players[1].ch === ST.CHARS[ST.settings.chars[1]], '3D 캐릭터 모델도 교체됨');
const desktopAspect = G3.camera.aspect;
G3.camera.aspect = 375 / 812; G3.camera.updateProjectionMatrix(); step(2);
const portraitEdges = [-1.5, 1.5].map(x => new sandbox.THREE.Vector3(x, 1, -2.2).project(G3.camera).x);
assert(portraitEdges.every(x => Math.abs(x) < 1), '세로 화면에서도 선택 화면의 두 캐릭터가 좌우로 잘리지 않음');
G3.camera.aspect = desktopAspect; G3.camera.updateProjectionMatrix(); step(1.5);
// 두 플레이어 모두 마지막 캐릭터 선택 및 양쪽 끝 순환을 확인한다.
for (const pi of [0, 1]) {
  const previous = ST.sel[pi].idx, last = charCount - 1;
  if (ST.sel[pi].idx !== last) ST.selSet(pi, last);
  assert(ST.settings.chars[pi] === last && G3.players[pi].ch === ST.CHARS[last], `P${pi + 1} 마지막 캐릭터 선택·모델 표시`);
  ST.selMove(pi, 1);
  assert(ST.settings.chars[pi] === 0 && G3.players[pi].ch === ST.CHARS[0], `P${pi + 1} 마지막 → 첫 캐릭터 순환`);
  ST.selMove(pi, -1);
  assert(ST.settings.chars[pi] === last && G3.players[pi].ch === ST.CHARS[last], `P${pi + 1} 첫 → 마지막 캐릭터 순환`);
  if (ST.sel[pi].idx !== previous) ST.selSet(pi, previous);
}
// 모든 캐릭터 모델을 차례로 생성·교체해 본다.
const keep = ST.settings.chars[1];
for (let k = 0; k < charCount; k++) { if (k !== ST.sel[1].idx) ST.selSet(1, k); step(0.2); const f = sceneFinite(); if (f.bad) { assert(false, ST.CHARS[k].name + ' 모델 좌표 이상'); } }
assert(true, `캐릭터 ${charCount}명 모델 모두 생성·표시 정상`);
const monsterCtx = fakeCtx(), monsterNaNBefore = draw.nan;
for (const ch of ST.CHARS) for (const front of [true, false]) sandbox.Nolja.characters.drawMonster2D(monsterCtx, ch, 76, 0, 152, front);
assert(draw.nan === monsterNaNBefore, `캐릭터 ${charCount}명 앞·뒷모습 2D 그리기 좌표 모두 정상`);
if (ST.sel[1].idx !== keep) ST.selSet(1, keep);
if (ST.sel[1].ready) ST.selReady(1, false);
ST.emitSwing(0, 0.8, now);          // P1 휘둘러서 준비
assert(ST.sel[0].ready && !ST.sel[1].ready && G.state === 'select', 'P1 휘두르기 → 준비, 아직 시작 안 함');
ST.selMove(1, 1); ST.selReady(1, true);
step(0.3);
assert(G.state === 'select', '둘 다 준비 후 잠깐 대기 (카운트다운)');
step(1.5);
assert(G.state === 'serve' && !G.demo && el('select').classList.contains('hidden'), '카운트다운 끝나면 경기 시작');
fin = sceneFinite();
assert(fin.bad === 0, '선택 후 3D 좌표 정상');

// 3) 2인 대결: 둘 다 (약간 흔들리는) 사람 봇으로 끝까지
G.log.length = 0;
let guard = 0;
const bot = () => {
  const s = G.shot;
  if (G.state === 'serve' && ST.T() - G.stateT > 0.6) ST.emitSwing(G.server, 0.6, now);
  else if (G.state === 'rally' && s && !s.resolved && s.reachable && !s.out) {
    if (s._aim === undefined) s._aim = (testMath.random() - 0.5) * 2.6 * s.W;   // 가끔 판정 창 밖 → 실수
    if (ST.T() >= s.hit.t + lat() + s._aim) ST.emitSwing(s.receiver, 0.3 + testMath.random() * 0.7, now);
  }
};
while (G.state !== 'matchEnd' && guard++ < 60 * 60 * 30) { now += 1 / 60; bot(); ST.update(); if (guard % 2 === 0) ST.render(); }
summarize(G.log, '2인 대결 (사람 봇 둘)');
assert(G.state === 'matchEnd' && G.winner >= 0, `경기 종료 — 승자 ${G.winner >= 0 ? ST.CHARS[ST.settings.chars[G.winner]].name : '-'} (${G.games[0]}:${G.games[1]})`);
assert(!el('result').classList.contains('hidden'), `결과 화면: "${el('resTitle').textContent}"`);
step(2);
fin = sceneFinite();
assert(fin.bad === 0, '세리머니 중 3D 좌표 정상');
assert(Math.abs(G3.players[G.winner].root.position.z + 2.3) < 0.01, '이긴 캐릭터가 앞으로 나와 있음');

// 4) 다시 하기 (같은 캐릭터) → CPU 모드 선택
ST.startMatch();
assert(G.state === 'serve' && G.games[0] === 0, '다시 하기 → 새 경기');
ST.settings.mode = 'cpu'; ST.toMenu(); ST.openSelect();
assert(ST.sel[1].ready && ST.settings.chars[1] !== ST.settings.chars[0], `CPU는 자동 준비 + 다른 캐릭터 (${ST.CHARS[ST.settings.chars[1]].name})`);
ST.selMove(1, 1);
assert(ST.sel[1].ready, '키보드로 CPU 캐릭터는 안 바뀜 (마우스만)');
ST.selReady(0, true); step(1.7);
assert(G.state === 'serve', 'CPU 모드 경기 시작');

// 5) 조이콘 리포트: 버튼으로 캐릭터 고르기, 스윙으로 서브
ST.toMenu(); ST.settings.mode = '2p'; ST.openSelect();
const jc = { player: 1, gyro: 0, armed: true, swinging: false, swingStart: 0, peak: 0, peakT: 0, cool: 0, prevBtn: 0, simple: 0, lastReport: 0, lastPow: 0, lastSwingT: -9, ok: true, device: {} };
function report(dps, b2 = 0, b4 = 0) {
  const dv = new DataView(new ArrayBuffer(48));
  dv.setUint8(1, 0x80); dv.setUint8(2, b2); dv.setUint8(4, b4);
  for (let k = 0; k < 3; k++) { const o = 12 + k * 12; dv.setInt16(o + 2, 4096, true); dv.setInt16(o + 6, Math.round(dps * 0.6 / 0.061), true); dv.setInt16(o + 10, Math.round(dps * 0.8 / 0.061), true); }
  ST.joycon.report(jc, { reportId: 0x30, data: dv });
}
const c1 = ST.settings.chars[1];
now += 0.015; report(5, 0x08); now += 0.015; report(5, 0x00);      // A 버튼 → 다음 캐릭터
assert(ST.settings.chars[1] === (c1 + 1) % charCount, '조이콘 A 버튼 → P2 다음 캐릭터');
now += 0.015; report(5, 0, 0x08); now += 0.015; report(5, 0, 0);    // ← 버튼(왼쪽 조이콘 byte4 0x08) → 이전
assert(ST.settings.chars[1] === c1, '조이콘 ← 버튼 → P2 이전 캐릭터');
for (let i = 0; i < 8; i++) { now += 0.015; report(1100); }
for (let i = 0; i < 5; i++) { now += 0.015; report(5); }
assert(ST.sel[1].ready, '조이콘 스윙 → P2 준비');
ST.selReady(0, true); step(1.7);
assert(G.state === 'serve' && G.server === 0, '경기 시작, P1 서브');
jc.player = 0; jc.cool = 0;
step(0.6, { render: false });
for (let i = 0; i < 8; i++) { now += 0.015; report(1100); }
for (let i = 0; i < 5; i++) { now += 0.015; report(5); }
assert(G.state === 'rally', `조이콘 스윙으로 서브 (세기 ${Math.round(ST.players[0].lastPow * 100)}%)`);
const b = ST.players[0].swingT;
for (let i = 0; i < 6; i++) { now += 0.015; report(300); }
for (let i = 0; i < 6; i++) { now += 0.015; report(5); }
assert(ST.players[0].swingT === b, '약한 흔들림(300도/초)은 스윙 아님');

// 6) 그래픽 자동 조절: 느리면 한 단계씩, 낮춰도 그대로면 원래대로 + 고정
ST.settings.quality = 'auto'; ST.gfx.locked = false; ST.gfx.pending = null; ST.applyQuality('mid');
ST.autoStep(30);
assert(ST.gfx.level === 'low', `30fps → '낮음'으로 (${ST.gfx.level})`);
ST.autoStep(31);
assert(ST.gfx.level === 'mid' && ST.gfx.locked, `낮춰도 그대로 → 원래대로 '보통' + 고정 (${ST.gfx.level})`);
ST.gfx.locked = false; ST.applyQuality('mid');
ST.autoStep(35); ST.autoStep(44);
assert(ST.gfx.level === 'lowest', `개선됐지만 여전히 느림 → 한 단계 더 (${ST.gfx.level})`);
ST.gfx.pending = null; ST.applyQuality('2d');
step(1);
assert(!ST.gfx.mode3d && errors.length === 0, '2D 모드로 전환해도 정상');
ST.applyQuality('high'); step(1);
fin = sceneFinite();
assert(ST.gfx.mode3d && fin.bad === 0, '다시 3D(높음)로 전환해도 정상');

// 7) 게임패드: 선택 화면에서 → 방향키, 경기에서 A 버튼
ST.toMenu(); ST.openSelect();
const btn = p => ({ pressed: p, value: p ? 1 : 0 });
const pad = on => ({ connected: true, index: 0, id: 'Xbox Wireless Controller', mapping: 'standard', axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, (_, i) => btn(on.includes(i))) });
const c0 = ST.settings.chars[0];
pads = [pad([15])]; step(1 / 60, { render: false }); pads = [pad([])]; step(1 / 60, { render: false });
assert(ST.settings.chars[0] === (c0 + 1) % charCount, '게임패드 → 방향키로 캐릭터 바꾸기');
pads = [pad([0])]; step(1 / 60, { render: false }); pads = [];
assert(ST.sel[0].ready, '게임패드 A → 준비');

ST.toMenu(); ST.setDemoPaused(true); step(2);
const matchResumeT = ST.T(); ST.startMatch(); step(0.25);
assert(!G.demo && !G.paused && Math.abs(ST.T() - matchResumeT - 0.25) < 1e-8, '정지된 데모에서 바로 경기 시작 시 정지가 자동 해제됨');
assert(!ST.setDemoPaused(true), '실제 경기 중에는 데모 정지를 적용하지 않음');

// 8) 공 물리: 착지 정확도 · 네트 통과 · 공기저항 · 스핀별 궤적과 바운드
{
  const C = ST.C, from = { x: 0.3, y: -0.9, z: 1.0 }, to = { x: -1.5, y: C.net + 0.75 * C.net };
  const shots = { top: ST.planShot(from, to, 1.05, 0.8), flat: ST.planShot(from, to, 1.05, 0.15), slice: ST.planShot(from, to, 1.05, -0.8) };
  const info = s => {
    const P = s.path, z = i => P[3 * i + 2], dt = 1 / 240, i1 = Math.ceil(s.T1 / dt), i2 = s.bounces[1] ? Math.floor(s.bounces[1].t / dt) : s.n;
    let netZ = 0, apex1 = 0, apex2 = 0;
    for (let i = 1; i < i1; i++) { apex1 = Math.max(apex1, z(i)); if ((P[3 * i - 2] - C.net) * (P[3 * i + 1] - C.net) <= 0) netZ = z(i); }
    for (let i = i1; i < i2; i++) apex2 = Math.max(apex2, z(i));
    const hv = i => Math.hypot(P[3 * i + 3] - P[3 * i], P[3 * i + 4] - P[3 * i + 1]) / dt;
    return { netZ, apex1, apex2, v0: hv(0), vLand: hv(i1 - 2), vOut: hv(i1 + 1) };
  };
  const I = {}; for (const k in shots) I[k] = info(shots[k]);
  for (const k in shots) console.log(`   ${k.padEnd(5)} ${shots[k].speed.toFixed(0)}km/h · 네트 위 ${(I[k].netZ - C.netH).toFixed(2)}m · 최고 ${I[k].apex1.toFixed(2)}m · 바운드 후 최고 ${I[k].apex2.toFixed(2)}m · 수평 ${(I[k].v0 * 3.6).toFixed(0)}→${(I[k].vLand * 3.6).toFixed(0)}→${(I[k].vOut * 3.6).toFixed(0)}km/h`);
  assert(Object.values(shots).every(s => Math.hypot(s.xb - to.x, s.yb - to.y) < 0.05), '공이 노린 자리에 떨어짐 (스핀과 공기저항을 넣어도 조준 정확)');
  assert(Object.values(I).every(o => o.netZ > C.netH + 0.2), '모든 스핀에서 네트를 넘음');
  assert(Object.values(I).every(o => o.vLand < o.v0 * 0.85), '공기저항으로 날아가며 느려짐');
  assert(I.top.apex1 > I.flat.apex1 && I.flat.apex1 > I.slice.apex1, '탑스핀은 높게 떠서 뚝 떨어지고, 슬라이스는 낮게 깔림');
  assert(I.top.apex2 > I.flat.apex2 && I.flat.apex2 > I.slice.apex2, '바운드 뒤 탑스핀은 높게 튀고(킥) 슬라이스는 낮게 미끄러짐');
  assert(I.top.vOut > I.flat.vOut, '탑스핀은 바운드 뒤에도 속도가 덜 줄어듦');
  assert(Object.values(shots).every(s => s.speed > 60 && s.speed < 200), '친 순간 속도가 실제 테니스 범위 (60~200km/h)');
}

// 9) 조이콘 휘두른 방향 → 스핀. 어깨를 중심으로 기울어진 평면에서 라켓을 휘두를 때 조이콘이 보낼 IMU 리포트를 만들어 넣음
//    (포핸드·백핸드 × 조이콘을 어느 쪽으로 쥐었나 × 손목 돌림, 가속도 ±8g · 자이로 ±2000도/초에서 잘림)
function swingReports({ beta, side, head, roll, peakDps = 1400 }) {
  const R = Math.PI / 180, V = (x, y, z) => ({ x, y, z });
  const add = (a, b) => V(a.x + b.x, a.y + b.y, a.z + b.z), mul = (a, k) => V(a.x * k, a.y * k, a.z * k);
  const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z, cross = (a, b) => V(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
  const rot = (v, k, a) => add(add(mul(v, Math.cos(a)), mul(cross(k, v), Math.sin(a))), mul(k, dot(k, v) * (1 - Math.cos(a))));
  const n = mul(V(0, -Math.sin(beta * R), Math.cos(beta * R)), side), e = V(side, 0, 0);   // 회전축 · 타점에서 팔 방향 (x 오른쪽, y 앞, z 위)
  const X0 = mul(e, head), Z0 = add(mul(n, Math.cos(roll * R)), mul(cross(X0, n), Math.sin(roll * R))), Y0 = cross(Z0, X0);
  const phi0 = -100 * R, span = 170 * R, D = 2 * span / (peakDps * R), out = [];
  const sample = (phi, w, wd) => {
    const X = rot(X0, n, phi), Y = rot(Y0, n, phi), Z = rot(Z0, n, phi), r = mul(rot(e, n, phi), 0.6), Om = mul(n, w);
    const f = add(mul(add(cross(mul(n, wd), r), cross(Om, cross(Om, r))), 1 / 9.8), V(0, 0, 1));   // 가속도계 = 운동 가속도 + 중력 반대
    out.push([dot(f, X), dot(f, Y), dot(f, Z), dot(Om, X) / R, dot(Om, Y) / R, dot(Om, Z) / R]);
  };
  for (let t = 0; t < 0.6; t += 0.005) sample(phi0, 0, 0);
  for (let t = 0; t < D; t += 0.005) { const u = t / D, c = 2 * Math.PI * u; sample(phi0 + span * (u - Math.sin(c) / (2 * Math.PI)), span / D * (1 - Math.cos(c)), span / D / D * 2 * Math.PI * Math.sin(c)); }
  for (let t = 0; t < 0.4; t += 0.005) sample(phi0 + span, 0, 0);
  const i16 = v => Math.max(-32768, Math.min(32767, Math.round(v))), reps = [];
  for (let i = 0; i + 3 <= out.length; i += 3) {
    const dv = new DataView(new ArrayBuffer(48)); dv.setUint8(1, 0x80);
    for (let k = 0; k < 3; k++) { const s = out[i + k], o = 12 + k * 12; for (let a = 0; a < 6; a++) dv.setInt16(o + 2 * a, i16(s[a] / (a < 3 ? 0.000244 : 0.061)), true); }
    reps.push(dv);
  }
  return reps;
}
{
  G.paused = true;   // 판정만 보고 경기에는 안 넘김
  const cases = { top: [30, s => s >= 0.6], flat: [0, s => ST.spinLabel(s) === '플랫'], slice: [-25, s => s <= -0.5] };
  const bad = [], badSide = [];
  let motionOk = true;
  for (const side of [1, -1]) for (const head of [1, -1]) for (const roll of [0, 140]) for (const k in cases) {
    const j = { player: 0, gyro: 0, armed: true, swinging: false, swingStart: 0, peak: 0, peakT: 0, cool: 0, prevBtn: 0, simple: 0, lastReport: 0, lastPow: 0, lastSwingT: -9, ok: true, device: {} };
    for (const dv of swingReports({ beta: cases[k][0], side, head, roll })) { now += 0.015; ST.joycon.report(j, { reportId: 0x30, data: dv }); }
    const label = `${k} ${side > 0 ? '포핸드' : '백핸드'} 머리${head > 0 ? '+' : '-'}X 롤${roll}`;
    if (j.lastSpin == null || !cases[k][1](j.lastSpin)) bad.push(`${label}: ${j.lastSpin}`);
    if (j.lastSide !== (side > 0 ? 'fh' : 'bh')) badSide.push(`${label}: ${j.lastSide}`);
    if (!j.motion || j.motion.active || j.motion.angle < 120) motionOk = false;   // 실제로는 170° 휘두름 (420도/초 밑은 빼고 셈)
  }
  G.paused = false;
  assert(bad.length === 0, '조이콘 올려 치기 → 탑스핀, 수평 → 플랫, 깎아 치기 → 슬라이스 (포핸드·백핸드, 쥔 방향·손목 돌림 상관없이 24가지)' + (bad.length ? ' — ' + bad.join(', ') : ''));
  assert(badSide.length === 0, '조이콘 포핸드·백핸드를 휘두른 방향으로 구분 (24가지)' + (badSide.length ? ' — ' + badSide.join(', ') : ''));
  assert(motionOk, '휘두른 각도를 팔로스루 끝까지 따라가고, 멈추면 끝남');
}

// 11) 포핸드·백핸드 자리 잡기 · 조이콘 스윙대로 화면 스윙 · 반대쪽으로 치면 약하게
{
  const RS = [1, -1], seen = { fh: 0, bh: 0 };
  let placedOk = true;
  // 3D 도형 UUID 생성이 난수를 쓰므로 앞선 모델 생성 수와 독립된 데모 시나리오로 확인한다.
  randomSeed = 0x12345678;
  ST.toMenu(); step(0.1, { render: false });
  for (let i = 0, last = null; i < 120 * 60; i++) {
    now += 1 / 60; ST.update();
    const s = G.shot;
    if (s && s !== last && s.kind !== 'serve' && s.hit.z <= 1.8) {
      last = s; seen[s.side]++;
      if (((s.hit.x - s.stand.x) * RS[s.receiver] > 0) !== (s.side === 'fh')) placedOk = false;   // 포핸드면 공이 라켓 쪽에
    }
  }
  assert(placedOk && seen.fh > 10 && seen.bh > 10, `공이 오는 쪽에 따라 포핸드·백핸드로 자리 잡음 (2분 데모: 포핸드 ${seen.fh} · 백핸드 ${seen.bh})`);

  // 2인 경기에서 P2가 조이콘으로 받기: 공이 오는 쪽대로 휘두름 → 휘두르기 시작하자마자 화면 스윙 시작, 타점에서 맞음
  const j = { player: 1, gyro: 0, armed: true, swinging: false, swingStart: 0, peak: 0, peakT: 0, cool: 0, prevBtn: 0, simple: 0, lastReport: 0, lastPow: 0, lastSwingT: -9, ok: true, device: {} };
  const p2 = ST.players[1];
  const receive = (wrongSide, want) => {
    for (let tries = 0; tries < 30; tries++) {
      if (G.state !== 'serve') step(3, { render: false });
      step(0.6, { render: false });
      ST.emitSwing(G.server, 0.6, now);
      const s = G.shot;
      if (!s || s.receiver !== 1 || !s.reachable || s.hit.z > 1.8 || (want && s.side !== want)) { step(4, { render: false }); continue; }
      const side = (s.side === 'fh') !== wrongSide ? 1 : -1;   // 오른손 기준 포핸드 = 위에서 볼 때 반시계
      const reps = swingReports({ beta: 15, side, head: 1, roll: 0 });
      // 리포트를 넣기 시작해서 가장 빠른 순간(타점)까지 약 0.72초 → 그때가 이상적인 타이밍이 되게 시작
      while (ST.T() < s.hit.t + lat() - 0.72) { now += 1 / 60; ST.update(); }
      let liveBeforeHit = false, animAtHit = '';
      for (const dv of reps) {
        now += 0.015; ST.joycon.report(j, { reportId: 0x30, data: dv }); ST.update(); ST.render();
        if (G.shot === s && !s.resolved && p2.swingLive && ST.T() - p2.swingT < 0.2) liveBeforeHit = true;
        if (G.shot !== s && !animAtHit) animAtHit = p2.anim;
      }
      return { s, ns: G.shot !== s ? G.shot : null, liveBeforeHit, animAtHit, flash: p2.flash };
    }
    return null;
  };
  ST.toMenu(); ST.settings.mode = '2p'; ST.startMatch();
  for (const want of ['fh', 'bh']) {
    const r = receive(false, want);
    const name = want === 'fh' ? '포핸드' : '백핸드';
    assert(r && r.ns && r.ns.hitter === 1, `조이콘 ${name} 스윙(가짜 IMU)으로 P2가 받아 넘김`);
    assert(r && r.liveBeforeHit, `${name}: 휘두르기 시작하자마자 화면 속 스윙이 움직임 (판정 전에)`);
    assert(r && r.animAtHit === (want === 'bh' ? 'backhand' : 'drive') && r.flash !== '반대쪽!', `${name}: 휘두른 쪽대로 화면 스윙 (${r ? r.animAtHit : '-'})`);
    step(4, { render: false });
  }
  const ok = receive(false);
  step(4, { render: false });
  const bad = receive(true);
  assert(bad && bad.ns && bad.flash === '반대쪽!' && bad.ns.speed < ok.ns.speed, `반대쪽으로 휘두르면 맞긴 하지만 약하게 (${bad && bad.ns ? Math.round(bad.ns.speed) : '-'} < ${ok && ok.ns ? Math.round(ok.ns.speed) : '-'}km/h)`);
  ST.settings.lefty[1] = true;
  assert(ST.handSide(1, 'fh') === 'bh' && ST.handSide(0, 'fh') === 'fh', '왼손잡이 설정이면 그 선수만 포핸드·백핸드를 반대로 봄');
  ST.settings.lefty[1] = false;
}

// 10) 키보드 쉼표(P2) = 슬라이스로 받아 침
{
  ST.toMenu(); ST.settings.mode = '2p'; ST.startMatch();
  let got = null;
  for (let tries = 0; tries < 6 && !got; tries++) {
    step(0.6, { render: false });
    ST.emitSwing(G.server, 0.6, now);
    const s = G.shot;
    if (!s || s.receiver !== 1 || !s.reachable) { step(4, { render: false }); continue; }
    while (ST.T() < s.hit.t + lat()) step(1 / 60, { render: false });
    for (const fn of windowEvents.keydown || []) fn({ code: 'Comma', preventDefault: noop });
    if (G.shot !== s) got = G.shot;
    step(4, { render: false });
  }
  assert(got && got.hitter === 1 && got.spin < -0.5 && got.kind === 'drive', `키보드 쉼표로 슬라이스 리턴 (스핀 ${got ? got.spin : '-'})`);
}

assert(errors.length === 0, '전체 예외 없음' + (errors[0] ? ' — ' + errors[0] : ''));
assert(draw.nan === 0, '전체 HUD NaN 없음');
