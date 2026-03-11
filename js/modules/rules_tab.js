export function switchRulesSubtab(tabName) {
  const tabs = ['items', 'events', 'cells'];
  tabs.forEach((name) => {
    const btn = document.getElementById(`rules-tab-${name}-btn`);
    const panel = document.getElementById(`rules-panel-${name}`);
    const active = name === tabName;
    btn?.classList.toggle('active', active);
    panel?.classList.toggle('active', active);
    if (panel) panel.style.display = active ? 'block' : 'none';
  });
}

export function openRulesScroll() {
  const btn = document.querySelector('.nav-item[onclick*="tab-rules"]');
  if (typeof window.switchTab === 'function') window.switchTab('tab-rules', btn);
}

export function initRulesTab(db) {
  console.log('DEBUG: Module RulesTab received DB object:', !!db);
  window.switchRulesSubtab = switchRulesSubtab;
  window.openRulesScroll = openRulesScroll;
}

export const RulesTabModule = { init: initRulesTab, switchRulesSubtab, openRulesScroll };
window.RulesTabModule = RulesTabModule;
