# @vexa-video/ffmpeg

FFmpeg/ffprobe planning and execution backend for Vexa Video SDK. Most applications should use `@vexa-video/sdk` instead of importing this backend directly.

The project-composition backend executes ordered programmable image/video effects for blur, brightness, contrast, saturation, hue, grayscale, sepia, deterministic noise, vignette, shadow, and glow. Shadow/glow use explicit split/mask/blur/overlay compositor branches with transparent bounds padding and position compensation; effect-bearing advanced wipes and spatial effects combined with non-normal blend modes fail explicitly rather than bypassing or approximating the authored effect chain. Effect-bearing text renders on an isolated transparent full-canvas layer and reuses the same ordered linear/compositor effect compiler before clip opacity and fades. Effect-bearing text wipes/crossfades and fill/solid/surface effect execution remain explicit unsupported paths.
