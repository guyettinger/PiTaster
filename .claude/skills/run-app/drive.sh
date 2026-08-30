#!/bin/bash
# Wrapper around driver.mjs for agents with no tmux.
#
#   ./drive.sh start                  # boot the REPL (background) and launch the app
#   ./drive.sh <cmd> [<cmd> ...]      # send commands, print what the REPL said
#   ./drive.sh stop                   # quit the app and tear the REPL down
#
# Each argument is one REPL line, so quote anything containing spaces:
#   ./drive.sh 'open-app Magic 8 Ball' 'panel Preview' 'shot preview'
set -u

DIR="${TMPDIR:-/tmp}/anyapp-drive"
FIFO="$DIR/in.fifo"
LOG="$DIR/out.log"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SETTLE="${DRIVE_SETTLE:-2.5}"   # seconds to wait after each command

case "${1:-}" in
  start)
    mkdir -p "$DIR"
    pkill -f "$HERE/driver.mjs" 2>/dev/null
    pkill -f "tail -f $FIFO" 2>/dev/null
    rm -f "$FIFO" "$LOG"
    mkfifo "$FIFO"
    # `tail -f` keeps node's stdin open so the REPL survives between sends.
    # Every stream is detached: a background job still holding the caller's
    # stdout/stderr blocks the calling tool forever, even after this exits.
    nohup bash -c "tail -f '$FIFO' | node '$HERE/driver.mjs' > '$LOG' 2>&1" \
      </dev/null >/dev/null 2>&1 &
    disown 2>/dev/null || true
    for _ in $(seq 1 40); do grep -q 'driver>' "$LOG" 2>/dev/null && break; sleep 0.25; done
    echo 'launch' > "$FIFO"
    for _ in $(seq 1 120); do grep -qE 'launched|ERROR' "$LOG" 2>/dev/null && break; sleep 0.5; done
    cat "$LOG"
    ;;
  stop)
    [ -p "$FIFO" ] && echo 'quit' > "$FIFO" && sleep 3
    pkill -f "$HERE/driver.mjs" 2>/dev/null
    # The fifo-holder outlives node; without this it lingers on a deleted fifo.
    pkill -f 'tail -f .*anyapp-drive/in.fifo' 2>/dev/null
    rm -rf "$DIR"
    echo 'stopped'
    ;;
  '')
    echo "usage: drive.sh start | drive.sh <repl-command>... | drive.sh stop" >&2
    exit 2
    ;;
  *)
    if [ ! -p "$FIFO" ]; then echo "not started - run: ./drive.sh start" >&2; exit 1; fi
    : > "$LOG"
    for cmd in "$@"; do echo "$cmd" > "$FIFO"; sleep "$SETTLE"; done
    sleep 1
    cat "$LOG"
    ;;
esac
