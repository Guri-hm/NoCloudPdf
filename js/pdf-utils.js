let pdfConfig = null;

// ========================================
// 共通ユーティリティ関数
// ========================================

/**
 * Base64文字列をUint8Arrayに変換
 */
function base64ToUint8Array(base64) {
    const cleanBase64 = base64.replace(/[\r\n\s]/g, "");
    const binaryString = atob(cleanBase64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
}

/**
 * データ型の統一変換関数
 */
function toUint8Array(data) {
    if (data instanceof Uint8Array) {
        return data;
    } else if (Array.isArray(data)) {
        return new Uint8Array(data);
    } else if (typeof data === 'string') {
        return base64ToUint8Array(data);
    } else {
        return new Uint8Array(data);
    }
}

/**
 * Uint8Array → Base64 変換ヘルパー
 */
function uint8ArrayToBase64(bytes) {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

/**
 * PDF.js 読み込みヘルパー
 */
async function loadPdfDocument(uint8Array, options = {}) {
    const pdfjsLib = window.pdfjsLib;
    if (!pdfjsLib) throw new Error('PDF.js library not loaded');

    const defaultOptions = {
        data: uint8Array,
        cMapUrl: pdfjsLib.GlobalWorkerOptions.cMapUrl, 
        cMapPacked: pdfjsLib.GlobalWorkerOptions.cMapPacked,
        standardFontDataUrl: pdfjsLib.GlobalWorkerOptions.standardFontDataUrl,
        wasmUrl: pdfjsLib.GlobalWorkerOptions.wasmUrl,
        openjpegJsUrl: pdfjsLib.GlobalWorkerOptions.openjpegJsUrl
    };

    const loadingTask = pdfjsLib.getDocument({ ...defaultOptions, ...options });
    return await loadingTask.promise;
}

/**
 * Canvas レンダリングヘルパー
 */
async function renderPageToCanvas(page, scale, rotation = 0, options = {}) {
    const viewport = page.getViewport({ scale, rotation });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(viewport.width));
    canvas.height = Math.max(1, Math.round(viewport.height));
    
    const context = canvas.getContext('2d', { alpha: false });
    
    if (options.fillWhite) {
        context.fillStyle = '#FFFFFF';
        context.fillRect(0, 0, canvas.width, canvas.height);
    }
    
    await page.render({ canvasContext: context, viewport }).promise;
    return canvas;
}

/**
 * RGB ヘルパー（Hex → RGB）
 */
function hexToRgb(hex) {
    const { rgb } = PDFLib;
    hex = hex.replace('#', '');
    if (hex.length === 3) {
        hex = hex.split('').map(x => x + x).join('');
    }
    const num = parseInt(hex, 16);
    return rgb(
        ((num >> 16) & 255) / 255,
        ((num >> 8) & 255) / 255,
        (num & 255) / 255
    );
}

/**
 * 回転角度を0/90/180/270に正規化
 */
function normalizeRotationAngle(rotateAngle) {
    const angle = ((Number(rotateAngle) || 0) % 360 + 360) % 360;
    return (Math.round(angle / 90) * 90) % 360;
}

/**
 * 正規化座標を実際のピクセル座標に変換（クランプ付き）
 */
function normalizedToPixel(normValue, maxValue, isSize = false) {
    const pixel = Math.round(normValue * maxValue);
    if (isSize) {
        return Math.max(1, Math.min(maxValue, pixel));
    }
    return Math.max(0, Math.min(maxValue, pixel));
}

/**
 * トリミング領域の座標計算（回転適用後のキャンバス座標）
 */
function calculateCropRegion(normX, normY, normWidth, normHeight, canvasWidth, canvasHeight) {
    const sx = normalizedToPixel(normX, canvasWidth);
    const sy = normalizedToPixel(normY, canvasHeight);
    const sw = normalizedToPixel(normWidth, canvasWidth - sx, true);
    const sh = normalizedToPixel(normHeight, canvasHeight - sy, true);
    
    return { sx, sy, sw, sh };
}

/**
 * 共通エラーハンドラー
 */
function handlePdfError(error, context) {
    console.error(`${context} error:`, error);
    
    if (error && error.name === "PasswordException") {
        return {
            thumbnail: "",
            isPasswordProtected: true,
            securityInfo: "パスワード付きPDF"
        };
    }
    
    return {
        thumbnail: "",
        isError: true,
        securityInfo: "解析失敗"
    };
}

/**
 * 日本語判定
 */
function containsJapanese(text) {
    return /[\u3000-\u30FF\u4E00-\u9FFF\uFF01-\uFF60]/.test(text || "");
}

// ========================================
// フォント管理クラス
// ========================================
class PdfFontManager {
    constructor(pdfDoc) {
        this.pdfDoc = pdfDoc;
        this.cache = {};
    }

    async getFont(text, options = {}) {
        const { isBold = false, isSerif = false } = options;
        const isJapanese = containsJapanese(text);

        if (isJapanese) {
            const fontKey = isSerif 
                ? (isBold ? 'notoSerifBold' : 'notoSerifReg')
                : (isBold ? 'notoSansBold' : 'notoSansReg');

            if (!this.cache[fontKey]) {
                const fontMap = {
                    notoSerifBold: '/fonts/NotoSerifJP-Bold.ttf',
                    notoSerifReg: '/fonts/NotoSerifJP-Regular.ttf',
                    notoSansBold: '/fonts/NotoSansJP-Bold.ttf',
                    notoSansReg: '/fonts/NotoSansJP-Regular.ttf'
                };
                const bytes = await fetch(fontMap[fontKey]).then(r => r.arrayBuffer());
                this.cache[fontKey] = await this.pdfDoc.embedFont(bytes);
            }
            return this.cache[fontKey];
        } else {
            const { StandardFonts } = PDFLib;
            return isBold 
                ? await this.pdfDoc.embedFont(StandardFonts.HelveticaBold)
                : await this.pdfDoc.embedFont(StandardFonts.Helvetica);
        }
    }
}

// ========================================
// キャッシュマネージャークラス
// ========================================
class PdfCacheManager {
    constructor() {
        this.libCache = new Map();
        this.restrictedFiles = new Set();
        this.renderingFlags = {};
    }

    set(key, doc) { this.libCache.set(key, doc); }
    get(key) { return this.libCache.get(key); }
    has(key) { return this.libCache.has(key); }
    delete(key) { 
        this.libCache.delete(key);
        this.restrictedFiles.delete(key);
    }
    clear() {
        this.libCache.clear();
        this.restrictedFiles.clear();
    }

    markRestricted(key) { this.restrictedFiles.add(key); }
    isRestricted(key) { return this.restrictedFiles.has(key); }
    clearRestricted() { this.restrictedFiles.clear(); }

    setRendering(key, value) { this.renderingFlags[key] = value; }
    isRendering(key) { return !!this.renderingFlags[key]; }
}

window._pdfCache = new PdfCacheManager();

// 後方互換性のためのエイリアス
window._pdfLibCache = window._pdfCache.libCache;
window._pdfLibFileRestricted = window._pdfCache.restrictedFiles;
window._canvasRendering = window._pdfCache.renderingFlags;

window._pdfLibFileIsRestricted = function (key) {
    return window._pdfCache.isRestricted(key);
};

window._pdfLibCacheClear = function () {
    window._pdfCache.clear();
    return true;
};

window._pdfLibCacheDelete = function (key) {
    if (!key) return false;
    window._pdfCache.delete(key);
    return true;
};

window._pdfLibFileRestrictedClear = function () {
    window._pdfCache.clearRestricted();
    return true;
};

// ========================================
// 設定読み込み
// ========================================
window.loadConfig = async function () {
    if (!pdfConfig) {
        const response = await fetch('/config.json');
        pdfConfig = await response.json();
    }
    return pdfConfig;
};
window.loadConfig();

// ========================================
// 画像 → PDF 変換
// ========================================
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
        const mime = ext.endsWith('.gif') ? 'image/gif'
            : ext.endsWith('.bmp') ? 'image/bmp'
            : ext.endsWith('.webp') ? 'image/webp'
            : ext.endsWith('.svg') ? 'image/svg+xml'
            : '';
        const { pngBase64 } = await window.convertImageToPngBase64AndSize(imageBase64, mime);
        img = await pdfDoc.embedPng(base64ToUint8Array(pngBase64.split(',')[1]));
    } else {
        throw new Error('Unsupported image type');
    }

    const imgDims = img.scale(1);
    const page = pdfDoc.addPage([imgDims.width, imgDims.height]);
    page.drawImage(img, { x: 0, y: 0, width: imgDims.width, height: imgDims.height });
    const pdfBytes = await pdfDoc.save();
    
    return uint8ArrayToBase64(pdfBytes);
};

