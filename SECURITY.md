# Security Policy

Vexa Video SDK executes media workloads, resolves files and URLs, launches FFmpeg processes, accepts plugin/provider integrations, and can expose render services to browsers or agents. Treat those boundaries as security-sensitive.

## Supported version

| Version | Security support |
| --- | --- |
| 2.x | Supported |
| 1.x | Upgrade recommended |
| Unreleased development branches | Best effort only |

## Reporting a vulnerability

Please report suspected vulnerabilities privately to the maintainers rather than opening a public issue. Include:

- affected package/version;
- reproduction steps or proof of concept;
- expected vs actual behavior;
- security impact;
- any known mitigation.

Do not include secrets, customer media or credentials in issue trackers, test fixtures or public logs.

## Security model

### Process execution

Vexa launches FFmpeg/ffprobe using explicit argument arrays. Public APIs should not concatenate untrusted input into shell commands. New execution backends must preserve that rule.

### Browser/server separation

Browser packages must not import Node execution code. Browsers should communicate with a controlled render service through explicit transport contracts. Never expose arbitrary command execution as a browser convenience API.

### Remote media

The Node storage/media resolver is intentionally conservative. Remote HTTP workflows should preserve HTTPS-only defaults, credential restrictions, redirect revalidation, size limits and public-network protections unless an application explicitly provides a trusted adapter with its own policy.

Applications handling untrusted URLs should also apply infrastructure-level egress controls.

### Filesystem paths

Render services should isolate workspaces, reject path traversal, avoid writing outside managed roots and ensure cleanup occurs on success, cancellation and failure.

### Plugins

Plugins execute inside the Node host and therefore inherit host privileges. Only load trusted plugin packages. Plugin metadata is not a sandbox. Plugins must use explicit registration points and must not silently bypass validation, planning or security rules.

### AI providers

`@vexa-video/ai` is provider-neutral. Provider credentials and vendor SDKs belong to application-owned adapters. Do not place provider secrets in browser bundles or serialized composition/project data.

### Agent and MCP surfaces

Agent-facing tools should expose typed Vexa operations, not raw shell/media commands. Validate all tool input and preserve existing renderer/hosted-render error boundaries.

### Hosted rendering

Hosted adapters own authentication, tenant isolation, quota enforcement and vendor-specific infrastructure. Treat idempotency keys, artifact destinations and callback/event inputs as untrusted tenant data.

## Supply-chain controls

The protected npm release path uses GitHub Actions OIDC trusted publishing with provenance. Release automation rejects legacy npm token variables in the protected publish environment and validates packed consumer installs before publication.

Maintainers should not bypass the protected workflow with local `npm publish` for normal releases.

## Deployment recommendations

For an internet-facing render service:

1. authenticate and authorize every render/upload endpoint;
2. apply request/body/media size limits;
3. isolate workspaces and service accounts;
4. restrict outbound network access where possible;
5. rate-limit expensive operations;
6. validate media destinations and signed URLs;
7. collect structured audit/operational logs without leaking secrets;
8. keep FFmpeg, Node.js and Vexa dependencies patched;
9. use explicit retention/deletion policies for customer media.

Version 3 production-hardening work expands worker recovery, retention, telemetry, scheduling and tenant-aware controls; those planned features should not be assumed to exist in 2.0.0.
