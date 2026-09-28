import type { CaptionDocument, CaptionFormat, CaptionStyle, CaptionTemplateName } from "@vexa-video/core";
import { applyCaptionTemplate, captionTemplate, parseCaptions, serializeCaptions } from "@vexa-video/core";

export class Captions {
  static parse(content: string, format: CaptionFormat): CaptionDocument {
    return parseCaptions(content, format);
  }

  static stringify(document: CaptionDocument, format: CaptionFormat = document.format): string {
    return serializeCaptions(document, format);
  }

  static template(name: CaptionTemplateName, overrides: CaptionStyle = {}): CaptionStyle {
    return captionTemplate(name, overrides);
  }

  static applyTemplate(document: CaptionDocument, name: CaptionTemplateName, overrides: CaptionStyle = {}): CaptionDocument {
    return applyCaptionTemplate(document,name,overrides);
  }
}
