#!/usr/bin/env bash
# run-concierge.sh: the headless run. This is what launchd fires each week, and what you
# re-run after editing preferences.json.
#
# The whole agent is: one prompt file, one read-only data tool, one notifier. There is no
# server, no API client, no scheduler daemon of our own. `claude -p` IS the runtime.
#
# Optional environment:
#   CONCIERGE_NOW=2026-09-16 ./run-concierge.sh
#       Run for a different date. Appends `--now 2026-09-16` to the one tool line of the
#       prompt, in memory only; concierge.md itself is never edited. The files in
#       examples/ were produced this way, so a run on any later day can be compared.
#   CONCIERGE_LOG_DIR=/some/dir ./run-concierge.sh
#       Where the transcript and the digest land. Default ~/Library/Logs/game-day-concierge
#   CONCIERGE_PROGRESS=0 ./run-concierge.sh
#       Silence the progress line. It only appears when stderr is a terminal anyway, so a
#       launchd run never prints it.

set -uo pipefail

# Resolve our own directory so this works from launchd (whose cwd is /) and from anywhere,
# then work from it: the prompt refers to ./read-schedules.mjs and ./notify.sh.
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

PROMPT_FILE="$DIR/concierge.md"
LOG_DIR="${CONCIERGE_LOG_DIR:-$HOME/Library/Logs/game-day-concierge}"
mkdir -p "$LOG_DIR"
STAMP="$(date +%Y-%m-%d)"
TRANSCRIPT="$LOG_DIR/run-$STAMP.log"       # everything the agent said
DIGEST="$LOG_DIR/digest-$STAMP.md"         # just the message, written by notify.sh
export CONCIERGE_LOG_DIR="$LOG_DIR"

# launchd hands a job a minimal PATH that does not include Homebrew or a Node version
# manager, so `claude` and `node` are both invisible unless we put them back. This is the
# single most common reason a scheduled agent "silently does nothing".
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$PATH"

for bin in claude node; do
  command -v "$bin" >/dev/null 2>&1 || { echo "run-concierge.sh: '$bin' not on PATH ($PATH)" >&2; exit 127; }
done

[ -f "$PROMPT_FILE" ] || { echo "run-concierge.sh: missing prompt file $PROMPT_FILE" >&2; exit 66; }

PROMPT="$(cat "$PROMPT_FILE")"
if [ -n "${CONCIERGE_NOW:-}" ]; then
  # Exactly one line of the prompt ends in `--all`: the tool command. Give it a clock.
  PROMPT="$(sed "s|--all\$|--all --now $CONCIERGE_NOW|" "$PROMPT_FILE")"
  if [ "$PROMPT" = "$(cat "$PROMPT_FILE")" ]; then
    echo "run-concierge.sh: CONCIERGE_NOW is set but the prompt has no tool line ending in --all (is concierge.md still the stub?)" >&2
    exit 70
  fi
  echo "run-concierge.sh: simulated date $CONCIERGE_NOW"
fi

echo "run-concierge.sh: starting $(date -Iseconds)"

# The allowlist is the security boundary and it is deliberately narrow.
#
#   - The two Bash entries are pinned to our two scripts, so the agent can run OUR tools
#     and nothing else. `Bash(node:*)` would have allowed arbitrary JavaScript;
#     `Bash(*)` would have allowed arbitrary anything. The `:*` suffix means "this exact
#     script, any arguments"; without it the agent cannot pass --days 7 and the run dies
#     on its first tool call.
#   - The paths are relative to this directory, which is why this script cd's here first.
#     They must be spelled exactly the way the prompt spells them.
#   - Read is allowed because the prompt points it at preferences.json.
#   - Write, Edit, and every git verb are absent. There is no line here that can modify the
#     sports-tracker repos, which is the property that makes this safe to schedule.
#
# --permission-mode default means anything NOT on this list is refused rather than silently
# escalated; in a headless run there is nobody to approve a prompt, so an off-list tool call
# fails loudly in the log, which is exactly what we want.
#
# The agent runs in the background and writes straight to the transcript. `claude -p`
# prints nothing until it has finished, so streaming it would show nothing anyway; the
# transcript is printed in full once the run ends, exactly as before.
MARK="$(mktemp -t concierge-mark)"           # its mtime is "when this run started"
STATUS_FILE="$(mktemp -t concierge-status)"
(
  claude -p "$PROMPT" \
    --allowedTools \
      "Bash(node ./read-schedules.mjs:*)" \
      "Bash(./notify.sh:*)" \
      "Read" \
    --permission-mode default \
    >"$TRANSCRIPT" 2>&1
  echo "$?" >"$STATUS_FILE"
) &
AGENT=$!

# Progress, on stderr, only while a person is watching. The bar fills toward a typical
# two-minute run (September rehearsals: 53 to 130 s) and the label changes on the one
# thing this script can see from outside: the digest file, which notify.sh writes when the
# agent delivers. A digest newer than this run's start means the message is out and the
# agent is only writing its build notes.
if [ -t 2 ] && [ "${CONCIERGE_PROGRESS:-1}" != "0" ]; then
  T0="$(date +%s)"; TYPICAL=120; WIDTH=30
  while kill -0 "$AGENT" 2>/dev/null; do
    el=$(( $(date +%s) - T0 ))
    fill=$(( el * WIDTH / TYPICAL )); [ "$fill" -gt "$WIDTH" ] && fill=$WIDTH
    bar="$(printf '%*s' "$fill" '' | tr ' ' '#')$(printf '%*s' $(( WIDTH - fill )) '' | tr ' ' '.')"
    if [ -s "$DIGEST" ] && [ "$DIGEST" -nt "$MARK" ]; then
      phase="digest written, agent finishing its notes"
    elif [ "$el" -lt 8 ]; then
      phase="starting Claude Code"
    elif [ "$el" -gt 160 ]; then
      phase="past the usual budget, still running"
    else
      phase="one tool call, then judgment (typically 1 to 2 min)"
    fi
    printf '\r  [%s] %d:%02d  %s' "$bar" $(( el / 60 )) $(( el % 60 )) "$phase" >&2
    sleep 2
  done
  printf '\r%*s\r' 100 '' >&2                # wipe the bar before the transcript prints
fi

wait "$AGENT"
STATUS="$(cat "$STATUS_FILE" 2>/dev/null || echo 1)"
rm -f "$STATUS_FILE" "$MARK"
cat "$TRANSCRIPT"

echo "run-concierge.sh: finished $(date -Iseconds) with status $STATUS"
echo "run-concierge.sh: transcript at $TRANSCRIPT"

# Verify the EFFECT, not the report of the effect. The agent can exit 0 having said "sent"
# without a message ever existing; the digest file is written by notify.sh itself, so its
# presence is the only honest evidence that something was actually delivered.
if [ -s "$DIGEST" ]; then
  echo "run-concierge.sh: digest at $DIGEST ($(wc -c <"$DIGEST" | tr -d ' ') bytes)"
else
  echo "run-concierge.sh: WARNING, no digest written to $DIGEST; the agent did not call notify.sh" >&2
  [ "$STATUS" -eq 0 ] && STATUS=65
fi
exit "$STATUS"
