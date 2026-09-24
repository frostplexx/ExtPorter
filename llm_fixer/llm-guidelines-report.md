# LLM Guidelines Assessment

**Paper:** *(no draft provided — this report is generated from project artifacts)*
**Supplementary material:** `migrate_extensions.py`, `downloaded_extensions/manifest.json`, `migration_results.json`, `transcripts/*.jsonl`, `.migrate_run/`
**Identified study type(s):** LLMs for New Software Engineering Tools; partially Studying LLM Usage in Software Engineering
**Skill version:** 2026.06_rev10

> This report applies the community LLM reporting guidelines from
> <https://llm-guidelines.org> as a self-check for authors. It is not a
> rejection rubric; missing items are reporting gaps to consider, not
> grounds for rejection.

## Summary

The project uses Claude Code (an agentic LLM-based coding tool, model `claude-sonnet-4-6`) to automatically fix broken Chrome Manifest V3 (MV3) extensions and validates results through human side-by-side inspection. The LLM role, model version, and prompt are all clearly recoverable from the code. Three session transcripts are available as supplementary material. The main gaps for a paper are: (1) no model configuration parameters (temperature, seed) are reported or logged; (2) the open-LLM baseline is absent; (3) human-validation details (construct definition, rater description, inter-rater agreement procedure) are not yet documented; (4) limitations around non-determinism, commercial-model reproducibility, and data leakage need to be addressed.

## Supplementary material availability

- **User-supplied paths:** `migrate_extensions.py`, `migration_results.json`, `transcripts/`, `.migrate_run/`, `downloaded_extensions/manifest.json`
- **Links found in the paper:** No paper draft was provided; no links were found in the project's `README.md`.
- **Unanchored release claims:** The `README.md` does not make any open-release claims.
- **Coverage:** The project contains the following supplementary artifacts (all read directly):
  - Orchestration harness and prompt: `migrate_extensions.py` — `MIGRATION_PROMPT` constant at line 84; Claude Code settings template at lines 333–339; tool-invocation launcher pattern at lines 343–351.
  - Session transcripts (3 of 5 tested extensions): `transcripts/ehhoppehlpohjjbflmffjpoblnfhikbi.jsonl` (102 lines), `transcripts/dfabnoahjnbkpfpadnngfiamnmombjmc.jsonl` (82 lines), `transcripts/cboiihjkpoglonpcokofnogklldjanog.jsonl` (67 lines). The session for `gnapooibnagamngemlkkjmjfkmgbdmcl` was not exported to `transcripts/`.
  - Dataset manifest: `downloaded_extensions/manifest.json` — 175 extensions, downloaded 2026-06-17T17:25, selected by interestingness score.
  - Results: `migration_results.json` — 5 tested as of 2026-06-17, all `pass`.

---

## Per-guideline findings

### Declare LLM Usage and Role

- Status: partial
- Evidence:
  1. `migrate_extensions.py:84` — `MIGRATION_PROMPT = """You are an expert Chrome extension developer specializing in fixing broken extensions after migration from Manifest V2 to Manifest V3. You are currently in the directory of the broken Manifest V3 extension that has been migrated from Manifest V2. Analyze the extension files and their code to identify and fix issues causing the extension to not work in Google Chrome 140. Do not ask questions."""`
  2. `migrate_extensions.py:8` (module docstring) — `"LLM-assisted MV2 -> MV3 migration & verification harness."` and `"LEFT pane:  Claude Code is launched (with --dangerously-skip-permissions) on extension N and asked, via a standardized prompt, to fix its broken MV3 migration."`
  3. `README.md:lines 1–5` — `"# LLM-assisted MV2 → MV3 migration & verification"` with table describing `migrate_extensions.py` as `"drive Claude Code to fix each MV3 migration in tmux, then verify it side-by-side in Chrome"`.
- Gaps:
  - The paper must declare that Claude Code (an agentic LLM-based tool) was used to autonomously fix MV3 extensions, specifying which LLM (`claude-sonnet-4-6`), how it was used (as an autonomous coding agent with file read/write/edit and shell access), and where in the research process (the migration repair step). The current project code supports this but no paper section exists yet.
  - When the LLM is used in multiple roles (e.g., as a migration tool and potentially as a judge or annotator in any automated evaluation), each role should be declared separately.
