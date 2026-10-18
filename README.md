# VAULT NINE

A story-driven tactical shooter for the browser and Android. Contact with Meridian Ridge Research Station stopped fourteen hours ago. Find out why.

- **Play in a browser:** https://wajahatahmed82.github.io/vault-nine/
- **Android test build:** [android-latest release](https://github.com/wajahatahmed82/vault-nine/releases/tag/android-latest)
- **Privacy policy:** https://wajahatahmed82.github.io/vault-nine/privacy.html

Everything is generated in code with Three.js: geometry, textures, characters and sound. There are no model, texture or audio files and nothing is licensed from anyone.

## The game

- **Campaign, "The Signal":** eight objectives through a two-floor research station, with keycards, locked doors, checkpoints and a story told through logs, recordings and terminals.
- **Human enemies** on a 19-bone skinned rig. They patrol, guard, notice you through a vision cone, take cover, flank and react to casualties. Stealth works; crouching halves how fast you're spotted.
- **Gunplay** with per-weapon learnable recoil patterns, surface-matched bullet impacts, scope sway with breath-holding, tactical and empty reloads.
- **Survival and Time Attack** arcade modes.
- **Phones:** landscape touch controls, a contextual USE button, automatic quality that starts lean and adapts to real frame time.

## Controls

| Desktop | Phone |
|---|---|
| WASD move, mouse look | left thumb drag to move, right side drag to look |
| Left click fire, right click aim | FIRE, ADS |
| Shift sprint (hold breath while scoped) | push the stick to its edge to sprint, BREATH while scoped |
| Ctrl crouch, Space jump, R reload | CRCH, JUMP, RELD |
| E interact | USE (appears when something is in reach) |
| 1–4 weapons, I inspect, Esc pause | SWAP, inspect button, pause button |

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
(await import('/tools/inputstress.js')).run(__rs)    // simultaneous input, 15 checks
(await import('/tools/walktest.js')).run(__rs)       // level route walkability
```

## Layout

```
src/            game source (facility, campaign, soldiers, weapons, recoil, input, HUD)
tools/          build, dev server, test suites
docs/           built single-file game and privacy policy, served by GitHub Pages
android/        Capacitor Android project
store/          store listing, graphics and release guides
```
