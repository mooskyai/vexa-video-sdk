export interface Mp4ChunkInput {
  readonly type: "key" | "delta";
  readonly timestampUs: number;
  readonly durationUs?: number;
  readonly data: Uint8Array;
}

export interface AacMp4Input {
  readonly sampleRate: number;
  readonly numberOfChannels: number;
  readonly decoderConfig: Uint8Array;
  readonly chunks: readonly Mp4ChunkInput[];
}

export interface H264Mp4Input {
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly frameCount: number;
  readonly durationSeconds: number;
  readonly decoderConfig: Uint8Array;
  readonly chunks: readonly Mp4ChunkInput[];
  readonly audio?: AacMp4Input;
}

export class Mp4MuxInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Mp4MuxInputError";
  }
}

const textEncoder = new TextEncoder();
const TIMESCALE = 1_000_000;

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const size = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const out = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

function u16(value: number): Uint8Array {
  const out = new Uint8Array(2);
  new DataView(out.buffer).setUint16(0, value, false);
  return out;
}

function u32(value: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value >>> 0, false);
  return out;
}

function i32(value: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setInt32(0, value, false);
  return out;
}

function type(name: string): Uint8Array {
  if (name.length !== 4) throw new Mp4MuxInputError(`MP4 box type ${name} must be four characters.`);
  return textEncoder.encode(name);
}

function box(name: string, ...payload: readonly Uint8Array[]): Uint8Array {
  const body = concat(payload);
  const size = body.byteLength + 8;
  if (size > 0xffff_ffff) throw new Mp4MuxInputError(`MP4 box ${name} exceeds 32-bit size support.`);
  return concat([u32(size), type(name), body]);
}

function fullBox(name: string, version: number, flags: number, ...payload: readonly Uint8Array[]): Uint8Array {
  const header = new Uint8Array([version & 0xff, (flags >>> 16) & 0xff, (flags >>> 8) & 0xff, flags & 0xff]);
  return box(name, header, ...payload);
}

function fixed16_16(value: number): Uint8Array {
  return u32(Math.round(value * 65_536));
}

function identityMatrix(): Uint8Array {
  return concat([
    fixed16_16(1), u32(0), u32(0),
    u32(0), fixed16_16(1), u32(0),
    u32(0), u32(0), u32(0x40000000)
  ]);
}

function languageUnd(): Uint8Array {
  const value = (("u".charCodeAt(0) - 0x60) << 10)
    | (("n".charCodeAt(0) - 0x60) << 5)
    | ("d".charCodeAt(0) - 0x60);
  return u16(value);
}

function ftyp(): Uint8Array {
  return box("ftyp", type("isom"), u32(0x200), type("isom"), type("iso6"), type("avc1"), type("mp41"));
}

function mvhd(nextTrackId: number): Uint8Array {
  return fullBox("mvhd", 0, 0,
    u32(0), u32(0), u32(TIMESCALE), u32(0),
    fixed16_16(1), u16(0x0100), u16(0), u32(0), u32(0),
    identityMatrix(),
    new Uint8Array(24),
    u32(nextTrackId)
  );
}

function tkhd(trackId: number, width: number, height: number, audio: boolean): Uint8Array {
  return fullBox("tkhd", 0, 0x000007,
    u32(0), u32(0), u32(trackId), u32(0), u32(0),
    u32(0), u32(0),
    u16(0), u16(0), u16(audio ? 0x0100 : 0), u16(0),
    identityMatrix(), fixed16_16(width), fixed16_16(height)
  );
}

function mdhd(): Uint8Array {
  return fullBox("mdhd", 0, 0,
    u32(0), u32(0), u32(TIMESCALE), u32(0), languageUnd(), u16(0)
  );
}

function hdlr(kind: "vide" | "soun"): Uint8Array {
  return fullBox("hdlr", 0, 0,
    u32(0), type(kind), u32(0), u32(0), u32(0),
    textEncoder.encode(kind === "vide" ? "Vexa Video\0" : "Vexa Audio\0")
  );
}

function vmhd(): Uint8Array {
  return fullBox("vmhd", 0, 0x000001, u16(0), u16(0), u16(0), u16(0));
}

function smhd(): Uint8Array {
  return fullBox("smhd", 0, 0, u16(0), u16(0));
}

function dinf(): Uint8Array {
  const url = fullBox("url ", 0, 0x000001);
  const dref = fullBox("dref", 0, 0, u32(1), url);
  return box("dinf", dref);
}

function avc1(width: number, height: number, decoderConfig: Uint8Array): Uint8Array {
  if (decoderConfig.byteLength < 7 || decoderConfig[0] !== 1) {
    throw new Mp4MuxInputError("H.264 MP4 muxing requires an AVCDecoderConfigurationRecord in decoderConfig.description.");
  }
  const compressor = new Uint8Array(32);
  const name = textEncoder.encode("Vexa H.264");
  compressor[0] = Math.min(name.byteLength, 31);
  compressor.set(name.slice(0, 31), 1);
  const sampleEntry = concat([
    new Uint8Array(6), u16(1),
    u16(0), u16(0), u32(0), u32(0), u32(0),
    u16(width), u16(height),
    fixed16_16(72), fixed16_16(72), u32(0), u16(1), compressor,
    u16(0x0018), u16(0xffff),
    box("avcC", decoderConfig)
  ]);
  return box("avc1", sampleEntry);
}

