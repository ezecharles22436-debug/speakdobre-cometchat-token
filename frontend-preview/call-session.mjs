// Local integration seam: authorize must revalidate the accepted/in-progress
// call using the host's authenticated workflow. Never feed it URL/form data.
// Not connected to Webflow; no call invitation or credential creation here.
export function createCallSession({ sdk, authorize, mountControls, onState, timeoutMs = 15000 }) {
  let phase = 'idle', closed = false, cleanup, generation = 0, joinAttempted = false, timer;
  const listeners = [];
  const emit = value => { phase = value; onState(value); };
  const removeControls = () => { cleanup?.(); cleanup = undefined; };
  function end() { clearTimeout(timer); removeControls(); joinAttempted = false; if (!closed) emit('ended'); }
  listeners.push(sdk.addEventListener('onSessionLeft', end));
  listeners.push(sdk.addEventListener('onConnectionClosed', end));
  listeners.push(sdk.addEventListener('onSessionTimedOut', end));
  // A connection restoration requires fresh authorization before remounting.
  listeners.push(sdk.addEventListener('onConnectionLost', () => { removeControls(); if (!closed) emit('connection-lost'); }));
  async function start(container) {
    if (closed || phase !== 'idle') throw Error('Сеанс уже розпочато або завершено.');
    const version = ++generation;
    emit('authorizing');
    const stillCurrent = () => { if (closed || version !== generation) throw Error('Сеанс завершено.'); };
    try {
      const grant = await authorize(); stillCurrent();
      if (grant?.appId !== '168437005e7f6fa2a' || grant.allowed !== true ||
          !grant.uid || !grant.sessionId || !grant.authToken || !['VOICE', 'VIDEO'].includes(grant.type) ||
          !['student', 'moderator', 'super_moderator'].includes(grant.role)) throw Error('Дзвінок недоступний.');
      if (grant.role === 'student' && (grant.direction !== 'incoming' || grant.peerIsStaff !== true)) throw Error('Дзвінок недоступний.');
      if (sdk.getLoggedInUser()?.getUid() !== grant.uid) throw Error('Акаунт змінився.');
      const { token } = await sdk.generateToken(grant.sessionId, grant.authToken); stillCurrent();
      if (!token) throw Error('Не вдалося перевірити дзвінок.');
      // Recheck grant after token generation; tokens never enter DOM or logs.
      const fresh = await authorize(); stillCurrent();
      for (const key of ['appId','allowed','uid','sessionId','role','type','direction','peerIsStaff']) {
        if (fresh?.[key] !== grant[key]) throw Error('Доступ до дзвінка змінився.');
      }
      emit('joining'); joinAttempted = true;
      timer = setTimeout(() => { if (!closed && phase === 'joining') { generation++; sdk.leaveSession(); removeControls(); emit('failed'); } }, timeoutMs);
      const result = await sdk.joinSession(token, {
        sessionType: grant.type, hideControlPanel: true,
        startAudioMuted: true, startVideoPaused: true,
        autoStartRecording: false, autoStartTranscription: false,
      }, container);
      stillCurrent(); clearTimeout(timer);
      if (!result || result.error) throw Error('Не вдалося приєднатися до дзвінка.');
      if (phase !== 'joining') throw Error('Дзвінок уже завершився.');
      cleanup = mountControls({ audioMuted:true, videoPaused:true, screenSharing:false });
      emit('active');
    } catch {
      clearTimeout(timer); removeControls();
      if (joinAttempted) { sdk.leaveSession(); joinAttempted = false; }
      if (!closed) emit('failed');
      throw Error('Не вдалося відкрити дзвінок. Перевірте доступ і спробуйте ще раз.');
    }
  }
  return { start, dispose() {
    if (closed) return;
    closed = true; generation++; clearTimeout(timer); removeControls();
    if (joinAttempted) sdk.leaveSession();
    listeners.forEach(unsubscribe => unsubscribe());
  } };
}
