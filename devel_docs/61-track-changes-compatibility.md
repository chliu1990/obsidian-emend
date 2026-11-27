# Stage 61: Track Changes compatibility

## Current ownership and verdict

This is the current compatibility record for the separately installed Track Changes companion. It records PR 08 characterization, durable candidate fixtures, a local companion presentation implementation, and the final runtime matrix. It does not enable PR 09/10 behavior. `Refs #36`; the issue remains open.

Current public Emend behavior is unchanged: each table text Operation is confined to one existing cell. Row, column, delimiter, and cross-cell Operations remain fail-closed with `table-structure-edit`. The structural fixtures below are direct companion setup and candidate encodings for later design, not writer-enablement evidence. Track Changes remains the separate and only review surface; Emend has no diff/Apply/Reject UI, bundling, auto-install, or added structural review renderer.

The final selected-companion decision is deliberately split:

| Decision field | Final value | Meaning and boundary |
| --- | --- | --- |
| `companionVersion` | `2.3.0` | Manifest value of both the released baseline and the selected local branch. It does not identify a release containing the branch changes. |
| `companionCommit` | `2678dc03b5c84fe58a48b45c48b317e20d772e16` | Exact selected local, unmerged, unreleased companion HEAD. |
| `byteCompatible` | `true` | All 26 selected non-CRLF direct cases and six rejected-alternative direct cases produced exact independent Accept/Reject bytes; four closed-file CRLF applications also passed. |
| `presentationComplete` | `true` | Every required presentation observation completed. This is not a compatibility verdict. |
| `presentationCompatible` | **`false`** | Host-widget, cursor, formatter-variant, Reading, CRLF-scope, and environment limitations remain despite complete structural cards. |
| `structuralFailures` | `[]` | All 24 selected non-CRLF structural bare/Emend cases passed the exercised complete old/new card comparisons on the local branch. |
| `companionChangeRequired` | `false` | No further change was required for that exercised local structural-card surface. This does not remove the merge/integration gate or make overall presentation compatible. |
| `alternativesPassed` | `true` | Six direct rejected-alternative cases passed exact bytes; they remain non-gating and unselected. |
| `crlfStatus` | `passed` | Exactly four unique closed-file SourceEdit/application runs passed. This is not open-editor CRLF card coverage. |

The only structural-card implementation verified here is the local companion branch at `2678dc03b5c84fe58a48b45c48b317e20d772e16`, whose manifest still says `2.3.0`. No companion PR, merge commit, integrated compatible version, tag, or release exists for those changes. No released compatible structural-preview version is declared. **PR 09 remains blocked until a companion change is merged and its integrated compatible version/commit is declared.**

## Exact provenance and bundle identity

| Surface | Exact identity |
| --- | --- |
| Emend branch | `feature/2.11-pr08-track-changes-compatibility` |
| Emend base | `344a377837410bd91999d776c12a416ab305ec62` (`main` before PR 08) |
| Emend production/evidence HEAD | `c59e20ab85f11923d38d8f6add541ffd68469d00` (`test: record Track Changes compatibility fixtures`) |
| Emend manifest during runtime | `emend` / `2.11.0-beta.1` |
| Final Task 4 Emend root and loaded `main.js` SHA-256 | `d5d9f1579ca42fab922008eafbfd1e2be96c5823e0a2b5dfd0efb827c7786f7b`; every green summary has `loadedBundleMatchedRoot: true` |
| Upstream companion repository | `philphilphil/obsidian-track-changes` (`https://github.com/philphilphil/obsidian-track-changes`) |
| Released baseline tag | `2.3.0`; tag object `682ab8801fd8f82bbea5c201aafa14f113deece9`; peeled full tag commit `9e34c3c7af1c12fce6169dd990275e98376db86f` |
| Released-baseline local and loaded `main.js` SHA-256 | `2bde1acfa9bb2151cae213766b739089a327ffb1584505ce44546168b6c2d0f9` |
| Selected companion branch | `feature/structural-review-previews`, local only |
| Selected companion base | `864865d177df841a4cddc1e6664dd2ef2d4940d9` |
| Selected reviewed companion HEAD | `2678dc03b5c84fe58a48b45c48b317e20d772e16` |
| Selected companion commits | `250cace` extraction; `c4c6f91` nested fences; `7cae3c0` rendering; `7a44239` lifecycle; `2678dc0` eligibility hardening |
| Selected companion built/root/staged/loaded `main.js` SHA-256 | `ef94ed22468fcd5527e3502d93b547f2baadb3257c2840e29b1428912182ac5d` at all four locations |
| Final Task 4 runtime harness SHA-256 | `33f0f19011aa5c642b46931f39694a07e57fe8b8f44ffad59735527bba4b64ad` |
| Recovered companion provenance copy SHA-256 | `25dd4c0a0ca1686ab1f7ea90faa00d1402913a2dcbb1229a6c1a4c69ff033a5e` |
| Companion PR / reviewed upstream head / merge commit / actual release | None / none / none / none. The reviewed head above is local, not an upstream review or merge identity. |

The companion branch changes review-card-only structural old/new previews. Its scoped diff does not change the parser, source operations, commands, writers, Live Preview, Reading, dependencies, manifest, or version. It adds no Emend structural Operation or review UI. No fork, push, upstream submission, merge, tag, publication, or external issue update occurred.

