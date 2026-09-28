<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";

const baseUrl = "http://127.0.0.1:4190";
const file = ref<File | null>(null);
const mediaId = ref<string | null>(null);
const job = ref<any>(null);
let timer: number | undefined;

const outputUrl = computed(() => job.value?.result?.outputUrl
  ? new URL(job.value.result.outputUrl, baseUrl).toString()
  : null);

function choose(event: Event) {
  file.value = (event.target as HTMLInputElement).files?.[0] ?? null;
}

async function upload() {
  if (!file.value) return;
  const response = await fetch(`${baseUrl}/v1/media`, {
    method: "POST",
    headers: {
      "content-type": file.value.type || "application/octet-stream",
      "x-vexa-file-name": file.value.name
    },
    body: file.value
  });
  const media = await response.json();
  if (!response.ok) throw new Error(media.error ?? "Upload failed");
  mediaId.value = media.id;
}

async function render() {
  if (!mediaId.value) return;
  const response = await fetch(`${baseUrl}/v1/jobs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "video.render",
      payload: {
        mediaId: mediaId.value,
        operations: [{ type: "resize", options: { width: 1280, height: 720, fit: "contain" } }],
        outputFormat: "mp4",
        export: { videoCodec: "h264", audioCodec: "aac", hardwareAcceleration: "auto" }
      }
    })
  });
  job.value = await response.json();
  if (!response.ok) throw new Error(job.value.error ?? "Render submission failed");
  timer = window.setInterval(async () => {
    const status = await fetch(`${baseUrl}/v1/jobs/${job.value.descriptor.id}`);
    if (!status.ok) return;
    job.value = await status.json();
    if (["succeeded", "failed", "cancelled"].includes(job.value.state)) {
      window.clearInterval(timer);
      timer = undefined;
    }
  }, 500);
}

onBeforeUnmount(() => {
  if (timer !== undefined) window.clearInterval(timer);
});
</script>

<template>
  <main>
    <h1>Vexa Vue example</h1>
    <input type="file" accept="video/*" @change="choose">
    <button :disabled="!file" @click="upload">Upload</button>
    <button :disabled="!mediaId" @click="render">Render 720p</button>
    <p v-if="job">{{ job.state }} · {{ job.progress?.percent ?? 0 }}%</p>
    <video v-if="outputUrl" controls :src="outputUrl" style="width:100%;max-width:800px" />
  </main>
</template>
