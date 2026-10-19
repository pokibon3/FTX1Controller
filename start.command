#!/bin/sh
# FTX-1 Controller をローカルで起動（Web Serial は http://localhost で動作します）
cd "$(dirname "$0")"
PORT=${PORT:-8765}
( sleep 1; open -a "Google Chrome" "http://localhost:$PORT/" 2>/dev/null || open "http://localhost:$PORT/" ) &
exec python3 -m http.server "$PORT" --bind 127.0.0.1
