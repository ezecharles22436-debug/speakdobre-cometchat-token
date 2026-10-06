// Local synthetic fixtures. Never invokes provider SDKs or reads account data.
import { mountStudentPicker } from './student-picker.mjs';
import { mountCallControls } from './call-controls.mjs';
import './chat.css';
import './call-controls.css';
import './controls-preview.css';

const identity = { uid: 'mem_fixture_moderator', role: 'moderator' };
const roomGuid = 'fixture_c2';
let revoked = false;
const picked = document.querySelector('#selected-student');
mountStudentPicker(document.querySelector('#moderator-picker'), {
  identity, roomGuid,
  getSession: async () => ({ token: 'local-fixture-not-a-credential', user: identity, rooms: revoked ? [] : [{ guid: roomGuid, unlocked: true }] }),
  createRequest: () => ({ fetchNext: async () => ['Олена', 'Андрій', 'Марія — дуже довге ім’я для перевірки на мобільному'].map((name, i) => ({ getUid: () => `mem_fixture_${i}`, getScope: () => 'participant', getName: () => name })) }),
  authorizeStudent: async ({ uid }) => ({ actor: identity, target: { uid }, roomGuid }),
  onSelect: async uid => { picked.textContent = `Локальна перевірка: обрано ${uid}. Повідомлення не надсилалося.`; },
});
document.querySelector('#revoke-access').addEventListener('click', () => {
  revoked = true;
  document.querySelector('#access-status').textContent = 'Доступ у локальному сценарії відкликано. Спробуйте обрати студента.';
});

const listeners = new Map();
const emit = name => { for (const fn of listeners.get(name) || []) fn(); };
const sdk = { addEventListener(name, fn) {
  if (!listeners.has(name)) listeners.set(name, new Set());
  listeners.get(name).add(fn); return () => listeners.get(name).delete(fn);
} };
for (const [method, event] of Object.entries({ muteAudio: 'onAudioMuted', unmuteAudio: 'onAudioUnMuted', pauseVideo: 'onVideoPaused', resumeVideo: 'onVideoResumed', startScreenSharing: 'onScreenShareStarted', stopScreenSharing: 'onScreenShareStopped', leaveSession: 'onSessionLeft' })) {
  sdk[method] = async () => { emit(event); };
}
mountCallControls(document.querySelector('#student-call-controls'), { sdk, initial: { audioMuted: true, videoPaused: true, screenSharing: false } });
document.querySelector('#lose-connection').addEventListener('click', () => emit('onConnectionLost'));
