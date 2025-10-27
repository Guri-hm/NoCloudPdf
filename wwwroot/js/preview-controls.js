window.setPreviewZoom = function (zoom, mode = 'contain') {
    try {
        zoom = Math.max(0.25, Math.min(3, Number(zoom) || 1));
        const viewport = document.querySelector('.preview-zoom-viewport');
        const inner = document.getElementById('preview-zoom-inner');
        if (!inner || !viewport) return;

        // 前回のズーム（なければ1）
        const prev = (window._previewZoomState && window._previewZoomState.lastZoom) ? window._previewZoomState.lastZoom : 1;

        // 1) ビューポートの画面上中心を inner のクライアント座標系に変換（現在のスケール prev のまま）
        const vpRect = viewport.getBoundingClientRect();
        const innerRect = inner.getBoundingClientRect();
        const centerClientX = vpRect.left + vpRect.width / 2;
        const centerClientY = vpRect.top + vpRect.height / 2;

        const centerInnerClientX = centerClientX - innerRect.left;
        const centerInnerClientY = centerClientY - innerRect.top;

        const centerUnscaledX = centerInnerClientX / prev;
        const centerUnscaledY = centerInnerClientY / prev;

        inner.style.setProperty('--preview-zoom', String(zoom));
        inner.style.transform = `scale(${zoom})`;
        inner.style.transformOrigin = '0 0';

        const vpW = vpRect.width;
        const vpH = vpRect.height;

        const contentScaledW = (inner.scrollWidth || innerRect.width) * zoom;
        const contentScaledH = (inner.scrollHeight || innerRect.height) * zoom;

        let newScrollLeft = centerUnscaledX * zoom - vpW / 2;
        let newScrollTop = centerUnscaledY * zoom - vpH / 2;

        newScrollLeft = Math.max(0, Math.min(contentScaledW - vpW, newScrollLeft));
        newScrollTop = Math.max(0, Math.min(contentScaledH - vpH, newScrollTop));

        viewport.scrollLeft = Math.round(newScrollLeft);
        viewport.scrollTop = Math.round(newScrollTop);

        window._previewZoomState = window._previewZoomState || {};
        window._previewZoomState.lastZoom = zoom;
    } catch (e) {
        console.error('setPreviewZoom error', e);
    }
};

window.computeAndApplyFitZoom = function () {
    try {
        const container = document.getElementById('trim-preview-container');
        const inner = document.getElementById('preview-zoom-inner');
        if (!container || !inner) {
            return;
        }

        const containerW = container.clientWidth || 1;

        const prev = (window._previewZoomState && window._previewZoomState.lastZoom) ? window._previewZoomState.lastZoom : 1;

        let contentLogicalW = 0;
        const canvases = inner.querySelectorAll('canvas');
        if (canvases && canvases.length > 0) {
            canvases.forEach((c, i) => {
                try {
                    const rect = c.getBoundingClientRect();
                    const logical = (rect.width || c.clientWidth || 0) / prev;
                    if (logical > contentLogicalW) contentLogicalW = logical;
                } catch (e) { console.warn('computeAndApplyFitZoom: canvas measurement error', e); }
            });
        }

        if (contentLogicalW <= 0) {
            const innerRect = inner.getBoundingClientRect();
            contentLogicalW = (inner.scrollWidth || innerRect.width || inner.clientWidth || 1) / prev;
        }

        if (!contentLogicalW || contentLogicalW <= 0) contentLogicalW = 1;

        const rawFit = containerW / contentLogicalW;
        const fit = Math.max(0.25, Math.min(3.0, rawFit));

        if (typeof window.setPreviewZoom === 'function') {
            window.setPreviewZoom(fit);
        }
    } catch (e) {
        console.error('computeAndApplyFitZoom error', e);
    }
};


