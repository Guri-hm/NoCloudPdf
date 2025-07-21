let sortableInstance = null;

window.initializeSortable = function () {
    const container = document.getElementById('sortable-container');

    if (container && window.Sortable) {
        // 既存のインスタンスを安全に破棄
        if (container.sortableInstance) {
            try {
                container.sortableInstance.destroy();
            } catch (e) {
                console.warn('Error destroying sortable instance:', e);
            }
            container.sortableInstance = null;
        }

        container.sortableInstance = new Sortable(container, {
            draggable: '.sortable-item-container',
            ignore: '.non-sortable',
            animation: 150,

            // ドラッグ中の移動制御：インデックス範囲外なら最後の有効位置に調整
            onMove: function (evt) {
                const related = evt.related;
                const dragged = evt.dragged;

                // 有効なサムネイル数を取得
                const sortableItems = container.querySelectorAll('.sortable-item-container:not(.non-sortable)');
                const maxValidIndex = sortableItems.length - 1;

                if (related && related.classList.contains('non-sortable')) {
                    evt.newIndex = maxValidIndex;
                    return false;
                }

                // non-sortableの子要素への移動も同様に処理
                if (related && related.closest('.non-sortable')) {
                    evt.newIndex = maxValidIndex;
                    return false;
                }

                // コンテナ末尾や範囲外インデックスへの移動も調整
                if (!related || related === container || evt.newIndex > maxValidIndex) {
                    evt.newIndex = maxValidIndex;
                    return false;
                }

                return true; // その他の移動は許可
            },

            onEnd: function (evt) {

                // サムネイル数を取得（non-sortable要素を除外）
                const sortableCount = container.querySelectorAll('.sortable-item-container:not(.non-sortable)').length;

                // newIndexが範囲外（最後尾固定ボタンより後）の場合は修正
                let adjustedNewIndex = evt.newIndex;
                if (evt.newIndex >= sortableCount) {
                    adjustedNewIndex = sortableCount - 1; // 最後の有効位置に修正
                    console.log('⚠️ Index adjusted:', evt.newIndex, '→', adjustedNewIndex);
                }

                const sortableItems = Array.from(container.querySelectorAll('.sortable-item-container:not(.non-sortable)'));

                // data-indexでソート
                sortableItems.sort((a, b) => {
                    const indexA = parseInt(a.getAttribute('data-index'));
                    const indexB = parseInt(b.getAttribute('data-index'));
                    return indexA - indexB;
                });

                // sortable要素のみを削除（重複削除を修正）
                container.querySelectorAll('.sortable-item-container:not(.non-sortable)').forEach(item => item.remove());

                // +マークの前に順番に挿入
                const insertPoint = container.querySelector('.non-sortable');
                if (insertPoint) {
                    sortableItems.forEach(item => {
                        container.insertBefore(item, insertPoint);
                    });
                }

                DotNet.invokeMethodAsync('ClientPdfApp', 'UpdateOrder', evt.oldIndex, adjustedNewIndex);
            }
        });

    } else {
        console.error('Failed to initialize sortable - container or Sortable library not found');
    }
};
