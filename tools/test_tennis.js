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
let pads = [];
const sandbox = {
  __ST_HEADLESS: '3d',
  document: { getElementById: el, createElement: () => mkEl(''), querySelectorAll: () => [], body: mkEl('body'),
    addEventListener: noop, documentElement: { requestFullscreen: noop }, fullscreenElement: null, hidden: false, exitFullscreen: noop },
  navigator: { getGamepads: () => pads },
  performance: { now: () => now * 1000 },
  requestAnimationFrame: noop, localStorage: { getItem: () => null, setItem: noop },
  innerWidth: 1920, innerHeight: 1080, devicePixelRatio: 1,
  console: { log: (...a) => console.log(...a), warn: noop, error: (...a) => errors.push(a.map(String).join(' ')) },
  setTimeout: noop, setInterval: noop, location: { protocol: 'https:' }, addEventListener: noop,
};
sandbox.window = sandbox;
vm.createContext(sandbox);
for (const s of scripts) vm.runInContext(s, sandbox);
const ST = sandbox.__ST, G = ST.game, G3 = ST.G3;
const lat = () => ST.settings.latencyMs / 1000;
const assert = (c, msg) => { if (!c) { console.log('❌ ' + msg); process.exitCode = 1; } else console.log('✅ ' + msg); };

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
ST.openSelect();
assert(G.state === 'select' && !el('select').classList.contains('hidden'), '캐릭터 선택 화면 열림');
const before = ST.settings.chars.slice();
ST.selMove(0, 1); ST.selMove(1, -1); ST.selMove(1, -1);
assert(ST.settings.chars[0] === (before[0] + 1) % 8 && ST.settings.chars[1] === (before[1] + 6) % 8, `캐릭터 바꾸기 → P1 ${ST.CHARS[ST.settings.chars[0]].name}, P2 ${ST.CHARS[ST.settings.chars[1]].name}`);
step(0.5);
assert(G3.players[0].ch === ST.CHARS[ST.settings.chars[0]] && G3.players[1].ch === ST.CHARS[ST.settings.chars[1]], '3D 캐릭터 모델도 교체됨');
// 모든 캐릭터 모델 만들어 보기 (P2로 8명 차례로)
const keep = ST.settings.chars[1];
for (let k = 0; k < 8; k++) { if (k !== ST.sel[1].idx) ST.selSet(1, k); step(0.2); const f = sceneFinite(); if (f.bad) { assert(false, ST.CHARS[k].name + ' 모델 좌표 이상'); } }
assert(true, '캐릭터 8명 모델 모두 생성·표시 정상');
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
    if (s._aim === undefined) s._aim = (Math.random() - 0.5) * 2.6 * s.W;   // 가끔 판정 창 밖 → 실수
    if (ST.T() >= s.hit.t + lat() + s._aim) ST.emitSwing(s.receiver, 0.3 + Math.random() * 0.7, now);
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
assert(ST.settings.chars[1] === (c1 + 1) % 8, '조이콘 A 버튼 → P2 다음 캐릭터');
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
assert(ST.settings.chars[0] === (c0 + 1) % 8, '게임패드 → 방향키로 캐릭터 바꾸기');
pads = [pad([0])]; step(1 / 60, { render: false }); pads = [];
assert(ST.sel[0].ready, '게임패드 A → 준비');

assert(errors.length === 0, '전체 예외 없음' + (errors[0] ? ' — ' + errors[0] : ''));
assert(draw.nan === 0, '전체 HUD NaN 없음');
