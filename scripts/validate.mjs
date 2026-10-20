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
  if (ex.logType !== 'time' && ex.loadUnit !== 'pin' && !ex.incrementGroup) {
    warn(`${exFile}: "${ex.id}" has no incrementGroup — the app will assume "upper"`)
  }
}

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