// ========================================
// PDF結合
// ========================================
window.mergePDFPages = async function (pdfPageDataList) {
    const { PDFDocument, degrees } = PDFLib;
    const mergedPdf = await PDFDocument.create();

    for (let i = 0; i < pdfPageDataList.length; i++) {
        let pageInfo = pdfPageDataList[i];
        let pageData = pageInfo.pageData;

        const bytes = toUint8Array(pageData);

        try {
            const pdfDoc = await PDFDocument.load(bytes);
            const [page] = await mergedPdf.copyPages(pdfDoc, [0]);

            if (typeof pageInfo === 'object' && pageInfo.rotateAngle && pageInfo.rotateAngle % 360 !== 0) {
                page.setRotation(degrees(pageInfo.rotateAngle));
            }

            mergedPdf.addPage(page);
        } catch (error) {
            console.error(`Error at mergePDFPages index=${i}:`, error);
            throw error;
        }
    }

    const mergedPdfBytes = await mergedPdf.save();
    const blob = new Blob([mergedPdfBytes], { type: 'application/pdf' });
    return URL.createObjectURL(blob);
};

// ========================================
// PDF情報取得（サムネイル・ブックマーク等）
// ========================================
window.renderFirstPDFPage = async function (fileData, password) {
    try {
        const uint8Array = toUint8Array(fileData);

        if (uint8Array.length < 8) {
            throw new Error('Data too short to be valid PDF');
        }

        const header = String.fromCharCode.apply(null, uint8Array.slice(0, 8));
        if (!header.startsWith('%PDF-')) {
            throw new Error(`Invalid PDF header: ${header}`);
        }

        let pdf = null;
        let isPasswordProtected = false;
        let lastError = null;

        const loadingOptions = [
            { stopAtErrors: false, maxImageSize: 1024 * 1024 * 5, disableFontFace: true, disableRange: true, disableStream: true, verbosity: 1 },
            { stopAtErrors: false, maxImageSize: 1024 * 1024 * 10, disableFontFace: false, disableRange: true, disableStream: false, verbosity: 1 },
            { stopAtErrors: false, verbosity: 1 }
        ];

        for (let i = 0; i < loadingOptions.length; i++) {
            try {
                pdf = await loadPdfDocument(uint8Array, { ...loadingOptions[i], password: password || undefined });
                break;
            } catch (error) {
                lastError = error;
                if (error && error.name === "PasswordException") {
                    isPasswordProtected = true;
                    break;
                }
                if (i === loadingOptions.length - 1) {
                    throw lastError;
                }
            }
        }

        if (isPasswordProtected || !pdf) {
            return {
                thumbnail: "",
                isPasswordProtected: true,
                securityInfo: "パスワード付きPDF"
            };
        }

        // サムネイル生成
        const page = await pdf.getPage(1);
        let pageRotation = 0;
        try {
            if (typeof page.getRotation === 'function') pageRotation = page.getRotation();
            else if (typeof page.rotate !== 'undefined') pageRotation = page.rotate;
        } catch (e) {
            pageRotation = 0;
        }
        pageRotation = ((Number(pageRotation) || 0) % 360 + 360) % 360;

        const canvas = await renderPageToCanvas(page, pdfConfig.pdfSettings.scales.thumbnail, 0);
        const thumbnail = canvas.toDataURL('image/png');

        // ブックマーク取得
        let bookmarks = [];
        try {
            const outline = await pdf.getOutline();
            if (outline && outline.length) {
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
                bookmarks = await mapOutlineItems(outline);
            }
        } catch (e) {
            console.error('pdf: outline extraction failed', e);
        }

        return {
            thumbnail,
            isPasswordProtected: false,
            securityInfo: "",
            bookmarks,
            pageRotation
        };

    } catch (error) {
        return handlePdfError(error, 'renderFirstPDFPage');
    }
};

