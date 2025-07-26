// ファイルドロップによる追加
window.registerDropArea = function (elementId, dotNetRef) {
    const area = document.getElementById(elementId);
    if (!area) return;

    area.addEventListener('dragover', function (e) {
        e.preventDefault();
        dotNetRef.invokeMethodAsync('SetDragOver', true);
    });
    area.addEventListener('dragleave', function (e) {
        dotNetRef.invokeMethodAsync('SetDragOver', false);
    });
    area.addEventListener('drop', function (e) {
        e.preventDefault();
        dotNetRef.invokeMethodAsync('SetDragOver', false);
        if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            const files = Array.from(e.dataTransfer.files);
            files.forEach(file => {
                const reader = new FileReader();
                reader.onload = function (evt) {
                    dotNetRef.invokeMethodAsync('OnJsFileDropped', file.name, file.type, evt.target.result.split(',')[1]);
                };
                reader.readAsDataURL(file);
            });
        }
    });
};

// ↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓
// 並び替え
window.initializeDragDrop = function () {
    const dropZone = document.getElementById('drop-zone');
    if (!dropZone) return;

    // ドラッグオーバー効果
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, preventDefaults, false);
    });

    function preventDefaults(e) {
        e.preventDefault();
        e.stopPropagation();
    }

    // ドラッグオーバー時のスタイル
    ['dragenter', 'dragover'].forEach(eventName => {
        dropZone.addEventListener(eventName, highlight, false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, unhighlight, false);
    });

    function highlight(e) {
        dropZone.classList.add('drag-over');
    }

    function unhighlight(e) {
        dropZone.classList.remove('drag-over');
    }

    // ファイルドロップ処理
    dropZone.addEventListener('drop', handleDrop, false);

    function handleDrop(e) {
        const dt = e.dataTransfer;
        const files = dt.files;

        if (files.length > 0) {
            // ファイル入力要素にファイルを設定
            const fileInput = document.getElementById('fileInput');
            if (fileInput) {
                fileInput.files = files;
                // change イベントを発火
                const event = new Event('change', { bubbles: true });
                fileInput.dispatchEvent(event);
            }
        }
    }
};

// ページロード時に初期化
document.addEventListener('DOMContentLoaded', function () {
    window.initializeDragDrop();
});
window.initializeDragDrop = function () {
    const dropZone = document.getElementById('drop-zone');
    if (!dropZone) return;

    // ドラッグオーバー効果
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, preventDefaults, false);
    });

    function preventDefaults(e) {
        e.preventDefault();
        e.stopPropagation();
    }

    // ドラッグオーバー時のスタイル
    ['dragenter', 'dragover'].forEach(eventName => {
        dropZone.addEventListener(eventName, highlight, false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, unhighlight, false);
    });

    function highlight(e) {
        dropZone.classList.add('drag-over');
    }

    function unhighlight(e) {
        dropZone.classList.remove('drag-over');
    }

    // ファイルドロップ処理
    dropZone.addEventListener('drop', handleDrop, false);

    function handleDrop(e) {
        const dt = e.dataTransfer;
        const files = dt.files;

        if (files.length > 0) {
            // ファイル入力要素にファイルを設定
            const fileInput = document.getElementById('fileInput');
            if (fileInput) {
                fileInput.files = files;
                // change イベントを発火
                const event = new Event('change', { bubbles: true });
                fileInput.dispatchEvent(event);
            }
        }
    }
};

// ページロード時に初期化
document.addEventListener('DOMContentLoaded', function () {
    window.initializeDragDrop();
});
