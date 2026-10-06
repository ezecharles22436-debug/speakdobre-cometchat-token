// Packaging smoke test only: import the real UI without initializing or logging in.
const status = document.getElementById('package-status');
async function loadPackage() {
try {
  for (const file of ['chat-sdk-4.2.0.js', 'calls-sdk-5.0.6.js']) await new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = new URL('./vendor/' + file, location.href).href;
    script.onload = resolve;
    script.onerror = () => reject(Error('Не вдалося завантажити SDK чату.'));
    document.head.append(script);
  });
  const module = await import('./chat.tsx');
  if (typeof module.mountPreviewChat !== 'function') throw Error('Інтерфейс чату недоступний.');
  status.textContent = 'Пакет завантажено. Вхід у чат не виконувався.';
  status.dataset.result = 'passed';
} catch (error) {
  status.textContent = 'Помилка завантаження локального пакета. Перегляньте журнал браузера.';
  status.dataset.result = 'failed';
  console.error('Local package smoke test failed', error);
}
}
loadPackage();
