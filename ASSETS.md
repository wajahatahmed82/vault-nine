# Third-party assets

Everything in Vault Nine is generated in code except the textures below. Each is
CC0 1.0 (public domain dedication): no attribution required, free for commercial
use. Credited anyway.

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

Everything else (buff brick, stone, corrugated metal, clay roof tiles, felt
roofs, pavement slabs, gravel, road paint, signs, terrain, characters, weapons,
sound) is still procedural.
