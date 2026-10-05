$ErrorActionPreference = 'Stop'
$root = [System.IO.Path]::GetFullPath($PSScriptRoot)
$rootPrefix = $root.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
$port = 8001
$listener = $null
$mimeTypes = @{
  '.css' = 'text/css; charset=utf-8'
  '.html' = 'text/html; charset=utf-8'
  '.jpeg' = 'image/jpeg'
  '.jpg' = 'image/jpeg'
  '.js' = 'text/javascript; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'
  '.png' = 'image/png'
  '.svg' = 'image/svg+xml'
  '.webp' = 'image/webp'
}

  if (-not ('ShowroomStaticServer' -as [type])) {
    $compilerLib = $env:LIB
    try {
      Remove-Item Env:LIB -ErrorAction SilentlyContinue
      Add-Type -TypeDefinition @'
  using System;
  using System.IO;
  using System.Net;
  using System.Threading;
  using System.Threading.Tasks;

  public static class ShowroomStaticServer
  {
    public static void Run(HttpListener listener, string root, string rootPrefix)
    {
      while (listener.IsListening)
      {
        HttpListenerContext context;
        try
        {
          context = listener.GetContext();
        }
        catch (HttpListenerException)
        {
          break;
        }
        catch (ObjectDisposedException)
        {
          break;
        }

        ThreadPool.QueueUserWorkItem(delegate(object state)
        {
          Handle((HttpListenerContext)state, root, rootPrefix);
        }, context);
      }
    }

    private static void Handle(HttpListenerContext context, string root, string rootPrefix)
    {
      try
      {
        string relativePath = Uri.UnescapeDataString(context.Request.Url.AbsolutePath.TrimStart('/'));
        if (String.IsNullOrWhiteSpace(relativePath)) relativePath = "index.html";
        string filePath = Path.GetFullPath(Path.Combine(root, relativePath.Replace('/', Path.DirectorySeparatorChar)));
        if (!filePath.StartsWith(rootPrefix, StringComparison.OrdinalIgnoreCase) || !File.Exists(filePath))
        {
          context.Response.StatusCode = 404;
          return;
        }

        string extension = Path.GetExtension(filePath).ToLowerInvariant();
        context.Response.StatusCode = 200;
        context.Response.ContentType = GetContentType(extension);
        context.Response.Headers["Cache-Control"] = "no-store";
        using (FileStream stream = File.OpenRead(filePath))
        {
          context.Response.ContentLength64 = stream.Length;
          if (!String.Equals(context.Request.HttpMethod, "HEAD", StringComparison.OrdinalIgnoreCase))
          {
            stream.CopyToAsync(context.Response.OutputStream).GetAwaiter().GetResult();
          }
        }
      }
      catch (Exception error)
      {
        Console.Error.WriteLine("Static file request failed: " + error.Message);
      }
      finally
      {
        context.Response.Close();
      }
    }

    private static string GetContentType(string extension)
    {
      switch (extension)
      {
        case ".css": return "text/css; charset=utf-8";
        case ".html": return "text/html; charset=utf-8";
        case ".jpeg":
        case ".jpg": return "image/jpeg";
        case ".js": return "text/javascript; charset=utf-8";
        case ".json": return "application/json; charset=utf-8";
        case ".png": return "image/png";
        case ".svg": return "image/svg+xml";
        case ".webp": return "image/webp";
        default: return "application/octet-stream";
      }
    }
  }
'@
  }
  finally {
    if ($null -ne $compilerLib) { $env:LIB = $compilerLib }
  }
  }

$started = $false
while (-not $started -and $port -le 8010) {
  $listener = [System.Net.HttpListener]::new()
  $prefix = "http://localhost:$port/"
  $listener.Prefixes.Add($prefix)
  try {
    $listener.Start()
    $started = $true
  }
  catch {
    $listener.Close()
    $port++
  }
}
if (-not $started) { throw 'No available localhost port found between 8000 and 8010.' }
Write-Host "Serving Atelier Motors showroom at http://localhost:$port/"
Write-Host 'Press Ctrl+C to stop the server.'

try {
  [ShowroomStaticServer]::Run($listener, $root, $rootPrefix)
}
finally {
  $listener.Stop()
  $listener.Close()
}