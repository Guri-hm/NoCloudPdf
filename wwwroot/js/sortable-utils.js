let sortablePc = null;
let sortableMobile = null;
window.isSorting = false;

window.initializeSortable = function () {
    // PC用（md以上）
    const pc = document.getElementById('sortable-container');
    if (pc && window.getComputedStyle(pc).display !== 'none' && window.Sortable) {
        // 既存のインスタンスを破棄
        if (sortablePc) {
            sortablePc.destroy();
            sortablePc = null;
        }
        sortablePc = new Sortable(pc, {
            draggable: '.sortable-item-container',
            filter: '.non-sortable',
            animation: 150,
            ghostClass: 'dragging-ghost',
            dragClass: 'sortable-chosen',
            onStart: function (evt) {
                document.querySelectorAll('.non-sortable').forEach(el => {
                    el.classList.add('hide-during-drag');
                });
                window.isSorting = true;
            },
            onMove: function (evt) {
                const container = pc;
                const related = evt.related;
                const dragged = evt.dragged;
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
                if (related && related.closest('.non-sortable')) {
                    const nonSortableElement = related.closest('.non-sortable');
                    container.insertBefore(dragged, nonSortableElement);
                    return false;
                }
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
                window.isSorting = false;
                document.querySelectorAll('.non-sortable').forEach(el => {
                    el.classList.remove('hide-during-drag');
                });
                const container = pc;
                const sortableCount = container.querySelectorAll('.sortable-item-container:not(.non-sortable)').length;
                let adjustedNewIndex = evt.newIndex;
                if (evt.newIndex >= sortableCount) {
                    adjustedNewIndex = sortableCount - 1;
                }
                const sortableItems = Array.from(container.querySelectorAll('.sortable-item-container:not(.non-sortable)'));
                sortableItems.sort((a, b) => {
                    const indexA = parseInt(a.getAttribute('data-index'));
                    const indexB = parseInt(b.getAttribute('data-index'));
                    return indexA - indexB;
                });
                const nonSortableElements = Array.from(container.querySelectorAll('.non-sortable'));
                container.querySelectorAll('.sortable-item-container:not(.non-sortable)').forEach(item => item.remove());
                const insertPoint = container.querySelector('.non-sortable');
                sortableItems.forEach(item => {
                    container.insertBefore(item, insertPoint);
                });
                DotNet.invokeMethodAsync('ClientPdfApp', 'UpdateOrder', evt.oldIndex, adjustedNewIndex);
            }
        });
    } else if (sortablePc) {
        sortablePc.destroy();
        sortablePc = null;
    }

    // タブレット・スマホ用（md未満）
    const mobile = document.getElementById('sortable-list-container');
    if (mobile && window.getComputedStyle(mobile).display !== 'none' && window.Sortable) {
        if (sortableMobile) {
            sortableMobile.destroy();
            sortableMobile = null;
        }
        sortableMobile = new Sortable(mobile, {
            draggable: '.sortable-list-item',
            handle: '.drag-handle',
            animation: 150,
            ghostClass: 'dragging-ghost',
            dragClass: 'sortable-chosen',
            onStart: function () {
                window.isSorting = true;
            },
            onEnd: function (evt) {
                window.isSorting = false;
                document.querySelectorAll('.non-sortable').forEach(el => {
                    el.classList.remove('hide-during-drag');
                });
                const container = mobile;
                const sortableCount = container.querySelectorAll('.sortable-item-container:not(.non-sortable)').length;
                let adjustedNewIndex = evt.newIndex;
                if (evt.newIndex >= sortableCount) {
                    adjustedNewIndex = sortableCount - 1;
                }
                const sortableItems = Array.from(container.querySelectorAll('.sortable-item-container:not(.non-sortable)'));
                sortableItems.sort((a, b) => {
                    const indexA = parseInt(a.getAttribute('data-index'));
                    const indexB = parseInt(b.getAttribute('data-index'));
                    return indexA - indexB;
                });
                const nonSortableElements = Array.from(container.querySelectorAll('.non-sortable'));
                container.querySelectorAll('.sortable-item-container:not(.non-sortable)').forEach(item => item.remove());
                const insertPoint = container.querySelector('.non-sortable');
                sortableItems.forEach(item => {
                    container.insertBefore(item, insertPoint);
                });
                DotNet.invokeMethodAsync('ClientPdfApp', 'UpdateOrder', evt.oldIndex, adjustedNewIndex);
            }
        });
    } else if (sortableMobile) {
        sortableMobile.destroy();
        sortableMobile = null;
    }
};

// ウィンドウリサイズ時にも再初期化
window.addEventListener('resize', () => {
    initializeSortable();
});