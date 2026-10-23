/* ============================================================
 * 놀자 공용 조이콘 입력 (WebHID) — PC 크롬·엣지 전용
 *
 *  - connect()        브라우저 장치 선택 창을 띄워 조이콘 연결 (버튼 클릭 안에서 호출)
 *  - start()          예전에 허락한 조이콘 자동 연결 + 끊김 감시 (페이지마다 한 번)
 *  - on(이름, 함수)   이벤트 받기
 *        'swing'   (player, pow 0~1, t초) — 자이로로 감지한 휘두르기. t = 가장 세게 휘두른 순간
 *        'buttons' (player, 새로 눌린 버튼 비트, jc)
 *        'change'  () — 연결·배정이 바뀜
 *  - assign()         조이콘을 P1·P2에 배정 (single=true면 모두 P1, swapped=true면 반대로)
 *  - rumble(player, 세기, ms)  진동
 *  - tilt(player)     가속도 {x,y,z} (단위 g) — 기울이기 조작(레이싱 등)에 사용
 *
 * 입력 리포트 0x30: [0]타이머 [1]배터리 [2..4]버튼 [5..10]스틱 [11]진동
 *                  [12..47] IMU 3샘플 (가속도 xyz, 자이로 xyz, int16 LE)
 * ============================================================ */
