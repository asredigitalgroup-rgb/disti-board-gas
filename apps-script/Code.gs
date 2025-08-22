/**
 * DISTI BOARD – 2025 Clean Backend (Apps Script)
 * Uses Google Sheets as DB (PRODUCTS DB + DISTI BOARD files)
 * Exposes: whoAmI, getCategories, listProducts, updateProduct, setFavorite
 * Robust validation, role checks, audit logging, and consistent envelopes.
 */

const CONFIG = {
  // <<— Spreadsheet IDs provided by you
  PRODUCTS_DB_ID: '1MHYOcvzQUcZrZkJVwscrqAgMUQzHMMnLdPBbyir18X4',
  DISTI_BOARD_ID: '1LsNFNkDAYYhXd5iuIQ-qk9R8pzvy1EgxLtiHBDGBNB4',

  SHEETS: {
    USERS: 'USERS',
    PREFS_FAV: 'PREFS_FAV',
    PREFS_NOTES: 'PREFS_NOTES',
    AUDIT_LOG: 'AUDIT_LOG',
    META: 'META',
    SYNC_CATEGORIES: 'SYNC_CATEGORIES'
  },

  // Fallback list if SYNC_CATEGORIES is empty/missing
  FALLBACK_TABS: [
    'CPU','MB','VGA','RAM',
    'STORAGE_SSD','STORAGE_HDD',
    'COOLING_LIQUID','COOLING_AIR','COOLING_FAN',
    'POWER','CASE','MONITOR','KEYBOARD','MOUSE',
    'AUDIO_HEADSET','AUDIO_SPEAKER',
    'PERIPHERAL_MICROPHONE','PERIPHERAL_WEBCAM','PERIPHERAL_ACCESSORIES',
    'FURNITURE_CHAIR','FURNITURE_DESK','FURNITURE_ACCESSORIES'
  ],

  // QTY coloring rule: >=10 green, 3–9 yellow, <3 red
  QTY_LEVELS: { green: 10, yellow: 3 }
};

