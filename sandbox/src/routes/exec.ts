/**
 * POST /exec — unified shell-command and code-snippet execution endpoint.
 * Register AFTER express.json(); the request body is JSON.
 */
import { log } from 'apify';
import type { Request, Response } from 'express';

import { execute, normalizeLanguage, SUPPORTED_LANGUAGES } from '../operations.js';

export const handleExec = async (req: Request, res: Response): Promise<void> => {
    try {
        const { command, language, cwd, timeoutSecs } = req.body;

        log.info('REST /exec request received', { command: command?.substring(0, 100), language, cwd, timeoutSecs });

        if (!command) {
            res.status(400).json({ error: 'Command is required' });
            return;
        }

        const normalizedLang = normalizeLanguage(language);
        if (language && !normalizedLang) {
            res.status(400).json({ error: `Invalid language: ${language}. Supported: ${SUPPORTED_LANGUAGES}` });
            return;
        }

        const result = await execute({ command, language: normalizedLang, cwd, timeoutSecs });

        if (result.exitCode !== 0) {
            log.debug('REST /exec completed with error', { language: result.language, exitCode: result.exitCode });
            res.status(500).json(result);
            return;
        }

        log.info('REST /exec completed successfully', { language: result.language });
        res.json(result);
    } catch (error) {
        log.error('REST /exec error', { error });
        res.status(500).json({
            error: (error as Error).message,
            stdout: '',
            stderr: '',
            exitCode: 1,
            language: 'shell',
        });
    }
};
