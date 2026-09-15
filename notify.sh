#!/usr/bin/env bash
# notify.sh — deliver the finished digest. Three channels, no dependencies.
#
#   1. stdout          — always. The terminal is the channel that never fails.
#   2. macOS banner    — always, via osascript. Truncated: a notification is a nudge.
#   3. ntfy.sh topic   — only when NTFY_TOPIC is set. This is the one that lands on a phone.
#
# USAGE
#   ./notify.sh "Title" "Body text"
#   ./notify.sh "Title" < digest.txt          # body on stdin
#   NTFY_TOPIC=my-secret-topic ./notify.sh "This week" "..."
#
# NTFY_TOPIC is a shared secret, not an account: anyone who knows the string can read the
# topic. Use a long random one, keep it in the shell env, never in this file.

set -uo pipefail

TITLE="${1:-Game-day concierge}"

if [ $# -ge 2 ]; then
  BODY="$2"
else
  BODY="$(cat)" # body on stdin, so a digest can be piped straight in
fi

if [ -z "${BODY//[[:space:]]/}" ]; then
  echo "notify.sh: refusing to send an empty message" >&2
  exit 1
fi

# 1. stdout — the always-works channel.
echo "=============================================================="
echo "$TITLE"
echo "=============================================================="
echo "$BODY"
echo "=============================================================="

# 1b. A file copy, unconditionally. When this script is called by an agent, its stdout is a
# TOOL RESULT and never reaches the job log — so a run can succeed and leave no artifact
# behind. Writing the digest here means the message survives regardless of what the agent
# chooses to say afterwards. This is the break-glass copy.
ARCHIVE_DIR="${CONCIERGE_LOG_DIR:-$HOME/Library/Logs/game-day-concierge}"
if mkdir -p "$ARCHIVE_DIR" 2>/dev/null; then
  ARCHIVE="$ARCHIVE_DIR/digest-$(date +%Y-%m-%d).md"
  {
    echo "# $TITLE"
    echo
    echo "_Delivered $(date -Iseconds)_"
    echo
    echo "$BODY"
  } >"$ARCHIVE"
  echo "notify.sh: archived to $ARCHIVE"
fi

# 2. macOS notification centre. osascript needs its own quoting, so escape backslashes and
# double quotes, and flatten newlines — a banner is one line whatever we do.
if command -v osascript >/dev/null 2>&1; then
  short="$(printf '%s' "$BODY" | tr '\n' ' ' | cut -c1-230)"
  esc() { printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'; }
  osascript -e "display notification \"$(esc "$short")\" with title \"$(esc "$TITLE")\" sound name \"Glass\"" \
    || echo "notify.sh: osascript failed (non-fatal)" >&2
fi

# 3. ntfy.sh — push to a phone. Opt-in via env var so the default run is fully offline.
# The phone apps render plain text only (ntfy's Markdown header is web-app only), so for
# this channel alone the day headings and the "Editor's pick:" label are set in bold
# Unicode letters and each game line under a day gets a bullet. A day block is the
# heading and the lines up to the next blank line, so the opening sentence and the
# closing line stay as they are. stdout and the archive keep the plain text.
if [ -n "${NTFY_TOPIC:-}" ]; then
  PHONE_BODY="$(NOTIFY_BODY="$BODY" node -e '
    const bold = (s) => [...s].map((c) => {
      const n = c.codePointAt(0);
      if (n >= 65 && n <= 90) return String.fromCodePoint(0x1D5D4 + n - 65);   // A-Z
      if (n >= 97 && n <= 122) return String.fromCodePoint(0x1D5EE + n - 97);  // a-z
      return c;
    }).join("");
    const day = /^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)$/;
    let inDay = false;
    const out = process.env.NOTIFY_BODY.split("\n").map((line) => {
      if (day.test(line)) { inDay = true; return bold(line); }
      if (line.trim() === "") { inDay = false; return line; }
      const l = line.replace(/Editor.s pick:/g, (m) => bold(m));
      return inDay ? "• " + l : l;
    });
    process.stdout.write(out.join("\n"));
  ' 2>/dev/null || printf '%s' "$BODY")"
  if curl -fsS \
      -H "Title: $TITLE" \
      -H "Tags: sports_medal" \
      -d "$PHONE_BODY" \
      "https://ntfy.sh/${NTFY_TOPIC}" >/dev/null; then
    echo "notify.sh: pushed to ntfy.sh/${NTFY_TOPIC}"
  else
    echo "notify.sh: ntfy push failed (non-fatal)" >&2
  fi
else
  echo "notify.sh: NTFY_TOPIC unset — skipped phone push (stdout + banner only)"
fi
