window.embedImageAsPdf = async function (imageBase64, ext) {
    const { PDFDocument } = PDFLib;
    const pdfDoc = await PDFDocument.create();
    let img;
    const bytes = base64ToUint8Array(imageBase64);
    if (ext.endsWith('.png')) {
        img = await pdfDoc.embedPng(bytes);
    } else if (ext.endsWith('.jpg') || ext.endsWith('.jpeg')) {
        img = await pdfDoc.embedJpg(bytes);
    } else {
        throw new Error('Unsupported image type');
    }
    const imgDims = img.scale(1);
    const page = pdfDoc.addPage([imgDims.width, imgDims.height]);
    page.drawImage(img, { x: 0, y: 0, width: imgDims.width, height: imgDims.height });
    const pdfBytes = await pdfDoc.save();
    // base64エンコードして返す
    let binary = '';
    for (let i = 0; i < pdfBytes.length; i++) {
        binary += String.fromCharCode(pdfBytes[i]);
    }
    return btoa(binary);
};

function base64ToUint8Array(base64) {
    // 改行・空白除去
    const cleanBase64 = base64.replace(/[\r\n\s]/g, "");
    const binaryString = atob(cleanBase64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
}

// 結合
window.mergePDFPages = async function (pdfPageDataList) {
    const { PDFDocument, degrees } = PDFLib;
    const mergedPdf = await PDFDocument.create();

    for (let i = 0; i < pdfPageDataList.length; i++) {
        let pageInfo = pdfPageDataList[i];
        let pageData = pageInfo.pageData;

        let bytes;
        if (typeof pageData === 'string') {
            bytes = base64ToUint8Array(pageData);
        } else if (pageData instanceof Uint8Array) {
            bytes = pageData;
        } else if (Array.isArray(pageData)) {
            bytes = new Uint8Array(pageData);
        } else {
            throw new Error(`Unsupported pageData type at index ${i}: ${typeof pageData}`);
        }

        try {
            const pdfDoc = await PDFDocument.load(bytes);
            const [page] = await mergedPdf.copyPages(pdfDoc, [0]);

            // 回転値が指定されていれば反映
            if (typeof pageInfo === 'object' && pageInfo.rotateAngle && pageInfo.rotateAngle % 360 !== 0) {
                page.setRotation(degrees(pageInfo.rotateAngle));
                console.log(`→ setRotation(${pageInfo.rotateAngle}) 実行`);
            }

            mergedPdf.addPage(page);
        } catch (error) {
            console.error(`Error at mergePDFPages index=${i}:`, error, pageData);
            throw error;
        }
    }

    const mergedPdfBytes = await mergedPdf.save();
    const blob = new Blob([mergedPdfBytes], { type: 'application/pdf' });
    return URL.createObjectURL(blob);
};

window.renderPDFPages = async function (pdfData) {
    const pdfjsLib = window['pdfjs-dist/build/pdf'];
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.11.338/pdf.worker.min.js';

    const loadingTask = pdfjsLib.getDocument({ data: pdfData });
    const pdf = await loadingTask.promise;
    const pageImages = [];

    for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);

        const viewport = page.getViewport({ scale: 1 });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;

        const context = canvas.getContext('2d');
        const renderContext = {
            canvasContext: context,
            viewport: viewport,
        };

        await page.render(renderContext).promise;

        // Canvasを画像データとして取征E
        const imageData = canvas.toDataURL('image/png');
        pageImages.push(imageData);
    }

    return pageImages;
};

