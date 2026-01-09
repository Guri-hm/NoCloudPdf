let renderTask = null;

window.getDevicePixelRatio = function() {
    return window.devicePixelRatio || 1;
};

window.getPageSourceInfo = async function (fileId, pageIndex, pageData) {
    try {
        if (!pageData) return null;
        // base64 の中身を取り出す（data:...;base64, を想定）
        let raw = pageData;
        const m = /^data:.*;base64,(.*)$/.exec(pageData);
        if (m && m[1]) raw = m[1];

        const dpr = window.getDevicePixelRatio();

        // try PDF
        try {
            const bytes = Uint8Array.from(atob(raw), c => c.charCodeAt(0));
            const pdf = await window.pdfjsLib.getDocument({
                data: bytes,
                standardFontDataUrl: pdfjsLib.GlobalWorkerOptions.standardFontDataUrl,
                wasmUrl: pdfjsLib.GlobalWorkerOptions.wasmUrl,
                openjpegJsUrl: pdfjsLib.GlobalWorkerOptions.openjpegJsUrl
            }).promise;
            const page = await pdf.getPage(1);
            const baseViewport = page.getViewport({ scale: 1.0 });
            return { origW: baseViewport.width, origH: baseViewport.height, dpr: dpr };
        } catch (pdfErr) {
            // not PDF -> try image
            try {
                const dataUrl = pageData;
                const img = await new Promise((res, rej) => {
                    const i = new Image();
                    i.onload = () => res(i);
                    i.onerror = rej;
                    i.src = dataUrl;
                });
                return { origW: img.naturalWidth, origH: img.naturalHeight, dpr: dpr };
            } catch (imgErr) {
                console.error("getPageSourceInfo: not pdf nor image", imgErr);
                return null;
            }
        }
    } catch (err) {
        console.error("getPageSourceInfo error", err);
        return null;
    }
};

window.drawPdfPageToCanvas = async function (id, pageData, zoomLevel = 1.0, rotateAngle) {
    try {
        const canvasSelector = `#pdf-canvas-${id}`;
        const canvas = document.querySelector(canvasSelector);
        if (!canvas || !pageData) return;

        // pageData base64
        let rawBase64 = pageData;
        const m = /^data:.*;base64,(.*)$/.exec(pageData);
        if (m && m[1]) rawBase64 = m[1];

        let bytes;
        try { bytes = Uint8Array.from(atob(rawBase64), c => c.charCodeAt(0)); } catch (e) { console.error("drawPdfPageToCanvas: invalid base64", e); return; }

        const pdfjsLib = window.pdfjsLib;
        if (!pdfjsLib) { console.error("pdfjsLib not loaded"); return; }

        if (window._pdfRenderTask && window._pdfRenderTask.cancel) { try { window._pdfRenderTask.cancel(); } catch { } }

        const loadingTask = pdfjsLib.getDocument({
            data: bytes,
            cMapUrl: pdfjsLib.GlobalWorkerOptions.cMapUrl,
            cMapPacked: pdfjsLib.GlobalWorkerOptions.cMapPacked,
            standardFontDataUrl: pdfjsLib.GlobalWorkerOptions.standardFontDataUrl,
            wasmUrl: pdfjsLib.GlobalWorkerOptions.wasmUrl,
            openjpegJsUrl: pdfjsLib.GlobalWorkerOptions.openjpegJsUrl
        });
        const pdf = await loadingTask.promise;
        const page = await pdf.getPage(1);

        // 回転・ズームを反映したviewport
        const dpr = window.getDevicePixelRatio();
        const effectiveDpr = zoomLevel < 1 ? 1 : dpr;
        const targetScale = zoomLevel * effectiveDpr;
        const viewport = page.getViewport({ scale: targetScale, rotation: rotateAngle });

        canvas.width = Math.round(viewport.width);
        canvas.height = Math.round(viewport.height);
        // オフスクリーンcanvasでPDFを描画
        const off = document.createElement('canvas');
        off.width = Math.max(1, Math.round(viewport.width));
        off.height = Math.max(1, Math.round(viewport.height));
        const offCtx = off.getContext('2d');
        if (offCtx && offCtx.setTransform) offCtx.setTransform(1, 0, 0, 1, 0, 0);

        window._pdfRenderTask = page.render({ canvasContext: offCtx, viewport: viewport });
        await window._pdfRenderTask.promise;

        // メインcanvasに転送
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // 中央に配置
        const dx = Math.round((canvas.width - off.width) / 2);
        const dy = Math.round((canvas.height - off.height) / 2);
        ctx.drawImage(off, 0, 0, off.width, off.height, dx, dy, off.width, off.height);

        // CSSズーム用のtransform（必要なら）
        if (ctx.setTransform) ctx.setTransform(effectiveDpr, 0, 0, effectiveDpr, 0, 0);
    } catch (err) {
        if (err && err.name === "RenderingCancelledException") return;
        console.error("drawPdfPageToCanvas error", err);
    }
};

