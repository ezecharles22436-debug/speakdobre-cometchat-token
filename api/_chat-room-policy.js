// Server-owned policy. Do not accept role, scope or member ID from a selection request.
const ROOMS = Object.freeze([
  ['speakdobre-a1', 'A1–A2 · Початковий', 'level', 'Для перших упевнених розмов.'],
  ['speakdobre-b1', 'B1–B2 · Середній', 'level', 'Для вільнішого щоденного спілкування.'],
  ['speakdobre-c1', 'C1 · Просунутий', 'level', 'Для складних тем і точного висловлення думок.'],
  ['speakdobre-c2', 'C2 · Вільне володіння', 'level', 'Для тонкощів мови та глибоких дискусій.'],
  ['speakdobre-travel', 'Подорожі', 'topic', 'Англійська для нових місць і вражень.'],
  ['speakdobre-business', 'Ділова англійська', 'topic', 'Робота, зустрічі та професійне спілкування.'],
  ['speakdobre-job-interview', 'Співбесіди', 'topic', 'Розповідайте про себе та свій досвід.'],
  ['speakdobre-ielts-toefl', 'Підготовка до IELTS / TOEFL', 'topic', 'Обговорення тем і практика для іспитів.'],
  ['speakdobre-listening-reading', 'Клуб читання й аудіювання', 'topic', 'Обговорюйте прочитане та почуте.'],
  ['speakdobre-movies-tv', 'Кіно та серіали', 'topic', 'Історії, герої та ваші улюблені сцени.'],
  ['speakdobre-music-lovers', 'Музика', 'topic', 'Пісні, виконавці та нові відкриття.'],
  ['speakdobre-sports-gaming', 'Спорт та ігри', 'topic', 'Захоплення, команди й спільні інтереси.'],
  ['speakdobre-food-cooking', 'Їжа та кулінарія', 'topic', 'Смаки, рецепти та кулінарні традиції.'],
  ['speakdobre-culture-exchange', 'Культурний обмін', 'topic', 'Традиції та життя в різних країнах.'],
  ['speakdobre-ukrainian-gossip', 'Українська спільнота', 'topic', 'Знайомі теми — англійською.'],
  ['speakdobre-international-gossip', 'Міжнародна спільнота', 'topic', 'Світові події та повсякденне життя.']
].map(([guid, name, kind, description]) => Object.freeze({ guid, name, kind, description })));

class SelectionError extends Error {
  constructor(code, message) { super(message); this.code = code; this.status = 400; }
}

function validateSelection(input) {
  if (!Array.isArray(input) || input.length < 1 || input.length > 3) {
    throw new SelectionError('ROOM_LIMIT', 'Оберіть від однієї до трьох груп.');
  }
  if (input.some(id => typeof id !== 'string') || new Set(input).size !== input.length) {
    throw new SelectionError('INVALID_SELECTION', 'Перевірте обрані групи.');
  }
  const selected = input.map(id => ROOMS.find(room => room.guid === id));
  if (selected.some(room => !room)) {
    throw new SelectionError('UNKNOWN_ROOM', 'Ця група недоступна для вибору.');
  }
  if (selected.filter(room => room.kind === 'level').length !== 1) {
    throw new SelectionError('ONE_LEVEL_REQUIRED', 'Оберіть одну групу за рівнем англійської.');
  }
  return selected.map(room => room.guid).sort();
}

function roleForMember(memberId, trustedConfig = {}) {
  if (!/^mem_[A-Za-z0-9_-]{1,96}$/.test(String(memberId || ''))) {
    throw new SelectionError('INVALID_MEMBER', 'Потрібно увійти до акаунта.');
  }
  if ((trustedConfig.superModeratorIds || []).includes(memberId)) return 'super_moderator';
  if ((trustedConfig.moderatorIds || []).includes(memberId)) return 'moderator';
  return 'student';
}

function membershipDelta(currentIds, requestedIds) {
  const desired = validateSelection(requestedIds);
  if (!Array.isArray(currentIds) || currentIds.some(id => typeof id !== 'string')) {
    throw new Error('Verified current memberships are required.');
  }
  // Caller must serialize per member, remove first, verify removals, then add.
  // The delta alone is not a concurrency or authorization mechanism.
  return {
    remove: [...new Set(currentIds)].filter(id => !desired.includes(id)),
    add: desired.filter(id => !currentIds.includes(id)),
    desired,
    scope: 'participant'
  };
}

module.exports = { ROOMS, SelectionError, validateSelection, roleForMember, membershipDelta };
