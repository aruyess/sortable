const API = "https://rawcdn.githack.com/akabab/superhero-api/0.2.0/api/all.json";

const COLUMNS = [
  { key: "images.xs",               label: "Icon",        sortable: false, type: "image" },
  { key: "name",                    label: "Name",        sortable: true,  type: "string" },
  { key: "biography.fullName",      label: "Full Name",   sortable: true,  type: "string" },
  { key: "powerstats.intelligence", label: "INT",         sortable: true,  type: "number" },
  { key: "powerstats.strength",     label: "STR",         sortable: true,  type: "number" },
  { key: "powerstats.speed",        label: "SPD",         sortable: true,  type: "number" },
  { key: "powerstats.durability",   label: "DUR",         sortable: true,  type: "number" },
  { key: "powerstats.power",        label: "POW",         sortable: true,  type: "number" },
  { key: "powerstats.combat",       label: "CMB",         sortable: true,  type: "number" },
  { key: "appearance.race",         label: "Race",        sortable: true,  type: "string" },
  { key: "appearance.gender",       label: "Gender",      sortable: true,  type: "string" },
  { key: "appearance.height",       label: "Height",      sortable: true,  type: "measure" },
  { key: "appearance.weight",       label: "Weight",      sortable: true,  type: "measure" },
  { key: "biography.placeOfBirth",  label: "Place of Birth", sortable: true, type: "string" },
  { key: "biography.alignment",     label: "Alignment",   sortable: true,  type: "string" },
];

const SEARCH_FIELDS = [
  { key: "name",                    label: "Name",          type: "string" },
  { key: "biography.fullName",      label: "Full Name",     type: "string" },
  { key: "appearance.race",         label: "Race",          type: "string" },
  { key: "appearance.gender",       label: "Gender",        type: "string" },
  { key: "biography.placeOfBirth",  label: "Place of Birth",type: "string" },
  { key: "biography.alignment",     label: "Alignment",     type: "string" },
  { key: "biography.publisher",     label: "Publisher",     type: "string" },
  { key: "appearance.height",       label: "Height",        type: "measure" },
  { key: "appearance.weight",       label: "Weight",        type: "measure" },
  { key: "powerstats.intelligence", label: "Intelligence",  type: "number" },
  { key: "powerstats.strength",     label: "Strength",      type: "number" },
  { key: "powerstats.speed",        label: "Speed",         type: "number" },
  { key: "powerstats.durability",   label: "Durability",    type: "number" },
  { key: "powerstats.power",        label: "Power",         type: "number" },
  { key: "powerstats.combat",       label: "Combat",        type: "number" },
];

const STRING_OPS = [
  { value: "include", label: "include" },
  { value: "exclude", label: "exclude" },
  { value: "fuzzy",   label: "fuzzy" },
  { value: "equal",   label: "equal" },
];

const NUMBER_OPS = [
  { value: "eq",  label: "=" },
  { value: "neq", label: "≠" },
  { value: "gt",  label: ">" },
  { value: "lt",  label: "<" },
];

const state = {
  all: [],
  filtered: [],
  sortKey: "name",
  sortDir: "asc",
  page: 1,
  pageSize: 20,
  query: "",
  field: "name",
  op: "include",
  heroSlug: null,
};

// Спускаемся по объекту по пути "a.b.c" через reduce.
const getPath = (obj, path) =>
  path.split(".").reduce((acc, key) => (acc == null ? acc : acc[key]), obj);

const isMissing = (v) => v == null || v === "" || v === "-";

// Извлекаем первое число из строки regexp-ом: "78 kg" -> 78.
const parseNumber = (v) => {
  if (isMissing(v)) return null;
  const match = String(v).match(/-?\d+(\.\d+)?/);
  return match ? parseFloat(match[0]) : null;
};

// В API height/weight хранятся как ["6'2", "188 cm"] — берём метрическое.
const normalizeMeasure = (v) => {
  if (Array.isArray(v)) return v[1] || v[0];
  return v;
};

const fieldByKey = (key) => SEARCH_FIELDS.find((f) => f.key === key) || SEARCH_FIELDS[0];

