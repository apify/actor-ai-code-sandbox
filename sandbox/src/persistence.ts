/**
 * Migration Persistence Module
 *
 * Handles Actor state persistence across Apify platform migrations.
 * This module tracks filesystem changes, package installations, and
 * restores the complete Actor state after resurrection.
 */

import { exec } from 'node:child_process';
import { existsSync, readFileSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { promisify } from 'node:util';

import { Actor, log } from 'apify';

import {
    JS_TS_CODE_DIR,
    KV_MIGRATION_MANIFEST,
    KV_MIGRATION_TARBALL,
    MIGRATION_EXCLUDED_PATHS,
    STARTUP_MARKER_PATH,
} from './consts.js';

const execAsync = promisify(exec);

/** Milliseconds per second, used for utimesSync which expects seconds */
const MS_PER_SECOND = 1000;

/**
 * Guard against clock skew when restoring the startup marker timestamp.
 * If the manifest timestamp is somehow in the future relative to the current
 * wall clock, we clamp it to (now - this guard) to avoid missing files.
 */
const CLOCK_SKEW_GUARD_MS = 1000;

/**
 * Migration manifest structure.
 *
 * Manifests written before Python was dropped from the image also carry a
 * `packages.pip` array. Nothing reads it any more, so such a manifest still
 * restores cleanly — its pip packages are simply ignored, which is correct
 * now that there is no interpreter to install them into. Keep new readers
 * tolerant of extra keys for the same reason.
 */
export interface MigrationManifest {
    version: number;
    createdAt: string;
    actorRunId: string | null;
    startupTimestamp: number;
    packages: {
        apt: string[];
    };
    changedFiles: {
        count: number;
        totalSize: number;
        paths: string[];
    };
}

/**
 * Initialize persistence system by creating startup marker.
 * IMPORTANT: This must be called both on fresh starts AND after migration restore.
 * Without the marker, findChangedFiles() returns [] and the next save would
 * overwrite good state with an empty snapshot.
 */
export const initializePersistence = (): void => {
    try {
        writeFileSync(STARTUP_MARKER_PATH, '');
        log.info('Persistence initialized - startup marker created', { path: STARTUP_MARKER_PATH });
    } catch (error) {
        log.error('Failed to create startup marker', { error: (error as Error).message });
        throw error;
    }
};

/**
 * Restore the startup marker timestamp from the migration manifest.
 *
 * When files are restored from a tarball, `tar` preserves their original mtimes.
 * If we create a fresh marker (mtime = now), `find -newer marker` will miss all
 * restored files because they appear older than the marker. This causes the next
 * save to produce an empty tarball, losing all state on the subsequent resurrect.
 *
 * Fix: set the marker's mtime back to the original startup timestamp from the
 * manifest. This ensures `find -newer` catches both restored files AND any new
 * files created after restoration.
 *
 * @param startupTimestampMs - The original startup marker mtime in milliseconds
 */
export const restoreStartupMarkerTimestamp = (startupTimestampMs: number): void => {
    if (!Number.isFinite(startupTimestampMs) || startupTimestampMs <= 0) {
        log.error('Invalid startupTimestamp from manifest, skipping marker restore', {
            startupTimestampMs,
        });
        return;
    }

    // Clamp to prevent the marker from being set to the future (clock skew protection)
    const nowMs = Date.now();
    const clampedMs = Math.min(startupTimestampMs, nowMs - CLOCK_SKEW_GUARD_MS);
    const markerSeconds = clampedMs / MS_PER_SECOND;

    // Ensure marker file exists
    if (!existsSync(STARTUP_MARKER_PATH)) {
        writeFileSync(STARTUP_MARKER_PATH, '');
    }

    // Set both atime and mtime to the original startup timestamp
    utimesSync(STARTUP_MARKER_PATH, markerSeconds, markerSeconds);

    log.info('Startup marker timestamp restored from manifest', {
        originalTimestamp: new Date(startupTimestampMs).toISOString(),
        appliedTimestamp: new Date(clampedMs).toISOString(),
    });
};

/**
 * Find all files that have been modified since Actor startup
 * @returns Array of file paths that have changed
 */
export const findChangedFiles = async (): Promise<string[]> => {
    log.info('Finding changed files since startup...');

    if (!existsSync(STARTUP_MARKER_PATH)) {
        log.warning('Startup marker not found, cannot determine changed files');
        return [];
    }

    try {
        // Build find command with excluded paths
        const excludeArgs = MIGRATION_EXCLUDED_PATHS.map((p) => `-path '${p}' -prune -o`).join(' ');

        // Find all files newer than marker, excluding virtual filesystems and regenerable directories
        const command = `find / -xdev ${excludeArgs} -type f -newer ${STARTUP_MARKER_PATH} -print 2>/dev/null || true`;

        log.debug('Running find command', { command });
        const startTime = Date.now();
        const { stdout } = await execAsync(command, {
            maxBuffer: 50 * 1024 * 1024, // 50 MB buffer for long file lists
            timeout: 30000, // 30 second timeout
        });
        const findDurationMs = Date.now() - startTime;

        const files = stdout
            .trim()
            .split('\n')
            .filter((f) => f.length > 0)
            .filter((f) => {
                // Additional filtering for excluded paths (in case find didn't catch everything)
                return !MIGRATION_EXCLUDED_PATHS.some((excluded) => f.startsWith(excluded));
            });

        log.info('Found changed files', { count: files.length, findDurationMs });

        if (files.length > 0) {
            log.debug('Changed files sample', { sample: files.slice(0, 10) });
        }

        return files;
    } catch (error) {
        log.error('Error finding changed files', { error: (error as Error).message });
        return [];
    }
};

/**
 * Parse APT history log to get list of installed packages
 * @returns Array of package names
 */
export const parseAptHistory = (): string[] => {
    const aptHistoryPath = '/var/log/apt/history.log';

    if (!existsSync(aptHistoryPath)) {
        log.debug('APT history log not found, no packages to restore');
        return [];
    }

    try {
        const content = readFileSync(aptHistoryPath, 'utf-8');
        const packages = new Set<string>();

        // Parse log file for Install: lines
        const lines = content.split('\n');
        for (const line of lines) {
            if (line.startsWith('Install:')) {
                // Extract package names from "Install: pkg1:arch (version), pkg2:arch (version), ..."
                const pkgLine = line.substring('Install:'.length).trim();
                const pkgMatches = pkgLine.matchAll(/([a-z0-9][a-z0-9+.-]+):[a-z0-9]+\s+\([^)]+\)/gi);

                for (const match of pkgMatches) {
                    packages.add(match[1]);
                }
            }
        }

        const packageList = Array.from(packages);
        log.info('Parsed APT history', { packageCount: packageList.length });

        if (packageList.length > 0) {
            log.debug('APT packages to reinstall', { packages: packageList });
        }

        return packageList;
    } catch (error) {
        log.error('Error parsing APT history', { error: (error as Error).message });
        return [];
    }
};

