window.openFileDialog = function (elementId) {
    const fileInput = document.getElementById(elementId);
    if (fileInput) {
        fileInput.click();
    }
};