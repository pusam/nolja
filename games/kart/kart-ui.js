/* Layout and accessible controls around the race; rules stay in kart.js. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const menu = $('menu'), stage = $('kartStage'), preview = $('kartPreview');
  const guide = $('guideDialog'), game = window.__KT;
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let previewPaused = motion.matches;
  const toolbar = document.createElement('div');
  toolbar.className = 'game-toolbar kart-toolbar';
  toolbar.hidden = true;
  toolbar.innerHTML = '<button type="button" id="btnGamePause">일시정지 <kbd>Esc</kbd></button><button type="button" id="btnGameFull" aria-label="게임 전체화면">전체화면</button>';
  document.body.appendChild(toolbar);
  function updatePreviewButton() {
    $('btnPreview').textContent = previewPaused ? '▷' : 'Ⅱ';
    $('btnPreview').setAttribute('aria-pressed', String(previewPaused));
    $('btnPreview').setAttribute('aria-label', previewPaused ? '시범 레이스 재생' : '시범 레이스 일시정지');
  }
  function updateRaceSummary() {
    const mode = document.querySelector('#modeRow button.on');
    const laps = document.querySelector('#lapRow button.on');
    const level = document.querySelector('#lvRow button.on');
    const course = game.settings.gp ? { en: 'MONSTER CUP · 4 COURSES' } : game.COURSES[game.settings.course];
    if (!mode || !laps || !level) return;
    const summary = `${mode.dataset.mode === '2p' ? '2 PLAYERS' : '1 PLAYER'} + CPU  /  ${course ? course.en + '  /  ' : ''}${laps.dataset.laps} LAPS  /  ${['EASY', 'NORMAL', 'HARD'][Number(level.dataset.lv)]}`;
    if ($('setupSummary').textContent !== summary) $('setupSummary').textContent = summary;
  }
  function syncLayout() {
    const inMenu = !menu.classList.contains('hidden');
    if (!inMenu && guide.open) guide.close();   // a controller button can leave the menu while the guide is open
    const parent = inMenu ? preview : document.body;
    if (stage.parentElement !== parent) parent.prepend(stage);
    game.setDemoPaused(inMenu && previewPaused);
    toolbar.hidden = inMenu || game.game.demo || !$('select').classList.contains('hidden') || !$('pause').classList.contains('hidden') || !$('result').classList.contains('hidden');
    document.querySelectorAll('#modeRow button, #lvRow button, #lapRow button, #courseRow button, #qRow button').forEach(button => {
      button.setAttribute('aria-pressed', String(button.classList.contains('on')));
    });
    updateRaceSummary();
    $('select').classList.toggle('solo', $('selc1').classList.contains('hidden'));
    requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
  }
  $('btnPreview').addEventListener('click', () => {
    previewPaused = !previewPaused;
    game.setDemoPaused(previewPaused);
    updatePreviewButton();
  });
  motion.addEventListener('change', event => {
    previewPaused = event.matches;
    if (!menu.classList.contains('hidden')) game.setDemoPaused(previewPaused);
    updatePreviewButton();
  });
  // Opened with the mouse: drop focus on close so Enter starts the game instead of reopening the guide.
  let guideByMouse = false;
  $('btnGuide').addEventListener('click', event => { guideByMouse = event.detail > 0; guide.showModal(); });
  guide.addEventListener('close', () => { if (guideByMouse) $('btnGuide').blur(); });
  $('btnGuideClose').addEventListener('click', () => guide.close());
  guide.addEventListener('click', event => { if (event.target === guide) { const r = guide.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) guide.close(); } });
  // Let native controls keep only the keys they actually use; everything else (Enter to start, F, driving keys) reaches the game.
  window.addEventListener('keydown', event => {
    if (guide.open) { event.stopImmediatePropagation(); return; }
    const el = event.target instanceof Element ? event.target.closest('button, a, input, summary, select, textarea') : null;
    if (!el) return;
    const activate = event.code === 'Enter' || event.code === 'NumpadEnter' || event.code === 'Space';
    if (el.matches('textarea, select, input:not([type=checkbox]):not([type=range])')) { if (event.code !== 'Escape') event.stopImmediatePropagation(); }
    else if (el.matches('input[type=checkbox]')) { if (event.code === 'Space') event.stopImmediatePropagation(); }
    else if (el.matches('input[type=range]')) { if (event.code.startsWith('Arrow') || event.code === 'Home' || event.code === 'End' || event.code.startsWith('Page')) event.stopImmediatePropagation(); }
    else if (activate) event.stopImmediatePropagation();
  }, true);
  $('btnGamePause').addEventListener('click', () => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape' })));
  $('btnGameFull').addEventListener('click', () => $('btnFull').click());
  const layoutObserver = new MutationObserver(syncLayout);
  [menu, $('select'), $('pause'), $('result')].forEach(element => layoutObserver.observe(element, { attributes: true, attributeFilter: ['class'] }));
  new MutationObserver(() => {
    $('select').classList.toggle('solo', $('selc1').classList.contains('hidden'));
  }).observe($('selc1'), { attributes: true, attributeFilter: ['class'] });
  document.querySelectorAll('#modeRow button, #lvRow button, #lapRow button, #courseRow button, #qRow button').forEach(button => button.addEventListener('click', syncLayout));
  new ResizeObserver(() => window.dispatchEvent(new Event('resize'))).observe(preview);
  const joycon = window.Nolja.joycon;
  const updateSlots = joycon.handlers.change;
  function updateConnection() {
    const count = joycon.list.length;
    $('connectionStatus').textContent = count ? `조이콘 ${count}개 연결됨 · 가로로 잡고 기울여 보세요.` : '키보드만으로도 바로 달릴 수 있어요.';
    if (count) $('controllerDetails').open = true;
  }
  joycon.on('change', () => { if (updateSlots) updateSlots(); updateConnection(); });
  const showWarning = () => { if (!$('hidWarn').classList.contains('hidden')) $('controllerDetails').open = true; };
  new MutationObserver(showWarning).observe($('hidWarn'), { attributes: true, childList: true, characterData: true, subtree: true });
  showWarning();   // kart.js may have shown the "no Joy-Con here" warning before this observer existed
  updatePreviewButton();
  updateConnection();
  syncLayout();
})();
