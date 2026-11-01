#!/bin/sh
# 놀자 미니PC 동기화 — 공개 저장소 pusam/nolja 의 main 을 받아 my-platform nginx 정적 폴더에 풀어 둔다.
#  서버 크론이 5분마다 부른다:  */5 * * * * sh /home/dev/nolja/sync.sh >>/home/dev/nolja/sync.log 2>&1
#  화면에 필요한 index.html · games/ · shared/ 만 넣는다 (tools/ · README 는 안 넣음).
#  rsync --delete 로 내용만 바꿔 폴더 inode 를 지킨다 — 폴더를 통째로 바꾸면 nginx 바인드 마운트가 옛 폴더를 본다.
#  새 커밋이 없으면 아무것도 안 하고, 바꿨을 때만 한 줄 남긴다. 크론은 /bin/sh(dash)라 bash 문법을 쓰지 않는다.
#  설치는 README '미니PC에 올리기'.
set -eu
DIR=${NOLJA_DIR:-/home/dev/nolja}
DEST=${NOLJA_DEST:-/home/dev/my-platform/nginx/nolja-dist}
exec 9>"$DIR/sync.lock"
flock -n 9 || exit 0
git --git-dir="$DIR/repo.git" fetch -q origin main
rev=$(git --git-dir="$DIR/repo.git" rev-parse FETCH_HEAD)
if [ -d "$DEST" ] && [ "$rev" = "$(cat "$DIR/deployed" 2>/dev/null || true)" ]; then exit 0; fi
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
git --git-dir="$DIR/repo.git" archive "$rev" index.html games shared | tar -x -C "$tmp"
mkdir -p "$DEST"
rsync -a --delete --chmod=Du=rwx,Dgo=rx,Fu=rw,Fgo=r "$tmp"/ "$DEST"/
echo "$rev" > "$DIR/deployed"
echo "$(date '+%F %T') $(git --git-dir="$DIR/repo.git" log -1 --format='%h %s' "$rev")"
