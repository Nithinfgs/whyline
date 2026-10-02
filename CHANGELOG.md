# Changelog

## 0.1.0

First release.

- `whyline <file>`: provenance map of a whole file, one letter per agent session
- `whyline <file>:<line>[-<line>]`: prompt, agent note, time and confidence for a line or range
- Reads Claude Code transcripts; finds sessions for the repo, its worktrees and parent-directory launches
- Edit replay that credits a line only to the edit that introduced it
- `--json`, `--summary`, `--transcripts`, `--no-color`
- `--demo`: generates a throwaway repo with synthetic transcripts
- Best-effort secret redaction in printed prompts
