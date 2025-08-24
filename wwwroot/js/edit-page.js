let renderTask = null;

window.setupEditPage = async function (fileId, pageIndex, pageData, zoomLevel = 1.0) {
    try {
        const pageSelector = `#pdf-page-${fileId}-${pageIndex}`;
        const canvasSelector = `#pdf-canvas-${fileId}-${pageIndex}`;
        const pageEl = document.querySelector(pageSelector);
        const canvas = document.querySelector(canvasSelector);
        if (!canvas || !pageEl || !pageData) return;

        // 重要：まず親の実表示サイズに合わせて canvas の CSS/backing を確定する
        await window.syncCanvasCssToParentAndBacking(pageSelector, canvasSelector);

        // pageData が data:URI なら base64 部分を抽出
        let rawBase64 = pageData;
        const m = /^data:.*;base64,(.*)$/.exec(pageData);
        if (m && m[1]) rawBase64 = m[1];

        let bytes;
        try {
            bytes = Uint8Array.from(atob(rawBase64), c => c.charCodeAt(0));
        } catch (e) {
            console.error("setupEditPage: invalid base64", e);
            return;
        }

        const pdfjsLib = window.pdfjsLib;
        if (!pdfjsLib) { console.error("pdfjsLib not loaded"); return; }

        // cancel previous
        if (window._pdfRenderTask && window._pdfRenderTask.cancel) {
            try { window._pdfRenderTask.cancel(); } catch { }
        }

        const loadingTask = pdfjsLib.getDocument({ data: bytes });
        const pdf = await loadingTask.promise;
        const page = await pdf.getPage(1);

        // 親の実表示幅を再取得して viewport を決める（念のため）
        const rect = pageEl.getBoundingClientRect();
        const cssWidth = Math.max(1, Math.round(rect.width));
        const dpr = window.devicePixelRatio || 1;

        const baseViewport = page.getViewport({ scale: 1.0 });
        const targetScale = cssWidth / baseViewport.width * zoomLevel;
        const viewport = page.getViewport({ scale: targetScale });

        // 描画（canvas の backing は既に sync で設定済み）
        const ctx = canvas.getContext('2d');
        if (ctx) {
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.clearRect(0, 0, canvas.width, canvas.height);
        }

        window._pdfRenderTask = page.render({ canvasContext: ctx, viewport: viewport });
        await window._pdfRenderTask.promise;
    } catch (err) {
        if (err && err.name === "RenderingCancelledException") return;
        console.error("setupEditPage error", err);
    }
};

window.getTagNameFromEvent = function (e) {
    return e?.target?.tagName || "";
}

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

window.setPdfPageAndCanvasCssSize = function (pageSelector, canvasSelector, cssW, cssH) {
    const pageEl = document.querySelector(pageSelector);
    const canvas = document.querySelector(canvasSelector);
    if (!pageEl || !canvas) return;
    pageEl.style.width = cssW + "px";
    pageEl.style.height = cssH + "px";
    canvas.style.width = cssW + "px";
    canvas.style.height = cssH + "px";
};

window.syncCanvasCssToParentAndBacking = function (pageSelector, canvasSelector) {
    return new Promise((resolve) => {
        try {
            const pageEl = document.querySelector(pageSelector);
            const canvas = document.querySelector(canvasSelector);
            if (!pageEl || !canvas) return resolve(null);

            requestAnimationFrame(() => {
                const r = pageEl.getBoundingClientRect();
                const cssW = Math.max(1, Math.round(r.width));
                const cssH = Math.max(1, Math.round(r.height));

                // 表示を必ず親に揃える（これで見た目は一致する）
                canvas.style.width = cssW + "px";
                canvas.style.height = cssH + "px";

                // バックバッファは DPR を考慮して設定（描画前に行う）
                const dpr = window.devicePixelRatio || 1;
                const backingW = Math.max(1, Math.round(cssW * dpr));
                const backingH = Math.max(1, Math.round(cssH * dpr));
                if (canvas.width !== backingW || canvas.height !== backingH) {
                    canvas.width = backingW;
                    canvas.height = backingH;
                }

                // コンテキストのスケールをセット（常に dpr にする）
                const ctx = canvas.getContext('2d');
                if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

                resolve({ cssW, cssH, backingW, backingH });
            });
        } catch (e) {
            console && console.debug && console.debug("syncCanvasCssToParentAndBacking failed", e);
            resolve(null);
        }
    });
};