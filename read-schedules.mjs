#!/usr/bin/env node
// read-schedules.mjs — the concierge's data layer.
//
// WHY THIS EXISTS. Ten sports-tracker repos commit their full schedules to disk under
// `src/data/`. That is ~1.6MB of JS across ten files in TWO incompatible shapes. Handing
// that to an agent as raw text is both expensive and error-prone, so this script does the
// boring, deterministic part: read all ten, normalise them into ONE game record, bucket
// them into the viewer's calendar days, and hand back a small summary (or JSON). The agent
// then does the part only an agent can do — judgement about what is worth watching.
//
// ZERO DEPENDENCIES, Node ESM, read-only. It never writes to the sports-trackers repos.
//
// The data files are ES modules, so they are loaded with `await import(pathToFileURL(...))`
// rather than regex-scraped. That is the whole trick: the committed data parses itself.
//
// USAGE
//   node read-schedules.mjs                                   # next 7 days from today
//   node read-schedules.mjs --from 2026-09-16 --days 7
//   node read-schedules.mjs --days 14 --json                  # widen in a dead stretch
//   node read-schedules.mjs --prefs preferences.json          # annotate followed teams
//   node read-schedules.mjs --tz America/New_York
//   node read-schedules.mjs --root /path/to/sports-trackers
//
// EXIT CODES: 0 always (a missing repo is a warning, not a failure). The agent should read
// `warnings` / the "missing" source lines rather than rely on the exit code.

import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'

// ---------------------------------------------------------------------------
// Where the repos live. Default is a sports-trackers/ folder next to this repo, which is
// where clone-viewers.sh puts them; --root or SPORTS_TRACKERS_ROOT wins.
// ---------------------------------------------------------------------------

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_ROOT =
  process.env.SPORTS_TRACKERS_ROOT || path.resolve(HERE, '..', 'sports-trackers')

// ---------------------------------------------------------------------------
// Source catalogue. TWO FAMILIES, and the differences between them are exactly the traps
// this file exists to absorb.
//
// FAMILY A — abbreviation-keyed league schedules. One JSON object per line. Teams are
//            three-letter codes needing a lookup in the repo's own teams.js.
//            NOTE premier-league is the odd one out TWICE: the export is FIXTURES (not
//            GAMES) and the date field is `ko` (not `tip`). Assuming GAMES/tip silently
//            yields an empty Premier League, which is the single easiest bug to ship here.
//
// FAMILY B — tournament match lists. Full team names (no lookup needed), `ko` carries an
//            EXPLICIT local offset rather than being UTC-normalised, and `venue` is an id
//            that must be resolved through the repo's venues.js.
// ---------------------------------------------------------------------------

