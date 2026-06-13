/**
 * Reverse proxies backing bridges (exposed path → local server inside the
 * sandbox). Bridge *configuration* (the path/target list, persisted to
 * /sandbox/.bridges.json) lives in bridges.ts; this module owns the live
 * http-proxy instances and routes incoming HTTP requests and WebSocket
 * upgrades to them.
 */
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';

import { log } from 'apify';
import type { NextFunction, Request, Response } from 'express';
import httpProxy from 'http-proxy';

import { getBridges, onBridgesChange } from './bridges.js';
import { touchActivity } from './idle.js';
import type { Bridge } from './types.js';

/** Live reverse-proxy instance backing one bridge. */
interface BridgeProxy {
    proxy: ReturnType<typeof httpProxy.createProxyServer>;
    targetOrigin: string;
    targetPath: string;
}

const bridgeProxies = new Map<string, BridgeProxy>();

/**
 * Find the bridge whose exposed path is the longest prefix of the request
 * path, or null when none matches.
 */
export const matchBridge = (bridges: Bridge[], requestPath: string): Bridge | null => {
    let matched: Bridge | null = null;
    for (const bridge of bridges) {
        if (requestPath.startsWith(bridge.path) && bridge.path.length > (matched?.path.length ?? 0)) {
            matched = bridge;
        }
    }
    return matched;
};

/**
 * Rewrite a request URL from the exposed bridge path to the target path,
 * preserving the query string. E.g. with bridge path `/app` targeting
 * `/myapp`, `/app/users?x=1` becomes `/myapp/users?x=1`. Joins the two path
 * pieces without doubling or dropping the `/` between them.
 */
export const rewriteBridgeUrl = (reqUrl: string, bridgePath: string, targetPath: string): string => {
    const queryIdx = reqUrl.indexOf('?');
    const pathOnly = queryIdx >= 0 ? reqUrl.slice(0, queryIdx) : reqUrl;
    const queryString = queryIdx >= 0 ? reqUrl.slice(queryIdx) : '';

    let extraPath = pathOnly.slice(bridgePath.length);
    let finalPath = targetPath;
    if (extraPath) {
        if (finalPath.endsWith('/') && extraPath.startsWith('/')) {
            extraPath = extraPath.slice(1);
        }
        if (!finalPath.endsWith('/') && !extraPath.startsWith('/')) {
            finalPath += '/';
        }
        finalPath += extraPath;
    }

    const url = finalPath + queryString;
    return url.startsWith('/') ? url : `/${url}`;
};

/** Create or replace the reverse proxy backing a bridge. */
const setupBridge = (bridge: Bridge): void => {
    let targetUrl = bridge.target;
    if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
        targetUrl = `http://${targetUrl}`;
    }

    let targetOrigin: string;
    let targetPath: string;
    try {
        const url = new URL(targetUrl);
        targetOrigin = `${url.protocol}//${url.host}`;
        // Keep the target path as-is (preserve trailing slash if present)
        targetPath = url.pathname || '/';
    } catch {
        log.error('Invalid bridge target URL', { target: targetUrl });
        return;
    }

    bridgeProxies.get(bridge.path)?.proxy.close();

    // The proxy targets just the origin; rewriteBridgeUrl remaps paths per request.
    const proxy = httpProxy.createProxyServer({
        target: targetOrigin,
        changeOrigin: true,
        // Don't rewrite redirects - we remap paths ourselves below
        autoRewrite: false,
    });

    proxy.on('error', (err, _req, res) => {
        log.error('Bridge proxy error', { path: bridge.path, target: targetUrl, error: err.message });
        if (res && 'writeHead' in res && !res.headersSent) {
            res.writeHead(502, { 'Content-Type': 'text/plain' });
            res.end(`Proxy error: target server at ${targetUrl} not available`);
        }
    });

    // Rewrite Location headers in redirects to map target paths back to exposed paths
    proxy.on('proxyRes', (proxyRes) => {
        const { location } = proxyRes.headers;
        if (location && typeof location === 'string' && location.startsWith(targetPath)) {
            const newLocation = bridge.path + location.slice(targetPath.length);
            // eslint-disable-next-line no-param-reassign -- mutating proxyRes headers is http-proxy's rewrite API
            proxyRes.headers.location = newLocation;
            log.info('Rewrote redirect Location header', { original: location, rewritten: newLocation });
        }
    });

    bridgeProxies.set(bridge.path, { proxy, targetOrigin, targetPath });
    log.info('Bridge proxy configured', { exposedPath: bridge.path, targetOrigin, targetPath });
};

/** Tear down the reverse proxy for a bridge path. */
const removeBridgeProxy = (path: string): void => {
    const entry = bridgeProxies.get(path);
    if (entry) {
        entry.proxy.close();
        bridgeProxies.delete(path);
        log.info('Bridge proxy removed', { path });
    }
};

/**
 * Create proxies for the currently configured bridges and keep them in sync
 * with config changes (API updates or edits to /sandbox/.bridges.json).
 */
export const initializeBridgeProxies = (): void => {
    for (const bridge of getBridges()) {
        setupBridge(bridge);
    }

    onBridgesChange((newBridges) => {
        const newPaths = new Set(newBridges.map((b) => b.path));
        for (const path of bridgeProxies.keys()) {
            if (!newPaths.has(path)) {
                removeBridgeProxy(path);
            }
        }
        for (const bridge of newBridges) {
            setupBridge(bridge);
        }
    });
};

/** Look up the live proxy for the bridge matching a request path. */
const findProxyEntry = (requestPath: string): { bridge: Bridge; entry: BridgeProxy } | null => {
    const bridge = matchBridge(getBridges(), requestPath);
    if (!bridge) return null;
    const entry = bridgeProxies.get(bridge.path);
    return entry ? { bridge, entry } : null;
};

/**
 * Express middleware forwarding requests on bridged paths to their local
 * target server. Falls through to the next handler when no bridge matches.
 */
export const bridgeRequestHandler = (req: Request, res: Response, next: NextFunction): void => {
    const match = findProxyEntry(req.path);
    if (!match) {
        next();
        return;
    }

    req.url = rewriteBridgeUrl(req.url, match.bridge.path, match.entry.targetPath);
    log.info('Proxying bridged request', {
        exposedPath: match.bridge.path,
        targetUrl: match.entry.targetOrigin + req.url,
    });

    touchActivity();
    match.entry.proxy.web(req, res);
};

/**
 * Proxy a WebSocket upgrade on a bridged path to its target server. Returns
 * false (untouched request) when no bridge matches.
 */
export const handleBridgeUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer): boolean => {
    const reqUrl = req.url || '/';
    const pathOnly = reqUrl.split('?')[0];
    const match = findProxyEntry(pathOnly);
    if (!match) return false;

    req.url = rewriteBridgeUrl(reqUrl, match.bridge.path, match.entry.targetPath);
    log.info('Proxying bridged WebSocket upgrade', {
        exposedPath: match.bridge.path,
        targetUrl: match.entry.targetOrigin + req.url,
    });

    socket.on('data', touchActivity);
    match.entry.proxy.ws(req, socket, head);
    return true;
};
