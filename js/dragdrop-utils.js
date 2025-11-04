// drop-area 内の DropCover を即時表示/非表示
function setDropCoverVisible(area, visible) {
    if (!area) return;
    const cover = area.querySelector('[data-drop-cover]');
    const inner = area.querySelector('[data-drop-cover-inner]');
    if (!cover) return;
    if (visible) {
        cover.classList.remove('opacity-0', 'pointer-events-none');
        cover.classList.add('opacity-60', 'pointer-events-auto');
        if (inner) {
            inner.classList.remove('scale-70');
            inner.classList.add('scale-100');
        }
    } else {
        cover.classList.remove('opacity-60', 'pointer-events-auto');
        cover.classList.add('opacity-0', 'pointer-events-none');
        if (inner) {
            inner.classList.remove('scale-100');
            inner.classList.add('scale-70');
        }
    }
}

// ファイルドロップによる追加
window.registerDropArea = function (elementId, dotNetRef) {
    const area = document.getElementById(elementId);
    if (!area) return;

    // すでに登録済みなら一度解除
    if (area._dropHandlers) {
        window.unregisterDropArea(elementId);
    }

    let dragCounter = 0;

    area._dropHandlers = {
        dragenter: function (e) {
            if (window.isSorting) return;
            dragCounter++;
            setDropCoverVisible(area, true);
        },
        dragover: function (e) {
            if (window.isSorting) return;
            e.preventDefault();
        },
        dragleave: function (e) {
            if (window.isSorting) return;
            dragCounter--;
            if (dragCounter <= 0) {
                dragCounter = 0;
                setDropCoverVisible(area, false);
            }
        },
        drop: function (e) {
            if (window.isSorting) return;
            e.preventDefault();
            dragCounter = 0;
            setDropCoverVisible(area, false);
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
        }
    };

    area.addEventListener('dragenter', area._dropHandlers.dragenter);
    area.addEventListener('dragover', area._dropHandlers.dragover);
    area.addEventListener('dragleave', area._dropHandlers.dragleave);
    area.addEventListener('drop', area._dropHandlers.drop);
};

window.unregisterDropArea = function (elementId) {
    const area = document.getElementById(elementId);
    if (!area || !area._dropHandlers) return;

    // すべてのイベントを解除
    area.removeEventListener('dragenter', area._dropHandlers.dragenter);
    area.removeEventListener('dragover', area._dropHandlers.dragover);
    area.removeEventListener('dragleave', area._dropHandlers.dragleave);
    area.removeEventListener('drop', area._dropHandlers.drop);

    delete area._dropHandlers;
};

window.registerSelectDropArea = function (dotNetRef) {
    const area = document.getElementById('select-drop-area');
    if (!area || !area.firstElementChild) return;

    // すでに登録済みなら一度解除
    window.unregisterSelectDropArea();

    const child = area.firstElementChild;
    let dragCounter = 0;

    area.ondragenter = e => {
        dragCounter++;
        child.classList.remove('bg-white/60');
        child.classList.add('bg-blue-100/60', 'border-solid');
    };
    area.ondragover = e => {
        e.preventDefault();
    };
    area.ondragleave = e => {
        dragCounter--;
        if (dragCounter <= 0) {
            console.log("ondragleave")
            dragCounter = 0;
            child.classList.remove(
                'bg-blue-100/60',
                'border-solid');
            child.classList.add('bg-white/60');
        }
    };
    area.ondrop = e => {
        e.preventDefault();
        child.classList.remove(
            'bg-blue-100/60',
            'border-solid'
        );
        child.classList.add('bg-white/60');
        if (e.dataTransfer && e.dataTransfer.files.length > 0) {
            // Blazor InputFileを使わず、JSからbase64で渡す場合
            Array.from(e.dataTransfer.files).forEach(file => {
                const reader = new FileReader();
                reader.onload = function (evt) {
                    const base64 = evt.target.result.split(',')[1];
                    dotNetRef.invokeMethodAsync('OnJsFileDropped', file.name, file.type, base64);
                };
                reader.readAsDataURL(file);
            });
        }
    };

    // ペースト
    area.onpaste = e => {
        if (e.clipboardData && e.clipboardData.files.length > 0) {
            Array.from(e.clipboardData.files).forEach(file => {
                const reader = new FileReader();
                reader.onload = function (evt) {
                    const base64 = evt.target.result.split(',')[1];
                    dotNetRef.invokeMethodAsync('OnJsFileDropped', file.name, file.type, base64);
                };
                reader.readAsDataURL(file);
            });
        }
    };

};

window.unregisterSelectDropArea = function () {
    const area = document.getElementById('select-drop-area');
    if (!area) return;

    // すべてのイベントを解除
    area.ondragenter = null;
    area.ondragover = null;
    area.ondragleave = null;
    area.ondrop = null;
    area.onpaste = null;
};