// ====== HTTP Entrypoint ======
function doGet() {
  return HtmlService.createTemplateFromFile('index')
    .evaluate()
    .setTitle('DISTI TRADE BOARD')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ====== Utilities ======
function _ss(id) { return SpreadsheetApp.openById(id); }
function _sh(ss, name) {
  const s = ss.getSheetByName(name);
  if (!s) throw new Error('Missing sheet: ' + name);
  return s;
}
function _headers(s) {
  const lc = s.getLastColumn();
  if (lc < 1) return [];
  return (s.getRange(1,1,1,lc).getValues()[0] || []).map(h => String(h || '').trim());
}
function _rows(s) {
  if (s.getLastRow() < 2) return [];
  return s.getRange(2, 1, s.getLastRow()-1, s.getLastColumn()).getValues();
}
function _asObj(H, row) {
  const o = {};
  H.forEach((h, i) => o[h] = row[i]);
  return o;
}
function _nowISO() { return new Date().toISOString(); }
function _email() { return Session.getActiveUser().getEmail() || 'anonymous@local'; }

function _mapPersianDigits(str) {
  if (str === null || str === undefined) return str;
  const s = String(str);
  // Persian (۰۱۲۳۴۵۶۷۸۹), Arabic (٠١٢٣٤٥٦٧٨٩)
  const map = {'۰':'0','۱':'1','۲':'2','۳':'3','۴':'4','۵':'5','۶':'6','۷':'7','۸':'8','۹':'9','٠':'0','١':'1','٢':'2','٣':'3','٤':'4','٥':'5','٦':'6','٧':'7','٨':'8','٩':'9'};
  return s.replace(/[۰-۹٠-٩]/g, d => map[d] || d);
}
function _num(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return isFinite(v) ? v : null;
  const s = _mapPersianDigits(String(v)).replace(/[^0-9.\-]/g, '');
  const f = parseFloat(s);
  return isNaN(f) ? null : f;
}
function _bool(v) {
  if (typeof v === 'boolean') return v;
  const s = String(v || '').trim().toLowerCase();
  return ['1','true','yes','y','on'].includes(s);
}
function _ok(data) { return { ok: true, data }; }
function _fail(message) { return { ok: false, error: String(message || 'Unknown error') }; }

// Role helpers
const _ROLE_RANK = { viewer: 1, editor: 2, admin: 3 };
function _getUserRecord() {
  const email = _email();
  try {
    const sh = _sh(_ss(CONFIG.DISTI_BOARD_ID), CONFIG.SHEETS.USERS);
    const H = _headers(sh);
    const rows = _rows(sh).map(r => _asObj(H, r));
    const rec = rows.find(r => String(r.EMAIL || '').trim().toLowerCase() === email.toLowerCase());
    if (rec) {
      return {
        email,
        role: String(rec.ROLE || 'viewer').toLowerCase(),
        displayName: rec.DISPLAY_NAME || rec.NAME || '',
        avatar: rec.AVATAR_URL || ''
      };
    }
  } catch (e) { /* optional */ }
  return { email, role: 'viewer', displayName: '', avatar: '' };
}
function _requireRole(minRole) {
  const u = _getUserRecord();
  if (_ROLE_RANK[u.role] < _ROLE_RANK[minRole]) {
    throw new Error('Permission denied: requires ' + minRole + ' role.');
  }
  return u;
}

// ====== API: Identity ======
function whoAmI() {
  try {
    const u = _getUserRecord();
    return _ok(u);
  } catch (err) {
    return _fail(err.message);
  }
}

// ====== API: Categories ======
function getCategories() {
  try {
    const ss = _ss(CONFIG.DISTI_BOARD_ID);
    try {
      const sh = _sh(ss, CONFIG.SHEETS.SYNC_CATEGORIES);
      const H = _headers(sh);
      const rows = _rows(sh).map(r => _asObj(H, r));
      // Expected columns: TAB, TITLE (optional), GROUP_BY (optional), ORDER (optional)
      const cats = rows
        .filter(r => String(r.TAB || '').trim())
        .sort((a, b) => (_num(a.ORDER || 0) - _num(b.ORDER || 0)))
        .map(r => ({
          tab: String(r.TAB).trim(),
          title: String(r.TITLE || r.TAB).trim(),
          groupBy: String(r.GROUP_BY || '').trim()
        }));
      if (cats.length) return _ok(cats);
    } catch (e) { /* fall back */ }
    return _ok(CONFIG.FALLBACK_TABS.map(t => ({ tab: t, title: t, groupBy: '' })));
  } catch (err) {
    return _fail(err.message);
  }
}

// ====== API: Products ======
function listProducts(tab, opts) {
  try {
    if (!tab) throw new Error('tab is required');
    const ss = _ss(CONFIG.PRODUCTS_DB_ID);
    const sh = _sh(ss, tab);
    const H = _headers(sh);
    const rows = _rows(sh).map(r => _asObj(H, r));

    // Fetch favorites (optional)
    let favSet = new Set();
    try {
      const prefSh = _sh(_ss(CONFIG.DISTI_BOARD_ID), CONFIG.SHEETS.PREFS_FAV);
      const HP = _headers(prefSh);
      const PRows = _rows(prefSh).map(r => _asObj(HP, r));
      const me = _email().toLowerCase();
      PRows.filter(p => String(p.EMAIL || '').toLowerCase() === me && _bool(p.FAVORITE))
           .forEach(p => favSet.add(String(p.SKU || '').trim()));
    } catch (e) { /* optional */ }

    // Normalize and map columns (case/alias tolerant)
    const get = (rec, keys) => {
      for (let k of keys) {
        if (k in rec && rec[k] !== '' && rec[k] !== null && rec[k] !== undefined) return rec[k];
      }
      return '';
    };

    const clean = rows
      .filter(r => {
        const active = get(r, ['Active','ACTIVE']);
        return active === '' ? true : _bool(active);
      })
      .map(r => {
        const sku = String(get(r, ['SKU'])).trim();
        const brand = String(get(r, ['BRAND'])).trim();
        const series = String(get(r, ['SERIES'])).trim();
        const model = String(get(r, ['MODEL','MODEL NAME'])).trim();
        const salesPrice = _num(get(r, ['SALES PRICE','SALES','SELL']));
        const qty = _num(get(r, ['QTY','QUANTITY']));
        const market = _num(get(r, ['MARKET','MARKET PRICE']));
        const retail = _num(get(r, ['RETAIL','RETAIL PRICE']));
        const guarantee = String(get(r, ['GUARANTEE'])).trim();
        const grntDu = String(get(r, ['GRNT_DU','GU DU'])).trim();
        const note = String(get(r, ['NOTE'])).trim();
        if (!sku) return null;
        return { sku, brand, series, model, salesPrice, qty, market, retail, guarantee, grntDu, note };
      })
      .filter(Boolean);

    // Favorite flag + qty level
    clean.forEach(p => {
      p.favorite = favSet.has(p.sku);
      const qv = _num(p.qty) || 0;
      p.qtyLevel = (qv >= CONFIG.QTY_LEVELS.green) ? 'in' : (qv >= CONFIG.QTY_LEVELS.yellow ? 'low' : 'out');
    });

    // Server-side search / onlyFavorites (optional)
    const q = (opts && opts.search) ? String(opts.search).toLowerCase().trim() : '';
    const onlyFav = !!(opts && opts.onlyFavorites);
    let out = clean.filter(p => {
      if (onlyFav && !p.favorite) return false;
      if (!q) return true;
      return (
        (p.sku || '').toLowerCase().includes(q) ||
        (p.brand || '').toLowerCase().includes(q) ||
        (p.series || '').toLowerCase().includes(q) ||
        (p.model || '').toLowerCase().includes(q)
      );
    });

    // Sort
    if (opts && opts.sort && opts.sort.field) {
      const f = opts.sort.field;
      const dir = (opts.sort.direction || 'asc').toLowerCase();
      out.sort((a, b) => {
        const va = a[f], vb = b[f];
        if (va == null && vb == null) return 0;
        if (va == null) return 1;
        if (vb == null) return -1;
        if (typeof va === 'number' && typeof vb === 'number') return dir === 'asc' ? (va - vb) : (vb - va);
        return dir === 'asc' ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va));
      });
    }

    return _ok({ tab, count: out.length, products: out });
  } catch (err) {
    return _fail(err.message);
  }
}

