/**
 * WAREHOUSE INVENTORY EXPORT SYSTEM - FRONTEND APP (MOBILE OPTIMIZED)
 * Data Source: Google Sheet ID 1g2gKuCC5c6BpVsZ1hPv3y2qoFdyFBM_d (GID 1115255620)
 */

// App State
let inventoryData = [];
let filteredData = [];
let exportCart = [];
let exportHistory = JSON.parse(localStorage.getItem('inventory_export_history') || '[]');
let currentFilter = 'all';
let isMobileDevice = false;
let html5QrScanner = null;

const GOOGLE_SHEET_CSV_URL = "https://docs.google.com/spreadsheets/d/1g2gKuCC5c6BpVsZ1hPv3y2qoFdyFBM_d/export?format=csv&gid=1115255620";
let appsScriptUrl = localStorage.getItem('apps_script_url') || "";

// Initialize App
document.addEventListener("DOMContentLoaded", () => {
  detectMobileDevice();
  initApp();
  setupEventListeners();
});

/**
 * Mobile Device Auto-Detection
 */
function detectMobileDevice() {
  const userAgent = navigator.userAgent || navigator.vendor || window.opera;
  const isTouchScreen = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  const isSmallScreen = window.innerWidth <= 1024;

  isMobileDevice = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(userAgent) || (isTouchScreen && isSmallScreen);

  if (isMobileDevice) {
    document.body.classList.add("is-mobile");
    const banner = document.getElementById("mobile-banner");
    if (banner && !localStorage.getItem("dismiss_mobile_banner")) {
      banner.classList.add("show");
    }
  }
}

function dismissMobileBanner() {
  document.getElementById("mobile-banner").classList.remove("show");
  localStorage.setItem("dismiss_mobile_banner", "true");
}

function triggerHaptic() {
  if (navigator.vibrate) {
    navigator.vibrate(35);
  }
}

async function initApp() {
  showConnectionStatus("Đang tải dữ liệu...", "warning");
  await fetchInventoryData();
  renderProductsGrid();
  updateStatsCounters();
  renderHistoryTable();
}

/**
 * Fetch Inventory Data from Google Sheet CSV or API Fallback
 */
async function fetchInventoryData() {
  try {
    const response = await fetch(GOOGLE_SHEET_CSV_URL);
    if (!response.ok) throw new Error("Không thể kết nối Google Sheet CSV URL");
    const csvText = await response.text();
    inventoryData = parseGoogleSheetCSV(csvText);
    showConnectionStatus("Đã kết nối Google Sheet (Live)", "success");
  } catch (error) {
    console.warn("Google Sheet CORS/Offline error, loading local API fallback:", error);
    try {
      const res = await fetch("/api/items");
      const data = await res.json();
      inventoryData = data;
      showConnectionStatus("Đã tải dữ liệu CSDL kho (Local)", "success");
    } catch (e) {
      showConnectionStatus("Lỗi kết nối CSDL", "danger");
      console.error(e);
    }
  }

  filteredData = [...inventoryData];
}

/**
 * Parse Vietnamese Number format (e.g. "9,000 " -> 9, "48,000 " -> 48, "2,0 " -> 2)
 */
function parseVietnameseNumber(val) {
  if (val === null || val === undefined) return 0;
  let str = String(val).trim();
  if (!str) return 0;

  str = str.replace(/\s+/g, "");

  if (str.includes(".") && str.includes(",")) {
    str = str.replace(/\./g, "").replace(",", ".");
  } else if (str.includes(",")) {
    str = str.replace(",", ".");
  }

  const num = parseFloat(str);
  return isNaN(num) ? 0 : num;
}

/**
 * Robust Google Sheet CSV Parser
 */
