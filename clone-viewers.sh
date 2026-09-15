#!/usr/bin/env bash
# clone-viewers.sh: fetch the schedule data the concierge reads.
#
# read-schedules.mjs reads ten public sports-tracker repos, plus a few small helper modules
# from the hub that ties them together, and it expects all of them under ONE folder with
# these exact local names. The local names are the tool's own source catalogue and differ
# from the GitHub repo names, which is the only reason this script exists.
#
# Default location: a sports-trackers/ folder NEXT TO this repo, which is where the tool
# looks when neither SPORTS_TRACKERS_ROOT nor --root is given.
#
#   ./clone-viewers.sh                    # into ../sports-trackers
#   ./clone-viewers.sh /some/other/dir    # anywhere; then run the tool with --root
#
# Safe to re-run: an existing clone is pulled, not re-cloned. Clones are shallow because
# the schedules are committed files and the tool only ever reads the current checkout.

set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_ROOT="$(dirname "$DIR")/sports-trackers"
ROOT="${1:-$DEFAULT_ROOT}"
mkdir -p "$ROOT"

# local folder name = GitHub repo name, all under https://github.com/ismayc/
REPOS=(
  "hub=sports-trackers"
  "the-wnba-schedule=wnba-schedule"
  "premier-league=premier-league"
  "the-nfl-schedule=nfl-schedule"
  "the-nba-schedule=nba-schedule"
  "the-mens-march-madness=mens-march-madness"
  "the-womens-march-madness=womens-march-madness"
  "world-cup-viewer=world-cup-viewer"
  "womens-world-cup-viewer=womens-world-cup-viewer"
  "football-euros-viewer=football-euros-viewer"
  "copa-america-viewer=copa-america-viewer"
)

for pair in "${REPOS[@]}"; do
  local_name="${pair%%=*}"
  repo="${pair#*=}"
  dest="$ROOT/$local_name"
  if [ -d "$dest/.git" ]; then
    printf 'update  %-28s\n' "$local_name"
    git -C "$dest" pull -q --ff-only || echo "        (pull failed; keeping the checkout as it is)"
  else
    printf 'clone   %-28s <-  ismayc/%s\n' "$local_name" "$repo"
    git clone -q --depth 1 "https://github.com/ismayc/$repo.git" "$dest"
  fi
done

echo
echo "Done. $ROOT holds ${#REPOS[@]} checkouts. Try the data layer on its own:"
if [ "$ROOT" = "$DEFAULT_ROOT" ]; then
  echo "  node read-schedules.mjs --days 7 --prefs preferences.json"
else
  echo "  node read-schedules.mjs --days 7 --prefs preferences.json --root \"$ROOT\""
fi
