'use client';

/**
 * <VoiceInput> — mic button that dictates into a controlled textarea/input.
 *
 * Uses the browser Web Speech API (webkitSpeechRecognition). Silently
 * hides itself if unsupported. Interim results append live; final results
 * are appended with a trailing space.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Mic, MicOff } from 'lucide-react';
import { Button } from '@caia/ui';

interface Props {
  onTranscript: (text: string) => void;
  className?: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SR = any;

export function VoiceInput({ onTranscript, className }: Props): React.JSX.Element | null {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const recogRef = useRef<SR>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!Ctor) return;
    setSupported(true);
    const r = new Ctor();
    r.continuous = true;
    r.interimResults = false;
    r.lang = navigator.language || 'en-US';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    r.onresult = (e: any) => {
      let text = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) text += e.results[i][0].transcript + ' ';
      }
      if (text) onTranscript(text.trim());
    };
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    recogRef.current = r;
    return () => { try { r.stop(); } catch {} };
  }, [onTranscript]);

  const toggle = useCallback(() => {
    const r = recogRef.current;
    if (!r) return;
    if (listening) { try { r.stop(); } catch {} setListening(false); }
    else { try { r.start(); setListening(true); } catch { setListening(false); } }
  }, [listening]);

  if (!supported) return null;

  return (
    <Button
      type="button"
      variant={listening ? 'default' : 'outline'}
      size="sm"
      onClick={toggle}
      className={`gap-2 ${listening ? 'bg-red-500 hover:bg-red-500/90 text-white' : ''} ${className || ''}`}
      aria-label={listening ? 'Stop dictation' : 'Start dictation'}
    >
      {listening ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
      {listening ? 'Listening…' : 'Speak'}
    </Button>
  );
}