// ========================================
// 指定ページのサムネイル生成
// ========================================
window.generatePdfThumbnailFromFileMetaData = async function (pdfFileData, pageIndex) {
    try {
        const uint8Array = toUint8Array(pdfFileData);
        const pdf = await loadPdfDocument(uint8Array);
        
        const page = await pdf.getPage(pageIndex + 1);
        const canvas = await renderPageToCanvas(page, pdfConfig.pdfSettings.scales.thumbnail, 0);
        const thumbnail = canvas.toDataURL('image/png');

        return {
            thumbnail,
            isError: false,
            isPasswordProtected: false,
            securityInfo: ""
        };
    } catch (error) {
        return handlePdfError(error, 'generatePdfThumbnailFromFileMetaData');
    }
};

// ========================================
// 画像変換ヘルパー
// ========================================
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

        if (base64OrDataUrl.startsWith('data:')) {
            img.src = base64OrDataUrl;
        } else if (mime) {
            img.src = `data:${mime};base64,${base64OrDataUrl}`;
        } else {
            img.src = `data:image/png;base64,${base64OrDataUrl}`;
        }
    });
};

// ========================================
// PDFページ数取得
// ========================================
window.getPDFPageCount = async function (pdfData) {
    try {
        const uint8Array = toUint8Array(pdfData);
        const pdf = await loadPdfDocument(uint8Array, { stopAtErrors: false, verbosity: 1 });
        return pdf.numPages;
    } catch (error) {
        console.error('Error in getPDFPageCount:', error);
        throw error;
    }
};

// ========================================
// 画像フォールバック処理
// ========================================
async function imageFallbackPdf(uint8Array, pageIndex, cacheKey = null) {
    if (cacheKey) {
        window._pdfCache.markRestricted(cacheKey);
    }

    const pdf = await loadPdfDocument(uint8Array);
    const page = await pdf.getPage(pageIndex + 1);
    
    const scale = pdfConfig?.pdfSettings?.scales?.unlock || 1.5;
    const canvas = await renderPageToCanvas(page, scale, 0, { fillWhite: true });
    
    const imgDataUrl = canvas.toDataURL('image/png');
    const imgBytes = base64ToUint8Array(imgDataUrl.split(',')[1]);

    const { PDFDocument } = PDFLib;
    const imgPdf = await PDFDocument.create();
    const embedded = await imgPdf.embedPng(imgBytes);
    imgPdf.addPage([canvas.width, canvas.height]);
    const [imgPage] = imgPdf.getPages();
    imgPage.drawImage(embedded, { x: 0, y: 0, width: canvas.width, height: canvas.height });

    const newPdfBytes = await imgPdf.save();
    return uint8ArrayToBase64(newPdfBytes);
}

// ========================================
// 空白ページ作成
// ========================================
window.createBlankPage = async function () {
    try {
        const { PDFDocument } = PDFLib;
        const blankPdf = await PDFDocument.create();
        blankPdf.addPage([595.28, 841.89]);
        const pdfBytes = await blankPdf.save();
        return uint8ArrayToBase64(pdfBytes);
    } catch (error) {
        console.error('Error creating blank page:', error);
        return '';
    }
}

