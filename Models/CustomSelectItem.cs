using Microsoft.AspNetCore.Components;

namespace NoCloudPdf.Models
{
    public class CustomSelectItem<TValue>
    {
        public TValue Value { get; set; } = default!;
        public string Label { get; set; } = "";
        public RenderFragment? IconFragment { get; set; }
    }
}