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




// ...existing code...

// ...existing code...
// ...existing code...
// ...existing code...
(function(){
    // attachTrimListeners/detachTrimListeners - overlay as sibling of canvas.parentElement so it scrolls/ scales with canvas
    window._simpleTrim = window._simpleTrim || {};

    window.attachTrimListeners = function(canvasId, dotNetRef) {
        try {
            if (!canvasId) return false;
            const base = document.getElementById(canvasId);
            if (!base) {
                console.warn('attachTrimListeners: canvas not found', canvasId);
                return false;
            }

            // already attached
            if (window._simpleTrim[canvasId]) return true;

            // parent element to host overlay — must be ancestor that moves/ scales with canvas
            const host = base.parentElement || base.closest('.tp-preview-page') || base.closest('.preview-zoom-inner') || document.body;
            if (!host) return false;
            // ensure host is a positioned container
            try { if (getComputedStyle(host).position === 'static') host.style.position = 'relative'; } catch(e){}

            // create overlay canvas as child of host so it scrolls/scales with canvas
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
                base,
                host,
                overlay,
                dotNetRef,
                active: false,
                pointerId: null,
                startClientX: 0,
                startClientY: 0,
                lastMoveEv: null,
                pendingMove: false,
                handlers: {},
                internal: {}
            };
            window._simpleTrim[canvasId] = state;
            const dpr = window.devicePixelRatio || 1;

            function updateOverlaySize() {
                try {
                    const baseRect = state.base.getBoundingClientRect();
                    const hostRect = state.host.getBoundingClientRect();

                    // compute position of canvas relative to host
                    const relLeft = Math.round(baseRect.left - hostRect.left);
                    const relTop  = Math.round(baseRect.top  - hostRect.top);
                    const cssW = Math.max(1, Math.round(baseRect.width || state.base.clientWidth || 0));
                    const cssH = Math.max(1, Math.round(baseRect.height || state.base.clientHeight || 0));

                    state.overlay.style.left = relLeft + 'px';
                    state.overlay.style.top  = relTop + 'px';
                    state.overlay.style.width = cssW + 'px';
                    state.overlay.style.height = cssH + 'px';
                    state.overlay.width  = Math.min(16384, Math.round(cssW * dpr));
                    state.overlay.height = Math.min(16384, Math.round(cssH * dpr));
                } catch (e) {
                    // ignore
                }
            }

            // throttled scroll/resize handler
            let scrollPending = false;
            function onAnyScrollOrResize() {
                if (scrollPending) return;
                scrollPending = true;
                requestAnimationFrame(() => { scrollPending = false; updateOverlaySize(); });
            }

            function clearOverlay() {
                try {
                    const ctx = state.overlay.getContext('2d');
                    if (ctx) { ctx.setTransform(1,0,0,1,0,0); ctx.clearRect(0,0,state.overlay.width,state.overlay.height); }
                } catch(e){}
            }

            function drawRect(normRect) {
                try {
                    updateOverlaySize();
                    const ov = state.overlay;
                    const ctx = ov.getContext('2d');
                    if (!ctx) return;
                    ctx.setTransform(1,0,0,1,0,0);
                    ctx.clearRect(0,0,ov.width,ov.height);
                    ctx.scale(dpr, dpr);

                    const cssW = Math.max(1, Math.round(state.base.getBoundingClientRect().width || state.base.clientWidth || 0));
                    const cssH = Math.max(1, Math.round(state.base.getBoundingClientRect().height || state.base.clientHeight || 0));

                    if (!normRect) return;
                    const nx = Number(normRect.X)||0;
                    const ny = Number(normRect.Y)||0;
                    const nw = Number(normRect.Width)||0;
                    const nh = Number(normRect.Height)||0;

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

                    const handleSize = 8;
                    ctx.fillStyle = strokeColor;
                    const half = Math.round(handleSize/2);
                    const corners = [
                        [rx-half, ry-half],
                        [rx+rw-half, ry-half],
                        [rx-half, ry+rh-half],
                        [rx+rw-half, ry+rh-half]
                    ];
                    corners.forEach(c => ctx.fillRect(c[0], c[1], handleSize, handleSize));
                } catch(e){
                    console.error('drawRect error', e);
                }
            }

            function toNormalized(clientX, clientY) {
                const b = state.base.getBoundingClientRect();
                const cssW = Math.max(1, b.width || state.base.clientWidth || 0);
                const cssH = Math.max(1, b.height || state.base.clientHeight || 0);
                const localX = clientX - b.left;
                const localY = clientY - b.top;
                const nx = Math.max(0, Math.min(1, localX / cssW));
                const ny = Math.max(0, Math.min(1, localY / cssH));
                return { nx, ny, cssW, cssH, localX, localY };
            }

            function scheduleMove(ev) {
                state.lastMoveEv = ev;
                if (state.pendingMove) return;
                state.pendingMove = true;
                requestAnimationFrame(() => {
                    state.pendingMove = false;
                    if (!state.active || !state.lastMoveEv) return;
                    const s = toNormalized(state.startClientX, state.startClientY);
                    const c = toNormalized(state.lastMoveEv.clientX, state.lastMoveEv.clientY);
                    const x = Math.min(s.nx, c.nx);
                    const y = Math.min(s.ny, c.ny);
                    const w = Math.abs(c.nx - s.nx);
                    const h = Math.abs(c.ny - s.ny);

                    // draw and log
                    try {
                        const px = Math.round(x * s.cssW);
                        const py = Math.round(y * s.cssH);
                        const pw = Math.round(w * s.cssW);
                        const ph = Math.round(h * s.cssH);
                        console.log(`[trim][${canvasId}] move normalized=${x.toFixed(4)},${y.toFixed(4)},${w.toFixed(4)},${h.toFixed(4)}  px=${px},${py},${pw},${ph}`);
                    } catch(e){}

                    drawRect({ X: x, Y: y, Width: w, Height: h });
                });
            }

            const onPointerDown = function(ev) {
                try {
                    if (ev.button !== undefined && ev.button !== 0) return;
                    state.active = true;
                    state.pointerId = ev.pointerId ?? 'mouse';
                    state.startClientX = ev.clientX;
                    state.startClientY = ev.clientY;
                    try { state.base.setPointerCapture && state.base.setPointerCapture(ev.pointerId); } catch(e){}
                    updateOverlaySize();
                    const s = toNormalized(ev.clientX, ev.clientY);
                    console.log(`[trim][${canvasId}] down client=${ev.clientX},${ev.clientY} local=${Math.round(s.localX)},${Math.round(s.localY)}`);
                    drawRect({ X: s.nx, Y: s.ny, Width: 0, Height: 0 });

                    // window handlers so up fires even if pointer leaves canvas
                    state.handlers.move = function(mEv) { scheduleMove(mEv); };
                    state.handlers.up = function(uEv) {
                        if (!state.active) return;
                        state.active = false;
                        try { state.base.releasePointerCapture && state.base.releasePointerCapture(state.pointerId); } catch(e){}
                        const s2 = toNormalized(state.startClientX, state.startClientY);
                        const c2 = toNormalized(uEv.clientX, uEv.clientY);
                        const x = Math.min(s2.nx, c2.nx);
                        const y = Math.min(s2.ny, c2.ny);
                        const w = Math.abs(c2.nx - s2.nx);
                        const h = Math.abs(c2.ny - s2.ny);

                        try {
                            const px = Math.round(x * s2.cssW);
                            const py = Math.round(y * s2.cssH);
                            const pw = Math.round(w * s2.cssW);
                            const ph = Math.round(h * s2.cssH);
                            console.log(`[trim][${canvasId}] up normalized=${x.toFixed(4)},${y.toFixed(4)},${w.toFixed(4)},${h.toFixed(4)}  px=${px},${py},${pw},${ph}`);
                        } catch(e){}

                        drawRect({ X:x, Y:y, Width:w, Height:h });

                        if (state.dotNetRef && state.dotNetRef.invokeMethodAsync) {
                            try { state.dotNetRef.invokeMethodAsync('CommitTrimRectFromJs', x, y, w, h); } catch(e){ console.warn('CommitTrimRectFromJs invoke failed', e); }
                        }

                        try {
                            window.removeEventListener('pointermove', state.handlers.move, { passive: false });
                            window.removeEventListener('pointerup', state.handlers.up, { passive: false });
                        } catch(e){}
                    };

                    window.addEventListener('pointermove', state.handlers.move, { passive: false });
                    window.addEventListener('pointerup', state.handlers.up, { passive: false });

                    ev.preventDefault?.();
                } catch(e) {
                    console.error('attachTrimListeners onPointerDown error', e);
                }
            };

            const onTouchStart = function(tEv) {
                try {
                    if (!tEv.touches || tEv.touches.length === 0) return;
                    const t = tEv.touches[0];
                    onPointerDown({ clientX: t.clientX, clientY: t.clientY, pointerId: 'touch', button: 0, preventDefault: () => tEv.preventDefault() });
                    tEv.preventDefault();
                } catch(e) {
                    console.error('attachTrimListeners onTouchStart error', e);
                }
            };

            // attach element listeners
            state.base.addEventListener('pointerdown', onPointerDown, { passive: false });
            state.base.addEventListener('touchstart', onTouchStart, { passive: false });

            // scroll/resize listeners (host, container viewport, window)
            try {
                state.internal.hostScroll = onAnyScrollOrResize;
                state.host.addEventListener('scroll', state.internal.hostScroll, { passive: true });
            } catch(e){}
            try {
                const container = document.getElementById('trim-preview-container') || state.host.closest('.preview-zoom-viewport');
                if (container) {
                    state.internal.containerScroll = onAnyScrollOrResize;
                    container.addEventListener('scroll', state.internal.containerScroll, { passive: true });
                }
            } catch(e){}
            try {
                state.internal.windowScroll = onAnyScrollOrResize;
                window.addEventListener('scroll', state.internal.windowScroll, { passive: true });
                state.internal.resize = onAnyScrollOrResize;
                window.addEventListener('resize', state.internal.resize, { passive: true });
            } catch(e){}

            // initial sizing
            updateOverlaySize();
            return true;
        } catch(e) {
            console.error('attachTrimListeners error', e);
            return false;
        }
    };

    window.detachTrimListeners = function(canvasId) {
        try {
            const entry = window._simpleTrim && window._simpleTrim[canvasId];
            if (!entry) return false;

            try {
                entry.base.removeEventListener('pointerdown', entry.handlers.pointerDown);
                entry.base.removeEventListener('touchstart', entry.handlers.touchStart);
            } catch(e){}

            try {
                if (entry.handlers && entry.handlers.move) window.removeEventListener('pointermove', entry.handlers.move, { passive: false });
                if (entry.handlers && entry.handlers.up) window.removeEventListener('pointerup', entry.handlers.up, { passive: false });
            } catch(e){}

            try {
                if (entry.internal && entry.internal.hostScroll) entry.host.removeEventListener('scroll', entry.internal.hostScroll, { passive: true });
                if (entry.internal && entry.internal.containerScroll) {
                    const container = document.getElementById('trim-preview-container') || entry.host.closest('.preview-zoom-viewport');
                    if (container) container.removeEventListener('scroll', entry.internal.containerScroll, { passive: true });
                }
                if (entry.internal && entry.internal.windowScroll) window.removeEventListener('scroll', entry.internal.windowScroll, { passive: true });
                if (entry.internal && entry.internal.resize) window.removeEventListener('resize', entry.internal.resize, { passive: true });
            } catch(e){}

            // clear overlay buffer
            try {
                const ov = entry.overlay || document.getElementById(canvasId + '-overlay');
                if (ov && ov.getContext) {
                    const ctx = ov.getContext('2d'); ctx && ctx.clearRect(0,0,ov.width,ov.height);
                }
            } catch(e){}

            // remove overlay element if desired (keep commented if you prefer reuse)
            try { if (entry.overlay && entry.overlay.parentElement) entry.overlay.parentElement.removeChild(entry.overlay); } catch(e){}

            delete window._simpleTrim[canvasId];
            return true;
        } catch(e) {
            console.error('detachTrimListeners error', e);
            return false;
        }
    };
})();