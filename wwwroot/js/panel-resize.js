// ========================================
// 共通定数・ヘルパー関数
// ========================================

const MIN_LEFT = 150;
const MIN_RIGHT = 260;
const MAX_LEFT = 600;

function measureAvailable() {
    const vw = window.innerWidth || document.documentElement.clientWidth;
    const TW_BREAKPOINTS_MD = 768;
    const isMobileHeaderSidebar = vw < TW_BREAKPOINTS_MD;
    const sidebarEl = document.querySelector('.sidebar');
    const sidebarW = (sidebarEl && !isMobileHeaderSidebar) ? Math.round(sidebarEl.getBoundingClientRect().width) : 0;
    const avail = Math.max(0, vw - sidebarW);
    return { vw, sidebarW, avail };
}

function clampLeftWidth(requestedLeft, avail) {
    const maxAllowed = Math.max(MIN_LEFT, Math.round(avail - MIN_RIGHT));
    const finalMax = Math.min(maxAllowed, MAX_LEFT);
    return Math.max(MIN_LEFT, Math.min(finalMax, Math.round(requestedLeft)));
}

function applyLeftPanelWidth(leftPx, avail) {
    try {
        const thumbArea = document.getElementById('thumbnail-area');
        const rightArea = thumbArea?.parentElement?.querySelector('.overflow-auto');
        
        if (!thumbArea) return;

        // 左エリア：固定幅
        thumbArea.style.width = leftPx + 'px';
        thumbArea.style.flex = 'none';

        // 右エリア：固定幅（全体 - 左幅 - 仕切り幅）
        if (rightArea) {
            const rightWidth = Math.max(MIN_RIGHT, avail - leftPx - 4);
            rightArea.style.width = rightWidth + 'px';
            rightArea.style.flex = 'none';
        }

        if (window._trimResize) {
            window._trimResize.lastAppliedLeft = leftPx;
            window._trimResize.lastAvail = avail;
        }

        // パネル幅変更後に自動フィット再調整
        requestAnimationFrame(() => {
            try {
                if (typeof window.adjustAutoFitIfNeeded === 'function') {
                    window.adjustAutoFitIfNeeded();
                }
            } catch (e) { /* ignore */ }
        });
    } catch (e) {
        console.error('applyLeftPanelWidth error', e);
    }
}

// ========================================
// パネルドラッグリサイズ
// ========================================

