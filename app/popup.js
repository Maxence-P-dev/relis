'use strict';
// Mini-fenêtre : affiche les fautes soulignées, permet de choisir chaque correction puis de tout appliquer.

const card = document.getElementById('card');
let view = null; // { text, matches, choice[] } ; choice[i] = index de suggestion, ou null = garder l'original
let open = -1; // faute dont le détail est affiché
let autoClose = 0;

const KIND_LABEL = { spelling: 'Orthographe', grammar: 'Grammaire', typo: 'Typographie', style: 'Style' };

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

const ICON = {
  check: '<svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg>',
  x: '<svg viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></svg>',
  warn: '<svg viewBox="0 0 24 24"><path d="m21.7 18-8-14a2 2 0 0 0-3.5 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3Z"/><path d="M12 9v4M12 17h.01"/></svg>',
};

function header(title, extra) {
  const head = el('header', 'head');
  const brand = el('div', 'brand');
  brand.append(el('span', 'logo'), el('span', null, title));
  head.append(brand);
  if (extra) head.append(extra);
  const close = el('button', 'icon');
  close.title = 'Fermer (Échap)';
  close.innerHTML = ICON.x;
  close.onclick = cancel;
  head.append(close);
  return head;
}

function render(payload) {
  clearTimeout(autoClose);
  card.className = 'card';
  card.replaceChildren();
  open = -1;
  if (payload.state === 'loading') {
    card.append(header('Relis'), el('div', 'status loading', 'Relecture en cours…'));
  } else if (payload.state === 'empty') {
    card.append(header('Relis'), el('div', 'status', 'Aucun texte trouvé. Sélectionne du texte ou place-toi dans un champ, puis recommence.'));
  } else if (payload.state === 'error') {
    const s = el('div', 'status error');
    s.innerHTML = ICON.warn;
    s.append(el('span', null, payload.message));
    card.append(header('Relis'), s);
  } else if (!payload.matches.length) {
    const s = el('div', 'status ok');
    s.innerHTML = ICON.check;
    s.append(el('span', null, 'Aucune faute trouvée.'));
    card.append(header('Relis'), s);
    autoClose = setTimeout(cancel, 1400);
  } else {
    view = { text: payload.text, matches: payload.matches, choice: payload.matches.map((m) => (m.replacements.length ? 0 : null)) };
    renderResult();
  }
  fit();
}

function renderResult() {
  const { text, matches, choice } = view;
  const n = choice.filter((c) => c !== null).length;
  card.replaceChildren();
  card.append(header('Relis', el('span', 'count', `${matches.length} faute${matches.length > 1 ? 's' : ''}`)));

  const body = el('div', 'text');
  let pos = 0;
  matches.forEach((m, i) => {
    if (m.offset < pos) return; // chevauchement : on garde la première
    body.append(text.slice(pos, m.offset));
    const mark = el('button', `mark ${m.kind}${choice[i] === null ? ' kept' : ''}${open === i ? ' open' : ''}`);
    mark.textContent = choice[i] === null ? m.word : m.replacements[choice[i]];
    mark.title = `${m.word} → ${m.message}`;
    mark.onclick = () => {
      open = open === i ? -1 : i;
      renderResult();
    };
    body.append(mark);
    pos = m.offset + m.length;
  });
  body.append(text.slice(pos));
  card.append(body);

  if (open >= 0) card.append(detail(open));

  const foot = el('footer', 'foot');
  const cancelBtn = el('button', 'btn ghost', 'Annuler');
  cancelBtn.append(el('kbd', null, 'Échap'));
  cancelBtn.onclick = cancel;
  const applyBtn = el('button', 'btn primary', n ? `Corriger ${n > 1 ? `(${n})` : ''}`.trim() : 'Rien à corriger');
  applyBtn.append(el('kbd', null, 'Entrée'));
  applyBtn.disabled = !n;
  applyBtn.onclick = apply;
  foot.append(el('span', 'hint', 'Clique sur un mot pour choisir'), cancelBtn, applyBtn);
  card.append(foot);
  fit();
}

function detail(i) {
  const m = view.matches[i];
  const box = el('div', `detail ${m.kind}`);
  const top = el('div', 'detail-top');
  top.append(el('span', 'kind', KIND_LABEL[m.kind]), el('span', 'title', m.title));
  box.append(top, el('p', 'msg', m.message));
  const chips = el('div', 'chips');
  m.replacements.forEach((r, k) => {
    const c = el('button', `chip${view.choice[i] === k ? ' on' : ''}`, r || '(supprimer)');
    c.onclick = () => {
      view.choice[i] = k;
      open = -1;
      renderResult();
    };
    chips.append(c);
  });
  const keep = el('button', `chip keep${view.choice[i] === null ? ' on' : ''}`, `Garder « ${m.word} »`);
  keep.onclick = () => {
    view.choice[i] = null;
    open = -1;
    renderResult();
  };
  chips.append(keep);
  if (m.kind === 'spelling') {
    const dict = el('button', 'chip dict', 'Ajouter au dictionnaire');
    dict.onclick = async () => {
      await window.relis.ignoreAlways(m.word);
      // Le mot est accepté partout dans ce texte aussi.
      view.matches.forEach((x, j) => {
        if (x.kind === 'spelling' && x.word.toLowerCase() === m.word.toLowerCase()) view.choice[j] = null;
      });
      open = -1;
      renderResult();
    };
    chips.append(dict);
  }
  box.append(chips);
  return box;
}

function apply() {
  if (!view) return;
  const edits = view.matches
    .map((m, i) => (view.choice[i] === null ? null : { offset: m.offset, length: m.length, replacement: m.replacements[view.choice[i]] }))
    .filter(Boolean);
  if (!edits.length) return;
  view = null;
  window.relis.decide({ action: 'apply', edits });
}

function cancel() {
  clearTimeout(autoClose);
  view = null;
  window.relis.decide({ action: 'cancel' });
}

let fitFrame = 0;
function fit() {
  cancelAnimationFrame(fitFrame);
  fitFrame = requestAnimationFrame(() => window.relis.height(Math.ceil(card.getBoundingClientRect().height) + 24));
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') return e.preventDefault(), cancel();
  if (e.key === 'Enter' && view) {
    // Entrée sur une suggestion la choisit ; ailleurs, elle applique tout.
    if (document.activeElement?.classList.contains('chip') || document.activeElement?.classList.contains('mark')) return;
    e.preventDefault();
    apply();
  }
});

window.relis.onShow(render);
