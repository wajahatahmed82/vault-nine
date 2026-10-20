# VAULT NINE

A story-driven tactical shooter for the browser and Android. Contact with Meridian Ridge Research Station stopped fourteen hours ago. Find out why.

- **Play in a browser:** https://wajahatahmed82.github.io/vault-nine/
- **Android test build:** [android-latest release](https://github.com/wajahatahmed82/vault-nine/releases/tag/android-latest)
- **Privacy policy:** https://wajahatahmed82.github.io/vault-nine/privacy.html

Almost everything is generated in code with Three.js: geometry, characters, sound and most textures. The exceptions are nine CC0 (public domain) photo textures from ambientCG, listed in [ASSETS.md](ASSETS.md).

## The game

- **Meridian Ridge:** a walkable mountain town of about 150 buildings below the station. It has a Main Street of shops with signs and awnings, a square with a town hall and clock tower, houses and terraces, an industrial edge with a rail siding and water tower, and ten buildings you can walk into.
- **Campaign, "The Signal":** starts at a police roadblock on the edge of town, works through the police station, the substation and the town hall, then climbs to a two-floor research station with keycards, locked doors, checkpoints and a story told through logs, recordings and terminals.
- **Living world:** day, dusk or night with working street lights. Rain with splashes and wet roads, steam from drains, a burning car, birds that scatter at gunfire, swinging signs, a flag, a sparking power line, windows that shatter, car alarms, and a car you can blow up.
- **Human enemies** on a 19-bone skinned rig. They patrol, guard, notice you through a vision cone, take cover, flank and react to casualties. Stealth works; crouching halves how fast you're spotted.
- **Gunplay** with per-weapon learnable recoil patterns, surface-matched bullet impacts, scope sway with breath-holding, tactical and empty reloads. Rifle rounds past 50 m fly with travel time and drop; the marksman scope zeroes at 100-400 m.
- **Loot and gear:** soldiers drop their weapon, ammo and kit; crates in the level. Attachments change real numbers (red dot, 2x, 4x, suppressor, compensator, foregrip, extended magazine). Two primaries plus a sidearm in the campaign, armour plates, medkits, frag and smoke grenades.
- **Presentation:** minimap and compass with the objective and enemy gunfire, killfeed, objective pop-ups, a mission-complete screen. Positional 3D audio for gunfire, footsteps, impacts and soldiers' callouts. Camera effects (suppression blur, low-health colour drain, flashbang white-out, hit colour split), each switchable; the HUD can be hidden entirely. Ambient occlusion on HIGH/ULTRA.
- **Survival and Time Attack** arcade modes.
- **Phones:** landscape touch controls, a contextual USE button, automatic quality that starts lean and adapts to real frame time.

## Controls

| Desktop | Phone |
|---|---|
| WASD move, mouse look | left thumb drag to move, right side drag to look |
| Left click fire, right click aim | FIRE, ADS |
| Shift sprint, Shift twice for a dash (hold breath while scoped) | push the stick to its edge to sprint, DASH, BREATH while scoped |
| Ctrl crouch (slide when sprinting), Z prone, Space jump (vaults waist-high cover), R reload | CRCH, PRONE, JUMP, RELD |
| Q / E lean | lean arrows above SWAP |
| F interact | USE (appears when something is in reach) |
| 1–5 weapons (primaries, then sidearm), I inspect, Esc pause | SWAP, inspect button, pause button |
| G frag, T smoke, V flashbang, B armour plate, H medkit, Tab pack (attachments, gear), [ ] sniper zero | NADE, BAG |

## Run and build

```bash
node tools/serve.js 5181
```

Then open http://localhost:5181.

```bash
npx --no-install esbuild src/main.js --bundle --format=iife --minify --outfile=dist/bundle.js
node tools/build.js
```

`tools/build.js` writes the single-file game to `docs/`, which GitHub Pages serves. Pushing to `main` also triggers `.github/workflows/android.yml`, which wraps that same file with Capacitor and publishes a test APK.

## Shipping

The `store/` folder holds the Play Store listing text, icon, feature graphic and screenshots, plus step-by-step guides:

- `store/PLAY_STORE.md`: account, upload key, the 12-tester closed test, and production
- `store/ITCH.md`: free browser release on itch.io
- `store/APP_STORE.md`: what iOS needs and the cheapest way to get it

## Tests

Run in the browser console on the dev server (or the built `docs/index.html`):

```js
(await import('/tools/campaigntest.js')).run(__rs)   // mission playthrough, 25 checks
(await import('/tools/gunfeeltest.js')).run(__rs)    // recoil, spread, scope, impacts, 12 checks
(await import('/tools/mobiletest.js')).run(__rs)     // phone controls, 11 checks
(await import('/tools/inputstress.js')).run(__rs)    // simultaneous input + movement set, 22 checks
(await import('/tools/walktest.js')).run(__rs)       // level route walkability ({ route: 'town' } for the town)
(await import('/tools/towntest.js')).run(__rs)       // town prologue, 11 checks
(await import('/tools/geartest.js')).run(__rs)       // ballistics, suppressor, loot, attachments, grenades, gear, 20 checks
(await import('/tools/presenttest.js')).run(__rs)    // HUD, 3D audio, callouts, camera effects, AO, 21 checks
(await import('/tools/holescan.js')).run(__rs, { town: true })   // reachable spots with no floor
(await import('/tools/perftest.js')).run(__rs, { preset: 'high' })   // worst-view search and timings
```

## Layout

```
src/            game source (town, terrain, sky, facility, campaign, soldiers, weapons, input, HUD)
tools/          build, dev server, test suites
docs/           built single-file game and privacy policy, served by GitHub Pages
android/        Capacitor Android project
store/          store listing, graphics and release guides
```
