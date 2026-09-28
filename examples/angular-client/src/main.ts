import { bootstrapApplication } from "@angular/platform-browser";
import { AppComponent } from "./app.component.js";
import { appConfig } from "./app.config.js";

bootstrapApplication(AppComponent, appConfig)
  .catch((error) => {
    console.error("Failed to bootstrap Vexa Angular demo:", error);
  });
