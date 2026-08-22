# TAC-GRID — Working Status

Snapshot at **2026-08-11 23:37**. Read this first when resuming.

---

## Bottom line

The app works and is running. `http://localhost:3000`, login `admin` /
`admin123` (**change before any demo**). Two long jobs are running detached and
will continue regardless of any session ending.

Docs to read, in order: **`RUNBOOK.md`** (how to run it, where every feature
is), **`BRIEFING.md`** (how to present it, and what not to claim),
`CONTEXT.md` (full technical history).

---

## Running right now (detached — survives session end)

| Job | State |
|---|---|
| Scene analysis | **COMPLETE — 108 / 108 nodes** |
| Offline tile + route pre-cache | **COMPLETE — 268 tiles, 110 routes** |
| Web server (`node server.js`) | up on :3000 (detached) |

**Analysis quality: 88% of tactical fields populated (1825/2085), up from 3%.**
4 nodes carry `incompleteViews` — a face or two missing, the rest good.
`node56` (hand-written) and `node12` (cloud) preserved untouched.

**Offline is done.** `precacheOffline.js` finished: 268 map tiles (1.1 MB) and
all 110 walking routes between placed nodes are on disk. The app no longer
needs a connection for maps or routing.

All three are ordinary detached Windows processes. Check with:

```
Get-Content C:\tactigrid\Tactigridv2\analyze.log -Tail 5
Get-Content C:\tactigrid\Tactigridv2\precache.log -Tail 5
```

Both scripts are **resumable and safe to re-run** — they skip completed work.

---

## Done this session

1. **Made it run at all.** Node.js was not installed (portable install now at
   `%LOCALAPPDATA%\Programs\nodejs`, added to PATH); installed npm deps and
   `opencv-python` / `numpy` / `pillow`; fixed `.claude/launch.json`, which
   hardcoded a different machine's paths.
2. **Local AI backend (`vlmAnalyze.js`).** `TACGRID_VLM_BACKEND=ollama`,
   qwen2.5vl:7b on the RTX 5060. Imagery never leaves the machine. Verified
   against `ollama ps` / `nvidia-smi` during a live run.
3. **Fixed three real bugs**, each found by checking output rather than
   assuming success:
   - Local model returns objects where strings were asked for
     (`overall: {description: …}`), which threw and silently fell back to
     concatenated text → added `asText()` / `normalizeDirection()`.
   - **Context overflow**: a 1024px face is ~1800 tokens and overflowed
     Ollama's 4096 default. **Overflow returns HTTP 200 with an empty body**,
     silently caching blank analyses → `num_ctx` now 8192 and an empty reply
     now raises an explicit error.
   - **The "none obvious" problem**: the original prompt offered
     `- or 'none obvious'` on every tactical field and asked for blind spots as
     negative inference. The model took the opt-out **97% of the time** (2
     substantive of 66). Rewrote every field as "name the objects that…" and
     removed all opt-outs. Cost ~27 s → ~67 s per node because it now writes
     real content.
4. **New: reaction analysis** — the Google Maps differentiator.
   `GET /api/tours/:p/:f/reaction?from=<node>&pace=walk|brisk|double` plus
   `/api/tours/:p/:f/overview`, and a self-contained UI at **`/tactical.html`**.
   Answers "an incident happened here — who reaches it, in what order, how
   long?" Uses Valhalla real paths (needs only endpoints placed) with a
   `mode=graph` cross-check.
