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

                // sortable要素のみを削除
                container.querySelectorAll('.sortable-item-container:not(.non-sortable)').forEach(item => item.remove());

                // +マークの前に順番に挿入
                const insertPoint = container.querySelector('.non-sortable');
                sortableItems.forEach(item => {
                    container.insertBefore(item, insertPoint);
                });

                DotNet.invokeMethodAsync('ClientPdfApp', 'UpdateOrder', evt.oldIndex, evt.newIndex);
            }
        });

        console.log('Sortable initialized successfully');
    } else {
        console.error('Failed to initialize sortable - container or Sortable library not found');
    }
};