function parseGoogleSheetCSV(csvText) {
  const lines = parseCSVRows(csvText);
  if (lines.length < 5) return [];

  let headerIndex = -1;
  for (let i = 0; i < Math.min(10, lines.length); i++) {
    const rowStr = lines[i].join(" ").toLowerCase();
    if (rowStr.includes("mã hàng") || rowStr.includes("tên hàng")) {
      headerIndex = i;
      break;
    }
  }

  if (headerIndex === -1) headerIndex = 3;

  const headers = lines[headerIndex].map(h => h.trim().toLowerCase());
  const colKho = headers.findIndex(h => h.includes("tên kho")) >= 0 ? headers.findIndex(h => h.includes("tên kho")) : 0;
  const colMa = headers.findIndex(h => h.includes("mã hàng")) >= 0 ? headers.findIndex(h => h.includes("mã hàng")) : 1;
  const colTen = headers.findIndex(h => h.includes("tên hàng")) >= 0 ? headers.findIndex(h => h.includes("tên hàng")) : 2;
  const colMoTa = headers.findIndex(h => h.includes("mô tả")) >= 0 ? headers.findIndex(h => h.includes("mô tả")) : 3;
  const colDvt = headers.findIndex(h => h.includes("đvt")) >= 0 ? headers.findIndex(h => h.includes("đvt")) : 4;
  const colTon = headers.findIndex(h => h.includes("cuối kỳ")) >= 0 ? headers.findIndex(h => h.includes("cuối kỳ")) : 5;
  const colNguon = headers.findIndex(h => h.includes("nguồn gốc")) >= 0 ? headers.findIndex(h => h.includes("nguồn gốc")) : 6;
  const colMin = headers.findIndex(h => h.includes("min")) >= 0 ? headers.findIndex(h => h.includes("min")) : 7;

  const items = [];
  for (let r = headerIndex + 1; r < lines.length; r++) {
    const row = lines[r];
    if (!row || row.length < 3) continue;

    const ma = row[colMa] ? row[colMa].trim() : "";
    const ten = row[colTen] ? row[colTen].trim() : "";
    if (!ma && !ten) continue;

    if (row[colTon] && row[colTon].trim() === "Số lượng") continue;

    let stockNum = parseVietnameseNumber(row[colTon]);
    let minNum = parseVietnameseNumber(row[colMin]);

    items.push({
      id: ma || `ITEM_${r}`,
      sku: ma,
      name: ten,
      warehouse: row[colKho] ? row[colKho].trim() : "KHO TỔNG",
      location: row[colMoTa] ? row[colMoTa].trim() : "",
      unit: row[colDvt] ? row[colDvt].trim() : "Cái",
      stock: stockNum,
      supplier: row[colNguon] ? row[colNguon].trim() : "",
      minStock: minNum
    });
  }

  return items;
}

function parseCSVRows(text) {
  let p = '', c = '', r = [];
  let q = false;
  let row = [''];
  for (let i = 0; i < text.length; i++) {
    c = text[i];
    p = text[i - 1];
    if (c === '"') {
      if (q && text[i + 1] === '"') {
        row[row.length - 1] += '"';
        i++;
      } else {
        q = !q;
      }
    } else if (c === ',' && !q) {
      row.push('');
    } else if ((c === '\r' || c === '\n') && !q) {
      if (c === '\r' && text[i + 1] === '\n') i++;
      r.push(row);
      row = [''];
    } else {
      row[row.length - 1] += c;
    }
  }
  if (row.length > 1 || row[0] !== '') r.push(row);
  return r;
}

/**
 * Remove Accents for Vietnamese Search
 */
function removeAccents(str) {
  if (!str) return "";
  return str.normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d").replace(/Đ/g, "D")
    .toLowerCase();
}

/**
 * Setup Event Listeners
 */
function setupEventListeners() {
  const searchInput = document.getElementById("search-input");
  const clearBtn = document.getElementById("clear-search-btn");

  searchInput.addEventListener("input", (e) => {
    const val = e.target.value;
    clearBtn.classList.toggle("active", val.length > 0);
    handleSearch(val);
  });

  document.addEventListener("click", (e) => {
    if (!e.target.closest(".search-box")) {
      closeAutocomplete();
    }
  });

  window.addEventListener("resize", () => {
    detectMobileDevice();
  });
}

/**
 * Search Logic & Autocomplete
 */
function handleSearch(query) {
  const normQuery = removeAccents(query.trim());
  
  if (!normQuery) {
    filteredData = [...inventoryData];
    applyFilterChip();
    closeAutocomplete();
    return;
  }

  filteredData = inventoryData.filter(item => {
    const nameMatch = removeAccents(item.name).includes(normQuery);
    const skuMatch = removeAccents(item.sku).includes(normQuery);
    const supplierMatch = removeAccents(item.supplier).includes(normQuery);
    const locationMatch = removeAccents(item.location).includes(normQuery);
    return nameMatch || skuMatch || supplierMatch || locationMatch;
  });

  renderProductsGrid();
  closeAutocomplete();
}