const SOURCES = [
  // ---- Family A -----------------------------------------------------------
  {
    id: 'wnba',
    viewerId: 'wnba',
    name: 'WNBA',
    emoji: '🏀',
    family: 'A',
    repo: 'the-wnba-schedule',
    file: 'src/data/schedule.js',
    exportName: 'GAMES',
    dateField: 'tip',
    tvField: 'broadcast',
    teamsFile: 'src/data/teams.js',
    locale: 'en-US',
    hour12: true,
    weekStartDow: 0, // US sports: Sunday–Saturday
    commitsScores: true,
  },
  {
    id: 'epl',
    viewerId: 'epl',
    name: 'Premier League',
    emoji: '⚽',
    family: 'A',
    repo: 'premier-league',
    file: 'src/data/fixtures.js',
    exportName: 'FIXTURES', // NOT GAMES
    dateField: 'ko', // NOT tip
    tvField: 'tv', // NOT broadcast
    teamsFile: 'src/data/teams.js',
    locale: 'en-GB',
    hour12: false, // football is 24-hour
    weekStartDow: 1, // Premier League weeks run Monday–Sunday
    commitsScores: false,
    notes: ['No score field is committed for fixtures; results are resolved live in the app.'],
  },
  {
    id: 'nfl',
    viewerId: 'nfl',
    name: 'NFL',
    emoji: '🏈',
    family: 'A',
    repo: 'the-nfl-schedule',
    file: 'src/data/schedule.js',
    exportName: 'GAMES',
    dateField: 'tip',
    tvField: 'broadcast',
    teamsFile: 'src/data/teams.js',
    locale: 'en-US',
    hour12: true,
    weekStartDow: 0,
    commitsScores: false,
    notes: ['Schedule only — no score field is committed.'],
  },
  {
    id: 'nba',
    viewerId: 'nba',
    name: 'NBA',
    emoji: '🏀',
    family: 'A',
    repo: 'the-nba-schedule',
    file: 'src/data/schedule.js',
    exportName: 'GAMES',
    dateField: 'tip',
    tvField: 'broadcast',
    teamsFile: 'src/data/teams.js',
    locale: 'en-US',
    hour12: true,
    weekStartDow: 0,
    commitsScores: true,
  },
  {
    id: 'mens-mm',
    viewerId: 'mens-mm',
    name: "Men's March Madness",
    emoji: '🏀',
    family: 'A',
    repo: 'the-mens-march-madness',
    file: 'src/data/schedule.js',
    exportName: 'GAMES',
    dateField: 'tip',
    tvField: 'broadcast',
    teamsFile: 'src/data/teams.js',
    locale: 'en-US',
    hour12: true,
    weekStartDow: 0,
    commitsScores: true,
    // Abbreviations here are ESPN college codes (HOW, UMBC, M-OH, NCSU). They are NOT
    // guessable from the school name — the teams.js lookup is mandatory, never inferred.
    collegeCodes: true,
  },
  {
    id: 'womens-mm',
    viewerId: 'womens-mm',
    name: "Women's March Madness",
    emoji: '🏀',
    family: 'A',
    repo: 'the-womens-march-madness',
    file: 'src/data/schedule.js',
    exportName: 'GAMES',
    dateField: 'tip',
    tvField: 'broadcast',
    teamsFile: 'src/data/teams.js',
    locale: 'en-US',
    hour12: true,
    weekStartDow: 0,
    commitsScores: true,
    collegeCodes: true,
  },

  // ---- Family B -----------------------------------------------------------
  {
    id: 'worldcup',
    viewerId: 'worldcup',
    name: 'World Cup',
    emoji: '⚽',
    family: 'B',
    repo: 'world-cup-viewer',
    file: 'src/data/matches.js',
    exportName: 'MATCHES',
    dateField: 'ko',
    locale: 'en-GB',
    hour12: false,
    weekStartDow: 1,
    commitsScores: false,
    // THE BIG TRAP. The 2026 tournament is over, but this repo commits NO score field at
    // all and all 32 knockout matches still carry PLACEHOLDER team labels ("Winner Group
    // C", "3rd A/B/C/D/F", "Winner Match 101"). Results are fetched at runtime from
    // OpenFootball and never written back. An agent reading the committed data naively
    // sees 104 unplayed past fixtures, a third of them between teams that do not exist.
    notes: [
      'Tournament is COMPLETE (2026-06-11 to 2026-07-19) but this repo commits no results.',
      'All 32 knockout matches carry placeholder team labels, not real teams.',
      'Never report a placeholder match as a fixture. Never report a past match as upcoming.',
    ],
  },
  {
    id: 'wwc',
    viewerId: 'wwc',
    name: "Women's World Cup",
    emoji: '⚽',
    family: 'B',
    repo: 'womens-world-cup-viewer',
    file: 'src/data/matches.js',
    exportName: 'MATCHES',
    dateField: 'ko',
    locale: 'en-GB',
    hour12: false,
    weekStartDow: 1,
    commitsScores: true,
    // Offsets VARY per match (+12:00 / +10:00 / +09:30 / +08:00) because the 2023 edition
    // spanned Australia and New Zealand. `new Date(ko)` still resolves correctly precisely
    // because the offset is explicit — do not "helpfully" append a Z.
    notes: ['2023 edition, complete. Kickoff offsets vary per match (+12/+10/+09:30/+08).'],
  },
  {
    id: 'euros',
    viewerId: 'euros',
    name: 'Euros',
    emoji: '⚽',
    family: 'B',
    repo: 'football-euros-viewer',
    file: 'src/data/matches.js',
    exportName: 'MATCHES',
    dateField: 'ko',
    locale: 'en-GB',
    hour12: false,
    weekStartDow: 1,
    commitsScores: true,
    notes: ['Euro 2024, complete. Uniform +02:00 offset.'],
  },
  {
    id: 'copa',
    viewerId: 'copa',
    name: 'Copa América',
    emoji: '⚽',
    family: 'B',
    repo: 'copa-america-viewer',
    file: 'src/data/matches.js',
    exportName: 'MATCHES',
    dateField: 'ko',
    locale: 'en-GB',
    hour12: false,
    weekStartDow: 1,
    commitsScores: true,
    notes: ['Copa América 2024, complete. Uniform -04:00 offset.'],
  },
]

