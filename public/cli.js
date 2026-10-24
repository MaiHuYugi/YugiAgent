/** Yugi CLI: authenticated chat client with server-side conversation history. */
(function () {
  "use strict";

  var scroller = document.getElementById("scroller");
  var thread = document.getElementById("thread");
  var form = document.getElementById("chatForm");
  var input = document.getElementById("chatInput");
  var sendBtn = document.getElementById("sendBtn");
  var statusEl = document.getElementById("status");
  var newChatBtn = document.getElementById("newChat");
  var historySelect = document.getElementById("savedChats");
  var signOutBtn = document.getElementById("signOut");
  var profileMenu = document.getElementById("profileMenu");
  var profileToggle = document.getElementById("profileToggle");
  var profileCard = document.getElementById("profileCard");
  var accountName = document.getElementById("accountName");
  var chatSidebar = document.getElementById("chatSidebar");
  var profileName = document.getElementById("profileName");
  var profileEmail = document.getElementById("profileEmail");
  var profilePicture = document.getElementById("profilePicture");
  var profileInitials = document.getElementById("profileInitials");
  var chatWindow = document.querySelector(".cli-window");
  var authGate = document.getElementById("authGate");
  var authError = document.getElementById("authError");
  var connectionsPanel = document.getElementById("cliConnectionsPanel");
  var showConnections = document.getElementById("showConnections");
  var backToChat = document.getElementById("backToChat");
  if (!scroller || !thread || !form || !input || !sendBtn) return;

  if (connectionsPanel && showConnections && backToChat) {
    showConnections.addEventListener("click", function () { chatWindow.hidden = true; connectionsPanel.hidden = false; });
    backToChat.addEventListener("click", function () { connectionsPanel.hidden = true; chatWindow.hidden = false; });
  }

  var API_URL = "/api/chat";
  var ACTION_HEADERS = { "Content-Type": "application/json", "X-Requested-With": "YugiAgent" };
  var MAX_CONTEXT = 40;
  var conversationId = null;
  var messages = [];
  var sent = [];
  var sentPos = 0;
  var busy = false;
  var controller = null;
  var activeAudio = null;
  var activeAudioUrl = "";
  var activeListenButton = null;
  var activeSpeechRequest = null;
  var speechToken = 0;

  function setStatus(text) { if (statusEl) statusEl.textContent = text; }
  function getTimeZone() {
    try {
      var zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      return zone === "Asia/Calcutta" ? "Asia/Kolkata" : (zone || "Asia/Kolkata");
    } catch (_) {
      return "Asia/Kolkata";
    }
  }
  function nearBottom() { return scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80; }
  function scrollToEnd() { scroller.scrollTop = scroller.scrollHeight; }
  function autoGrow() {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 160) + "px";
  }
  function clean(raw) {
    var text = raw.replace(/<think>[\s\S]*?<\/think>/g, "");
    var open = text.indexOf("<think>");
    if (open !== -1) text = text.slice(0, open);
    text = text.replace(/<(?:\/?(?:t(?:h(?:i(?:n(?:k)?)?)?)?)?)?$/, "");
    return text.replace(/\*/g, "").replace(/^\s+/, "");
  }
  function setBusy(on) {
    busy = on;
    scroller.setAttribute("aria-busy", on ? "true" : "false");
    sendBtn.textContent = on ? "Stop" : "Send";
    sendBtn.classList.toggle("btn-solid", !on);
    sendBtn.classList.toggle("btn-outline", on);
    if (!on) setStatus("ready");
  }
  function renderWelcome() {
    var banner = document.createElement("div");
    banner.className = "term-banner";
    banner.textContent = "YUGI";
    var intro = document.createElement("p");
    intro.className = "term-intro";
    intro.textContent = "Your personal AI agent. Ask a question or describe what you're working on.";
    thread.appendChild(banner);
    thread.appendChild(intro);
  }
  function addMessage(role, text) {
    var row = document.createElement("div");
    row.className = "msg msg-" + (role === "user" ? "user" : role === "error" ? "err" : "ai");
    var label = document.createElement("span");
    label.className = "msg-label";
    label.textContent = role === "user" ? "you ›" : "yugi ›";
    var body = document.createElement("div");
    body.className = "msg-body";
    body.textContent = clean(text || "");
    row.appendChild(label);
    row.appendChild(body);
    thread.appendChild(row);
    return { row: row, body: body };
  }
  function stopSpeech() {
    speechToken += 1;
    if (activeSpeechRequest) activeSpeechRequest.abort();
    if (activeAudio) { activeAudio.onended = null; activeAudio.onerror = null; activeAudio.pause(); }
    if (activeAudioUrl) URL.revokeObjectURL(activeAudioUrl);
    if (activeListenButton) {
      activeListenButton.disabled = false;
      activeListenButton.textContent = "Listen";
      activeListenButton.setAttribute("aria-pressed", "false");
    }
    activeSpeechRequest = null;
    activeAudio = null;
    activeAudioUrl = "";
    activeListenButton = null;
  }
  function finishSpeech(token) {
    if (token !== speechToken) return;
    if (activeAudioUrl) URL.revokeObjectURL(activeAudioUrl);
    if (activeListenButton) {
      activeListenButton.disabled = false;
      activeListenButton.textContent = "Listen";
      activeListenButton.setAttribute("aria-pressed", "false");
    }
    activeSpeechRequest = null;
    activeAudio = null;
    activeAudioUrl = "";
    activeListenButton = null;
  }
  function addListenControl(row, text) {
    if (!text || !text.trim()) return;
    var button = document.createElement("button");
    button.type = "button";
    button.className = "listen-button";
    button.textContent = "Listen";
    button.disabled = text.length > 8000;
    button.setAttribute("aria-pressed", "false");
    if (button.disabled) button.title = "Replies over 8,000 characters cannot be read aloud.";
    button.addEventListener("click", function () {
      if (button.disabled) return;
      if (activeListenButton === button) { stopSpeech(); return; }
      stopSpeech();
      var token = speechToken;
      var request = new AbortController();
      activeSpeechRequest = request;
      activeListenButton = button;
      button.textContent = "Preparing audio...";
      button.setAttribute("aria-pressed", "true");
      fetch("/api/tts", {
        method: "POST",
        headers: ACTION_HEADERS,
        body: JSON.stringify({ text: text }),
        signal: request.signal
      }).then(function (response) {
        if (!response.ok) return readError(response).then(function (error) { throw new Error(error); });
        return response.blob();
      }).then(function (blob) {
        if (token !== speechToken) return;
        activeSpeechRequest = null;
        activeAudioUrl = URL.createObjectURL(blob);
        activeAudio = new Audio(activeAudioUrl);
        var player = activeAudio;
        button.textContent = "Stop audio";
        player.addEventListener("ended", function () { finishSpeech(token); }, { once: true });
        player.addEventListener("error", function () { finishSpeech(token); }, { once: true });
        return player.play();
      }).catch(function (error) {
        if (token !== speechToken || error.name === "AbortError") return;
        finishSpeech(token);
        setStatus(error.message || "Speech generation failed.");
      });
    });
    row.appendChild(button);
  }
  function clearThread() {
    stopSpeech();
    while (thread.firstChild) thread.removeChild(thread.firstChild);
    messages = [];
  }
  function resetThread() {
    if (controller) controller.abort();
    conversationId = null;
    clearThread();
    renderWelcome();
    updateHistorySelection();
    setBusy(false);
    input.value = "";
    autoGrow();
    input.focus({ preventScroll: true });
  }
  function readError(res) {
    return res.json().then(
      function (data) {
        if (data && data.signInRequired) window.location.assign("/auth/google");
        return (data && data.error) || "The server returned an error (" + res.status + ").";
      },
      function () { return "The server returned an error (" + res.status + ")."; }
    );
  }
  function consumeEvent(eventText, onChunk, onProgress) {
    var data = eventText.replace(/\r/g, "").split("\n")
      .filter(function (line) { return line.indexOf("data:") === 0; })
      .map(function (line) { return line.slice(5).replace(/^ /, ""); })
      .join("\n");
    if (!data || data === "[DONE]") return;
    var event = JSON.parse(data);
    if (event.error) throw new Error(event.error);
    if (typeof event.progress === "string" && onProgress) onProgress(event.progress);
    if (typeof event.content === "string") onChunk(event.content);
  }
  function loadConversation(id) {
    if (busy || !id) return;
    fetch("/api/conversations/" + encodeURIComponent(id), { cache: "no-store" })
      .then(function (res) {
        if (!res.ok) return readError(res).then(function (error) { throw new Error(error); });
        return res.json();
      })
      .then(function (data) {
        conversationId = data.conversation.id;
        updateHistorySelection();
        clearThread();
        data.conversation.messages.forEach(function (message) {
          messages.push({ role: message.role, content: message.content });
          var rendered = addMessage(message.role, message.content);
          if (message.role === "assistant") addListenControl(rendered.row, clean(message.content));
        });
        scrollToEnd();
        input.focus({ preventScroll: true });
      })
      .catch(function (error) { setStatus(error.message || "Could not load conversation."); });
  }
  function refreshHistory() {
    if (!historySelect) return Promise.resolve();
    return fetch("/api/conversations", { cache: "no-store" })
      .then(function (res) {
        if (!res.ok) return readError(res).then(function (error) { throw new Error(error); });
        return res.json();
      })
      .then(function (data) {
        historySelect.replaceChildren();
        if (!data.conversations.length) {
          var empty = document.createElement("p");
          empty.className = "chat-history-empty";
          empty.textContent = "Your saved chats will appear here.";
          historySelect.appendChild(empty);
        }
        data.conversations.forEach(function (conversation) {
          var row = document.createElement("div");
          row.className = "chat-history-row";
          var item = document.createElement("button");
          item.type = "button";
          item.className = "chat-history-item";
          item.dataset.conversationId = conversation.id;
          item.textContent = conversation.title || "New conversation";
          item.addEventListener("click", function () { loadConversation(conversation.id); });
          var remove = document.createElement("button");
          remove.type = "button";
          remove.className = "chat-history-delete";
          remove.textContent = "×";
          remove.title = "Delete " + (conversation.title || "conversation");
          remove.setAttribute("aria-label", remove.title);
          remove.addEventListener("click", function () { deleteHistoryConversation(conversation.id, conversation.title, remove); });
          row.append(item, remove);
          historySelect.appendChild(row);
        });
        updateHistorySelection();
      });
  }
  function updateHistorySelection() {
    if (!historySelect) return;
    historySelect.querySelectorAll("[data-conversation-id]").forEach(function (item) {
      var selected = item.dataset.conversationId === conversationId;
      item.classList.toggle("is-selected", selected);
      item.setAttribute("aria-current", selected ? "true" : "false");
    });
  }
  function deleteHistoryConversation(id, title, button) {
    if (busy) { setStatus("Stop the current reply before deleting a chat."); return; }
    if (!window.confirm('Delete "' + (title || "this conversation") + '" and its messages? This cannot be undone.')) return;
    button.disabled = true;
    fetch("/api/conversations/" + encodeURIComponent(id), {
      method: "DELETE",
      headers: ACTION_HEADERS,
      body: "{}"
    }).then(function (res) {
      if (!res.ok && res.status !== 204) return readError(res).then(function (error) { throw new Error(error); });
      if (conversationId === id) resetThread();
      return refreshHistory();
    }).then(function () { setStatus("Conversation deleted"); })
      .catch(function (error) { button.disabled = false; setStatus(error.message || "Could not delete conversation."); });
  }
  function initialize() {
    var params = new URLSearchParams(window.location.search);
    if (authError && params.get("auth") === "failed") authError.hidden = false;
    fetch("/api/auth/me", { cache: "no-store" })
      .then(function (res) {
        if (!res.ok) throw new Error("Could not check sign-in status.");
        return res.json();
      })
      .then(function (data) {
        if (!data.authenticated) {
          if (chatWindow) chatWindow.hidden = true;
          if (authGate) authGate.hidden = false;
          return;
        }
        var displayName = data.user.name || (data.user.email || "").split("@")[0] || "Yugi user";
        if (accountName) accountName.textContent = displayName;
        if (profileName) profileName.textContent = displayName;
        if (profileEmail) profileEmail.textContent = data.user.email || "";
        if (profileInitials) profileInitials.textContent = displayName.trim().charAt(0).toUpperCase() || "Y";
        if (profileMenu) profileMenu.hidden = false;
        if (profilePicture && data.user.picture) {
          try {
            var pictureUrl = new URL(data.user.picture);
            if (pictureUrl.protocol === "https:" && (pictureUrl.hostname === "googleusercontent.com" || pictureUrl.hostname.endsWith(".googleusercontent.com"))) {
              profilePicture.src = pictureUrl.href;
              profilePicture.hidden = false;
              if (profileInitials) profileInitials.hidden = true;
              profilePicture.addEventListener("error", function () {
                profilePicture.hidden = true;
                if (profileInitials) profileInitials.hidden = false;
              }, { once: true });
            }
          } catch (_) { /* Invalid profile image URL: show initials instead. */ }
        }
        renderWelcome();
        if (chatSidebar) chatSidebar.hidden = false;
        if (new URLSearchParams(window.location.search).get("view") === "connections" && chatWindow && connectionsPanel) {
          chatWindow.hidden = true;
          connectionsPanel.hidden = false;
        }
        return refreshHistory().catch(function (error) { setStatus(error.message); });
      })
      .catch(function () {
        if (chatWindow) chatWindow.hidden = true;
        if (authGate) {
          authGate.hidden = false;
          var text = authGate.querySelector("p");
          if (text) text.textContent = "Yugi could not reach the account service. Make sure the server and MongoDB are running.";
        }
      });
  }

  function send(text) {
    text = text.trim();
    if (!text || busy) return;
    if (sent[sent.length - 1] !== text) sent.push(text);
    sentPos = sent.length;
    messages.push({ role: "user", content: text });
    addMessage("user", text);
    var reply = addMessage("assistant", "");
    reply.body.classList.add("is-streaming");
    scrollToEnd();
    controller = new AbortController();
    var raw = "";
    var stopped = false;
    var pending = "";
    setBusy(true);
    setStatus("thinking…");

    function render() {
      var stick = nearBottom();
      var visible = clean(raw);
      reply.body.textContent = visible;
      if (visible) setStatus("replying…");
      if (stick) scrollToEnd();
    }

    fetch(API_URL, {
      method: "POST",
      headers: ACTION_HEADERS,
      body: JSON.stringify({ message: text, conversationId: conversationId, timezone: getTimeZone() }),
      signal: controller.signal
    }).then(function (res) {
      if (!res.ok) return readError(res).then(function (error) { throw new Error(error); });
      conversationId = res.headers.get("X-Conversation-Id") || conversationId;
      if (!res.body || !res.body.getReader) return res.text().then(function (value) { raw = value; render(); });
      var reader = res.body.getReader();
      var decoder = new TextDecoder();
      function consumePending(final) {
        var separator;
        while ((separator = pending.indexOf("\n\n")) !== -1) {
          consumeEvent(pending.slice(0, separator), function (chunk) { raw += chunk; render(); }, setStatus);
          pending = pending.slice(separator + 2);
        }
        if (final && pending.trim()) consumeEvent(pending, function (chunk) { raw += chunk; render(); }, setStatus);
        if (final) pending = "";
      }
      function pump() {
        return reader.read().then(function (result) {
          if (result.done) {
            pending += decoder.decode();
            consumePending(true);
            return;
          }
          pending += decoder.decode(result.value, { stream: true });
          consumePending(false);
          return pump();
        });
      }
      return pump();
    }).catch(function (error) {
      if (error && error.name === "AbortError") { stopped = true; return; }
      var message = error && error.message && error.message !== "Failed to fetch"
        ? error.message
        : "Couldn't reach Yugi. Check that the server and MongoDB are running.";
      if (reply.row.parentNode) reply.row.parentNode.removeChild(reply.row);
      var errorMessage = addMessage("error", message);
      errorMessage.row.classList.add("msg-err");
      messages.pop();
      input.value = text;
      autoGrow();
      raw = "";
      scrollToEnd();
    }).then(function () {
      reply.body.classList.remove("is-streaming");
      var answer = clean(raw).trim();
      if (answer) {
        messages.push({ role: "assistant", content: answer });
        addListenControl(reply.row, answer);
        if (stopped) {
          var note = document.createElement("span");
          note.className = "term-muted";
          note.textContent = "\n(stopped)";
          reply.body.appendChild(note);
        }
        refreshHistory().catch(function () {});
      } else if (stopped) {
        if (reply.row.parentNode) reply.row.parentNode.removeChild(reply.row);
        messages.pop();
        input.value = text;
        autoGrow();
      } else if (reply.row.parentNode) {
        reply.body.textContent = "(no reply)";
        reply.body.classList.add("term-muted");
        messages.pop();
      }
      controller = null;
      setBusy(false);
      scrollToEnd();
      input.focus({ preventScroll: true });
    });
  }

  function stop() { if (controller) controller.abort(); }
  form.addEventListener("submit", function (event) {
    event.preventDefault();
    if (busy) { stop(); return; }
    var text = input.value;
    input.value = "";
    autoGrow();
    send(text);
  });
  input.addEventListener("input", autoGrow);
  input.addEventListener("keydown", function (event) {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      form.requestSubmit();
    } else if (event.key === "Escape" && busy) {
      event.preventDefault();
      stop();
    } else if (event.key === "ArrowUp" && input.value.indexOf("\n") === -1 && sentPos > 0) {
      event.preventDefault();
      sentPos--;
      input.value = sent[sentPos];
      autoGrow();
    } else if (event.key === "ArrowDown" && input.value.indexOf("\n") === -1 && sentPos < sent.length) {
      event.preventDefault();
      sentPos++;
      input.value = sentPos < sent.length ? sent[sentPos] : "";
      autoGrow();
    }
  });
  scroller.addEventListener("click", function () {
    var selection = window.getSelection && window.getSelection().toString();
    if (!selection) input.focus({ preventScroll: true });
  });
  if (newChatBtn) newChatBtn.addEventListener("click", resetThread);
  if (profileToggle && profileCard) profileToggle.addEventListener("click", function () {
    var isOpen = profileCard.hidden;
    profileCard.hidden = !isOpen;
    profileToggle.setAttribute("aria-expanded", String(isOpen));
  });
  document.addEventListener("click", function (event) {
    if (profileMenu && profileCard && profileToggle && !profileMenu.contains(event.target)) {
      profileCard.hidden = true;
      profileToggle.setAttribute("aria-expanded", "false");
    }
  });
  if (signOutBtn) signOutBtn.addEventListener("click", function () {
    signOutBtn.disabled = true;
    fetch("/api/auth/logout", { method: "POST", headers: ACTION_HEADERS, body: "{}" })
      .finally(function () { window.location.assign("/"); });
  });

  initialize();
  var coarse = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
  if (!coarse) input.focus({ preventScroll: true });
})();
