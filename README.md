# `@lockweb/qa-workflow`

Playwright-powered QA workflow tooling for recording tests, running targeted test sets, capturing visual baselines, comparing snapshots, and generating shareable reports.

This package is being shaped toward a reusable CLI-first workflow built around the `qaw` command.

Author: Chris Lock
Owner: Lock Web Development LLC

## Status

This package is public, but it is not open source at this time. The package currently uses the `UNLICENSED` license while the public API, package structure, and reuse terms are still being finalized.

## Goals

- Make Playwright setup easier to adopt.
- Make test recording and publishing easier to manage.
- Support targeted test execution across suites and targets.
- Provide visual regression capture and compare workflows.
- Generate review-friendly reports that are easier to share with stakeholders.

## Planned CLI

The intended end-state interface is a CLI built around `qaw`, for example:

```bash
qaw init
qaw validate
qaw menu
qaw record
qaw run
qaw publish
qaw visual capture
qaw visual compare
```

The current repository is still being refactored toward that package shape.

## Project Setup

The package includes an interactive setup command:

```bash
npx qaw init
```

`qaw init` can:

- ask where workflow files should live and set `paths.rootDir`
- create `qa-workflow.config.json`
- create a sample visual regression CSV at `<rootDir>/visual-regression/sample.csv`
- create `playwright.config.js`
- add a local npm script such as `npm run qaw`

The package also includes a config validation command:

```bash
npx qaw validate --config ./qa-workflow.config.json
```

`qaw validate` checks:

- config file presence and JSON parsing
- `suites` structure
- target definitions and `baseUrl` values
- referenced CSV file paths
- persona support module paths when personas are configured
- selector and boolean field types

## Configuration Direction

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

## Development Direction

The long-term split is:

- package repo: CLI, engine, reporting, config loading, shared templates
- consuming repo: local config, CSV sets, specs, and generated artifacts

Current ownership boundary:

- package-owned:
  - CLI entrypoints
  - run / record / publish / visual workflow logic
  - config loading and default resolution
  - auth orchestration
  - visual regression capture, compare, and reporting
  - generic persona orchestration
- consumer-owned:
  - `qa-workflow.config.json`
  - suite definitions and target URLs
  - visual regression CSV files
  - published specs
  - recorded specs
  - saved auth state
  - persona switch modules and any project-specific support code

In other words, this package should contain reusable engine code, while project-specific setup and test assets stay in the consuming repository.

## Local Development

Current local development entry points in this repo:

```bash
npm run qaw
npm run smoke:cli
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

## Next Steps

- finish extracting project-specific behavior into config
- stabilize the CLI command surface
- separate engine code from copied starter structure
- define the first supported public package shape