Before the final green run, an ignored companion SDD provenance file had been removed during workspace cleanup. The exact live companion HEAD and unchanged built bundle were revalidated; only the provenance location and current harness fingerprint changed in the ignored Emend harness. The copy preserves original harness SHA-256 `426c35126eb8a3850dbac1aa8df090e65433f922a307aada598ff579e2c7ebd3`. No scenario semantics, Emend production bytes, companion source, or companion bundle changed. This was provenance recovery, not a fresh companion rebuild. Machine proof is `test_vault/emend-selection-chat-verify/evidence-task4-20261127-194000-c59e20a-track-changes-compatibility/machine-provenance.json`.

## Durable fixture contract

The tracked catalog is `tests/fixtures/track-changes-compatibility.json`; validated loading, exact-byte reconstruction, selected-family coverage, legacy metadata preservation, and fail-closed controls are in `tests/track-changes-compatibility.test.ts`. The runtime harness consumes the same catalog. The catalog contains `sourceConstants` and 17 fixtures. Each fixture has:

- `id` and a `family` of `legacy`, `table-cell`, `table-row`, `table-column`, `table-delimiter`, `table-cross-cell`, `list`, or `blockquote`;
- exact `original`, `bareAnnotated`, `emendAnnotated`, `accepted`, and `rejected` strings;
- a nonnegative integer `changeCount`;
- `disposition: "selected"` or `disposition: "rejected-alternative"`; and
- a nonempty `limitation` exactly when it is a rejected alternative.

Every `rejected` string equals `original`. Bare tokens use `{~~old~>new~~}`, `{++insertion++}`, and `{--deletion--}`. Emend forms insert the exact prefix `author="Emend"` after the opening brace, for example `{author="Emend"~~old~>new~~}`. Both forms independently reconstruct the same exact accepted and rejected documents. Existing other-author/date bytes are preserved rather than normalized.

The source constants are:

```json
{
  "H2": "| A | B |",
  "D2": "| --- | --- |",
  "R1": "| one | two |",
  "R2": "| keep | last |",
  "TABLE": "| A | B |\n| --- | --- |\n| one | two |\n",
  "H3": "| A | B | C |",
  "D3": "| --- | --- | --- |",
  "R3": "| one | two | three |",
  "TABLE3": "| A | B | C |\n| --- | --- | --- |\n| one | two | three |\n",
  "ESCAPED_OLD": "one \\| two",
  "ESCAPED_NEW": "first \\| second"
}
```

The test-derived `selectedFixtureIds`, also recorded in the runtime decision, are exactly:

1. `legacy-prose`
2. `table-cell-escaped-pipe-minimized`
3. `table-row-insert-append`
4. `table-row-insert-interior`
5. `table-row-delete`
6. `table-row-replace`
7. `table-column-add-per-row`
8. `table-column-delete-per-row`
9. `table-delimiter-replace`
10. `table-cross-cell-replace`
11. `table-crlf-row-replace`
12. `list-item-insert`
13. `list-item-delete`
14. `blockquote-line-replace`

Every required family has selected coverage: legacy prose; minimized escaped-pipe cell text; append/interior insertion, deletion, replacement, and CRLF replacement for table rows; per-row column addition/deletion; delimiter replacement; cross-cell replacement; list insertion/deletion; and blockquote replacement. Rejected alternatives cannot satisfy this coverage.

### Exact selected encodings and resolution bytes

The following values use JSON string notation. `rejected` is also the exact original document. These are candidate compatibility fixtures, not Operations enabled in Emend.

#### `legacy-prose` — `legacy`, selected, `changeCount: 2`

```json
{
  "bareAnnotated": "Alpha {~~beta~>Beta~~}{++!++}.\n",
  "emendAnnotated": "Alpha {author=\"Emend\"~~beta~>Beta~~}{author=\"Emend\"++!++}.\n",
  "accepted": "Alpha Beta!.\n",
  "rejected": "Alpha beta.\n"
}
```

#### `table-cell-escaped-pipe-minimized` — `table-cell`, selected, `changeCount: 2`

```json
{
  "bareAnnotated": "| A | B |\n| --- | --- |\n| {~~one~>first~~} \\| {~~two~>second~~} |\n",
  "emendAnnotated": "| A | B |\n| --- | --- |\n| {author=\"Emend\"~~one~>first~~} \\| {author=\"Emend\"~~two~>second~~} |\n",
  "accepted": "| A | B |\n| --- | --- |\n| first \\| second |\n",
  "rejected": "| A | B |\n| --- | --- |\n| one \\| two |\n"
}
```

The real compiler assertion is `createReplacementCompiler()(ESCAPED_OLD, ESCAPED_NEW) === '{author="Emend"~~one~>first~~} \\| {author="Emend"~~two~>second~~}'`. The actual safe-cell Full-note control wrote exactly this minimized attributed cell content once.

#### `table-row-insert-append` — `table-row`, selected, `changeCount: 1`

```json
{
  "bareAnnotated": "| A | B |\n| --- | --- |\n| one | two |\n{++| middle | added |\n++}",
  "emendAnnotated": "| A | B |\n| --- | --- |\n| one | two |\n{author=\"Emend\"++| middle | added |\n++}",
  "accepted": "| A | B |\n| --- | --- |\n| one | two |\n| middle | added |\n",
  "rejected": "| A | B |\n| --- | --- |\n| one | two |\n"
}
```

#### `table-row-insert-interior` — `table-row`, selected, `changeCount: 1`

