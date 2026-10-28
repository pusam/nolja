/* ============================================================
 * 놀자 공용 소리 — WebAudio로 즉석 합성 (소리 파일 없음)
 *   init()은 클릭·키 입력 같은 사용자 동작 안에서 한 번 불러야 소리가 남
 *   소리 줄기 3개: 효과음 sfx · 관중 crowd · 음악 music. 볼륨 0~1은 setVolume(줄기, 값) (게임끼리 공유 저장)
 *
 *  - 효과음: hit(세기, { spin, perfect, wrong, kind }) · bounce(속도 m/s) · net() · whoosh(세기) · toss() · squeak()
 *            point() · tick() · ready()
 *  - 관중:   ambience(켜기) 웅성거림 · applause(세기 0~1) 박수 · ooh() 감탄 · groan() 아쉬움 · cheer(초) 함성
 *            nature(종류) 카트 코스 주변 소리 'meadow' 새·산들바람 · 'beach' 파도·갈매기 · 'snow' 바람·풍경 · 'candy' 반짝반짝 · 'lava' 용암 부글부글·우르릉 · 'canyon' 협곡 바람·매·곡괭이 · 'city' 도시 차 소리·경적 (null이면 끔)
 *  - 음악:   music(켜기, 곡) 곡 'menu' 밝은 배경 음악 · 'race' 신나는 레이스 곡 · 코스 곡 'beach' 'snow' 'candy' 'lava' 'forest' 'coast' 'coaster' 'canyon' 'city' 'aurora' 'jungle' (계속 반복) · tempo(배) 빠르기
 *            jingle(크게) 이겼을 때 짧은 축하
 *  - 카트:   engine(id, 속도 0~1.4, 부스트 0~1, 드리프트 0~1) 엔진·타이어 소리 (계속, engine(id, null)이면 끔) · enginesOff()
 *            countdown(숫자, 0이면 출발) · boost() · spark(단계) · itemBox() · roulette() · itemGet() · zap() · crash()
 *            plop() · splash() · sand() · fire() · bump(세기) · trick() · land() · finalLap()
 *            아이템: shield() 보호막 · pop() 보호막 터짐 · magnet() 자석 · thunder() 천둥 · boing() 통통 공 · splat() 물감
 *                    rocket() 로켓 · whirl() 회오리 · freeze() 꽁꽁 · boom() 꽝 · throw() 휙 · spring() 스프링
 *                    horn() 나팔 · ufo() UFO · ghost() 유령 · steal() 훔침 · plane() 비행기 · boomerang() 부메랑 · cloud() 먹구름
 *                    shrink() 작아짐 · squash() 납작 · wood() 바리케이드 · powWarn() 쿵 블록 경고 · thud() 쿵 · bubble() 물방울
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
      else if (kind === 'lava') { bed(140, 0.9, 0.05, 'lowpass', 0.07, 0.02); bed(700, 1.2, 0.006, 'bandpass', 0.3, 0.004); }   // 낮게 우르릉 + 지글지글
      else if (kind === 'canyon') { bed(320, 1.1, 0.026, 'bandpass', 0.07, 0.014, 0.05, 140); bed(1300, 3, 0.006, 'bandpass', 0.17, 0.004, 0.09, 500); }   // 협곡을 지나는 마른 바람
      else if (kind === 'city') { bed(180, 0.8, 0.03, 'lowpass', 0.05, 0.008); bed(900, 1.5, 0.004, 'bandpass', 0.11, 0.002); }   // 멀리 웅웅 도시 차 소리
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
      } else if (n.kind === 'lava') {   // 용암이 "보글·뽀글" 터지고 "타닥" 불티. 가끔 멀리서 화산 "우르릉"
        for (let i = 0, k = 1 + Math.floor(Math.random() * 3); i < k; i++) { const f = rnd(90, 170), t0 = t + i * rnd(0.1, 0.25); this.tone(t0, f, f * rnd(1.8, 2.6), 0.09, 0.05, 'sine', out); }
        for (let i = 0; i < 3; i++) if (Math.random() < 0.5) this.noise(t + rnd(0, 0.8), 0.02, rnd(3000, 5000), 2, 0.016, out, 'highpass');
        if (Math.random() < 0.12) this.noise(t + 0.4, 2.4, 90, 0.7, 0.12, out, 'lowpass');
        n.next = t + rnd(0.7, 1.8);
      } else if (n.kind === 'city') {   // 차가 "쉬익" 지나가고, 가끔 멀리 경적 "빵빵" · 비둘기 "구구"
        { const f = this.noise(t + rnd(0, 1), 1.4, 500, 0.8, 0.03, out); f.frequency.exponentialRampToValueAtTime(1800, t + 1.4); }
        if (Math.random() < 0.3) { const t0 = t + rnd(0.5, 2); for (const [dt, f] of [[0, 415], [0.22, 415]]) { this.tone(t0 + dt, f, f, 0.16, 0.012, 'square', out, 0.01); this.tone(t0 + dt, f * 1.26, f * 1.26, 0.16, 0.01, 'square', out, 0.01); } }
        if (Math.random() < 0.2) for (let i = 0; i < 3; i++) this.tone(t + 1.5 + i * 0.35, 520, 430, 0.18, 0.008, 'sine', out, 0.03);
        n.next = t + rnd(3, 6);
      } else if (n.kind === 'canyon') {   // 바람이 세졌다 잦아들고, 가끔 높이 나는 매 "삐이~" · 멀리 광산 곡괭이 "땡 땡"
        for (const W of n.beds) { W.g.gain.setTargetAtTime(W.gain * rnd(1.6, 2.4), t, 1.2); W.g.gain.setTargetAtTime(W.gain, t + rnd(2.5, 4), 1.5); }
        if (Math.random() < 0.35) { const f = rnd(2300, 2700); this.tone(t + rnd(0.3, 2), f, f * 0.62, 0.7, 0.02, 'sine', out, 0.05); }
        if (Math.random() < 0.4) for (let i = 0, k = 2 + Math.floor(Math.random() * 2); i < k; i++) { const t0 = t + 1 + i * rnd(0.5, 0.7); this.tone(t0, 2900, 2600, 0.12, 0.012, 'triangle', out, 0.002); this.noise(t0, 0.03, 5000, 3, 0.01, out); }
        n.next = t + rnd(6, 10);
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
      } else if (song.style === 'castle') {   // 용암 성: "둥둥둥" 말 달리는 베이스(셋잇단 느낌) · 마디 첫 박 묵직한 오르간 화음 · 큰북 "둥" · 심벌
        if (s % 4 !== 3) { const n = chord.bass - (s % 4 ? 0 : 12); this.tone(t, mtof(n), mtof(n), q * 0.22, 0.17, 'sawtooth', out, 0.004); }
        if (s === 0 || s === 8) for (const n of chord.keys) { this.tone(t, mtof(n), mtof(n), q * 1.8, 0.026, 'sawtooth', out, 0.03); this.tone(t, mtof(n - 12), mtof(n - 12), q * 1.8, 0.03, 'triangle', out, 0.03); }
        if (s % 4 === 0) this.tone(t, 100, 40, 0.18, 0.26, 'sine', out);
        if (s === 4 || s === 12) this.noise(t, 0.12, 1500, 0.7, 0.07, out);
        if (s === 0 && bar % 4 === 0) this.noise(t, 0.9, 6000, 0.5, 0.03, out, 'highpass');
        if (s % 2 === 1) this.noise(t, 0.02, 8500, 0.7, 0.012, out, 'highpass');
      } else if (song.style === 'folk') {   // 구름다리 숲: "둥(으뜸음)·둥(5도)" 컨트리 베이스 · 2·4박 "착" 기타 · 8분음표로 굴리는 밴조 · 나무 블록 "톡"
        if (s % 8 === 0) { const n = chord.bass - 12 + (s ? 7 : 0); this.tone(t, mtof(n), mtof(n), q * 0.55, 0.21, 'triangle', out, 0.006); }
        if (s % 8 === 4) for (const n of chord.keys) this.tone(t, mtof(n), mtof(n), 0.13, 0.036, 'triangle', out, 0.003);
        if (s % 2 === 0) { const n = chord.keys[(s >> 1) % 3] + 12; this.tone(t, mtof(n), mtof(n), 0.09, 0.016, 'triangle', out, 0.002); }
        if (s === 0 || s === 8) this.tone(t, 105, 48, 0.1, 0.16, 'sine', out);
        if (s % 4 === 2) this.noise(t, 0.035, 2400, 7, 0.06, out);
      } else if (song.style === 'wave') {   // 소라 해안: 8분음표로 달리는 서프 록 베이스 · 엇박 기타 "착" · 스프링이 울리는 스네어 · 하이햇
        if (s % 2 === 0) { const n = chord.bass - (s % 4 ? 0 : 12); this.tone(t, mtof(n), mtof(n), q * 0.4, 0.19, 'triangle', out, 0.005); }
        if (s % 4 === 2) for (const n of chord.keys) this.tone(t, mtof(n), mtof(n) * 0.995, 0.1, 0.03, 'sawtooth', out);
        if (s === 0 || s === 8 || s === 10) this.tone(t, 120, 46, 0.12, 0.2, 'sine', out);
        if (s === 4 || s === 12) { this.noise(t, 0.09, 1800, 0.8, 0.07, out); this.noise(t + 0.03, 0.35, 2600, 3, 0.015, out); }
        if (s % 2 === 1) this.noise(t, 0.02, 8800, 0.7, 0.014, out, 'highpass');
      } else if (song.style === 'funk') {   // 빌딩 고가도로: 튕기는 슬랩 베이스(옥타브 "팝") · 엇박 클라비 "칙" · 16분음표 하이햇 · 묵직한 킥과 스네어
        if ([0, 3, 6, 8, 10, 11, 14].includes(s)) { const pop = s === 6 || s === 14, n = chord.bass - (pop ? 0 : 12); this.tone(t, mtof(n), mtof(n) * (pop ? 1 : 0.99), q * (pop ? 0.18 : 0.3), pop ? 0.13 : 0.2, pop ? 'square' : 'triangle', out, 0.003); }
        if (s % 4 === 2) for (const k of chord.keys) this.tone(t, mtof(k), mtof(k), 0.07, 0.024, 'square', out, 0.002);
        if (s === 0 || s === 7 || s === 8) this.tone(t, 120, 44, 0.13, 0.22, 'sine', out);
        if (s === 4 || s === 12) { this.noise(t, 0.11, 1700, 0.9, 0.075, out); this.noise(t, 0.05, 6000, 1, 0.02, out, 'highpass'); }
        this.noise(t, 0.02, 9500, 0.8, s % 2 ? 0.01 : 0.017, out, 'highpass');
      } else if (song.style === 'western') {   // 모래 협곡: "둥·다·둥" 말 달리는 베이스 · 엇박 기타 "착" · 말발굽 "딱 딱" 나무 블록
        if (s % 4 === 0 || s % 4 === 3) { const n = chord.bass - (s % 4 ? 0 : 12); this.tone(t, mtof(n), mtof(n), q * 0.3, 0.2, 'triangle', out, 0.004); }
        if (s % 4 === 2) { const n = chord.bass + 7 - 12; this.tone(t, mtof(n), mtof(n), q * 0.25, 0.15, 'triangle', out, 0.004); for (const k of chord.keys) this.tone(t, mtof(k), mtof(k) * 0.99, 0.11, 0.028, 'sawtooth', out); }
        if (s === 0 || s === 8) this.tone(t, 110, 46, 0.12, 0.18, 'sine', out);
        if (s % 2 === 0) this.noise(t, 0.03, s % 4 ? 1300 : 2100, 8, 0.055, out);
        if (s === 12 && bar % 2) this.noise(t, 0.18, 3800, 1.2, 0.03, out, 'highpass');
      } else if (song.style === 'carnival') {   // 사탕 롤러코스터: "쿵(으뜸음)·짝(5도)" 움파 베이스 · 엇박 오르간 화음 · 네 마디마다 심벌
        if (s % 4 === 0) { const n = chord.bass - 12 + (s % 8 ? 7 : 0); this.tone(t, mtof(n), mtof(n), q * 0.5, 0.21, 'triangle', out, 0.006); }
        if (s % 4 === 2) for (const n of chord.keys) { this.tone(t, mtof(n), mtof(n), 0.1, 0.028, 'square', out); this.tone(t, mtof(n), mtof(n), 0.12, 0.03, 'triangle', out); }
        if (s === 0 || s === 8) this.tone(t, 118, 48, 0.12, 0.18, 'sine', out);
        if (s === 4 || s === 12) this.noise(t, 0.07, 2000, 1, 0.05, out);
        if (s === 0 && bar % 4 === 0) this.noise(t, 0.7, 7000, 0.6, 0.028, out, 'highpass');
        if (s % 2 === 1) this.noise(t, 0.018, 9000, 0.7, 0.011, out, 'highpass');
      } else if (song.style === 'aurora') {   // 오로라 얼음 궁전: 마디 처음 천천히 피어오르는 화음 · 16분음표로 반짝이는 종 아르페지오 · 둥실 베이스 · 부드러운 킥 · 셰이커
        if (s === 0) for (const n of chord.keys) this.tone(t, mtof(n), mtof(n), q * 3.8, 0.02, 'sine', out, 0.25);
        if (s === 0 || s === 6 || s === 8 || s === 14) { const n = chord.bass - 12; this.tone(t, mtof(n), mtof(n), q * 0.7, 0.18, 'triangle', out, 0.01); }
        { const n = chord.keys[[0, 1, 2, 1][s % 4]] + 12 + (s >= 8 ? 12 : 0); this.tone(t, mtof(n), mtof(n), 0.16, 0.013, 'sine', out, 0.002); }   // 마디 뒤 절반은 한 옥타브 위
        if (s === 0 || s === 8) this.tone(t, 110, 46, 0.14, 0.17, 'sine', out);
        if (s === 4 || s === 12) this.noise(t, 0.12, 2600, 0.9, 0.04, out);
        if (s % 2 === 1) this.noise(t, 0.03, 9000, 1, 0.012, out, 'highpass');
      } else if (song.style === 'jungle') {   // 정글 유적: "둥 · 둥둥" 베이스 · 낮은·중간 탐탐 · 손뼉 · 엇박 마림바 화음 · 봉고 "톡" · 셰이커
        if (s === 0 || s === 3 || s === 6 || s === 10) { const n = chord.bass - 12; this.tone(t, mtof(n), mtof(n), q * 0.4, 0.2, 'triangle', out, 0.004); }
        if (s === 0 || s === 6 || s === 8) this.tone(t, 140, 70, 0.16, 0.2, 'sine', out);
        if (s === 11 || s === 14) this.tone(t, 200, 120, 0.12, 0.13, 'sine', out);
        if (s === 4 || s === 12) this.noise(t, 0.06, 2200, 2, 0.05, out);
        if (s % 4 === 2) for (const n of chord.keys) { this.tone(t, mtof(n), mtof(n), 0.09, 0.03, 'sine', out); this.tone(t, mtof(n) * 4, mtof(n) * 4, 0.03, 0.006, 'sine', out); }
        if (s % 2 === 1) this.tone(t, 620, 420, 0.04, 0.03, 'sine', out);
        this.noise(t, 0.03, 7000, 1, s % 2 ? 0.01 : 0.017, out, 'highpass');
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
        } else if (song.style === 'castle') {   // 금관처럼: 톱니파 + 한 옥타브 아래 세모파로 굵게
          const d = Math.min(0.5, len * q / 4 + 0.06);
          this.tone(t, f, f, d, 0.04, 'sawtooth', out, 0.012);
          this.tone(t, f / 2, f / 2, d, 0.05, 'triangle', out, 0.012);
          this.tone(t, f, f, d, 0.05, 'sine', out, 0.012);
        } else if (song.style === 'bubble') {   // 통통 튀는 네모파 + 세모파, 한 옥타브 위 반짝
          const d = Math.min(0.35, len * q / 4 + 0.04);
          this.tone(t, f, f, d, 0.035, 'square', out);
          this.tone(t, f, f, d, 0.05, 'triangle', out);
          this.tone(t, f * 2, f * 2, 0.06, 0.018, 'sine', out);
        } else if (song.style === 'folk') {   // 피리: 살짝 아래에서 미끄러져 올라오는 맑은 사인 + 숨소리 같은 세모파
          const d = Math.min(0.5, len * q / 4 + 0.08);
          this.tone(t, f * 0.97, f, d, 0.09, 'sine', out, 0.02);
          this.tone(t, f * 2, f * 2, d * 0.6, 0.012, 'triangle', out, 0.02);
        } else if (song.style === 'wave') {   // 서프 기타: 16분음표마다 다시 튕기는 트레몰로 (톱니파 + 세모파)
          for (let r = 0; r < len; r++) { const tr = t + r * q / 4; this.tone(tr, f * 1.006, f, 0.09, r ? 0.026 : 0.034, 'sawtooth', out, 0.003); this.tone(tr, f, f, 0.1, r ? 0.04 : 0.05, 'triangle', out, 0.003); }
        } else if (song.style === 'funk') {   // 신스 브라스: 살짝 어긋난 톱니파 둘 + 네모파
          const d = Math.min(0.4, len * q / 4 + 0.05);
          this.tone(t, f, f, d, 0.028, 'sawtooth', out, 0.006);
          this.tone(t, f * 1.004, f * 1.004, d, 0.024, 'sawtooth', out, 0.006);
          this.tone(t, f, f, d * 0.8, 0.03, 'square', out, 0.004);
        } else if (song.style === 'western') {   // 서부 기타: 살짝 아래에서 끌어올리는 톱니파 "띠잉" + 세모파
          const d = Math.min(0.45, len * q / 4 + 0.06);
          this.tone(t, f * 0.95, f, d, 0.034, 'sawtooth', out, 0.004);
          this.tone(t, f, f, d, 0.06, 'triangle', out, 0.004);
        } else if (song.style === 'carnival') {   // 서커스 오르간: 네모파 + 사인 + 한 옥타브 위 사인
          const d = Math.min(0.4, len * q / 4 + 0.05);
          this.tone(t, f, f, d, 0.03, 'square', out);
          this.tone(t, f, f, d, 0.06, 'sine', out);
          this.tone(t, f * 2, f * 2, d * 0.8, 0.022, 'sine', out);
        } else if (song.style === 'aurora') {   // 첼레스타: 맑은 사인 + 한 옥타브 위 + 두 옥타브 위 반짝이 (오래 울림)
          const d = Math.min(0.6, len * q / 4 + 0.2);
          this.tone(t, f, f, d, 0.08, 'sine', out, 0.004);
          this.tone(t, f * 2, f * 2, d * 0.6, 0.02, 'sine', out, 0.004);
          this.tone(t, f * 4.01, f * 4.01, 0.12, 0.01, 'sine', out, 0.002);
        } else if (song.style === 'jungle') {   // 팬플루트: 살짝 아래에서 불어 올라가는 사인 + 숨소리 + 한 옥타브 위 톡
          const d = Math.min(0.5, len * q / 4 + 0.08);
          this.tone(t, f * 0.985, f, d, 0.08, 'sine', out, 0.03);
          this.noise(t, Math.min(0.2, d), Math.min(9000, f * 2), 2, 0.008, out);
          this.tone(t, f * 2, f * 2, 0.05, 0.015, 'sine', out);
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
    fire() {   // 용암·불기둥에 닿음 "화르륵": 잡음이 확 일었다 꺼지고 아래에서 "훅"
      if (!this.live()) return;
      const t = this.ctx.currentTime;
      this.noise(t, 0.5, 900, 0.6, 0.2, null, 'lowpass'); this.noise(t + 0.02, 0.35, 2600, 1.2, 0.07);
      this.tone(t, 180, 70, 0.3, 0.16, 'sine');
    },
    splash() {   // 물방울 함정 밟기 "첨벙"
      if (!this.live()) return;
      const t = this.ctx.currentTime, f = this.noise(t, 0.4, 1400, 0.9, 0.22);
      f.frequency.exponentialRampToValueAtTime(400, t + 0.35);
      this.tone(t, 500, 150, 0.2, 0.1);
    },
    sand() {   // 모래늪에 빠짐 "푸석": 마른 잡음이 아래로 + 낮게 "퍽"
      if (!this.live()) return;
      const t = this.ctx.currentTime, f = this.noise(t, 0.32, 2200, 0.7, 0.16, null, 'lowpass');
      f.frequency.exponentialRampToValueAtTime(500, t + 0.3);
      this.tone(t, 160, 80, 0.12, 0.12);
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
    shield() {   // 방울 보호막 "뾰로롱": 위로 올라가는 맑은 소리 두 겹 + 반짝
      if (!this.live()) return;
      const t = this.ctx.currentTime;
      this.tone(t, 520, 1150, 0.35, 0.09, 'sine'); this.tone(t + 0.05, 780, 1700, 0.3, 0.045, 'triangle');
      this.noise(t, 0.3, 6000, 2, 0.025, null, 'highpass');
    },
    pop() {   // 보호막이 대신 맞고 터짐 "퐁"
      if (!this.live()) return;
      const t = this.ctx.currentTime;
      this.tone(t, 950, 280, 0.14, 0.14); this.noise(t, 0.08, 2400, 1.2, 0.08);
    },
    magnet() {   // 자석 "위이잉": 올라가며 떨리는 소리
      if (!this.live()) return;
      const c = this.ctx, t = c.currentTime, o = this.tone(t, 260, 900, 0.7, 0.06, 'square');
      const lfo = c.createOscillator(), depth = c.createGain();
      lfo.frequency.value = 16; depth.gain.value = 40; lfo.connect(depth).connect(o.frequency); lfo.start(t); lfo.stop(t + 0.75);
    },
    thunder() {   // 천둥 번개 "쾅 우르르": 날카롭게 갈라지는 잡음 + 낮게 길게 울림
      if (!this.live()) return;
      const t = this.ctx.currentTime;
      this.noise(t, 0.18, 3200, 0.6, 0.3, null, 'highpass');
      this.noise(t + 0.03, 1.6, 180, 0.7, 0.35, null, 'lowpass');
      this.tone(t, 90, 38, 0.9, 0.3);
    },
    boing() {   // 통통 공 "통": 짧게 위로 튀는 소리
      if (!this.live()) return;
      const t = this.ctx.currentTime;
      this.tone(t, 240, 640, 0.13, 0.09, 'triangle'); this.tone(t, 120, 70, 0.08, 0.08);
    },
    rocket() {   // 추적 로켓 "슈우웅": 잡음이 위로 쓸려 올라가며 휘파람
      if (!this.live()) return;
      const t = this.ctx.currentTime, f = this.noise(t, 0.7, 600, 1.2, 0.14);
      f.frequency.exponentialRampToValueAtTime(3200, t + 0.6);
      this.tone(t, 320, 1100, 0.6, 0.05, 'sawtooth');
    },
    whirl() {   // 회오리 "휘이잉": 바람 잡음이 오르내림
      if (!this.live()) return;
      const t = this.ctx.currentTime, f = this.noise(t, 1.2, 500, 2.5, 0.12);
      f.frequency.linearRampToValueAtTime(1500, t + 0.5); f.frequency.linearRampToValueAtTime(700, t + 1.1);
    },
    freeze() {   // 눈덩이에 갇힘 "쨍 꽁꽁": 맑은 종 셋 + 얼음 금 가는 소리
      if (!this.live()) return;
      const t = this.ctx.currentTime;
      [1760, 2350, 3135].forEach((f, i) => this.tone(t + i * 0.05, f, f, 0.35, 0.05, 'sine', null, 0.002));
      this.noise(t, 0.12, 5000, 2, 0.08, null, 'highpass');
    },
    boom() {   // 로켓·폭탄 "꽝": 낮게 터지는 잡음 + 쿵 + 파편
      if (!this.live()) return;
      const t = this.ctx.currentTime;
      this.noise(t, 1.0, 320, 0.6, 0.4, null, 'lowpass');
      this.tone(t, 95, 34, 0.7, 0.35);
      this.noise(t + 0.05, 0.4, 3500, 0.8, 0.08, null, 'highpass');
    },
    throw() {   // 던지기 "휙"
      if (!this.live()) return;
      const t = this.ctx.currentTime, f = this.noise(t, 0.22, 1600, 1.5, 0.1);
      f.frequency.exponentialRampToValueAtTime(500, t + 0.2);
    },
    spring() {   // 스프링 "보잉~": 올라가며 떨리는 소리
      if (!this.live()) return;
      const c = this.ctx, t = c.currentTime, o = this.tone(t, 200, 700, 0.5, 0.11, 'triangle');
      const lfo = c.createOscillator(), depth = c.createGain();
      lfo.frequency.value = 14; depth.gain.value = 60; lfo.connect(depth).connect(o.frequency); lfo.start(t); lfo.stop(t + 0.55);
    },
    horn() {   // 빵빵 나팔 "빠-빵!": 굵은 네모파 두 음 + 퍼지는 바람
      if (!this.live()) return;
      const t = this.ctx.currentTime;
      for (const [dt, f] of [[0, 392], [0.18, 523]]) { this.tone(t + dt, f, f * 0.98, 0.28, 0.12, 'square', null, 0.01); this.tone(t + dt, f * 1.5, f * 1.48, 0.28, 0.05, 'sawtooth', null, 0.01); }
      const n = this.noise(t + 0.15, 0.6, 400, 0.7, 0.12); n.frequency.exponentialRampToValueAtTime(2400, t + 0.7);
    },
    ufo() {   // 외계인 UFO "우잉우잉": 떨리며 오르내리는 맑은 소리
      if (!this.live()) return;
      const c = this.ctx, t = c.currentTime, o = this.tone(t, 700, 760, 1.2, 0.07, 'sine', null, 0.05);
      const lfo = c.createOscillator(), depth = c.createGain();
      lfo.frequency.value = 7; depth.gain.value = 260; lfo.connect(depth).connect(o.frequency); lfo.start(t); lfo.stop(t + 1.25);
    },
    ghost() {   // 꼬마 유령 "우~": 낮게 흔들리는 소리 + 높은 휘파람
      if (!this.live()) return;
      const c = this.ctx, t = c.currentTime, o = this.tone(t, 330, 250, 0.9, 0.08, 'triangle', null, 0.12);
      const lfo = c.createOscillator(), depth = c.createGain();
      lfo.frequency.value = 5; depth.gain.value = 18; lfo.connect(depth).connect(o.frequency); lfo.start(t); lfo.stop(t + 0.95);
      this.tone(t + 0.1, 1200, 900, 0.6, 0.02, 'sine', null, 0.2);
    },
    steal() {   // 아이템 훔침 "휙 띠링"
      if (!this.live()) return;
      const t = this.ctx.currentTime, n = this.noise(t, 0.2, 1200, 1.5, 0.1);
      n.frequency.exponentialRampToValueAtTime(3000, t + 0.18);
      this.tone(t + 0.15, 1320, 1320, 0.1, 0.09, 'triangle'); this.tone(t + 0.24, 1760, 1760, 0.16, 0.09, 'triangle');
    },
    plane() {   // 꼬마 비행기 "부우웅": 프로펠러 붕붕 + 위로 슝
      if (!this.live()) return;
      const c = this.ctx, t = c.currentTime, o = this.tone(t, 90, 140, 1.3, 0.1, 'sawtooth', null, 0.05);
      const lfo = c.createOscillator(), depth = c.createGain();
      lfo.frequency.value = 28; depth.gain.value = 25; lfo.connect(depth).connect(o.frequency); lfo.start(t); lfo.stop(t + 1.35);
      const n = this.noise(t, 0.8, 900, 1, 0.08); n.frequency.exponentialRampToValueAtTime(2600, t + 0.7);
    },
    boomerang() {   // 부메랑 "휘휘휙": 빠르게 도는 바람 소리
      if (!this.live()) return;
      const t = this.ctx.currentTime;
      for (let i = 0; i < 4; i++) this.noise(t + i * 0.09, 0.12, 1400 + i * 200, 2, 0.07);
    },
    cloud() {   // 천둥 먹구름이 옴 "우르릉": 낮게 깔리는 잡음
      if (!this.live()) return;
      const t = this.ctx.currentTime;
      this.noise(t, 1.0, 120, 0.8, 0.18, null, 'lowpass');
      this.tone(t, 70, 50, 0.9, 0.12);
    },
    shrink() {   // 작아져라 광선 "뾰로로롱": 내려가는 반짝 소리
      if (!this.live()) return;
      const t = this.ctx.currentTime;
      [1760, 1480, 1245, 1047, 880, 740].forEach((f, i) => this.tone(t + i * 0.06, f, f * 0.9, 0.1, 0.06, 'triangle'));
    },
    squash() {   // 밟혀서 납작 "뿌직"
      if (!this.live()) return;
      const t = this.ctx.currentTime;
      this.tone(t, 300, 60, 0.25, 0.16, 'square');
      this.noise(t, 0.15, 700, 1, 0.12);
    },
    wood() {   // 바리케이드 "탁탁탁": 나무 치는 소리 셋
      if (!this.live()) return;
      const t = this.ctx.currentTime;
      for (let i = 0; i < 3; i++) { this.noise(t + i * 0.11, 0.06, 900, 3, 0.18); this.tone(t + i * 0.11, 260, 180, 0.06, 0.12, 'triangle'); }
    },
    powWarn() {   // 쿵 블록이 곧 떨어짐: "똑 똑 똑" 점점 빨라지는 경고
      if (!this.live()) return;
      const t = this.ctx.currentTime;
      [0, 0.45, 0.8, 1.05, 1.25].forEach(dt => this.tone(t + dt, 1000, 800, 0.08, 0.1, 'square'));
    },
    thud() {   // 쿵! 큰 블록이 떨어짐: 아주 낮은 쿵 + 먼지
      if (!this.live()) return;
      const t = this.ctx.currentTime;
      this.tone(t, 80, 30, 0.6, 0.4);
      this.noise(t, 0.5, 250, 0.7, 0.3, null, 'lowpass');
    },
    bubble() {   // 물방울에 갇힘 "뽀글뽀글"
      if (!this.live()) return;
      const t = this.ctx.currentTime;
      for (let i = 0; i < 5; i++) { const f = rnd(500, 900); this.tone(t + i * 0.07, f, f * 1.8, 0.07, 0.07, 'sine'); }
    },
    splat() {   // 물감 폭탄 "철퍽": 젖은 잡음이 아래로
      if (!this.live()) return;
      const t = this.ctx.currentTime, f = this.noise(t, 0.3, 1600, 0.8, 0.22, null, 'lowpass');
      f.frequency.exponentialRampToValueAtTime(260, t + 0.25);
      this.tone(t, 420, 110, 0.18, 0.1);
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
  // 용암 성: 152bpm · Dm-B♭-C-A-Dm-B♭-Gm-A7. 말 달리는 베이스와 금관, 조금 무섭지만 신나게
  const LAVA_CHORDS = [
    { bass: 38, keys: [62, 65, 69] }, { bass: 46, keys: [62, 65, 70] }, { bass: 48, keys: [64, 67, 72] }, { bass: 45, keys: [61, 64, 69] },
    { bass: 38, keys: [62, 65, 69] }, { bass: 46, keys: [62, 65, 70] }, { bass: 43, keys: [62, 67, 70] }, { bass: 45, keys: [61, 67, 69] },
  ];
  const LAVA_MELODY = [
    [[0, 74, 3], [3, 74, 1], [4, 77, 2], [6, 81, 2], [8, 86, 4], [12, 84, 2], [14, 81, 2]],
    [[0, 82, 3], [3, 81, 1], [4, 79, 2], [6, 77, 2], [8, 74, 4], [12, 77, 4]],
    [[0, 79, 3], [3, 79, 1], [4, 76, 2], [6, 79, 2], [8, 84, 4], [12, 82, 2], [14, 79, 2]],
    [[0, 81, 4], [4, 76, 2], [6, 73, 2], [8, 76, 2], [10, 79, 2], [12, 81, 4]],
    [[0, 74, 3], [3, 74, 1], [4, 77, 2], [6, 81, 2], [8, 86, 3], [11, 86, 1], [12, 89, 4]],
    [[0, 89, 2], [2, 86, 2], [4, 82, 2], [6, 86, 2], [8, 84, 4], [12, 82, 4]],
    [[0, 79, 2], [2, 82, 2], [4, 86, 2], [6, 82, 2], [8, 79, 2], [10, 77, 2], [12, 74, 4]],
    [[0, 73, 2], [2, 76, 2], [4, 79, 2], [6, 81, 2], [8, 85, 4], [12, 88, 4]],
  ];
  // 구름다리 숲: 138bpm · G-Em-C-D-G-Em-Am-D7. 피리와 밴조, 숲길을 신나게
  const FOREST_CHORDS = [
    { bass: 43, keys: [59, 62, 67] }, { bass: 40, keys: [59, 64, 67] }, { bass: 48, keys: [60, 64, 67] }, { bass: 38, keys: [57, 62, 66] },
    { bass: 43, keys: [59, 62, 67] }, { bass: 40, keys: [59, 64, 67] }, { bass: 45, keys: [57, 60, 64] }, { bass: 38, keys: [60, 62, 66] },
  ];
  const FOREST_MELODY = [
    [[0, 74, 2], [2, 71, 2], [4, 67, 2], [6, 71, 2], [8, 74, 3], [11, 76, 1], [12, 74, 4]],
    [[0, 71, 2], [2, 67, 2], [4, 64, 2], [6, 67, 2], [8, 71, 4], [12, 69, 2], [14, 67, 2]],
    [[0, 72, 2], [2, 76, 2], [4, 79, 4], [8, 76, 2], [10, 72, 2], [12, 76, 4]],
    [[0, 74, 2], [2, 78, 2], [4, 81, 4], [8, 78, 2], [10, 76, 2], [12, 74, 4]],
    [[0, 79, 2], [2, 74, 2], [4, 71, 2], [6, 74, 2], [8, 79, 3], [11, 81, 1], [12, 83, 4]],
    [[0, 83, 2], [2, 79, 2], [4, 76, 2], [6, 79, 2], [8, 83, 4], [12, 81, 2], [14, 79, 2]],
    [[0, 76, 2], [2, 79, 2], [4, 81, 2], [6, 79, 2], [8, 76, 2], [10, 72, 2], [12, 69, 4]],
    [[0, 74, 2], [2, 72, 2], [4, 69, 2], [6, 72, 2], [8, 74, 2], [10, 78, 2], [12, 81, 4]],
  ];
  // 소라 해안: 164bpm · Em-C-G-D-Em-C-Am-B7. 파도를 타는 서프 록 (기타가 "따라라라" 떨림)
  const COAST_CHORDS = [
    { bass: 40, keys: [59, 64, 67] }, { bass: 48, keys: [60, 64, 67] }, { bass: 43, keys: [59, 62, 67] }, { bass: 38, keys: [57, 62, 66] },
    { bass: 40, keys: [59, 64, 67] }, { bass: 48, keys: [60, 64, 67] }, { bass: 45, keys: [57, 60, 64] }, { bass: 47, keys: [59, 63, 69] },
  ];
  const COAST_MELODY = [
    [[0, 76, 4], [4, 74, 2], [6, 71, 2], [8, 76, 4], [12, 79, 4]],
    [[0, 76, 4], [4, 72, 2], [6, 74, 2], [8, 76, 6], [14, 72, 2]],
    [[0, 71, 4], [4, 74, 2], [6, 79, 2], [8, 78, 4], [12, 74, 4]],
    [[0, 74, 4], [4, 78, 2], [6, 81, 2], [8, 78, 6], [14, 74, 2]],
    [[0, 76, 2], [2, 79, 2], [4, 83, 4], [8, 81, 2], [10, 79, 2], [12, 76, 4]],
    [[0, 72, 2], [2, 76, 2], [4, 79, 4], [8, 84, 4], [12, 79, 4]],
    [[0, 81, 2], [2, 79, 2], [4, 76, 2], [6, 72, 2], [8, 69, 4], [12, 72, 4]],
    [[0, 71, 4], [4, 75, 2], [6, 78, 2], [8, 81, 4], [12, 83, 4]],
  ];
  // 사탕 롤러코스터: 168bpm · C-G7-C-G7-F-C-D7-G7. 서커스 오르간 갤럽, 오르락내리락
  const COASTER_CHORDS = [
    { bass: 48, keys: [64, 67, 72] }, { bass: 43, keys: [62, 65, 71] }, { bass: 48, keys: [64, 67, 72] }, { bass: 43, keys: [62, 65, 71] },
    { bass: 41, keys: [65, 69, 72] }, { bass: 48, keys: [64, 67, 72] }, { bass: 50, keys: [62, 66, 72] }, { bass: 43, keys: [62, 65, 71] },
  ];
  const COASTER_MELODY = [
    [[0, 79, 2], [2, 76, 2], [4, 79, 2], [6, 84, 2], [8, 83, 2], [10, 84, 2], [12, 88, 4]],
    [[0, 86, 2], [2, 83, 2], [4, 79, 2], [6, 77, 2], [8, 74, 4], [12, 79, 4]],
    [[0, 76, 2], [2, 79, 2], [4, 84, 2], [6, 79, 2], [8, 76, 2], [10, 79, 2], [12, 84, 4]],
    [[0, 83, 2], [2, 81, 2], [4, 79, 2], [6, 77, 2], [8, 76, 2], [10, 74, 2], [12, 71, 4]],
    [[0, 77, 2], [2, 81, 2], [4, 84, 4], [8, 81, 2], [10, 77, 2], [12, 81, 4]],
    [[0, 79, 2], [2, 84, 2], [4, 88, 4], [8, 84, 2], [10, 79, 2], [12, 76, 4]],
    [[0, 78, 2], [2, 81, 2], [4, 84, 2], [6, 86, 2], [8, 84, 2], [10, 81, 2], [12, 78, 4]],
    [[0, 79, 1], [1, 81, 1], [2, 83, 1], [3, 84, 1], [4, 86, 4], [8, 83, 2], [10, 79, 2], [12, 74, 4]],
  ];
  // 모래 협곡 광산: 150bpm · Am-G-F-E-Am-G-F-E7. 말 달리는 서부 질주
  const CANYON_CHORDS = [
    { bass: 45, keys: [57, 60, 64] }, { bass: 43, keys: [55, 59, 62] }, { bass: 41, keys: [57, 60, 65] }, { bass: 40, keys: [56, 59, 64] },
    { bass: 45, keys: [57, 60, 64] }, { bass: 43, keys: [55, 59, 62] }, { bass: 41, keys: [57, 60, 65] }, { bass: 40, keys: [56, 62, 64] },
  ];
  const CANYON_MELODY = [
    [[0, 76, 3], [3, 76, 1], [4, 77, 2], [6, 76, 2], [8, 74, 2], [10, 72, 2], [12, 69, 4]],
    [[0, 74, 3], [3, 74, 1], [4, 76, 2], [6, 74, 2], [8, 72, 2], [10, 71, 2], [12, 67, 4]],
    [[0, 72, 3], [3, 72, 1], [4, 74, 2], [6, 72, 2], [8, 69, 2], [10, 72, 2], [12, 77, 4]],
    [[0, 76, 6], [6, 74, 2], [8, 72, 2], [10, 71, 2], [12, 68, 4]],
    [[0, 81, 3], [3, 81, 1], [4, 79, 2], [6, 77, 2], [8, 76, 4], [12, 72, 4]],
    [[0, 79, 3], [3, 79, 1], [4, 77, 2], [6, 76, 2], [8, 74, 4], [12, 71, 4]],
    [[0, 77, 2], [2, 76, 2], [4, 74, 2], [6, 72, 2], [8, 74, 2], [10, 76, 2], [12, 77, 4]],
    [[0, 80, 4], [4, 76, 2], [6, 74, 2], [8, 71, 2], [10, 68, 2], [12, 64, 4]],
  ];
  // 빌딩 고가도로: 126bpm · Em7-A7-Em7-A7-Cmaj7-Bm7-Am7-B7. 튕기는 도시 펑크
  const CITY_CHORDS = [
    { bass: 40, keys: [59, 62, 64] }, { bass: 45, keys: [61, 64, 67] }, { bass: 40, keys: [59, 62, 64] }, { bass: 45, keys: [61, 64, 67] },
    { bass: 48, keys: [60, 64, 67] }, { bass: 47, keys: [57, 62, 66] }, { bass: 45, keys: [57, 60, 64] }, { bass: 47, keys: [57, 63, 66] },
  ];
  const CITY_MELODY = [
    [[0, 76, 2], [3, 74, 1], [4, 76, 2], [8, 79, 2], [11, 76, 1], [12, 74, 4]],
    [[0, 73, 2], [3, 74, 1], [4, 76, 2], [8, 79, 3], [12, 76, 4]],
    [[0, 76, 2], [3, 79, 1], [4, 81, 2], [8, 79, 2], [10, 76, 2], [12, 74, 4]],
    [[0, 76, 1], [2, 73, 1], [4, 69, 4], [8, 73, 2], [10, 76, 2], [12, 79, 4]],
    [[0, 79, 2], [2, 76, 2], [4, 72, 4], [8, 76, 2], [10, 79, 2], [12, 83, 4]],
    [[0, 81, 2], [2, 78, 2], [4, 74, 4], [8, 78, 2], [10, 81, 2], [12, 83, 4]],
    [[0, 84, 2], [2, 81, 2], [4, 76, 2], [6, 72, 2], [8, 76, 2], [10, 79, 2], [12, 81, 4]],
    [[0, 83, 3], [3, 81, 1], [4, 78, 2], [6, 75, 2], [8, 71, 4], [12, 75, 4]],
  ];
  // 오로라 얼음 궁전: 146bpm · E-C♯m-A-B-E-G♯m-A-B7. 밤하늘에 반짝이는 첼레스타
  const AURORA_CHORDS = [
    { bass: 40, keys: [64, 68, 71] }, { bass: 37, keys: [61, 64, 68] }, { bass: 45, keys: [61, 64, 69] }, { bass: 47, keys: [63, 66, 71] },
    { bass: 40, keys: [64, 68, 71] }, { bass: 44, keys: [63, 68, 71] }, { bass: 45, keys: [61, 64, 69] }, { bass: 47, keys: [63, 66, 69] },
  ];
  const AURORA_MELODY = [
    [[0, 76, 2], [2, 80, 2], [4, 83, 4], [8, 88, 2], [10, 87, 2], [12, 83, 4]],
    [[0, 85, 4], [4, 83, 2], [6, 80, 2], [8, 76, 4], [12, 80, 4]],
    [[0, 81, 2], [2, 83, 2], [4, 85, 4], [8, 88, 4], [12, 85, 4]],
    [[0, 83, 6], [6, 81, 2], [8, 78, 4], [12, 75, 4]],
    [[0, 76, 2], [2, 80, 2], [4, 83, 2], [6, 88, 2], [8, 92, 4], [12, 88, 4]],
    [[0, 87, 4], [4, 83, 2], [6, 80, 2], [8, 83, 4], [12, 87, 4]],
    [[0, 85, 2], [2, 88, 2], [4, 85, 2], [6, 81, 2], [8, 85, 4], [12, 83, 4]],
    [[0, 81, 2], [2, 83, 2], [4, 87, 4], [8, 90, 4], [12, 87, 4]],
  ];
  // 정글 유적: 150bpm · Dm-C-B♭-C-Dm-F-G-A. 탐탐 북 위로 팬플루트
  const JUNGLE_CHORDS = [
    { bass: 38, keys: [62, 65, 69] }, { bass: 36, keys: [60, 64, 67] }, { bass: 34, keys: [62, 65, 70] }, { bass: 36, keys: [60, 64, 67] },
    { bass: 38, keys: [62, 65, 69] }, { bass: 41, keys: [60, 65, 69] }, { bass: 43, keys: [62, 67, 71] }, { bass: 45, keys: [61, 64, 69] },
  ];
  const JUNGLE_MELODY = [
    [[0, 74, 2], [2, 77, 2], [4, 81, 4], [8, 79, 2], [10, 77, 2], [12, 74, 4]],
    [[0, 76, 2], [3, 79, 1], [4, 76, 2], [6, 72, 2], [8, 74, 4], [12, 76, 4]],
    [[0, 77, 2], [2, 74, 2], [4, 70, 4], [8, 74, 2], [10, 77, 2], [12, 82, 4]],
    [[0, 79, 4], [4, 76, 2], [6, 79, 2], [8, 84, 4], [12, 79, 4]],
    [[0, 81, 2], [2, 84, 2], [4, 86, 4], [8, 84, 2], [10, 81, 2], [12, 77, 4]],
    [[0, 81, 4], [4, 77, 2], [6, 72, 2], [8, 77, 2], [10, 81, 2], [12, 84, 4]],
    [[0, 83, 2], [2, 79, 2], [4, 74, 4], [8, 79, 2], [10, 83, 2], [12, 86, 4]],
    [[0, 85, 2], [2, 81, 2], [4, 76, 2], [6, 81, 2], [8, 85, 4], [12, 88, 4]],
  ];
  const SONGS = {
    menu: { bpm: 112, style: 'pop', chords: CHORDS, melody: MELODY },
    race: { bpm: 148, style: 'drive', chords: RACE_CHORDS, melody: RACE_MELODY },
    beach: { bpm: 132, style: 'surf', chords: BEACH_CHORDS, melody: BEACH_MELODY },
    snow: { bpm: 144, style: 'sleigh', chords: SNOW_CHORDS, melody: SNOW_MELODY },
    candy: { bpm: 156, style: 'bubble', chords: CANDY_CHORDS, melody: CANDY_MELODY },
    lava: { bpm: 152, style: 'castle', chords: LAVA_CHORDS, melody: LAVA_MELODY },
    forest: { bpm: 138, style: 'folk', chords: FOREST_CHORDS, melody: FOREST_MELODY },
    coast: { bpm: 164, style: 'wave', chords: COAST_CHORDS, melody: COAST_MELODY },
    coaster: { bpm: 168, style: 'carnival', chords: COASTER_CHORDS, melody: COASTER_MELODY },
    canyon: { bpm: 150, style: 'western', chords: CANYON_CHORDS, melody: CANYON_MELODY },
    city: { bpm: 126, style: 'funk', chords: CITY_CHORDS, melody: CITY_MELODY },
    aurora: { bpm: 146, style: 'aurora', chords: AURORA_CHORDS, melody: AURORA_MELODY },
    jungle: { bpm: 150, style: 'jungle', chords: JUNGLE_CHORDS, melody: JUNGLE_MELODY },
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
