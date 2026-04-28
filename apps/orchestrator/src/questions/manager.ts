import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { nanoid } = require('nanoid') as { nanoid: (size?: number) => string };

import { assertQuestionTransition } from './state-machine';
import type {
  CreateQuestionParams,
  DrainedQuestion,
  Question,
  QuestionAnswer,
  QuestionDrainResult,
  QuestionEvent,
  QuestionEventType,
  QuestionsState,
  QuestionState,
} from './types';

function applyEvent(state: QuestionsState, event: QuestionEvent): QuestionsState {
  const questions = { ...state.questions };
  const { questionId } = event;

  switch (event.type) {
    case 'QUESTION_CREATED': {
      const payload = event.payload as { question: Question } | undefined;
      if (payload?.question) {
        questions[questionId] = { ...payload.question };
      }
      break;
    }
    case 'QUESTION_ANSWERED': {
      const payload = event.payload as { answer: QuestionAnswer } | undefined;
      if (questions[questionId] && payload) {
        questions[questionId] = {
          ...questions[questionId]!,
          state: 'answered',
          answeredAt: event.timestamp,
          answer: payload.answer,
        };
      }
      break;
    }
    case 'QUESTION_CANCELLED': {
      if (questions[questionId]) {
        questions[questionId] = { ...questions[questionId]!, state: 'cancelled' };
      }
      break;
    }
    default:
      break;
  }

  return { questions, lastEventId: event.id, rebuiltAt: state.rebuiltAt };
}

export class QuestionsManager {
  readonly conductorDir: string;
  private state: QuestionsState;
  private pendingDrain: DrainedQuestion[] = [];

  constructor(conductorDir?: string) {
    this.conductorDir = conductorDir ?? path.join(os.homedir(), '.conductor');
    this.state = { questions: {}, lastEventId: '' };
  }

  async init(): Promise<void> {
    fs.mkdirSync(this.conductorDir, { recursive: true });
    await this.loadState();
  }

  private async loadState(): Promise<void> {
    const snapshotPath = path.join(this.conductorDir, 'questions.snapshot.json');
    if (!fs.existsSync(snapshotPath)) {
      await this.rebuildFromEventLog();
      return;
    }
    try {
      const raw = fs.readFileSync(snapshotPath, 'utf8');
      const snapshot = JSON.parse(raw) as QuestionsState;
      this.state = snapshot;
      await this.replayEventsAfter(snapshot.lastEventId);
    } catch {
      await this.rebuildFromEventLog();
    }
  }

  private readEventLog(): QuestionEvent[] {
    const eventsPath = path.join(this.conductorDir, 'questions.jsonl');
    if (!fs.existsSync(eventsPath)) return [];
    const raw = fs.readFileSync(eventsPath, 'utf8');
    const events: QuestionEvent[] = [];
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        events.push(JSON.parse(trimmed) as QuestionEvent);
      } catch {
        // skip malformed lines
      }
    }
    return events;
  }

  private async replayEventsAfter(lastEventId: string): Promise<void> {
    const events = this.readEventLog();
    let found = lastEventId === '';
    for (const event of events) {
      if (!found) {
        if (event.id === lastEventId) found = true;
        continue;
      }
      this.state = applyEvent(this.state, event);
    }
  }

  async rebuildFromEventLog(): Promise<void> {
    const events = this.readEventLog();
    let state: QuestionsState = { questions: {}, lastEventId: '' };
    for (const event of events) {
      state = applyEvent(state, event);
    }
    state.rebuiltAt = new Date().toISOString();
    this.state = state;
    await this.saveSnapshot();
  }

  private async appendEvent(
    type: QuestionEventType,
    questionId: string,
    payload?: unknown,
  ): Promise<QuestionEvent> {
    const event: QuestionEvent = {
      id: 'qevt_' + nanoid(8),
      type,
      questionId,
      timestamp: new Date().toISOString(),
      payload,
    };
    const eventsPath = path.join(this.conductorDir, 'questions.jsonl');
    fs.appendFileSync(eventsPath, JSON.stringify(event) + '\n');
    this.state = applyEvent(this.state, event);
    await this.saveSnapshot();
    return event;
  }

  private async saveSnapshot(): Promise<void> {
    const snapshotPath = path.join(this.conductorDir, 'questions.snapshot.json');
    const tmpPath = snapshotPath + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(this.state, null, 2));
    fs.renameSync(tmpPath, snapshotPath);
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  async create(params: CreateQuestionParams): Promise<Question> {
    const id = 'qst_' + nanoid(8);
    const now = new Date().toISOString();
    const question: Question = {
      id,
      title: params.title,
      createdAt: now,
      state: 'open',
      priority: params.priority,
      requirementId: params.requirementId,
      taskId: params.taskId,
      context: params.context,
      recommendations: params.recommendations,
      customAnswerPlaceholder: params.customAnswerPlaceholder,
    };
    await this.appendEvent('QUESTION_CREATED', id, { question });
    this.sendNativeNotification(params.title, id);
    return this.state.questions[id]!;
  }

  async answer(id: string, answer: QuestionAnswer): Promise<Question> {
    const question = this.getOrThrow(id);
    assertQuestionTransition(question.state, 'answered');
    if (answer.kind === 'accepted-recommendation' && answer.recommendationId) {
      const rec = question.recommendations.find((r) => r.id === answer.recommendationId);
      if (!rec) throw new Error(`Recommendation not found: ${answer.recommendationId}`);
    }
    await this.appendEvent('QUESTION_ANSWERED', id, { answer });
    const answered = this.state.questions[id]!;
    this.pendingDrain.push({ question: answered });
    return answered;
  }

  async cancel(id: string): Promise<Question> {
    const question = this.getOrThrow(id);
    assertQuestionTransition(question.state, 'cancelled');
    await this.appendEvent('QUESTION_CANCELLED', id);
    return this.state.questions[id]!;
  }

  list(state?: QuestionState): Question[] {
    const all = Object.values(this.state.questions);
    if (!state) return all;
    return all.filter((q) => q.state === state);
  }

  get(id: string): Question | undefined {
    return this.state.questions[id];
  }

  drain(): QuestionDrainResult {
    const answeredQuestions = [...this.pendingDrain];
    this.pendingDrain = [];
    return { answeredQuestions };
  }

  openCount(): number {
    return this.list('open').length;
  }

  // Seed from external record
  async seedFromRecord(
    record: Omit<Question, 'id' | 'createdAt'> & { createdAt?: string },
  ): Promise<Question> {
    const id = 'qst_' + nanoid(8);
    const now = record.createdAt ?? new Date().toISOString();
    const question: Question = { ...record, id, createdAt: now };
    await this.appendEvent('QUESTION_CREATED', id, { question });
    if (record.state === 'answered' && record.answer) {
      await this.appendEvent('QUESTION_ANSWERED', id, { answer: record.answer });
    } else if (record.state === 'cancelled') {
      await this.appendEvent('QUESTION_CANCELLED', id);
    }
    return this.state.questions[id]!;
  }

  // ─── Internal helpers ──────────────────────────────────────────────────────

  private sendNativeNotification(title: string, id: string): void {
    try {
      const safeTitle = title.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      execSync(
        `osascript -e 'display notification "${safeTitle}" with title "PokerZeno Conductor" subtitle "Question for you"'`,
        { timeout: 3000, stdio: 'ignore' },
      );
    } catch {
      // best-effort
    }
  }

  private getOrThrow(id: string): Question {
    const question = this.state.questions[id];
    if (!question) throw new Error(`Question not found: ${id}`);
    return question;
  }
}
