// 소파 조작 테스트: 가짜 조이콘·게임패드·화면 요소로 메뉴 고르기와 알림을 확인 (shared/joycon.js + shared/couch.js)
//  실행: node tools/test_couch.js
const fs = require('fs'), vm = require('vm'), path = require('path');
const root = path.join(__dirname, '..');
let now = 1.0, ticks = null;
const docEvents = {}, winEvents = {};
const fire = (map, type, e) => { for (const f of map[type] || []) f(e); };
function classes() { const c = new Set(); return { add: x => c.add(x), remove: x => c.delete(x), contains: x => c.has(x) }; }
function mkEl(sel, rect, opt = {}) {
  const e = Object.assign({ sel, clicks: 0, disabled: false, tabIndex: 0, classList: classes(), kids: [], events: [],
    getBoundingClientRect: () => e.rect, focus() { doc.activeElement = e; fire(docEvents, 'focusin', { target: e }); }, scrollIntoView() {},
    click() { e.clicks++; if (e.onclick) e.onclick(); }, dispatchEvent(ev) { e.events.push(ev.type); },
    matches: s => s.split(',').some(p => { p = p.trim(); return p === e.sel || (p === 'input[type=range]' && e.range); }) }, opt);
  e.rect = rect;
  return e;
}
const box = (x, y, w = 100, h = 40) => ({ left: x, top: y, right: x + w, bottom: y + h, width: w, height: h });
function layerEl(kids) {
  const e = mkEl('.layer', box(0, 0, 1000, 800));
  e.kids = kids; e.closeCount = 0; e.close = () => { e.closeCount++; e.open = false; };
  e.querySelectorAll = () => e.kids; e.querySelector = s => e.kids.find(k => k.sel === s) || null; e.contains = x => e.kids.includes(x);
  e.scrollHeight = 2000; e.clientHeight = 800; e.scrolled = 0; e.scrollBy = o => { e.scrolled += o.top; }; e.parentElement = null;
  return e;
}
const doc = { activeElement: null, hidden: false, body: { appendChild: n => { doc.kids.push(n); } }, kids: [],
  getElementById: id => doc.kids.find(k => k.id === id) || null,
  createElement: () => { const n = { kids: [], classList: classes(), setAttribute() {}, appendChild(c) { n.kids.push(c); n.children = n.kids; c.remove = () => { n.kids.splice(n.kids.indexOf(c), 1); }; }, children: [] }; return n; },
  addEventListener: (t, f) => { (docEvents[t] = docEvents[t] || []).push(f); } };
let gamepads = [];
const sandbox = { console, Math, performance: { now: () => now * 1000 }, document: doc, Event: class { constructor(t) { this.type = t; } },
  navigator: { getGamepads: () => gamepads }, getComputedStyle: () => ({ overflowY: 'auto' }),
  setTimeout: () => 0, setInterval: f => { ticks = f; return 0; }, addEventListener: (t, f) => { (winEvents[t] = winEvents[t] || []).push(f); } };
sandbox.window = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);
for (const f of ['shared/joycon.js', 'shared/couch.js']) vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), sandbox);
const J = sandbox.Nolja.joycon, C = sandbox.Nolja.couch, B = J.BTN;
console.log('문법 OK');
let pass = 0, fail = 0;
function assert(ok, msg) { if (ok) { pass++; console.log('  ✓ ' + msg); } else { fail++; console.log('  ✗ ' + msg); } }

// 가짜 입력 리포트: 버튼 비트(앞면·방향키·+/−) · 스틱 · 가속도 · 배터리 (윗 4비트)
function report(jc, { m = 0, stick = [2048, 2048], acc = [0, 0, 1], bat = 8 } = {}) {
  const d = new DataView(new ArrayBuffer(48));
  d.setUint8(1, bat << 4);
  d.setUint8(2, m & 0x0f); d.setUint8(4, (m >> 4) & 0x0f); d.setUint8(3, (m >> 8) & 0x03);
  const so = jc.kind === 'R' ? 8 : 5;
  d.setUint8(so, stick[0] & 0xff); d.setUint8(so + 1, (stick[0] >> 8) | ((stick[1] & 0x0f) << 4)); d.setUint8(so + 2, stick[1] >> 4);
  for (let k = 0; k < 3; k++) for (let i = 0; i < 3; i++) d.setInt16(12 + k * 12 + 2 * i, Math.round(acc[i] * 4096), true);
  J.report(jc, { reportId: 0x30, data: d });
}
const newJc = (kind, player = 0) => ({ kind, player, name: kind === 'L' ? '조이콘 (L)' : '조이콘 (R)', ok: true, device: {}, prevBtn: 0, gyro: 0, armed: true, cool: 0, simple: 0, accel: { x: 0, y: 0, z: 1 } });
const SIDE = [0, -1, 0], UP = [1, 0, 0], FLAT = [0, 0, 1];   // 레일이 위 · 어깨가 위 · 눕힘