// Fuzzy: символы needle встречаются в haystack в том же порядке (не обязательно подряд).
const fuzzyMatch = (haystack, needle) => {
  let i = 0;
  for (let j = 0; j < haystack.length && i < needle.length; j += 1) {
    if (haystack[j] === needle[i]) i += 1;
  }
  return i === needle.length;
};

// Замыкание: возвращает предикат (hero) => bool под выбранное поле/оператор/запрос.
const makeMatcher = (field, op, rawQuery) => {
  const q = rawQuery.trim();
  if (!q) return () => true;

  if (field.type === "string") {
    const needle = q.toLowerCase();
    return (hero) => {
      const raw = getPath(hero, field.key);
      const val = isMissing(raw) ? "" : String(raw).toLowerCase();
      if (op === "include") return val.includes(needle);
      if (op === "exclude") return !val.includes(needle);
      if (op === "equal")   return val === needle;
      if (op === "fuzzy")   return fuzzyMatch(val, needle);
      return true;
    };
  }

  const numQ = parseFloat(q);
  if (isNaN(numQ)) return () => true;

  return (hero) => {
    const raw = getPath(hero, field.key);
    const numVal = field.type === "measure"
      ? parseNumber(normalizeMeasure(raw))
      : (typeof raw === "number" ? raw : null);
    if (numVal === null) return false;
    if (op === "eq")  return numVal === numQ;
    if (op === "neq") return numVal !== numQ;
    if (op === "gt")  return numVal > numQ;
    if (op === "lt")  return numVal < numQ;
    return true;
  };
};

// Замыкание: компаратор для .sort. Пропуски всегда в конец, числа сравниваются как числа.
const makeCompare = (key, dir, type) => {
  const mult = dir === "asc" ? 1 : -1;
  return (a, b) => {
    let va = getPath(a, key);
    let vb = getPath(b, key);

    if (type === "measure") {
      va = parseNumber(normalizeMeasure(va));
      vb = parseNumber(normalizeMeasure(vb));
    } else if (type === "number") {
      va = typeof va === "number" ? va : null;
      vb = typeof vb === "number" ? vb : null;
    } else {
      va = isMissing(va) ? null : String(va).toLowerCase();
      vb = isMissing(vb) ? null : String(vb).toLowerCase();
    }

    if (va === null && vb === null) return 0;
    if (va === null) return 1;
    if (vb === null) return -1;
    if (va < vb) return -1 * mult;
    if (va > vb) return  1 * mult;
    return 0;
  };
};

// Ручная сериализация URL: {k: v} -> "?k=v&...".
const buildQuery = (obj) => {
  const parts = Object.keys(obj)
    .filter((k) => obj[k] !== "" && obj[k] != null)
    .map((k) => encodeURIComponent(k) + "=" + encodeURIComponent(obj[k]));
  return parts.length ? "?" + parts.join("&") : "";
};

// Обратный разбор query-строки через split + reduce.
const parseQuery = (search) => {
  if (!search || search.length < 2) return {};
  return search.slice(1).split("&").reduce((acc, pair) => {
    const eqIdx = pair.indexOf("=");
    if (eqIdx < 0) return acc;
    const k = decodeURIComponent(pair.slice(0, eqIdx));
    const v = decodeURIComponent(pair.slice(eqIdx + 1));
    if (k) acc[k] = v;
    return acc;
  }, {});
};

// Пишем в URL только изменённые относительно defaults поля.
const syncURL = () => {
  const params = {};
  if (state.query.trim())         params.q = state.query;
  if (state.field !== "name")     params.field = state.field;
  if (state.op !== "include")     params.op = state.op;
  if (state.sortKey !== "name")   params.sort = state.sortKey;
  if (state.sortDir !== "asc")    params.dir = state.sortDir;
  if (state.pageSize !== 20)      params.size = state.pageSize;
  if (state.page !== 1)           params.page = state.page;
  if (state.heroSlug)             params.hero = state.heroSlug;

  const qs = buildQuery(params);
  window.history.replaceState(null, "", qs || window.location.pathname);
};

const loadURL = () => {
  const p = parseQuery(window.location.search);
  state.query    = p.q || "";
  state.field    = p.field || "name";
  state.op       = p.op || (fieldByKey(state.field).type === "string" ? "include" : "eq");
  state.sortKey  = p.sort || "name";
  state.sortDir  = p.dir === "desc" ? "desc" : "asc";
  if (p.size === "all") state.pageSize = "all";
  else if (p.size)      state.pageSize = Number(p.size);
  state.page     = Number(p.page) || 1;
  state.heroSlug = p.hero || null;
};