(function () {
  'use strict';
  const N = window.Nolja = window.Nolja || {};
  const NINTENDO = 0x057e;
  const now = () => performance.now() / 1000;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // 버튼 비트: Y · X · B · A (오른쪽 조이콘) / ↓ ↑ → ← (왼쪽 조이콘) / − +
  const BTN = { Y: 0x01, X: 0x02, B: 0x04, A: 0x08, DOWN: 0x10, UP: 0x20, RIGHT: 0x40, LEFT: 0x80, MINUS: 0x100, PLUS: 0x200 };

  const J = N.joycon = {
    supported: typeof navigator !== 'undefined' && !!navigator.hid,
    list: [],                 // 연결된 조이콘들
    swapped: N.store ? !!N.store.get('swapped', false) : false,
    single: false,            // true면 모두 P1 (1인 모드)
    sensitivity: 1,           // 스윙 감도 (게임이 설정값으로 갱신)
    BTN,
    isPrev: m => !!(m & (BTN.Y | BTN.LEFT)),   // 메뉴에서 이전
    isNext: m => !!(m & (BTN.A | BTN.RIGHT)),  // 메뉴에서 다음
    handlers: { swing: null, buttons: null, change: null },
    pkt: 0, started: false,
  };
  J.on = (name, fn) => { J.handlers[name] = fn; };
  const emit = (name, ...args) => { const f = J.handlers[name]; if (f) { try { f(...args); } catch (e) { console.error(e); } } };

  J.nameOf = d => d.productId === 0x2006 ? '조이콘 (L)' : d.productId === 0x2007 ? '조이콘 (R)' : d.productId === 0x2009 ? '프로콘' : (d.productName || '닌텐도 컨트롤러');
  J.labelOf = pi => { const j = J.list.find(x => x.player === pi); return j ? j.name : ''; };

  // 서브커맨드 보내기 (출력 리포트 0x01: [0]패킷번호 [1..8]진동 [9]명령 [10..]인자)
  async function sub(jc, id, args) {
    const data = new Uint8Array(10 + args.length);
    data[0] = (J.pkt++) & 0x0f;
    data.set([0x00, 0x01, 0x40, 0x40, 0x00, 0x01, 0x40, 0x40], 1);   // 진동 없음
    data[9] = id; data.set(args, 10);
    try { await jc.device.sendReport(0x01, data); } catch (e) { /* 연결 직후·끊김 등은 무시 */ }
  }
  async function init(jc) {
    await sub(jc, 0x40, [0x01]); await sleep(50);   // 자이로·가속도 켜기
    await sub(jc, 0x03, [0x30]); await sleep(50);   // 풀 리포트 모드 (60Hz)
    await sub(jc, 0x48, [0x01]); await sleep(50);   // 진동 켜기
    await lights(jc);
  }
  const lights = jc => sub(jc, 0x30, [jc.player === 1 ? 0x03 : 0x01]);   // 플레이어 LED

  async function add(device) {
    if (!device || device.vendorId !== NINTENDO || J.list.some(j => j.device === device)) return;
    const jc = { device, name: J.nameOf(device), player: 0, gyro: 0, armed: true, swinging: false, swingStart: 0,
      peak: 0, peakT: 0, cool: 0, prevBtn: 0, lastPow: 0, lastSwingT: -9, simple: 0, lastReport: 0, ok: false, err: '',
      accel: { x: 0, y: 0, z: 0 }, gyroDps: { x: 0, y: 0, z: 0 } };
    J.list.push(jc);
    J.assign();
    try { if (!device.opened) await device.open(); }
    catch (e) { jc.err = '열기 실패 — 블루투스 다시 연결해 보세요'; emit('change'); return; }
    device.addEventListener('inputreport', ev => J.report(jc, ev));
    await init(jc);
    jc.ok = true; jc.lastReport = now(); emit('change');
    J.rumbleOne(jc, 0.5, 120);
  }
  function remove(device) {
    const i = J.list.findIndex(j => j.device === device);
    if (i >= 0) { J.list.splice(i, 1); J.assign(); }
  }

  J.assign = function () {
    J.list.forEach((jc, idx) => {
      let pi = idx % 2;
      if (J.swapped) pi = 1 - pi;
      if (J.single) pi = 0;
      if (jc.player !== pi) { jc.player = pi; if (jc.ok) lights(jc); }
    });
    emit('change');
  };

  // 장치 선택 창 (사용자 클릭 안에서 호출해야 함). 결과: { ok, count, error }
  J.connect = async function () {
    if (!J.supported) return { ok: false, count: 0, error: '이 브라우저는 조이콘 직접 연결을 지원하지 않아요. PC의 크롬이나 엣지로 열어주세요. (키보드·게임패드는 사용 가능)' };
    try {
      const devs = await navigator.hid.requestDevice({ filters: [{ vendorId: NINTENDO }] });
      for (const d of devs) await add(d);
      return { ok: true, count: devs.length, error: '' };
    } catch (e) {
      const fileHint = typeof location !== 'undefined' && location.protocol === 'file:';
      return { ok: false, count: 0, error: fileHint ? '파일을 직접 열면 크롬이 조이콘 연결을 막아요. 인터넷 주소나 start-game.bat으로 열어주세요.' : '연결 실패: ' + (e && e.message ? e.message : e) };
    }
  };

  // 예전에 허락한 조이콘 자동 연결 + 2초 넘게 소식 없으면 다시 설정
  J.start = function () {
    if (!J.supported || J.started) return;
    J.started = true;
    navigator.hid.addEventListener('connect', e => add(e.device));
    navigator.hid.addEventListener('disconnect', e => remove(e.device));
    navigator.hid.getDevices().then(ds => ds.forEach(add)).catch(() => {});
    setInterval(() => { for (const jc of J.list) if (jc.ok && jc.device.opened && now() - jc.lastReport > 2) init(jc); }, 2000);
  };

  // 입력 리포트 처리 (테스트에서도 직접 부름)
  J.report = function (jc, ev) {
    const id = ev.reportId, d = ev.data;
    if (id === 0x3f) { if ((jc.simple++ % 30) === 0) init(jc); return; }   // 단순 모드면 다시 설정
    if (id !== 0x30 || d.byteLength < 48) return;
    jc.lastReport = now();
    const b2 = d.getUint8(2), b3 = d.getUint8(3), b4 = d.getUint8(4);
    const btn = (b2 & 0x0f) | ((b4 & 0x0f) << 4) | ((b3 & 0x03) << 8);   // 앞면 버튼·방향키·+/−
    const pressed = btn & ~jc.prevBtn;
    jc.prevBtn = btn;
    if (pressed) emit('buttons', jc.player, pressed, jc);
    const t = now();
    for (let k = 0; k < 3; k++) {
      const o = 12 + k * 12;
      const gx = d.getInt16(o + 6, true) * 0.061, gy = d.getInt16(o + 8, true) * 0.061, gz = d.getInt16(o + 10, true) * 0.061;   // 도/초
      if (k === 2) {
        jc.accel = { x: d.getInt16(o, true) * 0.000244, y: d.getInt16(o + 2, true) * 0.000244, z: d.getInt16(o + 4, true) * 0.000244 };   // g
        jc.gyroDps = { x: gx, y: gy, z: gz };
      }
      J.sample(jc, Math.hypot(gx, gy, gz), t - (2 - k) * 0.005);
    }
  };

  // 자이로 크기로 스윙 감지: 임계값을 넘으면 시작, 90ms 동안 최고값 = 세기, 최고점 시각 = 타이밍
  J.sample = function (jc, mag, t) {
    jc.gyro = Math.max(mag, jc.gyro * 0.92);
    const sens = J.sensitivity, on = 420 / sens, off = 170 / sens;
    if (jc.swinging) {
      if (mag > jc.peak) { jc.peak = mag; jc.peakT = t; }
      if (t - jc.swingStart >= 0.09) {
        jc.swinging = false; jc.cool = t + 0.32;
        const pow = clamp((jc.peak * sens - 420) / 1080, 0, 1);
        jc.lastPow = pow; jc.lastSwingT = now();
        emit('swing', jc.player, pow, jc.peakT, jc);
      }
    } else {
      if (mag < off) jc.armed = true;
      if (jc.armed && mag > on && t > jc.cool) { jc.swinging = true; jc.armed = false; jc.swingStart = t; jc.peak = mag; jc.peakT = t; }
    }
  };

  J.tilt = pi => { const j = J.list.find(x => x.player === pi && x.ok); return j ? j.accel : null; };

  // 진동 데이터 인코딩 (JoyconLib 방식)
  J.rumbleBytes = function (lf, hf, amp) {
    if (amp <= 0) return [0x00, 0x01, 0x40, 0x40];
    lf = clamp(lf, 40.875885, 626.286133); hf = clamp(hf, 81.75177, 1252.572266); amp = clamp(amp, 0, 1);
    const hfE = (Math.round(32 * Math.log2(hf * 0.1)) - 0x60) * 4;
    const lfE = Math.round(32 * Math.log2(lf * 0.1)) - 0x40;
    let hfAmp;
    if (amp < 0.117) hfAmp = ((Math.log2(amp * 1000) * 32) - 0x60) / (5 - amp * amp) - 1;
    else if (amp < 0.23) hfAmp = ((Math.log2(amp * 1000) * 32) - 0x60) - 0x5c;
    else hfAmp = (((Math.log2(amp * 1000) * 32) - 0x60) * 2) - 0xf6;
    hfAmp = Math.max(0, Math.floor(hfAmp)) & 0xff;
    let lfAmp = Math.floor(hfAmp * 0.5);
    const parity = lfAmp % 2;
    if (parity > 0) lfAmp--;
    lfAmp = (lfAmp >> 1) + 0x40;
    if (parity > 0) lfAmp |= 0x8000;
    return [hfE & 0xff, (((hfE >> 8) & 0xff) + hfAmp) & 0xff, (lfE + ((lfAmp >> 8) & 0xff)) & 0xff, lfAmp & 0xff];
  };
  J.rumbleOne = async function (jc, amp, ms) {
    if (!jc.device || !jc.device.opened) return;
    const send = async b => {
      const data = new Uint8Array(9); data[0] = (J.pkt++) & 0x0f; data.set(b, 1); data.set(b, 5);
      try { await jc.device.sendReport(0x10, data); } catch (e) { /* 무시 */ }
    };
    await send(J.rumbleBytes(160, 320, amp));
    setTimeout(() => send([0x00, 0x01, 0x40, 0x40]), ms);
  };
  J.rumble = (pi, amp, ms) => { for (const jc of J.list) if (jc.player === pi) J.rumbleOne(jc, amp, ms); };
})();
