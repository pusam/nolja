// 조이콘 자세 추적 테스트: 가짜 조이콘(tools/joysim.js)으로 몸짓을 만들어 넣고, 화면 속 팔이 따라갈 값이 맞는지 확인
//  실행: node tools/test_motion.js
const fs = require('fs'), vm = require('vm'), path = require('path');
const SIM = require('./joysim.js');
const root = path.join(__dirname, '..');
let now = 1.0;
const sandbox = { console, Math, performance: { now: () => now * 1000 }, setTimeout: () => 0, setInterval: () => 0 };
sandbox.window = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(root, 'shared/joycon.js'), 'utf8'), sandbox);
const J = sandbox.Nolja.joycon;
console.log('문법 OK');

let pass = 0, fail = 0;
function assert(ok, msg) { if (ok) { pass++; console.log('  ✓ ' + msg); } else { fail++; console.log('  ✗ ' + msg); } }
const R = Math.PI / 180;
const newJc = kind => ({ player: 0, gyro: 0, armed: true, swinging: false, swingStart: 0, peak: 0, peakT: 0, cool: 0, prevBtn: 0, simple: 0, lastReport: 0, lastPow: 0, lastSwingT: -9, ok: true, device: {}, kind });
function feed(jc, motion, dur, opt = {}, each) {
  const reps = SIM.reports(motion, dur, Object.assign({ kind: jc.kind }, opt));
  reps.forEach((dv, i) => { now += 0.015; J.report(jc, { reportId: 0x30, data: dv }); if (each) each((i + 1) * 0.015, jc); });
}
// 팔 각도: 어깨→손(세상)을 앞 방향 기준으로 (0 아래 · + 앞 · - 뒤)
const armDeg = (jc, h = [1, 0]) => { const A = J.armWorld(jc, {}); return Math.atan2(A.x * h[0] + A.y * h[1], -A.z) / R; };
const smooth = u => { u = Math.max(0, Math.min(1, u)); return u * u * (3 - 2 * u); };

// 1) 가만히: 기울기가 바로 맞고, 자이로 영점이 어긋나 있어도 곧 잡힘
for (const kind of ['R', 'L']) {
  const jc = newJc(kind);
  const still = SIM.bowl(() => 30);
  feed(jc, still, 3, { bias: [35, -28, 50] });   // 약 2.5 · 2 · 3.5도/초 어긋남
  const A = J.armWorld(jc, {}), fromDown = Math.acos(-A.z) / R;   // 가로 방향은 게임이 정하니까 아래에서 벌어진 각도만
  assert(jc.q && Math.abs(fromDown - 30) < 2, `${kind} 조이콘: 30° 앞으로 든 팔을 가만히 들고 있으면 아래에서 ${fromDown.toFixed(1)}° (2° 안)`);
  const b = jc.bias;
  assert(Math.abs(b.x - 35 * J.GYRO) < 0.3 && Math.abs(b.y + 28 * J.GYRO) < 0.3 && Math.abs(b.z - 50 * J.GYRO) < 0.3, `${kind}: 자이로 영점 어긋남을 3초 안에 찾음 (${(b.x / J.GYRO).toFixed(0)}, ${(b.y / J.GYRO).toFixed(0)}, ${(b.z / J.GYRO).toFixed(0)} 눈금)`);
}

// 2) 볼링 스윙을 따라감: 앞(80°) → 뒤(-75°) → 앞(110°). 휘두르는 동안 팔 각도가 실제와 몇 도 안에서 같이 감
{
  const th = t => t < 0.6 ? 80 : t < 1.2 ? 80 - 155 * smooth((t - 0.6) / 0.6) : t < 1.65 ? -75 + 185 * smooth((t - 1.2) / 0.45) : 110;
  for (const kind of ['R', 'L']) for (const heading of [0, 70]) {
    const jc = newJc(kind);
    let worst = 0, h = null;
    feed(jc, SIM.bowl(th, { heading }), 2.2, {}, (t, j) => {
      if (t < 0.3) return;
      if (!h) { const A = J.armWorld(j, {}), n = Math.hypot(A.x, A.y); h = [A.x / n, A.y / n]; }   // 게임처럼: 앞으로 든 조이콘이 가리키는 가로 방향 = 앞
      worst = Math.max(worst, Math.abs(armDeg(j, h) - th(t)));
    });
    assert(worst < 6, `${kind} 조이콘 · 서 있는 방향 ${heading}°: 볼링 스윙 내내 팔 각도 오차 ${worst.toFixed(1)}° (6° 안)`);
  }
}

