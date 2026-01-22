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

        console.log(`startQrScanner called with cameraId: ${cameraId}`);

        // カメラIDが指定されていない場合は優先カメラを取得
        if (!cameraId) {
            const preferredCamera = await window.getPreferredCamera();
            if (!preferredCamera) {
                throw new Error('No camera available');
            }
            cameraId = preferredCamera.id;
            console.log(`No cameraId provided, using preferred: ${cameraId}`);
        }

        activeScanner = new Html5Qrcode(elementId);
        currentCameraId = cameraId;
        
        console.log(`About to start scanner with cameraId: ${cameraId}`);

        const config = {
            fps: 10,
            // 正方形のスキャンエリアを表示: ビューポートの70%を使用
            qrbox: function(viewfinderWidth, viewfinderHeight) {
                const minEdge = Math.min(viewfinderWidth, viewfinderHeight);
                const qrboxSize = Math.floor(minEdge * 0.7);
                // 正方形を保証するため width と height を同じ値に設定
                return {
                    width: qrboxSize,
                    height: qrboxSize
                };
            },
            aspectRatio: 1.0,  // 1:1 アスペクト比を強制
            // videoConstraints の facingMode を削除（カメラIDで直接指定するため）
            videoConstraints: {
                aspectRatio: 1.0
            },
            // QRコードの文字コード自動検出を有効化
            formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
            experimentalFeatures: {
                useBarCodeDetectorIfSupported: true
            }
        };

        await activeScanner.start(
            cameraId,
            config,
            (decodedText, decodedResult) => {
                // スキャン成功時の処理
                // 文字コードの自動検出を試みる（Shift_JISやUTF-8など）
                let text = decodedText;
                
                // デコード結果にバイト配列がある場合、複数の文字コードで試行
                if (decodedResult && decodedResult.result && decodedResult.result.rawBytes) {
                    try {
                        // まずUTF-8として解釈
                        const decoder = new TextDecoder('utf-8');
                        const utf8Text = decoder.decode(new Uint8Array(decodedResult.result.rawBytes));
                        
                        // 文字化けチェック（�が含まれていたらShift_JISを試行）
                        if (!utf8Text.includes('�')) {
                            text = utf8Text;
                        } else {
                            // Shift_JISで再試行
                            try {
                                const sjisDecoder = new TextDecoder('shift_jis');
                                text = sjisDecoder.decode(new Uint8Array(decodedResult.result.rawBytes));
                            } catch (e) {
                                // Shift_JIS失敗時は元のテキストを使用
                                console.log('Shift_JIS decode failed, using default:', e);
                            }
                        }
                    } catch (e) {
                        console.log('Text decoding failed, using default:', e);
                    }
                }
                
                if (dotNetRef) {
                    dotNetRef.invokeMethodAsync('OnQrCodeScanned', text);
                }
            },
            (errorMessage) => {
                // エラーは無視（連続スキャン中は頻繁に発生）
            }
        );

        console.log(`✅ Scanner successfully started with cameraId: ${cameraId}`);
        
        // 実際に起動したカメラの情報を取得して確認
        try {
            const state = activeScanner.getState();
            console.log(`📹 Scanner state: ${state}`);
            
            // カメラストリームの詳細情報を取得
            const capabilities = activeScanner.getRunningTrackCapabilities();
            if (capabilities) {
                console.log(`📹 Running track capabilities:`, capabilities);
            }
        } catch (e) {
            console.log('Could not get scanner state:', e);
        }
        
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

/**
 * ズーム機能のサポート状態を取得
 */
window.getQrScannerZoomCapabilities = async function() {
    if (!activeScanner) {
        return { supported: false, min: 1.0, max: 1.0, current: 1.0 };
    }

    try {
        // Html5Qrcode の getRunningTrackCapabilities() メソッドを使用
        const capabilities = activeScanner.getRunningTrackCapabilities();
        
        if (!capabilities || !capabilities.zoomFeature) {
            console.log('Zoom feature not available in capabilities');
            return { supported: false, min: 1.0, max: 1.0, current: 1.0 };
        }

        const zoomFeature = capabilities.zoomFeature();
        
        return {
            supported: true,
            min: zoomFeature.min(),
            max: zoomFeature.max(),
            current: zoomFeature.value()
        };
    } catch (error) {
        console.log('Zoom not supported:', error);
        return { supported: false, min: 1.0, max: 1.0, current: 1.0 };
    }
};

