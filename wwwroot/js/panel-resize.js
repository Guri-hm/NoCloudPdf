
window.registerPanelResize = function (dotNetRef, handleId) {

    try {
        
        if (window._trimResize && window._trimResize.cleanupForHandle) {
            try { window._trimResize.cleanupForHandle(); } catch (e) { }
            window._trimResize.cleanupForHandle = null;
        }

        window._trimResize.dotNetRef = dotNetRef;

        const safeDotNetInvoke = (method, ...args) => {
            try {
                const d = window._trimResize?.dotNetRef;
                if (d && typeof d.invokeMethodAsync === 'function') {
                    d.invokeMethodAsync(method, ...args).catch(() => { });
                }
            } catch (e) { /* ignore */ }
        };

        const handle = document.getElementById(handleId);
        const thumbArea = document.getElementById('thumbnail-area');
        if (!handle) {
            console.warn('registerPanelResize: handle element not found:', handleId);
            return;
        }

        const minLeft = 150;
        const minRight = 260;
        const MAX_LEFT = 600;

        function measureAvail() {
            const vw = window.innerWidth || document.documentElement.clientWidth;
            // tailwindのmdブレークポイント
            const isMobileHeaderSidebar = vw < 768;
            const sidebarEl = document.querySelector('.sidebar');
            const sidebarW = (sidebarEl && !isMobileHeaderSidebar) ? Math.round(sidebarEl.getBoundingClientRect().width) : 0;
            const avail = Math.max(0, vw - sidebarW);
            return { vw, sidebarW, isMobileHeaderSidebar, avail };
        }

        function computeOriginLeft(measured) {
            return measured.sidebarW || 0;
        }

        let pending = false;
        let latestClientX = 0;

        function applyWidthsUsingAvail(requestedLeft) {
            try {
                const measured = measureAvail();
                const avail = measured.avail;
                const splitterW = handle.getBoundingClientRect().width || 8;

                const availableForLeft = Math.max(minLeft, Math.round(avail - minRight - splitterW));
                const allowedMaxLeft = Math.min(availableForLeft, MAX_LEFT);
                let left = Math.max(minLeft, Math.min(allowedMaxLeft, Math.round(requestedLeft)));

                const right = Math.max(minRight, Math.round(avail - left - splitterW));

                if (thumbArea) {
                    thumbArea.style.setProperty('--thumbnail-width', left + 'px');
                    thumbArea.style.width = left + 'px';
                    thumbArea.style.flex = `0 0 ${left}px`;
                }

                const splitEl = document.getElementById('split-container');
                const rightPane = splitEl ? splitEl.querySelector(':scope > .flex-1') : (handle.nextElementSibling || null);
                if (rightPane) {
                    rightPane.style.width = right + 'px';
                    rightPane.style.flex = '0 0 auto';
                    rightPane.style.minWidth = '0';
                    rightPane.style.maxWidth = right + 'px';
                }

                splitEl && splitEl.offsetHeight;
                try { if (window._trimResize && window._trimResize.updateAllTrimOverlays) window._trimResize.updateAllTrimOverlays(); } catch (e) { /* ignore */ }

                window._trimResize.lastAppliedLeft = left;
                window._trimResize.lastAvail = avail;
            } catch (e) {
                console.error('applyWidthsUsingAvail error', e);
            }
        }

        const onPointerDown = function (e) {
            try {
                try {
                    window._trimResize.suspendFitZoom = true;
                } catch (ex) { /* ignore */ }
                handle.setPointerCapture?.(e.pointerId);

                const onPointerMove = function (ev) {
                    latestClientX = ev.clientX;
                    if (!pending) {
                        pending = true;
                        requestAnimationFrame(function () {
                            pending = false;
                            try {
                                const measured = measureAvail();
                                const originLeft = computeOriginLeft(measured);
                                const computedLeft = Math.round(latestClientX - originLeft);
                                applyWidthsUsingAvail(computedLeft);

                            } catch (err) {
                                console.error('onPointerMove error', err);
                            }
                        });
                    }
                };

                const onPointerUp = function (ev) {
                    try {
                        handle.releasePointerCapture?.(ev.pointerId);

                        const measured = measureAvail();
                        const originLeft = computeOriginLeft(measured);
                        const splitterW = handle.getBoundingClientRect().width || 8;

                        const availForCalc = measured.avail;
                        const availableForLeft = Math.max(minLeft, Math.round(availForCalc - minRight - splitterW));
                        const allowedMaxLeft = Math.min(availableForLeft, MAX_LEFT); // JS 側で MAX を考慮
                        const computedFinalLeft = Math.round(ev.clientX - originLeft);
                        const finalLeftWidth = Math.max(minLeft, Math.min(allowedMaxLeft, computedFinalLeft));

                        safeDotNetInvoke('CommitPanelWidth', finalLeftWidth);

                        applyWidthsUsingAvail(finalLeftWidth);

                        requestAnimationFrame(function () {
                            if (window._trimResize && window._trimResize.updateAllTrimOverlays) window._trimResize.updateAllTrimOverlays();
                        });
                    } catch (err) {
                        console.error('onPointerUp error', err);
                    } finally {
                        try { window._trimResize.suspendFitZoom = false; } catch (ex) { /* ignore */ }
                        handle.removeEventListener('pointermove', onPointerMove);
                        handle.removeEventListener('pointerup', onPointerUp);
                    }
                };

                handle.addEventListener('pointermove', onPointerMove);
                handle.addEventListener('pointerup', onPointerUp);
            } catch (e) {
                console.error('onPointerDown error', e);
            }
        };

        handle.addEventListener('pointerdown', onPointerDown);

        window._trimResize.cleanupForHandle = function () {
            try { handle.removeEventListener('pointerdown', onPointerDown); } catch (e) { /* ignore */ }
            window._trimResize.dotNetRef = null;
        };
    } catch (e) {
        console.error('registerPanelResize error', e);
    }
};

