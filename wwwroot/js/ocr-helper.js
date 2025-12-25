window.ocrHelper = {
    worker: null,
    isLibraryLoaded: false,
    loadingPromise: null,
    currentLanguage: null,  // 現在初期化されている言語

    async loadLibrary() {
        if (this.isLibraryLoaded) {
            return true;
        }

        if (this.loadingPromise) {
            return this.loadingPromise;
        }

        this.loadingPromise = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
            script.async = true;
            script.onload = () => {
                this.isLibraryLoaded = true;
                resolve(true);
            };
            script.onerror = (error) => {
                console.error('[OCR] Failed to load Tesseract.js', error);
                this.loadingPromise = null;
                reject(error);
            };
            document.head.appendChild(script);
        });

        return this.loadingPromise;
    },
    
    async initialize(lang = 'eng+jpn') {
        try {
            if (!this.isLibraryLoaded) {
                await this.loadLibrary();
            }

            // 言語が変更された場合は、既存のworkerを終了して再初期化
            if (this.worker && this.currentLanguage !== lang) {
                await this.worker.terminate();
                this.worker = null;
                this.currentLanguage = null;
            }

            if (!this.worker) {
                this.worker = await Tesseract.createWorker(lang, 1, {
                    logger: m => {
                        if (m.status === 'recognizing text') {
                            // progress は内部でのみ処理する（デバッグ出力は削除）
                        }
                    }
                });
                this.currentLanguage = lang;
                console.log('[OCR] Worker initialized successfully');
            }
            
            return true;
        } catch (error) {
            console.error('[OCR] Initialization error:', error);
            this.worker = null;
            this.currentLanguage = null;
            return false;
        }
    },

    /**
     * 画像を回転（-180°～180°対応）
     */
    async rotateImage(imageDataUrl, angle) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                try {
                    const canvas = document.createElement('canvas');
                    const ctx = canvas.getContext('2d');
                    
                    // 角度をラジアンに変換
                    const rad = (angle * Math.PI) / 180;
                    const cos = Math.abs(Math.cos(rad));
                    const sin = Math.abs(Math.sin(rad));
                    
                    // 回転後のキャンバスサイズを計算
                    canvas.width = Math.ceil(img.width * cos + img.height * sin);
                    canvas.height = Math.ceil(img.width * sin + img.height * cos);
                    
                    // 背景を白で塗りつぶし
                    ctx.fillStyle = '#FFFFFF';
                    ctx.fillRect(0, 0, canvas.width, canvas.height);
                    
                    // 中心点を原点として回転
                    ctx.translate(canvas.width / 2, canvas.height / 2);
                    ctx.rotate(rad);
                    ctx.drawImage(img, -img.width / 2, -img.height / 2);
                    
                    resolve(canvas.toDataURL('image/png'));
                } catch (error) {
                    console.error('[OCR] Rotation error:', error);
                    reject(error);
                }
            };
            img.onerror = () => {
                console.error('[OCR] Failed to load image for rotation');
                reject(new Error('Failed to load image for rotation'));
            };
            img.src = imageDataUrl;
        });
    },

    async recognize(imageDataUrl, options = {}) {
        try {
            if (!this.worker) {
                const initialized = await this.initialize();
                if (!initialized) {
                    throw new Error('OCR worker initialization failed');
                }
            }

            // C#からのプロパティ名（PascalCase）を受け取る
            const {
                PsmMode = 3,
                psmMode = PsmMode,
                AutoRotate = false,
                autoRotate = AutoRotate,
                ReadingOrder = 'auto',
                readingOrder = ReadingOrder
            } = options;

            let processedImage = imageDataUrl;

            // Tesseractパラメータの設定
            const params = {
                tessedit_pageseg_mode: psmMode
            };

            // 読み取り順序の設定
            if (readingOrder === 'rtl') {
                params.textord_force_make_prop_words = 0;
                params.textord_tabfind_find_tables = 0;
            } else if (readingOrder === 'ltr') {
                params.textord_force_make_prop_words = 1;
            }

            await this.worker.setParameters(params);

            const result = await this.worker.recognize(processedImage);

            // 右から左の場合、行内のテキストを反転
            let finalText = result.data.text;
            let finalLines = result.data.lines?.map(line => ({
                text: line.text,
                confidence: line.confidence,
                bbox: line.bbox
            })) || [];

            if (readingOrder === 'rtl') {
                finalLines = finalLines.map(line => {
                    const reversed = line.text.split('').reverse().join('');
                    return {
                        text: reversed,
                        confidence: line.confidence,
                        bbox: line.bbox
                    };
                });

                finalText = finalLines.map(line => line.text).join('\n');
            }

            return {
                text: finalText,
                confidence: result.data.confidence,
                lines: finalLines
            };
        } catch (error) {
            console.error('[OCR] Recognition error:', error);
            throw error;
        }
    },

    async terminate() {
        if (this.worker) {
            await this.worker.terminate();
            this.worker = null;
            this.currentLanguage = null;
        }
    },

    async reset() {
        await this.terminate();
    }
};

/**
 * クリップボードにテキストをコピー（モダンなClipboard API使用）
 */
window.copyToClipboard = async function (text) {
    // モダンなClipboard APIを使用（推奨）
    if (navigator.clipboard && navigator.clipboard.writeText) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch (error) {
            console.error('Clipboard API error:', error);
            // フォールバック処理へ
        }
    }

    // フォールバック: テキストエリアを使った方法（execCommandは使わない）
    try {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.left = '-999999px';
        textarea.style.top = '-999999px';
        textarea.setAttribute('readonly', '');
        document.body.appendChild(textarea);

        // iOS対応: contentEditableとRange APIを使用
        if (navigator.userAgent.match(/ipad|iphone/i)) {
            const range = document.createRange();
            range.selectNodeContents(textarea);
            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(range);
            textarea.setSelectionRange(0, text.length);
        } else {
            textarea.select();
        }

        // モダンブラウザでもexecCommandのフォールバックが必要な場合のみ
        let success = false;
        try {
            success = document.execCommand('copy');
        } catch (err) {
            console.error('execCommand fallback failed:', err);
        }

        document.body.removeChild(textarea);
        return success;
    } catch (error) {
        console.error('Fallback copy error:', error);
        return false;
    }
};