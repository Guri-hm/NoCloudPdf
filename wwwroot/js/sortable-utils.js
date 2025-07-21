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
            onStart: function(evt) {
                console.log('=== DRAG START ===');
                console.log('Dragging item:', evt.item);
                console.log('From index:', evt.oldIndex);
                console.log('Item classList:', evt.item.classList.toString());
                console.log('Item data-index:', evt.item.getAttribute('data-index'));
            },
            
            // ドラッグ中の移動制御：最後尾の固定要素より後には移動させない
            onMove: function(evt) {
                const related = evt.related;
                const dragged = evt.dragged;
                
                console.log('=== MOVE EVENT ===');
                console.log('Related element:', related);
                console.log('Related classList:', related ? related.classList.toString() : 'null');
                console.log('Related data-position:', related ? related.getAttribute('data-position') : 'null');
                console.log('Dragged element:', dragged);
                console.log('Dragged classList:', dragged ? dragged.classList.toString() : 'null');
                
                // 最後尾の固定+ボタン（non-sortable）への移動を拒否
                if (related && related.classList.contains('non-sortable')) {
                    console.log('🚫 Drop rejected: targeting non-sortable end button');
                    return false; // ドロップを拒否
                }
                
                // non-sortableの子要素への移動も拒否
                if (related && related.closest('.non-sortable')) {
                    console.log('🚫 Drop rejected: targeting child of non-sortable element');
                    return false;
                }
                
                // コンテナの末尾（固定ボタンより後）への移動を検出
                if (!related) {
                    const sortableItems = container.querySelectorAll('.sortable-item-container:not(.non-sortable)');
                    const nonSortableButton = container.querySelector('.non-sortable');
                    
                    // ドラッグ中のアイテムの位置をチェック
                    const rect = evt.originalEvent ? {
                        x: evt.originalEvent.clientX,
                        y: evt.originalEvent.clientY
                    } : null;
                    
                    if (nonSortableButton && rect) {
                        const buttonRect = nonSortableButton.getBoundingClientRect();
                        // 固定ボタンより右側への移動を拒否
                        if (rect.x > buttonRect.right) {
                            console.log('🚫 Drop rejected: targeting area after fixed button');
                            return false;
                        }
                    }
                }
                
                console.log('✅ Move allowed');
                return true; // その他の移動は許可
            },
            
            onEnd: function (evt) {
                console.log('=== DRAG END ===');
                console.log('Final oldIndex:', evt.oldIndex);
                console.log('Final newIndex:', evt.newIndex);
                console.log('To element:', evt.to);
                console.log('Item moved to:', evt.item.nextElementSibling);
                
                // サムネイル数を取得（non-sortable要素を除外）
                const sortableCount = container.querySelectorAll('.sortable-item-container:not(.non-sortable)').length;
                console.log('Total sortable items:', sortableCount);
                console.log('Max valid index:', sortableCount - 1);
                
                // newIndexが範囲外（最後尾固定ボタンより後）の場合は修正
                let adjustedNewIndex = evt.newIndex;
                if (evt.newIndex >= sortableCount) {
                    adjustedNewIndex = sortableCount - 1; // 最後の有効位置に修正
                    console.log('⚠️ newIndex out of range! Adjusted from', evt.newIndex, 'to', adjustedNewIndex);
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