// ========================================
// PDFページ抽出
// ========================================
window.extractPdfPage = async function (pdfData, pageIndex, cacheKey = null) {
    try {
        const { PDFDocument } = PDFLib;
        const uint8Array = toUint8Array(pdfData);

        let srcPdfDoc = null;
        if (cacheKey && window._pdfCache.has(cacheKey)) {
            srcPdfDoc = window._pdfCache.get(cacheKey);
        } else {
            try {
                srcPdfDoc = await PDFDocument.load(uint8Array);
                if (cacheKey) {
                    window._pdfCache.set(cacheKey, srcPdfDoc);
                }
            } catch (loadErr) {
                return await imageFallbackPdf(uint8Array, pageIndex, cacheKey);
            }
        }

        const newPdf = await PDFDocument.create();

        try {
            if (cacheKey && window._pdfCache.isRestricted(cacheKey)) {
                throw new Error('file-restricted-precheck');
            }
            const [copiedPage] = await newPdf.copyPages(srcPdfDoc, [pageIndex]);
            newPdf.addPage(copiedPage);
        } catch (copyError) {
            return await imageFallbackPdf(uint8Array, pageIndex, cacheKey);
        }

        const pdfBytes = await newPdf.save();
        return uint8ArrayToBase64(pdfBytes);

    } catch (error) {
        console.error(`Error extracting PDF page ${pageIndex}:`, error);
        return await window.createBlankPage();
    }
};

// ========================================
// 単一PDFページサムネイル生成
// ========================================
window.generatePdfThumbnailFromPageData = async function (pdfData) {
    try {
        const uint8Array = base64ToUint8Array(pdfData);
        const pdf = await loadPdfDocument(uint8Array);
        const page = await pdf.getPage(1);
        const canvas = await renderPageToCanvas(page, pdfConfig.pdfSettings.scales.thumbnail);
        return canvas.toDataURL('image/png');
    } catch (error) {
        console.error('Error rendering single PDF page:', error);
        return '';
    }
};

// ========================================
// プレビュー画像生成
// ========================================
window.generatePreviewImage = async function (pdfBase64, rotateAngle) {
    const uint8Array = base64ToUint8Array(pdfBase64);
    const pdf = await loadPdfDocument(uint8Array);
    const page = await pdf.getPage(1);
    const canvas = await renderPageToCanvas(page, pdfConfig.pdfSettings.scales.normal, rotateAngle || 0);
    return canvas.toDataURL('image/jpeg', 0.85);
};

// ========================================
// ファイルサイズ取得
// ========================================
window.getPdfFileSize = async function (url) {
    const response = await fetch(url);
    const blob = await response.blob();
    const sizeMB = (blob.size / (1024 * 1024)).toFixed(2) + "MB";
    return sizeMB;
};

// ========================================
// ダウンロード
// ========================================
window.downloadFileFromUrl = function (url, filename, mimeType) {
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.type = mimeType || 'application/octet-stream';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
};

// ========================================
// PDF複数ページレンダリング
// ========================================
window.renderPdfPages = async function (pdfUrl, canvasIds) {
    if (!window.pdfjsLib) {
        console.error("pdfjsLib is not loaded");
        return;
    }

    const pdf = await loadPdfDocument(await fetch(pdfUrl).then(r => r.arrayBuffer()).then(b => new Uint8Array(b)));
    
    for (let i = 0; i < canvasIds.length; i++) {
        const page = await pdf.getPage(i + 1);
        const canvas = document.getElementById(canvasIds[i]);
        if (!canvas) continue;
        
        const viewport = page.getViewport({ scale: pdfConfig.pdfSettings.scales.normal });
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const context = canvas.getContext('2d');
        await page.render({ canvasContext: context, viewport: viewport }).promise;
    }
};

// ========================================
// Canvas存在確認
// ========================================
window.checkCanvasExists = function (canvasId) {
    return !!document.getElementById(canvasId);
};

// ========================================
// PDFサムネイルをCanvasに描画
// ========================================
window.renderPdfThumbnailToCanvas = async function (pdfUrl, canvasId) {
    if (!window.pdfjsLib) {
        throw new Error("pdfjsLib is not loaded.");
    }
    
    if (window._pdfCache.isRendering(canvasId)) {
        console.warn("render in progress, skipping:", canvasId);
        return false;
    }

    window._pdfCache.setRendering(canvasId, true);
    try {
        const response = await fetch(pdfUrl);
        const arrayBuffer = await response.arrayBuffer();
        const uint8Array = new Uint8Array(arrayBuffer);
        
        const pdf = await loadPdfDocument(uint8Array);
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
        window._pdfCache.setRendering(canvasId, false);
    }
};

