(function (window) {
  function init() {
    if (typeof window.updateWorksTabForRole === 'function') {
      window.updateWorksTabForRole(Number(window.currentUserId) === Number(window.ADMIN_ID));
    }

    if (typeof window.renderSubmissions === 'function') window.renderSubmissions();
    if (typeof window.renderGalleryTab === 'function') window.renderGalleryTab();
  }

  window.WorksGalleryModule = { init };
})(window);
