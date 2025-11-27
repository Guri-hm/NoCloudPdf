// ========================================
// グローバル状態管理: Observer と DotNetRef の保持
// ========================================
window._trimPreview = window._trimPreview || {
    previewCacheObservers: new Map(), // containerId -> { observer, dotNetRef }
    visibilityObservers: new Map()    // elementId -> { observer, dotNetRef }
};

// ========================================
// 安全な DotNet 呼び出しヘルパー
// ========================================
window._trimPreview.safeInvoke = function (dotNetRef, methodName, ...args) {
    if (!dotNetRef || typeof dotNetRef.invokeMethodAsync !== 'function') return;
    try {
        dotNetRef.invokeMethodAsync(methodName, ...args).catch(() => {});
    } catch (e) {
        // swallow
    }
};

// ========================================
// Canvas描画完了待機
// ========================================
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

// ========================================
// ヘルパー: 祖先要素を基準とした offsetLeft/Top を計算
// ========================================
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

// ========================================
// SVGオーバーレイ描画: トリム矩形の表示
// ========================================
window.drawTrimOverlayAsSvg = function (canvasId, rects) {
    try {
        if (!canvasId) return false;
        const canvas = document.getElementById(canvasId);
        if (!canvas) return false;
        const host = canvas.parentElement || canvas.closest('.tp-preview-page') || canvas.closest('.preview-zoom-inner') || document.body;
        
        window._simpleTrim = window._simpleTrim || {};
        if (!window._simpleTrim[canvasId]) window._simpleTrim[canvasId] = {};
        const trimState = window._simpleTrim[canvasId];

        const isDrawing = trimState.active && (trimState.mode === 'draw' || trimState.mode === 'move' || trimState.mode === 'resize');
        const preservedRects = (isDrawing && Array.isArray(trimState.currentRectsPx)) ? [...trimState.currentRectsPx] : [];

        function removeRectAt(index) {
            try {

                if (trimState.allowMultipleRects) {
                    if (index >= 0 && index < trimState.currentRectsPx.length) {
                        trimState.currentRectsPx.splice(index, 1);
                    }
                    trimState.selectedRectIndex = -1;

                    const cssW = Math.max(1, Math.round(canvas.clientWidth || 1));
                    const cssH = Math.max(1, Math.round(canvas.clientHeight || 1));
                    const rectsToRender = (trimState.currentRectsPx || []).map(r => ({
                        X: r.x / cssW, Y: r.y / cssH,
                        Width: r.w / cssW, Height: r.h / cssH
                    }));

                    if (window.drawTrimOverlayAsSvg) {
                        window.drawTrimOverlayAsSvg(canvasId, rectsToRender);
                    }
                    if (trimState.dotNetRef?.invokeMethodAsync) {
                        trimState.dotNetRef.invokeMethodAsync('CommitMultipleRectsFromJs', rectsToRender).catch(() => {});
                    }
                } else {
                    trimState.selected = false;
                    trimState.currentRectPx = null;
                    trimState.currentRectsPx = [];

                    if (trimState.dotNetRef?.invokeMethodAsync) {
                        trimState.dotNetRef.invokeMethodAsync('ClearTrimRectFromJs').catch(() => {});
                    }
                    if (window.drawTrimOverlayAsSvg) {
                        window.drawTrimOverlayAsSvg(canvasId, []);
                    }
                }
            } catch (e) { console.error('removeRectAt error', e); }
        }
        
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
        
        const canvasRect = canvas.getBoundingClientRect();
        const offset = getOffsetRelativeTo(canvas, host);
        const relLeft = Math.round(offset.x);
        const relTop = Math.round(offset.y);

        const cssW = Math.max(1, Math.round(canvas.clientWidth || canvasRect.width || 0));
        const cssH = Math.max(1, Math.round(canvas.clientHeight || canvasRect.height || 0));
        
        container.style.left = relLeft + 'px';
        container.style.top = relTop + 'px';
        container.style.width = cssW + 'px';
        container.style.height = cssH + 'px';
        
        let svg = container.querySelector('svg');
        if (!svg) {
            svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.setAttribute('width', '100%');
            svg.setAttribute('height', '100%');
            svg.setAttribute('viewBox', `0 0 ${cssW} ${cssH}`);
            svg.setAttribute('preserveAspectRatio', 'none');
            svg.style.pointerEvents = 'none';
            svg.style.touchAction = 'none';
            container.appendChild(svg);
        }

        while (svg.firstChild) svg.removeChild(svg.firstChild);

        if (!Array.isArray(rects) || rects.length === 0) {
            trimState.overlayDom = container;
            
            if (!isDrawing) {
                trimState.currentRectPx = null;
                trimState.currentRectsPx = [];
            } else {
                if (preservedRects.length > 0) {
                    trimState.currentRectsPx = preservedRects;
                }
            }
            
            container.style.pointerEvents = 'none';
            svg.style.pointerEvents = 'none';
            return true;
        }

        container.style.pointerEvents = 'auto';
        svg.style.pointerEvents = 'auto';
        
        rects.forEach((rect, rectIndex) => {
            const normX = Number(rect.X ?? rect.x ?? 0);
            const normY = Number(rect.Y ?? rect.y ?? 0);
            const normW = Number(rect.Width ?? rect.width ?? 0);
            const normH = Number(rect.Height ?? rect.height ?? 0);

            const rectX = Math.round(normX * cssW);
            const rectY = Math.round(normY * cssH);
            const rectW = Math.round(normW * cssW);
            const rectH = Math.round(normH * cssH);

            const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            g.setAttribute('data-rect-index', String(rectIndex));

            const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            bg.setAttribute('x', '0');
            bg.setAttribute('y', '0');
            bg.setAttribute('width', String(cssW));
            bg.setAttribute('height', String(cssH));
            bg.setAttribute('fill', 'transparent');
            bg.style.pointerEvents = 'none';
            g.appendChild(bg);

            const mainRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            mainRect.setAttribute('x', String(rectX));
            mainRect.setAttribute('y', String(rectY));
            mainRect.setAttribute('width', String(Math.max(0, rectW)));
            mainRect.setAttribute('height', String(Math.max(0, rectH)));
            mainRect.setAttribute('fill', 'rgba(59,130,246,0.12)');

            const isSelected = trimState.allowMultipleRects 
                ? (trimState.selectedRectIndex === rectIndex)
                : Boolean(trimState.selected);

            mainRect.setAttribute('stroke', isSelected ? 'rgba(37,99,235,1)' : 'rgba(59,130,246,0.95)');
            mainRect.setAttribute('stroke-width', isSelected ? '3' : '2');
            mainRect.setAttribute('data-rect', 'true');
            mainRect.setAttribute('data-rect-index', String(rectIndex));
            mainRect.style.pointerEvents = 'auto';

            g.appendChild(mainRect);

            if (isSelected) {
                const HANDLE_SIZE = 12;
                const handleHalf = Math.round(HANDLE_SIZE / 2);
                const handlePositions = [
                    [rectX, rectY], [rectX + rectW / 2, rectY], [rectX + rectW, rectY],
                    [rectX + rectW, rectY + rectH / 2], [rectX + rectW, rectY + rectH],
                    [rectX + rectW / 2, rectY + rectH], [rectX, rectY + rectH], [rectX, rectY + rectH / 2]
                ];
                const handleKeys = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
                const handleCursors = {
                    nw: 'nwse-resize', se: 'nwse-resize',
                    ne: 'nesw-resize', sw: 'nesw-resize',
                    n: 'ns-resize', s: 'ns-resize',
                    e: 'ew-resize', w: 'ew-resize'
                };

                handlePositions.forEach(([px, py], idx) => {
                    const handle = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                    handle.setAttribute('x', String(Math.round(px - handleHalf)));
                    handle.setAttribute('y', String(Math.round(py - handleHalf)));
                    handle.setAttribute('width', String(HANDLE_SIZE));
                    handle.setAttribute('height', String(HANDLE_SIZE));
                    handle.setAttribute('fill', 'rgba(59,130,246,0.95)');
                    handle.setAttribute('data-handle', String(idx));
                    handle.setAttribute('data-rect-index', String(rectIndex));
                    handle.style.pointerEvents = 'auto';
                    handle.style.cursor = handleCursors[handleKeys[idx]] || 'default';
                    g.appendChild(handle);
                });

                let deleteX = rectX + rectW + 10;
                let deleteY = rectY - 10;
                deleteX = Math.min(cssW - 12, Math.max(12, deleteX));
                deleteY = Math.min(cssH - 12, Math.max(12, deleteY));

                const deleteBtn = document.createElementNS('http://www.w3.org/2000/svg', 'g');
                deleteBtn.style.pointerEvents = 'auto';

                const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                circle.setAttribute('cx', String(deleteX));
                circle.setAttribute('cy', String(deleteY));
                circle.setAttribute('r', '10');
                circle.setAttribute('fill', 'rgba(0,0,0,0.6)');
                circle.setAttribute('data-close', 'true');
                circle.setAttribute('data-rect-index', String(rectIndex));
                circle.style.cursor = 'pointer';
                deleteBtn.appendChild(circle);

                const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                text.setAttribute('x', String(deleteX));
                text.setAttribute('y', String(deleteY + 4));
                text.setAttribute('fill', '#fff');
                text.setAttribute('font-size', '12');
                text.setAttribute('text-anchor', 'middle');
                text.setAttribute('data-close', 'true');
                text.setAttribute('data-rect-index', String(rectIndex));
                text.style.pointerEvents = 'none';
                text.textContent = '×';
                deleteBtn.appendChild(text);

                deleteBtn.addEventListener('pointerdown', function (ev) {
                    try {
                        ev.stopPropagation();
                        removeRectAt(rectIndex);
                    } catch (e) { console.error(e); }
                }, { passive: false });

                g.appendChild(deleteBtn);
            }

            svg.appendChild(g);
        });

        if (!isDrawing) {
            trimState.overlayDom = container;
            trimState.currentRectsPx = rects.map(r => ({
                x: Number(r.X ?? r.x ?? 0) * cssW,
                y: Number(r.Y ?? r.y ?? 0) * cssH,
                w: Number(r.Width ?? r.width ?? 0) * cssW,
                h: Number(r.Height ?? r.height ?? 0) * cssH
            }));
            trimState.currentRectPx = trimState.currentRectsPx.length > 0 
                ? { ...trimState.currentRectsPx[trimState.currentRectsPx.length - 1] }
                : null;

        } else {
            if (preservedRects.length > 0 && (!trimState.currentRectsPx || trimState.currentRectsPx.length === 0)) {
                trimState.currentRectsPx = preservedRects;
            } 
        }

        if (!trimState.internal) trimState.internal = {};
        if (!trimState.internal.keydown) {
            trimState.internal.keydown = function (ev) {
                if ((ev.key === 'Delete' || ev.key === 'Del')) {
                    if (trimState.allowMultipleRects && trimState.selectedRectIndex >= 0) {
                        removeRectAt(trimState.selectedRectIndex);
                    } else if (!trimState.allowMultipleRects && trimState.selected) {
                        removeRectAt(0);
                    }
                }
            };
            document.addEventListener('keydown', trimState.internal.keydown);
        }

        if (trimState.handlers && !container.__trimHooked) {
            const safeInvoke = (fn, ev) => { try { fn(ev); } catch (e) {} };
            trimState.internal.overlayPointerDown = (ev) => safeInvoke(trimState.handlers.pointerDown, ev);
            trimState.internal.overlayMove = (ev) => safeInvoke(trimState.handlers.overlayMove, ev);

            container.addEventListener('pointerdown', trimState.internal.overlayPointerDown, { passive: false, capture: true });
            container.addEventListener('pointermove', trimState.internal.overlayMove, { passive: true, capture: true });
            container.__trimHooked = true;
        }

        return true;
    } catch (e) {
        console.error('drawTrimOverlayAsSvg error', e);
        return false;
    }
};

