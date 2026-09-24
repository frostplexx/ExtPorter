# LLM-assisted MV2 → MV3 migration & verification

Two scripts plus a nix dev shell:

| file | purpose |
|------|---------|
| `download_broken_extensions.py` | pull failed MV3 migrations (by `ids` or random) from the DB via SSH/SCP |
| `migrate_extensions.py` | drive Claude Code to fix each MV3 migration in tmux, then verify it side-by-side in Chrome |
| `flake.nix` | dev shell providing `tmux`, `python3` (+ `pymongo`), `node` |

## 1. Set up the environment

```sh
nix develop          # provides tmux + python + pymongo
```

## 2. Download the extensions to fix

By default this reads `./ids` and pulls each listed extension from the remote
server into `./downloaded_extensions/`:

```sh
python download_broken_extensions.py
```

This yields `downloaded_extensions/<ext_id>/mv2/` (original) and
`downloaded_extensions/<ext_id>/mv3/` (the broken automated migration) — the
layout `migrate_extensions.py` expects. Defaults (override as needed):
`--ids-file ./ids`, `--ssh-host $EXT_SSH_HOST`,
`--ssh-port 54321`, directories (not `--compress`), both MV2 + MV3.

Each extension is streamed as a single gzipped tar over SSH (much faster than
per-file `scp` for these many-small-file extensions), `-j/--jobs` of them at a
time (default 6). The download is **resumable**: already-complete extensions are
skipped and partial ones re-fetched, so you can just re-run it after an
interruption. Use `--force` to re-download everything.

If you used the LMU path layout, pass both prefix maps (repeatable `--path-map`):

```sh
python download_broken_extensions.py \
  --path-map "/app/extensions:/home/<data-owner>/experiment/CODE" \
  --path-map "/app/output:/home/<user>/migrated_extensions"
```

## 3. Run the migration + verification harness

```sh
python migrate_extensions.py            # or: --ext-dir <dir>  --redo
```

A tmux session opens with this choreography:

```
 ┌───────────────┬───────────────┐
 │ Claude Code   │ Claude Code   │   right-top: the just-finished migration
 │ migrating     │ (ext N, kept  │              (stays open for follow-ups)
 │ ext N+1       │  alive)       │
 │ (LEFT)        ├───────────────┤
 │               │ controls pane │   p / f / s + notes
 └───────────────┴───────────────┘
   + Chrome 130 (mv2) and Chrome 141 (mv3) windows for ext N
```

1. The **left** pane runs Claude Code (`--dangerously-skip-permissions`) on the
   next extension with a standardized migration prompt.
2. When Claude finishes its first turn (detected via a `Stop` hook), that pane
   **moves to the right** and stays alive for follow-up prompts. Chrome 130
   (original `mv2/`) and Chrome 141 (migrated `mv3/`) open side-by-side, and a
   small **controls pane** appears.
3. Meanwhile the **left** pane immediately starts migrating the next extension.
4. Record `p`/`f`/`s` (+ optional notes) in the controls pane. The Chrome
   windows and controls pane then close.
5. The next finished migration only moves right **after** you record a verdict —
   if you're still testing, the pipeline waits. When a tested session is
   retired, its transcript is exported to `transcripts/<ext_id>.jsonl`.

Detach any time with `prefix + d` (results are saved after each verdict).

## Outputs

- `migration_results.json` — `{ext_id: {name, status, notes, tested_at}}`
- `transcripts/<ext_id>.jsonl` — full Claude Code session transcript per extension
- `.migrate_run/` — ephemeral launchers, sentinels, `orchestrator.log`

## Notes / assumptions

- Chrome-for-Testing builds are reused from `../google_manifest_converter/chrome`
  (Chrome 130 for MV2, Chrome 141 for MV3). Adjust `CHROME_130` / `CHROME_141`
  in `migrate_extensions.py` if they live elsewhere.
- The standardized migration prompt is the `MIGRATION_PROMPT` constant — edit it
  there.
- Already-recorded extensions are skipped unless you pass `--redo`.
- Claude is launched with its working directory set to the extension's `mv3/`
  folder and edits it in place; the original `mv2/` stays untouched and is loaded
  in Chrome 130 for side-by-side comparison.
