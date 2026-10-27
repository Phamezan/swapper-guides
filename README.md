# Swapper guides

Hand-written matchup guides, compiled to the JSON consumed by Swapper. Write from
your champion's perspective; put advice that applies to every opponent of an enemy
in that enemy's shared core. Vetted authors live in one registry.

Use Node.js 22 or newer (CI uses 24):

```sh
npm ci
npm test
npm run build
```

The build uses only local files. `yaml` is the only dependency. Generated `dist/`
and installed `node_modules/` are ignored by Git.

## Layout

```text
guides/Ahri/Zed-mid.md             champion/enemy/lane guide
enemies/Zed.md                    shared advice against Zed
authors.yml                      vetted source records
champions.json                   champion name → numeric id snapshot
scripts/                         Markdown compiler, validation and refresh
test/fixtures/ahri-vs-zed.json     original app fixture without fixture
dist/index.json                  generated manifest
dist/champions/103.json           generated guides for Ahri
.github/workflows/build.yml       PR check and main → dist publishing
```

Use exact champion **display names** from `champions.json`, including spaces and
punctuation, in paths, frontmatter and ability references. The compiler resolves
them to numeric ids. The file path must match its frontmatter, including case.
Lanes are `top`, `jungle`, `mid`, `adc`, `support`. `adc` matches the app's
`MatchupGuide` type, as chosen for this milestone (the original contract said
`bottom`).

## Writing a guide

Every guide needs YAML frontmatter with `champion`, `enemy`, `lane`, `patch`,
`reviewed`, `difficulty`, `favoredWhen` and `sources`. Quote patch versions so YAML
does not turn them into numbers. Difficulty is exactly `Easy`, `Medium`, `Hard`
or `Skill matchup`. `reviewed` is a boolean: unreviewed guides still compile and
retain `false`, including the pilot.

The body has six required `##` headings: `Key tips`, `Overview`, `Early lane`,
`Mid lane`, `Win condition`, `Itemization`. Order does not matter. A section may
be empty except where the quality bar requires tips.

A tip is a Markdown bullet followed by metadata indented by two spaces:

```text
- Trade while Living Shadow is down ({cd:238:W}).
  sources: [peng04]
  heading: Trading window
  abilities: [Zed.W, Ahri.Q]
  patch: "26.21"
```

The first line is the tip's plain text. Wrapped text lines must be indented by
two spaces and come before metadata; they are joined with spaces. Each bullet is
one tip. `heading` is an optional per-tip heading, rather than Markdown formatting
inside the text. YAML quoting and block strings work in metadata.

| Tip metadata | Meaning |
| --- | --- |
| `sources` | Required nonempty array of vetted author ids, also declared in guide frontmatter. |
| `heading` | Optional nonempty plain-text heading. |
| `patch` | Optional quoted patch version for this tip. Omitted stays omitted. |
| `abilities` | Optional nonempty array like `[Ahri.P, Zed.W]`; keys are `P`, `Q`, `W`, `E`, `R`. Only guide participants are allowed. |
| `items` | Optional nonempty array of positive integer item ids, e.g. `[3157]`. The build validates shape, without fetching an item catalog. |
| `outdated` | Optional nonempty plain-text explanation of what needs reviewing. |

Guide tips compile with `scope: "pair"`; shared tips compile with `scope: "enemy"`.
Metadata `sources`, `abilities`, `items` become `sourceIds`, `abilityKeys`, `itemIds`.
Unknown metadata fields fail the build, rather than disappearing silently.

Text is plain text plus live cooldown tokens such as `{cd:238:W}`. Cooldown tokens
require a numeric participant id and `Q`, `W`, `E` or `R`; passive cooldown tokens
are invalid. Use tokens instead of literal durations such as `20 seconds` or
`20s`. HTML and Markdown formatting in output text are rejected. Put links in the
author registry, not in tip text.

For optional playstyles, add `### Alternative: <title>` under one of the four
phase sections, followed by `source: <author id>` and one or more normal tip
bullets. Each tip still needs its own `sources`. Main section tips go before
alternative headings. Alternatives do not count toward the main-tip quality bar.

For an optional timeline, use `### Timeline` and a Markdown table with exactly
`At`, `Champion`, `Enemy` columns, in that order. Cells contain plain text plus
cooldown tokens. Escape a literal pipe as `\|`. Place the table after tips; a new
heading ends it. At most one timeline is allowed per phase section.

Here is a complete valid `guides/Ahri/Zed-mid.md` example, including both optional
formats. The full port of the original pilot is in [the actual guide](guides/Ahri/Zed-mid.md).