const renderHead = () => {
  const row = document.querySelector("#headRow");
  row.innerHTML = "";

  COLUMNS.forEach((col) => {
    const th = document.createElement("th");
    th.textContent = col.label;

    if (col.sortable) {
      th.style.cursor = "pointer";
      th.setAttribute("aria-sort",
        state.sortKey === col.key
          ? (state.sortDir === "asc" ? "ascending" : "descending")
          : "none");
      if (state.sortKey === col.key) {
        const arrow = document.createElement("span");
        arrow.className = "arrow";
        arrow.textContent = state.sortDir === "asc" ? " ▲" : " ▼";
        th.appendChild(arrow);
      }
      th.addEventListener("click", () => onSort(col.key));
    } else {
      th.style.cursor = "default";
    }

    row.appendChild(th);
  });
};

// Рисуем только текущую страницу (slice) — быстрее для 700+ записей.
const renderBody = () => {
  const body = document.querySelector("#body");
  body.innerHTML = "";

  const size = state.pageSize === "all" ? state.filtered.length : state.pageSize;
  const start = (state.page - 1) * size;
  const pageRows = state.filtered.slice(start, start + size);

  pageRows.forEach((hero) => {
    const tr = document.createElement("tr");
    tr.addEventListener("click", () => openDetail(hero));

    COLUMNS.forEach((col) => {
      const td = document.createElement("td");
      let val = getPath(hero, col.key);

      if (col.type === "image") {
        const img = document.createElement("img");
        img.src = val || "";
        img.alt = hero.name;
        img.loading = "lazy";
        td.appendChild(img);
      } else {
        if (col.type === "measure") val = normalizeMeasure(val);
        td.textContent = isMissing(val) ? "—" : val;
      }

      tr.appendChild(td);
    });

    body.appendChild(tr);
  });
};

const renderPager = () => {
  const size = state.pageSize === "all" ? state.filtered.length || 1 : state.pageSize;
  const totalPages = Math.max(1, Math.ceil(state.filtered.length / size));
  if (state.page > totalPages) state.page = totalPages;

  document.querySelector("#pageInfo").textContent = `Page ${state.page} of ${totalPages}`;
  document.querySelector("#prev").disabled = state.page <= 1;
  document.querySelector("#next").disabled = state.page >= totalPages;
  document.querySelector("#counter").textContent = `${state.filtered.length} hero(es)`;
};

const render = () => {
  renderHead();
  renderBody();
  renderPager();
  syncURL();
};

// Pipeline: событие -> state -> filter -> sort -> render -> URL.
const applyFilter = () => {
  const field = fieldByKey(state.field);
  const matcher = makeMatcher(field, state.op, state.query);
  state.filtered = state.all.filter(matcher);
  applySort();
};

const applySort = () => {
  const col = COLUMNS.find((c) => c.key === state.sortKey);
  if (col) {
    const cmp = makeCompare(state.sortKey, state.sortDir, col.type);
    state.filtered.sort(cmp);
  }
  render();
};

// Тот же столбец — toggle asc/desc; другой — сброс на asc.
const onSort = (key) => {
  if (state.sortKey === key) {
    state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
  } else {
    state.sortKey = key;
    state.sortDir = "asc";
  }
  state.page = 1;
  applySort();
};

const populateFieldSelect = () => {
  const sel = document.querySelector("#searchField");
  sel.innerHTML = "";
  SEARCH_FIELDS.forEach((f) => {
    const opt = document.createElement("option");
    opt.value = f.key;
    opt.textContent = f.label;
    if (f.key === state.field) opt.selected = true;
    sel.appendChild(opt);
  });
};

// При смене поля тип может смениться (string↔number) — перезаполняем операторы.
const populateOpSelect = () => {
  const sel = document.querySelector("#searchOp");
  const field = fieldByKey(state.field);
  const ops = field.type === "string" ? STRING_OPS : NUMBER_OPS;

  if (!ops.some((o) => o.value === state.op)) {
    state.op = ops[0].value;
  }

  sel.innerHTML = "";
  ops.forEach((o) => {
    const opt = document.createElement("option");
    opt.value = o.value;
    opt.textContent = o.label;
    if (o.value === state.op) opt.selected = true;
    sel.appendChild(opt);
  });
};

