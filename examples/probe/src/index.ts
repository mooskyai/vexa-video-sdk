import { Video } from "@vexa-video/sdk";

const source = process.argv[2];

if (!source) {
  console.error("Usage: npm run example:probe -- <path-to-video>");
  process.exitCode = 1;
} else {
  const info = await Video.load(source).probe({ timeoutMs: 15_000 });
  console.log(JSON.stringify(info, null, 2));
}
