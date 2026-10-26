# VAULT NINE — working notes

Story-driven FPS, browser + Android. Three.js, procedural geometry, audio and most textures. Third-party content: CC0 photo textures and decals (ambientCG, `docs/assets/mat/`), three CC0 HDRI skies (Poly Haven, `docs/assets/sky/`), eight MIT Rocketbox soldiers with CC0 Quaternius motion (`docs/assets/chars/`), 57 CC0 Poly Haven props/furniture/plants (`docs/assets/props/`), the MIT ez-tree generator (`src/vendor/ez-tree/`), all loaded at run time and listed in ASSETS.md; any new asset must be listed to the user before download and logged there. Formerly ROBOT STRIKE; local folder and localStorage keys (`robotstrike.*`) keep the old name on purpose — renaming the keys would wipe every player's saves.

Live: https://wajahatahmed82.github.io/vault-nine/  (repo `wajahatahmed82/vault-nine`; old `robot-strike` Pages URL redirects)

## Run and build

    node tools/serve.js 5181        # dev server, sends no-store
    # http://localhost:5181

    npx --no-install esbuild src/main.js --bundle --format=iife --minify --outfile=dist/bundle.js
    node tools/build.js             # writes the built page into docs/ (run-time assets live in docs/assets/)
    git add -A && git commit -m "..." && git push   # Pages redeploys from docs/

`?capture=1` enables `preserveDrawingBuffer`, screenshot tooling. `?fps` not needed — FPS readout is setting, on by default.

## Traps already hit — do not reintroduce

