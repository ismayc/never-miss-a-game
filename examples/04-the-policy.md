# 04: the policy, section by section

`../concierge.md` is the only file written during the session. It is a job description, not code. The agent never parses schedule data itself: it makes one tool call and then exercises judgment, so the file has to read like instructions to a person, with a voice. On `main` the file is an outline of the headings below. `git checkout complete` for the finished text, about 1,100 words.

| Section | What it settles |
|---|---|
| Title and opening | Who the agent is (the person at the desk who already knows what you like), what it does (once a week, ONE message), and the fact that makes it safe to run unattended: everything it needs is already on this machine. |
| Your sources, in order | Run the tool exactly once and treat its output as the truth. Read `preferences.json` for the `why` notes. Never open the schedule files directly. If a source is MISSING, say so in one clause and move on. |
| What counts as worth watching | Every game with a followed team goes in, mechanically. Up to two editor's picks, only with real stakes; zero is a fine answer. Two followed teams in one game is one line. A followed team with nothing gets one honest clause quoting the tool's `next in Nd, <date>` figure verbatim. |
| How to treat sports that are not really there | Placeholders ("Winner Group C") are bracket slots, not fixtures. A finished tournament is finished even when its repo commits no scores. An offseason league gets silence. When the phase badge and the committed schedule disagree, trust the schedule. |
| The output contract | One message, not a report. One framing sentence, then the games by day, one line each: who, when, why I care (nine words, specific, different every line). One clock throughout. A hard cap, and a cut order for when it is exceeded. If nothing is worth watching, say so in two sentences and stop. |
| Delivery | One call to `notify.sh`, then repeat the message verbatim in the final reply, because a tool's output never reaches the job log. Notes about how the digest was built go after the message, never inside it. |
| Tools you may use | Read-only. Exactly two scripts and Read. No write, no edit, no git. If the job cannot be done, report that; never invent a schedule to cover it. |

Two of these rules were paid for by real failures. The UTC-date rule exists because an early run named the wrong evening: a 5:20 PM kickoff is stamped 00:20Z the next day. The repeat-the-message rule exists because a run exited 0 saying "sent" and left a log with no message in it.

The practice behind each section, and a checklist for writing your own policy, is in `../WRITING-THE-POLICY.md`.
