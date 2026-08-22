# TAC-GRID — What It Is, In Plain Language

For someone who has never seen the tool and has to explain it to a senior
officer. No prior knowledge assumed. Read this before `BRIEFING.md` (how to
present) and `RUNBOOK.md` (which button is where).

---

## 1. The one-paragraph version

Someone walked the Cadet Training Wing with a 360° camera and photographed it
from **108 positions**. TAC-GRID takes those photographs and turns them into a
working model of the site: you can stand at any of those positions and look
around, measure the real walking distance between any two of them, and read an
automatic assessment of what each viewpoint offers tactically — cover,
concealment, hidden ground, approach routes, hazards. It runs on one laptop,
with no internet, and nothing ever leaves the machine.

The mental model to give a senior officer: **it is the site itself, captured
and made queryable.**

---

## 2. What the raw material actually is

Four things sit underneath everything else. Knowing them stops you being caught
out by "where does this come from?"

**a. The 108 panoramas.** Each is a complete 360° photograph taken from one
standing position — a "node". You can look in any direction from it, including
up and down. Together they cover the site.

**b. The 282 links between them.** When the survey was done, each position was
connected to the ones you can physically walk to from it. That connectivity was
made by *walking the site*, so it is ground truth about what actually connects
to what — better than any map could infer.

**c. 15 named places.** Main Gate, Rear Gate, Kote, Gymnasium, Charlie Block,
Eklavya Mess, Wing Office, Central Anteroom, Motivation Hall and others, tied
to the positions they were photographed from.

**d. Real coordinates for 11 positions.** Actual latitude and longitude, so
distances come out in true metres rather than as a sketch. **Be upfront that
it is 11 of 108** — see §7.

---

## 3. The four modalities — the same site, seen four ways

This is the clearest way to structure a brief. One site, four lenses.

### Modality 1 — The map (top-down, geographic)
An OpenStreetMap view of the site with the surveyed positions marked. This is
the orientation view: where things are in relation to each other.

You can drop your own markers on it — **note, hazard or asset** — for things
the photographs do not show: a gate that is kept locked, a stretch of broken
wire, a generator. Coordinates are entered by pasting from Google Maps, in
either decimal or degrees-minutes-seconds.

### Modality 2 — The immersive view (first-person, 360°)
Click into any position and you are standing there. Drag to look around, zoom,
and click the on-screen markers to walk to a connected position. This is the
same experience as being on the ground, from 108 vantage points.

There are **drawing tools** over the top — rectangle, circle, arrow, freehand —
so you can mark up what you are looking at while briefing. Draw the arc you
want watched, circle the doorway, trace the approach.

### Modality 3 — The automatic assessment (AI reading the imagery)
Two different engines, and it matters that they are different:

**Object detection.** Recognises common physical objects — people, vehicles,
furniture. At the Main Gate it picks out two people, a car, a bench and two
potted plants. It uses a fixed list of about 80 everyday object types, so it
does **not** know what a door, a window or a nallah is. Runs on the laptop's
processor, no internet.

**Scene understanding.** This is the substantial one. For each of the four
horizontal directions from a position, it writes a tactical readout:

- **Features** — the structures present, and their doors, windows, gates and openings
- **Cover** — what would actually stop a bullet: walls, vehicles, kerbs, embankments
- **Concealment** — what hides a person without stopping fire: vegetation, shadow, dead ground
- **Hidden ground** — which objects block line of sight, and what sits behind each
- **Routes** — every way a person could move into or through that view
- **Hazards** — ditches, nallahs, barbed wire, slopes, loose surface, power lines

In the immersive view this panel **follows the direction you are looking**.
Turn to face the gate and it tells you about the gate.

All 108 positions are analysed and cached. It is performed by an AI model
running **on the laptop's own graphics card** — the imagery is never uploaded
anywhere. That is the whole reason it is built this way.

### Modality 4 — Distance and time (the planning lens)
Two related capabilities:

**Route measurement.** Pick any two surveyed positions and get the real walking
distance in metres plus turn-by-turn directions, following the paths that
actually exist rather than a straight line. Main Gate to Rear Gate is 402 m.

**Reaction analysis.** The standout capability — see §5. Pick a position where
something has happened and get every other surveyed position ranked by how long
it takes to reach, grouped into bands: within 30 seconds, within a minute,
within two minutes, beyond. Three paces: walking, brisk, double time.

---

## 4. The supporting features

Less demonstrable, but they are what make it a tool rather than a demo.

- **Two levels of access.** Operators can view everything; only an administrator
  can change data, place positions or upload a new survey.
