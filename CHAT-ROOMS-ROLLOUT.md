# Practice Chat group selection — implementation in progress

## Local implementation

- `GET /api/chat-rooms`: authenticated student catalog and current memberships.
- `POST /api/chat-rooms`: accepts only `{ "rooms": [...] }`; identity comes from Memberstack verification.
- One level room (A1–A2, B1–B2, C1, C2), zero to two topic rooms.
- Durable Firestore compare-and-swap lock, no automatic stale-lock takeover.
- Remove old memberships and verify before additions; verify final state and current entitlement.
- Banned groups are rejected; elevated existing membership requires staff review.
- Provider response failures fail closed; per-user addition results are checked.
- UI prototype: workspace `outputs/speakdobre-group-selection-preview.html` (not connected to this endpoint yet).

## Preview configuration (not yet applied)

- `CHAT_ROOMS_ENABLED=true` only after permission verification below.
- `CHAT_ROOMS_PERMISSIONS_VERIFIED=true` only after real SDK negative tests pass.
- `CHAT_ROOMS_DATA_NAMESPACE=preview_room_selection`.
- Existing Preview-only Firebase and Memberstack Test Mode credentials.
- A separate CometChat test app, its server-only key and matching private test rooms.
- `CHAT_SUPER_MODERATOR_IDS`: verified Test Mode owner ID. Never use an email/custom field as authorization.
- `CHAT_MODERATOR_IDS`: empty until designated moderator identities are supplied.
- ALLOWED_ORIGINS limited to approved staging/Preview origins.

The existing live CometChat app must NOT be used to test app-wide permissions.
Vercel Preview alone does not isolate CometChat roles, groups or messaging.

## Owner identity read-only verification, 2026-10-06

Memberstack dashboard maps the user-designated owner email to separate accounts:
- Test Mode: `mem_sb_cmmwrrogh15540so99w7d7fmu`.
- Live Mode: `mem_cmre5k63v0hp20sqk5t781l56`.
No roles or permissions were changed during verification.

## Required before enabling

1. Provision student/moderator/super-moderator roles in isolated CometChat app.
2. Deny student self-join/create-group and student-to-student DM/call operations at provider level, not merely UI.
3. Allow student contact/replies to staff, moderator contact/calls to students, and group messaging.
4. Test user listing/details, existing private conversations/history and group member views for privacy boundaries.
5. Give moderators all school rooms, moderation rights but no group deletion; only owner deletes groups.
6. Integrate trusted roles and staff access in token endpoint, without client-controlled elevation.
7. Wire Ukrainian picker into chat bootstrap before starting chat; replace assignment-waiting copy; update payment-success routing only after entitlement confirmed.
8. Test all role combinations, subscriptions/revocation races, mobile/desktop, retries and provider timeouts against isolated app.
9. Reconcile failed operations only after confirming previous worker is terminated and provider membership calls settled. Never clear locks using age alone.
10. Obtain approval for production role migration, backend rollout and Webflow publication after Preview checks.

## Known limitations / remaining work

Local mocked tests do not prove CometChat RBAC semantics or dashboard plan capabilities.
Provider ban checks and additions are separate calls: moderator changes can race; verify CometChat rejects adding a banned member, and design reconciliation if necessary.
Access-revocation integration must prevent/clean membership additions racing with subscription expiry.
Default token flow is unchanged so deployed behavior is unchanged while feature remains off.
No automatic self-repair of uncertain locks is implemented; safety takes precedence over availability.
No production release is ready yet.

## Documentation used

- https://www.cometchat.com/docs/rest-api/groups/list
- https://www.cometchat.com/docs/rest-api/group-members/add-members
- https://www.cometchat.com/docs/rest-api/banned-users/list