/**
 * ズームを適用
 */
window.applyQrScannerZoom = async function(zoomLevel) {
    if (!activeScanner) {
        throw new Error('Scanner not active');
    }

    try {
        const capabilities = activeScanner.getRunningTrackCapabilities();
        if (capabilities && capabilities.zoomFeature) {
            const zoomFeature = capabilities.zoomFeature();
            await zoomFeature.apply(zoomLevel);
        } else {
            console.warn('Zoom feature not available');
        }
    } catch (error) {
        console.error('Failed to apply zoom:', error);
        throw error;
    }
};

// ========================================
// ピンチイン/アウト機能
// ========================================

let pinchStartDistance = 0;
let pinchStartZoom = 1.0;
let pinchHandlersAttached = false;
let pinchTouchStartHandler = null;
let pinchTouchMoveHandler = null;
let pinchTouchEndHandler = null;

/**
 * ピンチジェスチャーのサポートを初期化
 */
window.initQrScannerPinchZoom = function(elementId, dotNetRef = null) {
    const element = document.getElementById(elementId);
    if (!element) {
        console.error('Element not found for pinch zoom:', elementId);
        return;
    }

    // 既存のイベントリスナーを削除
    if (pinchHandlersAttached) {
        if (pinchTouchStartHandler) element.removeEventListener('touchstart', pinchTouchStartHandler);
        if (pinchTouchMoveHandler) element.removeEventListener('touchmove', pinchTouchMoveHandler);
        if (pinchTouchEndHandler) element.removeEventListener('touchend', pinchTouchEndHandler);
    }

    // タッチイベントハンドラー
    pinchTouchStartHandler = (e) => {
        if (e.touches.length === 2 && activeScanner) {
            pinchStartDistance = getTouchDistance(e.touches[0], e.touches[1]);
            
            try {
                const stream = activeScanner.getRunningTrackCameraCapabilities();
                if (stream && stream.zoomFeature) {
                    pinchStartZoom = stream.zoomFeature().value();
                }
            } catch (error) {
                console.log('Could not get current zoom:', error);
            }
        }
    };

    pinchTouchMoveHandler = async (e) => {
        if (e.touches.length === 2 && activeScanner && pinchStartDistance > 0) {
            e.preventDefault();
            
            const currentDistance = getTouchDistance(e.touches[0], e.touches[1]);
            const scale = currentDistance / pinchStartDistance;
            
            try {
                const stream = activeScanner.getRunningTrackCameraCapabilities();
                if (stream && stream.zoomFeature) {
                    const minZoom = stream.zoomFeature().min();
                    const maxZoom = stream.zoomFeature().max();
                    let newZoom = pinchStartZoom * scale;
                    newZoom = Math.max(minZoom, Math.min(maxZoom, newZoom));
                    
                    await stream.zoomFeature().apply(newZoom);
                }
            } catch (error) {
                // ズームエラーは無視
            }
        }
    };

    pinchTouchEndHandler = (e) => {
        if (e.touches.length < 2) {
            pinchStartDistance = 0;
        }
    };

    element.addEventListener('touchstart', pinchTouchStartHandler);
    element.addEventListener('touchmove', pinchTouchMoveHandler);
    element.addEventListener('touchend', pinchTouchEndHandler);
    
    pinchHandlersAttached = true;
};

/**
 * 2点間の距離を計算
 */
function getTouchDistance(touch1, touch2) {
    const dx = touch1.clientX - touch2.clientX;
    const dy = touch1.clientY - touch2.clientY;
    return Math.sqrt(dx * dx + dy * dy);
}

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
