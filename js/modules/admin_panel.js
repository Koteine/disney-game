(function (window) {
  function wireAdminEventButtons() {
    const scheduleEventBtn = document.getElementById('admin-schedule-event-btn');
    if (!scheduleEventBtn) return;

    scheduleEventBtn.disabled = false;
    scheduleEventBtn.removeAttribute('disabled');
    scheduleEventBtn.onclick = async (ev) => {
      ev?.preventDefault?.();
      if (Number(window.currentUserId) !== Number(window.ADMIN_ID)) return;
      const run = window.adminScheduleEpicPaintEvent || window.adminScheduleEvent || window.adminLaunchEpicPaintEvent;
      if (typeof run !== 'function') {
        console.error('Epic event handler is not available');
        return;
      }
      await run();
    };
  }

  function init() {
    wireAdminEventButtons();
    if (typeof window.fillAdminItemsFormDefaults === 'function') window.fillAdminItemsFormDefaults();
  }

  window.AdminPanelModule = { init, wireAdminEventButtons };
})(window);