// ========================================
// 画像をCanvasに描画
// ========================================
window.drawImageToCanvas = function (canvasId, imageUrl, useDevicePixelRatio = true) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const img = new window.Image();
    img.crossOrigin = 'anonymous';

    img.onload = function () {
        try {
            // 親要素の内寸を使って canvas を親いっぱいにする（親の border に合わせるため）
            const parent = canvas.parentElement || document.body;
            const parentStyle = window.getComputedStyle(parent);
            const padL = parseFloat(parentStyle.paddingLeft) || 0;
            const padR = parseFloat(parentStyle.paddingRight) || 0;
            const padT = parseFloat(parentStyle.paddingTop) || 0;
            const padB = parseFloat(parentStyle.paddingBottom) || 0;

            const availW = Math.max(1, parent.clientWidth - padL - padR);
            const availH = Math.max(1, parent.clientHeight - padT - padB);

            // CSS 表示サイズを決めてキャンバスを合わせる（親内に収めつつ画像のアスペクト比を保持）
            const imgW = Math.max(1, img.width || 1);
            const imgH = Math.max(1, img.height || 1);
            const imgRatio = imgW / imgH;
            const availRatio = availW / availH;

            let cssW, cssH;
            if (imgRatio > availRatio) {
                cssW = availW;
                cssH = Math.max(1, Math.round(availW / imgRatio));
            } else {
                cssH = availH;
                cssW = Math.max(1, Math.round(availH * imgRatio));
            }

            // 表示サイズをキャンバスに反映（CSS サイズとピクセルバッファ）
            const dpr = useDevicePixelRatio ? (window.devicePixelRatio || 1) : 1;
            canvas.style.width = cssW + 'px';
            canvas.style.height = cssH + 'px';
            canvas.width = Math.max(1, Math.round(cssW * dpr));
            canvas.height = Math.max(1, Math.round(cssH * dpr));

            // 描画は CSS ピクセル座標で行う
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';

            ctx.clearRect(0, 0, cssW, cssH);

            // contain モードで縮小して中央に描画（切らさない）
            const scale = Math.min(cssW / imgW, cssH / imgH);
            const drawW = imgW * scale;
            const drawH = imgH * scale;
            const offsetX = Math.round((cssW - drawW) / 2);
            const offsetY = Math.round((cssH - drawH) / 2);

            // ソース全体を目的位置へリサイズ描画
            ctx.drawImage(img, 0, 0, imgW, imgH, offsetX, offsetY, drawW, drawH);

        } catch (e) {
            console.debug('drawImageToCanvas error', e);
        }
    };

    img.onerror = function (e) {
        console.debug('drawImageToCanvas image load error', e, imageUrl);
    };

    img.src = imageUrl;
};
// ========================================
// PDF ロック解除
// ========================================
window.unlockPdf = async function (pdfData, password) {
    const uint8Array = toUint8Array(pdfData);
    const pdf = await loadPdfDocument(uint8Array, { password });
    
    const { PDFDocument } = PDFLib;
    const unlockedPdf = await PDFDocument.create();
    
    for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const canvas = await renderPageToCanvas(
            page,
            pdfConfig.pdfSettings.scales.unlock,
            0,
            { fillWhite: true }
        );
        
        const imgData = canvas.toDataURL('image/png');
        const img = await unlockedPdf.embedPng(imgData);
        const pdfPage = unlockedPdf.addPage([canvas.width, canvas.height]);
        pdfPage.drawImage(img, { 
            x: 0, y: 0, 
            width: canvas.width, 
            height: canvas.height 
        });
    }
    
    return uint8ArrayToBase64(await unlockedPdf.save());
};

