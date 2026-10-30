// Recorrido de auditoría para móvil/tablet. Se pega en la consola del navegador (o con javascript_tool) con el tamaño ya emulado.
// Antes: borrar rc_room y rc_onboard del almacenamiento y recargar. Devuelve solo lo que falla.
(async () => {
  const w = (ms) => new Promise((r) => setTimeout(r, ms));
  const b = (t) => [...document.querySelectorAll('button')].find((x) => t.test(x.textContent));
  const vis = (el) => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; };
  const audit = () => {
    const vw = innerWidth, bad = [];
    document.querySelectorAll('button,a,input,[role=tab],[role=radio],select').forEach((e) => {
      const r = e.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      const nm = (e.getAttribute('aria-label') || e.innerText || e.className || '').toString().replace(/\s+/g, ' ').slice(0, 22);
      if (r.right > vw + 1 || r.left < -1) bad.push('FUERA ' + nm);
      else if (Math.min(r.width, r.height) < 40) bad.push('pequeño ' + Math.round(r.width) + 'x' + Math.round(r.height) + ' ' + nm);
    });
    return { overflowX: document.documentElement.scrollWidth > vw + 1, bad: [...new Set(bad)].slice(0, 10) };
  };
  const out = { vw: innerWidth, vh: innerHeight, fallos: {} };
  const note = (k, a) => { if (a.overflowX || a.bad.length) out.fallos[k] = a; };
  const tour = [];
  for (let i = 0; i < 5; i++) { const n = b(/Siguiente|A jugar/); if (!n) break; tour.push(vis(n)); note('tour' + i, audit()); n.click(); await w(450); }
  out.botonTourVisible = tour.every(Boolean) ? 'sí (5/5)' : 'NO: ' + tour.join(',');
  note('portada', audit());
  const inp = document.querySelector('#name');
  inp.value = 'Ana'; inp.dispatchEvent(new Event('input', { bubbles: true })); await w(200);
  b(/Crear mesa/).click(); await w(2500);
  note('mesa', audit());
  const tab = (t) => [...document.querySelectorAll('[role=tab]')].find((x) => t.test(x.textContent));
  for (const [name, re] of [['casino', /Casino/], ['fiesta', /Fiesta/], ['ludo', /Ludo/]]) { tab(re)?.click(); await w(1300); note(name, audit()); }
  tab(/Fiesta/).click(); await w(900);
  const back = b(/^\s*Fiesta\s*$/); if (back) { back.click(); await w(900); }
  b(/Yo nunca/)?.click(); await w(800);
  (b(/Empezar/) || b(/Siguiente/))?.click(); await w(900); note('yo-nunca', audit());
  b(/Yo sí/)?.click(); await w(3200); note('yo-nunca-resultado', audit());
  document.querySelector('.code')?.click(); await w(700); note('ventana-mesa', audit());
  return JSON.stringify(out);
})();
