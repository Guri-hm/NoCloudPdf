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
            animation: 150,
            onEnd: async function (evt) {
                console.log('Sort completed:', evt.oldIndex, evt.newIndex);

                // DOM操作はSortable.jsに任せる（元に戻さない）
                // データのみBlazor側で更新
                try {
                    await DotNet.invokeMethodAsync('ClientPdfApp', 'UpdateOrder', evt.oldIndex, evt.newIndex);
                    console.log('Data update completed successfully');
                } catch (error) {
                    console.error('Error updating data:', error);
                    // エラー時のみDOMを元に戻す
                    if (evt.oldIndex !== evt.newIndex) {
                        const item = evt.item;
                        const parent = item.parentNode;
                        const children = Array.from(parent.children);

                        if (evt.oldIndex < children.length) {
                            parent.insertBefore(item, children[evt.oldIndex]);
                        } else {
                            parent.appendChild(item);
                        }
                    }
                }
            }
        });

        console.log('Sortable initialized successfully');
    } else {
        console.error('Failed to initialize sortable - container or Sortable library not found');
    }
};