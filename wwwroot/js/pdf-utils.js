let pdfConfig = null;

window.loadConfig = async function () {
    if (!pdfConfig) {
        const response = await fetch('/config.json');
        pdfConfig = await response.json();
    }
    return pdfConfig;
};
// 初期化時にJSONを1回だけ読み込み
window.loadConfig();

window.embedImageAsPdf = async function (imageBase64, ext) {
    const { PDFDocument } = PDFLib;
    const pdfDoc = await PDFDocument.create();
    let img;
    const bytes = base64ToUint8Array(imageBase64);
    if (ext.endsWith('.png')) {
        img = await pdfDoc.embedPng(bytes);
    } else if (ext.endsWith('.jpg') || ext.endsWith('.jpeg')) {
        img = await pdfDoc.embedJpg(bytes);
    } else if (
        ext.endsWith('.gif') ||
        ext.endsWith('.bmp') ||
        ext.endsWith('.webp') ||
        ext.endsWith('.svg')
    ) {
        // その他画像はcanvasでPNGに変換
        const mime = ext.endsWith('.gif') ? 'image/gif'
            : ext.endsWith('.bmp') ? 'image/bmp'
                : ext.endsWith('.webp') ? 'image/webp'
                    : ext.endsWith('.svg') ? 'image/svg+xml'
                        : '';
        const { pngBase64, width, height } = await convertImageToPngBase64AndSize(imageBase64, mime);
        img = await pdfDoc.embedPng(base64ToUint8Array(pngBase64.split(',')[1]));
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
window.renderFirstPDFPage = async function (fileData, password) {

    try {
        // BlazorからのデータがUint8Arrayかどうかチェック
        let uint8Array;
        if (fileData instanceof Uint8Array) {
            uint8Array = fileData;
        } else if (Array.isArray(fileData)) {
            uint8Array = new Uint8Array(fileData);
        } else if (typeof fileData === 'string') {
            const binaryString = atob(fileData);
            uint8Array = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
                uint8Array[i] = binaryString.charCodeAt(i);
            }
        } else {
            uint8Array = new Uint8Array(fileData);
        }

        if (uint8Array.length < 8) {
            throw new Error('Data too short to be valid PDF');
        }

        // 抽出試行時に使用
        // PDF.jsによる読取後にuint8Arrayがdetachされるためコピーを用意
        // const freshArray = new Uint8Array(uint8Array);

        const header = String.fromCharCode.apply(null, uint8Array.slice(0, 8));
        if (!header.startsWith('%PDF-')) {
            throw new Error(`Invalid PDF header: ${header}`);
        }

        const pdfjsLib = window.pdfjsLib;
        if (!pdfjsLib) {
            throw new Error('PDF.js library not loaded');
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
                    standardFontDataUrl: pdfjsLib.GlobalWorkerOptions.standardFontDataUrl,
                    wasmUrl: pdfjsLib.GlobalWorkerOptions.wasmUrl,
                    openjpegJsUrl: pdfjsLib.GlobalWorkerOptions.openjpegJsUrl,
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
            isOperationRestricted = pdf._pdfInfo.permissions.length > 0;
            securityInfo += (isOperationRestricted ? " 操作制限あり" : "");
        }

        // 編集禁止などが判定できないので抽出を試行して判定→処理時間が長いのでコメントアウト
        // try {
        //     const { PDFDocument } = PDFLib;
        //     const pdfDoc = await PDFDocument.load(freshArray);
        //     window._pdfLibCache.set(cacheKey, pdfDoc);
        //     // 1ページ目をコピー
        //     const newPdf = await PDFDocument.create();
        //     const [copiedPage] = await newPdf.copyPages(pdfDoc, [0]);
        //     // ここまで成功すれば編集可能
        //     newPdf.addPage(copiedPage);
        // } catch (extractError) {
        //     // 編集不可（暗号化やパーミッション制限など）
        //     console.warn("PDF extraction failed, likely due to restrictions:", extractError);
        //     isOperationRestricted = true;
        //     securityInfo += "編集不可PDF（画像PDFに変換）";
        // }

        // サムネイル生成
        try {
            const page = await pdf.getPage(1);
            const viewport = page.getViewport({ scale: pdfConfig.pdfSettings.scales.thumbnail });
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(viewport.width));
            canvas.height = Math.max(1, Math.round(viewport.height));
            const context = canvas.getContext('2d');
            await page.render({ canvasContext: context, viewport: viewport }).promise;
            thumbnail = canvas.toDataURL('image/png');
        } catch (thumbErr) {
            console.error("サムネイル生成エラー:", thumbErr);
            thumbnail = "";
        }

        let bookmarks = [];
        try {
            const outline = await pdf.getOutline(); // PDF.js の getOutline()
            if (outline && outline.length) {
                // 再帰でツリー構造をページ番号付きで取り出すヘルパー
                async function mapOutlineItems(items) {
                    const results = [];
                    for (const it of items) {
                        let pageIndex = null;
                        try {
                            let dest = it.dest;
                            if (typeof dest === 'string') {
                                dest = await pdf.getDestination(dest);
                            }
                            if (Array.isArray(dest) && dest.length > 0) {
                                // dest[0] はページ参照オブジェクトのことが多い
                                try { pageIndex = await pdf.getPageIndex(dest[0]); } catch (e) { pageIndex = null; }
                            }
                        } catch (e) { /* ignore */ }
                        const node = { title: it.title || '', pageIndex: pageIndex, items: [] };
                        if (it.items && it.items.length) {
                            node.items = await mapOutlineItems(it.items);
                        }
                        results.push(node);
                    }
                    return results;
                }
                try {
                    bookmarks = await mapOutlineItems(outline);
                } catch (e) {
                    console.error('pdf: outline mapping failed', e);
                    bookmarks = [];
                }
            }
        } catch (e) {
            console.error('pdf: getOutline failed or no outline', e);
            bookmarks = [];
        }

        return {
            thumbnail,
            isPasswordProtected,
            isOperationRestricted,
            securityInfo,
            bookmarks
        };

    } catch (error) {
        console.error('Error in renderFirstPDFPage:', error);
        return {
            thumbnail: "",
            isPasswordProtected: error && error.name === "PasswordException",
            isOperationRestricted: false,
            securityInfo: error && error.name === "PasswordException" ? "パスワード付きPDF" : "解析失敗",
            bookmarks: []
        };
    }
};

