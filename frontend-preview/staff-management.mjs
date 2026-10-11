// Discoverable staff workspace; existing action authorization remains mandatory.
export function staffPresentation(role) {
  if (role === 'super_moderator') return { label: 'Супермодератор', title: 'Керування Practice Chat' };
  if (role === 'moderator') return { label: 'Модератор', title: 'Керування групами' };
  return null;
}
import { mountOwnerAccess } from './owner-access.mjs';
export function mountStaffManagement(container, { identity, getSession, ownerAccess }) {
  const presentation = staffPresentation(identity?.role);
  if (!presentation) return null;
  const doc = container.ownerDocument;
  const toolbar = doc.createElement('div'), badge = doc.createElement('span');
  const toggle = doc.createElement('button'), panel = doc.createElement('section');
  const title = doc.createElement('h2'), help = doc.createElement('p'), content = doc.createElement('div');
  const students = doc.createElement('button'), directoryRoot = doc.createElement('section');
  students.type = 'button'; students.textContent = 'Студенти'; students.disabled = true;
  students.setAttribute('aria-expanded', 'false'); directoryRoot.hidden = true;
  directoryRoot.className = 'sd-student-directory'; directoryRoot.setAttribute('aria-label', 'Студенти Practice Chat');
  container.className = 'sd-staff-management'; toolbar.className = 'sd-staff-toolbar';
  badge.className = 'sd-staff-badge'; badge.textContent = presentation.label;
  toggle.type = 'button'; toggle.textContent = 'Керування'; toggle.setAttribute('aria-expanded', 'false');
  panel.hidden = true; panel.setAttribute('aria-label', presentation.title);
  title.textContent = presentation.title;
  help.textContent = 'Оберіть групу нижче. Тут можна відкрити розмову зі студентом, вилучити його з групи або заблокувати в цій групі. Видалення повідомлень доступне в меню повідомлення.';
  content.textContent = 'Спочатку відкрийте потрібну групу.';
  panel.append(title, help, content); toolbar.append(badge, toggle, students); container.replaceChildren(toolbar, panel, directoryRoot);
  let removeOwner;
  if (identity.role === 'super_moderator' && ownerAccess) {
    const ownerRoot = doc.createElement('section'); panel.append(ownerRoot);
    removeOwner = mountOwnerAccess(ownerRoot, ownerAccess);
  }
  let disposed = false, checking = false;
  let openDirectory;
  students.addEventListener('click', async () => {
    if (disposed || checking || !openDirectory) return;
    if (!directoryRoot.hidden) { directoryRoot.hidden = true; students.setAttribute('aria-expanded', 'false'); return; }
    checking = true; students.disabled = true;
    try {
      const session = await getSession();
      if (disposed || session?.user?.uid !== identity.uid || session.user.role !== identity.role || !session.token) throw Error('changed');
      directoryRoot.hidden = false; students.setAttribute('aria-expanded', 'true');
      await openDirectory();
    } catch { directoryRoot.hidden = true; students.setAttribute('aria-expanded', 'false'); students.textContent = 'Оновіть сторінку для перевірки доступу'; }
    finally { checking = false; if (!disposed) students.disabled = false; }
  });
  toggle.addEventListener('click', async () => {
    if (disposed || checking) return;
    if (!panel.hidden) { panel.hidden = true; toggle.setAttribute('aria-expanded', 'false'); toggle.textContent = 'Керування'; return; }
    checking = true; toggle.disabled = true;
    try {
      const session = await getSession();
      if (disposed) return;
      if (session?.user?.uid !== identity.uid || session.user.role !== identity.role || !session.token) throw Error('changed');
      panel.hidden = false; toggle.setAttribute('aria-expanded', 'true'); toggle.textContent = 'Закрити керування';
    } catch { panel.hidden = true; toggle.setAttribute('aria-expanded', 'false'); toggle.textContent = 'Оновіть сторінку для перевірки доступу'; }
    finally { checking = false; if (!disposed) toggle.disabled = false; }
  });
  return {
    content,
    directoryRoot,
    bindDirectory(open) { openDirectory = open; students.disabled = false; },
    closeDirectory() { directoryRoot.hidden = true; students.setAttribute('aria-expanded', 'false'); },
    clear() { content.replaceChildren(); content.textContent = 'Відкрийте групу, щоб керувати її учасниками.'; },
    setGroup(name) { title.textContent = `${presentation.title} · ${name}`; },
    dispose() { disposed = true; removeOwner?.(); container.replaceChildren(); }
  };
}
