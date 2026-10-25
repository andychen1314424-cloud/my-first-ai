# Working on ZX Ai

- Keep this a single-user, local-first learning tool. Cloud providers, external sending, automatic command execution and deployment require explicit user scope.
- Use Node.js 24.x, React and TypeScript. The server runs erasable TypeScript directly; use `import type` and `.ts` extensions. Do not add unnecessary infrastructure.
- Keep domain types, input validation, output schema and prompt template in `shared/domain.ts`. Validate model output before saving.
- Keep the Ollama boundary in `server/ollama.ts`. Do not disguise fixture data or canned examples as AI output. Tests may use the explicitly named protocol fixture in `tests/helpers.ts`.
- Bind the app to `127.0.0.1`. Preserve Host/Origin checks and local-model restrictions.
- Keep `.data/`, databases, model weights, `.env*`, secrets and personal test inputs out of Git. Public examples must be generic.
- Update the README and `docs/ROADMAP.md` when behavior changes. Preserve the distinction between implemented code, automated verification and real-device validation.
- Before completing meaningful changes, run `npm run check`. For UI or workflow changes also run `npm run test:e2e` after building. Verify narrow and desktop widths.
- Keep feature work on a separate branch and make it reviewable with a pull request. Do not merge as part of routine implementation.
