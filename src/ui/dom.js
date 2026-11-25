/**
 * 面板通用 DOM 构建原语。
 */

export const TAG_KIND = {
  required: 'vip',
  ogv: 'borrow',
  identity: 'on',
  auto: 'muted',
  optional: 'plain'
};

export function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export function section(title) {
  const s = el('div', 'sec');
  if (title) s.appendChild(el('div', 'lbl', title));
  return s;
}

export function segmented(options, current, onPick) {
  const seg = el('div', 'seg');
  let cur = current;
  for (const o of options) {
    const b = el('button', o.value === cur ? 'on' : '', o.label);
    b.title = o.title || o.label;
    b.addEventListener('click', () => {
      if (o.value === cur) return;
      onPick(o.value);
      cur = o.value;
      for (const x of seg.children) x.className = '';
      b.className = 'on';
    });
    seg.appendChild(b);
  }
  return seg;
}

export function row(label, control, title) {
  const r = el('div', 'row');
  const sp = el('span', '', label);
  if (title) sp.title = title;
  r.appendChild(sp);
  r.appendChild(control);
  return r;
}

export function details(summary, text) {
  const d = el('details');
  d.appendChild(el('summary', '', summary));
  d.appendChild(el('pre', 'help', text));
  return d;
}

export function mkBtn(text, fn, attrs) {
  const b = el('button', 'act', text);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) b[k] = v;
  }
  b.addEventListener('click', fn);
  return b;
}
