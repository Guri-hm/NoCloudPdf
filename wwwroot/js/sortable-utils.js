let sortableInstance = null;

window.initializeSortable = function () {
    const container = document.getElementById('sortable-container');
    if (container && window.Sortable) {
        // 既存のインスタンスを破棄
        if (container.sortableInstance) {
            container.sortableInstance.destroy();
        }

        // Sortable.jsの役割：イベント検知のみ
        container.sortableInstance = new Sortable(container, {
            draggable: '.sortable-item-container',
            animation: 150,
            onEnd: function (evt) {
                console.log('Sortable drag ended:', evt.oldIndex, '->', evt.newIndex);
                // 重要：Sortable.jsのDOM変更を即座に元に戻す
                const movedElement = evt.item;
                const container = evt.from;

                // DOM操作を元の位置に戻す
                if (evt.oldIndex < container.children.length) {
                    const referenceElement = container.children[evt.oldIndex];
                    if (referenceElement) {
                        container.insertBefore(movedElement, referenceElement);
                    } else {
                        container.appendChild(movedElement);
                    }
                }
                // DOM操作はしない、Blazorに通知のみ
                DotNet.invokeMethodAsync('ClientPdfApp', 'UpdateOrder', evt.oldIndex, evt.newIndex);
            }
        });

        console.log('Sortable initialized successfully');
    } else {
        console.error('Failed to initialize sortable - container or Sortable library not found');
    }
};