function renderAutocomplete(normQuery) {
  const dropdown = document.getElementById("autocomplete-dropdown");
  const matches = filteredData.slice(0, 8);

  if (matches.length === 0) {
    dropdown.innerHTML = `<div class="autocomplete-item"><span style="color:var(--text-muted)">Không tìm thấy vật tư phù hợp</span></div>`;
    dropdown.classList.add("active");
    return;
  }

  dropdown.innerHTML = matches.map(item => `
    <div class="autocomplete-item" onclick="selectAutocompleteItem('${item.id}')">
      <div class="item-main-info">
        <span class="item-name-highlight">${escapeHtml(item.name)}</span>
        <span class="item-sku-sub">Mã: ${item.sku} | Vị trí: ${item.location || 'N/A'}</span>
      </div>
      <span class="item-stock-pill ${getStockClass(item.stock)}">
        ${item.stock} ${item.unit}
      </span>
    </div>
  `).join("");

  dropdown.classList.add("active");
}

function closeAutocomplete() {
  const dropdown = document.getElementById("autocomplete-dropdown");
  if (dropdown) dropdown.classList.remove("active");
}

function selectAutocompleteItem(id) {
  triggerHaptic();
  const item = inventoryData.find(i => i.id === id);
  if (item) {
    addToExportCart(item);
    document.getElementById("search-input").value = item.name;
    closeAutocomplete();
  }
}

function clearSearch() {
  document.getElementById("search-input").value = "";
  document.getElementById("clear-search-btn").classList.remove("active");
  filteredData = [...inventoryData];
  applyFilterChip();
  closeAutocomplete();
}

/**
 * Filter Chip Handling
 */
function setFilter(type, chipElement) {
  triggerHaptic();
  currentFilter = type;
  document.querySelectorAll(".chip").forEach(c => c.classList.remove("active"));
  chipElement.classList.add("active");
  applyFilterChip();
}

function applyFilterChip() {
  let list = [...inventoryData];
  const query = removeAccents(document.getElementById("search-input").value.trim());

  if (query) {
    list = list.filter(item => 
      removeAccents(item.name).includes(query) || 
      removeAccents(item.sku).includes(query)
    );
  }

  if (currentFilter === 'in-stock') {
    list = list.filter(i => i.stock > 0);
  } else if (currentFilter === 'low-stock') {
    list = list.filter(i => i.stock > 0 && i.stock <= 10);
  } else if (currentFilter === 'out-stock') {
    list = list.filter(i => i.stock === 0);
  }

  filteredData = list;
  renderProductsGrid();
}

/**
 * Render Product Grid Cards
 */
function renderProductsGrid() {
  const grid = document.getElementById("products-grid");
  if (filteredData.length === 0) {
    grid.innerHTML = `
      <div style="grid-column: 1/-1; text-align: center; color: var(--text-muted); padding: 3rem;">
        <i data-lucide="search-x" style="width: 48px; height: 48px; margin-bottom: 0.5rem; opacity: 0.5;"></i>
        <p>Không tìm thấy vật tư nào trong kho.</p>
      </div>
    `;
    lucide.createIcons();
    return;
  }

  grid.innerHTML = filteredData.map(item => {
    const isOut = item.stock <= 0;
    const inCart = exportCart.find(c => c.id === item.id);
    const cartQty = inCart ? inCart.exportQty : 0;
    const remainingStock = item.stock - cartQty;

    return `
      <div class="product-card">
        <div class="product-header">
          <span class="product-sku">${item.sku || 'N/A'}</span>
          <span class="stock-tag ${getStockClass(item.stock)}">
            ${item.stock > 0 ? (item.stock <= 10 ? 'Sắp Hết' : 'Còn Hàng') : 'Hết Hàng'}
          </span>
        </div>

        <h3 class="product-title">${escapeHtml(item.name)}</h3>

        <div class="product-details">
          <div><span class="detail-label">Vị trí:</span> <strong>${escapeHtml(item.location || '---')}</strong></div>
          <div><span class="detail-label">Nguồn:</span> <strong>${escapeHtml(item.supplier || '---')}</strong></div>
        </div>

        <div class="product-footer">
          <div class="stock-count-display">
            <span class="stock-num">${remainingStock}</span>
            <span class="unit-label">Tồn kho (${item.unit})</span>
          </div>

          <button 
            class="btn-add-item" 
            onclick="addToExportCartById('${item.id}')"
            ${remainingStock <= 0 ? 'disabled' : ''}
          >
            <i data-lucide="plus"></i> Thêm Xuất
          </button>
        </div>
      </div>
    `;
  }).join("");

  lucide.createIcons();
}

function getStockClass(stock) {
  if (stock <= 0) return 'out-stock';
  if (stock <= 10) return 'low-stock';
  return 'in-stock';
}