console.log('\n[1] 쥔 방향과 자리');
{
  const R = newJc('R'), L = newJc('L');
  J.wheel = false;
  report(R, { acc: UP }); report(L, { acc: UP });
  assert(!J.sideways(R) && !J.sideways(L), '세로로 쥐면 세로');
  let f = J.faceOf(R, B.A); assert(f.ok && !f.back, '세로 R: A = 누르기');
  f = J.faceOf(R, B.B); assert(f.back && !f.ok, '세로 R: B = 뒤로');
  f = J.faceOf(L, B.RIGHT); assert(f.ok && !f.back, '세로 L: 오른쪽 = 누르기');
  f = J.faceOf(L, B.DOWN); assert(f.back, '세로 L: 아래 = 뒤로');
  report(R, { stick: [3400, 2048], acc: UP }); let a = J.stickAxes(R); assert(a.x > 0.9 && Math.abs(a.y) < 0.05, '세로 R: 스틱 오른쪽 = 오른쪽');
  report(R, { acc: SIDE }); report(L, { acc: SIDE });
  assert(J.sideways(R) && J.sideways(L), '레일이 위를 보면 가로');
  f = J.faceOf(R, B.X); assert(f.ok && !f.back, '가로 R: 오른쪽 자리 X = 누르기');
  f = J.faceOf(R, B.A); assert(f.back && !f.ok, '가로 R: 아래 자리 A = 뒤로');
  f = J.faceOf(L, B.DOWN); assert(f.ok && !f.back, '가로 L: 오른쪽 자리 ↓ = 누르기');
  f = J.faceOf(L, B.LEFT); assert(f.back && !f.ok, '가로 L: 아래 자리 ← = 뒤로');
  report(R, { stick: [2048, 3400], acc: SIDE }); a = J.stickAxes(R); assert(a.x > 0.9, '가로 R: 스틱을 어깨 쪽으로 밀면 오른쪽');
  report(L, { stick: [2048, 3400], acc: SIDE }); a = J.stickAxes(L); assert(a.x < -0.9, '가로 L: 스틱을 어깨 쪽으로 밀면 왼쪽 (스틱이 왼쪽 끝)');
  report(L, { stick: [3400, 2048], acc: SIDE }); a = J.stickAxes(L); assert(a.y > 0.9, '가로 L: 스틱을 레일 쪽으로 밀면 위');
  report(R, { stick: [700, 2048], acc: SIDE }); a = J.stickAxes(R); assert(a.y > 0.9, '가로 R: 스틱을 레일 쪽으로 밀면 위');
  report(R, { acc: FLAT }); assert(!J.sideways(R), '눕혀 두면 세로와 같은 자리');
  J.wheel = true;
  assert(J.sideways(R), '카트(가로가 기본): 눕혀 쥐어도 가로');
  report(R, { acc: UP }); assert(!J.sideways(R), '카트: 세로로 세우면 세로');
  J.wheel = false;
  const P = { kind: 'pro', accel: { x: 0, y: 0, z: 1 } };
  f = J.faceOf(P, B.LEFT); assert(f.dir === 'left' && !f.ok, '프로콘: 방향키 = 칸 옮기기');
  f = J.faceOf(P, B.B); assert(f.back, '프로콘: B = 뒤로');
}

