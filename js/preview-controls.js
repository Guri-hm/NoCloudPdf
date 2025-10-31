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
            } catch (e) {  }

            window._previewPan.handlers = null;
            window._previewPan.state = null;
            viewport.classList.remove('pan-active');
            viewport.style.touchAction = '';
        }

        if (!enabled) {
            window._previewPan.enabled = false;
            viewport.style.cursor = '';
            return;
        }

        window._previewPan.enabled = true;
        viewport.style.touchAction = 'none';
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
                viewport.classList.add('panning');
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
        mode = (mode || '').toString().toLowerCase();
        if (mode === 'pan') {
            window.setPreviewPanEnabled(true);
        } else {
            window.setPreviewPanEnabled(false);
        }

        return true;
    } catch (e) { console.error(e); return false; }
};
window._previewPan = window._previewPan || { enabled: false, handlers: null, state: null };