```markdown
---
champion: Ahri
enemy: Zed
lane: mid
patch: "26.21"
reviewed: false
difficulty: Skill matchup
favoredWhen: Hold Charm and trade while Living Shadow is down.
sources: [peng04, v222, aikopanda]
---

## Key tips

- Trade when Living Shadow is down ({cd:238:W}).
  sources: [peng04]
  abilities: [Zed.W]

- Hold Charm to deter Death Mark.
  sources: [v222, aikopanda]
  abilities: [Ahri.E, Zed.R]

- Aim Charm behind you when Zed lands from Death Mark.
  sources: [peng04, aikopanda]
  abilities: [Ahri.E, Zed.R]

## Overview

## Early lane

- Send Q through both Zed and the wave.
  sources: [peng04]
  heading: Levels 1–3
  abilities: [Ahri.Q]

- Keep trades short and save Charm.
  sources: [peng04]
  abilities: [Ahri.E]

### Alternative: Safer lane
source: peng04

- When low on health, reset instead of extending a trade.
  sources: [peng04]
  patch: "26.21"

## Mid lane

- Clear the wave and move first.
  sources: [peng04]

- Use priority to check side lanes, then return for the next wave.
  sources: [peng04]

### Timeline

| At | Champion | Enemy |
| --- | --- | --- |
| Levels 1–2 | Short trades through the wave. | Farms with Q. |
| Level 6 | Hold Charm and Spirit Rush. | Looks for Death Mark. |

## Win condition

- Convert priority into side-lane plays and objectives.
  sources: [peng04, aikopanda]

## Itemization

- Time Zhonya's stasis for Death Mark's detonation.
  sources: [peng04]
  items: [3157]
```

## Shared enemy advice and vetted authors

Shared files use only `enemy` frontmatter and any of the four phase headings.
For example, `enemies/Zed.md` can contain:

```markdown
---
enemy: Zed
---

## Win condition

- Death Mark places Zed behind his target; aim crowd control behind you.
  sources: [peng04]
  patch: "26.21"
  abilities: [Zed.R]
```

The shared file is optional. When present, all its tips are merged into each
guide's `enemyTips`, separately from pair tips; any source used by the core must
also appear in that guide's frontmatter `sources`. Shared ability/cooldown
references must name the enemy, so the advice remains reusable. Unused shared
files are still validated.

Add or update a vetted source once in `authors.yml`. `author` is the display name;
`rankClaim` records the source's claim, not an independently verified ranking.
`url` is the guide/profile URL carried into the compiled `GuideSource` object.
The three pilot records were copied exactly from the app fixture.

```yaml
- id: peng04
  author: Peng04
  rankClaim: Challenger · Ahri main
  url: https://www.mobafire.com/league-of-legends/build/26-20-pengs-ahri-guide-5-1mil-points-13x-challenger-648700
  kind: mobafire
```

All five fields are required. Ids must be unique lowercase letters/digits with
optional `_` or `-`. Kinds are `mobafire` or `sheet`. URLs require HTTPS without
credentials or a custom port, with one of these exact hosts:
`mobafire.com`, `www.mobafire.com`, `docs.google.com`, `youtube.com`,
`www.youtube.com`, `youtu.be`. Vetting remains a maintainer decision; the build
checks the registry and URL rules, without visiting links.

## Validation and output

Every guide must have exactly three key tips. At least two of `Early lane`,
`Mid lane`, `Win condition` must each have at least two main pair tips. Every tip
in key tips, phase sections, alternatives, shared cores and itemization needs a
source. Shared tips and alternative tips do not fill a gap in the pair-tip bar.
Errors name the file and line, for example:
`guides/Ahri/Zed-mid.md:18: required field sources is missing`.

The compiler emits only `MatchupGuide` fields: numeric `champion` and `enemy`,
`lane`, `patch`, `reviewed`, `difficulty`, `favoredWhen`, `keyTips`, `enemyTips`,
`sections`, `itemization`, `sources`. The development-only `fixture` field is
never emitted. Each champion file has `schema: 1`, `champion`, `generatedAt`,
`guides`. Files larger than 2,000,000 UTF-8 bytes fail the build.

`dist/index.json` has `schema: 1`, `generatedAt`, and `champions` keyed by numeric
champion id. Each entry has `sha256` (the exact champion JSON file's bytes,
including the final newline) and `guides` (count). Only champions with guides
are listed. All files in a build share one UTC timestamp. Guide order is stable
by enemy id, then lane. Validation finishes before replacing the previous output;
a successful rebuild removes files for deleted guides.

`npm test` uses Node's built-in test runner. It checks exact deep equality with
the saved Ahri-vs-Zed app fixture after removing only `fixture`, plus invalid
inputs for the validation rules, shared cores, optional formats and on-disk
output. The saved fixture came from `src/full-app/fixtures/ahriVsZed.ts` and
`zedCore.ts` in the Swapper worktree on 2026-10-27; tests need no Swapper checkout
or network.

To update the local champion snapshot, explicitly run:

```sh
npm run refresh:champions
```

This is the only command that fetches content, from CommunityDragon's
[champion-summary.json](https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/champion-summary.json).
It omits the placeholder and Jade mode variants, sorts by id and keeps just
`id` and `name`. Review the resulting `champions.json` diff along with content
changes. The build never refreshes this snapshot automatically.

## Publishing

Pull requests targeting `main` run tests and the build with read-only repository
permissions. Pushes to `main` run those checks, then a separate job builds and
publishes only `dist/` contents to the `dist` branch. That job has
`contents: write` and uses the repository's built-in GitHub token. Its only push
target is `HEAD:refs/heads/dist`; it replaces that generated branch's history.
Source branches are not pushed by the workflow.

Once the maintainer creates the public `Phamezan/swapper-guides` remote and pushes
the source to `main`, the app can fetch:

- [index.json](https://raw.githubusercontent.com/Phamezan/swapper-guides/dist/index.json)
- [champions/103.json](https://raw.githubusercontent.com/Phamezan/swapper-guides/dist/champions/103.json)

GitHub Actions must be enabled and repository rules must allow the workflow to
write the generated `dist` branch. Publishing has not been run locally.
