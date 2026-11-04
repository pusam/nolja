/* Layout and accessible controls around the game; rules stay in bowling.js. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const menu = $('menu'), stage = $('laneStage'), preview = $('lanePreview');
  const guide = $('guideDialog'), game = window.__BW;
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let previewPaused = motion.matches;
  const setup = menu.querySelector('.match-setup');
  const setupFields = document.createElement('div');
  setupFields.className = 'setup-fields';
  setupFields.setAttribute('role', 'group');
  setupFields.setAttribute('aria-label', '경기 옵션');
  setup.querySelectorAll(':scope > .setup-group').forEach(group => setupFields.appendChild(group));
  setup.querySelector('.start-area').before(setupFields);
  setup.id = 'matchSetup';
  const setupJump = document.createElement('button');
  setupJump.type = 'button';
  setupJump.className = 'setup-jump';
  setupJump.setAttribute('aria-controls', setup.id);
  setupJump.innerHTML = '게임 설정하고 시작하기 <svg class="icon" aria-hidden="true"><use href="#i-arrow"/></svg>';
  setupJump.addEventListener('click', () => {
    $('setupTitle').tabIndex = -1;
    $('setupTitle').focus({ preventScroll: true });
    setup.scrollIntoView({ behavior: motion.matches ? 'auto' : 'smooth', block: 'start' });
  });
  menu.querySelector('.page-heading').after(setupJump);
  const toolbar = document.createElement('div');
  toolbar.className = 'game-toolbar';
  toolbar.hidden = true;
  toolbar.innerHTML = '<button type="button" id="btnGamePause">일시정지 <kbd>Esc</kbd></button><button type="button" id="btnGameFull" aria-label="게임 전체화면">전체화면</button>';
  document.body.appendChild(toolbar);
  const OPTION_BUTTONS = '#modeRow button, #countRow button, #cpuRow button, #frameRow button, #qRow button, #guideRow button';
  function updatePreviewButton() {
    $('btnPreview').textContent = previewPaused ? '▷' : 'Ⅱ';
    $('btnPreview').setAttribute('aria-pressed', String(previewPaused));
    $('btnPreview').setAttribute('aria-label', previewPaused ? '시범 경기 재생' : '시범 경기 일시정지');
  }
  function syncLayout() {
    const inMenu = !menu.classList.contains('hidden');
    if (!inMenu && guide.open) guide.close();   // a controller button can leave the menu while the guide is open
    const parent = inMenu ? preview : document.body;
    if (stage.parentElement !== parent) parent.prepend(stage);
    game.setDemoPaused(inMenu && previewPaused);
    toolbar.hidden = inMenu || game.game.demo || !$('select').classList.contains('hidden') || !$('pause').classList.contains('hidden') || !$('result').classList.contains('hidden');
    document.querySelectorAll(OPTION_BUTTONS).forEach(button => { button.setAttribute('aria-pressed', String(button.classList.contains('on'))); });
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
  // Let native controls keep only the keys they actually use; everything else (Enter to start, F, game keys) reaches the game.
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
  document.querySelectorAll(OPTION_BUTTONS).forEach(button => button.addEventListener('click', syncLayout));
  new ResizeObserver(() => window.dispatchEvent(new Event('resize'))).observe(preview);
  function syncRosterState() {
    const roster = $('roster'), current = game.sel.cards.find(card => card.cpu < 0 && !card.ready);
    roster.querySelectorAll('.tile').forEach(tile => {
      const k = Number(tile.dataset.k), selected = !!current && current.ch === k;
      const players = game.sel.cards.filter(card => card.ch === k).map(card => card.cpu >= 0 ? 'CPU' : `P${card.slot + 1}`);
      tile.setAttribute('aria-pressed', String(selected));
      tile.setAttribute('aria-label', `${game.CHARS[k].name}${players.length ? ', ' + players.join('·') + ' 선택됨' : ''}. ${selected ? '한 번 더 누르면 준비' : current ? `P${current.slot + 1} 캐릭터로 선택` : '모두 준비 완료'}`);
    });
    // Selection updates run before this observer, including the next player's turn.
    if (current && !$('select').classList.contains('hidden') && document.activeElement?.matches('#roster .tile')) {
      const selected = roster.querySelector(`.tile[data-k="${current.ch}"]`);
      if (selected && selected !== document.activeElement) {
        selected.focus({ preventScroll: true });
        selected.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
    }
  }
  new MutationObserver(syncRosterState).observe($('roster'), { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  const joycon = window.Nolja.joycon;
  const updateSlots = joycon.handlers.change;
  function updateConnection() {
    const count = joycon.list.length;
    $('connectionStatus').textContent = count ? `조이콘 ${count}개 연결됨 · R을 누른 채 팔을 뒤로 뺐다가 앞으로 휘두르며 놓아요.` : '키보드만으로도 바로 플레이할 수 있어요.';
    $('connectionStatus').closest('.connection-card').classList.toggle('is-connected', count > 0);
    if (count) $('controllerDetails').open = true;
  }
  joycon.on('change', () => { if (updateSlots) updateSlots(); updateConnection(); });
  const showWarning = () => { if (!$('hidWarn').classList.contains('hidden')) $('controllerDetails').open = true; };
  new MutationObserver(showWarning).observe($('hidWarn'), { attributes: true, childList: true, characterData: true, subtree: true });
  showWarning();   // bowling.js may have shown the "no Joy-Con here" warning before this observer existed
  updatePreviewButton();
  updateConnection();
  syncLayout();
})();
