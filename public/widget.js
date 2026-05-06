/* === Obiimy Chat Widget — vanilla JS, embeddable === */
(function () {
  if (window.__obiimyChatLoaded) return;
  window.__obiimyChatLoaded = true;

  // Resolve API base from script tag (so embed.js can override)
  const API_BASE = (window.__OBIIMY_API_BASE__ || (function () {
    const me = document.currentScript || document.querySelector('script[src*="widget.js"]');
    if (me) return new URL(me.src).origin;
    return '';
  })()).replace(/\/$/, '');

  const POSITION = window.__OBIIMY_POSITION__ || 'right';
  const STORAGE_KEY = 'obiimy_chat_v1';
  const MAX_HISTORY = 50;

  const QUICK_REPLIES = [
    'Як дізнатись наявність?',
    'Який розмір хустинки обрати?',
    'Адреса шоуруму'
  ];

  const SVG = {
    chat: '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 3C6.48 3 2 6.81 2 11.5c0 2.27 1.06 4.34 2.8 5.86L4 21l4.16-1.69c1.18.41 2.47.69 3.84.69 5.52 0 10-3.81 10-8.5S17.52 3 12 3z" stroke="currentColor" stroke-width="2" stroke-linejoin="round" fill="rgba(255,255,255,.18)"/><circle cx="8.5" cy="11.5" r="1.2" fill="currentColor"/><circle cx="12" cy="11.5" r="1.2" fill="currentColor"/><circle cx="15.5" cy="11.5" r="1.2" fill="currentColor"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6l-12 12"/></svg>',
    send:  '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3.4 20.4l17.4-7.5c.8-.4.8-1.5 0-1.8L3.4 3.6c-.7-.3-1.4.4-1.2 1.1L4 11.5l13 .5L4 12.5l-1.8 6.8c-.2.7.5 1.4 1.2 1.1z"/></svg>'
  };

  // Minimal markdown renderer (paragraphs, bold, italic, lists, links, code)
  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function md(text) {
    let s = escapeHtml(text);
    // Code spans
    s = s.replace(/`([^`\n]+)`/g, '<code>$1</code>');
    // Bold
    s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    // Italic (no greedy across newlines)
    s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    // Links [text](url)
    s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    // Bare urls
    s = s.replace(/(^|\s)(https?:\/\/[^\s<]+)/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>');
    // Lists (-, *, •) -> simple group
    const lines = s.split(/\n/);
    const out = [];
    let listOpen = false;
    for (const ln of lines) {
      const m = /^\s*(?:[-*•]|\d+\.)\s+(.*)/.exec(ln);
      if (m) {
        if (!listOpen) { out.push('<ul>'); listOpen = true; }
        out.push('<li>' + m[1] + '</li>');
      } else {
        if (listOpen) { out.push('</ul>'); listOpen = false; }
        out.push(ln);
      }
    }
    if (listOpen) out.push('</ul>');
    s = out.join('\n');
    // Convert blank-line-separated paragraphs
    s = s.split(/\n{2,}/).map(p => /<(ul|ol|li|p|strong|em|code|a)/.test(p) ? p : '<p>' + p.replace(/\n/g, '<br>') + '</p>').join('');
    return s;
  }

  // Storage
  function loadHistory() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { sid: 'sid_' + Math.random().toString(36).slice(2, 12), msgs: [] };
      const j = JSON.parse(raw);
      return { sid: j.sid, msgs: (j.msgs || []).slice(-MAX_HISTORY) };
    } catch { return { sid: 'sid_' + Math.random().toString(36).slice(2, 12), msgs: [] }; }
  }
  function saveHistory(state) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ sid: state.sid, msgs: state.msgs.slice(-MAX_HISTORY) })); } catch {}
  }

  // Build DOM
  function build() {
    const root = document.createElement('div');
    root.id = 'obiimy-chat-root';
    if (POSITION === 'left') root.classList.add('left');
    root.innerHTML = `
      <div class="ob-greeter" id="ob-greeter" role="status" aria-hidden="true">
        <button class="ob-close" id="ob-greeter-close" aria-label="Закрити">×</button>
        Вітаю в Обіймах 🫂💛<br>
        Я Вікторія, рада допомогти ✨
      </div>
      <div class="ob-panel" id="ob-panel" role="dialog" aria-label="Чат з Вікторією">
        <div class="ob-header">
          <div class="ob-avatar">В</div>
          <div class="ob-htext">
            <div class="ob-name">Вікторія · Обійми</div>
            <div class="ob-status">онлайн</div>
          </div>
          <button class="ob-hclose" id="ob-hclose" aria-label="Згорнути">${SVG.close}</button>
        </div>
        <div class="ob-body" id="ob-body"></div>
        <div class="ob-foot">
          <div class="ob-input-wrap">
            <textarea class="ob-input" id="ob-input" placeholder="Напишіть повідомлення…" rows="1" maxlength="2000"></textarea>
            <button class="ob-send" id="ob-send" aria-label="Надіслати" disabled>${SVG.send}</button>
          </div>
          <div class="ob-footnote">з турботою від <span>Обійми</span> 💛</div>
        </div>
      </div>
      <button class="ob-bubble pulse" id="ob-bubble" aria-label="Відкрити чат">${SVG.chat}</button>
    `;
    document.body.appendChild(root);
    return root;
  }

  function init() {
    if (!document.body) return document.addEventListener('DOMContentLoaded', init, { once: true });
    const root = build();
    const bubble = root.querySelector('#ob-bubble');
    const greeter = root.querySelector('#ob-greeter');
    const greeterClose = root.querySelector('#ob-greeter-close');
    const panel = root.querySelector('#ob-panel');
    const hclose = root.querySelector('#ob-hclose');
    const body = root.querySelector('#ob-body');
    const input = root.querySelector('#ob-input');
    const send = root.querySelector('#ob-send');

    let state = loadHistory();
    let busy = false;

    function pushMsg(role, content) {
      state.msgs.push({ role, content, t: Date.now() });
      saveHistory(state);
    }

    function renderAll() {
      body.innerHTML = '';
      if (!state.msgs.length) {
        appendBot('Вітаю в Обіймах 🫂💛\nЯ Вікторія, рада допомогти ✨\nПідкажіть, що вас цікавить?');
        renderQuicks();
      } else {
        for (const m of state.msgs) {
          if (m.role === 'user') appendUser(m.content);
          else appendBot(m.content);
        }
      }
      scrollBottom();
    }

    function makeMsg(role, html) {
      const wrap = document.createElement('div');
      wrap.className = 'ob-msg ' + role;
      if (role === 'bot') {
        wrap.innerHTML = `<div class="ob-mavt">В</div><div class="ob-bubble-msg"></div>`;
        wrap.querySelector('.ob-bubble-msg').innerHTML = html;
      } else {
        wrap.innerHTML = `<div class="ob-bubble-msg"></div>`;
        wrap.querySelector('.ob-bubble-msg').textContent = html;
      }
      body.appendChild(wrap);
      return wrap;
    }
    function appendBot(text) { return makeMsg('bot', md(text)); }
    function appendUser(text) { return makeMsg('user', text); }
    function renderQuicks() {
      const q = document.createElement('div');
      q.className = 'ob-quicks';
      q.id = 'ob-quicks';
      QUICK_REPLIES.forEach(r => {
        const b = document.createElement('button');
        b.className = 'ob-quick';
        b.textContent = r;
        b.onclick = () => { input.value = r; sendMessage(); };
        q.appendChild(b);
      });
      body.appendChild(q);
    }
    function clearQuicks() {
      const q = document.getElementById('ob-quicks');
      if (q) q.remove();
    }
    function scrollBottom() { body.scrollTop = body.scrollHeight; }

    function showTyping() {
      const wrap = document.createElement('div');
      wrap.className = 'ob-msg bot';
      wrap.id = 'ob-typing';
      wrap.innerHTML = `<div class="ob-mavt">В</div><div class="ob-typing"><span></span><span></span><span></span></div>`;
      body.appendChild(wrap);
      scrollBottom();
      return wrap;
    }

    async function sendMessage() {
      if (busy) return;
      const text = input.value.trim();
      if (!text) return;
      busy = true;
      input.value = '';
      input.style.height = 'auto';
      send.disabled = true;
      clearQuicks();
      pushMsg('user', text);
      appendUser(text);
      scrollBottom();

      const typing = showTyping();
      let botEl = null;
      let botContentEl = null;
      let acc = '';

      try {
        const r = await fetch(API_BASE + '/api/chat', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ messages: state.msgs.map(m => ({ role: m.role, content: m.content })), sessionId: state.sid })
        });

        if (!r.ok) {
          if (r.status === 429) {
            const j = await r.json().catch(() => ({}));
            typing.remove();
            appendBot(j.message || 'Вибачте, забагато повідомлень — спробуйте трохи пізніше 💛');
            return;
          }
          throw new Error('http ' + r.status);
        }
        if (!r.body) throw new Error('no body');

        const reader = r.body.getReader();
        const dec = new TextDecoder();
        let buf = '';
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          // Parse SSE: separated by blank line
          let idx;
          while ((idx = buf.indexOf('\n\n')) >= 0) {
            const block = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            const ev = /event:\s*(\S+)/.exec(block);
            const dat = /data:\s*(.*)/.exec(block);
            if (!dat) continue;
            try {
              const data = JSON.parse(dat[1]);
              const evName = ev ? ev[1] : 'message';
              if (evName === 'delta' && data.t) {
                if (!botEl) {
                  const t = document.getElementById('ob-typing'); if (t) t.remove();
                  botEl = appendBot('');
                  botContentEl = botEl.querySelector('.ob-bubble-msg');
                }
                acc += data.t;
                botContentEl.innerHTML = md(acc);
                scrollBottom();
              } else if (evName === 'regenerate') {
                // Backend decided to upgrade (Flash → Pro): clear current bubble, keep typing indicator
                acc = '';
                if (botEl) { botEl.remove(); botEl = null; botContentEl = null; }
                if (!document.getElementById('ob-typing')) {
                  const t2 = showTyping();
                  // Replace local var so we can remove it on next delta
                  // (typing local var will be garbage-collected)
                }
                scrollBottom();
              } else if (evName === 'error') {
                if (!botEl) {
                  const t = document.getElementById('ob-typing'); if (t) t.remove();
                  botEl = appendBot('');
                  botContentEl = botEl.querySelector('.ob-bubble-msg');
                }
                botContentEl.innerHTML = md(data.message || 'Щось пішло не так 💛');
              }
            } catch {}
          }
        }
        if (acc) pushMsg('assistant', acc);
        else { typing.remove(); appendBot('Вибачте, не вдалось отримати відповідь 💛 спробуєте ще раз? ✨'); }
      } catch (e) {
        const t = document.getElementById('ob-typing'); if (t) t.remove();
        appendBot('Здається, у мене стався збій звʼязку 💛 спробуйте, будь ласка, ще раз ✨');
      } finally {
        busy = false;
        send.disabled = !input.value.trim();
        scrollBottom();
      }
    }

    // === Events ===
    function openPanel() {
      panel.classList.add('open');
      greeter.classList.remove('show');
      bubble.classList.remove('pulse');
      try { localStorage.setItem('obiimy_chat_seen', '1'); } catch {}
      setTimeout(() => input.focus(), 200);
    }
    function closePanel() { panel.classList.remove('open'); }

    bubble.addEventListener('click', openPanel);
    hclose.addEventListener('click', closePanel);
    greeterClose.addEventListener('click', e => { e.stopPropagation(); greeter.classList.remove('show'); });

    input.addEventListener('input', () => {
      send.disabled = !input.value.trim();
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 120) + 'px';
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    });
    send.addEventListener('click', sendMessage);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && panel.classList.contains('open')) closePanel();
    });

    // First-load greeter (only if user hasn't opened before)
    let seen = false;
    try { seen = localStorage.getItem('obiimy_chat_seen') === '1'; } catch {}
    if (!seen) {
      setTimeout(() => greeter.classList.add('show'), 1500);
      setTimeout(() => greeter.classList.remove('show'), 8500);
    }

    renderAll();
  }

  init();
})();
