import { execFile } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const SKILLS_DIR = '/app/functions';
const PIP_PACKAGES_DIR = '/app/config/pip_packages';
const SKILL_TIMEOUT_MS = 30_000;

// Supported run scripts, tried in order
const RUN_SCRIPTS: { file: string; cmd: string }[] = [
    { file: 'run.sh',  cmd: 'bash'    },
    { file: 'run.py',  cmd: 'python3' },
    { file: 'run.js',  cmd: 'node'    },
];

export interface DynamicSkill {
    definition: any;   // Gemini FunctionDeclaration
    dir: string;       // absolute path to the skill directory
}

/**
 * Scans /app/config/functions/ and returns all valid skill definitions.
 * Each skill directory must contain a definition.json.
 */
export async function loadDynamicSkills(): Promise<DynamicSkill[]> {
    const skills: DynamicSkill[] = [];
    try {
        const entries = await fs.readdir(SKILLS_DIR, { withFileTypes: true });
        for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            const skillDir = path.join(SKILLS_DIR, entry.name);
            const defPath = path.join(skillDir, 'definition.json');
            try {
                const raw = await fs.readFile(defPath, 'utf-8');
                const definition = JSON.parse(raw);
                skills.push({ definition, dir: skillDir });
            } catch {
                console.warn(`[skill-loader] Skipping ${entry.name}: definition.json missing or invalid`);
            }
        }
    } catch {
        // SKILLS_DIR doesn't exist yet — no dynamic skills loaded
    }
    return skills;
}

/**
 * Executes the run script for a skill.
 * Args are passed as JSON via the SKILL_ARGS environment variable.
 * The script's stdout is returned as the result.
 */
export async function executeDynamicSkill(
    skillDir: string,
    args: Record<string, any>,
): Promise<string> {
    // Find the first available run script
    let runner: { file: string; cmd: string } | null = null;
    for (const candidate of RUN_SCRIPTS) {
        try {
            await fs.access(path.join(skillDir, candidate.file));
            runner = candidate;
            break;
        } catch { /* not found, try next */ }
    }

    if (!runner) {
        return `Error: No run script found in ${skillDir} (expected run.sh, run.py, or run.js)`;
    }

    const scriptPath = path.join(skillDir, runner.file);

    // Ensure the script is executable
    await fs.chmod(scriptPath, 0o755);

    try {
        // Prepend pip_packages dir so installed libraries are importable
        const existingPythonPath = process.env.PYTHONPATH ?? '';
        const pythonPath = existingPythonPath
            ? `${PIP_PACKAGES_DIR}:${existingPythonPath}`
            : PIP_PACKAGES_DIR;

        const { stdout, stderr } = await execFileAsync(runner.cmd, [scriptPath], {
            timeout: SKILL_TIMEOUT_MS,
            env: {
                ...process.env,
                SKILL_ARGS: JSON.stringify(args),
                PYTHONPATH: pythonPath,
            },
        });
        return stdout.trim() || stderr.trim() || '(no output)';
    } catch (e: any) {
        const msg = e.stdout?.trim() || e.stderr?.trim() || e.message;
        return `Error: ${msg}`;
    }
}
