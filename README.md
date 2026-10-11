# forge-web

Owned by **platform-engineering**. Scaffolded by `forge create` from the
`nextjs` template (v1.3.1): a server-rendered
Next.js app with TypeScript and Tailwind CSS.

## Develop

```sh
npm ci
npm run dev        # http://localhost:3000
npm run lint && npm run typecheck && npm test
npm run build      # standalone server in .next/standalone
```

The image runs the standalone server (`node .next/standalone/server.js`); `npm start` (`next start`) warns with standalone output but still serves locally.

## Ship

CI tests every push. On `main` it pushes
`ghcr.io/showmino/forge-web:<short-sha>`, then a `deploy`
job deploys that commit to staging through Forge. It logs in with the job's
GitHub OIDC token, and needs the organization variable `FORGE_API_URL`.

- `forge deploy status forge-web`: what runs where.
- `forge deploy promote forge-web`: staging to production.
- `forge env create <name> --service forge-web --ref <branch>`: a
  preview with its own URL.

The server listens on `$PORT` (`run:` in `forge.yaml`). In Forge the root
filesystem is read-only, and Next's cache (`.next/cache`) is a link to the
writable `/tmp`.
