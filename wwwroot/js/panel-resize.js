
window.registerPanelResize = function (dotNetRef, handleId, panelDebounceMs = 1500) {
    try {
        if (window._trimResize && window._trimResize.cleanupForHandle) {
            try { window._trimResize.cleanupForHandle(); } catch (e) { }
            window._trimResize.cleanupForHandle = null;
        }

        window._trimResize.dotNetRef = dotNetRef;

        const handle = document.getElementById(handleId);
        const thumbArea = document.getElementById('thumbnail-area');
        if (!handle) {
            console.warn('registerPanelResize: handle element not found:', handleId);
            return;
        }

        const minLeft = 150;
        const minRight = 260;

        function measureAvail() {
            const vw = window.innerWidth || document.documentElement.clientWidth;
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

        const PANEL_DEBOUNCE = Number(panelDebounceMs) || 500;
        let lastNotify = 0;
        let notifyTimer = null;
        let pendingClientXForNotify = null;

        function scheduleDotNetNotify(clientX) {
            pendingClientXForNotify = clientX;
            const now = Date.now();
            if (!lastNotify || (now - lastNotify) >= PANEL_DEBOUNCE) {
                lastNotify = now;
                if (window._trimResize && window._trimResize.dotNetRef && window._trimResize.dotNetRef.invokeMethodAsync) {
                    try { window._trimResize.dotNetRef.invokeMethodAsync('OnPanelMouseMove', clientX).catch(() => { }); } catch (e) { /* ignore */ }
                }
            } else {
                const remaining = PANEL_DEBOUNCE - (now - lastNotify);
                if (notifyTimer) clearTimeout(notifyTimer);
                notifyTimer = setTimeout(() => {
                    lastNotify = Date.now();
                    if (window._trimResize && window._trimResize.dotNetRef && window._trimResize.dotNetRef.invokeMethodAsync) {
                        try { window._trimResize.dotNetRef.invokeMethodAsync('OnPanelMouseMove', pendingClientXForNotify).catch(() => { }); } catch (e) { /* ignore */ }
                    }
                    notifyTimer = null;
                    pendingClientXForNotify = null;
                }, remaining);
            }
        }

        // ★ 簡素化: flex-basis のみ変更し、固定幅は設定しない
        function applyFlexBasis(requestedLeft) {
            try {
                const measured = measureAvail();
                const avail = measured.avail;

                const availableForLeft = Math.max(minLeft, Math.round(avail - minRight));
                let left = Math.max(minLeft, Math.min(availableForLeft, Math.round(requestedLeft)));

                if (thumbArea) {
                    thumbArea.style.flexBasis = left + 'px';
                }

                window._trimResize.lastAppliedLeft = left;
                window._trimResize.lastAvail = avail;
            } catch (e) {
                console.error('applyFlexBasis error', e);
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
                                applyFlexBasis(computedLeft);

                                scheduleDotNetNotify(latestClientX);
                            } catch (err) {
                                console.error('onPointerMove error', err);
                            }
                        });
                    }
                };

                const onPointerUp = function (ev) {
                    try {
                        handle.releasePointerCapture?.(ev.pointerId);

                        if (notifyTimer) {
                            clearTimeout(notifyTimer);
                            notifyTimer = null;
                        }
                        if (pendingClientXForNotify != null && window._trimResize && window._trimResize.dotNetRef && window._trimResize.dotNetRef.invokeMethodAsync) {
                            try { window._trimResize.dotNetRef.invokeMethodAsync('OnPanelMouseMove', pendingClientXForNotify).catch(() => { }); } catch (e) { /* ignore */ }
                            pendingClientXForNotify = null;
                        }

                        const measured = measureAvail();
                        const originLeft = computeOriginLeft(measured);

                        const availForCalc = measured.avail;
                        const maxLeft = Math.max(minLeft, Math.round(availForCalc - minRight));
                        const computedFinalLeft = Math.round(ev.clientX - originLeft);
                        const finalLeftWidth = Math.max(minLeft, Math.min(maxLeft, computedFinalLeft));

                        if (window._trimResize && window._trimResize.dotNetRef && window._trimResize.dotNetRef.invokeMethodAsync) {
                            try { window._trimResize.dotNetRef.invokeMethodAsync('CommitPanelWidth', finalLeftWidth).catch(() => { }); } catch (e) { /* ignore */ }
                        }

                        applyFlexBasis(finalLeftWidth);

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

window.registerWindowResize = function (dotNetRef, debounceMs = 500) {
    try {
        if (!dotNetRef) return;

        window._trimResize.windowResizeCallback = null;
        window._trimResize.windowResizeDotNetRef = dotNetRef;

        function measureAndNotify() {
            try {
                const vw = window.innerWidth || document.documentElement.clientWidth;
                const TW_BREAKPOINTS_MD = 768;
                const IS_MOBILE_HEADER_SIDEBAR = vw < TW_BREAKPOINTS_MD;
                const sidebarEl = document.querySelector('.sidebar');
                const sidebarW = (sidebarEl && !IS_MOBILE_HEADER_SIDEBAR) ? Math.round(sidebarEl.getBoundingClientRect().width) : 0;
                const avail = Math.max(0, vw - sidebarW);

                // Blazor 側に通知（必要なら）
                if (window._trimResize && window._trimResize.windowResizeDotNetRef) {
                    try {
                        window._trimResize.windowResizeDotNetRef.invokeMethodAsync('OnWindowResizedFromJs', avail, sidebarW).catch(() => { });
                    } catch (e) { /* ignore */ }
                }

            } catch (e) {
                console.error('measureAndNotify error', e);
            }
        }

        window._trimResize.windowResizeCallback = measureAndNotify;

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
