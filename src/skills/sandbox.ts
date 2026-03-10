import { runInSandbox } from '../sandbox.js';
import { Type } from '@google/genai';

export const sandboxSkillDef = {
    name: 'sandbox_execute',
    description: 'Execute code in an isolated Docker container safe sandbox environment.',
    parameters: {
        type: Type.OBJECT,
        properties: {
            language: {
                type: Type.STRING,
                description: "The language to execute: 'python', 'node', or 'bash'",
            },
            code: {
                type: Type.STRING,
                description: "The code script to execute",
            }
        },
        required: ["language", "code"]
    }
} as const; // Added as const to satisfy TypeScript

export async function executeSandboxSkill(args: any): Promise<string> {
    const { language, code } = args;
    console.log(`[Skill] Executing ${language} code...`);
    const result = await runInSandbox(language, code);
    return `Exit Code: ${result.exitCode}\nError: ${result.error}\nOutput:\n${result.output}`;
}
