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
  // 기록판 · 트로피 진열장: 코스·컵마다 트로피와 최고 기록, 빈자리도 그대로 보여 줌. 누르면 그 코스를 골라 바로 도전 (규칙은 kart.js recordBoard)
  const records = $('recordDialog');
  const LEVELS = ['쉬움', '보통', '어려움'];
  const recordGroups = [['basic', '기본 코스'], ['challenge', '도전 코스'], ['adventure', '모험 코스'], ['legend', '전설 코스']];
  const trophyBadge = t => `<span class="record-trophy ${t ? 't' + t.p : 'empty'}" aria-hidden="true"><svg class="icon"><use href="#i-trophy"/></svg>${game.hasCrown(t) ? '<svg class="icon record-crown"><use href="#i-crown"/></svg>' : ''}</span>`;
  const trophyWords = t => t ? `${game.TROPHY_NAME[t.p]} 트로피 · ${LEVELS[t.lv]}${game.hasCrown(t) ? ' · 왕관' : ''}` : '빈자리';
  const courseTimes = x => [x.lap ? `바퀴 ${game.fmtTime(x.lap)}` : '', ...x.race.map(r => `${r.laps}바퀴 ${game.fmtTime(r.t)}`)].filter(Boolean).join(' · ') || '아직 기록이 없어요';
  const courseThumb = i => { const thumb = courseRow.querySelector(`button[data-course="${i}"] .course-thumb`); return thumb ? thumb.outerHTML : ''; };
  const recordCard = (x, times, thumb, attr) => `<button type="button" class="record-card${x.trophy ? '' : ' is-empty'}" ${attr} aria-label="${x.name}, ${trophyWords(x.trophy)}, ${times}. 누르면 이 코스를 골라요">${trophyBadge(x.trophy)}<span class="record-text"><strong>${x.name}</strong><span class="record-medal">${trophyWords(x.trophy)}</span><span class="record-times">${times}</span></span>${thumb}</button>`;
  function nextGoalText(next) {
    if (!next) return '트로피를 전부 금으로, 왕관까지 다 모았어요!';
    if (!next.trophy) return `다음 도전: ${next.name} · 3등 안에 들면 트로피`;
    return next.trophy.p > 1 ? `다음 도전: ${next.name} · 1등 하면 금 트로피` : `다음 도전: ${next.name} · 어려움에서 1등 하면 왕관`;
  }
  function renderRecords() {
    const board = game.recordBoard(), percent = Math.round(board.got / board.total * 100), next = board.next;
    const sections = recordGroups.map(([id, title]) => `<section class="record-group"><h3>${title}</h3><div class="record-grid">${board.courses.filter(x => groupOfCourse(x.course) === id).map(x => recordCard(x, courseTimes(x), courseThumb(x.course), `data-course="${x.course}"`)).join('')}</div></section>`);
    sections.push(`<section class="record-group"><h3>그랑프리 컵</h3><div class="record-grid">${board.cups.map(x => recordCard(x, x.score ? `최고 ${x.score}점` : '아직 기록이 없어요', '', `data-gp="${x.gp}"`)).join('')}</div></section>`);
    $('recordBody').innerHTML = `<div class="record-summary"><div class="record-total"><strong>${board.got}</strong><span>/ ${board.total}개</span></div><div class="record-progress"><div class="record-bar" role="progressbar" aria-label="모은 트로피" aria-valuenow="${board.got}" aria-valuemin="0" aria-valuemax="${board.total}"><i style="width:${percent}%"></i></div><ul class="record-medals"><li class="t1">금 ${board.gold}</li><li class="t2">은 ${board.silver}</li><li class="t3">동 ${board.bronze}</li><li class="crown">왕관 ${board.crown}</li></ul></div></div>
      <button type="button" class="record-next"${next ? (next.gp ? ` data-gp="${next.gp}"` : ` data-course="${next.course}"`) : ' disabled'}>${nextGoalText(next)}${next ? ' <span aria-hidden="true">→</span>' : ''}</button>
      <p class="record-rule">코스를 1·2·3등으로 완주하면 금·은·동, 그랑프리는 종합 순위로 받아요. 어려움에서 1등 하면 왕관이 붙어요. 이 브라우저에 저장돼요.</p>${sections.join('')}`;
  }
  function updateRecordChip() { const board = game.recordBoard(); $('recordCount').textContent = `${board.got}/${board.total}`; }
  let recordsByMouse = false;
  $('btnRecords').addEventListener('click', event => { recordsByMouse = event.detail > 0; renderRecords(); records.showModal(); records.scrollTop = 0; });
  records.addEventListener('close', () => { if (recordsByMouse) $('btnRecords').blur(); });
  $('btnRecordClose').addEventListener('click', () => records.close());
  records.addEventListener('click', event => {
    if (event.target === records) { const r = records.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) records.close(); return; }
    const pick = event.target.closest && event.target.closest('[data-course], [data-gp]');
    if (!pick) return;
    const target = courseRow.querySelector(pick.dataset.gp ? `button[data-gp="${pick.dataset.gp}"]` : `button[data-course="${pick.dataset.course}"]`);
    records.close();
    target.click();   // 메뉴에서 고른 것과 똑같이 (코스 바꾸고 시범 레이스도 그 코스로)
    showCourseGroup(pick.dataset.gp ? 'gp' : groupOfCourse(Number(pick.dataset.course)));
    setup.scrollIntoView({ behavior: motion.matches ? 'auto' : 'smooth', block: 'nearest' });
  });
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
    if (!inMenu && records.open) records.close();
    if (inMenu) updateRecordChip();
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
    if (guide.open || records.open) { event.stopImmediatePropagation(); return; }
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
