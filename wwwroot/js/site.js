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
            // ensure previous handlers are removed to avoid duplicates
            this.unregister && this.unregister();

            this.dotNetRef = dotNetRef;

            const onMouseMove = (e) => {
                try {
                    if (this.dotNetRef) this.dotNetRef.invokeMethodAsync('OnPanelMouseMove', e.clientX).catch(()=>{});
                } catch (ex) { /* ignore */ }
            };
            const onMouseUp = (e) => {
                try {
                    if (this.dotNetRef) this.dotNetRef.invokeMethodAsync('OnPanelMouseUp').catch(()=>{});
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

window.getElementDimensions = function (element) {
    if (!element) return [0, 0];
    return [element.offsetWidth, element.offsetHeight];
};

window.registerPanelResize = function (dotNetRef, handleId, panelDebounceMs = 500) {
    console.log('Registering panel resize:', handleId);
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

        // ms
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
                    try { window._trimResize.dotNetRef.invokeMethodAsync('OnPanelMouseMove', clientX).catch(()=>{}); } catch (e) { /* ignore */ }
                }
            } else {
                const remaining = PANEL_DEBOUNCE - (now - lastNotify);
                if (notifyTimer) clearTimeout(notifyTimer);
                notifyTimer = setTimeout(() => {
                    lastNotify = Date.now();
                    if (window._trimResize && window._trimResize.dotNetRef && window._trimResize.dotNetRef.invokeMethodAsync) {
                        try { window._trimResize.dotNetRef.invokeMethodAsync('OnPanelMouseMove', pendingClientXForNotify).catch(()=>{}); } catch (e) { /* ignore */ }
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

                try { splitEl && splitEl.offsetHeight; } catch (e) { /* ignore */ }
                try { if (window._trimResize && window._trimResize.updateAllTrimOverlays) window._trimResize.updateAllTrimOverlays(); } catch (e) { /* ignore */ }

                window._trimResize.lastAppliedLeft = left;
                window._trimResize.lastAvail = avail;
            } catch (e) {
                console.error('applyWidthsUsingAvail error', e);
            }
        }

        const onPointerDown = function (e) {
            try {
                try { window._trimResize.suspendFitZoom = true; } catch (ex) { /* ignore */ }
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
                            try { window._trimResize.dotNetRef.invokeMethodAsync('OnPanelMouseMove', pendingClientXForNotify).catch(()=>{}); } catch (e) { /* ignore */ }
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
                            try { window._trimResize.dotNetRef.invokeMethodAsync('CommitPanelWidth', finalLeftWidth).catch(()=>{}); } catch (e) { /* ignore */ }
                        }

                        applyWidthsUsingAvail(finalLeftWidth);

                        requestAnimationFrame(function () {
                            if (window._trimResize && window._trimResize.updateAllTrimOverlays) window._trimResize.updateAllTrimOverlays();
                        });
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
            try {
                handle.removeEventListener('pointerdown', onPointerDown);
            } catch (e) { /* ignore */ }
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
    console.log('Setting preview zoom:', zoom, 'Mode:', mode);
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

        // フォールバック: canvas が見つからなければ inner の実測幅を使用（縮尺で逆除算）
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
// ...existing code...

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
            try {
                // preserve selection flag onto base element so reattach can restore it
                try {
                    if (entry.base && entry.base.dataset) {
                        entry.base.dataset.trimSelected = entry.selected ? '1' : '0';
                    }
                } catch (e) { /* ignore */ }

                if (entry.base && entry.handlers && entry.handlers.pointerDown) entry.base.removeEventListener('pointerdown', entry.handlers.pointerDown);
            } catch (e) { }
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

            // keydown listener cleanup (for Delete)
            try { if (entry.internal && entry.internal.keydown) document.removeEventListener('keydown', entry.internal.keydown); } catch (e) { }

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

    // ...existing code...
    window.attachTrimListeners = function (canvasId, dotNetRef) {
        try {
            if (!canvasId) return false;
            const base = document.getElementById(canvasId);
            if (!base) {
                console.warn(`trim attach: canvas not found: ${canvasId}`);
                return false;
            }

            // restore selection hint from dataset if present (will be consumed below into state)
            const preservedSelected = (() => {
                try {
                    if (base.dataset && base.dataset.trimSelected) {
                        const v = base.dataset.trimSelected;
                        delete base.dataset.trimSelected;
                        return v === '1';
                    }
                } catch (e) { }
                return false;
            })();

            try { cleanupTrimEntry(canvasId); } catch (e) { /* ignore */ }

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
                active: false, mode: null,              // mode: null | 'maybe-draw' | 'draw' | 'move' | 'resize'
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
                didDrag: false // track whether a drag/move actually occurred during this interaction
            };

            state.internal = state.internal || {};
            state.internal.lastAttachedAt = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
            if (preservedSelected) state.selected = true;

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

                    // maybe-draw: only start drawing after small movement threshold
                    if (state.mode === 'maybe-draw') {
                        const dx = loc.x - state.startClientLocal.x;
                        const dy = loc.y - state.startClientLocal.y;
                        const distSq = dx * dx + dy * dy;
                        const THRESHOLD_PX = 8; // squared threshold uses 8px
                        if (distSq >= THRESHOLD_PX * THRESHOLD_PX) {
                            // convert to actual draw
                            state.mode = 'draw';
                            state.currentRectPx = { x: state.startClientLocal.x, y: state.startClientLocal.y, w: 0, h: 0 };
                        } else {
                            // not yet moved enough -> do nothing (do not clear existing overlay)
                            return;
                        }
                    }

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

                        if (!state.didDrag && prevRect && (prevRect.x !== state.currentRectPx.x || prevRect.y !== state.currentRectPx.y || prevRect.w !== state.currentRectPx.w || prevRect.h !== state.currentRectPx.h)) {
                            state.didDrag = true;
                        }

                    } else if (state.mode === 'move' && state.startRectPx) {
                        const dx = loc.x - state.startClientLocal.x;
                        const dy = loc.y - state.startClientLocal.y;

                        const cssWVal = cssW;
                        const cssHVal = cssH;

                        let nx = state.startRectPx.x + dx;
                        let ny = state.startRectPx.y + dy;

                        nx = Math.max(0, Math.min(cssWVal - state.startRectPx.w, nx));
                        ny = Math.max(0, Math.min(cssHVal - state.startRectPx.h, ny));

                        state.currentRectPx = { x: Math.round(nx), y: Math.round(ny), w: Math.round(state.startRectPx.w), h: Math.round(state.startRectPx.h) };

                        state.didDrag = true;
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

                        state.didDrag = true;
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
                    state.didDrag = false;

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
                        const entry = window._simpleTrim && window._simpleTrim[canvasId];

                        if (handleAttr !== null) {
                            const idx = Number(handleAttr);
                            state.resizeHandle = (Number.isFinite(idx) && idx >= 0 && idx < HANDLE_KEY_MAP.length) ? HANDLE_KEY_MAP[idx] : null;
                            state.mode = 'resize';
                            try {
                                const cur = (entry && entry.currentRectPx) || null;
                                state.startRectPx = cur ? { ...cur } : { x: state.startClientLocal.x, y: state.startClientLocal.y, w: 0, h: 0 };
                            } catch (e) { state.startRectPx = { x: state.startClientLocal.x, y: state.startClientLocal.y, w: 0, h: 0 }; }

                        } else if (rectAttr !== null) {
                            state.mode = 'move';
                            try {
                                const cur = (window._simpleTrim && window._simpleTrim[canvasId] && window._simpleTrim[canvasId].currentRectPx) || null;
                                state.startRectPx = cur ? { ...cur } : { x: state.startClientLocal.x, y: state.startClientLocal.y, w: 0, h: 0 };
                                try { if (window._simpleTrim && window._simpleTrim[canvasId]) window._simpleTrim[canvasId].selected = true; } catch (e) { }
                                try { if (state.currentRectPx && state.overlayDom && window.drawTrimOverlayAsSvg) window.drawTrimOverlayAsSvg(canvasId, [rectPxToNormalized(state.currentRectPx)]); } catch (e) { }
                            } catch (e) { state.startRectPx = { x: state.startClientLocal.x, y: state.startClientLocal.y, w: 0, h: 0 }; }
                        } else {
                            // clicked outside overlay rect -> do NOT immediately clear or overwrite currentRectPx
                            // mark as deselected but allow starting a new draw only after a small drag (maybe-draw)
                            state.mode = 'maybe-draw';
                            try {
                                const entry = window._simpleTrim && window._simpleTrim[canvasId];
                                if (entry) {
                                    entry.selected = false;
                                    // 即時に再描画して「選択解除」を反映（矩形自体は残す）
                                    try {
                                        if (entry.currentRectPx && window.drawTrimOverlayAsSvg) {
                                            const norm = rectPxToNormalized(entry.currentRectPx);
                                            window.drawTrimOverlayAsSvg(canvasId, [norm]);
                                        } else if (window.drawTrimOverlayAsSvg) {
                                            // 現在の内部矩形がない場合は空配列でクリア（従来挙動）
                                            window.drawTrimOverlayAsSvg(canvasId, []);
                                        }
                                    } catch (e) { /* ignore per-entry redraw errors */ }
                                }
                            } catch (e) { /* ignore */ }
                        }
                    } else {
                        // no overlay DOM -> treat as maybe-draw (preserve existing overlay)
                        state.mode = 'maybe-draw';
                        try {
                            const entry = window._simpleTrim && window._simpleTrim[canvasId];
                            if (entry) {
                                entry.selected = false;
                                // 即時に再描画して「選択解除」を反映（矩形自体は残す）
                                try {
                                    if (entry.currentRectPx && window.drawTrimOverlayAsSvg) {
                                        const norm = rectPxToNormalized(entry.currentRectPx);
                                        window.drawTrimOverlayAsSvg(canvasId, [norm]);
                                    } else if (window.drawTrimOverlayAsSvg) {
                                        // 現在の内部矩形がない場合は空配列でクリア（従来挙動）
                                        window.drawTrimOverlayAsSvg(canvasId, []);
                                    }
                                } catch (e) { /* ignore per-entry redraw errors */ }
                            }
                        } catch (e) { /* ignore */ }
                    }

                    try {
                        if (state.overlayDom && state.resizeHandle) {
                            const cur = HANDLE_CURSOR_MAP[state.resizeHandle] || '';
                            state.overlayDom.style.cursor = cur;
                        } else if (state.overlayDom && state.mode === 'draw') {
                            state.overlayDom.style.cursor = 'crosshair';
                        } else if (state.overlayDom && state.mode === 'move') {
                            state.overlayDom.style.cursor = 'move';
                        } else if (state.overlayDom && state.mode === 'maybe-draw') {
                            state.overlayDom.style.cursor = ''; // keep default until movement
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

                        // If user never moved enough to start drawing (maybe-draw), do not clear or overwrite currentRectPx.
                        if (state.mode === 'maybe-draw') {
                            // simply reset mode and leave overlay/currentRectPx as-is (selection already cleared on pointerdown)
                            state.mode = null;
                            state.didDrag = false;
                            try { window.removeEventListener('pointermove', state.handlers.move, { passive: false }); } catch (e) { }
                            try { window.removeEventListener('pointerup', state.handlers.up, { passive: false }); } catch (e) { }
                            return;
                        }

                        const raw = state.currentRectPx || { x: 0, y: 0, w: 0, h: 0 };
                        if (raw.w > 0 && raw.h > 0) {
                            const norm = rectPxToNormalized(raw);
                            try { if (window._simpleTrim && window._simpleTrim[canvasId]) window._simpleTrim[canvasId].lastRawRect = raw; } catch (e) { }
                            if (state.dotNetRef && state.dotNetRef.invokeMethodAsync) {
                                try { state.dotNetRef.invokeMethodAsync('CommitTrimRectFromJs', norm.X, norm.Y, norm.Width, norm.Height); } catch (e) { /* ignore */ }
                            }
                            // clear selection only if an actual drag/resize/move occurred
                            try {
                                const entry = window._simpleTrim && window._simpleTrim[canvasId];
                                if (entry && state.didDrag) {
                                    entry.selected = false;
                                    if (entry.overlayDom && window.drawTrimOverlayAsSvg) {
                                        try { window.drawTrimOverlayAsSvg(canvasId, [rectPxToNormalized(raw)]); } catch (e) { }
                                    }
                                }
                            } catch (e) { /* ignore */ }
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
                            // update overlay size/position
                            if (typeof updateOverlaySize === 'function') updateOverlaySize();
                        } catch (e) { /* ignore */ }
                    });
                } catch (e) { /* ignore */ }
            }

            try {
                state.internal.hostScroll = onAnyScrollOrResize; state.host.addEventListener('scroll', state.internal.hostScroll, { passive: true });
            } catch (e) { }
            try {
                const container = document.getElementById('trim-preview-container') || state.host.closest('.preview-zoom-viewport');
                if (container) { state.internal.containerScroll = onAnyScrollOrResize; container.addEventListener('scroll', state.internal.containerScroll, { passive: true }); }
            } catch (e) { }
            try {
                state.internal.windowScroll = onAnyScrollOrResize;
                state.internal.resize = onAnyScrollOrResize;
                ensureSharedTrimResizeHandler();
            } catch (e) { }

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

        // previewScale: 現在のプレビュー縮尺（デフォルト1）
        const previewScale = (window._previewZoomState && window._previewZoomState.lastZoom) ? window._previewZoomState.lastZoom : 1;

        // relLeft/Top は getBoundingClientRect がスケール済みの値を返すため
        // オーバーレイを host 内で正しく配置するには縮尺で逆除算する
        const relLeft = Math.round((baseRect.left - hostRect.left) / previewScale);
        const relTop = Math.round((baseRect.top - hostRect.top) / previewScale);

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
            // viewBox を設定して内部座標を論理ピクセルに合わせる
            svg.setAttribute('viewBox', `0 0 ${cssW} ${cssH}`);
            svg.setAttribute('preserveAspectRatio', 'none');
            svg.style.pointerEvents = 'none';
            container.appendChild(svg);
        }

        while (svg.firstChild) svg.removeChild(svg.firstChild);

        window._simpleTrim = window._simpleTrim || {};
        if (!window._simpleTrim[canvasId]) window._simpleTrim[canvasId] = {};
        const entry = window._simpleTrim[canvasId];

        // if no rects -> clear overlay but keep entry.overlayDom reference
        if (!Array.isArray(rects) || rects.length === 0) {
            entry.overlayDom = container;
            entry.currentRectPx = null;
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

        // logical (非スケール) 座標に基づく矩形
        const rx = Math.round(nx * cssW);
        const ry = Math.round(ny * cssH);
        const rw = Math.round(nw * cssW);
        const rh = Math.round(nh * cssH);

        // background group
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

        // rectangle visual
        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', String(rx));
        rect.setAttribute('y', String(ry));
        rect.setAttribute('width', String(Math.max(0, rw)));
        rect.setAttribute('height', String(Math.max(0, rh)));
        rect.setAttribute('fill', 'rgba(59,130,246,0.12)');

        // selected visual
        const isSelected = !!(entry && entry.selected);
        rect.setAttribute('stroke', isSelected ? 'rgba(37,99,235,1)' : 'rgba(59,130,246,0.95)');
        rect.setAttribute('stroke-width', isSelected ? '3' : '2');
        rect.style.pointerEvents = 'auto';
        rect.style.cursor = 'move';
        rect.setAttribute('data-rect', 'true');
        g.appendChild(rect);

        // handles (unchanged)
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

        // close/delete button when selected
        if (isSelected) {
            let cx = rx + rw + 10;
            let cy = ry - 10;
            cx = Math.min(cssW - 12, Math.max(12, cx));
            cy = Math.min(cssH - 12, Math.max(12, cy));
            const btnG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            btnG.setAttribute('transform', `translate(0,0)`);
            btnG.style.pointerEvents = 'auto';

            const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            circle.setAttribute('cx', String(cx));
            circle.setAttribute('cy', String(cy));
            circle.setAttribute('r', '10');
            circle.setAttribute('fill', 'rgba(0,0,0,0.6)');
            circle.setAttribute('data-close', 'true');
            circle.style.cursor = 'pointer';
            btnG.appendChild(circle);

            const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            txt.setAttribute('x', String(cx));
            txt.setAttribute('y', String(cy + 4));
            txt.setAttribute('fill', '#fff');
            txt.setAttribute('font-size', '12');
            txt.setAttribute('text-anchor', 'middle');
            txt.setAttribute('data-close', 'true');
            txt.style.pointerEvents = 'none';
            txt.textContent = '×';
            btnG.appendChild(txt);

            // click handler: clear overlay + notify .NET to remove saved rect
            btnG.addEventListener('pointerdown', function (ev) {
                try {
                    ev.stopPropagation();
                    if (entry) {
                        entry.selected = false;
                        entry.currentRectPx = null;
                        if (entry.dotNetRef && entry.dotNetRef.invokeMethodAsync) {
                            try { entry.dotNetRef.invokeMethodAsync('ClearTrimRectFromJs'); } catch (e) { }
                        }
                        window.drawTrimOverlayAsSvg(canvasId, []);
                    }
                } catch (e) { }
            }, { passive: false });

            g.appendChild(btnG);
        }

        svg.appendChild(g);

        // synchronize overlay into internal state (do not overwrite during active drag)
        try {
            const rxFloat = nx * cssW;
            const ryFloat = ny * cssH;
            const rwFloat = nw * cssW;
            const rhFloat = nh * cssH;

            entry.overlayDom = container;

            if (!entry.active) {
                entry.currentRectPx = { x: rxFloat, y: ryFloat, w: rwFloat, h: rhFloat };
            }
        } catch (e) {
            console.error('drawTrimOverlayAsSvg sync error', e);
        }

        // ensure keydown handler to delete when selected
        try {
            // attach once and store ref for cleanup
            if (!entry.internal) entry.internal = {};
            if (!entry.internal.keydown) {
                entry.internal.keydown = function (ev) {
                    try {
                        if (ev.key === 'Delete' || ev.key === 'Del') {
                            if (entry && entry.selected) {
                                // clear and notify .NET
                                entry.selected = false;
                                entry.currentRectPx = null;
                                if (entry.dotNetRef && entry.dotNetRef.invokeMethodAsync) {
                                    try { entry.dotNetRef.invokeMethodAsync('ClearTrimRectFromJs'); } catch (e) { }
                                }
                                window.drawTrimOverlayAsSvg(canvasId, []);
                            }
                        }
                    } catch (e) { }
                };
                document.addEventListener('keydown', entry.internal.keydown);
            }
        } catch (e) { }

        // hook overlay events to forward into attachTrimListeners handlers (if present)
        try {
            const entry2 = window._simpleTrim[canvasId];
            if (entry2 && !container.__trimHooked) {
                if (entry2.handlers && entry2.handlers.pointerDown) {
                    container.addEventListener('pointerdown', function (ev) { try { entry2.handlers.pointerDown(ev); } catch (e) { } }, { passive: false, capture: true });
                    container.addEventListener('touchstart', function (ev) { try { entry2.handlers.touchStart && entry2.handlers.touchStart(ev); } catch (e) { } }, { passive: false, capture: true });
                }
                if (entry2.handlers && entry2.handlers.overlayMove) {
                    container.addEventListener('pointermove', function (ev) { try { entry2.handlers.overlayMove(ev); } catch (e) { } }, { passive: true, capture: true });
                    container.addEventListener('pointerover', function (ev) { try { entry2.handlers.overlayOver && entry2.handlers.overlayOver(ev); } catch (e) { } }, { passive: true, capture: true });
                    container.addEventListener('pointerout', function (ev) { try { entry2.handlers.overlayOut && entry2.handlers.overlayOut(ev); } catch (e) { } }, { passive: true, capture: true });
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

window._visiblePageObserver = window._visiblePageObserver || {};

window.registerVisiblePageObserver = function (dotNetRef, containerId, debounceMs = 1000) {
    try {
        // cleanup existing if any
        try { window.unregisterVisiblePageObserver(containerId); } catch (e) { }

        const container = document.getElementById(containerId);
        if (!container) return;

        const items = Array.from(container.querySelectorAll('[id^="preview-container-"]'));
        if (!items || items.length === 0) return;

        // store state object
        const state = { pendingBest: -1, timer: null, lastIdx: -1, debounceMs: Number(debounceMs) || 500 };

        // callback: pick item with largest intersectionRatio
        const cb = function (entries) {
            try {
                let bestIdx = -1;
                let bestRatio = 0;
                entries.forEach(en => {
                    const ratio = en.intersectionRatio || 0;
                    const id = en.target && en.target.id;
                    if (!id) return;
                    const parts = id.split('-');
                    const idx = Number(parts[parts.length - 1]);
                    if (!Number.isFinite(idx)) return;
                    if (ratio > bestRatio) {
                        bestRatio = ratio;
                        bestIdx = idx;
                    }
                });
                if (bestIdx >= 0) {
                    // schedule debounced notify (coalesce rapid changes)
                    try {
                        // if same as last reported, do nothing
                        if (state.lastIdx === bestIdx) {
                            // still update pendingBest so timer resets only when changed
                            return;
                        }
                        state.pendingBest = bestIdx;
                        if (state.timer) clearTimeout(state.timer);
                        state.timer = setTimeout(() => {
                            try {
                                if (state.lastIdx !== state.pendingBest) {
                                    state.lastIdx = state.pendingBest;
                                    dotNetRef.invokeMethodAsync('SetVisiblePageFromJs', state.pendingBest)
                                        .catch(() => { /* ignore */ });
                                }
                            } catch (e) { /* ignore */ }
                            state.timer = null;
                        }, state.debounceMs);
                    } catch (e) { /* ignore */ }
                }
            } catch (e) { /* ignore */ }
        };

        const obs = new IntersectionObserver(cb, { root: container, threshold: [0, 0.25, 0.5, 0.75, 1] });
        items.forEach(it => obs.observe(it));

        // store observer + state for later unregister
        window._visiblePageObserver = window._visiblePageObserver || {};
        window._visiblePageObserver[containerId] = { observer: obs, items: items, dotNetRef: dotNetRef, state: state };
    } catch (e) {
        console.error('registerVisiblePageObserver error', e);
    }
};

window.unregisterVisiblePageObserver = function (containerId) {
    try {
        const entry = window._visiblePageObserver && window._visiblePageObserver[containerId];
        if (!entry) return;
        try { if (entry.state && entry.state.timer) clearTimeout(entry.state.timer); } catch (e) { }
        try { if (entry.observer) entry.observer.disconnect(); } catch (e) { }
        try { delete window._visiblePageObserver[containerId]; } catch (e) { }
    } catch (e) {
        console.error('unregisterVisiblePageObserver error', e);
    }
};

window.registerWindowResize = function (dotNetRef, debounceMs = 500) {
    try {
        if (!dotNetRef) return;

        try { if (window._trimResize.windowResizeCallback) window._trimResize.windowResizeCallback = null; } catch (e) { /* ignore */ }
        window._trimResize.windowResizeDotNetRef = dotNetRef;

        function measureAndNotify() {
            try {
                const vw = window.innerWidth || document.documentElement.clientWidth;
                const IS_MOBILE_HEADER_SIDEBAR = vw < 768;
                const sidebarEl = document.querySelector('.sidebar');
                const sidebarW = (sidebarEl && !IS_MOBILE_HEADER_SIDEBAR) ? Math.round(sidebarEl.getBoundingClientRect().width) : 0;
                const avail = Math.max(0, vw - sidebarW);

                // (existing apply layout/notify logic)
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
                        try { window._trimResize.windowResizeDotNetRef.invokeMethodAsync('OnWindowResizedFromJs', avail, sidebarW).catch(()=>{}); } catch (e) { /* ignore */ }
                    }

                    try { splitEl && splitEl.offsetHeight; } catch (e) { /* ignore */ }
                    try { if (window._trimResize && window._trimResize.updateAllTrimOverlays) window._trimResize.updateAllTrimOverlays(); } catch (e) { /* ignore */ }
                    try { if (typeof window.computeAndApplyFitZoom === 'function') window.computeAndApplyFitZoom(); } catch (e) { /* ignore */ }
                } catch (e) {
                    console.error('measureAndNotify inner error', e);
                }
            } catch (e) {
                console.error('measureAndNotify error', e);
            }
        }

        // expose callback to shared handler (debounce comes from shared._trimShared.debounceMs or local debounce if needed)
        window._trimResize.windowResizeCallback = measureAndNotify;

        // ensure shared handler exists and will call our callback
        if (typeof ensureSharedTrimResizeHandler === 'function') ensureSharedTrimResizeHandler();

        // run once immediately
        try { measureAndNotify(); } catch (e) { /* ignore */ }

        // provide unregister that only clears our callback (shared handler remains)
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

// apply thumbnail width (called from .NET when recomputing)
window.applyThumbnailWidth = function (leftPx) {
    try {
        const thumb = document.getElementById('thumbnail-area');
        const handle = document.getElementById('splitter-handle');
        if (!thumb) return;
        const splitterW = handle ? (handle.getBoundingClientRect().width || 8) : 8;

        // set CSS var + inline width so layout follows
        thumb.style.setProperty('--thumbnail-width', Math.round(leftPx) + 'px');
        thumb.style.width = Math.round(leftPx) + 'px';
        // Do not forcibly pin right pane here; keep its flex behavior unless it already has inline width.
        // This function only runs on window resize (per spec), so we avoid breaking zoom behavior.
        return true;
    } catch (e) {
        console.error('applyThumbnailWidth error', e);
        return false;
    }
};

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

window._trimShared = window._trimShared || { resizeHandler: null, timer: null, debounceMs: 120 };
function ensureSharedTrimResizeHandler() {
    try {
        if (window._trimShared && window._trimShared.resizeHandler) return;
        const handler = function () {
            try {
                if (window._trimShared.timer) clearTimeout(window._trimShared.timer);
                window._trimShared.timer = setTimeout(() => {
                    try {
                        // call per-entry callbacks
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

                        // call optional global callback (e.g. registerWindowResize's measureAndNotify)
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