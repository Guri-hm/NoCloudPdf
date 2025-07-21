window.mergePDFs = async function (pdfDataList) {
    const { PDFDocument } = PDFLib;
    const mergedPdf = await PDFDocument.create();

    for (const pdfData of pdfDataList) {
        const pdfDoc = await PDFDocument.load(new Uint8Array(pdfData));
        const copiedPages = await mergedPdf.copyPages(pdfDoc, pdfDoc.getPageIndices());
        copiedPages.forEach((page) => mergedPdf.addPage(page));
    }

    const mergedPdfBytes = await mergedPdf.save();
    const blob = new Blob([mergedPdfBytes], { type: 'application/pdf' });
    return URL.createObjectURL(blob);
};

// 統一アーキテクチャ用のマージデータに基づいてPDFページを結合
window.mergePDFPages = async function (mergeData) {
    const { PDFDocument } = PDFLib;
    const mergedPdf = await PDFDocument.create();

    for (const item of mergeData) {
        const pdfDoc = await PDFDocument.load(new Uint8Array(item.fileData));
        const pageIndex = item.originalPageNumber - 1; // 0ベースインデックスに変換
        const [copiedPage] = await mergedPdf.copyPages(pdfDoc, [pageIndex]);
        mergedPdf.addPage(copiedPage);
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

        // Canvasを画像データとして取得
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
            // Base64エンコードされた文字列の場合

            const binaryString = atob(pdfData);
            uint8Array = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
                uint8Array[i] = binaryString.charCodeAt(i);
            }

        } else {

            uint8Array = new Uint8Array(pdfData);
        }

        // PDFヘッダーチェック
        if (uint8Array.length < 8) {
            throw new Error('Data too short to be valid PDF');
        }

        const header = String.fromCharCode.apply(null, uint8Array.slice(0, 8));


        if (!header.startsWith('%PDF-')) {

            throw new Error(`Invalid PDF header: ${header}`);
        }

        // PDF.jsライブラリの確認
        const pdfjsLib = window['pdfjs-dist/build/pdf'];
        if (!pdfjsLib) {
            throw new Error('PDF.js library not loaded');
        }



        // Worker設定
        if (pdfjsLib.GlobalWorkerOptions) {
            pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.11.338/pdf.worker.min.js';
        } else if (pdfjsLib.workerSrc) {
            pdfjsLib.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.11.338/pdf.worker.min.js';
        }

        // PDF構造の基本検証
        if (uint8Array.length < 1024) {
            throw new Error('PDF file is too small to be valid');
        }

        // 複数の読み込み設定を試行
        const loadingOptions = [
            // 最も制限的な設定（安全性重視）
            {
                data: uint8Array,
                stopAtErrors: false,
                maxImageSize: 1024 * 1024 * 5,
                disableFontFace: true,
                disableRange: true,
                disableStream: true,
                verbosity: 1
            },
            // 中程度の設定
            {
                data: uint8Array,
                stopAtErrors: false,
                maxImageSize: 1024 * 1024 * 10,
                disableFontFace: false,
                disableRange: true,
                disableStream: false,
                verbosity: 1
            },
            // 最小限の制限設定
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
                console.warn(`Loading option ${i + 1} failed:`, error.message);
                lastError = error;
                if (i === loadingOptions.length - 1) {
                    throw lastError;
                }
            }
        }

        if (!pdf) {
            throw new Error('Failed to load PDF with all options');
        }



        // 最初のページのみレンダリング
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


        // BlazorからのデータがUint8Arrayかどうかチェック
        let uint8Array;
        if (pdfData instanceof Uint8Array) {
            uint8Array = pdfData;

        } else if (Array.isArray(pdfData)) {
            uint8Array = new Uint8Array(pdfData);

        } else if (typeof pdfData === 'string') {
            // Base64エンコードされた文字列の場合

            const binaryString = atob(pdfData);
            uint8Array = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
                uint8Array[i] = binaryString.charCodeAt(i);
            }
            console.log('Converted base64 to Uint8Array, length:', uint8Array.length);
        } else {
            console.log('Data type not recognized, attempting to convert...');
            uint8Array = new Uint8Array(pdfData);
        }

        const pdfjsLib = window['pdfjs-dist/build/pdf'];
        if (!pdfjsLib) {
            throw new Error('PDF.js library not loaded');
        }

        if (pdfjsLib.GlobalWorkerOptions) {
            pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.11.338/pdf.worker.min.js';
        }

        // 複数の読み込み設定を試行（renderFirstPDFPageと同じ方式）
        const loadingOptions = [
            // 最も制限的な設定（安全性重視）
            {
                data: uint8Array,
                stopAtErrors: false,
                maxImageSize: 1024 * 1024 * 5,
                disableFontFace: true,
                disableRange: true,
                disableStream: true,
                verbosity: 1
            },
            // 中程度の設定
            {
                data: uint8Array,
                stopAtErrors: false,
                maxImageSize: 1024 * 1024 * 10,
                disableFontFace: false,
                disableRange: true,
                disableStream: false,
                verbosity: 1
            },
            // 最小限の制限設定
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
                console.warn(`Loading option ${i + 1} failed for page ${pageIndex}:`, error.message);
                lastError = error;
                if (i === loadingOptions.length - 1) {
                    throw lastError;
                }
            }
        }

        if (!pdf) {
            throw new Error('Failed to load PDF with all options');
        }

        // ページ数チェック
        if (pageIndex >= pdf.numPages) {
            return '';
        }

        // 指定されたページをレンダリング（0ベースから1ベースへ変換）
        const page = await pdf.getPage(pageIndex + 1);
        const viewport = page.getViewport({ scale: 0.5 }); // スケールを小さくしてメモリ使用量を削減
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;

        const context = canvas.getContext('2d');
        const renderContext = {
            canvasContext: context,
            viewport: viewport,
            intent: 'display'
        };

        // タイムアウト付きでレンダリング
        const renderTask = page.render(renderContext);

        // 10秒でタイムアウト
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Rendering timeout')), 10000);
        });

        await Promise.race([renderTask.promise, timeoutPromise]);

        return canvas.toDataURL('image/png');

    } catch (error) {
        console.error(`Error rendering PDF page ${pageIndex}:`, error);

        // エラー時は空白画像を生成
        try {
            const canvas = document.createElement('canvas');
            canvas.width = 200;
            canvas.height = 280;
            const ctx = canvas.getContext('2d');

            // 背景を白に
            ctx.fillStyle = 'white';
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            // エラーメッセージを描画
            ctx.fillStyle = '#dc2626';
            ctx.font = '14px Arial';
            ctx.textAlign = 'center';
            ctx.fillText('読み込みエラー', canvas.width / 2, canvas.height / 2 - 10);
            ctx.font = '10px Arial';
            ctx.fillText(`ページ ${pageIndex + 1}`, canvas.width / 2, canvas.height / 2 + 10);

            // 枠線を描画
            ctx.strokeStyle = '#fca5a5';
            ctx.lineWidth = 2;
            ctx.strokeRect(5, 5, canvas.width - 10, canvas.height - 10);

            return canvas.toDataURL('image/png');
        } catch (fallbackError) {
            console.error('Error creating fallback image:', fallbackError);
            return ''; // 完全に失敗した場合は空文字を返す
        }
    }
};

