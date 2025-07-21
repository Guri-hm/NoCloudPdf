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

window.renderPDFPages = async function (pdfData) {
    const pdfjsLib = window['pdfjs-dist/build/pdf'];
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';

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

// 高速読み込み用：最初のページのサムネイルのみ生成
window.renderFirstPDFPage = async function (pdfData) {
    const pdfjsLib = window['pdfjs-dist/build/pdf'];
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';

    const loadingTask = pdfjsLib.getDocument({ data: pdfData });
    const pdf = await loadingTask.promise;

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
    return canvas.toDataURL('image/png');
};

// PDFのページ数のみ取得
window.getPDFPageCount = async function (pdfData) {
    const pdfjsLib = window['pdfjs-dist/build/pdf'];
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';

    const loadingTask = pdfjsLib.getDocument({ data: pdfData });
    const pdf = await loadingTask.promise;
    return pdf.numPages;
};

// ページレベルでPDFを結合する関数
window.mergePDFPages = async function (pdfPageDataList) {
    const { PDFDocument } = PDFLib;
    const mergedPdf = await PDFDocument.create();

    for (const pageData of pdfPageDataList) {
        // base64文字列をUint8Arrayに変換
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

        // スプレッド演算子を使わずにbase64エンコード
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

// 非同期でページごとにサムネイルを生成する関数（順次処理でメモリ効率を向上）
window.renderPDFPagesAsync = async function (pdfData, dotNetRef) {
    const pdfjsLib = window['pdfjs-dist/build/pdf'];
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';

    try {
        const loadingTask = pdfjsLib.getDocument({ data: pdfData });
        const pdf = await loadingTask.promise;

        console.log(`Starting async rendering for ${pdf.numPages} pages`);

        // 各ページを順次処理
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

                // DotNetObjectReferenceのメソッドを呼び出し
                await dotNetRef.invokeMethodAsync('OnPageThumbnailReady', i - 1, imageData);

                console.log(`Page ${i} rendered and sent to Blazor`);

                // メモリ解放とUI更新のための短い待機
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