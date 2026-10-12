# @vexa-video/ffmpeg

FFmpeg/ffprobe planning and execution backend for Vexa Video SDK. Most applications should use `@vexa-video/sdk` instead of importing this backend directly.

The project-composition backend also executes ordered programmable image/video effects for blur, brightness, contrast, saturation, hue, grayscale, sepia, deterministic noise, and vignette. Shadow and glow require compositor-branch execution and remain explicitly unsupported in the linear effect path rather than being approximated.
