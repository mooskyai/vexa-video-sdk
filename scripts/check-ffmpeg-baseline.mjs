import { spawnSync } from "node:child_process";

const minimumVersion = [6, 1, 0];

function run(command, args) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    shell: false,
    windowsHide: true
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with code ${result.status}: ${result.stderr || result.stdout}`);
  }
  return `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
}

function parseVersion(command, output) {
  const match = new RegExp(`${command} version\\s+(\\d+)\\.(\\d+)(?:\\.(\\d+))?`, "iu").exec(output);
  if (!match) throw new Error(`Unable to parse ${command} version output.`);
  return [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)];
}

function versionAtLeast(actual, expected) {
  for (let index = 0; index < expected.length; index += 1) {
    if (actual[index] > expected[index]) return true;
    if (actual[index] < expected[index]) return false;
  }
  return true;
}

function versionText(version) {
  return version.join(".");
}

const ffmpegVersionOutput = run("ffmpeg", ["-version"]);
const ffprobeVersionOutput = run("ffprobe", ["-version"]);
const ffmpegVersion = parseVersion("ffmpeg", ffmpegVersionOutput);
const ffprobeVersion = parseVersion("ffprobe", ffprobeVersionOutput);

if (!versionAtLeast(ffmpegVersion, minimumVersion)) {
  throw new Error(`FFmpeg ${versionText(ffmpegVersion)} is below the supported release baseline ${versionText(minimumVersion)}.`);
}
if (!versionAtLeast(ffprobeVersion, minimumVersion)) {
  throw new Error(`ffprobe ${versionText(ffprobeVersion)} is below the supported release baseline ${versionText(minimumVersion)}.`);
}

const filters = run("ffmpeg", ["-hide_banner", "-filters"]);
if (!/\bdrawtext\b/iu.test(filters)) {
  throw new Error("FFmpeg must provide the drawtext filter for Vexa text and caption rendering.");
}

const encoders = run("ffmpeg", ["-hide_banner", "-encoders"]);
if (!/\blibx264\b/iu.test(encoders)) {
  throw new Error("FFmpeg must provide the libx264 encoder for the default H.264 release surface.");
}
if (!/\baac\b/iu.test(encoders)) {
  throw new Error("FFmpeg must provide the AAC encoder for the default MP4 audio release surface.");
}

console.log(`[release:ffmpeg] ffmpeg ${versionText(ffmpegVersion)}`);
console.log(`[release:ffmpeg] ffprobe ${versionText(ffprobeVersion)}`);
console.log("[release:ffmpeg] required capabilities: drawtext, libx264, aac");
console.log("[release:ffmpeg] supported release baseline passed.");
