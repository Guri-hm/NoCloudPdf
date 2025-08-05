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

// 高速読み込み用 - 最初のページのサムネイルのみ生成
window.renderFirstPDFPage = async function (pdfData, password) {
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

        const pdfjsLib = window.pdfjsLib;
        if (!pdfjsLib) {
            throw new Error('PDF.js library not loaded');
        }

        if (pdfjsLib.GlobalWorkerOptions) {
            pdfjsLib.GlobalWorkerOptions.workerSrc = '/lib/pdf.worker.mjs';
        } else if (pdfjsLib.workerSrc) {
            pdfjsLib.workerSrc = '/lib/pdf.worker.mjs';
        }

        if (uint8Array.length < 1024) {
            throw new Error('PDF file is too small to be valid');
        }

        // パスワード・セキュリティ情報取得用
        let isPasswordProtected = false;
        let isOperationRestricted = false;
        let securityInfo = "";
        let thumbnail = "";
        let pdf = null;
        let lastError = null;

        // 複数オプションでロードを試みる
        const loadingOptions = [
            { data: uint8Array, stopAtErrors: false, maxImageSize: 1024 * 1024 * 5, disableFontFace: true, disableRange: true, disableStream: true, verbosity: 1 },
            { data: uint8Array, stopAtErrors: false, maxImageSize: 1024 * 1024 * 10, disableFontFace: false, disableRange: true, disableStream: false, verbosity: 1 },
            { data: uint8Array, stopAtErrors: false, verbosity: 1 }
        ];

        for (let i = 0; i < loadingOptions.length; i++) {
            try {
                const loadingTask = pdfjsLib.getDocument({
                    ...loadingOptions[i],
                    password: password || undefined
                });
                loadingTask.onPassword = function (callback, reason) {
                    if (reason === pdfjsLib.PasswordResponses.NEED_PASSWORD) {
                        // パスワードが必要
                        throw new Error("PasswordException");
                    } else if (reason === pdfjsLib.PasswordResponses.INCORRECT_PASSWORD) {
                        // パスワードが間違っている
                        console.log(`パスワードが間違っています。`)
                        throw new Error("PasswordException");
                        // ここで再入力を促すUIを出すのが理想
                    } else {
                        throw new Error("PasswordException");
                    }
                };
                pdf = await loadingTask.promise;
                break;
            } catch (error) {
                lastError = error;
                // パスワード例外
                if (error && error.name === "PasswordException") {
                    isPasswordProtected = true;
                    securityInfo = "パスワード付きPDF";
                    break;
                }
                if (i === loadingOptions.length - 1) {
                    throw lastError;
                }
            }
        }

        // パスワード付きPDFの場合はサムネイル生成せず情報のみ返す
        if (isPasswordProtected || !pdf) {
            return {
                thumbnail: "",
                isPasswordProtected,
                isOperationRestricted,
                securityInfo: securityInfo || "パスワード付きPDF"
            };
        }

        // 権限情報取得(基本取得できない)
        if (pdf && pdf._pdfInfo && pdf._pdfInfo.permissions) {
            // permissionsは配列で、印刷・編集禁止などの情報が入る
            console.log("PDF permissions:", pdf._pdfInfo.permissions);
            isOperationRestricted = pdf._pdfInfo.permissions.length > 0;
            securityInfo += (isOperationRestricted ? " 操作制限あり" : "");
        }

        // 編集禁止などが判定できないので抽出を試行して判定
        try {
            const { PDFDocument } = pdfjsLib;
            const pdfDoc = await PDFDocument.load(uint8Array);
            // 1ページ目をコピー
            const newPdf = await PDFDocument.create();
            const [copiedPage] = await newPdf.copyPages(pdfDoc, [0]);
            // ここまで成功すれば編集可能
            newPdf.addPage(copiedPage);
        } catch (extractError) {
            // 編集不可（暗号化やパーミッション制限など）
            isOperationRestricted = true;
            isDegraded = true;
            securityInfo += "編集不可PDF（画像PDFに変換）";
        }

        // サムネイル生成
        try {
            const page = await pdf.getPage(1);
            const viewport = page.getViewport({ scale: 1 });
            const canvas = document.createElement('canvas');
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            const context = canvas.getContext('2d');
            await page.render({ canvasContext: context, viewport: viewport }).promise;
            thumbnail = canvas.toDataURL('image/png');
        } catch (thumbErr) {
            thumbnail = "";
        }

        return {
            thumbnail,
            isPasswordProtected,
            isOperationRestricted,
            securityInfo
        };

    } catch (error) {
        console.error('Error in renderFirstPDFPage:', error);
        return {
            thumbnail: "",
            isPasswordProtected: error && error.name === "PasswordException",
            isOperationRestricted: false,
            securityInfo: error && error.name === "PasswordException" ? "パスワード付きPDF" : "解析失敗"
        };
    }
};