// 高速読み込み用 - 最初のページのサムネイルのみ生成
window.renderFirstPDFPage = async function (pdfData) {
    try {
        // BlazorからのデータがUint8Arrayかどうかチェック
        let uint8Array;
        if (pdfData instanceof Uint8Array) {
            uint8Array = pdfData;
        } else if (Array.isArray(pdfData)) {
            uint8Array = new Uint8Array(pdfData);
        } else if (typeof pdfData === 'string') {
            const binaryString = atob(pdfData);
            uint8Array = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
                uint8Array[i] = binaryString.charCodeAt(i);
            }
        } else {
            uint8Array = new Uint8Array(pdfData);
        }

        if (uint8Array.length < 8) {
            throw new Error('Data too short to be valid PDF');
        }

        const header = String.fromCharCode.apply(null, uint8Array.slice(0, 8));
        if (!header.startsWith('%PDF-')) {
            throw new Error(`Invalid PDF header: ${header}`);
        }

        const pdfjsLib = window['pdfjs-dist/build/pdf'];
        if (!pdfjsLib) {
            throw new Error('PDF.js library not loaded');
        }

        if (pdfjsLib.GlobalWorkerOptions) {
            pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.11.338/pdf.worker.min.js';
        } else if (pdfjsLib.workerSrc) {
            pdfjsLib.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.11.338/pdf.worker.min.js';
        }

        if (uint8Array.length < 1024) {
            throw new Error('PDF file is too small to be valid');
        }

        const loadingOptions = [
            {
                data: uint8Array,
                stopAtErrors: false,
                maxImageSize: 1024 * 1024 * 5,
                disableFontFace: true,
                disableRange: true,
                disableStream: true,
                verbosity: 1
            },
            {
                data: uint8Array,
                stopAtErrors: false,
                maxImageSize: 1024 * 1024 * 10,
                disableFontFace: false,
                disableRange: true,
                disableStream: false,
                verbosity: 1
            },
            {
                data: uint8Array,
                stopAtErrors: false,
                verbosity: 1
            }
        ];

        let pdf = null;
        let lastError = null;

        for (let i = 0; i < loadingOptions.length; i++) {
            try {
                const loadingTask = pdfjsLib.getDocument(loadingOptions[i]);
                pdf = await loadingTask.promise;
                break;
            } catch (error) {
                lastError = error;
                if (i === loadingOptions.length - 1) {
                    throw lastError;
                }
            }
        }

        if (!pdf) {
            throw new Error('Failed to load PDF with all options');
        }

        const page = await pdf.getPage(1);
        const viewport = page.getViewport({ scale: 1 });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;

        const context = canvas.getContext('2d');
        const renderContext = {
            canvasContext: context,
            viewport: viewport,
        };

        await page.render(renderContext).promise;
        const result = canvas.toDataURL('image/png');
        return result;
    } catch (error) {
        console.error('Error in renderFirstPDFPage:', error);
        throw error;
    }
};

// 指定したページのサムネイルを生成
window.renderPDFPage = async function (pdfData, pageIndex) {
    try {
        let uint8Array;
        if (pdfData instanceof Uint8Array) {
            uint8Array = pdfData;
        } else if (Array.isArray(pdfData)) {
            uint8Array = new Uint8Array(pdfData);
        } else if (typeof pdfData === 'string') {
            const binaryString = atob(pdfData);
            uint8Array = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
                uint8Array[i] = binaryString.charCodeAt(i);
            }
        } else {
            uint8Array = new Uint8Array(pdfData);
        }

        const pdfjsLib = window['pdfjs-dist/build/pdf'];
        if (!pdfjsLib) {
            throw new Error('PDF.js library not loaded');
        }

        if (pdfjsLib.GlobalWorkerOptions) {
            pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.11.338/pdf.worker.min.js';
        }

        const loadingOptions = [
            {
                data: uint8Array,
                stopAtErrors: false,
                maxImageSize: 1024 * 1024 * 5,
                disableFontFace: true,
                disableRange: true,
                disableStream: true,
                verbosity: 1
            },
            {
                data: uint8Array,
                stopAtErrors: false,
                maxImageSize: 1024 * 1024 * 10,
                disableFontFace: false,
                disableRange: true,
                disableStream: false,
                verbosity: 1
            },
            {
                data: uint8Array,
                stopAtErrors: false,
                verbosity: 1
            }
        ];

        let pdf = null;
        let lastError = null;

        for (let i = 0; i < loadingOptions.length; i++) {
            try {
                const loadingTask = pdfjsLib.getDocument(loadingOptions[i]);
                pdf = await loadingTask.promise;
                break;
            } catch (error) {
                lastError = error;
                if (i === loadingOptions.length - 1) {
                    throw lastError;
                }
            }
        }

        if (!pdf) {
            throw new Error('Failed to load PDF with all options');
        }

        if (pageIndex >= pdf.numPages) {
            return '';
        }

        const page = await pdf.getPage(pageIndex + 1);
        const viewport = page.getViewport({ scale: 0.5 });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;

        const context = canvas.getContext('2d');
        const renderContext = {
            canvasContext: context,
            viewport: viewport,
            intent: 'display'
        };

        const renderTask = page.render(renderContext);
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Rendering timeout')), 10000);
        });

        await Promise.race([renderTask.promise, timeoutPromise]);
        return canvas.toDataURL('image/png');

    } catch (error) {
        console.error(`Error rendering PDF page ${pageIndex}:`, error);
        try {
            const canvas = document.createElement('canvas');
            canvas.width = 200;
            canvas.height = 280;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = 'white';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = '#dc2626';
            ctx.font = '14px Arial';
            ctx.textAlign = 'center';
            ctx.fillText('読み込みエラー', canvas.width / 2, canvas.height / 2 - 10);
            ctx.font = '10px Arial';
            ctx.fillText(`ペーEジ ${pageIndex + 1}`, canvas.width / 2, canvas.height / 2 + 10);
            ctx.strokeStyle = '#fca5a5';
            ctx.lineWidth = 2;
            ctx.strokeRect(5, 5, canvas.width - 10, canvas.height - 10);
            return canvas.toDataURL('image/png');
        } catch (fallbackError) {
            console.error('Error creating fallback image:', fallbackError);
            return '';
        }
    }
};

