# Contributing to GymCoach

Thanks for your interest in improving GymCoach. This guide covers the local
setup and the checks your changes should pass.

## Development setup

See the README for the full quick start. In short:

```bash
cp .env.example .env
npm install
docker compose up -d db
npm run db:migrate
npm run db:seed
npm run dev
```

## Project conventions

- TypeScript strict, no `any` where it can be avoided.
- Validate every API input with Zod.
- Prefer the existing Shadcn UI primitives in `components/ui`.
- The codebase is English-only (UI, comments, prompts, docs).
- Do not use em-dashes or en-dashes; use a regular hyphen.
- Conventional Commits for messages (`feat:`, `fix:`, `chore:`, ...).

## Tests

The project uses a three-tier test setup. Please add or update tests with your
change.

```bash
npm run test              # unit + component (Vitest, jsdom)
npm run test:coverage     # with coverage

# Recommended integration + E2E workflow. This owns and cleans the isolated
# gymcoach-test database and its E2E server even when a test fails:
bash scripts/verify.sh --full
```

On Windows, invoke that script through Git Bash:

```powershell
& 'D:\Program Files\Git\bin\bash.exe' scripts/verify.sh --full
```

Docker is available through WSL on the GymCoach Home PC. If manual database
diagnostics are required, use the explicit test project on both startup and
cleanup:

```powershell
wsl.exe --cd (Get-Location).Path docker compose --project-name gymcoach-test --file docker-compose.test.yml up -d --wait test-db
$env:DATABASE_URL = 'postgresql://gymcoach_test:gymcoach_test@localhost:5434/gymcoach_test'
npx prisma migrate deploy
npx vitest run --config vitest.integration.config.ts
wsl.exe --cd (Get-Location).Path docker compose --project-name gymcoach-test --file docker-compose.test.yml down --volumes
Remove-Item Env:DATABASE_URL
```

Setting `DATABASE_URL` in PowerShell is the supported fallback when an npm
script contains POSIX inline environment syntax. Never use an unscoped Compose
cleanup or append `--remove-orphans`: the canonical `gymcoach` project shares
the Docker daemon and must remain untouched.

CI runs lint, typecheck, unit, integration, build and E2E on every pull
request (see `.github/workflows/ci.yml`).

## Before opening a pull request

```bash
npm run lint
npm run typecheck
npm run test
npm run build
```

Keep pull requests focused and describe the change and how you tested it.
