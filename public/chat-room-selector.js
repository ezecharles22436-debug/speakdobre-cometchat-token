(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SpeakDobreRoomSelector = api;
})(typeof window === 'undefined' ? {} : window, function () {
  'use strict';
  function cooldownMessage(value) {
    const date = new Date(value);
    return Number.isFinite(date.getTime())
      ? `Наступна зміна груп доступна ${new Intl.DateTimeFormat('uk-UA', { timeZone: 'Europe/Kyiv', dateStyle: 'long', timeStyle: 'short' }).format(date)} (за київським часом).`
      : 'Змінювати групи можна раз на 30 днів.';
  }
  function createClient({ endpoint, getToken, fetcher = fetch }) {
    const url = new URL(endpoint);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
      throw new Error('Invalid room endpoint');
    }
    async function request(method, rooms) {
      const token = await getToken();
      if (!token) throw Object.assign(new Error('Увійдіть до акаунта.'), { status: 401 });
      const response = await fetcher(url.href, {
        method, credentials: 'omit', cache: 'no-store', redirect: 'error',
        headers: { Authorization: `Bearer ${token}`, ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}) },
        ...(method === 'POST' ? { body: JSON.stringify({ rooms }) } : {}),
        signal: AbortSignal.timeout(15000)
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (data.code === 'GROUP_CHANGE_COOLDOWN') throw Object.assign(new Error(cooldownMessage(data.nextChangeAt)), { status: response.status });
        const messages = { 401: 'Увійдіть до акаунта.', 403: 'Перевірте доступ до підписки або зверніться до модератора.',
          409: 'Зміна груп ще обробляється. Оновіть стан за мить.' };
        throw Object.assign(new Error(messages[response.status] || 'Не вдалося оновити групи. Спробуйте пізніше.'), { status: response.status });
      }
      return data;
    }
    return { load: () => request('GET'), save: rooms => request('POST', rooms) };
  }
  function validSelection(rooms, selected) {
    return Array.isArray(rooms) && Array.isArray(selected) && selected.length >= 1 && selected.length <= 3 &&
      new Set(selected).size === selected.length && selected.every(id => rooms.some(room => room.guid === id)) &&
      selected.filter(id => rooms.some(room => room.guid === id && room.kind === 'level')).length === 1;
  }
  async function mount({ container, client, onReady }) {
    const doc = container.ownerDocument;
    let busy = false, catalog = [], controls = [], pending = false, locked = false;
    const el = (tag, text) => { const node = doc.createElement(tag); if (text) node.textContent = text; return node; };
    const heading = el('h2', 'Оберіть свої групи');
    const intro = el('p', 'Одна група за рівнем англійської та до двох груп за інтересами. Усього — до трьох груп. Змінювати вибір можна раз на 30 днів.');
    const form = el('form'), fields = el('div'), status = el('p'), save = el('button', 'Зберегти та відкрити чат');
    const refresh = el('button', 'Оновити стан');
    const count = el('p', 'Обрано 0 із 3 груп'), actions = el('div');
    count.className = 'sd-room-count'; count.setAttribute('aria-live', 'polite');
    actions.className = 'sd-room-actions';
    save.className = 'sd-room-primary'; refresh.className = 'sd-room-refresh';
    status.className = 'sd-room-status'; fields.className = 'sd-room-fields';
    status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    save.type = 'submit'; refresh.type = 'button';
    actions.append(count, save, refresh);
    form.append(fields, status, actions); container.replaceChildren(heading, intro, form);
    container.classList.add('sd-room-picker');
    const selected = () => controls.filter(input => input.checked).map(input => input.value);
    function update() {
      const topics = controls.filter(input => input.type === 'checkbox' && input.checked).length;
      count.textContent = `Обрано ${selected().length} із 3 груп`;
      controls.forEach(input => { input.disabled = busy || pending || locked || (input.type === 'checkbox' && !input.checked && topics >= 2); });
      save.disabled = busy || pending || !validSelection(catalog, selected());
      save.textContent = locked ? 'Відкрити чат із поточними групами' : 'Зберегти та відкрити чат';
      refresh.disabled = busy;
      form.setAttribute('aria-busy', String(busy));
    }
    async function load() {
      if (busy) return;
      busy = true; update(); status.textContent = 'Завантажуємо ваші групи…';
      try {
        const data = await client.load();
        if (!Array.isArray(data.rooms) || !Array.isArray(data.selected) || typeof data.pending !== 'boolean') throw new Error('Не вдалося перевірити стан груп.');
        catalog = data.rooms; pending = data.pending; locked = data.canChange === false; controls = []; fields.replaceChildren();
        for (const [kind, title] of [['level', 'Ваш рівень англійської'], ['topic', 'Ваші інтереси — до двох груп']]) {
          const fieldset = el('fieldset'); fieldset.append(el('legend', title));
          for (const room of catalog.filter(room => room.kind === kind)) {
            const label = el('label'), input = el('input'), copy = el('span');
            input.type = kind === 'level' ? 'radio' : 'checkbox'; input.name = kind === 'level' ? 'sd-room-level' : 'sd-room-topic';
            input.value = room.guid; input.checked = data.selected.includes(room.guid);
            label.className = 'sd-room-choice';
            copy.append(el('strong', room.name), el('small', room.description)); label.append(input, copy);
            fieldset.append(label); controls.push(input); input.addEventListener('change', () => {
              update();
              status.textContent = !selected().some(id => catalog.some(r => r.guid === id && r.kind === 'level'))
                ? 'Оберіть одну групу за рівнем англійської.'
                : selected().length === 3 ? 'Три групи обрано. Ви готові до спілкування.'
                : 'Можна продовжити або додати групи за інтересами.';
            });
          }
          fields.append(fieldset);
        }
        status.textContent = pending ? 'Попередня зміна ще перевіряється. Оновіть стан або зверніться до модератора.' : locked ? cooldownMessage(data.nextChangeAt) : 'Після збереження наступна зміна буде доступна через 30 днів.';
      } catch (error) { pending = true; status.textContent = error.message; }
      finally { busy = false; update(); }
    }
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (busy || pending || !validSelection(catalog, selected())) return;
      const requested = selected().sort(); busy = true; update(); status.textContent = 'Зберігаємо ваш вибір…';
      try {
        const saved = await client.save(requested);
        if (!validSelection(catalog, saved.rooms) || [...saved.rooms].sort().join('|') !== requested.join('|')) throw new Error('Сервер не підтвердив вибір груп.');
        // Re-read provider memberships. Never open chat on optimistic browser state.
        const confirmed = await client.load();
        if (confirmed.pending || !validSelection(catalog, confirmed.selected) || [...confirmed.selected].sort().join('|') !== requested.join('|')) throw new Error('Групи ще перевіряються. Оновіть стан.');
        status.textContent = 'Групи підтверджено. Відкриваємо чат…';
        await onReady(confirmed);
      } catch (error) {
        // A timed-out POST may still finish on the server; never auto-repeat it.
        pending = true; status.textContent = error.message || 'Оновіть стан перед повторною спробою.';
      } finally { busy = false; update(); }
    });
    refresh.addEventListener('click', load);
    await load();
    return { reload: load };
  }
  return { createClient, validSelection, mount };
});

