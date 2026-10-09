# ADR-002: Zod as the single source of truth for validation, types and OpenAPI

## Context
The API needs request validation, typed handlers, response shaping and OpenAPI documentation. Maintaining these
separately (JSON Schema + TypeScript types + hand-written docs) drifts over time.

## Decision
Define each contract once as a Zod schema and derive everything from it:
- input validation (`params`, `querystring`) via a Fastify validator compiler;
- handler types via a small `ZodTypeProvider`;
- response serialization through the response schema (undeclared fields never leave the API);
- OpenAPI through `@fastify/swagger` with a transform based on `zod-to-json-schema`.

The adapter is ~60 lines in `src/shared/http/zod-provider.ts` instead of a third-party type-provider package.

## Alternatives
- `fastify-type-provider-zod`: fine, but its major versions are tied to specific Zod majors, and compatibility with
  the exact Fastify/Zod pair in use could not be verified up front. A small in-repo adapter removes that coupling.
- Native Fastify JSON Schema + Ajv: duplicates types and loses Zod's ergonomics.
- Hand-written OpenAPI: guaranteed to drift.

## Consequences
- One definition per contract; docs cannot disagree with runtime behavior.
- We own ~60 lines of glue and must keep it working across Fastify/Zod upgrades (covered by tests, including
  a test that the OpenAPI spec is generated).
- If the ecosystem package proves stable across our versions, swapping it in is a local change.
