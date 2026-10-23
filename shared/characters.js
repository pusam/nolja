/* Shared character collection. All characters have identical playing ability.
 * Models face -Z; every animated paw and the racket use the same shoulder rig.
 */
(function () {
  'use strict';
  const N = window.Nolja = window.Nolja || {};
  const CHARS = [
    { name: '피카츄', kind: 'pikachu', tag: '전기', blurb: '짜릿하게, 사랑스럽게!', body: '#ffcf45', skin: '#ffcf45', hair: '#352a38', shirt: '#ffcf45', shorts: '#ae713d', h: 1, w: 1, style: 'monster' },
    { name: '이브이', kind: 'eevee', tag: '노말', blurb: '폭신한 털 속에 숨겨둔 에이스', body: '#b7804e', skin: '#b7804e', hair: '#48323a', shirt: '#bc8756', shorts: '#f9e9bf', h: 0.96, w: 0.96, style: 'monster' },
    { name: '파이리', kind: 'charmander', tag: '불꽃', blurb: '작은 불꽃, 뜨거운 승부!', body: '#ff9858', skin: '#ff9858', hair: '#b84e32', shirt: '#ff9858', shorts: '#ffe8b7', h: 1, w: 0.98, style: 'monster' },
    { name: '꼬부기', kind: 'squirtle', tag: '물', blurb: '동글동글한 코트의 수호자', body: '#73cee4', skin: '#73cee4', hair: '#795549', shirt: '#73cee4', shorts: '#f6df9e', h: 0.96, w: 1, style: 'monster' },
    { name: '푸린', kind: 'jigglypuff', tag: '페어리', blurb: '통통 튀는 핑크빛 랠리', body: '#f4b0d0', skin: '#f4b0d0', hair: '#df83ad', shirt: '#f4b0d0', shorts: '#eb91b9', h: 0.97, w: 1.04, style: 'monster' },
    { name: '아구몬', kind: 'agumon', tag: '불꽃', blurb: '용감한 꼬마 공룡의 첫 서브', body: '#ffb44e', skin: '#ffb44e', hair: '#d77e32', shirt: '#ffb44e', shorts: '#fff2d8', h: 1.02, w: 1.02, style: 'monster' },
    { name: '파닥몬', kind: 'patamon', tag: '바람', blurb: '커다란 귀로 날아오를 준비!', body: '#eda05c', skin: '#eda05c', hair: '#995b44', shirt: '#eda05c', shorts: '#fff1d9', h: 0.95, w: 1, style: 'monster' },
    { name: '가트몬', kind: 'gatomon', tag: '빛', blurb: '작은 발끝에서 시작되는 반전', body: '#fff6ed', skin: '#fff6ed', hair: '#8b68b5', shirt: '#b5d574', shorts: '#fff6ed', h: 1, w: 0.96, style: 'monster' },
  ];
  const PLAYER_COLORS = ['#3688ff', '#fb729b'];

  function ellipse(g, x, y, rx, ry, fill, rotation = 0, stroke = true) {
    g.beginPath(); g.ellipse(x, y, rx, ry, rotation, 0, Math.PI * 2);
    g.fillStyle = fill; g.fill(); if (stroke) g.stroke();
  }
  function path(g, points, fill) {
    g.beginPath(); g.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i++) g.lineTo(points[i][0], points[i][1]);
    g.closePath(); g.fillStyle = fill; g.fill(); g.stroke();
  }
  // x is the centre, y the top of the ears; size is the complete body height.
  function drawMonster2D(g, ch, x, y, size, front = true) {
    const k = ch.kind;
    g.save(); g.translate(x - size / 2, y); g.scale(size / 256, size / 256);
    g.strokeStyle = '#4d3b47'; g.lineWidth = 3.1; g.lineJoin = 'round'; g.lineCap = 'round';
    if (k === 'pikachu') path(g, [[177, 187], [211, 179], [203, 153], [232, 138], [224, 109], [193, 134], [200, 155], [178, 166]], '#ffd64c');
    if (k === 'eevee') { ellipse(g, 190, 198, 32, 41, '#bd8757', -0.45); ellipse(g, 203, 175, 22, 19, '#fff0cc'); }
    if (k === 'charmander') {
      ellipse(g, 195, 198, 23, 33, '#ff9a5d', 0.5);
      path(g, [[203, 183], [193, 160], [208, 169], [219, 140], [228, 166], [225, 181]], '#ff7854');
      path(g, [[207, 183], [207, 166], [215, 174], [220, 159], [222, 182]], '#ffdf71');
    }
    if (k === 'squirtle') { ellipse(g, 161, 192, 44, 44, '#8f604d'); ellipse(g, 198, 204, 17, 23, '#79d2e5', 0.4); }
    if (k === 'gatomon') {
      g.strokeStyle = '#9572bd'; g.lineWidth = 15; g.beginPath(); g.moveTo(172, 217); g.bezierCurveTo(229, 228, 230, 178, 211, 172); g.stroke();
      g.strokeStyle = '#4d3b47'; g.lineWidth = 3.1; ellipse(g, 217, 192, 9, 5, '#f8d266', -0.5);
    }
    const fur = g.createLinearGradient(80, 78, 166, 228); fur.addColorStop(0, '#fffaf3'); fur.addColorStop(0.13, ch.body); fur.addColorStop(1, ch.body);
    ellipse(g, 128, 199, 43, 38, fur);
    const foot = k === 'gatomon' ? '#fff7f0' : ch.body;
    ellipse(g, 101, 229, 22, 13, foot, -0.15); ellipse(g, 155, 229, 22, 13, foot, 0.15);
    if (front && ['charmander', 'squirtle', 'patamon'].includes(k)) ellipse(g, 128, 207, 28, 25, k === 'patamon' ? '#fff7e6' : '#ffedc7');
    if (k === 'pikachu' || k === 'eevee') {
      for (const s of [-1, 1]) {
        ellipse(g, 128 + s * 42, 61, k === 'eevee' ? 23 : 17, k === 'eevee' ? 52 : 49, k === 'eevee' ? '#b98355' : '#ffcf45', s * 0.33);
        ellipse(g, 128 + s * 51, k === 'eevee' ? 43 : 31, k === 'eevee' ? 13 : 12, k === 'eevee' ? 31 : 17, k === 'eevee' ? '#69464b' : '#3d3540', s * 0.33, false);
      }
    }
    if (k === 'jigglypuff' || k === 'gatomon') {
      for (const s of [-1, 1]) {
        const ex = 128 + s * 49;
        path(g, [[ex - 24, 98], [ex + s * 8, 42], [ex + 26, 95]], ch.body);
        if (front) path(g, [[ex - 11, 88], [ex + s * 7, 58], [ex + 15, 88]], k === 'gatomon' ? '#ae88c6' : '#a55a82');
      }
    }
    if (k === 'patamon') {
      for (const s of [-1, 1]) {
        g.save(); g.translate(128 + s * 62, 105); g.rotate(s * -0.24);
        for (let j = 0; j < 3; j++) ellipse(g, s * (18 + j * 9), -j * 12, 17 - j * 2, 42 - j * 5, '#eda05c', s * 0.85);
        ellipse(g, s * 22, -8, 12, 32, '#d78b65', s * 0.85, false); g.restore();
      }
    }
    const hx = k === 'jigglypuff' ? 75 : k === 'patamon' ? 73 : 66;
    const hy = k === 'jigglypuff' ? 72 : k === 'patamon' ? 56 : 61;
    const cy = k === 'jigglypuff' ? 144 : 131;
    ellipse(g, 128, cy, hx, hy, fur);
    if (front && k === 'patamon') ellipse(g, 128, 157, 61, 32, '#fff6e4');
    if (k === 'eevee') {
      for (let i = 0; i < 7; i++) ellipse(g, 79 + i * 16, 187 + Math.sin(i / 6 * Math.PI) * 9, 18, 18, '#fff0cf', 0, false);
      path(g, [[82, 180], [77, 199], [96, 195], [104, 209], [118, 201], [130, 215], [143, 201], [160, 207], [164, 192], [179, 193], [175, 179]], '#fff0cf');
    }
    if (!front) {
      if (k === 'pikachu') { for (const by of [193, 209]) ellipse(g, 128, by, 30, 5, '#a87143', 0, false); }
      if (k === 'squirtle') {
        ellipse(g, 128, 201, 42, 33, '#fff0cd'); ellipse(g, 128, 201, 36, 28, '#93654f');
        g.strokeStyle = '#654c48'; path(g, [[112, 190], [139, 184], [150, 205], [128, 220], [108, 209]], '#a77659');
      }
      for (const s of [-1, 1]) ellipse(g, 128 + s * 46, 205, 15, 19, k === 'gatomon' ? '#b5d574' : ch.body, s * -0.5);
      g.restore(); return;
    }
    if (k === 'jigglypuff') {
      g.fillStyle = '#f5b4d3'; g.beginPath(); g.moveTo(101, 94); g.bezierCurveTo(100, 63, 161, 65, 153, 97); g.bezierCurveTo(148, 118, 119, 111, 126, 94); g.bezierCurveTo(126, 84, 139, 87, 136, 96); g.fill(); g.stroke();
    }
    if (k === 'agumon') {
      ellipse(g, 128, 160, 51, 29, '#ffc76f');
      for (const s of [-1, 1]) ellipse(g, 128 + s * 22, 151, 3, 3, '#b26938', 0, false);
    }
    const ey = k === 'agumon' ? 119 : cy - 1, ex = k === 'jigglypuff' ? 31 : 27;
    const er = k === 'jigglypuff' ? 21 : k === 'eevee' ? 18 : 15;
    for (const s of [-1, 1]) {
      const px = 128 + s * ex;
      if (['squirtle', 'agumon', 'gatomon'].includes(k)) ellipse(g, px, ey, er + 5, er * 1.25 + 4, '#fffdf9');
      ellipse(g, px, ey, er, er * 1.25, '#343044', 0, false);
      ellipse(g, px, ey + er * 0.43, er * 0.76, er * 0.59, k === 'jigglypuff' ? '#54b2c5' : k === 'agumon' ? '#81bc76' : k === 'gatomon' ? '#6aa4e4' : '#9d6d57', 0, false);
      ellipse(g, px, ey - 2, er * 0.47, er * 0.7, '#343044', 0, false);
      ellipse(g, px - 5, ey - 8, er * 0.32, er * 0.39, '#ffffff', -0.2, false);
      ellipse(g, px + 6, ey + 7, er * 0.14, er * 0.16, '#ffffff', 0, false);
    }
    const cheek = k === 'pikachu' ? '#ed7669' : '#ed92a088';
    for (const s of [-1, 1]) ellipse(g, 128 + s * 48, cy + 22, k === 'pikachu' ? 12 : 10, k === 'pikachu' ? 11 : 6, cheek, 0, false);
    if (k !== 'jigglypuff') { g.fillStyle = '#4d3b47'; g.beginPath(); g.moveTo(123, cy + 16); g.quadraticCurveTo(128, cy + 12, 133, cy + 16); g.lineTo(128, cy + 21); g.fill(); }
    g.strokeStyle = '#684653'; g.lineWidth = 2.6;
    g.beginPath(); g.moveTo(116, cy + 31); g.quadraticCurveTo(128, cy + 42, 140, cy + 31); g.stroke();
    if (k === 'gatomon') { g.strokeStyle = '#ac8cbb'; for (const s of [-1, 1]) for (let j = 0; j < 2; j++) { g.beginPath(); g.moveTo(128 + s * 40, cy + 14 + j * 9); g.lineTo(128 + s * 57, cy + 11 + j * 13); g.stroke(); } }
    g.strokeStyle = '#4d3b47';
    for (const s of [-1, 1]) ellipse(g, 128 + s * 46, 205, 15, 19, k === 'gatomon' ? '#b5d574' : ch.body, s * -0.5);
    g.restore();
  }
  function portrait(canvas, ch) {
    const g = canvas.getContext('2d'); if (!g) return;
    const S = canvas.width; g.clearRect(0, 0, S, canvas.height);
    g.save(); g.scale(1, canvas.height / S);
    const glow = g.createRadialGradient(S * 0.5, S * 0.5, 0, S * 0.5, S * 0.5, S * 0.48);
    glow.addColorStop(0, '#ffffff'); glow.addColorStop(1, ch.body + '16');
    ellipse(g, S * 0.5, S * 0.54, S * 0.43, S * 0.43, glow, 0, false);
    ellipse(g, S * 0.5, S * 0.92, S * 0.25, S * 0.035, '#4d3b4715', 0, false);
    drawMonster2D(g, ch, S * 0.5, 0, S);
    g.restore();
  }

  const HEAD_R = 0.44, ARM_L = 0.36;
  let GEO = null, P = null;
  const nrm = (x, y, z) => new THREE.Vector3(x, y, z).normalize();
  function geo() {
    if (GEO) return GEO;
    GEO = {
      sphere: new THREE.SphereGeometry(1, 24, 16), arm: new THREE.CapsuleGeometry(0.11, ARM_L - 0.22, 4, 12),
      cone: new THREE.ConeGeometry(1, 1, 16), box: new THREE.BoxGeometry(1, 1, 1),
      handle: new THREE.CylinderGeometry(0.019, 0.025, 0.24, 10), frame: new THREE.TorusGeometry(0.145, 0.017, 8, 32),
      band: new THREE.TorusGeometry(1, 0.045, 6, 24), blob: new THREE.CircleGeometry(0.53, 32),
    };
    P = {
      shR: new THREE.Vector3(0.32, 0.56, -0.005), shL: new THREE.Vector3(-0.32, 0.56, -0.005),
      up: new THREE.Vector3(0, 1, 0), x: new THREE.Vector3(), z: new THREE.Vector3(), m: new THREE.Matrix4(),
      ready: { dR: nrm(0.35, -0.72, -0.6), dL: nrm(-0.32, -0.85, -0.38), r: nrm(0.08, 0.82, -0.56), n: new THREE.Vector3(-1, 0, 0), twist: 0, lean: 0, nod: 0 },
    };
    return GEO;
  }
  function build3D(ch, accent, opts = {}) {
    const g = geo(), own = [], mats = new Map(), root = new THREE.Group(), cast = [];
    const mat = (color, unlit = false) => {
      const key = String(color) + unlit; if (mats.has(key)) return mats.get(key);
      const m = unlit ? new THREE.MeshBasicMaterial({ color }) : new THREE.MeshLambertMaterial({ color });
      mats.set(key, m); own.push(m); return m;
    };
    const ownGeo = geom => { own.push(geom); return geom; };
    const add = (parent, geom, color, x = 0, y = 0, z = 0, scale = null, unlit = false) => {
      const o = new THREE.Mesh(geom, mat(color, unlit)); o.position.set(x, y, z);
      if (scale) o.scale.set(...scale); parent.add(o); cast.push(o); return o;
    };
    const ball = (parent, color, x, y, z, rx, ry = rx, rz = rx, unlit = false) => add(parent, g.sphere, color, x, y, z, [rx, ry, rz], unlit);
    const cone = (parent, color, x, y, z, rx, h, rz = rx) => add(parent, g.cone, color, x, y, z, [rx, h, rz]);
    const k = ch.kind, body = ch.body, cream = '#fff0cb', dark = '#363041';
    root.name = 'character-' + k;
    const legs = [-1, 1].map(s => {
      const leg = new THREE.Group(); leg.position.set(s * 0.19, 0.34, 0); root.add(leg);
      ball(leg, body, 0, -0.1, 0, 0.13, 0.19, 0.135);
      ball(leg, k === 'jigglypuff' ? '#e58cb5' : body, s * 0.025, -0.22, -0.08, 0.19, 0.115, 0.24);
      if (k === 'agumon' || k === 'charmander') for (let i = -1; i <= 1; i++) ball(leg, '#fff5df', i * 0.085, -0.23, -0.275, 0.035, 0.043, 0.065);
      return leg;
    });
    const torso = new THREE.Group(); torso.position.y = 0.30; root.add(torso);
    ball(torso, body, 0, 0.34, 0.02, k === 'patamon' ? 0.40 : 0.33, 0.40, 0.29);
    if (['charmander', 'squirtle', 'agumon', 'patamon'].includes(k)) ball(torso, k === 'patamon' ? '#fff5de' : cream, 0, 0.34, -0.253, 0.245, 0.30, 0.055);
    if (k === 'squirtle') {
      ball(torso, '#fff1d6', 0, 0.36, 0.19, 0.37, 0.41, 0.22); ball(torso, '#9a6852', 0, 0.37, 0.30, 0.32, 0.35, 0.18);
      const panel = add(torso, g.band, '#704c49', 0, 0.39, 0.466, [0.17, 0.18, 0.09]); panel.rotation.z = Math.PI / 6;
      for (const a of [0, 2.094, 4.189]) {
        const seam = add(torso, g.box, '#704c49', Math.sin(a) * 0.20, 0.39 + Math.cos(a) * 0.20, 0.436, [0.014, 0.20, 0.014]); seam.rotation.z = -a;
      }
      for (const y of [0.23, 0.40]) ball(torso, '#dbc389', 0, y, -0.308, 0.20, 0.012, 0.008);
    }
    if (k === 'eevee') {
      for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI * 2; ball(torso, cream, Math.sin(a) * 0.28, 0.62 + Math.cos(a * 2) * 0.025, Math.cos(a) * 0.21, 0.15, 0.15, 0.14); }
      for (let i = -1; i <= 1; i++) { const tuft = cone(torso, cream, i * 0.14, 0.45 + Math.abs(i) * 0.04, -0.25, 0.11, 0.24, 0.075); tuft.rotation.z = Math.PI + i * 0.3; }
    }
    const head = new THREE.Group(); head.position.set(0, 0.84, -0.02); torso.add(head);
    const round = k === 'jigglypuff', hx = round ? 0.54 : k === 'patamon' ? 0.50 : HEAD_R, hy = round ? 0.52 : k === 'patamon' ? 0.36 : 0.41, hz = round ? 0.45 : 0.37;
    ball(head, body, 0, 0, 0, hx, hy, hz);
    if (k === 'patamon') ball(head, '#fff6e5', 0, -0.12, -0.13, 0.46, 0.24, 0.29);
    if (k === 'agumon') ball(head, '#ffc66c', 0, -0.15, -0.29, 0.31, 0.20, 0.23);
    if (k === 'charmander') ball(head, '#ffad71', 0, -0.14, -0.22, 0.30, 0.21, 0.22);
    const faceZ = round ? -0.419 : k === 'agumon' || k === 'charmander' ? -0.324 : k === 'patamon' ? -0.344 : -0.343;
    const eyeY = k === 'agumon' ? 0.09 : 0.035, eyeX = round ? 0.225 : k === 'patamon' ? 0.21 : 0.18;
    const eyeR = round ? 0.132 : k === 'eevee' ? 0.109 : 0.091;
    const whiteEyes = ['agumon', 'gatomon', 'squirtle'].includes(k);
    for (const s of [-1, 1]) {
      const x = eyeX * s;
      if (whiteEyes) ball(head, '#fffdfa', x, eyeY, faceZ + 0.007, eyeR * 1.3, eyeR * 1.52, 0.038);
      ball(head, dark, x, eyeY, faceZ - 0.022, eyeR, eyeR * 1.27, 0.038, true);
      const iris = round ? '#5fbdce' : k === 'agumon' ? '#85bd7e' : k === 'gatomon' ? '#78b1e9' : k === 'squirtle' ? '#b57688' : '#ae805e';
      ball(head, iris, x, eyeY - eyeR * 0.48, faceZ - 0.054, eyeR * 0.72, eyeR * 0.55, 0.013, true);
      ball(head, dark, x, eyeY - 0.005, faceZ - 0.062, eyeR * 0.47, eyeR * 0.78, 0.012, true);
      ball(head, '#ffffff', x - eyeR * 0.30, eyeY + eyeR * 0.43, faceZ - 0.066, eyeR * 0.27, eyeR * 0.34, 0.014, true);
      ball(head, '#ffffff', x + eyeR * 0.37, eyeY - eyeR * 0.40, faceZ - 0.072, eyeR * 0.12, eyeR * 0.13, 0.012, true);
      if (k === 'pikachu') ball(head, '#ee7770', s * 0.322, -0.13, -0.284, 0.092, 0.075, 0.025);
      else ball(head, '#efa2b1', s * (round ? 0.39 : 0.32), -0.14, round ? -0.338 : -0.265, 0.061, 0.030, 0.012);
    }
    const noseZ = k === 'agumon' ? -0.51 : k === 'charmander' ? -0.43 : k === 'patamon' ? -0.429 : -0.387;
    if (!round) ball(head, dark, 0, k === 'agumon' ? -0.09 : -0.105, noseZ, 0.033, 0.023, 0.018, true);
    const mouthY = k === 'agumon' ? -0.23 : k === 'charmander' ? -0.25 : -0.22;
    const mouthZ = k === 'agumon' ? -0.497 : k === 'charmander' ? -0.411 : round ? -0.42 : k === 'patamon' ? -0.403 : -0.323;
    ball(head, '#70485b', 0, mouthY, mouthZ, round ? 0.038 : 0.069, 0.035, 0.018, true);
    ball(head, '#f3a2af', 0, mouthY - 0.013, mouthZ - 0.014, 0.034, 0.012, 0.008, true);
    if (k === 'agumon') for (const s of [-1, 1]) ball(head, '#fff8e8', s * 0.065, mouthY + 0.015, mouthZ - 0.012, 0.018, 0.024, 0.012);
    if (k === 'pikachu' || k === 'eevee') {
      for (const s of [-1, 1]) {
        const ear = new THREE.Group(); ear.position.set(s * 0.29, 0.29, 0.01); ear.rotation.z = -s * 0.34; head.add(ear);
        const eh = k === 'pikachu' ? 0.34 : 0.32;
        ball(ear, body, 0, eh * 0.52, 0, k === 'pikachu' ? 0.085 : 0.14, eh, 0.077);
        if (k === 'pikachu') ball(ear, dark, 0, eh * 1.18, 0, 0.067, 0.12, 0.068);
        else ball(ear, '#65454b', 0, eh * 0.65, -0.059, 0.087, 0.225, 0.025);
      }
    }
    if (round || k === 'gatomon') {
      for (const s of [-1, 1]) {
        const ear = cone(head, body, s * 0.33, 0.35, 0.02, 0.165, 0.38, 0.115); ear.rotation.z = -s * 0.28;
        const inner = cone(head, round ? '#9f6088' : '#ab86c5', s * 0.34, 0.37, -0.075, 0.10, 0.23, 0.025); inner.rotation.z = -s * 0.28;
      }
      if (round) {
        ball(head, '#f8bfd9', -0.02, 0.40, -0.13, 0.18, 0.15, 0.17);
        const curl = add(head, g.band, '#e698bc', 0.027, 0.397, -0.266, [0.091, 0.087, 0.55]); curl.rotation.z = -0.3;
        ball(head, '#f8bfd9', 0.003, 0.36, -0.279, 0.070, 0.060, 0.025);
      } else for (const s of [-1, 1]) for (const y of [-0.08, -0.18]) { const stripe = ball(head, '#a381bf', s * 0.36, y, -0.234, 0.067, 0.018, 0.016); stripe.rotation.z = s * -0.22; }
    }
    if (k === 'patamon') {
      for (const s of [-1, 1]) {
        const ear = new THREE.Group(); ear.position.set(s * 0.38, 0.11, 0.04); ear.rotation.z = -s * 0.6; head.add(ear);
        for (let j = 0; j < 3; j++) {
          const wing = ball(ear, body, s * (0.15 + j * 0.075), 0.10 - j * 0.11, 0, 0.26 - j * 0.025, 0.11, 0.065); wing.rotation.z = s * 0.15;
          const inner = ball(ear, '#d38d67', s * (0.15 + j * 0.065), 0.10 - j * 0.11, -0.054, 0.20 - j * 0.023, 0.065, 0.020); inner.rotation.z = s * 0.15;
        }
      }
    }
    if (k === 'pikachu') {
      const shape = new THREE.Shape();
      shape.moveTo(0, 0); shape.lineTo(0.16, 0.10); shape.lineTo(0.11, 0.30); shape.lineTo(0.36, 0.40); shape.lineTo(0.27, 0.65); shape.lineTo(0.02, 0.44); shape.lineTo(0.08, 0.28); shape.lineTo(-0.06, 0.20); shape.closePath();
      const tail = add(torso, ownGeo(new THREE.ExtrudeGeometry(shape, { depth: 0.075, bevelEnabled: true, bevelSegments: 2, steps: 1, bevelSize: 0.016, bevelThickness: 0.014 })), body, 0.28, 0.18, 0.23); tail.rotation.y = -0.25;
      ball(torso, '#ac713e', 0.29, 0.25, 0.28, 0.080, 0.16, 0.067);
      for (const y of [0.32, 0.49]) ball(torso, '#ad7749', 0, y, 0.30, 0.21, 0.045, 0.022);
    } else if (k === 'eevee') {
      const tail = ball(torso, body, 0.28, 0.27, 0.36, 0.22, 0.31, 0.21); tail.rotation.z = -0.75; tail.rotation.x = 0.55;
      ball(torso, cream, 0.42, 0.49, 0.43, 0.16, 0.17, 0.17);
    } else if (k === 'charmander' || k === 'agumon') {
      const tail = ball(torso, body, 0.18, 0.18, 0.34, 0.13, 0.16, 0.32); tail.rotation.y = 0.55;
      ball(torso, body, 0.35, 0.26, 0.52, 0.10, 0.19, 0.11);
      if (k === 'charmander') { ball(torso, '#ff784e', 0.37, 0.44, 0.54, 0.13, 0.22, 0.10); cone(torso, '#ff784e', 0.39, 0.61, 0.54, 0.085, 0.19, 0.07); ball(torso, '#ffe17c', 0.37, 0.41, 0.48, 0.075, 0.15, 0.065, true); }
    } else if (k === 'squirtle') {
      ball(torso, body, -0.28, 0.08, 0.35, 0.16, 0.15, 0.23);
      const curl = add(torso, g.band, '#4ca5c1', -0.29, 0.10, 0.54, [0.095, 0.085, 0.55]); curl.rotation.z = -0.6;
    } else if (k === 'gatomon') {
      const points = [[0.1, 0.17, 0.25], [0.36, 0.14, 0.38], [0.53, 0.31, 0.43], [0.51, 0.57, 0.40], [0.38, 0.63, 0.35]].map(v => new THREE.Vector3(...v));
      add(torso, ownGeo(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 24, 0.055, 8, false)), '#9671be');
      const ring = add(torso, g.band, '#f3cf6c', 0.51, 0.41, 0.425, [0.069, 0.069, 0.57]); ring.rotation.x = Math.PI / 2;
    } else if (k === 'patamon') ball(torso, body, 0, 0.21, 0.36, 0.12, 0.12, 0.16);
    const armR = new THREE.Group(), armL = new THREE.Group(); torso.add(armR, armL);
    for (const arm of [armR, armL]) {
      add(arm, g.arm, body);
      const pawColor = k === 'gatomon' ? '#b9d875' : body;
      ball(arm, pawColor, 0, ARM_L * 0.5 - 0.025, 0, k === 'gatomon' ? 0.15 : 0.125, 0.125, 0.13);
      if (k === 'gatomon') for (const y of [0.12, 0.18]) ball(arm, '#809d4e', 0, y, -0.123, 0.092, 0.018, 0.014);
      if (k === 'agumon') for (let j = -1; j <= 1; j++) ball(arm, '#fff1d8', j * 0.065, 0.23, -0.01, 0.027, 0.060, 0.034);
    }
    let prop = null;
    if (opts.racket) {
      prop = new THREE.Group(); torso.add(prop);
      add(prop, g.handle, dark, 0, 0.11); add(prop, g.handle, accent, 0, 0.17, 0, [1.12, 0.22, 1.12]);
      const frame = add(prop, g.frame, accent, 0, 0.40); frame.scale.y = 1.23;
      add(prop, g.frame, '#fff4e3', 0, 0.40, 0, [0.88, 1.08, 0.48]);
      const vertices = [];
      for (let i = -4; i <= 4; i++) {
        const x = i * 0.028, y = i * 0.034, dy = 0.165 * Math.sqrt(1 - Math.pow(x / 0.14, 2)), dx = 0.135 * Math.sqrt(1 - Math.pow(y / 0.174, 2));
        vertices.push(x, 0.40 - dy, 0, x, 0.40 + dy, 0, -dx, 0.40 + y, 0, dx, 0.40 + y, 0);
      }
      const stringGeo = ownGeo(new THREE.BufferGeometry()); stringGeo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
      const stringMat = new THREE.LineBasicMaterial({ color: '#fff7e5', transparent: true, opacity: 0.65 }); own.push(stringMat);
      prop.add(new THREE.LineSegments(stringGeo, stringMat));
    }
    const blobMat = new THREE.MeshBasicMaterial({ color: '#4b3950', transparent: true, opacity: 0.15, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }); own.push(blobMat);
    const blob = new THREE.Mesh(g.blob, blobMat); blob.rotation.x = -Math.PI / 2;
    placeLimb(armR, P.shR, P.ready.dR); placeLimb(armL, P.shL, P.ready.dL); if (prop) placeProp(prop, P.ready);
    return { root, legs, torso, head, armR, armL, prop, blob, cast, ch, popT: -9, dispose() { for (const resource of own) resource.dispose(); } };
  }
  function placeLimb(limb, shoulder, direction) {
    limb.position.set(shoulder.x + direction.x * ARM_L / 2, shoulder.y + direction.y * ARM_L / 2, shoulder.z + direction.z * ARM_L / 2);
    limb.quaternion.setFromUnitVectors(P.up, direction);
  }
  function placeProp(group, pose) {
    if (!group) return;
    const { dR, r, n } = pose, S = P.shR;
    group.position.set(S.x + dR.x * (ARM_L + 0.03), S.y + dR.y * (ARM_L + 0.03), S.z + dR.z * (ARM_L + 0.03));
    P.z.copy(n).addScaledVector(r, -n.dot(r));
    if (P.z.lengthSq() < 1e-6) P.z.set(0, 0, 1).addScaledVector(r, -r.z);
    P.z.normalize(); P.x.crossVectors(r, P.z); P.m.makeBasis(P.x, r, P.z); group.quaternion.setFromRotationMatrix(P.m);
  }
  function mixPose(A, B, u) {
    const mv = (a, b) => new THREE.Vector3().copy(a).lerp(b, u).normalize(), lerp = (a, b) => a + (b - a) * u;
    return { dR: mv(A.dR, B.dR), dL: mv(A.dL, B.dL), r: mv(A.r, B.r), n: mv(A.n, B.n), twist: lerp(A.twist, B.twist), lean: lerp(A.lean || 0, B.lean || 0), nod: lerp(A.nod || 0, B.nod || 0) };
  }
  const poses = {
    ready() { geo(); return P.ready; },
    cheer(t) { geo(); return { dR: nrm(0.35, 0.9, -0.25), dL: P.ready.dL, r: nrm(0.2, 1, -0.15), n: new THREE.Vector3(0, 0, -1), twist: 0.15 * Math.sin(t * 3), lean: 0, nod: 0 }; },
    celebrate(t) { return { dR: nrm(0.25, 1, -0.05), dL: nrm(-0.3, 0.95, -0.1), r: nrm(0.15, 1, 0.05), n: new THREE.Vector3(0, 0, -1), twist: 0.35 * Math.sin(t * 5), lean: 0, nod: -0.15 }; },
    sad() { return { dR: nrm(0.12, -1, 0.08), dL: nrm(-0.12, -1, 0.08), r: nrm(0.05, -0.95, 0.3), n: new THREE.Vector3(1, 0, 0), twist: 0, lean: 0.32, nod: 0.35 }; },
  };
  N.characters = { CHARS, PLAYER_COLORS, portrait, drawMonster2D, build3D, placeLimb, placeProp, mixPose, poses, HEAD_R, ARM_L, nrm,
    shoulders() { geo(); return { R: P.shR, L: P.shL }; },
  };
})();
