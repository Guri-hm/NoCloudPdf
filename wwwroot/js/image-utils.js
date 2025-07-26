window.rotateImage = async function (imageUrl) {
    const img = new Image();
    img.src = imageUrl;

    await new Promise((resolve) => {
        img.onload = resolve;
    });

    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');

    canvas.width = img.height; // 回転後の幅
    canvas.height = img.width; // 回転後の高さ

    context.translate(canvas.width / 2, canvas.height / 2);
    context.rotate(Math.PI / 2); // 90度回転
    context.drawImage(img, -img.width / 2, -img.height / 2);

    return canvas.toDataURL('image/png');
};
window.drawImageToCanvas = function (canvasId, imageUrl) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const img = new window.Image();
    img.onload = function () {
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // 枠いっぱいにアスペクト比を保って描画
        const scale = Math.min(canvas.width / img.width, canvas.height / img.height);
        const drawWidth = img.width * scale;
        const drawHeight = img.height * scale;
        ctx.drawImage(img,
            (canvas.width - drawWidth) / 2,
            (canvas.height - drawHeight) / 2,
            drawWidth, drawHeight);
    };
    img.src = imageUrl;
};