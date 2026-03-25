// ════════════════════════════════════════════════════════
//  PROMPT TEMPLATES — Incident Analyzer
// ════════════════════════════════════════════════════════

window.Prompts = {

  system: `You are an expert Site Reliability Engineer (SRE) and incident responder with 10+ years of experience triaging production incidents across cloud-native, database, and distributed systems.

Your job is to analyze incident ticket descriptions and return a structured, actionable analysis that helps developers immediately understand the issue and know what to do.

IMPORTANT RULES:
- Be concise, direct, and technical
- Use developer-friendly language
- Do NOT state the obvious or repeat the input text verbatim
- Always provide specific, actionable steps
- If something is unclear, say so rather than guessing

You MUST respond with valid JSON only — no markdown fences, no extra text.`,

  buildUserMessage(incidentText) {
    return `Analyze this incident/ticket description and return a JSON object with EXACTLY this structure:

{
  "severity": "CRITICAL" | "HIGH" | "MEDIUM" | "LOW",
  "severityColor": "#ff4d4d" | "#f59e0b" | "#facc15" | "#22c55e",
  "severityReason": "One sentence explaining why this severity was chosen",
  "categories": ["Category1", "Category2"],
  "whatHappened": ["Concise sentence 1", "Sentence 2", "Sentence 3"],
  "affected": "Who/what is affected (users, services, environments)",
  "timestamps": ["extracted timestamp 1", "timestamp 2"],
  "errorCodes": ["ERR-123", "503"],
  "rootCause": ["Most likely cause sentence 1", "Possible cause 2"],
  "solution": [
    "Step 1 — most important immediate action",
    "Step 2",
    "Step 3",
    "Step 4",
    "Step 5"
  ],
  "immediateActions": [
    "Action 1 to take right now",
    "Action 2",
    "Action 3"
  ],
  "postMortemQuestions": [
    "Question to answer in post-mortem 1",
    "Question 2"
  ]
}

Severity guide:
- CRITICAL: Production down, data loss, security breach, all users affected
- HIGH: Major degradation, many users affected, SLA at risk
- MEDIUM: Partial impact, workaround exists, some users affected
- LOW: Minor issue, cosmetic, enhancement, single user

INCIDENT DESCRIPTION:
---
${incidentText.slice(0, 6000)}
---

Respond with valid JSON only.`;
  },
};
