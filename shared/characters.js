/* ============================================================
 * 놀자 공용 캐릭터 — 모든 게임에서 같은 8명을 씀
 *
 *  - CHARS                 생김새 데이터 (실력은 모두 같음)
 *  - portrait(canvas, ch)  선택 화면용 얼굴 그림 (2D 캔버스)
 *  - build3D(ch, accent, { racket })  three.js 3D 모델 (단순 도형 조합, 가벼움)
 *      accent = 플레이어 색 (라켓·머리띠·머리끈), racket = 오른손에 라켓 들기
 *      반환: { root, legs, torso, head, armR, armL, prop, blob, cast, ch, dispose() }
 *      좌표: 몸 기준 y 위, -z 앞, +x 오른쪽 (라켓 손)
 *  - placeLimb / placeProp / mixPose / poses  팔·도구 자세 도우미
 *      자세 = { dR, dL(어깨→손 방향), r(도구 방향), n(도구 면 방향), twist, lean, nod }
 * ============================================================ */
(function () {
  'use strict';
  const N = window.Nolja = window.Nolja || {};

  const CHARS = [
    { name: '준호', style: 'short',    skin: '#f1c9a5', hair: '#2b1d14', shirt: '#22c55e', shorts: '#1f2937', h: 1.00, w: 1.00, band: true },
    { name: '하나', style: 'ponytail', skin: '#f7d7bd', hair: '#6b3a1f', shirt: '#f472b6', shorts: '#f8fafc', h: 0.95, w: 0.92 },
    { name: '번개', style: 'spiky',    skin: '#e3b086', hair: '#facc15', shirt: '#f97316', shorts: '#1e293b', h: 1.02, w: 1.00 },
    { name: '민지', style: 'bob',      skin: '#f7d7bd', hair: '#111827', shirt: '#a78bfa', shorts: '#e5e7eb', h: 0.94, w: 0.92 },
    { name: '곰탱', style: 'cap',      skin: '#d9a77c', hair: '#3b2a20', shirt: '#b45309', shorts: '#374151', h: 1.04, w: 1.25, cap: '#0f766e' },
    { name: '레오', style: 'afro',     skin: '#8d5524', hair: '#1c1917', shirt: '#fde047', shorts: '#1d4ed8', h: 1.03, w: 1.00 },
    { name: '할배', style: 'bald',     skin: '#f1c9a5', hair: '#d1d5db', shirt: '#f8fafc', shorts: '#6b7280', h: 0.93, w: 1.06, glasses: true, mustache: true },
    { name: '코코', style: 'bun',      skin: '#f7d7bd', hair: '#b91c1c', shirt: '#14b8a6', shorts: '#f8fafc', h: 0.96, w: 0.95 },
  ];
  const PLAYER_COLORS = ['#3b82f6', '#f43f5e'];   // P1 파랑 · P2 빨강

  // ---------- 2D 얼굴 그림 ----------
  function circ(g, x, y, r) { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); }
  function rr(g, x, y, w, h, r) {
    g.beginPath();
    r = Math.max(0, Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2));
    g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  }
  function fringe(g, cx, cy, R, d) {   // 앞머리
    g.beginPath();
    g.moveTo(cx - R * 1.04, cy - R * 0.06);
    g.arc(cx, cy - R * 0.06, R * 1.04, Math.PI, Math.PI * 2);
    g.quadraticCurveTo(cx + R * 0.55, cy - R * d, cx + R * 0.1, cy - R * (d + 0.12));
    g.quadraticCurveTo(cx - R * 0.45, cy - R * (d - 0.08), cx - R * 1.04, cy - R * 0.06);
    g.closePath(); g.fill();
  }
  function portrait(c, ch) {
    const g = c.getContext('2d'); if (!g) return;
    const S = c.width, cx = S / 2, cy = S * 0.46, R = S * 0.24, st = ch.style;
    g.clearRect(0, 0, S, S);
    g.fillStyle = ch.shirt; g.beginPath(); g.ellipse(cx, S * 1.03, S * 0.33 * ch.w, S * 0.25, 0, Math.PI, Math.PI * 2); g.fill();
    g.fillStyle = ch.skin; g.fillRect(cx - R * 0.3, cy + R * 0.7, R * 0.6, R * 0.55);
    // 뒷머리
    g.fillStyle = ch.hair;
    if (st === 'afro') circ(g, cx, cy - R * 0.28, R * 1.5);
    if (st === 'bob') { rr(g, cx - R * 1.2, cy - R * 1.12, R * 2.4, R * 1.98, R * 0.95); g.fill(); }
    if (st === 'ponytail') { circ(g, cx + R * 1.08, cy + R * 0.25, R * 0.4); circ(g, cx + R * 0.98, cy - R * 0.25, R * 0.3); }
    if (st === 'bun') circ(g, cx, cy - R * 1.13, R * 0.42);
    if (st === 'short' || st === 'spiky' || st === 'ponytail' || st === 'bun' || st === 'cap') circ(g, cx, cy - R * 0.08, R * 1.07);
    // 귀 · 얼굴
    g.fillStyle = ch.skin;
    circ(g, cx - R * 0.98, cy + R * 0.1, R * 0.2); circ(g, cx + R * 0.98, cy + R * 0.1, R * 0.2); circ(g, cx, cy, R);
    // 앞머리
    g.fillStyle = ch.hair;
    if (st === 'short' || st === 'ponytail' || st === 'bun') fringe(g, cx, cy, R, 0.42);
    if (st === 'afro') fringe(g, cx, cy, R, 0.5);
    if (st === 'spiky') {
      fringe(g, cx, cy, R, 0.5);
      for (let k = -2; k <= 2; k++) {
        const bx = cx + k * R * 0.4, top = cy - R * (1.55 - Math.abs(k) * 0.16);
        g.beginPath(); g.moveTo(bx - R * 0.3, cy - R * 0.75); g.lineTo(bx + k * R * 0.1, top); g.lineTo(bx + R * 0.3, cy - R * 0.75); g.closePath(); g.fill();
      }
    }
    if (st === 'bob') { g.beginPath(); g.moveTo(cx - R * 1.04, cy - R * 0.1); g.arc(cx, cy - R * 0.1, R * 1.04, Math.PI, Math.PI * 2); g.lineTo(cx + R * 1.0, cy - R * 0.32); g.lineTo(cx - R * 1.0, cy - R * 0.32); g.closePath(); g.fill(); }
    if (st === 'bald') { circ(g, cx - R * 0.94, cy - R * 0.12, R * 0.24); circ(g, cx + R * 0.94, cy - R * 0.12, R * 0.24); }
    if (st === 'cap') {
      g.fillStyle = ch.cap || '#0f766e';
      g.beginPath(); g.arc(cx, cy - R * 0.15, R * 1.06, Math.PI, Math.PI * 2); g.closePath(); g.fill();
      g.beginPath(); g.ellipse(cx, cy - R * 0.17, R * 1.25, R * 0.22, 0, 0, Math.PI * 2); g.fill();
    }
    // 눈썹 · 눈 · 볼 · 입
    g.fillStyle = st === 'bald' ? ch.hair : '#1f2937';
    for (const sx of [-1, 1]) { g.save(); g.translate(cx + sx * R * 0.37, cy - R * 0.2); g.rotate(sx * 0.12); g.fillRect(-R * 0.17, -R * 0.045, R * 0.34, R * 0.09); g.restore(); }
    g.fillStyle = '#1f2937'; for (const sx of [-1, 1]) circ(g, cx + sx * R * 0.37, cy + R * 0.06, R * 0.12);
    g.fillStyle = 'rgba(244,114,182,0.28)'; for (const sx of [-1, 1]) circ(g, cx + sx * R * 0.6, cy + R * 0.38, R * 0.15);
    g.strokeStyle = '#9a3412'; g.lineWidth = R * 0.08; g.lineCap = 'round';
    g.beginPath(); g.arc(cx, cy + R * 0.28, R * 0.24, Math.PI * 0.18, Math.PI * 0.82); g.stroke();
    if (ch.glasses) {
      g.strokeStyle = '#334155'; g.lineWidth = R * 0.07;
      for (const sx of [-1, 1]) { g.beginPath(); g.arc(cx + sx * R * 0.37, cy + R * 0.06, R * 0.23, 0, Math.PI * 2); g.stroke(); }
      g.beginPath(); g.moveTo(cx - R * 0.14, cy + R * 0.04); g.lineTo(cx + R * 0.14, cy + R * 0.04); g.stroke();
    }
    if (ch.mustache) { g.fillStyle = ch.hair; for (const sx of [-1, 1]) { g.beginPath(); g.ellipse(cx + sx * R * 0.17, cy + R * 0.33, R * 0.22, R * 0.1, sx * 0.25, 0, Math.PI * 2); g.fill(); } }
  }

  // ---------- 3D 모델 (THREE가 로드된 페이지에서만) ----------
  const HEAD_R = 0.18, ARM_L = 0.5;
  let GEO = null, P = null;
  const nrm = (x, y, z) => new THREE.Vector3(x, y, z).normalize();
  const lam = (color, extra) => new THREE.MeshLambertMaterial(Object.assign({ color }, extra || {}));
  const basic = (color, extra) => new THREE.MeshBasicMaterial(Object.assign({ color }, extra || {}));

  function geo() {   // 모든 캐릭터가 같이 쓰는 도형 (한 번만 만듦)
    if (GEO) return GEO;
    GEO = {
      leg: new THREE.CapsuleGeometry(0.068, 0.56, 3, 8),
      shoe: new THREE.BoxGeometry(0.13, 0.08, 0.27),
      shorts: new THREE.CylinderGeometry(0.17, 0.2, 0.24, 12),
      torso: new THREE.CapsuleGeometry(0.175, 0.28, 4, 12),
      head: new THREE.SphereGeometry(HEAD_R, 20, 14),
      band: new THREE.TorusGeometry(HEAD_R * 1.02, 0.022, 6, 24),
      eye: new THREE.SphereGeometry(0.025, 8, 6),
      brow: new THREE.BoxGeometry(0.064, 0.014, 0.012),
      nose: new THREE.SphereGeometry(0.024, 8, 6),
      ear: new THREE.SphereGeometry(0.04, 8, 6),
      smile: new THREE.TorusGeometry(0.038, 0.009, 4, 12, Math.PI),
      ring: new THREE.TorusGeometry(0.042, 0.007, 4, 16),
      stache: new THREE.SphereGeometry(0.05, 10, 6),
      spike: new THREE.ConeGeometry(0.05, 0.15, 6),
      tail: new THREE.CapsuleGeometry(0.05, 0.2, 3, 8),
      knot: new THREE.SphereGeometry(0.04, 8, 6),
      bun: new THREE.SphereGeometry(0.08, 12, 8),
      brim: new THREE.CylinderGeometry(0.13, 0.13, 0.016, 16),
      arm: new THREE.CapsuleGeometry(0.05, 0.42, 3, 8),
      handle: new THREE.CylinderGeometry(0.016, 0.019, 0.24, 8),
      frame: new THREE.TorusGeometry(0.13, 0.014, 6, 26),
      strings: new THREE.CircleGeometry(0.124, 20),
      blob: new THREE.CircleGeometry(0.4, 20),
    };
    P = {
      shR: new THREE.Vector3(0.22, 0.45, 0), shL: new THREE.Vector3(-0.22, 0.45, 0),   // 어깨 (상체 기준)
      up: new THREE.Vector3(0, 1, 0), x: new THREE.Vector3(), z: new THREE.Vector3(), m: new THREE.Matrix4(),
      ready: { dR: nrm(0.35, -0.72, -0.6), dL: nrm(-0.32, -0.85, -0.38), r: nrm(0.08, 0.82, -0.56), n: new THREE.Vector3(-1, 0, 0), twist: 0, lean: 0, nod: 0 },
    };
    return GEO;
  }

  function build3D(ch, accent, opts = {}) {
    const g = geo();
    const own = [];   // 이 캐릭터만 쓰는 재질·도형 (교체할 때 정리)
    const mat = (c, extra) => { const m = lam(c, extra); own.push(m); return m; };
    const ownGeo = x => { own.push(x); return x; };
    const M = { skin: mat(ch.skin), shirt: mat(ch.shirt), shorts: mat(ch.shorts), shoe: mat(0xf8fafc), hair: mat(ch.hair, { side: THREE.DoubleSide }), dark: mat(0x1f2937), accent: mat(accent), lip: mat(0x9a3412) };
    const root = new THREE.Group(), cast = [];
    const add = (parent, geom, m, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(geom, m); o.position.set(x, y, z); parent.add(o); cast.push(o); return o; };
    const legs = [-1, 1].map(sd => {
      const lg = new THREE.Group(); lg.position.set(sd * 0.1, 0.84, 0); root.add(lg);
      add(lg, g.leg, M.skin, 0, -0.36);
      add(lg, g.shoe, M.shoe, 0, -0.79, -0.04);
      return lg;
    });
    add(root, g.shorts, M.shorts, 0, 0.84);
    const torso = new THREE.Group(); torso.position.y = 0.92; root.add(torso);
    add(torso, g.torso, M.shirt, 0, 0.3);
    const head = new THREE.Group(); head.position.y = 0.78; torso.add(head);
    add(head, g.head, M.skin);
    for (const sx of [-1, 1]) {
      add(head, g.ear, M.skin, sx * HEAD_R * 0.98, 0, 0.01);
      add(head, g.eye, M.dark, sx * 0.065, 0.015, -0.164);
      const b = add(head, g.brow, ch.style === 'bald' ? M.hair : M.dark, sx * 0.066, 0.07, -0.16); b.rotation.z = -sx * 0.12;
    }
    add(head, g.nose, M.skin, 0, -0.02, -0.177);
    const sm = add(head, g.smile, M.lip, 0, -0.078, -0.156); sm.rotation.z = Math.PI;
    if (ch.glasses) {
      const gm = mat(0x334155);
      for (const sx of [-1, 1]) add(head, g.ring, gm, sx * 0.068, 0.015, -0.176);
      add(head, ownGeo(new THREE.BoxGeometry(0.05, 0.008, 0.008)), gm, 0, 0.02, -0.18);
    }
    if (ch.mustache) { const s = add(head, g.stache, M.hair, 0, -0.05, -0.168); s.scale.set(1.6, 0.42, 0.55); }
    buildHair(head, ch, M, add, ownGeo, mat);
    if (ch.band) { const b = add(head, g.band, M.accent, 0, 0.06, 0); b.rotation.x = Math.PI / 2; }
    const armR = add(torso, g.arm, M.skin), armL = add(torso, g.arm, M.skin);
    let prop = null;
    if (opts.racket) {
      prop = new THREE.Group(); torso.add(prop);
      add(prop, g.handle, M.dark, 0, 0.11);
      const fr = add(prop, g.frame, M.accent, 0, 0.38); fr.scale.set(1, 1.25, 1);
      const strings = basic(0xffffff, { transparent: true, opacity: 0.32, side: THREE.DoubleSide, depthWrite: false }); own.push(strings);
      const st = new THREE.Mesh(g.strings, strings); st.position.y = 0.38; st.scale.set(1, 1.25, 1); prop.add(st);
    }
    const blob = new THREE.Mesh(g.blob, basic(0x000000, { transparent: true, opacity: 0.3, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
    own.push(blob.material); blob.rotation.x = -Math.PI / 2;
    return { root, legs, torso, head, armR, armL, prop, blob, cast, ch, popT: -9, dispose() { for (const o of own) o.dispose(); } };
  }

  function buildHair(head, ch, M, add, ownGeo, mat) {
    const R = HEAD_R, g = GEO;
    const cap = (s, theta, tilt, m = M.hair) => { const o = add(head, ownGeo(new THREE.SphereGeometry(R * s, 20, 10, 0, Math.PI * 2, 0, Math.PI * theta)), m); o.rotation.x = tilt; return o; };
    switch (ch.style) {
      case 'short': cap(1.05, 0.55, 0.42); break;
      case 'spiky': {
        cap(1.04, 0.5, 0.38);
        for (let k = 0; k < 7; k++) {
          const a = k / 7 * Math.PI * 2, rad = R * 0.5;
          const s = add(head, g.spike, M.hair, Math.cos(a) * rad, R * 0.82, Math.sin(a) * rad + R * 0.18);
          s.rotation.set(Math.sin(a) * 0.55 + 0.35, 0, -Math.cos(a) * 0.55);
        }
        add(head, g.spike, M.hair, 0, R * 1.05, R * 0.1).rotation.x = 0.3;
        break;
      }
      case 'ponytail': {
        cap(1.05, 0.55, 0.42);
        add(head, g.knot, M.accent, 0, R * 0.42, R * 0.98);
        const t = add(head, g.tail, M.hair, 0, R * 0.02, R * 1.14); t.rotation.x = 0.35;
        break;
      }
      case 'bob':
        cap(1.06, 0.55, 0.42);
        add(head, ownGeo(new THREE.SphereGeometry(R * 1.1, 20, 10, -Math.PI * 0.1, Math.PI * 1.2, Math.PI * 0.22, Math.PI * 0.5)), M.hair);   // 옆·뒤로 내려오는 단발
        break;
      case 'cap': {
        const cm = mat(ch.cap || '#0f766e');
        cap(1.03, 0.62, 0.55);                       // 모자 밖으로 보이는 뒷머리
        const d = cap(1.08, 0.5, 0.1, cm); d.position.y = R * 0.06;
        const b = add(head, g.brim, cm, 0, R * 0.32, -R * 0.98); b.rotation.x = -0.12; b.scale.set(1, 1, 1.25);
        break;
      }
      case 'afro': add(head, ownGeo(new THREE.SphereGeometry(R * 1.42, 16, 12)), M.hair, 0, R * 0.45, R * 0.55); break;
      case 'bun': cap(1.05, 0.55, 0.42); add(head, g.bun, M.hair, 0, R * 0.98, R * 0.42); break;
      case 'bald': add(head, ownGeo(new THREE.SphereGeometry(R * 1.04, 16, 4, Math.PI * 0.08, Math.PI * 0.84, Math.PI * 0.4, Math.PI * 0.22)), M.hair); break;   // 뒤통수만 둘러진 머리
    }
  }

  // ---------- 자세 도우미 ----------
  // 팔(캡슐)을 어깨 S에서 방향 d로 놓기
  function placeLimb(m, S, d) {
    m.position.set(S.x + d.x * ARM_L / 2, S.y + d.y * ARM_L / 2, S.z + d.z * ARM_L / 2);
    m.quaternion.setFromUnitVectors(P.up, d);
  }
  // 오른손 도구(라켓 등): 손 위치에 두고, 도구 방향 = pose.r, 면 방향 = pose.n
  function placeProp(gr, pose) {
    const { dR, r, n } = pose, S = P.shR;
    gr.position.set(S.x + dR.x * (ARM_L + 0.03), S.y + dR.y * (ARM_L + 0.03), S.z + dR.z * (ARM_L + 0.03));
    P.z.copy(n).addScaledVector(r, -n.dot(r));
    if (P.z.lengthSq() < 1e-6) P.z.set(0, 0, 1).addScaledVector(r, -r.z);
    P.z.normalize();
    P.x.crossVectors(r, P.z);
    P.m.makeBasis(P.x, r, P.z);
    gr.quaternion.setFromRotationMatrix(P.m);
  }
  function mixPose(A, B, u) {
    const mv = (a, b) => new THREE.Vector3().copy(a).lerp(b, u).normalize();
    const lerp = (a, b) => a + (b - a) * u;
    return { dR: mv(A.dR, B.dR), dL: mv(A.dL, B.dL), r: mv(A.r, B.r), n: mv(A.n, B.n), twist: lerp(A.twist, B.twist), lean: lerp(A.lean || 0, B.lean || 0), nod: lerp(A.nod || 0, B.nod || 0) };
  }
  // 자주 쓰는 자세 (t = 시간, 흔들림용)
  const poses = {
    ready() { geo(); return P.ready; },
    cheer(t) { geo(); return { dR: nrm(0.35, 0.9, -0.25), dL: P.ready.dL, r: nrm(0.2, 1, -0.15), n: new THREE.Vector3(0, 0, -1), twist: 0.15 * Math.sin(t * 3), lean: 0, nod: 0 }; },
    celebrate(t) { return { dR: nrm(0.25, 1, -0.05), dL: nrm(-0.3, 0.95, -0.1), r: nrm(0.15, 1, 0.05), n: new THREE.Vector3(0, 0, -1), twist: 0.35 * Math.sin(t * 5), lean: 0, nod: -0.15 }; },
    sad() { return { dR: nrm(0.12, -1, 0.08), dL: nrm(-0.12, -1, 0.08), r: nrm(0.05, -0.95, 0.3), n: new THREE.Vector3(1, 0, 0), twist: 0, lean: 0.32, nod: 0.35 }; },
  };

  N.characters = {
    CHARS, PLAYER_COLORS, portrait, build3D, placeLimb, placeProp, mixPose, poses, HEAD_R, ARM_L, nrm,
    shoulders() { geo(); return { R: P.shR, L: P.shL }; },
  };
})();
