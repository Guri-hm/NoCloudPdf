namespace NoCloudPdf.Models
{
    public class HeaderFooterSetting
    {
        public List<StampPosition> Stamps { get; set; } = new();
        public int StartPage { get; set; } = 1;
        public int EndPage { get; set; } = -1;

        public object ToJsObject(int totalPages)
        {
            return Stamps.Select(s => new
            {
                corner = s.Corner.ToString(),
                text = s.Text,
                isSerial = s.IsSerial,
                isZeroPadded = s.IsZeroPadded,
                serialStart = s.SerialStart,
                totalPages = totalPages,
                offsetX = s.OffsetX,
                offsetY = s.OffsetY,
                fontSize = s.FontSize,
                fontFamily = s.FontFamily, 
                isBold = s.IsBold,          
                color = new { r = s.Color.R / 255.0, g = s.Color.G / 255.0, b = s.Color.B / 255.0 }
            }).ToArray();
        }
    }

    public class StampPosition
    {
        public string Text { get; set; } = "";
        public bool IsSerial { get; set; } = false;
        public bool IsZeroPadded { get; set; } = false;
        public int SerialStart { get; set; } = 1;
        public int OffsetX { get; set; } = 10;
        public int OffsetY { get; set; } = 10;
        public StampCorner Corner { get; set; } = StampCorner.TopLeft;
        public int FontSize { get; set; } = 12;
        public string FontFamily { get; set; } = "NotoSansJP";  // 追加
        public bool IsBold { get; set; } = false;                
        public StampColor Color { get; set; } = new StampColor { R = 0, G = 0, B = 0 };
    }

    public enum StampCorner
    {
        TopLeft, Top, TopRight, BottomLeft, Bottom, BottomRight
    }

    public class StampColor
    {
        public int R { get; set; } = 0;
        public int G { get; set; } = 0;
        public int B { get; set; } = 0;
    }
}