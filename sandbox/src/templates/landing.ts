import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import ejs from 'ejs';
import { NodeHtmlMarkdown } from 'node-html-markdown';
import { parse as parseHtml } from 'node-html-parser';

interface LandingPageOptions {
    serverUrl: string;
    isLocalMode: boolean;
    idleTimeoutSecs: number;
}

/** Human-readable duration for the idle-timeout sentence, e.g. "15 minutes". */
function humanizeDuration(secs: number): string {
    if (secs % 3600 === 0) {
        const hours = secs / 3600;
        return `${hours} hour${hours === 1 ? '' : 's'}`;
    }
    if (secs >= 60) {
        const mins = Math.round(secs / 60);
        return `${mins} minute${mins === 1 ? '' : 's'}`;
    }
    return `${secs} second${secs === 1 ? '' : 's'}`;
}

const templatePath = join(dirname(fileURLToPath(import.meta.url)), 'landing.ejs');
const landingTemplate = readFileSync(templatePath, 'utf8');

const stylesPath = join(dirname(fileURLToPath(import.meta.url)), 'landing.css');
const landingStyles = readFileSync(stylesPath, 'utf8');

// `.status-badge` is intentionally not stripped here: the health-status badge is
// kept in /llms.txt so the /health URL stays discoverable. Badges that should not
// appear in the Markdown (the /llms.txt link, the idle countdown) are tagged
// data-no-md in the template instead.
const STRIP_SELECTOR = 'script, style, [data-no-md], .copy-btn';

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

export function getLandingPageHTML({ serverUrl, isLocalMode, idleTimeoutSecs }: LandingPageOptions): string {
    const modeLabel = isLocalMode ? 'Local mode (deps skipped)' : 'Production mode';

    return ejs.render(landingTemplate, {
        serverUrl,
        modeLabel,
        isLocalMode,
        idleTimeoutSecs,
        idleTimeoutLabel: humanizeDuration(idleTimeoutSecs),
        styles: landingStyles,
    });
}

export function getLLMsMarkdown({
    serverUrl,
    idleTimeoutSecs,
}: {
    serverUrl: string;
    idleTimeoutSecs: number;
}): string {
    const html = getLandingPageHTML({ serverUrl, isLocalMode: false, idleTimeoutSecs });
    const root = parseHtml(html);
    root.querySelectorAll(STRIP_SELECTOR).forEach((el) => el.remove());
    return `${nhm.translate(root.toString()).trim()}\n`;
}
