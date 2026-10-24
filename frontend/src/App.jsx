import { useCallback, useEffect, useRef, useState } from 'react';

const ACTION_HEADERS = { 'Content-Type': 'application/json', 'X-Requested-With': 'YugiAgent' };
// Replace this value with a direct video URL or a YouTube/Vimeo link for the hero preview.
const PREVIEW_VIDEO_URL = 'ADD_YOUR_VIDEO_LINK_HERE';
const SERVICES = [
  { id: 'calendar', icon: '◷', name: 'Google Calendar', detail: 'Find events, check availability, and manage meetings.' },
  { id: 'meet', icon: '◉', name: 'Google Meet', detail: 'Authorize Meet links through Google Calendar.' },
  { id: 'gmail', icon: '✉', name: 'Gmail', detail: 'Search messages and view their sender, subject, and snippet.' },
  { id: 'drive', icon: '▱', name: 'Google Drive', detail: 'Search files and read supported file details.' }
];

async function parseError(response) {
  let data = {};
  try { data = await response.json(); } catch { /* response may not contain JSON */ }
  if (data.signInRequired) window.location.assign('/auth/google');
  return data.error || `The server returned an error (${response.status}).`;
}

function useAccount() {
  const [account, setAccount] = useState({ loading: true, authenticated: false, user: null, error: '' });
  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/auth/me', { cache: 'no-store' });
      if (!response.ok) throw new Error('Could not check sign-in status.');
      const data = await response.json();
      setAccount({ loading: false, authenticated: Boolean(data.authenticated), user: data.user || null, error: '' });
    } catch {
      setAccount({ loading: false, authenticated: false, user: null, error: 'Yugi could not reach the account service. Check that the server and MongoDB are running.' });
    }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  return [account, refresh];
}

function Brand({ light = false }) {
  return <a href="/" className={`inline-flex items-center gap-2 font-display text-lg font-extrabold tracking-tight ${light ? 'text-white' : 'text-ink'}`} aria-label="Yugi home"><span className="grid size-8 place-items-center rounded-xl rounded-bl-sm bg-lime text-sm font-black text-ink">y</span>yugi</a>;
}

function Header({ user, onSignOut, theme, onTheme, app = false }) {
  const [menu, setMenu] = useState(false);
  const [mobile, setMobile] = useState(false);
  return <header className={`site-header ${app ? 'site-header-app' : ''}`}>
    <div className="mx-auto flex h-[72px] w-full max-w-[1380px] items-center justify-between px-5 md:px-9">
      <Brand />
      <nav className={`${mobile ? 'flex' : 'hidden'} absolute left-0 right-0 top-[72px] z-40 flex-col gap-1 border-b border-line bg-panel p-4 md:static md:flex md:flex-row md:items-center md:gap-8 md:border-0 md:bg-transparent md:p-0`}>
        {app ? <><a className="nav-item" href="/">Home</a><a className="nav-item" href="/cli">Yugi chat</a><a className="nav-item" href="/connections">Connections</a></> : <><a className="nav-item" href="#how-it-works">How it works</a><a className="nav-item" href="/cli">Yugi chat</a><a className="nav-item" href="/connections">Connections</a></>}
      </nav>
      <div className="flex items-center gap-2">
        <button type="button" onClick={onTheme} className="icon-button hidden sm:grid" aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}>{theme === 'dark' ? '☼' : '◐'}</button>
        {user ? <div className="relative">
          <button type="button" onClick={() => setMenu(!menu)} className="account-button" aria-expanded={menu}><Avatar user={user} /><span className="hidden max-w-28 truncate sm:block">{user.name || user.email}</span><span className="text-dim">⌄</span></button>
          {menu && <div className="account-popover"><strong>{user.name}</strong><span>{user.email}</span><button onClick={onSignOut}>Sign out</button></div>}
        </div> : <a className="button button-accent !min-h-10 !px-4 !text-xs" href="/auth/google">Get started <span>↗</span></a>}
        <button type="button" className="icon-button md:hidden" onClick={() => setMobile(!mobile)} aria-label="Toggle navigation">{mobile ? '×' : '☰'}</button>
      </div>
    </div>
  </header>;
}