- Pointers: [references/guidelines/declare-usage.md](references/guidelines/declare-usage.md)

---

### Report Model Version, Configuration, and Customizations

- Status: partial
- Evidence:
  1. `transcripts/ehhoppehlpohjjbflmffjpoblnfhikbi.jsonl` — assistant messages contain `"model": "claude-sonnet-4-6"` in every API response object.
  2. `transcripts/ehhoppehlpohjjbflmffjpoblnfhikbi.jsonl` — user message contains `"version": "2.1.179"` (Claude Code CLI version) and `"permissionMode": "bypassPermissions"`.
  3. `migrate_extensions.py:346` — `f"exec '{CLAUDE}' --dangerously-skip-permissions --session-id {session_id} --settings '{settings}' -- \"$(cat '{prompt_file}')\""`
- Gaps:
  - The paper must report: (1) the exact model name and version (`claude-sonnet-4-6`, accessed via Claude Code CLI version 2.1.179); (2) the date of study execution (sessions ran 2026-06-17, recoverable from `migration_results.json` and transcript timestamps); (3) any configured parameters affecting output generation. No temperature, top\_p, or seed values are set or logged in the settings files — these are Claude Code defaults. The paper should acknowledge that Claude Code's default decoding parameters were used and that these defaults may change across releases.
  - The paper should report the system fingerprint or any request IDs recoverable from transcripts to support drift monitoring. The `transcripts/*.jsonl` contain per-message `requestId` fields (`transcripts/ehhoppehlpohjjbflmffjpoblnfhikbi.jsonl` assistant entries) but no system fingerprint is logged.
  - No checksums or fingerprints for the model are available (proprietary commercial API). The paper should openly acknowledge this as a reproducibility limitation.
- Pointers: [references/guidelines/model-version.md](references/guidelines/model-version.md)

---

### Report System and Prompt Design

- Status: partial
- Evidence:
  1. `migrate_extensions.py:84` — The complete standardized prompt (`MIGRATION_PROMPT`) is defined as a Python constant and can be published verbatim.
  2. `migrate_extensions.py:333–339` — Settings template: `{"hooks": {"Stop": [{"hooks": [{"type": "command", "command": "touch '<sentinel>'"}]}]}}` — only a Stop hook is configured; no context files, skills, subagents, or MCP servers are used.
  3. `migrate_extensions.py:9–31` — System architecture described: Claude Code launched via CLI with `--dangerously-skip-permissions`, working directory set to the extension's `mv3/` folder, tools available are the default Claude Code tools (Read, Write, Edit, Bash — confirmed from transcript tool-use entries in `transcripts/ehhoppehlpohjjbflmffjpoblnfhikbi.jsonl`).
