# Labeloo Remediation Tracker (full audit, 2026-06-03)

Audit: 48 verified issues. Fixing in TDD waves; each wave committed + verified (tests + live docker).
Severity note (owner re-triage): "test type errors break docker" is FALSE (docker runs now; ts-node-dev only compiles the src entry graph, not test files) → low. organizations route brace is not a compile-break (backend boots) → verify as logic.

## Wave 1 — Backend security hardening (HIGH exploitability)
- [ ] users GET/PUT/toggle: trust `id` header → IDOR. Fix: operate on `jwtPayload.userId` (self-scope). TEST.
- [ ] bucket /public/:uuid + /taskData/:projectId/:fileName: path traversal (unsanitized params in fs path). Fix: validate UUID, sanitize fileName, path.resolve boundary check. TEST.
- [ ] CORS allowHeaders ['*'] + credentials:true (src/index.ts) → explicit headers.
- [ ] script.ts:42 logs plaintext password → remove.
- [ ] utils.ts:46 console.log('Permissions found') → remove.
- [ ] fix 2 test-file type errors (`let app: Hono<{Variables}>`) + add `typecheck` npm script.

## Wave 2 — Backend IDOR membership checks (trust client org/project IDs)
Add membership/permission verification before acting. Use existing utils.ts checkOrganizationPermission/checkProjectPermission or a new assertMembership helper.
- [ ] projects GET /all (orgId header) — already filters by userId via projectRelations; add explicit org membership assert.
- [ ] projectRelations /users + /addUser (projectId header) — verify membership/role.
- [ ] organizationRoles getById + delete (no membership / no orgId in WHERE).
- [ ] projectRoles getById.
- [ ] backendRelations all endpoints (orgId header, no membership).
- [ ] annotations GET /task/:taskId + POST / (no project membership check).
- [ ] organizations GET /:id — VERIFY (getOrganizationById takes userId; may already check). Confirm before changing.
- [ ] /bucket/taskData auth — RISKY: frontend loads images; check AuthenticatedImage.vue/useImageUrl before moving behind JWT.

## Wave 3 — Backend correctness
- [ ] organizations route.ts:~97 brace/return logic (verify).
- [ ] organizationRelations.service hardcoded roleId=1 (lines 162,237) → use permissionFlags.admin.
- [ ] organizationRelations delete: no rows-affected verification.
- [ ] tasks route delete: validateSingleTaskOperationPermissions(...,'assign') → add 'delete' op type.
- [ ] script.ts idempotency (existence checks before insert).
- [ ] t.service (organizationRelations) leftover file — check/remove.

## Wave 4 — Package D: real dataset export
- [ ] tasks/service.ts:1120 YOLO/COCO writes `.placeholder` → embed real image bytes from bucket.
- [ ] tasks/service.ts:1067 bare `return` in export loop → `continue` (else whole export aborts on one bad dim).

## Wave 5 — Frontend stubs (wire to existing backend)
- [ ] ProjectsSection editProject/deleteProject console.log stubs.
- [ ] ProjectUsersSection Add User (no handler).
- [ ] ProjectTasksSection Create Task + mock data.
- [ ] ProjectSettingsSection Archive/Delete buttons (no handler).
- [ ] SettingsSection logo upload + transfer ownership ("coming soon").

## Wave 6 — Frontend correctness
- [ ] useAuth.ts: use useApi/runtimeConfig (not import.meta.env), validate token, surface errors.
- [ ] useApi.ts token guard.
- [ ] nuxt.config.ts remove hardcoded Windows fs.allow paths + duplicate apiUrl define.

## Parked (do NOT fix): all AI/SAM2/magic-stick. Already-fixed: /query, central JWT_SECRET, bucket jwt secret, .env untrack, annotation self-approval, ContentfulStatusCode.
