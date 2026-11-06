// 사이트 점검: 페이지가 부르는 파일이 다 있는지 · ?v= 값이 맞는지 · 미니PC에도 올라가는 자리인지 · 스크립트가 찾는 화면 요소가 있는지
//  실행: node tools/test_site.js
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const PAGES = ['index.html', 'games/tennis/index.html', 'games/kart/index.html', 'games/bowling/index.html'];
const SCRIPTS = { 'games/tennis/index.html': ['tennis.js', 'tennis-ui.js'], 'games/kart/index.html': ['kart.js', 'kart-ui.js'], 'games/bowling/index.html': ['bowling.js', 'bowling-ui.js'] };
let pass = 0, fail = 0;
function assert(ok, msg) { if (ok) { pass++; console.log('  ✓ ' + msg); } else { fail++; console.log('  ✗ ' + msg); } }
const deployed = f => f === 'index.html' || f.startsWith('games/') || f.startsWith('shared/');   // tools/minipc-sync.sh가 올리는 자리

for (const page of PAGES) {
  console.log('\n' + page);
  const html = read(page), dir = path.posix.dirname(page);
  const refs = [...html.matchAll(/(?:src|href)="([^"#][^"]*)"/g)].map(m => m[1]).filter(u => !/^(https?:|data:|mailto:)/.test(u));
  const files = refs.map(u => { const [f, q] = u.split('?'); return { u, f: path.posix.normalize(path.posix.join(dir, f)), q }; });
  const missing = files.filter(x => !fs.existsSync(path.join(root, x.f)));
  assert(!missing.length, `부르는 파일 ${files.length}개가 다 있음${missing.length ? ' — 없음: ' + missing.map(x => x.u).join(', ') : ''}`);
  const outside = files.filter(x => !deployed(x.f));
  assert(!outside.length, `모두 미니PC에도 올라가는 자리${outside.length ? ' — 밖: ' + outside.map(x => x.f).join(', ') : ''}`);
  const code = files.filter(x => /\.(js|css)$/.test(x.f) && !x.f.includes('/vendor/'));
  const versions = new Set(code.map(x => x.q));
  assert(code.every(x => /^v=\d{8}[a-z]$/.test(x.q || '')) && versions.size === 1, `js·css ${code.length}개의 ?v= 값이 하나 (${[...versions].join(', ')})`);
  const uses = [...html.matchAll(/<use href="#([\w-]+)"/g)].map(m => m[1]), symbols = new Set([...html.matchAll(/ id="([\w-]+)"/g)].map(m => m[1]));
  const noSym = [...new Set(uses)].filter(id => !symbols.has(id));
  assert(!noSym.length, `아이콘 ${new Set(uses).size}개가 페이지에 있음${noSym.length ? ' — 없음: ' + noSym.join(', ') : ''}`);
  assert(/<title>[^<]+<\/title>/.test(html) && /<link rel="icon"/.test(html) && /<meta name="description"/.test(html) && /property="og:image"/.test(html), '제목 · 아이콘 · 설명 · 공유 그림');
  const scripts = [...html.matchAll(/<script src="([^"?]+)/g)].map(m => m[1].replace(/^.*\//, ''));
  if (scripts.includes('couch.js')) assert(scripts.indexOf('joycon.js') >= 0 && scripts.indexOf('joycon.js') < scripts.indexOf('couch.js'), 'couch.js는 joycon.js 뒤');
  for (const js of SCRIPTS[page] || []) {
    const src = read(path.posix.join(dir, js));
    const ids = [...new Set([...src.matchAll(/\$\('([\w-]+)'\)/g)].map(m => m[1]))];
    const madeInJs = new Set([...src.matchAll(/id="([\w-]+)"/g)].map(m => m[1]));
    const absent = ids.filter(id => !html.includes(`id="${id}"`) && !madeInJs.has(id));
    assert(!absent.length, `${js}가 찾는 화면 요소 ${ids.length}개가 있음${absent.length ? ' — 없음: ' + absent.join(', ') : ''}`);
  }
}

console.log('\n공유 파일');
const icon = read('shared/icon.svg');
assert(icon.includes('<svg') && icon.includes('viewBox'), '아이콘 shared/icon.svg');
assert(fs.statSync(path.join(root, 'shared/og.jpg')).size < 200 * 1024, '공유 그림 shared/og.jpg (200KB 안)');
console.log(`\n${fail ? '❌' : '✅'} 통과 ${pass} · 실패 ${fail}`);
process.exitCode = fail ? 1 : 0;