function Avatar({ user }) {
  const [failed, setFailed] = useState(false);
  const validPhoto = user?.picture && /^https:\/\/(?:[^/]+\.)?googleusercontent\.com\//.test(user.picture);
  return <span className="avatar">{validPhoto && !failed ? <img src={user.picture} alt="" onError={() => setFailed(true)} /> : (user?.name || user?.email || 'Y').trim().charAt(0).toUpperCase()}</span>;
}

function useTheme() {
  const [theme, setTheme] = useState(() => localStorage.getItem('yugi-theme-v2') || 'light');
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('yugi-theme-v2', theme);
  }, [theme]);
  return [theme, () => setTheme((current) => current === 'dark' ? 'light' : 'dark')];
}

function Landing({ user, onTheme, theme, onSignOut }) {
  const sceneRef = useRef(null);
  const previewRef = useRef(null);
  const copyRef = useRef(null);
  const [videoError, setVideoError] = useState(false);
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return undefined;
    let frame = 0;
    const update = () => {
      frame = 0;
      const rect = scene.getBoundingClientRect();
      const progress = Math.max(0, Math.min(1, -rect.top / Math.max(1, scene.offsetHeight - innerHeight)));
      previewRef.current?.style.setProperty('--scroll-progress', progress.toFixed(4));
      copyRef.current?.style.setProperty('--scroll-progress', progress.toFixed(4));
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    addEventListener('scroll', schedule, { passive: true });
    addEventListener('resize', schedule);
    update();
    return () => { removeEventListener('scroll', schedule); removeEventListener('resize', schedule); cancelAnimationFrame(frame); };
  }, []);

  const videoUrl = PREVIEW_VIDEO_URL;
  const validPreview = videoUrl && videoUrl !== 'ADD_YOUR_VIDEO_LINK_HERE';
  const embedUrl = (() => {
    if (!validPreview) return '';
    try {
      const url = new URL(videoUrl);
      if (!['http:', 'https:'].includes(url.protocol)) return '';
      const host = url.hostname.replace(/^www\./, '');
      if (host === 'youtu.be') return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(url.pathname.slice(1))}?autoplay=1&mute=1&loop=1&playlist=${encodeURIComponent(url.pathname.slice(1))}`;
      if (host === 'youtube.com' || host === 'm.youtube.com') {
        const id = url.searchParams.get('v');
        return id ? `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?autoplay=1&mute=1&loop=1&playlist=${encodeURIComponent(id)}` : '';
      }
      if (host === 'vimeo.com') return `https://player.vimeo.com/video/${url.pathname.match(/\d+/)?.[0] || ''}?autoplay=1&muted=1&loop=1`;
      return url.href;
    } catch { return ''; }
  })();
  const isEmbed = embedUrl.includes('youtube-nocookie.com') || embedUrl.includes('player.vimeo.com');

  return <>
    <Header user={user} theme={theme} onTheme={onTheme} onSignOut={onSignOut} />
    <main>
      <section className="landing-scene" id="how-it-works" ref={sceneRef}>
        <div className="landing-sticky">
          <div className="cosmos-bg" aria-hidden="true"><span className="cosmos-glow" /><span className="cosmos-orbit orbit-a" /><span className="cosmos-orbit orbit-b" /><span className="cosmos-grid" /></div>
          <div className="landing-copy" ref={copyRef}>
            <div className="eyebrow"><span className="pulse-dot" /> PERSONAL AI · MADE FOR YOUR DAY</div>
            <h1>Yugi <span>AI agent.</span></h1>
            <p>Your personal AI assistant, helping you manage tasks and make smarter decisions.</p>
            <div className="mt-7 flex flex-wrap items-center justify-center gap-4"><a href="/auth/google" className="button button-accent">Get started <span>↗</span></a><a href="/cli" className="button button-quiet">Open the CLI <span>→</span></a></div>
          </div>
          <div className="scroll-window" ref={previewRef}>
            <div className="product-window">
              <div className="product-bar"><Brand /><span className="product-context">YOUR PERSONAL WORKSPACE</span><span className="product-live"><i /> READY</span></div>
              <div className="product-screen">
                <aside className="product-sidebar"><small>WORKSPACE</small><b className="active">⌂ &nbsp; Overview</b><b>◷ &nbsp; Your day</b><b>⌁ &nbsp; Conversations</b><b>⚙ &nbsp; Preferences</b><div className="product-profile"><span>Y</span> Your Yugi assistant</div></aside>
                <div className="product-dashboard"><div className="dash-head"><div><small>YOUR DAY, AT A GLANCE</small><h2>Good morning.</h2><p>What would you like to focus on?</p></div><span className="sparkle">✳</span></div><div className="dash-cards"><div className="dash-card"><small>ON YOUR MIND</small><span className="dash-lines"><i /><i /><i /></span><em>✦ &nbsp; Tasks, made simpler</em></div><div className="dash-card dash-lilac"><small>A LITTLE MORE CLARITY</small><strong>One thing<br />at a time<span>↗</span></strong></div></div><div className="fake-prompt">＋ &nbsp; Ask Yugi anything… <b>↑</b></div></div>
              </div>
              {validPreview && isEmbed && <iframe className="preview-video" src={embedUrl} title="Yugi video preview" allow="autoplay; fullscreen; picture-in-picture" referrerPolicy="strict-origin-when-cross-origin" allowFullScreen />}
              {validPreview && !isEmbed && embedUrl && <video className="preview-video" src={embedUrl} autoPlay muted loop playsInline onError={() => setVideoError(true)} />}
              {videoError && <div className="video-error">That video link could not be played. Try a direct MP4 or a YouTube/Vimeo link.</div>}
              <div className="product-caption"><span>YUGI · YOUR PERSONAL AI ASSISTANT</span><span>SCROLL TO EXPLORE ↓</span></div>
            </div>
          </div>
          <div className="landing-footer-line"><span>YUGI — PERSONAL AI</span><span><i /> SCROLL TO EXPLORE</span><span>01 / 01</span></div>
        </div>
      </section>
      <section className="landing-followup"><div className="max-w-6xl"><div className="eyebrow"><span className="pulse-dot" /> YOUR PERSONAL AI ASSISTANT</div><h2>Manage tasks.<br /><span>Make smarter decisions.</span></h2><div className="followup-meta"><span>YUGI · PERSONAL AI</span><a href="/cli" className="button button-outline">Open the CLI <span>↗</span></a></div></div></section>
    </main>
    <Footer />
  </>;
}

