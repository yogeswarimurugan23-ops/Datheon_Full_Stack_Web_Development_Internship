/* ============ Atmosia – live weather via OpenWeatherMap ============ */
// 1) PASTE YOUR OWN OpenWeatherMap API KEY BELOW (the same one your old project used)
const API_KEY = "bf68d4267f2a122de37bfe32ce8c86d1";
const BASE = "https://api.openweathermap.org/data/2.5";

const $ = (s) => document.querySelector(s);
const store = {
  get: (k, d) => { try { return localStorage.getItem(k) || d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} }
};

let unit = store.get("atmosia-unit", "C");   // "C" or "F"
let city = store.get("atmosia-city", "Chennai");
let current = null, forecast = null;          // raw metric data from the API

/* ---------- helpers ---------- */
const temp = (c) => Math.round(unit === "C" ? c : c * 9 / 5 + 32);
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const icon = (code, size = "4x") => `https://openweathermap.org/img/wn/${code}@${size}.png`;
const shift = (unixSec, tz) => new Date((unixSec + tz) * 1000);       // "city local time" held in UTC fields
const hhmm = (unixSec, tz) => shift(unixSec, tz).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC" });

function setStatus(msg, type = "") {
  const el = $("#status");
  el.textContent = msg;
  el.className = "status " + type;
}

/* ---------- clock ---------- */
function tick() {
  const d = new Date();
  $("#clockDate").textContent = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  $("#clockTime").textContent = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}
tick(); setInterval(tick, 30000);
$("#yr").textContent = new Date().getFullYear();

/* ---------- fetching ---------- */
async function getJSON(url) {
  let res;
  try { res = await fetch(url); }
  catch { throw new Error("Network error. Check your internet connection and try again."); }
  if (res.status === 404) throw new Error("City not found. Check the spelling or try another city.");
  if (res.status === 401) throw new Error("Invalid API key. Add your OpenWeatherMap key in script.js (new keys can take up to 2 hours to activate).");
  if (res.status === 429) throw new Error("Too many requests. Please wait a minute and try again.");
  if (!res.ok) throw new Error("Weather service error (" + res.status + "). Please try again later.");
  return res.json();
}

async function loadWeather(name) {
  name = (name || "").trim();
  if (!name) return setStatus("Enter a city name to search.", "error");
  if (!API_KEY || API_KEY.startsWith("YOUR_")) return setStatus("Add your OpenWeatherMap API key at the top of script.js.", "error");

  setStatus("Fetching weather for " + name + "…", "loading");
  $("#weather").classList.add("busy");
  try {
    const q = encodeURIComponent(name);
    const [cur, fc] = await Promise.all([
      getJSON(`${BASE}/weather?q=${q}&units=metric&appid=${API_KEY}`),
      getJSON(`${BASE}/forecast?q=${q}&units=metric&appid=${API_KEY}`)
    ]);
    current = cur; forecast = fc;
    city = cur.name;
    store.set("atmosia-city", city);
    render();
    setStatus("");
  } catch (e) {
    setStatus(e.message, "error");
  } finally {
    $("#weather").classList.remove("busy");
  }
}

/* ---------- rendering ---------- */
function render() {
  if (!current) return;
  const c = current, tz = c.timezone, w = c.weather[0];

  $("#cityName").textContent = c.name;
  $("#countryName").textContent = new Intl.DisplayNames(["en"], { type: "region" }).of(c.sys.country) || c.sys.country;
  $("#flag").src = `https://flagcdn.com/48x36/${c.sys.country.toLowerCase()}.png`;
  $("#curIcon").src = icon(w.icon);
  $("#curIcon").alt = w.description;
  $("#temp").textContent = temp(c.main.temp) + "°" + unit;
  $("#cond").textContent = cap(w.description);
  $("#feels").textContent = "Feels like " + temp(c.main.feels_like) + "°" + unit;
  $("#humidity").textContent = c.main.humidity + "%";
  $("#wind").textContent = Math.round(c.wind.speed * 3.6) + " km/h";
  $("#pressure").textContent = c.main.pressure + " hPa";
  $("#visibility").textContent = (c.visibility != null ? (c.visibility / 1000).toFixed(c.visibility >= 10000 ? 0 : 1) : "--") + " km";
  $("#sunrise").textContent = hhmm(c.sys.sunrise, tz);
  $("#sunset").textContent = hhmm(c.sys.sunset, tz);

  // sun position on the arc (centre 100,98 · radius 90)
  const now = Math.floor(Date.now() / 1000);
  const p = Math.min(1, Math.max(0, (now - c.sys.sunrise) / (c.sys.sunset - c.sys.sunrise)));
  $("#sunDot").setAttribute("cx", 100 - 90 * Math.cos(Math.PI * p));
  $("#sunDot").setAttribute("cy", 98 - 90 * Math.sin(Math.PI * p));

  renderForecast();
}

