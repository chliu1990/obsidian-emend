# Stage 16: Add opt-in operation-based editing

## Goal

Add an explicitly selected operation-based editing strategy alongside the default CriticMarkup document strategy. Accept only a closed JSON union of insert, remove, replace, and comment commands resolved against the original captured source, compile valid operations into CriticMarkup, and reuse the existing Stage 07 validation and guarded full-note/selection write paths.

## Plan

1. Write test-first protocol, range, occurrence, ambiguity, overlap, stable-order, markup-injection, settings, prompt, full-note, and selection coverage. Verify the initial red run before adding production code.
2. Implement an operation strategy and factory behind the existing `EditStrategy` boundary. Keep `critic-markup` as the normalized default and add an **Edit strategy** dropdown for explicit opt-in.
3. Require a bare JSON array and exact operation fields. Resolve all anchors and targets against the untouched snapshot, reject ambiguity and overlap atomically, and compile accepted ranges from highest to lowest original offset.
4. Pass compiled markup through `prepareCriticMarkupEdit` and the unchanged stale-source, active-target, abort, permission, and single-write guards. Use only the captured selection as the original for selection operations.
5. Run focused and full gates plus real Obsidian/Track Changes comparisons using an isolated vault, loopback SSE mock, and dummy credentials. Update documentation, self-review, commit and push, verify the dedicated Gitea runner, then record CI evidence separately.

## Implementation details

- `src/types.ts` defines `EditStrategyId` and the closed `EditOperation` union. `src/settings.ts` normalizes `editStrategy` to `critic-markup` unless the persisted value is explicitly `operations`, and exposes the **Edit strategy** dropdown.
- `src/edit-strategy.ts` retains the existing CriticMarkup strategy and adds `getEditStrategy()` for normalized settings. `src/main.ts` selects the strategy only when constructing full-note or selection edit coordinators; read-only coordinators are unchanged.
- `src/operation-edit-strategy.ts` accepts only a bare JSON array. Each operation must be a plain object with exactly the declared fields for its `type`; unknown commands, fields, malformed JSON, prose, and code fences are rejected. An empty array is a no-op.
- Anchors and targets must be nonempty exact source strings. Insert text, replacements, and comments must also be nonempty. Every operation input rejects all CriticMarkup opener, closer, and substitution delimiters so compiled output cannot inject nested markup.
- Every match is found in the original snapshot. Without `occurrence`, exactly one match is required. A supplied occurrence must be a one-based positive integer in range. Selection preparation receives exactly `snapshot.selectedText`, so outside text cannot be addressed.
- All operations validate before compilation. Remove, replace, and comment target ranges may not overlap. Insertions are rejected when their anchor overlaps a changed target or their position falls at or inside one. Disjoint ranges are applied from highest to lowest offset; same-position insertions retain request order in the compiled output.
- Insert compiles to `{++text++}` beside an unchanged anchor, remove to `{--target--}`, replace to `{~~target~>replacement~~}`, and comment to unchanged target followed by `{>>comment<<}`. `prepareCriticMarkupEdit` revalidates the complete result, including prior Track Changes markup and comment-only zero-text-change behavior.
- Full-note and selection prompts describe only the closed JSON protocol, forbid rewritten documents, and preserve skills-before-AGENTS instruction ordering. No dependency, provider transport, read-only behavior, or write guard changed.

## Verification results

- Focused RED: `npx vitest run tests/operation-edit-strategy.test.ts tests/settings.test.ts` failed because the operation module did not exist and nine setting assertions lacked `editStrategy`. Focused GREEN subsequently passed 156 tests across operation, settings, full-note coordinator, and selection coordinator suites.
- The first green run exposed reversed same-position insertions; backward application ordering was corrected. A test-first self-review regression then proved a spanning insertion anchor could overlap a changed target without rejection. The new case failed before anchor/target overlap validation was added and passed afterward.
- Final focused operation suite: 78 tests passed. Final full local gate: `npm test` passed 19 files and 396 tests; `npm run lint` passed with no findings; `npm run build` passed strict TypeScript checking and production bundling; `git diff --check` passed.
- Real verification used the production bundle in ignored `test_vault/stage16_vault`, isolated profile `.emend-test-profile-16`, the bundled Obsidian 1.14.5 profile, CDP port 9231, Track Changes, and a CORS-enabled loopback SSE mock on port 8796 with dummy credentials. No real/paid provider call or other vault was used, and both isolated processes were stopped afterward.
- Thirteen actual plugin submissions exercised both strategies. CriticMarkup and operations produced byte-equivalent insertion `Alpha{++ inserted++} beta gamma.`, removal `Alpha {--beta--} gamma.`, replacement `Alpha {~~beta~>delta~~} gamma.`, comment `Alpha beta{>>Review this.<<} gamma.`, and second-occurrence removal `same {--same--} same.` results. Comment-only operations applied with `changeCount: 0`.
- The real Track Changes panel rendered equivalent cards for all five pairs: `INSERT inserted`, `DELETE beta`, `REPLACE beta → delta`, one `Review this.` comment with zero suggestions, and `DELETE same`. Same-leaf panel content was explicitly rebuilt between fixtures to avoid stale titles/content.
- Ambiguous repeated `beta` rejected with `Operation 1 anchor or target is ambiguous; specify occurrence.` Overlapping replace/remove operations rejected with `Operation target ranges overlap.` An operation targeting `Alpha` outside selected `beta` rejected with `Operation 1 anchor or target was not found in the original snapshot.` All three source files remained byte-for-byte unchanged and displayed `0 comments · 0 suggestions` with no cards.
- Mock logs confirmed five full-note CriticMarkup prompts and eight operation prompts, including the selection prompt. `node test_vault/verify-stage16.mjs` passed 13 request checks, 13 exact resulting-Markdown checks, five equivalent Track Changes pairs, and all three invalid/no-write checks. Scripts, fixtures, logs, profiles, copied bundles, and dummy settings are all ignored under `test_vault/`.
- Self-review confirmed atomic validation, original-snapshot ranges, deterministic ordering, Stage 07 revalidation, unchanged read-only and guarded writer behavior, default CriticMarkup normalization, and no generated bundle, vault content, mock log, local profile, credential, or dependency in git.
- Implementation CI evidence is recorded in the following documentation-only evidence commit.