function Footer() {
  return <footer className="site-footer"><Brand /><span>Your personal AI assistant.</span><a href="/connections">Google connections <span>↗</span></a></footer>;
}

function AuthGate({ error = '', connection = false }) {
  return <div className="auth-gate"><span className="gate-icon">{connection ? '⌘' : 'y'}</span><p className="eyebrow"><span className="pulse-dot" /> YOUR YUGI ACCOUNT</p><h1>{connection ? 'Connect your Google tools.' : 'Your AI, ready when you are.'}</h1><p>{error || (connection ? 'Sign in to Yugi before linking your Google services.' : 'Sign in to save and revisit your conversations.')}</p><a href="/auth/google" className="button button-accent">Continue with Google <span>↗</span></a><a href="/" className="text-link">Back to Yugi home</a></div>;
}

function SiteApp({ account, refreshAccount, theme, onTheme, onSignOut }) {
  const path = window.location.pathname.replace(/\/$/, '') || '/';
  if (path === '/cli' || path === '/cli.html') return <ChatApp account={account} refreshAccount={refreshAccount} theme={theme} onTheme={onTheme} onSignOut={onSignOut} />;
  if (path === '/connections' || path === '/integrations.html') return <ConnectionsApp account={account} theme={theme} onTheme={onTheme} onSignOut={onSignOut} />;
  return <Landing user={account.user} theme={theme} onTheme={onTheme} onSignOut={onSignOut} />;
}

