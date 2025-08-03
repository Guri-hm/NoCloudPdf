let sortableInstance = null;
window.isSorting = false;

window.initializeSortable = function () {
    function isPcSize() {
        return window.matchMedia('(min-width: 768px)').matches;
    }

    const container = document.getElementById('sortable-container');
    if (container && window.getComputedStyle(container).display !== 'none' && window.Sortable) {
        // 既存のインスタンスを破棄
        if (sortableInstance) {
            sortableInstance.destroy();
            sortableInstance = null;
        }
        sortableInstance = new Sortable(container, {
            draggable: '.sortable-item-container',
            handle: isPcSize() ? '.drag-handle' : '.touch-drag-handle',
            filter: '.non-sortable',
            animation: 150,
            ghostClass: 'dragging-ghost',
            chosenClass: 'dragging-chosen',
            onStart: function (evt) {
                container.classList.add('is-sorting');
                window.isSorting = true;
            },
            onMove: function (evt) {
                const related = evt.related;
                const dragged = evt.dragged;
                // ドロップ先が .non-sortable の場合、その前にドラッグ要素を挿入し、移動をキャンセル
                if (related && related.classList.contains('non-sortable')) {
                    const nonSortableElement = related;
                    const previousSibling = nonSortableElement.previousElementSibling;
                    if (previousSibling && !previousSibling.classList.contains('sortable-chosen')) {
                        container.insertBefore(dragged, nonSortableElement);
                    } else {
                        container.insertBefore(dragged, nonSortableElement);
                    }
                    return false;
                }

                // ドロップ先が .non-sortable の子孫要素の場合も、その前に挿入してキャンセル
                if (related && related.closest('.non-sortable')) {
                    const nonSortableElement = related.closest('.non-sortable');
                    container.insertBefore(dragged, nonSortableElement);
                    return false;
                }

                // ドロップ先が何もない、またはcontainer自体の場合も、.non-sortableの前に挿入してキャンセル
                if (!related || related === container) {
                    const nonSortableElement = container.querySelector('.non-sortable');
                    if (nonSortableElement) {
                        container.insertBefore(dragged, nonSortableElement);
                    }
                    return false;
                }
                return true;
            },
            onEnd: function (evt) {

                container.classList.remove('is-sorting');
                window.isSorting = false;

                const sortableCount = container.querySelectorAll('.sortable-item-container:not(.non-sortable)').length;

                // newIndexが範囲外の場合は修正
                let adjustedNewIndex = evt.newIndex;
                if (evt.newIndex >= sortableCount) {
                    adjustedNewIndex = sortableCount - 1;
                }

                DotNet.invokeMethodAsync(
                    'ClientPdfApp',
                    'UpdateOrder',
                    getPageType(),
                    evt.oldIndex,
                    adjustedNewIndex
                );
            }
        });
    } else if (sortableInstance && sortableInstance.el) {
        sortableInstance.destroy();
        sortableInstance = null;
    }
};