- **AI line of sight must test collider boxes, not raycast meshes.** Raycast merged map walks every triangle per robot per frame. Fix took AI cost 35.6ms to 4.2ms at 40 robots. See `Game.canSee`.
- **Weapon renders in second pass, own layer — `scene.background` must be nulled for that pass.** Three draws equirectangular background as full-screen mesh, depth testing off, on *every* `render()` call — leave it set, sky repaints over finished world. Symptom: world reports 47 draw calls, screen shows only sky.
- **`preserveDrawingBuffer` must stay behind `?capture=1`.** Forces full framebuffer copy every frame.
- **Dev server must send `no-store`.** python's `http.server` caches — produced scene lit by new intensities, old colours after edit.
- **Hemisphere light must be large (≈5).** Lands in indirect diffuse, which Lambert BRDF divides by PI; at 1.75, backlit wall measured rgb(14,17,24).
- **Painted steel wants low metalness.** High metalness takes all colour from environment map, renders as black slab.
- **Forward is `(-sin(yaw), -cos(yaw))`.** yaw 0 looks down -Z. Spawn with `yaw: Math.PI` points away from map.
- **Initialise every timer in `reset()`.** Undefined `spawnTimer` made `spawnTimer -= dt` NaN, Time Attack spawned nothing.
- **Mouse button state must key off `button`, not `pointerId`.** Every mouse button shares one pointerId. Track held buttons by pointerId: releasing first button clears tracked id, so second button's release matches nothing, action stays latched forever. Symptom: hold LMB+RMB, release both, player stuck aiming.
- **Freeze wave director when benchmarking.** Sweep spawning `n` enemies then stepping frames keeps spawning during timing loop — "40 enemies" really far more, reported 27fps where controlled measurement gives 267fps. Set `waveActive=false; queued=0; breakT=1e9`, assert actual count.
- **Only recompile materials when shader permutation actually changes.** Setting `material.needsUpdate` on every mesh each quality-knob move stalls hundreds of ms. `setShadows` only does it when flag flipped.
- **Pointer lock has to be switched on, not just supported.** `wantPointerLock` initialised `false`, never set anywhere — `requestPointerLock()` never ran, `pointerLocked` stayed false, `mousemove` look handler returned on first line. Symptom players report as "cannot move while shooting": view frozen whole time mouse held. `game.start` and `resume` set it; `pause`, `toMenu`, `gameOver` clear it. `main.js` also read flag under wrong name (`pointerLockWanted`).
- **Pointer lock must be requested from gesture that starts game.** Asking only on canvas mousedown means player must click world once before mouse aims anything — reads as "the character does not turn". `game.start` and `resume` run inside menu button's click handler, valid gesture, so `input.requestLock()` called there.
- **Mouse look must not require held button.** `enabled` only gate: false in menus/while paused, true in play. Gate on held button instead, view only turns while shooting.
- **Input stress test must assert look, not just held flags.** Frozen camera above passed 13/13 — no case ever moved mouse. Cases now dispatch `mousemove` every frame, require yaw change; movement scored against plain-walk baseline, not bare velocity threshold.
- **`movementX`/`movementY` read-only on constructed `MouseEvent`.** Must `Object.defineProperty` onto instance, else synthetic look test silently measures nothing.
- **Touch pads are `pointer-events:auto` over canvas.** Hidden under `(hover: hover) and (pointer: fine)` so cannot swallow desktop clicks; `#btn-pause` deliberately stays.
- **Never set `frustumCulled = false` to fix skinned mesh popping.** Posed skeleton moves vertices outside bind-pose bounds, but culling off makes every soldier draw in both passes even behind camera. Widen `geometry.boundingSphere` instead (soldier.js uses centre 0,0.95,0 r=1.35).
- **Benchmark numbers over long session worthless once machine throttles.** Old build measured 158fps at HIGH/40, then 16-56fps same code twenty minutes later. Always re-measure baseline immediately before/after candidate, same session — throw run away if baseline moved. Preset *slower* than heavier preset is the tell.
- **Hand placement on weapon must be solved, not authored.** Typed-in joint angles redone every weapon length, still leave hands beside gun not on it. soldier.js runs two-bone IK in chest space; weapon mount parented to chest too, so one solve stays correct through every torso twist, lean, recoil.
- **Support arm at >90% reach reads as plank.** Keep IK targets inside about 85% of `L_UPPER + L_FORE`, else elbow locks straight.
- **Thigh radius must stay under half-stance width.** At ±0.10 with 0.119 radius, two legs meet at crotch, silhouette reads as skirt.
- **Level that screenshots well can still be unwalkable.** `tools/walktest.js` drives real player controller along campaign route. Found three faults no still would show: leftover `arenaRadius: 54` leash cutting across stair shaft, stair treads centred so first step down was step up, and basement sealed off because staircase descends south while only door was north -- player would've had to walk back under the flight.
- **Reachability test must check height, not just X/Z.** Standing on ground floor directly above basement satisfied 2D distance check, sealed staircase passed.
- **Enemy sight ranges tuned for open arena.** 70-110m indoors means shot from across building moment you step into corridor. Campaign values 26-60m with vision cone.
- **Blue-looking world had three causes, not one.** Albedo palettes were blue-grey ([76,80,86]), the sky doubled as `scene.environment` so every PBR surface picked up its tint, and the HemisphereLight ran at 5.0 with a blue sky colour. Measured wall pixels had blue exceeding red by 41-46. All three had to change; recolouring walls alone would have done nothing.
- **A hemisphere light paints down-facing normals with its GROUND colour.** A warm-brown `ambientGround` turned every ceiling in the building brown.
- **`BoxGeometry` UVs are 0..1 per face whatever the box size.** One texture stretched across a 20m wall and squeezed onto a 2m one, which is most of why walls read as repeated identical panels. `scaleBoxUV` in facility.js rewrites UVs in metres; `TILE` holds metres-per-repeat per material.
- **Openings must sit proud of the wall face, not on its centre line.** Shell walls are 0.3 thick, so a window at the wall's z was buried inside the masonry and invisible.
- **Brick needs real dimensions.** 4 bricks per 1.35m is 337mm long and 150mm tall; it reads as a toy wall. 215x65mm with a 10mm joint means 4 per 0.9m over 12 courses.
- **Recoil must move the real aim, in a fixed pattern.** Old recoil was a camera punch that sprang back, with random yaw — aim never moved, nothing to learn or control. `src/recoil.js` gives each weapon a deterministic per-shot kick applied to `player.state` pitch/yaw before `player.step`. Mouse movement against the kick is `absorb()`-ed so recovery never drags the view past where the player put it.
- **Bullets went straight through closed doors.** Campaign doors were added to the scene but not to `game.blockers`, and raycasts ignore `visible`, so an opened door must also be removed from the list.
- **`npx esbuild` can hang on npm's update check.** Use `npx --no-install esbuild ...`.
- **A touch button that represents a press must be queued, not just held.** The first USE button used `bindHold`; a quick tap presses and releases between two frames, so `take()` never saw it. Interact now also goes through `queue.interact`. Same for desktop E on very fast presses.
- **Auto-quality must tune on real frame time.** It used `cost` (CPU submit time). Phones are GPU-bound, so `cost` stayed low and quality never dropped. `main.js` now feeds `max(cost, dt*1000)`.
- **Never request pointer lock on touch-only devices** (`TOUCH_ONLY` in input.js) — it swallows touch look.
- **Campaign parks the wave timer at 1e9**, so any HUD cell reading it shows "NEXT WAVE 1000000000s". `#combat.campaign` hides those cells.
- **HUD text never appears in canvas captures** — screenshots via the canvas miss every DOM overlay. Use the pane's real screenshot (needs the pane displayed) to see HUD bugs.
- **PowerShell can report success after an exception.** A `&&` chain carried on and deleted a source file after a failed image conversion. Check the output file exists and is non-empty before deleting the input.
- **Play rejects feature graphics with an alpha channel.** Canvas PNGs are 32-bit; export the feature graphic as JPEG.
- **String `.replace()` in build must use function.** `$&` in replacement string means "insert the match", minified JS contains `$&`.
- **Colliders go through `game.addCollider`, never `colliders.push`.** Movement, AI and sight read a `CollisionGrid` (src/collide.js); a box pushed onto the array alone is invisible to all of them.
- **Town colliders need a `bottom`.** The valley is below y=0 and `canSee` treats a missing bottom as 0, so sight lines passed under every building.
- **`blockedAt` is feet-relative.** It used absolute heights (top < 0.9 = walk over); at y=-7 every building in town counted as low enough to step over.
- **Vertex colours must be converted to linear.** three.js treats them as linear; writing sRGB values made the whole town and terrain washed out. `GeoBuf` and `terrain.js` convert.
- **Never raycast town meshes.** A merged chunk is thousands of triangles and three.js tests every one. Bullets and enemy fire use `game.castStatic` (collider boxes via the grid, plus a march over the terrain height function).
- **A road draped a few cm above the terrain shows a grass sliver under its end lip.** Start roads on existing asphalt (Station Road starts at z=45, on the shelf).
- **polygonOffset on roads drew a bright seam at grazing angles.** Use real lift (6-8 cm) and the 0.2 m world near plane instead.
- **The world pass uses near=0.2, the weapon pass near=0.03** (set in `Game.render`). 4x the depth precision at range.
- **Upload all town buffers at load** (main.js, after `renderer.compile`). Otherwise each chunk's first appearance stalled the frame ~40 ms.
- **The valley floor is legitimately down to about y=-10.** Hole and fall checks use -50 / -30, not -10.
- **Town frame cost is CPU, not GPU.** Same time at 320x180 as at 1080p; budget draw calls and objects, not pixels. Benchmark with paired runs (town on/off interleaved) — a 3-minute sweep throttled the laptop 10x.
- **A late `pointerlockchange` swallows the next mouse move** (correct in play). Tests that calibrate with one synthetic move must clear `input.swallowMove` first.
- **A car parked in a garden-boundary gap seals the garden.** Driveways sit beside the house and cars park 3.7 m inside the gap (`dressHouse`). A soldier trapped behind one is how this was found.
- **Local fan-out steering fights planned paths.** Soldiers following a nav path skip the 0.9 m fan-out probe (`onPath` in enemies.js); with it they were pushed out of every narrow gap.
- **Indoor AI timings are too short for streets.** SEARCH gave up after 9 s; town soldiers (`townSearch`) keep looking for 20 s.
- **Shell scripts with apostrophes break the Bash tool's heredoc.** Write patch scripts to a file first (story text has apostrophes).
- **CC0 photo textures arrive after the town is built.** `applyCC0` (texgen.js) loads `docs/assets/mat/<id>_{c,n,rh}.jpg` async and writes into the existing DataArrayTextures; layers a photo replaces are not drawn by `bake` (flat average colour until then, `redraw(layer)` if the photo fails). Tile sizes in `FACADE_TILE`/`ROOF_TILE`/`GROUND_TILE` are set for the photos (`[u, v]` where the source is not square). Arrays are 512 px on desktop, 256 on phones (`OUT`).
- **Bloom threshold must follow time of day.** At 1.05 sunlit pale paving glowed by day; `GRADES[...].bloom` is 1.9 day, 1.2 dusk, 1.0 night.

