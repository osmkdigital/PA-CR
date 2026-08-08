/* =========================================================
   ROYAL FLUSH — CRM console script
   Real Supabase auth + data. Every section reads from (and the
   relevant sections write to) the same Supabase project as the
   storefront — see supabase-setup.sql and supabase-crm-update.sql.
   ========================================================= */
(function () {
  "use strict";

  function $(id) { return document.getElementById(id); }
  function fmt$(n) { return "$" + Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function fmtUSDT(n) { return Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 }) + " USDT"; }

  /* ---------------- Supabase ---------------- */
  var SUPABASE_URL = "https://voriexbapbrkhrfboqeh.supabase.co";
  var SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZvcmlleGJhcGJya2hyZmJvcWVoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU5NTM0MzIsImV4cCI6MjEwMTUyOTQzMn0.-eTDBFH5kOxqFKaA-I_syt3ZrIK78Fyccg8eD4JyAsc";

  var supabaseClient = null;
  if (window.supabase && typeof window.supabase.createClient === "function") {
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  } else {
    console.error("Supabase JS library not loaded.");
  }

  /* ticket catalog — keep prices/labels identical to tickets.html */
  var ticketTypes = [
    { key: "dagger",       name: "Dagger",       price: 2,   suit: "♥" },
    { key: "joker",        name: "Joker",        price: 5,   suit: "♠" },
    { key: "jack",         name: "Jack",         price: 10,  suit: "♣" },
    { key: "queen",        name: "Queen",        price: 15,  suit: "♦" },
    { key: "king",         name: "King",         price: 20,  suit: "♥" },
    { key: "black-dragon", name: "Black Dragon", price: 25,  suit: "♠" },
    { key: "red-dragon",   name: "Red Dragon",   price: 50,  suit: "♦" },
    { key: "straight",     name: "Straight",     price: 100, suit: "♣" },
    { key: "royal-flush",  name: "Royal Flush",  price: 200, suit: "♠" },
    { key: "x-card",       name: "X Card",       price: 10,  suit: "♦" }
  ];
  function gameByKey(key) {
    var g = ticketTypes.filter(function (t) { return t.key === key; })[0];
    return g || { key: key, name: key, price: 0, suit: "♦" };
  }
  function isToday(iso) {
    var d = new Date(iso), t = new Date();
    return d.getFullYear() === t.getFullYear() && d.getMonth() === t.getMonth() && d.getDate() === t.getDate();
  }
  function dayKey(iso) { return new Date(iso).toISOString().slice(0, 10); }

  /* in-memory cache, refreshed from Supabase on load / after writes */
  var state = {
    profile: null,
    clients: [],
    tickets: [],       // every row from public.tickets, embedded with the buyer's profile
    winningNumbers: {}, // { game_type: number } for today
    counters: [],       // public.ticket_counters
    payouts: [],
    emailLog: []
  };

  /* ---------------- LOGIN GATE ---------------- */
  var loginScreen = $("loginScreen"), adminApp = $("adminApp");

  function showLoginError(msg) {
    var el = $("loginError");
    el.textContent = msg;
    el.classList.add("show");
  }
  function clearLoginError() { $("loginError").classList.remove("show"); }

  async function enterConsole(session) {
    if (!session || !session.user) return false;
    var res = await supabaseClient.from("profiles").select("*").eq("id", session.user.id).maybeSingle();
    if (res.error || !res.data) {
      showLoginError("Could not load your profile. Try again.");
      await supabaseClient.auth.signOut();
      return false;
    }
    if (!res.data.is_admin) {
      showLoginError("This account doesn't have admin access. Ask an existing admin to grant it from the Supabase SQL editor.");
      await supabaseClient.auth.signOut();
      return false;
    }
    state.profile = res.data;
    var displayName = res.data.name || res.data.email || "Admin";
    $("miniName").textContent = displayName;
    $("miniAvatar").textContent = displayName.trim().charAt(0).toUpperCase();
    loginScreen.style.display = "none";
    adminApp.classList.add("show");
    await renderAll();
    return true;
  }

  $("loginForm").addEventListener("submit", async function (e) {
    e.preventDefault();
    clearLoginError();
    if (!supabaseClient) { showLoginError("Auth isn't configured."); return; }
    var email = $("loginEmail").value.trim();
    var password = $("loginPassword").value;
    if (!email || !password) { showLoginError("Enter your email and password."); return; }
    var btn = this.querySelector("button[type=submit]");
    btn.disabled = true;
    var res = await supabaseClient.auth.signInWithPassword({ email: email, password: password });
    if (res.error) { showLoginError(res.error.message || "Could not sign in."); btn.disabled = false; return; }
    var ok = await enterConsole(res.data.session);
    btn.disabled = false;
    if (ok) { $("loginForm").reset(); }
  });

  $("forgotBtn").addEventListener("click", function () {
    $("loginFormWrap").classList.add("hide");
    $("forgotPanel").classList.add("show");
  });
  $("backToLoginBtn").addEventListener("click", function () {
    $("forgotPanel").classList.remove("show");
    $("loginFormWrap").classList.remove("hide");
    $("forgotSuccess").classList.remove("show");
  });
  $("forgotForm").addEventListener("submit", async function (e) {
    e.preventDefault();
    if (!supabaseClient) return;
    var email = $("forgotEmail").value.trim();
    if (!email) return;
    var btn = this.querySelector("button[type=submit]");
    btn.disabled = true;
    var res = await supabaseClient.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin + window.location.pathname });
    btn.disabled = false;
    if (res.error) { toast(res.error.message || "Could not send reset email"); return; }
    $("forgotSuccess").classList.add("show");
  });

  $("logoutBtn").addEventListener("click", async function () {
    if (supabaseClient) await supabaseClient.auth.signOut();
    adminApp.classList.remove("show");
    loginScreen.style.display = "flex";
    $("loginForm").reset();
    $("forgotPanel").classList.remove("show");
    $("loginFormWrap").classList.remove("hide");
    showPage("dashboard");
  });

  /* restore an existing session on reload */
  if (supabaseClient) {
    supabaseClient.auth.getSession().then(function (res) {
      if (res.data && res.data.session) enterConsole(res.data.session);
    });
  }

  /* ---------------- THEME TOGGLE ---------------- */
  $("themeToggle").addEventListener("click", function () {
    var body = document.body;
    var next = body.getAttribute("data-theme") === "dark" ? "light" : "dark";
    body.setAttribute("data-theme", next);
    $("themeToggle").querySelector(".knob").textContent = next === "dark" ? "☾" : "☀";
  });

  /* ---------------- SIDEBAR (mobile) ---------------- */
  var sidebar = $("sidebar"), scrim = $("scrim");
  function openSidebar() { sidebar.classList.add("open"); scrim.classList.add("open"); }
  function closeSidebar() { sidebar.classList.remove("open"); scrim.classList.remove("open"); }
  $("sidebarToggle").addEventListener("click", openSidebar);
  $("sidebarClose").addEventListener("click", closeSidebar);
  scrim.addEventListener("click", closeSidebar);

  /* ---------------- NAVIGATION ---------------- */
  var pageMeta = {
    dashboard: ["Dashboard", "OVERVIEW · LIVE FROM SUPABASE"],
    orders: ["Orders", "ALL TICKET PURCHASES"],
    clients: ["Client Data & Login", "ACCOUNTS · PROFILES"],
    sales: ["Sales", "PERFORMANCE BY TICKET"],
    tickets: ["Today's Tickets", "DAILY COUNT · WINNING NUMBERS · DRAW RESET"],
    email: ["Email", "CLIENT COMMUNICATIONS"],
    payouts: ["Getting Paid", "BALANCE · SETTLEMENTS"]
  };
  function showPage(key) {
    document.querySelectorAll(".crm-nav button[data-page]").forEach(function (b) { b.classList.toggle("active", b.dataset.page === key); });
    document.querySelectorAll(".crm-page").forEach(function (p) { p.classList.remove("active"); });
    var target = $("page-" + key);
    if (target) target.classList.add("active");
    if (pageMeta[key]) { $("pageTitle").textContent = pageMeta[key][0]; $("pageSub").textContent = pageMeta[key][1]; }
    document.querySelector(".crm-content").scrollTo({ top: 0 });
    closeSidebar();
    refreshData(); // pick up anything that changed (e.g. a ticket bought) since the last load
  }
  document.querySelectorAll(".crm-nav button[data-page]").forEach(function (b) {
    b.addEventListener("click", function () { showPage(b.dataset.page); });
  });

  /* ---------------- DATA REFRESH ----------------
     renderAll() re-fetches every table from Supabase — nothing in
     the CRM is cached beyond the current page view. It runs once on
     login, again every time you switch pages (above), on demand via
     the refresh button, and on a background poll so a ticket bought
     on the storefront shows up here without a manual reload. */
  var isRefreshing = false;
  async function refreshData(silent) {
    if (isRefreshing || !state.profile) return;
    isRefreshing = true;
    var btn = $("refreshBtn");
    if (btn) btn.classList.add("spinning");
    try {
      await renderAll();
      if (!silent) toast("Data refreshed");
    } finally {
      isRefreshing = false;
      if (btn) btn.classList.remove("spinning");
    }
  }
  $("refreshBtn").addEventListener("click", function () { refreshData(false); });

  setInterval(function () {
    if (state.profile && document.visibilityState === "visible") refreshData(true);
  }, 20000);

  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible" && state.profile) refreshData(true);
  });

  /* ---------------- NOTIFICATIONS (derived from real recent activity) ---------------- */
  $("notifBtn").addEventListener("click", function (e) {
    e.stopPropagation();
    $("notifPop").classList.toggle("open");
  });
  document.addEventListener("click", function (e) {
    if (!e.target.closest(".notif-wrap")) $("notifPop").classList.remove("open");
  });
  function timeAgo(iso) {
    var mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return mins + " min ago";
    var hrs = Math.round(mins / 60);
    if (hrs < 24) return hrs + "h ago";
    return Math.round(hrs / 24) + "d ago";
  }
  function renderNotifications() {
    var items = state.tickets.slice(0, 5).map(function (t) {
      var buyer = (t.profiles && (t.profiles.name || t.profiles.email)) || "A player";
      var game = gameByKey(t.game_type);
      return { text: buyer + " bought " + t.ticket_code + " (" + game.name + ", " + fmt$(t.price) + ").", time: timeAgo(t.purchased_at) };
    });
    $("notifPopCount").textContent = items.length + " recent";
    $("notifPing").textContent = items.length;
    $("notifPing").style.display = items.length ? "flex" : "none";
    var wrap = $("notifList"); wrap.innerHTML = "";
    if (items.length === 0) { wrap.innerHTML = '<p class="cell-dim" style="padding:12px;margin:0;">No ticket purchases yet.</p>'; return; }
    items.forEach(function (n) {
      var el = document.createElement("div");
      el.className = "notif-item";
      el.innerHTML = '<span class="notif-dot"></span><div class="notif-text">' + n.text + '<span class="notif-time">' + n.time + "</span></div>";
      wrap.appendChild(el);
    });
  }

  /* ---------------- TOAST ---------------- */
  var toastTimer = null;
  function toast(msg) {
    var el = document.querySelector(".toast");
    if (!el) { el = document.createElement("div"); el.className = "toast"; document.body.appendChild(el); }
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove("show"); }, 2800);
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /* Renders a client-pasted transaction hash as a truncated mono
     value (so it fits on mobile without breaking the table) plus a
     one-tap Copy button that copies the full hash — used to verify
     payment against the chain without the admin retyping anything. */
  function txHashCell(hash) {
    if (!hash) return '<span class="cell-dim">—</span>';
    var safe = escapeHtml(hash);
    var short = hash.length > 16 ? escapeHtml(hash.slice(0, 8) + "…" + hash.slice(-6)) : safe;
    return '<div class="txhash-cell"><span class="mono txhash-val" title="' + safe + '">' + short + '</span>' +
      '<button type="button" class="txhash-copy" data-hash="' + safe + '" title="Copy full hash">Copy</button></div>';
  }

  function statusPill(status) {
    var label = status.charAt(0).toUpperCase() + status.slice(1);
    return '<span class="status-pill ' + status + '">' + label + "</span>";
  }

  /* ---------------- DATA LOADING ---------------- */
  async function loadClients() {
    var res = await supabaseClient.from("profiles").select("*").order("created_at", { ascending: false });
    if (res.error) { console.error(res.error); state.clients = []; return; }
    state.clients = res.data || [];
  }
  async function loadTickets() {
    var res = await supabaseClient.from("tickets").select("*, profiles(name, email)").order("purchased_at", { ascending: false });
    if (res.error) { console.error(res.error); state.tickets = []; return; }
    state.tickets = res.data || [];
  }
  async function loadWinningNumbers() {
    var todayStr = new Date().toISOString().slice(0, 10);
    var res = await supabaseClient.from("winning_numbers").select("game_type, number").eq("draw_date", todayStr);
    state.winningNumbers = {};
    if (res.error) { console.error(res.error); return; }
    (res.data || []).forEach(function (row) { state.winningNumbers[row.game_type] = row.number; });
  }
  async function loadCounters() {
    var res = await supabaseClient.from("ticket_counters").select("*");
    if (res.error) { console.error(res.error); state.counters = []; return; }
    state.counters = res.data || [];
  }
  async function loadPayouts() {
    var res = await supabaseClient.from("payouts").select("*").order("requested_at", { ascending: false });
    if (res.error) { console.error(res.error); state.payouts = []; return; }
    state.payouts = res.data || [];
  }
  async function loadEmailLog() {
    var res = await supabaseClient.from("email_log").select("*").order("sent_at", { ascending: false }).limit(25);
    if (res.error) { console.error(res.error); state.emailLog = []; return; }
    state.emailLog = res.data || [];
  }

  /* ---------------- DASHBOARD ---------------- */
  function todayTickets() { return state.tickets.filter(function (t) { return isToday(t.purchased_at); }); }
  function todayRevenue() { return todayTickets().reduce(function (s, t) { return s + Number(t.price); }, 0); }

  function renderDashboard() {
    var tt = todayTickets();
    var pendingPayouts = state.payouts.filter(function (p) { return p.status === "pending"; }).reduce(function (s, p) { return s + Number(p.amount); }, 0);
    var kpis = [
      { label: "Revenue Today", value: fmtUSDT(todayRevenue()), suit: "♦" },
      { label: "Tickets Sold Today", value: tt.length, suit: "♠" },
      { label: "Total Clients", value: state.clients.length, suit: "♥" },
      { label: "Pending Payouts", value: fmtUSDT(pendingPayouts), suit: "♣" }
    ];
    var wrap = $("kpiGrid"); wrap.innerHTML = "";
    kpis.forEach(function (k) {
      var el = document.createElement("div");
      el.className = "kpi-card";
      el.innerHTML = '<span class="kpi-suit">' + k.suit + '</span><div class="kpi-label">' + k.label + '</div><div class="kpi-value">' + k.value + "</div>";
      wrap.appendChild(el);
    });

    // last 7 calendar days revenue, built from real ticket rows
    var days = [];
    for (var i = 6; i >= 0; i--) {
      var d = new Date(); d.setDate(d.getDate() - i);
      days.push({ key: d.toISOString().slice(0, 10), label: i === 0 ? "Today" : d.toLocaleDateString(undefined, { weekday: "short" }), value: 0 });
    }
    state.tickets.forEach(function (t) {
      var k = dayKey(t.purchased_at);
      var day = days.filter(function (d) { return d.key === k; })[0];
      if (day) day.value += Number(t.price);
    });
    var max = Math.max.apply(null, days.map(function (d) { return d.value; }).concat([1]));
    var chart = $("revenueChart"); chart.innerHTML = "";
    days.forEach(function (d, i) {
      var h = Math.max(6, Math.round((d.value / max) * 140));
      var col = document.createElement("div");
      col.className = "bar-col" + (i === days.length - 1 ? " alt" : "");
      col.innerHTML = '<div class="bar" style="height:' + h + 'px;"><span class="bar-val">' + fmt$(d.value) + "</span></div>" +
        '<span class="bar-label">' + d.label + "</span>";
      chart.appendChild(col);
    });

    // top sellers today
    var countsToday = {};
    tt.forEach(function (t) { countsToday[t.game_type] = (countsToday[t.game_type] || 0) + 1; });
    var sorted = Object.keys(countsToday).sort(function (a, b) { return countsToday[b] - countsToday[a]; }).slice(0, 5);
    var ts = $("topSellers"); ts.innerHTML = "";
    if (sorted.length === 0) { ts.innerHTML = '<p class="cell-dim" style="margin:0;">No tickets sold yet today.</p>'; }
    sorted.forEach(function (key, i) {
      var game = gameByKey(key);
      var row = document.createElement("div");
      row.style.cssText = "display:flex;align-items:center;gap:12px;padding:10px 0;" + (i < sorted.length - 1 ? "border-bottom:1px solid var(--border-soft);" : "");
      row.innerHTML = '<span class="mono" style="color:var(--gold);font-size:1.05rem;width:20px;">' + game.suit + '</span>' +
        '<div style="flex:1;"><div style="font-weight:700;font-size:.85rem;">' + game.name + '</div>' +
        '<div class="cell-dim">' + fmt$(game.price) + ' / ticket</div></div>' +
        '<div class="mono" style="font-weight:700;">' + countsToday[key] + '</div>';
      ts.appendChild(row);
    });

    var tb = document.querySelector("#recentOrdersTable tbody"); tb.innerHTML = "";
    state.tickets.slice(0, 6).forEach(function (t) {
      var game = gameByKey(t.game_type);
      var buyer = (t.profiles && (t.profiles.name || t.profiles.email)) || "Player";
      var when = new Date(t.purchased_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
      var tr = document.createElement("tr");
      tr.innerHTML = "<td class=\"mono cell-strong\">" + t.ticket_code + "</td><td>" + buyer + "</td><td>" + game.name + "</td>" +
        "<td class=\"mono\">" + fmt$(t.price) + "</td><td>" + statusPill(t.status || "paid") + "</td><td class=\"cell-dim\">" + when + "</td>";
      tb.appendChild(tr);
    });
  }

  /* ---------------- ORDERS ---------------- */
  var orderFilterStatus = "all", orderSearchTerm = "";
  function renderOrders() {
    $("ordersCount").textContent = state.tickets.filter(function (t) { return (t.status || "paid") === "pending"; }).length;
    var tb = document.querySelector("#ordersTable tbody"); tb.innerHTML = "";
    var rows = state.tickets.filter(function (t) {
      var status = t.status || "paid";
      var matchStatus = orderFilterStatus === "all" || status === orderFilterStatus;
      var term = orderSearchTerm.toLowerCase();
      var buyer = (t.profiles && (t.profiles.name || t.profiles.email)) || "";
      var matchSearch = !term || t.ticket_code.toLowerCase().indexOf(term) > -1 || buyer.toLowerCase().indexOf(term) > -1;
      return matchStatus && matchSearch;
    });
    if (rows.length === 0) {
      tb.innerHTML = '<tr><td colspan="8" class="cell-dim" style="text-align:center;padding:30px;">No orders match that search.</td></tr>';
      return;
    }
    rows.forEach(function (t) {
      var game = gameByKey(t.game_type);
      var buyer = (t.profiles && (t.profiles.name || t.profiles.email)) || "Player";
      var status = t.status || "paid";
      var when = new Date(t.purchased_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
      var tr = document.createElement("tr");
      tr.innerHTML = "<td class=\"mono cell-strong\">" + t.ticket_code + "</td><td>" + buyer + "</td><td>" + game.name + "</td>" +
        "<td class=\"mono\">" + fmt$(t.price) + "</td><td>" + txHashCell(t.tx_hash) + "</td>" +
        "<td>" + statusPill(status) + "</td><td class=\"cell-dim\">" + when + "</td>" +
        '<td><div class="row-actions">' +
        (status !== "paid" ? '<button data-act="paid">Mark Paid</button>' : "") +
        (status !== "refunded" ? '<button data-act="refunded" class="danger">Refund</button>' : "") +
        "</div></td>";
      tr.querySelectorAll("[data-act]").forEach(function (btn) {
        btn.addEventListener("click", async function () {
          btn.disabled = true;
          var res = await supabaseClient.from("tickets").update({ status: btn.dataset.act }).eq("id", t.id);
          btn.disabled = false;
          if (res.error) { toast(res.error.message || "Could not update order"); return; }
          t.status = btn.dataset.act;
          renderOrders(); renderDashboard();
          toast("Order " + t.ticket_code + " updated to " + t.status + ".");
        });
      });
      var copyBtn = tr.querySelector(".txhash-copy");
      if (copyBtn) {
        copyBtn.addEventListener("click", function () {
          var hash = copyBtn.dataset.hash;
          navigator.clipboard?.writeText(hash);
          toast("Transaction hash copied");
        });
      }
      tb.appendChild(tr);
    });
  }
  document.querySelectorAll("#orderTabs .pill-tab").forEach(function (btn) {
    btn.addEventListener("click", function () {
      document.querySelectorAll("#orderTabs .pill-tab").forEach(function (b) { b.classList.remove("active"); });
      btn.classList.add("active");
      orderFilterStatus = btn.dataset.status;
      renderOrders();
    });
  });
  $("orderSearch").addEventListener("input", function () { orderSearchTerm = this.value; renderOrders(); });

  /* ---------------- CLIENTS ---------------- */
  var clientSearchTerm = "";
  function renderClients() {
    var tb = document.querySelector("#clientsTable tbody"); tb.innerHTML = "";
    var rows = state.clients.filter(function (c) {
      var term = clientSearchTerm.toLowerCase();
      var name = c.name || "", email = c.email || "";
      return !term || name.toLowerCase().indexOf(term) > -1 || email.toLowerCase().indexOf(term) > -1;
    });
    rows.forEach(function (c) {
      var joined = c.created_at ? new Date(c.created_at).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "—";
      var status = c.status || "active";
      var tr = document.createElement("tr");
      tr.innerHTML = "<td class=\"cell-strong\">" + (c.name || "—") + "<div class=\"cell-dim mono\">" + c.id.slice(0, 8) + "</div></td>" +
        "<td>" + (c.email || "—") + "</td><td class=\"cell-dim\">" + joined + "</td>" +
        "<td class=\"mono\">" + (c.tickets || 0) + "</td><td class=\"mono\">" + fmt$(c.spent) + "</td>" +
        "<td>" + statusPill(status) + "</td>" +
        '<td><div class="row-actions">' +
        '<button data-act="reset">Reset Pwd</button>' +
        (c.is_admin ? "" : '<button data-act="toggle" class="danger">' + (status === "active" ? "Suspend" : "Reactivate") + "</button>") +
        "</div></td>";
      tr.querySelectorAll("[data-act]").forEach(function (btn) {
        btn.addEventListener("click", async function () {
          if (btn.dataset.act === "reset") {
            if (!c.email) { toast("No email on file for this client."); return; }
            var res = await supabaseClient.auth.resetPasswordForEmail(c.email, { redirectTo: window.location.origin + "/index.html" });
            toast(res.error ? (res.error.message || "Could not send reset email") : "Password reset email sent to " + c.email);
            return;
          }
          var nextStatus = status === "active" ? "suspended" : "active";
          btn.disabled = true;
          var upd = await supabaseClient.from("profiles").update({ status: nextStatus }).eq("id", c.id);
          btn.disabled = false;
          if (upd.error) { toast(upd.error.message || "Could not update client"); return; }
          c.status = nextStatus;
          renderClients(); renderDashboard();
          toast((c.name || c.email) + " is now " + nextStatus + ".");
        });
      });
      tb.appendChild(tr);
    });

    var lb = document.querySelector("#loginsTable tbody"); lb.innerHTML = "";
    var withPayout = state.clients.filter(function (c) { return c.payout_usdt || c.payout_usdc; });
    if (withPayout.length === 0) {
      lb.innerHTML = '<tr><td colspan="3" class="cell-dim" style="text-align:center;padding:24px;">No clients have saved a payout address yet.</td></tr>';
    }
    withPayout.forEach(function (c) {
      var tr = document.createElement("tr");
      tr.innerHTML = "<td class=\"cell-strong\">" + (c.name || c.email || "Player") + "</td>" +
        "<td class=\"mono cell-dim\">" + (c.payout_usdt || "—") + "</td><td class=\"mono cell-dim\">" + (c.payout_usdc || "—") + "</td>";
      lb.appendChild(tr);
    });
  }
  $("clientSearch").addEventListener("input", function () { clientSearchTerm = this.value; renderClients(); });

  /* ---------------- SALES (all-time) ---------------- */
  function renderSales() {
    var countsAll = {}, revenueAll = {};
    ticketTypes.forEach(function (t) { countsAll[t.key] = 0; revenueAll[t.key] = 0; });
    state.tickets.forEach(function (t) {
      if (countsAll[t.game_type] === undefined) return; // skip redeemed/free codes
      countsAll[t.game_type] += 1;
      revenueAll[t.game_type] += Number(t.price);
    });
    var totalRevenue = state.tickets.reduce(function (s, t) { return s + Number(t.price); }, 0);
    var totalUnits = state.tickets.length;
    var avgOrder = totalUnits ? totalRevenue / totalUnits : 0;
    var best = ticketTypes.slice().sort(function (a, b) { return countsAll[b.key] - countsAll[a.key]; })[0];

    var kpis = [
      { label: "Revenue (All Time)", value: fmtUSDT(totalRevenue), suit: "♦" },
      { label: "Tickets Sold (All Time)", value: totalUnits, suit: "♠" },
      { label: "Avg. Ticket Price", value: fmtUSDT(Math.round(avgOrder)), suit: "♥" },
      { label: "Best Seller", value: best ? best.name : "—", suit: "♣" }
    ];
    var wrap = $("salesKpiGrid"); wrap.innerHTML = "";
    kpis.forEach(function (k) {
      var el = document.createElement("div"); el.className = "kpi-card";
      el.innerHTML = '<span class="kpi-suit">' + k.suit + '</span><div class="kpi-label">' + k.label + '</div><div class="kpi-value">' + k.value + "</div>";
      wrap.appendChild(el);
    });

    var max = Math.max.apply(null, ticketTypes.map(function (t) { return countsAll[t.key]; }).concat([1]));
    var chart = $("salesChart"); chart.innerHTML = "";
    ticketTypes.forEach(function (t) {
      var v = countsAll[t.key];
      var h = Math.max(6, Math.round((v / max) * 140));
      var col = document.createElement("div"); col.className = "bar-col";
      col.innerHTML = '<div class="bar" style="height:' + h + 'px;"><span class="bar-val">' + v + "</span></div>" +
        '<span class="bar-label">' + t.name.split(" ")[0] + "</span>";
      chart.appendChild(col);
    });

    var tb = document.querySelector("#salesTable tbody"); tb.innerHTML = "";
    ticketTypes.slice().sort(function (a, b) { return revenueAll[b.key] - revenueAll[a.key]; }).forEach(function (t) {
      var rev = revenueAll[t.key];
      var share = totalRevenue ? Math.round((rev / totalRevenue) * 100) : 0;
      var tr = document.createElement("tr");
      tr.innerHTML = "<td class=\"cell-strong\">" + t.suit + " " + t.name + "</td><td class=\"mono\">" + countsAll[t.key] + "</td>" +
        "<td class=\"mono\">" + fmtUSDT(rev) + "</td><td class=\"mono\">" + share + "%</td>";
      tb.appendChild(tr);
    });
  }

  /* ---------------- TODAY'S TICKETS & DRAW CONTROL ---------------- */
  function renderTodayTickets() {
    var tt = todayTickets();
    var countsToday = {};
    ticketTypes.forEach(function (t) { countsToday[t.key] = 0; });
    tt.forEach(function (t) { if (countsToday[t.game_type] !== undefined) countsToday[t.game_type] += 1; });

    var wrap = $("ttGrid"); wrap.innerHTML = "";
    ticketTypes.forEach(function (t) {
      var win = state.winningNumbers[t.key] || "";
      var sold = countsToday[t.key];
      var el = document.createElement("div"); el.className = "tt-card";
      el.innerHTML =
        '<div class="tt-card-head"><span class="tt-suit">' + t.suit + '</span><span class="tt-price mono">' + fmt$(t.price) + '/ticket</span></div>' +
        '<div class="tt-name">' + t.name + '</div>' +
        '<div class="tt-revenue mono">' + sold + ' sold today · ' + fmtUSDT(sold * t.price) + '</div>' +
        '<div class="tt-win-row">' +
        '<label class="tt-win-label">Winning Number <span class="tt-win-status ' + (win ? "set" : "") + '" data-winstatus="' + t.key + '">' + (win ? "Announced" : "Pending") + '</span></label>' +
        '<input type="text" class="mono tt-win-input" maxlength="12" data-winkey="' + t.key + '" placeholder="e.g. 07" value="' + win + '">' +
        "</div>";
      var winInput = el.querySelector("input[data-winkey]");
      winInput.addEventListener("input", function () {
        el.querySelector("[data-winstatus]").textContent = winInput.value.trim() ? "Announced" : "Pending";
        el.querySelector("[data-winstatus]").classList.toggle("set", !!winInput.value.trim());
      });
      wrap.appendChild(el);
    });
    $("ttTotalUnits").textContent = tt.length;
    $("ttTotalRevenue").textContent = fmt$(todayRevenue());
  }

  $("ttSaveBtn").addEventListener("click", async function () {
    var btn = this;
    var inputs = Array.prototype.slice.call(document.querySelectorAll("#ttGrid input[data-winkey]"));
    var toAnnounce = inputs.map(function (input) { return { key: input.dataset.winkey, val: input.value.trim() }; }).filter(function (x) { return x.val; });
    if (toAnnounce.length === 0) { toast("Enter at least one winning number first."); return; }
    btn.disabled = true;
    var failed = 0;
    for (var i = 0; i < toAnnounce.length; i++) {
      var res = await supabaseClient.rpc("announce_winning_number", { p_game_type: toAnnounce[i].key, p_number: toAnnounce[i].val });
      if (res.error) { failed++; console.error(res.error); }
    }
    btn.disabled = false;
    await loadWinningNumbers();
    renderTodayTickets();
    if (failed) { toast(failed + " number(s) failed to save — check console."); }
    else {
      $("ttSavedMsg").classList.add("show");
      setTimeout(function () { $("ttSavedMsg").classList.remove("show"); }, 2600);
      toast("Winning numbers announced — live on the site now.");
    }
  });

  function renderCounters() {
    var grid = $("counterGrid");
    grid.innerHTML = state.counters.map(function (c) {
      var game = gameByKey(c.game_type);
      var nextCode = c.prefix + String(c.next_number).padStart(3, "0");
      return '<div class="counter-tile" data-game="' + c.game_type + '">' +
        '<div class="ct-name">' + game.name + '</div>' +
        '<div class="ct-next">Next: ' + nextCode + '</div>' +
        '<button class="ct-reset js-reset-one" type="button" data-game="' + c.game_type + '">Reset This Game</button>' +
        '</div>';
    }).join("");
    grid.querySelectorAll(".js-reset-one").forEach(function (btn) {
      btn.addEventListener("click", async function () {
        btn.disabled = true;
        var res = await supabaseClient.rpc("run_draw_reset", { p_game_type: btn.dataset.game });
        btn.disabled = false;
        if (res.error) { toast(res.error.message || "Could not reset draw"); return; }
        toast("Draw reset — numbering back to 001");
        await loadCounters(); renderCounters();
      });
    });
  }
  $("resetAllBtn").addEventListener("click", async function () {
    var btn = this;
    btn.disabled = true;
    var res = await supabaseClient.rpc("run_draw_reset", { p_game_type: null });
    btn.disabled = false;
    if (res.error) { toast(res.error.message || "Could not reset draws"); return; }
    toast("All games reset — new draw cycle started");
    await loadCounters(); renderCounters();
  });

  /* ---------------- EMAIL ---------------- */
  $("emailAudience").addEventListener("change", function () {
    $("singleClientField").style.display = this.value === "single" ? "block" : "none";
  });
  var audienceLabels = { all: "All Clients", active: "Active players", suspended: "Suspended players" };
  function renderEmailLog() {
    var wrap = $("emailLog"); wrap.innerHTML = "";
    if (state.emailLog.length === 0) {
      wrap.innerHTML = '<p class="cell-dim" style="margin:0;">No campaigns queued yet.</p>';
      return;
    }
    state.emailLog.forEach(function (m) {
      var el = document.createElement("div"); el.className = "email-log-item";
      el.innerHTML = '<div class="email-log-ic">✉</div><div class="email-log-body"><b>' + m.subject + "</b><span>To: " + m.audience + "</span></div>" +
        '<div class="email-log-meta">Queued<br>' + new Date(m.sent_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) + "</div>";
      wrap.appendChild(el);
    });
  }
  $("emailForm").addEventListener("submit", async function (e) {
    e.preventDefault();
    var audVal = $("emailAudience").value;
    var audience = audVal === "single" ? $("emailSingleTarget").value.trim() : audienceLabels[audVal];
    var subject = $("emailSubject").value.trim();
    if (!audience) { toast("Enter a client email first."); return; }
    if (!subject) { toast("Enter a subject first."); return; }
    var btn = this.querySelector("button[type=submit]");
    btn.disabled = true;
    var res = await supabaseClient.from("email_log").insert({ subject: subject, audience: audience, sent_by: state.profile.id }).select().maybeSingle();
    btn.disabled = false;
    if (res.error) { toast(res.error.message || "Could not queue email"); return; }
    state.emailLog.unshift(res.data);
    renderEmailLog();
    toast("Email queued for " + audience + ". Connect a mail provider to actually send it.");
    this.reset();
    $("singleClientField").style.display = "none";
  });

  /* ---------------- GETTING PAID ---------------- */
  function renderPayouts() {
    var pending = state.payouts.filter(function (p) { return p.status === "pending"; }).reduce(function (s, p) { return s + Number(p.amount); }, 0);
    $("payoutBalance").textContent = fmtUSDT(pending);
    var tb = document.querySelector("#payoutsTable tbody"); tb.innerHTML = "";
    if (state.payouts.length === 0) {
      tb.innerHTML = '<tr><td colspan="6" class="cell-dim" style="text-align:center;padding:24px;">No payout requests yet.</td></tr>';
      return;
    }
    state.payouts.forEach(function (p) {
      var when = new Date(p.requested_at).toLocaleDateString(undefined, { month: "short", day: "numeric" });
      var wallet = p.wallet.length > 10 ? p.wallet.slice(0, 4) + "..." + p.wallet.slice(-4) : p.wallet;
      var tr = document.createElement("tr");
      tr.innerHTML = "<td class=\"mono cell-strong\">" + p.id.slice(0, 8) + "</td><td class=\"mono\">" + fmtUSDT(p.amount) + "</td>" +
        "<td class=\"mono cell-dim\">" + wallet + "</td><td>" + statusPill(p.status) + "</td><td class=\"cell-dim\">" + when + "</td>" +
        '<td>' + (p.status === "pending" ? '<div class="row-actions"><button data-act="paid">Mark Paid</button></div>' : "") + '</td>';
      var actBtn = tr.querySelector("[data-act]");
      if (actBtn) {
        actBtn.addEventListener("click", async function () {
          actBtn.disabled = true;
          var res = await supabaseClient.from("payouts").update({ status: "paid" }).eq("id", p.id);
          actBtn.disabled = false;
          if (res.error) { toast(res.error.message || "Could not update payout"); return; }
          p.status = "paid";
          renderPayouts(); renderDashboard();
          toast("Payout " + p.id.slice(0, 8) + " marked paid.");
        });
      }
      tb.appendChild(tr);
    });
  }
  $("requestPayoutBtn").addEventListener("click", function () {
    var card = $("payoutFormCard");
    card.style.display = card.style.display === "none" ? "block" : "none";
  });
  $("payoutForm").addEventListener("submit", async function (e) {
    e.preventDefault();
    var amount = parseFloat($("payoutAmount").value) || 0;
    var wallet = $("payoutWallet").value.trim();
    if (amount <= 0 || !wallet) return;
    var btn = this.querySelector("button[type=submit]");
    btn.disabled = true;
    var res = await supabaseClient.from("payouts").insert({ amount: amount, wallet: wallet, requested_by: state.profile.id }).select().maybeSingle();
    btn.disabled = false;
    if (res.error) { toast(res.error.message || "Could not submit payout request"); return; }
    state.payouts.unshift(res.data);
    renderPayouts();
    $("payoutFormCard").style.display = "none";
    this.reset();
    toast("Payout request submitted.");
  });

  /* ---------------- INIT ---------------- */
  async function renderAll() {
    await Promise.all([loadClients(), loadTickets(), loadWinningNumbers(), loadCounters(), loadPayouts(), loadEmailLog()]);
    renderNotifications();
    renderDashboard();
    renderOrders();
    renderClients();
    renderSales();
    renderTodayTickets();
    renderCounters();
    renderEmailLog();
    renderPayouts();
  }
})();