console.log('\n[2] 다음 칸 고르기');
{
  const a = { el: 'a', rect: box(0, 0) }, b = { el: 'b', rect: box(120, 0) }, c = { el: 'c', rect: box(240, 0) }, d = { el: 'd', rect: box(0, 60) }, e = { el: 'e', rect: box(120, 60, 220) }, f = { el: 'f', rect: box(0, 120, 340) };
  const all = [a, b, c, d, e, f], go = (r, dir) => { const p = C.pick(r.rect, all.filter(x => x !== r), dir); return p && p.el; };
  assert(go(a, 'right') === 'b' && go(b, 'right') === 'c' && go(b, 'left') === 'a', '좌우: 바로 옆 칸');
  assert(go(a, 'down') === 'd' && go(d, 'up') === 'a', '위아래: 같은 줄');
  assert(go(c, 'down') === 'e', '아래 칸이 넓어도 겹치는 칸으로');
  assert(go(e, 'up') === 'b' && go(c, 'right') === null && go(a, 'up') === null, '가장자리면 없음');
  assert(go(f, 'up') === 'e', '넓은 칸에서 올라가면 가운데 가까운 칸');
}

console.log('\n[3] 스틱 → 한 칸씩');
{
  const s = { dir: '', next: Infinity };
  assert(C.tickDir(s, 0.3, 0, 1, true) === '', '살짝 밀면 안 움직임');
  assert(C.tickDir(s, 0.8, 0.1, 1, true) === 'right', '세게 밀면 한 칸');
  assert(C.tickDir(s, 0.8, 0, 1.2, true) === '', '밀고 있어도 바로는 안 되풀이');
  assert(C.tickDir(s, 0.8, 0, 1.45, true) === 'right' && C.tickDir(s, 0.8, 0, 1.5, true) === '' && C.tickDir(s, 0.8, 0, 1.62, true) === 'right', '오래 밀면 되풀이');
  assert(C.tickDir(s, 0.45, 0, 1.63, true) === '' && s.dir === 'right', '놓는 중간값은 그대로');
  C.tickDir(s, 0, 0, 1.7, true);
  assert(C.tickDir(s, 0, -0.9, 1.8, true) === 'down' && C.tickDir(s, 0, 0, 1.9, true) === '' && C.tickDir(s, -0.9, 0.2, 2, true) === 'left', '위아래·왼쪽');
  const g = { dir: '', next: Infinity };
  C.tickDir(g, 0.9, 0, 3, false);
  assert(C.tickDir(g, 0.9, 0, 3.1, true) === '' && C.tickDir(g, 0.9, 0, 9, true) === '', '메뉴가 아닐 때 밀고 있던 스틱은 메뉴가 떠도 안 움직임 (운전하다 일시정지)');
  C.tickDir(g, 0, 0, 9.1, true);
  assert(C.tickDir(g, 0.9, 0, 9.2, true) === 'right', '놓았다 다시 밀면 움직임');
}

console.log('\n[4] 메뉴 고르기 (조이콘)');
const start = mkEl('#btnStart', box(300, 300)), other = mkEl('#btnOther', box(300, 200)), full = mkEl('#btnFull', box(300, 100)), slider = mkEl('#vol', box(300, 400), { range: true, min: '0', max: '100', step: '1', value: '50' });
const off = mkEl('#off', box(300, 500), { disabled: true }), ghost = mkEl('#gone', box(300, 600, 0, 0));
const menu = layerEl([full, other, start, slider, off, ghost]);
const pauseKids = [mkEl('#resume', box(100, 300)), mkEl('#quit', box(300, 300))], pause = layerEl(pauseKids);
const resultKids = [mkEl('#again', box(100, 300)), mkEl('#back', box(300, 300))], result = layerEl(resultKids);
const dlgClose = mkEl('#close', box(800, 10)), dlg = layerEl([dlgClose]);
const state = { menu: true, pause: false, result: false, wait: false }, seen = [], lost = [];
J.on('buttons', (pi, m) => seen.push(m));
C.attach({ skip: '#btnFull', tick: () => { state.ticks = (state.ticks || 0) + 1; }, lost: jc => lost.push(jc),
  layers: [{ el: dlg, on: () => !!dlg.open, dialog: true, auto: true }, { el: pause, on: () => state.pause, first: '#resume', back: '#resume', auto: true }, { el: result, on: () => state.result, first: '#again', back: '#back', auto: true, wait: () => state.wait }, { el: menu, on: () => state.menu, first: '#btnStart' }] });
