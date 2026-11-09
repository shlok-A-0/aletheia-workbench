import type { DesignContext } from '../../src/engine/types';
import type { AssistantMode } from '../prompt';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface LLMRequest {
  apiKey: string;
  model: string;
  systemPrompt: string;
  messages: ChatMessage[];
  context: DesignContext;
  mode: AssistantMode;
}

export interface LLMAdapter {
  generate(request: LLMRequest): Promise<string>;
}

interface GeminiResponse {
  candidates?: {
    content?: { parts?: { text?: string }[] };
  }[];
}

export const geminiAdapter: LLMAdapter = {
  async generate({ apiKey, model, systemPrompt, messages }): Promise<string> {
    const endpoint = new URL(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`
    );
    endpoint.searchParams.set('key', apiKey);
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: AbortSignal.timeout(30_000),
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: messages.map((message) => ({
          role: message.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: message.content }],
        })),
        generationConfig: { temperature: 0.3, maxOutputTokens: 700 },
      }),
    });
    if (!response.ok) {
      throw new Error(`LLM provider returned HTTP ${response.status}.`);
    }
    const result = await response.json() as GeminiResponse;
    const answer = result.candidates?.[0]?.content?.parts
      ?.map((part) => part.text ?? '')
      .join('')
      .trim();
    if (!answer) throw new Error('LLM provider returned no answer.');
    return answer;
  },
};