// 指定したページのサムネイルを生成
window.generatePdfThumbnailFromFileMetaData = async function (pdfFileData, pageIndex) {

    try {
        let uint8Array;
        if (pdfFileData instanceof Uint8Array) {
            uint8Array = pdfFileData;
        } else if (Array.isArray(pdfFileData)) {
            uint8Array = new Uint8Array(pdfFileData);
        } else if (typeof pdfFileData === 'string') {
            const binaryString = atob(pdfFileData);
            uint8Array = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
                uint8Array[i] = binaryString.charCodeAt(i);
            }
        } else {
            uint8Array = new Uint8Array(pdfFileData);
        }

        const pdfjsLib = window.pdfjsLib;
        if (!pdfjsLib) {
            throw new Error('PDF.js library not loaded');
        }

        let pdf = await pdfjsLib.getDocument({
            data: uint8Array,
            standardFontDataUrl: pdfjsLib.GlobalWorkerOptions.standardFontDataUrl,
            wasmUrl: pdfjsLib.GlobalWorkerOptions.wasmUrl,
            openjpegJsUrl: pdfjsLib.GlobalWorkerOptions.openjpegJsUrl
        }).promise;
        let thumbnail = "";

        try {
            const page = await pdf.getPage(pageIndex + 1);
            const viewport = page.getViewport({ scale: pdfConfig.pdfSettings.scales.thumbnail });
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

// 画像のBase64からPNGに変換してサイズも取得
window.convertImageToPngBase64AndSize = function (base64OrDataUrl, mime) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = function () {
            const canvas = document.createElement('canvas');
            canvas.width = img.width || 800;
            canvas.height = img.height || 600;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);
            const pngBase64 = canvas.toDataURL('image/png');
            resolve({ pngBase64, width: img.width, height: img.height });
        };
        img.onerror = reject;

        // dataURL形式ならそのまま、base64のみならMIMEタイプを付与
        if (base64OrDataUrl.startsWith('data:')) {
            img.src = base64OrDataUrl;
        } else if (mime) {
            img.src = `data:${mime};base64,${base64OrDataUrl}`;
        } else {
            // MIME不明の場合はPNGとして扱う
            img.src = `data:image/png;base64,${base64OrDataUrl}`;
        }
    });
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

        const loadingTask = pdfjsLib.getDocument({
            data: uint8Array,
            stopAtErrors: false,
            verbosity: 1,
            standardFontDataUrl: pdfjsLib.GlobalWorkerOptions.standardFontDataUrl,
            wasmUrl: pdfjsLib.GlobalWorkerOptions.wasmUrl,
            openjpegJsUrl: pdfjsLib.GlobalWorkerOptions.openjpegJsUrl
        });
        const pdf = await loadingTask.promise;
        return pdf.numPages;
    } catch (error) {
        console.error('Error in getPDFPageCount:', error);
        throw error;
    }
};

window._pdfLibCache = window._pdfLibCache || new Map();
// ファイルごとの「画像化フォールバックが発生した」フラグ
window._pdfLibFileRestricted = window._pdfLibFileRestricted || new Set();
// JS側から制限フラグを問い合わせるAPI
window._pdfLibFileIsRestricted = function (key) {
    try {
        return !!(key && window._pdfLibFileRestricted && window._pdfLibFileRestricted.has(key));
    } catch (e) {
        return false;
    }
};

