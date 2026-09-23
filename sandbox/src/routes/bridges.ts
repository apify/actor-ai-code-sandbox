/**
 * Bridge configuration API mounted at /bridges. CRUD over the exposed-path →
 * local-target list; the live reverse proxies react to these changes via
 * bridges.ts change notifications (see bridge-proxy.ts).
 */
import { log } from 'apify';
import type { Request, Response } from 'express';
import { Router } from 'express';

import {
    addBridge,
    BridgeValidationError,
    getBridges,
    normalizeBridgePath,
    removeBridge,
    replaceBridges,
} from '../bridges.js';
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

/** Map a validation failure to 400 and anything else (e.g. a failed write) to 500. */
const sendError = (res: Response, action: string, error: unknown): void => {
    if (error instanceof BridgeValidationError) {
        res.status(400).json({ error: error.message });
        return;
    }
    log.error(`Failed to ${action}`, { error: (error as Error).message });
    res.status(500).json({ error: (error as Error).message });
};

// PUT / - Replace all bridges
const handlePut = (req: Request, res: Response): void => {
    try {
        replaceBridges(req.body?.bridges);
        log.info('Bridges updated via API', { count: getBridges().length });
        res.json({ success: true, bridges: getBridges() });
    } catch (error) {
        sendError(res, 'update bridges', error);
    }
};

// POST / - Add a single bridge
const handlePost = (req: Request, res: Response): void => {
    try {
        addBridge(req.body);
        log.info('Bridge added via API', { path: req.body?.path, target: req.body?.target });
        res.json({ success: true, bridges: getBridges() });
    } catch (error) {
        sendError(res, 'add bridge', error);
    }
};

// DELETE /*path - Remove the bridge exposed at that path
const handleDelete = (req: Request, res: Response): void => {
    try {
        const pathToRemove = normalizeBridgePath(wildcardPath(req.params.path));

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
