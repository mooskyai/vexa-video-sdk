import { watch } from "node:fs";

const supportedSourceExtension = /\.(?:[cm]?[jt]sx?|css|json|svg|png|jpe?g|webp|gif|avif|woff2?|ttf|otf|mp3|m4a|wav|mp4|webm|txt)$/iu;

export function normalizeStudioChangePath(filename) {
  if (filename === undefined || filename === null) return null;
  const normalized = String(filename).replaceAll("\\", "/").replace(/^\.\/+|\/+$/gu, "");
  if (!normalized || normalized.includes("\0")) return null;
  const parts = normalized.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) return null;
  if (!supportedSourceExtension.test(normalized)) return null;
  return normalized;
}

export function createStudioSourceWatcher({
  root,
  onChange,
  onError = () => {},
  debounceMs = 120,
  watchImpl = watch,
  setTimer = setTimeout,
  clearTimer = clearTimeout
}) {
  if (!root) throw new TypeError("Studio source watcher root is required.");
  if (typeof onChange !== "function") throw new TypeError("Studio source watcher onChange callback is required.");

  let timer = null;
  let closed = false;
  const paths = new Set();
  const eventTypes = new Set();

  const flush = () => {
    timer = null;
    if (closed || paths.size === 0) return;
    const payload = Object.freeze({
      paths: Object.freeze([...paths].sort()),
      eventTypes: Object.freeze([...eventTypes].sort()),
      timestamp: Date.now()
    });
    paths.clear();
    eventTypes.clear();
    onChange(payload);
  };

  const watcher = watchImpl(root, { recursive: true }, (eventType, filename) => {
    const path = normalizeStudioChangePath(filename);
    if (!path || closed) return;
    paths.add(path);
    eventTypes.add(String(eventType || "change"));
    if (timer !== null) clearTimer(timer);
    timer = setTimer(flush, debounceMs);
  });

  watcher.on?.("error", (error) => {
    if (!closed) onError(error);
  });

  return Object.freeze({
    close() {
      if (closed) return;
      closed = true;
      if (timer !== null) clearTimer(timer);
      timer = null;
      paths.clear();
      eventTypes.clear();
      watcher.close?.();
    }
  });
}

function writeEvent(res, payload) {
  if (res.destroyed || res.writableEnded) return false;
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
  return true;
}

export function createStudioEventHub({
  heartbeatMs = 15_000,
  setIntervalImpl = setInterval,
  clearIntervalImpl = clearInterval
} = {}) {
  const clients = new Set();

  const remove = (client) => {
    if (!clients.delete(client)) return;
    clearIntervalImpl(client.heartbeat);
  };

  return Object.freeze({
    add(res, initial = { type: "ready" }) {
      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-store",
        connection: "keep-alive",
        "x-accel-buffering": "no"
      });
      res.flushHeaders?.();
      writeEvent(res, initial);
      const client = {
        res,
        heartbeat: setIntervalImpl(() => {
          if (res.destroyed || res.writableEnded) {
            remove(client);
            return;
          }
          res.write(": studio-watch\n\n");
        }, heartbeatMs)
      };
      client.heartbeat.unref?.();
      clients.add(client);
      return () => remove(client);
    },
    broadcast(payload) {
      for (const client of [...clients]) {
        if (!writeEvent(client.res, payload)) remove(client);
      }
    },
    close() {
      for (const client of [...clients]) {
        remove(client);
        if (!client.res.writableEnded && !client.res.destroyed) client.res.end();
      }
    },
    get size() {
      return clients.size;
    }
  });
}
