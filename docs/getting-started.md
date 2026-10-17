# Getting Started

This guide gets a Node.js application from installation to its first Vexa render using the stable `2.0.0` release.

## 1. Prerequisites

Install:

- Node.js 24.21.0+
- npm 11+
- FFmpeg and ffprobe 6.1+

Verify:

```bash
node --version
npm --version
ffmpeg -version
ffprobe -version
```

## 2. Create an application

```bash
mkdir vexa-example
cd vexa-example
npm init -y
npm install @vexa-video/sdk@2.0.0
```

Set your project to ESM or use an `.mjs` entry file.

## 3. Render a video

Create `render.mjs`:

```js
import { Video } from "@vexa-video/sdk";

await Video.load("input.mp4")
  .trim({ start: 0, duration: 10 })
  .resize({ width: 1280, height: 720, fit: "cover" })
  .export("output.mp4", {
    videoCodec: "h264",
    audioCodec: "aac",
    hardwareAcceleration: "auto",
    hardwareFallback: true,
    onProgress(progress) {
      if (progress.percent != null) {
        console.log(`${progress.percent.toFixed(1)}%`);
      }
    }
  });
```

Run:

```bash
node render.mjs
```

## 4. Probe media

```js
import { Video } from "@vexa-video/sdk";

const metadata = await Video.load("input.mp4").probe();
console.log(metadata);
```

## 5. Inspect the plan

```js
import { Video } from "@vexa-video/sdk";

const video = Video.load("input.mp4")
  .resize({ width: 1920, height: 1080, fit: "contain" });

const plan = await video.planExport("output.mp4", {
  videoCodec: "h264",
  audioCodec: "aac",
  hardwareAcceleration: "auto"
});

console.dir(plan, { depth: null });
```

Planning lets you validate filters, codecs and hardware selection before rendering.

## 6. Next steps

- Multi-track edit: use `createProject()` from `@vexa-video/sdk`.
- Code-defined compositions: read [Programmable compositions](./compositions.md).
- Browser UI: read [Package guide](./package-guide.md) before choosing Player/Studio/framework packages.
- Angular application: read [Angular integration](./angular-integration.md).
- Background/cloud rendering: read [Hosted rendering](./hosted-rendering.md).

## Common problems

### `ffmpeg` not found

Ensure FFmpeg and ffprobe are both available on `PATH` and come from a compatible distribution.

### Hardware encode is unavailable

Use `hardwareAcceleration: "auto"` with `hardwareFallback: true`. Vexa verifies candidate hardware encoders with a real encode before selecting them.

### Browser build pulls Node modules

Do not import `@vexa-video/sdk` from browser code. Use a browser-safe Vexa package and call a Node render service through an explicit transport.