// 3) 손목 비틀기·휘두르는 방향이 세상 기준 회전 속도로 그대로 나옴
{
  const jc = newJc('R');
  const twist = t => t < 0.9 ? 0 : -70 * smooth((t - 0.9) / 0.25);   // 위에서 볼 때 시계 방향으로 70°
  let maxTw = 0;
  feed(jc, SIM.bowl(() => 0, { twist }), 1.4, {}, (t, j) => { const A = J.armWorld(j, {}), W = J.rateWorld(j, {}); maxTw = Math.min(maxTw, (W.x * A.x + W.y * A.y + W.z * A.z) * -1); });
  assert(maxTw < -3, `손목을 위에서 볼 때 시계 방향으로 비틀면 위쪽 축 기준 회전이 음수 (최대 ${(maxTw / R).toFixed(0)}도/초)`);
}

// 4) 망치 쥐듯(팔에 수직으로) 쥐어도 뒤로·앞으로 크게 휘두르면 쥔 방법을 알아내서 팔 각도가 맞음 (몸짓은 끊김 없이 이어서)
{
  const jc = newJc('R');
  const back = t => t < 0.5 ? 10 : 10 - 85 * smooth((t - 0.5) / 0.5);                       // 뒤로만 (1.0초에 -75°)
  const swing = t => t < 1.0 ? back(t) : t < 1.4 ? -75 + 175 * smooth((t - 1.0) / 0.4) : t < 2.0 ? 100 - 90 * smooth((t - 1.4) / 0.6) : 10 + 70 * smooth((t - 2.0) / 0.8);   // 앞으로 → 내림 → 가슴 앞으로 듦 (2.8초에 80°)
  const after = t => t < 0.6 ? 80 : t < 1.2 ? 80 - 155 * smooth((t - 0.6) / 0.6) : t < 1.65 ? -75 + 185 * smooth((t - 1.2) / 0.45) : 110;
  const all = t => t < 1.6 ? back(t) : t < 2.6 ? back(1.6) + (10 - back(1.6)) * smooth((t - 1.6) / 1.0) : t < 5.4 ? swing(t - 2.6) : after(t - 5.4);
  let before = null, after1 = null, worst = 0, h = null;
  feed(jc, SIM.bowl(all, { grip: 'hammer' }), 7.6, {}, (t, j) => {
    if (!before && t > 0.4) before = Math.acos(-J.armWorld(j, {}).z) / R;
    if (!after1 && t > 2.5) after1 = { ...j.arm };
    if (t < 5.7) return;
    if (!h) { const A = J.armWorld(j, {}), n = Math.hypot(A.x, A.y); h = [A.x / n, A.y / n]; }
    worst = Math.max(worst, Math.abs(armDeg(j, h) - after(t - 5.4)));
  });
  assert(Math.abs(before - 100) < 5, `망치 쥐기는 처음엔 팔이 앞을 가리키는 것으로 보임 (아래에서 ${before.toFixed(0)}°, 실제 팔은 10°)`);
  assert(Math.hypot(after1.x - 1, after1.y, after1.z) < 1e-6, '뒤로 한 번 돌린 것만으로는 바꾸지 않음 (두 번 같은 결과가 나와야 바꿈)');
  assert(Math.abs(jc.arm.y) > 0.95, `뒤로·앞으로 한 번 휘두르면 어깨→손 방향을 몸체 Y축으로 알아냄 (${jc.arm.x.toFixed(2)}, ${jc.arm.y.toFixed(2)}, ${jc.arm.z.toFixed(2)})`);
  assert(worst < 10, `그다음 스윙은 팔 각도 오차 ${worst.toFixed(1)}° (10° 안)`);
  const jc2 = newJc('L');
  const cyc = t => { const u = t % 3.6; return u < 2.8 ? swing(u) : 80 - 70 * smooth((u - 2.8) / 0.8); };   // 끊김 없이 되풀이
  feed(jc2, SIM.bowl(cyc), 10.8);
  assert(jc2.arm.x === 1, '보통으로(손끝 쪽을 가리키게) 쥐면 몇 번을 휘둘러도 그대로');
}

// 5) 스윙 감지(테니스·카트에서 쓰는 것)는 예전 느낌 그대로: 세게 휘두르면 swing 이벤트와 세기
{
  const jc = newJc('R');
  let got = null;
  J.on('swing', (pi, pow) => { got = pow; });
  feed(jc, SIM.bowl(t => (t < 0.3 ? 0 : -80 * Math.sin(Math.PI * Math.min(1, (t - 0.3) / 0.3)))), 1.0);
  assert(got !== null && got > 0.2, `빠르게 휘두르면 'swing' 이벤트 (세기 ${got === null ? '-' : got.toFixed(2)})`);
}

console.log(`\n${pass}개 통과, ${fail}개 실패`);
if (fail) process.exit(1);