// ---------------------------------------------------------------------------
// Placeholder detection.
//
// A knockout slot that has not been filled yet reads like a real team to anything doing
// string comparison: "Winner Group C", "Runner-up Group A", "3rd A/B/C/D/F", "Winner Match
// 101", "Loser Match 61". These are NOT fixtures and must never appear in a digest.
//
// The archived tournaments (Euros / Copa / WWC) preserve the original slot text in
// `label1`/`label2` while `t1`/`t2` hold the resolved real teams — so only t1/t2 are tested.
// ---------------------------------------------------------------------------

const PLACEHOLDER_RE =
  /^(winner|winners|runner-?up|runners-?up|loser|losers|best|third|fourth|\d+(st|nd|rd|th))\b/i

const isPlaceholderLabel = (s) => typeof s === 'string' && PLACEHOLDER_RE.test(s.trim())

// ---------------------------------------------------------------------------
// Time. Every landmine from PLAYBOOK §5 lives in this block and nowhere else.
//   - Bucket by the calendar day the VIEWER sees, via formatToParts in their zone.
//     A 5pm Pacific tip is "today" out west and "tomorrow" on the east coast.
//   - Anchor all whole-day arithmetic at UTC NOON so a DST jump can never move a date.
//   - Locale differs by sport: en-GB/24h for football, en-US/12h for the US leagues.
//   - Week start differs by sport: Premier League Monday–Sunday, US sports Sunday–Saturday.
//   - Drop past days WHOLE, never by kickoff time — a game that tipped at 1pm is still
//     part of today at 5pm.
//
// dayKey/addDayKey are reused from the hub (sports-trackers/hub/src/utils/time.js) when it
// is present; identical local fallbacks keep this script working if the hub is not cloned.
// ---------------------------------------------------------------------------

const localTime = {
  dayKey(iso, tz) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date(iso))
    const get = (t) => parts.find((p) => p.type === t).value
    return `${get('year')}-${get('month')}-${get('day')}`
  },
  addDayKey(key, n) {
    const d = new Date(`${key}T12:00:00Z`) // noon anchor — DST-proof
    d.setUTCDate(d.getUTCDate() + n)
    return d.toISOString().slice(0, 10)
  },
}

// Two clocks on purpose. `localTime` honours the sport's own convention (en-GB 24-hour for
// football, en-US 12-hour for the US leagues) as PLAYBOOK §5 requires. `localTimeUser` is
// the same instant on ONE clock, so a digest that interleaves a 12:00 kickoff with a 4:30 PM
// tip-off does not read like a typo. A digest should pick one column and stay with it.
const fmtTime = (iso, tz, locale, hour12) =>
  new Intl.DateTimeFormat(locale, {
    timeZone: tz,
    hour: hour12 ? 'numeric' : '2-digit',
    minute: '2-digit',
    hour12,
  })
    .format(new Date(iso))
    .replace(/ /g, ' ')

const fmtDay = (key, tz) =>
  new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  }).format(new Date(`${key}T12:00:00Z`))

// Day-of-week for a YYYY-MM-DD key, computed at the UTC-noon anchor.
const dowOf = (key) => new Date(`${key}T12:00:00Z`).getUTCDay()

// The sport-appropriate week containing `key`.
function weekWindow(key, weekStartDow, add) {
  const back = (dowOf(key) - weekStartDow + 7) % 7
  const start = add(key, -back)
  return { start, end: add(start, 6), startsOn: weekStartDow === 1 ? 'Monday' : 'Sunday' }
}

// ---------------------------------------------------------------------------
// Argument parsing.
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  // 7, not 14: in season a week is a briefing and a fortnight is a phone book. The old
  // 14-day default came from August 2026, when nine of ten sources were dormant and a
  // week returned WNBA and nothing else. Widen with --days when the calendar goes quiet.
  const out = { days: 7, tz: null, json: false, from: null, now: null, root: DEFAULT_ROOT, prefs: null, all: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = () => argv[++i]
    if (a === '--from') out.from = next()
    else if (a === '--days') out.days = Number(next())
    else if (a === '--now') out.now = next()
    else if (a === '--tz') out.tz = next()
    else if (a === '--root') out.root = next()
    else if (a === '--prefs') out.prefs = next()
    else if (a === '--json') out.json = true
    else if (a === '--all') out.all = true
    else if (a === '--help' || a === '-h') out.help = true
    else if (a.startsWith('--')) out.unknown = (out.unknown || []).concat(a)
  }
  return out
}

const HELP = `read-schedules.mjs — normalise ten committed sports schedules into one window.

  --from YYYY-MM-DD   first day of the window (default: today in --tz)
  --days N            window length in whole local days, inclusive (default: 7)
  --now WHEN          rehearsal clock override: YYYY-MM-DD (= 07:00 Phoenix) or ISO timestamp
  --tz IANA           viewer timezone (default: system zone, e.g. America/Los_Angeles)
  --prefs FILE        preferences.json — annotates games for followed teams
  --all               in text mode, print every game, not just followed + a sample
  --json              machine-readable output (what the agent should use)
  --root DIR          sports-trackers checkout (default: sibling of agent-ideas)
`

