# @vexa-video/ai

Optional provider-neutral AI/media planning helpers for Vexa Video SDK, including transcription/caption adapters, scene detection, silence removal, smart-reframe planning, and highlights. Normalized transcription speaker metadata is preserved into generated `CaptionCue.speaker`, and callers can provide browser-safe `speakerStyles` overrides without coupling provider diarization to the FFmpeg backend.
