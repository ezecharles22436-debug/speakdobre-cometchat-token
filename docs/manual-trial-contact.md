# Trial lessons are arranged manually

Students submit the assessment form with their preferred contact method. SpeakDobre contacts the student directly to agree a time. There is no online booking, rescheduling or booking-reminder service.

The assessment endpoint forwards the validated assessment to its existing staff notification webhook. It does not create booking-eligibility records. Practice Chat authentication and Firestore helpers are in `api/_platform-shared.js`; their configuration and chat namespaces remain unchanged.

Historical booking records are retained read-only. Payment/subscription trials, renewal reminders, promo codes and receipts are separate features and remain active.
