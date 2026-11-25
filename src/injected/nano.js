/**
 * nanoPlayer（新版 Next.js 番剧 / OGV 播放器）首屏接管与提示条清理控制器。
 */

const VIP_PROMPT_SELECTOR =
  '.bpx-player-toast-item, #BilibiliVipDialog, [class*="paywallView_container"], [data-testid="paywall-title"], [class*="PromptBar_container"], [data-testid="prompt-bar-title"], [class*="PromptBar_remindInfoWrap"]';

export function createNanoController(getState) {
  let promptObserver = null;
  let promptRetryTimer = null;
  let hookPlayerRef = null;
  let playerVal = window.player;
  let createdPlayerVal = null;
  let playerWatchTimer = null;
  let nanoVal = window.nano;

  /**
   * 会员收银台/提示条在首屏 SSR 阶段就可能被页面自己渲染出来，
   * 等 JS 观察器跑起来再删会有明显闪烁，极端情况下收银台 iframe
   * 甚至会在删除后重新创建。这里在配置就绪后先钉一条 CSS，
   * 保证会员弹窗不会显示。
   */
  function ensureVipCss() {
    const st = getState();
    if (!st.patchVip || typeof document === 'undefined') return;
    try {
      if (document.getElementById('bili-vip-hide')) return;
      const root = document.head || document.documentElement || document.body;
      if (!root || typeof root.appendChild !== 'function') return;
      const style = document.createElement('style');
      style.id = 'bili-vip-hide';
      style.textContent =
        '#BilibiliVipDialog,#pc-cashier-wrapper-video,#pc-cashier-wrapper-wide,#pc-cashier-wrapper-normal,' +
        '[class*="paywallView_container"],[data-testid="paywall-title"],' +
        '[class*="PromptBar_container"],[data-testid="prompt-bar-title"],[class*="PromptBar_remindInfoWrap"]' +
        '{display:none !important;visibility:hidden !important;}';
      root.appendChild(style);
    } catch (e) {}
  }

  /**
   * 钩子晚于页面内联脚本时，window.player 已经带着 A 的 SSR 试看数据建好了。
   * 仅接管 player 不一定能让它重新取流：先记一个一次性标记，自动刷新一次，
   * 让下一份文档从 document-start 开始就由钩子接管。标记按路径存，刷新后不再触发。
   */
  function latePlayerReload() {
    let key;
    try {
      key = 'bili-vip:late-reload:' + location.pathname + location.search;
      if (!playerVal) {
        sessionStorage.removeItem(key);
        return;
      }
      if (!getState().hidePlayinfo || !/^\/(bangumi\/play|video)\//.test(location.pathname)) return;
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, '1');
    } catch (e) {
      return;
    }
    setTimeout(function () {
      try {
        location.reload();
      } catch (e) {}
    }, 300);
  }

  function isBangumiPage() {
    try {
      return typeof location !== 'undefined' && typeof location.pathname === 'string' && location.pathname.indexOf('/bangumi/play/') === 0;
    } catch (e) {
      return false;
    }
  }

  function currentPlayer() {
    try {
      return window.player || playerVal || createdPlayerVal;
    } catch (e) {
      return playerVal || createdPlayerVal;
    }
  }

  function removeVipPromptBar() {
    const st = getState();
    if (!st.patchVip || typeof document === 'undefined') return;
    try {
      const selectors = [
        '.bpx-player-toast-item',
        '[class*="PromptBar_container"]',
        '[data-testid="prompt-bar-title"]',
        '[class*="PromptBar_remindInfoWrap"]'
      ];
      for (let s = 0; s < selectors.length; s++) {
        const items = document.querySelectorAll(selectors[s]);
        for (let i = items.length - 1; i >= 0; i--) {
          const text = items[i].textContent || '';
          if (!/大会员专享|成为大会员|试看中/.test(text)) continue;
          const host = items[i].closest ? items[i].closest('[class*="PromptBar_container"]') : null;
          (host || items[i]).remove();
        }
      }
      const dialog = document.getElementById('BilibiliVipDialog');
      if (dialog) dialog.remove();
      const paywalls = document.querySelectorAll('[class*="paywallView_container"], [data-testid="paywall-title"]');
      for (let j = paywalls.length - 1; j >= 0; j--) {
        const payHost = paywalls[j].closest ? paywalls[j].closest('[class*="paywallView_container"]') : null;
        (payHost || paywalls[j]).remove();
      }
      const bp = document.getElementById('big-block-panel');
      if (bp) bp.remove();
    } catch (e) {}
  }

  function disconnectVipPrompt() {
    if (promptRetryTimer) {
      clearTimeout(promptRetryTimer);
      promptRetryTimer = null;
    }
    if (promptObserver) {
      try {
        promptObserver.disconnect();
      } catch (e) {}
      promptObserver = null;
    }
  }

  function watchVipPrompt() {
    const st = getState();
    if (!st.patchVip || promptObserver || typeof MutationObserver === 'undefined' || typeof document === 'undefined') return;
    const root = document.documentElement || document.body;
    if (!root) {
      if (!promptRetryTimer) {
        promptRetryTimer = setTimeout(() => {
          promptRetryTimer = null;
          watchVipPrompt();
        }, 50);
      }
      return;
    }
    promptObserver = new MutationObserver((records) => {
      if (!getState().patchVip) {
        disconnectVipPrompt();
        return;
      }
      for (let i = 0; i < records.length; i++) {
        const added = records[i].addedNodes || [];
        for (let j = 0; j < added.length; j++) {
          const node = added[j];
          if (!node || node.nodeType !== 1) continue;
          if (
            (node.matches && node.matches(VIP_PROMPT_SELECTOR)) ||
            (node.childElementCount > 0 && node.querySelector && node.querySelector(VIP_PROMPT_SELECTOR))
          ) {
            removeVipPromptBar();
            return;
          }
        }
      }
    });
    promptObserver.observe(root, { childList: true, subtree: true });
    removeVipPromptBar();
  }

  function wrapUpdateRequestConfig(player) {
    if (!player || player.__biliUpdateCfgWrapped) return;
    const origUpdateRequestConfig = player.updateRequestConfig;
    if (typeof origUpdateRequestConfig !== 'function') return;
    player.__biliUpdateCfgWrapped = true;
    // 晚到的钩子拿到的是已经创建好的播放器：页面内联脚本早把
    // reqHttpPlayUrlInfo 指向 SSR 的试看数据了，单靠包装之后的
    // updateRequestConfig 清不掉这份旧绑定。这里先显式置空，
    // 让 reload 回落到 /pgc/player/web/v2/playurl 走代理。
    try {
      origUpdateRequestConfig.call(player, {
        reqHttpPlayUrlInfo: null,
        reqHttpPlayUrlInfoScope: null
      });
    } catch (e) {}
    player.updateRequestConfig = function (cfg) {
      if (getState().hidePlayinfo && cfg && typeof cfg === 'object') {
        try {
          delete cfg.reqHttpPlayUrlInfo;
          delete cfg.reqHttpPlayUrlInfoScope;
        } catch (e) {}
      }
      return origUpdateRequestConfig.apply(this, arguments);
    };
  }

  function stopPlayerWatch() {
    if (playerWatchTimer) {
      clearInterval(playerWatchTimer);
      playerWatchTimer = null;
    }
  }

  function startPlayerWatch() {
    if (!getState().canBorrow || playerWatchTimer || typeof setInterval === 'undefined') return;
    if (!isBangumiPage() && !nanoVal) return;
    const cur = currentPlayer();
    if (cur && cur.__biliVipPlayerHooked) return;
    let tries = 0;
    playerWatchTimer = setInterval(() => {
      tries++;
      if (!getState().canBorrow) {
        stopPlayerWatch();
        return;
      }
      const p = currentPlayer();
      if (p && hookPlayerRef) {
        const hooked = hookPlayerRef(p);
        if (p === playerVal) playerVal = hooked;
        if (hooked && hooked.__biliVipPlayerHooked) {
          stopPlayerWatch();
          return;
        }
      }
      if (tries >= 60) {
        stopPlayerWatch();
      }
    }, 250);
  }

  function hookPlayer(player) {
    if (!player) return player;
    const st = getState();
    if (st.hidePlayinfo) wrapUpdateRequestConfig(player);
    if (!st.canBorrow || player.__biliVipPlayerHooked) return player;
    player.__biliVipPlayerHooked = true;
    if (st.patchVip) watchVipPrompt();

    const origOn = player.on;
    if (typeof origOn === 'function') {
      player.on = function (event) {
        if (
          getState().canBorrow &&
          (event === 'Player_Access_Changed' ||
            event === 'player_access_changed' ||
            (window.nano && window.nano.EventType && event === window.nano.EventType.Player_Access_Changed))
        ) {
          return this;
        }
        return origOn.apply(this, arguments);
      };
    }

    if (typeof origOn === 'function') {
      try {
        origOn.call(player, 'player_block', () => {
          const cur = getState();
          if (!cur.canBorrow) return;
          try {
            if (typeof player.toggleFeature === 'function') {
              player.toggleFeature({ play: false, pause: false, seek: false, shortcut: false });
            }
            if (cur.patchVip) removeVipPromptBar();
            if (typeof player.play === 'function') {
              player.play().catch(() => {});
            }
          } catch (e) {}
        });
      } catch (e) {}
    }

    if (!player.__biliReloaded) {
      player.__biliReloaded = true;
      setTimeout(() => {
        if (!getState().canBorrow) return;
        try {
          if (typeof player.toggleFeature === 'function') {
            player.toggleFeature({ play: false, pause: false, seek: false, shortcut: false });
          }
          if (typeof player.reload === 'function') {
            player.reload();
          }
        } catch (e) {}

        let attempts = 0;
        const unlockTimer = setInterval(() => {
          attempts++;
          const cur = getState();
          if (!cur.canBorrow) {
            clearInterval(unlockTimer);
            return;
          }
          if (cur.patchVip) removeVipPromptBar();

          try {
            if (typeof player.toggleFeature === 'function') {
              player.toggleFeature({ play: false, pause: false, seek: false, shortcut: false });
            }
          } catch (e) {}

          const v = player.mediaElement || (typeof document !== 'undefined' ? document.querySelector('video') : null);
          const isBlob = v && v.currentSrc && v.currentSrc.indexOf('blob:') === 0;

          if (v && v.paused) {
            try {
              if (typeof player.play === 'function') {
                player.play().catch(() => {});
              }
            } catch (e) {}
          }

          if ((v && !v.paused && isBlob) || attempts >= 15) {
            clearInterval(unlockTimer);
          }
        }, 300);
      }, 50);
    }
    return player;
  }

  function hookNano(nano) {
    if (!nano || nano.__biliVipHooked) return nano;
    nano.__biliVipHooked = true;
    const st = getState();
    if (st.patchVip) watchVipPrompt();

    hookPlayerRef = hookPlayer;
    if (playerVal) playerVal = hookPlayer(playerVal);
    if (createdPlayerVal && createdPlayerVal !== playerVal) hookPlayer(createdPlayerVal);
    if (st.canBorrow) startPlayerWatch();

    const origCreate = nano.createPlayer;
    if (typeof origCreate !== 'function') return nano;

    nano.createPlayer = function (config) {
      if (config && getState().hidePlayinfo) {
        if (config.prefetch) delete config.prefetch.playUrl;
        if (config.requestConfig) {
          delete config.requestConfig.reqHttpPlayUrlInfo;
          delete config.requestConfig.reqHttpPlayUrlInfoScope;
        }
      }
      const created = origCreate.apply(this, arguments);
      if (created) createdPlayerVal = created;
      return hookPlayer(created);
    };

    return nano;
  }

  function install() {
    if (nanoVal) hookNano(nanoVal);
    try {
      Object.defineProperty(window, 'nano', {
        configurable: true,
        enumerable: true,
        get() {
          return nanoVal;
        },
        set(v) {
          nanoVal = hookNano(v);
        }
      });
    } catch (e) {}

    try {
      Object.defineProperty(window, 'player', {
        configurable: true,
        enumerable: true,
        get() {
          return playerVal;
        },
        set(v) {
          if (v && getState().hidePlayinfo) wrapUpdateRequestConfig(v);
          playerVal = hookPlayerRef ? hookPlayerRef(v) : v;
        }
      });
    } catch (e) {}
    ensureVipCss();
    latePlayerReload();
  }

  function onConfigChange() {
    const st = getState();
    if (st.patchVip) {
      ensureVipCss();
      if (isBangumiPage() || nanoVal) watchVipPrompt();
    } else {
      disconnectVipPrompt();
    }
    if (st.canBorrow) {
      const curPlayer = currentPlayer();
      if (curPlayer && hookPlayerRef) {
        playerVal = hookPlayerRef(curPlayer);
      }
      if (isBangumiPage() || nanoVal) startPlayerWatch();
    } else {
      stopPlayerWatch();
    }
  }

  return { install, onConfigChange };
}
