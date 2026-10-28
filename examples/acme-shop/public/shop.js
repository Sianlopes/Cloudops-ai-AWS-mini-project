// Acme Shop storefront: plain browser JavaScript against the shop's /api.
const $ = (id) => document.getElementById(id);
const money = (n) => `$${Number(n).toFixed(2)}`;
const state = {
  products: [],
  category: "All",
  user: null,
  cart: JSON.parse(localStorage.getItem("acme-cart") || "{}"), // id -> qty
};

async function api(path, options = {}) {
  const res = await fetch(`api/${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = Error(body.error || `Request failed (HTTP ${res.status})`);
    error.status = res.status;
    throw error;
  }
  return body;
}
let toastTimer;
function toast(message, error = false) {
  const t = $("toast");
  t.textContent = message;
  t.className = `toast${error ? " error" : ""}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add("hidden"), 3500);
}
function banner(message) {
  $("banner").textContent = message || "";
  $("banner").classList.toggle("hidden", !message);
}
function open(name) {
  $(name).classList.remove("hidden");
  $(`${name}Scrim`).classList.remove("hidden");
}
function close(name) {
  $(name).classList.add("hidden");
  $(`${name}Scrim`).classList.add("hidden");
}
document.querySelectorAll("[data-close]").forEach((b) => (b.onclick = () => close(b.dataset.close)));
["cart", "product", "login"].forEach((n) => ($(`${n}Scrim`).onclick = () => close(n)));
document.addEventListener("keydown", (e) => e.key === "Escape" && ["cart", "product", "login"].forEach(close));

// ---- catalog ----
async function loadProducts() {
  try {
    state.products = await api("products");
    banner("");
  } catch (e) {
    state.products = [];
    banner(e.status === 503 ? `${e.message} Please try again shortly.` : `We couldn't load the shop (${e.message}).`);
  }
  renderCatalog();
  renderCart();
}
function renderCatalog() {
  const cats = ["All", ...new Set(state.products.map((p) => p.category))];
  $("chips").innerHTML = state.products.length
    ? cats.map((c) => `<button class="chip${c === state.category ? " active" : ""}" data-cat="${c}">${c}</button>`).join("")
    : "";
  $("chips").querySelectorAll("[data-cat]").forEach((b) => (b.onclick = () => ((state.category = b.dataset.cat), renderCatalog())));
  const list = state.products.filter((p) => state.category === "All" || p.category === state.category);
  $("grid").innerHTML = list
    .map(
      (p) => `<article class="product">
        <button class="thumb" data-view="${p.id}" aria-label="View ${p.name}">${p.emoji}</button>
        <div class="info">
          <button class="name" data-view="${p.id}">${p.name}</button>
          <span class="cat">${p.category}</span>
          <div class="row"><span class="price">${money(p.price)}</span>
          <button class="btn sm" data-add="${p.id}">Add to cart</button></div>
        </div></article>`,
    )
    .join("");
  $("grid").querySelectorAll("[data-add]").forEach((b) => (b.onclick = () => add(Number(b.dataset.add))));
  $("grid").querySelectorAll("[data-view]").forEach((b) => (b.onclick = () => view(Number(b.dataset.view))));
}
async function view(id) {
  try {
    const p = await api(`products/${id}`);
    $("pName").textContent = p.name;
    $("pEmoji").textContent = p.emoji;
    $("pCat").textContent = p.category;
    $("pDesc").textContent = p.description;
    $("pPrice").textContent = money(p.price);
    $("pAdd").onclick = () => (add(p.id), close("product"));
    open("product");
  } catch (e) {
    toast(e.message, true);
  }
}