window.setPreviewPanEnabled = function (enabled) {
    try {
        const viewport = document.querySelector('.preview-zoom-viewport');
        if (!viewport) return;

        if (window._previewPan.handlers) {
            try {
                const h = window._previewPan.handlers;
                viewport.removeEventListener('pointerdown', h.down);
                viewport.removeEventListener('pointermove', h.move);
                viewport.removeEventListener('pointerup', h.up);
                viewport.removeEventListener('pointercancel', h.up);
            } catch (e) { /* ignore */ }

            window._previewPan.handlers = null;
            window._previewPan.state = null;
            viewport.classList.remove('pan-active');
            viewport.style.touchAction = ''; // restore
        }

        if (!enabled) {
            window._previewPan.enabled = false;

            viewport.style.cursor = '';
            return;
        }

        window._previewPan.enabled = true;
        viewport.style.cursor = 'grab';
        viewport.style.touchAction = 'none'; // allow pointer dragging
        viewport.classList.add('pan-active');

        const state = { active: false, startX: 0, startY: 0, scrollLeft: 0, scrollTop: 0, pointerId: null };
        window._previewPan.state = state;

        const onPointerDown = function (ev) {
            try {

                if (ev.button !== 0) return;
                state.active = true;
                state.pointerId = ev.pointerId;
                state.startX = ev.clientX;
                state.startY = ev.clientY;
                state.scrollLeft = viewport.scrollLeft;
                state.scrollTop = viewport.scrollTop;
                viewport.setPointerCapture && viewport.setPointerCapture(ev.pointerId);
                viewport.classList.add('panning'); // for cursor change
            } catch (e) { console.error('pan down error', e); }
        };

        const onPointerMove = function (ev) {
            try {
                if (!state.active || state.pointerId !== ev.pointerId) return;
                const dx = ev.clientX - state.startX;
                const dy = ev.clientY - state.startY;

                viewport.scrollLeft = state.scrollLeft - dx;
                viewport.scrollTop = state.scrollTop - dy;
            } catch (e) { /* ignore */ }
        };

        const onPointerUp = function (ev) {
            try {
                if (state.active && state.pointerId === ev.pointerId) {
                    state.active = false;
                    try { viewport.releasePointerCapture && viewport.releasePointerCapture(ev.pointerId); } catch { }
                    viewport.classList.remove('panning');
                }
            } catch (e) { /* ignore */ }
        };

        viewport.addEventListener('pointerdown', onPointerDown);
        viewport.addEventListener('pointermove', onPointerMove);
        viewport.addEventListener('pointerup', onPointerUp);
        viewport.addEventListener('pointercancel', onPointerUp);

        window._previewPan.handlers = { down: onPointerDown, move: onPointerMove, up: onPointerUp };
    } catch (e) {
        console.error('setPreviewPanEnabled error', e);
    }
};

window.setPreviewInteractionMode = function (mode) {
    try {
        // mode: 'pan' | 'trim' | 'none'
        mode = (mode || '').toString().toLowerCase();

        if (mode === 'pan') {
            // トリム抑止してパン有効
            if (typeof window.toggleTrimListenersSuppressed === 'function') {
                window.toggleTrimListenersSuppressed(true);
            }
            if (typeof window.setPreviewPanEnabled === 'function') {
                window.setPreviewPanEnabled(true);
            }
        } else if (mode === 'trim') {
            // パン無効にしてトリム復帰
            if (typeof window.setPreviewPanEnabled === 'function') {
                window.setPreviewPanEnabled(false);
            }
            if (typeof window.toggleTrimListenersSuppressed === 'function') {
                window.toggleTrimListenersSuppressed(false);
            }
        } else {
            // none: 両方無効（安全）
            if (typeof window.setPreviewPanEnabled === 'function') {
                window.setPreviewPanEnabled(false);
            }
            if (typeof window.toggleTrimListenersSuppressed === 'function') {
                window.toggleTrimListenersSuppressed(false);
            }
        }

        window._previewInteractionMode = mode;
        return true;
    } catch (e) {
        console.error('setPreviewInteractionMode error', e);
        return false;
    }
};

// 全 trim listeners の抑止/復帰切替（テスト用）
window.toggleTrimListenersSuppressed = function (suppress) {
    try {
        if (typeof window._simpleTrim !== 'object') {
            window._simpleTrim = window._simpleTrim || {};
        }
        // 引数省略時はトグル
        if (typeof suppress === 'undefined') suppress = !Boolean(window._simpleTrimSuppressed);
        window._simpleTrimSuppressed = Boolean(suppress);

        Object.keys(window._simpleTrim).forEach(k => {
            try {
                const ts = window._simpleTrim[k];
                if (!ts) return;
                ts.suppressed = window._simpleTrimSuppressed;

                // overlay と canvas の pointer-events を切り替える（イベント到達を防ぐ）
                if (ts.overlayDom && ts.overlayDom.style) {
                    ts.overlayDom.style.pointerEvents = window._simpleTrimSuppressed ? 'none' : 'auto';
                    ts.overlayDom.style.cursor = window._simpleTrimSuppressed ? '' : (ts.resizeHandle ? (HANDLE_CURSOR_MAP?.[ts.resizeHandle] || '') : (ts.mode === 'move' ? 'move' : (ts.mode === 'draw' ? 'crosshair' : '')) );
                }
                if (ts.base && ts.base.style) {
                    // canvas 本体も抑止（overlay が無い場合を考慮）
                    ts.base.style.pointerEvents = window._simpleTrimSuppressed ? 'none' : 'auto';
                    ts.base.style.cursor = window._simpleTrimSuppressed ? '' : (ts.mode === 'draw' ? 'crosshair' : '');
                }
            } catch (e) { /* ignore per-entry errors */ }
        });
        return true;
    } catch (e) {
        console.error('toggleTrimListenersSuppressed error', e);
        return false;
    }
};
window._previewPan = window._previewPan || { enabled: false, handlers: null, state: null };