function descriptorLength(value: number): Uint8Array {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0x0fff_ffff) {
    throw new Mp4MuxInputError("MP4 descriptor payload is too large.");
  }
  const bytes = [value & 0x7f];
  let remaining = value >>> 7;
  while (remaining > 0) {
    bytes.unshift((remaining & 0x7f) | 0x80);
    remaining >>>= 7;
  }
  return new Uint8Array(bytes);
}

function descriptor(tag: number, payload: Uint8Array): Uint8Array {
  return concat([new Uint8Array([tag]), descriptorLength(payload.byteLength), payload]);
}

function esds(decoderConfig: Uint8Array): Uint8Array {
  if (decoderConfig.byteLength === 0) {
    throw new Mp4MuxInputError("AAC MP4 muxing requires AudioSpecificConfig in decoderConfig.description.");
  }
  const decoderSpecific = descriptor(0x05, decoderConfig);
  const decoderConfiguration = descriptor(0x04, concat([
    new Uint8Array([0x40, 0x15, 0x00, 0x00, 0x00]),
    u32(192_000),
    u32(192_000),
    decoderSpecific
  ]));
  const slConfiguration = descriptor(0x06, new Uint8Array([0x02]));
  const esDescriptor = descriptor(0x03, concat([u16(2), new Uint8Array([0x00]), decoderConfiguration, slConfiguration]));
  return fullBox("esds", 0, 0, esDescriptor);
}

function mp4a(audio: AacMp4Input): Uint8Array {
  if (!Number.isInteger(audio.sampleRate) || audio.sampleRate <= 0 || audio.sampleRate > 0xffff) {
    throw new Mp4MuxInputError("AAC MP4 sampleRate must be a positive 16-bit integer.");
  }
  if (!Number.isInteger(audio.numberOfChannels) || audio.numberOfChannels <= 0 || audio.numberOfChannels > 0xffff) {
    throw new Mp4MuxInputError("AAC MP4 numberOfChannels must be a positive 16-bit integer.");
  }
  return box("mp4a", concat([
    new Uint8Array(6), u16(1),
    new Uint8Array(8),
    u16(audio.numberOfChannels), u16(16), u16(0), u16(0),
    fixed16_16(audio.sampleRate),
    esds(audio.decoderConfig)
  ]));
}

function emptySampleTable(sampleEntry: Uint8Array): Uint8Array {
  const stsd = fullBox("stsd", 0, 0, u32(1), sampleEntry);
  return box("stbl",
    stsd,
    fullBox("stts", 0, 0, u32(0)),
    fullBox("stsc", 0, 0, u32(0)),
    fullBox("stsz", 0, 0, u32(0), u32(0)),
    fullBox("stco", 0, 0, u32(0))
  );
}

function videoTrack(width: number, height: number, decoderConfig: Uint8Array): Uint8Array {
  const minf = box("minf", vmhd(), dinf(), emptySampleTable(avc1(width, height, decoderConfig)));
  return box("trak", tkhd(1, width, height, false), box("mdia", mdhd(), hdlr("vide"), minf));
}

function audioTrack(audio: AacMp4Input): Uint8Array {
  const minf = box("minf", smhd(), dinf(), emptySampleTable(mp4a(audio)));
  return box("trak", tkhd(2, 0, 0, true), box("mdia", mdhd(), hdlr("soun"), minf));
}

function moov(width: number, height: number, decoderConfig: Uint8Array, audio?: AacMp4Input): Uint8Array {
  const videoTrex = fullBox("trex", 0, 0, u32(1), u32(1), u32(0), u32(0), u32(0));
  const audioTrex = audio === undefined ? undefined : fullBox("trex", 0, 0, u32(2), u32(1), u32(0), u32(0), u32(0));
  return box("moov",
    mvhd(audio === undefined ? 2 : 3),
    videoTrack(width, height, decoderConfig),
    ...(audio === undefined ? [] : [audioTrack(audio)]),
    box("mvex", videoTrex, ...(audioTrex === undefined ? [] : [audioTrex]))
  );
}

function sampleDurations(chunks: readonly Mp4ChunkInput[], fallback: number): readonly number[] {
  return chunks.map((chunk, index) => {
    if (chunk.durationUs !== undefined) {
      if (!Number.isSafeInteger(chunk.durationUs) || chunk.durationUs <= 0) {
        throw new Mp4MuxInputError("MP4 sample durations must be positive safe integers.");
      }
      return chunk.durationUs;
    }
    const next = chunks[index + 1];
    if (next !== undefined) {
      const derived = next.timestampUs - chunk.timestampUs;
      if (Number.isSafeInteger(derived) && derived > 0) return derived;
    }
    return fallback;
  });
}