// 指定したページのサムネイルを生成
window.renderPdfPage = async function (pdfData, pageIndex) {
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

        const pdfjsLib = window.pdfjsLib;
        if (!pdfjsLib) {
            throw new Error('PDF.js library not loaded');
        }

        if (pdfjsLib.GlobalWorkerOptions) {
            pdfjsLib.GlobalWorkerOptions.workerSrc = '/lib/pdf.worker.mjs';
        }

        let pdf = await pdfjsLib.getDocument({ data: uint8Array }).promise;
        let thumbnail = "";

        try {
            const page = await pdf.getPage(pageIndex + 1);
            const viewport = page.getViewport({ scale: 1 });
            const canvas = document.createElement('canvas');
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            const context = canvas.getContext('2d');
            await page.render({ canvasContext: context, viewport: viewport }).promise;
            thumbnail = canvas.toDataURL('image/png');
        } catch (thumbErr) {
            thumbnail = "";
        }

        return {
            thumbnail,
            isError: false,
            isPasswordProtected: false,
            securityInfo: ""
        };

    } catch (error) {
        return {
            thumbnail: "",
            isError: true,
            isPasswordProtected: false,
            securityInfo: "解析失敗"
        };
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

        const pdfjsLib = window.pdfjsLib;
        if (!pdfjsLib) {
            throw new Error('PDF.js library not loaded');
        }

        if (pdfjsLib.GlobalWorkerOptions) {
            pdfjsLib.GlobalWorkerOptions.workerSrc = '/lib/pdf.worker.mjs';
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

// 個別のPDFデータとして抽出する関数
window.extractPdfPage = async function (pdfData, pageIndex) {

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
        const newPdf = await PDFDocument.create();

        try {
            const [copiedPage] = await newPdf.copyPages(pdfDoc, [pageIndex]);
            newPdf.addPage(copiedPage);
        } catch (copyError) {
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
            blankPdf.addPage([595.28, 841.89]); // A4サイズの空白ページ
            const pdfBytes = await blankPdf.save();

            let binary = '';
            for (let j = 0; j < pdfBytes.length; j++) {
                binary += String.fromCharCode(pdfBytes[j]);
            }

            return btoa(binary);
        } catch (fallbackError) {
            return '';
        }
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
        const pdfjsLib = window.pdfjsLib;
        pdfjsLib.GlobalWorkerOptions.workerSrc = '/lib/pdf.worker.mjs';

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

// renderPdfThumbnailToCanvas実行前にcanvasがレンダリングされているか確認
window.checkCanvasExists = function (canvasId) {
    return !!document.getElementById(canvasId);
};

window._canvasRendering = window._canvasRendering || {};
// 結果画面のサムネイル描画（PDF→canvas）
// 結果画面はPDFの各ページデータがまだないので、
// PDFの先頭ページをcanvasに描画する関数を用意
window.renderPdfThumbnailToCanvas = async function (pdfUrl, canvasId) {
    if (!window.pdfjsLib) {
        throw new Error("pdfjsLib is not loaded.");
    }
    if (window._canvasRendering[canvasId]) {
        console.warn("render in progress, skipping:", canvasId);
        return false;
    }
    window._canvasRendering[canvasId] = true;
    try {
        const loadingTask = window.pdfjsLib.getDocument(pdfUrl);
        const pdf = await loadingTask.promise;
        const page = await pdf.getPage(1);

        const viewport = page.getViewport({ scale: 0.2 });
        const canvas = document.getElementById(canvasId);
        if (!canvas) {
            console.warn("canvas not found:", canvasId);
            return false;
        }
        const context = canvas.getContext('2d');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        context.clearRect(0, 0, canvas.width, canvas.height);

        await page.render({ canvasContext: context, viewport: viewport }).promise;
        return true;
    } catch (e) {
        console.error("renderPdfThumbnailToCanvas error", e, pdfUrl, canvasId);
        return false;
    } finally {
        window._canvasRendering[canvasId] = false;
    }
};

// 編集画面のサムネイル描画（画像→canvas）
// 編集画面は各ページデータには画像URLがあるので、
// 画像をcanvasに描画する関数を用意
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

window.unlockPdf = async function (pdfData, password) {
    const pdfjsLib = window.pdfjsLib;
    if (!pdfjsLib) throw new Error('PDF.js library not loaded');
    if (pdfjsLib.GlobalWorkerOptions) {
        pdfjsLib.GlobalWorkerOptions.workerSrc = '/lib/pdf.worker.mjs';
    }
    // base64→Uint8Array変換
    let uint8Array;
    if (typeof pdfData === 'string') {
        const binaryString = atob(pdfData);
        uint8Array = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            uint8Array[i] = binaryString.charCodeAt(i);
        }
    } else {
        uint8Array = pdfData;
    }
    const loadingTask = pdfjsLib.getDocument({ data: uint8Array, password: password });
    const pdf = await loadingTask.promise;

    // PDF-libで新PDFを作成
    // 画像化するので劣化（クライアントサイドの仕様上）
    const { PDFDocument } = PDFLib;
    const unlockedPdf = await PDFDocument.create();
    for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: 1.5 }); // 高解像度でレンダリングして劣化を軽減
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const context = canvas.getContext('2d');
        await page.render({ canvasContext: context, viewport: viewport }).promise;
        const imgData = canvas.toDataURL('image/png');
        const img = await unlockedPdf.embedPng(imgData);
        const pdfPage = unlockedPdf.addPage([viewport.width, viewport.height]);
        pdfPage.drawImage(img, { x: 0, y: 0, width: viewport.width, height: viewport.height });
    }
    const pdfBytes = await unlockedPdf.save();
    let binary = '';
    for (let i = 0; i < pdfBytes.length; i++) {
        binary += String.fromCharCode(pdfBytes[i]);
    }
    return btoa(binary);
};