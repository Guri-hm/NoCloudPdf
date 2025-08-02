// ファイルドロップによる追加
window.registerDropArea = function (elementId, dotNetRef) {
    const area = document.getElementById(elementId);
    if (!area) return;

    area.addEventListener('dragenter', function (e) {
        if (window.isSorting) return;
        dotNetRef.invokeMethodAsync('SetDragOver', true);
    });
    area.addEventListener('dragover', function (e) {
        if (window.isSorting) return;
        e.preventDefault();
    });
    area.addEventListener('dragleave', function (e) {
        if (window.isSorting) return;
        dotNetRef.invokeMethodAsync('SetDragOver', false);
    });
    area.addEventListener('drop', function (e) {
        if (window.isSorting) return;
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

window.registerSelectDropArea = function (dotNetRef) {
    const area = document.getElementById('select-drop-area');
    if (!area || !area.firstElementChild) return;

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