const crypto = require("node:crypto");
const reminderHandler = require("./trial-booking-reminders");
const {
  BOOKING_COLLECTION,
  collectionName,
  createDocument,
  deleteDocument,
  getDocument,
  safeError
} = require("./_trial-booking-shared");

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed." });
  }
  const namespace = String(process.env.TRIAL_BOOKING_DATA_NAMESPACE || "");
  if (process.env.VERCEL_ENV !== "preview" || !/^preview_[a-z0-9_]+$/.test(namespace)) {
    return res.status(404).json({ error: "Not found." });
  }
  if (String(req.query?.confirm || "") !== "run-reminder-dedupe-test") {
    return res.status(400).json({ error: "Explicit test confirmation is required." });
  }

  const collection = collectionName(BOOKING_COLLECTION);
  const documentId = `reminder-test-${crypto.randomUUID()}`;
  const path = `${collection}/${documentId}`;
  const now = Date.now();
  let removed = false;
  try {
    const fixture = await createDocument(collection, documentId, {
      bookingId: crypto.randomUUID(),
      memberId: "synthetic-reminder-test",
      studentEmail: "reminder-test@example.invalid",
      studentName: "Synthetic Reminder Test",
      studentPhone: "",
      assessmentSubmissionId: "synthetic-reminder-test",
      startAt: new Date(now + 30 * 60_000).toISOString(),
      endAt: new Date(now + 60 * 60_000).toISOString(),
      timeZone: "Europe/Kyiv",
      durationMinutes: 30,
      meetingMethod: "google-meet",
      contactChannel: "email",
      contactValue: "",
      status: "scheduled",
      eventVersion: 1,
      createdAt: new Date(now).toISOString(),
      updatedAt: new Date(now).toISOString(),
      reminderDueAt: new Date(now - 60_000).toISOString(),
      reminderSentAt: "",
      reminderStatus: "pending",
      notificationStatus: "sent",
      notificationSentAt: new Date(now).toISOString(),
      pendingEvent: ""
    });
    const first = await reminderHandler.processBookings([fixture], now);
    const afterFirst = await getDocument(path);
    const second = await reminderHandler.processBookings([afterFirst], now + 1000);
    const finalRecord = await getDocument(path);
    await deleteDocument(path, { updateTime: finalRecord._updateTime });
    removed = true;
    return res.status(200).json({
      ok: first.remindersSent === 1 && second.remindersSent === 0 && finalRecord.reminderStatus === "sent",
      firstRemindersSent: first.remindersSent,
      secondRemindersSent: second.remindersSent,
      finalReminderStatus: finalRecord.reminderStatus,
      fixtureRemoved: true
    });
  } catch (error) {
    console.error("Preview reminder test failed:", safeError(error));
    return res.status(500).json({ error: "Preview reminder test failed.", fixtureRemoved: removed });
  } finally {
    if (!removed) {
      try { await deleteDocument(path); } catch {}
    }
  }
};
