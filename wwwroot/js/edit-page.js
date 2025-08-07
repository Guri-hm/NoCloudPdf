window.setupEditPage = (fileId, pageIndex) => {
    // PDF.jsを使用してPDFページを描画
    const canvas = document.getElementById(`pdf-canvas-${fileId}-${pageIndex}`);
    if (canvas) {
        const ctx = canvas.getContext('2d');
        // 仮のページ描画
        ctx.fillStyle = '#f8f9fa';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#000';
        ctx.font = '20px Arial';
        ctx.fillText(`PDF Page ${pageIndex + 1}`, 50, 50);
    }
};

window.triggerFileInput = (element) => {
    element.click();
};
