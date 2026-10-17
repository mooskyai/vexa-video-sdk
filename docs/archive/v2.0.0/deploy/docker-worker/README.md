# Docker render worker

Build and run the containerized REST render worker:

```bash
docker compose -f deploy/docker-worker/compose.yaml up --build
```

Health: `http://127.0.0.1:4190/health`.

The image includes Node.js 24 and FFmpeg and runs the same local `JobQueue`-based REST template used outside Docker. Mount `/var/lib/vexa` to control artifact retention. For multi-node deployments, replace the local queue with Vexa's distributed job transport while keeping the HTTP/media contract.
