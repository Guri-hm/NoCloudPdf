window.getPageType = function () {
    if (window.location.pathname.includes("/split")) return "split";
    if (window.location.pathname.includes("/merge")) return "merge";
    return "unknown";
};