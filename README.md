# Memoia Inspector

Memoia Inspector is a fork of [Memobase Inspector](https://github.com/memodb-io/memobase-inspector). It keeps the upstream project-switching UI, user/profile/event management, and chat Playground. The original Memobase TypeScript SDK and HTTP contract remain in use; this fork does not replace the SDK.

The source is MIT-licensed; see [LICENSE](LICENSE). Memoia server itself is a separate Apache-2.0 project. Deployment of this admin UI should be protected by an access layer: the project token entered in the UI is still required to access a Memoia project, but is not a substitute for authenticating the human administrator.

## Development

Use Node.js 24 LTS and pnpm 10.12.4:

```bash
pnpm install --frozen-lockfile
pnpm dev
```

The container image is built for the domain root path and same-origin API calls. An alternate Next.js `basePath` is a **build-time** choice and needs a different image; changing a server `.env` does not alter an already-built image.

The optional Playground calls a model independently of Memoia. Admin features do not require its `OPENAI_API_KEY`, `OPENAI_BASE_URL`, or `OPENAI_MODEL`; without a configured model, the Playground remains visible but its chat and test-user operations are not started. If enabled before first deployment, store its settings in the Inspector repository's GitHub `test` Environment; Actions installs a protected runtime copy on the host. Later changes require separate maintenance. Set the Memoia project origin and Bearer token through the Inspector settings page. Existing upstream Cloudflare Worker commands are retained for compatibility, but the deployment below uses Docker; do not run the upstream `wrangler.jsonc` against its original route.

## Tests and deployment

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
pnpm audit --prod --audit-level high --registry=https://registry.npmjs.org
docker run --rm --network none -v "$PWD:/work:ro" -w /work python:3.12-slim-bookworm@sha256:392307d22300de8b5986851a12d9176dfc0fc073e65bf6523ebd7dcbeb23564e bash tests/deploy-inspector.test.sh
```

The test-server installation, GitHub Actions setup, Cloudflare Access boundary, and recovery procedure are in [deploy/README.md](deploy/README.md). The public image is built by Actions from the `test` branch and is deployed by manifest digest; the VPS never builds source code.