## Verifying changes

Drive sim headlessly from console, not by hand:

    __rs.game.start(__rs.MODE.SURVIVAL)
    for (let i=0;i<600;i++) __rs.step(1/60)

`window.__rs` exposes `game, hud, input, renderer, prog, settings, step`.
Aiming test bot, target real hitbox (`robot.hitboxes[0]` is head) via `getWorldPosition` — approximating head offset aims over their heads, makes game look broken when not.

Measure render cost with `gl.finish()`, else timing CPU submit only.
`renderer.info` resets per `render()` call, `render()` runs two passes — set `renderer.info.autoReset = false` before counting draw calls.

## Town (Meridian Ridge)

`src/terrain.js`: one analytic height function (`terrainH`) for mesh, player, AI and bullets. Station shelf flat at y=0 (`SHELF`), valley ~7 m below, mountains past `PLAY` bounds (player clamped to the rectangle; `arenaRadius` only used without a world). Fine 2.5 m tiles inside, 25 m coarse ring outside, seam heights matched.

`src/town.js`: street plan and district table are data; blocks get lots, buildings are records (`building()`), emitted by `emitBuilding` into per-80 m-chunk `GeoBuf`s per material (walls, roof, trim, glass) plus always-on ground/road. Near detail hidden beyond `detailDist` (view distance setting); one whole-town far mesh of shells inset 15 cm always draws. Lots are raised 15 cm (kerb) — `town.surfaceH` is the walkable ground. `src/geobuf.js` writes vertices straight into arrays instead of building and merging a THREE.BoxGeometry per box.

    const p = await import('/tools/perftest.js'); await p.run(__rs, { preset: 'high' })   // worst-view search + timings
    const h = await import('/tools/holescan.js'); h.run(__rs, { town: true })
    const w = await import('/tools/walktest.js'); w.run(__rs, { route: 'town' })
    const ph = await import('/tools/photo.js'); ph.on(__rs); ph.eye(__rs, x, z, yaw, pitch)

