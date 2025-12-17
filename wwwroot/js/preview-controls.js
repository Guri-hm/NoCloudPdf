window.setPreviewZoom = function (zoom, mode = 'contain') {
    try {
        zoom = Math.max(0.25, Math.min(3, Number(zoom) || 1));
        const viewport = document.querySelector('.preview-zoom-viewport');
        const inner = document.getElementById('preview-zoom-inner');
        if (!inner || !viewport) {
            console.warn('setPreviewZoom: viewport or inner not found');
            return;
        }

        const prev = (window._previewZoomState && window._previewZoomState.lastZoom) ? window._previewZoomState.lastZoom : 1;

        const vpRect = viewport.getBoundingClientRect();
        const innerRect = inner.getBoundingClientRect();
        
        // ★ 修正：現在のスクロール位置を保持（中心座標）
        const centerX = viewport.scrollLeft + vpRect.width / 2;
        const centerY = viewport.scrollTop + vpRect.height / 2;
        
        // 中心座標をスケール前の座標に変換
        const unscaledCenterX = centerX / prev;
        const unscaledCenterY = centerY / prev;

        inner.style.setProperty('--preview-zoom', String(zoom));
        inner.style.transform = `scale(${zoom})`;
        inner.style.transformOrigin = 'top left'; // ★ 修正：左上を基準に

        const vpW = vpRect.width;
        const vpH = vpRect.height;

        // ★ 修正：スケール後のコンテンツサイズを計算
        const originalW = inner.scrollWidth / prev;
        const originalH = inner.scrollHeight / prev;
        const scaledW = originalW * zoom;
        const scaledH = originalH * zoom;

        // ★ 修正：中心座標を維持するスクロール位置を計算
        let newScrollLeft = unscaledCenterX * zoom - vpW / 2;
        let newScrollTop = unscaledCenterY * zoom - vpH / 2;

        newScrollLeft = Math.max(0, Math.min(scaledW - vpW, newScrollLeft));
        newScrollTop = Math.max(0, Math.min(scaledH - vpH, newScrollTop));

        viewport.scrollLeft = Math.round(newScrollLeft);
        viewport.scrollTop = Math.round(newScrollTop);

        window._previewZoomState = window._previewZoomState || {};
        window._previewZoomState.lastZoom = zoom;
    } catch (e) {
        console.error('setPreviewZoom error', e);
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