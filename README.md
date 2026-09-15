# Never Miss a Game: a sports concierge agent

The kit from the O'Reilly session "Zero to Agent in 30 Minutes: Never Miss a Game" (September 16, 2026). An agent that reads ten committed sports schedules and a list of teams you follow, decides what is worth your evening, and sends you ONE message a week. No app, no server, no API keys, no paid data. The agent is the integration layer.

The whole thing is four files plus a scheduler entry.

| File | Role |
| --- | --- |
| `read-schedules.mjs` | The data layer. A zero-dependency Node script that reads ten sports-tracker repos, normalizes two incompatible data shapes into one game record, and prints a week. Deterministic, read-only, about 0.3 seconds. |
| `preferences.json` | The teams you follow, keyed by `{sport, abbr}`, each with a `why` note the digest draws on. Edit this, and nothing else, to make the agent yours. |
| `concierge.md` | The agent's job description, written as prose. **This is the file written live in the session.** On `main` it is an outline; `git checkout complete` for the finished text. |
| `notify.sh` | Delivery: stdout, a macOS banner, an archive file on disk, and an optional phone push through ntfy.sh. |
| `run-concierge.sh` | The headless run: `claude -p` with a narrow, read-only tool allowlist. This is what the scheduler fires. |
| `game-day-concierge.plist` | A launchd entry for Wednesdays at 7:00. Not installed by anything in this repo. |
| `clone-viewers.sh` | Fetches the ten schedule repos, plus the hub's helper modules, into the folder the tool expects. |
| `examples/` | What the data looks like at every link of the chain, from the preferences file to the message on the phone, all from one real run. **Start here** if you want to understand the pieces before running anything. |

## The chain

```
preferences.json  +  ten schedule repos on disk
        |
        v
read-schedules.mjs      one tool call, about 0.3 s, prints the week          examples/02, 03
        |
        v
concierge.md            the policy: what counts, what to ignore, the shape    examples/04
        |               of one message. The agent reads the tool output
        |               and exercises judgment.                              examples/05
        v
notify.sh               one message, delivered three ways                    examples/06, 07
```

## Run it

You need Node 18 or newer, git, and the Claude Code CLI (`claude`) installed and signed in. There is nothing to `npm install`.

```bash
cd never-miss-a-game
./clone-viewers.sh        # eleven shallow clones into ../sports-trackers, about 30 seconds

# 1. The data layer on its own, no agent involved.
node read-schedules.mjs --days 7 --prefs preferences.json --all

# 2. The notifier on its own.
./notify.sh "Concierge test" "If you can see this, delivery works."

# 3. The whole agent, headless, with the finished policy. Budget 90 to 160 seconds.
git checkout complete
./run-concierge.sh
```

To watch the agent work instead, run the same prompt interactively from this directory:

```bash
claude --allowedTools "Bash(node ./read-schedules.mjs:*)" "Bash(./notify.sh:*)" "Read" --permission-mode default "$(cat concierge.md)"
```

The `:*` after each script is load-bearing. It means "this exact script, any arguments"; without it the agent cannot pass `--days 7` and the run dies on its first tool call. Run these commands in a plain terminal, never inside an open `claude` session.

Useful variations: `--tz Europe/London` moves every time in the digest; `--days 14` widens the window when the calendar is quiet; `--json` gives the machine-readable form; `CONCIERGE_NOW=2026-09-16 ./run-concierge.sh` runs for another date, which is how `examples/` was produced.

## Make it yours

Edit the `followed` array in `preferences.json`: sport, abbreviation, label, and a `why` note in your own words. The abbreviation must be the one the data uses (the Warriors are `GS`, not `GSW`; the Bears are `CHI`), and abbreviations collide across sports (`MIN` is both the Lynx and the Vikings), which is why every entry carries a sport. Before running the agent, run the tool read and check that your team appears under `Following` by its full name. A wrong abbreviation fails silently at run time; it fails visibly here.

A team whose league is between seasons gets one honest line with its committed return date. A team outside the ten repos (NHL, college football) gets an honest "not among my sources"; the policy prefers a reported miss to an invented schedule.

## Put it on a schedule

`game-day-concierge.plist` fires `run-concierge.sh` every Wednesday at 7:00 local time. Replace the two placeholders in it first (`/PATH/TO/never-miss-a-game` and `/Users/YOUR-USER`; launchd does not expand `~`), then:

```bash
mkdir -p ~/Library/Logs/game-day-concierge
cp game-day-concierge.plist ~/Library/LaunchAgents/local.game-day-concierge.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/local.game-day-concierge.plist
launchctl print gui/$(id -u)/local.game-day-concierge     # confirm it registered
```

To fire it once without waiting: `launchctl kickstart -p gui/$(id -u)/local.game-day-concierge`. To remove it: `launchctl bootout gui/$(id -u)/local.game-day-concierge`. Logs land in `~/Library/Logs/game-day-concierge/`: `run-YYYY-MM-DD.log` is everything the agent said, `digest-YYYY-MM-DD.md` is just the message. If the Mac is asleep at 7:00, launchd runs the job at the next wake, which is why this is a launchd entry and not a cron line.

To get the digest on a phone, install the ntfy app, subscribe to a long random topic string, and set `NTFY_TOPIC` to that string in the plist's `EnvironmentVariables` (or export it in the shell that runs the agent). Anyone who knows the topic can read it, so treat it as a password and never commit it.

## Why it is safe to leave running

The allowlist in `run-concierge.sh` is the security boundary: `Bash(node ./read-schedules.mjs:*)`, `Bash(./notify.sh:*)`, and `Read`. Not `Bash(node:*)`, which would permit arbitrary JavaScript, and certainly not `Bash(*)`. There is no `Write`, no `Edit`, and no `git` verb. With `--permission-mode default`, anything off the list is refused loudly in the log instead of silently escalated, and in a headless run there is nobody to approve a prompt. Nothing in this directory can modify the schedule repos.

`run-concierge.sh` also verifies the effect rather than the report: `notify.sh` writes the digest to disk itself, and the run fails if that file does not exist, no matter what the agent said.

## The data

The ten repos are the public sports-tracker sites collected at https://ismayc.github.io/sports-trackers/. Each commits its full schedule to `src/data/` and refreshes nightly. The hub lists more viewers than the tool reads (archived tournaments and the FIBA World Cups); the ten in `clone-viewers.sh` are the ones in the tool's source catalogue.

Two things in that data will fool a naive agent, and the policy names both. The World Cup repo commits no results and still labels its 32 knockout matches "Winner Group C" and the like, so an agent reading the file literally sees a tournament that never finished, between teams that do not exist. And the NFL and Premier League repos commit no score field, so a past game with no result is "we do not have the result", never "this has not happened yet". The tool marks both cases (`placeholder`, `past-unresolved`) and the policy says what to do with them.

## Branches

- `main`: the kit with `concierge.md` as an outline, for writing the policy yourself.
- `complete`: the same kit with the finished policy, the one that produced `examples/`.
