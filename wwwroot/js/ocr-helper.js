// ========================================
// Tesseract.js 遅延ロード + OCRヘルパー
// ========================================

window.ocrHelper = {
    worker: null,
    isLibraryLoaded: false,
    loadingPromise: null,

    /**
     * Tesseract.js を動的にロード（初回のみ）
     */
    async loadLibrary() {
        if (this.isLibraryLoaded) {
            return true;
        }

        if (this.loadingPromise) {
            // 既にロード中の場合は同じPromiseを返す
            return this.loadingPromise;
        }

        this.loadingPromise = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
            script.async = true;
            script.onload = () => {
                console.log('[OCR] Tesseract.js loaded');
                this.isLibraryLoaded = true;
                resolve(true);
            };
            script.onerror = (error) => {
                console.error('[OCR] Failed to load Tesseract.js', error);
                this.loadingPromise = null; // 失敗時はリトライ可能にする
                reject(error);
            };
            document.head.appendChild(script);
        });

        return this.loadingPromise;
    },
    
    async initialize(lang = 'eng+jpn') {
        try {
            // ライブラリが未ロードなら先にロード
            if (!this.isLibraryLoaded) {
                await this.loadLibrary();
            }

            // Workerが既に存在する場合は再利用
            if (!this.worker) {
                console.log('[OCR] Initializing worker with language:', lang);
                this.worker = await Tesseract.createWorker(lang, 1, {
                    logger: m => {
                        if (m.status === 'recognizing text') {
                            console.log(`[OCR] Progress: ${(m.progress * 100).toFixed(1)}%`);
                        }
                    }
                });
                console.log('[OCR] Worker initialized');
            }
            return true;
        } catch (error) {
            console.error('[OCR] Initialization error:', error);
            return false;
        }
    },

    async recognize(imageDataUrl, options = {}) {
        try {
            if (!this.worker) {
                const initialized = await this.initialize();
                if (!initialized) {
                    throw new Error('OCR worker initialization failed');
                }
            }

            const { 
                psmMode = 3, // Page segmentation mode
                oem = 1 // OCR Engine mode (LSTM)
            } = options;

            await this.worker.setParameters({
                tessedit_pageseg_mode: psmMode,
                tessedit_ocr_engine_mode: oem
            });

            console.log('[OCR] Starting recognition...');
            const result = await this.worker.recognize(imageDataUrl);
            console.log('[OCR] Recognition complete');

            return {
                text: result.data.text,
                confidence: result.data.confidence,
                lines: result.data.lines?.map(line => ({
                    text: line.text,
                    confidence: line.confidence,
                    bbox: line.bbox
                })) || []
            };
        } catch (error) {
            console.error('[OCR] Recognition error:', error);
            throw error;
        }
    },

    async terminate() {
        if (this.worker) {
            console.log('[OCR] Terminating worker');
            await this.worker.terminate();
            this.worker = null;
        }
    },

    /**
     * メモリクリーンアップ（言語データを再ロードせずWorkerのみリセット）
     */
    async reset() {
        await this.terminate();
        // 次回 initialize() 時に新しいWorkerが作成される
    }
};

// クリップボードコピー
window.copyToClipboard = async function(text) {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch (error) {
        console.error('Clipboard copy error:', error);
        // フォールバック
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        const success = document.execCommand('copy');
        document.body.removeChild(textarea);
        return success;
    }
};