```json
{
  "bareAnnotated": "| A | B |\n| --- | --- |\n| one | two |\n{++| middle | added |\n++}| keep | last |\n",
  "emendAnnotated": "| A | B |\n| --- | --- |\n| one | two |\n{author=\"Emend\"++| middle | added |\n++}| keep | last |\n",
  "accepted": "| A | B |\n| --- | --- |\n| one | two |\n| middle | added |\n| keep | last |\n",
  "rejected": "| A | B |\n| --- | --- |\n| one | two |\n| keep | last |\n"
}
```

#### `table-row-delete` — `table-row`, selected, `changeCount: 1`

```json
{
  "bareAnnotated": "| A | B |\n| --- | --- |\n{--| one | two |\n--}| keep | last |\n",
  "emendAnnotated": "| A | B |\n| --- | --- |\n{author=\"Emend\"--| one | two |\n--}| keep | last |\n",
  "accepted": "| A | B |\n| --- | --- |\n| keep | last |\n",
  "rejected": "| A | B |\n| --- | --- |\n| one | two |\n| keep | last |\n"
}
```

#### `table-row-replace` — `table-row`, selected, `changeCount: 1`

```json
{
  "bareAnnotated": "| A | B |\n| --- | --- |\n{~~| one | two |\n~>| first | second |\n~~}",
  "emendAnnotated": "| A | B |\n| --- | --- |\n{author=\"Emend\"~~| one | two |\n~>| first | second |\n~~}",
  "accepted": "| A | B |\n| --- | --- |\n| first | second |\n",
  "rejected": "| A | B |\n| --- | --- |\n| one | two |\n"
}
```

#### `table-column-add-per-row` — `table-column`, selected, `changeCount: 3`

```json
{
  "bareAnnotated": "{~~| A | B |~>| A | B | C |~~}\n{~~| --- | --- |~>| --- | --- | --- |~~}\n{~~| one | two |\n~>| one | two | three |\n~~}",
  "emendAnnotated": "{author=\"Emend\"~~| A | B |~>| A | B | C |~~}\n{author=\"Emend\"~~| --- | --- |~>| --- | --- | --- |~~}\n{author=\"Emend\"~~| one | two |\n~>| one | two | three |\n~~}",
  "accepted": "| A | B | C |\n| --- | --- | --- |\n| one | two | three |\n",
  "rejected": "| A | B |\n| --- | --- |\n| one | two |\n"
}
```

#### `table-column-delete-per-row` — `table-column`, selected, `changeCount: 3`

```json
{
  "bareAnnotated": "{~~| A | B | C |~>| A | B |~~}\n{~~| --- | --- | --- |~>| --- | --- |~~}\n{~~| one | two | three |\n~>| one | two |\n~~}",
  "emendAnnotated": "{author=\"Emend\"~~| A | B | C |~>| A | B |~~}\n{author=\"Emend\"~~| --- | --- | --- |~>| --- | --- |~~}\n{author=\"Emend\"~~| one | two | three |\n~>| one | two |\n~~}",
  "accepted": "| A | B |\n| --- | --- |\n| one | two |\n",
  "rejected": "| A | B | C |\n| --- | --- | --- |\n| one | two | three |\n"
}
```

#### `table-delimiter-replace` — `table-delimiter`, selected, `changeCount: 1`

```json
{
  "bareAnnotated": "| A | B |\n{~~| --- | --- |\n~>| :--- | ---: |\n~~}| one | two |\n",
  "emendAnnotated": "| A | B |\n{author=\"Emend\"~~| --- | --- |\n~>| :--- | ---: |\n~~}| one | two |\n",
  "accepted": "| A | B |\n| :--- | ---: |\n| one | two |\n",
  "rejected": "| A | B |\n| --- | --- |\n| one | two |\n"
}
```

#### `table-cross-cell-replace` — `table-cross-cell`, selected, `changeCount: 1`

```json
{
  "bareAnnotated": "| A | B |\n| --- | --- |\n| {~~one | two~>first | second~~} |\n",
  "emendAnnotated": "| A | B |\n| --- | --- |\n| {author=\"Emend\"~~one | two~>first | second~~} |\n",
  "accepted": "| A | B |\n| --- | --- |\n| first | second |\n",
  "rejected": "| A | B |\n| --- | --- |\n| one | two |\n"
}
```

#### `table-crlf-row-replace` — `table-row`, selected, `changeCount: 1`

```json
{
  "bareAnnotated": "| A | B |\r\n| --- | --- |\r\n{~~| one | two |\r\n~>| first | second |\r\n~~}",
  "emendAnnotated": "| A | B |\r\n| --- | --- |\r\n{author=\"Emend\"~~| one | two |\r\n~>| first | second |\r\n~~}",
  "accepted": "| A | B |\r\n| --- | --- |\r\n| first | second |\r\n",
  "rejected": "| A | B |\r\n| --- | --- |\r\n| one | two |\r\n"
}
```

#### `list-item-insert` — `list`, selected, `changeCount: 1`

```json
{
  "bareAnnotated": "- one\n{++- two\n++}",
  "emendAnnotated": "- one\n{author=\"Emend\"++- two\n++}",
  "accepted": "- one\n- two\n",
  "rejected": "- one\n"
}
```

#### `list-item-delete` — `list`, selected, `changeCount: 1`

```json
{
  "bareAnnotated": "- one\n{--- two\n--}",
  "emendAnnotated": "- one\n{author=\"Emend\"--- two\n--}",
  "accepted": "- one\n",
  "rejected": "- one\n- two\n"
}
```

