window.waitForCanvasReady = async function (canvasId, timeoutMs = 120) {
    try {
        if (!canvasId) return false;
        const start = performance.now();
        const el = document.getElementById(canvasId);
        if (!el) return false;

        const w0 = el.clientWidth, h0 = el.clientHeight;
        if (w0 > 0 && h0 > 0) {
            await new Promise(r => requestAnimationFrame(r));
            const w1 = el.clientWidth, h1 = el.clientHeight;
            if (w0 === w1 && h0 === h1) return true;
        }

        while (performance.now() - start < (timeoutMs || 120)) {
            await new Promise(r => requestAnimationFrame(r));
            const w = el.clientWidth, h = el.clientHeight;
            if (w > 0 && h > 0) {

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

        function getOffsetRelativeTo(element, ancestor) {
            let x = 0, y = 0;
            let el = element;
            while (el && el !== ancestor && el !== document.body) {
                x += el.offsetLeft || 0;
                y += el.offsetTop || 0;
                el = el.offsetParent;
            }
            return { x, y };
        }

        const off = getOffsetRelativeTo(base, host);
        const relLeft = Math.round(off.x);
        const relTop = Math.round(off.y);

        const cssW = Math.max(1, Math.round(base.clientWidth || baseRect.width || 0));
        const cssH = Math.max(1, Math.round(base.clientHeight || baseRect.height || 0));

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

        const isSelected = !!(entry && entry.selected);
        rect.setAttribute('stroke', isSelected ? 'rgba(37,99,235,1)' : 'rgba(59,130,246,0.95)');
        rect.setAttribute('stroke-width', isSelected ? '3' : '2');
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

        try {

            if (!entry.internal) entry.internal = {};
            if (!entry.internal.keydown) {
                entry.internal.keydown = function (ev) {
                    try {
                        if (ev.key === 'Delete' || ev.key === 'Del') {
                            if (entry && entry.selected) {

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

        try {
            const entry2 = window._simpleTrim[canvasId];
            if (entry2 && !container.__trimHooked) {
                entry2.internal = entry2.internal || {};
                if (!entry2.internal.overlayPointerDown) {
                    entry2.internal.overlayPointerDown = function (ev) { try { entry2.handlers.pointerDown(ev); } catch (e) { } };
                    container.addEventListener('pointerdown', entry2.internal.overlayPointerDown, { passive: false, capture: true });
                    container.addEventListener('touchstart', entry2.internal.overlayPointerDown, { passive: false, capture: true });
                }
                if (!entry2.internal.overlayMove) {
                    entry2.internal.overlayMove = function (ev) { try { entry2.handlers.overlayMove(ev); } catch (e) { } };
                    container.addEventListener('pointermove', entry2.internal.overlayMove, { passive: true, capture: true });
                }
                if (!entry2.internal.overlayOver) {
                    entry2.internal.overlayOver = function (ev) { try { entry2.handlers.overlayOver && entry2.handlers.overlayOver(ev); } catch (e) { } };
                    container.addEventListener('pointerover', entry2.internal.overlayOver, { passive: true, capture: true });
                }
                if (!entry2.internal.overlayOut) {
                    entry2.internal.overlayOut = function (ev) { try { entry2.handlers.overlayOut && entry2.handlers.overlayOut(ev); } catch (e) { } };
                    container.addEventListener('pointerout', entry2.internal.overlayOut, { passive: true, capture: true });
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

(function () {
    window._simpleTrim = window._simpleTrim || {};

    function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

    function cleanupTrimEntry(canvasId) {

        const safe = {
            removeListener(el, ev, fn, opts) {
                try { if (el && fn) el.removeEventListener(ev, fn, opts); } catch (e) { /* ignore */ }
            },
            removeWindowListener(ev, fn, opts) {
                try { if (fn) window.removeEventListener(ev, fn, opts); } catch (e) { /* ignore */ }
            },
            removeDocumentListener(ev, fn, opts) {
                try { if (fn) document.removeEventListener(ev, fn, opts); } catch (e) { /* ignore */ }
            },
            removeElement(el) {
                try {
                    if (!el) return;
                    try { if (el.style) el.style.pointerEvents = 'none'; } catch (e) { }
                    try { if (typeof el.remove === 'function') el.remove(); } catch (e) { }

                    try { if (el.width !== undefined) { el.width = 0; el.height = 0; } } catch (e) { }
                } catch (e) { /* ignore */ }
            }
        };

        try {
            const entry = window._simpleTrim && window._simpleTrim[canvasId];
            if (!entry) return;

            safe.removeListener(entry.base, 'pointerdown', entry.handlers?.pointerDown, { passive: false });
            safe.removeListener(entry.base, 'touchstart', entry.handlers?.touchStart, { passive: false });

            safe.removeWindowListener('pointermove', entry.handlers?.move, { passive: false });
            safe.removeWindowListener('pointerup', entry.handlers?.up, { passive: false });

            safe.removeElement(entry.overlay || document.getElementById(canvasId + '-overlay'));

            const od = entry.overlayDom || document.getElementById(canvasId + '-overlay-svg');
            if (od) {
                safe.removeListener(od, 'pointerdown', entry.internal?.overlayPointerDown, true);
                safe.removeListener(od, 'touchstart', entry.internal?.overlayPointerDown, true);
                safe.removeListener(od, 'pointermove', entry.internal?.overlayMove, true);
                safe.removeListener(od, 'pointerover', entry.internal?.overlayOver, true);
                safe.removeListener(od, 'pointerout', entry.internal?.overlayOut, true);
                safe.removeElement(od);
            }

            safe.removeDocumentListener('keydown', entry.internal?.keydown);

            safe.removeListener(entry.host, 'scroll', entry.internal?.hostScroll, { passive: true });
            if (entry.internal && entry.internal.container) {
                safe.removeListener(entry.internal.container, 'scroll', entry.internal?.containerScroll, { passive: true });
            }

            try {
                if (entry.handlers) {
                    entry.handlers.pointerDown = null;
                    entry.handlers.touchStart = null;
                    entry.handlers.move = null;
                    entry.handlers.up = null;
                }
                if (entry.internal) {
                    entry.internal.overlayPointerDown = null;
                    entry.internal.overlayMove = null;
                    entry.internal.overlayOver = null;
                    entry.internal.overlayOut = null;
                    entry.internal.keydown = null;
                    entry.internal.hostScroll = null;
                    entry.internal.containerScroll = null;
                    entry.internal.windowScroll = null;
                    entry.internal.resize = null;
                }
            } catch (e) { /* ignore */ }

            try { delete window._simpleTrim[canvasId]; } catch (e) { /* ignore */ }
        } catch (e) {
            console.error('cleanupTrimEntry error', e);
        }
    }

    window.attachTrimListeners = function (canvasId, dotNetRef, selectionMode = 'single') {
        try {
            if (!canvasId) return false;
            const base = document.getElementById(canvasId);
            if (!base) {
                console.warn(`trim attach: canvas not found: ${canvasId}`);
                return false;
            }

            let preservedSelected = false;
            try {
                window._simpleTrim = window._simpleTrim || {};
                const existing = window._simpleTrim[canvasId];
                if (existing && existing.selected) {
                    preservedSelected = true;
                }
            } catch (e) { /* ignore */ }

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
                selectionMode: (selectionMode === 'multi') ? 'multi' : 'single',
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
                didDrag: false
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
                try {
                    // logical (unscaled) size
                    const logicalW = (state.logicalWAtDown && state.active) ? state.logicalWAtDown : Math.max(1, Math.round(state.base.clientWidth || state.base.getBoundingClientRect().width || 1));
                    const logicalH = (state.logicalHAtDown && state.active) ? state.logicalHAtDown : Math.max(1, Math.round(state.base.clientHeight || state.base.getBoundingClientRect().height || 1));

                    // preview scale: prefer explicit previewZoom state, otherwise fallback to bounding rect ratio
                    const bRect = state.base.getBoundingClientRect();
                    const scaleFromRects = (bRect.width && logicalW) ? (bRect.width / logicalW) : 1;
                    const previewScale = (window._previewZoomState && window._previewZoomState.lastZoom) ? window._previewZoomState.lastZoom : scaleFromRects;
                    const scale = previewScale || 1;

                    // compute base offset relative to host (unscaled logical px)
                    function getOffsetRelativeTo(element, ancestor) {
                        let x = 0, y = 0;
                        let el = element;
                        while (el && el !== ancestor && el !== document.body) {
                            x += el.offsetLeft || 0;
                            y += el.offsetTop || 0;
                            el = el.offsetParent;
                        }
                        return { x, y };
                    }

                    const rel = getOffsetRelativeTo(state.base, state.host);
                    const hostRect = state.host.getBoundingClientRect();

                    // left/top of base in viewport coordinates (scaled)
                    const baseLeftInViewport = hostRect.left + rel.x * scale;
                    const baseTopInViewport = hostRect.top + rel.y * scale;

                    const xInScaled = clientX - baseLeftInViewport;
                    const yInScaled = clientY - baseTopInViewport;
                    const localX = xInScaled / scale;
                    const localY = yInScaled / scale;

                    return { x: localX, y: localY, cssW: logicalW, cssH: logicalH };
                } catch (e) {
                    // fallback to previous behavior on any error
                    const b = state.base.getBoundingClientRect();
                    const logicalW = Math.max(1, Math.round(state.base.clientWidth || b.width || 1));
                    const logicalH = Math.max(1, Math.round(state.base.clientHeight || b.height || 1));
                    const scale = (window._previewZoomState && window._previewZoomState.lastZoom) ? window._previewZoomState.lastZoom : 1;
                    return { x: (clientX - b.left) / scale, y: (clientY - b.top) / scale, cssW: logicalW, cssH: logicalH };
                }
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

                    if (state.mode === 'maybe-draw') {
                        const dx = loc.x - state.startClientLocal.x;
                        const dy = loc.y - state.startClientLocal.y;
                        const distSq = dx * dx + dy * dy;
                        const THRESHOLD_PX = 8; // squared threshold uses 8px
                        if (distSq >= THRESHOLD_PX * THRESHOLD_PX) {

                            state.mode = 'draw';
                            state.currentRectPx = { x: state.startClientLocal.x, y: state.startClientLocal.y, w: 0, h: 0 };
                        } else {

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
                                try {
                                    if (window._simpleTrim && window._simpleTrim[canvasId]) {
                                        // determine effective mode: per-entry selectionMode overrides global
                                        const mode = (window._simpleTrim[canvasId].selectionMode)
                                            || (window._simpleTrimSettings && window._simpleTrimSettings.selectionMode)
                                            || 'single';
                                        if (mode === 'single') {
                                            // clear other entries' selection (and redraw them)
                                            Object.keys(window._simpleTrim).forEach(k => {
                                                if (k === canvasId) return;
                                                try {
                                                    const other = window._simpleTrim[k];
                                                    if (other && other.selected) {
                                                        other.selected = false;
                                                    }
                                                } catch (ign) { /* ignore */ }
                                            });
                                        }
                                        window._simpleTrim[canvasId].selected = true;
                                    }
                                } catch (e) { }
                                try {
                                    if (state.currentRectPx && state.overlayDom && window.drawTrimOverlayAsSvg) window.drawTrimOverlayAsSvg(canvasId, [rectPxToNormalized(state.currentRectPx)]);
                                } catch (e) { }
                            } catch (e) {
                                state.startRectPx = { x: state.startClientLocal.x, y: state.startClientLocal.y, w: 0, h: 0 };
                            }
                        } else {

                            state.mode = 'maybe-draw';
                            try {
                                const entry = window._simpleTrim && window._simpleTrim[canvasId];
                                if (entry) {
                                    entry.selected = false;

                                    try {
                                        if (entry.currentRectPx && window.drawTrimOverlayAsSvg) {
                                            const norm = rectPxToNormalized(entry.currentRectPx);
                                            window.drawTrimOverlayAsSvg(canvasId, [norm]);
                                        } else if (window.drawTrimOverlayAsSvg) {

                                            window.drawTrimOverlayAsSvg(canvasId, []);
                                        }
                                    } catch (e) { /* ignore per-entry redraw errors */ }
                                }
                            } catch (e) { /* ignore */ }
                        }
                    } else {

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

                        if (state.mode === 'maybe-draw') {

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

            try {
                if (state.base && state.base.style) state.base.style.cursor = 'crosshair';
                if (state.overlayDom && state.overlayDom.style) state.overlayDom.style.cursor = 'crosshair';
            } catch (e) { /* ignore */ }

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

                try { cleanupTrimEntry(canvasId); } catch (e) { }
                return false;
            }

            cleanupTrimEntry(canvasId);
            return true;
        } catch (e) { console.error('detachTrimListeners error', e); return false; }
    };
})();


window.drawImageToCanvasForPreview = function (canvasId, imageUrl, useDevicePixelRatio = true) {
    // Promise を返すようにして、描画・レイアウト安定を待てるようにする
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
