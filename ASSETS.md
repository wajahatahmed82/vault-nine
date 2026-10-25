# Third-party assets

Everything in Vault Nine is generated in code except what is listed below:
CC0 1.0 textures, skies and motion capture (public domain dedication: no
attribution required, credited anyway) and MIT-licensed soldier models
(attribution required: see Soldiers).

Downloaded 2026-10-20 from ambientCG (https://ambientcg.com), 1K-JPG packs. Only
the Color, NormalGL and Roughness maps are used, downscaled to 512 px (256 px on
phones) and embedded in `src/cc0data.js` by `tools/cc0pack.js`.

| Asset | Source | Licence | Used for | Processing |
|---|---|---|---|---|
| Bricks104 | https://ambientcg.com/view?id=Bricks104 | CC0 1.0 | red brick facades, low garden walls | resized |
| Plaster001 | https://ambientcg.com/view?id=Plaster001 | CC0 1.0 | rendered facades | colour made neutral grey so paint colours tint it |
| WoodSiding008 | https://ambientcg.com/view?id=WoodSiding008 | CC0 1.0 | timber-clad houses | colour made neutral grey so paint colours tint it |
| Concrete034 | https://ambientcg.com/view?id=Concrete034 | CC0 1.0 | concrete facades, yards and hardstanding | resized |
| RoofingTiles003 | https://ambientcg.com/view?id=RoofingTiles003 | CC0 1.0 | slate roofs | resized |
| RoofingTiles013A | https://ambientcg.com/view?id=RoofingTiles013A | CC0 1.0 | asphalt-shingle house roofs | resized |
| Grass005 | https://ambientcg.com/view?id=Grass005 | CC0 1.0 | lawns and gardens | resized, tinted down in-game |
| PavingStones138 | https://ambientcg.com/view?id=PavingStones138 | CC0 1.0 | cobbled town square | resized |
| Asphalt033 | https://ambientcg.com/view?id=Asphalt033 | CC0 1.0 | roads | resized |

## Skies

Downloaded 2026-10-21 from Poly Haven (https://polyhaven.com), 2K Radiance HDR.
All Poly Haven assets are CC0 1.0. The 2K files are used as-is on desktop; 1K
copies for phones were made with a 2x2 box filter and re-encoded as RLE RGBE.
Stored once in `docs/assets/sky/` and loaded at run time (only the current time of day's file).
In game, two distant ridgelines are drawn into the horizon and the sky below
the horizon is filled with the haze colour.

| Asset | Source | Licence | Used for | Files |
|---|---|---|---|---|
| Kloofendal 48d Partly Cloudy (Pure Sky) | https://polyhaven.com/a/kloofendal_48d_partly_cloudy_puresky | CC0 1.0 | day sky and lighting | day_2k.hdr (5.5 MB), day_1k.hdr (1.4 MB) |
| Belfast Sunset (Pure Sky) | https://polyhaven.com/a/belfast_sunset_puresky | CC0 1.0 | dusk sky and lighting | dusk_2k.hdr (4.6 MB), dusk_1k.hdr (1.2 MB) |
| Kloppenheim 02 (Pure Sky) | https://polyhaven.com/a/kloppenheim_02_puresky | CC0 1.0 | night sky and moonlight | night_2k.hdr (5.6 MB), night_1k.hdr (1.4 MB) |

## Soldiers

Built by `tools/charbuild.js` into `docs/assets/chars/` (one GLB per soldier,
loaded at run time by `src/humans.js`, kept in Cache Storage after the first
visit). Sources live in `raw/` (git-ignored). The built-in procedural soldier
(`src/soldier.js`) remains the fallback when the files cannot load.

**Microsoft Rocketbox avatars** -- MIT licence, Copyright (c) 2020 Microsoft.
Downloaded 2026-10-25 from https://github.com/microsoft/Microsoft-Rocketbox
(`Assets/Avatars/Professions/<name>/Export/<name>.fbx` and the `Textures/`
TGAs). MIT requires the notice to travel with the files: it is in
`docs/assets/chars/LICENSE-Rocketbox.txt` and on the in-game Credits screen.
Changes made: every part's colour, normal and roughness packed into one atlas
per soldier (1024 px per part desktop, 512 px phones, JPEG); the national
flag on the sleeve painted over with an invented unit patch; UVs flipped to
glTF; mesh indexed, vertex colour dropped, skin weights stored as bytes;
skeleton re-posed from A-pose to T-pose for retargeting; exported in metres.

| Asset | Source (Professions/...) | Licence | Used for | Desktop / phone file |
|---|---|---|---|---|
| Military_Male_01 | Military_Male_01 | MIT | rifleman, gunner | military_male_01.glb 2.59 MB / _lo 1.40 MB (not on phones) |
| Military_Male_02 | Military_Male_02 | MIT | recon (cap, no vest) | 1.67 / 0.95 MB |
| Military_Male_03 | Military_Male_03 | MIT | marksman, operator | 2.56 / 1.39 MB |
| Military_Male_04 | Military_Male_04 | MIT | rifleman, gunner, operator | 2.41 / 1.34 MB |
| Military_Male_05 | Military_Male_05 | MIT | recon | 1.58 / 0.92 MB |
| Military_Male_06 | Military_Male_06 | MIT | recon | 1.56 / 0.90 MB |
| Military_Female_01 | Military_Female_01 | MIT | rifleman | 2.41 / 1.28 MB |
| Military_Female_02 | Military_Female_02 | MIT | marksman | 2.43 / 1.28 MB (not on phones) |

Desktop loads all eight (17.2 MB); phones load six `_lo` files (6.8 MB).

**Universal Animation Library [Standard] by Quaternius** -- CC0 1.0.
Downloaded 2026-10-25 from https://quaternius.itch.io/universal-animation-library
(free tier, `UAL1_Standard.glb`, 7.6 MB). Ten clips are retargeted onto every
Rocketbox skeleton and baked into each GLB at 30 fps: Idle_Loop, Walk_Loop,
Jog_Fwd_Loop, Sprint_Loop, Crouch_Idle_Loop, Crouch_Fwd_Loop, Hit_Chest,
Hit_Head, Death01, and Death01 mirrored. The source file is not shipped.

Everything else (buff brick, stone, corrugated metal, clay roof tiles, felt
roofs, pavement slabs, gravel, road paint, signs, terrain, weapons, sound) is
still procedural.
