/* Soda price per ounce
   Sections: config, storage, helpers, row markup, calculation, rendering, events, startup. */
(() => {
  "use strict";

  // ---------------------------------------------------------------- config

  // Conversion factors to US fluid ounces.
  const OZ_PER_UNIT = { "fl oz": 1, mL: 0.033814, L: 33.814, gal: 128 };

  // Each preset: [value in fl oz, dropdown label, short name used in auto-generated titles]
  const SIZE_GROUPS = [
    {
      group: "Cans and single-serve bottles",
      items: [
        ["7.5", "7.5 fl oz · mini can", "7.5 fl oz"],
        ["8", "8 fl oz", "8 fl oz"],
        ["10", "10 fl oz · slim can", "10 fl oz"],
        ["12", "12 fl oz · standard can", "12 fl oz"],
        ["13.2", "13.2 fl oz · bottle", "13.2 fl oz"],
        ["16", "16 fl oz · tallboy", "16 fl oz"],
        ["16.907", "16.9 fl oz · 500 mL bottle", "16.9 fl oz"],
        ["20", "20 fl oz · bottle", "20 fl oz"],
      ],
    },
    {
      group: "Liter bottles",
      items: [
        ["33.814", "1 L · 33.8 fl oz", "1 L"],
        ["42.268", "1.25 L · 42.3 fl oz", "1.25 L"],
        ["50.721", "1.5 L · 50.7 fl oz", "1.5 L"],
        ["67.628", "2 L · 67.6 fl oz", "2 L"],
        ["101.442", "3 L · 101.4 fl oz", "3 L"],
      ],
    },
  ];
  const PACK_COUNTS = [1, 2, 4, 6, 8, 10, 12, 15, 18, 20, 24, 30, 32, 36];

  const DEFAULT_SIZE = "12";
  const DEFAULT_PACK = "12";
  const DEFAULT_NEED_UNIT = "L";
  const SHELF_TAG_TOLERANCE = 0.03; // 3% difference still counts as a match

  // Same keys as earlier versions so saved entries carry over.
  const STORAGE_KEY = "soda-ppo-rows-v2";
  const NEED_KEY = STORAGE_KEY + "-need";
  const NEED_UNIT_KEY = STORAGE_KEY + "-needunit";

  // -------------------------------------------------------------- elements

  const rowsEl = document.getElementById("rows");
  const bestEl = document.getElementById("best");
  const needEl = document.getElementById("need");
  const needUnitEl = document.getElementById("needUnit");
  let rowCounter = 0;

  // --------------------------------------------------------------- helpers

  const pick = (row, selector) => row.querySelector(selector);
  const cents = (dollarsPerOz) => (dollarsPerOz * 100).toFixed(2) + "¢";
  const dollars = (n) => "$" + n.toFixed(2);
  const escapeHtml = (text) => {
    const span = document.createElement("span");
    span.textContent = text;
    return span.innerHTML;
  };

  const SIZE_OPTIONS_HTML =
    SIZE_GROUPS.map(
      (g) =>
        `<optgroup label="${g.group}">` +
        g.items.map(([value, label, short]) => `<option value="${value}" data-short="${short}">${label}</option>`).join("") +
        "</optgroup>"
    ).join("") + '<option value="custom" data-short="">Custom size…</option>';

  const PACK_OPTIONS_HTML =
    PACK_COUNTS.map((n) => `<option value="${n}">${n === 1 ? "Single" : n + "-pack"}</option>`).join("") +
    '<option value="other">Other count…</option>';

  const UNIT_OPTIONS_HTML = Object.keys(OZ_PER_UNIT).map((u) => `<option>${u}</option>`).join("");

  // --------------------------------------------------------------- storage

  function readRowsFromDom() {
    return [...rowsEl.children].map((row) => ({
      name: pick(row, ".f-name").value,
      size: pick(row, ".f-size").value,
      vol: pick(row, ".f-vol").value,
      unit: pick(row, ".f-unit").value,
      pack: pick(row, ".f-pack").value,
      count: pick(row, ".f-count").value,
      price: pick(row, ".f-price").value,
      shelf: pick(row, ".f-shelf").value,
    }));
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(readRowsFromDom()));
      localStorage.setItem(NEED_KEY, needEl.value);
      localStorage.setItem(NEED_UNIT_KEY, needUnitEl.value);
    } catch (e) {
      /* storage can be unavailable (private mode); the app still works */
    }
  }

  function loadRows() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (Array.isArray(saved) && saved.length) return saved;
    } catch (e) {}
    return null;
  }

  function loadNeed() {
    try {
      needEl.value = localStorage.getItem(NEED_KEY) || "";
      needUnitEl.value = localStorage.getItem(NEED_UNIT_KEY) || DEFAULT_NEED_UNIT;
    } catch (e) {}
  }

  // ------------------------------------------------------------ row markup

  function rowMarkup(id) {
    return `
      <div class="top">
        <input class="f-name" type="text" autocomplete="off" enterkeyhint="next" placeholder="Name (optional)" aria-label="Name (optional)">
        <button class="remove" type="button" aria-label="Remove this option">×</button>
      </div>
      <div class="grid">
        <div><label for="s${id}">Size of each</label><select class="f-size" id="s${id}">${SIZE_OPTIONS_HTML}</select></div>
        <div><label for="k${id}">Pack</label><select class="f-pack" id="k${id}">${PACK_OPTIONS_HTML}</select></div>
        <div class="sub full custom-size" hidden>
          <div><label for="v${id}">Volume</label><input class="f-vol" id="v${id}" type="number" inputmode="decimal" min="0" step="any" placeholder="e.g. 24"></div>
          <div><label for="u${id}">Unit</label><select class="f-unit" id="u${id}">${UNIT_OPTIONS_HTML}</select></div>
        </div>
        <div class="full custom-pack" hidden>
          <label for="c${id}">Number of containers</label>
          <input class="f-count" id="c${id}" type="number" inputmode="numeric" min="0" step="1" placeholder="e.g. 7">
        </div>
        <div>
          <label for="p${id}">Total price</label>
          <div class="money"><span>$</span><input class="f-price" id="p${id}" type="number" inputmode="decimal" min="0" step="any" enterkeyhint="done" placeholder="0.00"></div>
        </div>
        <div class="out"><div class="ppo"></div><div class="note"></div></div>
      </div>
      <details>
        <summary>Check against shelf tag</summary>
        <div>
          <label for="t${id}">Unit price on the tag, in cents per fl oz</label>
          <input class="f-shelf" id="t${id}" type="number" inputmode="decimal" min="0" step="any" enterkeyhint="done" placeholder="e.g. 5.5">
        </div>
      </details>
      <div class="extra"></div>`;
  }

  function setSelect(select, value, fallback) {
    select.value = value || fallback;
    if (!select.value) select.value = fallback; // saved value no longer in the list
  }

  function addRow(saved = {}) {
    const row = document.createElement("div");
    row.className = "row";
    row.innerHTML = rowMarkup(++rowCounter);

    pick(row, ".f-name").value = saved.name || "";
    setSelect(pick(row, ".f-size"), saved.size, DEFAULT_SIZE);
    pick(row, ".f-vol").value = saved.vol || "";
    if (saved.unit) pick(row, ".f-unit").value = saved.unit;
    setSelect(pick(row, ".f-pack"), saved.pack, DEFAULT_PACK);
    pick(row, ".f-count").value = saved.count || "";
    pick(row, ".f-price").value = saved.price || "";
    pick(row, ".f-shelf").value = saved.shelf || "";
    if (saved.shelf) pick(row, "details").open = true;

    row.addEventListener("input", update);
    row.addEventListener("change", update);

    // Tapping a number field selects it, so typing replaces the old value.
    row.addEventListener("focusin", (e) => {
      if (e.target.type === "number") {
        try { e.target.select(); } catch (err) {}
      }
    });

    // Enter jumps to the next visible field.
    row.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" || e.target.tagName !== "INPUT") return;
      e.preventDefault();
      const fields = [...document.querySelectorAll("input, select")].filter((n) => n.offsetParent !== null);
      const next = fields[fields.indexOf(e.target) + 1];
      if (next) next.focus();
      else e.target.blur();
    });

    pick(row, ".remove").addEventListener("click", () => {
      row.remove();
      if (!rowsEl.children.length) addRow();
      update();
    });

    rowsEl.appendChild(row);
  }

  // ----------------------------------------------------------- calculation

  // Reads one row's inputs and works out its volume and unit price.
  function measureRow(row, index) {
    const size = pick(row, ".f-size").value;
    const pack = pick(row, ".f-pack").value;
    const unit = pick(row, ".f-unit").value;
    const volume = parseFloat(pick(row, ".f-vol").value);

    const ozEach = size === "custom" ? volume * OZ_PER_UNIT[unit] : parseFloat(size);
    const count = pack === "other" ? parseFloat(pick(row, ".f-count").value) : parseFloat(pack);
    const price = parseFloat(pick(row, ".f-price").value);
    const shelf = parseFloat(pick(row, ".f-shelf").value);

    const valid = ozEach > 0 && count > 0 && price >= 0;
    const totalOz = valid ? ozEach * count : 0;

    const shortSize =
      size === "custom"
        ? volume > 0 ? `${volume} ${unit}` : ""
        : pick(row, ".f-size").selectedOptions[0].getAttribute("data-short");
    const typedName = pick(row, ".f-name").value.trim();
    const name = typedName || (count > 0 && shortSize ? `${count} × ${shortSize}` : `Option ${index + 1}`);

    return {
      row, name, count, price, shelf, totalOz,
      pricePerOz: valid && totalOz > 0 ? price / totalOz : null,
    };
  }

  // The "set amount" the person wants to buy, or null if blank.
  function readNeed() {
    const amount = parseFloat(needEl.value);
    const unit = needUnitEl.value;
    const oz = amount * OZ_PER_UNIT[unit];
    if (!(oz > 0)) return null;
    const label = unit === "fl oz" ? `${amount} ${unit}` : `${amount} ${unit} (${oz.toFixed(1)} fl oz)`;
    return { oz, label };
  }

  // For a set amount: whole packs needed, their cost, and ounces received.
  // Returns the option with the lowest total (ties go to more volume).
  function assignWholePackTotals(options, needOz) {
    let cheapest = null;
    options.forEach((o) => {
      o.packs = Math.max(1, Math.ceil(needOz / o.totalOz - 1e-9));
      o.total = o.packs * o.price;
      o.received = o.packs * o.totalOz;
      if (!cheapest || o.total < cheapest.total || (o.total === cheapest.total && o.received > cheapest.received)) {
        cheapest = o;
      }
    });
    return cheapest;
  }

  const lowestBy = (options, key) => options.reduce((a, b) => (!a || b[key] < a[key] ? b : a), null);

  // ------------------------------------------------------------- rendering

  function renderRow(o, ctx) {
    const { best, comparing, need, cheapestTotal } = ctx;
    const ppoEl = pick(o.row, ".ppo");
    const noteEl = pick(o.row, ".note");
    const extraEl = pick(o.row, ".extra");

    o.row.classList.toggle("is-best", comparing && o === best);

    if (o.pricePerOz === null) {
      ppoEl.textContent = "—";
      noteEl.textContent = "Add a price";
      extraEl.innerHTML = "";
      return;
    }

    ppoEl.textContent = cents(o.pricePerOz) + "/oz";
    const ozText = o.totalOz.toFixed(1) + " fl oz";
    if (!comparing && o === best) noteEl.textContent = ozText + " total";
    else if (o === best) noteEl.textContent = "Best price · " + ozText;
    else noteEl.textContent = Math.round((o.pricePerOz / best.pricePerOz - 1) * 100) + "% more than best · " + ozText;

    const lines = [`<span>${dollars(o.price / o.count)} per container</span>`];

    if (need) {
      const extraOz = o.received - need.oz;
      const text =
        `For ${need.label}: ${o.packs} × this pack = ${dollars(o.total)} ` +
        `(${o.received.toFixed(1)} fl oz${extraOz > 0.05 ? ", " + extraOz.toFixed(1) + " extra" : ""})`;
      lines.push(comparing && o === cheapestTotal ? `<span class="ok">${text} · lowest total</span>` : `<span>${text}</span>`);
    }

    if (o.shelf > 0) {
      const diff = Math.abs(o.shelf / 100 - o.pricePerOz);
      if (diff <= 0.0005 || diff / o.pricePerOz <= SHELF_TAG_TOLERANCE) {
        lines.push('<span class="ok">Matches the shelf tag</span>');
      } else {
        lines.push(
          `<span class="warn">Tag says ${o.shelf.toFixed(2)}¢/oz, your numbers give ${cents(o.pricePerOz)}. Recheck size, count, or price.</span>`
        );
      }
    }
    extraEl.innerHTML = lines.join("");
  }

  function renderBanner(best, validCount) {
    let left, right;
    if (!best) {
      left = '<div class="big">—</div><div class="unit">per fl oz</div>';
      right = '<div class="who">Enter a price to start</div>';
    } else {
      left = `<div class="big">${cents(best.pricePerOz)}</div><div class="unit">per fl oz</div>`;
      right =
        validCount === 1
          ? '<div class="who">Add a second option to compare</div>'
          : `<div class="who"><span>Best price</span><strong>${escapeHtml(best.name)}</strong></div>`;
    }
    bestEl.innerHTML = `<div class="best-inner"><div>${left}</div>${right}</div>`;
  }

  function update() {
    const rows = [...rowsEl.children];

    // Show the extra fields only when "Custom" / "Other" is chosen.
    rows.forEach((row) => {
      pick(row, ".custom-size").hidden = pick(row, ".f-size").value !== "custom";
      pick(row, ".custom-pack").hidden = pick(row, ".f-pack").value !== "other";
    });

    const options = rows.map(measureRow);
    const valid = options.filter((o) => o.pricePerOz !== null);
    const best = lowestBy(valid, "pricePerOz");
    const need = readNeed();
    const cheapestTotal = need ? assignWholePackTotals(valid, need.oz) : null;
    const ctx = { best, comparing: valid.length > 1, need, cheapestTotal };

    options.forEach((o) => renderRow(o, ctx));
    renderBanner(best, valid.length);
    save();
  }

  // ---------------------------------------------------------------- events

  document.getElementById("add").addEventListener("click", () => {
    addRow();
    update();
    const last = rowsEl.lastElementChild;
    last.scrollIntoView({ block: "center", behavior: "smooth" });
    pick(last, ".f-price").focus({ preventScroll: true });
  });

  document.getElementById("clear").addEventListener("click", () => {
    rowsEl.innerHTML = "";
    needEl.value = "";
    needUnitEl.value = DEFAULT_NEED_UNIT;
    addRow();
    addRow();
    update();
    window.scrollTo(0, 0);
  });

  needEl.addEventListener("input", update);
  needUnitEl.addEventListener("change", update);

  // --------------------------------------------------------------- startup

  loadNeed();
  const savedRows = loadRows();
  if (savedRows) savedRows.forEach(addRow);
  else { addRow(); addRow(); }
  update();

  // Offline support: the service worker caches the app after the first visit.
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    });
  }
})();
