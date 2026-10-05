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
pnpm hooks:install
pnpm ci:local --mode quick
pnpm ci:local --mode full
pnpm push:test
```

Use quick for everyday type, lint and offline business checks. Test push verifies the clean, exact outgoing commit with full checks selected from the remote Test SHA captured before pushing; missing or unsafe baselines expand to full verification. Local full also runs dependency audit, relevant deployment/hook tests and a real Docker build when required. The temporary source copy excludes business dotenv files and Git credentials. No real model or management API is called by these checks.

Cloud Verify for main PRs and merge queues builds the actual candidate Docker image without publishing. Ordinary branch pushes do not start Actions. Test publication is manual and builds AMD64 once. Stable release tags build AMD64 and ARM64 independently on native runners, assemble and verify their immutable manifest, then retain the Online Environment approval boundary. Docker owns the production build; cloud CI does not repeat the host Next build or business tests. Versions are owned by the manifest and lockfile.

Build, publication, local health and real Access/management/model acceptance are separate outcomes. Default-branch registration and protected merge still require the actual PR build check; local results do not register a workflow or prove remote deployment. See [deploy/README.md](deploy/README.md) for branch-specific installation and recovery limits.
