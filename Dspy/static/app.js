let controller  = null;
let replSteps   = [];
let trajCards   = 0;
let finalAnswer = '';
const CHUNK     = 3500;

const $  = id => document.getElementById(id);
const esc = s => String(s ?? '')
  .replace(/&/g,'&').replace(/</g,'<').replace(/>/g,'>').replace(/"/g,'"');

function updateStats() {
  const v = $('ctx').value;
  const s = $('ctx-stats');
  if (!v.trim()) { s.classList.remove('show'); return; }
  s.classList.add('show');
  $('s-chars').textContent  = v.length.toLocaleString() + ' chars';
  $('s-words').textContent  = v.split(/\s+/).filter(Boolean).length.toLocaleString() + ' words';
  $('s-chunks').textContent = Math.ceil(v.length / CHUNK) + ' chunk(s)';
}

function setStatus(state, text) {
  $('dot').className   = 'dot ' + state;
  $('stext').textContent = text;
}

function showError(msg) {
  const el = $('err');
  if (msg) { $('errmsg').textContent = msg; el.classList.add('show'); }
  else      { el.classList.remove('show'); }
}

function switchTab(tab) {
  document.querySelectorAll('.seg-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.panel').forEach(p =>
    p.classList.toggle('active', p.id === tab + '-panel'));
}

async function handleFile(file) {
  if (!file) return;
  $('dz-label').innerHTML = `<span class="file-chip">📄 ${esc(file.name)}</span>`;
  try {
    const fd  = new FormData();
    fd.append('file', file);
    const r   = await fetch('/upload', { method:'POST', body:fd });
    const d   = await r.json();
    $('ctx').value = d.text;
  } catch {
    const rd = new FileReader();
    rd.onload = e => { $('ctx').value = e.target.result; updateStats(); };
    rd.readAsText(file);
    return;
  }
  updateStats();
}

const dz = $('dz');
dz.addEventListener('dragover',  e => { e.preventDefault(); dz.classList.add('dragover'); });
dz.addEventListener('dragleave', ()  => dz.classList.remove('dragover'));
dz.addEventListener('drop', e => {
  e.preventDefault(); dz.classList.remove('dragover');
  handleFile(e.dataTransfer.files[0]);
});
$('fi').addEventListener('change', e => handleFile(e.target.files[0]));
$('ctx').addEventListener('input', updateStats);

function highlightCode(raw) {
  let s = esc(raw);
  s = s.replace(/\b(SUBMIT|FINAL)\s*\(/g, '<span class="t-submit">$1</span>(');
  s = s.replace(/\b(llm_query(?:_batched)?)\s*\(/g, '<span class="t-llmq">$1</span>(');
  s = s.replace(/\b(import|from|for|in|if|else|elif|while|def|return|print|class|with|as|try|except|pass|and|or|not|True|False|None)\b/g,
    '<span class="t-kw">$1</span>');
  s = s.replace(/(&#34;[^<]*?&#34;|'[^<]*?')/g, '<span class="t-str">$1</span>');
  s = s.replace(/\b(\d+)\b/g, '<span class="t-num">$1</span>');
  return s;
}

function classifyStep(step) {
  const code = (step.code || '').trim();
  const out  = (step.output || '').trim();
  if (/\bSUBMIT\s*\(/.test(code) || /\bFINAL\s*\(/.test(code)) {
    return { icon:'✦', css:'ic-submit', label:'SUBMIT', detail:'Final answer submitted' };
  }
  if (/llm_query/.test(code)) {
    return { icon:'⬡', css:'ic-llmquery', label:'llm_query()', detail:'Sub-LLM call for semantic analysis' };
  }
  if (step.index === 0) {
    return { icon:'◈', css:'ic-plan', label:'Initial Peek', detail:'LM reading context metadata' };
  }
  return { icon:'▸', css:'ic-repl', label:`REPL — iteration ${step.index + 1}`, detail: code.split('\n')[0].slice(0,70) };
}

function addTrajCard(step) {
  $('traj-empty').style.display = 'none';
  $('traj-load').classList.remove('show');

  const m   = classifyStep(step);
  const idx = trajCards++;

  const el  = document.createElement('div');
  el.className = 'traj-card';
  el.id = 'tc-' + idx;
  el.style.animationDelay = (idx * 30) + 'ms';

  const hasBody = !!(step.reasoning || step.code || step.output);

  el.innerHTML = `
    <div class="tc-head" onclick="toggleCard(${idx})">
      <div class="tc-ico ${m.css}">${m.icon}</div>
      <div class="tc-meta">
        <div class="tc-title">${esc(m.label)}</div>
        <div class="tc-detail">${esc(m.detail)}</div>
      </div>
      ${hasBody ? `<div class="tc-chev open" id="tcc-${idx}">⌄</div>` : ''}
    </div>
    ${hasBody ? `
    <div class="tc-body open" id="tcb-${idx}">
      ${step.reasoning ? `
        <div>
          <div class="blabel">Reasoning</div>
          <div class="reasoning-block">${esc(step.reasoning)}</div>
        </div>` : ''}
      ${step.code ? `
        <div>
          <div class="blabel">Code</div>
          <div class="code-block"><span class="p">>>> </span>${highlightCode(step.code)}</div>
        </div>` : ''}
      ${step.output ? `
        <div>
          <div class="blabel">Output</div>
          <div class="out-block">${esc(step.output)}</div>
        </div>` : ''}
    </div>` : ''}
  `;

  $('traj-steps').appendChild(el);
  el.scrollIntoView({ behavior:'smooth', block:'nearest' });

  $('n-traj').textContent = trajCards;
  $('n-traj').classList.add('show');
}

function toggleCard(idx) {
  const b = $('tcb-' + idx), c = $('tcc-' + idx);
  if (!b) return;
  const open = b.classList.toggle('open');
  if (c) c.classList.toggle('open', open);
}

let terminal    = null;
let termBody    = null;
let cursorEl    = null;

function ensureTerminal() {
  if (terminal) return;
  $('repl-empty').style.display = 'none';

  terminal = document.createElement('div');
  terminal.className = 'repl-terminal';
  terminal.innerHTML = `
    <div class="term-chrome">
      <div class="term-dot td-red"></div>
      <div class="term-dot td-yellow"></div>
      <div class="term-dot td-green"></div>
      <div class="term-title">Python REPL  ·  dspy.RLM</div>
    </div>
    <div class="term-body" id="term-body"></div>
  `;
  $('repl-panel').appendChild(terminal);
  termBody = $('term-body');

  cursorEl = document.createElement('span');
  cursorEl.className = 'cursor';
  termBody.appendChild(cursorEl);
}

function addReplIter(step) {
  ensureTerminal();

  if (cursorEl && cursorEl.parentNode) cursorEl.parentNode.removeChild(cursorEl);

  const block = document.createElement('div');
  block.className = 'repl-iter';
  block.style.animationDelay = (step.index * 40) + 'ms';

  const isFinal  = /\bSUBMIT\s*\(|\bFINAL\s*\(/.test(step.code || '');
  const isLLMQ   = /llm_query/.test(step.code || '');

  let html = `<div class="iter-label">Iteration ${step.index + 1}${isFinal ? ' · SUBMIT' : isLLMQ ? ' · sub-LLM' : ''}</div>`;

  if (step.reasoning) {
    html += `<div class="iter-reasoning">${esc(step.reasoning)}</div>`;
  }

  if (step.code) {
    const lines = step.code.split('\n');
    html += `<div class="iter-code">`;
    lines.forEach((ln, i) => {
      const prefix = i === 0 ? `<span class="prompt-sym">>>> </span>` : `<span class="prompt-sym">... </span>`;
      html += prefix + highlightCode(ln) + '\n';
    });
    html += `</div>`;
  }

  if (step.output) {
    html += `<div class="iter-output${isFinal ? ' final-out' : ''}">${esc(step.output)}</div>`;
  }

  block.innerHTML = html;
  termBody.appendChild(block);
  termBody.appendChild(cursorEl);
  termBody.scrollTop = termBody.scrollHeight;

  $('n-repl').textContent = step.index + 1;
  $('n-repl').classList.add('show');
}

function finaliseTerminal() {
  if (cursorEl && cursorEl.parentNode) cursorEl.parentNode.removeChild(cursorEl);
}

function showAnswer(text) {
  finalAnswer = text;
  const old = $('ans-panel').querySelector('.answer-card');
  if (old) old.remove();
  $('ans-empty').style.display = 'none';

  const c = document.createElement('div');
  c.className = 'answer-card';
  c.innerHTML = `
    <div class="ans-head">
      <div class="ans-dot"></div>
      <div class="ans-title">Synthesised Answer</div>
      <button class="copy-btn" id="copy-btn" onclick="copyAnswer()">⎘ Copy</button>
    </div>
    <div class="ans-text">${esc(text)}</div>
  `;
  $('ans-panel').appendChild(c);
}

function copyAnswer() {
  navigator.clipboard.writeText(finalAnswer).then(() => {
    const b = $('copy-btn');
    b.textContent = '✓ Copied'; b.classList.add('copied');
    setTimeout(() => { b.textContent = '⎘ Copy'; b.classList.remove('copied'); }, 2200);
  });
}

function setRunning() {
  $('btn-row').innerHTML = `
    <button class="btn btn-stop" onclick="stopRLM()">■ Stop</button>
    <button class="btn btn-icon" onclick="resetAll()">↺</button>
  `;
}
function setIdle() {
  $('btn-row').innerHTML = `
    <button class="btn btn-primary" id="run-btn" onclick="runRLM()">▶ Run</button>
    <button class="btn btn-icon" onclick="resetAll()">↺</button>
  `;
}

async function runRLM() {
  const sys  = $('sys').value.trim();
  const qry  = $('qry').value.trim();
  const ctx  = $('ctx').value.trim();

  if (!qry) { showError('Please enter a query.'); return; }
  if (!ctx) { showError('Please provide context — upload a file or paste text.'); return; }

  showError('');
  resetPanels();

  controller = new AbortController();
  setRunning();
  setStatus('running', 'Running…');
  $('traj-load').classList.add('show');
  switchTab('trajectory');

  try {
    const res = await fetch('/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ system_prompt: sys, user_prompt: qry, context: ctx }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const e = await res.json().catch(() => ({ detail: 'Server error' }));
      throw new Error(e.detail || 'Server error');
    }

    const reader = res.body.getReader();
    const dec    = new TextDecoder();
    let   buf    = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });

      const parts = buf.split('\n\n');
      buf = parts.pop();

      for (const part of parts) {
        let ev = 'message', data = '';
        for (const ln of part.split('\n')) {
          if (ln.startsWith('event: ')) ev   = ln.slice(7).trim();
          if (ln.startsWith('data: '))  data = ln.slice(6).trim();
        }
        if (!data) continue;

        let p;
        try { p = JSON.parse(data); } catch { continue; }

        switch (ev) {
          case 'status':
            $('traj-load').classList.add('show');
            $('load-msg').textContent = p.message;
            break;

          case 'repl_step':
            $('traj-load').classList.remove('show');
            addTrajCard(p);
            addReplIter(p);
            if (p.index < p.total - 1)
              $('load-msg').textContent = `REPL iteration ${p.index + 1} / ${p.total}…`;
            break;

          case 'answer':
            showAnswer(p.text);
            break;

          case 'done':
            $('traj-load').classList.remove('show');
            finaliseTerminal();
            setStatus('done', `${trajCards} steps  ·  done`);
            finish();
            break;

          case 'error':
            showError(p.message);
            setStatus('error', 'Error');
            finish();
            break;
        }
      }
    }
  } catch (err) {
    if (err.name === 'AbortError') { setStatus('', 'Stopped'); }
    else { showError(err.message); setStatus('error', 'Error'); }
    finish();
  }
}

function finish() {
  $('traj-load').classList.remove('show');
  finaliseTerminal();
  setIdle();
}

function stopRLM() {
  controller?.abort();
  setStatus('', 'Stopped');
  finish();
}

function resetPanels() {
  $('traj-steps').innerHTML  = '';
  $('traj-empty').style.display = 'flex';
  $('traj-load').classList.remove('show');
  $('n-traj').classList.remove('show');
  trajCards = 0;

  const old = $('repl-panel').querySelector('.repl-terminal');
  if (old) old.remove();
  terminal = termBody = cursorEl = null;
  replSteps = [];
  $('repl-empty').style.display = 'flex';
  $('n-repl').classList.remove('show');

  const ac = $('ans-panel').querySelector('.answer-card');
  if (ac) ac.remove();
  $('ans-empty').style.display = 'flex';

  finalAnswer = '';
}

function resetAll() {
  stopRLM();
  resetPanels();
  showError('');
  setStatus('', 'Ready');
  setIdle();
}
