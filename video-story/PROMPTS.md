# Generating the footage for the scroll-scrubbed video

The page in this folder scrubs one video with the scroll bar. The clip that ships (`assets/story.mp4`) is a placeholder made from your two photos. The photoreal version needs real or generated footage. Two ways to get it:

1. **Best quality: film it.** A drone pass over the forecourt, a slow walk to the doors, a gimbal walk-through of the hall at dusk. Nothing generated can match your actual cars and building.
2. **Fast: image-to-video generation.** Use any image-to-video tool, with your photos as the first frame. Your current photos are small (about 400 px), so use the full-resolution originals if you have them; small sources give soft video.

Generate each shot separately (5-8 s, 16:9), keep the look consistent, then join them with `make-scrub-video.sh`.

## Shot list (replaces the construction timelapse in the reference video)

| # | Shot | First frame | Prompt |
|---|------|-------------|--------|
| 1 | Aerial arrival | `assets/reference/aerial-forecourt.jpg` | Slow cinematic drone descent over a modern luxury car dealership. Cars parked on the forecourt, a stone-and-glass facade with a dark central tower and illuminated sign. The camera starts high and top-down, then pushes forward and tilts up toward the entrance. Soft late-afternoon light, light haze, photorealistic, smooth stabilised motion. Do not change the signage or building. |
| 2 | Day into evening | `assets/reference/facade-front.jpg` | Locked-off camera with a very slow push-in on the dealership facade and four parked cars. Time-lapse from late afternoon to dusk: the sky turns gold then deep blue, the facade and interior lights switch on, car headlights glow, reflections appear on the wet paving. Photorealistic, no people, signage unchanged. |
| 3 | Doors open | last frame of shot 2 | The camera glides toward the glass entrance. The glass doors slide apart and warm light spills out, revealing a luxury car showroom with spot-lit cars on a polished floor. Smooth dolly forward, photorealistic. |
| 4 | Into the hall | last frame of shot 3 | Slow steady dolly through a luxury car showroom at night: polished floor reflections, supercars on lit platforms, soft spotlights, glass walls with the lit forecourt outside. The camera drifts past two cars and settles on a hero car. Photorealistic. |
| 5 (optional) | Detail | any good still of a car | Macro slow slide across a car's headlight, wheel and paint highlights in a dark showroom, shallow depth of field, photorealistic. |

## Keeping the shots continuous

Extract the last frame of a finished clip and use it as the first frame of the next:

```bash
ffmpeg -sseof -0.1 -i shot2.mp4 -frames:v 1 shot2_last.png
```

## Build and install

```bash
bash make-scrub-video.sh shot1.mp4 shot2.mp4 shot3.mp4 shot4.mp4
```

Then open `index.html` and delete `data-placeholder="true"` from the `<video>` tag to remove the placeholder banner. If the story is longer than about 12 s, raise `--track` (the `700vh` value) so each second gets enough scrolling.

## Honest note on generated cars

Generated footage can morph details (badges, plates, wheels) and will not show your exact stock. Use it for atmosphere and the building, and keep specific vehicles to real photos and video. Do not present generated cars as a particular car for sale.