const jc = newJc('R');
J.list.push(jc);
const tick = (n = 1) => { for (let i = 0; i < n; i++) { now += 0.04; ticks(); } };
const push = (stick, opt = {}) => { report(jc, Object.assign({ stick, acc: UP }, opt)); tick(); report(jc, { acc: UP }); tick(); };
const btn = m => { report(jc, { m, acc: UP }); report(jc, { acc: UP }); };
{
  btn(B.A);
  assert(seen.length === 1 && !C.current(), '고른 칸이 없으면 버튼은 게임으로 (아무 버튼이나 눌러도 시작)');
  seen.length = 0;
  tick();
  assert(!C.current(), '메뉴는 먼저 칸을 띄우지 않음');
  push([2048, 3400]);
  assert(C.current() === start && start.classList.contains('pad-focus'), '스틱을 밀면 처음 칸(시작 버튼)에 표시');
  push([2048, 3400]);
  assert(C.current() === other && !start.classList.contains('pad-focus'), '다시 밀면 위 칸으로');
  push([2048, 3400]);
  assert(C.current() === other && menu.scrolled < 0, '위쪽 칸이 건너뛸 칸(전체화면)뿐이면 화면만 굴림');
  btn(B.A);
  assert(other.clicks === 1 && !seen.length, '고른 칸이 있으면 버튼은 그 칸을 누름 (게임엔 안 감)');
  push([2048, 700]); push([2048, 700]);
  assert(C.current() === slider, '슬라이더 칸으로');
  const v0 = +slider.value;
  push([3400, 2048]);
  assert(+slider.value === v0 + 5 && slider.events.join() === 'input,change', '슬라이더: 오른쪽 = 값이 오름 · 게임에 알림');
  push([700, 2048]);
  assert(+slider.value === v0, '슬라이더: 왼쪽 = 값이 내림');
  btn(B.A);
  assert(!slider.clicks, '슬라이더는 눌리지 않음');
  push([2048, 700]);
  assert(C.current() === slider, '꺼진 칸·안 보이는 칸은 건너뜀');
  btn(B.B);
  assert(!C.current() && !seen.length, '뒤로: 고른 칸을 치움');
  btn(B.B);
  assert(seen.length === 1, '고른 칸도 뒤로 갈 곳도 없으면 게임으로');
  seen.length = 0;
}

console.log('\n[5] 일시정지 · 결과 · 창');
{
  state.menu = false; state.pause = true;
  tick();
  assert(C.current() === pauseKids[0], '조이콘이 있으면 일시정지 화면은 첫 칸이 바로 보임');
  push([3400, 2048]);
  assert(C.current() === pauseKids[1], '스틱으로 다음 칸');
  btn(B.B);
  assert(pauseKids[0].clicks === 1, '뒤로 = 계속하기 버튼');
  state.pause = false; state.result = true; state.wait = true;
  tick();
  btn(B.A); btn(B.B);
  assert(!resultKids[0].clicks && !resultKids[1].clicks && !seen.length, '결과가 뜬 직후엔 입력을 무시 (연타하던 아이가 바로 다시 출발하지 않게)');
  state.wait = false;
  btn(B.A);
  assert(resultKids[0].clicks === 1, '그 뒤엔 첫 칸(한 판 더)');
  btn(B.B);
  assert(resultKids[1].clicks === 1, '뒤로 = 설정으로');
  state.result = false; state.menu = true; dlg.open = true;
  tick();
  assert(C.current() === dlgClose, '창이 열리면 그 안의 칸으로');
  push([2048, 700]);
  assert(dlg.scrolled > 0, '더 갈 칸이 없으면 창 안을 굴림');
  btn(B.B);
  assert(dlg.closeCount === 1, '뒤로 = 창 닫기');
  tick();
  assert(!C.current(), '창을 닫으면 메뉴로 (표시는 지움)');
}

