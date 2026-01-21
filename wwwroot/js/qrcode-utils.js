// ========================================
// QRコード処理ユーティリティ
// html5-qrcode ライブラリの動的ロード＆統合
// ========================================

let html5QrcodeLibLoaded = false;
let html5QrcodeLibLoading = false;
let html5QrcodeLoadPromise = null;

/**
 * html5-qrcode ライブラリを動的にロード
 */
window.loadHtml5QrcodeLibrary = async function() {
    if (html5QrcodeLibLoaded) {
        return true;
    }

    if (html5QrcodeLibLoading) {
        return html5QrcodeLoadPromise;
    }

    html5QrcodeLibLoading = true;
    html5QrcodeLoadPromise = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js';
        script.onload = () => {
            html5QrcodeLibLoaded = true;
            html5QrcodeLibLoading = false;
            console.log('✅ html5-qrcode library loaded');
            resolve(true);
        };
        script.onerror = () => {
            html5QrcodeLibLoading = false;
            console.error('❌ Failed to load html5-qrcode library');
            reject(new Error('Failed to load html5-qrcode library'));
        };
        document.head.appendChild(script);
    });

    return html5QrcodeLoadPromise;
};

// ========================================
// 1. 画像からQRコード読み取り
// ========================================

/**
 * 画像ファイル（Base64 or File object）からQRコードをデコード
 * @param {string|File} imageSource - Base64文字列 or File object
 * @returns {Promise<string>} デコードされたテキスト
 */
window.decodeQrCodeFromImage = async function(imageSource) {
    try {
        await window.loadHtml5QrcodeLibrary();

        if (!window.Html5Qrcode) {
            throw new Error('Html5Qrcode is not available');
        }

        const html5QrCode = new Html5Qrcode("qr-reader-hidden");
        
        let result;
        if (typeof imageSource === 'string') {
            // Base64 data URLの場合、Blobに変換してFileを作成
            const response = await fetch(imageSource);
            const blob = await response.blob();
            const file = new File([blob], "qrcode.png", { type: blob.type });
            result = await html5QrCode.scanFile(file, true);
        } else {
            // File objectの場合
            result = await html5QrCode.scanFile(imageSource, true);
        }

        return result.decodedText || result;
    } catch (error) {
        console.error('QR decode error:', error);
        throw new Error('QRコードが見つかりませんでした。画像が鮮明でQRコードが含まれているか確認してください。');
    }
};

/**
 * 画像ファイルから複数のQRコードを検出（可能な場合）
 */
window.decodeMultipleQrCodesFromImage = async function(imageSource) {
    try {
        const result = await window.decodeQrCodeFromImage(imageSource);
        return [result]; // 単一結果を配列として返す
    } catch (error) {
        console.error('Multiple QR decode error:', error);
        return [];
    }
};

// ========================================
// 2. PDFページ（画像化済み）からQRコード読み取り
// ========================================

/**
 * Canvas要素からQRコードを検出
 * @param {string} canvasId - Canvas要素のID
 * @returns {Promise<{success: boolean, text?: string, error?: string}>}
 */
window.scanQrCodeFromCanvas = async function(canvasId) {
    try {
        await window.loadHtml5QrcodeLibrary();

        const canvas = document.getElementById(canvasId);
        if (!canvas) {
            throw new Error(`Canvas not found: ${canvasId}`);
        }

        // CanvasをBlob経由でスキャン
        const dataUrl = canvas.toDataURL('image/png');
        const text = await window.decodeQrCodeFromImage(dataUrl);

        return {
            success: true,
            text: text
        };
    } catch (error) {
        return {
            success: false,
            error: error.message || 'QR code not found'
        };
    }
};

/**
 * 画像URL（Blob URL or Data URL）からQRコードを検出
 */
window.scanQrCodeFromImageUrl = async function(imageUrl) {
    try {
        await window.loadHtml5QrcodeLibrary();

        // 画像をロードしてCanvasに描画
        const img = new Image();
        img.crossOrigin = 'anonymous';
        
        await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = reject;
            img.src = imageUrl;
        });

        const canvas = document.createElement('canvas');
        // 小さいサムネイルの場合、一定以上に拡大してからスキャンすると検出率が上がる
        const minDetectWidth = 800;
        let drawWidth = img.naturalWidth || minDetectWidth;
        let drawHeight = img.naturalHeight || minDetectWidth;

        if (drawWidth < minDetectWidth) {
            const scale = minDetectWidth / drawWidth;
            drawWidth = Math.min(1600, Math.round(drawWidth * scale));
            drawHeight = Math.round(drawHeight * scale);
        }

        canvas.width = drawWidth;
        canvas.height = drawHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, drawWidth, drawHeight);

        const dataUrl = canvas.toDataURL('image/png');
        const text = await window.decodeQrCodeFromImage(dataUrl);

        return {
            success: true,
            text: text
        };
    } catch (error) {
        return {
            success: false,
            error: error.message || 'QR code not found'
        };
    }
};

