/* ============================================================
 * 놀자 공용 소리 — WebAudio로 즉석 합성 (소리 파일 없음)
 *   init()은 클릭·키 입력 같은 사용자 동작 안에서 한 번 불러야 소리가 남
 *   소리 줄기 3개: 효과음 sfx · 관중 crowd · 음악 music. 볼륨 0~1은 setVolume(줄기, 값) (게임끼리 공유 저장)
 *
 *  - 효과음: hit(세기, { spin, perfect, wrong, kind }) · bounce(속도 m/s) · net() · whoosh(세기) · toss() · squeak()
 *            point() · tick() · ready()
 *  - 관중:   ambience(켜기) 웅성거림 · applause(세기 0~1) 박수 · ooh() 감탄 · groan() 아쉬움 · cheer(초) 함성
 *            nature(종류) 카트 코스 주변 소리 'meadow' 새·산들바람 · 'beach' 파도·갈매기 · 'snow' 바람·풍경 · 'candy' 반짝반짝 (null이면 끔)
 *  - 음악:   music(켜기, 곡) 곡 'menu' 밝은 배경 음악 · 'race' 신나는 레이스 곡 · 코스 곡 'beach' 'snow' 'candy' (계속 반복) · tempo(배) 빠르기
 *            jingle(크게) 이겼을 때 짧은 축하
 *  - 카트:   engine(id, 속도 0~1.4, 부스트 0~1, 드리프트 0~1) 엔진·타이어 소리 (계속, engine(id, null)이면 끔) · enginesOff()
 *            countdown(숫자, 0이면 출발) · boost() · spark(단계) · itemBox() · roulette() · itemGet() · zap() · crash()
 *            plop() · splash() · bump(세기) · trick() · land() · finalLap()
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
    // ---------- 카트 코스 주변 소리 (관중 줄기로: 관중 소리 크기로 함께 조절) ----------
    // 계속 깔리는 소리는 잡음을 걸러서 만들고, 가끔 생기는 소리(파도·갈매기·바람·풍경·반짝·새)는 0.12초마다 예약
    nature(kind) {
      if (!this.ctx || (this.nat ? this.nat.kind : null) === (kind || null)) return;
      const c = this.ctx, t = c.currentTime;
      if (this.nat) {   // 지금 소리는 1초 동안 줄이고 끔
        const { out, nodes, timer } = this.nat; this.nat = null; clearInterval(timer);
        out.gain.cancelScheduledValues(t); out.gain.setValueAtTime(Math.max(0.0001, out.gain.value), t); out.gain.linearRampToValueAtTime(0.0001, t + 1);
        for (const n of nodes) n.stop(t + 1.05);
        setTimeout(() => out.disconnect(), 1300);
      }
      if (!kind) return;
      const out = c.createGain(); out.gain.setValueAtTime(0.0001, t); out.gain.linearRampToValueAtTime(1, t + 2); out.connect(this.bus.crowd);
      const nat = this.nat = { kind, out, nodes: [], next: t + rnd(0.5, 2), beds: [] };
      const bed = (freq, q, gain, type, sway = 0, swayDepth = 0, sweep = 0, sweepDepth = 0) => {   // 걸러 낸 잡음 + 크기·높이를 천천히 흔드는 LFO
        const src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
        src.buffer = this.buf; src.loop = true; src.playbackRate.value = rnd(0.8, 1);
        f.type = type; f.frequency.value = freq; f.Q.value = q; g.gain.value = gain;
        src.connect(f).connect(g).connect(out); src.start(t, Math.random()); nat.nodes.push(src);
        for (const [rate, depth, param] of [[sway, swayDepth, g.gain], [sweep, sweepDepth, f.frequency]]) {
          if (!rate) continue;
          const l = c.createOscillator(), d = c.createGain(); l.frequency.value = rate; d.gain.value = depth;
          l.connect(d).connect(param); l.start(t); nat.nodes.push(l);
        }
        nat.beds.push({ f, g, gain, freq });
      };
      if (kind === 'beach') bed(480, 0.7, 0.02, 'lowpass');                                        // 바다 바탕 (파도가 밀려올 때 커짐)
      else if (kind === 'snow') { bed(420, 1.4, 0.032, 'bandpass', 0.09, 0.02, 0.06, 220); bed(900, 2.2, 0.016, 'bandpass', 0.13, 0.011, 0.11, 380); }   // 바람 두 갈래 "휘이잉"
      else if (kind === 'meadow') bed(1100, 0.8, 0.012, 'bandpass', 0.11, 0.007);                    // 아주 약한 산들바람
      else if (kind === 'candy') bed(2400, 3, 0.004, 'bandpass', 0.2, 0.003);                       // 아주 약한 반짝이 바탕
      nat.timer = setInterval(() => this.naturePump(), 120);
    },
    naturePump() {
      const n = this.nat; if (!n || !this.live()) return;
      const t = this.ctx.currentTime, out = n.out;
      if (t < n.next) return;
      if (n.kind === 'beach') {   // 파도: 바다 바탕이 커지며 밝아졌다가 "쏴아" 부서지고 물러남. 가끔 갈매기
        const W = n.beds[0], up = rnd(2.2, 3.2), down = rnd(3, 4.5);
        W.g.gain.cancelScheduledValues(t); W.g.gain.setValueAtTime(W.gain, t); W.g.gain.linearRampToValueAtTime(rnd(0.045, 0.07), t + up); W.g.gain.exponentialRampToValueAtTime(W.gain, t + up + down);
        W.f.frequency.cancelScheduledValues(t); W.f.frequency.setValueAtTime(W.freq, t); W.f.frequency.linearRampToValueAtTime(1500, t + up); W.f.frequency.exponentialRampToValueAtTime(W.freq, t + up + down);
        this.noise(t + up - 0.15, 1.3, 2800, 0.6, 0.018, out, 'highpass');
        if (Math.random() < 0.4) this.gull(t + rnd(0.5, up + down), out);
        n.next = t + up + down + rnd(0.3, 1.8);
      } else if (n.kind === 'snow') {   // 바람이 "휘잉" 세졌다가 가라앉음. 가끔 처마 끝 풍경 "딸랑"
        for (const W of n.beds) { W.g.gain.setTargetAtTime(W.gain * rnd(1.8, 2.6), t, 1); W.g.gain.setTargetAtTime(W.gain, t + rnd(2.5, 4), 1.4); }
        if (Math.random() < 0.45) this.chimes(t + rnd(0.5, 3), out);
        n.next = t + rnd(7, 12);
      } else if (n.kind === 'candy') {   // 높은 반짝 소리 한두 개 (펜타토닉이라 아무렇게나 울려도 예쁨), 가끔 거품 "뽁"
        for (let i = 0, k = 1 + (Math.random() < 0.4); i < k; i++) { const f = mtof([88, 90, 93, 95, 97, 100][Math.floor(Math.random() * 6)]); this.tone(t + i * 0.12, f, f, 0.45, 0.02, 'sine', out, 0.002); }
        if (Math.random() < 0.25) this.tone(t + 0.3, 380, 950, 0.08, 0.028, 'sine', out);
        n.next = t + rnd(0.8, 2.2);
      } else if (n.kind === 'meadow') {   // 새가 "짹짹" 두세 번 (가끔 "삐요" 내려오는 소리)
        const f0 = rnd(2600, 3400), k = 2 + Math.floor(Math.random() * 3);
        for (let i = 0; i < k; i++) this.tone(t + i * rnd(0.09, 0.14), f0 * rnd(0.95, 1.05), f0 * 1.3, 0.06, 0.026, 'sine', out);
        if (Math.random() < 0.3) this.tone(t + 0.6, f0 * 1.2, f0 * 0.75, 0.22, 0.02, 'sine', out);
        n.next = t + rnd(2.5, 6);
      }
    },
    gull(t, out) {   // 갈매기 "꺄~ 꺄~": 올라갔다 내려오는 높은 소리 두세 번
      for (let i = 0, k = 2 + (Math.random() < 0.5); i < k; i++) {
        const t0 = t + i * rnd(0.32, 0.45), f = rnd(1300, 1600);
        this.tone(t0, f, f * 1.45, 0.1, 0.022, 'triangle', out, 0.01);
        this.tone(t0 + 0.1, f * 1.45, f * 0.9, 0.24, 0.02, 'triangle', out, 0.01);
      }
    },
    chimes(t, out) {   // 풍경: 높은 종 서너 개가 엇갈려 "딸랑" (눈 마을 곡과 같은 D장조 펜타토닉)
      const notes = [86, 88, 90, 93, 95];
      for (let i = 0, k = 3 + Math.floor(Math.random() * 2); i < k; i++) { const f = mtof(notes[Math.floor(Math.random() * notes.length)]); this.tone(t + i * rnd(0.08, 0.2), f, f, rnd(0.6, 1.1), 0.01, 'sine', out, 0.002); }
    },

    // ---------- 음악 ----------
    // menu: 밝은 4/4 · 112bpm · C-G-Am-F-C-G-F-G 8마디 반복. 마림바 멜로디 + 엇박 코드 + 베이스 + 가벼운 드럼
    // race: 148bpm · Am-F-C-G-Am-F-G-E. 8분음표로 달리는 베이스 + 쿵쿵 드럼 + 통통 튀는 리드
    music(on, song = 'menu') {
      if (!this.ctx) return;
      const c = this.ctx, t = c.currentTime;
      if (on && this.mus && this.mus.name !== song) this.music(false);   // 다른 곡이면 지금 곡은 줄이고 새로 시작
      if (on && !this.mus) {
        const out = c.createGain(); out.gain.setValueAtTime(0.0001, t); out.gain.linearRampToValueAtTime(0.38, t + 1.5); out.connect(this.bus.music);
        this.mus = { out, next: t + 0.1, step: 0, name: song, song: SONGS[song] || SONGS.menu, rate: 1 };
        this.timer = setInterval(() => this.pump(), 25);
      } else if (!on && this.mus) {
        const m = this.mus; this.mus = null; clearInterval(this.timer);
        m.out.gain.cancelScheduledValues(t); m.out.gain.setValueAtTime(m.out.gain.value, t); m.out.gain.linearRampToValueAtTime(0.0001, t + 0.8);
        setTimeout(() => m.out.disconnect(), 1000);
      }
    },
    tempo(rate) { if (this.mus) this.mus.rate = clamp(+rate || 1, 0.5, 2); },   // 마지막 바퀴처럼 곡을 빠르게
    pump() {   // 앞으로 0.15초 안에 울릴 16분음표들을 미리 예약 (타이머가 늦어도 박자는 정확)
      const m = this.mus; if (!m || !this.live()) return;
      const sixteenth = 60 / m.song.bpm / 4 / m.rate, len = m.song.chords.length * 16;
      if (m.next < this.ctx.currentTime - 0.05) m.next = this.ctx.currentTime + 0.05;   // 타이머가 오래 멈췄으면 밀린 음은 건너뜀
      while (m.next < this.ctx.currentTime + 0.15) { this.beat(m.step, m.next, m.out, m.song, m.rate); m.next += sixteenth; m.step = (m.step + 1) % len; }
    },
    beat(step, t, out, song = SONGS.menu, rate = 1) {
      const bar = step >> 4, s = step & 15, chord = song.chords[bar], q = 60 / song.bpm / rate;
      if (song.style === 'drive') {
        if (s % 2 === 0) this.tone(t, mtof(chord.bass - (s % 4 ? 0 : 12)), mtof(chord.bass - (s % 4 ? 0 : 12)), q * 0.42, 0.2, 'triangle', out, 0.006);   // 둥둥 달리는 베이스
        if (s % 4 === 2) for (const n of chord.keys) this.tone(t, mtof(n), mtof(n), 0.11, 0.04, 'square', out);                                            // 엇박 코드 "짠"
        if (s % 4 === 0) this.tone(t, 130, 45, 0.13, 0.24, 'sine', out);                                                                                  // 쿵쿵 킥
        if (s === 4 || s === 12) this.noise(t, 0.1, 1900, 0.8, 0.075, out);                                                                              // 스네어
        if (s % 2 === 1) this.noise(t, 0.02, 9000, 0.7, 0.02, out, 'highpass');                                                                         // 하이햇
      } else if (song.style === 'surf') {   // 바닷가: "둥 · 둥둥" 칼립소 베이스 · 우쿨렐레 엇박 · 림 "탁" · 셰이커
        if (s === 0 || s === 6 || s === 8 || s === 14) { const n = chord.bass - 12 + (s === 6 || s === 14 ? 7 : 0); this.tone(t, mtof(n), mtof(n), q * 0.45, 0.21, 'triangle', out, 0.006); }
        if (s % 4 === 2 || s === 7 || s === 15) for (const n of chord.keys) this.tone(t, mtof(n), mtof(n), 0.09, 0.038, 'triangle', out);
        if (s === 0 || s === 8) this.tone(t, 110, 50, 0.12, 0.17, 'sine', out);
        if (s === 4 || s === 12) this.noise(t, 0.04, 2600, 4, 0.07, out);
        this.noise(t, 0.035, 7600, 1, s % 2 ? 0.011 : 0.02, out, 'highpass');
      } else if (song.style === 'sleigh') {   // 눈 마을: "쿵(으뜸음)·짝(5도)" 베이스 · 마디마다 포근하게 깔리는 화음 · 썰매 방울 "찰랑"
        if (s % 4 === 0) { const n = chord.bass - 12 + (s % 8 ? 7 : 0); this.tone(t, mtof(n), mtof(n), q * 0.8, 0.2, 'triangle', out, 0.01); }
        if (s === 0) for (const n of chord.keys) this.tone(t, mtof(n), mtof(n), q * 3.6, 0.022, 'triangle', out, 0.08);
        if (s % 4 === 2) for (const n of chord.keys) this.tone(t, mtof(n + 12), mtof(n + 12), 0.1, 0.016, 'sine', out);
        if (s === 0 || s === 8) this.tone(t, 115, 50, 0.12, 0.15, 'sine', out);
        if (s === 4 || s === 12) this.noise(t, 0.08, 1900, 0.8, 0.045, out);
        if (s % 2 === 0) { this.noise(t, 0.09, 7200, 2.5, s % 4 ? 0.03 : 0.05, out); this.noise(t + 0.02, 0.07, 9200, 3, 0.022, out); }
      } else if (song.style === 'bubble') {   // 사탕 공원: 통통 튀는 옥타브 베이스 · 16분음표로 굴리는 반짝 화음 · 손뼉 "짝"
        if (s % 2 === 0) { const n = chord.bass - (s % 4 ? 0 : 12); this.tone(t, mtof(n), mtof(n), q * 0.35, 0.08, 'square', out, 0.004); this.tone(t, mtof(n), mtof(n), q * 0.4, 0.13, 'triangle', out, 0.004); }
        { const n = chord.keys[s % 3] + 12; this.tone(t, mtof(n), mtof(n), 0.07, 0.016, 'triangle', out); }
        if (s === 0 || s === 8) this.tone(t, 125, 48, 0.12, 0.2, 'sine', out);
        if (s === 4 || s === 12) { this.noise(t, 0.07, 1500, 1.1, 0.06, out); this.noise(t + 0.012, 0.06, 2300, 1.4, 0.035, out); }
        if (s % 2 === 1) this.noise(t, 0.018, 9500, 0.7, 0.012, out, 'highpass');
      } else {
        if (s % 4 === 0) this.tone(t, mtof(chord.bass - 12) * (s === 8 ? 1.5 : 1), mtof(chord.bass - 12), q * 0.9, 0.22, 'triangle', out, 0.01);
        if (s % 4 === 2) for (const n of chord.keys) this.tone(t, mtof(n), mtof(n), 0.16, 0.045, 'triangle', out);   // 엇박 코드 "짠"
        if (s === 0 || s === 8) this.tone(t, 120, 48, 0.12, 0.2, 'sine', out);                                         // 킥
        if (s === 4 || s === 12) this.noise(t, 0.09, 1800, 0.8, 0.06, out);                                           // 박수 같은 스네어
        if (s % 2 === 0) this.noise(t, 0.025, 8000, 0.7, s % 4 ? 0.018 : 0.03, out, 'highpass');                       // 하이햇
      }
      for (const [at, note, len] of song.melody[bar]) {
        if (at !== s) continue;
        const f = mtof(note);
        if (song.style === 'drive') {   // 리드: 살짝 거친 네모파 + 맑은 사인파
          this.tone(t, f, f, Math.min(0.45, len * q / 4 + 0.05), 0.045, 'square', out);
          this.tone(t, f, f, Math.min(0.45, len * q / 4 + 0.05), 0.07, 'sine', out);
        } else if (song.style === 'surf') {   // 스틸드럼: 맑은 사인 + 살짝 어긋난 배음이 빨리 사라짐
          const d = Math.min(0.5, len * q / 4 + 0.12);
          this.tone(t, f, f, d, 0.115, 'sine', out);
          this.tone(t, f * 2.02, f * 2.02, d * 0.5, 0.036, 'sine', out);
          this.tone(t, f * 3.01, f * 3.01, 0.06, 0.014, 'triangle', out);
        } else if (song.style === 'sleigh') {   // 글로켄슈필: 맑고 오래 울리는 종 + 종 특유의 어긋난 배음
          this.tone(t, f, f, 0.55, 0.075, 'sine', out, 0.002);
          this.tone(t, f * 2.76, f * 2.76, 0.18, 0.018, 'sine', out, 0.002);
        } else if (song.style === 'bubble') {   // 통통 튀는 네모파 + 세모파, 한 옥타브 위 반짝
          const d = Math.min(0.35, len * q / 4 + 0.04);
          this.tone(t, f, f, d, 0.035, 'square', out);
          this.tone(t, f, f, d, 0.05, 'triangle', out);
          this.tone(t, f * 2, f * 2, 0.06, 0.018, 'sine', out);
        } else {
          this.tone(t, mtof(note), mtof(note), Math.min(0.5, len * q / 4 + 0.08), 0.1, 'sine', out);                  // 마림바
          this.tone(t, mtof(note) * 4, mtof(note) * 4, 0.05, 0.02, 'sine', out);
        }
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

    // ---------- 카트 ----------
    // 엔진 "부릉": 톱니파 + 한 옥타브 아래 네모파를 저역 통과로 걸러 퉁퉁 떨게 함. 빠를수록 높고 밝게, 부스트면 더
    // 드리프트면 타이어 "끼익" (좁은 대역 잡음). 매 프레임 불러도 값은 0.06초마다만 바꿈
    engine(id, speed, boost = 0, drift = 0) {
      if (!this.ctx) return;
      const c = this.ctx, t = c.currentTime, eng = this.eng || (this.eng = {});
      let e = eng[id];
      if (speed == null || !Number.isFinite(speed) || !this.live()) {   // 끄기 (소리를 못 내는 동안에도 꺼 둠)
        if (e) {
          delete eng[id];
          e.out.gain.cancelScheduledValues(t); e.out.gain.setValueAtTime(Math.max(0.0001, e.out.gain.value), t); e.out.gain.linearRampToValueAtTime(0.0001, t + 0.2);
          for (const n of e.nodes) n.stop(t + 0.25);
        }
        return;
      }
      if (!e) {
        const out = c.createGain(); out.gain.value = 0.0001; out.connect(this.bus.sfx);
        const trem = c.createGain(); trem.gain.value = 0.7; trem.connect(out);
        const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 400; f.Q.value = 2; f.connect(trem);
        const o1 = c.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = 60; o1.connect(f);
        const o2 = c.createOscillator(), g2 = c.createGain(); o2.type = 'square'; o2.frequency.value = 30; g2.gain.value = 0.5; o2.connect(g2).connect(f);
        const lfo = c.createOscillator(), depth = c.createGain(); lfo.frequency.value = 18; depth.gain.value = 0.3; lfo.connect(depth).connect(trem.gain);
        const src = c.createBufferSource(), bp = c.createBiquadFilter(), sq = c.createGain();
        src.buffer = this.buf; src.loop = true; bp.type = 'bandpass'; bp.frequency.value = 2600; bp.Q.value = 5; sq.gain.value = 0.0001;
        src.connect(bp).connect(sq).connect(out);
        for (const n of [o1, o2, lfo]) n.start(t);
        src.start(t, Math.random() * 0.5);
        e = eng[id] = { out, f, o1, o2, lfo, sq, nodes: [o1, o2, lfo, src], at: -1 };
      }
      if (t - e.at < 0.06) return;
      e.at = t;
      const k = clamp(speed, 0, 1.4), b = clamp(boost, 0, 1), f0 = 52 + 88 * k + 30 * b;
      e.o1.frequency.setTargetAtTime(f0, t, 0.06); e.o2.frequency.setTargetAtTime(f0 / 2, t, 0.06);
      e.lfo.frequency.setTargetAtTime(14 + 26 * k, t, 0.1);
      e.f.frequency.setTargetAtTime(350 + 1500 * k + 900 * b, t, 0.08);
      e.out.gain.setTargetAtTime(0.045 + 0.04 * k + 0.03 * b, t, 0.1);
      e.sq.gain.setTargetAtTime(drift > 0 ? 0.035 + 0.035 * clamp(drift, 0, 1) : 0.0001, t, 0.05);
    },
    enginesOff() { for (const id of Object.keys(this.eng || {})) this.engine(id, null); },
    countdown(n) {   // 출발 신호: "삐 · 삐 · 삐 · 삐잉!"
      if (!this.live()) return;
      const t = this.ctx.currentTime;
      if (n > 0) { this.tone(t, 523, 523, 0.22, 0.17, 'square'); this.tone(t, 1046, 1046, 0.12, 0.05); }
      else { this.tone(t, 1046, 1046, 0.6, 0.17, 'square'); this.tone(t, 1568, 1568, 0.45, 0.07); }
    },
    boost() {   // 부스트 "슈웅": 잡음이 위로 쓸려 올라가고 음도 같이
      if (!this.live()) return;
      const t = this.ctx.currentTime, f = this.noise(t, 0.5, 500, 0.9, 0.18);
      f.frequency.exponentialRampToValueAtTime(3200, t + 0.45);
      this.tone(t, 220, 880, 0.4, 0.08, 'sawtooth');
    },
    spark(level = 1) {   // 드리프트 불꽃이 한 단계 커질 때 "띵"
      if (!this.live()) return;
      const t = this.ctx.currentTime, f = level > 1 ? 1760 : 1320;
      this.tone(t, f, f, 0.09, 0.06, 'square'); this.tone(t + 0.06, f * 1.5, f * 1.5, 0.12, 0.05);
    },
    itemBox() {   // 아이템 상자 깨질 때 반짝 "또로롱"
      if (!this.live()) return;
      const t = this.ctx.currentTime;
      [1047, 1319, 1568, 2093].forEach((f, i) => this.tone(t + i * 0.045, f, f, 0.12, 0.08, 'triangle'));
      this.noise(t, 0.15, 6000, 1, 0.05, null, 'highpass');
    },
    roulette() { if (!this.live()) return; const t = this.ctx.currentTime, f = rnd(1500, 2000); this.tone(t, f, f * 0.92, 0.04, 0.045, 'square'); },
    itemGet() { if (!this.live()) return; const t = this.ctx.currentTime; this.tone(t, 880, 880, 0.08, 0.11, 'triangle'); this.tone(t + 0.08, 1320, 1320, 0.16, 0.11, 'triangle'); },
    zap() {   // 번개 구슬 쏘기 "지잉"
      if (!this.live()) return;
      const t = this.ctx.currentTime;
      this.tone(t, 1800, 300, 0.35, 0.1, 'sawtooth'); this.noise(t, 0.25, 3000, 2, 0.1);
    },
    crash() {   // 맞아서 빙글빙글 "쿵 뺑그르르"
      if (!this.live()) return;
      const c = this.ctx, t = c.currentTime;
      this.tone(t, 160, 60, 0.25, 0.32); this.noise(t, 0.3, 600, 0.8, 0.28, null, 'lowpass');
      const o = this.tone(t + 0.05, 900, 300, 0.9, 0.06, 'triangle');
      const lfo = c.createOscillator(), depth = c.createGain();
      lfo.frequency.value = 9; depth.gain.value = 120; lfo.connect(depth).connect(o.frequency); lfo.start(t); lfo.stop(t + 1);
    },
    plop() { if (!this.live()) return; const t = this.ctx.currentTime; this.tone(t, 700, 180, 0.14, 0.16); },   // 함정 내려놓기 "퐁"
    splash() {   // 물방울 함정 밟기 "첨벙"
      if (!this.live()) return;
      const t = this.ctx.currentTime, f = this.noise(t, 0.4, 1400, 0.9, 0.22);
      f.frequency.exponentialRampToValueAtTime(400, t + 0.35);
      this.tone(t, 500, 150, 0.2, 0.1);
    },
    bump(p = 0.5) {   // 벽·카트에 부딪힘 "쿵"
      if (!this.live()) return;
      const t = this.ctx.currentTime, k = clamp(p, 0.1, 1);
      this.tone(t, 140, 55, 0.14, 0.08 + 0.25 * k); this.noise(t, 0.08, 700, 1, 0.04 + 0.15 * k);
    },
    trick() { if (!this.live()) return; const t = this.ctx.currentTime; this.tone(t, 660, 1320, 0.14, 0.09, 'square'); this.tone(t + 0.12, 1320, 1980, 0.16, 0.07, 'triangle'); },
    land() { if (!this.live()) return; const t = this.ctx.currentTime; this.tone(t, 110, 50, 0.12, 0.26); this.noise(t, 0.06, 500, 1, 0.1, null, 'lowpass'); },
    finalLap() {   // 마지막 바퀴 알림 "빰빰빰빰 빠밤!"
      if (!this.live()) return;
      const t = this.ctx.currentTime + 0.02, out = this.bus.music;
      [67, 72, 76, 79].forEach((n, i) => this.tone(t + i * 0.09, mtof(n), mtof(n), 0.2, 0.12, 'square', out));
      this.tone(t + 0.38, mtof(84), mtof(84), 0.6, 0.12, 'triangle', out);
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
  // 레이스 곡: Am-F-C-G-Am-F-G-E (마지막 E는 다시 처음으로 끌어당김)
  const RACE_CHORDS = [
    { bass: 45, keys: [57, 60, 64] }, { bass: 41, keys: [57, 60, 65] }, { bass: 48, keys: [55, 60, 64] }, { bass: 43, keys: [55, 59, 62] },
    { bass: 45, keys: [57, 60, 64] }, { bass: 41, keys: [57, 60, 65] }, { bass: 43, keys: [55, 59, 62] }, { bass: 40, keys: [56, 59, 64] },
  ];
  const RACE_MELODY = [
    [[0, 76, 2], [2, 74, 2], [4, 72, 2], [6, 76, 2], [8, 81, 4], [12, 79, 2], [14, 76, 2]],
    [[0, 77, 2], [2, 76, 2], [4, 74, 2], [6, 72, 2], [8, 74, 4], [12, 72, 2], [14, 69, 2]],
    [[0, 72, 2], [2, 76, 2], [4, 79, 4], [8, 84, 2], [10, 83, 2], [12, 79, 4]],
    [[0, 74, 2], [2, 79, 2], [4, 83, 4], [8, 81, 2], [10, 79, 2], [12, 74, 4]],
    [[0, 76, 2], [2, 74, 2], [4, 72, 2], [6, 76, 2], [8, 84, 4], [12, 83, 2], [14, 81, 2]],
    [[0, 81, 2], [2, 77, 2], [4, 72, 2], [6, 77, 2], [8, 81, 2], [10, 84, 2], [12, 81, 4]],
    [[0, 79, 2], [2, 83, 2], [4, 86, 4], [8, 83, 2], [10, 79, 2], [12, 74, 4]],
    [[0, 80, 4], [4, 76, 2], [6, 80, 2], [8, 83, 6], [14, 80, 2]],
  ];
  // 카트 코스 곡 (8마디 반복, 마지막 마디는 다시 처음으로 끌어당김)
  // 노을 바닷가: 132bpm · F-B♭-C-F-Dm-B♭-C-C7. 엇박으로 통통 튀는 스틸드럼
  const BEACH_CHORDS = [
    { bass: 41, keys: [65, 69, 72] }, { bass: 46, keys: [65, 70, 74] }, { bass: 48, keys: [64, 67, 72] }, { bass: 41, keys: [65, 69, 72] },
    { bass: 50, keys: [65, 69, 74] }, { bass: 46, keys: [65, 70, 74] }, { bass: 48, keys: [64, 67, 72] }, { bass: 48, keys: [64, 70, 72] },
  ];
  const BEACH_MELODY = [
    [[0, 81, 2], [3, 79, 1], [4, 77, 2], [6, 81, 2], [8, 84, 3], [11, 81, 1], [12, 79, 4]],
    [[0, 82, 2], [3, 81, 1], [4, 79, 2], [6, 77, 2], [8, 74, 4], [12, 77, 4]],
    [[0, 79, 2], [3, 77, 1], [4, 76, 2], [6, 79, 2], [8, 84, 3], [11, 82, 1], [12, 79, 4]],
    [[0, 81, 3], [3, 77, 1], [4, 72, 4], [8, 77, 2], [10, 81, 2], [12, 84, 4]],
    [[0, 86, 2], [3, 84, 1], [4, 81, 2], [6, 77, 2], [8, 81, 3], [11, 84, 1], [12, 86, 4]],
    [[0, 86, 2], [2, 84, 2], [4, 82, 2], [6, 81, 2], [8, 82, 4], [12, 77, 4]],
    [[0, 79, 2], [3, 81, 1], [4, 82, 2], [6, 84, 2], [8, 79, 3], [11, 76, 1], [12, 72, 4]],
    [[0, 76, 2], [2, 79, 2], [4, 82, 2], [6, 84, 2], [8, 88, 4], [12, 84, 2], [14, 82, 2]],
  ];
  // 눈꽃 마을: 144bpm · D-Bm-G-A-D-Bm-Em-A7. 썰매 방울과 글로켄슈필
  const SNOW_CHORDS = [
    { bass: 38, keys: [62, 66, 69] }, { bass: 47, keys: [62, 66, 71] }, { bass: 43, keys: [62, 67, 71] }, { bass: 45, keys: [61, 64, 69] },
    { bass: 38, keys: [62, 66, 69] }, { bass: 47, keys: [62, 66, 71] }, { bass: 40, keys: [62, 67, 71] }, { bass: 45, keys: [61, 67, 69] },
  ];
  const SNOW_MELODY = [
    [[0, 81, 2], [2, 78, 2], [4, 74, 2], [6, 78, 2], [8, 81, 4], [12, 86, 4]],
    [[0, 83, 2], [2, 81, 2], [4, 78, 2], [6, 81, 2], [8, 83, 6], [14, 81, 2]],
    [[0, 79, 2], [2, 83, 2], [4, 86, 4], [8, 83, 2], [10, 79, 2], [12, 74, 4]],
    [[0, 76, 2], [2, 78, 2], [4, 79, 2], [6, 81, 2], [8, 76, 4], [12, 73, 4]],
    [[0, 81, 2], [2, 78, 2], [4, 74, 2], [6, 78, 2], [8, 81, 2], [10, 86, 2], [12, 85, 2], [14, 83, 2]],
    [[0, 83, 4], [4, 81, 2], [6, 78, 2], [8, 74, 4], [12, 78, 4]],
    [[0, 79, 2], [2, 78, 2], [4, 76, 2], [6, 79, 2], [8, 83, 4], [12, 81, 4]],
    [[0, 79, 2], [2, 76, 2], [4, 73, 2], [6, 76, 2], [8, 79, 2], [10, 81, 2], [12, 85, 4]],
  ];
  // 하트 사탕 공원: 156bpm · A-F♯m-D-E-A-F♯m-D-E7. 통통 튀는 사탕 팝
  const CANDY_CHORDS = [
    { bass: 45, keys: [61, 64, 69] }, { bass: 42, keys: [61, 66, 69] }, { bass: 38, keys: [62, 66, 69] }, { bass: 40, keys: [59, 64, 68] },
    { bass: 45, keys: [61, 64, 69] }, { bass: 42, keys: [61, 66, 69] }, { bass: 38, keys: [62, 66, 69] }, { bass: 40, keys: [62, 64, 68] },
  ];
  const CANDY_MELODY = [
    [[0, 81, 1], [2, 85, 1], [4, 88, 2], [6, 85, 2], [8, 81, 2], [10, 83, 2], [12, 85, 4]],
    [[0, 85, 1], [2, 81, 1], [4, 78, 2], [6, 81, 2], [8, 85, 4], [12, 83, 2], [14, 81, 2]],
    [[0, 78, 2], [2, 81, 2], [4, 86, 2], [6, 85, 2], [8, 83, 2], [10, 81, 2], [12, 78, 4]],
    [[0, 80, 2], [2, 83, 2], [4, 88, 4], [8, 86, 2], [10, 83, 2], [12, 80, 4]],
    [[0, 81, 1], [2, 85, 1], [4, 88, 2], [6, 90, 2], [8, 88, 2], [10, 85, 2], [12, 81, 4]],
    [[0, 78, 2], [2, 81, 2], [4, 85, 2], [6, 81, 2], [8, 90, 4], [12, 88, 4]],
    [[0, 86, 2], [2, 85, 2], [4, 83, 2], [6, 81, 2], [8, 78, 2], [10, 81, 2], [12, 86, 4]],
    [[0, 88, 2], [2, 86, 2], [4, 83, 2], [6, 80, 2], [8, 83, 2], [10, 86, 2], [12, 88, 4]],
  ];
  const SONGS = {
    menu: { bpm: 112, style: 'pop', chords: CHORDS, melody: MELODY },
    race: { bpm: 148, style: 'drive', chords: RACE_CHORDS, melody: RACE_MELODY },
    beach: { bpm: 132, style: 'surf', chords: BEACH_CHORDS, melody: BEACH_MELODY },
    snow: { bpm: 144, style: 'sleigh', chords: SNOW_CHORDS, melody: SNOW_MELODY },
    candy: { bpm: 156, style: 'bubble', chords: CANDY_CHORDS, melody: CANDY_MELODY },
  };
  A.SONGS = SONGS;   // (테스트에서 곡 목록 확인용)

  // 다른 탭으로 가면 소리를 멈췄다가 돌아오면 다시
  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('visibilitychange', () => {
      if (!A.ctx) return;
      (document.hidden ? A.ctx.suspend() : A.ctx.resume()).catch(() => {});
    });
  }
})();