/**
 * Generate package manifests for all package managers
 */
export const generatePackageManifests = async (): Promise<MigrationManifest['packages']> => {
    log.info('Generating package manifests...');

    return { apt: parseAptHistory() };
};

/**
 * Create tarball from list of changed files
 * @param files - Array of file paths to include
 * @returns Path to created tarball
 */
export const createMigrationTarball = async (files: string[]): Promise<string> => {
    const tarballPath = '/tmp/migration-state.tar.gz';

    log.info('Creating migration tarball...', { fileCount: files.length });

    if (files.length === 0) {
        log.warning('No files to backup, creating empty tarball');
        // Create minimal empty tarball
        writeFileSync(tarballPath, '');
        return tarballPath;
    }

    try {
        // Write file list to temp file for tar command
        const fileListPath = '/tmp/migration-files.txt';
        writeFileSync(fileListPath, files.join('\n'));

        // Create tarball using native tar command (preserves permissions and ownership)
        const tarCommand = `tar -czf ${tarballPath} -P --files-from=${fileListPath} 2>/dev/null || true`;

        await execAsync(tarCommand, {
            timeout: 60000, // 60 second timeout
            maxBuffer: 10 * 1024 * 1024, // 10 MB buffer
        });

        if (!existsSync(tarballPath)) {
            throw new Error('Tarball creation failed - file not created');
        }

        const stats = statSync(tarballPath);
        log.info('Tarball created successfully', {
            path: tarballPath,
            size: stats.size,
            sizeMB: (stats.size / (1024 * 1024)).toFixed(2),
        });

        return tarballPath;
    } catch (error) {
        log.error('Error creating tarball', { error: (error as Error).message });
        throw error;
    }
};

