let renderTask = null;

window.getPageSourceInfo = async function (fileId, pageIndex, pageData) {
    try {
        if (!pageData) return null;
        // base64 の中身を取り出す（data:...;base64, を想定）
        let raw = pageData;
        const m = /^data:.*;base64,(.*)$/.exec(pageData);
        if (m && m[1]) raw = m[1];

        const dpr = window.devicePixelRatio || 1;

        // try PDF
        try {
            const bytes = Uint8Array.from(atob(raw), c => c.charCodeAt(0));
            const pdf = await window.pdfjsLib.getDocument({ data: bytes }).promise;
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

window.drawPdfPageToCanvas = async function (id, pageData, zoomLevel = 1.0) {
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

        const loadingTask = pdfjsLib.getDocument({ data: bytes, standardFontDataUrl: './lib/standard_fonts/' });
        const pdf = await loadingTask.promise;
        const page = await pdf.getPage(1);

        const baseViewport = page.getViewport({ scale: 1.0 });
        const dpr = window.devicePixelRatio || 1;

        // 画質調整: zoomLevelが小さい場合はdprも下げる
        // 例: zoomLevel < 1 のときは dpr = 1
        const effectiveDpr = zoomLevel < 1 ? 1 : dpr;

        // canvasの物理サイズを設定
        canvas.width = Math.round(baseViewport.width * zoomLevel * effectiveDpr);
        canvas.height = Math.round(baseViewport.height * zoomLevel * effectiveDpr);

        // PDFのviewportもzoomLevelとdprを反映
        const targetScale = zoomLevel * effectiveDpr;
        const viewport = page.getViewport({ scale: targetScale });

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

window.readImageAsBase64 = function (input, dotNetRef) {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function (e) {
        const img = new Image();
        img.onload = function () {
            dotNetRef.invokeMethodAsync('OnImageBase64Loaded', e.target.result, img.width, img.height);
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
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
    if (!ref) return;
    ref.style.height = "1px";
    const fontSize = parseFloat(window.getComputedStyle(ref).fontSize);
    const value = ref.value || "";
    const lines = value.split('\n');
    if (value.trim() === "") {
        // 空文字ならfontSizeで高さを強制
        ref.style.height = fontSize + "px";
    } else if (lines.length === 1) {
        // 1行ならfontSizeで高さを強制
        ref.style.height = fontSize + "px";
    } else {
        // 複数行ならscrollHeight
        ref.style.height = Math.max(ref.scrollHeight, fontSize) + "px";
    }
};