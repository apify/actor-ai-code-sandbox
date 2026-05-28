/**
 * Full-page wrapper that embeds the interactive shell terminal in an iframe.
 *
 * Served at `/` so the Apify run's Live View — which always loads the container
 * root — shows the live terminal directly in the run console.
 */
export function getShellLiveViewHTML(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Sandbox | Shell</title>
    <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ctext y='.9em' font-size='90'%3E📦%3C/text%3E%3C/svg%3E">
    <style>
        html, body { margin: 0; padding: 0; height: 100%; background: #000; }
        iframe { border: 0; display: block; width: 100%; height: 100%; }
    </style>
</head>
<body>
    <iframe src="/shell/" title="Interactive shell" allow="clipboard-read; clipboard-write"></iframe>
</body>
</html>
`;
}