// ---------------------------------------------------------------------------
// Loading. Every import is individually guarded: a repo that is not cloned, a renamed
// export, or a syntax error downgrades ONE source to `missing` and leaves the other nine
// working. A concierge that goes silent because one repo moved is a broken concierge.
// ---------------------------------------------------------------------------

async function safeImport(file) {
  if (!existsSync(file)) return { ok: false, error: `not found: ${file}` }
  try {
    return { ok: true, mod: await import(pathToFileURL(file).href) }
  } catch (err) {
    return { ok: false, error: `${err.name}: ${err.message}` }
  }
}

// Reuse the hub's season-phase badge and its time helpers rather than reinventing them.
async function loadHubTooling(root) {
  const viewers = await safeImport(path.join(root, 'hub/src/data/viewers.js'))
  const phase = await safeImport(path.join(root, 'hub/src/utils/phase.js'))
  const time = await safeImport(path.join(root, 'hub/src/utils/time.js'))
  const watch = await safeImport(path.join(root, 'hub/src/utils/watch.js'))
  return {
    viewerById: viewers.ok ? viewers.mod.viewerById : null,
    seasonPhase: phase.ok ? phase.mod.seasonPhase : null,
    dayKey: time.ok ? time.mod.dayKey : localTime.dayKey,
    addDayKey: time.ok ? time.mod.addDayKey : localTime.addDayKey,
    serviceCatalog: watch.ok ? watch.mod.SERVICE_CATALOG : null,
    watchableServices: watch.ok ? watch.mod.watchableServices : null,
    status: viewers.ok && phase.ok && time.ok && watch.ok ? 'reused' : 'fallback',
    errors: [viewers, phase, time, watch].filter((r) => !r.ok).map((r) => r.error),
  }
}

// ---------------------------------------------------------------------------
// Normalisation: two families in, one record shape out.
//
//   { sport, sportName, emoji, id, startUtc, homeLabel, awayLabel, venue, tv[],
//     status, seasonType, extra{} }
//
// `status` is the field that carries every data caveat:
//   final        — a result is committed for this game
//   scheduled    — in the future, genuinely upcoming
//   placeholder  — a knockout slot with a fake team label; NOT a fixture
//   past-unresolved — in the past, but this repo commits no results (do not call it upcoming)
// ---------------------------------------------------------------------------

function statusFor(src, { hasScore, isPlaceholder, startUtc, nowMs }) {
  if (isPlaceholder) return 'placeholder'
  if (hasScore) return 'final'
  if (new Date(startUtc).getTime() < nowMs) return 'past-unresolved'
  return 'scheduled'
}

