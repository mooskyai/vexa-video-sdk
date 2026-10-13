# @vexa-video/sdk

Node.js execution SDK for Vexa Video SDK: video, audio, timeline projects, captions, streaming, storage, jobs, plugins, hardware acceleration, and hosted-render adapters.

This package is Node-only and may execute FFmpeg/ffprobe processes.

`VideoProject` prepares text fonts before media probing/render planning: explicit local `fontFile` paths must be readable, relative paths resolve from the current working directory, and text without an explicit font receives Vexa's platform default. Missing fonts fail as `ProjectFontResolutionError` before FFmpeg rendering starts.
