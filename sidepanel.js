// ════════════════════════════════════════════════════════
//  SIDEPANEL CONTROLLER — Dual Mode (Smart + AI)
// ════════════════════════════════════════════════════════

// ── Element refs ─────────────────────────────────────────
const grabBtn        = document.getElementById('grabBtn');
const clearBtn       = document.getElementById('clearBtn');
const sendBtn        = document.getElementById('sendBtn');
const pasteInput     = document.getElementById('pasteInput');
const welcomeCard    = document.getElementById('welcomeCard');
const processingCard = document.getElementById('processingCard');
const resultArea     = document.getElementById('resultArea');
const procLabel      = document.getElementById('procLabel');
const procFill       = document.getElementById('procFill');
const procIcon       = document.getElementById('procIcon');
const procTitle      = document.getElementById('procTitle');
const platformBadge  = document.getElementById('platformBadge');
const settingsBtn    = document.getElementById('settingsBtn');
const settingsDrawer = document.getElementById('settingsDrawer');
const openaiKeyInput = document.getElementById('openaiKeyInput');
const groqKeyInput   = document.getElementById('groqKeyInput');
const geminiKeyInput = document.getElementById('geminiKeyInput');
const saveKeysBtn    = document.getElementById('saveKeysBtn');
const keyStatus      = document.getElementById('keyStatus');
const modelSelect    = document.getElementById('modelSelect');
const modeSmartBtn   = document.getElementById('modeSmartBtn');
const modeAiBtn      = document.getElementById('modeAiBtn');
const mainAnalyze    = document.getElementById('mainAnalyze');
const mainHistory    = document.getElementById('mainHistory');
const historyList    = document.getElementById('historyList');
const toast          = document.getElementById('toast');
const tabAnalyze     = document.getElementById('tabAnalyze');
const tabHistory     = document.getElementById('tabHistory');

let busy    = false;
let aiMode  = false;
let lastRawText = '';

// ════════════════════════════════════════════════════════
//  INIT — load saved settings
// ════════════════════════════════════════════════════════
chrome.storage.local.get(['openaiKey', 'groqKey', 'geminiKey', 'selectedModel', 'aiMode'], (data) => {
  if (data.openaiKey) openaiKeyInput.value = data.openaiKey;
  if (data.groqKey)   groqKeyInput.value   = data.groqKey;
  if (data.geminiKey) geminiKeyInput.value = data.geminiKey;
  if (data.selectedModel) modelSelect.value = data.selectedModel;
  if (data.aiMode) setMode('ai');
  // Purge any previously stored incident history for compliance
  chrome.storage.local.remove('history');
});

// ════════════════════════════════════════════════════════
//  MODE TOGGLE
// ════════════════════════════════════════════════════════
modeSmartBtn.addEventListener('click', () => setMode('smart'));
modeAiBtn.addEventListener('click', () => setMode('ai'));

function setMode(mode) {
  aiMode = mode === 'ai';
  modeSmartBtn.classList.toggle('active-smart', !aiMode);
  modeSmartBtn.classList.remove('active-ai');
  modeAiBtn.classList.toggle('active-ai', aiMode);
  modeAiBtn.classList.remove('active-smart');

  modelSelect.classList.toggle('visible', aiMode);
  grabBtn.classList.toggle('ai-mode', aiMode);
  sendBtn.classList.toggle('ai-mode', aiMode);
  pasteInput.classList.toggle('ai-focused', aiMode);

  chrome.storage.local.set({ aiMode });
}

// ════════════════════════════════════════════════════════
//  SETTINGS
// ════════════════════════════════════════════════════════
settingsBtn.addEventListener('click', () => {
  settingsDrawer.classList.toggle('open');
});

saveKeysBtn.addEventListener('click', () => {
  const openaiKey = openaiKeyInput.value.trim();
  const groqKey   = groqKeyInput.value.trim();
  const geminiKey = geminiKeyInput.value.trim();
  const selectedModel = modelSelect.value;
  chrome.storage.local.set({ openaiKey, groqKey, geminiKey, selectedModel }, () => {
    keyStatus.classList.add('visible');
    setTimeout(() => keyStatus.classList.remove('visible'), 2000);
  });
});

modelSelect.addEventListener('change', () => {
  chrome.storage.local.set({ selectedModel: modelSelect.value });
});

