import { useState } from 'react';
import type { FormEvent } from 'react';
import { useStore } from '../store';
import { buildContext } from './buildContext';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface ChatPanelProps {
  open: boolean;
  page: string;
  pageLabel: string;
  onClose: () => void;
}

const PAGE_SUGGESTIONS: Record<string, string[]> = {
  '/input': ['How does this expression parse?', 'What does this truth table represent?'],
  '/truth-table': ['How do I read these rows?', 'Which rows are minterms?'],
  '/kmap': ['Why is this group valid?', 'Why was this cell not grouped?'],
  '/circuit': ['How does this gate network implement the function?', 'What does the NAND-only version change?'],
  '/sequential': ['How is the next-state equation derived?', 'What is the difference between Moore and Mealy?'],
  '/timing': ['What does this timing diagram show?', 'How can I identify a hazard here?'],
  '/cost-power': ['How was this IC mapping selected?', 'Which values are still estimates?'],
  '/faults': ['How does this test vector detect the selected fault?', 'What does an undetectable fault mean?'],
};

export function ChatPanel({ open, page, pageLabel, onClose }: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [mode, setMode] = useState<'explain' | 'hint'>('explain');
  const [busy, setBusy] = useState(false);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState('');
  const contextLength = useStore((state) => {
    if (!open) return 0;
    return JSON.stringify(buildContext(state, page)).length;
  });
  const suggestions = PAGE_SUGGESTIONS[page] ?? ['Explain the main idea on this page.', 'What should I try next?'];

  async function sendMessage(content: string, requestedMode = mode) {
    const text = content.trim();
    if (!text || busy) return;
    const userMessage: ChatMessage = { role: 'user', content: text };
    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setDraft('');
    setBusy(true);
    setOffline(false);
    setError('');
    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          messages: nextMessages.slice(-20),
          context: buildContext(useStore.getState(), page),
          mode: requestedMode,
        }),
      });
      const payload: unknown = await response.json();
      if (response.status === 503 && typeof payload === 'object' && payload !== null &&
        'error' in payload && payload.error === 'assistant_unavailable') {
        setOffline(true);
        setMessages((current) => [...current, {
          role: 'assistant',
          content: 'The study assistant is offline right now. The rest of Aletheia is still available; try again when the assistant server is running.',
        }]);
        return;
      }
      if (!response.ok || typeof payload !== 'object' || payload === null ||
        !('message' in payload) || typeof payload.message !== 'string') {
        const code = typeof payload === 'object' && payload !== null && 'error' in payload &&
          typeof payload.error === 'string' ? payload.error : 'request_failed';
        throw new Error(code === 'rate_limited'
          ? 'The assistant is receiving too many requests. Please wait a moment and retry.'
          : 'The assistant could not process that request. Please retry.');
      }
      const assistantMessage = payload.message;
      setMessages((current) => [...current, { role: 'assistant', content: assistantMessage }]);
    } catch (caught) {
      if (caught instanceof TypeError) {
        setOffline(true);
        setMessages((current) => [...current, {
          role: 'assistant',
          content: 'The study assistant is offline right now. The rest of Aletheia is still available; try again when the assistant server is running.',
        }]);
      } else {
        setError(caught instanceof Error ? caught.message : 'The assistant could not process that request.');
      }
    } finally {
      setBusy(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void sendMessage(draft);
  }

  function explainPage() {
    void sendMessage(`Explain this ${pageLabel} page using the current design results.`, 'explain');
  }

  function giveHint() {
    setMode('hint');
    void sendMessage(`Give me a hint about the current ${pageLabel} page.`, 'hint');
  }

  return (
    <aside className={`app-chat-panel ${open ? 'open' : 'closed'}`} aria-label="AI Study Assistant" aria-hidden={!open} inert={!open}>
      <div className="chat-header">
        <div className="chat-title"><span>🤖</span> AI Study Assistant</div>
        <button className="chat-close" onClick={onClose} aria-label="Close AI Study Assistant">✕</button>
      </div>
      <div className="chat-content">
        <div className="chat-intro">
          <p><strong>Logic Design Study Assistant</strong></p>
          <p className="chat-desc">Ask about digital logic in the current design. Engine results are included as context.</p>
        </div>
        <div className="chat-placeholder-box">
          <span className="icon">💡</span>
          <span>Context: <em>{pageLabel}</em> · {contextLength} / 2000 chars</span>
        </div>
        <div className="chat-mode" role="group" aria-label="Assistant mode">
          <button type="button" aria-pressed={mode === 'explain'} onClick={() => setMode('explain')}>Explain</button>
          <button type="button" aria-pressed={mode === 'hint'} onClick={() => setMode('hint')}>Hint</button>
        </div>
        <div className="chat-page-actions">
          <button type="button" onClick={explainPage} disabled={busy}>Explain this page</button>
          <button type="button" onClick={giveHint} disabled={busy}>Give me a hint</button>
        </div>
        <div className="suggested-prompts">
          <span className="prompt-label">Suggested questions</span>
          {suggestions.map((suggestion) => (
            <button key={suggestion} className="prompt-chip" type="button" disabled={busy}
              onClick={() => void sendMessage(suggestion)}>{suggestion}</button>
          ))}
        </div>
        <div className="chat-messages" aria-live="polite" aria-label="Conversation">
          {messages.length === 0 && <p className="chat-empty">Start with a page explanation or ask a question.</p>}
          {messages.map((message, index) => (
            <article className={`chat-message ${message.role}`} key={`${index}-${message.role}`}>
              <span className="chat-message-role">{message.role === 'user' ? 'You' : 'Tutor'}</span>
              <p>{message.content}</p>
              {message.role === 'assistant' && <small>AI explanation — verify with the tool's results.</small>}
            </article>
          ))}
          {busy && <p className="chat-status" role="status">Thinking…</p>}
          {offline && <p className="chat-offline" role="status">Assistant unavailable · local circuit tools remain active.</p>}
          {error && <p className="chat-error" role="alert">{error}</p>}
        </div>
      </div>
      <form className="chat-footer" onSubmit={submit}>
        <input
          type="text"
          placeholder="Ask a question about this design..."
          className="chat-input"
          aria-label="Question for the AI study assistant"
          value={draft}
          maxLength={4_000}
          onChange={(event) => setDraft(event.target.value)}
          disabled={busy}
        />
        <button className="chat-send" type="submit" disabled={busy || !draft.trim()}>Send</button>
      </form>
    </aside>
  );
}
