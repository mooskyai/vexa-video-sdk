import { createHash, createHmac } from "node:crypto";

const digest = (data) => createHash("sha256").update(data).digest("hex");
const hmac = (key, value) => createHmac("sha256", key).update(value).digest();

/** Test-only S3 path-style signing; hard refuses non-loopback endpoints. */
export class LoopbackS3 {
  constructor(env = process.env) {
    const raw = env.VEXA_TEST_S3_URL;
    if (!raw) throw new Error("Set VEXA_TEST_S3_URL to a dedicated loopback S3-compatible test server.");
    const url = new URL(raw);
    if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
      || (url.pathname !== "/" && url.pathname !== "") || url.username || url.password
      || url.search || url.hash || !url.port) {
      throw new Error("VEXA_TEST_S3_URL must be an HTTP loopback origin with an explicit port.");
    }
    if (!env.VEXA_TEST_S3_ACCESS_KEY || !env.VEXA_TEST_S3_SECRET_KEY) {
      throw new Error("Set VEXA_TEST_S3_ACCESS_KEY and VEXA_TEST_S3_SECRET_KEY for the isolated test server.");
    }
    this.origin = url.origin;
    this.accessKey = env.VEXA_TEST_S3_ACCESS_KEY;
    this.secretKey = env.VEXA_TEST_S3_SECRET_KEY;
  }

  async request(method, bucket, key = "", { body = Buffer.alloc(0), metadata = {}, conditional = false } = {}) {
    if (!/^vexa-acceptance-[a-f0-9]{32}$/.test(bucket) || (key && !/^case-[a-z0-9-]+\.mp4$/.test(key))) {
      throw new Error("S3 acceptance only permits isolated random test buckets and known artifact keys.");
    }
    const uri = `/${bucket}${key ? `/${key}` : ""}`;
    const date = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
    const day = date.slice(0, 8);
    const payload = Buffer.isBuffer(body) ? body : Buffer.from(body);
    const payloadHash = digest(payload);
    const host = new URL(this.origin).host;
    const headers = {
      host,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": date,
      ...metadata
    };
    if (conditional) headers["if-none-match"] = "*";
    const keys = Object.keys(headers).sort();
    const canonicalHeaders = keys.map((k) => `${k}:${String(headers[k]).trim()}\n`).join("");
    const signed = keys.join(";");
    const canonicalRequest = [method, uri, "", canonicalHeaders, signed, payloadHash].join("\n");
    const scope = `${day}/us-east-1/s3/aws4_request`;
    const toSign = ["AWS4-HMAC-SHA256", date, scope, digest(canonicalRequest)].join("\n");
    const signingKey = hmac(hmac(hmac(hmac(`AWS4${this.secretKey}`, day), "us-east-1"), "s3"), "aws4_request");
    const signature = createHmac("sha256", signingKey).update(toSign).digest("hex");
    headers.authorization = `AWS4-HMAC-SHA256 Credential=${this.accessKey}/${scope}, SignedHeaders=${signed}, Signature=${signature}`;
    const response = await fetch(`${this.origin}${uri}`, {
      method,
      headers,
      ...(method === "PUT" ? { body: payload } : {}),
      signal: AbortSignal.timeout(10_000)
    });
    const result = { status: response.status, headers: response.headers,
      data: Buffer.from(await response.arrayBuffer()) };
    if (response.status >= 500 || response.status === 401 || response.status === 403) {
      throw new Error(`S3 acceptance request failed with HTTP ${response.status}.`);
    }
    return result;
  }

  async createBucket(bucket) {
    const result = await this.request("PUT", bucket);
    if (result.status !== 200 && result.status !== 201) throw new Error(`Test bucket create failed: ${result.status}`);
  }
  async deleteBucket(bucket) {
    const result = await this.request("DELETE", bucket);
    if (result.status !== 204 && result.status !== 200) throw new Error(`Test bucket delete failed: ${result.status}`);
  }
  async upload(bucket, key, bytes, fingerprint, artifactId) {
    return await this.request("PUT", bucket, key, {
      body: bytes, conditional: true,
      metadata: {
        "content-type": "video/mp4",
        "x-amz-meta-vexa-fingerprint": fingerprint,
        "x-amz-meta-vexa-artifact-id": artifactId
      }
    });
  }
  async head(bucket, key) {
    const result = await this.request("HEAD", bucket, key);
    if (result.status === 404) return null;
    if (result.status !== 200) throw new Error(`S3 artifact inspection failed: ${result.status}`);
    const fingerprint = result.headers.get("x-amz-meta-vexa-fingerprint");
    const artifactId = result.headers.get("x-amz-meta-vexa-artifact-id");
    const sizeBytes = Number(result.headers.get("content-length"));
    return { fingerprint, artifactId, sizeBytes };
  }
  async read(bucket, key) {
    const result = await this.request("GET", bucket, key);
    if (result.status !== 200) throw new Error(`S3 artifact GET failed: ${result.status}`);
    return result.data;
  }
  async remove(bucket, key) {
    const result = await this.request("DELETE", bucket, key);
    if (result.status !== 204 && result.status !== 200) throw new Error(`S3 artifact delete failed: ${result.status}`);
  }
}