// ════════════════════════════════════════════════════════
//  TAB SWITCHING (Analyze only — History removed)
// ════════════════════════════════════════════════════════
tabAnalyze.addEventListener('click', () => switchTab('analyze'));

function switchTab(tab) {
  tabAnalyze.classList.add('active');
  mainAnalyze.classList.remove('hidden');
}

// ════════════════════════════════════════════════════════
//  GRAB FROM PAGE
// ════════════════════════════════════════════════════════
grabBtn.addEventListener('click', () => {
  if (busy) return;
  grabBtn.disabled = true;
  grabBtn.textContent = '⏳ Reading page…';

  chrome.runtime.sendMessage({ action: 'getPageText' }, (res) => {
    grabBtn.disabled = false;
    grabBtn.innerHTML = aiMode ? '🤖 Grab from Page' : '📋 Grab from Page';

    if (res?.error || !res?.text?.trim()) {
      showError('Could not read this page. Try pasting the description below.', res?.error);
      return;
    }

    // Show platform badge
    if (res.platform && res.platform !== 'unknown') {
      platformBadge.textContent = res.platform;
      platformBadge.style.display = 'inline';
    }

    processText(res.text.trim());
  });
});

// ════════════════════════════════════════════════════════
//  MANUAL PASTE
// ════════════════════════════════════════════════════════
sendBtn.addEventListener('click', handleSend);
pasteInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
});

function handleSend() {
  const text = pasteInput.value.trim();
  if (!text || busy) return;
  pasteInput.value = '';
  platformBadge.style.display = 'none';
  processText(text);
}

// ════════════════════════════════════════════════════════
//  CLEAR
// ════════════════════════════════════════════════════════
clearBtn.addEventListener('click', () => {
  resultArea.innerHTML = '';
  welcomeCard.classList.remove('hidden');
  processingCard.style.display = 'none';
  platformBadge.style.display = 'none';
  lastRawText = '';
  busy = false;
});

// ════════════════════════════════════════════════════════
//  PROCESS TEXT — routes to Smart or AI mode
// ════════════════════════════════════════════════════════
async function processText(text) {
  busy = true;
  lastRawText = text;

  welcomeCard.classList.add('hidden');
  resultArea.innerHTML = '';
  processingCard.style.display = 'block';

  // Update UI for mode
  procFill.className = `proc-fill ${aiMode ? 'ai' : 'smart'}`;
  procIcon.textContent = aiMode ? '🤖' : '⚙️';
  procTitle.textContent = aiMode ? 'Asking AI…' : 'Analyzing incident…';

  if (aiMode) {
    // ── AI MODE ──────────────────────────────────────────
    const steps = ['Connecting to AI…', 'Sending prompt…', 'Waiting for response…', 'Processing…'];
    let si = 0;
    const labelInterval = setInterval(() => {
      procLabel.textContent = steps[Math.min(si++, steps.length - 1)];
    }, 800);

    try {
      const stored = await new Promise(r => chrome.storage.local.get(['openaiKey', 'groqKey', 'geminiKey', 'selectedModel'], r));
      const [provider, model] = (stored.selectedModel || 'openai:gpt-4o').split(':');
      const apiKey = provider === 'openai' ? stored.openaiKey
                   : provider === 'groq'   ? stored.groqKey
                   : stored.geminiKey;

      if (!apiKey) {
        clearInterval(labelInterval);
        processingCard.style.display = 'none';
        busy = false;
        showError('No API key found. Click ⚙ to add your API key.', 'Missing key for ' + provider);
        return;
      }

      // Show initial streaming skeleton
      clearInterval(labelInterval);
      processingCard.style.display = 'none';
      busy = false;

      renderStreamingPlaceholder(provider, model);

      const result = await LLM.analyze({
        provider,
        apiKey,
        model,
        incidentText: text,
        onChunk: null, // full JSON response only — streaming JSON is tricky to parse incrementally
      });

      renderAiResult(result, provider, model);

    } catch (err) {
      processingCard.style.display = 'none';
      busy = false;
      showError(`AI error: ${err.message}`, err.message);
    }

  } else {
    // ── SMART MODE ───────────────────────────────────────
    const steps = ['Reading description…', 'Scoring sentences…', 'Detecting severity…', 'Extracting signals…', 'Building summary…'];
    let i = 0;
    const interval = setInterval(() => {
      procLabel.textContent = steps[Math.min(i++, steps.length - 1)];
    }, 100);

    setTimeout(() => {
      clearInterval(interval);
      processingCard.style.display = 'none';
      busy = false;

      const result = IncidentEngine.analyze(text);
      if (!result) {
        showError('Text too short. Paste a longer incident description (at least a sentence or two).');
        return;
      }
      renderSmartResult(result);
    }, 350);
  }
}