// PDFのページ数のみ取得
window.getPDFPageCount = async function (pdfData) {
    try {
        let uint8Array;
        if (pdfData instanceof Uint8Array) {
            uint8Array = pdfData;
        } else if (Array.isArray(pdfData)) {
            uint8Array = new Uint8Array(pdfData);
        } else if (typeof pdfData === 'string') {
            const binaryString = atob(pdfData);
            uint8Array = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
                uint8Array[i] = binaryString.charCodeAt(i);
            }
        } else {
            uint8Array = new Uint8Array(pdfData);
        }

        const pdfjsLib = window['pdfjs-dist/build/pdf'];
        if (!pdfjsLib) {
            throw new Error('PDF.js library not loaded');
        }

        if (pdfjsLib.GlobalWorkerOptions) {
            pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.11.338/pdf.worker.min.js';
        }

        const loadingTask = pdfjsLib.getDocument({
            data: uint8Array,
            stopAtErrors: false,
            verbosity: 1
        });
        const pdf = await loadingTask.promise;
        return pdf.numPages;
    } catch (error) {
        console.error('Error in getPDFPageCount:', error);
        throw error;
    }
};

// 持ち込んだページを個別のPDFデータとして抽出する関数
window.extractPDFPage = async function (pdfData, pageIndex) {
    try {

        const { PDFDocument } = PDFLib;
        if (!PDFDocument) {
            throw new Error('PDF-lib library not loaded');
        }

        // BlazorからのデータがUint8Arrayかどうかチェック
        let uint8Array;
        if (pdfData instanceof Uint8Array) {
            uint8Array = pdfData;
        } else if (Array.isArray(pdfData)) {
            uint8Array = new Uint8Array(pdfData);
        } else if (typeof pdfData === 'string') {
            const binaryString = atob(pdfData);
            uint8Array = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
                uint8Array[i] = binaryString.charCodeAt(i);
            }
        } else {
            uint8Array = new Uint8Array(pdfData);
        }

        const pdfDoc = await PDFDocument.load(uint8Array);

        // ページ数チェック
        if (pageIndex >= pdfDoc.getPageCount()) {
            console.warn(`Page index ${pageIndex} is out of range (total pages: ${pdfDoc.getPageCount()})`);
            // エラー時は空白ページを作成
            const blankPdf = await PDFDocument.create();
            // A4サイズの空白ページ
            blankPdf.addPage([595.28, 841.89]);
            const pdfBytes = await blankPdf.save();

            let binary = '';
            for (let j = 0; j < pdfBytes.length; j++) {
                binary += String.fromCharCode(pdfBytes[j]);
            }
            return btoa(binary);
        }

        const newPdf = await PDFDocument.create();

        try {
            const [copiedPage] = await newPdf.copyPages(pdfDoc, [pageIndex]);
            newPdf.addPage(copiedPage);
        } catch (copyError) {
            console.warn(`Failed to copy page ${pageIndex}, creating blank page:`, copyError);
            // ページコピーに失敗した場合は空白ページを追加
            newPdf.addPage([595.28, 841.89]);
        }

        const pdfBytes = await newPdf.save();

        // base64エンコード
        let binary = '';
        for (let j = 0; j < pdfBytes.length; j++) {
            binary += String.fromCharCode(pdfBytes[j]);
        }

        return btoa(binary);

    } catch (error) {
        console.error(`Error extracting PDF page ${pageIndex}:`, error);

        // 完全にエラーが発生した場合は空白PDFを作成
        try {
            const { PDFDocument } = PDFLib;
            const blankPdf = await PDFDocument.create();
            blankPdf.addPage([595.28, 841.89]); // A4サイズの空白ペ�Eジ
            const pdfBytes = await blankPdf.save();

            let binary = '';
            for (let j = 0; j < pdfBytes.length; j++) {
                binary += String.fromCharCode(pdfBytes[j]);
            }

            console.log(`Created blank PDF for failed page ${pageIndex}`);
            return btoa(binary);
        } catch (fallbackError) {
            console.error('Error creating fallback blank PDF:', fallbackError);
            return '';
        }
    }
};

