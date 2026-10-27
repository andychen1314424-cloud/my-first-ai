# Working on ZX Ai

- Keep this a single-user, local-first learning tool. Cloud providers, external sending, automatic command execution and deployment require explicit user scope.
- Use Node.js 24.x, React and TypeScript. The server runs erasable TypeScript directly; use `import type` and `.ts` extensions. Do not add unnecessary infrastructure.
- Keep domain types, input validation, output schema and prompt template in `shared/domain.ts`. Validate model output before saving.
- Keep the Ollama boundary in `server/ollama.ts`. Do not disguise fixture data or canned examples as AI output. Tests may use the explicitly named protocol fixture in `tests/helpers.ts`.
- Bind the app to `127.0.0.1`. Preserve Host/Origin checks and local-model restrictions.
- The user approved free local DeepSeek and Kimi chat on 2026-10-26. The chat-only allowlist in `shared/chat.ts` may include Qwen3 1.7B/4B/8B, DeepSeek R1 1.5B/8B distilled models and the explicitly named Kimi Linear 48B-A3B community GGUF. Keep the original project Lab Qwen allowlist unchanged. Never use `:cloud`, remote Ollama models, paid APIs or automatic cloud fallback. Distinguish model download, installation and successful inference in status and delivery reports.
- Keep `.data/`, databases, model weights, `.env*`, secrets and personal test inputs out of Git. Public examples must be generic.
- Update the README and `docs/ROADMAP.md` when behavior changes. Preserve the distinction between implemented code, automated verification and real-device validation.
- Before completing meaningful changes, run `npm run check`. For UI or workflow changes also run `npm run test:e2e` after building. Verify narrow and desktop widths.
- Keep feature work on a separate branch and make it reviewable with a pull request. Do not merge as part of routine implementation.