/**
 * Save migration state to Key-Value Store
 */
export const saveMigrationState = async (): Promise<void> => {
    const saveStartTime = Date.now();
    log.info('Starting migration state save...');

    try {
        // Step 1: Find changed files and generate package manifests in parallel
        const [changedFiles, packages] = await Promise.all([findChangedFiles(), generatePackageManifests()]);

        // Calculate total size of changed files
        let totalSize = 0;
        for (const file of changedFiles) {
            try {
                const stats = statSync(file);
                totalSize += stats.size;
            } catch {
                // File may have been deleted, skip
            }
        }

        // Step 2: Build manifest
        const manifest: MigrationManifest = {
            version: 1,
            createdAt: new Date().toISOString(),
            actorRunId: process.env.ACTOR_RUN_ID || null,
            startupTimestamp: statSync(STARTUP_MARKER_PATH).mtimeMs,
            packages,
            changedFiles: {
                count: changedFiles.length,
                totalSize,
                paths: changedFiles,
            },
        };

        log.info('Migration manifest prepared', {
            files: manifest.changedFiles.count,
            sizeMB: (totalSize / (1024 * 1024)).toFixed(2),
            aptPackages: manifest.packages.apt.length,
        });

        // Step 3: Create tarball
        const tarballPath = await createMigrationTarball(changedFiles);

        // Step 4: Upload tarball to KV store
        const tarballBuffer = readFileSync(tarballPath);
        await Actor.setValue(KV_MIGRATION_TARBALL, tarballBuffer, { contentType: 'application/gzip' });

        log.info('Tarball uploaded to KV store', { key: KV_MIGRATION_TARBALL, size: tarballBuffer.length });

        // Step 5: Upload manifest
        await Actor.setValue(KV_MIGRATION_MANIFEST, manifest);

        const saveDurationMs = Date.now() - saveStartTime;
        log.info('Migration state saved successfully', {
            durationMs: saveDurationMs,
            files: changedFiles.length,
            aptPackages: packages.apt.length,
        });
    } catch (error) {
        const saveDurationMs = Date.now() - saveStartTime;
        log.error('Failed to save migration state', {
            error: (error as Error).message,
            durationMs: saveDurationMs,
        });
        // Don't throw - let Actor shutdown continue
    }
};

/**
 * Reinstall packages from manifest
 * @param packages - Package manifest
 */
