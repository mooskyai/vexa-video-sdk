export interface VideoStreamInfo {
  index: number;
  codec: string | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  pixelFormat: string | null;
  bitRate: number | null;
  rotation: number;
}

export interface AudioStreamInfo {
  index: number;
  codec: string | null;
  sampleRate: number | null;
  channels: number | null;
  channelLayout: string | null;
  bitRate: number | null;
}

export interface ProbeResult {
  source: string;
  format: string | null;
  durationSeconds: number | null;
  sizeBytes: number | null;
  bitRate: number | null;
  video: VideoStreamInfo | null;
  audio: AudioStreamInfo | null;
  videoStreams: VideoStreamInfo[];
  audioStreams: AudioStreamInfo[];
}

export interface ProbeOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface VideoLoadOptions {
  ffmpegPath?: string;
  ffprobePath?: string;
}
