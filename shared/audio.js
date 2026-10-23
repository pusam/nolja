/* ============================================================
 * 놀자 공용 소리 — WebAudio로 즉석 합성 (소리 파일 없음)
 *   init()은 클릭·키 입력 같은 사용자 동작 안에서 한 번 불러야 소리가 남
 *   소리 줄기 3개: 효과음 sfx · 관중 crowd · 음악 music. 볼륨 0~1은 setVolume(줄기, 값) (게임끼리 공유 저장)
 *
 *  - 효과음: hit(세기, { spin, perfect, wrong, kind }) · bounce(속도 m/s) · net() · whoosh(세기) · toss() · squeak()
 *            point() · tick() · ready()
 *  - 관중:   ambience(켜기) 웅성거림 · applause(세기 0~1) 박수 · ooh() 감탄 · groan() 아쉬움 · cheer(초) 함성
 *  - 음악:   music(켜기) 밝은 배경 음악 (계속 반복) · jingle(크게) 이겼을 때 짧은 축하
 * ============================================================ */
(function () {
  'use strict';
  const N = window.Nolja = window.Nolja || {};
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rnd = (a, b) => a + Math.random() * (b - a);
  const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
  const saved = N.store ? N.store.get('sound', null) : null;

  const A = N.audio = {
    ctx: null, buf: null, clapBuf: null, bus: null,
    vol: { music: 0.6, sfx: 0.85, crowd: 0.7 },
    init() {
      if (!this.ctx) {
        try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; }
        const c = this.ctx, n = c.sampleRate;
        const b = c.createBuffer(1, n, n), d = b.getChannelData(0);
        for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;   // 1초짜리 잡음
        this.buf = b;
        this.clapBuf = makeClaps(c);
        // 줄기 → 전체 → 컴프레서(갑자기 커지는 소리 눌러줌) → 스피커
        const comp = c.createDynamicsCompressor();
        comp.threshold.value = -14; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.25;
        const master = c.createGain(); master.gain.value = 0.9;
        master.connect(comp); comp.connect(c.destination);
        this.bus = {};
        for (const k of ['sfx', 'crowd', 'music']) { const g = c.createGain(); g.gain.value = this.vol[k]; g.connect(master); this.bus[k] = g; }
      }
      if (this.ctx.state === 'suspended' && !(typeof document !== 'undefined' && document.hidden)) this.ctx.resume().catch(() => {});
    },
    live() { return !!(this.ctx && this.ctx.state === 'running'); },
    setVolume(k, v) {
      this.vol[k] = clamp(+v || 0, 0, 1);
      if (this.bus) this.bus[k].gain.setTargetAtTime(this.vol[k], this.ctx.currentTime, 0.05);
      if (N.store) N.store.set('sound', this.vol);
    },

    // ---------- 기본 재료: 대역 잡음 · 음 (out = 보낼 줄기) ----------
    noise(t0, dur, freq, q, gain, out, type = 'bandpass') {
      const c = this.ctx, src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
      src.buffer = this.buf; f.type = type; f.frequency.value = freq; f.Q.value = q;
      g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t0 + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      src.connect(f).connect(g).connect(out || this.bus.sfx); src.start(t0, Math.random() * 0.5); src.stop(t0 + dur + 0.03);
      return f;
    },
    tone(t0, f0, f1, dur, gain, type = 'sine', out, attack = 0.004) {
      const c = this.ctx, o = c.createOscillator(), g = c.createGain();
      o.type = type; o.frequency.setValueAtTime(f0, t0); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
      g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t0 + attack); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g).connect(out || this.bus.sfx); o.start(t0); o.stop(t0 + dur + 0.03);
      return o;
    },

    // ---------- 효과음 ----------
    // 라켓에 맞는 소리: 줄이 튕기는 "퐁" + 공 울림 + 세기만큼 낮은 울림. 나이스면 맑게 "깡", 반대로 치면 둔하게 "퍽"
    // 탑스핀은 맞기 직전 줄이 공을 쓸어 올리는 "슥", 슬라이스는 깎는 "턱"
    hit(p = 0.5, o = {}) {
      if (!this.live()) return;
      const t = this.ctx.currentTime, k = clamp(p, 0, 1), big = o.kind === 'smash' || o.kind === 'serve' ? 1.2 : 1;
      const spin = o.spin || 0;
      if (spin > 0.3) this.noise(t, 0.05, 3800, 0.9, 0.05 * spin, null, 'highpass');
      else if (spin < -0.25) this.noise(t, 0.035, 900, 1.2, 0.07, null);
      if (o.wrong) {
        this.noise(t, 0.06, 700, 1.0, (0.3 + 0.2 * k) * big);
        this.tone(t, 300, 120, 0.09, 0.25 + 0.15 * k, 'triangle');
        return;
      }
      this.noise(t, 0.045, 1500 + 900 * k, 1.4, (0.32 + 0.35 * k) * big);
      this.tone(t, 620 + 220 * k, 260, 0.07, (0.22 + 0.2 * k) * big, 'triangle');
      this.tone(t, 160, 70, 0.08, (0.12 + 0.25 * k) * big);
      if (o.perfect) this.tone(t, 2400, 2300, 0.13, 0.11);
    },
    // 하드코트에 튀는 "톡" (빠를수록 크게)
    bounce(v = 8) {
      if (!this.live()) return;
      const t = this.ctx.currentTime, k = clamp(v / 20, 0.15, 1);
      this.tone(t, 190, 90, 0.06, 0.3 * k);
      this.noise(t, 0.03, 900, 1, 0.12 * k);
    },
    // 네트에 걸리는 "툭" + 그물이 떨리는 소리
    net() {
      if (!this.live()) return;
      const c = this.ctx, t = c.currentTime;
      this.noise(t, 0.12, 400, 0.8, 0.28, null, 'lowpass');
      const f = this.noise(t, 0.32, 2200, 4, 0.1);
      const lfo = c.createOscillator(), depth = c.createGain();
      lfo.frequency.value = 32; depth.gain.value = 900; lfo.connect(depth).connect(f.frequency);
      lfo.start(t); lfo.stop(t + 0.35);
    },
    whoosh(p = 0.5) {
      if (!this.live()) return;
      const t = this.ctx.currentTime, f = this.noise(t, 0.2, 600, 0.8, 0.07 + clamp(p, 0, 1) * 0.12);
      f.frequency.exponentialRampToValueAtTime(2600, t + 0.18);
    },
    toss() {   // 공을 위로 띄우는 짧은 "휙"
      if (!this.live()) return;
      const t = this.ctx.currentTime, f = this.noise(t, 0.18, 420, 0.9, 0.05);
      f.frequency.exponentialRampToValueAtTime(1300, t + 0.16);
    },
    squeak() {   // 운동화가 코트에 끌리는 "끽"
      if (!this.live()) return;
      const c = this.ctx, t = c.currentTime, f0 = rnd(1900, 2300);
      const o = this.tone(t, f0, f0 * rnd(1.15, 1.35), rnd(0.07, 0.11), 0.035, 'sine');
      const lfo = c.createOscillator(), depth = c.createGain();
      lfo.frequency.value = rnd(28, 40); depth.gain.value = 110; lfo.connect(depth).connect(o.frequency);
      lfo.start(t); lfo.stop(t + 0.13);
    },
    point() { if (!this.live()) return; const t = this.ctx.currentTime; this.tone(t, 660, 660, 0.12, 0.16, 'triangle'); this.tone(t + 0.12, 990, 990, 0.2, 0.16, 'triangle'); },
    tick() { if (!this.live()) return; const t = this.ctx.currentTime; this.tone(t, 900, 700, 0.07, 0.1, 'square'); },
    ready() { if (!this.live()) return; const t = this.ctx.currentTime; this.tone(t, 660, 660, 0.1, 0.16, 'triangle'); this.tone(t + 0.09, 1320, 1320, 0.18, 0.14, 'triangle'); },

    // ---------- 관중 ----------
    // 웅성거림: 잡음 세 갈래를 사람 목소리 높이로 거르고, 천천히(파도처럼) + 빠르게(말소리처럼) 크기를 흔듦
    ambience(on) {
      if (!this.ctx) return;
      const c = this.ctx, t = c.currentTime;
      if (on && !this.amb) {
        const out = c.createGain(); out.gain.setValueAtTime(0.0001, t); out.gain.linearRampToValueAtTime(0.05, t + 1.5); out.connect(this.bus.crowd);
        const nodes = [];
        for (const [freq, q, sway, chat] of [[380, 1.6, 0.13, 4.7], [720, 2.2, 0.21, 6.1], [1150, 2.8, 0.31, 7.9]]) {
          const src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
          src.buffer = this.buf; src.loop = true; src.playbackRate.value = rnd(0.9, 1.1);
          f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q; g.gain.value = 0.6;
          const l1 = c.createOscillator(), d1 = c.createGain(), l2 = c.createOscillator(), d2 = c.createGain();
          l1.frequency.value = sway; d1.gain.value = 0.25; l2.frequency.value = chat; d2.gain.value = 0.15;
          l1.connect(d1).connect(g.gain); l2.connect(d2).connect(g.gain);
          src.connect(f).connect(g).connect(out); src.start(t, Math.random()); l1.start(t); l2.start(t);
          nodes.push(src, l1, l2);
        }
        this.amb = { out, nodes };
      } else if (!on && this.amb) {
        const { out, nodes } = this.amb; this.amb = null;
        out.gain.cancelScheduledValues(t); out.gain.setValueAtTime(out.gain.value, t); out.gain.linearRampToValueAtTime(0.0001, t + 0.8);
        for (const n of nodes) n.stop(t + 0.85);
      }
    },
    // 박수: 미리 만든 박수 소리를 세기만큼 크고 길게
    applause(x = 0.5) {
      if (!this.live()) return;
      const c = this.ctx, t = c.currentTime, k = clamp(x, 0.1, 1), dur = 1.2 + 2.2 * k;
      const src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
      src.buffer = this.clapBuf; src.loop = true; src.playbackRate.value = 0.9 + 0.25 * k;
      f.type = 'bandpass'; f.frequency.value = 2100; f.Q.value = 0.6;
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.18 + 0.32 * k, t + 0.12); g.gain.setTargetAtTime(0.0001, t + dur * 0.45, dur * 0.22);
      src.connect(f).connect(g).connect(this.bus.crowd); src.start(t, Math.random() * 2); src.stop(t + dur + 0.6);
    },
    ooh() { this.chorus([450, 800], 1.08, 1.5); },   // "오~"
    groan() { this.chorus([720, 1100], 0.72, 1.2); }, // "아~" (내려가며 아쉬워함)
    // 여러 사람 목소리: 조금씩 다른 높이의 톱니파 여러 개를 모음(오·아) 높이로 거름. bend = 끝 음높이 비율
    chorus(formants, bend, dur) {
      if (!this.live()) return;
      const c = this.ctx, t = c.currentTime, g = c.createGain(), mix = c.createGain();
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.07, t + 0.25); g.gain.setTargetAtTime(0.0001, t + dur * 0.5, dur * 0.2);
      mix.gain.value = 0.5; g.connect(this.bus.crowd);
      for (const fq of formants) { const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = fq; f.Q.value = 5; mix.connect(f).connect(g); }
      for (let i = 0; i < 7; i++) {
        const o = c.createOscillator(), f0 = rnd(170, 320);
        o.type = 'sawtooth'; o.frequency.setValueAtTime(f0, t); o.frequency.linearRampToValueAtTime(f0 * (1 + (bend - 1) * 0.4), t + 0.3);
        o.frequency.linearRampToValueAtTime(f0 * bend, t + dur); o.connect(mix); o.start(t + rnd(0, 0.08)); o.stop(t + dur + 0.4);
      }
    },
    cheer(len = 1.4) {   // 관중 함성 + 박수
      if (!this.live()) return;
      const c = this.ctx, t = c.currentTime, src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
      src.buffer = this.buf; src.loop = true; f.type = 'lowpass'; f.frequency.value = 1300;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.14, t + 0.25); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
      src.connect(f).connect(g).connect(this.bus.crowd); src.start(t); src.stop(t + len + 0.05);
      this.applause(clamp(len / 2.2, 0.4, 1));
    },

    // ---------- 음악 ----------
    // 밝은 4/4 · 112bpm · C-G-Am-F-C-G-F-G 8마디 반복. 마림바 멜로디 + 엇박 코드 + 베이스 + 가벼운 드럼
    music(on) {
      if (!this.ctx) return;
      const c = this.ctx, t = c.currentTime;
      if (on && !this.mus) {
        const out = c.createGain(); out.gain.setValueAtTime(0.0001, t); out.gain.linearRampToValueAtTime(0.38, t + 1.5); out.connect(this.bus.music);
        this.mus = { out, next: t + 0.1, step: 0 };
        this.timer = setInterval(() => this.pump(), 25);
      } else if (!on && this.mus) {
        const m = this.mus; this.mus = null; clearInterval(this.timer);
        m.out.gain.cancelScheduledValues(t); m.out.gain.setValueAtTime(m.out.gain.value, t); m.out.gain.linearRampToValueAtTime(0.0001, t + 0.8);
        setTimeout(() => m.out.disconnect(), 1000);
      }
    },
    pump() {   // 앞으로 0.15초 안에 울릴 16분음표들을 미리 예약 (타이머가 늦어도 박자는 정확)
      const m = this.mus; if (!m || !this.live()) return;
      const sixteenth = 60 / 112 / 4;
      if (m.next < this.ctx.currentTime - 0.05) m.next = this.ctx.currentTime + 0.05;   // 타이머가 오래 멈췄으면 밀린 음은 건너뜀
      while (m.next < this.ctx.currentTime + 0.15) { this.beat(m.step, m.next, m.out); m.next += sixteenth; m.step = (m.step + 1) % 128; }
    },
    beat(step, t, out) {
      const bar = step >> 4, s = step & 15, chord = CHORDS[bar], q = 60 / 112;
      if (s % 4 === 0) this.tone(t, mtof(chord.bass - 12) * (s === 8 ? 1.5 : 1), mtof(chord.bass - 12), q * 0.9, 0.22, 'triangle', out, 0.01);
      if (s % 4 === 2) for (const n of chord.keys) this.tone(t, mtof(n), mtof(n), 0.16, 0.045, 'triangle', out);   // 엇박 코드 "짠"
      if (s === 0 || s === 8) this.tone(t, 120, 48, 0.12, 0.2, 'sine', out);                                         // 킥
      if (s === 4 || s === 12) this.noise(t, 0.09, 1800, 0.8, 0.06, out);                                           // 박수 같은 스네어
      if (s % 2 === 0) this.noise(t, 0.025, 8000, 0.7, s % 4 ? 0.018 : 0.03, out, 'highpass');                       // 하이햇
      for (const [at, note, len] of MELODY[bar]) {
        if (at !== s) continue;
        this.tone(t, mtof(note), mtof(note), Math.min(0.5, len * q / 4 + 0.08), 0.1, 'sine', out);                  // 마림바
        this.tone(t, mtof(note) * 4, mtof(note) * 4, 0.05, 0.02, 'sine', out);
      }
    },
    jingle(big = false) {   // 도-미-솔-도 + 화음, 크게면 한 번 더 올라감
      if (!this.live()) return;
      const t = this.ctx.currentTime + 0.05, out = this.bus.music, notes = big ? [72, 76, 79, 84, 88, 91] : [72, 76, 79, 84];
      notes.forEach((n, i) => { this.tone(t + i * 0.11, mtof(n), mtof(n), 0.3, 0.16, 'triangle', out); this.tone(t + i * 0.11, mtof(n) * 2, mtof(n) * 2, 0.12, 0.04, 'sine', out); });
      const end = t + notes.length * 0.11;
      for (const n of [72, 76, 79, 84]) this.tone(end, mtof(n), mtof(n), big ? 1.6 : 0.9, 0.08, 'triangle', out, 0.02);
      this.tone(end, 110, 45, 0.2, 0.25, 'sine', out);
    },
  };
  if (saved && typeof saved === 'object') for (const k of ['music', 'sfx', 'crowd']) if (Number.isFinite(saved[k])) A.vol[k] = clamp(saved[k], 0, 1);

  // 박수 3초: 짧게 탁 치고 빨리 사라지는 잡음을 여기저기 흩뿌림
  function makeClaps(c) {
    const n = Math.floor(c.sampleRate * 3), b = c.createBuffer(1, n, c.sampleRate), d = b.getChannelData(0);
    const claps = 150, len = Math.floor(c.sampleRate * 0.03);
    for (let k = 0; k < claps; k++) {
      const at = Math.floor(Math.random() * (n - len)), amp = rnd(0.3, 1), decay = rnd(0.004, 0.009) * c.sampleRate;
      let lp = 0;
      for (let i = 0; i < len; i++) { lp += (Math.random() * 2 - 1 - lp) * 0.6; d[at + i] += lp * amp * Math.exp(-i / decay); }
    }
    let peak = 0; for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(d[i]));
    if (peak > 0) for (let i = 0; i < n; i++) d[i] /= peak;
    return b;
  }

  // 음악 악보: 마디별 코드(베이스·건반)와 멜로디 [16분음표 위치, 음, 길이(16분음표)]
  const CHORDS = [
    { bass: 48, keys: [60, 64, 67] }, { bass: 43, keys: [59, 62, 67] }, { bass: 45, keys: [57, 60, 64] }, { bass: 41, keys: [57, 60, 65] },
    { bass: 48, keys: [60, 64, 67] }, { bass: 43, keys: [59, 62, 67] }, { bass: 41, keys: [57, 60, 65] }, { bass: 43, keys: [59, 62, 67] },
  ];
  const MELODY = [
    [[0, 76, 2], [2, 79, 2], [4, 84, 4], [8, 79, 2], [10, 76, 2], [12, 79, 4]],
    [[0, 74, 2], [2, 79, 2], [4, 83, 4], [8, 81, 2], [10, 79, 2], [12, 74, 4]],
    [[0, 72, 2], [2, 76, 2], [4, 81, 4], [8, 79, 2], [10, 76, 2], [12, 72, 4]],
    [[0, 77, 2], [2, 81, 2], [4, 84, 3], [7, 81, 1], [8, 79, 4], [12, 77, 2], [14, 76, 2]],
    [[0, 76, 2], [2, 79, 2], [4, 84, 4], [8, 86, 2], [10, 84, 2], [12, 79, 4]],
    [[0, 83, 2], [2, 81, 2], [4, 79, 4], [8, 74, 2], [10, 79, 2], [12, 83, 4]],
    [[0, 81, 2], [2, 79, 2], [4, 77, 2], [6, 81, 2], [8, 84, 4], [12, 81, 4]],
    [[0, 79, 2], [2, 77, 2], [4, 76, 2], [6, 74, 2], [8, 79, 8]],
  ];

  // 다른 탭으로 가면 소리를 멈췄다가 돌아오면 다시
  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('visibilitychange', () => {
      if (!A.ctx) return;
      (document.hidden ? A.ctx.suspend() : A.ctx.resume()).catch(() => {});
    });
  }
})();
