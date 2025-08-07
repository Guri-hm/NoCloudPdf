window.setupEditPage = async function (fileId, pageIndex, pageData) {
    const canvas = document.getElementById(`pdf-canvas-${fileId}-${pageIndex}`);
    if (!canvas || !pageData) return;

    const bytes = Uint8Array.from(atob(pageData), c => c.charCodeAt(0));
    const pdfjsLib = window.pdfjsLib;
    const loadingTask = pdfjsLib.getDocument({ data: bytes });
    const pdf = await loadingTask.promise;
    const page = await pdf.getPage(1); // 1ページ目のみ描画

    const viewport = page.getViewport({ scale: 1.0 });
    canvas.width = viewport.width;
    canvas.height = viewport.height;

    const context = canvas.getContext('2d');
    await page.render({ canvasContext: context, viewport: viewport }).promise;
};

window.triggerFileInput = (element) => {
    element.click();
};
