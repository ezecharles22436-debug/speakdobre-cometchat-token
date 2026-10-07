const labels = new Map([
  ['spam', 'Спам або небажаний вміст'],
  ['spam / unwanted content', 'Спам або небажаний вміст'],
  ['sexual content', 'Відвертий або неприйнятний вміст'],
  ['harassment / bullying', 'Образи або погрози'],
]);

// Keep provider IDs unchanged; translate presentation only.
export function reportReasonLabel(reason) {
  const name = String(reason?.name || '').trim();
  return labels.get(name.toLowerCase()) || (/^[\p{Script=Cyrillic}\s\p{P}]+$/u.test(name) ? name : 'Інше порушення');
}

export function reportErrorText(error) {
  // Never expose provider descriptions, tokens, request bodies, or message text.
  const code = typeof error?.code === 'string' && /^ERR_[A-Z_]{1,64}$/.test(error.code) ? error.code : '';
  return 'Не вдалося надіслати скаргу. Спробуйте пізніше або зверніться до модератора.' + (code ? ` Код: ${code}.` : '');
}

export async function submitReport(sdk, messageId, reasonId, remark) {
  if (!String(messageId || '').trim() || !String(reasonId || '').trim()) throw Error('Invalid report');
  const text = String(remark || '').trim().slice(0, 500);
  const result = await sdk.flagMessage(String(messageId), { reasonId, ...(text ? { remark: text } : {}) });
  if (result?.success !== true) throw Error('Report not confirmed');
  return true;
}
