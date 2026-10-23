/* ============================================================
 * 놀자 공용 효과음 — WebAudio로 즉석 합성 (파일 없음)
 *   init()은 클릭·키 입력 같은 사용자 동작 안에서 한 번 불러야 소리가 남
 * ============================================================ */
(function () {
  'use strict';
  const N = window.Nolja = window.Nolja || {};

  const A = N.audio = {
    ctx: null, buf: null,
    init() {
      if (!this.ctx) {
        try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; }
        const n = this.ctx.sampleRate, b = this.ctx.createBuffer(1, n, n), d = b.getChannelData(0);
        for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;   // 1초짜리 잡음
        this.buf = b;
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
    },
    live() { return !!(this.ctx && this.ctx.state === 'running'); },

    // 기본 재료: 대역 잡음 · 음
    noise(t0, dur, freq, q, gain) {
      const c = this.ctx, src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
      src.buffer = this.buf; f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
      g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(gain, t0 + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      src.connect(f).connect(g).connect(c.destination); src.start(t0, Math.random() * 0.5); src.stop(t0 + dur + 0.03);
      return f;
    },
    tone(t0, f0, f1, dur, gain, type = 'sine') {
      const c = this.ctx, o = c.createOscillator(), g = c.createGain();
      o.type = type; o.frequency.setValueAtTime(f0, t0); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
      g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(gain, t0 + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g).connect(c.destination); o.start(t0); o.stop(t0 + dur + 0.03);
    },

    // 자주 쓰는 소리 (p = 세기 0~1)
    hit(p) { if (!this.live()) return; const t = this.ctx.currentTime; this.noise(t, 0.07, 1700, 1.1, 0.45 + p * 0.4); this.tone(t, 540, 170, 0.09, 0.3 + p * 0.25, 'triangle'); },
    bounce() { if (!this.live()) return; const t = this.ctx.currentTime; this.tone(t, 200, 80, 0.09, 0.28); this.noise(t, 0.04, 700, 1, 0.1); },
    whoosh(p) { if (!this.live()) return; const t = this.ctx.currentTime; const f = this.noise(t, 0.2, 600, 0.8, 0.08 + p * 0.12); f.frequency.exponentialRampToValueAtTime(2600, t + 0.18); },
    point() { if (!this.live()) return; const t = this.ctx.currentTime; this.tone(t, 660, 660, 0.12, 0.16, 'triangle'); this.tone(t + 0.12, 990, 990, 0.2, 0.16, 'triangle'); this.cheer(0.9); },
    tick() { if (!this.live()) return; const t = this.ctx.currentTime; this.tone(t, 900, 700, 0.07, 0.1, 'square'); },
    ready() { if (!this.live()) return; const t = this.ctx.currentTime; this.tone(t, 660, 660, 0.1, 0.16, 'triangle'); this.tone(t + 0.09, 1320, 1320, 0.18, 0.14, 'triangle'); },
    cheer(len = 1.4) {   // 관중 함성
      if (!this.live()) return;
      const c = this.ctx, t = c.currentTime, src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
      src.buffer = this.buf; src.loop = true; f.type = 'lowpass'; f.frequency.value = 1300;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.14, t + 0.25); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
      src.connect(f).connect(g).connect(c.destination); src.start(t); src.stop(t + len + 0.05);
    },
  };
})();
