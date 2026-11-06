/* ============================================================
 * 놀자 소파 조작 — 거실 TV 앞에서 컨트롤러만으로 (키보드·마우스 없이)
 *
 *  메뉴 고르기: 스틱(프로콘·게임패드는 방향키도)으로 칸을 옮김 · 오른쪽 자리 버튼 = 누르기 · 아래 자리 버튼 = 뒤로
 *    세로로 쥐든 가로로 쥐든 같은 자리면 같은 뜻 (joycon.js faceOf · stickAxes). 슬라이더 칸에선 좌우가 값을 바꿈
 *    고른 칸이 없을 땐 버튼을 게임에 그대로 넘김 (아무 버튼이나 눌러도 시작·계속)
 *  알림: 조이콘 끊김(경기 중이면 일시정지) · 다시 연결 · 배터리 부족 · 브라우저가 소리를 막고 있을 때
 *
 *  - attach({ layers, skip, lost, tick, audio, wheel, pads })  페이지마다 한 번
 *      layers  위에서부터 먼저 맞는 화면 하나: { el, on() 지금 열렸나, first 처음 고를 칸(선택자), back 뒤로 버튼(선택자, 함수면 그때그때),
 *                dialog <dialog>면 true, auto 컨트롤러가 있으면 칸을 바로 보여 줌, wait() true면 잠깐 입력을 안 받음 }
 *      skip    고르지 않을 칸 (브라우저가 사람이 직접 누른 것만 허락하는 전체화면·조이콘 연결 버튼)
 *      lost    조이콘이 끊겼을 때 부름 (경기 일시정지)
 *      tick    칸을 옮길 때 부름 (소리) · audio Nolja.audio (소리가 막혔는지 살핌)
 *      wheel   조이콘을 가로로 쥐는 게임 · pads 게임패드를 여기서 읽음 (게임 루프가 없는 홈 화면)
 *  - pad(gp)        게임패드 하나 읽기. true면 메뉴가 받은 입력이라 게임은 넘어감 (게임이 자기 루프에서 부름)
 *  - toast(글, ms)  화면 위 짧은 알림
 *  - current()      지금 고른 칸 · poll() 한 번 살피기 (테스트에서도 직접 부름)
 *  - pick(지금 칸 사각형, [{ el, rect }], 방향)  다음 칸 고르기
 *  - tickDir(상태, x, y, 초, 켜짐)  스틱 → 방향 (밀면 한 번, 오래 밀면 되풀이)
 * ============================================================ */
