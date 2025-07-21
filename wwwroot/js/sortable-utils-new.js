let sortableInstance = null;
let thumbnailGenerationPaused = false;
let isDragging = false;

// サムネイル生成の一時停止/再開制御
window.pauseThumbnailGeneration = function(pause) {
    thumbnailGenerationPaused = pause;
    console.log('Thumbnail generation:', pause ? 'PAUSED' : 'RESUMED');
};

// ドラッグ状態の確認
window.isDragInProgress = function() {
    return isDragging;
};

// DOM操作が安全かどうかの確認
window.isSafeToModifyDOM = function() {
    return !isDragging && !thumbnailGenerationPaused;
};

// 失敗したサムネイルの再生成
window.regenerateFailedThumbnails = function() {
    if (thumbnailGenerationPaused) return;
    
    console.log('Regenerating failed thumbnails...');
    
    // src属性が空または読み込みに失敗したimg要素を検索
    const failedImages = document.querySelectorAll('.sortable-item-container img[src=""], .sortable-item-container img:not([src])');
    
    if (failedImages.length > 0) {
        console.log('Found', failedImages.length, 'failed thumbnails');
        
        // Blazor側のサムネイル再生成メソッドを呼び出し
        if (window.DotNet) {
            DotNet.invokeMethodAsync('ClientPdfApp', 'RegenerateThumbnails')
                .catch(error => console.error('Failed to regenerate thumbnails:', error));
        }
    }
};

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

            // ドラッグ開始時
            onStart: function (evt) {
                console.log('DRAG START - Index:', evt.oldIndex);
                
                isDragging = true;
                
                // サムネイル読み込み処理を一時停止
                if (window.pauseThumbnailGeneration) {
                    window.pauseThumbnailGeneration(true);
                }

                // ドラッグ中の要素のイベントリスナーを一時的に無効化
                const draggedItem = evt.item;
                if (draggedItem) {
                    draggedItem.style.pointerEvents = 'none';
                }
            },

            // ドラッグ中の移動制御：インデックス範囲外なら最後の有効位置に調整
            onMove: function (evt) {
                try {
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
                } catch (error) {
                    console.error('Error in onMove:', error);
                    return false; // エラー時は移動を拒否
                }
            },

            onEnd: function (evt) {
                console.log('DRAG END -', evt.oldIndex, '→', evt.newIndex);

                // ドラッグ状態をリセット
                isDragging = false;

                // ドラッグされた要素のpointerEventsを復元
                const draggedItem = evt.item;
                if (draggedItem) {
                    draggedItem.style.pointerEvents = '';
                }

                // サムネイル読み込み処理を再開
                if (window.pauseThumbnailGeneration) {
                    window.pauseThumbnailGeneration(false);
                }

                // サムネイル数を取得（non-sortable要素を除外）
                const sortableCount = container.querySelectorAll('.sortable-item-container:not(.non-sortable)').length;

                // newIndexが範囲外（最後尾固定ボタンより後）の場合は修正
                let adjustedNewIndex = evt.newIndex;
                if (evt.newIndex >= sortableCount) {
                    adjustedNewIndex = sortableCount - 1; // 最後の有効位置に修正
                    console.log('⚠️ Index adjusted:', evt.newIndex, '→', adjustedNewIndex);
                }

                // DOM操作を安全に実行するため少し待機
                setTimeout(() => {
                    try {
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

                        // Blazor側の順序更新を実行
                        DotNet.invokeMethodAsync('ClientPdfApp', 'UpdateOrder', evt.oldIndex, adjustedNewIndex)
                            .then(() => {
                                // 順序更新完了後、失敗したサムネイルを再生成
                                setTimeout(() => {
                                    if (window.regenerateFailedThumbnails) {
                                        window.regenerateFailedThumbnails();
                                    }
                                }, 200);
                            })
                            .catch(error => {
                                console.error('UpdateOrder failed:', error);
                            });
                    } catch (error) {
                        console.error('Error in onEnd DOM manipulation:', error);
                    }
                }, 50);
            }
        });

    } else {
        console.error('Failed to initialize sortable - container or Sortable library not found');
    }
};