Kit and dressing: `src/townkit.js` (building parts, enterable interiors with real openings), `src/props.js` (street furniture, cars, trees, merged into chunk buffers -- no draw calls), `src/texgen.js` (texture arrays drawn with canvas 2D, sign atlas with invented names), `src/townmat.js` (array material with baked wall-foot shadow, interior-mapped window glass, shared time-of-day uniforms).

Atmosphere: `src/sky.js` paints the equirect sky per time of day (gradient, sun, clouds, stars, two ridgeline layers) and feeds PMREM; patches the fog chunks for height fog; lamp heads + light pools are instanced; up to 4 real point lights follow the nearest lamps (0 on touch devices). `src/post.js`: HDR composer, bloom (threshold 1.05 so only emissives bloom), OutputPass, grade + vignette, FXAA; `postFx` off/light/full per preset. Settings `timeOfDay` (day/dusk/night) and `weather` (clear/rain).

Life: `src/townlife.js` -- rain (vertex-shader line set), splash rings, litter, indoor dust, drain steam, burning car, birds that scatter at gunfire, swinging hanging signs (vertex shader), flag, sparking downed line, window shatter (`b.windows` rects per face), car alarms, the fuel-leak car (7 hits, blast radius 7 m). All pooled; scratch objects reused.

Gameplay: `src/nav.js` waypoint graph (streets, lots, doorways) built lazily on the first town path request (~100 ms); `Game.navSteer` re-plans when stuck. Campaign prologue in `campaign.js` (`prologue` stages before the station ones); `game.campaignFrom = 'station'` starts the old mission (campaigntest/mobiletest set it). `game.townPower` gates the town lamps.

    const t = await import('/tools/towntest.js'); t.run(__rs)    // town prologue, 11 checks

## Characters

`src/soldier.js` builds one skinned mesh per loadout over 19-bone skeleton, solves arm poses with two-bone IK. Geometry, gun geometry, IK solutions cached per loadout; each instance gets own bones, tinted material clone, small build scale — squad doesn't read as five copies of one man.

`poseSoldier()` single blended pose function, not clip switcher: walk, aim, recoil, flinch, death are weights all applying same frame. Distant soldiers (>26m) pose every third frame, stop casting shadows.

## Campaign

`src/campaign.js` holds mission 1 as data: list of objectives, each with `enter` dressing world and `done` testing completion. Soldiers placed by objective, never spawned by wave director — level contains none at all until objective 5. `src/interact.js` is [E] system; `src/facility.js` builds location.

Basement only works because `Player.groundAt` takes list of `voids`: building interior is region where outdoor ground plane doesn't exist, floor comes from real slab colliders. Without it, player stands on invisible ground at y=0 above basement.

    const c = await import('/tools/campaigntest.js'); c.run(__rs)   // 25 checks
    const w = await import('/tools/walktest.js');    w.run(__rs)    // route

## AI states

IDLE, PATROL, ALERT, CHASE, ATTACK, COVER, FLANK, SEARCH, RETREAT, DEAD.

COVER: sustained fire raises `suppressT`; soldier samples 8 directions x 2 radii
for a spot that breaks LOS to player, holds ~3s, leans back out. Sampled once on
entry, not per frame -- each candidate costs a real LOS test.
FLANK: lost contact 1.2-5s -> approach from ~60-110 deg off the last known
position instead of down the same corridor.
Kill alerts squad within 20m (soft), a non-lethal hit within 12m.

## Movement

`src/player.js` (`MOVE` constants): slide (crouch edge while sprinting; momentum decays over 0.85 s, camera tilt), tactical sprint (second Shift press within 350 ms, buffered 0.45 s because the double-tap drops the sprint for a frame; 2.6 s burst, 7 s cooldown), prone (Z toggle; jump or sprint stands up; eye 0.42 m), lean (Q/E; camera and aim move 0.42 m sideways, backs off against walls; `state.leanX/leanZ` are what AI sight aims at), mantle/vault on jump at 0.45-1.3 m cover (`_tryMantle`: vault when the obstacle is under 1.1 m deep and the far side is lower). Interact moved to F. Weapon spread takes a `stance` multiplier (prone 0.55, crouch 0.85, slide 1.6). Footsteps by surface via `Game.surfaceUnder()` / `town.groundKind()`.

