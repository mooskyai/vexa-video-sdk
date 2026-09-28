import { spawn } from "node:child_process";
import {
  ProcessAbortedError,
  ProcessExecutionError,
  ProcessTimeoutError
} from "@vexa-video/core";

export interface RunProcessOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  onStdoutChunk?: (chunk: string) => void;
  onStderrChunk?: (chunk: string) => void;
}

export interface ProcessResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export async function runProcess(
  command: string,
  args: readonly string[],
  options: RunProcessOptions = {}
): Promise<ProcessResult> {
  if (options.signal?.aborted) {
    throw new ProcessAbortedError();
  }

  return await new Promise<ProcessResult>((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;

    const child = spawn(command, [...args], {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });

    const finishReject = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    const finishResolve = (result: ProcessResult) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };

    const abortHandler = () => {
      child.kill("SIGTERM");
      finishReject(new ProcessAbortedError());
    };

    const timeout = options.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          child.kill("SIGTERM");
        }, options.timeoutMs)
      : undefined;

    const cleanup = () => {
      if (timeout) clearTimeout(timeout);
      options.signal?.removeEventListener("abort", abortHandler);
    };

    options.signal?.addEventListener("abort", abortHandler, { once: true });

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      try {
        options.onStdoutChunk?.(chunk);
      } catch (cause) {
        child.kill("SIGTERM");
        finishReject(cause);
      }
    });

    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
      try {
        options.onStderrChunk?.(chunk);
      } catch (cause) {
        child.kill("SIGTERM");
        finishReject(cause);
      }
    });

    child.on("error", (cause) => {
      finishReject(
        new ProcessExecutionError({
          command,
          args,
          exitCode: null,
          stderr,
          cause
        })
      );
    });

    child.on("close", (code) => {
      if (settled) return;

      if (timedOut && options.timeoutMs) {
        finishReject(new ProcessTimeoutError(options.timeoutMs));
        return;
      }

      if (code !== 0) {
        finishReject(
          new ProcessExecutionError({
            command,
            args,
            exitCode: code,
            stderr
          })
        );
        return;
      }

      finishResolve({
        exitCode: code,
        stdout,
        stderr
      });
    });
  });
}
