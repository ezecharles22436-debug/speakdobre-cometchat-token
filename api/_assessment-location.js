// Self-reported coarse location only: never infer IP, GPS or a street address.
function locationText(value, required) {
  if (value === undefined && !required) return '';
  if (typeof value !== 'string' || value.length > 80 || /[\p{C}<>@:/\\]/u.test(value) || /www\./i.test(value)) return null;
  const text = value.normalize('NFC').trim().replace(/\s+/g, ' ');
  if (!text && !required) return '';
  // The value is also forwarded to Google Sheets; never accept a formula prefix.
  if (text.length < 2 || !/[\p{L}]/u.test(text) || /^[=+\-]/u.test(text)) return null;
  return text;
}

function assessmentLocation(body) {
  const legacy = body.locationSchemaVersion === undefined && body.currentCountry === undefined && body.currentCity === undefined;
  if (legacy) return { currentCountry:'', currentCity:'', locationSummary:'Не вказано', locationSchemaVersion:0 };
  if (body.locationSchemaVersion !== 1) return null;
  const currentCountry = locationText(body.currentCountry, true);
  const currentCity = locationText(body.currentCity, false);
  if (currentCountry === null || currentCity === null) return null;
  return { currentCountry, currentCity, locationSummary:[currentCountry,currentCity].filter(Boolean).join(', '), locationSchemaVersion:1 };
}

module.exports = { assessmentLocation };
