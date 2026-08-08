/* =========================================================
   ROYAL FLUSH — shared site script
   Cart (localStorage), auth + profile data (Supabase),
   sidebar, modal, countdowns, slider.
   Every page includes this file.
   ========================================================= */

(function () {
  "use strict";

  var CART_KEY = "rf_cart";

  /* ---------------- Supabase ---------------- */
  var SUPABASE_URL = "https://voriexbapbrkhrfboqeh.supabase.co";
  var SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZvcmlleGJhcGJya2hyZmJvcWVoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU5NTM0MzIsImV4cCI6MjEwMTUyOTQzMn0.-eTDBFH5kOxqFKaA-I_syt3ZrIK78Fyccg8eD4JyAsc";

  var supabaseClient = null;
  if (window.supabase && typeof window.supabase.createClient === "function") {
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  } else {
    console.error("Supabase JS library not loaded — check the <script> tag order in this page.");
  }

  /* ---------------- game catalog ----------------
     Shared by tickets.html (catalog + prices), profile.html and
     admin.html (labels for ticket_code prefixes). Keep the `id`
     values identical to the game_type column in Supabase. */
  var GAMES = {
    "dagger":       { label: "Dagger",       prefix: "DG" },
    "joker":        { label: "Joker",        prefix: "JK" },
    "jack":         { label: "Jack",         prefix: "JA" },
    "queen":        { label: "Queen",        prefix: "Q"  },
    "king":         { label: "King",         prefix: "K"  },
    "black-dragon": { label: "Black Dragon", prefix: "BD" },
    "red-dragon":   { label: "Red Dragon",   prefix: "RD" },
    "straight":     { label: "Straight",     prefix: "ST" },
    "royal-flush":  { label: "Royal Flush",  prefix: "RF" },
    "x-card":       { label: "X Card",       prefix: "X"  },
    "redeemed":     { label: "Redeemed Ticket", prefix: "FR" }
  };

  /* in-memory cache of the signed-in user + profile row, kept in
     sync via onAuthStateChange so RF.getUser() can stay synchronous */
  var _currentUser = null;

  /* ---------------- storage helpers (cart only) ---------------- */
  function readJSON(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }
  function writeJSON(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
  }

  /* ---------------- cart ---------------- */
  function getCart() { return readJSON(CART_KEY, []); }
  function saveCart(cart) { writeJSON(CART_KEY, cart); updateCartBadge(); }

  function addToCart(item) {
    var cart = getCart();
    var existing = cart.find(function (c) { return c.id === item.id; });
    if (existing) { existing.qty += item.qty; }
    else { cart.push({ id: item.id, name: item.name, price: item.price, qty: item.qty }); }
    saveCart(cart);
    toast(item.name + " added to bag");
  }

  function removeFromCart(id) {
    saveCart(getCart().filter(function (c) { return c.id !== id; }));
  }

  function setQty(id, qty) {
    var cart = getCart();
    if (qty <= 0) { saveCart(cart.filter(function (c) { return c.id !== id; })); return; }
    var item = cart.find(function (c) { return c.id === id; });
    if (item) { item.qty = qty; saveCart(cart); }
  }

  function clearCart() { saveCart([]); }

  function cartCount() {
    return getCart().reduce(function (sum, c) { return sum + c.qty; }, 0);
  }
  function cartTotal() {
    return getCart().reduce(function (sum, c) { return sum + c.qty * c.price; }, 0);
  }
  function fmtUSD(n) {
    return "$" + Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function updateCartBadge() {
    var n = cartCount();
    document.querySelectorAll(".js-cart-badge").forEach(function (el) { el.textContent = n; });
  }

  /* ---------------- user / auth (Supabase) ---------------- */

  /* Synchronous accessor — reads the in-memory cache kept up to
     date by onAuthStateChange (see initSupabaseAuth). */
  function getUser() { return _currentUser; }

  function logout() {
    if (!supabaseClient) return;
    supabaseClient.auth.signOut().then(function () {
      closeProfilePop();
      toast("Signed out");
    });
  }

  /* Pull (or lazily create) the profiles row for a session and
     populate _currentUser. The row itself is normally created
     automatically by a DB trigger on signup (see setup SQL). */
  function loadProfile(session) {
    if (!session || !session.user || !supabaseClient) {
      _currentUser = null;
      renderAuthUI();
      return;
    }
    var authUser = session.user;
    supabaseClient
      .from("profiles")
      .select("*")
      .eq("id", authUser.id)
      .maybeSingle()
      .then(function (res) {
        var profile = res.data || {};
        _currentUser = {
          id: authUser.id,
          email: authUser.email,
          name: profile.name || (authUser.user_metadata && authUser.user_metadata.name) || authUser.email.split("@")[0],
          dob: profile.dob || (authUser.user_metadata && authUser.user_metadata.dob) || null,
          tickets: profile.tickets || 0,
          spent: Number(profile.spent || 0),
          draws: profile.draws || 0,
          is_admin: !!profile.is_admin,
          payout_usdt: profile.payout_usdt || "",
          payout_usdc: profile.payout_usdc || ""
        };
        renderAuthUI();
      })
      .catch(function (err) {
        console.error("Could not load profile:", err);
        _currentUser = {
          id: authUser.id,
          email: authUser.email,
          name: authUser.email.split("@")[0],
          tickets: 0, spent: 0, draws: 0
        };
        renderAuthUI();
      });
  }

  function addPurchase(ticketCount, amount) {
    var user = getUser();
    if (!user || !supabaseClient) return;
    var next = {
      tickets: (user.tickets || 0) + ticketCount,
      spent: (user.spent || 0) + amount,
      draws: (user.draws || 0) + 1
    };
    // update local cache immediately so the UI feels instant
    user.tickets = next.tickets; user.spent = next.spent; user.draws = next.draws;
    renderAuthUI();
    supabaseClient
      .from("profiles")
      .update({ tickets: next.tickets, spent: next.spent, draws: next.draws, updated_at: new Date().toISOString() })
      .eq("id", user.id)
      .then(function (res) {
        if (res.error) console.error("Could not save purchase:", res.error);
      });
  }

  /* ---------------- ticket purchase (creates numbered ticket rows) ----------------
     Called from checkout.html after "payment" is confirmed. Walks the
     cart, asks Supabase for the next sequential code per unit
     (RF001, RF002, ... — see next_ticket_code() in supabase-setup.sql),
     then inserts one row per physical ticket.

     Cart item ids that aren't one of the real games (e.g. a redeemed
     code like "redeem-xk4p" from RF.redeemTicket) are stored under the
     catalog-all 'redeemed' game_type instead — that id is kept on the
     cart line itself so the bag can show which code it was, but it was
     never a valid game_type for ticket_counters/next_ticket_code, so
     without this mapping those tickets were silently never saved.

     Resolves to { tickets, failedCount } — tickets is the array of
     rows actually saved, failedCount is how many units could not be
     saved (so the caller can warn instead of pretending it worked). */
  function buyTickets(cartItems, txHash) {
    var user = getUser();
    if (!user || !supabaseClient) return Promise.resolve({ tickets: [], failedCount: 0 });

    var rows = [];
    var failedCount = 0;
    var chain = Promise.resolve();

    cartItems.forEach(function (item) {
      var gameType = GAMES[item.id] ? item.id : "redeemed";
      for (var i = 0; i < item.qty; i++) {
        chain = chain.then(function () {
          return supabaseClient.rpc("next_ticket_code", { p_game_type: gameType }).then(function (res) {
            if (res.error) {
              console.error("Could not get ticket code for " + gameType + ":", res.error);
              failedCount++;
              return;
            }
            rows.push({
              user_id: user.id,
              game_type: gameType,
              ticket_code: res.data,
              price: item.price,
              tx_hash: txHash || null
            });
          });
        });
      }
    });

    return chain.then(function () {
      if (rows.length === 0) return { tickets: [], failedCount: failedCount };
      return supabaseClient.from("tickets").insert(rows).select().then(function (res) {
        if (res.error) {
          console.error("Could not save tickets:", res.error);
          return { tickets: [], failedCount: failedCount + rows.length };
        }
        return { tickets: res.data || [], failedCount: failedCount };
      });
    });
  }

  /* Signed-in user's own tickets, newest first. */
  function getMyTickets() {
    var user = getUser();
    if (!user || !supabaseClient) return Promise.resolve([]);
    return supabaseClient
      .from("tickets")
      .select("*")
      .eq("user_id", user.id)
      .order("purchased_at", { ascending: false })
      .then(function (res) {
        if (res.error) { console.error("Could not load tickets:", res.error); return []; }
        return res.data || [];
      });
  }

  /* Mark a batch of the current user's own tickets as seen, so the
     "NEW" highlight clears on the next profile visit. */
  function markTicketsSeen(ids) {
    if (!supabaseClient || !ids || ids.length === 0) return Promise.resolve();
    return supabaseClient.from("tickets").update({ seen: true }).in("id", ids).then(function (res) {
      if (res.error) console.error("Could not mark tickets seen:", res.error);
    });
  }

  /* Save (or clear) the signed-in user's payout addresses. These are
     plain saved text fields — no wallet connection, no on-chain call. */
  function savePayoutAddresses(usdt, usdc) {
    var user = getUser();
    if (!user || !supabaseClient) return Promise.resolve(false);
    return supabaseClient
      .from("profiles")
      .update({ payout_usdt: usdt || null, payout_usdc: usdc || null, updated_at: new Date().toISOString() })
      .eq("id", user.id)
      .then(function (res) {
        if (res.error) { console.error("Could not save payout addresses:", res.error); return false; }
        user.payout_usdt = usdt || "";
        user.payout_usdc = usdc || "";
        return true;
      });
  }

  /* ---------------- admin ---------------- */
  function isAdmin() {
    var user = getUser();
    return !!(user && user.is_admin);
  }

  /* All tickets sold across every player, newest first, with the
     buyer's profile name attached (see the FK from tickets.user_id
     to profiles.id, which lets PostgREST embed it). Admin-only —
     enforced by RLS regardless of what calls this. */
  function adminGetAllTickets() {
    if (!supabaseClient) return Promise.resolve([]);
    return supabaseClient
      .from("tickets")
      .select("*, profiles(name)")
      .order("purchased_at", { ascending: false })
      .then(function (res) {
        if (res.error) { console.error("Could not load tickets (admin):", res.error); return []; }
        return res.data || [];
      });
  }

  function adminMarkWinner(ticketId, isWinner) {
    if (!supabaseClient) return Promise.resolve(false);
    return supabaseClient.from("tickets").update({ is_winner: isWinner }).eq("id", ticketId).then(function (res) {
      if (res.error) { console.error("Could not update ticket:", res.error); return false; }
      return true;
    });
  }

  /* Resets one game's ticket numbering back to 001, or every game's
     if gameType is omitted. Existing tickets are untouched. */
  function adminRunDrawReset(gameType) {
    if (!supabaseClient) return Promise.resolve(false);
    return supabaseClient.rpc("run_draw_reset", { p_game_type: gameType || null }).then(function (res) {
      if (res.error) { console.error("Could not reset draw:", res.error); toast(res.error.message || "Could not reset draw"); return false; }
      return true;
    });
  }

  function adminGetCounters() {
    if (!supabaseClient) return Promise.resolve([]);
    return supabaseClient.from("ticket_counters").select("*").then(function (res) {
      if (res.error) { console.error("Could not load counters:", res.error); return []; }
      return res.data || [];
    });
  }

  /* Public — no auth required. Winning numbers announced from the CRM
     (public.winning_numbers, one row per game per draw_date). Used by
     draw.html to show today's results and the previous day's.
     Returns { game_type: number }. dateStr must be 'YYYY-MM-DD'. */
  function getWinningNumbers(dateStr) {
    if (!supabaseClient) return Promise.resolve({});
    return supabaseClient
      .from("winning_numbers")
      .select("game_type, number")
      .eq("draw_date", dateStr)
      .then(function (res) {
        if (res.error) { console.error("Could not load winning numbers:", res.error); return {}; }
        var map = {};
        (res.data || []).forEach(function (row) { map[row.game_type] = row.number; });
        return map;
      });
  }

  function redeemTicket(code) {
    var user = getUser();
    if (!user) { toast("Log in to redeem a ticket code"); return false; }
    code = (code || "").trim();
    if (!code) { toast("Enter a code to redeem"); return false; }
    addToCart({ id: "redeem-" + code.toLowerCase(), name: "Redeemed Ticket (" + code.toUpperCase() + ")", price: 0, qty: 1 });
    toast("Code redeemed — free ticket added to your bag");
    return true;
  }

  function renderAuthUI() {
    var user = getUser();
    document.querySelectorAll(".js-auth-btn").forEach(function (btn) {
      var label = btn.querySelector(".au-label");
      var avatar = btn.querySelector(".avatar");
      if (user) {
        btn.classList.remove("is-guest");
        if (label) label.textContent = user.name || user.email;
        if (avatar) avatar.textContent = (user.name || user.email || "?").trim().charAt(0).toUpperCase();
      } else {
        btn.classList.add("is-guest");
        if (label) label.textContent = "Login / Sign Up";
        if (avatar) avatar.textContent = "♣";
      }
    });
    document.querySelectorAll(".js-profile-pop").forEach(function (pop) {
      pop.innerHTML = user ? profilePopHTML(user) : "";
    });
    document.querySelectorAll(".js-admin-nav-link").forEach(function (el) {
      el.style.display = (user && user.is_admin) ? "" : "none";
    });
    document.dispatchEvent(new CustomEvent("rf:authchange", { detail: { user: user } }));
  }

  function profilePopHTML(user) {
    return (
      '<div class="p-head">' +
        '<span class="avatar">' + (user.name || user.email || "?").trim().charAt(0).toUpperCase() + "</span>" +
        "<div><b>" + (user.name || "Player") + "</b><small>" + user.email + "</small></div>" +
      "</div>" +
      '<div class="profile-stats">' +
        '<div><div class="v">' + (user.tickets || 0) + '</div><div class="k">Tickets Bought</div></div>' +
        '<div><div class="v">' + fmtUSD(user.spent || 0) + '</div><div class="k">Total Spent</div></div>' +
      "</div>" +
      '<a href="profile.html" class="btn btn-ghost btn-block" style="margin-top:10px;">My Tickets</a>' +
      (user.is_admin ? '<a href="admin.html" class="btn btn-ghost btn-block" style="margin-top:8px;">Admin Panel</a>' : "") +
      (user.is_admin ? '<a href="../crm/crm.html" class="btn btn-ghost btn-block" style="margin-top:8px;" target="_blank" rel="noopener">CRM Console</a>' : "") +
      '<button class="btn btn-ghost btn-block js-logout" type="button" style="margin-top:8px;">Log Out</button>'
    );
  }

  function closeProfilePop() {
    document.querySelectorAll(".js-profile-pop").forEach(function (p) { p.classList.remove("open"); });
  }

  /* ---------------- toast ---------------- */
  var toastTimer = null;
  function toast(msg) {
    var el = document.querySelector(".toast");
    if (!el) {
      el = document.createElement("div");
      el.className = "toast";
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove("show"); }, 2400);
  }

  /* ---------------- countdowns ---------------- */
  function nextDrawTime() {
    var now = new Date();
    var t = new Date(now);
    t.setHours(15, 0, 0, 0);
    if (now >= t) t.setDate(t.getDate() + 1);
    return t;
  }

  function pad(n) { return String(n).padStart(2, "0"); }

  function startCountdown(containerId) {
    var el = document.getElementById(containerId);
    if (!el) return;
    var hEl = el.querySelector(".d-h"), mEl = el.querySelector(".d-m"), sEl = el.querySelector(".d-s");

    function tick() {
      var diff = nextDrawTime().getTime() - Date.now();
      if (diff <= 0) diff = 0;
      var h = Math.floor(diff / 3600000);
      var m = Math.floor((diff % 3600000) / 60000);
      var s = Math.floor((diff % 60000) / 1000);
      if (hEl) hEl.textContent = pad(h);
      if (mEl) mEl.textContent = pad(m);
      if (sEl) sEl.textContent = pad(s);
    }
    tick();
    setInterval(tick, 1000);
  }

  function run24hCountdown(id) { startCountdown(id); }
  function runDailyCountdown(id) { startCountdown(id); }

  /* ---------------- sidebar ---------------- */
  function initSidebar() {
    var sidebar = document.querySelector(".sidebar");
    var scrim = document.querySelector(".sidebar-scrim");
    if (!sidebar) return;

    function open() { sidebar.classList.add("open"); if (scrim) scrim.classList.add("open"); }
    function close() { sidebar.classList.remove("open"); if (scrim) scrim.classList.remove("open"); }

    document.querySelectorAll(".js-sidebar-open").forEach(function (btn) {
      btn.addEventListener("click", open);
    });
    document.querySelectorAll(".js-sidebar-close").forEach(function (btn) {
      btn.addEventListener("click", close);
    });
    if (scrim) scrim.addEventListener("click", close);
  }

  /* ---------------- mobile bottom nav ----------------
     Injects a fixed 5-tab bottom nav (Home, Tickets, Draw, My
     Profile, Royal Flush) on every page that loads script.js — no
     per-page HTML edits needed. Hidden above the mobile breakpoint,
     where the sidebar already handles navigation. */
  function initBottomNav() {
    if (document.querySelector(".rf-bottom-nav")) return;

    var style = document.createElement("style");
    style.id = "rf-bottom-nav-style";
    style.textContent =
      ".rf-bottom-nav{display:none;}" +
      "@media (max-width:860px){" +
      "  body{padding-bottom:calc(96px + env(safe-area-inset-bottom));}" +
      "  .rf-bottom-nav{" +
      "    display:flex; position:fixed; left:12px; right:12px; bottom:calc(12px + env(safe-area-inset-bottom)); z-index:1000;" +
      "    padding:8px 6px;" +
      "    border-radius:26px;" +
      "    background:rgba(11,15,22,.94); backdrop-filter:blur(16px); -webkit-backdrop-filter:blur(16px);" +
      "    border:1px solid var(--border-soft, rgba(233,201,118,.18));" +
      "    box-shadow:0 12px 32px rgba(0,0,0,.5), 0 0 0 1px rgba(233,201,118,.06) inset;" +
      "  }" +
      "}" +
      ".rf-bn-item{" +
      "  flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:4px;" +
      "  padding:8px 3px; margin:0 2px; border-radius:14px; color:var(--ink-faint,#8a8578); text-decoration:none;" +
      "  font-family:var(--font-mono,monospace); font-size:.64rem; letter-spacing:.03em; text-transform:uppercase;" +
      "  font-weight:600; transition:color .15s ease, transform .15s ease, background .15s ease;" +
      "  border:1px solid transparent;" +
      "}" +
      ".rf-bn-item .rf-bn-ic{" +
      "  font-family:var(--font-mono,monospace); font-size:1.45rem; line-height:1; color:inherit;" +
      "  transition:text-shadow .15s ease;" +
      "}" +
      ".rf-bn-item.active{" +
      "  color:var(--gold-bright,var(--gold,#e9c976)); transform:translateY(-3px);" +
      "  background:linear-gradient(180deg, rgba(233,201,118,.16), rgba(178,42,42,.10));" +
      "  border-color:rgba(233,201,118,.35);" +
      "  box-shadow:0 4px 16px rgba(233,201,118,.18), 0 0 0 1px rgba(233,201,118,.08) inset;" +
      "}" +
      ".rf-bn-item.active .rf-bn-ic{ text-shadow:0 0 16px rgba(233,201,118,.7); }" +
      ".rf-bn-item:active{ transform:scale(.94); }" +
      ".rf-bn-item.active .rf-bn-ic{" +
      "  position:relative; display:inline-block; overflow:hidden;" +
      "  background:linear-gradient(100deg, var(--gold-bright,#f2d488) 30%, #fff 50%, var(--gold-bright,#f2d488) 70%);" +
      "  background-size:220% 100%; -webkit-background-clip:text; background-clip:text; color:transparent;" +
      "  animation:rfShine 2.2s ease-in-out infinite;" +
      "}" +
      "@keyframes rfShine{" +
      "  0%{ background-position:140% 0; }" +
      "  60%{ background-position:-40% 0; }" +
      "  100%{ background-position:-40% 0; }" +
      "}" +
      ".rf-bn-rf .rf-bn-ic{" +
      "  width:34px; height:34px; border-radius:50%; display:flex; align-items:center; justify-content:center;" +
      "  background:radial-gradient(circle at 35% 30%, rgba(255,255,255,.10), rgba(11,15,22,.92));" +
      "  border:1.5px solid rgba(233,201,118,.4);" +
      "  box-shadow:0 2px 12px rgba(233,201,118,.22); position:relative; overflow:hidden;" +
      "}" +
      ".rf-bn-rf .rf-bn-ic img{ width:66%; height:66%; object-fit:contain; display:block; }" +
      ".rf-bn-rf.active .rf-bn-ic{" +
      "  display:flex; align-items:center; justify-content:center;" +
      "  border-color:var(--gold-bright,#f2d488);" +
      "  box-shadow:0 3px 20px rgba(233,201,118,.8); transform:scale(1.08);" +
      "  background:radial-gradient(circle at 35% 30%, rgba(255,255,255,.16), rgba(11,15,22,.92));" +
      "  -webkit-background-clip:border-box; background-clip:border-box; color:inherit;" +
      "}" +
      ".rf-bn-rf.active .rf-bn-ic::after{" +
      "  content:''; position:absolute; top:0; left:-60%; width:40%; height:100%;" +
      "  background:linear-gradient(100deg, transparent, rgba(255,255,255,.85), transparent);" +
      "  animation:rfShineSweep 2.2s ease-in-out infinite;" +
      "}" +
      "@keyframes rfShineSweep{" +
      "  0%{ left:-60%; }" +
      "  60%{ left:120%; }" +
      "  100%{ left:120%; }" +
      "}" +
      ".rf-bn-rf:not(.active) .rf-bn-ic{ filter:grayscale(.25) brightness(.9); }" +
      ".rf-bn-rf:not(.active) .rf-bn-ic img{ opacity:.85; }";
    document.head.appendChild(style);

    // Normalize against every URL shape a static host might serve:
    // "/tickets.html", "/tickets", "/tickets/", or "/" for the home page.
    // Comparing raw filenames breaks the moment Cloudflare (or any host)
    // serves clean URLs without the .html extension.
    var rawPath = location.pathname.replace(/\/+$/, "");
    var lastSeg = rawPath.split("/").pop() || "";
    var current = lastSeg.replace(/\.html$/i, "").toLowerCase() || "index";

    var tabs = [
      { href: "index.html", match: "index", label: "Home", icon: "♠" },
      { href: "tickets.html", match: "tickets", label: "Tickets", icon: "♥" },
      { href: "draw.html", match: "draw", label: "Draw", icon: "♣" },
      { href: "profile.html", match: "profile", label: "My Profile", icon: "☺" },
      { href: "royalflush.html", match: "royalflush", label: "Royal Flush", icon: '<img src="logo.png" alt="Royal Flush">', rf: true }
    ];

    var nav = document.createElement("nav");
    nav.className = "rf-bottom-nav";
    nav.innerHTML = tabs.map(function (t) {
      var isActive = current === t.match;
      return '<a class="rf-bn-item' + (t.rf ? " rf-bn-rf" : "") + (isActive ? " active" : "") + '" href="' + t.href + '">' +
        '<span class="rf-bn-ic">' + t.icon + '</span><span>' + t.label + '</span></a>';
    }).join("");
    document.body.appendChild(nav);
  }

  /* ---------------- Supabase session wiring ---------------- */
  function initSupabaseAuth() {
    if (!supabaseClient) return;

    supabaseClient.auth.onAuthStateChange(function (event, session) {
      loadProfile(session);

      if (event === "PASSWORD_RECOVERY") {
        // User followed the emailed reset link — Supabase already
        // exchanged the token for a session; just show the
        // "set a new password" panel.
        var modal = document.getElementById("auth-modal");
        if (modal) {
          modal.classList.add("open");
          showAuthPanel("reset");
        }
      }
    });

    supabaseClient.auth.getSession().then(function (res) {
      loadProfile(res.data ? res.data.session : null);
    });
  }

  function showAuthPanel(name) {
    var modal = document.getElementById("auth-modal");
    if (!modal) return;
    var tabsWrap = modal.querySelector(".js-modal-tabs");
    var isTabPanel = name === "login" || name === "signup";
    if (tabsWrap) tabsWrap.style.display = isTabPanel ? "" : "none";
    if (isTabPanel) {
      modal.querySelectorAll(".modal-tabs button").forEach(function (b) {
        b.classList.toggle("active", b.dataset.tab === name);
      });
    }
    modal.querySelectorAll(".auth-panel").forEach(function (panel) {
      panel.style.display = panel.dataset.panel === name ? "block" : "none";
    });
  }

  /* ---------------- auth modal ---------------- */
  function initAuthModal() {
    var modal = document.getElementById("auth-modal");

    document.querySelectorAll(".js-auth-open").forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        var user = getUser();
        if (user) {
          e.stopPropagation();
          var pop = btn.parentElement.querySelector(".js-profile-pop");
          if (pop) pop.classList.toggle("open");
          return;
        }
        if (modal) { showAuthPanel("login"); modal.classList.add("open"); }
      });
    });

    if (modal) {
      modal.querySelectorAll(".js-modal-close").forEach(function (btn) {
        btn.addEventListener("click", function () { modal.classList.remove("open"); });
      });
      modal.addEventListener("click", function (e) {
        if (e.target === modal) modal.classList.remove("open");
      });
      modal.querySelectorAll(".modal-tabs button").forEach(function (tabBtn) {
        tabBtn.addEventListener("click", function () { showAuthPanel(tabBtn.dataset.tab); });
      });
      var forgotLink = modal.querySelector(".js-forgot-link");
      if (forgotLink) {
        forgotLink.addEventListener("click", function (e) {
          e.preventDefault();
          var loginEmail = document.getElementById("login-email");
          var forgotEmail = document.getElementById("forgot-email");
          if (forgotEmail && loginEmail && loginEmail.value.trim()) forgotEmail.value = loginEmail.value.trim();
          showAuthPanel("forgot");
        });
      }
      var backToLogin = modal.querySelector(".js-back-to-login");
      if (backToLogin) {
        backToLogin.addEventListener("click", function (e) {
          e.preventDefault();
          showAuthPanel("login");
        });
      }
    }

    var loginForm = document.getElementById("login-form");
    if (loginForm) {
      loginForm.addEventListener("submit", function (e) {
        e.preventDefault();
        if (!supabaseClient) { toast("Auth isn't configured yet"); return; }
        var email = document.getElementById("login-email").value.trim();
        var password = document.getElementById("login-password").value;
        if (!email || !password) return;
        var submitBtn = loginForm.querySelector("button[type=submit]");
        if (submitBtn) submitBtn.disabled = true;
        supabaseClient.auth.signInWithPassword({ email: email, password: password })
          .then(function (res) {
            if (res.error) { toast(res.error.message || "Could not sign in"); return; }
            if (modal) modal.classList.remove("open");
            loginForm.reset();
            toast("Welcome back");
          })
          .finally(function () { if (submitBtn) submitBtn.disabled = false; });
      });
    }

    var dobInput = document.getElementById("signup-dob");
    if (dobInput) {
      var minAgeDate = new Date();
      minAgeDate.setFullYear(minAgeDate.getFullYear() - 18);
      dobInput.max = minAgeDate.toISOString().slice(0, 10);
    }

    var signupForm = document.getElementById("signup-form");
    if (signupForm) {
      signupForm.addEventListener("submit", function (e) {
        e.preventDefault();
        if (!supabaseClient) { toast("Auth isn't configured yet"); return; }
        var name = document.getElementById("signup-name").value.trim();
        var dob = document.getElementById("signup-dob").value;
        var email = document.getElementById("signup-email").value.trim();
        var password = document.getElementById("signup-password").value;
        var errorEl = document.getElementById("signup-error");
        var ageConfirmEl = document.getElementById("signup-age-confirm");

        var age = null;
        if (dob) {
          var dobDate = new Date(dob);
          var today = new Date();
          age = today.getFullYear() - dobDate.getFullYear();
          var hasHadBirthdayThisYear =
            today.getMonth() > dobDate.getMonth() ||
            (today.getMonth() === dobDate.getMonth() && today.getDate() >= dobDate.getDate());
          if (!hasHadBirthdayThisYear) age--;
        }

        // Hard block: date of birth must calculate to 18+, and the
        // explicit 18+ confirmation checkbox must be checked. Either
        // failing stops account creation — no account is created for
        // anyone under 18, regardless of what the checkbox says.
        var passesDob = dob && age !== null && age >= 18;
        var passesCheckbox = ageConfirmEl && ageConfirmEl.checked;

        if (!passesDob || !passesCheckbox) {
          if (errorEl) errorEl.style.display = "block";
          return;
        }
        if (errorEl) errorEl.style.display = "none";

        if (!email || !password) return;
        var submitBtn = signupForm.querySelector("button[type=submit]");
        if (submitBtn) submitBtn.disabled = true;
        supabaseClient.auth.signUp({
          email: email,
          password: password,
          options: { data: { name: name, dob: dob } }
        })
          .then(function (res) {
            if (res.error) { toast(res.error.message || "Could not create account"); return; }
            if (res.data && res.data.session) {
              // email confirmation is off — user is signed in immediately
              if (modal) modal.classList.remove("open");
              signupForm.reset();
              toast("Account created — welcome to the table");
            } else {
              // email confirmation is on — no session yet
              if (modal) modal.classList.remove("open");
              signupForm.reset();
              toast("Check your email to confirm your account");
            }
          })
          .finally(function () { if (submitBtn) submitBtn.disabled = false; });
      });
    }

    var forgotForm = document.getElementById("forgot-form");
    if (forgotForm) {
      forgotForm.addEventListener("submit", function (e) {
        e.preventDefault();
        if (!supabaseClient) { toast("Auth isn't configured yet"); return; }
        var email = document.getElementById("forgot-email").value.trim();
        if (!email) return;
        var submitBtn = forgotForm.querySelector("button[type=submit]");
        if (submitBtn) submitBtn.disabled = true;
        supabaseClient.auth.resetPasswordForEmail(email, {
          redirectTo: window.location.origin + window.location.pathname
        })
          .then(function (res) {
            if (res.error) { toast(res.error.message || "Could not send reset email"); return; }
            toast("Password reset link sent — check your email");
            showAuthPanel("login");
          })
          .finally(function () { if (submitBtn) submitBtn.disabled = false; });
      });
    }

    var resetForm = document.getElementById("reset-password-form");
    if (resetForm) {
      resetForm.addEventListener("submit", function (e) {
        e.preventDefault();
        if (!supabaseClient) { toast("Auth isn't configured yet"); return; }
        var newPassword = document.getElementById("reset-new-password").value;
        if (!newPassword) return;
        var submitBtn = resetForm.querySelector("button[type=submit]");
        if (submitBtn) submitBtn.disabled = true;
        supabaseClient.auth.updateUser({ password: newPassword })
          .then(function (res) {
            if (res.error) { toast(res.error.message || "Could not update password"); return; }
            resetForm.reset();
            if (modal) modal.classList.remove("open");
            toast("Password updated — you're signed in");
          })
          .finally(function () { if (submitBtn) submitBtn.disabled = false; });
      });
    }

    document.addEventListener("click", function (e) {
      if (e.target.classList.contains("js-logout")) { logout(); }
      if (!e.target.closest(".wrap-relative")) closeProfilePop();
    });
  }

  /* ---------------- slider ---------------- */
  function initSliders() {
    document.querySelectorAll(".slider").forEach(function (slider) {
      var track = slider.querySelector(".slider-track");
      var slides = slider.querySelectorAll(".slide");
      var dotsWrap = slider.querySelector(".slider-dots");
      var prevBtn = slider.querySelector(".js-prev");
      var nextBtn = slider.querySelector(".js-next");
      if (!track || slides.length === 0) return;

      var index = 0;
      if (dotsWrap) {
        dotsWrap.innerHTML = "";
        slides.forEach(function (_, i) {
          var dot = document.createElement("button");
          if (i === 0) dot.classList.add("active");
          dot.addEventListener("click", function () { goTo(i); });
          dotsWrap.appendChild(dot);
        });
      }

      function goTo(i) {
        index = (i + slides.length) % slides.length;
        track.style.transform = "translateX(-" + (index * 100) + "%)";
        if (dotsWrap) {
          dotsWrap.querySelectorAll("button").forEach(function (d, di) {
            d.classList.toggle("active", di === index);
          });
        }
      }

      if (prevBtn) prevBtn.addEventListener("click", function () { goTo(index - 1); });
      if (nextBtn) nextBtn.addEventListener("click", function () { goTo(index + 1); });

      if (slides.length > 1) {
        setInterval(function () { goTo(index + 1); }, 7000);
      }
    });
  }

  /* ---------------- init ---------------- */
  document.addEventListener("DOMContentLoaded", function () {
    updateCartBadge();
    renderAuthUI();
    initSidebar();
    initAuthModal();
    initSupabaseAuth();
    initSliders();
    initBottomNav();
  });

  /* ---------------- public API ---------------- */
  window.RF = {
    GAMES: GAMES,
    getCart: getCart,
    addToCart: addToCart,
    removeFromCart: removeFromCart,
    setQty: setQty,
    clearCart: clearCart,
    cartCount: cartCount,
    cartTotal: cartTotal,
    fmtUSD: fmtUSD,
    getUser: getUser,
    addPurchase: addPurchase,
    redeemTicket: redeemTicket,
    buyTickets: buyTickets,
    getMyTickets: getMyTickets,
    markTicketsSeen: markTicketsSeen,
    savePayoutAddresses: savePayoutAddresses,
    isAdmin: isAdmin,
    adminGetAllTickets: adminGetAllTickets,
    adminMarkWinner: adminMarkWinner,
    adminRunDrawReset: adminRunDrawReset,
    adminGetCounters: adminGetCounters,
    getWinningNumbers: getWinningNumbers,
    toast: toast,
    run24hCountdown: run24hCountdown,
    runDailyCountdown: runDailyCountdown
  };
})();
