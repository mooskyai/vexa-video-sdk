import type { ApplicationConfig } from "@angular/core";
import { provideVexaVideo } from "@vexa-video/angular";

export const appConfig: ApplicationConfig = {
  providers: [
    provideVexaVideo({
      baseUrl: "http://127.0.0.1:4180",
      pollIntervalMs: 500
    })
  ]
};
