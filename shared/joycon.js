/* ============================================================
 * 놀자 공용 조이콘 입력 (WebHID) — PC 크롬·엣지 전용
 *
 *  - connect()        브라우저 장치 선택 창을 띄워 조이콘 연결 (버튼 클릭 안에서 호출)
 *  - start()          예전에 허락한 조이콘 자동 연결 + 끊김 감시 (페이지마다 한 번)
 *  - on(이름, 함수)   이벤트 받기
 *        'swingstart' (player, t초, jc) — 휘두르기 시작한 순간 바로. jc.motion = { active, angle(도) } 은 팔로스루가 끝날 때까지 계속 늘어남
 *        'swing'   (player, pow 0~1, t초, jc) — 자이로로 감지한 휘두르기. t = 가장 세게 휘두른 순간
 *                  jc.lastSpin: 휘두른 방향으로 정한 스핀 (+1 올려 치기=탑스핀 · 0.15 수평=플랫 · -1 깎아 치기=슬라이스, 모르면 null)
 *                  jc.lastPath: 라켓 머리가 지나간 길의 기울기 sin값 (위 +, 아래 -)
 *                  jc.lastSide: 'fh' 포핸드(위에서 볼 때 반시계) · 'bh' 백핸드(시계) · null 머리 위로 내려치기 등 (오른손 기준)
 *  - swingDir(jc)     지금까지 모은 스윙으로 { spin, path, side } (휘두르는 도중에도 부를 수 있음)
 *        'buttons' (player, 새로 눌린 버튼 비트, jc)
 *        'change'  () — 연결·배정이 바뀜
 *  - jc.hold          지금 누르고 있는 버튼 비트 (앞면·방향키·+/− 에 SL·SR·L/R·ZL/ZR·스틱 누르기까지, 레이싱처럼 계속 누르는 조작용)
 *  - jc.kind          'L' · 'R' · 'pro' (조이콘 종류에 따라 가로로 쥐었을 때 버튼 위치가 다름)
 *  - jc.stick         스틱 원래 값 { x, y } (0~4095, 가운데 약 2048, 위·오른쪽이 큼)
 *  - assign()         조이콘을 연결 순서대로 P1·P2에 다시 배정 (single=true면 모두 P1, swapped=true면 반대로)
 *                     새로 붙은 조이콘은 빈자리로 가고, 하나가 끊겨도 나머지 자리는 그대로
 *  - rumble(player, 세기, ms)  진동
 *  - tilt(player)     가속도 {x,y,z} (단위 g) — 기울이기 조작(레이싱 등)에 사용
 *  - 자세 (닌텐도 위처럼 화면 속 팔·라켓이 조이콘을 그대로 따라가게)
 *      jc.q           [w,x,y,z] 조이콘 몸체 → 세상 회전 (세상 z = 위). 가속도를 처음 받기 전엔 null
 *      jc.w           지금 회전 속도 (몸체 기준 rad/s, 자이로 영점을 뺀 값)
 *      jc.arm         어깨 → 손 방향 (몸체 기준). 기본은 X축, 크게 휘두를 때 원심력으로 쥔 방법을 알아냄
 *      armWorld(jc)   어깨 → 손 방향 (세상 기준) · rateWorld(jc) 회전 속도 (세상 기준) · toWorld(jc, v)
 *
 * 몸체 축 (SDL과 같은 결론): X = 긴 축, 어깨 버튼·트리거 쪽이 + (왼쪽·오른쪽 조이콘 모두)
 *                           Z = 앞면 쪽(L) · 뒷면 쪽(R), Y = Z × X. 가속도·자이로는 같은 축 (오른손 법칙)
 *
 * 입력 리포트 0x30: [0]타이머 [1]배터리 [2..4]버튼 [5..10]스틱 [11]진동
 *                  [12..47] IMU 3샘플 (가속도 xyz, 자이로 xyz, int16 LE)
 * ============================================================ */