- **A Shift double-tap is not a sprint for a frame.** Without the buffer the tactical request landed on a non-sprinting frame and was dropped.
- **Synthetic Shift presses in one test run count as double-taps.** inputstress resets `input.lastShift` per case.

## Gunfeel

`src/recoil.js` patterns, `src/decals.js` surface-matched impacts (one InstancedMesh per surface, pool 96). Scope sway on the marksman rifle; Shift while scoped holds breath (~4.5s, then a tired penalty). Sprint-to-fire delay per weapon (`sprintToFire` in config). Inspect on I. Empty reload racks the bolt; tactical skips it.

    const g = await import('/tools/gunfeeltest.js'); g.run(__rs)   // 12 checks

`__rs.spawnSoldier(type, x, z, yaw)` places a soldier from tools without importing enemies.js, so tests also run on the single-file build.

## Gear and ballistics (Phase 3)

`src/gear.js` (`Gear`): loot items (cap 40) with walk-over pickup for ammo/plates/meds/grenades and F for weapons/attachments (`pickable`, `promptFor`, `take`), crates, soldier drops (`dropFrom`), flying rounds, grenades with bounce, smoke volumes, plate/medkit use. `game.traceShot(origin, dir, far, noRobots)` is the one hit query (robot hitboxes, station meshes, `castStatic`); `game.applyShotHit` does damage, marks and sound. `tryFire` resolves inside 50 m at once; past it a weapon with `velocity` (rifle 600, sniper 760 m/s) spawns a round 50 m out with drop pre-applied, aimed up by the zero angle atan(g*Z/2v^2). Rounds live until they reach the weapon's range.

Noise: every shot calls `alertNear(origin, CFG.gear.hearing * W.noise)`; hearing 46 m, suppressor noise 0.22 (about 10 m). Smoke blocks `canSee` (pass `ignoreSmoke` for blast checks). Frag: 2.5 m full-damage core, falls to 0 at 8 m, LOS-shielded.

Weapons: `CFG.attachments` stat multipliers via `W.attMul`, `CFG.fits` per weapon, `W.att[id]` slots, `W.spare` carried. `W.owned === null` is arcade (everything unlocked); the campaign calls `setLoadout(['rifle', null])` and `give()` fills/swaps slots. Number keys queue `'slot:N'` over `W.slotList()`. Pistol is the always-owned sidearm (`sidearm: true`). Viewmodel hides behind a scope overlay (`W.scoped`). Checkpoints save `gear.snapshot()` (counts only; taken crate items stay taken). Pack screen = `hud.inventoryPanel()` (Tab, pauses).

    const g = await import('/tools/geartest.js'); g.run(__rs)   // 20 checks incl. both acceptance checks

- **Long-range test targets must be pinned.** `game.update` settles every soldier onto `groundAt`; a target placed in mid-air drops to the street before the round arrives. geartest freezes it and patches `groundAt` locally.
- **A pickup during the swap animation must retarget the swap.** `give()` sets `pendingSwap`, otherwise the gun just dropped stays in hand.
- **Crates have no collider.** Check the spot is clear (`game.grid.segment`) before placing one; the first roadblock spot was inside a parked car.

## Presentation (Phase 4)

`src/minimap.js`: map pre-drawn once from `grid.all` colliders + `town.streets` (2 px/m, 1 on phones; ground and basement layers), drawn as a rotated crop (view up) at 30 Hz; compass bar 120 deg. Objective = `campaign.markerPos()` from each stage's `mark` (interactable id or function). Enemy gunfire = `game.fireMarks` (2.5 s).

Audio: `audio.spatial.*` wrap tone/noise layers in a PannerNode (HRTF desktop, equalpower phones) + distance lowpass; `curBus` routes layers built inside `at()`. Listener follows the camera every frame (`audio.setListener`). `audio.spatialLog` (ring of 40, `seq` numbered) is what tests read. `deafen()` muffles the sfx bus for flashbangs. Voices are formant-synth barks (not words); text via `game.onCallout`.

Enemies: magazines (`MAG`) and reload with callout, `ctx.callout/onStep/throwNade`, `blindT` from flashbangs, elites/assaults throw a flashbang when they lose sight of a near player. `game.callout` has a shared 0.9 s and per-soldier 4 s cooldown.

`src/screenfx.js`: suppression (with incoming direction), hurt, chroma, low-health desat, flash; settings `fxSuppression/fxLowHealth/fxFlash/fxChroma`. Post on: one `EffectsShader` pass in post.js (disabled when idle). Post off: `#screenfx` CSS layer (no blur, no RGB split). `showHud` setting adds `.nohud` to `#combat`.