function ChatApp({ account, refreshAccount, theme, onTheme, onSignOut }) {
  const [messages, setMessages] = useState([]);
  const [chats, setChats] = useState([]);
  const [chatId, setChatId] = useState('');
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('Ready');
  const [error, setError] = useState('');
  const [audioBusy, setAudioBusy] = useState({});
  const scroller = useRef(null);
  const inputRef = useRef(null);
  const controller = useRef(null);
  const sent = useRef([]);
  const sentPosition = useRef(0);

  const loadChats = useCallback(async () => {
    const response = await fetch('/api/conversations', { cache: 'no-store' });
    if (!response.ok) throw new Error(await parseError(response));
    const data = await response.json();
    setChats(data.conversations || []);
  }, []);
  useEffect(() => { if (account.authenticated) loadChats().catch((err) => setStatus(err.message)); }, [account.authenticated, loadChats]);
  useEffect(() => { if (scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight; }, [messages]);

  const loadChat = async (id) => {
    if (!id) { setChatId(''); setMessages([]); return; }
    try {
      const response = await fetch(`/api/conversations/${encodeURIComponent(id)}`, { cache: 'no-store' });
      if (!response.ok) throw new Error(await parseError(response));
      const data = await response.json();
      setChatId(data.conversation.id);
      setMessages(data.conversation.messages.map((message) => ({ ...message, content: cleanAnswer(message.content) })));
    } catch (err) { setStatus(err.message); }
  };

  const send = async (rawText) => {
    const text = rawText.trim();
    if (!text || busy) return;
    if (sent.current.at(-1) !== text) sent.current.push(text);
    sentPosition.current = sent.current.length;
    setInput(''); setError(''); setBusy(true); setStatus('Thinking…');
    const next = [...messages, { role: 'user', content: text }, { role: 'assistant', content: '', streaming: true }];
    setMessages(next);
    const abort = new AbortController(); controller.current = abort;
    let raw = ''; let pending = '';
    const render = () => setMessages((rows) => rows.map((row, index) => index === rows.length - 1 ? { ...row, content: cleanAnswer(raw) } : row));
    try {
      const response = await fetch('/api/chat', { method: 'POST', headers: ACTION_HEADERS, body: JSON.stringify({ message: text, conversationId: chatId || null, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }), signal: abort.signal });
      if (!response.ok) throw new Error(await parseError(response));
      setChatId(response.headers.get('X-Conversation-Id') || chatId);
      if (!response.body?.getReader) { raw = await response.text(); render(); }
      else {
        const reader = response.body.getReader(); const decoder = new TextDecoder();
        const consume = (final = false) => {
          let split;
          while ((split = pending.indexOf('\n\n')) >= 0) { appendSse(pending.slice(0, split), (chunk) => { raw += chunk; }); pending = pending.slice(split + 2); render(); }
          if (final && pending.trim()) appendSse(pending, (chunk) => { raw += chunk; });
          if (final) pending = '';
        };
        while (true) { const chunk = await reader.read(); if (chunk.done) { pending += decoder.decode(); consume(true); break; } pending += decoder.decode(chunk.value, { stream: true }); consume(); }
      }
      setMessages((rows) => rows.map((row, index) => index === rows.length - 1 ? { ...row, content: cleanAnswer(raw).trim() || '(no reply)', streaming: false } : row));
      setStatus('Ready');
      loadChats().catch(() => {});
    } catch (err) {
      if (err.name === 'AbortError') { setStatus('Reply stopped'); setMessages((rows) => rows.filter((_, index) => index !== rows.length - 1 || rows[index].content).map((row) => ({ ...row, streaming: false }))); }
      else { setError(err.message || 'Could not reach Yugi. Check the server and MongoDB.'); setStatus('Connection issue'); setMessages((rows) => rows.filter((row) => !row.streaming)); }
    } finally { controller.current = null; setBusy(false); }
  };

  const startNew = () => { controller.current?.abort(); setChatId(''); setMessages([]); setInput(''); setError(''); setStatus('Ready'); inputRef.current?.focus(); };
  const deleteChat = async () => {
    if (!chatId || busy) return;
    const title = chats.find((chat) => chat.id === chatId)?.title || 'this conversation';
    if (!window.confirm(`Permanently delete “${title}” and its messages? This cannot be undone.`)) return;
    try { const response = await fetch(`/api/conversations/${encodeURIComponent(chatId)}`, { method: 'DELETE', headers: ACTION_HEADERS, body: '{}' }); if (!response.ok && response.status !== 204) throw new Error(await parseError(response)); startNew(); await loadChats(); setStatus('Conversation deleted'); }
    catch (err) { setStatus(err.message); }
  };
  const speak = async (index, text) => {
    setAudioBusy((state) => ({ ...state, [index]: true }));
    try { const response = await fetch('/api/tts', { method: 'POST', headers: ACTION_HEADERS, body: JSON.stringify({ text }) }); if (!response.ok) throw new Error(await parseError(response)); const blob = await response.blob(); const url = URL.createObjectURL(blob); const audio = new Audio(url); audio.onended = () => URL.revokeObjectURL(url); await audio.play(); }
    catch (err) { setStatus(err.message || 'Speech generation failed.'); }
    finally { setAudioBusy((state) => ({ ...state, [index]: false })); }
  };
  const submit = (event) => { event.preventDefault(); if (busy) { controller.current?.abort(); return; } send(input); };
  const keyDown = (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); submit(event); }
    else if (event.key === 'Escape' && busy) controller.current?.abort();
    else if (event.key === 'ArrowUp' && !input.includes('\n') && sentPosition.current > 0) { event.preventDefault(); sentPosition.current--; setInput(sent.current[sentPosition.current]); }
    else if (event.key === 'ArrowDown' && !input.includes('\n') && sentPosition.current < sent.current.length) { event.preventDefault(); sentPosition.current++; setInput(sentPosition.current < sent.current.length ? sent.current[sentPosition.current] : ''); }
  };

  if (account.loading) return <LoadingScreen />;
  if (!account.authenticated) return <div className="min-h-screen app-shell"><Header theme={theme} onTheme={onTheme} app /><main className="grid min-h-[calc(100vh-72px)] place-items-center p-5"><AuthGate error={account.error} /></main></div>;
  return <div className="min-h-screen app-shell"><Header user={account.user} theme={theme} onTheme={onTheme} app onSignOut={onSignOut} />
    <main className="chat-layout">
      <aside className="chat-rail"><div className="rail-label">WORKSPACE</div><a href="/" className="rail-link">⌂ <span>Home</span></a><a href="/cli" className="rail-link rail-active">◌ <span>Yugi chat</span></a><a href="/connections" className="rail-link">⌘ <span>Connections</span></a><div className="rail-divider"/><div className="rail-section-title"><span>RECENT CHATS</span><button onClick={startNew} aria-label="Start a new chat">＋</button></div><div className="rail-chats">{chats.map((chat) => <button className={`rail-chat ${chat.id === chatId ? 'rail-chat-selected' : ''}`} key={chat.id} onClick={() => loadChat(chat.id)}>{chat.title || 'New conversation'}</button>)}</div><div className="rail-account"><Avatar user={account.user}/><span><b>{account.user.name}</b><small>Personal workspace</small></span></div></aside>
      <section className="chat-main"><div className="chat-toolbar"><div><span className="chat-brand-spark">✳</span><div><h1>Yugi chat</h1><p>Your personal AI assistant</p></div></div><div className="chat-toolbar-actions"><span className="connection-status"><i/> {status}</span><button className="tool-button" onClick={startNew}>＋ <span>New chat</span></button><button className="tool-button tool-danger" onClick={deleteChat} disabled={!chatId || busy}>⌫ <span>Delete</span></button></div></div>
        <div className="chat-thread" ref={scroller} role="log" aria-live="polite" aria-busy={busy}>
          {!messages.length && <div className="welcome-block"><span className="welcome-icon">✳</span><span className="eyebrow">YOUR PERSONAL AI</span><h2>What’s on your mind?</h2><p>Your personal AI assistant. Ask a question or describe what you're working on.</p><div className="suggestion-row"><button onClick={() => setInput('Help me plan my day')}>Help me plan my day <span>↗</span></button><button onClick={() => setInput('What can you help me with?')}>What can you help me with? <span>↗</span></button></div></div>}
          {messages.map((message, index) => <article className={`message-row ${message.role === 'user' ? 'message-user' : message.role === 'error' ? 'message-error' : ''}`} key={`${index}-${message.role}`}><div className="message-avatar">{message.role === 'user' ? (account.user.name || 'Y').charAt(0).toUpperCase() : '✳'}</div><div className="message-content"><div className="message-meta">{message.role === 'user' ? 'YOU' : 'YUGI'} {message.streaming && <span>THINKING…</span>}</div><p>{message.content || (message.streaming ? <span className="typing-dots">•••</span> : '')}</p>{message.role === 'assistant' && message.content && !message.streaming && <button className="listen-button" onClick={() => speak(index, message.content)} disabled={audioBusy[index]}>{audioBusy[index] ? 'Preparing audio…' : '♫ Listen'}</button>}</div></article>)}
          {error && <div className="chat-error"><span>!</span>{error}</div>}
        </div>
        <div className="composer-wrap"><form className="chat-composer" onSubmit={submit}><textarea ref={inputRef} value={input} onChange={(event) => { setInput(event.target.value); event.target.style.height = 'auto'; event.target.style.height = `${Math.min(event.target.scrollHeight, 160)}px`; }} onKeyDown={keyDown} placeholder="Message Yugi…" rows={1} maxLength={12000} /><div className="composer-bottom"><span>Enter to send · Shift + Enter for a new line · Esc to stop</span><button type="submit" className={busy ? 'send-stop' : ''} disabled={!busy && !input.trim()}>{busy ? 'Stop' : 'Send'} <span>{busy ? '■' : '↑'}</span></button></div></form><p className="composer-disclaimer">Yugi can make mistakes. Check important information.</p></div>
      </section>
      <aside className="chat-context"><div className="context-card"><span className="context-kicker">A LITTLE MORE ROOM</span><div className="context-orbit">✳</div><h2>One thought<br/>at a time.</h2><p>Bring your questions, plans, and everyday tasks into one conversation.</p><a href="/connections">Connect Google tools <span>↗</span></a></div><div className="context-footer">PRIVATE BY DESIGN <span>●</span></div></aside>
    </main>
  </div>;
}