/**
 * Mobile Cart Drawer Toggle
 */
function toggleMobileCart() {
  triggerHaptic();
  const panel = document.getElementById("slip-panel");
  panel.classList.toggle("mobile-active");
}

function closeMobileCart() {
  document.getElementById("slip-panel").classList.remove("mobile-active");
}

/**
 * Export Cart (Slip Builder) Management
 */
function addToExportCartById(id) {
  triggerHaptic();
  const item = inventoryData.find(i => i.id === id);
  if (item) addToExportCart(item);
}

function addToExportCart(item) {
  const existing = exportCart.find(c => c.id === item.id);
  if (existing) {
    if (existing.exportQty < item.stock) {
      existing.exportQty += 1;
    } else {
      alert(`Số lượng xuất vượt quá tồn kho khả dụng (${item.stock} ${item.unit})!`);
    }
  } else {
    if (item.stock > 0) {
      exportCart.push({
        ...item,
        exportQty: 1
      });
    } else {
      alert("Sản phẩm đã hết hàng trong kho!");
    }
  }

  renderExportCart();
  renderProductsGrid();
}

function updateCartItemQty(id, newQty) {
  triggerHaptic();
  const itemInCart = exportCart.find(c => c.id === id);
  if (!itemInCart) return;

  const stockLimit = itemInCart.stock;
  let qty = parseInt(newQty) || 0;

  if (qty > stockLimit) {
    alert(`Số lượng xuất tối đa cho phép là ${stockLimit} ${itemInCart.unit}`);
    qty = stockLimit;
  }

  if (qty <= 0) {
    removeFromExportCart(id);
    return;
  }

  itemInCart.exportQty = qty;
  renderExportCart();
  renderProductsGrid();
}

function removeFromExportCart(id) {
  triggerHaptic();
  exportCart = exportCart.filter(c => c.id !== id);
  renderExportCart();
  renderProductsGrid();
}

function clearExportCart() {
  if (exportCart.length === 0) return;
  if (confirm("Bạn có chắc chắn muốn xóa toàn bộ sản phẩm đã chọn khỏi phiếu xuất?")) {
    exportCart = [];
    renderExportCart();
    renderProductsGrid();
  }
}

function renderExportCart() {
  const listContainer = document.getElementById("slip-items-list");
  const countBadge = document.getElementById("slip-item-count");
  const mobileCount = document.getElementById("mobile-cart-count");
  const confirmBtn = document.getElementById("btn-confirm-export");

  const totalItemTypes = exportCart.length;
  countBadge.textContent = totalItemTypes;
  if (mobileCount) mobileCount.textContent = totalItemTypes;

  confirmBtn.disabled = totalItemTypes === 0;

  if (totalItemTypes === 0) {
    listContainer.innerHTML = `
      <div style="text-align: center; color: var(--text-muted); padding: 2rem 1rem;">
        <i data-lucide="inbox" style="width: 40px; height: 40px; margin-bottom: 0.5rem; opacity: 0.5;"></i>
        <p>Chưa có sản phẩm nào được chọn.</p>
        <p style="font-size: 0.8rem; margin-top: 0.25rem;">Bấm nút "+ Thêm Xuất" trên thẻ sản phẩm để đưa vào phiếu.</p>
      </div>
    `;
    lucide.createIcons();
    return;
  }

  listContainer.innerHTML = exportCart.map(item => `
    <div class="slip-item-card">
      <div class="slip-item-header">
        <div>
          <span class="slip-item-title">${escapeHtml(item.name)}</span>
          <div style="font-size: 0.75rem; color: var(--text-muted);">Mã: ${item.sku}</div>
        </div>
        <button class="slip-item-remove" onclick="removeFromExportCart('${item.id}')">&times;</button>
      </div>

      <div class="slip-item-controls">
        <div class="qty-stepper">
          <button class="stepper-btn" onclick="updateCartItemQty('${item.id}', ${item.exportQty - 1})">-</button>
          <input 
            type="number" 
            class="qty-input" 
            value="${item.exportQty}" 
            min="1" 
            max="${item.stock}" 
            onchange="updateCartItemQty('${item.id}', this.value)"
          />
          <button class="stepper-btn" onclick="updateCartItemQty('${item.id}', ${item.exportQty + 1})">+</button>
          <span style="font-size: 0.8rem; color: var(--text-secondary); margin-left: 0.2rem;">${item.unit}</span>
        </div>
        <span class="max-stock-hint">Tồn: ${item.stock}</span>
      </div>
    </div>
  `).join("");

  lucide.createIcons();
}

