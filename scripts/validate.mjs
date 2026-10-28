// Validates every data file the app downloads. Runs in CI on every push and PR,
// so a typo fails the commit instead of breaking everyone's app.
//   npm install && npm run validate
import Ajv from 'ajv'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => {
  try { return JSON.parse(readFileSync(join(root, p), 'utf8')) } catch (e) { fail(`${p}: ${e.message}`); return null }
}

const errors = []
const warnings = []
function fail (msg) { errors.push(msg) }
function warn (msg) { warnings.push(msg) }

const ajv = new Ajv({ allErrors: true, strict: false })
function check (schemaFile, data, label) {
  if (!data) return
  const validate = ajv.compile(read(schemaFile))
  if (!validate(data)) {
    for (const e of validate.errors) fail(`${label}${e.instancePath || ''}: ${e.message}${e.params?.allowedValues ? ' ' + JSON.stringify(e.params.allowedValues) : ''}`)
  }
}

// ── Manifest ──
const latest = read('latest.json')
check('schema/latest.schema.json', latest, 'latest.json')

// ── Exercises ──
const exFile = latest?.exercisesFile || 'exercises.json'
const exercises = read(exFile)
check('schema/exercises.schema.json', exercises, exFile)
const ids = new Map()
for (const ex of exercises?.exercises || []) {
  if (ids.has(ex.id)) fail(`${exFile}: duplicate id "${ex.id}"`)
  ids.set(ex.id, ex)
}
for (const ex of ids.values()) {
  for (const alt of ex.alternatives || []) {
    if (!ids.has(alt)) fail(`${exFile}: "${ex.id}" lists unknown alternative "${alt}"`)
    if (alt === ex.id) fail(`${exFile}: "${ex.id}" lists itself as an alternative`)
  }
  for (const img of ex.images || []) {
    if (!img.startsWith('https://') && !existsSync(join(root, img))) fail(`${exFile}: "${ex.id}" image ${img} does not exist`)
  }
  if (ex.logType === 'climb' && !ex.climbType) fail(`${exFile}: "${ex.id}" is a climb but has no climbType (boulder or route)`)
  if (ex.logType !== 'time' && ex.logType !== 'climb' && ex.loadUnit !== 'pin' && !ex.incrementGroup) {
    warn(`${exFile}: "${ex.id}" has no incrementGroup — the app will assume "upper"`)
  }
  if (ex.es) {
    for (const k of ['steps', 'setup', 'cues', 'mistakes']) {
      if (ex.es[k] && ex[k] && ex.es[k].length !== ex[k].length) warn(`${exFile}: "${ex.id}" has ${ex[k].length} ${k} in English but ${ex.es[k].length} in Spanish`)
    }
  }
}
const missingEs = [...ids.values()].filter(ex => !ex.es?.name).map(ex => ex.id)
if (missingEs.length) warn(`${exFile}: no Spanish name for ${missingEs.length} exercise(s): ${missingEs.slice(0, 5).join(', ')}${missingEs.length > 5 ? '…' : ''}`)

