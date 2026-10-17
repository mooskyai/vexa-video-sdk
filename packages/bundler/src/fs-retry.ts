import { rename } from "node:fs/promises";

const TRANSIENT_WINDOWS_RENAME_CODES = new Set(["EACCES", "EBUSY", "EPERM"]);
const DEFAULT_RENAME_ATTEMPTS = 6;
const DEFAULT_RENAME_BASE_DELAY_MS = 25;

type RenameDirectory = (source: string, destination: string) => Promise<void>;
type Sleep = (delayMs: number) => Promise<void>;

export interface RenameDirectoryRetryOptions {
  readonly attempts?: number;
  readonly baseDelayMs?: number;
  readonly platform?: NodeJS.Platform;
  readonly renameImpl?: RenameDirectory;
  readonly sleepImpl?: Sleep;
}

function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("code" in error)) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

function assertRetryOptions(attempts: number, baseDelayMs: number): void {
  if (!Number.isSafeInteger(attempts) || attempts < 1) {
    throw new TypeError("rename retry attempts must be a positive safe integer.");
  }
  if (!Number.isFinite(baseDelayMs) || baseDelayMs < 0) {
    throw new TypeError(
      "rename retry baseDelayMs must be a finite number greater than or equal to 0."
    );
  }
}

async function sleep(delayMs: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
}

export async function renameDirectoryWithRetry(
  source: string,
  destination: string,
  options: RenameDirectoryRetryOptions = {}
): Promise<void> {
  const attempts = options.attempts ?? DEFAULT_RENAME_ATTEMPTS;
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_RENAME_BASE_DELAY_MS;
  assertRetryOptions(attempts, baseDelayMs);

  const platform = options.platform ?? process.platform;
  const renameImpl = options.renameImpl ?? rename;
  const sleepImpl = options.sleepImpl ?? sleep;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await renameImpl(source, destination);
      return;
    } catch (error) {
      const code = errorCode(error);
      const retryable =
        platform === "win32" &&
        code !== undefined &&
        TRANSIENT_WINDOWS_RENAME_CODES.has(code) &&
        attempt < attempts;

      if (!retryable) throw error;
      await sleepImpl(baseDelayMs * attempt);
    }
  }
}
