(function () {
  "use strict";
  var services = [
    { id: "calendar", icon: "◷", name: "Google Calendar", detail: "Find events, check availability, and manage meetings." },
    { id: "meet", icon: "◉", name: "Google Meet", detail: "Create standalone Google Meet links from chat." },
    { id: "gmail", icon: "✉", name: "Gmail", detail: "Search messages and view their sender, subject, and snippet." },
    { id: "drive", icon: "◱", name: "Google Drive", detail: "Search files and read supported file details." }
  ];
  var grid = document.getElementById("serviceGrid");
  var message = document.getElementById("connectionsMessage");
  var signIn = document.getElementById("connectionsSignIn") || document.getElementById("signIn");
  var accountName = document.getElementById("connectionsAccountName") || document.getElementById("accountName");
  var agentSetup = document.getElementById("agentLinkSetup");
  var agentLinkForm = document.getElementById("agentLinkForm");
  var agentLinkCode = document.getElementById("agentLinkCode");
  var agentLinks = document.getElementById("agentLinks");
  var headers = { "Content-Type": "application/json", "X-Requested-With": "YugiAgent" };
  var connections = {};
  function showMessage(text, isError) {
    message.textContent = text; message.hidden = !text; message.classList.toggle("is-error", Boolean(isError));
  }
  function render() {
    grid.replaceChildren();
    services.forEach(function (service) {
      var linked = Boolean(connections[service.id] && connections[service.id].connected);
      var card = document.createElement("article"); card.className = "service-card" + (linked ? " is-connected" : "");
      var top = document.createElement("div"); top.className = "service-card-top";
      var icon = document.createElement("span"); icon.className = "service-icon"; icon.textContent = service.icon;
      var state = document.createElement("span"); state.className = "service-state"; state.textContent = linked ? "Connected" : "Not connected";
      top.append(icon, state);
      var title = document.createElement("h2"); title.textContent = service.name;
      var detail = document.createElement("p"); detail.textContent = service.detail;
      card.append(top, title, detail);
      if (linked && connections[service.id].email) { var email = document.createElement("p"); email.className = "connected-email"; email.textContent = connections[service.id].email; card.append(email); }
      var actions = document.createElement("div"); actions.className = "service-actions";
      var connect = document.createElement("a"); connect.className = "btn-solid btn-small"; connect.href = "/auth/google/connect/" + service.id + (document.getElementById("cliConnectionsPanel") ? "?returnTo=%2Fcli" : ""); connect.textContent = linked ? "Reconnect" : "Connect"; actions.append(connect);
      if (linked) { var disconnect = document.createElement("button"); disconnect.className = "btn-link"; disconnect.type = "button"; disconnect.textContent = "Disconnect"; disconnect.addEventListener("click", function () { disconnectService(service.id, disconnect); }); actions.append(disconnect); }
      card.append(actions); grid.append(card);
    });
  }
  function disconnectService(id, button) {
    button.disabled = true; button.textContent = "Disconnecting…"; showMessage("");
    fetch("/api/google/connections/" + id, { method: "DELETE", headers: headers, body: "{}" }).then(function (response) {
      if (!response.ok && response.status !== 204) return response.json().then(function (data) { throw new Error(data.error || "Could not disconnect this service."); });
      connections[id] = { connected: false }; render(); showMessage("Google service disconnected.");
    }).catch(function (error) { button.disabled = false; button.textContent = "Disconnect"; showMessage(error.message || "Could not reach Yugi. Try again.", true); });
  }
  function loadAgentLinks() {
    return fetch("/api/agent/links", { cache: "no-store" }).then(function (response) {
      if (!response.ok) throw new Error("Could not load linked Yugi agents."); return response.json();
    }).then(function (data) {
      agentLinks.replaceChildren();
      (data.agents || []).forEach(function (agent) {
        var row = document.createElement("div"); row.className = "agent-link-item";
        var address = document.createElement("code"); address.textContent = agent.agentAddress;
        var remove = document.createElement("button"); remove.type = "button"; remove.className = "btn-link"; remove.textContent = "Unlink";
        remove.addEventListener("click", function () {
          remove.disabled = true;
          fetch("/api/agent/links/" + encodeURIComponent(agent.agentAddress), { method: "DELETE", headers: headers, body: "{}" }).then(function (response) {
            if (!response.ok && response.status !== 204) throw new Error("Could not unlink this agent.");
            row.remove(); showMessage("Yugi agent unlinked.");
          }).catch(function (error) { remove.disabled = false; showMessage(error.message, true); });
        });
        row.append(address, remove); agentLinks.append(row);
      });
    });
  }
  if (agentLinkForm) agentLinkForm.addEventListener("submit", function (event) {
    event.preventDefault();
    var button = agentLinkForm.querySelector("button[type=submit]"); button.disabled = true;
    fetch("/api/agent/links", { method: "POST", headers: headers, body: JSON.stringify({ code: agentLinkCode.value }) }).then(function (response) {
      return response.json().then(function (data) { if (!response.ok) throw new Error(data.error || "Could not link the agent."); return data; });
    }).then(function () { agentLinkCode.value = ""; showMessage("Yugi agent linked to your account."); return loadAgentLinks(); })
      .catch(function (error) { showMessage(error.message || "Could not link the agent.", true); })
      .finally(function () { button.disabled = false; });
  });
  var params = new URLSearchParams(location.search);
  if (params.get("google") === "connected") showMessage("Google service connected.");
  else if (params.get("google") === "failed") showMessage("Google connection did not complete. Please try again.", true);
  fetch("/api/auth/me", { cache: "no-store" }).then(function (response) {
    if (!response.ok) throw new Error("Could not check sign-in status."); return response.json();
  }).then(function (data) {
    if (!data.authenticated) { if (signIn) signIn.hidden = false; if (agentSetup) agentSetup.hidden = true; services.forEach(function (service) { connections[service.id] = { connected: false }; }); render(); return; }
    if (agentSetup) agentSetup.hidden = false;
    if (accountName) { accountName.textContent = data.user.name || data.user.email || "Signed in"; accountName.hidden = false; }
    return fetch("/api/google/connections", { cache: "no-store" }).then(function (response) {
      if (!response.ok) throw new Error("Could not load your Google connections."); return response.json();
    }).then(function (data) { connections = data.connections || {}; render(); return loadAgentLinks(); });
  }).catch(function (error) { showMessage(error.message || "Yugi could not reach the account service.", true); });
})();
