chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getPageText') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]) return sendResponse({ error: 'No active tab' });
      chrome.scripting.executeScript(
        { target: { tabId: tabs[0].id }, func: extractPageText },
        (results) => {
          if (chrome.runtime.lastError) {
            sendResponse({ error: chrome.runtime.lastError.message });
          } else {
            sendResponse({ text: results[0]?.result?.text || '', platform: results[0]?.result?.platform || 'unknown' });
          }
        }
      );
    });
    return true;
  }
});

// ─── Injected into page ───────────────────────────────────────────────────────
function extractPageText() {

  // ── Platform-specific extraction ─────────────────────
  const hostname = location.hostname;

  // GitHub Issues / PRs
  if (hostname.includes('github.com')) {
    const body = document.querySelector('.comment-body, [data-testid="issue-body"], .js-comment-body');
    const title = document.querySelector('h1.gh-header-title bdi, h1[data-testid="issue-title"]');
    const labels = [...document.querySelectorAll('.IssueLabel, [data-testid="labels"] a')].map(el => el.textContent.trim()).join(', ');
    if (body) {
      const titleText = title ? `Title: ${title.textContent.trim()}\n` : '';
      const labelText = labels ? `Labels: ${labels}\n` : '';
      return { text: (titleText + labelText + body.innerText.trim()).slice(0, 8000), platform: 'GitHub' };
    }
  }

  // Jira
  if (hostname.includes('atlassian.net') || hostname.includes('jira.')) {
    const selectors = [
      '#description-val',
      '[data-testid="issue.views.issue-base.foundation.description.description"]',
      '[data-component-selector="issue-body-pin-field-description"]',
      '.ak-renderer-document',
      '#issue-content',
    ];
    const title = document.querySelector('h1[data-testid="issue.views.issue-base.foundation.summary.heading"], h1#summary-val, h1.issue-header-field');
    const priority = document.querySelector('[data-testid*="priority"] span, #priority-val');
    const status = document.querySelector('[data-testid*="status"] span, #status-val');

    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.innerText?.trim().length > 30) {
        const titleText = title ? `Summary: ${title.textContent.trim()}\n` : '';
        const meta = [priority && `Priority: ${priority.textContent.trim()}`, status && `Status: ${status.textContent.trim()}`].filter(Boolean).join(' | ');
        return { text: (titleText + (meta ? meta + '\n' : '') + el.innerText.trim()).slice(0, 8000), platform: 'Jira' };
      }
    }
  }

  // Linear
  if (hostname.includes('linear.app')) {
    const title = document.querySelector('h1[data-cy="issue-title"], [class*="title"]');
    const body = document.querySelector('[class*="description"] .ProseMirror, [class*="content"] [class*="editor"]');
    const priority = document.querySelector('[class*="priority"] [class*="label"]');
    if (body) {
      const titleText = title ? `Issue: ${title.textContent.trim()}\n` : '';
      const priText = priority ? `Priority: ${priority.textContent.trim()}\n` : '';
      return { text: (titleText + priText + body.innerText.trim()).slice(0, 8000), platform: 'Linear' };
    }
  }

  // ServiceNow
  if (hostname.includes('servicenow.com') || hostname.includes('service-now.com')) {
    const desc = document.querySelector('#incident_short_description, [id*="description"], textarea[id*="description"], [name="description"]');
    const workNotes = document.querySelector('[id*="work_notes"], [id*="comments"]');
    if (desc) {
      const workText = workNotes ? '\nWork Notes:\n' + workNotes.value : '';
      return { text: ((desc.value || desc.innerText || '').trim() + workText).slice(0, 8000), platform: 'ServiceNow' };
    }
  }

  // PagerDuty
  if (hostname.includes('pagerduty.com')) {
    const title = document.querySelector('h1[data-test="incident-title"], .incident-header__title');
    const body = document.querySelector('[data-test="incident-details"], .incident-body');
    if (body) {
      const titleText = title ? `Incident: ${title.textContent.trim()}\n` : '';
      return { text: (titleText + body.innerText.trim()).slice(0, 8000), platform: 'PagerDuty' };
    }
  }

  // Datadog
  if (hostname.includes('datadoghq.com')) {
    const body = document.querySelector('[class*="incident-timeline"], [class*="description"], [data-test*="description"]');
    if (body) return { text: body.innerText.trim().slice(0, 8000), platform: 'Datadog' };
  }

  // Notion
  if (hostname.includes('notion.so') || hostname.includes('notion.site')) {
    const body = document.querySelector('.notion-page-content');
    if (body) return { text: body.innerText.trim().slice(0, 8000), platform: 'Notion' };
  }

  // ── Generic smart fallback ────────────────────────────
  // Priority: semantic HTML first
  const semanticCandidates = [
    document.querySelector('article[class*="issue"], article[class*="incident"]'),
    document.querySelector('[role="main"] article'),
    document.querySelector('main article'),
    document.querySelector('main'),
    document.querySelector('article'),
    document.querySelector('[role="main"]'),
  ];
  for (const el of semanticCandidates) {
    if (!el) continue;
    const text = cleanText(el);
    if (text.length > 100) return { text: text.slice(0, 8000), platform: 'Web' };
  }

  // Named description/content areas
  const namedSelectors = [
    '[id*="description"]', '[class*="description"]',
    '[id*="incident"]', '[class*="incident"]',
    '[data-testid*="description"]', 'textarea',
    '[contenteditable="true"]',
  ];
  for (const sel of namedSelectors) {
    const els = document.querySelectorAll(sel);
    for (const el of els) {
      const text = (el.value || el.innerText || el.textContent || '').trim();
      if (text.length > 80) return { text: text.slice(0, 8000), platform: 'Web' };
    }
  }

  // Last resort: paragraph extraction (strips chrome noise)
  const paras = Array.from(document.querySelectorAll('p, li'))
    .map(el => el.innerText?.trim())
    .filter(t => t && t.length > 25)
    .join('\n');

  if (paras.length > 100) return { text: paras.slice(0, 8000), platform: 'Web' };

  return { text: cleanText(document.body).slice(0, 8000), platform: 'Web' };

  // Helper: extract text while stripping nav/header/footer/script
  function cleanText(root) {
    const clone = root.cloneNode(true);
    const strip = clone.querySelectorAll('nav, header, footer, script, style, aside, [aria-hidden="true"], [class*="sidebar"], [id*="sidebar"], [class*="nav"], [id*="nav"]');
    strip.forEach(el => el.remove());
    return (clone.innerText || clone.textContent || '').replace(/\s{3,}/g, '\n').trim();
  }
}
