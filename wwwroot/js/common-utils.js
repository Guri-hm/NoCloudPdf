window.getPageType = function () {
    if (window.location.pathname.includes("/split")) return "split";
    if (window.location.pathname.includes("/merge")) return "merge";
    return "unknown";
};

// 要素外クリックでイベントハンドリング
// 使用箇所：DropdownButton.razor
window.registerOutsideClick = (elementId, dotnetHelper, closeMethodName) => {
    function handler(event) {
        const el = document.getElementById(elementId);
        if (el && !el.contains(event.target)) {
            dotnetHelper.invokeMethodAsync(closeMethodName);
            document.removeEventListener('mousedown', handler);
        }
    }
    document.addEventListener('mousedown', handler);
};