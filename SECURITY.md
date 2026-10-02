# Security policy

## Scope

whyline runs locally, reads files on your machine (git history and Claude Code transcripts) and makes no network requests. The realistic risks are:

- **Leaking sensitive prompt text** in output you then share. Output is passed through a best-effort secret redactor (`src/redact.js`), which is not a guarantee.
- **Unsafe handling of crafted input**: a malicious transcript or repository causing code execution, path traversal outside the repo, or a crash/hang. Transcripts are parsed as data only; git is invoked with fixed arguments and no shell.

## Reporting

Please use [GitHub private vulnerability reporting](https://github.com/Nithinfgs/whyline/security/advisories/new) rather than a public issue. Include a minimal reproduction and the version (`whyline --version`). You can expect an initial reply within a week.

## Supported versions

Only the latest release receives fixes while the project is pre-1.0.
