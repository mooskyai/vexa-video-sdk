import type { VexaMediaAsset, VexaUploadOptions } from "./contracts.js";
import { VexaVideoTransport } from "./transport.js";

export abstract class VexaMediaProvider {
  abstract upload(file: Blob, options?: VexaUploadOptions): Promise<VexaMediaAsset>;
  abstract url(assetOrPath: VexaMediaAsset | string): string;
}

export class TransportVexaMediaProvider extends VexaMediaProvider {
  constructor(private readonly transport: VexaVideoTransport) { super(); }
  upload(file: Blob, options?: VexaUploadOptions): Promise<VexaMediaAsset> {
    return this.transport.upload(file, options);
  }
  url(assetOrPath: VexaMediaAsset | string): string {
    return this.transport.mediaUrl(typeof assetOrPath === "string" ? assetOrPath : assetOrPath.url);
  }
}

export class VexaMediaService {
  constructor(private readonly provider: VexaMediaProvider) {}
  upload(file: Blob, options?: VexaUploadOptions): Promise<VexaMediaAsset> {
    return this.provider.upload(file, options);
  }
  url(assetOrPath: VexaMediaAsset | string): string {
    return this.provider.url(assetOrPath);
  }
}