// ════════════════════════════════════════════════════════
//  RENDER — Smart Mode
// ════════════════════════════════════════════════════════
function renderSmartResult(r) {
  const sev = r.severity;
  const html = `
    <div class="result-card">
      <div class="card-header">
        <div class="card-title-group">
          <span class="card-title">Smart Analysis</span>
        </div>
        <div style="display:flex;align-items:center;gap:6px;">
          <div class="chips">${r.categories.map(c => `<span class="chip chip-cat">${escHtml(c)}</span>`).join('')}</div>
          <button class="copy-btn" onclick="copyResult(this)">⎘ Copy</button>
        </div>
      </div>

      <div class="card-body">
        ${renderSeverityBanner(sev)}

        <div class="stats-row">
          <div class="stat-box">
            <div class="stat-val">${r.summaryLength}</div>
            <div class="stat-key">key sentences</div>
          </div>
          <div class="stat-box">
            <div class="stat-val">${r.readTime}m</div>
            <div class="stat-key">read time</div>
          </div>
          <div class="stat-box">
            <div class="stat-val">${r.actions.length}</div>
            <div class="stat-key">actions</div>
          </div>
        </div>

        <div class="section">
          <div class="section-label">📌 What Happened</div>
          <div class="what-happened">
            ${r.whatHappened.map(s => `<div class="sentence">${escHtml(s)}</div>`).join('')}
          </div>
        </div>

        <div class="section">
          <div class="section-label">👥 Who / What Affected</div>
          <div class="affected-text">${escHtml(r.affected)}</div>
        </div>

        ${renderRootCause(r.rootCause)}

        ${renderExtracted(r.extracted)}

        ${r.timeline ? `
        <div class="section">
          <div class="section-label">🕐 Timestamps</div>
          <div class="chips">${r.timeline.map(t => `<span class="chip chip-time">${escHtml(t)}</span>`).join('')}</div>
        </div>` : ''}

        <div class="section">
          <div class="section-label">💡 Recommended Solution</div>
          <div class="solution-list">
            ${r.solution.map((s, i) => `
              <div class="solution-item">
                <span class="sol-num">${String(i+1).padStart(2,'0')}</span>
                <span>${escHtml(s)}</span>
              </div>`).join('')}
          </div>
        </div>

        <div class="section">
          <div class="section-label">✅ Immediate Actions</div>
          <div class="actions-list">
            ${r.actions.map((a, i) => `
              <div class="action-item">
                <span class="action-num">${String(i+1).padStart(2,'0')}</span>
                <span>${escHtml(a)}</span>
              </div>`).join('')}
          </div>
        </div>
      </div>
    </div>
  `;
  resultArea.innerHTML = html;
}

// ════════════════════════════════════════════════════════
//  RENDER — AI Streaming Placeholder
// ════════════════════════════════════════════════════════
function renderStreamingPlaceholder(provider, model) {
  resultArea.innerHTML = `
    <div class="result-card ai-mode" id="aiResultCard">
      <div class="card-header">
        <div class="card-title-group">
          <span class="card-title">AI Analysis</span>
          <span class="ai-badge">${escHtml(provider)} · ${escHtml(model)}</span>
        </div>
      </div>
      <div class="card-body" style="text-align:center;padding:20px;">
        <div style="font-size:22px;margin-bottom:8px;">🤖</div>
        <div style="font-size:12px;font-weight:600;margin-bottom:4px;color:var(--c-ai);">AI is thinking<span class="streaming-cursor"></span></div>
        <div style="font-size:10px;color:var(--muted);">Generating detailed incident analysis…</div>
      </div>
    </div>`;
}