async function loadSource(src, root, nowMs) {
  const dir = path.join(root, src.repo)
  const res = await safeImport(path.join(dir, src.file))
  if (!res.ok) return { ...src, ok: false, error: res.error, games: [] }

  const rows = res.mod[src.exportName]
  if (!Array.isArray(rows))
    return { ...src, ok: false, error: `export ${src.exportName} missing or not an array`, games: [] }

  let teamByAbbr = null
  let flagByTeam = null
  let venues = null

  if (src.family === 'A') {
    const t = await safeImport(path.join(dir, src.teamsFile))
    // A missing teams.js is survivable for the pro leagues (abbrs are readable) but NOT for
    // March Madness, whose ESPN college codes are unguessable. Flagged either way.
    teamByAbbr = t.ok ? t.mod.TEAM_BY_ABBR : null
  } else {
    const v = await safeImport(path.join(dir, 'src/data/venues.js'))
    venues = v.ok ? v.mod.VENUES : null
    const t = await safeImport(path.join(dir, 'src/data/teams.js'))
    flagByTeam = t.ok ? t.mod.FLAG_BY_TEAM : null
  }

  const label = (abbr) => {
    const team = teamByAbbr?.[abbr]
    return team?.displayName || team?.name || abbr
  }

  const games = rows.map((row) => {
    if (src.family === 'A') {
      const startUtc = new Date(row[src.dateField]).toISOString()
      const hasScore = Array.isArray(row.score) && row.score.length === 2
      return {
        sport: src.id,
        sportName: src.name,
        emoji: src.emoji,
        id: String(row.id),
        startUtc,
        homeLabel: label(row.home),
        awayLabel: label(row.away),
        venue: [row.venue, row.city].filter(Boolean).join(', '),
        tv: row[src.tvField] || [], // WNBA has at least one game with no broadcast at all
        status: statusFor(src, { hasScore, isPlaceholder: false, startUtc, nowMs }),
        seasonType: row.seasonType || (row.round ? 'tournament' : 'regular'),
        extra: {
          homeAbbr: row.home,
          awayAbbr: row.away,
          ...(row.week != null ? { week: row.week } : {}),
          ...(row.round ? { round: row.round, region: row.region } : {}),
          ...(row.homeSeed != null ? { homeSeed: row.homeSeed, awaySeed: row.awaySeed } : {}),
          ...(row.neutral ? { neutral: true } : {}),
          ...(hasScore ? { score: row.score, winner: row.winner } : {}),
        },
      }
    }

    // Family B. `ko` already carries an explicit offset, so new Date() resolves the correct
    // absolute instant with no assumptions — do not append a Z, do not re-parse by hand.
    const startUtc = new Date(row[src.dateField]).toISOString()
    const isPlaceholder = isPlaceholderLabel(row.t1) || isPlaceholderLabel(row.t2)
    const hasScore = Array.isArray(row.score) && row.score.length === 2
    const place = venues?.[row.venue]
    const flag = (n) => (flagByTeam?.[n] ? `${flagByTeam[n]} ${n}` : n)
    return {
      sport: src.id,
      sportName: src.name,
      emoji: src.emoji,
      id: `${src.id}-${row.num}`,
      startUtc,
      homeLabel: isPlaceholderLabel(row.t1) ? row.t1 : flag(row.t1),
      awayLabel: isPlaceholderLabel(row.t2) ? row.t2 : flag(row.t2),
      venue: place ? `${place.name}, ${place.city}` : row.venue,
      tv: [],
      status: statusFor(src, { hasScore, isPlaceholder, startUtc, nowMs }),
      seasonType: row.stage === 'Group' ? 'group' : 'knockout',
      extra: {
        matchNum: row.num,
        stage: row.stage,
        ...(row.group ? { group: row.group } : {}),
        ...(place?.tz ? { venueTz: place.tz } : {}),
        ...(isPlaceholder ? { placeholder: true, placeholderLabels: [row.t1, row.t2] } : {}),
        ...(hasScore ? { score: row.score } : {}),
        ...(row.aet ? { aet: true } : {}),
        ...(row.pens ? { pens: row.pens } : {}),
      },
    }
  })

  return { ...src, ok: true, games }
}

// ---------------------------------------------------------------------------
// Preferences.
// ---------------------------------------------------------------------------

async function loadPrefs(file, cwdRelativeTo) {
  if (!file) return { prefs: null, error: null }
  const resolved = path.isAbsolute(file) ? file : path.resolve(cwdRelativeTo, file)
  const alt = path.resolve(HERE, file)
  const target = existsSync(resolved) ? resolved : existsSync(alt) ? alt : null
  if (!target) return { prefs: null, error: `preferences file not found: ${file}` }
  try {
    return { prefs: JSON.parse(await readFile(target, 'utf8')), error: null, path: target }
  } catch (err) {
    return { prefs: null, error: `could not parse ${target}: ${err.message}` }
  }
}

// A followed entry is {sport, abbr|team, label}. Abbreviations COLLIDE across sports (GS is
// both the Warriors and the Valkyries; POR is both the Trail Blazers and the Fire), so a
// follow is only ever matched within its own sport.
function matchesFollow(game, follow) {
  if (follow.sport !== game.sport) return false
  if (follow.abbr) return game.extra.homeAbbr === follow.abbr || game.extra.awayAbbr === follow.abbr
  if (follow.team) {
    const needle = follow.team.toLowerCase()
    return (
      game.homeLabel.toLowerCase().includes(needle) || game.awayLabel.toLowerCase().includes(needle)
    )
  }
  return false
}