const openDetail = (hero) => {
  state.heroSlug = hero.slug || null;
  const body = document.querySelector("#detailBody");
  body.innerHTML = "";

  const images = hero.images || {};
  const img = document.createElement("img");
  img.src = images.lg || images.md || images.xs || "";
  img.alt = hero.name;
  body.appendChild(img);

  const h2 = document.createElement("h2");
  h2.textContent = hero.name;
  body.appendChild(h2);

  const sub = document.createElement("p");
  sub.style.color = "var(--muted)";
  sub.textContent = (hero.biography && hero.biography.fullName) || "—";
  body.appendChild(sub);

  const bio = hero.biography || {};
  const app = hero.appearance || {};
  const work = hero.work || {};
  const ps = hero.powerstats || {};

  const fields = [
    ["Race",         app.race],
    ["Gender",       app.gender],
    ["Height",       normalizeMeasure(app.height)],
    ["Weight",       normalizeMeasure(app.weight)],
    ["Birthplace",   bio.placeOfBirth],
    ["Alignment",    bio.alignment],
    ["Publisher",    bio.publisher],
    ["Occupation",   work.occupation],
    ["Intelligence", ps.intelligence],
    ["Strength",     ps.strength],
    ["Speed",        ps.speed],
    ["Durability",   ps.durability],
    ["Power",        ps.power],
    ["Combat",       ps.combat],
  ];

  const dl = document.createElement("dl");
  fields.forEach(([k, v]) => {
    const dt = document.createElement("dt");
    dt.textContent = k;
    const dd = document.createElement("dd");
    dd.textContent = isMissing(v) ? "—" : v;
    dl.appendChild(dt);
    dl.appendChild(dd);
  });
  body.appendChild(dl);

  const modal = document.querySelector("#detail");
  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");
  syncURL();
};

const closeDetail = () => {
  state.heroSlug = null;
  const modal = document.querySelector("#detail");
  modal.classList.remove("open");
  modal.setAttribute("aria-hidden", "true");
  syncURL();
};

const bindEvents = () => {
  document.querySelector("#search").addEventListener("input", (e) => {
    state.query = e.target.value;
    state.page = 1;
    applyFilter();
  });

  document.querySelector("#searchField").addEventListener("change", (e) => {
    state.field = e.target.value;
    populateOpSelect();
    state.page = 1;
    applyFilter();
  });

  document.querySelector("#searchOp").addEventListener("change", (e) => {
    state.op = e.target.value;
    state.page = 1;
    applyFilter();
  });

  document.querySelector("#pageSize").addEventListener("change", (e) => {
    const v = e.target.value;
    state.pageSize = v === "all" ? "all" : Number(v);
    state.page = 1;
    render();
  });

  document.querySelector("#prev").addEventListener("click", () => {
    state.page -= 1;
    render();
  });

  document.querySelector("#next").addEventListener("click", () => {
    state.page += 1;
    render();
  });

  document.querySelector("#closeDetail").addEventListener("click", closeDetail);
  document.querySelector("#detail").addEventListener("click", (e) => {
    if (e.target.id === "detail") closeDetail();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && state.heroSlug) closeDetail();
  });
};

const syncControlsFromState = () => {
  document.querySelector("#search").value = state.query;
  document.querySelector("#pageSize").value = String(state.pageSize);
  populateFieldSelect();
  populateOpSelect();
};

// Порядок важен: сначала читаем URL в state, потом fetch, потом рисуем.
const init = async () => {
  try {
    loadURL();
    const response = await fetch(API);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const heroes = await response.json();
    state.all = heroes;
    syncControlsFromState();
    bindEvents();
    applyFilter();

    if (state.heroSlug) {
      const hero = state.all.find((h) => h.slug === state.heroSlug);
      if (hero) openDetail(hero);
    }
  } catch (err) {
    document.querySelector("#body").innerHTML =
      `<tr><td colspan="${COLUMNS.length}">Failed to load: ${err.message}</td></tr>`;
  }
};

init();
