// 指定input要素をクリックしてファイル選択ダイアログを開く（PDF挿入用）
window.openInsertFileDialog = function (elementId) {
    const fileInput = document.getElementById(elementId);
    if (fileInput) {
        fileInput.value = null; // 連続選択対応
        fileInput.click();
    }
};
window.openFileDialog = function (elementId) {
    const fileInput = document.getElementById(elementId);
    if (fileInput) {
        fileInput.click();
    }
};

window.createZipFromUrls = async function (urls, names) {
    await ensureJsZipLoaded();
    // JSZipの読み込み（CDN等でwindow.JSZipが使える前提）
    if (!window.JSZip) {
        throw new Error("JSZipがロードされていません。");
    }
    const zip = new JSZip();

    // 各PDFファイルを取得してzipに追加
    for (let i = 0; i < urls.length; i++) {
        const url = urls[i];
        const name = names[i] || `file${i + 1}.pdf`;
        try {
            const response = await fetch(url);
            const blob = await response.blob();
            const arrayBuffer = await blob.arrayBuffer();
            zip.file(name, arrayBuffer);
        } catch (e) {
            console.error(`ファイル取得失敗: ${name}`, e);
        }
    }

    // zip生成
    const zipBlob = await zip.generateAsync({ type: "blob" });
    const zipUrl = URL.createObjectURL(zipBlob);

    // zipファイルのURLを返す
    return zipUrl;
};

window.getZipFileSize = async function (zipUrl) {
    // Blob URLからファイルサイズを取得
    try {
        const response = await fetch(zipUrl);
        const blob = await response.blob();
        // サイズを人間が読みやすい形式で返す
        const size = blob.size;
        if (size < 1024) return `${size} bytes`;
        if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
        return `${(size / (1024 * 1024)).toFixed(2)} MB`;
    } catch (e) {
        console.error("zipファイルサイズ取得失敗", e);
        return "";
    }
};

async function ensureJsZipLoaded() {
    if (!window.JSZip) {
        await new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js";
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
        });
    }
}

window.downloadAllPdfsAsPngZip = async function (pdfUrls, pdfNames, zipName) {
    await ensureJsZipLoaded();
    const pdfjsLib = window.pdfjsLib;
    if (!pdfjsLib) {
        alert('PDF.jsがロードされていません');
        return;
    }
    pdfjsLib.GlobalWorkerOptions.workerSrc = '/lib/pdf.worker.mjs';

    const zip = new window.JSZip();

    for (let i = 0; i < pdfUrls.length; i++) {
        const pdfUrl = pdfUrls[i];
        const baseName = (pdfNames[i] || `file${i + 1}.pdf`).replace(/\.pdf$/i, '');

        try {
            const response = await fetch(pdfUrl);
            const arrayBuffer = await response.arrayBuffer();
            const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

            for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
                const page = await pdf.getPage(pageNum);
                const canvas = document.createElement('canvas');
                const viewport = page.getViewport({ scale: 2 });
                canvas.width = viewport.width;
                canvas.height = viewport.height;
                await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
                const dataUrl = canvas.toDataURL('image/png');
                zip.file(`${baseName}_page${pageNum}.png`, dataUrl.split(',')[1], { base64: true });
            }
        } catch (e) {
            console.error(`PDF変換失敗: ${baseName}`, e);
        }
    }

    const zipBlob = await zip.generateAsync({ type: 'blob' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(zipBlob);
    link.download = zipName || "images.zip";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
};