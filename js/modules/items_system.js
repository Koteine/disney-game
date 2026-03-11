(function (window) {
  function init() {
    if (typeof window.renderInventory === 'function') window.renderInventory();
    if (typeof window.fillAdminItemsFormDefaults === 'function') window.fillAdminItemsFormDefaults();
  }

  window.ItemsSystemModule = { init };
})(window);
