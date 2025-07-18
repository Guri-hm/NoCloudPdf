let sortableInstance = null;

window.initializeSortable = function () {
    const container = document.getElementById('sortable-container');
    if (container) {
        console.log("Sortable container found, initializing...");

        // 既存のSortableインスタンスがあれば破棄
        if (sortableInstance) {
            sortableInstance.destroy();
            console.log("Previous sortable instance destroyed");
        }

        sortableInstance = new Sortable(container, {
            animation: 150,
            ghostClass: 'sortable-ghost',
            chosenClass: 'sortable-chosen',
            dragClass: 'sortable-drag',
            filter: '.flex.flex-col', // PDF追加ボタンを除外
            onStart: function (evt) {
                console.log('Drag started:', evt.oldIndex);
            },
            onEnd: function (evt) {
                console.log('Drag ended:', evt.oldIndex, '->', evt.newIndex);
                if (evt.oldIndex !== evt.newIndex) {
                    console.log('Calling UpdateOrder...');
                    DotNet.invokeMethodAsync('ClientPdfApp', 'UpdateOrder', evt.oldIndex, evt.newIndex)
                        .then(() => console.log("UpdateOrder invoked successfully"))
                        .catch(err => console.error("Error invoking UpdateOrder:", err));
                } else {
                    console.log('No change in position, skipping UpdateOrder');
                }
            }
        });
        console.log("Sortable initialized successfully.");
    } else {
        console.log("sortable-container element not found. Skipping initialization.");
    }
};