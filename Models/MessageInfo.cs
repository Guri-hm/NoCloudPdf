namespace NoCloudPdf.Models
{
    public enum MessageType { Success, Warn, Error }

    public class MessageInfo
    {
        public string? Text { get; set; }
        public MessageType Type { get; set; }
    }
}