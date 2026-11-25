/**
 * 左下角微缩胶囊（Mini Dock）与悬停快捷切号托盘。
 */
import { store } from '../core/store.js';
import { TEXT } from '../core/text.js';
import { overview, switchLoginTo } from '../core/switcher.js';
import { el } from './dom.js';

export function createDockRenderer({ getRoot, getState, onToggleBorrow }) {
  let lastTrayFingerprint = '';

  function renderDockTray() {
    const root = getRoot();
    if (!root) return;
    const tray = root.querySelector('.dock-tray');
    if (!tray) return;
    const o = overview();
    const rows = o.rows || [];
    const enabled = store.isEnabled();
    const fp =
      rows.map((r) => `${r.id}:${r.isActive}:${r.uname}:${r.vip}:${r.invalid}:${r.face}`).join('|') +
      '|canWrite:' +
      o.canWrite +
      '|en:' +
      enabled;
    if (fp === lastTrayFingerprint && tray.children.length > 0) return;
    lastTrayFingerprint = fp;

    const focusedId = tray.contains(document.activeElement) ? document.activeElement.dataset?.id : null;
    tray.innerHTML = '';

    const head = el('div', 'dock-tray-head');
    head.appendChild(el('span', '', TEXT.dock.quickSwitch));
    const toggleBtn = el(
      'button',
      'dock-toggle' + (enabled ? ' on' : ''),
      TEXT.dock.toggleBorrow + ' ' + (enabled ? TEXT.switches.on : TEXT.switches.off)
    );
    toggleBtn.type = 'button';
    toggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      store.setEnabled(!store.isEnabled());
      lastTrayFingerprint = '';
      if (onToggleBorrow) onToggleBorrow();
    });
    head.appendChild(toggleBtn);
    tray.appendChild(head);

    if (!rows.length) {
      tray.appendChild(el('div', 'dock-tray-empty', TEXT.dock.noOther));
      return;
    }

    const list = el('div', 'dock-tray-list');
    for (const r of rows) {
      const item = el(
        'div',
        'dock-tray-item' + (r.isActive ? ' active' : '') + (!o.canWrite ? ' disabled' : '')
      );
      item.dataset.id = r.id;
      item.tabIndex = 0;
      item.setAttribute('role', 'button');

      if (r.face) {
        const img = el('img', 'avatar');
        img.src = r.face;
        item.appendChild(img);
      } else {
        const init = el('span', 'avatar avatar-initial', (r.uname || r.mid || '?')[0]);
        item.appendChild(init);
      }

      const name = el('span', 'dock-tray-name', r.uname || r.mid || r.id.slice(0, 8));
      item.appendChild(name);

      if (r.invalid) {
        item.appendChild(el('span', 'tag warn', TEXT.pool.labels.invalid));
      } else if (r.vip) {
        item.appendChild(el('span', 'tag vip', TEXT.dock.vipBadge));
      }
      if (r.isActive) {
        item.appendChild(el('span', 'tag on', TEXT.dock.currentBadge));
      }

      item.addEventListener('click', (e) => {
        e.stopPropagation();
        if (r.isActive) return;
        if (!o.canWrite) {
          alert(TEXT.notify.switchUnsupportedLong);
          return;
        }
        if (o.browserMid && !confirm(TEXT.pool.confirms.switch)) return;
        switchLoginTo(r.id).then((sw) => {
          if (sw.ok && sw.needReload) location.reload();
          else if (!sw.ok) alert(sw.reason || TEXT.notify.switchFail);
        });
      });
      item.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          item.click();
        }
      });

      list.appendChild(item);
    }
    tray.appendChild(list);

    if (focusedId) {
      const nextFocus = tray.querySelector(`[data-id="${focusedId}"]`);
      if (nextFocus) nextFocus.focus();
    }
  }

  function renderDot() {
    const root = getRoot();
    if (!root) return;
    const dot = root.querySelector('.dot');
    if (!dot) return;
    const face = root.querySelector('.face');
    const s = getState();
    if (face) face.style.background = s.ok ? '' : s.dot;
    dot.classList.toggle('on', s.ok);
    let badge = root.querySelector('.badge');
    if (!s.ok && s.note) {
      if (!badge) {
        badge = el('div', 'badge');
        dot.appendChild(badge);
      }
      badge.textContent = '!';
      badge.title = s.note;
    } else if (badge) badge.remove();

    const o = overview();
    const cur = o.rows.find((r) => r.isActive);
    let avatarImg = dot.querySelector('.dot-avatar');
    let vipBadge = dot.querySelector('.dot-vip-badge');

    if (cur && cur.face) {
      dot.classList.add('has-avatar');
      if (!avatarImg) {
        avatarImg = el('img', 'dot-avatar');
        dot.insertBefore(avatarImg, dot.firstChild);
      }
      if (avatarImg.src !== cur.face) avatarImg.src = cur.face;
      if (cur.vip) {
        if (!vipBadge) {
          vipBadge = el('span', 'dot-vip-badge');
          vipBadge.title = TEXT.dock.vipBadge;
          dot.appendChild(vipBadge);
        }
      } else if (vipBadge) vipBadge.remove();
    } else {
      dot.classList.remove('has-avatar');
      if (avatarImg) avatarImg.remove();
      if (vipBadge) vipBadge.remove();
    }

    dot.title =
      (s.ok ? TEXT.badge.running : s.note || '') +
      '\n' +
      (cur ? (cur.uname || cur.mid || '') + ' · ' : '') +
      (TEXT.dock.hoverTip || '');
    renderDockTray();
  }

  return { renderDockTray, renderDot };
}