// ════════════════════════════════════════════════════════
//  RENDER — AI Mode (full result)
// ════════════════════════════════════════════════════════
function renderAiResult(r, provider, model) {
  const sevColor = r.severityColor || getSevColor(r.severity);
  const sev = { color: sevColor, label: r.severity, hits: [] };

  const html = `
    <div class="result-card ai-mode">
      <div class="card-header">
        <div class="card-title-group">
          <span class="card-title">AI Analysis</span>
          <span class="ai-badge">${escHtml(provider)} · ${escHtml(model)}</span>
        </div>
        <button class="copy-btn" onclick="copyResult(this)">⎘ Copy</button>
      </div>

      <div class="card-body">
        ${renderSeverityBanner(sev, r.severityReason)}

        ${r.categories?.length ? `
        <div class="section">
          <div class="section-label">🏷 Categories</div>
          <div class="chips">${r.categories.map(c => `<span class="chip chip-cat">${escHtml(c)}</span>`).join('')}</div>
        </div>` : ''}

        ${r.whatHappened?.length ? `
        <div class="section">
          <div class="section-label">📌 What Happened</div>
          <div class="what-happened">
            ${r.whatHappened.map(s => `<div class="sentence">${escHtml(s)}</div>`).join('')}
          </div>
        </div>` : ''}

        ${r.affected ? `
        <div class="section">
          <div class="section-label">👥 Who / What Affected</div>
          <div class="affected-text">${escHtml(r.affected)}</div>
        </div>` : ''}

        ${r.rootCause?.length ? renderRootCause(r.rootCause) : ''}

        ${(r.errorCodes?.length || r.timestamps?.length) ? `
        <div class="section">
          <div class="section-label">🔍 Extracted Signals</div>
          <div class="chips">
            ${(r.errorCodes || []).map(e => `<span class="chip chip-error">${escHtml(e)}</span>`).join('')}
            ${(r.timestamps || []).map(t => `<span class="chip chip-time">${escHtml(t)}</span>`).join('')}
          </div>
        </div>` : ''}

        ${r.solution?.length ? `
        <div class="section">
          <div class="section-label">💡 Recommended Solution</div>
          <div class="solution-list">
            ${r.solution.map((s, i) => `
              <div class="solution-item">
                <span class="sol-num">${String(i+1).padStart(2,'0')}</span>
                <span>${escHtml(s)}</span>
              </div>`).join('')}
          </div>
        </div>` : ''}

        ${r.immediateActions?.length ? `
        <div class="section">
          <div class="section-label">✅ Immediate Actions</div>
          <div class="actions-list">
            ${r.immediateActions.map((a, i) => `
              <div class="action-item">
                <span class="action-num">${String(i+1).padStart(2,'0')}</span>
                <span>${escHtml(a)}</span>
              </div>`).join('')}
          </div>
        </div>` : ''}

        ${r.postMortemQuestions?.length ? `
        <div class="section">
          <div class="section-label">📝 Post-Mortem Questions</div>
          <div class="postmortem-list">
            ${r.postMortemQuestions.map(q => `
              <div class="postmortem-item">
                <span class="pm-bullet">?</span>
                <span>${escHtml(q)}</span>
              </div>`).join('')}
          </div>
        </div>` : ''}

      </div>
    </div>`;

  resultArea.innerHTML = html;
}

// ════════════════════════════════════════════════════════
//  SHARED RENDER HELPERS
// ════════════════════════════════════════════════════════
function renderSeverityBanner(sev, reason) {
  return `
    <div class="severity-banner" style="background:${sev.color}0d;border-color:${sev.color}30;">
      <div class="sev-dot" style="background:${sev.color};box-shadow:0 0 8px ${sev.color};"></div>
      <div>
        <span class="sev-label" style="color:${sev.color}">${escHtml(sev.label)}</span>
        ${reason ? `<div class="sev-reason">${escHtml(reason)}</div>` : ''}
      </div>
      <span class="sev-desc">${getSevDesc(sev.label)}</span>
    </div>`;
}

function renderRootCause(causes) {
  if (!causes?.length) return '';
  return `
    <div class="section">
      <div class="section-label">🔎 Probable Root Cause</div>
      <div class="root-cause-list">
        ${causes.map(c => `
          <div class="root-cause-item">
            <span class="cause-icon">→</span>
            <span>${escHtml(c)}</span>
          </div>`).join('')}
      </div>
    </div>`;
}