// ========================================
// トリムリスナー管理: ドラッグ & リサイズ処理
// ========================================
(function () {
    window._simpleTrim = window._simpleTrim || {};
    window._trimSnapSettings = { enabled: false, threshold: 10 }; // スナップ有効化フラグと閾値（ピクセル）

    function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

    // スナップ補助線を描画
    function drawSnapGuides(canvasId, snapLines) {
        try {
            const overlayContainer = document.getElementById(canvasId + '-overlay-svg');
            if (!overlayContainer) return;

            // 補助線専用の SVG を探す（なければ作成）
            let guideSvg = overlayContainer.querySelector('.snap-guide-svg');
            if (!guideSvg) {
                guideSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                guideSvg.classList.add('snap-guide-svg');
                guideSvg.setAttribute('width', '100%');
                guideSvg.setAttribute('height', '100%');
                guideSvg.style.pointerEvents = 'none';
                guideSvg.style.position = 'absolute';
                guideSvg.style.left = '0';
                guideSvg.style.top = '0';
                guideSvg.style.zIndex = '44'; // 矩形より下、背景より上
                overlayContainer.appendChild(guideSvg);
            }

            // viewBox を動的に設定
            const canvas = document.getElementById(canvasId);
            if (!canvas) return;

            const cssW = Math.max(1, Math.round(canvas.clientWidth || 1));
            const cssH = Math.max(1, Math.round(canvas.clientHeight || 1));
            guideSvg.setAttribute('viewBox', `0 0 ${cssW} ${cssH}`);
            guideSvg.setAttribute('preserveAspectRatio', 'none');

            // 既存の補助線をクリア
            while (guideSvg.firstChild) {
                guideSvg.removeChild(guideSvg.firstChild);
            }

            if (!snapLines || snapLines.length === 0) return;

            // 補助線を描画
            snapLines.forEach(line => {
                const snapLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                
                if (line.type === 'vertical') {
                    snapLine.setAttribute('x1', String(line.position));
                    snapLine.setAttribute('y1', '0');
                    snapLine.setAttribute('x2', String(line.position));
                    snapLine.setAttribute('y2', String(cssH));
                } else { // horizontal
                    snapLine.setAttribute('x1', '0');
                    snapLine.setAttribute('y1', String(line.position));
                    snapLine.setAttribute('x2', String(cssW));
                    snapLine.setAttribute('y2', String(line.position));
                }

                snapLine.setAttribute('stroke', 'rgba(59,130,246,0.8)'); // 青色
                snapLine.setAttribute('stroke-width', '2');
                snapLine.setAttribute('stroke-dasharray', '5 5'); // 破線
                snapLine.setAttribute('vector-effect', 'non-scaling-stroke'); // ズームしても線幅を維持
                snapLine.style.pointerEvents = 'none';

                guideSvg.appendChild(snapLine);
            });

        } catch (e) {
            console.error('drawSnapGuides error', e);
        }
    }

    // スナップ計算関数（補助線情報も返す）
    function snapValue(value, targets, threshold) {
        const result = { snapped: value, hasSnap: false, snapTarget: null };

        if (!window._trimSnapSettings.enabled || !targets || targets.length === 0) {
            return result;
        }

        let closestDist = Infinity;

        for (const target of targets) {
            const dist = Math.abs(value - target);
            if (dist < threshold && dist < closestDist) {
                closestDist = dist;
                result.snapped = target;
                result.hasSnap = true;
                result.snapTarget = target;
            }
        }

        return result;
    }

    // 既存矩形からスナップターゲットを収集
    function collectSnapTargets(canvasId) {
        const targets = { x: [], y: [] };
        
        try {
            const trimState = window._simpleTrim[canvasId];
            if (!trimState || !trimState.currentRectsPx) return targets;

            trimState.currentRectsPx.forEach(rect => {
                targets.x.push(rect.x, rect.x + rect.w); // 左端と右端
                targets.y.push(rect.y, rect.y + rect.h); // 上端と下端
            });
        } catch (e) {
            console.error('collectSnapTargets error', e);
        }

        return targets;
    }

    // ========================================
    // クリーンアップ: リスナー・DOM削除
    // ========================================
    function cleanupTrimEntry(canvasId) {
        const safe = {
            removeListener(el, ev, fn, opts) {
                try { if (el && fn) el.removeEventListener(ev, fn, opts); } catch (e) {}
            },
            removeWindowListener(ev, fn, opts) {
                try { if (fn) window.removeEventListener(ev, fn, opts); } catch (e) {}
            },
            removeDocumentListener(ev, fn, opts) {
                try { if (fn) document.removeEventListener(ev, fn, opts); } catch (e) {}
            },
            removeElement(el) {
                try {
                    if (!el) return;
                    if (el.style) el.style.pointerEvents = 'none';
                    if (typeof el.remove === 'function') el.remove();
                    if (el.width !== undefined) { el.width = 0; el.height = 0; }
                } catch (e) {}
            }
        };

        try {
            const trimState = window._simpleTrim?.[canvasId];
            if (!trimState) return;

            safe.removeListener(trimState.base, 'pointerdown', trimState.handlers?.pointerDown, { passive: false });
            safe.removeListener(trimState.base, 'touchstart', trimState.handlers?.touchStart, { passive: false });
            safe.removeWindowListener('pointermove', trimState.handlers?.move, { passive: false });
            safe.removeWindowListener('pointerup', trimState.handlers?.up, { passive: false });

            safe.removeElement(trimState.overlay || document.getElementById(canvasId + '-overlay'));

            const overlayDom = trimState.overlayDom || document.getElementById(canvasId + '-overlay-svg');
            if (overlayDom) {
                safe.removeListener(overlayDom, 'pointerdown', trimState.internal?.overlayPointerDown, true);
                safe.removeListener(overlayDom, 'pointermove', trimState.internal?.overlayMove, true);
                safe.removeElement(overlayDom);
            }

            safe.removeDocumentListener('keydown', trimState.internal?.keydown);
            safe.removeListener(trimState.host, 'scroll', trimState.internal?.hostScroll, { passive: true });

            if (trimState.handlers) Object.keys(trimState.handlers).forEach(k => trimState.handlers[k] = null);
            if (trimState.internal) Object.keys(trimState.internal).forEach(k => trimState.internal[k] = null);

            delete window._simpleTrim[canvasId];
        } catch (e) {
            console.error('cleanupTrimEntry error', e);
        }
    }

    // ========================================
    // リスナー登録: ドラッグ・リサイズ・移動
    // ========================================
    window.attachTrimListeners = function (canvasId, dotNetRef, selectionMode = 'single', allowMultipleRects = false) {
        try {
            //登録時はパンモード解除
            window._previewPan.enabled = false;
            if (!canvasId) return false;
            const canvas = document.getElementById(canvasId);
            if (!canvas) {
                console.warn(`attachTrimListeners: canvas not found: ${canvasId}`);
                return false;
            }

            // 既存の選択状態を保持
            let preservedSelected = false;
            const existing = window._simpleTrim[canvasId];
            if (existing?.selected) preservedSelected = true;

            cleanupTrimEntry(canvasId);

            const host = canvas.parentElement || canvas.closest('.tp-preview-page') || canvas.closest('.preview-zoom-inner') || document.body;
            if (getComputedStyle(host).position === 'static') host.style.position = 'relative';

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

            const trimState = {
                base: canvas,
                host,
                overlay,
                overlayDom:null, //キャンバス上に置かれた SVG オーバーレイ（DOM コンテナ）への参 
                dotNetRef,
                selectionMode: (selectionMode === 'multi') ? 'multi' : 'single',
                allowMultipleRects: Boolean(allowMultipleRects), // 複数矩形許可フラグ
                active: false,
                mode: null,
                pointerId: null,
                startClientX: 0,
                startClientY: 0,
                startClientLocal: null,
                startRectPx: null,
                currentRectPx: null, // 単一矩形互換用（最後の矩形）
                currentRectsPx: [], // 複数矩形管理用（配列）
                selectedRectIndex: -1, // 選択中の矩形インデックス（複数時のみ使用）
                pendingMove: false,
                handlers: {},
                internal: {},
                resizeHandle: null,
                baseRectAtDown: null,
                logicalWAtDown: null,
                logicalHAtDown: null,
                didDrag: false,
                selected: preservedSelected
            };

            trimState.internal.lastAttachedAt = performance.now();
            window._simpleTrim[canvasId] = trimState;

            const HANDLE_KEY_MAP = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
            const HANDLE_CURSOR_MAP = {
                nw: 'nwse-resize', se: 'nwse-resize',
                ne: 'nesw-resize', sw: 'nesw-resize',
                n: 'ns-resize', s: 'ns-resize',
                e: 'ew-resize', w: 'ew-resize'
            };

            // 座標変換: クライアント座標 → Canvas 内論理ピクセル
            function toLocalPx(clientX, clientY) {
                try {
                    const logicalW = (trimState.logicalWAtDown && trimState.active)
                        ? trimState.logicalWAtDown
                        : Math.max(1, Math.round(canvas.clientWidth || canvas.getBoundingClientRect().width || 1));
                    const logicalH = (trimState.logicalHAtDown && trimState.active)
                        ? trimState.logicalHAtDown
                        : Math.max(1, Math.round(canvas.clientHeight || canvas.getBoundingClientRect().height || 1));

                    const canvasRect = canvas.getBoundingClientRect();
                    const scaleFromRects = (canvasRect.width && logicalW) ? (canvasRect.width / logicalW) : 1;
                    const scale = window._previewZoomState?.lastZoom || scaleFromRects || 1;

                    const offset = getOffsetRelativeTo(canvas, host);
                    const hostRect = host.getBoundingClientRect();
                    const canvasLeftInViewport = hostRect.left + offset.x * scale;
                    const canvasTopInViewport = hostRect.top + offset.y * scale;

                    const xInScaled = clientX - canvasLeftInViewport;
                    const yInScaled = clientY - canvasTopInViewport;

                    return {
                        x: xInScaled / scale,
                        y: yInScaled / scale,
                        cssW: logicalW,
                        cssH: logicalH
                    };
                } catch (e) {
                    const b = canvas.getBoundingClientRect();
                    const logicalW = Math.max(1, Math.round(canvas.clientWidth || b.width || 1));
                    const logicalH = Math.max(1, Math.round(canvas.clientHeight || b.height || 1));
                    const scale = window._previewZoomState?.lastZoom || 1;
                    return {
                        x: (clientX - b.left) / scale,
                        y: (clientY - b.top) / scale,
                        cssW: logicalW,
                        cssH: logicalH
                    };
                }
            }

            function rectPxToNormalized(rectPx) {
                const logicalW = Math.max(1, Math.round(canvas.clientWidth || 1));
                const logicalH = Math.max(1, Math.round(canvas.clientHeight || 1));
                const left = Number(rectPx.x || 0);
                const top = Number(rectPx.y || 0);
                const right = left + Number(rectPx.w || 0);
                const bottom = top + Number(rectPx.h || 0);
                const leftC = clamp(left, 0, logicalW);
                const topC = clamp(top, 0, logicalH);
                const rightC = clamp(right, 0, logicalW);
                const bottomC = clamp(bottom, 0, logicalH);
                return {
                    X: leftC / logicalW,
                    Y: topC / logicalH,
                    Width: Math.max(0, rightC - leftC) / logicalW,
                    Height: Math.max(0, bottomC - topC) / logicalH
                };
            }

            // ムーブイベント処理（requestAnimationFrame で間引き）
            function scheduleMove(ev) {
                trimState.lastMoveEv = ev;
                if (trimState.pendingMove) return;
                trimState.pendingMove = true;

                requestAnimationFrame(() => {
                    trimState.pendingMove = false;
                    if (!trimState.active) return;

                    const loc = toLocalPx(trimState.lastMoveEv.clientX, trimState.lastMoveEv.clientY);
                    const { cssW, cssH } = loc;
                    const prevRect = trimState.currentRectPx ? { ...trimState.currentRectPx } : null;

                    // スナップターゲットを収集
                    const snapTargets = collectSnapTargets(canvasId);
                    const snapThreshold = window._trimSnapSettings.threshold || 10;
                    // 表示する補助線
                    const activeSnapLines = [];
                    
                    // クリック（選択）とドラッグ（新規描画）の判定
                    if (trimState.mode === 'maybe-draw') {
                        const dx = loc.x - trimState.startClientLocal.x;
                        const dy = loc.y - trimState.startClientLocal.y;
                        const distSq = dx * dx + dy * dy;
                        const THRESHOLD_PX = 8;
                        if (distSq >= THRESHOLD_PX * THRESHOLD_PX) {
                            // ドラッグ開始と判定
                            trimState.mode = 'draw';
                            trimState.currentRectPx = { x: trimState.startClientLocal.x, y: trimState.startClientLocal.y, w: 0, h: 0 };
                        } else {
                            return;
                        }
                    }

                    if (trimState.mode === 'draw') {
                        let rawX = Math.min(loc.x, trimState.startClientLocal.x);
                        let rawY = Math.min(loc.y, trimState.startClientLocal.y);
                        let rawW = Math.abs(loc.x - trimState.startClientLocal.x);
                        let rawH = Math.abs(loc.y - trimState.startClientLocal.y);

                        // アスペクト比固定（1:1 など）
                        if (window._trimAspectRatio && window._trimAspectRatio > 0) {
                            const targetRatio = window._trimAspectRatio;
                            const currentRatio = rawW / Math.max(1, rawH);
                            
                            // ドラッグ方向を4方向で判定
                            const dragRight = loc.x >= trimState.startClientLocal.x;
                            const dragDown = loc.y >= trimState.startClientLocal.y;
                            
                            if (currentRatio > targetRatio) {
                                // 幅が広すぎる → 高さを基準に幅を調整
                                const newW = rawH * targetRatio;
                                
                                if (dragRight) {
                                    // 右方向ドラッグ：左側（X座標）を固定
                                    rawX = trimState.startClientLocal.x;
                                    rawW = newW;
                                } else {
                                    // 左方向ドラッグ：右側を固定
                                    rawX = trimState.startClientLocal.x - newW;
                                    rawW = newW;
                                }
                            } else {
                                // 高さが高すぎる → 幅を基準に高さを調整
                                const newH = rawW / targetRatio;
                                
                                if (dragDown) {
                                    // 下方向ドラッグ：上側（Y座標）を固定
                                    rawY = trimState.startClientLocal.y;
                                    rawH = newH;
                                } else {
                                    // 上方向ドラッグ：下側を固定
                                    rawY = trimState.startClientLocal.y - newH;
                                    rawH = newH;
                                }
                            }
                        }

                        // スナップ適用（描画中）
                        const snappedLeft = snapValue(rawX, snapTargets.x, snapThreshold);
                        const snappedTop = snapValue(rawY, snapTargets.y, snapThreshold);
                        const snappedRight = snapValue(rawX + rawW, snapTargets.x, snapThreshold);
                        const snappedBottom = snapValue(rawY + rawH, snapTargets.y, snapThreshold);

                        // 補助線を追加
                        if (snappedLeft.hasSnap) activeSnapLines.push({ type: 'vertical', position: snappedLeft.snapTarget });
                        if (snappedTop.hasSnap) activeSnapLines.push({ type: 'horizontal', position: snappedTop.snapTarget });
                        if (snappedRight.hasSnap) activeSnapLines.push({ type: 'vertical', position: snappedRight.snapTarget });
                        if (snappedBottom.hasSnap) activeSnapLines.push({ type: 'horizontal', position: snappedBottom.snapTarget });

                        rawX = snappedLeft.snapped;
                        rawY = snappedTop.snapped;
                        rawW = snappedRight.snapped - snappedLeft.snapped;
                        rawH = snappedBottom.snapped - snappedTop.snapped;

                        // 画面外へのはみ出しをこの時点で切り詰める（disp を currentRectPx に保存）
                        let dispX = rawX < 0 ? 0 : rawX;
                        let dispY = rawY < 0 ? 0 : rawY;
                        let dispW = rawX < 0 ? Math.max(0, Math.min(trimState.startClientLocal.x - dispX, rawW)) : rawW;
                        let dispH = rawY < 0 ? Math.max(0, Math.min(trimState.startClientLocal.y - dispY, rawH)) : rawH;

                        // 整数化して状態に入れる（以降の比較/描画が安定する）
                        trimState.currentRectPx = {
                            x: Math.round(dispX),
                            y: Math.round(dispY),
                            w: Math.round(dispW),
                            h: Math.round(dispH)
                        };

                        if (!trimState.didDrag && prevRect) {
                            const changed = prevRect.x !== trimState.currentRectPx.x ||
                                        prevRect.y !== trimState.currentRectPx.y ||
                                        prevRect.w !== trimState.currentRectPx.w ||
                                        prevRect.h !== trimState.currentRectPx.h;
                            if (changed) trimState.didDrag = true;
                        }

                    } else if (trimState.mode === 'move' && trimState.startRectPx) {
                        const dx = loc.x - trimState.startClientLocal.x;
                        const dy = loc.y - trimState.startClientLocal.y;
                        let nx = trimState.startRectPx.x + dx;
                        let ny = trimState.startRectPx.y + dy;

                        // スナップ適用（移動中）
                        const snappedLeft = snapValue(nx, snapTargets.x, snapThreshold);
                        const snappedTop = snapValue(ny, snapTargets.y, snapThreshold);
                        const snappedRight = snapValue(nx + trimState.startRectPx.w, snapTargets.x, snapThreshold);
                        const snappedBottom = snapValue(ny + trimState.startRectPx.h, snapTargets.y, snapThreshold);

                        const leftDist = Math.abs(nx - snappedLeft.snapped);
                        const rightDist = Math.abs((nx + trimState.startRectPx.w) - snappedRight.snapped);
                        if (rightDist < leftDist && snappedRight.hasSnap) {
                            nx = snappedRight.snapped - trimState.startRectPx.w;
                            activeSnapLines.push({ type: 'vertical', position: snappedRight.snapTarget });
                        } else if (snappedLeft.hasSnap) {
                            nx = snappedLeft.snapped;
                            activeSnapLines.push({ type: 'vertical', position: snappedLeft.snapTarget });
                        }

                        const topDist = Math.abs(ny - snappedTop.snapped);
                        const bottomDist = Math.abs((ny + trimState.startRectPx.h) - snappedBottom.snapped);
                        if (bottomDist < topDist && snappedBottom.hasSnap) {
                            ny = snappedBottom.snapped - trimState.startRectPx.h;
                            activeSnapLines.push({ type: 'horizontal', position: snappedBottom.snapTarget });
                        } else if (snappedTop.hasSnap) {
                            ny = snappedTop.snapped;
                            activeSnapLines.push({ type: 'horizontal', position: snappedTop.snapTarget });
                        }

                        nx = Math.max(0, Math.min(cssW - trimState.startRectPx.w, nx));
                        ny = Math.max(0, Math.min(cssH - trimState.startRectPx.h, ny));

                        trimState.currentRectPx = {
                            x: Math.round(nx),
                            y: Math.round(ny),
                            w: Math.round(trimState.startRectPx.w),
                            h: Math.round(trimState.startRectPx.h)
                        };
                        trimState.didDrag = true;

                    } else if (trimState.mode === 'resize' && trimState.startRectPx) {
                        const dx = loc.x - trimState.startClientLocal.x;
                        const dy = loc.y - trimState.startClientLocal.y;
                        const { x: sx, y: sy, w: sw, h: sh } = trimState.startRectPx;
                        const ex = sx + sw, ey = sy + sh;
                        const hKey = trimState.resizeHandle;

                        let propLeft = sx, propRight = ex, propTop = sy, propBottom = ey;

                        if (['nw', 'w', 'sw'].includes(hKey)) propLeft = clamp(sx + dx, 0, cssW);
                        if (['ne', 'e', 'se'].includes(hKey)) propRight = clamp(ex + dx, 0, cssW);
                        if (['nw', 'n', 'ne'].includes(hKey)) propTop = clamp(sy + dy, 0, cssH);
                        if (['sw', 's', 'se'].includes(hKey)) propBottom = clamp(ey + dy, 0, cssH);

                        // スナップ適用（リサイズ中）
                        if (['nw', 'w', 'sw'].includes(hKey)) {
                            const snapped = snapValue(propLeft, snapTargets.x, snapThreshold);
                            propLeft = snapped.snapped;
                            if (snapped.hasSnap) activeSnapLines.push({ type: 'vertical', position: snapped.snapTarget });
                        }
                        if (['ne', 'e', 'se'].includes(hKey)) {
                            const snapped = snapValue(propRight, snapTargets.x, snapThreshold);
                            propRight = snapped.snapped;
                            if (snapped.hasSnap) activeSnapLines.push({ type: 'vertical', position: snapped.snapTarget });
                        }
                        if (['nw', 'n', 'ne'].includes(hKey)) {
                            const snapped = snapValue(propTop, snapTargets.y, snapThreshold);
                            propTop = snapped.snapped;
                            if (snapped.hasSnap) activeSnapLines.push({ type: 'horizontal', position: snapped.snapTarget });
                        }
                        if (['sw', 's', 'se'].includes(hKey)) {
                            const snapped = snapValue(propBottom, snapTargets.y, snapThreshold);
                            propBottom = snapped.snapped;
                            if (snapped.hasSnap) activeSnapLines.push({ type: 'horizontal', position: snapped.snapTarget });
                        }

                        let newLeft = Math.min(propLeft, propRight);
                        let newRight = Math.max(propLeft, propRight);
                        let newTop = Math.min(propTop, propBottom);
                        let newBottom = Math.max(propTop, propBottom);

                        const MIN_SIZE = 1;
                        if (newRight - newLeft < MIN_SIZE) {
                            newRight = propRight >= propLeft ? Math.min(cssW, newLeft + MIN_SIZE) : newLeft;
                            newLeft = propRight < propLeft ? Math.max(0, newRight - MIN_SIZE) : newLeft;
                        }
                        if (newBottom - newTop < MIN_SIZE) {
                            newBottom = propBottom >= propTop ? Math.min(cssH, newTop + MIN_SIZE) : newTop;
                            newTop = propBottom < propTop ? Math.max(0, newBottom - MIN_SIZE) : newTop;
                        }

                        trimState.currentRectPx = {
                            x: Math.round(newLeft),
                            y: Math.round(newTop),
                            w: Math.round(newRight - newLeft),
                            h: Math.round(newBottom - newTop)
                        };
                        trimState.didDrag = true;
                    }

                    // 補助線を描画
                    drawSnapGuides(canvasId, activeSnapLines);

                    // 変更があれば再描画（複数矩形対応）
                    if (trimState.currentRectPx) {
                        const changed = !prevRect ||
                                    prevRect.x !== trimState.currentRectPx.x ||
                                    prevRect.y !== trimState.currentRectPx.y ||
                                    prevRect.w !== trimState.currentRectPx.w ||
                                    prevRect.h !== trimState.currentRectPx.h;
                        if (changed && trimState.overlayDom && window.drawTrimOverlayAsSvg) {
                            let rectsToRender = [];

                            if (trimState.allowMultipleRects) {
                                if (trimState.mode === 'draw') {
                                    // 描画中：既存矩形 + 描画中の一時矩形
                                    // currentRectPx が有効な場合のみ追加
                                    if (trimState.currentRectPx && trimState.currentRectPx.w > 0 && trimState.currentRectPx.h > 0) { 
                                        
                                        rectsToRender = [
                                            ...trimState.currentRectsPx.map(r => ({
                                                X: r.x / cssW, Y: r.y / cssH,
                                                Width: r.w / cssW, Height: r.h / cssH
                                            })),
                                            {
                                                X: trimState.currentRectPx.x / cssW,
                                                Y: trimState.currentRectPx.y / cssH,
                                                Width: trimState.currentRectPx.w / cssW,
                                                Height: trimState.currentRectPx.h / cssH
                                            }
                                        ];
                                    } else {
                                        // currentRectPx が無効な場合は既存矩形のみ
                                        rectsToRender = trimState.currentRectsPx.map(r => ({
                                            X: r.x / cssW, Y: r.y / cssH,
                                            Width: r.w / cssW, Height: r.h / cssH
                                        }));
                                    }
                                } else {
                                    // 移動/リサイズ：該当インデックスを更新
                                    if (trimState.selectedRectIndex >= 0 && trimState.selectedRectIndex < trimState.currentRectsPx.length) {
                                        trimState.currentRectsPx[trimState.selectedRectIndex] = { ...trimState.currentRectPx };
                                    }
                                    rectsToRender = trimState.currentRectsPx.map(r => ({
                                        X: r.x / cssW, Y: r.y / cssH,
                                        Width: r.w / cssW, Height: r.h / cssH
                                    }));
                                }
                            } else {
                                // 単一矩形
                                rectsToRender = [rectPxToNormalized(trimState.currentRectPx)];
                            }

                            // rectsToRender が空でない場合のみ描画
                            if (rectsToRender.length > 0) {
                                window.drawTrimOverlayAsSvg(canvasId, rectsToRender);
                            }
                        }
                    }

                });
            }

            // 空白クリック（maybe-draw）処理を共通化 ---
            function startMaybeDraw() {
                trimState.mode = 'maybe-draw';

                let rectsToRender = [];
                if (trimState.allowMultipleRects) {
                    trimState.selectedRectIndex = -1;
                    const baseW = trimState.logicalWAtDown || Math.max(1, Math.round(canvas.clientWidth || 1));
                    const baseH = trimState.logicalHAtDown || Math.max(1, Math.round(canvas.clientHeight || 1));
                    rectsToRender = trimState.currentRectsPx.map(r => ({
                        X: r.x / baseW, Y: r.y / baseH,
                        Width: r.w / baseW, Height: r.h / baseH
                    }));
                } else {
                    trimState.selected = false;
                    if (trimState.currentRectPx) {
                        rectsToRender = [rectPxToNormalized(trimState.currentRectPx)];
                    }
                }
                if (window.drawTrimOverlayAsSvg) {
                    window.drawTrimOverlayAsSvg(canvasId, rectsToRender);
                }
            }

            // PointerDown: モード判定 & キャプチャ開始
            const onPointerDown = function (ev) {
                try {

                    // パンモードならトリム処理を完全に無視
                    if (window._previewPan.enabled) {
                        return;
                    }

                    console.log("aaaa")
                    if (ev.button !== undefined && ev.button !== 0) return;

                    trimState.active = true;
                    trimState.pointerId = ev.pointerId ?? 'mouse';
                    trimState.startClientX = ev.clientX;
                    trimState.startClientY = ev.clientY;
                    trimState.didDrag = false;

                    trimState.baseRectAtDown = canvas.getBoundingClientRect();
                    trimState.logicalWAtDown = Math.max(1, Math.round(canvas.clientWidth || trimState.baseRectAtDown.width || 1));
                    trimState.logicalHAtDown = Math.max(1, Math.round(canvas.clientHeight || trimState.baseRectAtDown.height || 1));

                    trimState.startClientLocal = toLocalPx(ev.clientX, ev.clientY);

                    if (canvas.setPointerCapture) canvas.setPointerCapture(ev.pointerId);
                    const t = ev.target || ev.srcElement;
                    if (t?.setPointerCapture && t !== canvas) {
                        try { t.setPointerCapture(ev.pointerId); } catch (e) {}
                    }

                    trimState.resizeHandle = null;

                    // SVGオーバーレイの有無
                    if (trimState.overlayDom && t) {
                        const handleAttr = t.getAttribute?.('data-handle');
                        const rectAttr = t.getAttribute?.('data-rect');
                        const rectIndexAttr = t.getAttribute?.('data-rect-index');
                        const targetRectIndex = (rectIndexAttr !== null) ? Number(rectIndexAttr) : -1;

                        if (handleAttr !== null) {
                            // ハンドルクリック → リサイズモード
                            const idx = Number(handleAttr);
                            trimState.resizeHandle = (Number.isFinite(idx) && idx >= 0 && idx < HANDLE_KEY_MAP.length) ? HANDLE_KEY_MAP[idx] : null;
                            trimState.mode = 'resize';

                            if (trimState.allowMultipleRects && targetRectIndex >= 0 && targetRectIndex < trimState.currentRectsPx.length) {
                                trimState.selectedRectIndex = targetRectIndex;
                                trimState.startRectPx = { ...trimState.currentRectsPx[targetRectIndex] };
                                
                                // currentRectPx も同期
                                trimState.currentRectPx = { ...trimState.currentRectsPx[targetRectIndex] };
                            } else {
                                trimState.startRectPx = trimState.currentRectPx ? { ...trimState.currentRectPx } : { x: trimState.startClientLocal.x, y: trimState.startClientLocal.y, w: 0, h: 0 };
                            }
                        } else if (rectAttr !== null) {
                             // 矩形本体クリック → 移動モード
                            trimState.mode = 'move';

                            if (trimState.allowMultipleRects && targetRectIndex >= 0 && targetRectIndex < trimState.currentRectsPx.length) {
                                trimState.selectedRectIndex = targetRectIndex;
                                trimState.startRectPx = { ...trimState.currentRectsPx[targetRectIndex] };
                                
                                // 【修正】currentRectPx も同期（移動/リサイズ処理で参照されるため）
                                trimState.currentRectPx = { ...trimState.currentRectsPx[targetRectIndex] };

                                // 他の Canvas の矩形を非選択（selectionMode === 'single' の場合）
                                const mode = trimState.selectionMode || window._simpleTrimSettings?.selectionMode || 'single';
                                if (mode === 'single') {
                                    Object.keys(window._simpleTrim).forEach(k => {
                                        if (k !== canvasId && window._simpleTrim[k]) {
                                            window._simpleTrim[k].selectedRectIndex = -1;
                                            window._simpleTrim[k].selected = false;
                                        }
                                    });
                                }

                                // 再描画（選択状態反映）
                                const rectsToRender = trimState.currentRectsPx.map(r => ({
                                    X: r.x / trimState.logicalWAtDown,
                                    Y: r.y / trimState.logicalHAtDown,
                                    Width: r.w / trimState.logicalWAtDown,
                                    Height: r.h / trimState.logicalHAtDown
                                }));
                                window.drawTrimOverlayAsSvg(canvasId, rectsToRender);

                            } else {
                                // 単一矩形モード（既存動作）
                                trimState.startRectPx = trimState.currentRectPx ? { ...trimState.currentRectPx } : { x: trimState.startClientLocal.x, y: trimState.startClientLocal.y, w: 0, h: 0 };

                                const mode = trimState.selectionMode || window._simpleTrimSettings?.selectionMode || 'single';
                                if (mode === 'single') {
                                    Object.keys(window._simpleTrim).forEach(k => {
                                        if (k !== canvasId && window._simpleTrim[k]?.selected) {
                                            window._simpleTrim[k].selected = false;
                                        }
                                    });
                                }

                                trimState.selected = true;

                                if (trimState.overlayDom && window.drawTrimOverlayAsSvg) {
                                    window.drawTrimOverlayAsSvg(canvasId, [rectPxToNormalized(trimState.currentRectPx)]);
                                }
                            }
                        } else {
                            // オーバーレイあり（svg以外をクリック） → 新規描画候補
                            startMaybeDraw();
                        }
                    } else {
                        // オーバーレイなし → 新規描画候補
                        startMaybeDraw();
                    }

                    // カーソル変更
                    if (trimState.overlayDom) {
                        if (trimState.resizeHandle) {
                            trimState.overlayDom.style.cursor = HANDLE_CURSOR_MAP[trimState.resizeHandle] || '';
                        } else if (trimState.mode === 'draw') {
                            trimState.overlayDom.style.cursor = 'crosshair';
                        } else if (trimState.mode === 'move') {
                            trimState.overlayDom.style.cursor = 'move';
                        } else if (trimState.mode === 'maybe-draw') {
                            trimState.overlayDom.style.cursor = '';
                        }
                    }

                    // ドラッグ中のイベント
                    trimState.handlers.move = (mEv) => scheduleMove(mEv);
                    // ドラッグ終了時のイベント
                    trimState.handlers.up = function (uEv) {
                        if (!trimState.active) return;
                        // 補助線をクリア
                        drawSnapGuides(canvasId, []);
                        
                        trimState.active = false;

                        try { if (canvas.releasePointerCapture) canvas.releasePointerCapture(trimState.pointerId); } catch (e) {}

                        trimState.baseRectAtDown = null;
                        trimState.logicalWAtDown = null;
                        trimState.logicalHAtDown = null;

                        if (trimState.overlayDom) trimState.overlayDom.style.cursor = '';

                        if (trimState.mode === 'maybe-draw') {
                            trimState.mode = null;
                            trimState.didDrag = false;
                            window.removeEventListener('pointermove', trimState.handlers.move, { passive: false });
                            window.removeEventListener('pointerup', trimState.handlers.up, { passive: false });
                            return;
                        }

                        const raw = trimState.currentRectPx || { x: 0, y: 0, w: 0, h: 0 };
                        if (raw.w > 0 && raw.h > 0) {
                            const norm = rectPxToNormalized(raw);

                            if (trimState.allowMultipleRects) {
                                // 複数矩形時：配列に追加
                                if (trimState.mode === 'draw') {
                                    // ▼ グリッド分割の適用（新規描画時のみ）
                                    const gridDiv = window._trimGridDivision || { cols: 1, rows: 1 };
                                    const cols = Math.max(1, gridDiv.cols);
                                    const rows = Math.max(1, gridDiv.rows);

                                    if (cols > 1 || rows > 1) {
                                        // 描画した矩形を基準に分割
                                        const colWidth = raw.w / cols;
                                        const rowHeight = raw.h / rows;

                                        for (let row = 0; row < rows; row++) {
                                            for (let col = 0; col < cols; col++) {
                                                trimState.currentRectsPx.push({
                                                    x: raw.x + colWidth * col,
                                                    y: raw.y + rowHeight * row,
                                                    w: colWidth,
                                                    h: rowHeight
                                                });
                                            }
                                        }
                                        trimState.selectedRectIndex = trimState.currentRectsPx.length - 1;
                                        
                                        // 分割結果を即座に再描画（視覚的フィードバック）
                                        const rectsToRender = trimState.currentRectsPx.map(r => ({
                                            X: r.x / (canvas.clientWidth || 1),
                                            Y: r.y / (canvas.clientHeight || 1),
                                            Width: r.w / (canvas.clientWidth || 1),
                                            Height: r.h / (canvas.clientHeight || 1)
                                        }));
                                        if (window.drawTrimOverlayAsSvg) {
                                            window.drawTrimOverlayAsSvg(canvasId, rectsToRender);
                                        }
                                    } else { 
                                        // 1×1矩形
                                        trimState.currentRectsPx.push(raw);
                                        trimState.selectedRectIndex = trimState.currentRectsPx.length - 1;
                                    }

                                } else if (trimState.mode === 'move' || trimState.mode === 'resize') {
                                    // 移動/リサイズ → 該当インデックスを更新
                                    if (trimState.selectedRectIndex >= 0 && trimState.selectedRectIndex < trimState.currentRectsPx.length) {
                                        trimState.currentRectsPx[trimState.selectedRectIndex] = raw;
                                    }
                                }

                                // 配列全体を .NET に通知
                                const rectsToCommit = trimState.currentRectsPx.map(r => ({
                                    X: r.x / (canvas.clientWidth || 1),
                                    Y: r.y / (canvas.clientHeight || 1),
                                    Width: r.w / (canvas.clientWidth || 1),
                                    Height: r.h / (canvas.clientHeight || 1)
                                }));

                                if (trimState.dotNetRef?.invokeMethodAsync) {
                                    trimState.dotNetRef.invokeMethodAsync('CommitMultipleRectsFromJs', rectsToCommit).catch(() => {});
                                }

                            } else {
                                // 単一矩形時：上書き
                                trimState.lastRawRect = raw;
                                // 配列にも保存（互換性維持）
                                trimState.currentRectsPx = [raw];

                                if (trimState.dotNetRef?.invokeMethodAsync) {
                                    trimState.dotNetRef.invokeMethodAsync('CommitTrimRectFromJs', norm.X, norm.Y, norm.Width, norm.Height).catch(() => {});
                                }

                                if (trimState.didDrag) {
                                    trimState.selected = false;
                                    if (trimState.overlayDom && window.drawTrimOverlayAsSvg) {
                                        window.drawTrimOverlayAsSvg(canvasId, [rectPxToNormalized(raw)]);
                                    }
                                }
                            }
                        } else {
                            if (trimState.overlayDom && window.drawTrimOverlayAsSvg) {
                                window.drawTrimOverlayAsSvg(canvasId, []);
                            }
                        }

                        window.removeEventListener('pointermove', trimState.handlers.move, { passive: false });
                        window.removeEventListener('pointerup', trimState.handlers.up, { passive: false });
                    };

                    window.addEventListener('pointermove', trimState.handlers.move, { passive: false });
                    window.addEventListener('pointerup', trimState.handlers.up, { passive: false });

                    ev.preventDefault?.();
                } catch (e) {
                    console.error('onPointerDown error', e);
                }
            };

            const onTouchStart = function (tEv) {
                try {
                    if (!tEv.touches || tEv.touches.length === 0) return;
                    const t = tEv.touches[0];
                    onPointerDown({
                        clientX: t.clientX,
                        clientY: t.clientY,
                        pointerId: 'touch',
                        button: 0,
                        target: t.target,
                        preventDefault: () => tEv.preventDefault()
                    });
                    tEv.preventDefault();
                } catch (e) {
                    console.error('onTouchStart error', e);
                }
            };
            
            trimState.handlers.pointerDown = onPointerDown;
            trimState.handlers.touchStart = onTouchStart;

            canvas.addEventListener('pointerdown', onPointerDown, { passive: false });
            //pointerdownよりもtouchstartが動くのでタッチ操作時の画面揺れ防止のために個別にonTouchStartという形で実行
            canvas.addEventListener('touchstart', onTouchStart, { passive: false });

            let scrollPending = false;
            function onAnyScrollOrResize() {
                if (trimState.active) {
                    return;
                }
                if (scrollPending) return;
                scrollPending = true;
                requestAnimationFrame(() => { scrollPending = false; });
            }

            trimState.internal.hostScroll = onAnyScrollOrResize;
            host.addEventListener('scroll', trimState.internal.hostScroll, { passive: true });

            const container = document.getElementById('trim-preview-container') || host.closest('.preview-zoom-viewport');
            if (container) {
                trimState.internal.containerScroll = onAnyScrollOrResize;
                container.addEventListener('scroll', trimState.internal.containerScroll, { passive: true });
            }

            return true;
        } catch (e) {
            console.error('attachTrimListeners error', e);
            return false;
        }
    };

    window.detachTrimListeners = function (canvasId) {
        try {
            const trimState = window._simpleTrim?.[canvasId];
            if (!trimState) {
                cleanupTrimEntry(canvasId);
                return false;
            }
            cleanupTrimEntry(canvasId);
            return true;
        } catch (e) {
            console.error('detachTrimListeners error', e);
            return false;
        }
    };
})();

