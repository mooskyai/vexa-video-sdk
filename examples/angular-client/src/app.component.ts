import { Component, inject, signal } from "@angular/core";
import {
  VexaMediaService,
  VexaPreviewService,
  VexaRenderService,
  type VexaJobRef,
  type VexaMediaAsset,
  type VexaRenderResult,
  type VexaVideoRenderRequest
} from "@vexa-video/angular";

@Component({
  selector: "vexa-example-app",
  standalone: true,
  template: `
    <main>
      <h1>Vexa Angular example</h1>
      <input type="file" accept="video/*" (change)="upload($event)">
      <button type="button" [disabled]="!asset()" (click)="render()">Render 720p</button>
      @if (asset(); as media) {
        <video controls [src]="preview.url(media)" style="max-width: 720px; width: 100%"></video>
      }
      @if (job(); as current) {
        <pre>{{ current.state() }} · {{ current.progress()?.percent ?? 0 }}%</pre>
      }
    </main>
  `
})
export class AppComponent {
  private readonly media = inject(VexaMediaService);
  private readonly renders = inject(VexaRenderService);
  readonly preview = inject(VexaPreviewService);
  readonly asset = signal<VexaMediaAsset | null>(null);
  readonly job = signal<VexaJobRef<VexaVideoRenderRequest, VexaRenderResult> | null>(null);

  async upload(event: Event): Promise<void> {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    this.asset.set(await this.media.upload(file));
  }

  async render(): Promise<void> {
    const asset = this.asset();
    if (!asset) return;
    this.job.set(await this.renders.renderVideo({
      mediaId: asset.id,
      operations: [{ type: "resize", options: { width: 1280, height: 720, fit: "contain" } }],
      outputFormat: "mp4",
      export: { videoCodec: "h264", audioCodec: "aac", hardwareAcceleration: "auto" }
    }));
  }
}
