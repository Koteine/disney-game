(function (window) {
  function isAdmin() {
    return Number(window.currentUserId) === Number(window.ADMIN_ID);
  }

  function applyWorksRolePolicy() {
    const admin = isAdmin();

    if (typeof window.updateWorksTabForRole === 'function') {
      window.updateWorksTabForRole(admin);
    }

    const uploadCard = document.getElementById('works-upload-card');
    if (uploadCard) uploadCard.style.display = admin ? 'none' : 'block';

    const controls = [
      document.getElementById('before-upload'),
      document.getElementById('after-upload'),
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

  function init() {
    applyWorksRolePolicy();

    if (typeof window.renderSubmissions === 'function') window.renderSubmissions();
    if (typeof window.renderGalleryTab === 'function') window.renderGalleryTab();

    setTimeout(applyWorksRolePolicy, 0);
    setTimeout(applyWorksRolePolicy, 400);
  }

  window.WorksGalleryModule = { init, applyWorksRolePolicy };
})(window);