#### `blockquote-line-replace` — `blockquote`, selected, `changeCount: 1`

```json
{
  "bareAnnotated": "{~~> one\n~>> two\n~~}> keep\n",
  "emendAnnotated": "{author=\"Emend\"~~> one\n~>> two\n~~}> keep\n",
  "accepted": "> two\n> keep\n",
  "rejected": "> one\n> keep\n"
}
```

### Six rejected-alternative direct cases

Three fixture IDs, each in bare and Emend form, make six mandatory but non-gating alternative cases. All six passed actual cards and exact Accept/Reject bytes. They remain rejected for selected encoding:

- `table-cell-escaped-pipe-whole-cell`: `Synthetic whole-cell control; actual minimized Emend output uses two substitutions around the escaped pipe.`
- `table-column-add-whole-table` and `table-column-delete-whole-table`: `Whole-table substitution replaces unaffected rows; retained as an alternative to the per-row encoding.`

Their exact values are:

#### `table-cell-escaped-pipe-whole-cell` — `table-cell`, rejected alternative, `changeCount: 1`

```json
{
  "bareAnnotated": "| A | B |\n| --- | --- |\n| {~~one \\| two~>first \\| second~~} |\n",
  "emendAnnotated": "| A | B |\n| --- | --- |\n| {author=\"Emend\"~~one \\| two~>first \\| second~~} |\n",
  "accepted": "| A | B |\n| --- | --- |\n| first \\| second |\n",
  "rejected": "| A | B |\n| --- | --- |\n| one \\| two |\n"
}
```

#### `table-column-add-whole-table` — `table-column`, rejected alternative, `changeCount: 1`

```json
{
  "bareAnnotated": "{~~| A | B |\n| --- | --- |\n| one | two |\n~>| A | B | C |\n| --- | --- | --- |\n| one | two | three |\n~~}",
  "emendAnnotated": "{author=\"Emend\"~~| A | B |\n| --- | --- |\n| one | two |\n~>| A | B | C |\n| --- | --- | --- |\n| one | two | three |\n~~}",
  "accepted": "| A | B | C |\n| --- | --- | --- |\n| one | two | three |\n",
  "rejected": "| A | B |\n| --- | --- |\n| one | two |\n"
}
```

#### `table-column-delete-whole-table` — `table-column`, rejected alternative, `changeCount: 1`

```json
{
  "bareAnnotated": "{~~| A | B | C |\n| --- | --- | --- |\n| one | two | three |\n~>| A | B |\n| --- | --- |\n| one | two |\n~~}",
  "emendAnnotated": "{author=\"Emend\"~~| A | B | C |\n| --- | --- | --- |\n| one | two | three |\n~>| A | B |\n| --- | --- |\n| one | two |\n~~}",
  "accepted": "| A | B |\n| --- | --- |\n| one | two |\n",
  "rejected": "| A | B | C |\n| --- | --- | --- |\n| one | two | three |\n"
}
```

For multiline tokens at EOF, the final row line ending remains inside the token payload. No additional raw LF follows the closing delimiter because Accept/Reject would preserve it as an extra blank line. Thus affected raw annotated fixtures end in `++}`, `--}`, or `~~}`, while original, accepted, and rejected documents end in exactly their expected final LF or CRLF. No universal formatter normalization is claimed.

The independent legacy control preserves `{author="Reviewer" date="2026-11-26T00:00:00Z"~~old~>older~~}` byte-for-byte before a separate `{author="Emend"++!++}` token. Accept produces `Before older! after.\n`; reject produces `Before old after.\n`. Bare/other-author/date, comments, no-ops, strict in-token rejection, and recovery also remain covered by the inherited authorship, in-token, scanner, and default groups.

## Structural cards and multi-card UX

The selected local companion passed **24 selected non-CRLF structural bare/Emend cases**, **34 actual visible/operable structural cards**, and **68 old/new complete corresponding-root comparisons**, with `structuralFailures: []`. Every old root matched the complete document-wide all-rejected control, and every new root matched the complete document-wide all-accepted control. Deep comparisons covered actual element hierarchy, attributes, and text, not just counts or screenshots.

**Multi-card rule:** every card renders the same complete document-wide all-rejected old control and all-accepted new control. It never renders a one-card intermediate projection. This makes per-row multi-card presentation deterministic and matches the explicit old/new controls.

Across 26 selected direct non-CRLF cases and six rejected alternatives, all 32 cases and all **64 independent card Accept/Reject applications** produced exact expected final bytes. Direct fixture setup and companion operations caused zero Emend guarded writes and zero Emend native Selection replacements. The four closed-file CRLF applications are separate from these 64.

Evidence: `structural-diagnostics.json`, `fixtures/`, `resolutions/`, `markdown/`, and `audit-task4-20261127-194000-c59e20a-compatibility.log` under the final compatibility evidence root defined below.

## Source, Live Preview, Reading, and card matrix

Source Mode formatter preflight found no unexplained source difference. Source editor and disk bytes matched each exact annotated runtime fixture before and during DOM assertions. Cursor-outside and cursor-inside Live Preview and supplementary Reading were separately observed for all 26 selected non-CRLF direct cases.

The only `runtimeVariantOf` mapping is `table-cell-escaped-pipe-minimized/bare`: Obsidian padded the top-level editor table in Live Preview, so presentation used this exact list-contained variant:

```json
{
  "original": "- | A | B |\n  | --- | --- |\n  | one \\| two |\n",
  "bareAnnotated": "- | A | B |\n  | --- | --- |\n  | {~~one~>first~~} \\| {~~two~>second~~} |\n",
  "emendAnnotated": "- | A | B |\n  | --- | --- |\n  | {author=\"Emend\"~~one~>first~~} \\| {author=\"Emend\"~~two~>second~~} |\n",
  "accepted": "- | A | B |\n  | --- | --- |\n  | first \\| second |\n",
  "rejected": "- | A | B |\n  | --- | --- |\n  | one \\| two |\n"
}
```

This list-contained variant is **not top-level host presentation coverage**. The direct top-level byte/card cases still pass, but no top-level presentation claim is inferred from the variant. All other presentation cases have `runtimeVariantOf: null`.

In the matrix, “old/new pass” means every actual card's complete old/new roots matched the rejected/accepted controls. “Clean” means raw CriticMarkup delimiters were not visible. Reading was observational and supplementary; it cannot compensate for card or Live Preview limitations. **`readingAcceptedEquivalent=false` for 22 of 26 cases.** It is true only for legacy prose bare/Emend and minimized-cell bare/Emend.

| Case | Actual cards | Structural card roots | Source | Live Preview outside | Live Preview inside | Reading observation |
| --- | ---: | --- | --- | --- | --- | --- |
| `legacy-prose/bare` | 2 | Literal legacy cards; structural comparison N/A | Exact/raw | Clean | Raw | `readingAcceptedEquivalent=true` |
| `legacy-prose/emend` | 2 | Literal legacy cards; structural comparison N/A | Exact/raw | Clean | Raw | `readingAcceptedEquivalent=true` |
| `table-cell-escaped-pipe-minimized/bare` | 2 | Old/new pass | Exact/raw; list variant | Clean; not top-level coverage | Raw | `readingAcceptedEquivalent=true`; supplementary |
| `table-cell-escaped-pipe-minimized/emend` | 2 | Old/new pass | Exact/raw | Clean | No raw delimiters observed | `readingAcceptedEquivalent=true`; supplementary |
| `table-row-insert-append/bare` | 1 | Old/new pass | Exact/raw | Clean | Raw | `readingAcceptedEquivalent=false` |
| `table-row-insert-append/emend` | 1 | Old/new pass | Exact/raw | Clean | Raw | `readingAcceptedEquivalent=false` |
| `table-row-insert-interior/bare` | 1 | Old/new pass | Exact/raw | Clean | Raw | `readingAcceptedEquivalent=false` |
| `table-row-insert-interior/emend` | 1 | Old/new pass | Exact/raw | Clean | Raw | `readingAcceptedEquivalent=false` |
| `table-row-delete/bare` | 1 | Old/new pass | Exact/raw | Clean | Raw | `readingAcceptedEquivalent=false` |
| `table-row-delete/emend` | 1 | Old/new pass | Exact/raw | Clean | Raw | `readingAcceptedEquivalent=false` |
| `table-row-replace/bare` | 1 | Old/new pass | Exact/raw | Clean | Raw | `readingAcceptedEquivalent=false` |
| `table-row-replace/emend` | 1 | Old/new pass | Exact/raw | Clean | Raw | `readingAcceptedEquivalent=false` |
| `table-column-add-per-row/bare` | 3 | Old/new pass | Exact/raw | Raw; adjacent/token-touching fallback | Raw | `readingAcceptedEquivalent=false` |
| `table-column-add-per-row/emend` | 3 | Old/new pass | Exact/raw | Raw; adjacent/token-touching fallback | Raw | `readingAcceptedEquivalent=false` |
| `table-column-delete-per-row/bare` | 3 | Old/new pass | Exact/raw | Raw; adjacent/token-touching fallback | Raw | `readingAcceptedEquivalent=false` |
| `table-column-delete-per-row/emend` | 3 | Old/new pass | Exact/raw | Raw; adjacent/token-touching fallback | Raw | `readingAcceptedEquivalent=false` |
| `table-delimiter-replace/bare` | 1 | Old/new pass | Exact/raw | Clean | Raw | `readingAcceptedEquivalent=false` |
| `table-delimiter-replace/emend` | 1 | Old/new pass | Exact/raw | Clean | Raw | `readingAcceptedEquivalent=false` |
| `table-cross-cell-replace/bare` | 1 | Old/new pass | Exact/raw | Raw in Obsidian host table widget | Raw | `readingAcceptedEquivalent=false` |
| `table-cross-cell-replace/emend` | 1 | Old/new pass | Exact/raw | Raw in Obsidian host table widget | Raw | `readingAcceptedEquivalent=false` |
| `list-item-insert/bare` | 1 | Old/new pass | Exact/raw | Clean | Raw | `readingAcceptedEquivalent=false` |
| `list-item-insert/emend` | 1 | Old/new pass | Exact/raw | Clean | Raw | `readingAcceptedEquivalent=false` |
| `list-item-delete/bare` | 1 | Old/new pass | Exact/raw | Clean | Raw | `readingAcceptedEquivalent=false` |
| `list-item-delete/emend` | 1 | Old/new pass | Exact/raw | Clean | Raw | `readingAcceptedEquivalent=false` |
| `blockquote-line-replace/bare` | 1 | Old/new pass | Exact/raw | Clean | Raw | `readingAcceptedEquivalent=false` |
| `blockquote-line-replace/emend` | 1 | Old/new pass | Exact/raw | Clean | Raw | `readingAcceptedEquivalent=false` |