// キャッシュ破棄API（PdfDataService.Clear から呼び出す用）
window._pdfLibCacheClear = function () {
    try {
        if (window._pdfLibCache && typeof window._pdfLibCache.clear === 'function') {
            window._pdfLibCache.clear();
            return true;
        }
        window._pdfLibCache = new Map();
        return true;
    } catch (e) {
        return false;
    }
};

// 任意で個別削除API（既存提案と互換）
window._pdfLibCacheDelete = function (key) {
    try {
        if (!key) return false;
        if (window._pdfLibCache && window._pdfLibCache.has(key)) {
            window._pdfLibCache.delete(key);
            return true;
        }
        return false;
    } catch (e) {
        return false;
    }
};

window._pdfLibFileRestrictedClear = function () {
    try {
        if (window._pdfLibFileRestricted && typeof window._pdfLibFileRestricted.clear === 'function') {
            window._pdfLibFileRestricted.clear();
            return true;
        }
        window._pdfLibFileRestricted = new Set();
        return true;
    } catch (e) {
        return false;
    }
};

// PDFページを pdf.js でレンダリングして PNG を埋めた単一ページPDF（base64）を返す共通処理
async function imageFallbackPdf(uint8Array, pageIndex, cacheKey = null) {
    const pdfjsLib = window.pdfjsLib;
    if (!pdfjsLib) throw new Error('pdfjsLib not loaded for image fallback');

    // マーク：画像化フォールバックが発生したファイルとして登録
    if (cacheKey && window._pdfLibFileRestricted) {
        try { window._pdfLibFileRestricted.add(cacheKey); } catch (e) { /* ignore */ }
    }

    const loadingTask = pdfjsLib.getDocument({
        data: uint8Array,
        standardFontDataUrl: pdfjsLib.GlobalWorkerOptions.standardFontDataUrl,
        wasmUrl: pdfjsLib.GlobalWorkerOptions.wasmUrl,
        openjpegJsUrl: pdfjsLib.GlobalWorkerOptions.openjpegJsUrl
    });
    const pdfForRender = await loadingTask.promise;
    const page = await pdfForRender.getPage(pageIndex + 1);

    const scale = (pdfConfig && pdfConfig.pdfSettings && pdfConfig.pdfSettings.scales && pdfConfig.pdfSettings.scales.unlock) || 1.5;
    const viewport = page.getViewport({ scale: scale });

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(viewport.width));
    canvas.height = Math.max(1, Math.round(viewport.height));
    const ctx = canvas.getContext('2d', { alpha: false });

    await page.render({ canvasContext: ctx, viewport: viewport }).promise;

    const imgDataUrl = canvas.toDataURL('image/png');
    const imgBytes = base64ToUint8Array(imgDataUrl.split(',')[1]);

    const { PDFDocument } = PDFLib;
    const imgPdf = await PDFDocument.create();
    const embedded = await imgPdf.embedPng(imgBytes);
    imgPdf.addPage([canvas.width, canvas.height]);
    const [imgPage] = imgPdf.getPages();
    imgPage.drawImage(embedded, { x: 0, y: 0, width: canvas.width, height: canvas.height });

    const newPdfBytes = await imgPdf.save();
    let bin = '';
    for (let i = 0; i < newPdfBytes.length; i++) bin += String.fromCharCode(newPdfBytes[i]);
    return btoa(bin);
};

// 個別のPDFデータとして抽出する関数
window.extractPdfPage = async function (pdfData, pageIndex, cacheKey = null) {

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

        // cacheKey がある場合はキャッシュから PDFDocument を取得、なければロードしてキャッシュ
        let srcPdfDoc = null;
        if (cacheKey && window._pdfLibCache.has(cacheKey)) {
            srcPdfDoc = window._pdfLibCache.get(cacheKey);
        } else {
            try {
                srcPdfDoc = await PDFDocument.load(uint8Array);
                if (cacheKey) {
                    // キャッシュに保存（必要なら後で明示的に削除できる）
                    window._pdfLibCache.set(cacheKey, srcPdfDoc);
                }
            } catch (loadErr) {
                // 該当ページだけ pdf.js でレンダリングして画像化したPDFを返す（画像フォールバック）
                try {
                    return await imageFallbackPdf(uint8Array, pageIndex, cacheKey);
                } catch (imgErr) {
                    console.error('extractPdfPage: fallback render failed, returning blank page', imgErr);
                    return await createBlankPage();
                }
            }
        }

        const newPdf = await PDFDocument.create();

        try {
            if (cacheKey && window._pdfLibFileRestricted && window._pdfLibFileRestricted.has(cacheKey)) {
            throw new Error('file-restricted-precheck');
            }
            const [copiedPage] = await newPdf.copyPages(srcPdfDoc, [pageIndex]);
            newPdf.addPage(copiedPage);
        } catch (copyError) {
            try {
                return await imageFallbackPdf(uint8Array, pageIndex, cacheKey);
            } catch (imgErr) {
                console.error('extractPdfPage: image fallback failed', imgErr);
                return await createBlankPage();
            }
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
        return await createBlankPage();
    }
};

