/* app.js — wires the UI: question → DFA → info panels → animated simulation */
(function () {
  'use strict';
  const L = window.DFALib;
  const $ = id => document.getElementById(id);
  const view = new DFAView($('svg'));

  const EXAMPLE_GROUPS = {
    'Ends / starts / contains': [
      'Strings over {0,1} that end with 01',
      'Starts with a and ends with b over {a,b}',
      'Contains the substring 101 over {0,1}',
      "No two consecutive a's over {a,b}",
      'Ends with ab or ba over {a,b}',
      'Second last symbol is 1',
      'Third symbol from the end is 1',
      'Starts and ends with the same symbol over {a,b}',
      'Every a is followed by b over {a,b}',
      'At most 2 consecutive 1s',
    ],
    'Counting & parity': [
      "Exactly two a's over {a,b}",
      "At least 2 a's and at most 1 b over {a,b}",
      'Even number of 0s and odd number of 1s',
      'Length divisible by 3 over {a,b}',
      'Length between 2 and 4 over {a,b}',
      "Number of a's is 1 mod 3 over {a,b}",
      "'ab' occurs at least 2 times over {a,b}",
    ],
    'Numbers': [
      'Binary numbers divisible by 3',
      'Binary numbers divisible by 5',
      'Decimal numbers divisible by 3',
      'Ternary numbers that are even',
    ],
    'Regular expressions': [
      '(a+b)*abb',
      '0*10*',
      'a(a|b)*b',
      '(ab)*',
    ],
    'Set notation': [
      'L = { w ∈ {a,b}* | |w|_a is even }',
      'L = { a^n b^m | n >= 1, m >= 0 }',
    ],
    'Not regular (no DFA exists)': [
      'Equal number of 0s and 1s',
      'L = { a^n b^n | n >= 0 }',
    ],
  };
  const FIRST_EXAMPLE = EXAMPLE_GROUPS['Ends / starts / contains'][0];

  let dfa = null;
  const sim = { syms: [], pos: 0, path: [], started: false, animating: false, playing: false, timer: null, bad: -1 };

  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const qn = s => 'q' + s;
  const show = (el, msg, info) => { el.hidden = !msg; el.textContent = msg || ''; el.classList.toggle('info', !!info); };
  const parseAlpha = s => Array.from(new Set(s.split(/[\s,{}]+/).filter(Boolean)));

  /* ---------------- theme ---------------- */
  function applyTheme(t) {
    document.documentElement.dataset.theme = t;
    try { localStorage.setItem('dfa-theme', t); } catch (e) {}
    if (dfa) { view.draw(); }
  }
  (function initTheme() {
    let t = null;
    try { t = localStorage.getItem('dfa-theme'); } catch (e) {}
    if (!t) t = window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    document.documentElement.dataset.theme = t;
  })();
  $('themeBtn').onclick = () => applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');

  /* ---------------- question-type list ---------------- */
  (function () {
    const box = $('examples');
    let first = true;
    for (const g in EXAMPLE_GROUPS) {
      const d = document.createElement('details');
      d.open = first; first = false;
      const sm = document.createElement('summary'); sm.textContent = g; d.appendChild(sm);
      EXAMPLE_GROUPS[g].forEach(t => {
        const b = document.createElement('button');
        b.className = 'ex'; b.textContent = t;
        b.onclick = () => { $('q').value = t; $('alpha').value = ''; generate(); };
        d.appendChild(b);
      });
      box.appendChild(d);
    }
  })();

  /* ---------------- tabs ---------------- */
  document.querySelectorAll('.tab').forEach(b => (b.onclick = () => {
    document.querySelectorAll('.tab').forEach(x => x.classList.toggle('on', x === b));
    document.querySelectorAll('.tabpane').forEach(p => (p.hidden = p.id !== 'pane-' + b.dataset.tab));
    if (b.dataset.tab === 'man') renderManual();
  }));

  /* ---------------- generate from question ---------------- */
  function generate() {
    show($('msg'), '');
    document.body.classList.remove('has-error');
    try {
      const res = L.fromQuestion($('q').value, parseAlpha($('alpha').value));
      setDFA(res.dfa, {
        lang: res.lang,
        en: 'Accepts exactly the strings over {' + res.alphabet.join(', ') + '} where ' + res.cond + '.',
        notes: res.notes.concat(['Shown as the minimal DFA (' + res.dfa.n + ' state' + (res.dfa.n === 1 ? '' : 's') + ').']),
      });
      saveHash();
      if (window.innerWidth < 980) $('answer').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) {
      show($('msg'), e.message, e.nonRegular);
      document.body.classList.add('has-error');
      if (!(e instanceof L.DFAError)) { console.error(e); show($('msg'), 'Something went wrong while building that DFA — try rephrasing the question.'); }
    }
  }
  $('genBtn').onclick = generate;
  $('q').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); generate(); } });

  /* ---------------- install a DFA & render panels ---------------- */
  function setDFA(d, info) {
    dfa = d;
    $('hideDead').checked = false;
    view.hideDead = false;
    $('hideDeadWrap').hidden = !d.isDead.some(Boolean);
    view.setDFA(d);
    renderInfo(info);
    renderBatch();
    resetSim();
  }

  function renderInfo(info) {
    $('lang').textContent = info.lang;
    $('langEn').textContent = info.en || '';
    $('notes').innerHTML = (info.notes || []).map(n => '<li>' + esc(n) + '</li>').join('');

    const Q = [...Array(dfa.n).keys()].map(qn).join(', ');
    const F = dfa.accept.map((a, i) => (a ? qn(i) : null)).filter(Boolean).join(', ');
    $('tuple').innerHTML =
      `Q = { ${esc(Q)} }<br>Σ = { ${esc(dfa.alphabet.join(', '))} }<br>q₀ = ${qn(dfa.start)}<br>F = { ${esc(F)} }<br>δ : Q × Σ → Q  (table below)`;

    const acc = L.accessStrings(dfa);
    let h = '<tr><th>State</th>' + dfa.alphabet.map(c => `<th>${esc(c)}</th>`).join('') + '<th title="shortest string that reaches the state">reached by</th></tr>';
    for (let s = 0; s < dfa.n; s++) {
      const mark = (s === dfa.start ? '→' : '') + (dfa.accept[s] ? '*' : '');
      h += `<tr class="${dfa.isDead[s] ? 'dead' : ''}"><td>${mark} ${qn(s)}${dfa.isDead[s] ? ' (trap)' : ''}</td>` +
        dfa.delta[s].map(t => `<td>${qn(t)}</td>`).join('') +
        `<td>${acc[s] === null ? '—' : acc[s] === '' ? 'ε' : esc(acc[s])}</td></tr>`;
    }
    $('ttable').innerHTML = h;

    const pills = (list, cls) => list.length
      ? list.map(w => `<span class="pill ${cls}" data-w="${esc(w)}">${w === '' ? 'ε' : esc(w)}</span>`).join('')
      : '<span class="muted small">none</span>';
    $('sAcc').innerHTML = pills(L.samples(dfa, true, 8, 8), 'ok');
    $('sRej').innerHTML = pills(L.samples(dfa, false, 8, 8), 'bad');
    document.querySelectorAll('.samples .pill').forEach(p => (p.onclick = () => loadString(p.dataset.w)));
  }

  function loadString(w) {
    $('str').value = w === '' ? 'ε' : w;
    resetSim(); saveHash();
    $('str').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  /* ---------------- batch testing ---------------- */
  function renderBatch() {
    if (!dfa) return;
    const items = $('batch').value.split(/[\n,]+/).map(s => s.trim()).filter((s, i, a) => s !== '' || a.length === 1 && false);
    $('batchOut').innerHTML = items.map(raw => {
      const w = /^(ε|eps|epsilon)$/i.test(raw) ? '' : raw.replace(/\s+/g, '');
      const r = L.run(dfa, w);
      const cls = r.error >= 0 ? 'bad' : r.accepted ? 'ok' : 'bad';
      const mark = r.error >= 0 ? '? invalid' : r.accepted ? '✓' : '✗';
      return `<span class="pill ${cls}" data-w="${esc(w)}" title="${r.error >= 0 ? 'contains a symbol outside Σ' : r.accepted ? 'accepted' : 'rejected'}">${w === '' ? 'ε' : esc(w)} ${mark}</span>`;
    }).join('');
    document.querySelectorAll('#batchOut .pill').forEach(p => (p.onclick = () => loadString(p.dataset.w)));
  }
  $('batch').addEventListener('input', renderBatch);

  /* ---------------- diagram toolbar ---------------- */
  // natural size (≈1.25x) capped to the container width
  function fit() {
    if (!view.vb) return;
    const avail = $('canvas').clientWidth - 2;
    $('svg').style.width = Math.round(Math.min(avail, view.vb.w * 1.25)) + 'px';
  }
  view.onDraw = fit;
  window.addEventListener('resize', fit);
  $('hideDead').onchange = e => { view.setHideDead(e.target.checked); };
  $('relayout').onclick = () => { if (dfa) { view.autoLayout(); view.draw(); } };
  const download = (blob, name) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); };
  $('dlSvg').onclick = () => dfa && download(new Blob([view.svgString()], { type: 'image/svg+xml' }), 'dfa.svg');
  $('dlPng').onclick = () => dfa && view.toPNG(b => download(b, 'dfa.png'));

  /* ---------------- simulation ---------------- */
  function readInput() {
    let s = $('str').value.replace(/[\s,]+/g, '');
    if (/^(ε|eps|epsilon)$/i.test(s)) s = '';
    const bad = [...s].findIndex(ch => !dfa.alphabet.includes(ch));
    return { s, bad };
  }

  function stopPlay() { sim.playing = false; clearTimeout(sim.timer); $('bPlay').textContent = '▶ Run'; }

  function resetSim() {
    stopPlay(); view.cancelToken(); sim.animating = false;
    const { s, bad } = readInput();
    sim.bad = bad;
    sim.syms = bad >= 0 ? [] : [...s];
    sim.pos = 0; sim.path = [dfa.start]; sim.started = false;
    view.setEdge(null); view.verdict = null; view.setActive(dfa.start);
    renderSim();
  }

  function renderSim() {
    const n = sim.syms.length, finished = sim.started && sim.pos === n;
    // tape
    const tape = $('tape');
    if (sim.bad >= 0) {
      tape.innerHTML = '';
    } else if (n === 0) {
      tape.innerHTML = `<div class="cell eps ${sim.started ? 'done' : 'cur'}">ε (empty string)</div>`;
    } else {
      tape.innerHTML = sim.syms.map((c, i) =>
        `<div class="cell ${i < sim.pos ? 'done' : i === sim.pos && !finished ? 'cur' : ''}">${esc(c)}<small>${i + 1}</small></div>`).join('');
    }
    // trace
    const rows = [];
    for (let i = 0; i < sim.pos; i++) rows.push(`δ(${qn(sim.path[i])}, ${esc(sim.syms[i])}) = ${qn(sim.path[i + 1])}`);
    const cur = sim.path[sim.path.length - 1];
    if (finished) rows.push(`end of input in ${qn(cur)} ${dfa.accept[cur] ? '∈ F  → accept' : '∉ F  → reject'}`);
    $('trace').innerHTML = rows.map(r => `<li>${r}</li>`).join('');
    $('trace').scrollTop = 1e6;
    // verdict
    const v = $('verdict');
    if (sim.bad >= 0) {
      v.className = 'verdict bad';
      v.innerHTML = `Symbol “${esc($('str').value.replace(/[\s,]+/g, '')[sim.bad])}” is not in Σ = { ${esc(dfa.alphabet.join(', '))} }.`;
    } else if (finished) {
      const ok = dfa.accept[cur];
      v.className = 'verdict ' + (ok ? 'ok' : 'bad');
      v.innerHTML = `<b>${ok ? 'ACCEPTED ✓' : 'REJECTED ✗'}</b> — the DFA stops in ${qn(cur)}, which is ${ok ? '' : 'not '}a final state.`;
      view.setVerdict(ok ? 'ok' : 'bad');
    } else {
      v.className = 'verdict';
      v.textContent = sim.started ? `Reading symbol ${sim.pos + 1} of ${n}… currently in ${qn(cur)}.` : 'Press ▶ Run to animate, or Step to go one symbol at a time.';
      view.setVerdict(null);
    }
    const noInput = sim.bad >= 0;
    ['bPlay', 'bStep'].forEach(id => ($(id).disabled = noInput));
    $('bBack').disabled = noInput || sim.pos === 0;
  }

  const durMs = () => 1150 - (Number($('speed').value) - 1) * 110;

  function stepForward(after) {
    if (sim.animating || sim.bad >= 0) return;
    sim.started = true;
    if (sim.pos >= sim.syms.length) { renderSim(); if (after) after(); return; }
    const s = sim.path[sim.path.length - 1];
    const t = dfa.delta[s][dfa.alphabet.indexOf(sim.syms[sim.pos])];
    if (view.hideDead && dfa.isDead[t]) { $('hideDead').checked = false; view.setHideDead(false); }
    sim.animating = true;
    view.setVerdict(null);
    view.setEdge(s, t);
    renderSim();
    view.moveToken(s, t, durMs(), () => {
      sim.animating = false;
      sim.pos++; sim.path.push(t);
      view.setActive(t);
      renderSim();
      if (after) after();
    });
  }

  function loop() {
    if (!sim.playing) return;
    if (sim.pos >= sim.syms.length) { stopPlay(); return; }
    stepForward(() => {
      if (sim.playing && sim.pos < sim.syms.length) sim.timer = setTimeout(loop, durMs() * 0.3);
      else stopPlay();
    });
  }

  $('bPlay').onclick = () => {
    if (sim.playing) { stopPlay(); return; }
    if (sim.started && sim.pos >= sim.syms.length) resetSim();
    sim.playing = true; $('bPlay').textContent = '⏸ Pause';
    if (sim.syms.length === 0) { stepForward(stopPlay); return; }
    loop();
  };
  $('bStep').onclick = () => { stopPlay(); if (sim.started && sim.pos >= sim.syms.length) return; stepForward(); };
  $('bBack').onclick = () => {
    stopPlay();
    if (sim.animating) { view.cancelToken(); sim.animating = false; view.setEdge(null); renderSim(); return; }
    if (sim.pos === 0) return;
    sim.pos--; sim.path.pop();
    sim.started = true;
    view.setEdge(sim.pos > 0 ? sim.path[sim.pos - 1] : null, sim.path[sim.pos]);
    if (sim.pos === 0) view.setEdge(null);
    view.setActive(sim.path[sim.pos]);
    renderSim();
  };
  $('bReset').onclick = resetSim;
  $('str').addEventListener('input', () => { resetSim(); saveHash(); });
  $('str').addEventListener('keydown', e => { if (e.key === 'Enter') $('bPlay').click(); });

  /* ---------------- manual builder ---------------- */
  let manual = null; // { alphabet, n, start, accept[], delta[][] }

  function ensureManual() {
    const alphabet = parseAlpha($('malpha').value);
    let n = Math.max(1, Math.min(12, parseInt($('mn').value, 10) || 1));
    $('mn').value = n;
    if (!manual || manual.alphabet.join() !== alphabet.join() || manual.n !== n) {
      const old = manual;
      manual = { alphabet, n, start: 0, accept: Array(n).fill(false), delta: [] };
      for (let s = 0; s < n; s++) manual.delta.push(alphabet.map((c, ci) => (old && old.delta[s] && old.alphabet[ci] === c && old.delta[s][ci] < n ? old.delta[s][ci] : s)));
      if (old) { for (let s = 0; s < Math.min(n, old.n); s++) manual.accept[s] = old.accept[s]; manual.start = old.start < n ? old.start : 0; }
    }
  }
  function renderManual() {
    ensureManual();
    const m = manual, t = $('mtable');
    let h = '<tr><th>State</th><th>Start</th><th>Final</th>' + m.alphabet.map(c => `<th>on ${esc(c)}</th>`).join('') + '</tr>';
    for (let s = 0; s < m.n; s++) {
      h += `<tr><td>${qn(s)}</td><td><input type="radio" name="mstart" data-s="${s}" ${m.start === s ? 'checked' : ''}></td>` +
        `<td><input type="checkbox" data-f="${s}" ${m.accept[s] ? 'checked' : ''}></td>` +
        m.alphabet.map((c, ci) => `<td><select data-s="${s}" data-c="${ci}">` +
          [...Array(m.n).keys()].map(x => `<option value="${x}" ${m.delta[s][ci] === x ? 'selected' : ''}>${qn(x)}</option>`).join('') + '</select></td>').join('') + '</tr>';
    }
    t.innerHTML = h;
    t.querySelectorAll('input[name=mstart]').forEach(i => (i.onchange = () => (m.start = +i.dataset.s)));
    t.querySelectorAll('input[data-f]').forEach(i => (i.onchange = () => (m.accept[+i.dataset.f] = i.checked)));
    t.querySelectorAll('select').forEach(sel => (sel.onchange = () => (m.delta[+sel.dataset.s][+sel.dataset.c] = +sel.value)));
  }
  $('malpha').oninput = $('mn').oninput = renderManual;
  $('mapply').onclick = () => {
    show($('merr'), '');
    try {
      ensureManual();
      const d = L.fromTable(manual);
      setDFA(d, {
        lang: 'Custom DFA (built by hand)',
        en: 'Use the example strings and the animation to explore what it accepts.',
        notes: ['Not minimised — shown exactly as you entered it.'],
      });
      if (window.innerWidth < 980) $('answer').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) { show($('merr'), e.message); }
  };
  $('mfrom').onclick = () => {
    if (!dfa) return;
    $('malpha').value = dfa.alphabet.join(',');
    $('mn').value = Math.min(12, dfa.n);
    manual = { alphabet: dfa.alphabet.slice(), n: Math.min(12, dfa.n), start: dfa.start, accept: dfa.accept.slice(0, 12), delta: dfa.delta.slice(0, 12).map(r => r.map(t => (t < 12 ? t : 0))) };
    renderManual();
  };

  /* ---------------- share via URL hash ---------------- */
  function saveHash() {
    try {
      const p = new URLSearchParams();
      if ($('q').value) p.set('q', $('q').value);
      if ($('alpha').value) p.set('a', $('alpha').value);
      if ($('str').value) p.set('s', $('str').value);
      history.replaceState(null, '', p.toString() ? '#' + p.toString() : location.pathname);
    } catch (e) {}
  }
  function loadHash() {
    const p = new URLSearchParams(location.hash.slice(1));
    $('q').value = p.get('q') || FIRST_EXAMPLE;
    $('alpha').value = p.get('a') || '';
    $('str').value = p.get('s') || '';
  }

  loadHash();
  generate();
})();