window.unregisterPanelResize = function () {
    try {
        if (window._trimResize.cleanupForHandle) {
            window._trimResize.cleanupForHandle();
            window._trimResize.cleanupForHandle = null;
        }
        window._trimResize.dotNetRef = null;
    } catch (e) {
        console.error('unregisterPanelResize error', e);
    }
};

window._trimResize = window._trimResize || {
    dotNetRef: null,
    cleanupForHandle: null,
    windowResizeDotNetRef: null,
    windowResizeCallback: null,
    updateAllTrimOverlays: null,
    lastAppliedLeft: null,
    lastAvail: null,
    suspendFitZoom: false
};

function ensureSharedTrimResizeHandler() {
    try {
        if (window._trimShared && window._trimShared.resizeHandler) return;
        const handler = function () {
            try {
                if (window._trimShared.timer) clearTimeout(window._trimShared.timer);
                window._trimShared.timer = setTimeout(() => {
                    try {

                        const keys = Object.keys(window._simpleTrim || {});
                        keys.forEach(id => {
                            try {
                                const entry = (window._simpleTrim || {})[id];
                                if (entry && entry.internal && typeof entry.internal.onAnyScrollOrResize === 'function') {
                                    try { entry.internal.onAnyScrollOrResize(); } catch (e) { /* ignore per-entry */ }
                                } else if (entry && entry.internal && typeof entry.internal.resize === 'function') {
                                    try { entry.internal.resize(); } catch (e) { /* ignore per-entry */ }
                                }
                            } catch (e) { /* ignore */ }
                        });

                        try {
                            if (window._trimResize && typeof window._trimResize.windowResizeCallback === 'function') {
                                try { window._trimResize.windowResizeCallback(); } catch (e) { /* ignore */ }
                            }
                        } catch (e) { /* ignore */ }
                    } catch (e) { /* ignore */ }
                }, window._trimShared.debounceMs);
            } catch (e) { /* ignore */ }
        };
        window._trimShared.resizeHandler = handler;
        window.addEventListener('resize', handler, { passive: true });
        if (window.visualViewport && window.visualViewport.addEventListener) {
            window.visualViewport.addEventListener('resize', handler, { passive: true });
            window.visualViewport.addEventListener('scroll', handler, { passive: true });
        }
    } catch (e) {
        console.error('ensureSharedTrimResizeHandler error', e);
    }
}
window.getAvailableWidth = function () {
    try {
        const sidebarEl = document.querySelector('.sidebar');
        const vw = window.innerWidth || document.documentElement.clientWidth;
        const sidebarW = sidebarEl ? Math.round(sidebarEl.getBoundingClientRect().width) : 0;
        const avail = Math.max(0, vw - sidebarW);
        return { avail, sidebarW, vw };
    } catch (e) {
        return { avail: (window.innerWidth || document.documentElement.clientWidth), sidebarW: 0, vw: (window.innerWidth || document.documentElement.clientWidth) };
    }
};

window.applyThumbnailWidth = function (leftPx) {
    try {
        const thumb = document.getElementById('thumbnail-area');
        const handle = document.getElementById('splitter-handle');
        if (!thumb) return;
        const splitterW = handle ? (handle.getBoundingClientRect().width || 8) : 8;

        thumb.style.setProperty('--thumbnail-width', Math.round(leftPx) + 'px');
        thumb.style.width = Math.round(leftPx) + 'px';

        return true;
    } catch (e) {
        console.error('applyThumbnailWidth error', e);
        return false;
    }
};