The four per-row column add/delete cases have no cursor offset wholly outside every token. Their adjacent/token-touching fallback is not outside-token coverage. For both cross-cell forms, Obsidian's own Live Preview table widget exposed raw delimiters with the cursor outside; this is a host-widget limitation separate from the passing companion cards. Raw Source Mode and cursor-inside markup behavior are not an Emend review UI.

## Independent CRLF application evidence

`crlfStatus` is independently `passed` for exactly four unique **closed-file** applications: bare Accept, bare Reject, Emend Accept, and Emend Reject. Each used an exact raw-token SourceEdit and the actual SourceEdit/PanelHost delegate to real `applyEditsToFile`, with one real `Vault.process`. No Markdown leaf remained open.

| Form | Action | `from` / `to` | Inserted row | Delegate / process | CM dispatch / `setValue` / Markdown leaves | Result |
| --- | --- | --- | --- | --- | --- | --- |
| bare | Accept | 26 / 69 | Accepted CRLF row | 1 / 1 | 0 / 0 / 0 | Exact accepted CRLF disk bytes |
| bare | Reject | 26 / 69 | Original CRLF row | 1 / 1 | 0 / 0 / 0 | Exact rejected CRLF disk bytes |
| Emend | Accept | 26 / 83 | Accepted CRLF row | 1 / 1 | 0 / 0 / 0 | Exact accepted CRLF disk bytes |
| Emend | Reject | 26 / 83 | Original CRLF row | 1 / 1 | 0 / 0 / 0 | Exact rejected CRLF disk bytes |

The exact SourceEdit `expected` values were `"{~~| one | two |\r\n~>| first | second |\r\n~~}"` for bare and `"{author=\"Emend\"~~| one | two |\r\n~>| first | second |\r\n~~}"` for Emend. Accept inserts were `"| first | second |\r\n"` and reject inserts were `"| one | two |\r\n"`. Accepted disk bytes were `"| A | B |\r\n| --- | --- |\r\n| first | second |\r\n"`; rejected disk bytes were `"| A | B |\r\n| --- | --- |\r\n| one | two |\r\n"`. No line ending was normalized and no extra EOF newline was invented.

This is **closed-file SourceEdit/application-path evidence only**, not open-editor CRLF card coverage. Evidence: `crlf/*.json` and `markdown/table-crlf-row-replace-*.md`.

## Deferred rendering, active content, and source resolution

The real-Obsidian panel used actual asynchronous `MarkdownRenderer` completion and settled structural DOM before comparisons. Post-render Accept/Reject source resolution remained byte-exact in all 64 direct applications.

A fresh companion run of `node test/structural-preview.test.mjs` passed **82/82** focused cases. It covered deferred same-source refresh preservation, stale A/B discard, forced rebuild invalidation, current-path file-switch Accept/Reject, disconnected panel ignoring deferred completion, renderer-rejection literal fallback and child disposal, pending stale self-disposal, and presentation not changing source resolution. These are controlled mock-DOM/deferred-renderer tests, not physical Obsidian disconnect testing. Log: `test_vault/emend-selection-chat-verify/run-task4-20261127-194000-c59e20a-companion-structural-preview-tests.log`.

Active-content fallback covered 12 forms: wikilink embed, inline image, reference image, collapsed image, shortcut image, raw HTML image, raw autolink, nested backtick fence, nested tilde fence, nested unclosed fence, nested list fence, and nested blockquote fence. Every form retained the exact legacy literal card fallback—old HTML `o<span class="tc-diff-changed">ne</span>` and new HTML `<span class="tc-diff-changed">tw</span>o`—with zero observed renderer calls, native requests, image requests, loopback-image requests, external calls, Emend writes, or native Selection writes. The eligible blockquote control made exactly two renderer calls, one for `> one\n` and one for `> two\n`, with zero external requests. Evidence: `active-content-fallback.json`.

Network observations covered CDP `Network.requestWillBeSent`, renderer `fetch`, Obsidian `requestUrl`, XHR, Image constructor/src, WebSocket, EventSource, and sendBeacon. **Unobserved native network interfaces are not claimed.**

## Writer, native undo, privacy, UI, and bundle audits

- Direct synthetic structural fixtures caused **0 Emend guarded writes and 0 native Selection replacements**. They are compatibility setup only.
- The actual safe-cell Full-note control sent one loopback request containing the exact complete original table and no tools. It made exactly **one guarded `vault.modify`**, wrote the exact minimized attributed bytes, and made **zero native replacements**.
- The actual safe-cell Selection control sent the exact captured Selection and Smart context, made **one native `editor.replaceRange`**, made **zero guarded vault writes**, and preserved outside bytes including Unicode. Native undo/redo restored the exact complete original/redone documents:

```json
{
  "undone": "- | Café | Value | Note |\n  | --- | --- | --- |\n  | one \\| two | 值🙂 | é |\n\nSuffix unchanged.\n",
  "redone": "- | Café | Value | Note |\n  | --- | --- | --- |\n  | {author=\"Emend\"~~one~>first~~} \\| two | 值🙂 | é |\n\nSuffix unchanged.\n"
}
```

