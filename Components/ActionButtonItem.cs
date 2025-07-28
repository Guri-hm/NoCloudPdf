using Microsoft.AspNetCore.Components;

namespace ClientPdfApp.Components
{
    public class ActionButtonItem
    {
        public string Label { get; set; } = "";
        public string IconHtml { get; set; } = ""; // SVGや<i>タグなど
        public string Title { get; set; } = "";
        public EventCallback OnClick { get; set; }
    }
}