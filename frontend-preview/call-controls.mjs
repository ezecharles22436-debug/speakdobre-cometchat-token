// Presentation controller only. Host must authorize/join the session separately.
// No call creation, credentials, recording, or end-for-everyone capability here.
export const callPanelSettings = Object.freeze({ hideControlPanel: true });
export function createCallControls({ sdk, onChange, initial, timeoutMs = 8000 }) {
  if (typeof initial?.audioMuted !== 'boolean' || typeof initial?.videoPaused !== 'boolean' || typeof initial?.screenSharing !== 'boolean') throw Error('Потрібен перевірений стан дзвінка.');
  let state = { ...initial, active: true, pending: null, error: '' }, disposed = false, timer;
  const unsubscribers = [];
  const emit = () => { if (!disposed) onChange({ ...state }); };
  const labels = {
    audio: ['Увімкнути мікрофон', 'Вимкнути мікрофон'],
    video: ['Увімкнути камеру', 'Вимкнути камеру'],
    screen: ['Зупинити показ екрана', 'Показати екран'],
  };
  function update(field, value, action) {
    if (disposed) return;
    state[field] = value;
    if (state.pending === action) { clearTimeout(timer); state.pending = null; }
    state.error = ''; emit();
  }
  for (const [event, field, value, action] of [
    ['onAudioMuted', 'audioMuted', true, 'audio'], ['onAudioUnMuted', 'audioMuted', false, 'audio'],
    ['onVideoPaused', 'videoPaused', true, 'video'], ['onVideoResumed', 'videoPaused', false, 'video'],
    ['onScreenShareStarted', 'screenSharing', true, 'screen'], ['onScreenShareStopped', 'screenSharing', false, 'screen'],
  ]) unsubscribers.push(sdk.addEventListener(event, () => update(field, value, action)));
  for (const event of ['onSessionLeft', 'onConnectionClosed', 'onSessionTimedOut']) {
    unsubscribers.push(sdk.addEventListener(event, () => {
      if (disposed) return;
      clearTimeout(timer); state.active = false; state.pending = null; state.error = ''; emit();
    }));
  }
  unsubscribers.push(sdk.addEventListener('onConnectionLost', () => {
    if (disposed) return;
    clearTimeout(timer); state.active = false; state.pending = null;
    state.error = 'З’єднання втрачено. Закрийте вікно дзвінка та відкрийте його повторно.'; emit();
  }));
  const failed = () => { clearTimeout(timer); state.pending = null; state.error = 'Не вдалося виконати дію. Перевірте дозволи браузера та спробуйте ще раз.'; emit(); };
  async function act(action) {
    if (disposed || !state.active || state.pending) return false;
    const method = { audio: state.audioMuted ? 'unmuteAudio' : 'muteAudio', video: state.videoPaused ? 'resumeVideo' : 'pauseVideo', screen: state.screenSharing ? 'stopScreenSharing' : 'startScreenSharing', leave: 'leaveSession' }[action];
    if (!method) throw Error('Невідома дія дзвінка.');
    state.pending = action; state.error = ''; emit();
    timer = setTimeout(failed, timeoutMs);
    try {
      await sdk[method]();
      // Media indicators change only on SDK events, never optimistically.
      // Leaving is confirmed only by onSessionLeft, not a void method return.
      return true;
    } catch { if (!disposed) failed(); return false; }
  }
  emit();
  return { act, labels, dispose() { disposed = true; clearTimeout(timer); unsubscribers.forEach(unsubscribe => unsubscribe()); } };
}

export function mountCallControls(container, options) {
  const doc = container.ownerDocument;
  container.classList.add('sd-call-controls'); container.setAttribute('aria-label', 'Керування дзвінком');
  const buttons = {};
  for (const action of ['audio', 'video', 'screen', 'leave']) {
    const button = doc.createElement('button'); button.type = 'button'; button.dataset.action = action;
    buttons[action] = button; container.append(button);
  }
  const status = doc.createElement('p'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); container.append(status);
  const controller = createCallControls({ ...options, onChange(state) {
    buttons.audio.textContent = state.audioMuted ? 'Увімкнути мікрофон' : 'Вимкнути мікрофон';
    buttons.video.textContent = state.videoPaused ? 'Увімкнути камеру' : 'Вимкнути камеру';
    buttons.screen.textContent = state.screenSharing ? 'Зупинити показ екрана' : 'Показати екран';
    buttons.leave.textContent = 'Вийти з дзвінка';
    for (const button of Object.values(buttons)) button.disabled = !state.active || !!state.pending;
    status.textContent = state.error || (!state.active ? 'Ви вийшли з дзвінка.' : state.pending ? 'Виконуємо дію…' : '');
    options.onChange?.(state);
  } });
  for (const [action, button] of Object.entries(buttons)) button.addEventListener('click', () => controller.act(action));
  return () => { controller.dispose(); container.replaceChildren(); };
}
