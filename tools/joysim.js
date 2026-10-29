// 가짜 조이콘: 몸짓(시간 → 조이콘 자세·손 위치)을 받아 진짜 조이콘이 보낼 0x30 입력 리포트를 만듦 (시험·화면 확인용)
//  motion(t) → { top: [x,y,z] 어깨 버튼 쪽 끝이 가리키는 방향, face: [x,y,z] 버튼 면이 보는 방향,
//                p: [x,y,z] 손 위치(m), zr: 트리거(ZR·ZL)를 누르고 있나 }   세상: x 앞 · y 왼쪽 · z 위
//  reports(motion, dur, { kind: 'R' | 'L', bias: [x,y,z] 자이로 영점 어긋남(눈금) }) → DataView 배열 (리포트 하나 = 0.015초, 샘플 3개)
//  가속도 = 손의 가속도/9.8 + 위(중력 반대), 자이로 = 몸체 기준 회전 속도. ±8g · ±2293도/초에서 잘림
(function (root) {
  'use strict';
  const G = 9.80665, GYRO = 1 / 14.2842, ACC = 1 / 4096, H = 1e-4;
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const nrm = a => { const n = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / n, a[1] / n, a[2] / n]; };
  function axes(m, kind) {   // 몸체 X·Y·Z축의 세상 방향 (오른쪽 조이콘은 Z가 뒷면 쪽)
    const X = nrm(m.top);
    let F = sub(m.face, X.map(v => v * dot(m.face, X))); F = nrm(F);
    const Z = kind === 'L' ? F : F.map(v => -v);
    return [X, cross(Z, X), Z];
  }
  function sample(motion, t, kind) {
    const a = axes(motion(t - H), kind), b = axes(motion(t + H), kind), c = axes(motion(t), kind);
    // 세상 기준 회전 속도: dR/dt·Rᵀ 의 반대칭 부분
    const dR = k => [0, 1, 2].map(i => (b[k][i] - a[k][i]) / (2 * H));
    const w = [0, 0, 0];
    for (let k = 0; k < 3; k++) { const d = dR(k), v = cross(c[k], d); w[0] += v[0] / 2; w[1] += v[1] / 2; w[2] += v[2] / 2; }
    const p0 = motion(t - H).p || [0, 0, 0], p1 = motion(t).p || [0, 0, 0], p2 = motion(t + H).p || [0, 0, 0];
    const acc = [0, 1, 2].map(i => (p2[i] - 2 * p1[i] + p0[i]) / (H * H) / G + (i === 2 ? 1 : 0));
    return { f: c.map(e => dot(acc, e)), w: c.map(e => dot(w, e) * 180 / Math.PI), zr: !!motion(t).zr };
  }
  const i16 = v => Math.max(-32768, Math.min(32767, Math.round(v)));
  function reports(motion, dur, opt = {}) {
    const kind = opt.kind || 'R', bias = opt.bias || [0, 0, 0], out = [];
    for (let t = 0; t + 0.015 <= dur + 1e-9; t += 0.015) {
      const dv = new DataView(new ArrayBuffer(48));
      dv.setUint8(1, 0x80);
      dv.setUint8(5, 0x00); dv.setUint8(6, 0x08); dv.setUint8(7, 0x80);    // 두 스틱 가운데 (2048, 2048)
      dv.setUint8(8, 0x00); dv.setUint8(9, 0x08); dv.setUint8(10, 0x80);
      let zr = false;
      for (let k = 0; k < 3; k++) {
        const s = sample(motion, t + k * 0.005, kind), o = 12 + k * 12;
        zr = zr || s.zr;
        for (let i = 0; i < 3; i++) dv.setInt16(o + 2 * i, i16(s.f[i] / ACC), true);
        for (let i = 0; i < 3; i++) dv.setInt16(o + 6 + 2 * i, i16(s.w[i] / GYRO + bias[i]), true);
      }
      if (zr) { if (kind === 'L') dv.setUint8(4, 0x80); else dv.setUint8(2, 0x80); }
      out.push(dv);
    }
    return out;
  }
  // 자주 쓰는 몸짓 -------------------------------------------------------------
  // 볼링: 어깨(높이 1.4m)를 중심으로 팔(0.65m)이 앞뒤로. th(t) = 팔 각도(도, 0 아래 · + 앞 · - 뒤)
  //  grip 'forearm' 조이콘이 팔을 따라 손끝 쪽을 가리킴(기본) · 'hammer' 팔에 수직으로 앞을 가리킴(망치 쥐듯)
  //  heading: 서 있는 방향(도) · yaw(t): 휘두르는 면이 왼쪽(+)으로 돈 각도(도) · twist(t): 손목을 위에서 볼 때 반시계로 비튼 각도(도)
  function bowl(th, opt = {}) {
    const R = Math.PI / 180, heading = (opt.heading || 0) * R, sh = [0, 0, 1.4];
    const yaw = typeof opt.yaw === 'function' ? opt.yaw : () => opt.yaw || 0;
    const twist = opt.twist || (() => 0), grip = opt.grip || 'forearm', zr = opt.zr || (() => false);
    return t => {
      const a = th(t) * R, hd = heading + yaw(t) * R;
      const f = [Math.cos(hd), Math.sin(hd), 0], up = [0, 0, 1], side = cross(up, f);   // side = 왼쪽
      const arm = [f[0] * Math.sin(a), f[1] * Math.sin(a), -Math.cos(a)];
      const fwdOfArm = [f[0] * Math.cos(a), f[1] * Math.cos(a), Math.sin(a)];         // 팔에 수직, 팔이 아래일 때 앞
      const tw = twist(t) * R;
      // 손목 비틀기: 팔 축을 중심으로 돌림 (위에서 볼 때 반시계 = 팔이 아래를 가리킬 때 -팔 축 기준 +)
      const rot = v => { const k = arm.map(x => -x), c = Math.cos(tw), s = Math.sin(tw), kv = cross(k, v), kd = dot(k, v); return v.map((x, i) => x * c + kv[i] * s + k[i] * kd * (1 - c)); };
      const top = grip === 'hammer' ? rot(fwdOfArm) : arm;
      const face = grip === 'hammer' ? rot(side.map(x => -x)) : rot(fwdOfArm);
      return { top, face, p: [sh[0] + arm[0] * 0.65, sh[1] + arm[1] * 0.65, sh[2] + arm[2] * 0.65], zr: zr(t) };
    };
  }
  const api = { reports, sample, bowl, GYRO, ACC };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.JoySim = api;
})(typeof window !== 'undefined' ? window : globalThis);
