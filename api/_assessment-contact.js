// No network calls. Kept independent from payments, accounts and trial bookings.
const METHODS = Object.freeze({ telegram: 'Telegram', whatsapp: 'WhatsApp', viber: 'Viber', email: 'Електронна пошта' });

function assessmentContact(body, email) {
  const legacy = body.contactMethod === undefined && body.contactValue === undefined;
  if (legacy) return { contactMethod: 'email', contactValue: email, contactLabel: METHODS.email, contactSummary: `${METHODS.email}: ${email}`, contactSchemaVersion: 1 };
  const method = body.contactMethod;
  const raw = body.contactValue;
  if (!Object.hasOwn(METHODS, method) || (method !== 'email' && typeof raw !== 'string')) return null;
  if (raw != null && (typeof raw !== 'string' || raw.length > 80 || /[\u0000-\u001f\u007f]/.test(raw))) return null;
  let value = (raw || '').trim();
  if (method === 'email') value = email;
  else if (method === 'telegram' && /^@?[a-zA-Z][a-zA-Z0-9_]{4,31}$/.test(value)) value = '@' + value.replace(/^@/, '');
  else {
    // International numbers only; do not silently guess a student's country.
    if (!/^\+[0-9 ()-]+$/.test(value)) return null;
    value = value.replace(/[ ()-]/g, '');
    if (!/^\+[1-9]\d{7,14}$/.test(value)) return null;
  }
  return { contactMethod: method, contactValue: value, contactLabel: METHODS[method], contactSummary: `${METHODS[method]}: ${value}`, contactSchemaVersion: 2 };
}

module.exports = { assessmentContact };
