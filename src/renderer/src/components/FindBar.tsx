import { ChevronDown, ChevronUp, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { FindResult } from '../../../shared/ipc.js';
import { bridge } from './common.js';

/** Find in page (Ctrl+F). Enter / Shift+Enter step through matches, Esc closes. */
export function FindBar({ result, focusToken, onClose }: { result: FindResult | null; focusToken: number; onClose: () => void }) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [text, setText] = useState('');

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [focusToken]);

  useEffect(() => {
    void bridge?.find(text, { forward: true, findNext: false });
  }, [text]);

  const step = (forward: boolean) => {
    if (text) void bridge?.find(text, { forward, findNext: true });
  };

  const close = () => {
    void bridge?.stopFind();
    onClose();
  };

  const count = !text ? '' : result && result.matches > 0 ? `${result.activeMatch} of ${result.matches}` : result ? 'No results' : '';

  return (
    <div className="find-bar">
      <div className="find-box" role="search">
        <input
          ref={inputRef}
          aria-label="Find in page"
          placeholder="Find in page"
          value={text}
          spellCheck={false}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              step(!event.shiftKey);
            } else if (event.key === 'Escape') {
              event.preventDefault();
              close();
            }
          }}
        />
        <span className={count === 'No results' ? 'find-count none' : 'find-count'} aria-live="polite">
          {count}
        </span>
        <button type="button" className="tool-button" aria-label="Previous match" title="Previous (Shift+Enter)" onClick={() => step(false)} disabled={!result?.matches}>
          <ChevronUp size={16} />
        </button>
        <button type="button" className="tool-button" aria-label="Next match" title="Next (Enter)" onClick={() => step(true)} disabled={!result?.matches}>
          <ChevronDown size={16} />
        </button>
        <button type="button" className="tool-button" aria-label="Close find bar" title="Close (Esc)" onClick={close}>
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