export const reinstallPackages = async (packages: MigrationManifest['packages']): Promise<void> => {
    log.info('Reinstalling packages...', { apt: packages.apt.length });

    // Reinstall APT packages
    if (packages.apt.length > 0) {
        try {
            log.info(`Reinstalling ${packages.apt.length} APT packages...`);

            // Log packages in readable chunks (10 per line)
            const chunkSize = 10;
            for (let i = 0; i < packages.apt.length; i += chunkSize) {
                const chunk = packages.apt.slice(i, i + chunkSize);
                log.info(
                    `  APT packages [${i + 1}-${Math.min(i + chunkSize, packages.apt.length)}]: ${chunk.join(', ')}`,
                );
            }

            // Update package lists first
            log.info('Running apt-get update...');
            const { stdout: updateStdout, stderr: updateStderr } = await execAsync('apt-get update', {
                timeout: 60000,
                env: { ...process.env, DEBIAN_FRONTEND: 'noninteractive' },
            });

            if (updateStdout) {
                log.debug('apt-get update completed');
            }

            if (updateStderr) {
                log.debug('apt-get update stderr', { stderr: updateStderr });
            }

            // Install packages
            const aptCommand = `apt-get install -y ${packages.apt.join(' ')}`;
            log.info('Running apt-get install...');

            await execAsync(aptCommand, {
                timeout: 300000, // 5 minute timeout
                env: { ...process.env, DEBIAN_FRONTEND: 'noninteractive' },
            });

            log.info(`Successfully reinstalled ${packages.apt.length} APT packages`);
        } catch (error) {
            log.error('Failed to reinstall APT packages', {
                error: (error as Error).message,
                count: packages.apt.length,
            });
            // Log first 20 packages that failed
            if (packages.apt.length > 0) {
                const sample = packages.apt.slice(0, 20);
                log.error(`Failed packages (first 20 of ${packages.apt.length}): ${sample.join(', ')}`);
            }
            // Continue with the NPM restore below even if apt fails
        }
    }

    // NPM packages are handled by package.json restoration from tarball
    // Just run npm install if package.json exists
    if (existsSync(`${JS_TS_CODE_DIR}/package.json`)) {
        try {
            log.info('Reinstalling NPM packages from package.json...');

            await execAsync('npm install', {
                cwd: JS_TS_CODE_DIR,
                timeout: 300000, // 5 minute timeout
            });

            log.info('NPM packages reinstalled successfully');
        } catch (error) {
            log.error('Failed to reinstall NPM packages', { error: (error as Error).message });
        }
    }
};

/**
 * Restore migration state from Key-Value Store
 * @returns true if state was restored, false if no state found
 */
export const restoreMigrationState = async (): Promise<boolean> => {
    log.info('Checking for migration state...');

    try {
        // Step 1: Check if manifest exists
        const manifest = await Actor.getValue<MigrationManifest>(KV_MIGRATION_MANIFEST);

        if (!manifest) {
            log.info('No migration state found, starting fresh');
            return false;
        }

        log.info('Found migration state, restoring...', {
            createdAt: manifest.createdAt,
            files: manifest.changedFiles.count,
            aptPackages: manifest.packages.apt.length,
        });

        // Step 2: Download tarball
        const tarballBuffer = await Actor.getValue<Buffer>(KV_MIGRATION_TARBALL);

        if (!tarballBuffer) {
            log.error('Migration manifest found but tarball missing');
            return false;
        }

        log.info('Tarball downloaded from KV store', { size: tarballBuffer.length });

        // Step 3: Write tarball to temp file
        const tarballPath = '/tmp/restore-migration.tar.gz';
        writeFileSync(tarballPath, tarballBuffer);

        // Step 4: Extract tarball to root
        if (manifest.changedFiles.count > 0) {
            log.info('Extracting tarball to root filesystem...');

            // Extract using native tar command (preserves permissions and ownership)
            const extractCommand = `tar -xzf ${tarballPath} -C / -P 2>/dev/null || true`;

            await execAsync(extractCommand, {
                timeout: 60000, // 60 second timeout
            });

            log.info('Tarball extracted successfully');
        } else {
            log.info('No files to restore (empty tarball)');
        }

        // Step 5: Reinstall packages
        await reinstallPackages(manifest.packages);

        // Step 6: Restore startup marker timestamp from the manifest.
        // CRITICAL: tar preserves original file mtimes, but a fresh marker would have
        // mtime = NOW. This means `find -newer marker` would miss all restored files
        // (they appear "older" than the marker), causing the next save to produce an
        // empty tarball. Setting the marker back to the original startup timestamp
        // ensures find catches both restored files AND any new files created after restore.
        restoreStartupMarkerTimestamp(manifest.startupTimestamp);

        log.info('Migration state restored successfully', {
            files: manifest.changedFiles.count,
            aptPackages: manifest.packages.apt.length,
        });

        return true;
    } catch (error) {
        log.error('Failed to restore migration state', { error: (error as Error).message });
        return false;
    }
};
