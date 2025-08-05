using Microsoft.AspNetCore.Components;

namespace ClientPdfApp.Components
{
    public class ActionButtonItem
    {
        public string Label { get; set; } = "";
        public RenderFragment? Icon { get; set; }// コンポーネントやSVGなど
        public string IconHtml { get; set; } = "";// HTML文字列
        public string Title { get; set; } = "";
        public EventCallback OnClick { get; set; }
        public string ButtonClass { get; set; } = "";
        public string IconPosition { get; set; } = "left"; // "left" or "right"
        public bool StopPropagation { get; set; } = false;
    }
}