- **Works with no connection.** The map imagery and route calculations are
  cached to the laptop. Verified by capturing every network request the app
  makes: all of them go to the laptop itself, none to the outside world.
- **Re-surveying does not destroy work.** All the added material — coordinates,
  markers, assessments — is stored separately from the photographs. Re-upload
  a fresh survey and the analysis work survives.
- **Survey round-trip.** Positions can be exported as a spreadsheet, filled in
  with coordinates in the field, and imported back.
- **Add more sites.** A new 360° survey can be uploaded and gets the same
  treatment.

---

## 5. Reaction analysis — lead with this

The single most persuasive thing in the tool, because it answers a question no
public mapping service answers.

Choose a position where an incident has occurred. The tool returns every
surveyed position ranked by real walking time along the site's own paths.

Incident at the **Main Gate**, walking pace:

| Position | Distance | Reaction time |
|---|---|---|
| Eklavya Mess | 32 m | 24 s |
| Charlie Block | 75 m | 56 s |
| Central Anteroom | 95 m | 1 min 10 s |
| Wing Office | 131 m | 1 min 37 s |
| Kote | 250 m | 3 min 05 s |
| Motivation Hall | 268 m | 3 min 19 s |
| Rear Gate | 402 m | 4 min 58 s |

The conclusion states itself: **the Rear Gate cannot reinforce the Main Gate
inside five minutes at walking pace.** Switch to double time and watch the
bands re-sort. That is a siting and manning decision being made on measured
evidence rather than impression.

Uses for it: positioning a reserve, checking whether sentry posts can support
one another, judging whether a post can be reinforced before an incident is
over, and sanity-checking response plans that were written from memory.

---

## 6. "How is it different from Google Maps?"

You will be asked this. A weak answer here undoes the whole brief.

**Start by conceding what is true.** For a public street, Google is better —
better imagery, better directions, enormous coverage. Do not pretend otherwise;
a senior officer will spot it instantly and stop believing the rest.

Then give four things it cannot do:

**1. It does not have the inside of your camp.** No Street View vehicle has
driven this site and none will. These 108 positions are ground that exists in
no public dataset. This is not a better map of somewhere Google covers — it is
a map of somewhere Google does not.

**2. It cannot work disconnected.** Google Maps without a connection is a blank
grid. This runs with the network off entirely: imagery, map, routes and AI
assessment all served from the machine. Demonstrate it rather than assert it.

**3. It cannot answer a tactical question.** Google answers "how do I get from
here to there". It has no concept of cover, concealment, dead ground or an
approach route. It will never tell you which wall would stop a round, or what
the hut on the right is hiding.

**4. It cannot do reaction analysis at all — the sharpest difference.** Google
is point-to-point navigation between two things you already named. It cannot
answer *"something just happened here — who can reach it, in what order, and
how long does each take?"* That question is the whole of response planning, and
this answers it in one click for the site's own paths.

**The one-line version:**

> Google Maps tells you how to get somewhere. This tells you **who can get
> there in time**, on ground Google has never seen, with no connection.

**And on privacy, which is really the deciding argument:** using a public
service to study a defence site means uploading the layout of that site to a
commercial company. Everything here happens on the laptop. For this class of
site that is not a preference, it is the requirement.

---

## 7. What to be honest about

Volunteer these. A brief that states its own limits is the one that gets
believed, and each of these will be found within minutes by anyone competent.

- **11 of 108 positions carry real coordinates.** Distances between surveyed
  positions are accurate; extending across the whole cantonment is a surveying
  effort, not a software one.
- **The AI is an aid, not a source of truth.** It describes imagery from one
  day. It can miss things and it can be confidently wrong. Every output needs a
  human to confirm it before it informs a decision.
- **There is no fire planning.** No killzones, arcs or fields of fire. The tool
  has never done this. Do not let "cover and hidden ground" be heard as fire
  control — a Brigadier knows the difference better than anyone in the room.
- **It is not live.** It reflects the day of the survey. Anything built,
  demolished or moved since is not represented.
- **It is not surveillance.** No cameras, no tracking, no monitoring, no
  identifying of individuals.
- **The Main Gate assessment is hand-written, not AI output.** It is the best
  text in the system. Presenting it as what the model produced is the one
  mistake that could genuinely discredit you.

---

## 8. If you only remember five sentences

1. Someone photographed the site from 108 positions in 360°.
2. You can stand at any of them, look around, and measure real walking
   distances between them.
3. An AI running on the laptop reads each view and reports cover, concealment,
   hidden ground, approach routes and hazards.
4. It tells you who can reach an incident and how fast — which is response
   planning, not navigation.
5. It all runs on one laptop with no internet, and no imagery ever leaves it.
