# Security Policy

Vexa Video SDK processes untrusted media, starts native FFmpeg processes, can download remote content, and can expose render/job APIs. Deployments should treat those boundaries as security-sensitive.

## Reporting a vulnerability

Please report suspected vulnerabilities privately to the repository maintainer rather than opening a public issue with exploit details.

Include, when possible:

- affected package/file;
- impact;
- reproduction steps or proof of concept;
- relevant platform/runtime versions;
- suggested mitigation if known.

Public discussion can happen after a fix or coordinated disclosure plan is available.

## Supported code

The project is in active development. Security fixes target the current `main` branch and the latest actively maintained package state. A formal long-term support matrix will be defined before stable public package releases.

## Threat model

The most important trust boundaries are:

- uploaded media;
- remote media URLs and redirects;
- cloud/object-storage adapters;
- FFmpeg/ffprobe processes;
- filesystem workspaces and output paths;
- job payloads crossing process/machine boundaries;
- browser authentication headers;
- future plugins and alternate backends.

## Remote media and SSRF

The built-in remote-media path is intentionally restrictive.

Defaults include:

- HTTPS required;
- URL-embedded credentials rejected;
- loopback/private/link-local/reserved destinations rejected;
- DNS results checked before connection;
- redirect targets revalidated;
- sensitive auth/cookie headers stripped on cross-origin redirects;
- maximum redirect and byte limits;
- streamed writes into managed workspaces.

Private-network and plain-HTTP access should be enabled only for trusted development or controlled internal environments.

Do not remove these protections to support a single convenient test URL; add an explicit opt-in at the application boundary instead.

## Media uploads

Treat uploaded files as untrusted binary data.

Recommended deployment controls:

- enforce request/upload size limits before and during streaming;
- isolate render workspaces from application source/configuration;
- use unique non-user-controlled output names;
- avoid serving temporary directories directly without path validation;
- expire temporary media and render artifacts;
- run exposed render workers with least filesystem privileges.

## FFmpeg execution

Vexa uses `spawn()` with explicit argument arrays instead of shell-concatenated commands. Keep that invariant.

Do not interpolate untrusted media metadata into a shell command.

FFmpeg itself is a large native-code parser/codec surface. Internet-facing deployments should keep FFmpeg updated and consider OS/container isolation, CPU/memory limits, execution timeouts, and restricted filesystem/network access for workers.

## Paths and workspaces

Managed workspaces validate that generated paths remain inside the expected root. Any new feature that accepts a filename, relative path, package directory, or artifact key must preserve traversal protections.

Platform-specific separators must not be allowed to escape package directories or produce non-portable manifest URIs.

## Cloud credentials

S3/GCS/Azure integration is adapter-based by design. Vexa does not require cloud credentials in its core configuration.

Applications should:

- use least-privilege service identities;
- avoid embedding long-lived credentials in job payloads;
- keep cloud clients/credential refresh logic in application infrastructure;
- scope upload/download permissions to the required buckets/containers/prefixes;
- avoid logging secrets or signed URLs unnecessarily.

## Jobs and distributed workers

Job payloads and results should remain serializable and should not contain secrets unless the transport/store is designed to protect them.

Idempotency keys deduplicate submissions but do not guarantee exactly-once external side effects. Retryable handlers should write to deterministic object/output identities or use an external idempotent transaction contract.

Redis or other distributed transports should use authenticated, encrypted connections appropriate to the deployment environment.

## Angular/browser integration

The browser package should never receive server credentials, local filesystem paths, Redis connection details, or FFmpeg command access.

Authentication headers configured in Angular are browser-visible application credentials and should be short-lived/scoped appropriately.

Render-service CORS should be restricted in production rather than using broad development defaults.

The example Node render service is for local integration/testing. It is not a production-hardened internet-facing API without additional authentication, authorization, quotas, persistence, and isolation.

## Plugins

Future plugins will be executable application code, not untrusted data. Installing a plugin should be treated with the same trust level as installing any other Node package.

Plugin contracts should still enforce browser/Node boundaries and prevent accidental bypass of validation/security policy.

## Dependency and build security

Before releases:

- use clean installs in CI;
- review dependency updates, especially native/build tooling;
- avoid `--force` or `--legacy-peer-deps` as a permanent solution to incompatible peer dependencies;
- keep Angular build/compiler/runtime versions aligned;
- verify packed package contents before publication;
- keep generated media/build artifacts out of source control.

## Security-related tests

Changes to remote media, path resolution, uploads, jobs, or browser transport should include negative tests for the unsafe case, not only happy-path coverage.

Examples:

- private-network URL rejection;
- path traversal rejection;
- oversized download rejection;
- idempotency conflict behavior;
- browser-package import scanning;
- cancellation/timeout behavior.
