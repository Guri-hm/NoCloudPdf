let sortableInstance = null;

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

            // ドラッグ開始時
            onStart: function (evt) {
                // console.log 削除
            },

            // ドラッグ中の移動制御：固定ボタンより後ろに行こうとしたら前に強制移動
            onMove: function (evt) {
                const related = evt.related;
                const dragged = evt.dragged;

                // console.log 削除

                // 最後尾の固定+ボタン（non-sortable）への移動時は直前に強制移動
                if (related && related.classList.contains('non-sortable')) {
                    // console.log 削除

                    // 固定ボタンの直前に強制移動
                    const nonSortableElement = related;
                    const previousSibling = nonSortableElement.previousElementSibling;

                    if (previousSibling && !previousSibling.classList.contains('sortable-chosen')) {
                        // 直前の要素の後ろに挿入
                        container.insertBefore(dragged, nonSortableElement);
                    } else {
                        // 直前に要素がない場合は固定ボタンの前に挿入
                        container.insertBefore(dragged, nonSortableElement);
                    }

                    return false; // 元の移動をキャンセル
                }

                // non-sortableの子要素への移動も同様に処理
                if (related && related.closest('.non-sortable')) {
                    // console.log 削除
                    const nonSortableElement = related.closest('.non-sortable');
                    container.insertBefore(dragged, nonSortableElement);
                    return false;
                }

                // コンテナ末尾や無効な位置への移動も固定ボタン前に強制移動
                if (!related || related === container) {
                    // console.log 削除
                    const nonSortableElement = container.querySelector('.non-sortable');
                    if (nonSortableElement) {
                        container.insertBefore(dragged, nonSortableElement);
                    }
                    return false;
                }

                // console.log 削除
                return true; // その他の移動は許可
            },

            onEnd: function (evt) {
                // console.log 削除

                // サムネイル数を取得（non-sortable要素を除外）
                const sortableCount = container.querySelectorAll('.sortable-item-container:not(.non-sortable)').length;
                // console.log 削除

                // newIndexが範囲外（最後尾固定ボタンより後）の場合は修正
                let adjustedNewIndex = evt.newIndex;
                if (evt.newIndex >= sortableCount) {
                    adjustedNewIndex = sortableCount - 1; // 最後の有効位置に修正
                    // console.log 削除
                }

                console.log('Calling UpdateOrder with:', evt.oldIndex, '->', adjustedNewIndex);

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

                DotNet.invokeMethodAsync('ClientPdfApp', 'UpdateOrder', evt.oldIndex, adjustedNewIndex);
            }
        });

    } else {
        console.error('Failed to initialize sortable - container or Sortable library not found');
    }
};