- Inherited groups independently retained Full-note guarded-write versus Selection native-write routing, exact freshness fail-closed behavior, no-op/Chat writer-free behavior, and native undo/redo.
- Runtime command and DOM checks found `emendAcceptRejectCommands: []` and `emendAcceptRejectButtons: []`, while the actual companion review command existed. These runtime checks, **together with the static source/bundle and separate-manifest audit**, support the claims that Emend added no diff/review UI and did not bundle or auto-install the companion. Runtime button checks alone are not the basis for those broader claims.
- Emend and companion manifests, plugin directories, source hashes, and loaded hashes remained separate and exact. No structural review renderer was added to Emend.

The privacy audit inspected actual request JSON, note/markdown artifacts, writer/command logs, saved-chat aggregates, DOM/structural JSON, and screenshots. Across all groups, 128 request-log files contained no credential, `authorization`, `headers`, or `httpHeaders` fields. Correction requests may transiently return a rejected candidate to the same mock provider; that is distinct from ready persistence.

The default scenario's `persisted-thread-audit.json` contained 15 schema-3 threads, all messages ready, without snapshots/selected text, raw rejected candidates, correction diagnostics, source snapshots, additional-note private content, or credentials. The preserved final default-run vault contained 22 schema-3 saved chats and 58 ready messages passing the same audit. Focused groups also rejected raw candidates, rejected reasoning/summaries, correction diagnostics, Operations payloads, transient states, and request/source snapshots as applicable. Only concise Edit results and permitted successful reasoning/usage remained.

The compatibility evidence contains 171 PNGs; 290 PNGs across all groups passed signature validation. The combined audit passed all summary identities/counts, request logs, PNG signatures, persistence, and intentional-control shape. Writer/UI evidence is `commands/writer-ui-bundle-provenance.json`; safe-cell evidence is `logs/pr08-compatibility-safe-cell.json` and `commands/emend-safe-cell.json`; the combined privacy audit is `audit-task4-20261127-194000-c59e20a-all-groups-privacy.log`.

## RED, GREEN, static, and runtime verification

### Durable fixture TDD

Before the tracked catalog existed:

```bash
npx vitest run tests/track-changes-compatibility.test.ts
```

exited 1 for the expected missing `tests/fixtures/track-changes-compatibility.json`. After adding the exact catalog, the same command passed **58/58**. The focused regression command:

```bash
npx vitest run tests/track-changes-compatibility.test.ts tests/critic-markup.test.ts tests/replacement-diff.test.ts tests/markdown-edit-guards.test.ts
```

passed **290/290**. Task 2's `npm test` passed 59 files / 2,267 tests; `npm run lint`, `npm run build`, `git diff --check`, and `git diff --cached --check` passed. Row, column, delimiter, and cross-cell guards passed immediately as current-behavior characterization controls, not manufactured RED.

### Baseline RED and selected-companion GREEN

With released Track Changes 2.3.0 at peeled commit `9e34c3c7af1c12fce6169dd990275e98376db86f`, the strengthened real-Obsidian compatibility gate ran RED: **3 passed / 5 failed scenarios, 54 passing assertions**. The structural preview, active-renderer, writer/provenance, and final evidence gates failed as expected. Evidence: `test_vault/emend-selection-chat-verify/evidence-pr08-track-changes-compatibility-final-2678dc0-baseline-red/summary.json`; log: `run-final-2678dc0-baseline-red.log`.

With selected local HEAD `2678dc03b5c84fe58a48b45c48b317e20d772e16`, the same gate ran GREEN: **8 passed / 0 failed, 857 assertions**. Evidence: `test_vault/emend-selection-chat-verify/evidence-pr08-track-changes-compatibility-final-2678dc0-green/summary.json`; log: `run-final-2678dc0-fixed-green.log`. The controller rerun independently passed 8/857 at `evidence-pr08-track-changes-compatibility-controller-2678dc0-green/summary.json`.

The companion's whole-branch `npm test`, `npm run lint`, `npm run build`, and `git diff --check` passed on `2678dc0`; its focused 82 structural cases were included in `npm test`. Task 4 separately reran the focused command and passed 82/82.

### Final fresh Task 4 matrix

Emend `npm run build` passed at `c59e20a`; its log is `test_vault/emend-selection-chat-verify/run-task4-20261127-emend-build.log`. In the following table, `H` means `test_vault/emend-selection-chat-verify`. Each runtime command used a fresh direct-child evidence directory and:

```bash
EMEND_VERIFY_EVIDENCE_DIR="<fresh-evidence-directory>" timeout --signal=TERM --kill-after=30s 1800s node "H/verify.mjs" <arguments>
```

| Arguments | Exit | Scenarios | Assertions | Fresh summary under `H/` |
| --- | ---: | ---: | ---: | --- |
| `--track-changes-compatibility` | 0 | 8 / 0 failed | 857 | `evidence-task4-20261127-194000-c59e20a-track-changes-compatibility/summary.json` |
| `--emend-authorship` | 0 | 5 / 0 | 114 | `evidence-task4-20261127-194000-c59e20a-emend-authorship/summary.json` |
| `--in-token-rejection` | 0 | 5 / 0 | 62 | `evidence-task4-20261127-194000-c59e20a-in-token-rejection/summary.json` |
| `--stabilization` | 0 | 6 / 0 | 55 | `evidence-task4-20261127-194000-c59e20a-stabilization/summary.json` |
| `--modification-controller` | 0 | 6 / 0 | 73 | `evidence-task4-20261127-194000-c59e20a-modification-controller/summary.json` |
| `--markdown-scanner` | 0 | 10 / 0 | 318 | `evidence-task4-20261127-194000-c59e20a-markdown-scanner/summary.json` |
| `--edit-freshness` | 0 | 24 / 0 | 227 | `evidence-task4-20261127-194000-c59e20a-edit-freshness/summary.json` |
| `--edit-target-flow` | 0 | 5 / 0 | 95 | `evidence-task4-20261127-194000-c59e20a-edit-target-flow/summary.json` |
| `--sessions` | 0 | 9 / 0 | 156 | `evidence-task4-20261127-194000-c59e20a-sessions/summary.json` |
| default, no flag | 0 | 28 / 0 | 589 | `evidence-task4-20261127-194000-c59e20a-default/summary.json` |
| **Total** | **all 0** | **106 / 0 unexpected failures** | **2,546** | All HEADs/hashes/loaded identities matched |