// ── Routines ──
const listed = new Set()
const months = new Set()
for (const entry of latest?.routines || []) {
  listed.add(entry.file)
  if (months.has(entry.month)) fail(`latest.json: month ${entry.month} listed twice`)
  months.add(entry.month)
  if (!existsSync(join(root, entry.file))) { fail(`latest.json: ${entry.file} does not exist`); continue }

  const r = read(entry.file)
  check('schema/routine.schema.json', r, entry.file)
  if (!r) continue
  if (r.month !== entry.month) fail(`${entry.file}: month "${r.month}" doesn't match latest.json entry "${entry.month}"`)
  if (r.effectiveFrom !== entry.effectiveFrom) fail(`${entry.file}: effectiveFrom "${r.effectiveFrom}" doesn't match latest.json "${entry.effectiveFrom}"`)

  // Week and date plans
  const weeks = new Set()
  for (const w of r.weekPlan || []) {
    if (weeks.has(w.week)) fail(`${entry.file}: weekPlan lists week ${w.week} twice`)
    weeks.add(w.week)
  }
  for (const d of r.datePlan || []) {
    if (d.to && d.to < d.from) fail(`${entry.file}: datePlan range ${d.from} → ${d.to} is backwards`)
    if (isNaN(Date.parse(d.from)) || (d.to && isNaN(Date.parse(d.to)))) fail(`${entry.file}: datePlan has an invalid date`)
  }

  // Monthly challenge
  const ch = r.challenge
  if (ch) {
    for (const id of ch.exerciseIds || []) if (!ids.has(id)) fail(`${entry.file}: challenge counts unknown exercise "${id}"`)
    if (ch.exerciseIds?.length && ['workouts', 'manual'].includes(ch.type)) warn(`${entry.file}: challenge type "${ch.type}" ignores exerciseIds`)
    if (ch.type === 'volume' && !ch.unit) warn(`${entry.file}: volume challenge has no unit — the app assumes the target is in each person's unit`)
    if (ch.type === 'manual' && !ch.unitLabel) warn(`${entry.file}: manual challenge has no unitLabel (what people are counting)`)
  }
  if (r.es?.whatsNew && r.whatsNew && r.es.whatsNew.length !== r.whatsNew.length) warn(`${entry.file}: whatsNew has ${r.whatsNew.length} lines in English but ${r.es.whatsNew.length} in Spanish`)

  const dayIds = new Set()
  for (const day of r.days || []) {
    if (dayIds.has(day.id)) fail(`${entry.file}: duplicate day id "${day.id}"`)
    dayIds.add(day.id)
    const groups = {}
    day.items.forEach((it, i) => {
      const where = `${entry.file} day ${day.id} item ${i + 1}`
      const ex = ids.get(it.exerciseId)
      if (!ex) { fail(`${where}: unknown exerciseId "${it.exerciseId}"`); return }
      if (ex.logType === 'time' && !it.durationSec) fail(`${where}: "${ex.id}" is timed — use durationSec, not repRange`)
      if (ex.logType !== 'time' && it.durationSec) fail(`${where}: "${ex.id}" is rep-based — use repRange, not durationSec`)
      const range = it.repRange || it.durationSec
      if (range && range[0] > range[1]) fail(`${where}: range ${JSON.stringify(range)} is backwards`)
      if (it.group) (groups[it.group] ||= []).push(i)
      // Beginner track: the merged item has to make sense too
      if (it.beginner) {
        const b = { ...it, ...it.beginner }
        const bex = ids.get(b.exerciseId)
        if (!bex) { fail(`${where}: beginner version uses unknown exerciseId "${b.exerciseId}"`); return }
        if (it.beginner.repRange && it.beginner.durationSec) fail(`${where}: beginner version has both repRange and durationSec`)
        const timed = bex.logType === 'time'
        const bRange = it.beginner.durationSec || it.beginner.repRange || (timed ? it.durationSec : it.repRange)
        if (timed && !(it.beginner.durationSec || it.durationSec)) fail(`${where}: beginner exercise "${bex.id}" is timed — give the beginner version a durationSec`)
        if (!timed && !(it.beginner.repRange || it.repRange)) fail(`${where}: beginner exercise "${bex.id}" is rep-based — give the beginner version a repRange`)
        if (bRange && bRange[0] > bRange[1]) fail(`${where}: beginner range ${JSON.stringify(bRange)} is backwards`)
        if (b.exerciseId === it.exerciseId && Object.keys(it.beginner).every(k => k === 'es' || k === 'notes')) warn(`${where}: beginner version only changes the notes`)
      }
    })
    for (const [g, idx] of Object.entries(groups)) {
      if (idx.length < 2) fail(`${entry.file} day ${day.id}: superset ${g} has only one exercise`)
      if (idx.some((v, k) => k && v !== idx[k - 1] + 1)) fail(`${entry.file} day ${day.id}: superset ${g} exercises must be next to each other`)
    }
  }
}

// Routine files that exist but aren't in latest.json (probably forgotten)
const routineDir = join(root, 'routines')
if (existsSync(routineDir)) {
  for (const f of readdirSync(routineDir)) {
    if (f.endsWith('.json') && !listed.has(`routines/${f}`)) warn(`routines/${f} is not listed in latest.json — the app won't see it`)
  }
}

for (const w of warnings) console.warn('⚠️  ' + w)
if (errors.length) {
  for (const e of errors) console.error('❌ ' + e)
  console.error(`\n${errors.length} error(s).`)
  process.exit(1)
}
console.log(`✅ All good — ${ids.size} exercises, ${latest.routines.length} routine(s).`)
