// wwwroot/js/site.js

window.trimPreviewArea = {
    dotNetRef: null,

    initialize: function (dotNetRef) {
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

window.getElementDimensions = function (element) {
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
        let newScrollTop = centerUnscaledY * zoom - vpH / 2;

        // clamp
        newScrollLeft = Math.max(0, Math.min(contentScaledW - vpW, newScrollLeft));
        newScrollTop = Math.max(0, Math.min(contentScaledH - vpH, newScrollTop));

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
                    try { viewport.releasePointerCapture && viewport.releasePointerCapture(ev.pointerId); } catch { }
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


// ...existing code...
(function () {
    // attachTrimListeners/detachTrimListeners with 8-handle resize support
    window._simpleTrim = window._simpleTrim || {};

    function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

    // --- 共通クリーンアップ関数: 既存 entry のイベント/overlay を確実に除去 ---
    function cleanupTrimEntry(canvasId) {
        try {
            const entry = window._simpleTrim && window._simpleTrim[canvasId];
            if (!entry) return;
            try { if (entry.base && entry.handlers && entry.handlers.pointerDown) entry.base.removeEventListener('pointerdown', entry.handlers.pointerDown); } catch (e) { }
            try { if (entry.base && entry.handlers && entry.handlers.touchStart) entry.base.removeEventListener('touchstart', entry.handlers.touchStart); } catch (e) { }
            try { if (entry.handlers && entry.handlers.move) window.removeEventListener('pointermove', entry.handlers.move, { passive: false }); } catch (e) { }
            try { if (entry.handlers && entry.handlers.up) window.removeEventListener('pointerup', entry.handlers.up, { passive: false }); } catch (e) { }
            try { if (entry.internal && entry.internal.hostScroll) entry.host.removeEventListener('scroll', entry.internal.hostScroll, { passive: true }); } catch (e) { }
            try {
                if (entry.internal && entry.internal.containerScroll) {
                    const container = document.getElementById('trim-preview-container') || (entry.host && entry.host.closest && entry.host.closest('.preview-zoom-viewport'));
                    if (container) container.removeEventListener('scroll', entry.internal.containerScroll, { passive: true });
                }
            } catch (e) { }
            try { if (entry.internal && entry.internal.windowScroll) window.removeEventListener('scroll', entry.internal.windowScroll, { passive: true }); } catch (e) { }
            try { if (entry.internal && entry.internal.resize) window.removeEventListener('resize', entry.internal.resize, { passive: true }); } catch (e) { }
            try {
                // canvas overlay cleanup (existing)
                const ov = entry.overlay || document.getElementById(canvasId + '-overlay');
                if (ov && ov.getContext) { const ctx = ov.getContext('2d'); ctx && ctx.clearRect(0, 0, ov.width, ov.height); }
                if (entry.overlay && entry.overlay.parentElement) entry.overlay.parentElement.removeChild(entry.overlay);
            } catch (e) { }
            try {
                // SVG/DOM overlay cleanup (new)
                const od = entry.overlayDom || document.getElementById(canvasId + '-overlay-svg');
                if (od && od.parentElement) od.parentElement.removeChild(od);
            } catch (e) { }
            try { delete window._simpleTrim[canvasId]; } catch (e) { }
        } catch (e) { console.error('cleanupTrimEntry error', e); }
    }

    window.attachTrimListeners = function (canvasId, dotNetRef) {
        try {
            if (!canvasId) return false;
            const base = document.getElementById(canvasId);
            if (!base) {
                console.warn(`trim attach: canvas not found: ${canvasId}`);
                return false;
            }

            // 抑止: 短時間の再アタッチやアクティブ中の上書きを防ぐ
            try {
                const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
                const existing = window._simpleTrim && window._simpleTrim[canvasId];
                if (existing) {
                    if (existing.active) {
                        return true;
                    }
                    const last = existing.internal && existing.internal.lastAttachedAt ? existing.internal.lastAttachedAt : 0;
                    if (now - last < 250) return true;
                }
            } catch (e) { /* ignore */ }

            try { cleanupTrimEntry(canvasId); } catch (e) { console.error(e); }

            const host = base.parentElement || base.closest('.tp-preview-page') || base.closest('.preview-zoom-inner') || document.body;
            try { if (getComputedStyle(host).position === 'static') host.style.position = 'relative'; } catch (e) { /* ignore */ }

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

            const svgContainerId = canvasId + '-overlay-svg';
            const overlayDom = document.getElementById(svgContainerId) || null;

            const state = {
                base, host, overlay, overlayDom, dotNetRef,
                active: false, mode: null,
                pointerId: null,
                startClientX: 0, startClientY: 0,
                startClientLocal: null,
                startRectPx: null,
                currentRectPx: null,
                pendingMove: false,
                handlers: {},
                internal: {},
                resizeHandle: null,
                baseRectAtDown: null,
                logicalWAtDown: null,
                logicalHAtDown: null
            };

            state.internal.lastAttachedAt = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
            window._simpleTrim[canvasId] = state;

            const HANDLE_KEY_MAP = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
            const HANDLE_CURSOR_MAP = {
                nw: 'nwse-resize', se: 'nwse-resize',
                ne: 'nesw-resize', sw: 'nesw-resize',
                n: 'ns-resize', s: 'ns-resize',
                e: 'ew-resize', w: 'ew-resize'
            };

            function toLocalPx(clientX, clientY) {
                const usingCaptured = (state.baseRectAtDown && state.active);
                const b = usingCaptured ? state.baseRectAtDown : state.base.getBoundingClientRect();
                const logicalW = (state.logicalWAtDown && state.active) ? state.logicalWAtDown : Math.max(1, Math.round(state.base.clientWidth || b.width || 1));
                const logicalH = (state.logicalHAtDown && state.active) ? state.logicalHAtDown : Math.max(1, Math.round(state.base.clientHeight || b.height || 1));
                const scaleFromRects = (b.width && logicalW) ? (b.width / logicalW) : 1;
                const previewScale = (window._previewZoomState && window._previewZoomState.lastZoom) ? window._previewZoomState.lastZoom : scaleFromRects;
                const scale = previewScale || 1;
                const xInScaled = clientX - b.left;
                const yInScaled = clientY - b.top;
                const localX = xInScaled / scale;
                const localY = yInScaled / scale;
                return { x: localX, y: localY, cssW: logicalW, cssH: logicalH };
            }

            function rectPxToNormalized(rPx) {
                const logicalW = Math.max(1, Math.round(state.base.clientWidth || 1));
                const logicalH = Math.max(1, Math.round(state.base.clientHeight || 1));
                const left = Number(rPx.x || 0);
                const top = Number(rPx.y || 0);
                const right = left + Number(rPx.w || 0);
                const bottom = top + Number(rPx.h || 0);
                const leftClamped = clamp(left, 0, logicalW);
                const topClamped = clamp(top, 0, logicalH);
                const rightClamped = clamp(right, 0, logicalW);
                const bottomClamped = clamp(bottom, 0, logicalH);
                const widthClamped = Math.max(0, rightClamped - leftClamped);
                const heightClamped = Math.max(0, bottomClamped - topClamped);
                return {
                    X: leftClamped / logicalW,
                    Y: topClamped / logicalH,
                    Width: widthClamped / logicalW,
                    Height: heightClamped / logicalH
                };
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
                    const prevRect = state.currentRectPx ? { ...state.currentRectPx } : null;
                    let alreadyDrawn = false;

                    if (state.mode === 'draw') {
                        const rawX = Math.min(loc.x, state.startClientLocal.x);
                        const rawY = Math.min(loc.y, state.startClientLocal.y);
                        const rawW = Math.abs(loc.x - state.startClientLocal.x);
                        const rawH = Math.abs(loc.y - state.startClientLocal.y);

                        state.currentRectPx = { x: rawX, y: rawY, w: rawW, h: rawH };

                        let dispX = rawX;
                        let dispY = rawY;
                        let dispW = rawW;
                        let dispH = rawH;

                        if (rawX < 0) {
                            dispX = 0;
                            dispW = Math.max(0, Math.min(state.startClientLocal.x - dispX, rawW));
                        }
                        if (rawY < 0) {
                            dispY = 0;
                            dispH = Math.max(0, Math.min(state.startClientLocal.y - dispY, rawH));
                        }

                        try {
                            if (state.overlayDom && window.drawTrimOverlayAsSvg) {
                                const norm = {
                                    X: dispX / Math.max(1, cssW),
                                    Y: dispY / Math.max(1, cssH),
                                    Width: dispW / Math.max(1, cssW),
                                    Height: dispH / Math.max(1, cssH)
                                };
                                window.drawTrimOverlayAsSvg(canvasId, [norm]);
                                alreadyDrawn = true;
                            } else {
                                try { drawRectFromPx({ x: Math.round(dispX), y: Math.round(dispY), w: Math.round(dispW), h: Math.round(dispH) }); alreadyDrawn = true; } catch (e) { }
                            }
                        } catch (e) { console.error(e); }

                    } else if (state.mode === 'resize' && state.startRectPx) {
                        const dx = loc.x - state.startClientLocal.x;
                        const dy = loc.y - state.startClientLocal.y;
                        let sx = state.startRectPx.x, sy = state.startRectPx.y, sw = state.startRectPx.w, sh = state.startRectPx.h;
                        const ex = sx + sw, ey = sy + sh;
                        const hKey = state.resizeHandle;

                        let propLeft = sx;
                        let propRight = ex;
                        let propTop = sy;
                        let propBottom = ey;

                        if (hKey === 'nw' || hKey === 'w' || hKey === 'sw') {
                            propLeft = clamp(sx + dx, 0, cssW);
                        }
                        if (hKey === 'ne' || hKey === 'e' || hKey === 'se') {
                            propRight = clamp(ex + dx, 0, cssW);
                        }
                        if (hKey === 'nw' || hKey === 'n' || hKey === 'ne') {
                            propTop = clamp(sy + dy, 0, cssH);
                        }
                        if (hKey === 'sw' || hKey === 's' || hKey === 'se') {
                            propBottom = clamp(ey + dy, 0, cssH);
                        }

                        let newLeft = Math.min(propLeft, propRight);
                        let newRight = Math.max(propLeft, propRight);
                        let newTop = Math.min(propTop, propBottom);
                        let newBottom = Math.max(propTop, propBottom);

                        const MIN_SIZE = 1;
                        if (newRight - newLeft < MIN_SIZE) {
                            if (propRight >= propLeft) {
                                newRight = Math.min(cssW, newLeft + MIN_SIZE);
                            } else {
                                newLeft = Math.max(0, newRight - MIN_SIZE);
                            }
                        }
                        if (newBottom - newTop < MIN_SIZE) {
                            if (propBottom >= propTop) {
                                newBottom = Math.min(cssH, newTop + MIN_SIZE);
                            } else {
                                newTop = Math.max(0, newBottom - MIN_SIZE);
                            }
                        }

                        const finalW = newRight - newLeft;
                        const finalH = newBottom - newTop;
                        state.currentRectPx = { x: Math.round(newLeft), y: Math.round(newTop), w: Math.round(finalW), h: Math.round(finalH) };
                    }

                    try {
                        if (state.currentRectPx) {
                            const changed = !prevRect || prevRect.x !== state.currentRectPx.x || prevRect.y !== state.currentRectPx.y || prevRect.w !== state.currentRectPx.w || prevRect.h !== state.currentRectPx.h;
                            if (changed) {
                                if (state.overlayDom && window.drawTrimOverlayAsSvg) {
                                    if (!alreadyDrawn) {
                                        const norm = rectPxToNormalized(state.currentRectPx);
                                        window.drawTrimOverlayAsSvg(canvasId, [norm]);
                                    }
                                } else {
                                    if (!alreadyDrawn) try { drawRectFromPx(state.currentRectPx); } catch (e) { }
                                }
                            }
                        } else {
                            if (state.overlayDom && window.drawTrimOverlayAsSvg) {
                                window.drawTrimOverlayAsSvg(canvasId, []);
                            }
                        }
                    } catch (e) { console.error(e); }
                });
            }

            const onPointerDown = function (ev) {
                try {
                    if (ev.button !== undefined && ev.button !== 0) return;
                    state.active = true;
                    state.pointerId = ev.pointerId ?? 'mouse';
                    state.startClientX = ev.clientX;
                    state.startClientY = ev.clientY;

                    try {
                        state.baseRectAtDown = state.base.getBoundingClientRect();
                        state.logicalWAtDown = Math.max(1, Math.round(state.base.clientWidth || state.baseRectAtDown.width || 1));
                        state.logicalHAtDown = Math.max(1, Math.round(state.base.clientHeight || state.baseRectAtDown.height || 1));
                    } catch (e) { state.baseRectAtDown = null; state.logicalWAtDown = null; state.logicalHAtDown = null; }

                    state.startClientLocal = toLocalPx(ev.clientX, ev.clientY);

                    try { if (state.base.setPointerCapture) state.base.setPointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
                    try {
                        const t = ev.target || ev.srcElement;
                        if (t && t.setPointerCapture && t !== state.base) {
                            try { t.setPointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
                        }
                    } catch (e) { /* ignore */ }

                    const target = ev.target || ev.srcElement;
                    state.resizeHandle = null;

                    if (state.overlayDom && target) {
                        const handleAttr = (target.getAttribute && target.getAttribute('data-handle')) ?? null;
                        const rectAttr = (target.getAttribute && target.getAttribute('data-rect')) ?? null;
                        if (handleAttr !== null) {
                            const idx = Number(handleAttr);
                            state.resizeHandle = (Number.isFinite(idx) && idx >= 0 && idx < HANDLE_KEY_MAP.length) ? HANDLE_KEY_MAP[idx] : null;
                            state.mode = 'resize';
                            try {
                                const cur = (window._simpleTrim && window._simpleTrim[canvasId] && window._simpleTrim[canvasId].currentRectPx) || null;
                                state.startRectPx = cur ? { ...cur } : { x: state.startClientLocal.x, y: state.startClientLocal.y, w: 0, h: 0 };
                            } catch (e) { state.startRectPx = { x: state.startClientLocal.x, y: state.startClientLocal.y, w: 0, h: 0 }; }
                        } else if (rectAttr !== null) {
                            state.mode = 'draw';
                            state.startClientLocal = { x: state.startClientLocal.x, y: state.startClientLocal.y };
                            state.currentRectPx = { x: state.startClientLocal.x, y: state.startClientLocal.y, w: 0, h: 0 };
                        } else {
                            state.mode = 'draw';
                            state.startClientLocal = { x: state.startClientLocal.x, y: state.startClientLocal.y };
                            state.currentRectPx = { x: state.startClientLocal.x, y: state.startClientLocal.y, w: 0, h: 0 };
                        }
                    } else {
                        state.mode = 'draw';
                        state.startClientLocal = { x: state.startClientLocal.x, y: state.startClientLocal.y };
                        state.currentRectPx = { x: state.startClientLocal.x, y: state.startClientLocal.y, w: 0, h: 0 };
                    }

                    try {
                        if (state.overlayDom && state.resizeHandle) {
                            const cur = HANDLE_CURSOR_MAP[state.resizeHandle] || '';
                            state.overlayDom.style.cursor = cur;
                        } else if (state.overlayDom && state.mode === 'draw') {
                            state.overlayDom.style.cursor = 'crosshair';
                        }
                    } catch (e) { /* ignore */ }

                    state.handlers.move = function (mEv) { scheduleMove(mEv); };
                    state.handlers.up = function (uEv) {
                        if (!state.active) return;
                        state.active = false;
                        try { state.base.releasePointerCapture && state.base.releasePointerCapture(state.pointerId); } catch (e) { /* ignore */ }

                        state.baseRectAtDown = null;
                        state.logicalWAtDown = null;
                        state.logicalHAtDown = null;

                        try {
                            if (state.internal && state.internal.scrollPendingWhileActive) {
                                state.internal.scrollPendingWhileActive = false;
                                if (state.overlayDom && window.drawTrimOverlayAsSvg) window.drawTrimOverlayAsSvg(canvasId, []);
                            }
                        } catch (e) { /* ignore */ }

                        try { if (state.overlayDom) state.overlayDom.style.cursor = ''; } catch (e) { /* ignore */ }

                        const raw = state.currentRectPx || { x: 0, y: 0, w: 0, h: 0 };
                        if (raw.w > 0 && raw.h > 0) {
                            const norm = rectPxToNormalized(raw);
                            try { if (window._simpleTrim && window._simpleTrim[canvasId]) window._simpleTrim[canvasId].lastRawRect = raw; } catch (e) { }
                            if (state.dotNetRef && state.dotNetRef.invokeMethodAsync) {
                                try { state.dotNetRef.invokeMethodAsync('CommitTrimRectFromJs', norm.X, norm.Y, norm.Width, norm.Height); } catch (e) { /* ignore */ }
                            }
                        } else {
                            try {
                                if (state.overlayDom && window.drawTrimOverlayAsSvg) {
                                    window.drawTrimOverlayAsSvg(canvasId, []);
                                }
                            } catch (e) { /* ignore */ }
                        }
                        try { window.removeEventListener('pointermove', state.handlers.move, { passive: false }); } catch (e) { }
                        try { window.removeEventListener('pointerup', state.handlers.up, { passive: false }); } catch (e) { }
                    };

                    window.addEventListener('pointermove', state.handlers.move, { passive: false });
                    window.addEventListener('pointerup', state.handlers.up, { passive: false });

                    ev.preventDefault?.();
                } catch (e) { console.error('attachTrimListeners onPointerDown error', e); }
            };

            const onTouchStart = function (tEv) {
                try {
                    if (!tEv.touches || tEv.touches.length === 0) return;
                    const t = tEv.touches[0];
                    onPointerDown({ clientX: t.clientX, clientY: t.clientY, pointerId: 'touch', button: 0, target: t.target, preventDefault: () => tEv.preventDefault() });
                    tEv.preventDefault();
                } catch (e) { console.error('attachTrimListeners onTouchStart error', e); }
            };

            state.handlers.pointerDown = onPointerDown;
            state.handlers.touchStart = onTouchStart;

            state.base.addEventListener('pointerdown', onPointerDown, { passive: false });
            state.base.addEventListener('touchstart', onTouchStart, { passive: false });

            if (state.overlayDom) {
                try {
                    state.overlayDom.style.pointerEvents = 'auto';
                    state.overlayDom.addEventListener('pointerdown', onPointerDown, { passive: false, capture: true });
                    state.overlayDom.addEventListener('touchstart', onTouchStart, { passive: false, capture: true });

                    const onOverlayPointerMove = function (ev) {
                        try {
                            const t = ev.target;
                            const handleAttr = (t && t.getAttribute) ? t.getAttribute('data-handle') : null;
                            const rectAttr = (t && t.getAttribute) ? t.getAttribute('data-rect') : null;
                            if (handleAttr !== null) {
                                const idx = Number(handleAttr);
                                const key = (Number.isFinite(idx) && idx >= 0 && idx < HANDLE_KEY_MAP.length) ? HANDLE_KEY_MAP[idx] : null;
                                const cur = key ? (HANDLE_CURSOR_MAP[key] || '') : '';
                                state.overlayDom.style.cursor = cur;
                            } else if (rectAttr !== null) {
                                state.overlayDom.style.cursor = 'move';
                            } else {
                                state.overlayDom.style.cursor = '';
                            }
                        } catch (e) { /* ignore */ }
                    };
                    state.handlers.overlayMove = onOverlayPointerMove;
                    state.overlayDom.addEventListener('pointermove', onOverlayPointerMove, { passive: true, capture: true });
                } catch (e) { console.error(e); }
            }

            // scroll/resize listeners
            let scrollPending = false;
            function onAnyScrollOrResize() {
                try {
                    if (state.active) {
                        state.internal.scrollPendingWhileActive = true;
                        return;
                    }
                    if (scrollPending) return;
                    scrollPending = true;
                    requestAnimationFrame(() => {
                        scrollPending = false;
                        try {
                            if (state.overlayDom && window.drawTrimOverlayAsSvg) {
                                window.drawTrimOverlayAsSvg(canvasId, []);
                            }
                        } catch (e) { /* ignore */ }
                    });
                } catch (e) { /* ignore */ }
            }

            try { state.internal.hostScroll = onAnyScrollOrResize; state.host.addEventListener('scroll', state.internal.hostScroll, { passive: true }); } catch (e) { }
            try { const container = document.getElementById('trim-preview-container') || state.host.closest('.preview-zoom-viewport'); if (container) { state.internal.containerScroll = onAnyScrollOrResize; container.addEventListener('scroll', state.internal.containerScroll, { passive: true }); } } catch (e) { }
            try { state.internal.windowScroll = onAnyScrollOrResize; window.addEventListener('scroll', state.internal.windowScroll, { passive: true }); state.internal.resize = onAnyScrollOrResize; window.addEventListener('resize', state.internal.resize, { passive: true }); } catch (e) { }

            try {
                if (!state.overlayDom && typeof updateOverlaySize === 'function') updateOverlaySize();
            } catch (e) { /* ignore */ }

            return true;
        } catch (e) { console.error('attachTrimListeners error', e); return false; }
    };


    window.detachTrimListeners = function (canvasId) {
        try {
            const entry = window._simpleTrim && window._simpleTrim[canvasId];
            if (!entry) {
                // Ensure any stray state removed
                try { cleanupTrimEntry(canvasId); } catch (e) { }
                return false;
            }

            // use cleanup helper
            cleanupTrimEntry(canvasId);
            return true;
        } catch (e) { console.error('detachTrimListeners error', e); return false; }
    };
})();

window.waitForCanvasReady = async function (canvasId, timeoutMs = 120) {
    try {
        if (!canvasId) return false;
        const start = performance.now();
        const el = document.getElementById(canvasId);
        if (!el) return false;

        // quick check: already stable (1 frame confirmation for speed)
        const w0 = el.clientWidth, h0 = el.clientHeight;
        if (w0 > 0 && h0 > 0) {
            await new Promise(r => requestAnimationFrame(r));
            const w1 = el.clientWidth, h1 = el.clientHeight;
            if (w0 === w1 && h0 === h1) return true;
        }

        // poll until size stabilizes or timeout
        while (performance.now() - start < (timeoutMs || 120)) {
            await new Promise(r => requestAnimationFrame(r));
            const w = el.clientWidth, h = el.clientHeight;
            if (w > 0 && h > 0) {
                // confirm stable across one extra frame (faster)
                await new Promise(r => requestAnimationFrame(r));
                const w2 = el.clientWidth, h2 = el.clientHeight;
                if (w === w2 && h === h2) return true;
            }
        }
        return false;
    } catch (e) {
        console.error('waitForCanvasReady error', e);
        return false;
    }
};

window.drawImageToCanvasForPreview = function (canvasId, imageUrl, useDevicePixelRatio = true) {
    // 変更: Promise を返すようにして、描画・レイアウト安定を待てるようにする
    return new Promise((resolve) => {
        try {
            const canvas = document.getElementById(canvasId);
            if (!canvas) { resolve(false); return; }
            const ctx = canvas.getContext('2d');
            if (!ctx) { resolve(false); return; }

            const img = new window.Image();
            img.crossOrigin = 'anonymous';

            img.onload = function () {
                try {
                    const iw = Math.max(1, Math.round(img.naturalWidth));
                    const ih = Math.max(1, Math.round(img.naturalHeight));
                    const dpr = useDevicePixelRatio ? (window.devicePixelRatio || 1) : 1;

                    // 内部ピクセルバッファを元画像サイズ * DPR にする
                    canvas.width = Math.round(iw * dpr);
                    canvas.height = Math.round(ih * dpr);

                    // 表示サイズ（CSS）は元画像の論理ピクセルサイズに設定する
                    canvas.style.width = iw + 'px';
                    canvas.style.height = ih + 'px';
                    canvas.style.display = 'block';

                    // 高DPI対応：コンテキストのスケールを設定（CSSピクセル単位で描画する）
                    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
                    ctx.clearRect(0, 0, iw, ih);

                    // 画像をキャンバスいっぱいに描く（アスペクトは img 自体のサイズなのでフィット）
                    ctx.drawImage(img, 0, 0, iw, ih);

                    // layout が安定するまで少し待つ（2フレーム）してから成功を返す
                    requestAnimationFrame(() => {
                        resolve(true);
                    });
                } catch (e) {
                    console.error('drawImageToCanvasForPreview draw error', e);
                    resolve(false);
                }
            };

            img.onerror = function (e) {
                console.error('drawImageToCanvasForPreview image load error', e, imageUrl);
                resolve(false);
            };

            img.src = imageUrl;
        } catch (e) {
            console.error('drawImageToCanvasForPreview error', e);
            resolve(false);
        }
    });
};

// ...existing code...
window.drawTrimOverlayAsSvg = function (canvasId, rects) {
    try {
        if (!canvasId) return false;
        const base = document.getElementById(canvasId);
        if (!base) return false;
        const host = base.parentElement || base.closest('.tp-preview-page') || base.closest('.preview-zoom-inner') || document.body;
        const overlayId = canvasId + '-overlay-svg';
        let container = document.getElementById(overlayId);
        if (!container) {
            container = document.createElement('div');
            container.id = overlayId;
            container.style.position = 'absolute';
            container.style.left = '0px';
            container.style.top = '0px';
            container.style.pointerEvents = 'none';
            container.style.zIndex = '45';
            host.appendChild(container);
        }

        const baseRect = base.getBoundingClientRect();
        const hostRect = host.getBoundingClientRect();
        const relLeft = Math.round(baseRect.left - hostRect.left);
        const relTop = Math.round(baseRect.top - hostRect.top);
        const cssW = Math.max(1, Math.round(base.clientWidth || Math.round(baseRect.width || 0)));
        const cssH = Math.max(1, Math.round(base.clientHeight || Math.round(baseRect.height || 0)));

        container.style.left = relLeft + 'px';
        container.style.top = relTop + 'px';
        container.style.width = cssW + 'px';
        container.style.height = cssH + 'px';

        let svg = container.querySelector('svg');
        if (!svg) {
            svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.setAttribute('width', '100%');
            svg.setAttribute('height', '100%');
            svg.style.pointerEvents = 'none';
            container.appendChild(svg);
        }

        while (svg.firstChild) svg.removeChild(svg.firstChild);

        if (!Array.isArray(rects) || rects.length === 0) {
            window._simpleTrim = window._simpleTrim || {};
            if (window._simpleTrim[canvasId]) {
                window._simpleTrim[canvasId].overlayDom = container;
                // ensure currentRectPx cleared so attachTrimListeners has correct startRect
                window._simpleTrim[canvasId].currentRectPx = null;
            }
            container.style.pointerEvents = 'none';
            svg.style.pointerEvents = 'none';
            return true;
        }

        container.style.pointerEvents = 'auto';
        svg.style.pointerEvents = 'auto';

        const r = rects[0];
        const nx = Number(r.X ?? r.x ?? 0);
        const ny = Number(r.Y ?? r.y ?? 0);
        const nw = Number(r.Width ?? r.width ?? 0);
        const nh = Number(r.Height ?? r.height ?? 0);

        const rx = Math.round(nx * cssW);
        const ry = Math.round(ny * cssH);
        const rw = Math.round(nw * cssW);
        const rh = Math.round(nh * cssH);

        const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        g.setAttribute('transform', `translate(0,0)`);

        const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        bg.setAttribute('x', '0');
        bg.setAttribute('y', '0');
        bg.setAttribute('width', String(cssW));
        bg.setAttribute('height', String(cssH));
        bg.setAttribute('fill', 'transparent');
        bg.style.pointerEvents = 'none';
        g.appendChild(bg);

        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', String(rx));
        rect.setAttribute('y', String(ry));
        rect.setAttribute('width', String(Math.max(0, rw)));
        rect.setAttribute('height', String(Math.max(0, rh)));
        rect.setAttribute('fill', 'rgba(59,130,246,0.12)');
        rect.setAttribute('stroke', 'rgba(59,130,246,0.95)');
        rect.setAttribute('stroke-width', '2');
        rect.style.pointerEvents = 'auto';
        rect.style.cursor = 'move';
        rect.setAttribute('data-rect', 'true');
        g.appendChild(rect);

        const HANDLE = 12;
        const half = Math.round(HANDLE / 2);
        const points = [
            [rx, ry],
            [rx + rw / 2, ry],
            [rx + rw, ry],
            [rx + rw, ry + rh / 2],
            [rx + rw, ry + rh],
            [rx + rw / 2, ry + rh],
            [rx, ry + rh],
            [rx, ry + rh / 2]
        ];
        const keyMap = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
        const cursorMap = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize' };
        points.forEach((p, idx) => {
            const h = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            h.setAttribute('x', String(Math.round(p[0] - half)));
            h.setAttribute('y', String(Math.round(p[1] - half)));
            h.setAttribute('width', String(HANDLE));
            h.setAttribute('height', String(HANDLE));
            h.setAttribute('fill', 'rgba(59,130,246,0.95)');
            h.setAttribute('data-handle', String(idx));
            h.style.pointerEvents = 'auto';
            const k = keyMap[idx];
            h.style.cursor = cursorMap[k] || 'default';
            g.appendChild(h);
        });

        svg.appendChild(g);

        // synchronize overlay into internal state (do not overwrite during active drag)
        window._simpleTrim = window._simpleTrim || {};
        if (!window._simpleTrim[canvasId]) window._simpleTrim[canvasId] = {};
        try {
            const rxFloat = nx * cssW;
            const ryFloat = ny * cssH;
            const rwFloat = nw * cssW;
            const rhFloat = nh * cssH;

            const entry = window._simpleTrim[canvasId];
            entry.overlayDom = container;

            if (!entry.active) {
                entry.currentRectPx = { x: rxFloat, y: ryFloat, w: rwFloat, h: rhFloat };
            }
        } catch (e) {
            // swallow sync errors but surface to console
            console.error('drawTrimOverlayAsSvg sync error', e);
        }

        try {
            const entry = window._simpleTrim[canvasId];
            if (entry && !container.__trimHooked) {
                if (entry.handlers && entry.handlers.pointerDown) {
                    container.addEventListener('pointerdown', function (ev) { try { entry.handlers.pointerDown(ev); } catch (e) { } }, { passive: false, capture: true });
                    container.addEventListener('touchstart', function (ev) { try { entry.handlers.touchStart && entry.handlers.touchStart(ev); } catch (e) { } }, { passive: false, capture: true });
                }
                if (entry.handlers && entry.handlers.overlayMove) {
                    container.addEventListener('pointermove', function (ev) { try { entry.handlers.overlayMove(ev); } catch (e) { } }, { passive: true, capture: true });
                    container.addEventListener('pointerover', function (ev) { try { entry.handlers.overlayOver && entry.handlers.overlayOver(ev); } catch (e) { } }, { passive: true, capture: true });
                    container.addEventListener('pointerout', function (ev) { try { entry.handlers.overlayOut && entry.handlers.overlayOut(ev); } catch (e) { } }, { passive: true, capture: true });
                }
                container.__trimHooked = true;
            }
        } catch (e) {
            console.error('drawTrimOverlayAsSvg hook error', e);
        }

        return true;
    } catch (e) {
        console.error('drawTrimOverlayAsSvg error', e);
        return false;
    }
};