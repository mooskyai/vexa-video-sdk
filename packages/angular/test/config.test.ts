import assert from "node:assert/strict";
import test from "node:test";
import { joinVexaUrl, normalizeVexaVideoConfig } from "../src/config.js";

test("Angular config normalizes service paths and polling", () => {
  const fakeFetch = (async () => new Response()) as typeof fetch;
  const config = normalizeVexaVideoConfig({
    baseUrl: "https://media.example.com/",
    pollIntervalMs: 500,
    fetch: fakeFetch
  });
  assert.equal(config.baseUrl, "https://media.example.com");
  assert.equal(config.paths.media, "/v1/media");
  assert.equal(config.paths.jobs, "/v1/jobs");
  assert.equal(config.credentials, "same-origin");
  assert.equal(joinVexaUrl(config.baseUrl, "/v1/jobs/abc"), "https://media.example.com/v1/jobs/abc");
});

test("Angular config rejects unsafe/ambiguous endpoint configuration", () => {
  const fakeFetch = (async () => new Response()) as typeof fetch;
  assert.throws(() => normalizeVexaVideoConfig({ baseUrl: "ftp://example.com", fetch: fakeFetch }));
  assert.throws(() => normalizeVexaVideoConfig({ baseUrl: "https://example.com", pollIntervalMs: 20, fetch: fakeFetch }));
  assert.throws(() => normalizeVexaVideoConfig({ baseUrl: "https://example.com", paths: { jobs: "v1/jobs" }, fetch: fakeFetch }));
});
