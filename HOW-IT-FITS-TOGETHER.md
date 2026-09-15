# How it fits together

The session this kit comes from spent most of its thirty minutes on shape, not code. This page is the shape: what existed before, what was built, and why each piece is where it is. `README.md` has the run-time diagrams; `examples/` shows every file in use.

## What existed before the session, and what was built

```mermaid
%%{init: {"flowchart": {"nodeSpacing": 30, "rankSpacing": 80, "padding": 16}}}%%
flowchart TB
    subgraph had["Already there"]
        direction LR
        h1["ten sports-tracker sites<br/>schedules committed to disk,<br/>refreshed twice a day"]
        h2["Claude Code CLI<br/>claude -p: prompt in,<br/>tool calls, exit"]
        h3["launchd<br/>the Mac's own scheduler"]
        h4["ntfy.sh<br/>one POST to a topic<br/>lands on a phone"]
    end
    subgraph built["Built: five files and a plist"]
        direction LR
        b6["preferences-editor.html<br/>a form over preferences.json"]
        b1["read-schedules.mjs"]
        b2["concierge.md"]
        b3["notify.sh"]
        b4["run-concierge.sh"]
        b5["game-day-concierge.plist"]
    end
    had -- "used as they are: the sites by read-schedules.mjs, claude -p by run-concierge.sh, launchd by the plist, ntfy.sh by notify.sh" --> built
    b6 -. "writes preferences.json" .-> b1
    b1 --> b2 --> b3
    b4 -- "runs" --> b2
    b5 -- "fires" --> b4
```

Nothing on the top row was made for the session. The build is the connections. The hub that lists the sites is https://ismayc.github.io/sports-trackers/. The form was the last file built, the day before the session, and it sits outside the run: it writes the preferences file that the tool reads, and nothing else touches it. It is also served at https://ismayc.github.io/never-miss-a-game/preferences-editor.html.

## The two halves

```mermaid
%%{init: {"flowchart": {"nodeSpacing": 40, "rankSpacing": 70, "padding": 16}}}%%
flowchart TD
    subgraph det["Deterministic: the tool"]
        direction TB
        d1["parse two data shapes"]
        d2["bucket by the viewer's calendar day"]
        d3["mark placeholder / postponed / final /<br/>past-unresolved / scheduled"]
        d4["days until each followed<br/>team's next game"]
    end
    subgraph jud["Judgment: the policy"]
        direction TB
        j1["which games matter"]
        j2["why I care, in nine words"]
        j3["is this week worth a message at all"]
    end
    det -- "8 KB summary" --> jud
```

The line between the halves is the one question: does this have one right answer? If yes, it goes in the tool, where it is computed once and the same way every week. If no, it goes in the policy, where a rule can bound it. An agent that parses 1.6 MB of JavaScript itself is expensive and wrong in a new way every run. An agent that reads an 8 KB summary and decides is cheap and wrong in ways you can write a rule about.

## The decisions, with the road not taken

| Decision | Chosen | Not chosen | Why |
| --- | --- | --- | --- |
| Who reads the data | A tool, once, deterministically | The agent reads the schedule files | Read literally, a finished World Cup is 104 unplayed matches, a third between teams that do not exist. The tool absorbs that once; the policy names it anyway so the rule survives a tool change. |
| What the policy is | Prose, a job description | A config file | A config can say "max 20 lines". It cannot say "zero picks is a good answer" or define real stakes. The reader reasons like a person; write to it like one. |
| What the agent may run | Two scripts by exact path, plus Read | `Bash(node:*)`, or any write tool | The repos back live websites. The property that makes the job safe to schedule is that nothing in the run can touch them. |
| How we know it worked | The digest file exists on disk | The agent says "sent" | A tool's stdout never reaches the log. A run once exited 0 with no message anywhere. |
| The clock | launchd | cron | Asleep at 7:00, launchd runs at the next wake; cron misses the week. launchd also needs a real PATH in the plist, failure mode number one. |
| The window | 7 days | 14 days | In season a week is a briefing and a fortnight is a phone book. The 14 came from a dead August. |
| A quiet week | Two honest sentences, then stop | Fill the space | The title promises never missing a game you care about, which is exactly why the agent has to be willing to send a short message. |
| How you edit your teams | A one-file form (`preferences-editor.html`) that writes `preferences.json` back in place | Editing the JSON by hand, or a settings database | The JSON stays the only thing the agent reads, so nothing about the run changes. The form removes the two ways a hand edit fails: a stray comma, and an abbreviation the data does not use (GS, not GSW). It runs in the browser with no server and nothing installed. |
| How the form shows the week | A GitHub Actions workflow in this repo runs the tool every few hours and commits its output under `docs/reads/`; the page fetches that static file and checks the ticked teams against it | A small local server that ran the tool when the page asked | A page cannot run a program, and a local helper meant a public page reaching a program on the viewer's computer. Running the same tool on GitHub's machines keeps the page static, the agent untouched, and nothing on anyone's computer. The costs: the read is up to a few hours old, and the workflow commits to `main`, so pull before you push. |

## Where to look

- `README.md`: the idea in one picture, and how to try it.
- `TECHNICAL.md`: the files, one run step by step, one repo end to end, the tool's five states, scheduling, the allowlist.
- `examples/README.md`: the chain, file by file, from one real run. Inputs on `main`, outputs on `complete`.
- `WRITING-THE-POLICY.md`: the structure of the policy file and the practice behind each section.
