using Microsoft.JSInterop;

namespace NoCloudPdf.Services;

public class MessageService
{
    private readonly IJSRuntime _jsRuntime;

    public MessageService(IJSRuntime jsRuntime)
    {
        _jsRuntime = jsRuntime;
    }

    public async Task ShowAsync(string? text, MessageType type = MessageType.Success, int autoCloseMs = 3000)
    {
        if (string.IsNullOrEmpty(text)) return;

        try
        {
            var typeStr = type switch
            {
                MessageType.Success => "success",
                MessageType.Warn => "warn",
                MessageType.Error => "error",
                _ => "success"
            };

            await _jsRuntime.InvokeVoidAsync("messageBar.show", text, typeStr, autoCloseMs);
        }
        catch (Exception ex)
        {
            Console.WriteLine($"MessageService.ShowAsync error: {ex.Message}");
        }
    }

    public async Task HideAsync()
    {
        try
        {
            await _jsRuntime.InvokeVoidAsync("messageBar.hide");
        }
        catch { }
    }
}

public enum MessageType
{
    Success,
    Warn,
    Error
}