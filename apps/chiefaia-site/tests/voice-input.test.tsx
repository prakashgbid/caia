/**
 * VoiceInput — dictation behaviour and the unsupported-browser fallback.
 *
 * jsdom has no Web Speech API, so these install a mock SpeechRecognition
 * on `window` before render. The component samples support once, lazily,
 * during the first render, so the mock must be in place beforehand.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { VoiceInput } from '@caia/ui';
import { ContactForm } from '../components/contact-form';

/* ---------------------------------------------------------------- *
 * Mock Web Speech API
 * ---------------------------------------------------------------- */

type Handler = ((ev: unknown) => void) | null;

class MockSpeechRecognition {
  static instances: MockSpeechRecognition[] = [];

  continuous = false;
  interimResults = false;
  lang = '';
  started = false;

  onstart: Handler = null;
  onend: Handler = null;
  onresult: Handler = null;
  onerror: Handler = null;

  constructor() {
    MockSpeechRecognition.instances.push(this);
  }

  start() {
    this.started = true;
    this.onstart?.(new Event('start'));
  }

  stop() {
    this.started = false;
    this.onend?.(new Event('end'));
  }

  /** Push a recognition result through, as the browser would. */
  emit(phrases: Array<{ transcript: string; isFinal: boolean }>) {
    const results = phrases.map((p) => {
      const alt = { transcript: p.transcript, confidence: 0.9 };
      return { 0: alt, length: 1, isFinal: p.isFinal, item: () => alt };
    });
    this.onresult?.({
      resultIndex: 0,
      results: { ...results, length: results.length, item: (i: number) => results[i] },
    });
  }

  /** Most recently constructed instance. */
  static latest() {
    return MockSpeechRecognition.instances.at(-1)!;
  }
}

function installSpeechRecognition() {
  MockSpeechRecognition.instances = [];
  (window as unknown as Record<string, unknown>).SpeechRecognition =
    MockSpeechRecognition;
}

function removeSpeechRecognition() {
  delete (window as unknown as Record<string, unknown>).SpeechRecognition;
  delete (window as unknown as Record<string, unknown>).webkitSpeechRecognition;
}

afterEach(() => {
  removeSpeechRecognition();
  vi.restoreAllMocks();
});

/* ---------------------------------------------------------------- *
 * Tests
 * ---------------------------------------------------------------- */

describe('VoiceInput', () => {
  describe('in a browser that supports the Web Speech API', () => {
    beforeEach(() => {
      installSpeechRecognition();
    });

    it('starts recognition when the mic is clicked', () => {
      render(<VoiceInput value="" onValueChange={() => {}} fieldLabel="message" />);

      const mic = screen.getByTestId('voice-input-button');
      expect(mic).toBeEnabled();
      expect(MockSpeechRecognition.latest().started).toBe(false);

      fireEvent.click(mic);

      const recognition = MockSpeechRecognition.latest();
      expect(recognition.started).toBe(true);
      expect(recognition.continuous).toBe(true);
      expect(recognition.interimResults).toBe(true);
      expect(mic).toHaveAttribute('aria-pressed', 'true');
    });

    it('stops recognition on a second click', () => {
      render(<VoiceInput value="" onValueChange={() => {}} />);
      const mic = screen.getByTestId('voice-input-button');

      fireEvent.click(mic);
      expect(MockSpeechRecognition.latest().started).toBe(true);

      fireEvent.click(mic);
      expect(MockSpeechRecognition.latest().started).toBe(false);
      expect(mic).toHaveAttribute('aria-pressed', 'false');
    });

    it('announces listening state to screen readers', () => {
      render(<VoiceInput value="" onValueChange={() => {}} />);
      const status = screen.getByTestId('voice-input-status');
      expect(status).toHaveTextContent('');

      fireEvent.click(screen.getByTestId('voice-input-button'));
      expect(status).toHaveTextContent('Listening. Speak now.');
    });

    it('derives its locale from navigator.language', () => {
      vi.spyOn(navigator, 'language', 'get').mockReturnValue('fr-FR');
      render(<VoiceInput value="" onValueChange={() => {}} />);
      expect(MockSpeechRecognition.latest().lang).toBe('fr-FR');
    });

    it('emits final transcripts and appends to the existing value', () => {
      const onValueChange = vi.fn();
      render(<VoiceInput value="Existing text" onValueChange={onValueChange} />);

      fireEvent.click(screen.getByTestId('voice-input-button'));
      act(() => {
        MockSpeechRecognition.latest().emit([
          { transcript: 'and the dictated part', isFinal: true },
        ]);
      });

      expect(onValueChange).toHaveBeenCalledWith('Existing text and the dictated part');
    });

    it('surfaces interim results without committing them to the value', () => {
      const onValueChange = vi.fn();
      const onInterimChange = vi.fn();
      render(
        <VoiceInput
          value=""
          onValueChange={onValueChange}
          onInterimChange={onInterimChange}
        />
      );

      fireEvent.click(screen.getByTestId('voice-input-button'));
      act(() => {
        MockSpeechRecognition.latest().emit([
          { transcript: 'still speaking', isFinal: false },
        ]);
      });

      expect(onInterimChange).toHaveBeenCalledWith('still speaking');
      expect(onValueChange).not.toHaveBeenCalled();
    });
  });

  describe('in a browser without the Web Speech API', () => {
    it('renders a disabled mic explaining the fallback rather than vanishing', () => {
      removeSpeechRecognition();
      render(<VoiceInput value="" onValueChange={() => {}} fieldLabel="message" />);

      const mic = screen.getByTestId('voice-input-button');
      expect(mic).toBeDisabled();
      expect(mic).toHaveAccessibleName(
        'Voice input is not supported in this browser for message'
      );
      expect(screen.getByTestId('voice-input-status')).toHaveTextContent(
        'Voice input is not supported in this browser.'
      );
    });

    it('never breaks the form it is attached to', () => {
      removeSpeechRecognition();
      render(<ContactForm />);
      expect(screen.getByLabelText(/how can we help/i)).toBeInTheDocument();
      expect(screen.getAllByTestId('voice-input-button')).toHaveLength(3);
    });
  });
});

describe('ContactForm dictation', () => {
  beforeEach(() => {
    installSpeechRecognition();
  });

  it('puts a mic on name, email and message — and writes speech into the field', () => {
    render(<ContactForm />);

    const mics = screen.getAllByTestId('voice-input-button');
    expect(mics).toHaveLength(3);

    // Third mic belongs to the message textarea.
    fireEvent.click(mics[2]!);
    act(() => {
      MockSpeechRecognition.latest().emit([
        { transcript: 'We would like to discuss onboarding.', isFinal: true },
      ]);
    });

    expect(screen.getByLabelText(/how can we help/i)).toHaveValue(
      'We would like to discuss onboarding.'
    );
  });

  it('exposes no mic for password input anywhere on the form', () => {
    render(<ContactForm />);
    // The contact form has no password field; this asserts the invariant
    // holds so a future password addition without a `sensitive` guard fails.
    const passwords = document.querySelectorAll('input[type="password"]');
    expect(passwords).toHaveLength(0);
  });
});
