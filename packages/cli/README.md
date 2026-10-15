# @vexa-video/cli

Command-line interface for Vexa Video SDK.

```bash
vexa compositions
vexa bundle ./src/video.tsx --out-dir ./.vexa/bundle
vexa probe input.mp4
vexa plan input.mp4 output.mp4 --width 1280 --height 720
vexa render input.mp4 output.mp4 --hardware auto
vexa hardware --json
vexa stream input.mp4 ./hls --protocol hls --preset balanced
```

The `compositions` command defaults to `src/video.tsx` under the current directory and prints the deterministic discovery descriptors. Use `--root-dir` for another project root and `--json` for compact machine-readable output. `bundle` reuses `@vexa-video/bundler`; it does not introduce a separate composition parser or build path.
