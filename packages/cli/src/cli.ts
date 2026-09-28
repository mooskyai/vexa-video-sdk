import { Hardware, Streaming, Video } from "@moosky-video/sdk";
import type { ExportOptions, HardwareAccelerationPreference, ResizeFit, StreamingPresetName, StreamingProtocol } from "@moosky-video/core";

export type CliCommandName = "help" | "version" | "probe" | "plan" | "render" | "hardware" | "stream";

export interface CliInvocation {
  command: CliCommandName;
  positionals: readonly string[];
  options: Readonly<Record<string, string | boolean>>;
}

export interface CliIo {
  stdout(value: string): void;
  stderr(value: string): void;
}

const HELP = `Vexa Video CLI

Usage:
  vexa probe <input>
  vexa plan <input> <output> [options]
  vexa render <input> <output> [options]
  vexa hardware
  vexa stream <input> <output-dir> [--protocol hls|dash] [--preset mobile|balanced|hd]

Video options:
  --width <px>              Resize width
  --height <px>             Resize height
  --fit <contain|cover|fill>
  --video-codec <codec>     h264|h265|av1|vp9|copy
  --audio-codec <codec>     aac|opus|mp3|copy|none
  --crf <number>
  --preset <name>
  --hardware <provider>     auto|cpu|nvidia|intel|amd|apple
  --no-hardware-fallback
  --json                    Print machine-readable JSON
`;

function optionName(raw: string): string {
  return raw.replace(/^--/u, "").trim();
}

export function parseCliArgs(argv: readonly string[]): CliInvocation {
  const first = argv[0];
  const known = new Set<CliCommandName>(["help", "version", "probe", "plan", "render", "hardware", "stream"]);
  const command: CliCommandName = !first || first === "--help" || first === "-h"
    ? "help"
    : first === "--version" || first === "-v"
      ? "version"
      : known.has(first as CliCommandName)
        ? first as CliCommandName
        : "help";
  const start = command === "help" && first && !first.startsWith("-") && !known.has(first as CliCommandName) ? 0 : 1;
  const positionals: string[] = [];
  const options: Record<string, string | boolean> = {};

  for (let index = start; index < argv.length; index += 1) {
    const value = argv[index]!;
    if (!value.startsWith("--")) {
      positionals.push(value);
      continue;
    }
    const name = optionName(value);
    if (name.startsWith("no-")) {
      options[name.slice(3)] = false;
      continue;
    }
    const next = argv[index + 1];
    if (next !== undefined && !next.startsWith("--")) {
      options[name] = next;
      index += 1;
    } else {
      options[name] = true;
    }
  }

  return { command, positionals, options };
}

function stringOption(invocation: CliInvocation, name: string): string | undefined {
  const value = invocation.options[name];
  return typeof value === "string" ? value : undefined;
}

function numberOption(invocation: CliInvocation, name: string): number | undefined {
  const raw = stringOption(invocation, name);
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`--${name} must be a finite number.`);
  return value;
}

function boolOption(invocation: CliInvocation, name: string, fallback: boolean): boolean {
  const value = invocation.options[name];
  return typeof value === "boolean" ? value : fallback;
}

function exportOptions(invocation: CliInvocation): ExportOptions {
  const value: ExportOptions = {
    overwrite: true,
    hardwareFallback: boolOption(invocation, "hardware-fallback", true)
  };
  const videoCodec = stringOption(invocation, "video-codec") as ExportOptions["videoCodec"] | undefined;
  const audioCodec = stringOption(invocation, "audio-codec") as ExportOptions["audioCodec"] | undefined;
  const crf = numberOption(invocation, "crf");
  const preset = stringOption(invocation, "preset") as ExportOptions["preset"] | undefined;
  const hardware = stringOption(invocation, "hardware") as HardwareAccelerationPreference | undefined;
  if (videoCodec) value.videoCodec = videoCodec;
  if (audioCodec) value.audioCodec = audioCodec;
  if (crf !== undefined) value.crf = crf;
  if (preset) value.preset = preset;
  if (hardware) value.hardwareAcceleration = hardware;
  return value;
}

function buildVideo(invocation: CliInvocation, source: string): Video {
  let video = Video.load(source);
  const width = numberOption(invocation, "width");
  const height = numberOption(invocation, "height");
  if ((width === undefined) !== (height === undefined)) throw new Error("--width and --height must be provided together.");
  if (width !== undefined && height !== undefined) {
    video = video.resize({
      width,
      height,
      fit: (stringOption(invocation, "fit") as ResizeFit | undefined) ?? "contain"
    });
  }
  return video;
}

function format(value: unknown, invocation: CliInvocation): string {
  if (invocation.options.json === true) return JSON.stringify(value);
  return JSON.stringify(value, null, 2);
}

function requirePositional(invocation: CliInvocation, index: number, label: string): string {
  const value = invocation.positionals[index]?.trim();
  if (!value) throw new Error(`${label} is required.`);
  return value;
}

export async function runCli(
  argv: readonly string[],
  io: CliIo = {
    stdout: (value) => process.stdout.write(`${value}\n`),
    stderr: (value) => process.stderr.write(`${value}\n`)
  }
): Promise<number> {
  const invocation = parseCliArgs(argv);

  try {
    switch (invocation.command) {
      case "help":
        io.stdout(HELP.trimEnd());
        return 0;
      case "version":
        io.stdout("0.1.0");
        return 0;
      case "probe": {
        const input = requirePositional(invocation, 0, "input");
        io.stdout(format(await Video.load(input).probe(), invocation));
        return 0;
      }
      case "hardware":
        io.stdout(format(await Hardware.detect(), invocation));
        return 0;
      case "plan": {
        const input = requirePositional(invocation, 0, "input");
        const output = requirePositional(invocation, 1, "output");
        const plan = await buildVideo(invocation, input).planExport(output, exportOptions(invocation));
        io.stdout(format(plan, invocation));
        return 0;
      }
      case "render": {
        const input = requirePositional(invocation, 0, "input");
        const output = requirePositional(invocation, 1, "output");
        const options = exportOptions(invocation);
        options.onProgress = (progress) => {
          if (progress.percent !== null) io.stderr(`progress ${progress.percent.toFixed(1)}%`);
        };
        const result = await buildVideo(invocation, input).export(output, options);
        io.stdout(format(result, invocation));
        return 0;
      }
      case "stream": {
        const input = requirePositional(invocation, 0, "input");
        const output = requirePositional(invocation, 1, "output-dir");
        const protocol = (stringOption(invocation, "protocol") ?? "hls") as StreamingProtocol;
        const preset = (stringOption(invocation, "preset") ?? "balanced") as StreamingPresetName;
        const result = await Streaming.load(input).package(output, {
          protocol,
          preset,
          hardwareAcceleration: (stringOption(invocation, "hardware") as HardwareAccelerationPreference | undefined) ?? "cpu",
          hardwareFallback: boolOption(invocation, "hardware-fallback", true)
        });
        io.stdout(format(result, invocation));
        return 0;
      }
    }
  } catch (error) {
    io.stderr(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

export const cliHelp = HELP;
