using Microsoft.AspNetCore.Components;

namespace ClientPdfApp.Components
{
    public class DropdownMenuItem
    {
        public string Label { get; set; } = "";
        public string IconHtml { get; set; } = "";
        public EventCallback OnClick { get; set; }
    }
}