function renderExtracted(ex) {
  const sections = [];
  if (ex.errorCodes?.length) {
    sections.push(`
      <div class="section">
        <div class="section-label">🔴 Error Codes</div>
        <div class="chips">${ex.errorCodes.map(e => `<span class="chip chip-error">${escHtml(e)}</span>`).join('')}</div>
      </div>`);
  }
  if (ex.ips?.length) {
    sections.push(`
      <div class="section">
        <div class="section-label">🌐 IP Addresses</div>
        <div class="chips">${ex.ips.map(ip => `<span class="chip chip-ip">${escHtml(ip)}</span>`).join('')}</div>
      </div>`);
  }
  if (ex.services?.length) {
    sections.push(`
      <div class="section">
        <div class="section-label">⚙️ Services Mentioned</div>
        <div class="chips">${ex.services.map(s => `<span class="chip chip-svc">${escHtml(s)}</span>`).join('')}</div>
      </div>`);
  }
  if (ex.userCounts?.length || ex.percentages?.length) {
    const all = [...(ex.userCounts || []), ...(ex.percentages || [])];
    sections.push(`
      <div class="section">
        <div class="section-label">📊 Numbers & Impact</div>
        <div class="chips">${all.map(n => `<span class="chip chip-num">${escHtml(n)}</span>`).join('')}</div>
      </div>`);
  }
  if (ex.urls?.length) {
    sections.push(`
      <div class="section">
        <div class="section-label">🔗 URLs Found</div>
        <div class="chips">${ex.urls.map(u => `<span class="chip chip-url" title="${escHtml(u)}">${escHtml(u.replace(/^https?:\/\//, '').slice(0, 30))}…</span>`).join('')}</div>
      </div>`);
  }
  if (ex.versions?.length) {
    sections.push(`
      <div class="section">
        <div class="section-label">🏷 Versions</div>
        <div class="chips">${ex.versions.map(v => `<span class="chip chip-ver">${escHtml(v)}</span>`).join('')}</div>
      </div>`);
  }
  return sections.join('');
}

// ════════════════════════════════════════════════════════
//  COPY TO CLIPBOARD
// ════════════════════════════════════════════════════════
window.copyResult = function(btn) {
  const card = btn.closest('.result-card');
  const lines = [];

  // Build plain-text copy from result
  card.querySelectorAll('.sev-label').forEach(el => lines.push(`SEVERITY: ${el.textContent.trim()}`));
  card.querySelectorAll('.section-label').forEach(label => {
    lines.push(`\n${label.textContent.replace(/[^\w\s/]/g, '').trim().toUpperCase()}`);
    const parent = label.parentElement;
    parent.querySelectorAll('.sentence,.affected-text,.root-cause-item,.solution-item,.action-item,.postmortem-item').forEach(el => {
      const num = el.querySelector('.sol-num, .action-num')?.textContent || '';
      const txt = el.textContent.replace(num, '').trim();
      lines.push(num ? `  ${num}. ${txt}` : `  • ${txt}`);
    });
    parent.querySelectorAll('.chip').forEach(chip => {
      lines.push(`  [${chip.textContent.trim()}]`);
    });
  });

  navigator.clipboard.writeText(lines.join('\n')).then(() => {
    btn.textContent = '✓ Copied';
    btn.classList.add('copied');
    showToast('✓ Copied to clipboard');
    setTimeout(() => {
      btn.innerHTML = '⎘ Copy';
      btn.classList.remove('copied');
    }, 2000);
  });
};



// ════════════════════════════════════════════════════════
//  TOAST
// ════════════════════════════════════════════════════════
function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2200);
}

// ════════════════════════════════════════════════════════
//  ERROR STATE
// ════════════════════════════════════════════════════════
function showError(msg, detail) {
  welcomeCard.classList.add('hidden');
  resultArea.innerHTML = `
    <div class="result-card">
      <div class="card-body" style="text-align:center;padding:22px;">
        <div style="font-size:22px;margin-bottom:8px;">⚠️</div>
        <div style="font-size:12px;font-weight:600;margin-bottom:6px;color:var(--text);">${escHtml(msg)}</div>
        ${detail ? `<div style="font-size:10px;color:var(--muted);font-family:var(--mono);">${escHtml(detail)}</div>` : ''}
      </div>
    </div>`;
}

// ════════════════════════════════════════════════════════
//  UTILITY
// ════════════════════════════════════════════════════════
function getSevDesc(label) {
  return { CRITICAL: 'Immediate action', HIGH: 'Urgent attention', MEDIUM: 'Monitor closely', LOW: 'Normal priority' }[label] || '';
}

function getSevColor(label) {
  return { CRITICAL: '#ff4d4d', HIGH: '#f59e0b', MEDIUM: '#facc15', LOW: '#22c55e' }[label] || '#566373';
}

function escHtml(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
