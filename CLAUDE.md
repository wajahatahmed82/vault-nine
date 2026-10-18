# VAULT NINE — working notes

Story-driven FPS, browser + Android. Three.js, all procedural (geometry, textures, audio) — no asset files, nothing licensed. Formerly ROBOT STRIKE; local folder and localStorage keys (`robotstrike.*`) keep the old name on purpose — renaming the keys would wipe every player's saves.

Live: https://wajahatahmed82.github.io/vault-nine/  (repo `wajahatahmed82/vault-nine`; old `robot-strike` Pages URL redirects)

## Run and build

    node tools/serve.js 5181        # dev server, sends no-store
    # http://localhost:5181

    npx esbuild src/main.js --bundle --format=iife --minify --outfile=dist/bundle.js
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

## Verifying changes

Drive sim headlessly from console, not by hand:

    __rs.game.start(__rs.MODE.SURVIVAL)
    for (let i=0;i<600;i++) __rs.step(1/60)

`window.__rs` exposes `game, hud, input, renderer, prog, settings, step`.
Aiming test bot, target real hitbox (`robot.hitboxes[0]` is head) via `getWorldPosition` — approximating head offset aims over their heads, makes game look broken when not.

Measure render cost with `gl.finish()`, else timing CPU submit only.
`renderer.info` resets per `render()` call, `render()` runs two passes — set `renderer.info.autoReset = false` before counting draw calls.

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

## Gunfeel

`src/recoil.js` patterns, `src/decals.js` surface-matched impacts (one InstancedMesh per surface, pool 96). Scope sway on the marksman rifle; Shift while scoped holds breath (~4.5s, then a tired penalty). Sprint-to-fire delay per weapon (`sprintToFire` in config). Inspect on I. Empty reload racks the bolt; tactical skips it.

    const g = await import('/tools/gunfeeltest.js'); g.run(__rs)   // 12 checks

`__rs.spawnSoldier(type, x, z, yaw)` places a soldier from tools without importing enemies.js, so tests also run on the single-file build.

## Mobile and Android

Touch: contextual USE (`#btn-interact`, label = first word of the prompt, red LOCKED when keycard too low), BREATH when scoped, inspect, turn-sideways card in portrait, fullscreen + landscape lock from the start tap. `tools/mobiletest.js` (11 checks) includes a press-and-release with no frame between.

Android: Capacitor 8 (`capacitor.config.json`, `android/`), app id `com.wajahatahmed.vaultnine`. `.github/workflows/android.yml` copies `docs/index.html` into `www/`, `cap sync`, builds a debug APK and publishes it to release `android-latest`. Signed AAB only when the owner's `VN_KEYSTORE_*` secrets exist; `app/build.gradle` reads them from env. Bump `versionCode` before every Play upload. Store listing/graphics/guides in `store/`.

## Input

Every action independent latched boolean in `src/input.js`, built from three OR'd sources (keyboard, mouse buttons, on-screen buttons). One-shot actions go through edge queue drained once per frame. Nothing in input ever cancels unrelated action.

`tools/inputstress.js` dispatches real KeyboardEvent/MouseEvent objects at listeners, asserts 13 simultaneous-input combinations. Run after any input change:

    const t = await import('/tools/inputstress.js'); t.run(__rs)

## Open

- No human playtesting. All balance bot-derived — treat every tuning number as hypothesis.
- Armour bar wired into damage, nothing grants armour yet.