(function () {
  'use strict';
  const N = window.Nolja = window.Nolja || {};
  const J = N.joycon;
  const FOCUSABLE = 'a[href], button, summary, input, select';
  const ON = 0.55, OFF = 0.35, FIRST_REPEAT = 0.42, REPEAT = 0.16;   // 스틱: 민 것으로 칠 값 · 놓은 것으로 칠 값 · 되풀이 간격(초)
  let opts = {}, layers = [], cur = null, lastLayer = null, mouse = false, soundSince = 0, soundSaid = false;
  const memo = new WeakMap(), sticks = new WeakMap(), pads = {}, lostOnes = new WeakSet();
  const clock = () => performance.now() / 1000;
  const active = () => layers.find(L => L.on()) || null;

  const C = N.couch = {};

  // ---------- 다음 칸 고르기: 그 방향에 있는 칸 중 가깝고 줄이 맞는 칸 ----------
  C.pick = function (from, cands, dir) {
    const h = dir === 'left' || dir === 'right', sign = dir === 'right' || dir === 'down' ? 1 : -1;
    const fx = (from.left + from.right) / 2, fy = (from.top + from.bottom) / 2;
    let best = null, bestScore = Infinity;
    for (const c of cands) {
      const r = c.rect, cx = (r.left + r.right) / 2, cy = (r.top + r.bottom) / 2;
      if ((h ? cx - fx : cy - fy) * sign <= 1) continue;
      const gap = Math.max(0, h ? (sign > 0 ? r.left - from.right : from.left - r.right) : (sign > 0 ? r.top - from.bottom : from.top - r.bottom));
      const inLine = h ? r.top < from.bottom && r.bottom > from.top : r.left < from.right && r.right > from.left;
      const score = gap + (h ? Math.abs(cy - fy) : Math.abs(cx - fx)) * (inLine ? 0.3 : 1.6);
      if (score < bestScore) { bestScore = score; best = c; }
    }
    return best;
  };
  // 스틱 → 방향: 밀면 한 번, 계속 밀면 잠시 뒤 되풀이. 메뉴가 아닐 때 밀고 있던 스틱은 놓았다 다시 밀어야 함 (운전하다 일시정지했을 때 칸이 튀지 않게)
  C.tickDir = function (s, x, y, t, on) {
    const ax = Math.abs(x), ay = Math.abs(y), m = Math.max(ax, ay);
    const d = m < OFF ? '' : m > ON ? (ax >= ay ? (x > 0 ? 'right' : 'left') : (y > 0 ? 'up' : 'down')) : s.dir || '';
    if (!on) { s.dir = d; s.next = Infinity; return ''; }
    if (d !== (s.dir || '')) { s.dir = d; s.next = t + FIRST_REPEAT; return d; }
    if (d && t >= s.next) { s.next = t + REPEAT; return d; }
    return '';
  };

  // ---------- 고른 칸 ----------
  function setCur(el) {
    if (el === cur) return;
    if (cur) cur.classList.remove('pad-focus');
    cur = el;
    if (!el) return;
    el.classList.add('pad-focus');
    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const L = active();
    if (L) memo.set(L, el);
  }
  C.current = () => cur;
  function candidates(L) {
    const out = [];
    for (const el of L.el.querySelectorAll(FOCUSABLE)) {
      if (el.disabled || el.tabIndex < 0 || (opts.skip && el.matches(opts.skip))) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) continue;
      out.push({ el, rect });
    }
    return out;
  }
  function alive(L, el) {
    if (!el || el.disabled || !L.el.contains(el)) return false;
    const r = el.getBoundingClientRect();
    return r.width >= 2 && r.height >= 2;
  }
  const usable = (L, el) => alive(L, el) && !(opts.skip && el.matches(opts.skip));
  function firstOf(L) {
    const had = L.auto ? null : memo.get(L);   // 일시정지·결과는 늘 첫 칸부터 (지난번에 고른 '처음부터'가 남아 있으면 A 한 번에 경기가 지워짐)
    if (usable(L, had)) return had;
    const named = L.first && L.el.querySelector(L.first);
    if (usable(L, named)) return named;
    const list = candidates(L), on = list.find(c => c.el.classList.contains('on'));
    return on ? on.el : list.length ? list[0].el : null;
  }
  function scrollLayer(L, dir) {
    for (let e = L.el; e && e.getBoundingClientRect; e = e.parentElement) {
      if (e.scrollHeight > e.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(e).overflowY)) { e.scrollBy({ top: dir === 'up' ? -180 : 180 }); return; }
    }
  }
  function nudgeRange(el, d) {   // 슬라이더: 스무 번쯤이면 끝까지
    const min = +el.min || 0, max = el.max === '' ? 100 : +el.max, step = +el.step || 1;
    const by = Math.max(step, Math.round((max - min) / 20 / step) * step);
    el.value = Math.min(max, Math.max(min, +el.value + d * by));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function go(L, dir) {
    mouse = false;
    if (!cur) { const f = firstOf(L); if (f) { setCur(f); if (opts.tick) opts.tick(); } else scrollLayer(L, dir); return; }
    if ((dir === 'left' || dir === 'right') && cur.matches('input[type=range]')) { nudgeRange(cur, dir === 'right' ? 1 : -1); return; }
    const next = C.pick(cur.getBoundingClientRect(), candidates(L).filter(c => c.el !== cur), dir);
    if (next) { setCur(next.el); if (opts.tick) opts.tick(); } else if (dir === 'up' || dir === 'down') scrollLayer(L, dir);
  }
  function press() { if (cur && !cur.matches('input[type=range]')) cur.click(); }
  function back(L) {
    if (L.dialog) { L.el.close(); return true; }
    const sel = typeof L.back === 'function' ? L.back() : L.back, b = sel && L.el.querySelector(sel);
    if (b) { b.click(); return true; }
    if (cur) { setCur(null); return true; }
    return false;   // 고른 칸도 뒤로 갈 곳도 없으면 게임으로 (아무 버튼이나 눌러도 시작)
  }

  // ---------- 조이콘 ----------
  function joyButtons(pi, m, jc) {
    const L = active();
    if (!L) return false;
    mouse = false;
    if (L.wait && L.wait()) return true;
    const f = J.faceOf(jc, m);
    if (f.dir) { go(L, f.dir); return true; }
    if (f.back) return back(L);
    if (!f.ok) return false;
    if (cur) { press(); return true; }
    if (L.dialog) { L.el.close(); return true; }
    return false;
  }
  function pollSticks(L, t) {
    for (const jc of J.list) {
      if (!jc.ok) continue;
      let s = sticks.get(jc);
      if (!s) sticks.set(jc, s = { dir: '', next: Infinity });
      const a = J.stickAxes(jc), d = C.tickDir(s, a.x, a.y, t, !!L);
      if (d && !(L.wait && L.wait())) go(L, d);
    }
  }

  // ---------- 게임패드 ----------
  const isJoyPad = gp => !!(J && J.supported && /057e|joy-con|pro controller|nintendo/i.test(gp.id));   // PC에선 조이콘은 WebHID로 받음
  C.pad = function (gp) {
    const s = pads[gp.index] || (pads[gp.index] = { dir: '', next: Infinity, b: [] });
    const now = gp.buttons.map(b => b.pressed || b.value > 0.5), rise = i => !!now[i] && !s.b[i];
    const std = gp.mapping === 'standard', ax = gp.axes[0] || 0, ay = gp.axes[1] || 0;
    const x = std && now[15] ? 1 : std && now[14] ? -1 : ax, y = std && now[12] ? 1 : std && now[13] ? -1 : -ay;
    const L = active(), d = C.tickDir(s, x, y, clock(), !!L), a = rise(0), b = rise(1);
    s.b = now;
    if (!L) return false;
    if (d || a || b) mouse = false;
    if (L.wait && L.wait()) return !!(d || a || b);
    if (d) { go(L, d); return true; }
    if (b) return back(L);
    if (a && cur) { press(); return true; }
    if (a && L.dialog) { L.el.close(); return true; }
    return false;
  };
  function liveGamepads() {
    if (!navigator.getGamepads) return [];
    let list;
    try { list = navigator.getGamepads() || []; } catch (e) { return []; }
    return Array.from(list).filter(gp => gp && gp.connected && !isJoyPad(gp));
  }

  // ---------- 알림 ----------
  function toastBox() {
    let box = document.getElementById('couchToasts');
    if (!box) {
      box = document.createElement('div');
      box.id = 'couchToasts'; box.className = 'couch-toasts';
      box.setAttribute('role', 'status'); box.setAttribute('aria-live', 'polite');
      document.body.appendChild(box);
    }
    return box;
  }
  C.toast = function (text, ms = 5000) {
    const box = toastBox();
    for (const el of box.children) if (el.textContent === text) return;
    const el = document.createElement('div');
    el.className = 'couch-toast'; el.textContent = text;
    box.appendChild(el);
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 320); }, ms);
  };
  const who = jc => (J.single ? '' : `P${jc.player + 1} `) + jc.name;
  function watchSound(t) {   // 조이콘만 눌렀을 땐 브라우저가 소리를 안 열어 줌 (사람이 직접 클릭·키 입력을 한 번 해야 함)
    const A = opts.audio;
    if (soundSaid || !A) return;
    if (!A.ctx || A.ctx.state !== 'suspended' || document.hidden) { soundSince = t; return; }
    if (t - soundSince > 2) { soundSaid = true; C.toast('소리를 켜려면 화면을 한 번 클릭하거나 아무 키나 눌러 주세요', 9000); }
  }

  // ---------- 살피기 ----------
  C.poll = function () {
    const L = active(), t = clock();
    if (cur && (!L || L !== lastLayer || !alive(L, cur))) setCur(null);
    lastLayer = L;
    if (L && L.auto && !cur && !mouse && (J && J.list.some(j => j.ok) || liveGamepads().length)) setCur(firstOf(L));
    if (J) pollSticks(L, t);
    if (opts.pads) for (const gp of liveGamepads()) C.pad(gp);
    watchSound(t);
  };
  C.attach = function (o) {
    opts = o; layers = o.layers || [];
    if (J) {
      J.wheel = !!o.wheel; J.nav = joyButtons;
      J.on('lost', jc => {
        lostOnes.add(jc.device);
        if (opts.lost) opts.lost(jc);
        C.toast(`${who(jc)} 연결이 끊겼어요 · 버튼을 눌러 다시 깨워 주세요`, 7000);
      });
      J.on('found', jc => { if (lostOnes.has(jc.device)) { lostOnes.delete(jc.device); C.toast(`${who(jc)} 다시 연결됐어요`); } });
      J.on('lowbattery', jc => C.toast(`${who(jc)} 배터리가 거의 없어요 · 곧 꺼질 수 있어요`, 7000));
    }
    window.addEventListener('pointerdown', () => { mouse = true; setCur(null); }, true);
    document.addEventListener('focusin', e => { if (cur && e.target !== cur) setCur(null); });   // 키보드로 다른 칸에 가면 표시를 치움
    setInterval(C.poll, 40);
  };
})();
