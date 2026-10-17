import type { VexaWebVideoFrameContext } from "./index.js";

export type VexaWebCaptureErrorCode =
  | "INVALID_CAPTURE_SOURCE"
  | "CAPTURE_UNAVAILABLE"
  | "CAPTURE_FAILED"
  | "CANCELLED";

export class VexaWebCaptureError extends Error {
  readonly code: VexaWebCaptureErrorCode;

  constructor(code: VexaWebCaptureErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "VexaWebCaptureError";
    this.code = code;
  }
}

export interface VexaWebFrameCapture {
  (
    context: VexaWebVideoFrameContext,
    signal: AbortSignal | undefined
  ): HTMLCanvasElement | OffscreenCanvas | Promise<HTMLCanvasElement | OffscreenCanvas>;
}

export interface VexaWebCanvasCaptureOptions {
  readonly canvas: HTMLCanvasElement | OffscreenCanvas;
  readonly renderFrame?: (
    context: VexaWebVideoFrameContext,
    signal: AbortSignal | undefined
  ) => void | Promise<void>;
}

export interface VexaWebDomCaptureRuntime {
  snapshotElement(element: Element): string;
  createImageBitmap(source: Blob): Promise<ImageBitmap>;
  createCanvas(width: number, height: number): HTMLCanvasElement | OffscreenCanvas;
  drawImage(
    canvas: HTMLCanvasElement | OffscreenCanvas,
    image: ImageBitmap,
    width: number,
    height: number
  ): void;
  waitForReady?(): Promise<void>;
}

export interface VexaWebDomCaptureOptions {
  readonly element: Element;
  readonly renderFrame?: (
    context: VexaWebVideoFrameContext,
    signal: AbortSignal | undefined
  ) => void | Promise<void>;
  readonly runtime?: VexaWebDomCaptureRuntime;
}

function cancellationError(): VexaWebCaptureError {
  return new VexaWebCaptureError("CANCELLED", "Browser frame capture was cancelled.");
}

function positiveDimension(value: number, name: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new VexaWebCaptureError("INVALID_CAPTURE_SOURCE", `${name} must be a positive integer.`);
  }
  return value;
}

export function createCanvasFrameCapture(options: VexaWebCanvasCaptureOptions): VexaWebFrameCapture {
  const width = positiveDimension(options.canvas.width, "canvas.width");
  const height = positiveDimension(options.canvas.height, "canvas.height");

  return async (context, signal) => {
    if (signal?.aborted) throw cancellationError();
    if (context.width !== width || context.height !== height) {
      throw new VexaWebCaptureError(
        "INVALID_CAPTURE_SOURCE",
        `Canvas capture dimensions ${width}x${height} do not match encoded frame dimensions ${context.width}x${context.height}.`
      );
    }
    try {
      await options.renderFrame?.(context, signal);
    } catch (error) {
      if (signal?.aborted) throw cancellationError();
      throw new VexaWebCaptureError("CAPTURE_FAILED", `Canvas frame ${context.frame} could not be rendered.`, { cause: error });
    }
    if (signal?.aborted) throw cancellationError();
    return options.canvas;
  };
}

function copyComputedStyles(
  source: Element,
  target: Element,
  readStyle: (element: Element) => CSSStyleDeclaration
): void {
  const computed = readStyle(source);
  let cssText = "";
  for (let index = 0; index < computed.length; index += 1) {
    const property = computed.item(index);
    if (property.length === 0) continue;
    const value = computed.getPropertyValue(property);
    const priority = computed.getPropertyPriority(property);
    cssText += `${property}:${value}${priority.length === 0 ? "" : ` !${priority}`};`;
  }
  target.setAttribute("style", cssText);

  const sourceChildren = source.children;
  const targetChildren = target.children;
  const childCount = Math.min(sourceChildren.length, targetChildren.length);
  for (let index = 0; index < childCount; index += 1) {
    const sourceChild = sourceChildren.item(index);
    const targetChild = targetChildren.item(index);
    if (sourceChild !== null && targetChild !== null) copyComputedStyles(sourceChild, targetChild, readStyle);
  }
}