The intentional compatibility control ran separately with `--track-changes-compatibility-failing-control`, exited **1** as required, and recorded 0 passed / 1 intentionally failed / 0 passing assertions. Evidence: `H/evidence-task4-20261127-194000-c59e20a-failing-control/summary.json`. Nine comparator/evidence-gate negative self-tests also passed, including hierarchy/text mismatch, wrong roots, missing alternatives, and missing/environment-limited CRLF rejection.

Final static/process audits passed `node --check` for the harness and both bundles, `git diff --check` in both repositories, clean tracked/unignored status, ignored-artifact checks, final head/hash equality, and no remaining verifier/provider/Xvfb/Obsidian processes. Complete log: `H/run-task4-20261127-194000-c59e20a-final-audits-complete.log`.

### Independent reviews already completed

- Task 1 characterization received clean independent spec-compliance and quality review; its full-hierarchy comparison recommendation was incorporated into Task 4.
- Task 2 durable fixtures received clean independent spec-compliance and quality review.
- The local companion branch received whole-branch presentation/privacy review and scoped re-review, with no open Critical/Important findings at `2678dc0`.
- Task 4 received independent spec-compliance/quality approval (`agent-180`) and write/privacy factual approval (`agent-181`). The Reading and static/runtime claim-boundary minors are explicitly preserved here.

Task 5's documentation self-review is not an independent review. Independent spec-compliance, quality, and factual documentation review of this record follows separately and is not claimed in this stage record.

## Environment and preserved limitations

Runtime used Linux `krypton`, kernel `6.12.117+deb13-amd64 #1 SMP PREEMPT_DYNAMIC Debian 6.12.117-1 (2026-11-12)`, `x86_64`; official Obsidian `1.15.0` AppImage; isolated Xvfb `:101` at `1440x1000x24`; CDP `127.0.0.1:19224`; default Obsidian theme with default dark appearance; Node `v20.19.2`; and npm `9.2.0`. Input was trusted CDP-dispatched keyboard/events and DOM interaction, not physical OS-level typing. The only provider was `http://127.0.0.1:18766`, an OpenAI-compatible SSE loopback mock with a dummy SecretStorage credential.

The following limits remain explicit:

1. Overall `presentationCompatible=false` despite passing selected structural cards.
2. Reading was supplementary observation, with `readingAcceptedEquivalent=false` for 22/26 cases.
3. The bare minimized-table list-contained variant is not top-level coverage.
4. Cross-cell bare and Emend Live Preview exposed raw delimiters in Obsidian's own host table widget with the cursor outside.
5. Per-row column addition/deletion used adjacent/token-touching fallback because no wholly outside-token cursor offset exists.
6. CRLF evidence is closed-file only, not open-editor card coverage.
7. EOF bytes retain the selected token-boundary encoding; no universal formatter normalization is claimed.
8. Windows, macOS, mobile, other Obsidian versions, non-default themes, physical input, screen readers/assistive technology, real providers/accounts/credentials, and paid calls were not exercised.
9. Companion mock-DOM lifecycle cases do not establish unexercised physical host disconnect behavior.
10. Network/privacy observations do not cover unobserved native interfaces.
11. No real-provider, universal host-presentation, released-companion, merged-companion, or external-submission claim is made.

The remaining integration dependency is the principal PR 09 blocker: the selected companion branch is local, unmerged, and unreleased. A merged companion change and declared integrated compatible version/commit are required before PR 09. Structural Operations and any renderer/fork decision remain outside PR 08.

## Issue #36 disposition and post-merge template

Use `Refs #36`, never `Closes #36`, for PR 08. Keep #36 open for unscoped external-dependency limitations and any future fork-versus-renderer decision. The PR body must include this scoped companion gate and the following post-merge comment template. **Do not post the comment before merge.**

> PR 08 added Stage 61 and durable bare/`author="Emend"` compatibility fixtures against Track Changes 2.3.0. It verified the exercised review cards, source/reading presentation, exact accept/reject bytes, and current limitations. The selected structural-preview companion remains local, unmerged, and unreleased at `2678dc03b5c84fe58a48b45c48b317e20d772e16` with manifest version `2.3.0`; no merged companion PR or integrated compatible release exists, so PR 09 remains blocked until a companion change is merged and its compatible integrated version/commit is declared. Structural Emend Operations remain disabled here and belong to PR 09/10. No Emend review UI, bundling, auto-install, fork, or renderer was added. The 2.11 direction remains Track Changes integration; #36 stays open for unscoped external-dependency limitations and any future fork-versus-renderer decision.