// PDFの各ページを個別のPDFデータとして抽出する関数
window.extractPDFPages = async function (pdfData) {
    try {
        const { PDFDocument } = PDFLib;
        const pdfDoc = await PDFDocument.load(new Uint8Array(pdfData));
        const pageDataList = [];

        for (let i = 0; i < pdfDoc.getPageCount(); i++) {
            const newPdf = await PDFDocument.create();
            const [copiedPage] = await newPdf.copyPages(pdfDoc, [i]);
            newPdf.addPage(copiedPage);

            const pdfBytes = await newPdf.save();

            // スプレッド演算子を使わずにbase64エンコード
            let binary = '';
            for (let j = 0; j < pdfBytes.length; j++) {
                binary += String.fromCharCode(pdfBytes[j]);
            }
            const base64String = btoa(binary);
            pageDataList.push(base64String);
        }

        return pageDataList;
    } catch (error) {
        console.error('Error extracting PDF pages:', error);
        return [];
    }
};

// PDFページを回転する関数
window.rotatePDFPage = async function (pageData, angle) {
    try {
        const { PDFDocument, degrees } = PDFLib;
        const binaryString = atob(pageData);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }

        const pdfDoc = await PDFDocument.load(bytes);
        const pages = pdfDoc.getPages();

        if (pages.length > 0) {
            const page = pages[0];
            // 現在の回転角度を取得し、angle加算
            const currentRotation = page.getRotation().angle;
            page.setRotation(degrees((currentRotation + angle) % 360));
        }

        const pdfBytes = await pdfDoc.save();

        let binary = '';
        for (let j = 0; j < pdfBytes.length; j++) {
            binary += String.fromCharCode(pdfBytes[j]);
        }
        const base64String = btoa(binary);
        return base64String;
    } catch (error) {
        console.error('Error rotating PDF page:', error);
        return null;
    }
};

// 非同期でページごとにサムネイルを生成する関数
window.renderPDFPagesAsync = async function (pdfData, dotNetRef) {
    const pdfjsLib = window['pdfjs-dist/build/pdf'];
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.11.338/pdf.worker.min.js';

    try {
        const loadingTask = pdfjsLib.getDocument({ data: pdfData });
        const pdf = await loadingTask.promise;

        console.log(`Starting async rendering for ${pdf.numPages} pages`);

        // 各ページを順番に処理
        for (let i = 1; i <= pdf.numPages; i++) {
            try {
                const page = await pdf.getPage(i);
                const viewport = page.getViewport({ scale: 1 });
                const canvas = document.createElement('canvas');
                canvas.width = viewport.width;
                canvas.height = viewport.height;

                const context = canvas.getContext('2d');
                const renderContext = {
                    canvasContext: context,
                    viewport: viewport,
                };

                await page.render(renderContext).promise;
                const imageData = canvas.toDataURL('image/png');

                // DotNetObjectReferenceのメソッドを呼び出す
                await dotNetRef.invokeMethodAsync('OnPageThumbnailReady', i - 1, imageData);

                console.log(`Page ${i} rendered and sent to Blazor`);

                // メモリ解放とUI更新のための短い遅延
                await new Promise(resolve => setTimeout(resolve, 10));

            } catch (pageError) {
                console.error(`Error rendering page ${i}:`, pageError);
                // エラーの場合もBlazorに通知
                await dotNetRef.invokeMethodAsync('OnPageThumbnailReady', i - 1, null);
            }
        }

        console.log('All pages rendered');
        return true;

    } catch (error) {
        console.error('Error in renderPDFPagesAsync:', error);
        return false;
    }
};

// 空白ページのPDFを作成
window.createBlankPage = async function () {
    try {
        const { PDFDocument, rgb } = PDFLib;
        const pdfDoc = await PDFDocument.create();
        const page = pdfDoc.addPage([595.28, 841.89]); // A4サイズ

        // 空白ページなので何も描画しない

        const pdfBytes = await pdfDoc.save();

        // base64エンコーディング
        let binary = '';
        for (let i = 0; i < pdfBytes.length; i++) {
            binary += String.fromCharCode(pdfBytes[i]);
        }
        return btoa(binary);
    } catch (error) {
        console.error('Error creating blank page:', error);
        return '';
    }
};

