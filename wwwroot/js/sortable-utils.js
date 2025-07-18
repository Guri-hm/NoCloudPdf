let sortableInstance = null;

window.initializeSortable = function () {
    const container = document.getElementById('sortable-container');
    if (container && window.Sortable) {
        // 既存のインスタンスを破棄
        if (container.sortableInstance) {
            container.sortableInstance.destroy();
        }

        container.sortableInstance = new Sortable(container, {
            draggable: '.sortable-item-container', // ＋ボタン＋サムネイルのコンテナ全体を並び替え対象
            animation: 150,
            onEnd: function (evt) {
                console.log('Sort completed:', evt.oldIndex, evt.newIndex);
                DotNet.invokeMethodAsync('ClientPdfApp', 'UpdateOrder', evt.oldIndex, evt.newIndex);
            }
        });

        console.log('Sortable initialized successfully');
    } else {
        console.error('Failed to initialize sortable - container or Sortable library not found');
    }
};
// ＋マークを正しい位置に再配置する関数
function repositionInsertButtons() {
    const container = document.getElementById('sortable-container');
    const sortableItems = container.querySelectorAll('.sortable-item');
    const insertButtons = container.querySelectorAll('.insert-button');

    // 既存の＋マークを一時的に隠す
    insertButtons.forEach(btn => btn.style.display = 'none');

    // 各サムネイルの後に＋マークを配置
    sortableItems.forEach((item, index) => {
        const insertButton = insertButtons[index + 1]; // 最初の＋マークは位置0用
        if (insertButton) {
            // サムネイルの直後に配置
            item.parentNode.insertBefore(insertButton, item.nextSibling);
            insertButton.style.display = 'flex';
            // data-insert-positionを更新
            insertButton.setAttribute('data-insert-position', index + 1);
        }
    });
}