// ---------------------------------------------------------------------------
// Main.
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    process.stdout.write(HELP)
    return
  }

  const warnings = []
  if (args.unknown) warnings.push(`ignored unknown flags: ${args.unknown.join(' ')}`)

  const tz = args.tz || Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Los_Angeles'
  // --now overrides the clock for rehearsal. Without it, panels like "Premier League
  // starts in 4d" and "next in 29d" are computed against the real current date even when
  // --from shifts the window, so a dress rehearsal of a future session date reads
  // self-inconsistently. A bare YYYY-MM-DD means 07:00 America/Phoenix (the digest hour);
  // a full ISO timestamp is taken as-is.
  let now
  if (args.now) {
    const iso = /^\d{4}-\d{2}-\d{2}$/.test(args.now) ? `${args.now}T07:00:00-07:00` : args.now
    now = new Date(iso)
    if (Number.isNaN(now.getTime())) {
      process.stderr.write(`--now must be YYYY-MM-DD or an ISO timestamp, got "${args.now}"\n`)
      process.exitCode = 2
      return
    }
  } else {
    now = new Date()
  }
  const nowMs = now.getTime()

  const root = path.resolve(args.root)
  if (!existsSync(root)) warnings.push(`sports-trackers root does not exist: ${root}`)

  const hub = await loadHubTooling(root)
  if (hub.status === 'fallback')
    warnings.push(`hub tooling unavailable, using local fallbacks (${hub.errors.join('; ')})`)
  const { dayKey, addDayKey } = hub

  const todayKey = dayKey(now.toISOString(), tz)
  const from = args.from || todayKey
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) {
    process.stderr.write(`--from must be YYYY-MM-DD, got "${from}"\n`)
    process.exitCode = 2
    return
  }
  const days = Number.isFinite(args.days) && args.days > 0 ? Math.floor(args.days) : 14
  // Whole local days, inclusive of `from`. Past days are dropped WHOLE — everything on
  // `from` is in the window even if it already kicked off.
  const windowDays = Array.from({ length: days }, (_, i) => addDayKey(from, i))
  const windowSet = new Set(windowDays)
  const to = windowDays[windowDays.length - 1]

  const { prefs, error: prefsError, path: prefsPath } = await loadPrefs(args.prefs, process.cwd())
  if (prefsError) warnings.push(prefsError)
  const follows = prefs?.followed || []

  const loaded = await Promise.all(SOURCES.map((s) => loadSource(s, root, nowMs)))

  const sources = []
  const games = []

  for (const src of loaded) {
    if (!src.ok) {
      warnings.push(`${src.name}: ${src.error}`)
      sources.push({
        id: src.id,
        name: src.name,
        emoji: src.emoji,
        repo: src.repo,
        status: 'missing',
        error: src.error,
        notes: src.notes || [],
      })
      continue
    }

    const all = src.games
    const upcoming = all
      .filter((g) => g.status === 'scheduled')
      .sort((a, b) => a.startUtc.localeCompare(b.startUtc))
    const inWindow = all.filter((g) => windowSet.has(dayKey(g.startUtc, tz)))

    // Decorate each in-window game with the viewer-local day/time and follow matches.
    for (const g of inWindow) {
      const key = dayKey(g.startUtc, tz)
      const matched = follows.filter((f) => matchesFollow(g, f))
      games.push({
        ...g,
        localDay: key,
        localWeekday: fmtDay(key, tz),
        localTime: fmtTime(g.startUtc, tz, src.locale, src.hour12),
        localTimeUser: fmtTime(g.startUtc, tz, 'en-US', true),
        tz,
        followedBy: matched.map((f) => f.label || f.abbr || f.team),
        followed: matched.length > 0,
      })
    }

    // The hub's phase badge, upgraded by whether this source actually has games today.
    const hasGamesToday = all.some((g) => dayKey(g.startUtc, tz) === todayKey)
    const viewer = hub.viewerById?.[src.viewerId]
    const phase =
      viewer && hub.seasonPhase
        ? hub.seasonPhase(viewer, { now, hasGames: hasGamesToday })
        : { label: 'unknown', tone: 'cold' }

    const nextGame = upcoming[0] || null
    const kos = all.map((g) => g.startUtc).sort()

    sources.push({
      id: src.id,
      name: src.name,
      emoji: src.emoji,
      repo: src.repo,
      family: src.family,
      status: 'ok',
      // The hub badge is derived from coarse MONTH windows and can disagree with the
      // committed schedule by days — `daysUntilNextGame` is the schedule's own answer and
      // is the one to trust in a digest.
      phase,
      week: weekWindow(todayKey, src.weekStartDow, addDayKey),
      locale: src.locale,
      hour12: src.hour12,
      commitsScores: src.commitsScores,
      counts: {
        total: all.length,
        final: all.filter((g) => g.status === 'final').length,
        scheduled: all.filter((g) => g.status === 'scheduled').length,
        placeholder: all.filter((g) => g.status === 'placeholder').length,
        pastUnresolved: all.filter((g) => g.status === 'past-unresolved').length,
        inWindow: inWindow.length,
        inWindowReal: inWindow.filter((g) => g.status !== 'placeholder').length,
        inWindowFollowed: inWindow.filter((g) => follows.some((f) => matchesFollow(g, f))).length,
      },
      dataRange: { first: kos[0] || null, last: kos[kos.length - 1] || null },
      nextGameUtc: nextGame?.startUtc || null,
      nextGameLocalDay: nextGame ? dayKey(nextGame.startUtc, tz) : null,
      nextGameLabel: nextGame ? `${nextGame.awayLabel} at ${nextGame.homeLabel}` : null,
      daysUntilNextGame: nextGame
        ? Math.round(
            (new Date(`${dayKey(nextGame.startUtc, tz)}T12:00:00Z`) -
              new Date(`${todayKey}T12:00:00Z`)) /
              86_400_000
          )
        : null,
      notes: src.notes || [],
    })
  }

  games.sort((a, b) => a.startUtc.localeCompare(b.startUtc) || a.sport.localeCompare(b.sport))

  // Season openers are a mechanical fact worth surfacing: the first scheduled game of a
  // source that lands inside the window is, by construction, opening day.
  for (const s of sources) {
    if (s.status !== 'ok' || !s.nextGameUtc) continue
    const opener = games.find((g) => g.sport === s.id && g.startUtc === s.nextGameUtc)
    if (opener && s.counts.final === 0) opener.extra.seasonOpener = true
  }

  const followedGames = games.filter((g) => g.followed)

  // Per-followed-team rollup. A team with NOTHING in the window still gets a next-game
  // answer drawn from the committed schedule (or an explicit null when its league has no
  // future games committed at all, i.e. a real offseason). This is what lets the digest say
  // "the Seahawks open in 30 days" or "the Lakers are dark" as a FACT rather than a guess —
  // the alternative is an agent inventing a plausible date, which is the failure mode this
  // whole tool exists to prevent.
  const bySport = new Map(loaded.filter((s) => s.ok).map((s) => [s.id, s]))
  const followedTeams = follows.map((f) => {
    const src = bySport.get(f.sport)
    const label = f.label || f.abbr || f.team
    if (!src)
      return { ...f, label, sourceStatus: 'missing', inWindow: 0, nextGameUtc: null, note: 'source unavailable' }
    const mine = src.games.filter((g) => matchesFollow(g, f)).sort((a, b) => a.startUtc.localeCompare(b.startUtc))
    const upcoming = mine.filter((g) => g.status === 'scheduled')
    const inWindow = mine.filter((g) => windowSet.has(dayKey(g.startUtc, tz)) && g.status !== 'placeholder')
    const next = upcoming[0] || null
    return {
      sport: f.sport,
      sportName: src.name,
      abbr: f.abbr || null,
      label,
      why: f.why || null,
      sourceStatus: 'ok',
      totalThisSeason: mine.length,
      inWindow: inWindow.length,
      inWindowGameIds: inWindow.map((g) => g.id),
      nextGameUtc: next?.startUtc || null,
      // The VIEWER-LOCAL day, not the UTC one. A 5:20pm Pacific kickoff is 00:20Z the
      // following day, so anything reading the ISO string's date component names the wrong
      // day — which is precisely the mistake a digest will make if only `nextGameUtc` is on
      // offer. Give it the answer in the form it should print.
      nextGameLocalDay: next ? dayKey(next.startUtc, tz) : null,
      nextGameLocal: next
        ? `${fmtDay(dayKey(next.startUtc, tz), tz)} at ${fmtTime(next.startUtc, tz, 'en-US', true)}`
        : null,
      nextGameLabel: next ? `${next.awayLabel} at ${next.homeLabel}` : null,
      daysUntilNextGame: next
        ? Math.round(
            (new Date(`${dayKey(next.startUtc, tz)}T12:00:00Z`) - new Date(`${todayKey}T12:00:00Z`)) /
              86_400_000
          )
        : null,
      // No unmatched-abbr silence: a typo'd abbreviation is reported, not swallowed.
      note: mine.length === 0 ? 'no games matched this follow in the committed data' : null,
    }
  })
  for (const t of followedTeams)
    if (t.note === 'no games matched this follow in the committed data')
      warnings.push(`follow "${t.label}" (${t.sport}) matched zero games — check the abbreviation`)

  const payload = {
    generatedAt: now.toISOString(),
    tz,
    window: { from, to, days, localDays: windowDays },
    root,
    hubTooling: hub.status,
    preferences: prefs
      ? { path: prefsPath, timezone: prefs.timezone || null, followed: follows.map((f) => f.label || f.abbr || f.team) }
      : null,
    followedTeams: prefs ? followedTeams : null,
    sources,
    counts: {
      sourcesOk: sources.filter((s) => s.status === 'ok').length,
      sourcesMissing: sources.filter((s) => s.status === 'missing').length,
      gamesInWindow: games.length,
      realGamesInWindow: games.filter((g) => g.status !== 'placeholder').length,
      placeholdersInWindow: games.filter((g) => g.status === 'placeholder').length,
      followedGamesInWindow: followedGames.length,
    },
    games,
    warnings,
  }

  if (args.json) {
    process.stdout.write(JSON.stringify(payload, null, 2) + '\n')
    return
  }

  printSummary(payload, { all: args.all })
}

