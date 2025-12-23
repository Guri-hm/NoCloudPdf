window.setPreviewPanEnabled = function (enabled) {
    try {
        const viewport = document.getElementById('preview-zoom-viewport');
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

        const viewport = document.getElementById('preview-zoom-viewport');
        const canvas = viewport?.querySelector('canvas');
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

// 画面 DPI を取得（CSS px / inch）
function getScreenDpi() {
    try {
        const d = document.createElement('div');
        d.style.width = '1in';
        d.style.position = 'absolute';
        d.style.left = '-100%';
        document.body.appendChild(d);
        const dpi = d.offsetWidth || 96;
        document.body.removeChild(d);
        return dpi;
    } catch (e) { return 96; }
}

window.fitPreviewToViewport = function(canvasId, mode = 'fit-width') {
    try {
        const canvas = document.getElementById(canvasId);
        if (!canvas) {
            console.warn('fitPreviewToViewport: canvas not found', canvasId);
            return 1.0;
        }
        
        const viewport = document.getElementById('preview-zoom-viewport');
        if (!viewport) {
            console.warn('fitPreviewToViewport: viewport not found');
            return 1.0;
        }
        
        const viewportW = viewport.clientWidth;
        const viewportH = viewport.clientHeight;
    
        // Canvas の自然なサイズ（実際のピクセルサイズ）
        const canvasW = canvas.width || 1;
        const canvasH = canvas.height || 1;
        
        if (canvasW === 0 || canvasH === 0) {
            console.warn('fitPreviewToViewport: canvas size is 0');
            return 1.0;
        }
        
        let scale = 1.0;
        const MAX_RATIO = 1.0;
        
        if (mode === 'fit-width') {
            scale = (viewportW * MAX_RATIO) / canvasW;
        } else if (mode === 'fit-height') {
            scale = (viewportH * MAX_RATIO) / canvasH;
        } else if (mode === 'fit-both') {
            const scaleW = viewportW / canvasW;
            const scaleH = viewportH / canvasH;
            scale = Math.min(scaleW, scaleH) * MAX_RATIO;
        } else if (mode === 'actual-size') {
            console.group('🔍 actual-size 計算詳細');
            
            // 実寸表示の計算
            const pdfVpW = parseFloat(canvas.dataset.originalWidth) || NaN;
            const pdfVpH = parseFloat(canvas.dataset.originalHeight) || NaN;
            
            console.log('📄 PDF 情報:');
            console.log('  - dataset.originalWidth (pt):', pdfVpW);
            console.log('  - dataset.originalHeight (pt):', pdfVpH);
            console.log('  - Adobe 表示 (参考): 272.7×385.9 mm');

            if (!isNaN(pdfVpW) && pdfVpW > 0) {
                // 画面 DPI を計測（ブラウザズーム・OS スケールを反映）
                const dpi = getScreenDpi();
                
                console.log('\n🖥️ 画面情報:');
                console.log('  - 計測した DPI:', dpi);
                console.log('  - devicePixelRatio:', window.devicePixelRatio);
                console.log('  - ブラウザズーム:', Math.round(window.devicePixelRatio * 100) + '%（推定）');
                
                // PDF の論理幅（pt）を CSS px に変換
                // 1pt = 1/72 inch なので、CSS px = pt * (dpi / 72)
                const desiredCssW = pdfVpW * (dpi / 72);
                const desiredCssH = pdfVpH * (dpi / 72);
                
                console.log('\n📐 目標サイズ（CSS px）:');
                console.log('  - 幅:', desiredCssW.toFixed(2), 'px');
                console.log('  - 高さ:', desiredCssH.toFixed(2), 'px');
                
                // pt → mm 変換（参考：1pt = 0.3527777778 mm）
                const expectedMmW = pdfVpW * 0.3527777778;
                const expectedMmH = pdfVpH * 0.3527777778;
                console.log('  - 換算（mm）:', expectedMmW.toFixed(1), '×', expectedMmH.toFixed(1), 'mm');
                
                // 現在のレンダリング画像の CSS px 幅
                const renderedCssW = parseFloat(canvas.dataset.renderedCssWidth) || 
                                    parseFloat(canvas.style.width) || 
                                    (canvas.width / (window.devicePixelRatio || 1));
                const renderedCssH = parseFloat(canvas.dataset.renderedCssHeight) || 
                                    parseFloat(canvas.style.height) || 
                                    (canvas.height / (window.devicePixelRatio || 1));
                
                console.log('\n🖼️ レンダリング画像:');
                console.log('  - canvas.width × canvas.height:', canvasW, '×', canvasH, 'px（バックバッファ）');
                console.log('  - dataset.renderedCssWidth:', canvas.dataset.renderedCssWidth);
                console.log('  - canvas.style.width:', canvas.style.width);
                console.log('  - 使用する renderedCssW:', renderedCssW.toFixed(2), 'px');
                console.log('  - 使用する renderedCssH:', renderedCssH.toFixed(2), 'px');
                
                if (renderedCssW > 0) {
                    scale = desiredCssW / renderedCssW;
                    
                    console.log('\n✅ 計算結果:');
                    console.log('  - scale:', scale.toFixed(4));
                    console.log('  - 適用後の表示サイズ:', (renderedCssW * scale).toFixed(2), '×', (renderedCssH * scale).toFixed(2), 'px');
                    
                    // 実際の画面上のサイズ（mm）を推定
                    // 96dpi の場合、1px = 25.4mm / 96 ≈ 0.2645833 mm
                    const pxToMm = 25.4 / dpi;
                    const actualMmW = (renderedCssW * scale) * pxToMm;
                    const actualMmH = (renderedCssH * scale) * pxToMm;
                    console.log('  - 画面上の推定サイズ:', actualMmW.toFixed(1), '×', actualMmH.toFixed(1), 'mm');
                    console.log('  - Adobe との差:', (actualMmW - 272.7).toFixed(1), 'mm（幅）');
                } else {
                    // フォールバック
                    scale = pdfVpW / canvasW;
                    console.warn('⚠️ renderedCssW が取得できないためフォールバック');
                }
            } else {
                // dataset がない場合のフォールバック
                console.warn('⚠️ actual-size: originalWidth not found, fallback to 1.0');
                scale = 1.0;
            }
            
            console.groupEnd();
        }
        
        // setPreviewZoom を呼び出してズーム適用
        if (typeof window.setPreviewZoom === 'function') {
            window.setPreviewZoom(scale);
        }
        
        return scale;
    } catch (e) {
        console.error('fitPreviewToViewport error', e);
        return 1.0;
    }
};

/**
 * SVG オーバーレイを再描画（現在の Canvas サイズ基準）
 */
window.redrawTrimOverlays = function() {
    try {
        if (!window._simpleTrim) return false;

        let redrawn = false;
        for (const canvasId in window._simpleTrim) {
            const trimState = window._simpleTrim[canvasId];
            if (!trimState || !trimState.currentRectsPx || trimState.currentRectsPx.length === 0) {
                continue;
            }

            const canvas = document.getElementById(canvasId);
            if (!canvas) continue;

            // Canvas の現在の CSS サイズを取得
            const computedStyle = getComputedStyle(canvas);
            const paddingLeft = parseFloat(computedStyle.paddingLeft) || 0;
            const paddingRight = parseFloat(computedStyle.paddingRight) || 0;
            const paddingTop = parseFloat(computedStyle.paddingTop) || 0;
            const paddingBottom = parseFloat(computedStyle.paddingBottom) || 0;

            const cssW = Math.max(1, Math.round(parseFloat(canvas.style.width) || canvas.clientWidth || 1));
            const cssH = Math.max(1, Math.round(parseFloat(canvas.style.height) || canvas.clientHeight || 1));

            const innerW = cssW - paddingLeft - paddingRight;
            const innerH = cssH - paddingTop - paddingBottom;

            // 現在の矩形（px）を正規化座標に変換
            const rectsToRender = trimState.currentRectsPx.map(r => ({
                X: r.x / innerW,
                Y: r.y / innerH,
                Width: r.w / innerW,
                Height: r.h / innerH
            }));

            // SVG を再描画
            if (window.drawTrimOverlayAsSvg) {
                window.drawTrimOverlayAsSvg(canvasId, rectsToRender);
                redrawn = true;
            }
        }

        return redrawn;
    } catch (e) {
        console.error('redrawTrimOverlays error', e);
        return false;
    }
};

window.setPreviewZoom = function (zoom, mode = 'contain') {
    try {
        zoom = Math.max(0.25, Math.min(3, Number(zoom) || 1));
        const viewport = document.getElementById('preview-zoom-viewport');
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
        const innerContainer = canvas.parentElement;
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

        const computedStyle = getComputedStyle(canvas);
        const paddingLeft = parseFloat(computedStyle.paddingLeft) || 0;
        const paddingRight = parseFloat(computedStyle.paddingRight) || 0;
        const paddingTop = parseFloat(computedStyle.paddingTop) || 0;
        const paddingBottom = parseFloat(computedStyle.paddingBottom) || 0;

        // 現在の Canvas のサイズ（CSS）
        const oldW = parseFloat(canvas.style.width) || naturalW;
        const oldH = parseFloat(canvas.style.height) || naturalH;

        // padding を引いた内側のサイズ（矩形座標の基準）
        const oldInnerW = oldW - paddingLeft - paddingRight;
        const oldInnerH = oldH - paddingTop - paddingBottom;

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
                    X: r.x / oldInnerW,
                    Y: r.y / oldInnerH,
                    Width: r.w / oldInnerW,
                    Height: r.h / oldInnerH
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

// ...existing code...