// ========================================
// 3. カメラスキャナー
// ========================================

let activeScanner = null;
let currentCameraId = null;

/**
 * 利用可能なカメラデバイス一覧を取得
 * @returns {Promise<Array<{id: string, label: string}>>}
 */
window.getQrScannerCameras = async function() {
    try {
        await window.loadHtml5QrcodeLibrary();

        const devices = await Html5Qrcode.getCameras();
        return devices.map(device => ({
            id: device.id,
            label: device.label || `Camera ${device.id}`
        }));
    } catch (error) {
        console.error('Failed to get cameras:', error);
        return [];
    }
};

/**
 * 背面カメラを優先的に取得
 */
window.getPreferredCamera = async function() {
    try {
        const cameras = await window.getQrScannerCameras();
        if (cameras.length === 0) {
            return null;
        }

        // 背面カメラを探す（environment, back, rearなどのキーワード）
        const backCamera = cameras.find(cam => 
            cam.label.toLowerCase().includes('back') ||
            cam.label.toLowerCase().includes('rear') ||
            cam.label.toLowerCase().includes('environment')
        );

        return backCamera || cameras[0];
    } catch (error) {
        console.error('Failed to get preferred camera:', error);
        return null;
    }
};

/**
 * QRコードスキャナーを開始
 * @param {string} elementId - スキャナーを表示する要素のID
 * @param {string} cameraId - 使用するカメラID（nullの場合は優先カメラ）
 * @param {function} onScanSuccess - スキャン成功時のコールバック
 * @returns {Promise<string>} 使用中のカメラID
 */
window.startQrScanner = async function(elementId, cameraId = null, dotNetRef = null) {
    try {
        await window.loadHtml5QrcodeLibrary();

        // 既存のスキャナーを停止
        if (activeScanner) {
            await window.stopQrScanner();
        }

        const element = document.getElementById(elementId);
        if (!element) {
            throw new Error(`Element not found: ${elementId}`);
        }

        // カメラIDが指定されていない場合は優先カメラを取得
        if (!cameraId) {
            const preferredCamera = await window.getPreferredCamera();
            if (!preferredCamera) {
                throw new Error('No camera available');
            }
            cameraId = preferredCamera.id;
        }

        activeScanner = new Html5Qrcode(elementId);
        currentCameraId = cameraId;

        const config = {
            fps: 10,
            qrbox: { width: 250, height: 250 },
            aspectRatio: 1.0
        };

        await activeScanner.start(
            cameraId,
            config,
            (decodedText, decodedResult) => {
                // スキャン成功時の処理
                if (dotNetRef) {
                    dotNetRef.invokeMethodAsync('OnQrCodeScanned', decodedText);
                }
            },
            (errorMessage) => {
                // エラーは無視（連続スキャン中は頻繁に発生）
            }
        );

        return cameraId;
    } catch (error) {
        console.error('Failed to start QR scanner:', error);
        throw error;
    }
};

/**
 * QRコードスキャナーを停止
 */
window.stopQrScanner = async function() {
    try {
        if (activeScanner) {
            await activeScanner.stop();
            activeScanner.clear();
            activeScanner = null;
            currentCameraId = null;
        }
    } catch (error) {
        console.error('Failed to stop QR scanner:', error);
    }
};

/**
 * カメラを切り替え
 */
window.switchQrScannerCamera = async function(elementId, cameraId, dotNetRef = null) {
    try {
        await window.stopQrScanner();
        return await window.startQrScanner(elementId, cameraId, dotNetRef);
    } catch (error) {
        console.error('Failed to switch camera:', error);
        throw error;
    }
};

/**
 * 現在のカメラIDを取得
 */
window.getCurrentCameraId = function() {
    return currentCameraId;
};

// ========================================
// ユーティリティ関数
// ========================================

/**
 * テキストがURLかどうかを判定
 */
window.isUrl = function(text) {
    try {
        new URL(text);
        return true;
    } catch {
        return false;
    }
};

/**
 * クリップボードにコピー
 */
window.copyToClipboard = async function(text) {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch (error) {
        console.error('Failed to copy to clipboard:', error);
        return false;
    }
};
