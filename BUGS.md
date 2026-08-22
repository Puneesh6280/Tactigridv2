# TAC-GRID — Bug & Cleanup Backlog

> **Status: all 19 items fixed and verified (2026-07-20).**
> Verified by two automated suites (29 + 14 assertions) plus browser testing.
> Kept as a record of what changed and why.

Findings from the full test pass on 2026-07-20. Ordered by priority.
Work top-down: P0 items either expose data or silently destroy/lose work.

---

## P0 — Do these first

### [x] 1. Anyone can use the app without logging in
**What:** Typing `/admin_dashboard.html` straight into the browser loads the full admin
dashboard. Every API route (`/personnel`, `/upload`, `/reupload`, `/update-personnel`,
`/clear-personnel`) also answers without any login.
**Problem:** The login screen is decoration. Anyone who can reach the server has full
admin rights — they can upload, rename, and wipe everything. For a site with real
layout and sentry data, this is the most serious issue on the list.
**Fix:** Add real sessions — issue a signed session cookie on login, and put a
middleware check in front of the dashboard pages and every write route. Mark
admin-only routes so an "operator" login can read but not modify.

### [x] 2. Passwords are written in plain text in the code
**What:** `server.js` has `admin/admin123` and `user/user123` hardcoded, and it is
committed to git.
**Problem:** The passwords are visible to anyone with repo access, and they cannot be
changed without editing code. Git history keeps them even after removal.
**Fix:** Move accounts out of the source into a config/env file that is git-ignored,
and store password *hashes* (bcrypt/argon2), not the passwords themselves.

### [x] 3. Old personnel file is published on the web
**What:** `uploads/personnel.json` is a leftover file. It is not used by the app, but
because the whole `uploads/` folder is served publicly, anyone can fetch it at
`/uploads/personnel.json`. It contains old records with a real person's name repeated
many times.
**Problem:** Personal data is exposed to anyone with the URL.
**Fix:** Delete the file. Then stop serving non-tour files — only expose the specific
file types a tour needs, rather than the entire folder.

### [x] 4. Re-uploading a scan can silently do nothing
**What:** `/upload` skips extraction when a folder of that name already exists, but
still replies "success".
**Problem:** You upload a fresh scan, the app says it worked, and the old scan is still
there. Silent, and easy to miss — exactly the trap you'd hit while re-uploading maps.
It also leaves the uploaded `.ggpkg` sitting in the project folder as junk.
**Fix:** Either refuse the upload with a clear "that name already exists — use
Re-upload Scan instead" message, or treat it as a replace. Always delete the temporary
`.ggpkg` afterwards, success or failure.

---

## P1 — Real bugs, fix soon

### [x] 5. "Clear All" leaves orphaned data and cannot be undone
**What:** It empties the records list but leaves the actual tour folders on disk. The
data is still there, just invisible to the app, with no way back through the UI.
**Problem:** Looks like everything was deleted; disk stays full; no undo. There is also
no way to delete a *single* structure — it's all or nothing.
**Fix:** Add a per-structure Delete (record + folder together), and make Clear All
either remove the folders too or clearly say it only clears the list.

### [x] 6. The same structure can be added twice
**What:** Nothing stops two records pointing at the same project + folder.
**Problem:** Duplicate cards and duplicate dropdown entries for one real place.
**Fix:** Reject a save when that project + folder already has a record, and tell the
user it exists.

### [x] 7. The raw scan package can be downloaded by anyone
**What:** `pano3.ggpkg` (the entire tour package) and `pano3.p2vr` (the Pano2VR project
file) got bundled inside the export and are served publicly.
**Problem:** Anybody with the link can download the complete raw survey of the site.
**Fix:** Delete these from the extracted folder automatically after upload (extend the
existing `patchTour.js` step), and don't serve those extensions.

### [x] 8. The OPERATOR / ADMIN buttons on the login screen do nothing
**What:** Picking OPERATOR and then logging in with admin details still lands you on
the admin dashboard with an ADMIN badge. The role comes only from the username.
**Problem:** A control that looks meaningful but has no effect — misleading.
**Fix:** Either make it real (reject the login if the chosen role doesn't match the
account) or remove the buttons.

### [x] 9. "Sign Out" doesn't actually sign you out
**What:** It's just a link back to the login page; the stored session value stays.
**Problem:** Harmless today because there's no real login, but it becomes a genuine
security hole the moment item 1 is fixed.
**Fix:** Make it clear the session and call a `/logout` route.

