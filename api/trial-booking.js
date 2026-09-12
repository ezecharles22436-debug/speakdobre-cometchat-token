const {
  HttpError,
  assertAllowedOrigin,
  assertJsonRequest,
  cancelBooking,
  createOrUpdateBooking,
  generateAvailableSlots,
  getBookingForMember,
  loadEligibility,
  publicBooking,
  requireTrialEnvironment,
  safeError,
  setCors,
  trialBookingEnabled,
  validateBookingInput,
  verifyMember
} = require("./_trial-booking-shared");

module.exports = async function handler(req, res) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (!trialBookingEnabled()) return res.status(503).json({ error: "Trial booking is not available yet.", code: "FEATURE_DISABLED" });
  if (!["GET", "POST"].includes(req.method)) {
    res.setHeader("Allow", "GET, POST, OPTIONS");
    return res.status(405).json({ error: "Method not allowed." });
  }

  try {
    requireTrialEnvironment();
    assertAllowedOrigin(req);
    const authenticated = await verifyMember(req);
    if (req.method === "GET") {
      const booking = await getBookingForMember(authenticated.memberId);
      const eligibility = await loadEligibility(authenticated.email);
      const eligible = eligibility?.status === "eligible" || eligibility?.status === "booked";
      return res.status(200).json({
        ok: true,
        eligible,
        booking: publicBooking(booking),
        slots: !eligible ? [] : generateAvailableSlots()
      });
    }

    assertJsonRequest(req);
    const validated = validateBookingInput(req.body);
    const result = validated.action === "cancel"
      ? await cancelBooking(authenticated)
      : await createOrUpdateBooking(authenticated, validated);
    return res.status(result.notificationsPending ? 202 : 200).json({ ok: true, ...result });
  } catch (error) {
    console.error("Trial booking endpoint failed:", safeError(error));
    if (error instanceof HttpError) {
      return res.status(error.status).json({ error: error.publicMessage, code: error.code, booking: error.details || undefined });
    }
    return res.status(500).json({ error: "Unable to manage the trial lesson.", code: "TRIAL_BOOKING_FAILED" });
  }
};
