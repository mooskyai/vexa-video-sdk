import {
  InjectionToken,
  inject,
  makeEnvironmentProviders,
  type EnvironmentProviders,
  type Provider,
  type Type
} from "@angular/core";
import { normalizeVexaVideoConfig, type NormalizedVexaVideoConfig, type VexaVideoConfig } from "./config.js";
import { VexaMediaProvider, TransportVexaMediaProvider, VexaMediaService } from "./media.js";
import { VexaRenderProvider, TransportVexaRenderProvider, VexaRenderService } from "./render.js";
import { VexaPreviewService } from "./preview.js";
import { FetchVexaVideoTransport, VexaVideoTransport } from "./transport.js";

export const VEXA_VIDEO_CONFIG = new InjectionToken<NormalizedVexaVideoConfig>("VEXA_VIDEO_CONFIG");

export interface VexaVideoFeature {
  readonly providers: readonly Provider[];
}

function overrideProvider<T>(token: unknown, value: Type<T> | T): Provider {
  return typeof value === "function"
    ? { provide: token, useClass: value as Type<T> }
    : { provide: token, useValue: value };
}

export function withVexaTransport(value: Type<VexaVideoTransport> | VexaVideoTransport): VexaVideoFeature {
  return { providers: [overrideProvider(VexaVideoTransport, value)] };
}

export function withVexaMediaProvider(value: Type<VexaMediaProvider> | VexaMediaProvider): VexaVideoFeature {
  return { providers: [overrideProvider(VexaMediaProvider, value)] };
}

export function withVexaRenderProvider(value: Type<VexaRenderProvider> | VexaRenderProvider): VexaVideoFeature {
  return { providers: [overrideProvider(VexaRenderProvider, value)] };
}

export function provideVexaVideo(
  config: VexaVideoConfig,
  ...features: readonly VexaVideoFeature[]
): EnvironmentProviders {
  const normalized = normalizeVexaVideoConfig(config);
  return makeEnvironmentProviders([
    { provide: VEXA_VIDEO_CONFIG, useValue: normalized },
    {
      provide: VexaVideoTransport,
      useFactory: () => new FetchVexaVideoTransport(inject(VEXA_VIDEO_CONFIG))
    },
    {
      provide: VexaMediaProvider,
      useFactory: () => new TransportVexaMediaProvider(inject(VexaVideoTransport))
    },
    {
      provide: VexaRenderProvider,
      useFactory: () => new TransportVexaRenderProvider(inject(VexaVideoTransport))
    },
    {
      provide: VexaMediaService,
      useFactory: () => new VexaMediaService(inject(VexaMediaProvider))
    },
    {
      provide: VexaRenderService,
      useFactory: () => new VexaRenderService(inject(VexaRenderProvider), inject(VEXA_VIDEO_CONFIG))
    },
    {
      provide: VexaPreviewService,
      useFactory: () => new VexaPreviewService(inject(VexaMediaProvider))
    },
    ...features.flatMap((feature) => [...feature.providers])
  ]);
}
