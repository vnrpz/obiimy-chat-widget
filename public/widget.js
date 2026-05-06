/* === Obiimy Chat Widget — vanilla JS, embeddable === */
(function () {
  if (window.__obiimyChatLoaded) return;
  window.__obiimyChatLoaded = true;

  // === Config ===
  const API_BASE = (window.__OBIIMY_API_BASE__ || (function () {
    const me = document.currentScript || document.querySelector('script[src*="widget.js"]');
    if (me) return new URL(me.src).origin;
    return '';
  })()).replace(/\/$/, '');

  const POSITION = window.__OBIIMY_POSITION__ || 'right';
  const MODE = window.__OBIIMY_MODE__ || 'bubble'; // 'bubble' | 'fullscreen'
  const STORAGE_KEY = 'obiimy_chat_v2';
  const MAX_HISTORY = 50;

  const QUICK_REPLIES = [
    'Які розміри хустинок?',
    'Як замовити доставку?',
    'Чи є подарункові набори?',
    'Як потрапити в шоурум?'
  ];

  const SVG = {
    chat: '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 3C6.48 3 2 6.81 2 11.5c0 2.27 1.06 4.34 2.8 5.86L4 21l4.16-1.69c1.18.41 2.47.69 3.84.69 5.52 0 10-3.81 10-8.5S17.52 3 12 3z" stroke="currentColor" stroke-width="2" stroke-linejoin="round" fill="rgba(255,255,255,.18)"/><circle cx="8.5" cy="11.5" r="1.2" fill="currentColor"/><circle cx="12" cy="11.5" r="1.2" fill="currentColor"/><circle cx="15.5" cy="11.5" r="1.2" fill="currentColor"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6l-12 12"/></svg>',
    send:  '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3.4 20.4l17.4-7.5c.8-.4.8-1.5 0-1.8L3.4 3.6c-.7-.3-1.4.4-1.2 1.1L4 11.5l13 .5L4 12.5l-1.8 6.8c-.2.7.5 1.4 1.2 1.1z"/></svg>'
  };

  // === Markdown renderer ===
  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function md(text) {
    // Strip [[SCENE:...]] markers BEFORE escaping (they're rendered separately)
    const cleaned = text.replace(/\[\[SCENE:[a-z0-9_]+\]\]/gi, '').trim();
    let s = escapeHtml(cleaned);
    s = s.replace(/`([^`\n]+)`/g, '<code>$1</code>');
    s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    s = s.replace(/(^|\s)(https?:\/\/[^\s<]+)/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>');
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
    s = s.split(/\n{2,}/).map(p => /<(ul|ol|li|p|strong|em|code|a)/.test(p) ? p : '<p>' + p.replace(/\n/g, '<br>') + '</p>').join('');
    return s;
  }

  // === Persistence ===
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

  // === Mobile viewport fix (iOS Safari dynamic toolbar) ===
  function setAppHeight() {
    document.documentElement.style.setProperty('--ob-app-height', window.innerHeight + 'px');
  }

  // === DOM build ===
  function build() {
    const root = document.createElement('div');
    root.id = 'obiimy-chat-root';
    root.className = 'ob-' + MODE;
    if (POSITION === 'left') root.classList.add('left');
    const headerLogoUrl = API_BASE + '/assets/logo.webp';
    root.innerHTML = `
      ${MODE === 'bubble' ? `
        <div class="ob-greeter" id="ob-greeter" role="status" aria-hidden="true">
          <button class="ob-close" id="ob-greeter-close" aria-label="Закрити">×</button>
          Вітаю в Обіймах 🫂💛<br>
          Я Вікторія, рада допомогти ✨
        </div>
      ` : ''}
      <div class="ob-panel${MODE === 'fullscreen' ? ' open ob-panel-fs' : ''}" id="ob-panel" role="dialog" aria-label="Чат з Вікторією">
        <div class="ob-header">
          <div class="ob-logo-wrap">
            <img class="ob-logo" src="${headerLogoUrl}" alt="Обійми" onerror="this.style.display='none'">
          </div>
          <div class="ob-htext">
            <div class="ob-name">Вікторія · Обійми</div>
            <div class="ob-status">онлайн</div>
          </div>
          ${MODE === 'bubble' ? `<button class="ob-hclose" id="ob-hclose" aria-label="Згорнути">${SVG.close}</button>` : ''}
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
      ${MODE === 'bubble' ? `<button class="ob-bubble pulse" id="ob-bubble" aria-label="Відкрити чат">${SVG.chat}</button>` : ''}
    `;
    document.body.appendChild(root);
    return root;
  }

  function init() {
    if (!document.body) return document.addEventListener('DOMContentLoaded', init, { once: true });
    setAppHeight();
    window.addEventListener('resize', setAppHeight);
    window.addEventListener('orientationchange', setAppHeight);
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', setAppHeight);
    }

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
    let scenarios = {};

    // Fetch scenarios manifest
    fetch(API_BASE + '/api/scenarios').then(r => r.json()).then(j => { scenarios = j; }).catch(() => {});

    function pushMsg(role, content) {
      state.msgs.push({ role, content, t: Date.now() });
      saveHistory(state);
    }

    function makeMsgEl(role) {
      const wrap = document.createElement('div');
      wrap.className = 'ob-msg ' + role + ' ob-pop';
      if (role === 'bot') {
        wrap.innerHTML = `<div class="ob-mavt"><img src="${API_BASE}/assets/logo.webp" alt="" onerror="this.style.display='none';this.parentNode.textContent='В'"></div><div class="ob-bubble-msg"></div>`;
      } else {
        wrap.innerHTML = `<div class="ob-bubble-msg"></div>`;
      }
      body.appendChild(wrap);
      return wrap;
    }
    function appendUser(text) {
      const el = makeMsgEl('user');
      el.querySelector('.ob-bubble-msg').textContent = text;
      return el;
    }
    function appendBot(text) {
      const el = makeMsgEl('bot');
      const c = el.querySelector('.ob-bubble-msg');
      c.innerHTML = md(text);
      return el;
    }
    function appendScene(key) {
      const sc = scenarios[key];
      if (!sc) return null;
      const wrap = document.createElement('div');
      wrap.className = 'ob-msg bot ob-pop ob-msg-scene';
      const isCarousel = sc.images.length > 1;
      const grid = sc.images.map((src, i) =>
        `<img class="ob-scene-img" src="${API_BASE}${src}" alt="${escapeHtml(sc.title)} ${i+1}" loading="lazy">`
      ).join('');
      wrap.innerHTML = `
        <div class="ob-mavt"><img src="${API_BASE}/assets/logo.webp" alt="" onerror="this.style.display='none';this.parentNode.textContent='В'"></div>
        <div class="ob-scene${isCarousel ? ' ob-scene-grid' : ''}">${grid}</div>
      `;
      // Lightbox on click
      wrap.querySelectorAll('.ob-scene-img').forEach(img => img.addEventListener('click', () => openLightbox(img.src)));
      body.appendChild(wrap);
      return wrap;
    }
    function openLightbox(src) {
      const lb = document.createElement('div');
      lb.className = 'ob-lightbox';
      lb.innerHTML = `<img src="${src}" alt=""><button class="ob-lb-close" aria-label="Закрити">×</button>`;
      lb.addEventListener('click', () => lb.remove());
      document.body.appendChild(lb);
    }
    function appendQuickReplies() {
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
    function appendFollowUps(suggestions) {
      // suggestions: array of strings
      if (!suggestions || !suggestions.length) return;
      const q = document.createElement('div');
      q.className = 'ob-quicks ob-followups ob-pop';
      suggestions.slice(0, 3).forEach(s => {
        const b = document.createElement('button');
        b.className = 'ob-quick';
        b.textContent = s;
        b.onclick = () => { input.value = s; sendMessage(); };
        q.appendChild(b);
      });
      body.appendChild(q);
    }
    function clearQuicks() {
      document.querySelectorAll('.ob-quicks').forEach(el => el.remove());
    }
    function scrollBottom() { body.scrollTop = body.scrollHeight; }
    function showTyping() {
      const wrap = document.createElement('div');
      wrap.className = 'ob-msg bot';
      wrap.id = 'ob-typing';
      wrap.innerHTML = `<div class="ob-mavt"><img src="${API_BASE}/assets/logo.webp" alt="" onerror="this.style.display='none';this.parentNode.textContent='В'"></div><div class="ob-typing"><span></span><span></span><span></span></div>`;
      body.appendChild(wrap);
      scrollBottom();
      return wrap;
    }
    function killTyping() {
      const t = document.getElementById('ob-typing'); if (t) t.remove();
    }

    // Welcome typewriter (only if no history yet)
    function welcomeTypewriter(onDone) {
      const text = 'Вітаю в Обіймах 🫂💛\nЯ Вікторія, рада допомогти ✨\nПідкажіть, що вас цікавить?';
      const el = makeMsgEl('bot');
      const c = el.querySelector('.ob-bubble-msg');
      let i = 0;
      let buf = '';
      const tick = () => {
        if (i >= text.length) { onDone && onDone(); return; }
        buf += text[i++];
        c.innerHTML = md(buf);
        scrollBottom();
        setTimeout(tick, text[i-1] === '\n' ? 110 : 26);
      };
      tick();
    }

    function renderHistory() {
      body.innerHTML = '';
      if (!state.msgs.length) {
        welcomeTypewriter(() => appendQuickReplies());
        return;
      }
      // Re-render full history
      for (const m of state.msgs) {
        if (m.role === 'user') appendUser(m.content);
        else {
          // Bot history may have scenes intermixed
          const parts = splitContentByScene(m.content);
          for (const p of parts) {
            if (p.kind === 'text' && p.text.trim()) appendBot(p.text);
            else if (p.kind === 'scene') appendScene(p.key);
          }
        }
      }
      scrollBottom();
    }

    function splitContentByScene(text) {
      const re = /\[\[SCENE:([a-z0-9_]+)\]\]/gi;
      const out = [];
      let last = 0; let m;
      while ((m = re.exec(text))) {
        if (m.index > last) out.push({ kind: 'text', text: text.slice(last, m.index) });
        out.push({ kind: 'scene', key: m[1] });
        last = re.lastIndex;
      }
      if (last < text.length) out.push({ kind: 'text', text: text.slice(last) });
      return out;
    }

    // Detect inline scenes during streaming and render them as soon as the marker is complete
    function maybeFlushScene(state) {
      // state.acc is full accumulated text. Find any [[SCENE:KEY]] not already rendered.
      const re = /\[\[SCENE:([a-z0-9_]+)\]\]/gi;
      let m;
      while ((m = re.exec(state.acc))) {
        if (!state.renderedScenes.has(m.index)) {
          state.renderedScenes.add(m.index);
          // Close current bot bubble (if it has any visible text), render scene, open a new bubble
          if (state.botEl && state.botContentEl) {
            // If bubble has no rendered text yet, remove the empty one before scene
            const visible = (state.botContentEl.innerText || '').trim();
            if (!visible) state.botEl.remove();
          }
          appendScene(m[1]);
          // Reset bot bubble for subsequent text after the marker
          state.botEl = null; state.botContentEl = null;
          scrollBottom();
        }
      }
    }

    // Generate smart follow-up suggestions based on bot's last reply (heuristic, no extra API call)
    function suggestFollowups(text) {
      const t = text.toLowerCase();
      const ideas = [];
      if (/65×65|65\\65|розмір 65/i.test(text) && !/88/.test(text.toLowerCase())) ideas.push('А як виглядає 88×88?');
      if (/88×88|88\\88|розмір 88/i.test(text) && !/65/.test(text.toLowerCase())) ideas.push('А як виглядає 65×65?');
      if (/двосторонн/i.test(text)) ideas.push('Покажіть різницю в принтах');
      if (/принт/i.test(text)) ideas.push('Які є розміри?');
      if (/доставк/i.test(text)) ideas.push('Які умови оплати?');
      if (/оплат|реквізит|післяплат/i.test(text)) ideas.push('Чи є знижка від суми?');
      if (/комплект|твіллі|резинк|кільце|маск|тюрбан|наволочк/i.test(text)) ideas.push('Покажіть аксесуари до хустинки');
      if (/подарунок|подарунк/i.test(text)) ideas.push('Покажіть оформлення подарунка');
      if (/шоурум|сагайдачн|графік/i.test(text)) ideas.push('А як замовити онлайн?');
      // Default fallback
      if (!ideas.length) ideas.push('Покажіть каталог принтів', 'Які є розміри хустинок?');
      return Array.from(new Set(ideas)).slice(0, 2);
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

      showTyping();
      const stream = {
        acc: '',
        botEl: null,
        botContentEl: null,
        renderedScenes: new Set()
      };

      try {
        const r = await fetch(API_BASE + '/api/chat', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ messages: state.msgs.map(m => ({ role: m.role, content: m.content })), sessionId: state.sid })
        });

        if (!r.ok) {
          if (r.status === 429) {
            const j = await r.json().catch(() => ({}));
            killTyping();
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
                if (!stream.botEl) {
                  killTyping();
                  stream.botEl = makeMsgEl('bot');
                  stream.botContentEl = stream.botEl.querySelector('.ob-bubble-msg');
                }
                stream.acc += data.t;
                stream.botContentEl.innerHTML = md(stream.acc);
                maybeFlushScene(stream);
                scrollBottom();
              } else if (evName === 'regenerate') {
                stream.acc = '';
                stream.renderedScenes.clear();
                if (stream.botEl) { stream.botEl.remove(); stream.botEl = null; stream.botContentEl = null; }
                if (!document.getElementById('ob-typing')) showTyping();
                scrollBottom();
              } else if (evName === 'error') {
                if (!stream.botEl) {
                  killTyping();
                  stream.botEl = makeMsgEl('bot');
                  stream.botContentEl = stream.botEl.querySelector('.ob-bubble-msg');
                }
                stream.botContentEl.innerHTML = md(data.message || 'Щось пішло не так 💛');
              }
            } catch {}
          }
        }
        if (stream.acc) {
          pushMsg('assistant', stream.acc);
          appendFollowUps(suggestFollowups(stream.acc));
        }
        else { killTyping(); appendBot('Вибачте, не вдалось отримати відповідь 💛 спробуєте ще раз? ✨'); }
      } catch (e) {
        killTyping();
        appendBot('Здається, у мене стався збій звʼязку 💛 спробуйте, будь ласка, ще раз ✨');
      } finally {
        busy = false;
        send.disabled = !input.value.trim();
        scrollBottom();
      }
    }

    // === Event wiring ===
    function openPanel() {
      panel.classList.add('open');
      if (greeter) greeter.classList.remove('show');
      if (bubble) bubble.classList.remove('pulse');
      try { localStorage.setItem('obiimy_chat_seen', '1'); } catch {}
      setTimeout(() => input.focus(), 200);
    }
    function closePanel() { panel.classList.remove('open'); }

    if (bubble) bubble.addEventListener('click', openPanel);
    if (hclose) hclose.addEventListener('click', closePanel);
    if (greeterClose) greeterClose.addEventListener('click', e => { e.stopPropagation(); greeter.classList.remove('show'); });

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
      if (e.key === 'Escape' && MODE === 'bubble' && panel.classList.contains('open')) closePanel();
    });

    if (MODE === 'bubble') {
      let seen = false;
      try { seen = localStorage.getItem('obiimy_chat_seen') === '1'; } catch {}
      if (!seen) {
        setTimeout(() => greeter && greeter.classList.add('show'), 1500);
        setTimeout(() => greeter && greeter.classList.remove('show'), 8500);
      }
    }

    renderHistory();
  }

  init();
})();
