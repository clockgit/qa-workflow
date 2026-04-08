# QA Workflow Architecture Notes

## Current Direction

These notes capture the current model decisions for turning the copied baseline into a reusable package. This is the working plan, not a final schema contract.

## Core Model

- `suite` is the primary logical collection of tests and defaults.
- A suite owns related tests, CSV sets, selectors, and default behavior.
- `target` is the runnable endpoint selected for a given suite.

## Targets

- `target` belongs to a suite.
- Different suites may support different target sets.
- There should not be a single global target list that every suite must share.

Targets can represent deployment stages, runtime variants, or any other named endpoint that should be selectable for a suite.

## Login Model

- Login should not be treated as primarily suite-specific.
- Login is a test-level requirement.
- Suite config may provide a default, but the test metadata should be the source of truth for whether a given test requires login.

Decision order:

1. explicit test-level `requiresLogin`
2. suite default

This allows one suite to support both public and authenticated tests without forcing the whole suite into one auth mode.

## Test Targeting

Tests should be able to declare compatibility using:

- direct suite targeting
- optional explicit multi-suite support later if needed

## Config Direction

The current config work should move toward:

- package-level defaults
- suite definitions
- per-suite targets
- suite defaults for selectors and behavior
- path locations
- CSV set definitions

Avoid building more code around the old assumptions of:

- global target lists
- suite-level auth as the primary rule
- a separate long-term `surface` abstraction
- a required grouping abstraction before it is needed

## Practical Refactor Goal

Near-term goal:

- stabilize the config model before refactoring too much more code

Refactor target:

- `suite`
- `target` nested under suite
- test-level login and compatibility metadata

## Ownership Map

The package repo should contain reusable engine code only.

Shared engine code in this repo:

- `package.json`
- `package-lock.json`
- `LICENSE`
- `README.md`
- `bin/qaw`
- `src/index.js`
- `src/config/index.js`
- `src/config/targets.js`
- `src/auth/auth-check.js`
- `src/auth/auth-state.js`
- `src/auth/manual-login.js`
- `src/auth/targeting.js`
- `src/cli/menu.js`
- `src/cli/init.js`
- `src/cli/setup-workspace.js`
- `src/cli/reset-workspace.js`
- `src/run/record-test.js`
- `src/run/publish-recording.js`
- `src/run/clean-recordings.js`
- `src/run/run-tests.js`
- `src/run/run-by-tag.js`
- `src/run/run-target.js`
- `src/run/run-standard-smoke.js`
- `src/run/create-auth-state.js`
- `src/run/list-targets.js`
- `src/run/workflow-utils.js`
- `src/visual/menu.js`
- `src/visual/index.js`
- `src/support/persona-test.ts`

Consumer-owned files in a consuming project:

- `qa-workflow.config.json`
- `playwright.config.js`
- visual regression CSV files
- published specs
- recorded specs
- saved auth state
- persona switch modules
- any other project-specific support code

Templates in this repo:

- `templates/qa-workflow.config.json`
- `templates/playwright.config.js`
- `templates/visual-regression/sample.csv`

Future templates may include:

- sanitized sample persona switch modules
- template files used to scaffold other consumer-owned support code

The package repo should not contain:

- real target URLs for a consuming project
- real suite definitions for a consuming project
- project-specific CSV files
- project-specific recorded specs
- project-specific published specs
- project-specific auth state
- project-specific persona switch logic

## Planned Package Layout

The current flat layout is still workable, but the long-term package shape should separate:

- CLI entrypoints
- command wiring
- shared engine modules
- consumer-facing scaffolds

Target layout:

- `bin/`
  - thin executable entrypoints such as `qaw`
- `src/cli/`
  - command parsing
  - menu flow
  - interactive setup flow
- `src/config/`
  - config loading
  - config defaults
  - future schema validation
- `src/auth/`
  - auth state helpers
  - auth checks
  - targeting helpers used for login decisions
- `src/run/`
  - run orchestration
  - record flow
  - publish flow
  - tag filtering helpers
- `src/visual/`
  - capture
  - compare
  - report generation
  - visual menu flow
- `src/support/`
  - package-owned support helpers such as persona orchestration
- `templates/`
  - sanitized scaffold files for `qaw init`

Planned mapping from current files:

Implemented package layout:

- `bin/qaw`
  - CLI entrypoint
- `src/cli/*`
  - command parsing and interactive entry flows
- `src/config/*`
  - config loading and target resolution
- `src/auth/*`
  - auth state and login helpers
- `src/run/*`
  - record, publish, run, and listing flows
- `src/visual/*`
  - visual capture, compare, report, and visual menu flow
- `src/support/persona-test.ts`
  - package-owned persona orchestration

What should not move into `templates/`:

- engine code
- report generation
- config loading
- auth orchestration

What belongs in `templates/`:

- sample `qa-workflow.config.json`
- sample `playwright.config.js`
- sample visual regression CSV
- sample persona switch module if persona scaffolding is added

Remaining structure work:

1. decide whether prompt/shared helpers should stay under `src/run` or move into a shared utility area
2. keep the command surface stable while consumer repos adopt the package

## Pre-Commit Cleanup

Before the first public commit:

- remove leftover copied project naming
- align the config shape with the architecture above
- make sure public docs describe the generic model rather than the copied baseline