// 単一PDFページをレンダリング
window.renderSinglePDFPage = async function (pdfData) {
    try {
        const pdfjsLib = window['pdfjs-dist/build/pdf'];
        pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.11.338/pdf.worker.min.js';

        // base64文字列をUint8Arrayに変換
        const binaryString = atob(pdfData);
        const uint8Array = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            uint8Array[i] = binaryString.charCodeAt(i);
        }

        const loadingTask = pdfjsLib.getDocument({ data: uint8Array });
        const pdf = await loadingTask.promise;

        const page = await pdf.getPage(1);
        const viewport = page.getViewport({ scale: 1 });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;

        const context = canvas.getContext('2d');
        const renderContext = {
            canvasContext: context,
            viewport: viewport,
        };

        await page.render(renderContext).promise;
        return canvas.toDataURL('image/png');
    } catch (error) {
        console.error('Error rendering single PDF page:', error);
        return '';
    }
};

// 回転角度を指定してPDFプレビュー画像を生成
window.generatePreviewImage = async function (pdfBase64, rotateAngle) {

    // base64文字列をUint8Arrayに変換
    const binaryString = atob(pdfBase64);
    const uint8Array = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
        uint8Array[i] = binaryString.charCodeAt(i);
    }

    // PDF読み込み
    const loadingTask = pdfjsLib.getDocument({ data: uint8Array });
    const pdf = await loadingTask.promise;
    const page = await pdf.getPage(1);

    // 回転角度を反映したviewportを作成
    const scale = 2.0; // 高画質用スケール
    const viewport = page.getViewport({ scale: scale, rotation: (rotateAngle || 0) });

    // canvas生成・描画
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const context = canvas.getContext('2d');
    await page.render({ canvasContext: context, viewport: viewport }).promise;

    // 画像データとして返す
    return canvas.toDataURL('image/jpeg', 0.85);
};

window.getPdfFileSize = async function (url) {
    const response = await fetch(url);
    const blob = await response.blob();
    // サイズをMB表記
    const sizeMB = (blob.size / (1024 * 1024)).toFixed(2) + "MB";
    return sizeMB;
};

window.downloadFileFromUrl = function (url, filename, mimeType) {
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.type = mimeType || 'application/octet-stream';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
};
window.downloadMergedPngOrZip = async function (pdfUrl, baseFileName, pageCount) {
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
    await ensureJsZipLoaded();
    // PDF.jsとJSZipが必要です
    const pdfjsLib = window['pdfjs-dist/build/pdf'];
    if (!pdfjsLib) {
        alert('PDF.jsがロードされていません');
        return;
    }
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.11.338/pdf.worker.min.js';

    const response = await fetch(pdfUrl);
    const arrayBuffer = await response.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

    if (pageCount <= 1) {
        // 1ページのみPNGでダウンロード
        const page = await pdf.getPage(1);
        const canvas = document.createElement('canvas');
        const viewport = page.getViewport({ scale: 2 });
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
        canvas.toBlob(blob => {
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = baseFileName.replace(/\.pdf$/i, '.png');
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }, 'image/png');
    } else {
        // 複数ページ: ZIPでダウンロード
        if (!window.JSZip) {
            alert('JSZipがロードされていません');
            return;
        }
        const zip = new window.JSZip();
        for (let i = 1; i <= pageCount; i++) {
            const page = await pdf.getPage(i);
            const canvas = document.createElement('canvas');
            const viewport = page.getViewport({ scale: 2 });
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
            const dataUrl = canvas.toDataURL('image/png');
            zip.file(`page${i}.png`, dataUrl.split(',')[1], { base64: true });
        }
        const zipBlob = await zip.generateAsync({ type: 'blob' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(zipBlob);
        link.download = baseFileName.replace(/\.pdf$/i, '.zip');
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }
};
window.registerOutsideClickForDownloadMenu = function (menuId, dotNetRef) {
    function handler(e) {
        const menu = document.getElementById(menuId);
        if (menu && !menu.contains(e.target)) {
            dotNetRef.invokeMethodAsync('CloseDownloadMenu');
            document.removeEventListener('mousedown', handler);
        }
    }
    setTimeout(() => { // メニュー表示直後のクリックを防ぐ
        document.addEventListener('mousedown', handler);
    }, 100);
};
window.renderPdfPages = async function (pdfUrl, canvasIds) {
    if (!window.pdfjsLib) {
        console.error("pdfjsLib is not loaded");
        return;
    }
    const pdf = await pdfjsLib.getDocument(pdfUrl).promise;
    for (let i = 0; i < canvasIds.length; i++) {
        const page = await pdf.getPage(i + 1);
        const canvas = document.getElementById(canvasIds[i]);
        if (!canvas) continue;
        const context = canvas.getContext('2d');
        // 元データサイズでviewportを取得
        const viewport = page.getViewport({ scale: 1 });
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await page.render({ canvasContext: context, viewport: viewport }).promise;
    }
};