# @vexa-video/sdk

Node.js execution SDK for Vexa Video SDK: video, audio, timeline projects, captions, streaming, storage, jobs, plugins, hardware acceleration, and hosted-render adapters.

This package is Node-only and may execute FFmpeg/ffprobe processes.

`VideoProject` accepts optional composition-level `CaptionDocument` intent and prepares text/caption fonts before media probing/render planning: explicit local `fontFile` paths must be readable, relative paths resolve from the current working directory, and text or caption cues without an explicit font receive Vexa's platform default. Missing fonts fail as `ProjectFontResolutionError` before FFmpeg rendering starts.
