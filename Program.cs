using Microsoft.AspNetCore.Components.Web;
using Microsoft.AspNetCore.Components.WebAssembly.Hosting;
using NoCloudPdfApp;
using NoCloudPdfApp.Services;

var builder = WebAssemblyHostBuilder.CreateDefault(args);
builder.RootComponents.Add<App>("#app");
builder.RootComponents.Add<HeadOutlet>("head::after");

builder.Services.AddScoped(sp => new HttpClient { BaseAddress = new Uri(builder.HostEnvironment.BaseAddress) });

// 統一PDFデータサービスを登録
builder.Services.AddScoped<PdfDataService>();
// 統一状態管理サービスを登録
builder.Services.AddSingleton<CompletionStateService>();

await builder.Build().RunAsync();
