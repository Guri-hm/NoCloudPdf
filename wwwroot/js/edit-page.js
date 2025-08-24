let renderTask = null;

window.setupEditPage = async function (fileId, pageIndex, pageData, zoomLevel = 1.0) {
    try {
        const canvas = document.getElementById(`pdf-canvas-${fileId}-${pageIndex}`);
        if (!canvas || !pageData) return;

        const dpr = window.devicePixelRatio || 1;
        const bytes = Uint8Array.from(atob(pageData), c => c.charCodeAt(0));
        const pdfjsLib = window.pdfjsLib;
        if (!pdfjsLib) {
            console.error("pdfjsLib is not loaded");
            return;
        }
        const loadingTask = pdfjsLib.getDocument({ data: bytes });
        const pdf = await loadingTask.promise;
        const page = await pdf.getPage(1);

        // viewportはズーム倍率のみ反映
        const viewport = page.getViewport({ scale: zoomLevel });

        // canvasの物理サイズとCSSサイズを一致させる
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        canvas.style.width = viewport.width + "px";
        canvas.style.height = viewport.height + "px";

        const context = canvas.getContext('2d');
        context.setTransform(1, 0, 0, 1, 0, 0);

        // 前回の描画タスクがあればキャンセル
        if (window._pdfRenderTask && window._pdfRenderTask.cancel) {
            window._pdfRenderTask.cancel();
        }

        window._pdfRenderTask = page.render({ canvasContext: context, viewport: viewport });
        await window._pdfRenderTask.promise;
    } catch (err) {
        if (err && err.name === "RenderingCancelledException") {
            // ズーム連打や素早い操作で発生するため例外を握りつぶす
            return;
        }
        console.error("setupEditPage error:", err);
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

