let renderTask = null;

// ...existing code...
window.setupEditPage = async function (fileId, pageIndex, pageData, zoomLevel = 1.0) {
    try {
        console.debug("setupEditPage called", { fileId, pageIndex, len: pageData ? pageData.length : 0, zoomLevel });

        const pageEl = document.getElementById(`pdf-page-${fileId}-${pageIndex}`);
        const canvas = document.getElementById(`pdf-canvas-${fileId}-${pageIndex}`);
        if (!canvas) {
            console.error("setupEditPage: canvas not found", `pdf-canvas-${fileId}-${pageIndex}`);
            return;
        }
        if (!pageData) {
            console.error("setupEditPage: pageData empty");
            return;
        }

        // 親要素の表示幅（CSSピクセル）を取得して、それに合わせた scale を計算する
        const pageCssRect = pageEl ? pageEl.getBoundingClientRect() : canvas.getBoundingClientRect();
        const targetCssWidth = Math.max(1, Math.round(pageCssRect.width)); // 0回避
        const dpr = window.devicePixelRatio || 1;

        // pageData が data: URI の場合に base64 部分を抽出
        let rawBase64 = pageData;
        const m = /^data:.*;base64,(.*)$/.exec(pageData);
        if (m && m[1]) rawBase64 = m[1];

        let bytes;
        try {
            bytes = Uint8Array.from(atob(rawBase64), c => c.charCodeAt(0));
        } catch (e) {
            console.error("setupEditPage: atob failed (invalid base64?)", e);
            return;
        }

        const pdfjsLib = window.pdfjsLib;
        if (!pdfjsLib) {
            console.error("setupEditPage: pdfjsLib is not loaded");
            return;
        }

        // 前回の描画タスクをキャンセル（安全系）
        try {
            if (window._pdfRenderTask && window._pdfRenderTask.cancel) {
                window._pdfRenderTask.cancel();
            }
        } catch (e) {
            console.debug("setupEditPage: cancel previous render failed", e);
        }

        const loadingTask = pdfjsLib.getDocument({ data: bytes });
        const pdf = await loadingTask.promise;
        const page = await pdf.getPage(1);

        // デフォルト（scale=1）の幅を取得して、親要素幅に合わせる scale を決定
        const baseViewport = page.getViewport({ scale: 1.0 });
        const scaleToFit = targetCssWidth / baseViewport.width;
        const targetScale = scaleToFit * zoomLevel;

        const viewport = page.getViewport({ scale: targetScale });

        // CSS サイズ（表示サイズ）と内部バックバッファを設定（DPRを考慮）
        const cssWidth = Math.round(viewport.width);
        const cssHeight = Math.round(viewport.height);
        const backingW = Math.max(1, Math.round(cssWidth * dpr));
        const backingH = Math.max(1, Math.round(cssHeight * dpr));

        // 先に CSS サイズを適用してからバックバッファを設定（レンダリング前）
        canvas.style.width = cssWidth + "px";
        canvas.style.height = cssHeight + "px";
        canvas.width = backingW;
        canvas.height = backingH;

        const context = canvas.getContext('2d');

        // コンテキストを dpr でスケールして、viewport の CSS ピクセル基準で描画させる
        context.setTransform(dpr, 0, 0, dpr, 0, 0);
        context.clearRect(0, 0, cssWidth, cssHeight);

        // 描画タスクを保持して待機
        window._pdfRenderTask = page.render({ canvasContext: context, viewport: viewport });
        await window._pdfRenderTask.promise;
        console.debug("setupEditPage: render finished", { cssWidth, cssHeight, backingW, backingH });
    } catch (err) {
        if (err && err.name === "RenderingCancelledException") {
            console.debug("setupEditPage: render cancelled");
            return;
        }
        console.error("setupEditPage error:", err);
    }
};
// ...existing code...
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