// ====== API: Update Product (role-protected) ======
function updateProduct(payload) {
  try {
    const u = _requireRole('editor'); // editor/admin
    const { tab, sku } = payload || {};
    if (!tab || !sku) throw new Error('tab and sku are required');

    const ss = _ss(CONFIG.PRODUCTS_DB_ID);
    const sh = _sh(ss, tab);
    const H = _headers(sh);
    const data = _rows(sh);

    const idxSKU = H.indexOf('SKU');
    if (idxSKU < 0) throw new Error('SKU column missing in sheet: ' + tab);

    // Find row by SKU
    let rowIndex = -1;
    for (let i = 0; i < data.length; i++) {
      if (String(data[i][idxSKU]).trim() === String(sku).trim()) { rowIndex = i + 2; break; }
    }
    if (rowIndex < 0) throw new Error('SKU not found: ' + sku);

    // Prepare updates (only allowed fields)
    const updates = {};
    if ('salesPrice' in payload) updates['SALES PRICE'] = _num(payload.salesPrice);
    if ('qty' in payload)        updates['QTY']         = _num(payload.qty);
    if ('market' in payload)     updates['MARKET']      = _num(payload.market);
    if ('retail' in payload)     updates['RETAIL']      = _num(payload.retail);
    if ('note' in payload)       updates['NOTE']        = String(payload.note || '');

    // Apply updates
    Object.keys(updates).forEach(col => {
      let c = H.indexOf(col);
      if (c < 0) c = H.indexOf(col.toUpperCase());
      if (c > -1) sh.getRange(rowIndex, c + 1).setValue(updates[col]);
    });

    // Audit
    try {
      const log = _sh(_ss(CONFIG.DISTI_BOARD_ID), CONFIG.SHEETS.AUDIT_LOG);
      const lr = Math.max(log.getLastRow() + 1, 2);
      log.getRange(lr, 1, 1, 7).setValues([[
        _nowISO(), u.email, 'updateProduct', tab, sku, JSON.stringify(updates), Session.getScriptTimeZone()
      ]]);
    } catch (e) { /* optional */ }

    return _ok({ tab, sku, updated: Object.keys(updates) });
  } catch (err) {
    return _fail(err.message);
  }
}

// ====== API: Favorite Toggle ======
function setFavorite(sku, favorite) {
  try {
    const email = _email();
    const ss = _ss(CONFIG.DISTI_BOARD_ID);
    const sh = _sh(ss, CONFIG.SHEETS.PREFS_FAV);
    const H = _headers(sh);
    const rows = _rows(sh);

    const idxEmail = H.indexOf('EMAIL');
    const idxSKU = H.indexOf('SKU');
    const idxFav = H.indexOf('FAVORITE');
    if (idxEmail < 0 || idxSKU < 0 || idxFav < 0) {
      throw new Error('PREFS_FAV must have columns: EMAIL, SKU, FAVORITE');
    }

    let found = -1;
    for (let i = 0; i < rows.length; i++) {
      if (String(rows[i][idxEmail]).toLowerCase() === email.toLowerCase() &&
          String(rows[i][idxSKU]).trim() === String(sku).trim()) {
        found = i + 2; break;
      }
    }

    if (found > 0) {
      sh.getRange(found, idxFav + 1).setValue(_bool(favorite));
    } else {
      const lr = Math.max(sh.getLastRow() + 1, 2);
      sh.getRange(lr, 1, 1, H.length).setValues([[ email, sku, _bool(favorite) ]]);
    }

    // Audit
    try {
      const log = _sh(_ss(CONFIG.DISTI_BOARD_ID), CONFIG.SHEETS.AUDIT_LOG);
      const lr = Math.max(log.getLastRow() + 1, 2);
      log.getRange(lr, 1, 1, 7).setValues([[
        _nowISO(), email, 'setFavorite', '', sku, JSON.stringify({ favorite: _bool(favorite) }), Session.getScriptTimeZone()
      ]]);
    } catch (e) { /* optional */ }

    return _ok({ sku, favorite: _bool(favorite) });
  } catch (err) {
    return _fail(err.message);
  }
}
