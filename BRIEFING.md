# TAC-GRID — Briefing Plan (Senior Officer / Bde Cdr)

How to present this system to a Brigadier. Written for a 15–20 minute slot with
questions. The guiding principle: **demonstrate, don't describe.** This is a
visual tool and it sells itself on screen. Slides about architecture will lose
the room in ninety seconds.

---

## 1. Read the audience

A Bde Cdr is assessing four things, in this order:

1. **Does this reduce risk or save time for my command?**
2. **What are its limits — where would it mislead someone?**
3. **Does it scale beyond this one demo site?**
4. **What does it cost me — money, manpower, training, maintenance?**

He is *not* assessing your choice of framework. Never say "Node", "Express",
"JSON" or "ONNX" unless asked directly. Translate everything into capability.

Speak in service terminology the system genuinely supports: approach routes,
cover and concealment, dead ground, blind spots, obstacles and nallahs, entry
and exit points, sentry positions, response timings.

---

## 2. The opening line

Lead with the outcome and the OPSEC posture in one breath:

> "Sir — this takes a 360° photographic survey of a site and turns it into a
> planning tool. You can measure real walking distances along actual paths,
> brief approach routes from the commander's own viewpoint, and get an
> automatic readout of cover, blind spots and entry points at any position.
> It runs entirely on this laptop. No internet, and no imagery ever leaves
> the machine."

That last sentence is the single most important thing you will say. For a
defence site, a cloud AI tool is a non-starter. A local one is a different
conversation entirely. Say it early and prove it later.

---

## 3. Demo arc (12–15 minutes)

Run it in this order. Each step earns the next.

**(a) The map — 2 min.** Open on the site with nodes placed. Establish that
this is the real location, not a mock-up. Let him orient himself.

**(b) Real routing — 3 min. This is the credibility moment.** Pick two points
he knows — Main Gate to Rear Gate, or Main Gate to Kote. Show the distance in
metres and the turn-by-turn. Emphasise it follows **actual paths**, not a
straight line. Invite him to name the two points himself; the fact that it
answers an unrehearsed question is worth more than any slide.

**(c) Into the tour — 3 min.** Open the 360° view at the Main Gate. Pan
around. He is now standing at his own gate. This lands emotionally in a way
the map does not.

**(d) The scene readout — 3 min.** With the tactical panel open, pan and show
the analysis following the direction of view — structures, doors and openings,
cover, approach routes, hazards. Read one or two entries aloud. Let him check
them against what he knows of the ground; his own verification is more
convincing than your assertion.

> **Read §6a before demonstrating this.** The Main Gate node contains a
> *hand-written* analysis, not model output. Demonstrating it while implying
> the AI produced it is the one mistake that could genuinely discredit you.

**(e) Object detection — 1 min.** In the Explore panel pick **Main Gate** and
click **DETECT OBJECTS AT THIS POSITION**. It returns 2 people, a car, a bench
and 2 potted plants, broken down by direction. Frame it honestly as a
*different, narrower* capability from the scene readout — about 80 everyday
object types, nothing more.

Demo Main Gate specifically. Several positions legitimately return nothing
(Charlie Block is a building exterior with no people or vehicles in shot), and
"no objects found" is a weak thing to show a Brigadier even though it is the
correct answer.

**(f) The OPSEC close — 2 min. Save this for last; it is the winner.**
Physically disable the network — pull the cable, switch on flight mode, do it
where he can see. Then run an analysis. It still works. Say plainly:

> "The AI model is running on this laptop's own graphics card. The imagery of
> your site is never transmitted anywhere. This is why it is built this way."

Ending on demonstrated OPSEC rather than a features list is what makes the
brief memorable.

---

## 4. Pre-brief checklist — do not skip any of this

Rehearsal failures here are the difference between a confident brief and a
visible fumble.

- [ ] **Change the default password.** `node setPassword.js admin <new>`.
      Logging in as `admin` / `admin123` in front of a senior officer
      undermines every security claim you are about to make.
- [ ] **Pre-cache the map and routes** ("Save map for offline"). The map tiles
      and the routing engine are the only parts that touch the internet. If
      they are not cached, a dead connection kills your best demo.
- [ ] **Pre-run the scene analysis** on every node you intend to show. Each
      node takes minutes on a laptop GPU. Do not stand in silence waiting.
- [ ] **Warm the model** immediately before the brief — run one analysis so
      the model is resident in GPU memory. A cold start adds a slow first run.
