namespace NoCloudPdf.Models
{
    public class Bookmark
    {
        public string Title { get; set; } = "";
        public int PageIndex { get; set; } = 0;
        public List<Bookmark>? Items { get; set; }
    }
}