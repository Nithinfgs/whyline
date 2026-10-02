# Contributing

Thanks for looking. whyline is small on purpose: plain ES modules, no runtime dependencies, no build step.

## Setup

```bash
git clone https://github.com/Nithinfgs/whyline && cd whyline
npm install
npm run check   # eslint + tsc + tests; this is what CI runs
```

Types are JSDoc checked by `tsc --strict`; please keep new code annotated.

## The most useful contributions

1. **Transcripts that fail.** If a line is attributed wrongly, or should be traced and isn't, open an issue with a minimal reproduction. A synthetic repo built like `src/demo.js` is ideal. **Never attach real transcripts without removing secrets and private prompts.**
2. **Adapters for other agents.** `src/transcripts.js` turns a session file into `{ prompts, events }`. A new adapter returns the same shape for Codex CLI, Gemini CLI, Cursor, etc.; the matcher doesn't care where events come from. Open an issue first so we agree on format detection.
3. **Matching accuracy.** Changes to `src/match.js` should come with a test that shows the failure they fix and one that shows they don't regress the rest.

## Pull requests

- Keep them focused; one behaviour change per PR.
- Add or update tests. Tests build throwaway git repos and synthetic transcripts, so they need only git and Node.
- Run `npm run check`. If output formatting changes, run `npm run render-demo` and commit the new `docs/assets/demo.svg`.
- Commit messages follow `type: summary` (`feat`, `fix`, `docs`, `test`, `ci`, `chore`).

## Conduct

Be kind and assume good faith. See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
