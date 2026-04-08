# `@lockweb/qa-workflow`

Playwright-powered QA workflow tooling for recording tests, running targeted test sets, capturing visual baselines, comparing snapshots, and generating shareable reports.

This package is built around a reusable CLI-first workflow exposed through `qaw`.

Author: Chris Lock
Owner: Lock Web Development LLC

## Status

This package is public, but it is not open source at this time. It currently uses the `UNLICENSED` license while the public API and reuse terms are still being finalized.

## Goals

- Make Playwright setup easier to adopt.
- Make test recording and publishing easier to manage.
- Support targeted test execution across suites and targets.
- Provide visual regression capture and compare workflows.
- Generate review-friendly reports that are easier to share with stakeholders.

## CLI

The primary CLI entrypoints are:

```bash
qaw
qaw init
qaw validate
```

`qaw` opens the interactive menu by default.

Additional commands are available when a project wants to call the package more directly:

```bash
qaw menu
qaw record
qaw run
qaw publish
qaw visual capture
qaw visual compare
```

## Project Setup

For a one-off setup command:

```bash
npx qaw init
```

`qaw init` can:

- ask where workflow files should live and set `paths.rootDir`
- create `qa-workflow.config.json`
- create a sample visual regression CSV at `<rootDir>/visual-regression/sample.csv`
- create `playwright.config.js`
- add a local npm script such as `npm run qaw`

`playwright.config.js` is required for running tests through `qa-workflow`. It scopes Playwright to the package-managed test directory so Playwright does not auto-discover unrelated `*.spec.*` files elsewhere in the repo.

After the package is installed in a project, the same commands can be run through the local binary or a repo script.

The package also includes a config validation command:

```bash
npx qaw validate --config ./qa-workflow.config.json
```

`qaw validate` checks:

- config file presence and JSON parsing
- consumer `playwright.config.js` presence
- `suites` structure
- target definitions and `baseUrl` values
- referenced CSV file paths
- persona support module paths when personas are configured
- selector and boolean field types
- basic path configuration sanity

## Configuration

The tool is structured around project-level configuration rather than hardcoded project logic.

Example:

```json
{
  "paths": {
    "rootDir": "."
  },
  "suites": {
    "public-suite": {
      "defaultRequiresLogin": false,
      "personas": {
        "admin": {
          "label": "Administrator",
          "username": "alice",
          "password": "example-password"
        },
        "editor": {
          "label": "Editor",
          "accountId": "editor-123"
        }
      },
      "personaSupport": {
        "module": "qa-workflow/support/persona-switch.cjs"
      },
      "full": true,
      "selectors": {
        "header": "header",
        "main": "main",
        "footer": "footer"
      },
      "csvSets": {
        "main-menu": "visual-regression/public-suite/main-menu.csv",
        "homepage": "visual-regression/public-suite/homepage.csv"
      },
      "targets": {
        "local": {
          "baseUrl": "https://local.example.test"
        },
        "preview": {
          "baseUrl": "https://preview.example.gov"
        },
        "prod": {
          "baseUrl": "https://www.example.gov"
        }
      }
    }
  }
}
```

## Config Reference

Configuration fields:

- `paths.rootDir`
  Base workflow folder inside the consuming repo. Standard subpaths are derived from this automatically.
- `paths.testsDir`
  Optional override for the tests root. Default: `<rootDir>/tests`
- `paths.recordedDir`
  Optional override for raw recorded specs. Default: `<testsDir>/recorded`
- `paths.specsDir`
  Optional override for published specs. Default: `<testsDir>/specs`
- `paths.supportDir`
  Optional override for consumer-owned support files such as persona switch modules. Default: `<testsDir>/support`
- `paths.authDir`
  Optional override for saved auth state. Default: `<rootDir>/auth/.auth`
- `paths.visualDir`
  Optional override for visual regression assets. Default: `<rootDir>/visual-regression`
- `paths.visualRunsDir`
  Optional override for captured visual runs. Default: `<visualDir>/runs`
