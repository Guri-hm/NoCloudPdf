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