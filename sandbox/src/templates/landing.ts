import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import ejs from 'ejs';
import { NodeHtmlMarkdown } from 'node-html-markdown';
import { parse as parseHtml } from 'node-html-parser';

interface LandingPageOptions {
    serverUrl: string;
    isLocalMode: boolean;
}

const templatePath = join(dirname(fileURLToPath(import.meta.url)), 'landing.ejs');
const landingTemplate = readFileSync(templatePath, 'utf8');

const STRIP_SELECTOR = 'script, style, [data-no-md], .copy-btn, .collapse-btn, .status-badge';

const nhm = new NodeHtmlMarkdown(
    {
        bulletMarker: '-',
        codeFence: '```',
        codeBlockStyle: 'fenced',
        useInlineLinks: true,
    },
    {
        pre: {
            noEscape: true,
            postprocess: ({ node }) => {
                const text = (node.textContent ?? '').replace(/\n+$/, '');
                const lang = node.getAttribute('data-lang') ?? '';
                return `\`\`\`${lang}\n${text}\n\`\`\``;
            },
            surroundingNewlines: 2,
        },
    },
);

export function getLandingPageHTML({ serverUrl, isLocalMode }: LandingPageOptions): string {
    const modeLabel = isLocalMode ? 'Local mode (deps skipped)' : 'Production mode';

    return ejs.render(landingTemplate, {
        serverUrl,
        modeLabel,
        isLocalMode,
    });
}

export function getLLMsMarkdown({ serverUrl }: { serverUrl: string }): string {
    const html = getLandingPageHTML({ serverUrl, isLocalMode: false });
    const root = parseHtml(html);
    root.querySelectorAll(STRIP_SELECTOR).forEach((el) => el.remove());
    return `${nhm.translate(root.toString()).trim()}\n`;
}
