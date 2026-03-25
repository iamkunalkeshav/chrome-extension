// ════════════════════════════════════════════════════════
//  SMART INCIDENT SUMMARIZER ENGINE — Zero LLM, Pure JS
//  v3.0 — negation-aware, hit-count weighted, full output
// ════════════════════════════════════════════════════════

const Engine = (() => {

  // ── Severity signal words ─────────────────────────────
  const SEVERITY = {
    critical: {
      words: ['down','outage','critical','crash','crashed','unavailable','not responding',
              'production down','p0','p1','complete failure','total loss','data loss',
              'security breach','breach','hacked','ransomware','all users','entire system',
              'database down','service unavailable','500 error','system failure'],
      score: 4, label: 'CRITICAL', color: '#ff4d4d'
    },
    high: {
      words: ['error','failed','failure','broken','not working','degraded','major',
              'multiple users','p2','high','intermittent','spike','timeout','slow',
              'latency','500','503','502','exception','null pointer','oom','memory leak',
              'unable to','can\'t access','cannot access','login failed','authentication failed'],
      score: 3, label: 'HIGH', color: '#f59e0b'
    },
    medium: {
      words: ['issue','problem','warning','delay','partial','some users','occasionally',
              'unexpected','incorrect','mismatch','p3','medium','moderate','wrong',
              'inconsistent','missing','not loading'],
      score: 2, label: 'MEDIUM', color: '#facc15'
    },
    low: {
      words: ['minor','cosmetic','ui','display','typo','enhancement','p4','low','question',
              'feature','request','clarification','suggestion','feedback'],
      score: 1, label: 'LOW', color: '#22c55e'
    }
  };

  // Negation phrases — if found near a severity word, ignore that word
  const NEGATIONS = ['no ','not ','never ','without ','fixed ','resolved ','cleared ','no longer '];

  // ── Category detection ────────────────────────────────
  const CATEGORIES = {
    'Database':    ['database','db','sql','query','mongodb','postgres','mysql','oracle','redis','table','schema','migration','ora-','deadlock'],
    'Network':     ['network','dns','firewall','vpn','ip','port','connection','socket','timeout','latency','bandwidth','packet','traceroute','ping'],
    'Auth':        ['login','auth','authentication','password','sso','oauth','token','session','permission','access denied','403','401','jwt','ldap'],
    'API':         ['api','endpoint','rest','graphql','request','response','payload','webhook','integration','microservice','swagger','grpc'],
    'Server':      ['server','cpu','memory','ram','disk','vm','container','kubernetes','docker','pod','node','cluster','k8s','ec2','gcp'],
    'UI/Frontend': ['ui','frontend','page','browser','screen','button','form','display','render','css','javascript','react','vue','angular'],
    'Payment':     ['payment','transaction','billing','invoice','stripe','razorpay','checkout','refund','charge','pgw','gateway'],
    'Email/Notif': ['email','notification','sms','alert','smtp','sendgrid','push','mail','twilio','ses'],
    'Data/ETL':    ['pipeline','etl','sync','data','batch','job','cron','scheduler','kafka','queue','worker','airflow','spark'],
    'Storage':     ['file','upload','s3','blob','storage','bucket','disk full','attachment','image','pdf','cdn','cloudfront'],
    'CI/CD':       ['deploy','deployment','build','pipeline','ci','cd','jenkins','github actions','helm','release','rollback'],
    'Security':    ['breach','hack','vulnerability','injection','xss','csrf','malware','ransomware','exploit','pentest'],
  };

  // ── Patterns for auto-detection ───────────────────────
  const PATTERNS = {
    errorCodes:   /\b([A-Z]{2,8}[-_]?\d{3,6}|[Ee]rror\s*\d{3,6}|HTTP\s*\d{3}|[45]\d{2}|ORA-\d+|ERR_[A-Z_]+)\b/g,
    ips:          /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g,
    timestamps:   /\b\d{1,2}[:\-]\d{2}(?:[:\-]\d{2})?(?:\s*(?:AM|PM|UTC|IST|GMT|PST|EST))?\b|\d{4}[-/]\d{2}[-/]\d{2}(?:T\d{2}:\d{2})?/gi,
    urls:         /https?:\/\/[^\s<>'"]+/g,
    services:     /\b[A-Z][a-z]+(?:Service|API|DB|Server|App|Portal|Module|System|Engine|Gateway|Worker|Queue|Bus|Hub)\b/g,
    percentages:  /\b\d+(?:\.\d+)?%/g,
    userCounts:   /\b\d[\d,]*\s*(?:users?|customers?|clients?|accounts?|sessions?|requests?)\b/gi,
    versions:     /\bv?\d+\.\d+(?:\.\d+)?(?:-[\w.]+)?\b/g,
  };

  // ── Stopwords (ignored in scoring) ───────────────────
  const STOPWORDS = new Set([
    'the','a','an','is','are','was','were','be','been','being','have','has','had',
    'do','does','did','will','would','could','should','may','might','shall','can',
    'to','of','in','on','at','by','for','with','from','into','through','during',
    'and','or','but','if','then','so','as','this','that','these','those','it',
    'its','we','our','they','their','he','she','you','your','i','my','me','us',
    'not','no','also','please','hi','hello','team','ticket','incident','report',
    'below','above','following','noted','kindly','attached','please','find','dear',
  ]);

  // ── Recommended solutions per category ───────────────
  const SOLUTIONS = {
    'Database': [
      'Check connection pool size and increase if saturated',
      'Review slow query logs and add missing indexes',
      'Verify DB process is running: `systemctl status postgresql`',
      'Check disk space on DB host — full disk causes failures',
      'Review recent schema migrations for breaking changes',
    ],
    'Network': [
      'Run `traceroute` / `mtr` to identify the failing hop',
      'Check firewall rules and security group configurations',
      'Verify DNS resolution: `nslookup <service-hostname>`',
      'Test TCP connectivity: `telnet <host> <port>`',
      'Review recent network changes (VPN, load balancer, CDN config)',
    ],
    'Auth': [
      'Check auth service health and logs for JWT validation errors',
      'Verify SSO/OAuth provider is reachable and certs are valid',
      'Check token expiry — consider refreshing client credentials',
      'Review recent IAM/permission changes that may have locked users out',
      'Test auth endpoint directly: `curl -I <auth-url>`',
    ],
    'API': [
      'Check API gateway logs for upstream errors (502/503/504)',
      'Verify upstream service health and circuit breaker state',
      'Review recent API contract changes (breaking schema changes)',
      'Check rate limits — client may be throttled',
      'Trace request flow end-to-end using correlation ID',
    ],
    'Server': [
      'Check CPU/memory/disk: `top`, `df -h`, `free -m`',
      'Review OOM killer logs: `dmesg | grep -i oom`',
      'Check for runaway processes consuming resources',
      'Restart affected service pod if kubernetes: `kubectl rollout restart`',
      'Review node health via monitoring dashboard (Grafana/Datadog)',
    ],
    'UI/Frontend': [
      'Check browser console for JS errors and failed network requests',
      'Verify CDN assets are reachable and cache is not stale',
      'Test on multiple browsers to isolate browser-specific issue',
      'Check for recent frontend deployments and consider rollback',
      'Review Content Security Policy headers for blocked resources',
    ],
    'Payment': [
      'Check payment gateway dashboard for service outage',
      'DO NOT auto-retry failed transactions — risk of double-charge',
      'Verify webhook signature validation logic',
      'Review API key rotation — payment keys may have expired',
      'Contact payment provider support with failed transaction IDs',
    ],
    'Email/Notif': [
      'Check SMTP relay logs and bounce rates',
      'Verify email provider API key is valid and quota not exhausted',
      'Test with a direct SMTP send to isolate the failure point',
      'Review spam/bounce lists — sender domain may be blacklisted',
    ],
    'Data/ETL': [
      'Inspect pipeline run logs for the failed job step',
      'Check upstream data source availability (DB, API, S3)',
      'Verify queue depth — consumer may be backed up',
      'Review recent schema changes in source data',
      'Re-run failed pipeline with debug logging enabled',
    ],
    'Storage': [
      'Check bucket/volume disk usage and quotas',
      'Verify IAM permissions for the service account accessing storage',
      'Test file upload directly via CLI to isolate SDK issues',
      'Review CDN configuration for stale cache on static assets',
    ],
    'CI/CD': [
      'Check build logs for exact failure step',
      'Verify environment secrets/variables are set correctly',
      'Consider immediate rollback to last stable release tag',
      'Check for dependency version conflicts in the build',
      'Review recent infra changes (Helm chart, Dockerfile)',
    ],
    'Security': [
      '🚨 Isolate affected systems immediately',
      'Preserve logs — do not restart/wipe before forensic capture',
      'Rotate all credentials and API keys immediately',
      'Notify security team and relevant stakeholders',
      'Document timeline of events for incident post-mortem',
    ],
  };

  // ═════════════════════════════════════════════════════
  //  MAIN ANALYZE FUNCTION
  // ═════════════════════════════════════════════════════
  function analyze(rawText) {
    const text = rawText.trim();
    if (!text || text.length < 20) return null;

    const sentences  = splitSentences(text);
    const wordFreq   = buildWordFrequency(text);
    const severity   = detectSeverity(text);
    const categories = detectCategories(text);
    const extracted  = extractPatterns(text);
    const topSentences  = rankSentences(sentences, wordFreq, extracted);
    const whatHappened  = buildWhatHappened(topSentences, sentences);
    const affected      = detectAffected(text, extracted);
    const timeline      = buildTimeline(text, extracted);
    const actions       = suggestActions(text, categories, severity, extracted);
    const solution      = buildSolution(categories, severity, text);
    const rootCause     = inferRootCause(text, categories, extracted);
    const readTime      = Math.ceil(text.split(/\s+/).length / 200);

    return {
      severity,
      categories,
      extracted,
      whatHappened,
      affected,
      timeline,
      actions,
      solution,
      rootCause,
      readTime,
      originalLength: sentences.length,
      summaryLength: whatHappened.length,
    };
  }

  // ── Split into sentences ──────────────────────────────
  function splitSentences(text) {
    return text
      .replace(/\n{2,}/g, ' |BREAK| ')
      .split(/(?<=[.!?])\s+(?=[A-Z])|\|BREAK\||(?<=:)\s*\n/g)
      .map(s => s.replace('|BREAK|', '').trim())
      .filter(s => s.length > 15);
  }

  // ── Build word frequency map ──────────────────────────
  function buildWordFrequency(text) {
    const words = text.toLowerCase().match(/\b[a-z]{3,}\b/g) || [];
    const freq = {};
    words.forEach(w => {
      if (!STOPWORDS.has(w)) freq[w] = (freq[w] || 0) + 1;
    });
    return freq;
  }

  // ── Negation-aware severity check ────────────────────
  function hasNegatedWord(lower, word) {
    const idx = lower.indexOf(word);
    if (idx === -1) return false;
    const context = lower.slice(Math.max(0, idx - 30), idx);
    return NEGATIONS.some(neg => context.includes(neg));
  }

  // ── Detect severity (negation-aware + hit-count weighted) ──
  function detectSeverity(text) {
    const lower = text.toLowerCase();
    let bestScore = 0;
    let result = { ...SEVERITY.low, hits: [] };

    for (const [key, data] of Object.entries(SEVERITY)) {
      const hits = data.words.filter(w => {
        if (!lower.includes(w)) return false;
        return !hasNegatedWord(lower, w);
      });

      // Weight = base score × sqrt(hit count) for multi-signal boost
      const weighted = hits.length > 0 ? data.score * Math.sqrt(hits.length) : 0;
      if (weighted > bestScore) {
        bestScore = weighted;
        result = { ...data, hits };
      }
    }
    return result;
  }

  // ── Detect categories ─────────────────────────────────
  function detectCategories(text) {
    const lower = text.toLowerCase();
    const found = [];
    for (const [cat, words] of Object.entries(CATEGORIES)) {
      const hits = words.filter(w => lower.includes(w));
      if (hits.length > 0) found.push({ cat, hits: hits.length });
    }
    // Sort by hit count, return top 5
    return found.sort((a, b) => b.hits - a.hits).slice(0, 5).map(f => f.cat);
  }

  // ── Extract patterns (codes, IPs, etc.) ──────────────
  function extractPatterns(text) {
    const result = {};
    for (const [key, regex] of Object.entries(PATTERNS)) {
      const matches = [...new Set(text.match(new RegExp(regex.source, regex.flags)) || [])];
      if (matches.length) result[key] = matches.slice(0, 6);
    }
    return result;
  }

  // ── Score and rank sentences ──────────────────────────
  function rankSentences(sentences, wordFreq, extracted) {
    const maxFreq = Math.max(...Object.values(wordFreq), 1);

    return sentences.map((sentence, idx) => {
      let score = 0;
      const words = sentence.toLowerCase().match(/\b[a-z]{3,}\b/g) || [];

      words.forEach(w => {
        if (wordFreq[w]) score += wordFreq[w] / maxFreq;
      });

      // Positional bonus
      if (idx === 0) score *= 1.8;
      if (idx === 1) score *= 1.3;

      // Signal bonuses
      if (/[45]\d{2}|error|fail|crash|down|critical/i.test(sentence)) score *= 1.5;
      if (/\d+%|\d+\s*users?|\d+\s*minutes?/i.test(sentence)) score *= 1.3;
      if (/since|started|began|reported|noticed/i.test(sentence)) score *= 1.2;

      // Penalty: too short or too long
      if (sentence.length < 30) score *= 0.5;
      if (sentence.length > 300) score *= 0.7;

      return { sentence, score, idx };
    })
    .sort((a, b) => b.score - a.score);
  }

  // ── Build "What Happened" summary ─────────────────────
  function buildWhatHappened(ranked, all) {
    const chosen = new Set();
    chosen.add(0);
    ranked.slice(0, 5).forEach(r => chosen.add(r.idx));

    return [...chosen]
      .sort((a, b) => a - b)
      .slice(0, 3)
      .map(i => all[i])
      .filter(Boolean);
  }

  // ── Who is affected ───────────────────────────────────
  function detectAffected(text, extracted) {
    const lower = text.toLowerCase();
    const parts = [];

    if (extracted.userCounts?.length) parts.push(extracted.userCounts[0]);
    else if (lower.includes('all users')) parts.push('All users');
    else if (lower.includes('some users')) parts.push('Some users');
    else if (lower.match(/customer|client/)) parts.push('Customers');
    else if (lower.match(/internal|employee|staff|team/)) parts.push('Internal users');

    if (lower.includes('production') || lower.includes('prod')) parts.push('Production');
    else if (lower.includes('staging')) parts.push('Staging');
    else if (lower.includes('dev ')) parts.push('Dev environment');

    if (extracted.services?.length) parts.push(...extracted.services.slice(0, 2));

    return parts.length ? parts.join(' · ') : 'Scope unclear — needs investigation';
  }

  // ── Timeline from timestamps ──────────────────────────
  function buildTimeline(text, extracted) {
    if (!extracted.timestamps?.length) return null;
    return extracted.timestamps.slice(0, 5);
  }

  // ── Infer probable root cause ─────────────────────────
  function inferRootCause(text, categories, extracted) {
    const lower = text.toLowerCase();
    const clues = [];

    if (lower.match(/after\s+(deploying|deploy|deployment|release|update|upgrade|migration)/))
      clues.push('Recent deployment is likely the trigger — check diff and consider rollback');
    if (lower.match(/config|configuration|env\s|environment\s+variable|secret/))
      clues.push('Configuration or environment variable change may be the cause');
    if (lower.match(/disk\s*full|storage\s*full|no\s*space/))
      clues.push('Disk/storage exhaustion detected as probable cause');
    if (lower.match(/memory\s*leak|oom|out\s*of\s*memory/))
      clues.push('Memory leak or OOM condition — application needs restart and heap analysis');
    if (lower.match(/certificate|cert|ssl|tls|expired/))
      clues.push('SSL/TLS certificate expiry may be causing connection failures');
    if (lower.match(/rate\s*limit|throttl|quota/))
      clues.push('Rate limiting or quota exceeded on an upstream service');
    if (lower.match(/spike|surge|traffic|load|scale/))
      clues.push('Traffic spike causing resource exhaustion — consider scaling out');
    if (extracted.versions?.length)
      clues.push(`Version ${extracted.versions[0]} may have introduced a regression`);

    if (clues.length === 0) {
      if (categories.includes('Database')) clues.push('DB-level failure — check connection limits and query performance');
      else if (categories.includes('Network')) clues.push('Network-level disruption — check routing and firewall rules');
      else clues.push('Root cause unclear — correlate logs, metrics, and recent changes');
    }

    return clues.slice(0, 2);
  }

  // ── Build recommended solution ────────────────────────
  function buildSolution(categories, severity, text) {
    const steps = [];

    // Universal first action based on severity
    if (severity.label === 'CRITICAL') {
      steps.push('🚨 Page the on-call lead immediately — do not wait');
      steps.push('Open a war room bridge (Zoom/Slack) and pin incident channel');
    } else if (severity.label === 'HIGH') {
      steps.push('Notify the on-call engineer and team lead');
    }

    // Category-specific solutions (top 2 categories)
    for (const cat of categories.slice(0, 2)) {
      const catSteps = SOLUTIONS[cat];
      if (catSteps) steps.push(...catSteps.slice(0, 2));
    }

    // Universal closing steps
    steps.push('Document all findings in the incident ticket with timestamps');
    if (severity.label === 'CRITICAL' || severity.label === 'HIGH') {
      steps.push('Schedule a blameless post-mortem within 48 hours');
    }

    return [...new Set(steps)].slice(0, 7);
  }

  // ── Suggest actions based on context ─────────────────
  function suggestActions(text, categories, severity, extracted) {
    const lower = text.toLowerCase();
    const actions = [];

    actions.push(`Verify current system status${extracted.services?.length ? ` — check ${extracted.services[0]}` : ''}`);

    if (categories.includes('Database')) {
      actions.push('Check DB connection pool and query logs');
      if (lower.includes('slow') || lower.includes('timeout')) actions.push('Run EXPLAIN on slow queries, check index usage');
    }
    if (categories.includes('Network')) {
      actions.push('Test connectivity and run traceroute to affected endpoints');
      if (extracted.ips?.length) actions.push(`Investigate IP: ${extracted.ips[0]}`);
    }
    if (categories.includes('Auth')) {
      actions.push('Check auth service logs and token expiry settings');
      if (lower.includes('401') || lower.includes('403')) actions.push('Verify API keys/tokens are not expired or revoked');
    }
    if (categories.includes('API')) {
      actions.push('Check API gateway logs and upstream service health');
      if (extracted.errorCodes?.length) actions.push(`Investigate error code: ${extracted.errorCodes[0]}`);
    }
    if (categories.includes('Server')) {
      actions.push('Check CPU/memory/disk utilisation on affected nodes');
      if (lower.includes('memory') || lower.includes('oom')) actions.push('Analyze heap dumps — possible memory leak');
    }
    if (categories.includes('Payment')) {
      actions.push('Check payment gateway dashboard for failed transactions');
      actions.push('Do NOT retry failed payments without manual review');
    }

    if (severity.label === 'CRITICAL') {
      actions.unshift('🚨 ESCALATE IMMEDIATELY — Page on-call lead');
      actions.push('Initiate rollback if recent deployment is suspected cause');
    }
    if (severity.label === 'HIGH') {
      actions.push('Notify stakeholders — ETA update every 30 mins');
    }

    if (extracted.errorCodes?.length && !actions.some(a => a.includes('error code'))) {
      actions.push(`Search runbook for: ${extracted.errorCodes.slice(0, 2).join(', ')}`);
    }

    return [...new Set(actions)].slice(0, 6);
  }

  return { analyze };
})();

window.IncidentEngine = Engine;
