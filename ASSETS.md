# Third-party assets

Everything in Vault Nine is generated in code except what is listed below:
CC0 1.0 textures, skies and motion capture (public domain dedication: no
attribution required, credited anyway) and MIT-licensed soldier models
(attribution required: see Soldiers).

Downloaded 2026-10-20 from ambientCG (https://ambientcg.com), 1K-JPG packs.
Colour, NormalGL, Roughness, height and AO maps are used, downscaled to 512 px
(256 px on phones) by `tools/matbuild.mjs` into `docs/assets/mat/` and loaded
at run time (embedded in the bundle before Phase 3).

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

Everything else (corrugated metal, felt roofs, gravel, signs, terrain,
weapons, sound) is still procedural.

## Phase 3: street props, furniture, plants (Poly Haven)

Downloaded 2026-10-25 from Poly Haven (https://polyhaven.com), glTF with 1K
textures; all CC0 1.0. Sources in `raw/p3/models/` (git-ignored). Built by
`tools/propbuild.mjs` (gltf-transform: dedup, prune, flatten, join, weld,
simplify to a per-model triangle budget, textures to KTX2 at 512 px desktop /
256 px phones, quantize, meshopt) into `docs/assets/props/<name>.glb` and
`<name>_lo.glb`, loaded at run time by `src/models.js` and kept in Cache
Storage. Seven downloaded models ended up unused and are not shipped (marked
below).

| Asset | Source | Licence | Download | Used for | Desktop / phone file |
|---|---|---|---|---|---|
| street_lamp_01 | https://polyhaven.com/a/street_lamp_01 | CC0 1.0 | 2.17 MB | box-built street lamps (main streets) | 0.16 / 0.05 MB |
| street_lamp_02 | https://polyhaven.com/a/street_lamp_02 | CC0 1.0 | 1.87 MB | box-built street lamps (side streets) | not used, not shipped |
| fire_hydrant | https://polyhaven.com/a/fire_hydrant | CC0 1.0 | 5.52 MB | box hydrants | 0.43 / 0.15 MB |
| metal_trash_can | https://polyhaven.com/a/metal_trash_can | CC0 1.0 | 4.99 MB | box litter bins | 0.46 / 0.15 MB |
| concrete_road_barrier_02 | https://polyhaven.com/a/concrete_road_barrier_02 | CC0 1.0 | 2.93 MB | box roadblock barriers | 0.21 / 0.06 MB |
| modular_chainlink_fence | https://polyhaven.com/a/modular_chainlink_fence | CC0 1.0 | 7.29 MB | box yard fences | 0.59 / 0.35 MB |
| modular_electricity_poles | https://polyhaven.com/a/modular_electricity_poles | CC0 1.0 | 12.42 MB | box telegraph poles and wires | 0.95 / 0.62 MB |
| modular_metal_gutter | https://polyhaven.com/a/modular_metal_gutter | CC0 1.0 | 2.21 MB | new: gutters and drainpipes on buildings | 0.25 / 0.11 MB |
| modular_street_seating | https://polyhaven.com/a/modular_street_seating | CC0 1.0 | 7.62 MB | box benches in the square | not used, not shipped |
| utility_box_01 | https://polyhaven.com/a/utility_box_01 | CC0 1.0 | 1.98 MB | box street cabinets | 0.18 / 0.06 MB |
| utility_box_02 | https://polyhaven.com/a/utility_box_02 | CC0 1.0 | 2.03 MB | box street cabinets (second look) | 0.18 / 0.06 MB |
| security_light | https://polyhaven.com/a/security_light | CC0 1.0 | 2.39 MB | new: wall floodlights on yards and the station | 0.09 / 0.04 MB |
| exterior_aircon_unit | https://polyhaven.com/a/exterior_aircon_unit | CC0 1.0 | 7.67 MB | new: wall air-con units | 0.64 / 0.20 MB |
| rollershutter_door | https://polyhaven.com/a/rollershutter_door | CC0 1.0 | 2.34 MB | box garage and warehouse doors | not used, not shipped |
| rollershutter_window_01 | https://polyhaven.com/a/rollershutter_window_01 | CC0 1.0 | 2.24 MB | new: shuttered shop windows | not used, not shipped |
| old_tyre | https://polyhaven.com/a/old_tyre | CC0 1.0 | 2.24 MB | new: litter, yards | 0.06 / 0.02 MB |
| covered_car | https://polyhaven.com/a/covered_car | CC0 1.0 | 2.35 MB | new: parked cars under covers | 0.25 / 0.10 MB |
| modular_fire_escape | https://polyhaven.com/a/modular_fire_escape | CC0 1.0 | 4.81 MB | new: fire escapes on tall blocks | 0.46 / 0.19 MB |
| painted_wooden_bench | https://polyhaven.com/a/painted_wooden_bench | CC0 1.0 | 1.99 MB | box garden and park benches | 0.19 / 0.06 MB |
| planter_box_01 | https://polyhaven.com/a/planter_box_01 | CC0 1.0 | 2.34 MB | box planters | 0.23 / 0.08 MB |
| Barrel_01 | https://polyhaven.com/a/Barrel_01 | CC0 1.0 | 0.69 MB | box barrels | 0.08 / 0.03 MB |
| barrel_03 | https://polyhaven.com/a/barrel_03 | CC0 1.0 | 0.57 MB | box barrels (second look) | 0.06 / 0.03 MB |
| wooden_crate_01 | https://polyhaven.com/a/wooden_crate_01 | CC0 1.0 | 2.28 MB | box crates | 0.07 / 0.03 MB |
| plastic_crate_03 | https://polyhaven.com/a/plastic_crate_03 | CC0 1.0 | 3.34 MB | box crates (plastic) | 0.20 / 0.16 MB |
| cardboard_box_01 | https://polyhaven.com/a/cardboard_box_01 | CC0 1.0 | 2.17 MB | box rubbish piles | 0.06 / 0.02 MB |
| old_military_crate | https://polyhaven.com/a/old_military_crate | CC0 1.0 | 2.50 MB | box loot crates | 0.22 / 0.08 MB |
| propane_tank | https://polyhaven.com/a/propane_tank | CC0 1.0 | 2.21 MB | new: yard clutter | 0.07 / 0.03 MB |
| portable_generator | https://polyhaven.com/a/portable_generator | CC0 1.0 | 3.43 MB | new: checkpoint and roadblock clutter | 0.31 / 0.16 MB |
| WetFloorSign_01 | https://polyhaven.com/a/WetFloorSign_01 | CC0 1.0 | 0.27 MB | new: interior clutter | 0.04 / 0.02 MB |
| metal_office_desk | https://polyhaven.com/a/metal_office_desk | CC0 1.0 | 1.61 MB | box desks (police, station offices) | 0.18 / 0.08 MB |
| modern_arm_chair_01 | https://polyhaven.com/a/modern_arm_chair_01 | CC0 1.0 | 2.70 MB | box office chairs | 0.30 / 0.10 MB |
| SchoolChair_01 | https://polyhaven.com/a/SchoolChair_01 | CC0 1.0 | 0.48 MB | box plain chairs | 0.07 / 0.03 MB |
| steel_frame_shelves_01 | https://polyhaven.com/a/steel_frame_shelves_01 | CC0 1.0 | 1.60 MB | box shelving (stores, warehouse) | 0.14 / 0.05 MB |
| worn_metal_rack | https://polyhaven.com/a/worn_metal_rack | CC0 1.0 | 2.01 MB | box racks (warehouse) | 0.21 / 0.10 MB |
| wooden_bookshelf_worn | https://polyhaven.com/a/wooden_bookshelf_worn | CC0 1.0 | 2.78 MB | box bookshelves | 0.22 / 0.07 MB |
| drawer_cabinet | https://polyhaven.com/a/drawer_cabinet | CC0 1.0 | 1.14 MB | box filing cabinets | 0.18 / 0.11 MB |
| mounted_fluorescent_lights | https://polyhaven.com/a/mounted_fluorescent_lights | CC0 1.0 | 1.86 MB | new: ceiling tube lights | 0.19 / 0.10 MB |
| CashRegister_01 | https://polyhaven.com/a/CashRegister_01 | CC0 1.0 | 1.04 MB | new: shop counters | 0.14 / 0.08 MB |
| Sofa_01 | https://polyhaven.com/a/Sofa_01 | CC0 1.0 | 0.52 MB | box sofas (houses) | 0.20 / 0.07 MB |
| CoffeeTable_01 | https://polyhaven.com/a/CoffeeTable_01 | CC0 1.0 | 0.96 MB | box coffee tables | 0.08 / 0.04 MB |
| Television_01 | https://polyhaven.com/a/Television_01 | CC0 1.0 | 0.53 MB | new: house interiors | 0.07 / 0.03 MB |
| classic_laptop | https://polyhaven.com/a/classic_laptop | CC0 1.0 | 2.18 MB | new: desks | 0.11 / 0.07 MB |
| office_notepads | https://polyhaven.com/a/office_notepads | CC0 1.0 | 1.33 MB | new: desk clutter | 0.04 / 0.03 MB |
| metal_stool_01 | https://polyhaven.com/a/metal_stool_01 | CC0 1.0 | 2.29 MB | box stools | 0.08 / 0.03 MB |
| wooden_display_shelves_01 | https://polyhaven.com/a/wooden_display_shelves_01 | CC0 1.0 | 0.47 MB | box shop shelves | 0.16 / 0.06 MB |
| tool_cart | https://polyhaven.com/a/tool_cart | CC0 1.0 | 3.17 MB | new: garage interior | 0.25 / 0.11 MB |
| metal_tool_chest | https://polyhaven.com/a/metal_tool_chest | CC0 1.0 | 2.36 MB | new: garage interior | 0.22 / 0.10 MB |
| dining_table | https://polyhaven.com/a/dining_table | CC0 1.0 | 2.28 MB | box kitchen tables | not used, not shipped |
| plastic_monobloc_chair_01 | https://polyhaven.com/a/plastic_monobloc_chair_01 | CC0 1.0 | 1.95 MB | box cafe chairs | 0.08 / 0.04 MB |
| painted_wooden_chair_01 | https://polyhaven.com/a/painted_wooden_chair_01 | CC0 1.0 | 0.49 MB | box kitchen chairs | 0.06 / 0.03 MB |
| painted_wooden_table | https://polyhaven.com/a/painted_wooden_table | CC0 1.0 | 1.78 MB | box tables | 0.05 / 0.02 MB |
| painted_wooden_shelves | https://polyhaven.com/a/painted_wooden_shelves | CC0 1.0 | 2.11 MB | box wall shelves | 0.06 / 0.02 MB |
| painted_wooden_cabinet | https://polyhaven.com/a/painted_wooden_cabinet | CC0 1.0 | 1.86 MB | box cupboards | 0.19 / 0.07 MB |
| korean_fire_extinguisher_01 | https://polyhaven.com/a/korean_fire_extinguisher_01 | CC0 1.0 | 1.62 MB | new: corridor clutter | 0.15 / 0.06 MB |
| wall_clock | https://polyhaven.com/a/wall_clock | CC0 1.0 | 1.56 MB | new: office walls | 0.07 / 0.04 MB |
| modern_ceiling_lamp_01 | https://polyhaven.com/a/modern_ceiling_lamp_01 | CC0 1.0 | 0.44 MB | new: house ceiling lights | 0.05 / 0.02 MB |
| hanging_industrial_lamp | https://polyhaven.com/a/hanging_industrial_lamp | CC0 1.0 | 3.24 MB | new: warehouse lights | 0.28 / 0.10 MB |
| shrub_02 | https://polyhaven.com/a/shrub_02 | CC0 1.0 | 1.97 MB | box/sphere bushes | 0.23 / 0.10 MB |
| shrub_03 | https://polyhaven.com/a/shrub_03 | CC0 1.0 | 1.63 MB | box/sphere bushes (second look) | not used, not shipped |
| shrub_04 | https://polyhaven.com/a/shrub_04 | CC0 1.0 | 1.91 MB | box/sphere bushes (third look) | not used, not shipped |
| potted_plant_04 | https://polyhaven.com/a/potted_plant_04 | CC0 1.0 | 2.12 MB | new: doorsteps and offices | 0.23 / 0.08 MB |
| planter_pot_clay | https://polyhaven.com/a/planter_pot_clay | CC0 1.0 | 1.80 MB | new: doorsteps | 0.06 / 0.02 MB |
| weed_plant_02 | https://polyhaven.com/a/weed_plant_02 | CC0 1.0 | 2.05 MB | new: weeds at wall bases and kerbs | 0.08 / 0.04 MB |
| fern_02 | https://polyhaven.com/a/fern_02 | CC0 1.0 | 1.15 MB | new: damp corners, verges | 0.07 / 0.03 MB |

## Phase 3: textures and decals (ambientCG)

Downloaded 2026-10-25 from ambientCG, 1K-JPG zips, CC0 1.0. Sources in
`raw/p3/tex/` (git-ignored). Built by `tools/matbuild.mjs` into
`docs/assets/mat/`: `<id>_c.jpg` (colour), `_n.jpg` (normal, GL),
`_rh.jpg` (R roughness, G height for parallax, B ambient occlusion), and for
decals with an opacity map `_d.webp` (colour with alpha); 512 px desktop,
`_lo` 256 px phones. The nine textures from 20 Oct now load the same way
(they were embedded in the bundle before; the height maps come from the same
zips).

| Asset | Source | Licence | Download | Used for |
|---|---|---|---|---|
| Bricks097 | https://ambientcg.com/view?id=Bricks097 | CC0 1.0 | 5.17 MB | old red brick terraces and shops (with depth map) |
| Bricks090 | https://ambientcg.com/view?id=Bricks090 | CC0 1.0 | 7.49 MB | industrial brick (warehouses, yard) |
| Bricks103 | https://ambientcg.com/view?id=Bricks103 | CC0 1.0 | 5.58 MB | procedural buff brick |
| Bricks110A | https://ambientcg.com/view?id=Bricks110A | CC0 1.0 | 7.90 MB | procedural stone (bank, church, civic fronts) |
| Bricks066 | https://ambientcg.com/view?id=Bricks066 | CC0 1.0 | 7.23 MB | procedural grey stone (police station, plinths) |
| PaintedBricks004 | https://ambientcg.com/view?id=PaintedBricks004 | CC0 1.0 | 6.96 MB | plain painted walls |
| RoofingTiles012A | https://ambientcg.com/view?id=RoofingTiles012A | CC0 1.0 | 4.76 MB | procedural clay roof tiles |
| Asphalt013 | https://ambientcg.com/view?id=Asphalt013 | CC0 1.0 | 8.65 MB | new: cracked and patched road sections |
| Road012A | https://ambientcg.com/view?id=Road012A | CC0 1.0 | 8.29 MB | new: worn tarmac on side roads |
| PavingStones136 | https://ambientcg.com/view?id=PavingStones136 | CC0 1.0 | 6.48 MB | procedural pavement slabs (cracks added on top) |
| RoadLines007 | https://ambientcg.com/view?id=RoadLines007 | CC0 1.0 | 1.72 MB | procedural road markings (worn dashed lines) |
| RoadLines009 | https://ambientcg.com/view?id=RoadLines009 | CC0 1.0 | 1.96 MB | procedural road markings (worn solid lines) |
| ManholeCover003 | https://ambientcg.com/view?id=ManholeCover003 | CC0 1.0 | 5.95 MB | new: round manhole covers |
| ManholeCover007 | https://ambientcg.com/view?id=ManholeCover007 | CC0 1.0 | 4.37 MB | new: rectangular utility covers |
| Grate001 | https://ambientcg.com/view?id=Grate001 | CC0 1.0 | 7.59 MB | new: kerb drains |
| Leaking003 | https://ambientcg.com/view?id=Leaking003 | CC0 1.0 | 4.05 MB | new: grime streaks under sills and gutters |
| Moss002 | https://ambientcg.com/view?id=Moss002 | CC0 1.0 | 10.39 MB | new: moss and damp at wall bases and roof edges |
| Bark006 | https://ambientcg.com/view?id=Bark006 | CC0 1.0 | 9.55 MB | new: tree bark (generated trees) |
| LeafSet026 | https://ambientcg.com/view?id=LeafSet026 | CC0 1.0 | 3.06 MB | box/sphere tree crowns (leaf cards) |
| Foliage006 | https://ambientcg.com/view?id=Foliage006 | CC0 1.0 | 2.28 MB | flat grass (moving grass blades) |

In game: Leaking003 is the grime under sills (faded out downwards in the
atlas), Asphalt013 the patched tarmac, the two ManholeCover sets the covers,
Grate001 (cropped to the cast iron) the kerb drains; all four live in one
decal atlas (`src/towndecals.js`) with cracks, posters, graffiti and oil
stains drawn in code (every word on them invented). RoadLines009's chipped
edge line is used as the wear mask for road paint. Foliage006 is the grass
tufts (`src/grass.js`) and the pine needles.

## Phase 3: code

**ez-tree** by Daniel Greenheck -- MIT licence, Copyright (c) 2024 Daniel
Greenheck. From the npm package @dgreenheck/ez-tree 1.1.0
(https://github.com/dgreenheck/ez-tree). Its generator source is vendored in
`src/vendor/ez-tree/` with the licence file (`tools/vendor-eztree.mjs`), and
grows the town's trees in the browser with the CC0 bark and leaf textures
above. The notice is on the Credits screen.

Build tools, not shipped: @gltf-transform/core, /extensions, /functions 4.5.1
(MIT), meshoptimizer 1.3.0 (MIT), sharp 0.35.5 (Apache-2.0; libvips LGPL-3.0),
ktx2-encoder 0.6.0 (MIT; Basis encoder Apache-2.0). Shipped decoders from
three.js: meshopt decoder (MIT) and the Basis KTX2 transcoder (Apache-2.0,
`docs/assets/libs/basis/`, 0.58 MB).

Made in code, not downloaded: the cars (no CC0 car models that look real),
the truck, posters and graffiti. No bikes were added.

## Phase 4: combat and weather effects

No files were downloaded. Every effect texture (smoke puffs with normals,
flame and flash shapes, decal marks) and every effect mesh (chips, casings)
is generated in code at start-up (`src/vfx.js`, `src/decals.js`).
