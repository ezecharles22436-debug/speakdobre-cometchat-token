const {
  HttpError,
  eventPayload,
  listBookings,
  patchDocument,
  safeError,
  sendBookingEvent,
  trialBookingEnabled
} = require("./_trial-booking-shared");

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed." });
  }
  try {
    if (!trialBookingEnabled()) throw new HttpError(503, "Trial booking is disabled.", "FEATURE_DISABLED");
    const expected = String(process.env.CRON_SECRET || "");
    const supplied = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    if (!expected || !supplied || !timingSafeEqual(expected, supplied)) {
      throw new HttpError(401, "Authentication required.", "AUTH_REQUIRED");
    }

    const now = Date.now();
    const bookings = await listBookings();
    let remindersSent = 0;
    let notificationsRetried = 0;
    for (const booking of bookings) {
      const path = booking._documentName.split("/documents/")[1];
      if (!path) continue;

      const notificationAttempt = Date.parse(booking.notificationAttemptAt || "");
      const notificationLeaseExpired = booking.notificationStatus === "sending" && (!Number.isFinite(notificationAttempt) || now - notificationAttempt > 10 * 60_000);
      if (booking.notificationStatus === "pending" || notificationLeaseExpired) {
        const event = booking.pendingEvent || (booking.status === "cancelled" ? "trial-booking-cancelled" : "trial-booking-created");
        try {
          await patchDocument(path, {
            notificationStatus: "sending",
            notificationAttemptAt: new Date().toISOString()
          }, { updateTime: booking._updateTime });
          await sendBookingEvent(eventPayload(event, booking));
          await patchDocument(path, {
            notificationStatus: "sent",
            notificationSentAt: new Date().toISOString(),
            pendingEvent: ""
          });
          notificationsRetried++;
        } catch (error) {
          console.warn("Trial booking notification retry failed:", safeError(error));
          if (error?.code !== "BOOKING_CONFLICT") {
            try { await patchDocument(path, { notificationStatus: "pending" }); } catch {}
          }
        }
        continue;
      }

      const due = Date.parse(booking.reminderDueAt || "");
      const starts = Date.parse(booking.startAt || "");
      const reminderAttempt = Date.parse(booking.reminderAttemptAt || "");
      const reminderLeaseExpired = booking.reminderStatus === "sending" && (!Number.isFinite(reminderAttempt) || now - reminderAttempt > 10 * 60_000);
      if (booking.status !== "scheduled" || !(booking.reminderStatus === "pending" || reminderLeaseExpired) || !Number.isFinite(due) || !Number.isFinite(starts)) continue;
      if (now < due || now >= starts) continue;
      try {
        await patchDocument(path, {
          reminderStatus: "sending",
          reminderAttemptAt: new Date().toISOString()
        }, { updateTime: booking._updateTime });
        await sendBookingEvent(eventPayload("trial-booking-reminder", booking));
        await patchDocument(path, {
          reminderStatus: "sent",
          reminderSentAt: new Date().toISOString()
        });
        remindersSent++;
      } catch (error) {
        console.warn("Trial booking reminder retry failed:", safeError(error));
        if (error?.code !== "BOOKING_CONFLICT") {
          try { await patchDocument(path, { reminderStatus: "pending" }); } catch {}
        }
      }
    }
    return res.status(200).json({ ok: true, scanned: bookings.length, remindersSent, notificationsRetried });
  } catch (error) {
    console.error("Trial booking reminder endpoint failed:", safeError(error));
    if (error instanceof HttpError) return res.status(error.status).json({ error: error.publicMessage, code: error.code });
    return res.status(500).json({ error: "Unable to process trial reminders." });
  }
};

function timingSafeEqual(left, right) {
  const crypto = require("node:crypto");
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