// 空白ページのPDFを作成
async function createBlankPage() {
    try {
        const { PDFDocument} = PDFLib;
        const blankPdf = await PDFDocument.create();
        blankPdf.addPage([595.28, 841.89]);
        const pdfBytes = await blankPdf.save();

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
window.generatePdfThumbnailFromPageData = async function (pdfData) {
    try {
        const pdfjsLib = window.pdfjsLib;

        // base64文字列をUint8Arrayに変換
        const binaryString = atob(pdfData);
        const uint8Array = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            uint8Array[i] = binaryString.charCodeAt(i);
        }

        const loadingTask = pdfjsLib.getDocument({
            data: uint8Array,
            standardFontDataUrl: pdfjsLib.GlobalWorkerOptions.standardFontDataUrl,
            wasmUrl: pdfjsLib.GlobalWorkerOptions.wasmUrl,
            openjpegJsUrl: pdfjsLib.GlobalWorkerOptions.openjpegJsUrl
        });
        const pdf = await loadingTask.promise;

        const page = await pdf.getPage(1);
        const viewport = page.getViewport({ scale: pdfConfig.pdfSettings.scales.thumbnail });
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
    const loadingTask = pdfjsLib.getDocument({
        data: uint8Array,
        standardFontDataUrl: pdfjsLib.GlobalWorkerOptions.standardFontDataUrl,
        wasmUrl: pdfjsLib.GlobalWorkerOptions.wasmUrl,
        openjpegJsUrl: pdfjsLib.GlobalWorkerOptions.openjpegJsUrl
    });
    const pdf = await loadingTask.promise;
    const page = await pdf.getPage(1);

    // 回転角度を反映したviewportを作成
    const viewport = page.getViewport({ scale: pdfConfig.pdfSettings.scales.normal, rotation: (rotateAngle || 0) });

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

    const pdf = await pdfjsLib.getDocument({
        url: pdfUrl,
        standardFontDataUrl: pdfjsLib.GlobalWorkerOptions.standardFontDataUrl,
        wasmUrl: pdfjsLib.GlobalWorkerOptions.wasmUrl,
        openjpegJsUrl: pdfjsLib.GlobalWorkerOptions.openjpegJsUrl
    }).promise;
    for (let i = 0; i < canvasIds.length; i++) {
        const page = await pdf.getPage(i + 1);
        const canvas = document.getElementById(canvasIds[i]);
        if (!canvas) continue;
        const context = canvas.getContext('2d');
        // 元データサイズでviewportを取得
        const viewport = page.getViewport({ scale: pdfConfig.pdfSettings.scales.normal });
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
        const loadingTask = window.pdfjsLib.getDocument({
            url: pdfUrl,
            standardFontDataUrl: pdfjsLib.GlobalWorkerOptions.standardFontDataUrl,
            wasmUrl: pdfjsLib.GlobalWorkerOptions.wasmUrl,
            openjpegJsUrl: pdfjsLib.GlobalWorkerOptions.openjpegJsUrl
        });
        const pdf = await loadingTask.promise;
        const page = await pdf.getPage(1);

        const viewport = page.getViewport({ scale: pdfConfig.pdfSettings.scales.thumbnail });
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
// window.drawImageToCanvas = function (canvasId, imageUrl) {
//     const canvas = document.getElementById(canvasId);
//     if (!canvas) return;
//     const ctx = canvas.getContext('2d');
//     const img = new window.Image();
//     img.onload = function () {
//         ctx.clearRect(0, 0, canvas.width, canvas.height);

//         // 枠いっぱいにアスペクト比を保って描画
//         const scale = Math.min(canvas.width / img.width, canvas.height / img.height);
//         const drawWidth = img.width * scale;
//         const drawHeight = img.height * scale;
//         ctx.drawImage(img,
//             (canvas.width - drawWidth) / 2,
//             (canvas.height - drawHeight) / 2,
//             drawWidth, drawHeight);
//     };
//     img.src = imageUrl;
// };
window.drawImageToCanvas = function (canvasId, imageUrl, useDevicePixelRatio = true) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const img = new window.Image();

    img.onload = function () {
        try {
            // 表示サイズ（CSSピクセル）
            const rect = canvas.getBoundingClientRect();
            const cssW = Math.max(1, rect.width || canvas.clientWidth || 96);
            const cssH = Math.max(1, rect.height || canvas.clientHeight || 128);

            const dpr = useDevicePixelRatio ? (window.devicePixelRatio || 1) : 1;

            // 内部ピクセルバッファを調整
            canvas.width = Math.round(cssW * dpr);
            canvas.height = Math.round(cssH * dpr);

            // CSS 表示サイズを保持
            // canvas.style.width = cssW + "px";
            // canvas.style.height = cssH + "px";

            // 高DPI対応：コンテキストをスケール
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.clearRect(0, 0, cssW, cssH);

            // アスペクト比を維持して中央に描画
            const scale = Math.min(cssW / img.width, cssH / img.height);
            const drawW = img.width * scale;
            const drawH = img.height * scale;
            ctx.drawImage(img,
                (cssW - drawW) / 2,
                (cssH - drawH) / 2,
                drawW, drawH);
        } catch (e) {
            console.debug('drawImageToCanvas error', e);
        }
    };

    img.onerror = function (e) {
        console.debug('drawImageToCanvas image load error', e, imageUrl);
    };

    img.src = imageUrl;
};

window.drawImageToCanvasForPreview = function (canvasId, imageUrl, useDevicePixelRatio = true) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const img = new window.Image();
    img.crossOrigin = 'anonymous';

    img.onload = function () {
        try {
            const iw = Math.max(1, Math.round(img.naturalWidth));
            const ih = Math.max(1, Math.round(img.naturalHeight));
            const dpr = useDevicePixelRatio ? (window.devicePixelRatio || 1) : 1;

            // 内部ピクセルバッファを元画像サイズ * DPR にする
            canvas.width = Math.round(iw * dpr);
            canvas.height = Math.round(ih * dpr);

            // 表示サイズ（CSS）は元画像の論理ピクセルサイズに設定する
            canvas.style.width = iw + 'px';
            canvas.style.height = ih + 'px';
            canvas.style.display = 'block';

            // 高DPI対応：コンテキストのスケールを設定（CSSピクセル単位で描画する）
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.clearRect(0, 0, iw, ih);

            // 画像をキャンバスいっぱいに描く（アスペクトは img 自体のサイズなのでフィット）
            ctx.drawImage(img, 0, 0, iw, ih);

            // store src for potential redraws
            try { canvas.dataset.src = imageUrl; } catch (e) { /* ignore */ }
        } catch (e) {
            console.error('drawImageToCanvas error', e);
        }
    };

    img.onerror = function (e) {
        console.error('drawImageToCanvas image load error', e, imageUrl);
    };

    img.src = imageUrl;
};

window.unlockPdf = async function (pdfData, password) {
    const pdfjsLib = window.pdfjsLib;
    if (!pdfjsLib) throw new Error('PDF.js library not loaded');

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
    const loadingTask = pdfjsLib.getDocument({
        data: uint8Array, password: password,
        standardFontDataUrl: pdfjsLib.GlobalWorkerOptions.standardFontDataUrl,
        wasmUrl: pdfjsLib.GlobalWorkerOptions.wasmUrl,
        openjpegJsUrl: pdfjsLib.GlobalWorkerOptions.openjpegJsUrl
    });
    const pdf = await loadingTask.promise;

    // PDF-libで新PDFを作成
    // 画像化するので劣化（クライアントサイドの仕様上）
    const { PDFDocument } = PDFLib;
    const unlockedPdf = await PDFDocument.create();
    for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: pdfConfig.pdfSettings.scales.unlock }); // 高解像度でレンダリングして劣化を軽減
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


window.editPdfPageWithElements = async function (pdfBase64, editJson) {
    const { PDFDocument, rgb, StandardFonts } = PDFLib;

    // fontkit登録（1回だけでOK）
    if (!PDFLib._fontkitRegistered) {
        if (window.fontkit) {
            PDFLib.PDFDocument.prototype.registerFontkit(window.fontkit);
            PDFLib._fontkitRegistered = true;
        } else {
            throw new Error("fontkitがロードされていません。");
        }
    }
    const pdfBytes = base64ToUint8Array(pdfBase64);
    const pdfDoc = await PDFDocument.load(pdfBytes);

    const page = pdfDoc.getPage(0);
    const pageHeight = page.getHeight();

    let editElements = [];
    try {
        editElements = JSON.parse(editJson);
    } catch (e) {
        console.error("editJson parse error", e, editJson);
    }

    // フォントキャッシュ（pdfDoc 単位で保持）
    const fontCache = {
        notoSansReg: null,
        notoSansBold: null,
        notoSerifReg: null,
        notoSerifBold: null
    };

    async function getEmbeddedFontForElement(el) {
        const containsJapanese = (text) => /[\u3000-\u30FF\u4E00-\u9FFF\uFF01-\uFF60]/.test(text || "");
        const wantsSerif = (ff) => !!(ff && ff.toString().toLowerCase().indexOf("notoserif") >= 0);
        const isJapanese = containsJapanese(el.Text);
        const useSerif = isJapanese && wantsSerif(el.FontFamily);
        const isBold = !!el.IsBold;

        try {
            if (isJapanese) {
                if (useSerif) {
                    if (isBold) {
                        if (!fontCache.notoSerifBold) {
                            const bytes = await fetch("/fonts/NotoSerifJP-Bold.ttf").then(r => r.arrayBuffer());
                            fontCache.notoSerifBold = await pdfDoc.embedFont(bytes);
                        }
                        return fontCache.notoSerifBold;
                    } else {
                        if (!fontCache.notoSerifReg) {
                            const bytes = await fetch("/fonts/NotoSerifJP-Regular.ttf").then(r => r.arrayBuffer());
                            fontCache.notoSerifReg = await pdfDoc.embedFont(bytes);
                        }
                        return fontCache.notoSerifReg;
                    }
                } else {
                    // Noto Sans fallback
                    if (isBold) {
                        if (!fontCache.notoSansBold) {
                            const bytes = await fetch("/fonts/NotoSansJP-Bold.ttf").then(r => r.arrayBuffer());
                            fontCache.notoSansBold = await pdfDoc.embedFont(bytes);
                        }
                        return fontCache.notoSansBold;
                    } else {
                        if (!fontCache.notoSansReg) {
                            const bytes = await fetch("/fonts/NotoSansJP-Regular.ttf").then(r => r.arrayBuffer());
                            fontCache.notoSansReg = await pdfDoc.embedFont(bytes);
                        }
                        return fontCache.notoSansReg;
                    }
                }
            } else {
                // 非日本語は標準フォントを利用
                return el.IsBold ? await pdfDoc.embedFont(StandardFonts.HelveticaBold) : await pdfDoc.embedFont(StandardFonts.Helvetica);
            }
        } catch (err) {
            console.error("font embed error", err);
            return await pdfDoc.embedFont(StandardFonts.Helvetica);
        }
    }

    for (const el of editElements) {
        if (el.Type === 0 || el.Type === "Text") {

            const font = await getEmbeddedFontForElement(el);

            const rotateDegrees = PDFLib.degrees(el.Rotation || 0);

            const fontSize = Number(el.FontSize) || 16;
            const specifiedLineHeight = (typeof el.LineHeight !== "undefined" && el.LineHeight > 0) ? Number(el.LineHeight) : null;
            const lineHeightPx = specifiedLineHeight || fontSize;

            const text = el.Text || "";
            const startX = (typeof el.X === "number") ? el.X : 0;
            const maxWidth = (typeof el.Width === "number" && el.Width > 0)
                ? Number(el.Width)
                : (page.getWidth() - startX);

            // テキストを段落（\n）毎に分け、単語／文字で折り返す
            function splitToLines(paragraph, font, size, maxW) {
                if (!paragraph) return [''];
                const lines = [];
                // 単語単位（空白を保持）で分割して処理
                const tokens = paragraph.split(/(\s+)/);
                let current = '';
                for (const token of tokens) {
                    const tokenWidth = font.widthOfTextAtSize(token, size);
                    const currentWidth = current ? font.widthOfTextAtSize(current, size) : 0;
                    if (currentWidth + tokenWidth <= maxW) {
                        current += token;
                    } else {
                        if (current) {
                            lines.push(current);
                        }
                        // token 自体が長すぎる場合は文字単位で切る
                        if (tokenWidth <= maxW) {
                            current = token;
                        } else {
                            let chunk = '';
                            for (let i = 0; i < token.length; i++) {
                                chunk += token[i];
                                const w = font.widthOfTextAtSize(chunk, size);
                                if (w > maxW) {
                                    // 直前の分を確定し、新しいチャンク開始
                                    if (chunk.length > 1) {
                                        lines.push(chunk.slice(0, -1));
                                        chunk = chunk.slice(-1);
                                    } else {
                                        // 1文字でも超える場合は強制的に押し込む
                                        lines.push(chunk);
                                        chunk = '';
                                    }
                                }
                            }
                            current = chunk;
                        }
                    }
                }
                if (current) lines.push(current);
                return lines;
            }

            // 全段落を行配列に展開
            const paragraphs = text.split('\n');
            const wrappedLines = [];
            for (const p of paragraphs) {
                const lines = splitToLines(p, font, fontSize, maxWidth);
                // 空行の維持
                if (lines.length === 0) wrappedLines.push('');
                else wrappedLines.push(...lines);
            }
            // 描画：最初の行のベースライン位置
            const startY = pageHeight - (el.Y || 0) - fontSize;
            for (let i = 0; i < wrappedLines.length; i++) {
                page.drawText(wrappedLines[i] || '', {
                    x: startX,
                    y: startY - (i * lineHeightPx),
                    size: fontSize,
                    font: font,
                    color: rgbHexToRgb(el.Color || "#000000"),
                    rotate: rotateDegrees
                });
            }
        } else if (el.Type === 1 || el.Type === "Image") {
            if (el.ImageUrl && (el.ImageUrl.startsWith("data:image/png") || el.ImageUrl.startsWith("data:image/jpeg"))) {
                let base64 = el.ImageUrl.split(',')[1] || el.ImageUrl;
                let img;
                if (el.ImageUrl.startsWith("data:image/png")) {
                    img = await pdfDoc.embedPng(base64ToUint8Array(base64));
                } else if (el.ImageUrl.startsWith("data:image/jpeg")) {
                    img = await pdfDoc.embedJpg(base64ToUint8Array(base64));
                }
                const rotateDegrees = PDFLib.degrees(el.Rotation || 0);

                page.drawImage(img, {
                    x: el.X || 0,
                    y: pageHeight - (el.Y || 0) - (el.Height || img.height),
                    width: el.Width || img.width,
                    height: el.Height || img.height,
                    rotate: rotateDegrees
                });
            } else {
                // SVGやWebPなど未対応形式はスキップ
                console.warn("未対応画像形式: ", el.ImageUrl ? el.ImageUrl.substring(0, 30) : "");
            }
        }
    }

    const newPdfBytes = await pdfDoc.save();
    let binary = '';
    for (let i = 0; i < newPdfBytes.length; i++) {
        binary += String.fromCharCode(newPdfBytes[i]);
    }
    return btoa(binary);

    // ヘルパー
    function rgbHexToRgb(hex) {
        hex = hex.replace('#', '');
        if (hex.length === 3) hex = hex.split('').map(x => x + x).join('');
        const num = parseInt(hex, 16);
        return rgb(
            ((num >> 16) & 255) / 255,
            ((num >> 8) & 255) / 255,
            (num & 255) / 255
        );
    }
    function base64ToUint8Array(base64) {
        const binaryString = atob(base64.replace(/^data:.*;base64,/, ''));
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        return bytes;
    }
};

window.addStampsToPdf = async function (pdfBytes, stamps) {
    const { PDFDocument, rgb, StandardFonts, degrees } = PDFLib;

    // fontkit登録
    if (!PDFLib._fontkitRegistered) {
        if (window.fontkit) {
            PDFLib.PDFDocument.prototype.registerFontkit(window.fontkit);
            PDFLib._fontkitRegistered = true;
        } else {
            console.warn("fontkitがロードされていません。日本語フォントは使用できません。");
        }
    }

    // Uint8Array変換
    let uint8Array;
    if (typeof pdfBytes === 'string') {
        uint8Array = base64ToUint8Array(pdfBytes);
    } else if (pdfBytes instanceof Uint8Array) {
        uint8Array = pdfBytes;
    } else if (Array.isArray(pdfBytes)) {
        uint8Array = new Uint8Array(pdfBytes);
    } else {
        uint8Array = new Uint8Array(pdfBytes);
    }

    // 回転角度を取得
    const rotateAngle = stamps.length > 0 ? (stamps[0].rotateAngle || 0) : 0;
    const normalizedAngle = ((rotateAngle % 360) + 360) % 360;

    // === 元PDFを読み込み ===
    const pdfDoc = await PDFDocument.load(uint8Array);
    const page = pdfDoc.getPage(0);
    const { width, height } = page.getSize();

    // フォント関連の準備
    let notoFontRegular = null;

    function containsJapanese(text) {
        return /[\u3000-\u30FF\u4E00-\u9FFF\uFF01-\uFF60]/.test(text);
    }

    function generateSerialNumber(currentPageIndex, totalPages, isZeroPadded) {
        const pageNumber = currentPageIndex + 1;
        if (!isZeroPadded) {
            return pageNumber.toString();
        }
        const digits = totalPages.toString().length;
        return pageNumber.toString().padStart(digits, '0');
    }

    // === 座標変換関数（Y座標正しい修正版）===
    function transformCoordinates(corner, offsetX, offsetY, rotateAngle, pageWidth, pageHeight, textWidth, fontSize) {
        let x = 0, y = 0;
        let textRotation = 0;

        // 回転角度に応じて座標変換
        const angle = ((rotateAngle % 360) + 360) % 360;

        if (angle === 0) {
            // 回転なし：通常の座標計算
            switch (corner) {
                case 'TopLeft':
                    x = offsetX;
                    y = pageHeight - offsetY - fontSize;
                    break;
                case 'Top':
                    x = pageWidth / 2 - textWidth / 2;
                    y = pageHeight - offsetY - fontSize;
                    break;
                case 'TopRight':
                    x = pageWidth - offsetX - textWidth;
                    y = pageHeight - offsetY - fontSize;
                    break;
                case 'BottomLeft':
                    x = offsetX;
                    y = offsetY;
                    break;
                case 'Bottom':
                    x = pageWidth / 2 - textWidth / 2;
                    y = offsetY;
                    break;
                case 'BottomRight':
                    x = pageWidth - offsetX - textWidth;
                    y = offsetY;
                    break;
            }
            textRotation = 0;
        } else if (angle === 90) {
            // 90度回転: 画面上の位置 → 元PDFでの実際の位置
            switch (corner) {
                case 'TopLeft':     // 画面左上 → 元PDF左下
                    x = offsetY;
                    y = offsetX;
                    break;
                case 'Top':         // 画面上 → 元PDF左
                    x = offsetY;
                    y = pageHeight / 2 - textWidth / 2;
                    break;
                case 'TopRight':    // 画面右上 → 元PDF左上
                    x = offsetY;
                    y = pageHeight - offsetX - textWidth;
                    break;
                case 'BottomLeft':  // 画面左下 → 元PDF右下
                    x = pageWidth - offsetY;
                    y = offsetX;
                    break;
                case 'Bottom':      // 画面下 → 元PDF右
                    x = pageWidth - offsetY;
                    y = pageHeight / 2 - textWidth / 2;
                    break;
                case 'BottomRight': // 画面右下 → 元PDF右上
                    x = pageWidth - offsetY;
                    y = pageHeight - offsetX - textWidth;
                    break;
            }
            textRotation = 90;
        } else if (angle === 180) {
            // 180度回転: 上下左右完全反転 + 右端基点対応（Y座標修正版）
            switch (corner) {
                case 'TopLeft':     // 画面左上 → 元PDF右下
                    x = pageWidth - offsetX;
                    y = offsetY; // 修正：0度BottomLeftと同じY座標
                    break;
                case 'Top':         // 画面上 → 元PDF下
                    x = pageWidth / 2 - textWidth / 2;
                    y = offsetY; // 修正：0度Bottomと同じY座標
                    break;
                case 'TopRight':    // 画面右上 → 元PDF左下
                    x = offsetX + textWidth; // 右端基点対応
                    y = offsetY; // 修正：0度BottomRightと同じY座標
                    break;
                case 'BottomLeft':  // 画面左下 → 元PDF右上
                    x = pageWidth - offsetX;
                    y = pageHeight - offsetY;
                    break;
                case 'Bottom':      // 画面下 → 元PDF上
                    x = pageWidth / 2 - textWidth / 2;
                    y = pageHeight - offsetY;
                    break;
                case 'BottomRight': // 画面右下 → 元PDF左上
                    x = offsetX + textWidth;
                    y = pageHeight - offsetY;
                    break;
            }
            textRotation = 180;
        } else if (angle === 270) {
            // 270度回転: 右端基点対応
            switch (corner) {
                case 'TopLeft':     // 画面左上 → 元PDF右上
                    x = pageWidth - offsetY;
                    y = pageHeight - offsetX;
                    break;
                case 'Top':         // 画面上 → 元PDF右
                    x = pageWidth - offsetY;
                    y = pageHeight / 2 - textWidth / 2;
                    break;
                case 'TopRight':    // 画面右上 → 元PDF右下
                    x = pageWidth - offsetY;
                    y = offsetX + textWidth; // 右端基点対応
                    break;
                case 'BottomLeft':  // 画面左下 → 元PDF左上
                    x = offsetY;
                    y = pageHeight - offsetX;
                    break;
                case 'Bottom':      // 画面下 → 元PDF左
                    x = offsetY;
                    y = pageHeight / 2 - textWidth / 2;
                    break;
                case 'BottomRight': // 画面右下 → 元PDF左下
                    x = offsetY;
                    y = offsetX + textWidth; // 右端基点対応
                    break;
            }
            textRotation = -90;
        }

        return { x, y, textRotation };
    }

    for (const stamp of stamps) {

        let text = stamp.text || "";
        if (stamp.isSerial) {
            const serialNumber = generateSerialNumber(
                stamp.currentPageIndex || 0,
                stamp.totalPages || 1,
                stamp.isZeroPadded || false
            );
            text = text ? `${text}${serialNumber}` : serialNumber;
        }

        // フォント選択
        let font;
        if (containsJapanese(text)) {
            if (!notoFontRegular) {
                try {
                    const fontUrl = "/fonts/NotoSansJP-Regular.ttf";
                    const fontBytes = await fetch(fontUrl).then(res => res.arrayBuffer());
                    notoFontRegular = await pdfDoc.embedFont(fontBytes);
                } catch (fontError) {
                    console.warn("日本語フォント読み込み失敗:", fontError);
                    font = await pdfDoc.embedFont(StandardFonts.Helvetica);
                }
            }
            font = notoFontRegular || await pdfDoc.embedFont(StandardFonts.Helvetica);
        } else {
            font = await pdfDoc.embedFont(StandardFonts.Helvetica);
        }

        const fontSize = stamp.fontSize || 12;
        const textWidth = font.widthOfTextAtSize(text, fontSize);

        // === 座標変換実行 ===
        const transformed = transformCoordinates(
            stamp.corner,
            stamp.offsetX,
            stamp.offsetY,
            normalizedAngle,
            width,
            height,
            textWidth,
            fontSize
        );

        // 色設定
        const color = stamp.color ?
            rgb(stamp.color.r || 0, stamp.color.g || 0, stamp.color.b || 0) :
            rgb(0, 0, 0);

        // テキスト描画
        try {
            page.drawText(text, {
                x: transformed.x,
                y: transformed.y,
                size: fontSize,
                font: font,
                color: color,
                rotate: degrees(transformed.textRotation),
            });
        } catch (drawError) {
            console.error("スタンプ描画エラー:", drawError);
            throw drawError;
        }
    }

    return await pdfDoc.save();
};