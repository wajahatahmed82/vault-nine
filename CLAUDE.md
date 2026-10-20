# VAULT NINE — working notes

Story-driven FPS, browser + Android. Three.js, procedural geometry, audio and most textures. The only third-party content is nine CC0 photo textures (ambientCG), listed in ASSETS.md and embedded by `tools/cc0pack.js` into `src/cc0data.js`; any new asset must be listed to the user before download and logged there. Formerly ROBOT STRIKE; local folder and localStorage keys (`robotstrike.*`) keep the old name on purpose — renaming the keys would wipe every player's saves.

Live: https://wajahatahmed82.github.io/vault-nine/  (repo `wajahatahmed82/vault-nine`; old `robot-strike` Pages URL redirects)

## Run and build

    node tools/serve.js 5181        # dev server, sends no-store
    # http://localhost:5181

    npx --no-install esbuild src/main.js --bundle --format=iife --minify --outfile=dist/bundle.js
    node tools/build.js             # writes the single-file build into docs/
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
- **CC0 photo textures arrive after the town is built.** `applyCC0` (texgen.js) decodes them async and writes into the existing DataArrayTextures; tile sizes in `FACADE_TILE`/`ROOF_TILE`/`GROUND_TILE` are already set for the photos (`[u, v]` where the source is not square). Arrays are 512 px on desktop, 256 on phones (`OUT`).
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