---

## P2 — UI / UX

### [x] 10. Stacked map pins can't be clicked separately, and "you are here" is hidden
**What:** Several names sit on the same panorama node, so their pins land exactly on top
of each other: Kote + QM Store; Main Gate + Sentry Post; Motivation Hall + T 55 Tank +
Technodrome. Only the top pin is clickable. The amber "default start point" marker is
completely buried under the Main Gate pins.
**Problem:** You can't pick Technodrome from the map at all, and you can never see where
the tour actually starts.
**Fix:** Group pins that share a node into one pin that lists its names on click, and
always draw the origin marker on top (or give it a distinct ring).

### [x] 11. Project cards have blank grey thumbnails
**What:** Every tour ships a `preview.jpg` (~100 KB) that the dashboard never uses.
**Problem:** Cards look unfinished and all identical.
**Fix:** Point the card thumbnail at the tour's `preview.jpg`.

### [x] 12. Plain browser popups clash with the design
**What:** 13 `alert()` and 2 `confirm()` dialogs for errors and confirmations.
**Problem:** Grey system popups look out of place against the dark HUD theme, and they
freeze the page.
**Fix:** Replace with small in-page toast/confirm panels using the existing card styling.

### [x] 13. The UI claims capabilities that don't exist yet
**What:** The login screen shows `YOLOv11 / SAM 2 / Grounding DINO / NetworkX A*` and
`NODE ONLINE · GPU 0 · READY`; the dashboards show a `SERVER: ONLINE` tile that is
fixed text.
**Problem:** None of this is real — no AI models run, there's no GPU work, and the tile
says ONLINE even if nothing is checked. Fine as a mockup, misleading to anyone else.
**Fix:** Either make them live (real health check; list only what's actually wired up)
or label them clearly as planned/roadmap.

### [x] 14. Every card says "MAPPED" no matter what
**What:** The status badge is hardcoded.
**Problem:** It carries no information.
**Fix:** Derive it — e.g. show node count, or a warning when the tour can't be parsed.

### [x] 15. Small rename-form annoyances
**What:** The rename fields aren't inside a `<form>`, so pressing Enter does nothing, and
there's no check for renaming something to a name already in use.
**Problem:** Minor friction and possible confusing duplicates.
**Fix:** Wrap in a form so Enter submits; warn on duplicate names.

---

## P3 — Performance & robustness

### [x] 16. The map is re-analysed from scratch on every single request
**What:** Each API call re-reads the 340 KB `pano.xml`, rebuilds the node graph, and
re-runs 300 rounds of position estimation. Measured 190–290 ms per request, every time.
The dashboard also fires one request per structure just to show a node count.
**Problem:** Slow now, and it gets noticeably worse as you add more maps.
**Fix:** Compute once per tour and cache the result in memory (or write it to a small
JSON file next to the tour), refreshing only when the tour is re-uploaded.

### [x] 17. Uploads aren't checked before being accepted
**What:** Any zip file is accepted. There's no size limit and no check that it actually
contains a `pano.xml`.
**Problem:** A wrong or corrupt file gets accepted as a valid map and only fails later,
confusingly.
**Fix:** Verify the extension, cap the file size, and confirm `pano.xml` exists after
extraction — roll back and report a clear error if not.

### [x] 18. Upload breaks if form fields are sent in the wrong order
**What:** The server works out where to save the file from the `project` field while the
file is still uploading, so `project` *must* be sent before `file`.
**Problem:** Works today, but it's an invisible rule — any future change to the form
would break uploads with a confusing error.
**Fix:** Save to a temp folder first, then move it into place once all fields are read.

### [x] 19. One endpoint reports bad input as success
**What:** `escape-routes` given an unknown exit node returns "200 OK" with empty results
and a warning, while every other endpoint correctly returns a 400 error.
**Problem:** Inconsistent — a caller checking only the status code sees success.
**Fix:** Return 400 when none of the supplied exit nodes exist.

---

## Verified working (no action needed)

- Path traversal is properly blocked on all tour routes (tested with encoded `../`).
- Distance, escape-route, and graph maths are correct; error handling on those routes is sound.
- Deep-linking to a start point works, and the duplicate-player patch is applied
  automatically on upload.
- Structure picker correctly auto-hides for single-map projects.
- Mobile layout holds up — no horizontal scrolling at 375 px.
