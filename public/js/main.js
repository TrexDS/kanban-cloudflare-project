// One tooltip for every [data-tip] chart mark (mouse hover and keyboard focus).
(function(){
  const tip = () => document.getElementById('vizTip');
  const show = (el, x, y) => { const t = tip(); t.textContent = el.dataset.tip; t.style.display = 'block';
    t.style.left = Math.max(8, Math.min(x + 12, innerWidth - t.offsetWidth - 8)) + 'px'; t.style.top = Math.max(8, y - t.offsetHeight - 10) + 'px'; };
  document.addEventListener('mousemove', e => { const el = e.target.closest && e.target.closest('[data-tip]'); el ? show(el, e.clientX, e.clientY) : (tip().style.display = 'none'); });
  document.addEventListener('focusin', e => { const el = e.target.closest && e.target.closest('[data-tip]'); if(el){ const r = el.getBoundingClientRect(); show(el, r.left, r.top); } });
  document.addEventListener('focusout', () => tip().style.display = 'none');
})();

applyI18n();
loadState();
loadOuraRows().then(renderDashboard); // readiness KPI on the dashboard + ⚠️ on the health tab if Oura can't be read
