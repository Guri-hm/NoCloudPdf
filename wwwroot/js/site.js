// wwwroot/js/site.js

window.trimPreviewArea = {
    dotNetRef: null,
    
    initialize: function(dotNetRef) {
        this.dotNetRef = dotNetRef;
        
        document.addEventListener('mousemove', (e) => {
            if (this.dotNetRef) {
                this.dotNetRef.invokeMethodAsync('OnPanelMouseMove', e.clientX);
            }
        });
        
        document.addEventListener('mouseup', () => {
            if (this.dotNetRef) {
                this.dotNetRef.invokeMethodAsync('OnPanelMouseUp');
            }
        });
        
        // プレビュー画像のマウスイベント
        document.querySelectorAll('[id^="preview-img-"]').forEach(img => {
            const container = img.parentElement;
            const pageIndex = parseInt(img.id.split('-')[2]);
            
            container.addEventListener('mousedown', (e) => {
                const rect = img.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const y = e.clientY - rect.top;
                this.dotNetRef.invokeMethodAsync('OnMouseDown', pageIndex, x, y);
            });
        });
        
        document.addEventListener('mousemove', (e) => {
            const activeImg = document.querySelector('[id^="preview-img-"]:hover');
            if (activeImg) {
                const rect = activeImg.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const y = e.clientY - rect.top;
                this.dotNetRef.invokeMethodAsync('OnMouseMove', x, y);
            }
        });
        
        document.addEventListener('mouseup', () => {
            this.dotNetRef.invokeMethodAsync('OnMouseUp');
        });
    },
    
    getImageDimensions: function(imgId) {
        const img = document.getElementById(imgId);
        if (img) {
            return [img.offsetWidth, img.offsetHeight];
        }
        return [0, 0];
    },
    
    scrollToPage: function(pageIndex) {
        const container = document.getElementById(`preview-container-${pageIndex}`);
        if (container) {
            container.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    }
};

window.getElementDimensions = function(element) {
    if (!element) return [0, 0];
    return [element.offsetWidth, element.offsetHeight];
};

window._trimResize = window._trimResize || {
    dotNetRef: null,
    cleanupForHandle: null
};


window.registerPanelResize = function (dotNetRef, handleId) {
    try {
        // cleanup previous
        if (window._trimResize.cleanupForHandle) {
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
        if (!thumbArea) {
            console.warn('registerPanelResize: thumbnail-area not found');
        }

        // rAF-based throttle state
        let pending = false;
        let latestClientX = 0;

        const onPointerDown = function (e) {
            try {
                handle.setPointerCapture?.(e.pointerId);

                const onPointerMove = function (ev) {
                    latestClientX = ev.clientX;
                    if (!pending) {
                        pending = true;
                        requestAnimationFrame(function () {
                            pending = false;

                            const splitContainerRect = handle.parentElement.getBoundingClientRect();
                            const minLeft = 150;
                            const minRight = 260;
                            const splitterWidth = handle.getBoundingClientRect().width || 8;

                            // compute left width (clamped to split container width)
                            const maxLeft = Math.max(minLeft, Math.round(splitContainerRect.width - minRight - splitterWidth));
                            const computedLeft = Math.round(latestClientX - splitContainerRect.left);
                            const newLeftWidth = Math.max(minLeft, Math.min(maxLeft, computedLeft));

                            // compute right width so left+splitter+right == splitContainerRect.width (clamped)
                            const newRightWidthUnclamped = Math.round(splitContainerRect.width - newLeftWidth - splitterWidth);
                            const newRightWidth = Math.max(minRight, Math.min(Math.round(splitContainerRect.width - minLeft - splitterWidth), newRightWidthUnclamped));

                            // apply to left pane
                            if (thumbArea) {
                                thumbArea.style.setProperty('--thumbnail-width', newLeftWidth + 'px');
                                thumbArea.style.width = newLeftWidth + 'px';
                                thumbArea.style.maxWidth = maxLeft + 'px';
                            } else {
                                handle.parentElement.style.width = newLeftWidth + 'px';
                            }
                            // apply to right pane (handle.nextElementSibling is the right pane)
                            const rightPane = handle.nextElementSibling;
                            if (rightPane) {
                                rightPane.style.width = newRightWidth + 'px';
                                rightPane.style.flex = '0 0 auto';
                            }
                        });
                    }
                };
                const onPointerUp = function (ev) {
                    try {
                        handle.releasePointerCapture?.(ev.pointerId);
                        
                        const splitContainerRect = handle.parentElement.getBoundingClientRect();
                        const minWidth = 150;
                        const minRightWidth = 260;
                        const splitterWidth = handle.getBoundingClientRect().width || 8;

                        const maxLeft = Math.max(minLeft, Math.round(splitContainerRect.width - minRight - splitterWidth));
                        const computedFinalLeft = Math.round(ev.clientX - splitContainerRect.left);
                        const finalLeftWidth = Math.max(minLeft, Math.min(maxLeft, computedFinalLeft));
                        const finalRightUnclamped = Math.round(splitContainerRect.width - finalLeftWidth - splitterWidth);
                    
                        if (window._trimResize.dotNetRef && window._trimResize.dotNetRef.invokeMethodAsync) {
                            window._trimResize.dotNetRef.invokeMethodAsync('CommitPanelWidth', finalLeftWidth);
                        }
                        // persist styles on final commit
                        if (thumbArea) {
                            thumbArea.style.setProperty('--thumbnail-width', finalLeftWidth + 'px');
                            thumbArea.style.width = finalLeftWidth + 'px';
                            thumbArea.style.maxWidth = maxLeft + 'px';
                        }
                        const rightPaneFinal = handle.nextElementSibling;
                        if (rightPaneFinal) {
                            rightPaneFinal.style.width = finalRightWidth + 'px';
                            rightPaneFinal.style.flex = '0 0 auto';
                        }
                    } catch (err) {
                        console.error('onPointerUp error', err);
                    }
                    // cleanup listeners
                    handle.removeEventListener('pointermove', onPointerMove);
                    handle.removeEventListener('pointerup', onPointerUp);
                };

                handle.addEventListener('pointermove', onPointerMove);
                handle.addEventListener('pointerup', onPointerUp);
            } catch (e) {
                console.error('onPointerDown error', e);
            }
        };

        handle.addEventListener('pointerdown', onPointerDown);

        window._trimResize.cleanupForHandle = function () {
            try {
                handle.removeEventListener('pointerdown', onPointerDown);
            } catch (e) { }
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

window._previewZoomDebounce = window._previewZoomDebounce || { timer: null, lastZoom: 1 };

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
        // center position inside inner's client rect (still scaled by prev)
        const centerInnerClientX = centerClientX - innerRect.left;
        const centerInnerClientY = centerClientY - innerRect.top;
        // convert to unscaled (logical) coordinates
        const centerUnscaledX = centerInnerClientX / prev;
        const centerUnscaledY = centerInnerClientY / prev;

        // 2) apply transform (scale) using top-left origin
        inner.style.setProperty('--preview-zoom', String(zoom));
        inner.style.transform = `scale(${zoom})`;
        inner.style.transformOrigin = '0 0';

        // 3) compute new scroll so that the same content-center stays centered in viewport
        const vpW = vpRect.width;
        const vpH = vpRect.height;
        // scaled content size (use inner.scrollWidth/Height * zoom as fallback)
        const contentScaledW = (inner.scrollWidth || innerRect.width) * zoom;
        const contentScaledH = (inner.scrollHeight || innerRect.height) * zoom;

        let newScrollLeft = centerUnscaledX * zoom - vpW / 2;
        let newScrollTop  = centerUnscaledY * zoom - vpH / 2;

        // clamp
        newScrollLeft = Math.max(0, Math.min(contentScaledW - vpW, newScrollLeft));
        newScrollTop  = Math.max(0, Math.min(contentScaledH - vpH, newScrollTop));

        viewport.scrollLeft = Math.round(newScrollLeft);
        viewport.scrollTop = Math.round(newScrollTop);

        // store last zoom
        window._previewZoomState = window._previewZoomState || {};
        window._previewZoomState.lastZoom = zoom;
    } catch (e) {
        console.error('setPreviewZoom error', e);
    }
};

// 初期フィット計算（オプション：EditPage と同様に container に合わせる）
window.computeAndApplyFitZoom = function () {
    try {
        const container = document.getElementById('trim-preview-container');
        const inner = document.getElementById('preview-zoom-inner');
        if (!container || !inner) return;
        
        const containerW = container.clientWidth || 1;
        const innerW = inner.scrollWidth || inner.getBoundingClientRect().width || 1;
        
        // フィット倍率（内部が container より大きければ縮小）
        const fit = Math.min(1.0, containerW / innerW);
        
        if (typeof window.setPreviewZoom === 'function') {
            window.setPreviewZoom(fit);
        }
    } catch (e) {
        console.error('computeAndApplyFitZoom error', e);
    }
};

window._previewPan = window._previewPan || { enabled: false, handlers: null, state: null };

window.setPreviewPanEnabled = function (enabled) {
    try {
        const viewport = document.querySelector('.preview-zoom-viewport');
        if (!viewport) return;

        // disable existing
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
            // set default cursor when pan disabled
            viewport.style.cursor = '';
            return;
        }

        // enable pan
        window._previewPan.enabled = true;
        viewport.style.cursor = 'grab';
        viewport.style.touchAction = 'none'; // allow pointer dragging
        viewport.classList.add('pan-active');

        const state = { active: false, startX: 0, startY: 0, scrollLeft: 0, scrollTop: 0, pointerId: null };
        window._previewPan.state = state;

        const onPointerDown = function (ev) {
            try {
                // only left button or primary pointer
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
                // invert movement to emulate hand-drag (dragging moves content oppositely)
                viewport.scrollLeft = state.scrollLeft - dx;
                viewport.scrollTop = state.scrollTop - dy;
            } catch (e) { /* ignore */ }
        };

        const onPointerUp = function (ev) {
            try {
                if (state.active && state.pointerId === ev.pointerId) {
                    state.active = false;
                    try { viewport.releasePointerCapture && viewport.releasePointerCapture(ev.pointerId); } catch {}
                    viewport.classList.remove('panning');
                }
            } catch (e) { /* ignore */ }
        };

        // attach
        viewport.addEventListener('pointerdown', onPointerDown);
        viewport.addEventListener('pointermove', onPointerMove);
        viewport.addEventListener('pointerup', onPointerUp);
        viewport.addEventListener('pointercancel', onPointerUp);

        window._previewPan.handlers = { down: onPointerDown, move: onPointerMove, up: onPointerUp };
    } catch (e) {
        console.error('setPreviewPanEnabled error', e);
    }
};


(function(){
    // attachTrimListeners/detachTrimListeners with 8-handle resize support
    window._simpleTrim = window._simpleTrim || {};

    function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

    // --- 共通クリーンアップ関数: 既存 entry のイベント/overlay を確実に除去 ---
    function cleanupTrimEntry(canvasId) {
        try {
            const entry = window._simpleTrim && window._simpleTrim[canvasId];
            if (!entry) return;
            try { if (entry.base && entry.handlers && entry.handlers.pointerDown) entry.base.removeEventListener('pointerdown', entry.handlers.pointerDown); } catch(e){}
            try { if (entry.base && entry.handlers && entry.handlers.touchStart) entry.base.removeEventListener('touchstart', entry.handlers.touchStart); } catch(e){}
            try { if (entry.handlers && entry.handlers.move) window.removeEventListener('pointermove', entry.handlers.move, { passive: false }); } catch(e){}
            try { if (entry.handlers && entry.handlers.up) window.removeEventListener('pointerup', entry.handlers.up, { passive: false }); } catch(e){}
            try { if (entry.internal && entry.internal.hostScroll) entry.host.removeEventListener('scroll', entry.internal.hostScroll, { passive: true }); } catch(e){}
            try {
                if (entry.internal && entry.internal.containerScroll) {
                    const container = document.getElementById('trim-preview-container') || (entry.host && entry.host.closest && entry.host.closest('.preview-zoom-viewport'));
                    if (container) container.removeEventListener('scroll', entry.internal.containerScroll, { passive: true });
                }
            } catch(e){}
            try { if (entry.internal && entry.internal.windowScroll) window.removeEventListener('scroll', entry.internal.windowScroll, { passive: true }); } catch(e){}
            try { if (entry.internal && entry.internal.resize) window.removeEventListener('resize', entry.internal.resize, { passive: true }); } catch(e){}
            try {
                const ov = entry.overlay || document.getElementById(canvasId + '-overlay');
                if (ov && ov.getContext) { const ctx = ov.getContext('2d'); ctx && ctx.clearRect(0,0,ov.width,ov.height); }
                if (entry.overlay && entry.overlay.parentElement) entry.overlay.parentElement.removeChild(entry.overlay);
            } catch(e){}
            try { delete window._simpleTrim[canvasId]; } catch(e){}
        } catch(e) { console.error('cleanupTrimEntry error', e); }
    }

    window.attachTrimListeners = function (canvasId, dotNetRef) {
        try {
            if (!canvasId) return false;
            const base = document.getElementById(canvasId);
            if (!base) {
                console.warn('attachTrimListeners: canvas not found', canvasId);
                return false;
            }

            // 既存エントリがあれば必ずクリーンアップしてから再作成する
            try { cleanupTrimEntry(canvasId); } catch(e){}

            const host = base.parentElement || base.closest('.tp-preview-page') || base.closest('.preview-zoom-inner') || document.body;
            try { if (getComputedStyle(host).position === 'static') host.style.position = 'relative'; } catch(e){}

            const overlayId = canvasId + '-overlay';
            let overlay = document.getElementById(overlayId);
            if (!overlay) {
                overlay = document.createElement('canvas');
                overlay.id = overlayId;
                overlay.style.position = 'absolute';
                overlay.style.pointerEvents = 'none';
                overlay.style.zIndex = '40';
                host.appendChild(overlay);
            }

            const state = {
                base, host, overlay, dotNetRef,
                active:false, mode:null, // mode: 'draw'|'resize'
                pointerId:null,
                startClientX:0, startClientY:0,
                startRectPx:null, // for resize: {x,y,w,h} in px
                currentRectPx:null, // current rect in px
                pendingMove:false,
                handlers:{},
                internal:{}
            };
            window._simpleTrim[canvasId] = state;
            const dpr = window.devicePixelRatio || 1;
            const HANDLE_SIZE = 12; // px

            function updateOverlaySize() {
                try {
                    const b = state.base.getBoundingClientRect();
                    const h = state.host.getBoundingClientRect();

                    // 重要: overlay の幅/高さ（および canvas 内部ピクセル数）は
                    // 「論理サイズ (clientWidth/clientHeight)」で揃える
                    const logicalW = Math.max(1, Math.round(state.base.clientWidth || Math.round(b.width || 0)));
                    const logicalH = Math.max(1, Math.round(state.base.clientHeight || Math.round(b.height || 0)));

                    // 位置はホストに対する表示上の相対位置（getBoundingClientRect を使う）
                    const relLeft = Math.round(b.left - h.left);
                    const relTop  = Math.round(b.top  - h.top);

                    state.overlay.style.left = relLeft + 'px';
                    state.overlay.style.top  = relTop + 'px';

                    // CSS 表示サイズは論理サイズに合わせる（これで描画系と整合）
                    state.overlay.style.width = logicalW + 'px';
                    state.overlay.style.height = logicalH + 'px';

                    // canvas 内部ピクセルは DPR を掛けた論理サイズ
                    state.overlay.width  = Math.min(16384, Math.round(logicalW * dpr));
                    state.overlay.height = Math.min(16384, Math.round(logicalH * dpr));
                } catch(e){ /* ignore */ }
            }

            function clearOverlay() {
                try {
                    const ctx = state.overlay.getContext('2d');
                    if (ctx) { ctx.setTransform(1,0,0,1,0,0); ctx.clearRect(0,0,state.overlay.width,state.overlay.height); }
                } catch(e){}
            }

            function rectPxToNormalized(rPx) {
                const logicalW = Math.max(1, Math.round(state.base.clientWidth || 1));
                const logicalH = Math.max(1, Math.round(state.base.clientHeight || 1));
                return {
                    X: clamp(rPx.x / logicalW, 0, 1),
                    Y: clamp(rPx.y / logicalH, 0, 1),
                    Width: clamp(rPx.w / logicalW, 0, 1),
                    Height: clamp(rPx.h / logicalH, 0, 1)
                };
            }

            function drawRectFromPx(rPx) {
                try {
                    updateOverlaySize();
                    const ov = state.overlay;
                    const ctx = ov.getContext('2d');
                    if (!ctx) return;
                    ctx.setTransform(1,0,0,1,0,0);
                    ctx.clearRect(0,0,ov.width,ov.height);
                    ctx.scale(dpr, dpr);

                    const cssW = Math.max(1, Math.round(state.base.clientWidth || state.base.getBoundingClientRect().width || 0));
                    const cssH = Math.max(1, Math.round(state.base.clientHeight || state.base.getBoundingClientRect().height || 0));
                    if (!rPx) return;

                    let rx = Math.round(rPx.x);
                    let ry = Math.round(rPx.y);
                    let rw = Math.round(rPx.w);
                    let rh = Math.round(rPx.h);
                    rx = clamp(rx, 0, cssW);
                    ry = clamp(ry, 0, cssH);
                    rw = clamp(rw, 0, cssW - rx);
                    rh = clamp(rh, 0, cssH - ry);

                    const strokeColor = 'rgba(59,130,246,0.95)';
                    const fillColor = 'rgba(59,130,246,0.12)';

                    ctx.fillStyle = fillColor;
                    ctx.fillRect(rx, ry, rw, rh);
                    ctx.lineWidth = 2;
                    ctx.strokeStyle = strokeColor;
                    ctx.strokeRect(rx + 0.5, ry + 0.5, Math.max(0, rw - 1), Math.max(0, rh - 1));

                    // draw 8 handles
                    const hs = HANDLE_SIZE;
                    ctx.fillStyle = strokeColor;
                    const half = Math.round(hs / 2);
                    const points = [
                        [rx, ry],
                        [rx + rw/2, ry],
                        [rx + rw, ry],
                        [rx + rw, ry + rh/2],
                        [rx + rw, ry + rh],
                        [rx + rw/2, ry + rh],
                        [rx, ry + rh],
                        [rx, ry + rh/2]
                    ];
                    points.forEach(p => ctx.fillRect(Math.round(p[0]-half), Math.round(p[1]-half), hs, hs));
                } catch(e){ console.error('drawRect error', e); }
            }

            function toLocalPx(clientX, clientY) {
                const b = state.base.getBoundingClientRect();
                const logicalW = Math.max(1, Math.round(state.base.clientWidth || b.width || 1));
                const logicalH = Math.max(1, Math.round(state.base.clientHeight || b.height || 1));

                const scaleFromRects = (b.width && logicalW) ? (b.width / logicalW) : 1;
                const previewScale = (window._previewZoomState && window._previewZoomState.lastZoom) ? window._previewZoomState.lastZoom : scaleFromRects;
                const scale = previewScale || 1;

                const xInScaled = clientX - b.left;
                const yInScaled = clientY - b.top;
                const localX = xInScaled / scale;
                const localY = yInScaled / scale;

                return { x: localX, y: localY, cssW: logicalW, cssH: logicalH };
            }

            function getHandleUnderPoint(rPx, px, py) {
                if (!rPx) return null;
                const rx = rPx.x, ry = rPx.y, rw = rPx.w, rh = rPx.h;
                const hs = HANDLE_SIZE;
                const half = Math.round(hs/2);
                const handles = [
                    {k:'nw', x:rx, y:ry},
                    {k:'n',  x:rx+rw/2, y:ry},
                    {k:'ne', x:rx+rw, y:ry},
                    {k:'e',  x:rx+rw, y:ry+rh/2},
                    {k:'se', x:rx+rw, y:ry+rh},
                    {k:'s',  x:rx+rw/2, y:ry+rh},
                    {k:'sw', x:rx, y:ry+rh},
                    {k:'w',  x:rx, y:ry+rh/2}
                ];
                for (let h of handles) {
                    if (px >= h.x - half && px <= h.x + half && py >= h.y - half && py <= h.y + half) return h.k;
                }
                return null;
            }

            function scheduleMove(ev) {
                state.lastMoveEv = ev;
                if (state.pendingMove) return;
                state.pendingMove = true;
                requestAnimationFrame(() => {
                    state.pendingMove = false;
                    if (!state.active) return;
                    const loc = toLocalPx(state.lastMoveEv.clientX, state.lastMoveEv.clientY);
                    const cssW = loc.cssW, cssH = loc.cssH;
                    if (state.mode === 'draw') {
                        const x = clamp(Math.min(loc.x, state.startClientLocal.x), 0, cssW);
                        const y = clamp(Math.min(loc.y, state.startClientLocal.y), 0, cssH);
                        const w = clamp(Math.abs(loc.x - state.startClientLocal.x), 0, cssW);
                        const h = clamp(Math.abs(loc.y - state.startClientLocal.y), 0, cssH);
                        state.currentRectPx = { x, y, w, h };
                        drawRectFromPx(state.currentRectPx);
                    } else if (state.mode === 'resize' && state.startRectPx) {
                        const dx = loc.x - state.startClientLocal.x;
                        const dy = loc.y - state.startClientLocal.y;
                        let sx = state.startRectPx.x, sy = state.startRectPx.y, sw = state.startRectPx.w, sh = state.startRectPx.h;
                        let ex = sx + sw, ey = sy + sh;
                        const hKey = state.resizeHandle;
                        if (hKey === 'nw' || hKey === 'w' || hKey === 'sw') {
                            let newLeft = clamp(sx + dx, 0, ex - 1);
                            sx = newLeft;
                            sw = ex - sx;
                        }
                        if (hKey === 'ne' || hKey === 'e' || hKey === 'se') {
                            let newRight = clamp(ex + dx, sx + 1, cssW);
                            sw = newRight - sx;
                        }
                        if (hKey === 'nw' || hKey === 'n' || hKey === 'ne') {
                            let newTop = clamp(sy + dy, 0, ey - 1);
                            sy = newTop;
                            sh = ey - sy;
                        }
                        if (hKey === 'sw' || hKey === 's' || hKey === 'se') {
                            let newBottom = clamp(ey + dy, sy + 1, cssH);
                            sh = newBottom - sy;
                        }
                        state.currentRectPx = { x: Math.round(sx), y: Math.round(sy), w: Math.round(sw), h: Math.round(sh) };
                        drawRectFromPx(state.currentRectPx);
                    }
                });
            }

            const onPointerDown = function (ev) {
                console.log("attachTrimListeners")
                try {
                    if (ev.button !== undefined && ev.button !== 0) return;
                    state.active = true;
                    state.pointerId = ev.pointerId ?? 'mouse';
                    state.startClientX = ev.clientX;
                    state.startClientY = ev.clientY;
                    state.startClientLocal = toLocalPx(ev.clientX, ev.clientY);
                    try { state.base.setPointerCapture && state.base.setPointerCapture(ev.pointerId); } catch(e){}
                    updateOverlaySize();

                    // if there is a current rect, test handles
                    let existingRectPx = null;
                    if (state.currentRectPx) existingRectPx = state.currentRectPx;
                    else if (state.dotNetRef && state.dotNetRef.getCurrentRectPx) {
                        try { existingRectPx = state.dotNetRef.getCurrentRectPx(); } catch(e) { existingRectPx = null; }
                    }

                    const px = state.startClientLocal.x;
                    const py = state.startClientLocal.y;
                    const hit = getHandleUnderPoint(existingRectPx, px, py);
                    if (hit) {
                        state.mode = 'resize';
                        state.resizeHandle = hit;
                        state.startRectPx = existingRectPx ? { ...existingRectPx } : { x:px, y:py, w:0, h:0 };
                        state.startClientLocal = { x: px, y: py };
                        console.log(`[trim][${canvasId}] resize start handle=${hit} client=${ev.clientX},${ev.clientY} local=${Math.round(px)},${Math.round(py)}`);
                    } else {
                        state.mode = 'draw';
                        state.startClientLocal = { x: px, y: py };
                        state.currentRectPx = { x: px, y: py, w:0, h:0 };
                        console.log(`[trim][${canvasId}] draw start client=${ev.clientX},${ev.clientY} local=${Math.round(px)},${Math.round(py)}`);
                        drawRectFromPx(state.currentRectPx);
                    }

                    state.handlers.move = function(mEv) { scheduleMove(mEv); };
                    state.handlers.up = function(uEv) {
                        if (!state.active) return;
                        state.active = false;
                        try { state.base.releasePointerCapture && state.base.releasePointerCapture(state.pointerId); } catch(e){}

                        const raw = state.currentRectPx || { x: 0, y: 0, w: 0, h: 0 };
                        try { console.log(`[trim][${canvasId}] end RAW px = ${raw.x},${raw.y},${raw.w},${raw.h}`); } catch(e){}

                        if (raw.w > 0 && raw.h > 0) {
                            const norm = rectPxToNormalized(raw);
                            try { console.log(`[trim][${canvasId}] end normalized=${norm.X.toFixed(4)},${norm.Y.toFixed(4)},${norm.Width.toFixed(4)},${norm.Height.toFixed(4)}`); } catch(e){}
                            try { if (window._simpleTrim && window._simpleTrim[canvasId]) window._simpleTrim[canvasId].lastRawRect = raw; } catch(e){}
                            if (state.dotNetRef && state.dotNetRef.invokeMethodAsync) {
                                try { state.dotNetRef.invokeMethodAsync('CommitTrimRectFromJs', norm.X, norm.Y, norm.Width, norm.Height); } catch(e){ console.warn('CommitTrimRectFromJs invoke failed', e); }
                            }
                        } else {
                            clearOverlay();
                        }

                        try { window.removeEventListener('pointermove', state.handlers.move, { passive: false }); } catch(e){}
                        try { window.removeEventListener('pointerup', state.handlers.up, { passive: false }); } catch(e){}
                    };

                    window.addEventListener('pointermove', state.handlers.move, { passive: false });
                    window.addEventListener('pointerup', state.handlers.up, { passive: false });

                    ev.preventDefault?.();
                } catch(e) { console.error('attachTrimListeners onPointerDown error', e); }
            };

            const onTouchStart = function(tEv) {
                try {
                    if (!tEv.touches || tEv.touches.length === 0) return;
                    const t = tEv.touches[0];
                    onPointerDown({ clientX: t.clientX, clientY: t.clientY, pointerId: 'touch', button: 0, preventDefault: () => tEv.preventDefault() });
                    tEv.preventDefault();
                } catch(e){ console.error('attachTrimListeners onTouchStart error', e); }
            };

            // store handlers so detachTrimListeners can remove them reliably
            state.handlers.pointerDown = onPointerDown;
            state.handlers.touchStart = onTouchStart;

            // attach element listeners
            state.base.addEventListener('pointerdown', onPointerDown, { passive: false });
            state.base.addEventListener('touchstart', onTouchStart, { passive: false });

            // scroll/resize listeners
            let scrollPending = false;
            function onAnyScrollOrResize() { if (scrollPending) return; scrollPending = true; requestAnimationFrame(()=>{ scrollPending=false; updateOverlaySize(); drawRectFromPx(state.currentRectPx); }); }
            try { state.internal.hostScroll = onAnyScrollOrResize; state.host.addEventListener('scroll', state.internal.hostScroll, { passive: true }); } catch(e){}
            try { const container = document.getElementById('trim-preview-container') || state.host.closest('.preview-zoom-viewport'); if (container) { state.internal.containerScroll = onAnyScrollOrResize; container.addEventListener('scroll', state.internal.containerScroll, { passive: true }); } } catch(e){}
            try { state.internal.windowScroll = onAnyScrollOrResize; window.addEventListener('scroll', state.internal.windowScroll, { passive: true }); state.internal.resize = onAnyScrollOrResize; window.addEventListener('resize', state.internal.resize, { passive: true }); } catch(e){}

            // initial sizing
            updateOverlaySize();
            return true;
        } catch(e) { console.error('attachTrimListeners error', e); return false; }
    };

    window.detachTrimListeners = function(canvasId) {
        try {
            const entry = window._simpleTrim && window._simpleTrim[canvasId];
            if (!entry) {
                // Ensure any stray state removed
                try { cleanupTrimEntry(canvasId); } catch(e){}
                return false;
            }

            // use cleanup helper
            cleanupTrimEntry(canvasId);
            return true;
        } catch(e) { console.error('detachTrimListeners error', e); return false; }
    };
})();
 // ...existing code...

window.drawTrimOverlay = function(canvasId, rects) {
    try {
        if (!canvasId) return false;
        const base = document.getElementById(canvasId);
        if (!base) return false;

        const host = base.parentElement || base.closest('.tp-preview-page') || base.closest('.preview-zoom-inner') || document.body;
        const overlayId = canvasId + '-overlay';
        let overlay = document.getElementById(overlayId);

        if (!overlay) {
            overlay = document.createElement('canvas');
            overlay.id = overlayId;
            overlay.style.position = 'absolute';
            overlay.style.pointerEvents = 'none';
            overlay.style.zIndex = '40';
            try { if (getComputedStyle(host).position === 'static') host.style.position = 'relative'; } catch(e){}
            host.appendChild(overlay);
        }

        const dpr = window.devicePixelRatio || 1;

        // position uses transformed bounding rects, but size for normalized->px uses logical clientWidth/clientHeight
        const baseRect = base.getBoundingClientRect();
        const hostRect = host.getBoundingClientRect();
        const relLeft = Math.round(baseRect.left - hostRect.left);
        const relTop  = Math.round(baseRect.top  - hostRect.top);

        // Use clientWidth/clientHeight (layout size, unaffected by CSS transform scale)
        const cssW = Math.max(1, Math.round(base.clientWidth || Math.round(baseRect.width || 0)));
        const cssH = Math.max(1, Math.round(base.clientHeight || Math.round(baseRect.height || 0)));

        overlay.style.left = relLeft + 'px';
        overlay.style.top  = relTop + 'px';
        overlay.style.width = cssW + 'px';
        overlay.style.height = cssH + 'px';
        overlay.width  = Math.min(16384, Math.round(cssW * dpr));
        overlay.height = Math.min(16384, Math.round(cssH * dpr));

        console.log(`[trim][${canvasId}] drawTrimOverlay overlay size=${overlay.width}x${overlay.height} css=${cssW}x${cssH} dpr=${dpr}`);

        const ctx = overlay.getContext('2d');
        if (!ctx) return false;

        ctx.setTransform(1,0,0,1,0,0);
        ctx.clearRect(0,0,overlay.width,overlay.height);
        ctx.scale(dpr, dpr);

        if (Array.isArray(rects) && rects.length > 0) {
            const r = rects[0];

            // accept either PascalCase (X,Y,Width,Height) or camelCase (x,y,width,height)
            const getNum = (o, pascal, camel) => {
                if (!o) return 0;
                if (o[pascal] !== undefined && o[pascal] !== null) return Number(o[pascal]);
                if (o[camel] !== undefined && o[camel] !== null) return Number(o[camel]);
                return 0;
            };

            const nx = getNum(r, 'X', 'x') || 0;
            const ny = getNum(r, 'Y', 'y') || 0;
            const nw = getNum(r, 'Width', 'width') || 0;
            const nh = getNum(r, 'Height', 'height') || 0;

            let rx = Math.round(nx * cssW);
            let ry = Math.round(ny * cssH);
            let rw = Math.round(nw * cssW);
            let rh = Math.round(nh * cssH);

            rx = Math.max(0, Math.min(cssW, rx));
            ry = Math.max(0, Math.min(cssH, ry));
            rw = Math.max(0, Math.min(cssW - rx, rw));
            rh = Math.max(0, Math.min(cssH - ry, rh));

            const strokeColor = 'rgba(59,130,246,0.95)';
            const fillColor = 'rgba(59,130,246,0.12)';

            ctx.fillStyle = fillColor;
            ctx.fillRect(rx, ry, rw, rh);

            ctx.lineWidth = 2;
            ctx.strokeStyle = strokeColor;
            ctx.strokeRect(rx + 0.5, ry + 0.5, Math.max(0, rw - 1), Math.max(0, rh - 1));

            const HANDLE_SIZE = 12;
            ctx.fillStyle = strokeColor;
            const half = Math.round(HANDLE_SIZE/2);
            const points = [
                [rx, ry],
                [rx + rw/2, ry],
                [rx + rw, ry],
                [rx + rw, ry + rh/2],
                [rx + rw, ry + rh],
                [rx + rw/2, ry + rh],
                [rx, ry + rh],
                [rx, ry + rh/2]
            ];
            points.forEach(p => ctx.fillRect(Math.round(p[0]-half), Math.round(p[1]-half), HANDLE_SIZE, HANDLE_SIZE));

            console.log(`[trim][${canvasId}] drawTrimOverlay points=${JSON.stringify(points)}`);
            try {
                if (window._simpleTrim && window._simpleTrim[canvasId]) {
                    // sync logical-px rect into internal state so resize handles match
                    window._simpleTrim[canvasId].currentRectPx = { x: rx, y: ry, w: rw, h: rh };
                }
            } catch(e) {}
        } else {
            try {
                if (window._simpleTrim && window._simpleTrim[canvasId]) {
                    window._simpleTrim[canvasId].currentRectPx = null;
                }
            } catch(e) {}
        }

        return true;
    } catch (e) {
        console.error('drawTrimOverlay error', e);
        return false;
    }
};