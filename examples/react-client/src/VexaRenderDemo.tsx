import { useEffect, useMemo, useState } from "react";

type Job = {
  descriptor: { id: string };
  state: "queued" | "running" | "retrying" | "succeeded" | "failed" | "cancelled";
  progress?: { percent?: number };
  result?: { outputUrl?: string };
  error?: { message?: string };
};

export function VexaRenderDemo({ baseUrl = "http://127.0.0.1:4190" }: { baseUrl?: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [mediaId, setMediaId] = useState<string | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const outputUrl = useMemo(() => job?.result?.outputUrl ? new URL(job.result.outputUrl, baseUrl).toString() : null, [baseUrl, job]);

  useEffect(() => {
    if (!job || ["succeeded", "failed", "cancelled"].includes(job.state)) return;
    const timer = window.setInterval(async () => {
      const response = await fetch(`${baseUrl}/v1/jobs/${job.descriptor.id}`);
      if (response.ok) setJob(await response.json());
    }, 500);
    return () => window.clearInterval(timer);
  }, [baseUrl, job]);

  async function upload() {
    if (!file) return;
    const response = await fetch(`${baseUrl}/v1/media`, {
      method: "POST",
      headers: { "content-type": file.type || "application/octet-stream", "x-vexa-file-name": file.name },
      body: file
    });
    const media = await response.json();
    if (!response.ok) throw new Error(media.error ?? "Upload failed");
    setMediaId(media.id);
  }

  async function render() {
    if (!mediaId) return;
    const response = await fetch(`${baseUrl}/v1/jobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "video.render",
        payload: {
          mediaId,
          operations: [{ type: "resize", options: { width: 1280, height: 720, fit: "contain" } }],
          outputFormat: "mp4",
          export: { videoCodec: "h264", audioCodec: "aac", hardwareAcceleration: "auto" }
        }
      })
    });
    const value = await response.json();
    if (!response.ok) throw new Error(value.error ?? "Render submission failed");
    setJob(value);
  }

  return <main>
    <h1>Vexa React example</h1>
    <input type="file" accept="video/*" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
    <button disabled={!file} onClick={() => void upload()}>Upload</button>
    <button disabled={!mediaId} onClick={() => void render()}>Render 720p</button>
    {job && <p>{job.state} · {job.progress?.percent ?? 0}%</p>}
    {outputUrl && <video controls src={outputUrl} style={{ width: "100%", maxWidth: 800 }} />}
  </main>;
}
