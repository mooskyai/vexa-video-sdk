export type VideoSdkErrorCode =
  | "BINARY_NOT_FOUND"
  | "INVALID_MEDIA_SOURCE"
  | "INVALID_OPERATION"
  | "INVALID_PROJECT"
  | "INVALID_STREAMING"
  | "INVALID_CAPTION"
  | "INCOMPATIBLE_OUTPUT"
  | "HARDWARE_ACCELERATION_UNAVAILABLE"
  | "INVALID_STORAGE"
  | "REMOTE_MEDIA_REJECTED"
  | "STORAGE_ADAPTER_NOT_FOUND"
  | "STORAGE_TRANSFER_FAILED"
  | "INVALID_JOB"
  | "JOB_NOT_FOUND"
  | "JOB_CANCELLED"
  | "JOB_FAILED"
  | "JOB_IDEMPOTENCY_CONFLICT"
  | "JOB_QUEUE_CLOSED"
  | "JOB_TRANSPORT_FAILED"
  | "INVALID_PLUGIN"
  | "PLUGIN_NOT_FOUND"
  | "PLUGIN_CONFLICT"
  | "PLUGIN_DEPENDENCY_MISSING"
  | "PLUGIN_EXECUTION_FAILED"
  | "PROCESS_ABORTED"
  | "PROCESS_FAILED"
  | "PROCESS_TIMEOUT"
  | "PROBE_FAILED";

export class VideoSdkError extends Error {
  readonly code: VideoSdkErrorCode;
  readonly cause?: unknown;

  constructor(message: string, code: VideoSdkErrorCode, options?: { cause?: unknown }) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.cause = options?.cause;
  }
}

export class BinaryNotFoundError extends VideoSdkError {
  constructor(binary: string, options?: { cause?: unknown }) {
    super(`Required media binary was not found or could not be executed: ${binary}`, "BINARY_NOT_FOUND", options);
  }
}

export class InvalidMediaSourceError extends VideoSdkError {
  constructor(source: string) {
    super(`Invalid media source: ${source}`, "INVALID_MEDIA_SOURCE");
  }
}

export class ProcessExecutionError extends VideoSdkError {
  readonly command: string;
  readonly args: readonly string[];
  readonly exitCode: number | null;
  readonly stderr: string;

  constructor(options: {
    command: string;
    args: readonly string[];
    exitCode: number | null;
    stderr: string;
    cause?: unknown;
  }) {
    super(
      `Media process failed (${options.command}, exit code ${options.exitCode ?? "unknown"}).`,
      "PROCESS_FAILED",
      { cause: options.cause }
    );
    this.command = options.command;
    this.args = options.args;
    this.exitCode = options.exitCode;
    this.stderr = options.stderr;
  }
}

export class ProcessTimeoutError extends VideoSdkError {
  constructor(timeoutMs: number) {
    super(`Media process exceeded timeout of ${timeoutMs}ms.`, "PROCESS_TIMEOUT");
  }
}

export class ProcessAbortedError extends VideoSdkError {
  constructor() {
    super("Media process was aborted.", "PROCESS_ABORTED");
  }
}

export class ProbeError extends VideoSdkError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, "PROBE_FAILED", options);
  }
}

export class InvalidOperationError extends VideoSdkError {
  constructor(message: string) {
    super(message, "INVALID_OPERATION");
  }
}


export class HardwareAccelerationUnavailableError extends VideoSdkError {
  constructor(message: string) {
    super(message, "HARDWARE_ACCELERATION_UNAVAILABLE");
  }
}

export class IncompatibleOutputError extends VideoSdkError {
  constructor(message: string) {
    super(message, "INCOMPATIBLE_OUTPUT");
  }
}

export class InvalidProjectError extends VideoSdkError {
  constructor(message: string) {
    super(message, "INVALID_PROJECT");
  }
}

export class InvalidCaptionError extends VideoSdkError {
  constructor(message: string) {
    super(message, "INVALID_CAPTION");
  }
}

export class InvalidStreamingError extends VideoSdkError {
  constructor(message: string) {
    super(message, "INVALID_STREAMING");
  }
}


export class InvalidStorageError extends VideoSdkError {
  constructor(message: string) {
    super(message, "INVALID_STORAGE");
  }
}

export class RemoteMediaRejectedError extends VideoSdkError {
  constructor(message: string) {
    super(message, "REMOTE_MEDIA_REJECTED");
  }
}

export class StorageAdapterNotFoundError extends VideoSdkError {
  constructor(provider: string) {
    super(`No storage adapter is registered for provider: ${provider}`, "STORAGE_ADAPTER_NOT_FOUND");
  }
}

export class StorageTransferError extends VideoSdkError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, "STORAGE_TRANSFER_FAILED", options);
  }
}


export class InvalidJobError extends VideoSdkError {
  constructor(message: string) {
    super(message, "INVALID_JOB");
  }
}

export class JobNotFoundError extends VideoSdkError {
  readonly jobId: string;

  constructor(jobId: string) {
    super(`Job was not found: ${jobId}`, "JOB_NOT_FOUND");
    this.jobId = jobId;
  }
}

export class JobCancelledError extends VideoSdkError {
  readonly jobId: string;

  constructor(jobId: string) {
    super(`Job was cancelled: ${jobId}`, "JOB_CANCELLED");
    this.jobId = jobId;
  }
}

export class JobExecutionError extends VideoSdkError {
  readonly jobId: string;

  constructor(jobId: string, message: string, options?: { cause?: unknown }) {
    super(`Job ${jobId} failed: ${message}`, "JOB_FAILED", options);
    this.jobId = jobId;
  }
}

export class JobIdempotencyConflictError extends VideoSdkError {
  readonly idempotencyKey: string;

  constructor(idempotencyKey: string) {
    super(
      `Idempotency key is already associated with different work: ${idempotencyKey}`,
      "JOB_IDEMPOTENCY_CONFLICT"
    );
    this.idempotencyKey = idempotencyKey;
  }
}

export class JobQueueClosedError extends VideoSdkError {
  constructor() {
    super("Job queue is closed and cannot accept new work.", "JOB_QUEUE_CLOSED");
  }
}

export class JobTransportError extends VideoSdkError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, "JOB_TRANSPORT_FAILED", options);
  }
}


export class InvalidPluginError extends VideoSdkError {
  constructor(message: string) {
    super(message, "INVALID_PLUGIN");
  }
}

export class PluginNotFoundError extends VideoSdkError {
  readonly pluginId: string;

  constructor(pluginId: string) {
    super(`Plugin was not found: ${pluginId}`, "PLUGIN_NOT_FOUND");
    this.pluginId = pluginId;
  }
}

export class PluginConflictError extends VideoSdkError {
  constructor(message: string) {
    super(message, "PLUGIN_CONFLICT");
  }
}

export class PluginDependencyError extends VideoSdkError {
  readonly pluginId: string;
  readonly dependencyId: string;

  constructor(pluginId: string, dependencyId: string) {
    super(
      `Plugin ${pluginId} requires plugin ${dependencyId}, but that dependency is not registered.`,
      "PLUGIN_DEPENDENCY_MISSING"
    );
    this.pluginId = pluginId;
    this.dependencyId = dependencyId;
  }
}

export class PluginExecutionError extends VideoSdkError {
  readonly pluginId: string;
  readonly phase: string;

  constructor(pluginId: string, phase: string, message: string, options?: { cause?: unknown }) {
    super(`Plugin ${pluginId} failed during ${phase}: ${message}`, "PLUGIN_EXECUTION_FAILED", options);
    this.pluginId = pluginId;
    this.phase = phase;
  }
}