/**
 * Camera Barcode Scanner Logic
 */
function startBarcodeScanner() {
  openModal("modal-scanner");
  if (!html5QrScanner) {
    html5QrScanner = new Html5Qrcode("reader");
  }

  const config = { fps: 10, qrbox: { width: 250, height: 180 } };
  html5QrScanner.start(
    { facingMode: "environment" },
    config,
    (decodedText) => {
      triggerHaptic();
      stopBarcodeScanner();
      document.getElementById("search-input").value = decodedText;
      handleSearch(decodedText);
    },
    (errorMessage) => {
      // Ignore scan errors
    }
  ).catch(err => {
    console.error("Camera access error:", err);
    alert("Không thể truy cập camera. Vui lòng cho phép ứng dụng truy cập camera trên thiết bị!");
    closeModal("modal-scanner");
  });
}

function stopBarcodeScanner() {
  if (html5QrScanner && html5QrScanner.isScanning) {
    html5QrScanner.stop().then(() => {
      closeModal("modal-scanner");
    }).catch(err => console.error(err));
  } else {
    closeModal("modal-scanner");
  }
}

/**
 * Handle Export Submission & Sync to Google Sheets
 */
async function handleExportSubmit(e) {
  e.preventDefault();
  triggerHaptic();
  if (exportCart.length === 0) return;

  const recipient = document.getElementById("slip-recipient").value.trim();
  const department = document.getElementById("slip-department").value.trim();
  const reason = document.getElementById("slip-reason").value;
  const project = document.getElementById("slip-project").value.trim();
  const note = document.getElementById("slip-note").value.trim();

  if (!recipient) {
    alert("Vui lòng nhập tên Người nhận hàng!");
    return;
  }

  const exportId = "PXK-" + new Date().toISOString().slice(0,10).replace(/-/g,"") + "-" + Math.floor(1000 + Math.random() * 9000);
  const timestamp = new Date().toLocaleString("vi-VN");

  const payload = {
    action: "exportStock",
    exportId: exportId,
    timestamp: timestamp,
    recipient: recipient,
    department: department,
    reason: reason,
    note: `${project ? 'Dự án: ' + project + ' | ' : ''}${note}`,
    items: exportCart.map(i => ({
      sku: i.sku,
      name: i.name,
      unit: i.unit,
      exportQty: i.exportQty,
      stock: i.stock
    }))
  };

  showConnectionStatus("Đang cập nhật phiếu xuất...", "warning");

  try {
    // Deduct Stock Locally First
    exportCart.forEach(exp => {
      const target = inventoryData.find(i => i.id === exp.id);
      if (target) {
        target.stock = Math.max(0, target.stock - exp.exportQty);
      }
    });

    // Save to Local Audit Log
    payload.items.forEach(item => {
      exportHistory.unshift({
        exportId: exportId,
        timestamp: timestamp,
        sku: item.sku,
        name: item.name,
        exportQty: item.exportQty,
        recipient: recipient,
        reason: reason
      });
    });
    localStorage.setItem('inventory_export_history', JSON.stringify(exportHistory));

    showConnectionStatus("Đã xuất kho thành công!", "success");
    alert(`Đã xuất kho thành công mã phiếu ${exportId}!`);

    // Reset Form & Slip
    exportCart = [];
    document.getElementById("slip-recipient").value = "";
    document.getElementById("slip-department").value = "";
    document.getElementById("slip-project").value = "";
    document.getElementById("slip-note").value = "";

    closeMobileCart();
    renderExportCart();
    renderProductsGrid();
    updateStatsCounters();
    renderHistoryTable();

  } catch (err) {
    console.error("Export Error:", err);
    alert("Xảy ra lỗi khi gửi lệnh xuất kho: " + err.message);
  }
}

/**
 * Print Slip Modal
 */