console.log('\n[6] 마우스 · 키보드로 돌아오면');
{
  push([2048, 3400]);
  const had = C.current();
  fire(winEvents, 'pointerdown', {});
  assert(had && !C.current(), '마우스를 누르면 표시를 치움');
  state.menu = false; state.pause = true;
  tick();
  assert(!C.current(), '마우스를 쓰는 중엔 일시정지에도 칸을 안 띄움');
  push([3400, 2048]);
  assert(!!C.current(), '스틱을 다시 밀면 표시');
  fire(docEvents, 'focusin', { target: {} });
  assert(!C.current(), '키보드로 다른 곳에 가면 표시를 치움');
  state.pause = false; state.menu = true;
  tick();
}

console.log('\n[7] 게임패드');
{
  const P = { index: 0, id: 'Xbox', connected: true, mapping: 'standard', axes: [0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
  const tap = i => { P.buttons[i].pressed = true; const r = C.pad(P); P.buttons[i].pressed = false; C.pad(P); return r; };
  assert(!tap(0), '고른 칸이 없으면 A는 게임으로');
  assert(tap(12) && C.current() === slider, '십자키: 칸이 보임 (이 화면에서 마지막에 고른 칸부터)');
  P.axes = [0, 1]; now += 0.05; C.pad(P); P.axes = [0, 0]; C.pad(P);
  assert(C.current() === slider, '왼쪽 스틱 아래: 더 갈 칸이 없으면 그대로');
  P.axes = [0, -1]; now += 0.05;
  assert(C.pad(P) && C.current() === start, '왼쪽 스틱 위: 다음 칸');
  P.axes = [0, 0]; C.pad(P);
  const n0 = start.clicks;
  assert(tap(0) && start.clicks === n0 + 1, 'A = 누르기');
  assert(tap(1) && !C.current(), 'B = 뒤로');
  state.menu = false;
  tick();
  assert(!tap(0), '경기 중(메뉴 없음)엔 아무것도 안 건드림');
  state.menu = true;
}

console.log('\n[8] 배터리 · 끊김 알림');
{
  const toasts = () => doc.getElementById('couchToasts') ? doc.getElementById('couchToasts').kids.map(x => x.textContent) : [];
  const j2 = newJc('L');
  report(j2, { acc: UP, bat: 8 });
  assert(j2.battery === 4 && !j2.charging && J.batteryText(j2) === '배터리 가득', '가득');
  report(j2, { acc: UP, bat: 6 });
  assert(j2.battery === 3 && J.batteryText(j2) === '배터리 넉넉', '넉넉');
  report(j2, { acc: UP, bat: 5 });
  assert(j2.charging && J.batteryText(j2) === '충전 중', '충전 중');
  assert(!toasts().length, '넉넉할 땐 알림 없음');
  report(j2, { acc: UP, bat: 2 });
  assert(toasts().some(t => t.includes('배터리가 거의 없어요')), '거의 없으면 알림');
  const n = toasts().length;
  report(j2, { acc: UP, bat: 2 }); report(j2, { acc: UP, bat: 0 });
  assert(toasts().length === n, '연결마다 한 번만');
  report(j2, { acc: UP, bat: 9 });
  assert(J.batteryText(j2) === '충전 중', '충전하면 다시 셈');
  const handlers = J.handlers;
  handlers.lost(jc);
  assert(lost[0] === jc && toasts().some(t => t.includes('연결이 끊겼어요')), '끊기면 게임에 알리고(일시정지) 화면에 알림');
  handlers.found(j2);
  assert(!toasts().some(t => t.includes('다시 연결')), '처음 연결은 조용히');
  handlers.found(jc);
  assert(toasts().some(t => t.includes('P1 조이콘 (R) 다시 연결됐어요')), '끊겼던 조이콘이 돌아오면 알림');
  J.single = true;
  handlers.lost(j2);
  assert(toasts().some(t => t.startsWith('조이콘 (L) 연결이')), '모두 P1인 게임(볼링)은 P 번호 없이');
  J.single = false;
  const n2 = toasts().length;
  handlers.lost(jc); handlers.lost(jc);
  assert(toasts().length === n2 + 1 || toasts().filter(t => t.includes('P1 조이콘 (R) 연결이')).length === 1, '같은 글은 겹쳐 안 띄움');
}

console.log(`\n${fail ? '❌' : '✅'} 통과 ${pass} · 실패 ${fail}`);
process.exitCode = fail ? 1 : 0;