AO: depth-only SSAO in `post.applyAO`, called by `Game.renderScene` between the world and weapon passes; composer targets carry DepthTexture; half-res, multiplied in with a custom blend. `ao` knob in presets (high/ultra), desktop auto on and dropped first by the auto-tuner. Cost measured only as a ratio under throttling (~6% GPU frame time).

    const t = await import('/tools/presenttest.js'); t.run(__rs)   // 21 checks

- **The hidden browser pane throttles timers and rAF.** Front the tab (`tabs_select`) before timing anything, and don't await setTimeout loops while hidden.
- **Audio-log tests must use `seq`, not indices** -- the log is a ring.
- **Test scenes need open ground.** Main Street has parked cars along both kerbs that block soldiers' sight; the Ridge Road / Main Street junction (0, 110) is open on four sides.

## Mission 2 and the truck (Phase 5)

`Campaign` holds two stage lists: `m1` (town prologue + station) and `m2` from `_mission2()`; `start(diff, 'm2')` picks mission 2 (`game.campaignFrom = 'm2'`). Mission 2 forces night via `game._setTime` (not the setting). Stage extras: `mark`, `tick(dt)` (the hold's countdown, shown in the objective hint), `opts.target` (marksmen), `opts.persist` (standing patrols, kept across objectives and respawned on a checkpoint reload). Props (junction boxes, jammer) go through `_prop` / `_clearProps`.

`src/vehicle.js`: one pickup truck, mission 2 only, placed at (0, 27) in line with the south gate. Footprint sampled at eight points against `game.blockedAt`; terrain-following; orbit camera via `placeDriverAndCamera()` after `weapons.update`. While driving, `Game.update` zeroes the on-foot inputs; Space is the held `fire` action in the input layer, so that is the brake. Half damage to the driver; run-overs kill above 5 m/s.

    const t = await import('/tools/mission2test.js'); t.run(__rs)   // 11 checks
    const v = await import('/tools/vehicletest.js');  v.run(__rs)   // 8 checks
    const w = await import('/tools/walktest.js');     w.run(__rs, { route: 'mission2' })

- **Checkpoint restore used to double the stage's soldiers.** `restore()` calls the stage's `enter()` (for its interactables), which also spawns; those are now removed before the checkpoint's own list is respawned.
- **Main Street has a burning car at z 206 and the roadblock at z 302 in the middle of the road.** Routes go round them (x -2.5 past the car, the east pavement x 8.2 past the roadblock).
- **Patrols pause at each end of their beat** -- give movement checks ten seconds, not three.

Driving camera (graphics prompt Phase 1): `placeDriverAndCamera(dt, look)` -- base yaw springs to heading + 0.4 x yaw rate (leads into turns), mouse look offset relaxes after 1.5 s idle, boom 6.2-8.8 m and FOV +9 with speed, boom shortened by `traceShot` (station meshes, town boxes, terrain), floor clamp asks from above the outdoor surface. C or SWAP toggles a bonnet view. Truck footprint samples sit 0.55 m inside the body because `blockedAt` pads by 0.55.

    const d = await import('/tools/drivetest.js'); d.run(__rs)   // keys-only autopilot over the mission 2 streets, 7 checks

- **drivetest judges "where I'm going" as where the truck actually is 0.8 s later**, from the camera of the judged frame; a thin pole may hide it briefly, so the pass mark is "never hidden longer than 0.25 s" (actual: 99.55% of frames visible, longest gap 0.1 s).
- **The abandoned car on Main Street (z 236) was moved 0.4 m kerbward** so a vehicle lane is 3.4 m wide; the truck used to wedge there.

## Light and sky (graphics prompt 2, Phase 1)

Skies: `sky.js` loads `assets/sky/<time>_{2k|1k}.hdr` (1k on phones) through `src/assets.js` (thin top progress bar), draws the two ridgelines and a below-horizon fill into the photo, converts to half floats, and uses it for background + PMREM. `TIMES[t].hdr` holds the photo's sun/moon direction and the background/env/hemi/sun/exposure scales; fog takes the photo's horizon colour away from the sun. The painted sky stays as the fallback. The dev server maps `/assets/` to `docs/assets/` so there is one copy; the APK copies only the 1k files.

Shadows: `src/shadows.js` patches three's light loop for two cascades -- the sun (64 m, sharp) and `sunFar` (340 m, black light, radius 2.5, refreshed every 0.5 s or 6 m). Both boxes texel-snapped by `placeSnapped`. Far cascade on desktop at shadow size >= 1024; the auto-tuner drops it first (~11% GPU at the square, paired, throttled).

Night: 6 lamp point lights on desktop, shop-window light pools (`windowPools`), wet-road lamp streaks (`wetStreaks`, 18 nearest lamps, rain only), one shared enemy muzzle-flash light, truck headlight spot (desktop). Light shafts: `post.setRays` + a sky mask drawn from the world pass's depth in `applyAO`, then a 40-tap radial pass in HDR before OutputPass; strength `TIMES[t].rays`.

    const v = await import('/tools/views.js'); await v.capture(__rs, 'after')   // 5 views x 3 times -> shots/ (needs tools/shotsrv.js and ?capture)
    const t = await import('/tools/gputime.js'); await t.queue(__rs, 'square', 'dusk'); t.read(__rs)   // GPU ms with timer queries

- **Project the sun inside the far plane.** `camera.position + sunDir * 1000` lies past `camera.far` and projects as "behind the camera"; the shafts never switched on.
- **Captures must run one real `game.update` per view.** The shadow boxes and lamp lights follow the player, not the camera; photo mode alone left every view outside both shadow maps.
- **A script cut off mid-capture leaves photo mode on** (`game.update` is the no-op). Reload the page before the next capture.
- **Never junction `node_modules` into a git worktree.** `git worktree remove --force` followed the junction and emptied the real `node_modules` (restored with `npm ci`; esbuild comes from the npx cache, not the lockfile). Copy what a temp checkout needs, or delete the junction first.
- **The Artifact preview cannot load `docs/assets`** (no `.hdr` type, no outside requests): it shows the painted sky. The live site has the photo skies.
- **The photo skies are far brighter than the painted ones.** Day needed env 0.38, hemi x0.3, exposure 0.82 or pale yards blew out to white.

## Real people (graphics prompt 2, Phase 2)

Soldiers are Microsoft Rocketbox avatars (MIT) driven by Quaternius UAL motion capture (CC0), built offline into `docs/assets/chars/<look>{_lo}.glb` by `tools/charbuild.js` (runs in the dev page; needs `node tools/assetsrv.js` on 5177 and the sources in git-ignored `raw/`). One skinned mesh, one atlas material (one draw call), 80-bone biped, ten baked clips. Desktop loads all 8 (1024 px parts, 17.2 MB), phones 6 `_lo` (512 px, 6.8 MB). `assets.fetchAsset` keeps them in Cache Storage -- bump `CACHE` in assets.js when any asset file changes.

`src/humans.js`: `Human` (one per enemy when `humansReady()`; `soldier.js` stays the fallback) and `FPArms` (the player's arms, cut from a soldier's arm triangles, hung from the camera; `weapons.useArms`). Clips own legs/hips/spine; then hip yaw toward travel, upper-spine twist back + aim pitch, foot plant (<16 m), rifle placed from the right shoulder bone (pocket offsets), two-bone arm IK onto the carried gun's grip/guard (`viewmodel.buildCarriedGun`, 85% of the viewmodel, vertex colours), hand frames + finger curls, forearm roll. Hit boxes are boxes attached to bones (`hitboxes()`, [0] = head). Deaths: two clips, body turned square to the shot first, rifle drops. Menu waits for the models (`hud.setLoading`); Credits screen carries the MIT notice.

    const v = await import('/tools/humanview.js'); await v.capture(__rs, 'after')   // idle/running/firing/dying at 2/10/40 m
    const f = await import('/tools/humanfit.js'); f.run(__rs)                      // palm-to-grip error per loadout
    const b = await import('/tools/crowdbench.js'); await b.run(__rs, { n: 24 })   // people vs built-in, paired
    const r = await import('/tools/fprig.js'); await r.run(__rs, 'rifle')          // first-person rig from the side
    __rs.useHumans(false)   // spawn built-in soldiers (before shots, benchmarks)

- **`Skeleton.pose()` drops a root bone's parent transform.** It takes the bind matrix as the local matrix; the glTF armature's -90 degree X turn vanished and every retargeted clip lay flat. `restPose()` in charbuild uses `skin.matrixWorld * bindMatrix^-1 * boneInverse^-1`.
- **FBXLoader makes the skeleton root's parent a Bone too.** "Root = parent is not a Bone" found nothing and the bake loop never ran (all-zero tracks). Use "parent not in the skeleton".
- **Rocketbox rests in an A-pose, UAL in a T-pose.** Limbs are swung to the source's directions before deltas are measured.
- **FBX UVs are v-up; the textures went in flipY=false.** Legs sampled the hands and boots of the atlas (skin-coloured thighs). UVs are flipped in `packGeometry`.
- **GLTFExporter re-encodes textures through `canvas.toBlob`** (JPEG 0.92); charbuild patches it to 0.85 for the export.
- **Never read `getWorldPosition/Quaternion` in the solver.** Each call re-multiplies every ancestor; it made a person cost 260 us. Read `matrixWorld` and refresh with `own(bone)`; a bone's matrix must be refreshed *before* it is read in a frame or last frame's twist compounds (the chest spun 100 degrees).
- **Thighs hang off `Bip01_Spine` in this rig.** Twist only Spine1/Spine2 or the legs turn with the chest.
- **The viewmodel's handguard is out of a real arm's reach.** Carried guns are 85% size with the support hand on the handguard's rear; FPArms are 1.15x, bladed 0.35 rad, and slide the support hand back when still short.
- **Bone matrices are uploaded every frame for people** even when the distance LOD holds the pose (every 2nd/3rd/6th frame past 16/26/50 m): they are world space, so a skipped upload leaves the body behind a moving root.

## Real buildings and streets (graphics prompt 2, Phase 3)

Props, furniture and plants are Poly Haven scans built by `tools/propbuild.mjs` (gltf-transform: join, weld, simplify to the `BUDGET` table, KTX2 textures, meshopt) into `docs/assets/props/<file>{_lo}.glb`. `src/models.js` holds `KINDS` (a file plus a node regex, recentred, parts merged per material) and `KindInstances`: one InstancedMesh per kind part for the whole town, refilled with the placements inside the kind's `VIEW` distance when the camera moves 6 m (trees swap to `_far` versions 80-420 m). Town code places with `P.place(kind, x, y, z, rot, s, sy, col, sx)` into `chunk.placements`; buildings get `b.place`. Box stand-ins go in each chunk's `props` buffer and hide once `modelsReady()`. Cars are lofted in code (`src/cars.js`), trees grown with ez-tree (`src/trees.js`), grass tufts round the camera (`src/grass.js`).

Materials: `tools/matbuild.mjs` packs ambientCG zips into colour / normal / `_rh` (R rough, G height, B AO) JPEGs and `_d.webp` decals. `townmat.js` does parallax occlusion (height in albedo alpha, 14 steps, fades 14-24 m, off on phones) and moss/damp at wall feet. `src/towndecals.js` is one 4x4 atlas (grime, cracks, posters, graffiti, patches, manholes, drain, oil) drawn into each chunk's `decal` buffer. Interiors (`makeEnterable`, town.js) place furniture models with `model(...)`; `stand(item(...))` keeps the box as collider and stand-in.

    const s = await import('/tools/routeshots.js'); await s.capture(__rs, 'route')   // a shot per walk-route waypoint (needs tools/shotsrv.js and ?capture)
    __rs.loadTimes   // town / models / modelsOn / humans, ms since navigation

- **New dressing must not draw from the town's shared random stream `r`.** One extra `r()` reshuffles every later car and prop: a parked car landed on the drive test's waypoint and a van closed the rooftop marksman's sightline. Use `PR.hash01(x, z, k)` or a local `rng(seed)`; a replacement for old code must take exactly as many draws (the grown tree keeps the old tree's one).
- **Colliders taller than knee height must keep their Phase 2 size unless the routes are re-checked.** Wider tree trunks and canopy columns, a 2 m van and a street cabinet each broke a test sightline or route.
- **Bench colliders were a 1.8 m square whatever the rotation**, closing most of a pavement; they now follow the model's footprint.
- **The walk-test probe never stopped strafing once it started** and circled the target into a bench; it now walks straight again once closing in with a clear line ahead.
- **Hanging signs need one face per side**, each reading left to right from its side, 2.4 cm apart; two coplanar double-sided quads showed mirrored text.
- **Decal quads on roads take the terrain height per corner**; one height for the whole quad buried half of it on slopes.

