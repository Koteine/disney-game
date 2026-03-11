(function (window) {
  function init() {
    if (window.EventsEngineModule && typeof window.EventsEngineModule.wireAdminEventButton === 'function') {
      window.EventsEngineModule.wireAdminEventButton();
    }

    if (typeof window.fillAdminItemsFormDefaults === 'function') {
      window.fillAdminItemsFormDefaults();
    }
  }

  window.AdminPanelModule = { init };
})(window);
