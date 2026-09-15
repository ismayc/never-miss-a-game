# Never Miss a Game: a sports concierge agent

One message a week about what is worth watching, built from schedules that already sit on disk. No app, no server, no API keys, no paid data. This is the kit from the O'Reilly session "Zero to Agent in 30 Minutes: Never Miss a Game" (September 16, 2026).

## The idea

Every sport I follow has a site that is good at its own game. None of them knows about my week. I wanted one message on my phone, only about games I care about, and quiet when there is nothing worth watching.

```mermaid
%%{init: {"flowchart": {"nodeSpacing": 50, "rankSpacing": 60, "padding": 16}}}%%
flowchart TD
    F["preferences-editor.html<br/>a form over that file, optional"] -. "writes" .-> P
    P["preferences.json<br/>the teams you follow"] --> det
    R[("ten schedule repos<br/>committed data on disk")] --> det
    subgraph det["Deterministic: questions with one right answer"]
        T["read-schedules.mjs<br/>reads the schedules, prints the week<br/>0.3 s, zero dependencies"]
    end
    det -- "an 8 KB plain-text summary of the week" --> jud
    subgraph jud["Judgment: what is worth your evening"]
        M["concierge.md<br/>the policy, written as a job description"] --> A["the agent<br/>claude -p with a read-only allowlist"]
    end
    L["launchd<br/>Wednesdays, 7:00"] -. "fires the run weekly" .-> jud
    A -- "ONE message" --> N["notify.sh<br/>delivers it, and writes it to disk"]
    N --> PH[("your phone")]
```

Two halves. Everything with one right answer (parsing, time zones, "is this a real fixture") lives in a small tool. Only what has no single right answer (which games matter, and why) lives in a written policy that the agent follows. Listing games is a script; deciding which four matter, and saying "nothing this week" when that is true, is judgment.

For one of the ten sources, end to end: the WNBA site's repo commits its season as one JSON object per game (`tip` in UTC, `home` and `away` as abbreviations, a `score` once the game is played), plus a team file that says ATL is the Atlanta Dream. The tool imports both files as modules, looks the abbreviations up, moves the tip to your clock and your calendar day, marks the game scheduled, final, or past with no result, and writes the one record shape every source shares. The other nine differ only in field names and in which of two shapes they use. "One repo, end to end" in `TECHNICAL.md` shows the actual rows.

## Try it

You need a Mac or Linux machine with Node 18 or newer, git, and the Claude Code CLI (`claude`) installed and signed in. Nothing to install beyond that. The schedule data comes from the public repos behind https://ismayc.github.io/sports-trackers/, fetched by the first command below; nothing here depends on the author's computer.

```bash
git clone https://github.com/ismayc/never-miss-a-game.git
cd never-miss-a-game
./clone-viewers.sh                                               # fetch the schedule data
node read-schedules.mjs --days 7 --prefs preferences.json --all  # the data layer, on its own
git checkout complete                                            # the finished policy
./run-concierge.sh                                               # the whole agent, 90 to 160 seconds
```

The message prints in the terminal and is saved to disk. `examples/` shows what every step looks like: on `main`, what exists before the run (the preferences file and the tool's output); on `complete`, what the run produces (the transcript, the message, the delivery). Read along there before running anything. To see the preferences file as a form before you clone anything, open https://ismayc.github.io/never-miss-a-game/preferences-editor.html and click "Try the example".

## Make it yours

Edit the `followed` list in `preferences.json`: the sport, the team's abbreviation, its name, and a line on why you care. Run the data layer again and check your team appears under `Following` by full name. Then run the agent. That file is the only thing the agent knows about you.

The form can also show you the week without a shell. Its "Read this week's schedules" button fetches a read that this repo's own GitHub Actions workflow (`.github/workflows/read-schedules.yml`) produces every few hours: the same `read-schedules.mjs`, run on GitHub's machines with the same flags as the policy's tool line, committed under `docs/reads/`, and served by GitHub Pages. The page checks the teams you have ticked against that read, lists each one's games under a Following line, and can hand you the week as text, JSON, or CSV. Nothing runs on your computer for that, and the agent never uses it: your own run reads your own clone.

To have the message reach your phone, install the free ntfy app, pick a long random topic name, and export it as `NTFY_TOPIC` before the run. "The phone" in `TECHNICAL.md` has the three steps and a one-line test. Without it, the message prints in the terminal and is saved to disk, and nothing leaves your machine.

If you would rather not edit JSON by hand, use the form at https://ismayc.github.io/never-miss-a-game/preferences-editor.html (the same page is `preferences-editor.html` in this repo; double-click it). Click Open and pick your `preferences.json`, tick your teams, type a line for each, set the snark slider, and Save. Chrome and Edge write the file back in place through the browser's file picker; any other browser downloads a `preferences.json` to put over the one in your checkout. It lists every team the ten repos know by the abbreviation the data uses. No server, nothing to install, and nothing leaves your machine. The agent never sees the page; it reads the file.

## Read next

- https://ismayc.github.io/never-miss-a-game/: the whole story on one page, for someone who has never built an agent.
- https://ismayc.github.io/never-miss-a-game/preferences-editor.html: the preferences form, with the session's own file one click away.
- `examples/README.md`: one real run, file by file. Inputs on `main`, outputs on `complete`.
- `HOW-IT-FITS-TOGETHER.md`: what already existed, what was built, and each decision with its road not taken.
- `WRITING-THE-POLICY.md`: how the policy file is structured, the practice behind each section, and a checklist for your own.
- `TECHNICAL.md`: the files, what happens in one run, the data traps the tool handles, scheduling, the phone, and the safety boundary.
- The data: https://ismayc.github.io/sports-trackers/
