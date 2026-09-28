import assert from "node:assert/strict";
import test from "node:test";
import { normalizeVexaVideoConfig } from "../src/config.js";
import { FetchVexaVideoTransport, VexaAngularHttpError } from "../src/transport.js";

function response(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" }
  });
}

test("fetch transport uploads media with auth and filename headers", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), ...(init ? { init } : {}) });
    return response({ id: "media-1", name: "clip one.mp4", sizeBytes: 4, url: "/v1/media/media-1/clip.mp4" }, 201);
  };
  const transport = new FetchVexaVideoTransport(normalizeVexaVideoConfig({
    baseUrl: "https://media.example.com",
    headers: ({ kind }) => ({ authorization: "Bearer token", "x-request-kind": kind }),
    fetch: fetchImpl
  }));
  const asset = await transport.upload(new Blob(["test"], { type: "video/mp4" }), { filename: "clip one.mp4" });
  assert.equal(asset.id, "media-1");
  assert.equal(calls[0]?.url, "https://media.example.com/v1/media");
  assert.equal(calls[0]?.init?.method, "POST");
  const headers = calls[0]?.init?.headers as Record<string, string>;
  assert.equal(headers.authorization, "Bearer token");
  assert.equal(headers["x-request-kind"], "upload");
  assert.equal(headers["x-vexa-file-name"], "clip%20one.mp4");
});

test("fetch transport surfaces typed service errors", async () => {
  const fetchImpl: typeof fetch = async () => response({ error: "conflict", code: "JOB_IDEMPOTENCY_CONFLICT" }, 409);
  const transport = new FetchVexaVideoTransport(normalizeVexaVideoConfig({
    baseUrl: "https://media.example.com",
    fetch: fetchImpl
  }));
  await assert.rejects(
    () => transport.submitJob("video.render", { mediaId: "x" }),
    (error: unknown) => error instanceof VexaAngularHttpError
      && error.status === 409
      && error.code === "JOB_IDEMPOTENCY_CONFLICT"
  );
});
