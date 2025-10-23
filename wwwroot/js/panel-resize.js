
window.registerPanelResize = function (dotNetRef, handleId, panelDebounceMs = 1500) {

    function setPanelResizeOverlayVisible(visible) {
        try {
            const el = document.getElementById('loading-indicator');
            if (!el) return;

            // 既存のフェード処理があればキャンセル
            try { if (el.__fadeTimeout) { clearTimeout(el.__fadeTimeout); el.__fadeTimeout = null; } } catch (e) { }

            const DURATION_MS = 220; // フェード時間（必要なら調整）
            // ensure transition is present (do not override if user provided custom transition)
            if (!el.style.transition || el.style.transition.indexOf('opacity') === -1) {
                el.style.transition = `opacity ${DURATION_MS}ms ease`;
            }

            if (visible) {
                // show then fade in
                el.style.display = 'flex';
                // ensure starting opacity 0 for the animation
                el.style.opacity = el.style.opacity ? el.style.opacity : '0';
                // next frame -> set to 1 to trigger transition
                requestAnimationFrame(() => {
                    try { el.style.opacity = '1'; } catch (e) { /* ignore */ }
                });
            } else {
                // fade out then hide
                // ensure it's visible (in case it was hidden but opacity left at 1)
                if (getComputedStyle(el).display === 'none') {
                    // nothing to do
                    return;
                }
                // start fade-out
                requestAnimationFrame(() => {
                    try { el.style.opacity = '0'; } catch (e) { /* ignore */ }
                });
                // after transition elapsed, set display none
                el.__fadeTimeout = setTimeout(() => {
                    try {
                        el.style.display = 'none';
                        // keep opacity at 0 for next show
                        el.style.opacity = '0';
                    } catch (e) { /* ignore */ }
                    el.__fadeTimeout = null;
                }, DURATION_MS + 20);
            }
        } catch (e) { /* ignore */ }
    }

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

        function applyWidthsUsingAvail(requestedLeft) {
            try {
                const measured = measureAvail();
                const avail = measured.avail;
                const splitterW = handle.getBoundingClientRect().width || 8;

                const availableForLeft = Math.max(minLeft, Math.round(avail - minRight - splitterW));
                let left = Math.max(minLeft, Math.min(availableForLeft, Math.round(requestedLeft)));
                left = Math.min(left, availableForLeft);

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
                try { setPanelResizeOverlayVisible(true); } catch (ex) { /* ignore */ }
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
                        const splitterW = handle.getBoundingClientRect().width || 8;

                        const availForCalc = measured.avail;
                        const maxLeft = Math.max(minLeft, Math.round(availForCalc - minRight - splitterW));
                        const computedFinalLeft = Math.round(ev.clientX - originLeft);
                        const finalLeftWidth = Math.max(minLeft, Math.min(maxLeft, computedFinalLeft));

                        if (window._trimResize && window._trimResize.dotNetRef && window._trimResize.dotNetRef.invokeMethodAsync) {
                            try { window._trimResize.dotNetRef.invokeMethodAsync('CommitPanelWidth', finalLeftWidth).catch(() => { }); } catch (e) { /* ignore */ }
                        }

                        applyWidthsUsingAvail(finalLeftWidth);

                        requestAnimationFrame(function () {
                            if (window._trimResize && window._trimResize.updateAllTrimOverlays) window._trimResize.updateAllTrimOverlays();
                        });
                    } catch (err) {
                        console.error('onPointerUp error', err);
                    } finally {
                        try { window._trimResize.suspendFitZoom = false; } catch (ex) { /* ignore */ }
                        try { setPanelResizeOverlayVisible(false); } catch (e) { /* ignore */ }
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

window.trimPreviewArea = {
    dotNetRef: null,
    handlers: null,

    initialize: function (dotNetRef) {
        try {

            this.unregister && this.unregister();

            this.dotNetRef = dotNetRef;

            const onMouseMove = (e) => {
                try {
                    if (this.dotNetRef) this.dotNetRef.invokeMethodAsync('OnPanelMouseMove', e.clientX).catch(() => { });
                } catch (ex) { /* ignore */ }
            };
            const onMouseUp = (e) => {
                try {
                    if (this.dotNetRef) this.dotNetRef.invokeMethodAsync('OnPanelMouseUp').catch(() => { });
                } catch (ex) { /* ignore */ }
            };

            this.handlers = { onMouseMove, onMouseUp };

            document.addEventListener('mousemove', onMouseMove, { passive: true });
            document.addEventListener('mouseup', onMouseUp, { passive: true });

        } catch (e) {
            console.error('trimPreviewArea.initialize error', e);
        }
    },

    unregister: function () {
        try {
            if (this.handlers) {
                document.removeEventListener('mousemove', this.handlers.onMouseMove);
                document.removeEventListener('mouseup', this.handlers.onMouseUp);
                this.handlers = null;
            }
            this.dotNetRef = null;
        } catch (e) { console.error('trimPreviewArea.unregister error', e); }
    },
    getImageDimensions: function (imgId) {
        const img = document.getElementById(imgId);
        if (img) {
            return [img.offsetWidth, img.offsetHeight];
        }
        return [0, 0];
    },

    scrollToPage: function (pageIndex) {
        const container = document.getElementById(`preview-container-${pageIndex}`);
        if (container) {
            container.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    }
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
                const IS_MOBILE_HEADER_SIDEBAR = vw < 768;
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
                        try { window._trimResize.windowResizeDotNetRef.invokeMethodAsync('OnWindowResizedFromJs', avail, sidebarW).catch(() => { }); } catch (e) { /* ignore */ }
                    }

                    try { splitEl && splitEl.offsetHeight; } catch (e) { /* ignore */ }

                    if (window._trimResize?.updateAllTrimOverlays) {
                        try { window._trimResize.updateAllTrimOverlays(); } catch (e) { console.error(e); }
                    }

                    try { if (typeof window.computeAndApplyFitZoom === 'function') window.computeAndApplyFitZoom(); } catch (e) { /* ignore */ }
                } catch (e) {
                    console.error('measureAndNotify inner error', e);
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
