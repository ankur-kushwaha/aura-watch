import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

function resolveReidPython(): string {
  if (process.env.REID_PYTHON) {
    return process.env.REID_PYTHON;
  }

  const venvPython = path.join(__dirname, '../../.venv-reid/bin/python');
  if (fs.existsSync(venvPython)) {
    return venvPython;
  }

  return 'python3';
}

interface ReidQueueItem {
  imagePath: string;
  resolve: (embedding: number[]) => void;
  reject: (err: any) => void;
}

class ReidWorkerService {
  private pythonProcess: ChildProcess | null = null;
  private isReady = false;
  private queue: ReidQueueItem[] = [];
  private isProcessing = false;
  private currentRequest: ReidQueueItem | null = null;
  private stdoutBuffer = '';
  private readyPromise: Promise<void> | null = null;

  public async start(): Promise<void> {
    if (this.readyPromise) return this.readyPromise;

    this.readyPromise = new Promise<void>((resolve, reject) => {
      const scriptPath = path.join(__dirname, 'reid_worker.py');
      const pythonBin = resolveReidPython();
      console.log(`[ReID Worker] Spawning persistent python process (${pythonBin}) at ${scriptPath}...`);

      this.pythonProcess = spawn(pythonBin, [scriptPath]);
      
      this.pythonProcess.stdout?.on('data', (data: Buffer) => {
        const text = data.toString();
        this.stdoutBuffer += text;
        this.handleStdout(resolve, reject);
      });

      this.pythonProcess.stderr?.on('data', (data: Buffer) => {
        console.error(`[ReID Worker Python Error] ${data.toString().trim()}`);
      });

      this.pythonProcess.on('error', (err) => {
        console.error('[ReID Worker Process Error]', err);
        reject(err);
        this.handleCrash(err);
      });

      this.pythonProcess.on('exit', (code) => {
        if (code !== 0 && code !== null) {
          console.warn(`[ReID Worker] Python process exited with code ${code}`);
          const err = new Error(`Python process exited with code ${code}`);
          reject(err);
          this.handleCrash(err);
        }
      });
    });

    return this.readyPromise;
  }

  private handleStdout(resolveReady: () => void, rejectReady: (err: any) => void) {
    let newlineIndex: number;
    while ((newlineIndex = this.stdoutBuffer.indexOf('\n')) !== -1) {
      const line = this.stdoutBuffer.slice(0, newlineIndex).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);

      if (!line) continue;

      if (!this.isReady) {
        if (line === 'READY') {
          console.log('[ReID Worker] OSNet python model is loaded and ready.');
          this.isReady = true;
          resolveReady();
          this.processQueue();
        } else {
          try {
            const parsed = JSON.parse(line);
            if (parsed && parsed.error) {
              rejectReady(new Error(parsed.error));
            }
          } catch (e) {
            // Ignore non-JSON lines printed during initialization
            console.log(`[ReID Worker Startup Log] ${line}`);
          }
        }
      } else {
        // We are processing a crop image request
        try {
          const parsed = JSON.parse(line);
          const req = this.currentRequest;
          this.currentRequest = null;
          this.isProcessing = false;

          if (req) {
            if (parsed && parsed.error) {
              req.reject(new Error(parsed.error));
            } else if (Array.isArray(parsed) && parsed.length === 512) {
              req.resolve(parsed);
            } else {
              req.reject(new Error(`Invalid embedding output length: ${parsed.length || 'not an array'}`));
            }
          }

          // Process next item in queue
          this.processQueue();
        } catch (err) {
          // If JSON parse fails, it is likely a print log/warning from torchreid/PyTorch.
          // Print it to console, but don't resolve/reject the current request yet.
          console.log(`[ReID Worker Log] ${line}`);
        }
      }
    }
  }

  private handleCrash(err: any) {
    this.isReady = false;
    this.isProcessing = false;
    this.readyPromise = null;

    const req = this.currentRequest;
    this.currentRequest = null;
    if (req) {
      req.reject(err);
    }

    // Reject all items currently in queue
    const queuedItems = [...this.queue];
    this.queue = [];
    queuedItems.forEach(item => item.reject(new Error(`ReID worker crashed: ${err.message}`)));

    // Attempt to restart after 5 seconds
    setTimeout(() => {
      console.log('[ReID Worker] Re-starting crashed ReID worker...');
      this.start().catch(console.error);
    }, 5000);
  }

  private processQueue() {
    if (this.isProcessing || this.queue.length === 0 || !this.isReady) {
      return;
    }

    const next = this.queue.shift();
    if (!next) return;

    this.currentRequest = next;
    this.isProcessing = true;

    if (this.pythonProcess && this.pythonProcess.stdin) {
      this.pythonProcess.stdin.write(next.imagePath + '\n');
    } else {
      next.reject(new Error('Python process stdin is not writeable'));
      this.isProcessing = false;
      this.currentRequest = null;
    }
  }

  public generateEmbedding(imagePath: string): Promise<number[]> {
    return new Promise<number[]>((resolve, reject) => {
      this.queue.push({ imagePath, resolve, reject });
      this.processQueue();
    });
  }

  public stop() {
    if (this.pythonProcess) {
      console.log('[ReID Worker] Stopping persistent python process...');
      this.pythonProcess.kill();
      this.pythonProcess = null;
    }
    this.isReady = false;
    this.isProcessing = false;
    this.readyPromise = null;
  }
}

export const reidWorker = new ReidWorkerService();
export default reidWorker;
