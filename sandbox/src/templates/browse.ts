/**
 * Filesystem browser page served at /browse and /browse/<path>.
 *
 * Client-side SPA that fetches the existing /fs/* JSON endpoints to render
 * directory listings and inline file previews. All path validation happens
 * server-side in the /fs/* handlers — this page is purely a viewer.
 */
export function getBrowsePageHTML(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Sandbox | Browse</title>
    <link rel="icon" type="image/x-icon" href="/favicon.ico">
    <style>
        :root { color-scheme: dark; }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            background: radial-gradient(circle at 18% 20%, #1e293b, #0f172a 38%, #020617) fixed;
            color: #e2e8f0;
            padding: 32px;
            min-height: 100vh;
        }
        .page { max-width: 1080px; margin: 0 auto; display: flex; flex-direction: column; gap: 24px; }
        .hero {
            display: flex; justify-content: space-between; align-items: center; gap: 12px;
            padding: 20px 24px; background: linear-gradient(135deg, #1e293b, #334155); color: #f1f5f9; border-radius: 12px;
            box-shadow: 0 20px 40px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(148, 163, 184, 0.1);
        }
        h1 { font-size: 26px; margin-bottom: 4px; color: #f1f5f9; }
        .path-label {
            color: #cbd5e1; line-height: 1.4;
            font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
            font-size: 14px; word-break: break-all;
        }
        .card {
            background: rgba(30, 41, 59, 0.6); border: 1px solid rgba(148, 163, 184, 0.2); border-radius: 12px;
            padding: 20px 24px; box-shadow: 0 12px 30px rgba(0, 0, 0, 0.3);
            display: flex; flex-direction: column; gap: 14px;
            backdrop-filter: blur(10px);
        }
        .toolbar {
            display: flex; justify-content: space-between; align-items: center; gap: 16px; flex-wrap: wrap;
        }
        .actions { display: flex; gap: 8px; flex-wrap: wrap; }
        .button {
            background: linear-gradient(120deg, #3b82f6, #06b6d4); color: #fff; padding: 8px 14px;
            border-radius: 8px; font-weight: 600; text-decoration: none;
            box-shadow: 0 6px 14px rgba(59, 130, 246, 0.3);
            transition: all 0.2s ease; display: inline-block; font-size: 13px;
            border: none; cursor: pointer; font-family: inherit;
        }
        .button.secondary { background: linear-gradient(120deg, #10b981, #84cc16); box-shadow: 0 6px 14px rgba(16, 185, 129, 0.3); }
        .button.ghost { background: rgba(148, 163, 184, 0.15); color: #cbd5e1; box-shadow: none; }
        .button:hover { filter: brightness(1.1); transform: translateY(-1px); }
        .button.ghost:hover { background: rgba(148, 163, 184, 0.25); }
        .muted { color: #94a3b8; line-height: 1.6; }
        code {
            background: #0c1220; color: #e2e8f0; padding: 2px 6px; border-radius: 4px;
            font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
            font-size: 12px; border: 1px solid rgba(148, 163, 184, 0.2);
        }
        .breadcrumbs {
            font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
            font-size: 14px;
            display: flex; flex-wrap: wrap; align-items: center; gap: 2px;
        }
        .breadcrumbs a {
            color: #60a5fa; text-decoration: none;
            padding: 4px 6px; border-radius: 4px; transition: background 0.15s ease;
        }
        .breadcrumbs a:hover { background: rgba(96, 165, 250, 0.15); }
        .breadcrumbs .sep { color: #475569; padding: 0 2px; }
        .file-table { width: 100%; border-collapse: collapse; }
        .file-table th, .file-table td {
            padding: 9px 12px; text-align: left;
            border-bottom: 1px solid rgba(148, 163, 184, 0.08);
            font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
            font-size: 13px;
        }
        .file-table th {
            color: #94a3b8; font-weight: 600; font-size: 11px;
            text-transform: uppercase; letter-spacing: 0.06em;
            font-family: inherit;
            border-bottom: 1px solid rgba(148, 163, 184, 0.2);
        }
        .file-table tbody tr { transition: background 0.12s ease; }
        .file-table tbody tr:hover { background: rgba(96, 165, 250, 0.06); }
        .file-table a { color: #e2e8f0; text-decoration: none; }
        .file-table a:hover { color: #60a5fa; }
        .file-table .icon { display: inline-block; width: 22px; }
        .file-table .size { text-align: right; color: #94a3b8; white-space: nowrap; width: 110px; }
        .file-content {
            background: #0c1220; color: #e2e8f0; padding: 14px 16px; border-radius: 8px;
            font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
            font-size: 13px; overflow: auto; white-space: pre; line-height: 1.5;
            border: 1px solid rgba(148, 163, 184, 0.2);
            max-height: 70vh;
        }
        .meta { font-size: 13px; }
        .empty-state, .error-state, .loading-state { padding: 32px 16px; text-align: center; }
        .error-state { color: #ef4444; }
        img.preview { max-width: 100%; max-height: 70vh; border-radius: 8px; display: block; }
        .summary { font-size: 12px; color: #94a3b8; }
        @media (max-width: 640px) {
            body { padding: 18px; }
            .hero { flex-direction: column; align-items: flex-start; }
            .file-table th, .file-table td { padding: 8px 6px; font-size: 12px; }
            .file-table .size { width: 90px; }
        }
    </style>
</head>
<body>
    <main class="page">
        <header class="hero">
            <div style="min-width: 0; flex: 1;">
                <h1>Sandbox browser</h1>
                <div class="path-label" id="pathLabel">/sandbox</div>
            </div>
            <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                <a class="button ghost" href="/">Docs</a>
                <a class="button secondary" href="/shell/" target="_blank" rel="noopener noreferrer">Shell</a>
            </div>
        </header>

        <section class="card">
            <div class="toolbar">
                <div id="breadcrumbs" class="breadcrumbs"></div>
                <div class="actions" id="actions"></div>
            </div>
            <div id="content"><div class="loading-state muted">Loading…</div></div>
        </section>
    </main>

    <script>
        const BROWSE_PREFIX = '/browse';
        const FS_PREFIX = '/fs';
        const TEXT_PREVIEW_MAX = 1024 * 1024;
        const TEXT_MIME_PATTERNS = [
            /^text\\//i,
            /\\bjson\\b/i,
            /\\bxml\\b/i,
            /\\bjavascript\\b/i,
            /\\btypescript\\b/i,
            /\\bx-sh\\b/i,
            /\\byaml\\b/i,
            /\\btoml\\b/i,
            /\\bcsv\\b/i,
        ];

        function getRelativePath() {
            const p = window.location.pathname;
            if (!p.startsWith(BROWSE_PREFIX)) return '/';
            let rel = p.slice(BROWSE_PREFIX.length);
            if (rel === '') rel = '/';
            if (rel.length > 1 && rel.endsWith('/')) rel = rel.slice(0, -1);
            try { rel = decodeURIComponent(rel); } catch (e) { /* keep raw */ }
            if (!rel.startsWith('/')) rel = '/' + rel;
            return rel;
        }

        function encodePath(p) {
            return p.split('/').map(encodeURIComponent).join('/');
        }

        function joinPath(parent, child) {
            if (parent === '/' || parent === '') return '/' + child;
            return parent + '/' + child;
        }

        function formatSize(bytes) {
            if (bytes === undefined || bytes === null) return '—';
            const n = Number(bytes);
            if (Number.isNaN(n)) return '—';
            if (n < 1024) return n + ' B';
            if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
            if (n < 1024 * 1024 * 1024) return (n / (1024 * 1024)).toFixed(1) + ' MB';
            return (n / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
        }

        function escapeHtml(s) {
            return String(s).replace(/[&<>"']/g, c => ({
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                '"': '&quot;',
                "'": '&#39;',
            })[c]);
        }

        function isTextMime(mime) {
            if (!mime) return false;
            return TEXT_MIME_PATTERNS.some(re => re.test(mime));
        }

        function fsUrlFor(relPath) {
            if (relPath === '/' || relPath === '') return FS_PREFIX + '/';
            return FS_PREFIX + encodePath(relPath);
        }

        function browseUrlFor(relPath) {
            if (relPath === '/' || relPath === '') return BROWSE_PREFIX;
            return BROWSE_PREFIX + encodePath(relPath);
        }

        function renderBreadcrumbs(relPath) {
            const parts = relPath.split('/').filter(Boolean);
            const crumbs = ['<a href="' + BROWSE_PREFIX + '">/sandbox</a>'];
            let acc = '';
            for (const part of parts) {
                acc += '/' + part;
                crumbs.push('<a href="' + browseUrlFor(acc) + '">' + escapeHtml(part) + '</a>');
            }
            document.getElementById('breadcrumbs').innerHTML = crumbs.join(' <span class="sep">/</span> ');
        }

        function showError(msg) {
            document.getElementById('content').innerHTML = '<div class="error-state">' + escapeHtml(msg) + '</div>';
            document.getElementById('actions').innerHTML = '';
        }

        async function loadPath() {
            const relPath = getRelativePath();
            const fsUrl = fsUrlFor(relPath);

            document.getElementById('pathLabel').textContent = '/sandbox' + (relPath === '/' ? '' : relPath);
            renderBreadcrumbs(relPath);

            let headRes;
            try {
                headRes = await fetch(fsUrl, { method: 'HEAD' });
            } catch (e) {
                showError('Failed to reach sandbox: ' + e.message);
                return;
            }

            if (headRes.status === 404) {
                showError('Path not found: ' + relPath);
                return;
            }
            if (!headRes.ok) {
                showError('Could not access path (status ' + headRes.status + ')');
                return;
            }

            const type = headRes.headers.get('x-file-type');
            if (type === 'directory') {
                await renderDirectory(fsUrl, relPath);
            } else {
                await renderFile(fsUrl, relPath, headRes.headers);
            }
        }

        async function renderDirectory(fsUrl, relPath) {
            const dlUrl = fsUrl + (fsUrl.includes('?') ? '&' : '?') + 'download=1';
            document.getElementById('actions').innerHTML =
                '<a class="button secondary" href="' + dlUrl + '">Download ZIP</a>';

            let data;
            try {
                const res = await fetch(fsUrl);
                data = await res.json();
            } catch (e) {
                showError('Failed to read directory: ' + e.message);
                return;
            }

            const entries = (data.entries || []).slice().sort((a, b) => {
                if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
                return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
            });

            if (entries.length === 0) {
                document.getElementById('content').innerHTML = '<div class="empty-state muted">Empty directory</div>';
                return;
            }

            const dirCount = entries.filter(e => e.type === 'directory').length;
            const fileCount = entries.length - dirCount;
            const summary = '<div class="summary">' + dirCount + ' director' + (dirCount === 1 ? 'y' : 'ies') +
                ', ' + fileCount + ' file' + (fileCount === 1 ? '' : 's') + '</div>';

            const rows = entries.map(e => {
                const childRel = joinPath(relPath, e.name);
                const href = browseUrlFor(childRel);
                const icon = e.type === 'directory' ? '📁' : '📄';
                const displayName = escapeHtml(e.name) + (e.type === 'directory' ? '/' : '');
                return '<tr>' +
                    '<td><span class="icon">' + icon + '</span><a href="' + href + '">' + displayName + '</a></td>' +
                    '<td class="size">' + formatSize(e.size) + '</td>' +
                    '</tr>';
            }).join('');

            document.getElementById('content').innerHTML =
                summary +
                '<table class="file-table">' +
                '<thead><tr><th>Name</th><th class="size">Size</th></tr></thead>' +
                '<tbody>' + rows + '</tbody>' +
                '</table>';
        }

        async function renderFile(fsUrl, relPath, headHeaders) {
            const dlUrl = fsUrl + (fsUrl.includes('?') ? '&' : '?') + 'download=1';
            document.getElementById('actions').innerHTML =
                '<a class="button" href="' + fsUrl + '" target="_blank" rel="noopener noreferrer">Open raw</a>' +
                '<a class="button secondary" href="' + dlUrl + '">Download</a>';

            const mime = (headHeaders.get('content-type') || 'application/octet-stream').split(';')[0].trim();
            const size = parseInt(headHeaders.get('content-length') || '0', 10);

            const meta = '<p class="meta muted">Type: <code>' + escapeHtml(mime) +
                '</code> &nbsp;·&nbsp; Size: ' + formatSize(size) + '</p>';

            let body;
            if (mime.startsWith('image/')) {
                body = '<img class="preview" src="' + fsUrl + '" alt="' + escapeHtml(relPath) + '">';
            } else if (isTextMime(mime)) {
                if (size > TEXT_PREVIEW_MAX) {
                    body = '<p class="muted">File is ' + formatSize(size) +
                        ' — too large to preview inline. Use <strong>Open raw</strong> or <strong>Download</strong>.</p>';
                } else {
                    try {
                        const res = await fetch(fsUrl);
                        const text = await res.text();
                        body = '<pre class="file-content">' + escapeHtml(text) + '</pre>';
                    } catch (e) {
                        body = '<p class="muted">Failed to load preview: ' + escapeHtml(e.message) + '</p>';
                    }
                }
            } else {
                body = '<p class="muted">Binary file — no inline preview. Use <strong>Open raw</strong> or <strong>Download</strong>.</p>';
            }

            document.getElementById('content').innerHTML = meta + body;
        }

        loadPath();
    </script>
</body>
</html>
`;
}
