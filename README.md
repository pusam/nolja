# 놀자 🎮

거실 TV에서 조이콘 들고 같이 노는 게임 모음. 브라우저(PC 크롬·엣지)에서 돌아가고, 조이콘은 WebHID로 직접 읽음.

- 바로 하기: https://pusam.github.io/nolja/
- 게임: 🎾 테니스 (조이콘을 라켓처럼 휘둘러서 치는 2인 대결 · 몬스터 캐릭터 16종 · 3D)

## 하는 법

1. 노트북(그램 등) 블루투스에서 조이콘 L·R 각각 페어링 (레일 옆 동그란 버튼 길게)
2. 크롬으로 위 주소 열기 → 게임 메뉴에서 **조이콘 연결** (두 개면 두 번)
3. 노트북을 TV에 HDMI 연결 → `윈도우키 + P` → 두 번째 화면만 → TV 해상도 1920×1080 · 60Hz
4. `F` 전체화면, TV는 게임 모드

인터넷 없이 하려면 `start-game.bat` 더블클릭 (이 폴더를 http://localhost:8765 로 열어줌. 창은 켜둘 것).
파일을 직접 열면(file://) 크롬이 조이콘 연결을 막아서 키보드만 됨.

## 구조

```
index.html          홈 화면 (게임 고르기)
games/
  tennis/           테니스 (index.html + tennis.js)
shared/
  store.js          설정 저장 (게임끼리 공유: 캐릭터·감도·그래픽)
  joycon.js         조이콘 연결·스윙 감지·버튼·진동·기울기
  characters.js     몬스터 캐릭터 16종 (얼굴 그림 + 3D 모델 + 자세)
  audio.js          효과음 합성
  nolja.css         공용 스타일
  vendor/three.min.js  three.js r149 (MIT, THREE_LICENSE)
tools/test_tennis.js  테니스 로직 시뮬레이션 테스트 (node tools/test_tennis.js)
start-game.bat      오프라인 실행기
```

## 새 게임 추가

1. `games/게임이름/index.html` 만들고 `shared/*.js`를 불러와서 사용 (`window.Nolja.joycon`, `.characters`, `.audio`, `.store`)
2. 루트 `index.html`의 `GAMES` 목록에 한 줄 추가

## 그래픽

2018년형 노트북 내장그래픽(인텔 UHD 620)에서도 돌아가게 가볍게 만듦. 렌더 해상도는 최대 1080p, 메뉴의 그래픽 설정에서 자동/높음/보통/낮음/2D 선택 (자동은 느리면 알아서 낮춤).