- `paths.visualReportsDir`
  Optional override for generated visual reports. Default: `<visualDir>/reports`
- `suites`
  Ordered collection of logical test buckets. The first suite listed is treated as the default suite.
- `suites.<suite>.defaultRequiresLogin`
  Default login requirement for that suite. Tests can still override this at the test level.
- `suites.<suite>.personas`
  Optional ordered map of persona keys to persona metadata. Extra fields are allowed and are passed through to the consumer persona support module unchanged.
- `suites.<suite>.personaSupport.module`
  Optional project-relative path to the consumer-provided persona switch module. This module should export `switchPersona(page, personaKey, persona, context)` and may export `resetPersona(page, context)`.
- `suites.<suite>.full`
  Optional boolean controlling full-page visual capture and compare. Default: `true`
- `suites.<suite>.selectors`
  Optional ordered map of region names to selectors used for visual regression capture and compare. Each configured key becomes its own report section and can be combined with full-page capture.
- `suites.<suite>.csvSets`
  Ordered map of visual regression CSV names to project-relative file paths. The first CSV listed is treated as the default for that suite.
- `suites.<suite>.targets`
  Ordered map of runnable endpoints for that suite. The first target listed is treated as the default target for that suite.
- `suites.<suite>.targets.<target>.baseUrl`
  Base URL used when running tests, recording tests, or capturing visual snapshots for that target.

Default behavior:

- first suite listed = default suite
- first target listed in that suite = default target
- first CSV listed in that suite = default visual regression CSV
- full-page capture is enabled unless `suites.<suite>.full` is set to `false`

This lets a project keep the config minimal while still allowing any path or suite-specific behavior to be overridden explicitly.

Persona behavior:

- if a suite does not define personas and persona support, publish does not ask about personas
- if a suite defines personas and a persona support module, publish offers those personas
- if a test references a persona that no longer exists in suite config, runtime fails with a clear message
- if a test does not set a persona:
  - no auth required = anonymous user
  - auth required = base logged-in user

## Repo Boundary

`qa-workflow` is the shared engine. Consuming repositories own their local setup and assets.

Package-owned:

- CLI entrypoints
- config loading and default resolution
- auth orchestration
- run / record / publish logic
- visual capture, compare, and reporting
- generic persona orchestration
- sanitized scaffolding in `templates/`

Consumer-owned:

- `qa-workflow.config.json`
- `playwright.config.js`
- suite definitions and target URLs
- visual regression CSV files
- published specs
- recorded specs
- saved auth state
- persona switch modules and other project-specific support code

If `playwright.config.js` is missing, `qaw run` may cause Playwright to scan unrelated tests in the consuming repo. The simplest fix is to run `npx qaw init` and create it.

This package should not contain real consumer target URLs, real consumer CSVs, published specs, recorded specs, auth state, or project-specific persona switch logic.

## Maintainer Notes

The sections below are for package maintenance, not for consuming projects.

### Package Layout

Current package structure:

- `bin/`
  Thin CLI entrypoints such as `qaw`
- `src/cli/`
  Command parsing, menu flow, setup, validation, and maintenance commands
- `src/config/`
  Config loading, defaults, and target resolution
- `src/auth/`
  Auth state and login helpers
- `src/run/`
  Record, publish, run, and listing flows
- `src/visual/`
  Visual capture, compare, report generation, and visual menu flow
- `src/support/`
  Package-owned support helpers such as persona orchestration
- `templates/`
  Sanitized files used by `qaw init`

### Local Development

Common local development commands in this repo:

```bash
npm run qaw
npm run smoke:cli
npm test
npm run record
npm run run:interactive
npm run visual:interactive
```

The short CLI name exposed by the package is:

```bash
qaw
```

The package repo also includes a smoke check for CLI and config loading:

```bash
npm run smoke:cli
```

Maintainer-facing package tests run with:

```bash
npm test
```

### Published Package Contents

Published package contents are intentionally limited to:

- `bin/`
- `src/`
- `templates/`
- `README.md`
- `LICENSE`
