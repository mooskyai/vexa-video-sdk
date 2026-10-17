# @vexa-video/cli

Command-line interface for Vexa Video SDK.

```bash
vexa compositions
vexa bundle ./src/video.tsx --out-dir ./.vexa/bundle
vexa probe input.mp4
vexa plan input.mp4 output.mp4 --width 1280 --height 720
vexa render input.mp4 output.mp4 --hardware auto
vexa render ProductDemo output.mp4 --manifest ./.vexa/bundle/vexa.bundle.json --props '{"title":"Launch"}'
vexa still ProductDemo thumbnail.png --manifest ./.vexa/bundle/vexa.bundle.json --frame 120
vexa hardware --json
vexa stream input.mp4 ./hls --protocol hls --preset balanced
```

The `compositions` command defaults to `src/video.tsx` under the current directory and prints the deterministic discovery descriptors. Use `--root-dir` for another project root and `--json` for compact machine-readable output. `bundle` reuses `@vexa-video/bundler`; it does not introduce a separate composition parser or build path.

Composition rendering reuses `@vexa-video/renderer`. `render` preserves existing media-file behavior when its first argument is an existing path, URL, or filename-like source; a plain composition id can resolve through `.vexa/bundle/vexa.bundle.json`, and `--manifest` forces composition resolution. `still` is composition-only: true still compositions render directly, while video compositions render frame zero by default or the frame selected with `--frame`. `--props` accepts a JSON object, and composition video renders also support `--start-frame`, `--end-frame`, `--concurrency`, `--timeout-ms`, and the shared hardware options.

When developing this repository on Windows, prefer `node packages/cli/dist/bin.js ... --props '{"key":"value"}'` for structured-props acceptance. The repository-only `npm run cli -- ...` wrapper passes through `cmd.exe`, which can remove the inner JSON quotes before the CLI receives argv. Repository acceptance therefore uses direct Node invocation for structured props; installed-package shell behavior is validated separately during release hardening.