// スナップ機能の有効化/無効化
window.setTrimSnapEnabled = function(enabled) {
    try {
        window._trimSnapSettings = window._trimSnapSettings || {};
        window._trimSnapSettings.enabled = Boolean(enabled);
        return true;
    } catch (e) {
        console.error('setTrimSnapEnabled error', e);
        return false;
    }
};

// ========================================
// Canvas プレビュー描画: data URL から画像を描画
// ========================================
window.drawImageToCanvasForPreview = function (canvasId, imageUrl, useDevicePixelRatio = true) {
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

                    canvas.width = Math.round(iw * dpr);
                    canvas.height = Math.round(ih * dpr);

                    canvas.style.width = iw + 'px';
                    canvas.style.height = ih + 'px';
                    canvas.style.display = 'block';

                    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
                    ctx.clearRect(0, 0, iw, ih);
                    ctx.drawImage(img, 0, 0, iw, ih);

                    requestAnimationFrame(() => resolve(true));
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

// ========================================
// 矩形オプション: アスペクト比固定
// ========================================
window.setTrimRectAspectRatio = function(ratio) {
    try {
        window._trimAspectRatio = (typeof ratio === 'number' && ratio > 0) ? ratio : null;
        return true;
    } catch (e) {
        console.error('setTrimRectAspectRatio error', e);
        return false;
    }
};

// ========================================
// 矩形オプション: グリッド分割（cols × rows）
// ========================================
window.setTrimRectGridDivision = function(cols, rows) {
    try {
        window._trimGridDivision = {
            cols: Math.max(1, Math.min(5, Math.round(cols) || 1)),
            rows: Math.max(1, Math.min(5, Math.round(rows) || 1))
        };
        return true;
    } catch (e) {
        console.error('setTrimRectGridDivision error', e);
        return false;
    }
};

// ========================================
// スクロール監視: プレビューキャッシュの自動クリーンアップ
// ========================================
window.registerPreviewCacheCleanup = function(containerId, dotNetRef) {
    try {
        const container = document.getElementById(containerId);
        if (!container) {
            console.warn(`registerPreviewCacheCleanup: container not found: ${containerId}`);
            return false;
        }

        // 既存の Observer があれば解除して置換
        const existing = window._trimPreview.previewCacheObservers.get(containerId);
        if (existing && existing.observer) {
            try { existing.observer.disconnect(); } catch (e) {}
        }

        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                const canvas = entry.target;
                const itemId = canvas?.dataset?.itemId;

                if (!entry.isIntersecting && itemId) {
                    // 表示領域外になったらキャッシュを破棄（安全呼び出し）
                    const store = window._trimPreview.previewCacheObservers.get(containerId);
                    if (store && store.dotNetRef) {
                        window._trimPreview.safeInvoke(store.dotNetRef, 'OnPreviewOutOfView', itemId);
                    }
                }
            });
        }, { rootMargin: '400px' });

        container.querySelectorAll('canvas[data-item-id]').forEach(canvas => observer.observe(canvas));

        // Observer と DotNetRef を保存
        window._trimPreview.previewCacheObservers.set(containerId, { observer, dotNetRef });

        return true;
    } catch (e) {
        console.error('registerPreviewCacheCleanup error', e);
        return false;
    }
};

