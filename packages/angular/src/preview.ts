import type { VexaMediaAsset } from "./contracts.js";
import { VexaMediaProvider } from "./media.js";

export interface VexaAttachPreviewOptions {
  autoplay?: boolean;
  muted?: boolean;
}

export class VexaPreviewService {
  constructor(private readonly media: VexaMediaProvider) {}

  url(assetOrPath: VexaMediaAsset | string): string {
    return this.media.url(assetOrPath);
  }

  attach(
    element: HTMLMediaElement,
    assetOrPath: VexaMediaAsset | string,
    options: VexaAttachPreviewOptions = {}
  ): () => void {
    const previous = element.getAttribute("src");
    element.src = this.url(assetOrPath);
    if (options.muted !== undefined) element.muted = options.muted;
    element.load();
    if (options.autoplay) void element.play();
    return () => {
      element.pause();
      if (previous === null) element.removeAttribute("src");
      else element.setAttribute("src", previous);
      element.load();
    };
  }
}
