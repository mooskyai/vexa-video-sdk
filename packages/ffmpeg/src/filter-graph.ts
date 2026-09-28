import type { VideoOperation } from "@moosky-video/core";

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(6)));
}

export interface CompiledFilterGraph {
  filters: readonly string[];
  expression: string | null;
  requiresVideoEncode: boolean;
}

export function compileVideoFilterGraph(
  operations: readonly VideoOperation[]
): CompiledFilterGraph {
  const filters: string[] = [];

  for (const operation of operations) {
    switch (operation.type) {
      case "trim":
        break;
      case "resize": {
        const { width, height, fit = "contain" } = operation.options;
        if (fit === "fill") {
          filters.push(`scale=${width}:${height}`);
        } else if (fit === "cover") {
          filters.push(
            `scale=${width}:${height}:force_original_aspect_ratio=increase`,
            `crop=${width}:${height}`
          );
        } else {
          filters.push(
            `scale=${width}:${height}:force_original_aspect_ratio=decrease`,
            `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black`
          );
        }
        break;
      }
      case "crop": {
        const { width, height, x, y } = operation.options;
        const xExpression = x === undefined ? "(iw-ow)/2" : formatNumber(x);
        const yExpression = y === undefined ? "(ih-oh)/2" : formatNumber(y);
        filters.push(`crop=${width}:${height}:${xExpression}:${yExpression}`);
        break;
      }
      case "rotate": {
        const normalized = ((operation.options.degrees % 360) + 360) % 360;
        if (normalized === 0) break;
        if (normalized === 90) {
          filters.push("transpose=clock");
        } else if (normalized === 180) {
          filters.push("hflip", "vflip");
        } else if (normalized === 270) {
          filters.push("transpose=cclock");
        } else {
          const degrees = formatNumber(normalized);
          filters.push(
            `rotate=${degrees}*PI/180:ow=rotw(${degrees}*PI/180):oh=roth(${degrees}*PI/180):c=black@0`
          );
        }
        break;
      }
    }
  }

  return {
    filters,
    expression: filters.length > 0 ? filters.join(",") : null,
    requiresVideoEncode: filters.length > 0
  };
}