## Mobile and Android

Touch: contextual USE (`#btn-interact`, label = first word of the prompt, red LOCKED when keycard too low), BREATH when scoped, inspect, turn-sideways card in portrait, fullscreen + landscape lock from the start tap. `tools/mobiletest.js` (11 checks) includes a press-and-release with no frame between.

Android: Capacitor 8 (`capacitor.config.json`, `android/`), app id `com.wajahatahmed.vaultnine`. `.github/workflows/android.yml` copies `docs/index.html` into `www/`, `cap sync`, builds a debug APK and publishes it to release `android-latest`. Signed AAB only when the owner's `VN_KEYSTORE_*` secrets exist; `app/build.gradle` reads them from env. Bump `versionCode` before every Play upload. Store listing/graphics/guides in `store/`.

## Input

Every action independent latched boolean in `src/input.js`, built from three OR'd sources (keyboard, mouse buttons, on-screen buttons). One-shot actions go through edge queue drained once per frame. Nothing in input ever cancels unrelated action.

`tools/inputstress.js` dispatches real KeyboardEvent/MouseEvent objects at listeners, asserts 13 simultaneous-input combinations plus the movement set (slide + fire, lean + aim + fire, mantle while reloading, prone, tactical sprint, slide-into-cover-lean-fire-duck). Run after any input change:

    const t = await import('/tools/inputstress.js'); t.run(__rs)

## Open

- No human playtesting. All balance bot-derived — treat every tuning number as hypothesis.
- Armour bar wired into damage, nothing grants armour yet.