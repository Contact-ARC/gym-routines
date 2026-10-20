# gym-routines

Public data for the Gym Crew app: the exercise library and one routine per month.
The app downloads these files from `https://raw.githubusercontent.com/OWNER/gym-routines/main/`.
No code here and nothing personal — workout logs stay on each phone.

```
builder/index.html     ← routine builder: make next month's file with forms
images/                ← exercise photos (public domain, see images/README.md)
latest.json            ← manifest: which routine is live + newest app version
exercises.json         ← every exercise (instructions, muscles, alternatives)
routines/2026-10.json  ← one file per month
schema/                ← JSON Schemas the validator checks against
scripts/validate.mjs   ← run by GitHub Actions on every push
```

## The easy way: routine builder

Open `builder/index.html` (double-click it, or turn on GitHub Pages for this repo and open
`https://contact-arc.github.io/gym-routines/builder/`). It loads the exercise list, lets you copy
last month as a starting point, edit days and exercises with forms, set week-by-week targets, and
checks everything with the same rules as CI. Download the file, then do steps 3 and 6 below.

## Publishing next month's routine

1. Copy the current month: `cp routines/2026-10.json routines/2026-11.json`
2. Edit it: change `month`, `effectiveFrom` (e.g. `2026-11-01`), `title`, `whatsNew`, and the `days`.
3. Add a line to `routines` in `latest.json`:
   ```json
   { "month": "2026-11", "file": "routines/2026-11.json", "effectiveFrom": "2026-11-01" }
   ```
4. Need a new exercise? Add it to `exercises.json` first (unique kebab-case `id`).
5. Validate locally (optional — CI does it too): `npm install && npm run validate`
6. Commit and push. Check the **Actions** tab shows a green tick.

You can publish early: the app keeps using the old routine until `effectiveFrom`, then switches
automatically the next time someone opens it with internet. When a new month starts, the
A/B/C rotation resets to Day A and everyone gets a "What's new" popup.

## Routine file cheatsheet

```jsonc
{
  "schemaVersion": 1,
  "month": "2026-11",
  "effectiveFrom": "2026-11-01",
  "title": "November — Strength block",
  "description": "Shown in the What's new popup.",
  "whatsNew": ["Bullet points for the popup"],
  "rir": 2,                        // optional: default reps-in-reserve target for the month
  "weekPlan": [                    // optional: targets per week (week 1 starts on effectiveFrom)
    { "week": 1, "rir": 3, "focus": "Find working weights" },
    { "week": 3, "rir": 1, "focus": "Hardest week" },
    { "week": 4, "deload": true }  // deload = one set fewer + ~90% weights unless you set setDelta/loadFactor
  ],
  "datePlan": [                    // optional: overrides the week on specific dates
    { "from": "2026-11-29", "to": "2026-11-30", "rir": 2, "setDelta": 1, "applyTo": "first" }
  ],
  "deloadWeek": 4,                 // older shorthand, still understood
  "days": [
    {
      "id": "A", "name": "Day A — …", "estMinutes": 40, "notes": "optional",
      "items": [
        { "exerciseId": "barbell-back-squat", "sets": 3, "repRange": [5, 8], "restSec": 150 },   // first exercise gets a warm-up checklist
        { "exerciseId": "barbell-rdl", "sets": 3, "repRange": [8, 10], "restSec": 150, "warmup": true }, // ask for one on any exercise
        { "exerciseId": "plank", "sets": 2, "durationSec": [30, 45], "restSec": 45 },
        // Supersets: same "group" (S1–S9), next to each other. Rest only after the last one.
        { "exerciseId": "db-lateral-raise", "sets": 2, "repRange": [12, 15], "restSec": 60, "group": "S1" },
        { "exerciseId": "cable-rope-pushdown", "sets": 2, "repRange": [10, 15], "restSec": 60, "group": "S1" }
      ]
    }
  ]
}
```

- `repRange` drives progression: once every set hits the top number, the app suggests adding weight.
- `durationSec` is for timed exercises (`logType: "time"` in the library).
- `setDelta` / `loadFactor` / `applyTo` in a plan change the sets and suggested weights when a workout starts that day.

## Exercise fields

| Field | Notes |
|---|---|
| `logType` | `weight`, `bodyweight` (load = added weight), or `time` |
| `equipment` | free text; the app recognises barbell, rack, bench, dumbbell, EZ bar, cable, Smith, leg press, leg curl, pull-up bar and box for the "Your gym" filter |
| `loadUnit` | omit for normal weights; `"pin"` for machine/cable stacks numbered by position |
| `incrementGroup` | `upper`, `lower` or `dumbbell` — which weight jump the user has set for it |
| `perSide` | unilateral; reps are logged per side |
| `loadable` | timed exercise that also takes a weight (carries) |
| `primary` / `secondary` | muscles (see `schema/exercises.schema.json` for the list) |
| `setup`, `steps`, `cues`, `mistakes` | text shown on the exercise screen |
| `images` | up to 4 photos, e.g. `["images/goblet-squat/0.jpg"]` (start and end position) |
| `videoUrl` | optional; otherwise the app opens a YouTube search |
| `alternatives` | ids offered in the in-workout Swap menu |

## Releasing an app update

When a new APK is published in the private `gym-app` repo, bump `app.version` (and `notes`)
in `latest.json`. Everyone's app then shows an "Update available" banner.
