# Stage 07: Validating CriticMarkup edit engine

## Goal

Add a pure, dependency-free CriticMarkup parser, reject-view renderer, validating edit preparation function, and strategy boundary without wiring note writes or changing chat, providers, vault access, or the dormant diff runtime.

## Plan

1. Specify parser behavior for all five CriticMarkup token types, multiline and adjacent tokens, exact source offsets and raw text, ordinary braces, malformed delimiters, nesting, and substitution separators.
2. Specify reject-view reconstruction and validation for exact original-content preservation, no-op responses, text-change counting, prose/code-fence/empty-output rejection, dropped content, malformed markup, whitespace changes, and altered YAML.
3. Specify sequential edits that preserve every original raw token as an ordered exact subsequence, allow new non-nested tokens outside old tokens, retain tracked changes through later edits, and count only newly introduced text changes.
4. Run the focused suite against missing modules for the expected red result, implement the pure engine and Stage 03-backed strategy, then run focused green tests and the full local gate.
5. Self-review the domain-only scope, commit and push the implementation, verify Gitea Actions on `emend-macos-docker`, and record implementation and documentation-evidence runs.

## Implementation details

- Added `src/critic-markup.ts` with `parseCriticMarkup()`, `toRejectView()`, and `prepareCriticMarkupEdit()`. Parsed tokens retain their type, exact raw source, inner content, and start/end offsets; substitutions additionally retain old and new text.
- The parser recognizes insertions, deletions, substitutions, comments, and highlights across line boundaries. It leaves ordinary braces untouched and rejects unmatched or mismatched delimiters, nested tokens, and substitutions without exactly one `~>` separator.
- Reject-view reconstruction removes insertions and comments, retains deletion and highlight content, retains the old side of substitutions, and copies ordinary text byte-for-byte. Prepared edits always retain the complete annotated response rather than stripping markup.
- Validation rejects empty responses, malformed original or response markup, any reject-view difference, and any missing, rewritten, or reordered original token. Original tokens must appear as an ordered exact-raw-token subsequence of response tokens, so old tracked changes survive sequential edits.
- Identical responses return zero changes. Otherwise, comments and previously existing tokens do not increment `changeCount`; newly introduced insertions, deletions, substitutions, and highlights do.
- Added `src/edit-strategy.ts` with the `EditPreparation` and `EditStrategy` contracts and `criticMarkupEditStrategy`. Its full-note and selection prompts delegate directly to Stage 03, and edit preparation delegates to the validating engine. Stage 16 can add another strategy behind the same interface without changing chat or transport.
- Added 57 focused tests in `tests/critic-markup.test.ts`. No runtime dependency, note writer, Obsidian API, vault access, provider networking, chat integration, or dormant-diff change was introduced.

## Verification results

- Focused red: `npx vitest run tests/critic-markup.test.ts` failed because `src/critic-markup.ts` did not exist; zero tests ran in the expected missing-feature state.
- Focused green: the same command passed all 57 tests after implementation. `npx tsc -noEmit -skipLibCheck` also passed.
- Full local gate: `npm test`, `npm run lint`, `npm run build`, and `git diff --check` passed. Vitest reports 8 files and 143 tests; lint has no findings, and the production build includes strict TypeScript checking. An intermediate lint run caught a deprecated Vitest type assertion, which was replaced before the successful complete rerun.
- Self-review: the change is limited to the requested engine, strategy boundary, focused tests, and this stage record. Validation requires both reject-view equality and exact original-token order, and returned Markdown is never stripped of annotations. No generated bundle, vault content, request log, credential, or secret is tracked. Manual Obsidian and real-provider testing are not applicable to this domain-only stage.
- Implementation commit `cf4afad074a72eae803a5facb4cb5f02ff7a86ef`: Gitea run 41 at http://127.0.0.1:19705/cliu/obsidian-emend/actions/runs/41 and job 53 at http://127.0.0.1:19705/cliu/obsidian-emend/actions/runs/41/jobs/53 completed with conclusion **success** on `emend-macos-docker`. Checkout, Node/npm verification, `npm ci`, lint, all 143 tests, and the production build succeeded.
