# Demo media shot list

Only synthetic content goes here: the project's own character in content made from text or from the owner's own photos.
No media made from other people's videos or photos. No revealing content.
Strip metadata from every file before you commit it (`exiftool -all= <file>` or re-encode with ffmpeg `-map_metadata -1`).

| # | File | What | Source | Status |
|---|---|---|---|---|
| 1 | `copy-a-video.gif` | Screen recording, 20 to 30 s: Video tab, "Copy a video", drop the synthetic clip, press "Her still from video", pick a still. GIF under 10 MB. | Video record `dd430cbb` (synthetic source and result) | To record |
| 2 | `still-1.jpg` | Text-made photo of the character | Library, text path | To pick |
| 3 | `still-2.jpg` | Text-made photo of the character, different setting | Library, text path | To pick |
| 4 | `still-3.jpg` | Text-made photo of the character, different light | Library, text path | To pick |
| 5 | `talking-clip.mp4` or `.gif` | Talking clip | `car_fasting_veo` or `car_gta6_veo` | To pick |
| 6 | `workflow-photo-from-text.jpg` | Result image for the "Photo from text" row | Library | To pick |
| 7 | `workflow-copy-a-photo.jpg` | Result for "Copy a photo": scene must be the owner's own photo | Library | To pick |
| 8 | `workflow-copy-a-video.jpg` | Still from record `dd430cbb` only | Video record `dd430cbb` | To pick |

Do not use any other motion-copy result.

GIF from a screen recording:

```bash
ffmpeg -i rec.mov -vf "fps=12,scale=900:-1:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse" -map_metadata -1 copy-a-video.gif
```
