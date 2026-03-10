import Docker from 'dockerode';

// Connects to the local Docker daemon. When running inside docker-compose with
// /var/run/docker.sock mounted, this automatically uses the host's Docker engine.
const docker = new Docker({ socketPath: '/var/run/docker.sock' });

export interface SandboxResult {
    output: string;
    error: string;
    exitCode: number;
}

export async function runInSandbox(language: 'python' | 'node' | 'bash', code: string): Promise<SandboxResult> {
    let image = 'alpine/node:latest';
    let cmd: string[] = [];

    switch (language) {
        case 'python':
            image = 'python:3.11-slim';
            cmd = ['python', '-c', code];
            break;
        case 'node':
            image = 'node:20-slim';
            cmd = ['node', '-e', code];
            break;
        case 'bash':
            image = 'ubuntu:22.04';
            cmd = ['bash', '-c', code];
            break;
        default:
            throw new Error(`Unsupported language: ${language}`);
    }

    try {
        // Ensure image exists or pull it (simplified for now, assumes image exists or pulls quickly)
        // For production, a more robust pull with stream logging is recommended
        
        const container = await docker.createContainer({
            Image: image,
            Cmd: cmd,
            Tty: false,
            HostConfig: {
                AutoRemove: true, // Automatically remove the container when it exits
                Memory: 128 * 1024 * 1024, // 128MB limit
                NetworkMode: 'none' // No internet access for safety
            }
        });

        await container.start();
        
        // Wait for container to exit and get the output streams
        const stream = await container.logs({
            stdout: true,
            stderr: true,
            follow: true
        });

        const outputData: string[] = [];
        stream.on('data', (chunk) => outputData.push(chunk.toString('utf8')));

        const result = await container.wait();

        // Clean up the output string (Dockerode output can sometimes have headers in raw buffers, 
        // string casting is basic here - ideally we'd use stream demuxing, but keeping it minimal)
        const rawOutput = outputData.join('');
        // Node's dockerode demux is better, but this crude join often suffices for simple scripts if tty=true or simple streams.

        return {
            output: rawOutput.trim(),
            error: result.StatusCode !== 0 ? 'Exited with error' : '',
            exitCode: result.StatusCode
        };
    } catch (e: any) {
        return {
            output: '',
            error: e.message || String(e),
            exitCode: -1
        };
    }
}