// ---------------------------------------------------------------------------
// Human-readable summary.
// ---------------------------------------------------------------------------

function printSummary(p, { all }) {
  const L = []
  const pad = (s, n) => String(s).padEnd(n)
  L.push('')
  L.push(`GAME-DAY CONCIERGE — schedule read`)
  L.push(
    `Window ${fmtDay(p.window.from, p.tz)} through ${fmtDay(p.window.to, p.tz)} (${p.window.days} days) · times in ${p.tz}`
  )
  L.push(
    `Sources ${p.counts.sourcesOk}/${p.sources.length} readable · hub tooling: ${p.hubTooling} · generated ${p.generatedAt}`
  )
  if (p.preferences) L.push(`Following ${p.preferences.followed.length}: ${p.preferences.followed.join(', ')}`)
  L.push('')
  L.push('SOURCES')
  for (const s of p.sources) {
    if (s.status === 'missing') {
      L.push(`  ${s.emoji} ${pad(s.name, 22)} MISSING — ${s.error}`)
      continue
    }
    const next =
      s.daysUntilNextGame == null
        ? 'no upcoming games in committed data'
        : s.daysUntilNextGame === 0
          ? 'next game today'
          : `next game in ${s.daysUntilNextGame}d (${s.nextGameLocalDay} local)`
    L.push(
      `  ${s.emoji} ${pad(s.name, 22)} ${pad(s.phase.label, 14)} ${pad(s.counts.inWindowReal + ' in window', 16)} ${next}`
    )
    if (s.counts.placeholder)
      L.push(`      ⚠ ${s.counts.placeholder} placeholder matches in this repo (not real fixtures)`)
    if (s.counts.pastUnresolved)
      L.push(`      ⚠ ${s.counts.pastUnresolved} past matches with no committed result`)
    for (const n of s.notes) L.push(`      · ${n}`)
  }

  if (p.followedTeams) {
    L.push('')
    L.push('FOLLOWED TEAMS')
    for (const t of p.followedTeams) {
      const next =
        t.sourceStatus !== 'ok'
          ? 'SOURCE UNAVAILABLE — cannot say anything about this team'
          : t.daysUntilNextGame == null
            ? 'no future games in committed data (offseason)'
            : t.daysUntilNextGame === 0
            ? 'plays today'
            : `next in ${t.daysUntilNextGame}d, ${t.nextGameLocal} local — ${t.nextGameLabel}`
      L.push(`  ${pad(t.label, 24)} ${pad(t.sportName || t.sport, 18)} ${pad(t.inWindow + ' in window', 14)} ${next}`)
    }
  }

  L.push('')
  L.push(
    `IN WINDOW: ${p.counts.realGamesInWindow} real games` +
      (p.counts.placeholdersInWindow ? `, ${p.counts.placeholdersInWindow} placeholders excluded` : '') +
      (p.preferences ? `, ${p.counts.followedGamesInWindow} involving a followed team` : '')
  )

  const show = all
    ? p.games.filter((g) => g.status !== 'placeholder')
    : p.preferences
      ? p.games.filter((g) => g.followed)
      : p.games.filter((g) => g.status !== 'placeholder')

  let day = null
  for (const g of show) {
    if (g.localDay !== day) {
      day = g.localDay
      L.push('')
      L.push(`  ${g.localWeekday}`)
    }
    const who = `${g.awayLabel} at ${g.homeLabel}`
    const tv = g.tv.length ? ` · ${g.tv.slice(0, 2).join('/')}` : ''
    const mark = g.followed ? '★' : ' '
    const extra = g.extra.seasonOpener ? ' · SEASON OPENER' : g.extra.week ? ` · Week ${g.extra.week}` : ''
    L.push(`  ${mark} ${pad(g.localTimeUser, 8)} ${g.emoji} ${pad(who, 46)}${tv}${extra}`)
  }
  if (!show.length) L.push('  (nothing)')

  if (p.warnings.length) {
    L.push('')
    L.push('WARNINGS')
    for (const w of p.warnings) L.push(`  ! ${w}`)
  }
  L.push('')
  process.stdout.write(L.join('\n') + '\n')
}

main().catch((err) => {
  process.stderr.write(`read-schedules.mjs failed: ${err.stack}\n`)
  process.exitCode = 1
})
