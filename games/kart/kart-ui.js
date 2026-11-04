/* Layout and accessible controls around the race; rules stay in kart.js. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const menu = $('menu'), stage = $('kartStage'), preview = $('kartPreview');
  const guide = $('guideDialog'), game = window.__KT;
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
  toolbar.className = 'game-toolbar kart-toolbar';
  toolbar.hidden = true;
  toolbar.innerHTML = '<button type="button" id="btnGamePause">일시정지 <kbd>Esc</kbd></button><button type="button" id="btnGameFull" aria-label="게임 전체화면">전체화면</button>';
  document.body.appendChild(toolbar);
  // Browse the growing course collection in small, readable groups.
  const courseRow = $('courseRow');
  const courseButtons = [...courseRow.querySelectorAll('button')];
  const groupOfCourse = i => i < 4 ? 'basic' : i < 8 ? 'challenge' : i < 12 ? 'adventure' : 'legend';
  const courseGroup = button => button.dataset.gp ? 'gp' : groupOfCourse(Number(button.dataset.course));
  const courseGroups = [
    { id: 'basic', label: '기본', hint: '처음이라면 가볍게, 편안한 코스 4개' },
    { id: 'challenge', label: '도전', hint: '장애물과 다리를 넘는 긴 코스 4개' },
    { id: 'adventure', label: '모험', hint: '숨은 지름길을 탐험하는 모험 코스 4개' },
    { id: 'legend', label: '전설', hint: '장애물이 가득한 가장 어려운 코스 4개' },
    { id: 'gp', label: '그랑프리', hint: '코스 4개를 연달아 달리는 컵 대회 4개' }
  ];
  const courseFilters = document.createElement('div');
  courseFilters.className = 'course-filters';
  courseFilters.setAttribute('role', 'group');
  courseFilters.setAttribute('aria-label', '코스 종류');
  const courseHint = document.createElement('p');
  courseHint.className = 'course-browser-hint';
  const currentCourse = document.createElement('p');
  currentCourse.className = 'course-current';
  currentCourse.innerHTML = '<span>현재 선택</span><strong></strong>';
  let activeCourseGroup = game.settings.gp ? 'gp' : groupOfCourse(game.settings.course);
  function showCourseGroup(groupId) {
    activeCourseGroup = groupId;
    courseButtons.forEach(button => { button.hidden = !button.dataset.random && courseGroup(button) !== groupId; });
    courseFilters.querySelectorAll('button').forEach(button => {
      button.classList.toggle('on', button.dataset.group === groupId);
      button.setAttribute('aria-pressed', String(button.dataset.group === groupId));
    });
    courseHint.textContent = courseGroups.find(group => group.id === groupId).hint;
  }
  courseGroups.forEach(group => {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.group = group.id;
    button.textContent = group.label;
    button.setAttribute('aria-controls', 'courseRow');
    button.addEventListener('click', () => showCourseGroup(group.id));
    courseFilters.appendChild(button);
  });
  courseRow.classList.add('is-filtered');
  courseRow.before(courseFilters, courseHint, currentCourse);
  showCourseGroup(activeCourseGroup);
  function updatePreviewButton() {
    $('btnPreview').textContent = previewPaused ? '▷' : 'Ⅱ';
    $('btnPreview').setAttribute('aria-pressed', String(previewPaused));
    $('btnPreview').setAttribute('aria-label', previewPaused ? '시범 레이스 재생' : '시범 레이스 일시정지');
  }
  function updateRaceSummary() {
    const mode = document.querySelector('#modeRow button.on');
    const laps = document.querySelector('#lapRow button.on');
    const level = document.querySelector('#lvRow button.on');
    const cup = game.settings.gp ? game.CUPS[game.settings.gp - 1] : null;
    const course = game.settings.random ? { name: '랜덤 코스' } : cup || game.COURSES[game.settings.course];
    if (!mode || !laps || !level) return;
    currentCourse.querySelector('strong').textContent = course ? course.name : '';
    const summary = `${course ? course.name + ' · ' : ''}${mode.dataset.mode === '2p' ? '2인' : '1인'} + CPU · ${laps.dataset.laps}바퀴 · ${['쉬움', '보통', '어려움'][Number(level.dataset.lv)]}`;
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
  function syncRosterState() {
    const roster = $('roster');
    roster.querySelectorAll('.tile').forEach(tile => {
      const k = Number(tile.dataset.k), players = [];
      if (game.sel[0].idx === k) players.push('P1');
      if (game.settings.mode !== '1p' && game.sel[1].idx === k) players.push('P2');
      tile.setAttribute('aria-pressed', String(game.sel[0].idx === k));
      tile.setAttribute('aria-label', `${game.CHARS[k].name}${players.length ? ', ' + players.join('·') + ' 선택됨' : ''}. ${game.sel[0].idx === k ? '한 번 더 누르면 P1 준비' : 'P1 캐릭터로 선택'}`);
    });
    // Native Enter clicks the focused tile, so it must follow keyboard selection.
    if (game.settings.mode === '1p' && !$('select').classList.contains('hidden') && document.activeElement?.matches('#roster .tile')) {
      const selected = roster.querySelector(`.tile[data-k="${game.sel[0].idx}"]`);
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
    $('connectionStatus').textContent = count ? `조이콘 ${count}개 연결됨 · 가로로 잡고 기울여 보세요.` : '키보드만으로도 바로 달릴 수 있어요.';
    $('connectionStatus').closest('.connection-card').classList.toggle('is-connected', count > 0);
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
