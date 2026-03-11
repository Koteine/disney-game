export function isAdmin() {
  return Number(window.currentUserId) === Number(window.ADMIN_ID);
}

async function ensureDbReady(dbInstance) {
  if (dbInstance) {
    window.db = dbInstance;
    return dbInstance;
  }
  if (typeof window.waitForDbReady === 'function') {
    return window.waitForDbReady();
  }
  return window.db || null;
}

export function applyWorksRolePolicy() {
  const admin = isAdmin();

  if (typeof window.updateWorksTabForRole === 'function') {
    window.updateWorksTabForRole(admin);
  }

  const uploadCard = document.getElementById('works-upload-card');
  if (uploadCard) uploadCard.style.display = admin ? 'none' : 'block';

  const controls = [
    document.getElementById('work-image-before-input'),
    document.getElementById('work-image-after-input'),
    document.getElementById('work-submit-btn')
  ].filter(Boolean);

  controls.forEach((el) => {
    el.disabled = admin;
    if (admin) {
      el.setAttribute('aria-disabled', 'true');
    } else {
      el.removeAttribute('aria-disabled');
    }
  });

  const statusEl = document.getElementById('work-upload-status');
  if (admin && statusEl) {
    statusEl.textContent = 'Режим администратора: загрузка работ отключена.';
  }
}

export async function initWorksGallery(dbInstance) {
  console.log('DEBUG: Module WorksGallery received DB object:', !!dbInstance);
  await ensureDbReady(dbInstance);
  applyWorksRolePolicy();

  if (typeof window.renderSubmissions === 'function') window.renderSubmissions();
  if (typeof window.renderGalleryTab === 'function') window.renderGalleryTab();

  setTimeout(applyWorksRolePolicy, 0);
  setTimeout(applyWorksRolePolicy, 400);
}

export const WorksGalleryModule = { init: initWorksGallery, applyWorksRolePolicy };
window.WorksGalleryModule = WorksGalleryModule;