window.getTagNameFromEvent = function (e) {
    // e.target.tagName を返す
    return e && e.target && e.target.tagName ? e.target.tagName : "";
};

window.getCanvasCoords = function (canvasSelector, clientX, clientY, offsetX, offsetY, zoomLevel) {
    const canvas = document.querySelector(canvasSelector);
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    // offsetX/offsetYはtransformで既に反映済みなので引かない！
    const x = (clientX - rect.left) / zoomLevel;
    const y = (clientY - rect.top) / zoomLevel;
    return { x, y };
};

window.triggerFileInput = (element) => {
    element.click();
};
window.clearFileInput = function (element) {
    if (element) element.value = "";
};

window.registerGlobalMouseUp = function (dotNetHelper) {
    window._blazorMouseUpHandler = function (e) {
        dotNetHelper.invokeMethodAsync('OnGlobalMouseUp');
    };
    window.addEventListener('mouseup', window._blazorMouseUpHandler);
};
window.unregisterGlobalMouseUp = function () {
    if (window._blazorMouseUpHandler) {
        window.removeEventListener('mouseup', window._blazorMouseUpHandler);
        window._blazorMouseUpHandler = null;
    }
};

window.registerGlobalMouseMove = function (dotNetRef) {
    window._globalMouseMoveHandler = function (e) {
        dotNetRef.invokeMethodAsync('OnGlobalMouseMove', {
            clientX: e.clientX,
            clientY: e.clientY
        });
    };
    window.addEventListener('mousemove', window._globalMouseMoveHandler);
};
window.unregisterGlobalMouseMove = function () {
    if (window._globalMouseMoveHandler) {
        window.removeEventListener('mousemove', window._globalMouseMoveHandler);
        window._globalMouseMoveHandler = null;
    }
};

window.getElementRect = function (selector) {
    const el = document.querySelector(selector);
    if (!el) return { left: 0, top: 0, width: 0, height: 0 };
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
};

window.waitForNextFrame = function () {
    return new Promise(resolve => requestAnimationFrame(resolve));
};

window.measureMaxLineWidth = function (text, fontSize, fontFamily) {
    const canvas = window._measureTextCanvas || (window._measureTextCanvas = document.createElement("canvas"));
    const ctx = canvas.getContext("2d");
    ctx.font = `${fontSize}px ${fontFamily}`;
    const lines = text.split('\n');
    let maxWidth = 0;
    for (const line of lines) {
        const w = ctx.measureText(line).width;
        if (w > maxWidth) maxWidth = w;
    }
    return maxWidth;
};

window.selectAllTextarea = function (ref) {
    if (!ref) return;
    ref.select();
};

window.autoResizeTextarea = function (ref) {
    try {
        const resolveEl = (r) => {
            if (!r) return null;
            if (typeof r === "string") return document.getElementById(r);
            if (r instanceof HTMLElement) return r;
            return r;
        };
        const el = resolveEl(ref);
        if (!el || !el.style) {
            console.debug("autoResizeTextarea: element not found:", ref);
            return 0; // 常に数値を返す
        }

        return new Promise((resolve) => {
            requestAnimationFrame(() => {
                try {
                    el.style.height = "auto";
                    void el.getBoundingClientRect();
                    const cs = window.getComputedStyle(el);
                    const lineH = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) || 16;
                    const contentH = Math.max(el.scrollHeight || 0, lineH);
                    const textareaH = Math.ceil(contentH + 2);
                    el.style.height = textareaH + "px";
                    el.style.overflow = "hidden";

                    // 親の枠（border）を加算して返す（存在しなければ 0 区分）
                    let parentBorderV = 0;
                    try {
                        const parent = el.closest && el.closest(".edit-element");
                        if (parent) {
                            const pcs = window.getComputedStyle(parent);
                            parentBorderV = (parseFloat(pcs.borderTopWidth) || 0) + (parseFloat(pcs.borderBottomWidth) || 0);
                        }
                    } catch (e) { /* ignore */ }

                    const totalParentPx = textareaH + parentBorderV;
                    resolve(totalParentPx || 0);
                } catch (err) {
                    console.error("autoResizeTextarea inner error", err);
                    resolve(0);
                }
            });
        });
    } catch (err) {
        console.error("autoResizeTextarea error", err);
        return 0;
    }
};

// 画像のBase64からサイズ取得
window.getImageSizeFromBase64 = function (base64) {
    return new Promise(resolve => {
        const img = new Image();
        img.onload = function () {
            resolve({ width: img.width, height: img.height });
        };
        img.src = base64;
    });
};