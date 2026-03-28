import { execFile } from 'child_process';
import { promisify } from 'util';
import { Type } from '@google/genai';

const execFileAsync = promisify(execFile);

const PIP_TARGET = '/app/config/pip_packages';
const INSTALL_TIMEOUT_MS = 120_000; // 2 minutes — compilation can be slow

export const pipInstallDef = {
    name: 'pip_install',
    description:
        'Installs a Python package persistently to /app/config/pip_packages/ using pip. ' +
        'Installed packages are available immediately in all skill scripts via PYTHONPATH. ' +
        'Use this before creating a skill that requires a third-party Python library (e.g. requests, beautifulsoup4, pandas).',
    parameters: {
        type: Type.OBJECT,
        properties: {
            package: {
                type: Type.STRING,
                description: "Package name to install, optionally with version (e.g. 'requests' or 'requests==2.31.0')",
            },
        },
        required: ['package'],
    },
} as const;

export async function executePipInstall(args: any): Promise<string> {
    const pkg = String(args.package ?? '').trim();
    if (!pkg) return 'Error: package name is required.';

    // Basic safety check — reject obviously dangerous inputs
    if (/[;&|`$<>]/.test(pkg)) {
        return `Error: invalid characters in package name: ${pkg}`;
    }

    try {
        const { stdout, stderr } = await execFileAsync(
            'python3',
            ['-m', 'pip', 'install', '--target', PIP_TARGET, '--quiet', pkg],
            { timeout: INSTALL_TIMEOUT_MS }
        );
        const out = (stdout + stderr).trim();
        return out
            ? `Installed ${pkg} to ${PIP_TARGET}.\n${out}`
            : `Installed ${pkg} to ${PIP_TARGET}.`;
    } catch (e: any) {
        return `pip install failed for "${pkg}": ${e.message}`;
    }
}
