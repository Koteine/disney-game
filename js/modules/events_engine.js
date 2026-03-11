(function (window) {
  function init() {
    if (typeof window.initEventSystem === 'function') {
      window.initEventSystem().catch((err) => console.error('initEventSystem failed:', err));
    }

    // Fix: primary admin event button should use epic event scheduler/launcher.
    const btn = document.getElementById('admin-schedule-event-btn');
    if (btn) {
      btn.disabled = false;
      btn.removeAttribute('disabled');
      btn.onclick = async (ev) => {
        ev?.preventDefault?.();
        if (Number(window.currentUserId) !== Number(window.ADMIN_ID)) return;
        const run = window.adminScheduleEpicPaintEvent || window.adminLaunchEpicPaintEvent;
        if (typeof run === 'function') await run();
      };
    }
  }

  window.EventsEngineModule = { init };
})(window);