// ========================================
// プレビューキャッシュクリーンアップの解除
// ========================================
window.unregisterPreviewCacheCleanup = function(containerId) {
    try {
        const entry = window._trimPreview.previewCacheObservers.get(containerId);
        if (entry) {
            try { if (entry.observer) entry.observer.disconnect(); } catch (e) {}
            entry.dotNetRef = null;
            window._trimPreview.previewCacheObservers.delete(containerId);
        }
        return true;
    } catch (e) {
        console.error('unregisterPreviewCacheCleanup error', e);
        return false;
    }
};

// ========================================
// TrimPreviewItem 可視監視（IntersectionObserver）
// ========================================
(function () {
    // 既存の observerMap を window._trimPreview.visibilityObservers に統合
    const observerMap = window._trimPreview.visibilityObservers;

    window.observeTrimPreviewVisibility = function (elementId, dotNetRef, rootMargin = '400px') {
        try {
            const element = document.getElementById(elementId);
            if (!element) {
                console.warn(`observeTrimPreviewVisibility: element not found: ${elementId}`);
                return false;
            }

            // 既存の Observer があれば解除
            if (observerMap.has(elementId)) {
                const existing = observerMap.get(elementId);
                try { existing.observer.disconnect(); } catch (e) {}
                observerMap.delete(elementId);
            }

            const observer = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    try {
                        const store = observerMap.get(elementId);
                        if (store && store.dotNetRef) {
                            window._trimPreview.safeInvoke(store.dotNetRef, 'OnVisibilityChanged', entry.isIntersecting);
                        }
                    } catch (e) {
                        console.error(`IntersectionObserver callback error for ${elementId}`, e);
                    }
                });
            }, {
                root: null,
                rootMargin: rootMargin,
                threshold: 0.01
            });

            observer.observe(element);
            observerMap.set(elementId, { observer, dotNetRef });

            return true;
        } catch (e) {
            console.error('observeTrimPreviewVisibility error', e);
            return false;
        }
    };

    window.unobserveTrimPreviewVisibility = function (elementId) {
        try {
            const entry = observerMap.get(elementId);
            if (entry && entry.observer) {
                try { entry.observer.disconnect(); } catch (e) {}
                if (entry) entry.dotNetRef = null;
                observerMap.delete(elementId);
            }
            return true;
        } catch (e) {
            console.error('unobserveTrimPreviewVisibility error', e);
            return false;
        }
    };
})();

