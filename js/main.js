(function (window) {
  function initModules() {
    [
      window.RulesTabModule,
      window.ItemsSystemModule,
      window.EventsEngineModule,
      window.AdminPanelModule,
      window.WorksGalleryModule
    ].forEach((moduleApi) => {
      if (moduleApi && typeof moduleApi.init === 'function') {
        moduleApi.init();
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initModules);
  } else {
    initModules();
  }

  window.MainDispatcher = { initModules };
})(window);
