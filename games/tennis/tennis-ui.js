/* Layout and accessible controls around the game; rules stay in tennis.js. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const menu = $('menu'), stage = $('courtStage'), preview = $('courtPreview');
  const guide = $('guideDialog'), game = window.__ST;
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let previewPaused = motion.matches;
  const toolbar = document.createElement('div');
  toolbar.className = 'game-toolbar';
  toolbar.hidden = true;
  toolbar.innerHTML = '<button type="button" id="btnGamePause">일시정지 <kbd>Esc</kbd></button><button type="button" id="btnGameFull" aria-label="게임 전체화면">전체화면</button>';
  document.body.appendChild(toolbar);
  function updatePreviewButton() {
    $('btnPreview').textContent = previewPaused ? '▷' : 'Ⅱ';
    $('btnPreview').setAttribute('aria-pressed', String(previewPaused));
    $('btnPreview').setAttribute('aria-label', previewPaused ? '시범 경기 재생' : '시범 경기 일시정지');
  }
  function syncLayout() {
    const inMenu = !menu.classList.contains('hidden');
    const parent = inMenu ? preview : document.body;
    if (stage.parentElement !== parent) parent.prepend(stage);
    game.setDemoPaused(inMenu && previewPaused);
    toolbar.hidden = inMenu || game.game.demo || !$('select').classList.contains('hidden') || !$('pause').classList.contains('hidden') || !$('result').classList.contains('hidden');
    document.querySelectorAll('#modeRow button, #lvRow button, #gwRow button, #qRow button').forEach(button => {
      button.setAttribute('aria-pressed', String(button.classList.contains('on')));
    });
    const isCPU = game.settings.mode === 'cpu';
    document.querySelectorAll('#lvRow button').forEach(button => { button.disabled = !isCPU; });
    $('lvRow').setAttribute('aria-disabled', String(!isCPU));
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
  $('btnGuide').addEventListener('click', () => guide.showModal());
  $('btnGuideClose').addEventListener('click', () => guide.close());
  guide.addEventListener('click', event => { if (event.target === guide) { const r = guide.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) guide.close(); } });
  // Let native buttons, disclosures and the dialog keep their keyboard behavior.
  window.addEventListener('keydown', event => {
    if (guide.open) { event.stopImmediatePropagation(); return; }
    const interactive = event.target instanceof Element ? event.target.closest('button, a, input, summary, select, textarea') : null;
    if (!interactive) return;
    if (event.code === 'Enter' || event.code === 'NumpadEnter' || event.code === 'Space') event.stopImmediatePropagation();
    if (interactive.matches('input') && event.code !== 'Escape') event.stopImmediatePropagation();
  }, true);
  $('btnGamePause').addEventListener('click', () => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape' })));
  $('btnGameFull').addEventListener('click', () => $('btnFull').click());
  const layoutObserver = new MutationObserver(syncLayout);
  [menu, $('select'), $('pause'), $('result')].forEach(element => layoutObserver.observe(element, { attributes: true, attributeFilter: ['class'] }));
  document.querySelectorAll('#modeRow button, #lvRow button, #gwRow button, #qRow button').forEach(button => button.addEventListener('click', syncLayout));
  new ResizeObserver(() => window.dispatchEvent(new Event('resize'))).observe(preview);
  const joycon = window.Nolja.joycon;
  const updateSlots = joycon.handlers.change;
  function updateConnection() {
    const count = joycon.list.length;
    $('connectionStatus').textContent = count ? `조이콘 ${count}개 연결됨 · 가볍게 휘둘러 보세요.` : '키보드만으로도 바로 플레이할 수 있어요.';
    if (count) $('controllerDetails').open = true;
  }
  joycon.on('change', () => { if (updateSlots) updateSlots(); updateConnection(); });
  new MutationObserver(() => {
    if (!$('hidWarn').classList.contains('hidden')) $('controllerDetails').open = true;
  }).observe($('hidWarn'), { attributes: true, childList: true, characterData: true, subtree: true });
  updatePreviewButton();
  updateConnection();
  syncLayout();
})();