function defaultDomRuntime(): VexaWebDomCaptureRuntime {
  const globalValue = globalThis as typeof globalThis & {
    XMLSerializer?: typeof XMLSerializer;
    createImageBitmap?: typeof createImageBitmap;
    OffscreenCanvas?: typeof OffscreenCanvas;
    document?: Document;
    getComputedStyle?: typeof getComputedStyle;
  };
  if (
    typeof globalValue.XMLSerializer !== "function"
    || typeof globalValue.createImageBitmap !== "function"
    || typeof globalValue.getComputedStyle !== "function"
  ) {
    throw new VexaWebCaptureError(
      "CAPTURE_UNAVAILABLE",
      "DOM frame capture requires XMLSerializer, getComputedStyle, and createImageBitmap browser APIs."
    );
  }

  const createCanvas = (width: number, height: number): HTMLCanvasElement | OffscreenCanvas => {
    if (typeof globalValue.OffscreenCanvas === "function") return new globalValue.OffscreenCanvas(width, height);
    if (globalValue.document !== undefined) {
      const canvas = globalValue.document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      return canvas;
    }
    throw new VexaWebCaptureError("CAPTURE_UNAVAILABLE", "DOM frame capture requires Canvas or OffscreenCanvas support.");
  };

  return {
    snapshotElement(element) {
      if (element.matches("canvas,video,iframe") || element.querySelector("canvas,video,iframe") !== null) {
        throw new VexaWebCaptureError(
          "INVALID_CAPTURE_SOURCE",
          "DOM capture does not serialize canvas, video, or iframe descendants; capture those surfaces directly instead."
        );
      }
      const clone = element.cloneNode(true);
      if (!(clone instanceof Element)) {
        throw new VexaWebCaptureError("CAPTURE_FAILED", "DOM capture could not clone the source element.");
      }
      copyComputedStyles(element, clone, globalValue.getComputedStyle!);
      return new globalValue.XMLSerializer!().serializeToString(clone);
    },
    createImageBitmap(source) {
      return globalValue.createImageBitmap!(source);
    },
    createCanvas,
    drawImage(canvas, image, width, height) {
      const context = canvas.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
      if (context === null) {
        throw new VexaWebCaptureError("CAPTURE_UNAVAILABLE", "DOM capture requires a 2D canvas context.");
      }
      context.clearRect(0, 0, width, height);
      context.drawImage(image, 0, 0, width, height);
    },
    async waitForReady() {
      const fonts = globalValue.document?.fonts;
      if (fonts !== undefined) await fonts.ready;
    }
  };
}

function svgForeignObject(snapshot: string, width: number, height: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><foreignObject x="0" y="0" width="100%" height="100%">${snapshot}</foreignObject></svg>`;
}

export function createDomFrameCapture(options: VexaWebDomCaptureOptions): VexaWebFrameCapture {
  const runtime = options.runtime ?? defaultDomRuntime();
  let canvas: HTMLCanvasElement | OffscreenCanvas | undefined;
  let captureWidth: number | undefined;
  let captureHeight: number | undefined;

  return async (context, signal) => {
    if (signal?.aborted) throw cancellationError();
    try {
      await options.renderFrame?.(context, signal);
      if (signal?.aborted) throw cancellationError();
      await runtime.waitForReady?.();
      if (signal?.aborted) throw cancellationError();

      if (canvas === undefined) {
        captureWidth = positiveDimension(context.width, "capture width");
        captureHeight = positiveDimension(context.height, "capture height");
        canvas = runtime.createCanvas(captureWidth, captureHeight);
      } else if (context.width !== captureWidth || context.height !== captureHeight) {
        throw new VexaWebCaptureError(
          "INVALID_CAPTURE_SOURCE",
          "DOM capture dimensions must remain stable for one encoder run."
        );
      }

      const snapshot = runtime.snapshotElement(options.element);
      const svg = svgForeignObject(snapshot, context.width, context.height);
      const bitmap = await runtime.createImageBitmap(new Blob([svg], { type: "image/svg+xml" }));
      try {
        if (signal?.aborted) throw cancellationError();
        runtime.drawImage(canvas, bitmap, context.width, context.height);
      } finally {
        bitmap.close();
      }
      if (signal?.aborted) throw cancellationError();
      return canvas;
    } catch (error) {
      if (error instanceof VexaWebCaptureError) throw error;
      if (signal?.aborted) throw cancellationError();
      throw new VexaWebCaptureError("CAPTURE_FAILED", `DOM frame ${context.frame} could not be captured.`, { cause: error });
    }
  };
}
