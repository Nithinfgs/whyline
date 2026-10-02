# How whyline works

## Inputs

1. **Transcripts**: Claude Code writes one JSONL file per session under `~/.claude/projects/<encoded-project-path>/`. The directory name is the launch directory with every non-alphanumeric character replaced by `-`. Each line is a JSON entry; whyline reads:
   - `user` entries whose content is human text (not `tool_result`, not `isMeta`, not sidechain, with `<system-reminder>` and similar injected blocks stripped) → **prompts**
   - `assistant` entries: `text` blocks → the agent's note; `tool_use` blocks named `Edit`, `Write` or `MultiEdit` → **edit events**
   - everything else is ignored, and unparseable lines are skipped, so format drift degrades results instead of breaking the tool.
2. **git blame**: `git blame --line-porcelain` on the working-tree file gives the commit, author, author-time and summary for each line. Uncommitted lines are reported as such.

## Finding the right sessions

Sessions are included when their directory is the repo, a descendant of it (worktrees such as `.claude/worktrees/x`), or an *ancestor* of it (agent launched in a parent folder). The encoding maps `/` and `-` to the same character, so a sibling like `repo-other` also matches; that only costs parse time because edits are filtered by their real file path afterwards (`--transcripts` skips the filtering).

## Replaying edits

All edit events for the repo are sorted by timestamp (ties by order within the file) and replayed per file:

- The tool keeps the file's content as the transcripts know it. `Write` replaces it; `Edit` swaps `old_string` for `new_string` if the old text is present; otherwise whyline loses track (the file was changed outside the transcripts) and starts again from the next `Write`.
- For each event it computes which lines of the new text are **introduced**: a multiset difference against the old text (`Edit`) or the previously known content (`Write`). Unchanged context lines inside an edit are therefore never credited to it.

## Matching a line

For blamed line *i*, every event whose introduced lines contain the same (whitespace-trimmed) text is a candidate. Each candidate scores 1 + the number of identical neighbouring lines, up to two on each side (max 5). Candidates are ordered by:

1. whether the edit happened no later than the line's commit + 15 minutes (a commit cannot contain a later edit),
2. score,
3. recency.

Lines that are blank or only punctuation need a score of at least 3. Confidence:

| | |
| --- | --- |
| `high` | score ≥ 4, or ≥ 3 on a distinctive line (25+ characters), and no other session produced identical text |
| `medium` | score ≥ 2, or a distinctive single line, with no competing session |
| `low` | everything else, including edits that postdate the commit |

## Privacy

whyline only reads local files and runs `git`. It makes no network requests. Output passes through a best-effort redactor for well-known secret shapes (see `src/redact.js`); prompts can still contain sensitive prose, so check before pasting output into public places.
