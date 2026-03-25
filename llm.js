// ════════════════════════════════════════════════════════
//  LLM ABSTRACTION MODULE
//  Supports: OpenAI + Groq + Google Gemini
// ════════════════════════════════════════════════════════

window.LLM = (() => {

  // ── Provider config ───────────────────────────────────
  const PROVIDERS = {
    openai: { baseUrl: 'https://api.openai.com/v1', jsonMode: true  },
    groq:   { baseUrl: 'https://api.groq.com/openai/v1', jsonMode: false },
  };

  // ── Call OpenAI-compatible API (OpenAI + Groq) ────────
  async function callOpenAICompat(provider, apiKey, model, systemPrompt, userMessage, onChunk) {
    const cfg = PROVIDERS[provider];
    const body = {
      model: model || 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userMessage },
      ],
      temperature: 0.3,
      max_tokens: 1200,
      stream: !!onChunk,
    };
    // Only add json_object mode when the provider supports it
    if (cfg.jsonMode) body.response_format = { type: 'json_object' };

    const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `${provider} API error: ${res.status}`);
    }

    if (onChunk) {
      return streamResponse(res, onChunk);
    } else {
      const data = await res.json();
      return data.choices[0].message.content;
    }
  }

  // ── Call Gemini ───────────────────────────────────────
  async function callGemini(apiKey, model, systemPrompt, userMessage, onChunk) {
    const geminiModel = model || 'gemini-1.5-flash';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:${onChunk ? 'streamGenerateContent' : 'generateContent'}?key=${apiKey}`;

    const body = {
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: userMessage }] }],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 1200,
        responseMimeType: 'application/json',
      },
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `Gemini error: ${res.status}`);
    }

    if (onChunk) {
      return streamGeminiResponse(res, onChunk);
    } else {
      const data = await res.json();
      return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    }
  }

  // ── Stream OpenAI SSE ─────────────────────────────────
  async function streamResponse(res, onChunk) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let fullText = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const lines = decoder.decode(value).split('\n');
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') continue;
        try {
          const json = JSON.parse(data);
          const delta = json.choices?.[0]?.delta?.content || '';
          if (delta) {
            fullText += delta;
            onChunk(delta, fullText);
          }
        } catch {}
      }
    }
    return fullText;
  }

  // ── Stream Gemini NDJSON ──────────────────────────────
  async function streamGeminiResponse(res, onChunk) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let fullText = '';
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value);

      // Gemini streams JSON array fragments
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === '[' || trimmed === ']' || trimmed === ',') continue;
        try {
          const parsed = JSON.parse(trimmed.replace(/^,/, ''));
          const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text || '';
          if (text) {
            fullText += text;
            onChunk(text, fullText);
          }
        } catch {}
      }
    }
    return fullText;
  }

  // ── Parse JSON from LLM response ─────────────────────
  function parseResult(raw) {
    try {
      // Strip any markdown fences if present
      const clean = raw.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
      return JSON.parse(clean);
    } catch (e) {
      throw new Error('LLM returned invalid JSON. Please try again.');
    }
  }

  // ── Main public method ────────────────────────────────
  async function analyze({ provider, apiKey, model, incidentText, onChunk }) {
    if (!apiKey?.trim()) throw new Error('API key is required for AI mode.');
    if (!incidentText?.trim()) throw new Error('No incident text to analyze.');

    const systemPrompt = window.Prompts.system;
    const userMessage  = window.Prompts.buildUserMessage(incidentText);

    let raw;
    if (provider === 'openai' || provider === 'groq') {
      raw = await callOpenAICompat(provider, apiKey, model, systemPrompt, userMessage, onChunk);
    } else if (provider === 'gemini') {
      raw = await callGemini(apiKey, model, systemPrompt, userMessage, onChunk);
    } else {
      throw new Error(`Unknown provider: ${provider}`);
    }

    return parseResult(raw);
  }

  return { analyze };
})();
