# Trial lesson booking

This feature adds one account-bound, private trial-lesson booking per Memberstack member. It is disabled unless `TRIAL_BOOKING_ENABLED=true`.

## Business rules

- A matching assessment submission makes the account email eligible.
- The lesson is free and lasts 30 minutes.
- Students may choose a server-generated slot within the next 14 days.
- Slots begin every 30 minutes from 06:00 through 00:30 in `Europe/Kyiv`.
- More than one student may choose the same time. Bookings are independent; no group is formed.
- No teacher is assigned or disclosed by this service.
- One member may have only one scheduled trial at a time.
- The minimum notice is 120 minutes by default.
- The reminder is due 120 minutes before the lesson by default. An hourly Zapier schedule therefore normally delivers it 60–120 minutes before the lesson.
- Email is the guaranteed fallback. Messenger delivery is not promised until an official channel integration exists.

## Required environment variables

| Name | Purpose |
| --- | --- |
| `TRIAL_BOOKING_ENABLED` | Feature flag; must be exactly `true` to enable persistence and booking. |
| `MEMBERSTACK_SECRET_KEY` | Verifies the browser session and loads the authoritative account email. |
| `FIREBASE_PROJECT_ID` | Firestore project containing eligibility and booking records. |
| `FIREBASE_CLIENT_EMAIL` | Firebase service-account identity. |
| `FIREBASE_PRIVATE_KEY` | Firebase service-account private key. Never expose it to Webflow or the browser. |
| `TRIAL_ELIGIBILITY_HMAC_SECRET` | HMAC key used to derive a non-reversible eligibility document ID from email. |
| `ALLOWED_ORIGINS` | Comma-separated exact Webflow staging and production origins. |
| `ZAPIER_TRIAL_BOOKING_WEBHOOK_URL` | Private Catch Hook for transactional booking events. |
| `CRON_SECRET` | Bearer secret used by the reminder endpoint. |

Optional: `TRIAL_BOOKING_MIN_NOTICE_MINUTES` (default `120`) and `TRIAL_REMINDER_LEAD_MINUTES` (default `120`).

For isolated Preview testing, set `TRIAL_BOOKING_DATA_NAMESPACE=preview_trial_booking` (or another short environment-specific value). This prefixes both Firestore collections so synthetic Preview records cannot overlap production records. Leave it empty in Production.

## Data and trust boundaries

- The browser supplies only slot, meeting preference, and contact preference.
- Member ID and email are always taken from a server-verified Memberstack session.
- The server validates the requested UTC instant against the rolling window, half-hour boundary, and Kyiv operating hours.
- Firestore uses deterministic member and email hashes as document IDs. The booking document still contains the contact data required for transactional messages; Firestore access must remain server-only.
- The first booking uses an atomic Firestore create. Later updates use an update-time precondition to prevent simultaneous overwrite.

Collections:

- `trialBookingEligibility/{HMAC(email)}` — assessment eligibility and booking link state.
- `trialBookings/{SHA256(memberId)}` — current booking, retry state, and reminder state.

## Zapier events

The webhook may receive:

- `trial-booking-created`
- `trial-booking-rescheduled`
- `trial-booking-cancelled`
- `trial-booking-reminder`

Use `idempotencyKey` as the Zap's deduplication key before any email or staff notification step. The Zap must:

1. send the immediate summary to `studentEmail` for created/rescheduled events;
2. notify the SpeakDobre mailbox for created/rescheduled/cancelled events;
3. send the reminder only for `trial-booking-reminder`;
4. treat all inserted values as text, not HTML;
5. never log webhook URLs, service credentials, or message bodies containing personal data.

The API uses a short sending lease to stop concurrent scheduler runs from intentionally duplicating delivery. A provider-side idempotency check is still required because a process can stop after Zapier accepts an event but before Firestore records success.

Because the connected Vercel project is on Hobby, reminders are not scheduled with Vercel Cron. Configure a separate `Schedule by Zapier` trigger every hour, followed by `Webhooks by Zapier` calling `POST /api/trial-booking-reminders` with `Authorization: Bearer {CRON_SECRET}`. The endpoint scans only the namespace selected by `TRIAL_BOOKING_DATA_NAMESPACE`.

## Manual assessment reply

Assessment replies remain manual. The approved reply should include:

`https://www.speakdobre.com/profile?section=trial-lesson`

Tell the student to sign in or create an account using the same email address used for the assessment. Do not promise a particular teacher or meeting platform in the reply.

Suggested Ukrainian reply:

> Вітаємо, {ім’я}! Дякуємо за відповіді — ми готові запросити вас на безкоштовний 30-хвилинний пробний урок. Увійдіть або створіть акаунт з тією самою електронною адресою, яку вказали в оцінюванні, а потім оберіть зручну дату й час за київським часом: https://www.speakdobre.com/profile?section=trial-lesson. Після бронювання ви отримаєте підтвердження. Викладача та посилання на зустріч ми повідомимо окремо.

## Transactional email copy

Created/rescheduled subject: `Ваш пробний урок SpeakDobre заброньовано — {startKyiv}`

Student body must include: free price (`0 ₴`), exact Kyiv date and time, 30-minute duration, selected meeting preference, selected contact method, the Profile manage link, and a note that the teacher and meeting link will be confirmed separately.

Reminder subject: `Нагадування: пробний урок SpeakDobre приблизно за годину`

Reminder body must repeat the exact Kyiv date and time, duration, confirmed platform/link when available, and a reply/contact route. If no official messenger delivery is configured, send this email regardless of the selected contact preference.

Cancellation subject: `Пробний урок SpeakDobre скасовано`

The staff notification must contain the event type, student name/email, exact Kyiv date and time, meeting/contact preference, and booking ID. Do not include credentials, Memberstack tokens, or Firebase identifiers.

## Activation checklist

1. Deploy to an isolated Preview environment with separate Firebase data and a non-customer Zapier test path.
2. Add all variables above to Preview only and set `TRIAL_BOOKING_ENABLED=true` there.
3. Test eligible, ineligible, booked, rescheduled, cancelled, duplicate-click, webhook-failure, and reminder flows without sending a real customer email.
4. Insert the reviewed Profile block and publish to Webflow staging only.
5. After approval, configure production variables, publish the Zap, deploy the backend, then publish Webflow production.
