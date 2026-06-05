import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';

export interface MotionDetectorOptions {
  streamUrl: string;
  cameraType: 'webcam' | 'rtsp';
  motionThreshold?: number;       // Pixel intensity difference threshold (0-255)
  pixelChangeThreshold?: number;  // Ratio of changed pixels to trigger motion (0-1)
  fps?: number;                   // Frames per second to analyze
}

export class MotionDetector extends EventEmitter {
  private streamUrl: string;
  private cameraType: 'webcam' | 'rtsp';
  private motionThreshold: number;
  private pixelChangeThreshold: number;
  private fps: number;
  
  private ffmpegProcess: ChildProcess | null = null;
  private prevFrame: Buffer | null = null;
  private isDetecting = false;
  private isMotionActive = false;
  private width = 320;
  private height = 240;
  private frameSize = 320 * 240; // Grayscale PGM size is width * height bytes

  constructor(options: MotionDetectorOptions) {
    super();
    this.streamUrl = options.streamUrl;
    this.cameraType = options.cameraType;
    this.motionThreshold = options.motionThreshold ?? 25;
    this.pixelChangeThreshold = options.pixelChangeThreshold ?? 0.02; // 2% change
    this.fps = options.fps ?? 2; // Check 2 frames per second
  }

  /**
   * Start the motion detection loop.
   */
  public start() {
    if (this.isDetecting) return;
    
    this.isDetecting = true;
    this.prevFrame = null;
    this.isMotionActive = false;
    
    let args: string[] = [];
    
    if (this.cameraType === 'webcam') {
      if (process.platform === 'darwin') {
        // macOS Webcam capture using avfoundation
        args = [
          '-f', 'avfoundation',
          '-framerate', '30',
          '-i', '0',
          '-vf', `fps=${this.fps},scale=${this.width}:${this.height},format=gray`,
          '-f', 'image2pipe',
          '-vcodec', 'pgm',
          '-'
        ];
      } else {
        // Linux Webcam capture using v4l2
        args = [
          '-f', 'v4l2',
          '-i', '/dev/video0',
          '-vf', `fps=${this.fps},scale=${this.width}:${this.height},format=gray`,
          '-f', 'image2pipe',
          '-vcodec', 'pgm',
          '-'
        ];
      }
    } else {
      // RTSP Stream capture
      args = [
        '-rtsp_transport', 'tcp',
        '-i', this.streamUrl,
        '-vf', `fps=${this.fps},scale=${this.width}:${this.height},format=gray`,
        '-f', 'image2pipe',
        '-vcodec', 'pgm',
        '-'
      ];
    }

    console.log(`[Detector] Spawning: ffmpeg ${args.join(' ')}`);
    this.emit('log', `Starting detector ffmpeg process...`);
    
    this.ffmpegProcess = spawn('ffmpeg', args);
    
    let buffer = Buffer.alloc(0);
    
    this.ffmpegProcess.stdout?.on('data', (chunk: Buffer) => {
      if (!this.isDetecting) return;
      
      buffer = Buffer.concat([buffer, chunk]);
      
      while (buffer.length > 0) {
        // PPM/PGM binary header starts with 'P5' (0x50, 0x35)
        if (buffer[0] !== 0x50 || buffer[1] !== 0x35) {
          const nextHeader = buffer.indexOf('P5');
          if (nextHeader === -1) {
            buffer = Buffer.alloc(0);
            break;
          }
          buffer = buffer.subarray(nextHeader);
        }

        // Find the index of "255" in the header (maximum pixel value)
        const index255 = buffer.indexOf('255');
        if (index255 === -1) {
          break; // Header incomplete
        }

        // The header ends with a newline immediately following "255"
        const headerEnd = buffer.indexOf('\n', index255);
        if (headerEnd === -1) {
          break; // Header incomplete
        }

        const pixelStartIndex = headerEnd + 1;
        const totalFrameSize = pixelStartIndex + this.frameSize;

        if (buffer.length < totalFrameSize) {
          break; // Frame data incomplete
        }

        // Extract pixel bytes
        const frameData = buffer.subarray(pixelStartIndex, totalFrameSize);
        
        // Process the frame
        this.processFrame(frameData);
        
        // Slice the processed frame off our buffer
        buffer = buffer.subarray(totalFrameSize);
      }
    });

    this.ffmpegProcess.stderr?.on('data', (data) => {
      // We can output logs for debugging, but prevent flooding
      const msg = data.toString();
      if (msg.includes('Error') || msg.includes('warn') || msg.includes('Failed')) {
        this.emit('log', `FFmpeg stderr: ${msg.trim()}`);
      }
    });

    this.ffmpegProcess.on('close', (code) => {
      console.log(`[Detector] FFmpeg process closed with code ${code}`);
      this.emit('log', `Detector FFmpeg process closed with code ${code}`);
      this.stop();
      if (code !== 0 && code !== null) {
        this.emit('error', new Error(`FFmpeg detector exited with code ${code}`));
      }
    });

    this.ffmpegProcess.on('error', (err) => {
      console.error('[Detector] FFmpeg error:', err);
      this.emit('error', err);
      this.stop();
    });
  }

  /**
   * Stop the motion detection loop and kill FFmpeg.
   */
  public stop() {
    if (!this.isDetecting) return;
    this.isDetecting = false;
    this.isMotionActive = false;
    
    if (this.ffmpegProcess) {
      console.log('[Detector] Stopping FFmpeg process...');
      this.ffmpegProcess.kill('SIGKILL');
      this.ffmpegProcess = null;
    }
    
    this.prevFrame = null;
    this.emit('log', 'Motion detector stopped.');
  }

  /**
   * Calculate pixel differences between current frame and previous frame.
   */
  private processFrame(frameData: Buffer) {
    if (!this.prevFrame) {
      this.prevFrame = Buffer.from(frameData);
      return;
    }

    let changedPixels = 0;
    
    for (let i = 0; i < frameData.length; i++) {
      const diff = Math.abs(frameData[i] - this.prevFrame[i]);
      if (diff > this.motionThreshold) {
        changedPixels++;
      }
    }

    const changeRatio = changedPixels / frameData.length;
    const motionDetected = changeRatio > this.pixelChangeThreshold;

    // Trigger state change events asynchronously to prevent re-entrancy issues (like synchronous stop() calls resetting prevFrame to null mid-execution)
    if (motionDetected && !this.isMotionActive) {
      this.isMotionActive = true;
      setImmediate(() => this.emit('motion-start', changeRatio));
    } else if (motionDetected && this.isMotionActive) {
      setImmediate(() => this.emit('motion-update', changeRatio));
    } else if (!motionDetected && this.isMotionActive) {
      this.isMotionActive = false;
      setImmediate(() => this.emit('motion-end', changeRatio));
    }

    // Copy current frame to previous frame for the next comparison if it still exists
    if (this.prevFrame) {
      frameData.copy(this.prevFrame);
    }
  }
}
