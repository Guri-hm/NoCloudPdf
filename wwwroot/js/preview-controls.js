window.setPreviewZoom = function (zoom, mode = 'contain') {
    try {
        zoom = Math.max(0.25, Math.min(3, Number(zoom) || 1));
        const viewport = document.querySelector('.preview-zoom-viewport');
        const canvas = viewport?.querySelector('canvas');
        
        if (!viewport || !canvas) {
            console.warn('setPreviewZoom: required elements not found');
            return;
        }

        // Canvas の自然なサイズ
        const naturalW = canvas.naturalWidth || canvas.width || 1;
        const naturalH = canvas.naturalHeight || canvas.height || 1;

        // 新しい表示サイズを計算
        const newW = Math.round(naturalW * zoom);
        const newH = Math.round(naturalH * zoom);

        // Viewport のサイズ
        const vpW = viewport.clientWidth;
        const vpH = viewport.clientHeight;

        // Canvas が Viewport より大きい場合は justify-content を削除（左上基点に）
        const innerContainer = canvas.closest('.preview-zoom-inner') || canvas.parentElement;
        if (innerContainer) {
            if (newW > vpW) {
                innerContainer.classList.remove('justify-center');
                innerContainer.classList.add('justify-start');
            } else {
                innerContainer.classList.remove('justify-start');
                innerContainer.classList.add('justify-center');
            }
        }

        // 現在のスクロール位置
        const scrollLeft = viewport.scrollLeft;
        const scrollTop = viewport.scrollTop;

        // 現在の Canvas のサイズ（CSS）
        const oldW = parseFloat(canvas.style.width) || naturalW;
        const oldH = parseFloat(canvas.style.height) || naturalH;

        // viewport 内での中心座標（スクロール位置 + viewport サイズの半分）
        const centerX = scrollLeft + vpW / 2;
        const centerY = scrollTop + vpH / 2;

        // 正規化座標（0..1）で中心点の位置を保持
        const normX = centerX / oldW;
        const normY = centerY / oldH;

        // Canvas サイズを更新
        canvas.style.width = newW + 'px';
        canvas.style.height = newH + 'px';

        // 新しいスクロール位置を計算（中心点を維持）
        let newScrollLeft = normX * newW - vpW / 2;
        let newScrollTop = normY * newH - vpH / 2;

        // スクロール範囲をクランプ
        const maxScrollLeft = Math.max(0, newW - vpW);
        const maxScrollTop = Math.max(0, newH - vpH);

        newScrollLeft = Math.max(0, Math.min(maxScrollLeft, newScrollLeft));
        newScrollTop = Math.max(0, Math.min(maxScrollTop, newScrollTop));

        // スクロール位置を適用
        viewport.scrollLeft = Math.round(newScrollLeft);
        viewport.scrollTop = Math.round(newScrollTop);

        // 状態を保存
        window._previewZoomState = window._previewZoomState || {};
        window._previewZoomState.lastZoom = zoom;

        // SVG オーバーレイを再描画
        const canvasId = canvas.id;
        if (canvasId && window._simpleTrim && window._simpleTrim[canvasId]) {
            const trimState = window._simpleTrim[canvasId];
            if (trimState.currentRectsPx && trimState.currentRectsPx.length > 0) {
                const rectsToRender = trimState.currentRectsPx.map(r => ({
                    X: r.x / oldW,
                    Y: r.y / oldH,
                    Width: r.w / oldW,
                    Height: r.h / oldH
                }));
                
                requestAnimationFrame(() => {
                    if (window.drawTrimOverlayAsSvg) {
                        window.drawTrimOverlayAsSvg(canvasId, rectsToRender);
                    }
                });
            }
        }

        return zoom;
    } catch (e) {
        console.error('setPreviewZoom error', e);
        return 1.0;
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
            } catch (e) { }

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

// ========================================
// 自動フィットモード管理
// ========================================
window._previewZoomState = window._previewZoomState || {
    lastZoom: 1.0,
    autoFitWidth: false,
    autoFitHeight: false
};

/**
 * 自動フィットモードを設定（width / height / both）
 */
window.setAutoFitMode = function (mode) {
    try {
        const state = window._previewZoomState;
        mode = (mode || '').toString().toLowerCase();

        if (mode === 'width') {
            state.autoFitWidth = true;
            state.autoFitHeight = false;
        } else if (mode === 'height') {
            state.autoFitWidth = false;
            state.autoFitHeight = true;
        } else if (mode === 'both') {
            state.autoFitWidth = true;
            state.autoFitHeight = true;
        } else {
            state.autoFitWidth = false;
            state.autoFitHeight = false;
        }
        return true;
    } catch (e) {
        console.error('setAutoFitMode error', e);
        return false;
    }
};

/**
 * 自動フィットモードをクリア
 */
window.clearAutoFitMode = function () {
    try {
        window._previewZoomState.autoFitWidth = false;
        window._previewZoomState.autoFitHeight = false;
        return true;
    } catch (e) {
        console.error('clearAutoFitMode error', e);
        return false;
    }
};

/**
 * 自動フィットが有効な場合、現在のキャンバスを再調整
 */
window.adjustAutoFitIfNeeded = function () {
    try {
        const state = window._previewZoomState;
        if (!state.autoFitWidth && !state.autoFitHeight) return false;

        const canvas = document.querySelector('.preview-zoom-viewport canvas');
        if (!canvas) return false;

        const canvasId = canvas.id;
        if (!canvasId) return false;

        // モード決定
        let mode = 'fit-width';
        if (state.autoFitWidth && state.autoFitHeight) {
            mode = 'fit-both';
        } else if (state.autoFitHeight) {
            mode = 'fit-height';
        }

        // fitPreviewToViewport を呼び出し
        if (typeof window.fitPreviewToViewport === 'function') {
            try {
                window.fitPreviewToViewport(canvasId, mode);
            } catch (e) {
                console.error('adjustAutoFitIfNeeded fitPreviewToViewport error', e);
            }
            return true;
        }
        return false;
    } catch (e) {
        console.error('adjustAutoFitIfNeeded error', e);
        return false;
    }
};

/**
 * 現在の Canvas 表示倍率を取得（CSS サイズ ÷ 自然なサイズ）
 */
window.getCurrentPreviewZoom = function(canvasId) {
    try {
        const canvas = document.getElementById(canvasId);
        if (!canvas) return 1.0;

        const naturalW = canvas.width || 1;
        const cssW = parseFloat(canvas.style.width) || naturalW;

        return cssW / naturalW;
    } catch (e) {
        console.error('getCurrentPreviewZoom error', e);
        return 1.0;
    }
};