function dailyForecast() {
  const tz = forecast.city.timezone, days = {};
  forecast.list.forEach((it) => {
    const d = shift(it.dt, tz), key = d.toISOString().slice(0, 10);
    (days[key] = days[key] || []).push({ it, hour: d.getUTCHours(), d });
  });
  return Object.values(days).slice(0, 5).map((arr) => {
    const mid = arr.reduce((a, b) => Math.abs(b.hour - 12) < Math.abs(a.hour - 12) ? b : a);
    return {
      label: mid.d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }),
      hi: Math.max(...arr.map((x) => x.it.main.temp_max)),
      lo: Math.min(...arr.map((x) => x.it.main.temp_min)),
      icon: mid.it.weather[0].icon.replace("n", "d"),
      desc: mid.it.weather[0].description
    };
  });
}

function renderForecast() {
  if (!forecast) return;
  $("#fGrid").innerHTML = dailyForecast().map((d) => `
    <article class="f-card">
      <small>${d.label}</small>
      <img src="${icon(d.icon, "2x")}" alt="${d.desc}">
      <p>${d.desc}</p>
      <b>${temp(d.hi)}° / ${temp(d.lo)}°</b>
    </article>`).join("");
}

/* ---------- events ---------- */
$("#searchForm").addEventListener("submit", (e) => {   // handles the Search button AND the Enter key
  e.preventDefault();
  const v = $("#cityInput").value.trim();
  if (v) loadWeather(v);
});

document.querySelectorAll(".chip").forEach((b) =>
  b.addEventListener("click", () => { $("#cityInput").value = b.dataset.city; loadWeather(b.dataset.city); }));

$("#refreshBtn").addEventListener("click", (e) => {
  e.currentTarget.classList.remove("spin"); void e.currentTarget.offsetWidth; e.currentTarget.classList.add("spin");
  loadWeather(city);
});

function setUnit(u) {
  unit = u; store.set("atmosia-unit", u);
  $("#btnC").classList.toggle("on", u === "C");
  $("#btnF").classList.toggle("on", u === "F");
  render();
}
$("#btnC").addEventListener("click", () => setUnit("C"));
$("#btnF").addEventListener("click", () => setUnit("F"));

$("#themeBtn").addEventListener("click", () => document.body.classList.toggle("dim"));

// navigation: smooth scroll + active link highlight
const navLinks = [...document.querySelectorAll("[data-nav]")];
const sections = navLinks.map((a) => document.querySelector(a.getAttribute("href")));
const io = new IntersectionObserver((entries) => {
  entries.forEach((en) => {
    if (en.isIntersecting) navLinks.forEach((a) => a.classList.toggle("active", a.getAttribute("href") === "#" + en.target.id));
  });
}, { rootMargin: "-40% 0px -50% 0px" });
sections.forEach((s) => s && io.observe(s));

// subtle 3D tilt on the main card (desktop only)
const card = $(".tilt");
if (window.matchMedia("(hover:hover) and (min-width:900px)").matches) {
  card.addEventListener("mousemove", (e) => {
    const r = card.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - .5, y = (e.clientY - r.top) / r.height - .5;
    card.style.transform = `perspective(1200px) rotateY(${x * 5}deg) rotateX(${-y * 4}deg)`;
  });
  card.addEventListener("mouseleave", () => (card.style.transform = ""));
}

/* ---------- start ---------- */
setUnit(unit);
$("#cityInput").value = "";
loadWeather(city);