// ブラウザのウィンドウサイズ変化を検知して、サムネイル左パネルと右プレビュー領域の幅を再計算・適用
window.registerWindowResize = function (dotNetRef, debounceMs = 500) {
    try {
        if (!dotNetRef) return;

        window._trimResize.windowResizeCallback = null;
        window._trimResize.windowResizeDotNetRef = dotNetRef;

        function measureAndNotify() {
            try {
                const vw = window.innerWidth || document.documentElement.clientWidth;
                // tailwindのブレークポイントを参考
                const TW_BREAKPOINTS_MD = 768;
                const IS_MOBILE_HEADER_SIDEBAR = vw < TW_BREAKPOINTS_MD;
                const sidebarEl = document.querySelector('.sidebar');
                const sidebarW = (sidebarEl && !IS_MOBILE_HEADER_SIDEBAR) ? Math.round(sidebarEl.getBoundingClientRect().width) : 0;
                const avail = Math.max(0, vw - sidebarW);

                try {
                    const MIN_LEFT = 200;
                    const MAX_LEFT = 600;
                    const MIN_RIGHT = 260;
                    const handle = document.getElementById('splitter-handle');
                    const splitterW = handle ? (handle.getBoundingClientRect().width || 8) : 8;

                    let leftPx = Math.round(avail * 0.25);
                    leftPx = Math.max(MIN_LEFT, Math.min(MAX_LEFT, leftPx));
                    leftPx = Math.min(leftPx, Math.max(MIN_LEFT, Math.round(avail - MIN_RIGHT - splitterW)));

                    const rightPx = Math.max(0, Math.round(avail - leftPx - splitterW));

                    const thumb = document.getElementById('thumbnail-area');
                    if (thumb) {
                        thumb.style.setProperty('--thumbnail-width', leftPx + 'px');
                        thumb.style.width = leftPx + 'px';
                        thumb.style.flex = `0 0 ${leftPx}px`;
                    }

                    const splitEl = document.getElementById('split-container');
                    const rightPane = splitEl ? splitEl.querySelector(':scope > .flex-1') : (document.getElementById('trim-preview-container')?.closest('.flex-1') || null);
                    if (rightPane) {
                        rightPane.style.width = '';
                        rightPane.style.flex = '1 1 0%';
                        rightPane.style.minWidth = '0';
                        rightPane.style.maxWidth = rightPx + 'px';
                    }

                    if (window._trimResize && window._trimResize.windowResizeDotNetRef) {
                        try {
                            // 利用可能幅をBlazor側に通知
                            window._trimResize.windowResizeDotNetRef.invokeMethodAsync('OnWindowResizedFromJs', avail, sidebarW).catch(() => { });
                        } catch (e) { /* ignore */ }
                    }

                    try { splitEl && splitEl.offsetHeight; } catch (e) { /* ignore */ }

                    if (window._trimResize?.updateAllTrimOverlays) {
                        try {
                            window._trimResize.updateAllTrimOverlays();
                        } catch (e) { console.error(e); }
                    }

                } catch (e) {
                    console.error('measureAndNotify inner error', e);
                }
            } catch (e) {
                console.error('measureAndNotify error', e);
            }
        }

        window._trimResize.windowResizeCallback = measureAndNotify;

        try { window._trimShared = window._trimShared || {}; window._trimShared.debounceMs = Number(debounceMs) || window._trimShared.debounceMs || 120; } catch (e) { /* ignore */ }

        if (typeof ensureSharedTrimResizeHandler === 'function') ensureSharedTrimResizeHandler();

        try { measureAndNotify(); } catch (e) { /* ignore */ }

        window._trimResize.unregisterWindowResize = function () {
            try {
                if (window._trimResize) {
                    window._trimResize.windowResizeCallback = null;
                    window._trimResize.windowResizeDotNetRef = null;
                }
            } catch (e) { /* ignore */ }
        };
    } catch (e) {
        console.error('registerWindowResize error', e);
    }
};

window.unregisterWindowResize = function () {
    try {
        if (window._trimResize && window._trimResize.unregisterWindowResize) {
            window._trimResize.unregisterWindowResize();
            window._trimResize.unregisterWindowResize = null;
        }
    } catch (e) {
        console.error('unregisterWindowResize error', e);
    }
};

window._trimShared = window._trimShared || { resizeHandler: null, timer: null, debounceMs: 120 };