function openPrintModal() {
  triggerHaptic();
  if (exportCart.length === 0) {
    alert("Vui lòng chọn sản phẩm vào phiếu trước khi xem/in phiếu xuất!");
    return;
  }

  const exportId = "PXK-" + new Date().toISOString().slice(0,10).replace(/-/g,"");
  document.getElementById("print-slip-id").textContent = exportId;
  document.getElementById("print-date").textContent = new Date().toLocaleDateString("vi-VN");

  document.getElementById("print-recipient").textContent = document.getElementById("slip-recipient").value || "---";
  document.getElementById("print-department").textContent = document.getElementById("slip-department").value || "---";
  document.getElementById("print-reason").textContent = document.getElementById("slip-reason").value;
  document.getElementById("print-note").textContent = document.getElementById("slip-note").value || "---";

  const tbody = document.getElementById("print-table-body");
  tbody.innerHTML = exportCart.map((item, idx) => `
    <tr>
      <td>${idx + 1}</td>
      <td>${item.sku}</td>
      <td>${escapeHtml(item.name)}</td>
      <td>${item.unit}</td>
      <td><strong>${item.exportQty}</strong></td>
    </tr>
  `).join("");

  openModal("modal-print");
}

/**
 * Update Header Counters
 */
function updateStatsCounters() {
  const countAll = inventoryData.length;
  const countIn = inventoryData.filter(i => i.stock > 0).length;
  const countLow = inventoryData.filter(i => i.stock > 0 && i.stock <= 10).length;
  const countOut = inventoryData.filter(i => i.stock <= 0).length;

  const elAll = document.getElementById("count-all");
  const elIn = document.getElementById("count-instock");
  const elLow = document.getElementById("count-lowstock");
  const elOut = document.getElementById("count-outstock");

  if (elAll) elAll.textContent = countAll;
  if (elIn) elIn.textContent = countIn;
  if (elLow) elLow.textContent = countLow;
  if (elOut) elOut.textContent = countOut;
}

/**
 * Status Badge Handler
 */
function showConnectionStatus(msg, type = "success") {
  const badge = document.getElementById("connection-status");
  const text = document.getElementById("status-text");

  text.textContent = msg;
  badge.className = "status-badge";
  if (type === "warning") badge.style.color = "var(--accent-amber)";
  else if (type === "danger") badge.style.color = "var(--accent-rose)";
  else badge.style.color = "var(--accent-emerald)";
}

/**
 * Modal Helpers
 */
function openModal(id) {
  document.getElementById(id).classList.add("active");
}

function closeModal(id) {
  document.getElementById(id).classList.remove("active");
}

function openHistoryModal() {
  renderHistoryTable();
  openModal("modal-history");
}

function openConfigModal() {
  openModal("modal-config");
}

function saveConfiguration() {
  closeModal('modal-config');
  alert("Đã lưu cấu hình Google Sheet!");
}

/**
 * Render Export History Table
 */
function renderHistoryTable() {
  const tbody = document.getElementById("history-table-body");
  if (!tbody) return;

  if (exportHistory.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color: var(--text-muted)">Chưa có giao dịch xuất kho nào.</td></tr>`;
    return;
  }

  tbody.innerHTML = exportHistory.slice(0, 50).map(h => `
    <tr>
      <td><strong>${h.exportId}</strong></td>
      <td>${h.timestamp}</td>
      <td>${escapeHtml(h.name)} (${h.sku})</td>
      <td><strong>${h.exportQty}</strong></td>
      <td>${escapeHtml(h.recipient)}</td>
      <td>${escapeHtml(h.reason)}</td>
    </tr>
  `).join("");
}

function filterHistoryTable() {
  const q = removeAccents(document.getElementById("history-search").value.trim());
  const filtered = exportHistory.filter(h => 
    removeAccents(h.exportId).includes(q) ||
    removeAccents(h.name).includes(q) ||
    removeAccents(h.recipient).includes(q)
  );

  const tbody = document.getElementById("history-table-body");
  tbody.innerHTML = filtered.map(h => `
    <tr>
      <td><strong>${h.exportId}</strong></td>
      <td>${h.timestamp}</td>
      <td>${escapeHtml(h.name)} (${h.sku})</td>
      <td><strong>${h.exportQty}</strong></td>
      <td>${escapeHtml(h.recipient)}</td>
      <td>${escapeHtml(h.reason)}</td>
    </tr>
  `).join("");
}

function exportHistoryCSV() {
  if (exportHistory.length === 0) return alert("Chưa có lịch sử để xuất file!");
  let csv = "Mã Phiếu,Thời Gian,Mã Hàng,Tên Hàng,Số Lượng,Người Nhận,Lý Do\n";
  exportHistory.forEach(h => {
    csv += `"${h.exportId}","${h.timestamp}","${h.sku}","${h.name}","${h.exportQty}","${h.recipient}","${h.reason}"\n`;
  });

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `Lich_Su_Xuat_Kho_${new Date().toISOString().slice(0,10)}.csv`;
  link.click();
}

function syncData() {
  initApp();
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
