# Ecommerce Engine — Engineering Rules

You are building a production-grade ecommerce engine incrementally.

## Core principle

Build the system **one step at a time**.

Never implement multiple unrelated modules in one task. Each task must leave the project in a working, buildable state.

## Architecture

* Backend: TypeScript.
* Use a modular architecture with clear boundaries between modules.
* Keep business logic independent from HTTP/framework-specific code wherever practical.
* Prefer small, composable, reusable functions.
* Keep infrastructure concerns separate from domain logic.
* Use strict TypeScript configuration.
* Use environment variables/configuration for deployment-specific values.
* Never hard-code secrets, credentials, API keys, database passwords, or production URLs.

## Reuse before creating

Before writing a new function:

1. Search the entire existing codebase for functionality that already satisfies the requirement.
2. If an existing function can satisfy the requirement, reuse it.
3. If it can satisfy the requirement with a small, backward-compatible improvement, improve and reuse it.
4. Only create a new function when the existing implementation genuinely cannot satisfy the requirement.
5. Avoid duplicate utilities, validators, repositories, services, formatters, API clients, and business rules.

Do not create abstractions merely for theoretical future reuse.

## Never break existing functionality

Before changing existing code:

* Identify all callers/usages.
* Understand the current behavior.
* Preserve existing public interfaces unless the current task explicitly requires a breaking change.
* Prefer backward-compatible changes.
* Update tests when behavior intentionally changes.
* Run the relevant tests after changes.
* Run the TypeScript build before considering the task complete.

If a change unexpectedly breaks existing functionality, fix the regression before proceeding.

## Every task must be incremental

For every requested module:

1. Inspect the current project.
2. Understand existing architecture and reusable functionality.
3. Define the smallest implementation required.
4. Implement only that scope.
5. Add/update tests.
6. Run lint/typecheck/tests/build.
7. Verify that existing functionality still works.
8. Report exactly what changed.

Do not silently implement future modules.

## Database

* Keep database access behind a clear persistence layer.
* Use migrations for schema changes.
* Never modify production data manually as part of normal development.
* Make migrations deterministic and reviewable.
* Avoid destructive migrations unless explicitly requested.

## API

* Keep API contracts explicit.
* Validate external input at system boundaries.
* Return consistent error structures.
* Do not expose internal errors, stack traces, secrets, or database details to clients.
* Keep authentication/authorization checks explicit.

## Configuration

Maintain a clear distinction between:

* development
* test
* staging
* production

Provide an example environment file containing variable names but never real secrets.

## Deployment

The application must be deployable from a clean checkout using documented steps.

Deployment configuration is part of the project and should be version-controlled, except for secrets.

Prefer:

* reproducible builds
* immutable build artifacts/images
* health checks
* graceful shutdown
* structured logging
* environment-based configuration
* database migration steps
* rollback-friendly deployments

## Git discipline

Make small, logically isolated commits.

Do not mix:

* refactoring
* feature development
* dependency upgrades
* formatting changes
* unrelated bug fixes

unless the task requires them.

## Definition of done

A task is NOT complete merely because the code was written.

A task is complete only when:

* the requested functionality works;
* existing functionality remains intact;
* TypeScript passes;
* tests pass;
* the production build passes;
* no unnecessary duplicate functionality was introduced;
* configuration/deployment implications have been handled;
* the implementation is documented where appropriate.

## Important restriction

Do not proceed to the next module automatically.

Stop after completing the requested step and report:

* files created/changed;
* functions reused;
* new functions introduced and why they were necessary;
* tests added/changed;
* commands executed and their results;
* deployment impact;
* any unresolved issues.

