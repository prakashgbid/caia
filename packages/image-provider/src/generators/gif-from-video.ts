import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const FFMPEG_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_SECONDS = 4;
const FPS = 15;
const SCALE_WIDTH = 640;

async function checkFfmpeg(): Promise<void> {
  try {
    await execAsync('which ffmpeg');
  } catch {
    throw new Error('ffmpeg not found — install via: brew install ffmpeg');
  }
}

export async function gifFromVideo(
  inputPath: string,
  outputPath: string,
  opts?: { maxSeconds?: number },
): Promise<void> {
  await checkFfmpeg();

  const maxSeconds = opts?.maxSeconds ?? DEFAULT_MAX_SECONDS;

  const vf = `fps=${FPS},scale=${SCALE_WIDTH}:-1:flags=lanczos`;
  const cmd = [
    'ffmpeg',
    `-i "${inputPath}"`,
    `-t ${maxSeconds}`,
    `-vf "${vf}"`,
    '-loop 0',
    `"${outputPath}"`,
    '-y',
  ].join(' ');

  await execAsync(cmd, { timeout: FFMPEG_TIMEOUT_MS });
}