// ========================================
// 一括解除: すべての Observer と DotNetRef をクリア
// ========================================
window.unregisterAllTrimPreview = function() {
    try {
        let count = 0;

        // プレビューキャッシュ Observer
        window._trimPreview.previewCacheObservers.forEach((v, k) => {
            try { if (v.observer) v.observer.disconnect(); } catch (e) {}
            if (v) v.dotNetRef = null;
            count++;
        });
        window._trimPreview.previewCacheObservers.clear();

        // 可視監視 Observer
        window._trimPreview.visibilityObservers.forEach((v, k) => {
            try { if (v.observer) v.observer.disconnect(); } catch (e) {}
            if (v) v.dotNetRef = null;
            count++;
        });
        window._trimPreview.visibilityObservers.clear();

        return true;
    } catch (e) {
        console.error('unregisterAllTrimPreview error', e);
        return false;
    }
};

// ========================================
// trimPreviewArea: スクロール・ページ移動関連
// ========================================
window.trimPreviewArea = window.trimPreviewArea || {
    dotNetRef: null,
    handlers: null,

    /**
     * 初期化: マウスイベントリスナーを登録
     */
    initialize: function (dotNetRef) {
        try {
            this.unregister && this.unregister();

            this.dotNetRef = dotNetRef;

            const onMouseMove = (e) => {
                try {
                    if (this.dotNetRef) this.dotNetRef.invokeMethodAsync('OnPanelMouseMove', e.clientX).catch(() => {});
                } catch (ex) { /* ignore */ }
            };
            const onMouseUp = (e) => {
                try {
                    if (this.dotNetRef) this.dotNetRef.invokeMethodAsync('OnPanelMouseUp').catch(() => {});
                } catch (ex) { /* ignore */ }
            };

            this.handlers = { onMouseMove, onMouseUp };

            document.addEventListener('mousemove', onMouseMove, { passive: true });
            document.addEventListener('mouseup', onMouseUp, { passive: true });

        } catch (e) {
            console.error('trimPreviewArea.initialize error', e);
        }
    },

    /**
     * 解除: イベントリスナーを削除
     */
    unregister: function () {
        try {
            if (this.handlers) {
                document.removeEventListener('mousemove', this.handlers.onMouseMove);
                document.removeEventListener('mouseup', this.handlers.onMouseUp);
                this.handlers = null;
            }
            this.dotNetRef = null;
        } catch (e) { 
            console.error('trimPreviewArea.unregister error', e); 
        }
    },

    /**
     * 画像の寸法を取得
     */
    getImageDimensions: function (imgId) {
        try {
            const img = document.getElementById(imgId);
            if (img) {
                return [img.offsetWidth, img.offsetHeight];
            }
            return [0, 0];
        } catch (e) {
            console.error('getImageDimensions error', e);
            return [0, 0];
        }
    },

    /**
     * 指定ページまでスムーズスクロール（Observer 一時停止機能付き）
     */
    scrollToPage: function (pageIndex) {
        try {
            // コンテナを取得（preview-zoom-viewport を優先）
            const container = document.querySelector('.preview-zoom-viewport') 
                           || document.getElementById('trim-preview-container');
            
            if (!container) {
                console.warn('scrollToPage: container not found');
                return false;
            }

            // ターゲット要素を取得
            const targetElement = document.getElementById(`preview-container-${pageIndex}`);
            if (!targetElement) {
                console.warn(`scrollToPage: element not found for index ${pageIndex}`);
                return false;
            }

            // ★ スクロール開始前に Observer を一時停止
            if (typeof window.pauseVisiblePageObserver === 'function') {
                window.pauseVisiblePageObserver();
            }

            // ★ スクロール完了後に Observer を再開 + 青枠を更新
            const onScrollEnd = () => {
                // Observer を再開
                if (typeof window.resumeVisiblePageObserver === 'function') {
                    window.resumeVisiblePageObserver();
                }

                // スクロール完了後に青枠を更新
                if (typeof window.selectThumbnailByIndex === 'function') {
                    window.selectThumbnailByIndex(pageIndex);
                }

                // イベントリスナーを削除
                container.removeEventListener('scrollend', onScrollEnd);
            };

            // scrollend イベントをリッスン（スクロール完了を検知）
            container.addEventListener('scrollend', onScrollEnd, { once: true });

            // フォールバック：scrollend が発火しない場合（古いブラウザ対応）
            setTimeout(() => {
                container.removeEventListener('scrollend', onScrollEnd);
                onScrollEnd();
            }, 1000);

            // スムーズスクロール実行
            targetElement.scrollIntoView({ 
                behavior: 'smooth', 
                block: 'start',
                inline: 'nearest'
            });

            return true;
        } catch (e) {
            console.error('scrollToPage error', e);
            // エラー時も Observer を再開
            if (typeof window.resumeVisiblePageObserver === 'function') {
                window.resumeVisiblePageObserver();
            }
            return false;
        }
    }
};

window.selectThumbnailByIndex = function(selectedIndex) {
    try {
        const container = document.getElementById('thumbnail-container');
        if (!container) {
            console.warn('selectThumbnailByIndex: thumbnail-container not found');
            return;
        }

        // ★ すべてのサムネイルから selected クラスを削除（排他制御）
        container.querySelectorAll('.trim-thumbnail-card').forEach(card => {
            const innerDiv = card.querySelector('.flex.flex-col');
            if (innerDiv) {
                innerDiv.classList.remove('selected', 'ring-2', 'ring-blue-500', 'bg-blue-50/40');
            }
        });

        // ★ 指定されたインデックスのサムネイルにのみ selected クラスを追加
        const targetCard = container.querySelector(`[data-thumb-index="${selectedIndex}"]`);
        if (targetCard) {
            const innerDiv = targetCard.querySelector('.flex.flex-col');
            if (innerDiv) {
                innerDiv.classList.add('selected', 'ring-2', 'ring-blue-500', 'bg-blue-50/40');
            }
        }
    } catch (e) {
        console.error('selectThumbnailByIndex error', e);
    }
};