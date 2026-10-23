/* ============================================================
 * 놀자 공용 저장소 — 브라우저(localStorage)에 설정을 저장
 *
 * 모든 게임이 같은 키를 쓰면 설정이 이어진다.
 *   chars        [P1, P2] 캐릭터 번호 (shared/characters.js의 CHARS 순서)
 *   sensitivity  조이콘 스윙 감도 (0.6 ~ 1.6, 기본 1)
 *   latencyMs    화면·블루투스 지연 보정 (ms, 기본 50)
 *   quality      그래픽 단계 auto · high · mid · low · 2d
 *   swapped      조이콘 P1 ↔ P2 바꿈 여부
 * 게임 전용 설정은 '게임이름.키' 형식으로 저장 (예: tennis.mode)
 * ============================================================ */
(function () {
  'use strict';
  const N = window.Nolja = window.Nolja || {};
  const PREFIX = 'nolja.';

  N.store = {
    get(key, fallback) {
      try {
        const v = localStorage.getItem(PREFIX + key);
        return v === null ? fallback : JSON.parse(v);
      } catch (e) { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); } catch (e) { /* 저장이 막힌 환경은 무시 */ }
    },
  };

  // 공용 설정 읽기 (값이 이상하면 기본값으로)
  N.prefs = function () {
    const S = N.store;
    const p = {
      chars: S.get('chars', [0, 1]),
      sensitivity: +S.get('sensitivity', 1),
      latencyMs: +S.get('latencyMs', 50),
      quality: S.get('quality', 'auto'),
    };
    if (!['auto', 'high', 'mid', 'low', '2d'].includes(p.quality)) p.quality = 'auto';
    if (!(p.sensitivity >= 0.6 && p.sensitivity <= 1.6)) p.sensitivity = 1;
    if (!(p.latencyMs >= 0 && p.latencyMs <= 200)) p.latencyMs = 50;
    return p;
  };
})();