// ========================================
// PDF編集（テキスト・画像追加）
// ========================================
window.editPdfPageWithElements = async function (pdfBase64, editJson) {
    const { PDFDocument, rgb, StandardFonts } = PDFLib;

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

    const fontManager = new PdfFontManager(pdfDoc);

    for (const el of editElements) {
        if (el.Type === 0 || el.Type === "Text") {
            const font = await fontManager.getFont(el.Text, { 
                isBold: el.IsBold, 
                isSerif: (el.FontFamily || '').toLowerCase().includes('notoserif')
            });

            const rotateDegrees = PDFLib.degrees(el.Rotation || 0);
            const fontSize = Number(el.FontSize) || 16;
            const specifiedLineHeight = (typeof el.LineHeight !== "undefined" && el.LineHeight > 0) ? Number(el.LineHeight) : null;
            const lineHeightPx = specifiedLineHeight || fontSize;

            const text = el.Text || "";
            const startX = (typeof el.X === "number") ? el.X : 0;
            const maxWidth = (typeof el.Width === "number" && el.Width > 0)
                ? Number(el.Width)
                : (page.getWidth() - startX);

            function splitToLines(paragraph, font, size, maxW) {
                if (!paragraph) return [''];
                const lines = [];
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
                        if (tokenWidth <= maxW) {
                            current = token;
                        } else {
                            let chunk = '';
                            for (let i = 0; i < token.length; i++) {
                                chunk += token[i];
                                const w = font.widthOfTextAtSize(chunk, size);
                                if (w > maxW) {
                                    if (chunk.length > 1) {
                                        lines.push(chunk.slice(0, -1));
                                        chunk = chunk.slice(-1);
                                    } else {
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

            const paragraphs = text.split('\n');
            const wrappedLines = [];
            for (const p of paragraphs) {
                const lines = splitToLines(p, font, fontSize, maxWidth);
                if (lines.length === 0) wrappedLines.push('');
                else wrappedLines.push(...lines);
            }
            
            const startY = pageHeight - (el.Y || 0) - fontSize;
            for (let i = 0; i < wrappedLines.length; i++) {
                page.drawText(wrappedLines[i] || '', {
                    x: startX,
                    y: startY - (i * lineHeightPx),
                    size: fontSize,
                    font: font,
                    color: hexToRgb(el.Color || "#000000"),
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
                console.warn("未対応画像形式: ", el.ImageUrl ? el.ImageUrl.substring(0, 30) : "");
            }
        }
    }

    const newPdfBytes = await pdfDoc.save();
    return uint8ArrayToBase64(newPdfBytes);
};

// ========================================
// スタンプ追加
// ========================================
window.addStampsToPdf = async function (pdfBytes, stamps) {
    const { PDFDocument, rgb, StandardFonts, degrees } = PDFLib;

    if (!PDFLib._fontkitRegistered) {
        if (window.fontkit) {
            PDFLib.PDFDocument.prototype.registerFontkit(window.fontkit);
            PDFLib._fontkitRegistered = true;
        } else {
            console.warn("fontkitがロードされていません。日本語フォントは使用できません。");
        }
    }

    const uint8Array = toUint8Array(pdfBytes);
    const rotateAngle = stamps.length > 0 ? (stamps[0].rotateAngle || 0) : 0;
    const normalizedAngle = ((rotateAngle % 360) + 360) % 360;

    const pdfDoc = await PDFDocument.load(uint8Array);
    const page = pdfDoc.getPage(0);
    const { width, height } = page.getSize();

    let notoFontRegular = null;

    function generateSerialNumber(currentPageIndex, totalPages, isZeroPadded) {
        const pageNumber = currentPageIndex + 1;
        if (!isZeroPadded) {
            return pageNumber.toString();
        }
        const digits = totalPages.toString().length;
        return pageNumber.toString().padStart(digits, '0');
    }

    function transformCoordinates(corner, offsetX, offsetY, rotateAngle, pageWidth, pageHeight, textWidth, fontSize) {
        let x = 0, y = 0;
        let textRotation = 0;

        const angle = ((rotateAngle % 360) + 360) % 360;

        if (angle === 0) {
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
            switch (corner) {
                case 'TopLeft':
                    x = offsetY;
                    y = offsetX;
                    break;
                case 'Top':
                    x = offsetY;
                    y = pageHeight / 2 - textWidth / 2;
                    break;
                case 'TopRight':
                    x = offsetY;
                    y = pageHeight - offsetX - textWidth;
                    break;
                case 'BottomLeft':
                    x = pageWidth - offsetY;
                    y = offsetX;
                    break;
                case 'Bottom':
                    x = pageWidth - offsetY;
                    y = pageHeight / 2 - textWidth / 2;
                    break;
                case 'BottomRight':
                    x = pageWidth - offsetY;
                    y = pageHeight - offsetX - textWidth;
                    break;
            }
            textRotation = 90;
        } else if (angle === 180) {
            switch (corner) {
                case 'TopLeft':
                    x = pageWidth - offsetX;
                    y = offsetY;
                    break;
                case 'Top':
                    x = pageWidth / 2 - textWidth / 2;
                    y = offsetY;
                    break;
                case 'TopRight':
                    x = offsetX + textWidth;
                    y = offsetY;
                    break;
                case 'BottomLeft':
                    x = pageWidth - offsetX;
                    y = pageHeight - offsetY;
                    break;
                case 'Bottom':
                    x = pageWidth / 2 - textWidth / 2;
                    y = pageHeight - offsetY;
                    break;
                case 'BottomRight':
                    x = offsetX + textWidth;
                    y = pageHeight - offsetY;
                    break;
            }
            textRotation = 180;
        } else if (angle === 270) {
            switch (corner) {
                case 'TopLeft':
                    x = pageWidth - offsetY;
                    y = pageHeight - offsetX;
                    break;
                case 'Top':
                    x = pageWidth - offsetY;
                    y = pageHeight / 2 - textWidth / 2;
                    break;
                case 'TopRight':
                    x = pageWidth - offsetY;
                    y = offsetX + textWidth;
                    break;
                case 'BottomLeft':
                    x = offsetY;
                    y = pageHeight - offsetX;
                    break;
                case 'Bottom':
                    x = offsetY;
                    y = pageHeight / 2 - textWidth / 2;
                    break;
                case 'BottomRight':
                    x = offsetY;
                    y = offsetX + textWidth;
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

        const color = stamp.color ?
            rgb(stamp.color.r || 0, stamp.color.g || 0, stamp.color.b || 0) :
            rgb(0, 0, 0);

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

// ========================================
// トリミング（ラスタ化版）
// ========================================
window.cropPdfPageRasterized = async function (pdfBase64, normX, normY, normWidth, normHeight, rotateAngle = 0) {
    try {
        const uint8Array = base64ToUint8Array(pdfBase64);
        const pdf = await loadPdfDocument(uint8Array);
        const page = await pdf.getPage(1);
        
        // 元のページサイズを取得（回転前）
        const originalViewport = page.getViewport({ scale: 1.0, rotation: 0 });
        const pageW = originalViewport.width;
        const pageH = originalViewport.height;
        
        const quant = normalizeRotationAngle(rotateAngle);
        const scale = pdfConfig?.pdfSettings?.scales?.unlock || 1.5;
        
        // 正規化座標をクランプ
        const nx = Math.max(0, Math.min(1, Number(normX) || 0));
        const ny = Math.max(0, Math.min(1, Number(normY) || 0));
        const nw = Math.max(0, Math.min(1, Number(normWidth) || 0));
        const nh = Math.max(0, Math.min(1, Number(normHeight) || 0));
        
        // PDF座標系で計算（cropPdfPageToTrimVectorと同じロジック）
        const llx = nx * pageW;
        const lly = pageH * (1 - ny - nh);  // Y座標を反転
        const urx = llx + (nw * pageW);
        const ury = lly + (nh * pageH);
        
        // 回転を適用したviewport
        const viewport = page.getViewport({ scale: scale, rotation: quant });

        const srcCanvas = document.createElement('canvas');
        srcCanvas.width = Math.max(1, Math.round(viewport.width));
        srcCanvas.height = Math.max(1, Math.round(viewport.height));
        const srcCtx = srcCanvas.getContext('2d', { alpha: false });
        await page.render({ canvasContext: srcCtx, viewport: viewport }).promise;

        // PDF座標をCanvas座標にスケール変換
        const scaleX = srcCanvas.width / pageW;
        const scaleY = srcCanvas.height / pageH;
        
        const sx = Math.round(llx * scaleX);
        const sy = Math.round((pageH - ury) * scaleY);  // Canvas座標系に変換
        const sw = Math.max(1, Math.round((urx - llx) * scaleX));
        const sh = Math.max(1, Math.round((ury - lly) * scaleY));

        const cropCanvas = document.createElement('canvas');
        cropCanvas.width = sw;
        cropCanvas.height = sh;
        const cropCtx = cropCanvas.getContext('2d', { alpha: false });
        cropCtx.drawImage(srcCanvas, sx, sy, sw, sh, 0, 0, sw, sh);

        const imgDataUrl = cropCanvas.toDataURL('image/png');
        const imgBase64 = imgDataUrl.split(',')[1];
        const imgBytes = base64ToUint8Array(imgBase64);

        const { PDFDocument } = PDFLib;
        const doc = await PDFDocument.create();
        const png = await doc.embedPng(imgBytes);
        const newPage = doc.addPage([sw, sh]);
        newPage.drawImage(png, { x: 0, y: 0, width: sw, height: sh });

        const newPdfBytes = await doc.save();
        return uint8ArrayToBase64(newPdfBytes);
    } catch (e) {
        console.error("cropPdfPageRasterized error", e);
        return pdfBase64 || "";
    }
};

// ========================================
// トリミング（ベクトル版）
// ========================================
window.cropPdfPageToTrimVector = async function (pdfBase64, normX, normY, normWidth, normHeight, rotateAngle = 0) {
    try {
        const bytes = base64ToUint8Array(pdfBase64);
        const { PDFDocument, PDFName } = PDFLib;

        const srcDoc = await PDFDocument.load(bytes);
        const srcPage = srcDoc.getPages()[0];
        const pageW = srcPage.getWidth();
        const pageH = srcPage.getHeight();

        const nx = Math.max(0, Math.min(1, Number(normX) || 0));
        const ny = Math.max(0, Math.min(1, Number(normY) || 0));
        const nw = Math.max(0, Math.min(1, Number(normWidth) || 0));
        const nh = Math.max(0, Math.min(1, Number(normHeight) || 0));

        const quant = normalizeRotationAngle(rotateAngle);

        let llx, lly, urx, ury;

        if (quant === 0) {
            // PDF座標系（左下原点）で計算
            // normY, normHeight は「上から」の正規化座標なので、PDF座標に変換
            llx = nx * pageW;
            lly = pageH * (1 - ny - nh);  // Y座標を反転
            urx = llx + (nw * pageW);
            ury = lly + (nh * pageH);
        } else {
            // 回転時の座標変換（既存コード維持）
            const D_w = (quant % 180 === 0) ? pageW : pageH;
            const D_h = (quant % 180 === 0) ? pageH : pageW;

            const sx = nx * D_w;
            const sy = ny * D_h;
            const sw = Math.max(1, nw * D_w);
            const sh = Math.max(1, nh * D_h);

            const cxD = D_w / 2;
            const cyD = D_h / 2;
            const cxP = pageW / 2;
            const cyP = pageH / 2;
            const theta = -quant * Math.PI / 180;
            const cosT = Math.cos(theta);
            const sinT = Math.sin(theta);

            function displayToPdf(x_d, y_d) {
                const x_c = x_d - cxD;
                const y_c = cyD - y_d;
                const x_pc = x_c * cosT - y_c * sinT;
                const y_pc = x_c * sinT + y_c * cosT;
                return { x: x_pc + cxP, y: y_pc + cyP };
            }

            const tl = displayToPdf(sx, sy);
            const tr = displayToPdf(sx + sw, sy);
            const bl = displayToPdf(sx, sy + sh);
            const br = displayToPdf(sx + sw, sy + sh);

            const xs = [tl.x, tr.x, bl.x, br.x];
            const ys = [tl.y, tr.y, bl.y, br.y];
            
            llx = Math.min(...xs);
            lly = Math.min(...ys);
            urx = Math.max(...xs);
            ury = Math.max(...ys);
        }

        const clampedLlX = Math.max(0, Math.min(pageW, Math.round(llx)));
        const clampedLlY = Math.max(0, Math.min(pageH, Math.round(lly)));
        const clampedUrX = Math.max(0, Math.min(pageW, Math.round(urx)));
        const clampedUrY = Math.max(0, Math.min(pageH, Math.round(ury)));

        const outDoc = await PDFDocument.create();
        const [copied] = await outDoc.copyPages(srcDoc, [0]);
        outDoc.addPage(copied);

        copied.node.set(PDFName.of('CropBox'), outDoc.context.obj([
            clampedLlX,
            clampedLlY,
            clampedUrX,
            clampedUrY
        ]));

        const outBytes = await outDoc.save();
        return uint8ArrayToBase64(outBytes);
    } catch (e) {
        console.error('cropPdfPageToTrimVector error', e);
        return pdfBase64 || "";
    }
};

// ========================================
// 画像サイズ取得
// ========================================
window.getImageSizeFromDataUrl = function (dataUrl) {
    return new Promise((resolve) => {
        try {
            if (!dataUrl) { resolve([0, 0]); return; }
            const img = new Image();
            img.onload = function () {
                resolve([img.naturalWidth || 0, img.naturalHeight || 0]);
            };
            img.onerror = function () {
                resolve([0, 0]);
            };
            img.src = dataUrl;
            setTimeout(() => {
                if (!img.complete) resolve([0, 0]);
            }, 2000);
        } catch (e) {
            resolve([0, 0]);
        }
    });
};

// ========================================
// トリミング → 画像出力
// ========================================
window.cropPdfPageToImage = async function (pageDataBase64, normX, normY, normWidth, normHeight, rotateAngle = 0, dpi = 150) {
    try {
        const uint8Array = base64ToUint8Array(pageDataBase64);
        const pdf = await loadPdfDocument(uint8Array);
        const page = await pdf.getPage(1);
        
        // 元のページサイズを取得（回転前）
        const originalViewport = page.getViewport({ scale: 1.0, rotation: 0 });
        const pageW = originalViewport.width;
        const pageH = originalViewport.height;
        
        const quant = normalizeRotationAngle(rotateAngle);
        const scale = dpi / 72;

        // 正規化座標をクランプ
        const nx = Math.max(0, Math.min(1, Number(normX) || 0));
        const ny = Math.max(0, Math.min(1, Number(normY) || 0));
        const nw = Math.max(0, Math.min(1, Number(normWidth) || 0));
        const nh = Math.max(0, Math.min(1, Number(normHeight) || 0));
        
        // PDF座標系で計算（cropPdfPageToTrimVectorと同じロジック）
        const llx = nx * pageW;
        const lly = pageH * (1 - ny - nh);  // Y座標を反転
        const urx = llx + (nw * pageW);
        const ury = lly + (nh * pageH);

        const viewport = page.getViewport({ scale: scale, rotation: quant });

        const srcCanvas = document.createElement('canvas');
        srcCanvas.width = Math.max(1, Math.round(viewport.width));
        srcCanvas.height = Math.max(1, Math.round(viewport.height));
        const srcCtx = srcCanvas.getContext('2d', { alpha: false });
        
        srcCtx.fillStyle = '#FFFFFF';
        srcCtx.fillRect(0, 0, srcCanvas.width, srcCanvas.height);
        
        await page.render({ canvasContext: srcCtx, viewport: viewport }).promise;

        // PDF座標をCanvas座標にスケール変換
        const scaleX = srcCanvas.width / pageW;
        const scaleY = srcCanvas.height / pageH;
        
        const sx = Math.round(llx * scaleX);
        const sy = Math.round((pageH - ury) * scaleY);  // Canvas座標系に変換
        const sw = Math.max(1, Math.round((urx - llx) * scaleX));
        const sh = Math.max(1, Math.round((ury - lly) * scaleY));

        const cropCanvas = document.createElement('canvas');
        cropCanvas.width = sw;
        cropCanvas.height = sh;
        const cropCtx = cropCanvas.getContext('2d', { alpha: false });

        cropCtx.fillStyle = '#FFFFFF';
        cropCtx.fillRect(0, 0, sw, sh);

        cropCtx.drawImage(srcCanvas, sx, sy, sw, sh, 0, 0, sw, sh);

        return cropCanvas.toDataURL('image/png');

    } catch (error) {
        console.error('cropPdfPageToImage error:', error);
        throw error;
    }
};

// 表示領域監視による遅延描画
window.drawVisibleCanvases = function(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const canvas = entry.target;
                const itemId = canvas.dataset.itemId;
                const thumbUrl = canvas.dataset.thumbnail;
                
                if (thumbUrl && !canvas.dataset.drawn) {
                    window.drawImageToCanvas(canvas.id, thumbUrl);
                    canvas.dataset.drawn = 'true';
                    observer.unobserve(canvas);
                }
            }
        });
    }, { rootMargin: '200px' }); // 200px手前から読み込み開始

    container.querySelectorAll('canvas[data-thumbnail]').forEach(canvas => {
        observer.observe(canvas);
    });
};