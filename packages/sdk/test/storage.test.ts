import assert from "node:assert/strict";
import { createReadStream } from "node:fs";
import { access, readFile, stat, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { InvalidStorageError, RemoteMediaRejectedError } from "@vexa-video/core";
import { runProcess } from "@vexa-video/ffmpeg";
import { Storage, parseStorageSource } from "../src/storage.js";
import { Video } from "../src/video.js";

async function withHttpServer<T>(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
  callback: (origin: string) => Promise<T>
): Promise<T> {
  const server = createServer(handler);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test HTTP server did not bind to TCP.");
    return await callback(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test("storage source parser recognizes local, HTTP, S3, GCS and Azure references", () => {
  assert.deepEqual(parseStorageSource("./input.mp4"), { kind: "local", path: "./input.mp4" });
  assert.deepEqual(parseStorageSource("https://cdn.example.com/video.mp4"), {
    kind: "http",
    url: "https://cdn.example.com/video.mp4"
  });
  assert.deepEqual(parseStorageSource("s3://media-bucket/path/video.mp4"), {
    kind: "object",
    provider: "s3",
    bucket: "media-bucket",
    key: "path/video.mp4"
  });
  assert.deepEqual(parseStorageSource("gs://media-bucket/path/video.mp4"), {
    kind: "object",
    provider: "gcs",
    bucket: "media-bucket",
    key: "path/video.mp4"
  });
  assert.deepEqual(parseStorageSource("az://media-container/path/video.mp4"), {
    kind: "object",
    provider: "azure",
    container: "media-container",
    key: "path/video.mp4"
  });
});

test("HTTP storage rejects loopback/private-network targets by default", async () => {
  await withHttpServer((_req, res) => {
    res.writeHead(200, { "content-type": "video/mp4" });
    res.end("media");
  }, async (origin) => {
    const storage = new Storage();
    await assert.rejects(
      storage.resolve(`${origin}/video.mp4`, { http: { allowHttp: true } }),
      RemoteMediaRejectedError
    );
  });
});

test("HTTP storage follows validated redirects and enforces byte limits", async () => {
  await withHttpServer((req, res) => {
    if (req.url === "/redirect") {
      res.writeHead(302, { location: "/media.mp4" });
      res.end();
      return;
    }
    res.writeHead(200, {
      "content-type": "video/mp4",
      "content-length": "12"
    });
    res.end("hello-remote");
  }, async (origin) => {
    const storage = new Storage({ http: { allowHttp: true, allowPrivateNetwork: true } });
    const resolved = await storage.resolve(`${origin}/redirect`, { maxBytes: 64 });
    try {
      assert.equal(await readFile(resolved.path, "utf8"), "hello-remote");
      assert.equal(resolved.provider, "http");
      assert.equal(resolved.managed, true);
    } finally {
      const path = resolved.path;
      await resolved.cleanup();
      await assert.rejects(access(path));
    }

    await assert.rejects(
      storage.resolve(`${origin}/media.mp4`, { maxBytes: 4 }),
      RemoteMediaRejectedError
    );
  });
});

test("managed workspaces prevent path escape and clean up recursively", async () => {
  const storage = new Storage();
  const workspace = await storage.createWorkspace({ root: tmpdir(), prefix: "vexa-storage-test-" });
  const file = workspace.file("nested/input.txt");
  await writeFile(file, "ok", { flag: "w" }).catch(async () => {
    const { mkdir } = await import("node:fs/promises");
    await mkdir(join(workspace.path, "nested"), { recursive: true });
    await writeFile(file, "ok");
  });
  assert.equal(await readFile(file, "utf8"), "ok");
  assert.throws(() => workspace.file("../escape.txt"), InvalidStorageError);
  const root = workspace.path;
  await workspace.cleanup();
  await assert.rejects(access(root));
});

test("object-storage adapters delegate S3 downloads and uploads without cloud SDK dependencies", async () => {
  const workspace = await new Storage().createWorkspace({ root: tmpdir(), prefix: "vexa-adapter-test-" });
  const sourceFile = workspace.file("source.txt");
  const downloadedFile = workspace.file("downloaded.txt");
  await writeFile(sourceFile, "adapter-data");
  const calls: string[] = [];

  const adapter = Storage.s3({
    async download(reference, destination) {
      calls.push(`download:${reference.bucket}/${reference.key}`);
      await writeFile(destination, "adapter-data");
    },
    async upload(localPath, reference) {
      calls.push(`upload:${reference.bucket}/${reference.key}:${await readFile(localPath, "utf8")}`);
    }
  });
  const storage = new Storage({ adapters: [adapter] });

  try {
    const downloaded = await storage.download("s3://demo-bucket/videos/input.txt", downloadedFile);
    assert.equal(downloaded.provider, "s3");
    assert.equal(await readFile(downloadedFile, "utf8"), "adapter-data");

    const uploaded = await storage.upload(sourceFile, "s3://demo-bucket/videos/output.txt");
    assert.equal(uploaded.provider, "s3");
    assert.deepEqual(calls, [
      "download:demo-bucket/videos/input.txt",
      "upload:demo-bucket/videos/output.txt:adapter-data"
    ]);
  } finally {
    await workspace.cleanup();
  }
});

test("withResolved cleans managed downloads after callback completion", async () => {
  await withHttpServer((_req, res) => {
    res.end("temporary");
  }, async (origin) => {
    const storage = new Storage({ http: { allowHttp: true, allowPrivateNetwork: true } });
    let localPath = "";
    const result = await storage.withResolved(`${origin}/temp.bin`, async (media) => {
      localPath = media.path;
      assert.equal((await stat(media.path)).isFile(), true);
      return await readFile(media.path, "utf8");
    });
    assert.equal(result, "temporary");
    await assert.rejects(access(localPath));
  });
});

test("resolved HTTP media can flow directly into Video probing", async () => {
  const workspace = await new Storage().createWorkspace({ root: tmpdir(), prefix: "vexa-storage-video-" });
  const input = workspace.file("input.mp4");
  try {
    await runProcess("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", "testsrc=size=320x180:rate=24",
      "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000",
      "-t", "1", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", input
    ]);

    await withHttpServer((req, res) => {
      if (req.url !== "/input.mp4") {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, { "content-type": "video/mp4" });
      createReadStream(input).pipe(res);
    }, async (origin) => {
      const storage = new Storage({ http: { allowHttp: true, allowPrivateNetwork: true } });
      await storage.withResolved(`${origin}/input.mp4`, async (media) => {
        const metadata = await Video.load(media.path).probe();
        assert.equal(metadata.video?.width, 320);
        assert.equal(metadata.video?.height, 180);
        assert.equal(metadata.video?.codec, "h264");
        assert.equal(metadata.audio?.codec, "aac");
      });
    });
  } finally {
    await workspace.cleanup();
  }
});