- [ ] **Full dry run, on battery, in flight mode**, exactly as you will
      present it. Everything above is untested until you have done this once.
- [ ] **Fallback ready.** Short screen-recording of the working demo on the
      same laptop. If something fails, you continue the brief instead of
      debugging in front of him.
- [ ] **Know your numbers cold**: how many nodes surveyed, how many positioned,
      how long an analysis takes, what hardware it needs.

---

## 5. Anticipated questions — and honest answers

Prepare these. Confident, bounded answers build far more trust than
enthusiasm, and a Bde Cdr will find the edges of a claim quickly.

**"Can this cover the whole cantonment / a forward location?"**
Yes in principle — the method is the same. Be straight about the current
state: one structure surveyed, and only a fraction of its nodes carry real
coordinates. Scaling is a surveying effort, not a software problem. Give a
realistic estimate of effort per site.

**"How accurate is the AI? Can I plan on it?"**
The most important answer to get right. It is a **planning and familiarisation
aid, not a source of truth.** It describes what is visible in imagery taken on
one day. It can miss things, and it can be confidently wrong. Every output must
be verified by a person before it informs a decision. Say this plainly and
unprompted — overclaiming here is how a tool like this gets banned after one
bad call.

**"Does it identify threats or people?"**
No, and do not imply otherwise. It recognises common objects — a person, a
vehicle — and separately describes scenes in prose. It does not identify
individuals, assess intent, or detect threats.

**"Is the imagery current?"**
It reflects the date of the survey. Anything built, demolished or changed since
is not represented. Re-surveying is how you refresh it.

**"What does it cost?"**
The software stack is free and open. The cost is a laptop with a suitable
graphics card, plus the time to survey a site.

**"Who runs and maintains it?"**
Answer honestly, including the sustainment risk if it currently rests on one
person. A senior officer will respect a named gap more than a vague assurance.

**"How is it secured?"**
Login with separate operator and admin roles; admin required for any change.
Be equally clear that **the real sensitive item is the laptop itself**, because
it holds imagery and layout of the site — it needs to be handled and stored
accordingly.

---

## 6a. Two things this system does NOT do — read before briefing

Measured across the analysed nodes, not assumed. Both matter because a
Brigadier will ask about exactly these.

**There is no killzone analysis. None.** The term does not appear anywhere in
the system — not in the prompt, the data schema, or any output. Nor does any
fire-control concept: fields of fire, arcs, interlocking fire, enfilade or
defilade. The tool has never done this and does not do it now. If asked, say so
plainly. Do not let "cover and blind spots" be heard as fire planning; they are
not the same thing, and a Brigadier knows the difference better than anyone in
the room.

**Blind-spot detection is real as a field but weak in practice.** Of 70
per-direction blind-spot entries, only 9 say anything substantive. Broken down
by what produced them:

| Source | Substantive blind spots |
|---|---|
| Hand-written (node56, Main Gate) | 4 of 6 (67%) |
| Cloud model, 26B (node12) | 4 of 6 (67%) |
| **Local model, qwen2.5vl 7B** | **2 of 66 (3%)** |

The local 7B model answers "none obvious" 97% of the time. Compare the same
field on the same site:

- *Hand-written:* "Dead ground behind the hedging and the left-hand building
  is hidden." / "The interior of the sentry cabin and ground behind the
  barrier block are not visible."
- *Local model:* "none obvious" / "none obvious" / "none obvious."

**The practical consequences:**

1. **Do not attribute the Main Gate readout to the AI.** It is human-written
   and it is by far the best content in the system. If you demo it as model
   output and he later sees a locally-analysed node, the gap is obvious and
   your credibility goes with it.
2. **Demo the capabilities that are genuinely strong** — structures and their
   doors, gates and openings; approach routes; hazards such as barbed wire and
   nallahs. Those the local model does well and consistently.
3. If blind spots specifically are what he cares about, the honest answer is
   that it needs a larger model, and that is a hardware or connectivity
   decision — not something to paper over.

---

## 6b. What not to claim

Integrity here protects both you and the tool.

- Not real-time. It works from a past survey, not a live feed.
- Not surveillance. No cameras, no tracking, no live monitoring.
- Not threat detection or facial recognition.
- **Not fire planning.** No killzones, arcs, or fields of fire — see §6a.
- **Not reliable blind-spot detection** on the local model — see §6a.
- Not a substitute for a physical recce — it supports one.
- Do not present a node you have not personally reviewed. If the AI has
  written something wrong about ground he knows, that single error will
  define his impression of the whole system.