window.registerPanelResize = function (dotNetRef, handleId) {
    try {
        if (window._trimResize && window._trimResize.cleanupForHandle) {
            try { window._trimResize.cleanupForHandle(); } catch (e) { }
            window._trimResize.cleanupForHandle = null;
        }

        window._trimResize.dotNetRef = dotNetRef;

        const handle = document.getElementById(handleId);
        if (!handle) {
            console.warn('registerPanelResize: handle element not found:', handleId);
            return;
        }

        function computeOriginLeft(measured) {
            return measured.sidebarW || 0;
        }

        let pending = false;
        let latestClientX = 0;

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
                                const measured = measureAvailable();
                                const originLeft = computeOriginLeft(measured);
                                const computedLeft = Math.round(latestClientX - originLeft);
                                const clampedLeft = clampLeftWidth(computedLeft, measured.avail);
                                
                                applyLeftPanelWidth(clampedLeft, measured.avail);
                            } catch (err) {
                                console.error('onPointerMove error', err);
                            }
                        });
                    }
                };

                const onPointerUp = function (ev) {
                    try {
                        handle.releasePointerCapture?.(ev.pointerId);

                        const measured = measureAvailable();
                        const originLeft = computeOriginLeft(measured);
                        const computedFinalLeft = Math.round(ev.clientX - originLeft);
                        const finalLeftWidth = clampLeftWidth(computedFinalLeft, measured.avail);

                        if (window._trimResize && window._trimResize.dotNetRef && window._trimResize.dotNetRef.invokeMethodAsync) {
                            try { window._trimResize.dotNetRef.invokeMethodAsync('CommitPanelWidth', finalLeftWidth).catch(() => { }); } catch (e) { /* ignore */ }
                        }

                        applyLeftPanelWidth(finalLeftWidth, measured.avail);

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

// ========================================
// ウィンドウリサイズ対応
// ========================================

window.registerWindowResize = function (dotNetRef, debounceMs = 350, invokeImmediately = false) {
    try {
        if (!dotNetRef) return false;
        if (!window._trimResize) window._trimResize = {};
        window._trimResize.windowResizeDotNetRef = dotNetRef;

        window._trimShared = window._trimShared || {};
        window._trimShared.debounceMs = Math.max(150, Number(debounceMs) || window._trimShared.debounceMs || 350);

        function measureAndNotify() {
            try {
                const measured = measureAvailable();
                
                const computed = Math.round(measured.avail * 0.25);
                const newLeft = clampLeftWidth(computed, measured.avail);
                
                applyLeftPanelWidth(newLeft, measured.avail);

                // ウィンドウリサイズ時に自動フィット再調整
                requestAnimationFrame(() => {
                    try {
                        if (typeof window.adjustAutoFitIfNeeded === 'function') {
                            window.adjustAutoFitIfNeeded();
                        }
                    } catch (e) { /* ignore */ }
                });

                const ref = window._trimResize && window._trimResize.windowResizeDotNetRef;
                if (ref && typeof ref.invokeMethodAsync === 'function') {
                    try {
                        ref.invokeMethodAsync('OnWindowResizedFromJs', measured.avail, measured.sidebarW).catch(() => {});
                    } catch (e) { /* swallow */ }
                }
            } catch (e) {
                console.error('measureAndNotify error', e);
            }
        }

        window._trimResize.windowResizeCallback = measureAndNotify;

        if (typeof ensureSharedTrimResizeHandler === 'function') ensureSharedTrimResizeHandler();

        if (invokeImmediately === true) {
            try { measureAndNotify(); } catch (e) { /* ignore */ }
        }

        return true;
    } catch (e) {
        console.error('registerWindowResize error', e);
        return false;
    }
};

window.unregisterWindowResize = function () {
    try {
        if (!window._trimResize) return false;
        window._trimResize.windowResizeCallback = null;
        window._trimResize.windowResizeDotNetRef = null;
        return true;
    } catch (e) {
        console.error('unregisterWindowResize error', e);
        return false;
    }
};

// ========================================
// グローバル状態の初期化
// ========================================

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

// ========================================
// 共有リサイズハンドラ（debounce 付き）
// ========================================

function ensureSharedTrimResizeHandler() {
    try {
        if (!window._trimShared) window._trimShared = {};
        if (window._trimShared._handlerRegistered) return;

        window._trimShared.debounceMs = Math.max(150, Number(window._trimShared.debounceMs) || 350);

        let timer = null;
        const onResize = function () {
            try {
                if (timer) clearTimeout(timer);
                timer = setTimeout(() => {
                    try {
                        const simpleTrim = window._simpleTrim || {};
                        Object.keys(simpleTrim).forEach(id => {
                            try {
                                const entry = simpleTrim[id];
                                if (entry && entry.internal && typeof entry.internal.onAnyScrollOrResize === 'function') {
                                    entry.internal.onAnyScrollOrResize();
                                }
                            } catch (e) { /* ignore per-entry */ }
                        });

                        if (window._trimResize && typeof window._trimResize.windowResizeCallback === 'function') {
                            try {
                                window._trimResize.windowResizeCallback();
                            } catch (e) { console.error('windowResizeCallback error', e); }
                        }
                    } catch (e) { console.error('shared resize handler inner error', e); }
                    finally { timer = null; }
                }, window._trimShared.debounceMs);
                window._trimShared.timer = timer;
            } catch (e) { console.error('shared resize handler schedule error', e); }
        };

        window.addEventListener('resize', onResize, { passive: true });
        if (window.visualViewport && window.visualViewport.addEventListener) {
            window.visualViewport.addEventListener('resize', onResize, { passive: true });
            window.visualViewport.addEventListener('scroll', onResize, { passive: true });
        }

        window._trimShared._handlerRegistered = true;
        window._trimShared._onResizeHandler = onResize;
    } catch (e) {
        console.error('ensureSharedTrimResizeHandler error', e);
    }
}

// ========================================
// ユーティリティ関数（後方互換性）
// ========================================

window.getAvailableWidth = function () {
    try {
        const measured = measureAvailable();
        return { avail: measured.avail, sidebarW: measured.sidebarW, vw: measured.vw };
    } catch (e) {
        const vw = window.innerWidth || document.documentElement.clientWidth;
        return { avail: vw, sidebarW: 0, vw };
    }
};

window.applyThumbnailWidth = function (leftPx) {
    try {
        const measured = measureAvailable();
        applyLeftPanelWidth(leftPx, measured.avail);
        return true;
    } catch (e) {
        console.error('applyThumbnailWidth error', e);
        return false;
    }
};

window._trimShared = window._trimShared || { resizeHandler: null, timer: null, debounceMs: 350 };