(function () {
  'use strict';
  const N = window.Nolja = window.Nolja || {};
  const NINTENDO = 0x057e;
  const GYRO = 1 / 14.2842, ACC = 1 / 4096;   // 한 눈금 = 0.07도/초 · 0.000244g (SDL 기본값과 같음)
  const now = () => performance.now() / 1000;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // 버튼 비트: Y · X · B · A (오른쪽 조이콘) / ↓ ↑ → ← (왼쪽 조이콘) / − +
  // 아래 SR부터는 jc.hold에만 있음 (레일 쪽 SL·SR, 어깨 L/R, 뒤 ZL/ZR, 스틱 누르기)
  const BTN = { Y: 0x01, X: 0x02, B: 0x04, A: 0x08, DOWN: 0x10, UP: 0x20, RIGHT: 0x40, LEFT: 0x80, MINUS: 0x100, PLUS: 0x200,
    SR: 0x400, SL: 0x800, SHOULDER: 0x1000, TRIGGER: 0x2000, STICK: 0x4000 };

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
    const jc = { device, name: J.nameOf(device), player: 0, gyro: 0, armed: true, swinging: false, swingStart: 0, hold: 0,
      kind: device.productId === 0x2006 ? 'L' : device.productId === 0x2007 ? 'R' : device.productId === 0x2009 ? 'pro' : '',
      peak: 0, peakT: 0, cool: 0, prevBtn: 0, lastPow: 0, lastSwingT: -9, simple: 0, lastReport: 0, ok: false, err: '',
      lastSpin: null, lastPath: null, lastSide: null, up: null, restX: 0, sw: null, motion: null,
      accel: { x: 0, y: 0, z: 0 }, gyroDps: { x: 0, y: 0, z: 0 } };
    J.list.push(jc);
    jc.player = freeSlot(jc); emit('change');
    try { if (!device.opened) await device.open(); }
    catch (e) {   // 못 열면 목록에서 빼서 자리를 비우고, 다시 연결할 수 있게 함
      const i = J.list.indexOf(jc); if (i >= 0) J.list.splice(i, 1);
      emit('change');
      return '열기 실패 — 블루투스를 다시 연결하거나, 다른 프로그램(Steam 등)이 조이콘을 쓰고 있지 않은지 확인해 보세요';
    }
    device.addEventListener('inputreport', ev => J.report(jc, ev));
    await init(jc);
    jc.ok = true; jc.lastReport = now(); emit('change');
    J.rumbleOne(jc, 0.5, 120);
    return '';
  }
  // 끊긴 조이콘만 빼고 남은 조이콘 자리는 그대로 (경기 중에 P1·P2가 뒤바뀌지 않게)
  function remove(device) {
    const i = J.list.findIndex(j => j.device === device);
    if (i >= 0) { J.list.splice(i, 1); emit('change'); }
  }
  // 새로 붙은 조이콘은 빈자리로 (P1부터, 바꿈이면 P2부터). 둘 다 차 있으면 번갈아
  function freeSlot(jc) {
    if (J.single) return 0;
    const used = J.list.filter(j => j !== jc).map(j => j.player), order = J.swapped ? [1, 0] : [0, 1];
    const free = order.find(pi => !used.includes(pi));
    return free !== undefined ? free : order[(J.list.length - 1) % 2];
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
      let error = '';
      for (const d of devs) error = (await add(d)) || error;
      return { ok: !error, count: devs.length, error };
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
    const side = b2 | b4;   // 오른쪽 바이트·왼쪽 바이트의 4~7번 비트 = SR · SL · R(L) · ZR(ZL)
    jc.hold = btn | (side & 0x10 ? BTN.SR : 0) | (side & 0x20 ? BTN.SL : 0) | (side & 0x40 ? BTN.SHOULDER : 0) | (side & 0x80 ? BTN.TRIGGER : 0) | (b3 & 0x0c ? BTN.STICK : 0);
    const so = jc.kind === 'R' ? 8 : 5;   // 스틱 12비트 두 개: 왼쪽 스틱(조이콘 L·프로콘) 5~7바이트, 오른쪽 스틱(조이콘 R) 8~10바이트. 가운데 약 2048
    jc.stick = { x: d.getUint8(so) | ((d.getUint8(so + 1) & 0x0f) << 8), y: (d.getUint8(so + 1) >> 4) | (d.getUint8(so + 2) << 4) };
    if (pressed) emit('buttons', jc.player, pressed, jc);
    const t = now();
    for (let k = 0; k < 3; k++) {
      const o = 12 + k * 12;
      const s = { ax: d.getInt16(o, true) * ACC, ay: d.getInt16(o + 2, true) * ACC, az: d.getInt16(o + 4, true) * ACC,   // g
        gx: d.getInt16(o + 6, true) * GYRO, gy: d.getInt16(o + 8, true) * GYRO, gz: d.getInt16(o + 10, true) * GYRO };    // 도/초
      if (k === 2) { jc.accel = { x: s.ax, y: s.ay, z: s.az }; jc.gyroDps = { x: s.gx, y: s.gy, z: s.gz }; }
      J.sample(jc, Math.hypot(s.gx, s.gy, s.gz), t - (2 - k) * 0.005, s);
    }
  };

  // 자이로 크기로 스윙 감지: 임계값을 넘으면 시작, 90ms 동안 최고값 = 세기, 최고점 시각 = 타이밍
  // imu(샘플 하나: 가속도 g · 자이로 도/초)가 있으면 휘두른 방향도 구해서 jc.lastSpin·lastPath에 두고, 자세(jc.q)도 갱신
  // 문턱값은 예전 눈금(0.061도/초)에서 맞춘 420·170·1080을 실제 도/초로 바꾼 값 (느낌은 그대로)
  J.sample = function (jc, mag, t, imu) {
    if (imu) { track(jc, imu); orient(jc, imu); }
    jc.gyro = Math.max(mag, jc.gyro * 0.92);
    const sens = J.sensitivity, on = 482 / sens, off = 195 / sens;
    const m = jc.motion;
    if (m && m.active) {   // 휘두르는 동작 전체(판정 90ms를 넘어 팔로스루까지) 동안 돈 각도
      m.angle += mag * DT_IMU;
      if (mag < off) m.active = false;
    }
    if (jc.swinging) {
      if (imu) gather(jc, imu, mag);
      if (mag > jc.peak) { jc.peak = mag; jc.peakT = t; }
      if (t - jc.swingStart >= 0.09) {
        jc.swinging = false; jc.cool = t + 0.32;
        const pow = clamp((jc.peak * sens - 482) / 1239, 0, 1);
        const dir = swingDir(jc);
        jc.lastPow = pow; jc.lastSpin = dir.spin; jc.lastPath = dir.path; jc.lastSide = dir.side; jc.lastSwingT = now();
        emit('swing', jc.player, pow, jc.peakT, jc);
      }
    } else {
      if (mag < off) jc.armed = true;
      if (jc.armed && mag > on && t > jc.cool) {
        jc.swinging = true; jc.armed = false; jc.swingStart = t; jc.peak = mag; jc.peakT = t;
        jc.sw = { up: 0, abs: 0, ax: 0, w: 0, vert: 0, mag: 0 };
        jc.motion = { active: true, angle: 0 };
        if (imu) gather(jc, imu, mag);
        emit('swingstart', jc.player, t, jc);
      }
    }
  };

  // ---------- 휘두른 방향 → 탑스핀 · 플랫 · 슬라이스 ----------
  //  조이콘 축: X = 긴 축(어깨 버튼 쪽이 +), Z = 앞면에 수직. 가속도·자이로는 같은 축 (오른손 법칙)
  //  1) up: 조이콘 기준으로 본 '위' 방향. 가만히 있을 땐 가속도(중력)로 맞추고, 움직이는 동안엔 자이로로 같이 돌림
  //  2) 라켓 머리 = 긴 축의 두 끝 중 스윙할 때 바깥으로 쏠리는(원심력) 쪽 → 쥐는 방향이 거꾸로여도 알아냄
  //  3) 라켓 머리가 움직이는 방향 = ω × 머리 방향. 그 위쪽 성분 = 올려 치기(+) / 깎아 치기(-)
  const DEG = Math.PI / 180, DT_IMU = 0.005;
  function track(jc, s) {
    const an = Math.hypot(s.ax, s.ay, s.az);
    let u = jc.up;
    if (!u) {
      if (an < 0.3) return;
      u = jc.up = { x: s.ax / an, y: s.ay / an, z: s.az / an }; jc.restX = u.x;
    }
    // 몸체가 ω로 돌면 고정된 '위' 벡터는 몸체 기준으로 반대로 돈다 (로드리게스 회전)
    const wx = s.gx * DEG, wy = s.gy * DEG, wz = s.gz * DEG, wn = Math.hypot(wx, wy, wz);
    if (wn > 1e-6) {
      const kx = wx / wn, ky = wy / wn, kz = wz / wn, th = -wn * DT_IMU, c = Math.cos(th), sn = Math.sin(th);
      const kd = kx * u.x + ky * u.y + kz * u.z;
      const cx = ky * u.z - kz * u.y, cy = kz * u.x - kx * u.z, cz = kx * u.y - ky * u.x;
      u.x = u.x * c + cx * sn + kx * kd * (1 - c);
      u.y = u.y * c + cy * sn + ky * kd * (1 - c);
      u.z = u.z * c + cz * sn + kz * kd * (1 - c);
    }
    if (wn < 1.2 && Math.abs(an - 1) < 0.15) {   // 거의 가만히 있음 → 중력 쪽으로 천천히 보정
      u.x += (s.ax / an - u.x) * 0.04; u.y += (s.ay / an - u.y) * 0.04; u.z += (s.az / an - u.z) * 0.04;
      jc.restX += (u.x - jc.restX) * 0.02;
    }
    const un = Math.hypot(u.x, u.y, u.z) || 1;
    u.x /= un; u.y /= un; u.z /= un;
  }
  function gather(jc, s, mag) {   // 스윙 중 샘플을 회전 속도의 세제곱으로 가중해서 모음 (가장 빠른 순간 = 타점 근처가 중심)
    const u = jc.up, sw = jc.sw;
    if (!u || !sw) return;
    const k = Math.pow(mag / 1000, 3);
    sw.up += k * (s.gz * u.y - s.gy * u.z);   // (ω × X축) · up — +X 끝이 위로 움직이는 빠르기
    sw.abs += k * Math.hypot(s.gy, s.gz);     // |ω × X축|
    sw.ax += k * (s.ax - u.x);                // 중력을 뺀 X축 가속도: 원심력 때문에 라켓 머리 쪽이 음수
    sw.vert += k * (s.gx * u.x + s.gy * u.y + s.gz * u.z);   // ω · up — 위에서 볼 때 반시계(+)로 돌면 포핸드
    sw.mag += k * mag;
    sw.w += k;
  }
  function swingDir(jc) {
    const sw = jc.sw;
    if (!sw || !jc.up || sw.abs < 1e-6) return { spin: null, path: null, side: null };
    const turn = sw.mag > 0 ? sw.vert / sw.mag : 0;   // 회전축이 얼마나 세로인지 (cos). 머리 위 스윙은 0 가까이
    const side = turn > 0.3 ? 'fh' : turn < -0.3 ? 'bh' : null;
    const ax = sw.ax / sw.w;
    const head = ax < -0.8 ? 1 : ax > 0.8 ? -1 : (jc.restX < -0.3 ? -1 : 1);   // 원심력이 약하면 쉴 때 위를 향한 끝을 머리로
    const path = clamp(head * sw.up / sw.abs, -1, 1);   // 라켓 머리가 지나간 길의 기울기 (sin)
    // 휘두르기 시작 무렵(타점 전)도 섞여서 실제 각도보다 작게 나옴 → 6°만 넘어도 기울여 친 것으로 봄
    let spin = 0.15;                                                                     // ±6° 안: 플랫
    if (path > 0.105) spin = 0.35 + 0.65 * clamp((path - 0.105) / 0.333, 0, 1);           // 올려 치기: 26°면 최대 탑스핀
    else if (path < -0.105) spin = -(0.35 + 0.65 * clamp((-path - 0.105) / 0.302, 0, 1)); // 깎아 치기: 24°면 최대 슬라이스
    return { spin, path, side };
  }
  J.swingDir = swingDir;

  // ---------- 자세 추적: 자이로를 적분하고, 손이 거의 멈췄을 땐 가속도(중력)로 기울기를 바로잡음 ----------
  //  가로 방향(어느 쪽이 앞인지)은 중력으로 알 수 없어서 게임이 '가만히 있을 때 가리키는 쪽'을 앞으로 삼음
  function orient(jc, s) {
    const an = Math.hypot(s.ax, s.ay, s.az);
    let q = jc.q;
    if (!q) {   // 처음: 지금 '위'(가속도) 방향이 세상 z가 되게만 맞춤
      if (an < 0.6 || an > 1.4) return;
      const ux = s.ax / an, uy = s.ay / an, uz = s.az / an;
      q = jc.q = uz < -0.999 ? [0, 1, 0, 0] : [1 + uz, uy, -ux, 0];
      norm4(q);
      jc.w = { x: 0, y: 0, z: 0 }; jc.bias = jc.bias || { x: 0, y: 0, z: 0 }; jc.gm = { x: s.gx, y: s.gy, z: s.gz }; jc.calm = 0;
      if (!jc.arm) jc.arm = { x: 1, y: 0, z: 0 };
      return;
    }
    // 자이로 영점: 거의 가만히(짧은 평균에서 2.5도/초 안 · 1g) 0.25초 넘게 있으면 평균 쪽으로 천천히
    const b = jc.bias, gm = jc.gm;
    gm.x += (s.gx - gm.x) * 0.08; gm.y += (s.gy - gm.y) * 0.08; gm.z += (s.gz - gm.z) * 0.08;
    const quiet = Math.hypot(s.gx - gm.x, s.gy - gm.y, s.gz - gm.z) < 2.5 && Math.abs(an - 1) < 0.06 && Math.hypot(gm.x, gm.y, gm.z) < 10;
    jc.calm = quiet ? jc.calm + 1 : 0;
    if (jc.calm > 50) { b.x += (gm.x - b.x) * 0.01; b.y += (gm.y - b.y) * 0.01; b.z += (gm.z - b.z) * 0.01; }
    const w = jc.w;
    w.x = (s.gx - b.x) * DEG; w.y = (s.gy - b.y) * DEG; w.z = (s.gz - b.z) * DEG;
    const wn = Math.hypot(w.x, w.y, w.z);
    const [qw, qx, qy, qz] = q;
    const vx = 2 * (qx * qz - qw * qy), vy = 2 * (qy * qz + qw * qx), vz = qw * qw - qx * qx - qy * qy + qz * qz;   // 세상 위 (몸체 기준)
    let cx = w.x, cy = w.y, cz = w.z;
    // 중력 보정 (마호니): 잰 위와 추정한 위가 어긋난 만큼 돌려 맞춤. 세게 휘두르는 중엔 원심력 때문에 거의 안 믿음
    const trust = an > 0.3 ? clamp(1 - Math.abs(an - 1) / 0.25, 0, 1) * (wn < 1.5 ? 1 : wn < 5 ? 0.25 : 0) : 0;
    if (trust > 0) {
      const ux = s.ax / an, uy = s.ay / an, uz = s.az / an, k = 1.2 * trust;
      cx += k * (uy * vz - uz * vy); cy += k * (uz * vx - ux * vz); cz += k * (ux * vy - uy * vx);
    }
    const cn = Math.hypot(cx, cy, cz);
    if (cn > 1e-9) {   // q ← q ⊗ (몸체 기준으로 cn·dt만큼 회전)
      const h = cn * DT_IMU / 2, sn = Math.sin(h) / cn, dw = Math.cos(h), dx = cx * sn, dy = cy * sn, dz = cz * sn;
      q[0] = qw * dw - qx * dx - qy * dy - qz * dz;
      q[1] = qw * dx + qx * dw + qy * dz - qz * dy;
      q[2] = qw * dy - qx * dz + qy * dw + qz * dx;
      q[3] = qw * dz + qx * dy - qy * dx + qz * dw;
      norm4(q);
    }
    learnGrip(jc, s, wn, vx, vy, vz);
  }
  // 쥔 방법: 크게 휘두르는 동안 (가속도 − 중력) ≈ −ω²·(어깨→손). 4rad/s 넘게 돌 때 모아서 어깨→손 방향을 구함
  //  지금 방향과 40° 넘게 다른 결과가 두 번 잇달아 비슷하게 나오면 바꿈 (조이콘을 옆으로·거꾸로 쥐어도 팔이 맞게)
  function learnGrip(jc, s, wn, vx, vy, vz) {
    const g = jc.grip || (jc.grip = { x: 0, y: 0, z: 0, w: 0, n: 0, cand: null });
    if (wn > 4) { g.x -= (s.ax - vx) * 9.8; g.y -= (s.ay - vy) * 9.8; g.z -= (s.az - vz) * 9.8; g.w += wn * wn; g.n++; return; }
    if (wn > 2 || !g.n) return;
    const enough = g.n >= 24, r = enough ? Math.hypot(g.x, g.y, g.z) / g.w : 0;   // 어깨→손 거리 (m)
    if (enough && r > 0.22) {
      const c = { x: g.x / g.w / r, y: g.y / g.w / r, z: g.z / g.w / r }, a = jc.arm;
      if (c.x * a.x + c.y * a.y + c.z * a.z > 0.77) g.cand = null;   // 지금 아는 방향과 40° 안: 그대로
      else if (g.cand && c.x * g.cand.x + c.y * g.cand.y + c.z * g.cand.z > 0.87) {
        const m = { x: c.x + g.cand.x, y: c.y + g.cand.y, z: c.z + g.cand.z }, mn = Math.hypot(m.x, m.y, m.z) || 1;
        jc.arm = { x: m.x / mn, y: m.y / mn, z: m.z / mn }; g.cand = null;
      } else g.cand = c;
    }
    g.x = g.y = g.z = g.w = 0; g.n = 0;
  }
  function norm4(q) { const n = Math.hypot(q[0], q[1], q[2], q[3]) || 1; q[0] /= n; q[1] /= n; q[2] /= n; q[3] /= n; }
  // 몸체 벡터 → 세상 (z = 위)
  J.toWorld = function (jc, v, out = {}) {
    const [w, x, y, z] = jc.q;
    const tx = 2 * (y * v.z - z * v.y), ty = 2 * (z * v.x - x * v.z), tz = 2 * (x * v.y - y * v.x);
    out.x = v.x + w * tx + y * tz - z * ty; out.y = v.y + w * ty + z * tx - x * tz; out.z = v.z + w * tz + x * ty - y * tx;
    return out;
  };
  J.armWorld = (jc, out) => J.toWorld(jc, jc.arm || { x: 1, y: 0, z: 0 }, out);
  J.rateWorld = (jc, out) => J.toWorld(jc, jc.w, out);
  J.GYRO = GYRO; J.ACC = ACC;

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