---

## 7. Useful framings for employment

If asked "what would I actually use it for", these are supportable:

- **Familiarisation** for an officer, guard commander or sentry posted in, who
  can walk the site before setting foot on it.
- **Orders and briefing aid** — brief a route or a position from the actual
  viewpoint rather than a sketch.
- **Security review** of a perimeter: approaches, blind spots, gaps in
  observation, obstacles.
- **Response planning** — measured walking distances and times between
  positions, on the paths people actually use.
- **Continuity** — an accurate record of a site that survives postings and
  handovers.

---

## 8. Running it efficiently

Measured on this laptop (RTX 5060 8 GB), analysing one node:

| Configuration | Time per node |
|---|---|
| 6 faces, model cold | 58 s |
| 6 faces, model warm | 44 s |
| 4 faces, model warm (**default**) | **27–29 s** |

**Do not analyse nodes live.** Pre-analyse the whole structure once and the
briefing runs entirely off cache, instantly. Analysing all 108 nodes takes
about 50 minutes, unattended:

```
node analyzeAll.js "CTW" "Main Gate"
```

It skips anything already done, so it is safe to stop with Ctrl-C and re-run
later to resume. Run it the night before, not the morning of.

**What actually made it faster, and why:**

- **Skipping the up and down faces** is the single biggest win — a third of the
  runtime for no tactical value. "Up" is sky; "down" is the tripod patch under
  the camera (on one node it earnestly reported chalk graffiti reading "LOVE").
  Front/right/back/left is the default. Override with
  `TACGRID_VLM_FACES=front,right,back,left,up,down` if you ever need all six.
- **Keeping the model warm** saves roughly a quarter. The model is held in GPU
  memory for 10 minutes after a request, so a batch run pays the load cost once
  instead of per node. Before a briefing, run one analysis to warm it.
- **One node at a time is deliberate — do not "optimise" this by running them
  in parallel.** The model occupies 6.7 GB of the card's 8.1 GB. A second
  concurrent request spills into system RAM and runs *slower*, not faster.

If you need more speed than this, the lever is a smaller model
(`TACGRID_OLLAMA_MODEL=qwen2.5vl:3b`) — roughly twice as fast, with a
noticeable drop in description quality. Test it on a node you know well before
committing to it.

---

## 9. Practical presentation mechanics

The content is only half of it. These are the things that actually go wrong.

**Screen and room.** Never present this off a laptop screen to more than two
people — the tool is detail-heavy and the panel text is small. Get an external
display or projector, confirm the cable and adapter *the day before*, and set
the laptop to mirror rather than extend so you can see what he sees. Bump the
browser to 125–150% zoom (`Ctrl` and `+`); what is comfortable at arm's length
is unreadable across a table.

**Kill every interruption.** Windows notifications, Teams, email, update
prompts. Use Focus Assist. A popup mid-brief is the kind of thing a senior
officer remembers instead of your work.

**Set the stage before he walks in.** Server running, browser open, logged in,
model warm, map already loaded on the site. Do not brief anyone through a login
screen or a loading spinner. Have the tour open in a second tab so you switch
rather than navigate.

**Rehearse the click path until it is muscle memory.** Run the full sequence
end to end at least three times. You should be able to talk while clicking,
looking at him rather than the screen. Hunting for a button destroys the
impression of a finished system faster than any missing feature.

**Power and time.** Mains power, charger in the bag, battery full anyway. Plan
for a 15-minute slot to become 8 — know which two things you would cut. The
routing demo and the OPSEC close are the ones to protect; the object detector
is the first to drop.

**Let him drive if he wants to.** If he asks "what about over there?", hand
over the mouse. A senior officer exploring his own site unprompted is worth
more than anything you had scripted — which is exactly why the whole structure
must be pre-analysed, so wherever he clicks responds instantly.

**Have a named next step.** Do not end on "any questions". End with a specific
ask: a decision on scaling to another site, permission to survey, or a follow-up
with his staff officer. A brief without an ask is a demonstration, not a
proposal.

---

## 10. Leave-behind

One page, no jargon: what it does, what it does not do, what it needs to run,
what scaling would take, and a named point of contact. Include the limitations
section. A leave-behind that states its own limits is the one that gets
believed — and it is what he will actually forward onward.