- Gaps:
  - The paper must describe the full tool architecture: Claude Code as a standalone agentic system invoked via CLI, with the working directory set to the broken MV3 extension, given a single zero-shot prompt, and allowed to call any default Claude Code tool (Read, Write, Edit, Bash). It must state explicitly that zero-shot prompting was used and that the same prompt was reused across all extensions without modification.
  - The paper must publish all prompts as supplementary material. The `MIGRATION_PROMPT` (`migrate_extensions.py:84`) is the only prompt; it should be included verbatim. Since it is a single static prompt (no template variables), no additional instantiation examples are needed.
  - The paper must summarize which tools were exposed to the model. From transcripts, Claude Code's default tools (`Read`, `Write`, `Edit`, `Bash`) were used. The paper should state this explicitly and note that no MCP servers were configured.
  - The paper must describe the agentic system: single-agent, no subagents, no retrieval-augmented generation, no context files, no skills — `migrate_extensions.py:333–339` confirms only a Stop hook was active.
  - The paper should describe how the model was hosted and accessed (Anthropic API via Claude Code CLI) and the prompt development rationale (why zero-shot; why "Do not ask questions" was included).
  - Non-disclosed proprietary components (Claude Code's internal system prompt, exact tool schema wording) must be acknowledged as reproducibility limitations.
- Pointers: [references/guidelines/design.md](references/guidelines/design.md)

---

### Report Session Traces

- Status: partial
- Evidence:
  1. `transcripts/ehhoppehlpohjjbflmffjpoblnfhikbi.jsonl` — Full Claude Code session transcript in JSONL format; 102 lines covering the complete session (2026-06-17T18:42:50Z to 18:46:23Z), including user message, 34 assistant turns, tool-use calls (Read, Write, Edit, Bash), and system events.
  2. `transcripts/ehhoppehlpohjjbflmffjpoblnfhikbi.jsonl` — The format is Claude Code's native JSONL session transcript format (file format: one JSON object per line; tool version: Claude Code CLI 2.1.179).
  3. `migrate_extensions.py:431–442` — Transcript export logic: sessions are copied from `~/.claude/projects/*/<session_id>.jsonl` to `transcripts/<ext_id>.jsonl` after each tested extension.
- Gaps:
  - The paper must describe the trace file format (Claude Code native JSONL session transcript) and report the tool version (Claude Code 2.1.179) as required when tool-native trace formats are used.
  - The paper should publish all available interaction logs (prompts and responses) as supplementary material. Three of five transcripts are available (`transcripts/*.jsonl`). The transcript for `gnapooibnagamngemlkkjmjfkmgbdmcl` was not exported (no matching file found in `transcripts/`) — this gap should be noted.
  - The paper should use or reference an open trace format (e.g., OpenTelemetry GenAI semantic conventions or OpenInference) or explicitly state why Claude Code's native format was used instead.
  - Runtime trace entries (tool calls, arguments, results) are embedded in the JSONL transcripts and should be described in the paper. The paper should explain that tool calls and their results are interleaved with assistant messages in the transcript format.
  - No agentic plans were produced (Claude Code's plan feature was not used in this setup), so plan reporting is not applicable.
- Pointers: [references/guidelines/traces.md](references/guidelines/traces.md)

---

### Use Suitable Baselines, Benchmarks, and Metrics

- Status: partial
- Evidence:
  1. `migration_results.json` — Metric used is human pass/fail/skip verdict per extension, stored as `"status": "pass"|"fail"|"skip"`. As of 2026-06-17, 5/5 tested extensions received `"pass"`.
  2. `migrate_extensions.py:228–237` — Verdict collection: human evaluator chooses `[p] pass [f] fail [s] skip` after visual side-by-side comparison of the extension in Chrome 130 (MV2) and Chrome 141 (MV3).
  3. `downloaded_extensions/manifest.json` — Extensions selected by `interestingness_score` field; scores range from 25 to 39,797 for the 175-extension dataset.
- Gaps:
  - The paper must justify the choice of metric (human pass/fail as the correctness criterion) and explain what "pass" means operationally — does it require all extension features to work identically to MV2, or only core functionality? This construct definition is currently implicit.
  - The paper must discuss the reliability and validity of the metric. A binary pass/fail judgment by a single human evaluator is subjective; the paper should discuss construct validity (does "visually works in Chrome" capture all correctness dimensions?) and reliability (single judge, no inter-rater agreement).
  - The paper should describe and justify the sampling strategy used (extensions selected by `interestingness_score` from the database). The `manifest.json` does not explain what `interestingness_score` measures or how the top 175 were chosen.
  - The paper should discuss non-probability sampling implications: results from 175 Chrome Web Store extensions may not generalize to all MV2→MV3 migration scenarios.
  - There is no traditional (non-LLM) baseline in the results. The paper should either include a non-LLM baseline comparison or discuss why none was included.
  - Only 5 of 175 extensions have been tested as of the date of this report. The paper should report on the full set or clarify the intended scope.
- Pointers: [references/guidelines/benchmarks-metrics.md](references/guidelines/benchmarks-metrics.md)

---

### Use an Open LLM as a Baseline

- Status: not found
- Evidence: A search for open-model alternatives across `migrate_extensions.py`, `download_broken_extensions.py`, `README.md`, and `migration_results.json` returned no hits. Only `claude-sonnet-4-6` (a proprietary commercial model accessed via Claude Code) is used.
- Gaps:
  - The paper should include an open LLM as a baseline when using commercial models. Candidate open-weight models deployable as coding agents include those accessible via Ollama or LM Studio (e.g., Qwen2.5-Coder, DeepSeek-Coder). Open-source agent frameworks such as OpenCode or Cline that expose their full system prompt and tool catalog could serve as transparent baselines.
  - If using an open-LLM baseline is not feasible (e.g., because Claude Code's agent loop and tool integration cannot be replicated with an open model at acceptable quality), the paper should justify this as a limitation.
  - The supplementary material should ensure the evaluation harness (`migrate_extensions.py`) is usable with open models where technically feasible.
- Pointers: [references/guidelines/open-llm.md](references/guidelines/open-llm.md)

---

### Use Human Validation for LLM Outputs

- Status: partial
- Evidence:
  1. `migrate_extensions.py:215–267` — Human validation is the sole evaluation method: a controls pane collects pass/fail/skip from the evaluator after visual inspection of both Chrome builds.
  2. `migrate_extensions.py:228–237` — `"Left Chrome 130 = original MV2"` and `"Right Chrome 141 = migrated MV3"` are shown to the evaluator. Verdict options are `p`/`f`/`s`; an optional free-text notes field is provided.
  3. `migration_results.json` — All 5 verdicts are `"pass"` with empty notes, recorded by a single evaluator on 2026-06-17.
- Gaps:
  - The paper must define the measured construct. What exactly does "pass" mean? Is it: the extension loads without errors, the popup renders correctly, all advertised features work, or something else? This definition is currently absent from the project.
  - The paper must describe the measurement instrument (the side-by-side Chrome comparison procedure, the verdict options, the controls pane). The instrument as implemented in `migrate_extensions.py:215–267` should be described and included as supplementary material.
  - There is only one human evaluator and no inter-rater reliability information. The paper should discuss this as a threat to construct validity and reliability.
  - The paper should consider and report whether annotation guidelines were given to the evaluator (currently none appear to exist beyond "Left Chrome 130 = original MV2 / Right Chrome 141 = migrated MV3").
  - The paper should assess and report how frequently the evaluator modified or followed up on Claude's proposals. The controls pane does not log follow-up prompts typed into the kept-alive Claude session.
- Pointers: [references/guidelines/human-validation.md](references/guidelines/human-validation.md)

---

### Report Limitations and Mitigations

- Status: not found
- Evidence: No limitations section exists in any project artifact. Searches across `README.md`, `migrate_extensions.py`, and `migration_results.json` returned no discussion of threats to validity, non-determinism, or reproducibility concerns.
- Gaps:
  - The paper must discuss the impact of LLM non-determinism. Claude Code sessions are not deterministic; rerunning the same prompt on the same extension may produce different fixes. No repeated runs or multiple-seed experiments are present in the current setup.
  - The paper must discuss generalizability: results are from 5 of 175 extensions tested on a single date (2026-06-17); the model (`claude-sonnet-4-6`) may behave differently across versions and over time.
  - The paper must discuss data leakage: Chrome extension source code is publicly available on the Chrome Web Store and may be present in the model's training data, potentially inflating apparent performance.
  - The paper must specify whether generalization across LLMs or time was assessed. Currently it was not — only one model on one date.
  - The paper must acknowledge non-disclosed proprietary components as reproducibility limitations: Claude Code's internal system prompt, exact tool schemas, and the agent loop logic are proprietary and cannot be published.
  - The paper must discuss data governance: the extensions are downloaded from a research server (`kuria.plai.ifi.lmu.de`) via SSH/SCP and contain publicly available Chrome Web Store extension code. Any privacy or licensing considerations for the downloaded extensions should be addressed.
  - The paper should justify LLM resource usage: each session uses significant tokens (e.g., `transcripts/ehhoppehlpohjjbflmffjpoblnfhikbi.jsonl` shows cache_read_input_tokens ≈ 1.4M for one session).
  - The paper should report mitigation strategies: the transcript export (`migrate_extensions.py:431–442`) provides a partial audit trail; the orchestrator log (`.migrate_run/orchestrator.log`) records session timing.
- Pointers: [references/guidelines/limitations.md](references/guidelines/limitations.md)

---

## Checklist gaps

The following items from the consolidated reporting checklist were not fully addressed in the per-guideline pass above:

**Introduction**

- **must** Disclose any use of LLMs in the empirical study, specifying which LLM, how, and where it was used. *(Currently in code only; needs a paper section.)*

**Research Design and Methods — Model Selection and Configuration**

- **must** Report default parameters and explain model and version choices. *(Default Claude Code parameters are used but not documented.)*
- **should** Report checksums and additional model properties where available; for commercial tools, openly acknowledge their reproducibility limits. *(No fingerprint or checksum available for `claude-sonnet-4-6` via Claude Code; must be acknowledged.)*
- **should** `[commercial-models]` Include an open LLM as a baseline when using commercial models and report inter-model agreement. *(No open baseline exists.)*

**Research Design and Methods — System and Prompt Design**

- **must** Specify whether zero-shot, one-shot, or few-shot prompting was used. *(Zero-shot; must be stated explicitly.)*
- **must** Specify prompt reuse across models and configurations. *(The same `MIGRATION_PROMPT` is reused across all extensions; must be stated.)*
- **must** `[tool-use]` Summarize in the *paper* which tools were exposed to the model. *(Read, Write, Edit, Bash — must be listed.)*
- **must** `[agents]` Specify agent roles, reasoning frameworks, and communication flows. *(Single-agent; no multi-agent; chain-of-thought style reasoning; no explicit framework.)*
- **must** `[agents]` Distinguish the model's reasoning and outputs, tool calls, and interactions with users. *(Transcripts contain all three; paper should describe how to interpret them.)*
- **should** Justify substantive architectural choices. *(Why Claude Code? Why zero-shot? Why `--dangerously-skip-permissions`?)*
- **should** Describe how the models were hosted and accessed. *(Anthropic API via Claude Code CLI.)*
- **should** Describe prompt development rationale and selection process. *(Why this prompt wording? How was it developed?)*
- **should** `[tool-use]` Include the tool catalog (names with purposes), tool schemas, and connected MCP servers as *supplementary material*. *(Tool catalog: Read, Write, Edit, Bash — default Claude Code tools. No MCP servers. Tool schemas are proprietary; this should be acknowledged.)*

**Research Design and Methods — Session Traces**

- **must** Where tool-native trace formats are used, describe the file format and report the tool version. *(Claude Code JSONL format; version 2.1.179.)*
- **should** Include full interaction logs as *supplementary material* if privacy can be ensured. *(3 of 5 transcripts available; one missing.)*

**Research Design and Methods — Benchmarks and Metrics**

- **must** Justify all benchmark and metric choices. *(Human pass/fail not yet justified in a paper.)*
- **must** Discuss reliability and validity, especially construct validity. *(Single-judge binary verdict; no formal reliability measure.)*
- **must** Explain why the selected metrics are suitable for the specific study. *(Not yet explained.)*
- **should** Repeat experiments due to non-determinism and report result distribution. *(No repeated runs; single-shot per extension.)*

**Research Design and Methods — Human Validation**

- **must** `[human-validation]` Define the measured construct and describe the measurement instrument. *(Not yet defined.)*
- **must** `[human-validation]` When developing measurement instruments, share them. *(The controls pane script is in `migrate_extensions.py:215–267`; should be published.)*

**Research Design and Methods — Reproducibility, Ethics, and Resources**

- **should** Justify LLM usage in light of its resource demands. *(High token counts per session; should be acknowledged.)*
- **should** Ensure the open-LLM baseline is independently reproducible from the *supplementary material*. *(No open baseline exists.)*

**Results**

- **should** Repeat experiments due to inherent non-determinism. *(Only one run per extension; this is a gap.)*
- **should** Use traditional (non-LLM) baselines for comparison where possible. *(No baseline; could compare against the unmodified automated migration tool or against a rule-based fixer.)*

**Limitations and Threats to Validity**

- **must** Discuss potential data leakage and its impact on results. *(Extension source code may be in training data.)*
- **must** Transparently report study limitations, including impact of non-determinism. *(Not yet present.)*
- **must** Specify whether generalization across LLMs or across time was assessed. *(Not assessed; must be stated.)*
- **should** Employ and report strategies to mitigate validity and reproducibility threats. *(Transcript export is a partial mitigation; should be highlighted.)*