5. **New scripts**: `analyzeAll.js` (batch analysis, resumable, refuses to
   overwrite another model's work without `--force-all`) and
   `precacheOffline.js` (tiles + routes for airgapped operation).
6. **Docs**: `RUNBOOK.md`, `BRIEFING.md`, plus README/CONTEXT updates.

---

## What still needs doing

Analysis, the browser check, font self-hosting and the offline proof are all
**done**.

**Offline verified by request capture.** Every network request made while
loading the login page, the Command Deck and the reaction page was recorded.
All of them went to `http://localhost:3000` or a `data:` URI — **zero external
hosts**. No `fonts.googleapis.com`, no `tile.openstreetmap.org`, no
`valhalla1.openstreetmap.de`. Map tiles returned 200 from the server's disk
cache and the self-hosted fonts (`vendor/fonts/f7.woff2`, `f13.woff2`) loaded
locally. That is stronger evidence than a flight-mode test, because it proves
nothing was *requested* rather than merely that failures were tolerated.

*One honest caveat:* tiles are cached for the site area padded ~275 m. Panning
far outside that would try to reach OSM. Stay near the site, or widen the
bounds in `precacheOffline.js` and re-run while connected.

**All 108 nodes now have all four views.** The 4 that were incomplete
(node129, node151, node153, node154) were redone and every node reports
complete coverage. Two distinct causes were behind them:
- three had empty replies from the wedged-model problem;
- **node154 was different** — its reply was cut off mid-object by the
  `num_predict` cap, surfacing as `Expected ',' or '}' ... at position 2515`
  rather than as an obvious truncation. `num_predict` is now **1600**
  (override with `TACGRID_VLM_NUM_PREDICT`); the cap only costs anything
  when it is actually reached.

`analyzeAll.js` gained `--incomplete` (redo nodes missing a view) and
`--only node151,node153` for targeted re-runs. Both still refuse to overwrite
another model's work.

What remains — yours to do:

1. **Change the admin password.** `node setPassword.js admin <new-password>`

---

## The "Model returned nothing" failures — cause measured

Batches failed large numbers of nodes with an empty model reply. **I was wrong
about the cause twice before testing properly** — recorded here so nobody
repeats the guesses.

**Wrong guess 1: context overflow.** Disproved by a controlled test — same
node, one knob at a time:

| Configuration | Empty replies |
|---|---|
| ctx 8192, num_predict 900 (the "failing" settings) | **0 / 4** |
| ctx 8192, num_predict 2000 | 0 / 4 |
| ctx 16384, num_predict 2000 | 0 / 4 |

Replies measure 400–604 tokens, nowhere near the 900 cap. Context is not it.

**Wrong guess 2: concurrency / GPU contention.** A clean re-run with nothing
else competing still failed 33 of 46.

**Actual cause: Ollama degrades under sustained batch load and never recovers.**
The failure sequence is the proof — it is not random:

```
OK OK OK FAIL FAIL FAIL FAIL OK OK OK OK OK OK OK OK OK OK
FAIL FAIL FAIL … (29 consecutive, to the end of the run)
```

Restarting Ollama fixed it instantly: **4/4 nodes succeeded straight after**,
with the browser still open and nothing else changed. A wedged model instance
is the whole story.

**The fix is automatic.** `analyzeAll.js` now watches for consecutive failures
and, after two, calls `vlmAnalyze.resetModel()` — which asks Ollama to unload
the model via `keep_alive: 0` (the official API, no process killing) and
retries the same node against a fresh instance. Look for
`N failures in a row - reloading the model...` in the log; the final line
reports how many reloads were needed.

If you ever see a run fail wholesale anyway, `ollama serve` restarted by hand
clears it.

Three code changes came out of this:
- A failing face no longer kills the whole node. Only the parse was guarded
  before, so one bad face threw straight out — turning a ~20% per-face failure
  into a 58% node failure via 1−(1−p)⁴.
- One automatic retry at a warmer temperature on an empty reply.
- Partial nodes now record `incompleteViews` / `viewErrors` instead of quietly
  passing as complete.

---

## Do not break

- **`node56` holds a hand-written analysis** and `node12` a cloud-model one.
  They are the best content in the system and must not be overwritten by a
  local re-run. `analyzeAll.js --force` already refuses; only `--force-all`
  overrides. A backup exists at `vlmdata.backup-20260811.json`.
- **Do not present node56's readout as AI output** — see `BRIEFING.md` §6a.
- **Do not parallelise analysis.** The model holds 6.4 GB of an 8.1 GB card; a
  second concurrent request spills to system RAM and runs slower.
- **Do not lower `TACGRID_VLM_NUM_CTX` below ~6000** — silent empty output.

---

## Honest limitations to carry into any briefing

- **11 of 108 nodes have real coordinates.** Routing between surveyed positions
  is metre-accurate; the rest of the site is a surveying effort, not a software
  one.
- **No killzone or fire-control analysis exists** — not in the prompt, schema,
  or output. Never claim it.
- **Blind-spot quality on the local 7B model was the weakest area.** The prompt
  fix improved it substantially, but a 26B cloud model still did it better.
  Re-measure before relying on it.
