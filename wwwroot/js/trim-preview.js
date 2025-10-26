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
                        console.log("矩形削除:複数矩形");
                        
                        window.drawTrimOverlayAsSvg(canvasId, rectsToRender);
                    }
                    if (trimState.dotNetRef?.invokeMethodAsync) {
                        trimState.dotNetRef.invokeMethodAsync('CommitMultipleRectsFromJs', rectsToRender).catch(() => {});
                    }
                } else {
                    // 単一矩形時: 全削除
                    trimState.selected = false;
                    trimState.currentRectPx = null;
                    trimState.currentRectsPx = [];
                    if (trimState.dotNetRef?.invokeMethodAsync) {
                        trimState.dotNetRef.invokeMethodAsync('ClearTrimRectFromJs').catch(() => {});
                    }
                    if (window.drawTrimOverlayAsSvg) {
                        console.log("矩形削除:単一矩形");
                        
                        window.drawTrimOverlayAsSvg(canvasId, []);
                    }
                }
            } catch (e) { console.error('removeRectAt error', e); }
        }

        // SVGコンテナを準備（既存または新規作成）
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

        // コンテナを Canvas と同じ位置・サイズに配置
        container.style.left = relLeft + 'px';
        container.style.top = relTop + 'px';
        container.style.width = cssW + 'px';
        container.style.height = cssH + 'px';

        // SVG 要素を準備（初回のみ作成）
        let svg = container.querySelector('svg');
        if (!svg) {
            svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.setAttribute('width', '100%');
            svg.setAttribute('height', '100%');
            svg.setAttribute('viewBox', `0 0 ${cssW} ${cssH}`);
            svg.setAttribute('preserveAspectRatio', 'none');
            svg.style.pointerEvents = 'none';
            container.appendChild(svg);
        }

        // 既存の子要素をクリア
        while (svg.firstChild) svg.removeChild(svg.firstChild);

        // グローバルトリム状態の初期化
        window._simpleTrim = window._simpleTrim || {};
        if (!window._simpleTrim[canvasId]) window._simpleTrim[canvasId] = {};
        const trimState = window._simpleTrim[canvasId];

        // 矩形なし → 空のオーバーレイのみ配置して終了
        if (!Array.isArray(rects) || rects.length === 0) {
            trimState.overlayDom = container;
            trimState.currentRectPx = null;
            trimState.currentRectsPx = [];
            container.style.pointerEvents = 'none';
            svg.style.pointerEvents = 'none';
            return true;
        }

        // 矩形あり → 描画処理
        container.style.pointerEvents = 'auto';
        svg.style.pointerEvents = 'auto';

        // 複数矩形を順次描画
        rects.forEach((rect, rectIndex) => {
            console.log(`Drawing rect ${rectIndex}:`, rect);
            const normX = Number(rect.X ?? rect.x ?? 0);
            const normY = Number(rect.Y ?? rect.y ?? 0);
            const normW = Number(rect.Width ?? rect.width ?? 0);
            const normH = Number(rect.Height ?? rect.height ?? 0);

            // 正規化座標 → ピクセル座標
            const rectX = Math.round(normX * cssW);
            const rectY = Math.round(normY * cssH);
            const rectW = Math.round(normW * cssW);
            const rectH = Math.round(normH * cssH);

            const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            g.setAttribute('data-rect-index', String(rectIndex)); // 矩形識別用

            // 背景（透明、イベント無視）
            const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            bg.setAttribute('x', '0');
            bg.setAttribute('y', '0');
            bg.setAttribute('width', String(cssW));
            bg.setAttribute('height', String(cssH));
            bg.setAttribute('fill', 'transparent');
            bg.style.pointerEvents = 'none';
            g.appendChild(bg);

            // メイン矩形（塗り + 枠）
            const mainRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            mainRect.setAttribute('x', String(rectX));
            mainRect.setAttribute('y', String(rectY));
            mainRect.setAttribute('width', String(Math.max(0, rectW)));
            mainRect.setAttribute('height', String(Math.max(0, rectH)));
            mainRect.setAttribute('fill', 'rgba(59,130,246,0.12)');

            // 選択判定（複数時は selectedRectIndex、単一時は selected フラグ）
            const isSelected = trimState.allowMultipleRects 
                ? (trimState.selectedRectIndex === rectIndex)
                : Boolean(trimState.selected);

            mainRect.setAttribute('stroke', isSelected ? 'rgba(37,99,235,1)' : 'rgba(59,130,246,0.95)');
            mainRect.setAttribute('stroke-width', isSelected ? '3' : '2');
            mainRect.setAttribute('data-rect', 'true');
            mainRect.setAttribute('data-rect-index', String(rectIndex));
            mainRect.style.pointerEvents = 'auto';
            mainRect.style.cursor = 'move';
            g.appendChild(mainRect);

            // リサイズハンドル（選択中の矩形のみ表示）
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

                // 削除ボタン（選択中のみ）
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

        // ピクセル座標を状態に保存
        if (!trimState.active) {
            trimState.overlayDom = container;
            trimState.currentRectsPx = rects.map(r => ({
                x: Number(r.X ?? r.x ?? 0) * cssW,
                y: Number(r.Y ?? r.y ?? 0) * cssH,
                w: Number(r.Width ?? r.width ?? 0) * cssW,
                h: Number(r.Height ?? r.height ?? 0) * cssH
            }));
            // 単一矩形互換用（最後の矩形）
            trimState.currentRectPx = trimState.currentRectsPx.length > 0 
                ? { ...trimState.currentRectsPx[trimState.currentRectsPx.length - 1] }
                : null;
        }

        // キーボードイベント登録（Delete で削除）
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

        // オーバーレイイベント登録（初回のみ）
        if (trimState.handlers && !container.__trimHooked) {
            const safeInvoke = (fn, ev) => { try { fn(ev); } catch (e) {} };
            trimState.internal.overlayPointerDown = (ev) => safeInvoke(trimState.handlers.pointerDown, ev);
            trimState.internal.overlayMove = (ev) => safeInvoke(trimState.handlers.overlayMove, ev);

            container.addEventListener('pointerdown', trimState.internal.overlayPointerDown, { passive: false, capture: true });
            container.addEventListener('touchstart', trimState.internal.overlayPointerDown, { passive: false, capture: true });
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

    function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

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
                safe.removeListener(overlayDom, 'touchstart', trimState.internal?.overlayPointerDown, true);
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

            const overlayDom = document.getElementById(canvasId + '-overlay-svg') || null;

            const trimState = {
                base: canvas,
                host,
                overlay,
                overlayDom, //キャンバス上に置かれた SVG オーバーレイ（DOM コンテナ）への参 
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
                        const rawX = Math.min(loc.x, trimState.startClientLocal.x);
                        const rawY = Math.min(loc.y, trimState.startClientLocal.y);
                        const rawW = Math.abs(loc.x - trimState.startClientLocal.x);
                        const rawH = Math.abs(loc.y - trimState.startClientLocal.y);

                        // 状態だけ更新（描画は下の changed 判定で一度だけ行う）
                        trimState.currentRectPx = { x: rawX, y: rawY, w: rawW, h: rawH };

                        let dispX = rawX < 0 ? 0 : rawX;
                        let dispY = rawY < 0 ? 0 : rawY;
                        let dispW = rawX < 0 ? Math.max(0, Math.min(trimState.startClientLocal.x - dispX, rawW)) : rawW;
                        let dispH = rawY < 0 ? Math.max(0, Math.min(trimState.startClientLocal.y - dispY, rawH)) : rawH;

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

                    // 変更があれば再描画（複数矩形対応）
                    if (trimState.currentRectPx) {
                        const changed = !prevRect ||
                                    prevRect.x !== trimState.currentRectPx.x ||
                                    prevRect.y !== trimState.currentRectPx.y ||
                                    prevRect.w !== trimState.currentRectPx.w ||
                                    prevRect.h !== trimState.currentRectPx.h;
                        if (changed && trimState.overlayDom && window.drawTrimOverlayAsSvg) {
                            if (trimState.allowMultipleRects && (trimState.mode === 'move' || trimState.mode === 'resize' || trimState.mode === 'draw')) {
                                // 複数矩形時：該当インデックスを更新して全体を再描画
                                if (trimState.mode === 'draw') {
                                    // 描画中は currentRectsPx に一時的に追加表示用の矩形を作る（描画後は上書きされる想定）
                                    const tempRects = [
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
                                    console.log("描画(集約):複数矩形");
                                    window.drawTrimOverlayAsSvg(canvasId, tempRects);
                                } else {
                                    if (trimState.selectedRectIndex >= 0 && trimState.selectedRectIndex < trimState.currentRectsPx.length) {
                                        trimState.currentRectsPx[trimState.selectedRectIndex] = { ...trimState.currentRectPx };
                                    }
                                    const rectsToRender = trimState.currentRectsPx.map(r => ({
                                        X: r.x / cssW, Y: r.y / cssH,
                                        Width: r.w / cssW, Height: r.h / cssH
                                    }));
                                    console.log("リサイズ/移動(集約):複数矩形");
                                    window.drawTrimOverlayAsSvg(canvasId, rectsToRender);
                                }
                            } else {
                                // 単一矩形時：既存動作
                                const norm = rectPxToNormalized(trimState.currentRectPx);
                                console.log("描画(集約):単一矩形");
                                window.drawTrimOverlayAsSvg(canvasId, [norm]);
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
                    console.log("描画開始:maybe-draw");
                    window.drawTrimOverlayAsSvg(canvasId, rectsToRender);
                }
            }

            // PointerDown: モード判定 & キャプチャ開始
            const onPointerDown = function (ev) {
                try {
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
                                console.log("矩形移動:複数矩形");
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
                                    console.log("矩形移動:単一矩形");

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
                                    // 新規描画 → 追加
                                    trimState.currentRectsPx.push(raw);
                                    trimState.selectedRectIndex = trimState.currentRectsPx.length - 1;
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

                                // ドラッグ確定後は非選択で再描画
                                if (trimState.didDrag) {
                                    trimState.selectedRectIndex = -1;
                                    console.log("確定:複数矩形");

                                    window.drawTrimOverlayAsSvg(canvasId, rectsToCommit);
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
                                        console.log("確定:単一矩形");
                                        window.drawTrimOverlayAsSvg(canvasId, [rectPxToNormalized(raw)]);
                                    }
                                }
                            }
                        } else {
                            if (trimState.overlayDom && window.drawTrimOverlayAsSvg) {
                                console.log("大きさ0矩形:クリア");

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
            canvas.addEventListener('touchstart', onTouchStart, { passive: false });

            if (canvas.style) canvas.style.cursor = 'crosshair';
            if (overlayDom?.style) overlayDom.style.cursor = 'crosshair';

            if (overlayDom) {
                overlayDom.style.pointerEvents = 'auto';
                overlayDom.addEventListener('pointerdown', onPointerDown, { passive: false, capture: true });
                overlayDom.addEventListener('touchstart', onTouchStart, { passive: false, capture: true });

                const onOverlayPointerMove = function (ev) {
                    const t = ev.target;
                    const handleAttr = t?.getAttribute?.('data-handle');
                    const rectAttr = t?.getAttribute?.('data-rect');

                    if (handleAttr !== null) {
                        const idx = Number(handleAttr);
                        const key = (Number.isFinite(idx) && idx >= 0 && idx < HANDLE_KEY_MAP.length) ? HANDLE_KEY_MAP[idx] : null;
                        overlayDom.style.cursor = key ? (HANDLE_CURSOR_MAP[key] || '') : '';
                    } else if (rectAttr !== null) {
                        overlayDom.style.cursor = 'move';
                    } else {
                        overlayDom.style.cursor = '';
                    }
                };
                trimState.handlers.overlayMove = onOverlayPointerMove;
                overlayDom.addEventListener('pointermove', onOverlayPointerMove, { passive: true, capture: true });
            }

            let scrollPending = false;
            function onAnyScrollOrResize() {
                if (trimState.active) {
                    trimState.internal.scrollPendingWhileActive = true;
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