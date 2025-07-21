let sortableInstance = null;

// sortable-utils.js
window.initializeSortable = function () {
    const container = document.getElementById('sortable-container');

    if (container && window.Sortable) {
        // 既存のインスタンスを破棄
        if (container.sortableInstance) {
            container.sortableInstance.destroy();
        }

        container.sortableInstance = new Sortable(container, {
            draggable: '.sortable-item-container',
            ignore: '.non-sortable',
            animation: 150,
            onEnd: function (evt) {

                // 手動でDOM順序を復元（確実な方法）
                const sortableItems = Array.from(container.querySelectorAll('.sortable-item-container:not(.non-sortable)'));

                // data-indexでソート
                sortableItems.sort((a, b) => {
                    const indexA = parseInt(a.getAttribute('data-index'));
                    const indexB = parseInt(b.getAttribute('data-index'));
                    return indexA - indexB;
                });
                // non-sortable要素（+マーク）を保存
                const nonSortableElements = Array.from(container.querySelectorAll('.non-sortable'));

                // sortable要素のみを削除
                container.querySelectorAll('.sortable-item-container:not(.non-sortable)').forEach(item => item.remove());

                // 正しい順序で再追加
                sortableItems.forEach(item => {
                    container.appendChild(item);
                });

                // non-sortable要素を最後に追加
                nonSortableElements.forEach(element => {
                    container.appendChild(element);
                });

                DotNet.invokeMethodAsync('ClientPdfApp', 'UpdateOrder', evt.oldIndex, evt.newIndex);
            }
        });

        console.log('Sortable initialized successfully');
    } else {
        console.error('Failed to initialize sortable - container or Sortable library not found');
    }
};