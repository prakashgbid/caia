/**
 * Convert split samples → MLX-LM chat-format JSONL files.
 *
 * MLX-LM's lora entry point reads a directory containing `train.jsonl`,
 * `valid.jsonl` (optional), and `test.jsonl` (optional). The chat shape is:
 *
 *     {"messages": [{"role": "system|user|assistant", "content": "..."}]}
 *
 * The "final message in the message list is the completion" (mlx-lm
 * `LORA.md`). Our corpus already emits 3-tuples of
 * (system, user, assistant) so the assistant turn is the loss target,
 * which is what `--mask-prompt` pairs with cleanly.
 *
 * Stripping `meta` keeps the training files lean; mlx-lm ignores extra
 * top-level keys, but absent-is-better.
 */

import * as path from 'node:path';
import type {
  ChatMessage,
  CorpusSample,
  FsAccess,
  SplitResult
} from './types.js';

export interface FormattedSplitPaths {
  trainPath: string;
  validPath: string;
  testPath: string;
}

/**
 * Write the three split files into `workDir`. Returns the absolute paths
 * for downstream subprocess argv construction. `workDir` MUST exist
 * (caller's responsibility — typically the trainer creates it).
 */
export function writeSplitJsonl(
  workDir: string,
  split: SplitResult,
  fs: FsAccess
): FormattedSplitPaths {
  const trainPath = path.join(workDir, 'train.jsonl');
  const validPath = path.join(workDir, 'valid.jsonl');
  const testPath = path.join(workDir, 'test.jsonl');

  fs.writeFile(trainPath, samplesToJsonl(split.train));
  fs.writeFile(validPath, samplesToJsonl(split.valid));
  fs.writeFile(testPath, samplesToJsonl(split.test));

  return { trainPath, validPath, testPath };
}

/**
 * Render a list of samples as JSONL — one `{"messages":[...]}` object per
 * line, plus a trailing newline. Preserves message order verbatim.
 */
export function samplesToJsonl(samples: CorpusSample[]): string {
  const lines = samples.map(s => JSON.stringify(toMlxRecord(s.messages)));
  return lines.length > 0 ? lines.join('\n') + '\n' : '';
}

/**
 * Strip everything except `messages` from a sample. mlx-lm reads this
 * shape natively when the data files are .jsonl in chat format.
 */
export function toMlxRecord(messages: ChatMessage[]): { messages: ChatMessage[] } {
  return { messages };
}