// PDFのページ数のみ取得
window.getPDFPageCount = async function (pdfData) {
    try {

        // BlazorからのデータがUint8Arrayかどうかチェック
        let uint8Array;
        if (pdfData instanceof Uint8Array) {
            uint8Array = pdfData;

        } else if (Array.isArray(pdfData)) {
            uint8Array = new Uint8Array(pdfData);

        } else if (typeof pdfData === 'string') {
            // Base64エンコードされた文字列の場合

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

        console.log('PDF page count retrieved:', pdf.numPages);
        return pdf.numPages;
    } catch (error) {
        console.error('Error in getPDFPageCount:', error);
        throw error;
    }
};

// ページレベルでPDFを結合する関数
window.mergePDFPages = async function (pdfPageDataList) {
    const { PDFDocument } = PDFLib;
    const mergedPdf = await PDFDocument.create();

    for (const pageData of pdfPageDataList) {
        // base64斁E�E��E��E�EをUint8Arrayに変換
        const binaryString = atob(pageData);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }

        const pdfDoc = await PDFDocument.load(bytes);
        const [page] = await mergedPdf.copyPages(pdfDoc, [0]);
        mergedPdf.addPage(page);
    }

    const mergedPdfBytes = await mergedPdf.save();
    const blob = new Blob([mergedPdfBytes], { type: 'application/pdf' });
    return URL.createObjectURL(blob);
};

// 持E�E��E�した�E�Eージを個別のPDFチE�E�Eタとして抽出する関数
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
            // Base64エンコードされた文字列の場合
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
            // エラー時は空白ページを作成
            const blankPdf = await PDFDocument.create();
            blankPdf.addPage([595.28, 841.89]); // A4サイズの空白ページ
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

        // base64エンコーチE
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
            console.error('Error creating fallback blank PDF:', fallbackError);
            return ''; // 完全に失敗した場合は空文字を返す
        }
    }
};

// PDFの吁E�E�Eージを個別のPDFチE�E�Eタとして抽出する関数
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

            // スプレチE�E��E�演算子を使わずにbase64エンコーチE
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
window.rotatePDFPage = async function (pageData) {
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
            page.setRotation(degrees(90));
        }

        const pdfBytes = await pdfDoc.save();

        // スプレチE�E��E�演算子を使わずにbase64エンコーチE
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

// 非同期でページごとにサムネイルを生成する関数（大量ページ処理やメモリ効率向上向け）
window.renderPDFPagesAsync = async function (pdfData, dotNetRef) {
    const pdfjsLib = window['pdfjs-dist/build/pdf'];
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.11.338/pdf.worker.min.js';

    try {
        const loadingTask = pdfjsLib.getDocument({ data: pdfData });
        const pdf = await loadingTask.promise;

        console.log(`Starting async rendering for ${pdf.numPages} pages`);

        // 吁E�E�Eージを頁E�E��E�処琁E
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

                // DotNetObjectReferenceのメソチE�E��E�を呼び出ぁE
                await dotNetRef.invokeMethodAsync('OnPageThumbnailReady', i - 1, imageData);

                console.log(`Page ${i} rendered and sent to Blazor`);

                // メモリ解放とUI更新のための短ぁE�E��E�E�E��E�E
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

        // base64エンコーチE
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

        // base64斁E�E��E��E�EをUint8Arrayに変換
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
