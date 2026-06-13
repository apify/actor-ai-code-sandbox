/**
 * Bridge configuration API mounted at /bridges. CRUD over the exposed-path →
 * local-target list; the live reverse proxies react to these changes via
 * bridges.ts change notifications (see bridge-proxy.ts).
 */
import { log } from 'apify';
import type { Request, Response } from 'express';
import { Router } from 'express';

import { addBridge, getBridges, removeBridge, saveBridges } from '../bridges.js';
import { wildcardPath } from '../route-params.js';

// GET / - Current bridges
const handleGet = (_req: Request, res: Response): void => {
    try {
        res.json({ bridges: getBridges() });
    } catch (error) {
        log.error('Failed to get bridges', { error: (error as Error).message });
        res.status(500).json({ error: (error as Error).message });
    }
};

// PUT / - Replace all bridges
const handlePut = (req: Request, res: Response): void => {
    try {
        const { bridges } = req.body;

        if (!Array.isArray(bridges)) {
            res.status(400).json({ error: 'bridges must be an array' });
            return;
        }

        for (const bridge of bridges) {
            if (!bridge.path || typeof bridge.path !== 'string') {
                res.status(400).json({ error: 'Each bridge must have a path string' });
                return;
            }
            if (!bridge.target || typeof bridge.target !== 'string') {
                res.status(400).json({
                    error: 'Each bridge must have a target string (full URL like http://127.0.0.1:3000/myapp)',
                });
                return;
            }
        }

        saveBridges(bridges);
        log.info('Bridges updated via API', { count: bridges.length });
        res.json({ success: true, bridges: getBridges() });
    } catch (error) {
        log.error('Failed to update bridges', { error: (error as Error).message });
        res.status(500).json({ error: (error as Error).message });
    }
};

// POST / - Add a single bridge
const handlePost = (req: Request, res: Response): void => {
    try {
        const { path, target } = req.body;

        if (!path || typeof path !== 'string') {
            res.status(400).json({ error: 'path is required (e.g., /myapp)' });
            return;
        }
        if (!target || typeof target !== 'string') {
            res.status(400).json({ error: 'target is required (full URL like http://127.0.0.1:3000/myapp)' });
            return;
        }

        addBridge({ path, target });
        log.info('Bridge added via API', { path, target });
        res.json({ success: true, bridges: getBridges() });
    } catch (error) {
        log.error('Failed to add bridge', { error: (error as Error).message });
        res.status(500).json({ error: (error as Error).message });
    }
};

// DELETE /*path - Remove the bridge exposed at that path
const handleDelete = (req: Request, res: Response): void => {
    try {
        const pathToRemove = `/${wildcardPath(req.params.path)}`;

        const removed = removeBridge(pathToRemove);
        if (removed) {
            log.info('Bridge removed via API', { path: pathToRemove });
            res.json({ success: true, removed: pathToRemove, bridges: getBridges() });
        } else {
            res.status(404).json({ error: 'Bridge not found', path: pathToRemove });
        }
    } catch (error) {
        log.error('Failed to remove bridge', { error: (error as Error).message });
        res.status(500).json({ error: (error as Error).message });
    }
};

/**
 * Build the /bridges router. Mount with `app.use('/bridges', ...)` AFTER
 * express.json() — the PUT/POST bodies are JSON.
 */
export const createBridgesRouter = (): Router => {
    const router = Router();
    router.get('/', handleGet);
    router.put('/', handlePut);
    router.post('/', handlePost);
    router.delete('/*path', handleDelete);
    return router;
};