function cleanAnswer(raw = '') {
  let text = raw.replace(/<think>[\s\S]*?<\/think>/g, '');
  const open = text.indexOf('<think>'); if (open !== -1) text = text.slice(0, open);
  return text.replace(/<(?:\/?(?:t(?:h(?:i(?:n(?:k)?)?)?)?)?)?$/, '').replace(/^(\s*)\*\s+/gm, '$1• ').replace(/(\d)\*(?=\d)/g, '$1×').replace(/\*/g, '').replace(/^\s+/, '');
}
function appendSse(eventText, onChunk) {
  const data = eventText.replace(/\r/g, '').split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).replace(/^ /, '')).join('\n');
  if (!data || data === '[DONE]') return;
  const event = JSON.parse(data);
  if (event.error) throw new Error(event.error);
  if (typeof event.content === 'string') onChunk(event.content);
}

function ConnectionsApp({ account, theme, onTheme, onSignOut }) {
  const [connections, setConnections] = useState({});
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    const response = await fetch('/api/google/connections', { cache: 'no-store' });
    if (!response.ok) throw new Error(await parseError(response));
    const data = await response.json(); setConnections(data.connections || {});
  }, []);
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('google') === 'connected') setStatus('Google service connected.');
    if (params.get('google') === 'failed') setStatus('Google connection did not complete. Please try again.');
    if (account.authenticated) load().catch((err) => setError(err.message));
  }, [account.authenticated, load]);
  const disconnect = async (service) => {
    setBusy(service); setError('');
    try { const response = await fetch(`/api/google/connections/${service}`, { method: 'DELETE', headers: ACTION_HEADERS, body: '{}' }); if (!response.ok && response.status !== 204) throw new Error(await parseError(response)); await load(); }
    catch (err) { setError(err.message); }
    finally { setBusy(''); }
  };
  if (account.loading) return <LoadingScreen />;
  if (!account.authenticated) return <div className="min-h-screen app-shell"><Header theme={theme} onTheme={onTheme} app/><main className="grid min-h-[calc(100vh-72px)] place-items-center p-5"><AuthGate error={account.error} connection /></main></div>;
  return <div className="min-h-screen app-shell"><Header user={account.user} theme={theme} onTheme={onTheme} app onSignOut={onSignOut}/><main className="connections-layout"><aside className="connections-rail"><span>YOUR WORKSPACE</span><a href="/">⌂ &nbsp; Home</a><a href="/cli">◌ &nbsp; Yugi chat</a><a className="rail-active" href="/connections">⌘ &nbsp; Connections</a><div className="rail-hint"><b>Connected tools</b><p>Choose which Google services Yugi can use on your behalf.</p></div></aside><section className="connections-main"><div className="connections-heading"><div><span className="eyebrow"><span className="pulse-dot"/> YOUR WORKSPACE</span><h1>Connect your tools.</h1><p>Link the Google services you want Yugi to use. Google will show the access requested before you approve.</p></div><div className="google-mark">G</div></div>{status && <div className="status-banner">✓ &nbsp; {status}</div>}{error && <div className="error-banner">{error}</div>}<div className="service-grid">{SERVICES.map((service) => { const connected = Boolean(connections[service.id]?.connected); return <article key={service.id} className={`service-card ${connected ? 'service-connected' : ''}`}><div className="service-card-top"><span className={`service-icon ${service.id}`}>{service.icon}</span><span className={`service-state ${connected ? 'state-connected' : ''}`}><i/>{connected ? 'Connected' : 'Not connected'}</span></div><h2>{service.name}</h2><p>{service.detail}</p>{connected && connections[service.id]?.email && <small className="connected-email">{connections[service.id].email}</small>}<div className="service-actions">{connected ? <><a href={`/auth/google/connect/${service.id}`} className="button button-outline">Reconnect <span>↗</span></a><button className="text-link" disabled={busy === service.id} onClick={() => disconnect(service.id)}>{busy === service.id ? 'Disconnecting…' : 'Disconnect'}</button></> : <a href={`/auth/google/connect/${service.id}`} className="button button-accent">Connect {service.name.replace('Google ', '')} <span>↗</span></a>}</div></article>; })}</div><div className="privacy-note"><span>◇</span><p><b>Your connections stay in your control.</b><br/>You can disconnect a service at any time. Google handles the sign-in and permission approval.</p></div></section></main></div>;
}

function LoadingScreen() { return <main className="grid min-h-screen place-items-center app-shell"><div className="loading-mark">✳<span>YUGI</span></div></main>; }

export default function App() {
  const [account, refreshAccount] = useAccount();
  const [theme, toggleTheme] = useTheme();
  useEffect(() => {
    document.title = window.location.pathname.startsWith('/cli') ? 'Yugi chat — Yugi' : ['/connections', '/integrations.html'].includes(window.location.pathname) ? 'Connections — Yugi' : 'Yugi — Your personal AI assistant';
  }, []);
  const signOut = async () => { try { await fetch('/api/auth/logout', { method: 'POST', headers: ACTION_HEADERS, body: '{}' }); } finally { await refreshAccount(); window.location.assign('/'); } };
  return <SiteApp account={account} refreshAccount={refreshAccount} theme={theme} onTheme={toggleTheme} onSignOut={signOut} />;
}