function videoTrun(chunks: readonly Mp4ChunkInput[], durations: readonly number[], dataOffset: number): Uint8Array {
  const entries: Uint8Array[] = [];
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index]!;
    const duration = durations[index]!;
    const flags = chunk.type === "key" ? 0x02000000 : 0x01010000;
    entries.push(u32(duration), u32(chunk.data.byteLength), u32(flags));
  }
  return fullBox("trun", 0, 0x000701, u32(chunks.length), i32(dataOffset), ...entries);
}

function audioTrun(chunks: readonly Mp4ChunkInput[], durations: readonly number[], dataOffset: number): Uint8Array {
  const entries: Uint8Array[] = [];
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index]!;
    entries.push(u32(durations[index]!), u32(chunk.data.byteLength));
  }
  return fullBox("trun", 0, 0x000301, u32(chunks.length), i32(dataOffset), ...entries);
}

function traf(trackId: number, trun: Uint8Array): Uint8Array {
  const tfhd = fullBox("tfhd", 0, 0x020000, u32(trackId));
  const tfdt = fullBox("tfdt", 1, 0, u32(0), u32(0));
  return box("traf", tfhd, tfdt, trun);
}

function moof(
  videoChunks: readonly Mp4ChunkInput[],
  videoDurations: readonly number[],
  videoOffset: number,
  audio?: Readonly<{ chunks: readonly Mp4ChunkInput[]; durations: readonly number[]; dataOffset: number }>
): Uint8Array {
  const mfhd = fullBox("mfhd", 0, 0, u32(1));
  const videoTraf = traf(1, videoTrun(videoChunks, videoDurations, videoOffset));
  const audioTraf = audio === undefined ? undefined : traf(2, audioTrun(audio.chunks, audio.durations, audio.dataOffset));
  return box("moof", mfhd, videoTraf, ...(audioTraf === undefined ? [] : [audioTraf]));
}

function validateChunks(chunks: readonly Mp4ChunkInput[], label: string, requireKeyframe: boolean): void {
  if (chunks.length === 0) throw new Mp4MuxInputError(`MP4 muxing requires at least one encoded ${label} chunk.`);
  if (requireKeyframe && chunks[0]?.type !== "key") {
    throw new Mp4MuxInputError("MP4 muxing requires the first encoded video chunk to be a keyframe.");
  }
  let previous = -1;
  for (const chunk of chunks) {
    if (!Number.isSafeInteger(chunk.timestampUs) || chunk.timestampUs < 0 || chunk.timestampUs < previous) {
      throw new Mp4MuxInputError(`MP4 muxing requires non-negative monotonic ${label} chunk timestamps.`);
    }
    if (chunk.data.byteLength === 0) throw new Mp4MuxInputError(`MP4 muxing does not accept empty encoded ${label} chunks.`);
    previous = chunk.timestampUs;
  }
}

function validate(input: H264Mp4Input): void {
  if (!Number.isInteger(input.width) || input.width <= 0 || input.width > 0xffff
      || !Number.isInteger(input.height) || input.height <= 0 || input.height > 0xffff) {
    throw new Mp4MuxInputError("MP4 width and height must be positive 16-bit integers.");
  }
  if (!Number.isFinite(input.fps) || input.fps <= 0) throw new Mp4MuxInputError("MP4 fps must be positive.");
  validateChunks(input.chunks, "video", true);
  if (input.audio !== undefined) {
    if (input.audio.decoderConfig.byteLength === 0) {
      throw new Mp4MuxInputError("AAC MP4 muxing requires AudioSpecificConfig in decoderConfig.description.");
    }
    validateChunks(input.audio.chunks, "audio", false);
  }
}

export function muxH264Mp4(input: H264Mp4Input): Uint8Array {
  validate(input);
  const videoDurations = sampleDurations(input.chunks, Math.max(1, Math.round(TIMESCALE / input.fps)));
  const audioDurations = input.audio === undefined
    ? undefined
    : sampleDurations(input.audio.chunks, Math.max(1, Math.round((1_024 * TIMESCALE) / input.audio.sampleRate)));
  const fileType = ftyp();
  const movie = moov(input.width, input.height, input.decoderConfig, input.audio);
  let fragment = moof(input.chunks, videoDurations, 0,
    input.audio === undefined || audioDurations === undefined
      ? undefined
      : { chunks: input.audio.chunks, durations: audioDurations, dataOffset: 0 });
  const videoOffset = fragment.byteLength + 8;
  const videoBytes = input.chunks.reduce((sum, chunk) => sum + chunk.data.byteLength, 0);
  fragment = moof(input.chunks, videoDurations, videoOffset,
    input.audio === undefined || audioDurations === undefined
      ? undefined
      : { chunks: input.audio.chunks, durations: audioDurations, dataOffset: videoOffset + videoBytes });
  const media = box("mdat",
    ...input.chunks.map((chunk) => chunk.data),
    ...(input.audio === undefined ? [] : input.audio.chunks.map((chunk) => chunk.data))
  );
  return concat([fileType, movie, fragment, media]);
}
