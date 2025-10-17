using Microsoft.AspNetCore.Components;
namespace NoCloudPdf.Components
{
    public class ToggleButtonItem<T>
    {
        public T Value { get; set; } = default!;
        public string Label { get; set; } = "";
        public string IconSvg { get; set; } = ""; // SVG文字列
        public RenderFragment? IconFragment { get; set; }
    }
}