// ---- cart ----
function saveCart() {
  localStorage.setItem("acme-cart", JSON.stringify(state.cart));
  renderCart();
}
function add(id) {
  state.cart[id] = (state.cart[id] || 0) + 1;
  saveCart();
  toast("Added to cart");
}
function renderCart() {
  const lines = Object.entries(state.cart)
    .map(([id, qty]) => ({ p: state.products.find((p) => p.id === Number(id)), qty }))
    .filter((l) => l.p);
  $("cartCount").textContent = lines.reduce((n, l) => n + l.qty, 0);
  $("cartTotal").textContent = money(lines.reduce((n, l) => n + l.p.price * l.qty, 0));
  $("checkout").disabled = !lines.length;
  $("cartLines").innerHTML = lines.length
    ? lines
        .map(
          (l) => `<div class="line"><span class="em">${l.p.emoji}</span>
          <span class="grow">${l.p.name}<br><span class="hint">${money(l.p.price)}</span></span>
          <span class="qty"><button data-dec="${l.p.id}">−</button>${l.qty}<button data-inc="${l.p.id}">+</button></span></div>`,
        )
        .join("")
    : `<p class="empty">Your cart is empty.</p>`;
  $("cartLines").querySelectorAll("[data-inc]").forEach((b) => (b.onclick = () => ((state.cart[b.dataset.inc]++), saveCart())));
  $("cartLines").querySelectorAll("[data-dec]").forEach(
    (b) => (b.onclick = () => {
      if (--state.cart[b.dataset.dec] <= 0) delete state.cart[b.dataset.dec];
      saveCart();
    }),
  );
}
$("cartBtn").onclick = () => {
  $("cartMsg").textContent = "";
  $("cartMsg").style.color = "";
  open("cart");
};
$("checkout").onclick = async () => {
  if (!state.user) {
    close("cart");
    open("login");
    $("loginMsg").textContent = "Sign in to check out.";
    return;
  }
  $("checkout").disabled = true;
  $("cartMsg").textContent = "Placing your order…";
  try {
    const order = await api("orders", {
      method: "POST",
      body: JSON.stringify({ items: Object.entries(state.cart).map(([id, qty]) => ({ id: Number(id), qty })) }),
    });
    state.cart = {};
    saveCart();
    close("cart");
    toast(`Order #${order.id} placed. Thank you!`);
  } catch (e) {
    $("cartMsg").textContent = e.message;
    $("cartMsg").style.color = "var(--danger)";
    $("checkout").disabled = false;
  }
};

// ---- account ----
async function loadUser() {
  try {
    state.user = (await api("me")).username;
  } catch {
    state.user = null;
  }
  $("who").textContent = state.user ? `Signed in as ${state.user}` : "";
  $("authBtn").textContent = state.user ? "Sign out" : "Sign in";
}
$("authBtn").onclick = async () => {
  if (!state.user) return (($("loginMsg").textContent = ""), open("login"));
  await api("logout", { method: "POST" }).catch(() => {});
  await loadUser();
  route();
  toast("Signed out");
};
$("loginForm").onsubmit = async (e) => {
  e.preventDefault();
  $("loginMsg").textContent = "";
  try {
    await api("login", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(e.target))) });
    e.target.reset();
    close("login");
    await loadUser();
    route();
    toast(`Welcome back, ${state.user}!`);
  } catch (err) {
    $("loginMsg").textContent = err.message;
  }
};

// ---- orders ----
async function loadOrders() {
  if (!state.user) {
    $("orders").innerHTML = `<p class="empty">Sign in to see your orders.</p>`;
    return;
  }
  try {
    const list = await api("orders");
    $("orders").innerHTML = list.length
      ? list
          .map(
            (o) => `<div class="order"><div class="head"><span>Order #${o.id}</span><span>${money(o.total)}</span></div>
            <div class="meta">${new Date(o.at).toLocaleString()} · ${o.items.map((i) => `${i.qty} × ${i.name}`).join(", ")}</div></div>`,
          )
          .join("")
      : `<p class="empty">No orders yet.</p>`;
  } catch (e) {
    $("orders").innerHTML = `<p class="empty">${e.message}</p>`;
  }
}

// ---- routing ----
function route() {
  const path = location.hash.replace(/^#/, "") || "/";
  document.querySelectorAll("nav a").forEach((a) => a.classList.toggle("active", a.dataset.route === path));
  $("shopView").classList.toggle("hidden", path !== "/");
  $("ordersView").classList.toggle("hidden", path !== "/orders");
  if (path === "/orders") loadOrders();
}
window.addEventListener("hashchange", route);
loadUser().then(() => {
  loadProducts();
  route();
});
