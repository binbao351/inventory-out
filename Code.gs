/**
 * GOOGLE APPS SCRIPT - QUẢN LÝ XUẤT KHO VẬT TƯ
 * Google Sheet ID: 1HLWmcgSAMUEWc1n_SdLYH3etzRqPj8g_5ipO7Oqg5EI
 * GID: 424403728
 */

const SHEET_NAME_DATA = "Data"; // Hoặc tên Tab chứa dữ liệu tồn kho
const SHEET_NAME_LOGS = "LICH_SU_XUAT_KHO";

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
 * Phục vụ Giao diện Web App khi truy cập qua URL Web App của Google Apps Script
 */
function doGet(e) {
  if (e && e.parameter && e.parameter.action === "getItems") {
    return ContentService.createTextOutput(JSON.stringify(getItems()))
      .setMimeType(ContentService.MimeType.JSON);
  }
  
  const html = HtmlService.createTemplateFromFile("Index")
    .evaluate()
    .setTitle("Hệ Thống Xuất Kho - Inventory Export System")
    .addMetaTag("viewport", "width=device-width, initial-scale=1")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
    
  return html;
}

/**
 * Xử lý yêu cầu POST từ Web App (Ghi nhận Lịch sử Xuất kho & Trừ Tồn Kho)
 */
function doPost(e) {
  try {
    let data;
    if (e.postData && e.postData.contents) {
      data = JSON.parse(e.postData.contents);
    } else {
      data = e.parameter;
    }

    if (data.action === "exportStock" || data.items) {
      const result = processStockExport(data);
      return ContentService.createTextOutput(JSON.stringify({ status: "success", result: result }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    return ContentService.createTextOutput(JSON.stringify({ status: "error", message: "Yêu cầu không hợp lệ" }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ status: "error", message: error.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * Lấy danh sách vật tư tồn kho từ Google Sheet
 */
function getItems() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME_DATA) || ss.getSheets()[0];
  const data = sheet.getDataRange().getValues();

  let headerRowIndex = -1;
  // Tìm dòng tiêu đề (chứa "Mã hàng" hoặc "Tên hàng")
  for (let i = 0; i < Math.min(10, data.length); i++) {
    const rowStr = data[i].join(" ").toLowerCase();
    if (rowStr.includes("mã hàng") || rowStr.includes("tên hàng")) {
      headerRowIndex = i;
      break;
    }
  }

  if (headerRowIndex === -1) headerRowIndex = 3; // Mặc định dòng 4 (index 3)

  const headers = data[headerRowIndex];
  const colKho = headers.findIndex(h => String(h).trim().toLowerCase().includes("tên kho")) >= 0 ? headers.findIndex(h => String(h).trim().toLowerCase().includes("tên kho")) : 0;
  const colMa = headers.findIndex(h => String(h).trim().toLowerCase().includes("mã hàng")) >= 0 ? headers.findIndex(h => String(h).trim().toLowerCase().includes("mã hàng")) : 1;
  const colTen = headers.findIndex(h => String(h).trim().toLowerCase().includes("tên hàng")) >= 0 ? headers.findIndex(h => String(h).trim().toLowerCase().includes("tên hàng")) : 2;
  const colMoTa = headers.findIndex(h => String(h).trim().toLowerCase().includes("mô tả")) >= 0 ? headers.findIndex(h => String(h).trim().toLowerCase().includes("mô tả")) : 3;
  const colDvt = headers.findIndex(h => String(h).trim().toLowerCase().includes("đvt")) >= 0 ? headers.findIndex(h => String(h).trim().toLowerCase().includes("đvt")) : 4;
  const colTon = headers.findIndex(h => String(h).trim().toLowerCase().includes("cuối kỳ")) >= 0 ? headers.findIndex(h => String(h).trim().toLowerCase().includes("cuối kỳ")) : 5;
  const colNguon = headers.findIndex(h => String(h).trim().toLowerCase().includes("nguồn gốc")) >= 0 ? headers.findIndex(h => String(h).trim().toLowerCase().includes("nguồn gốc")) : 6;
  const colMin = headers.findIndex(h => String(h).trim().toLowerCase().includes("min")) >= 0 ? headers.findIndex(h => String(h).trim().toLowerCase().includes("min")) : 7;

  const items = [];
  for (let r = headerRowIndex + 1; r < data.length; r++) {
    const row = data[r];
    if (!row || row.length === 0) continue;
    
    // Bỏ qua các dòng trống hoặc dòng gộp
    if (row[colTon] === "Số lượng") continue;
    
    const ma = String(row[colMa] || "").trim();
    const ten = String(row[colTen] || "").trim();
    if (!ma && !ten) continue;

    let ton = parseVietnameseNumber(row[colTon]);
    let minQty = parseVietnameseNumber(row[colMin]);

    items.push({
      rowIndex: r + 1, // 1-indexed row number in Sheet
      sku: ma,
      name: ten,
      warehouse: String(row[colKho] || "KHO TỔNG").trim(),
      location: String(row[colMoTa] || "").trim(),
      unit: String(row[colDvt] || "Cái").trim(),
      stock: ton,
      supplier: String(row[colNguon] || "").trim(),
      minStock: minQty
    });
  }

  return items;
}

/**
 * Xử lý Ghi nhận xuất kho & Trừ số lượng trong Google Sheet
 */
function processStockExport(payload) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheetData = ss.getSheetByName(SHEET_NAME_DATA) || ss.getSheets()[0];
  
  // 1. Kiểm tra hoặc tạo Tab Lịch sử Xuất kho
  let sheetLogs = ss.getSheetByName(SHEET_NAME_LOGS);
  if (!sheetLogs) {
    sheetLogs = ss.insertSheet(SHEET_NAME_LOGS);
    sheetLogs.appendRow([
      "Mã Phiếu", "Thời Gian", "Mã Hàng", "Tên Hàng", "ĐVT", 
      "Số Lượng Xuất", "Tồn Cũ", "Tồn Mới", "Người Nhận", "Bộ Phận", "Lý Do Xuất", "Dự Án / Ghi Chú"
    ]);
    sheetLogs.getRange("A1:L1").setFontWeight("bold").setBackground("#e2e8f0");
  }

  const exportId = "PXK-" + Utilities.formatDate(new Date(), "GMT+7", "yyyyMMdd-HHmmss");
  const timestamp = Utilities.formatDate(new Date(), "GMT+7", "dd/MM/yyyy HH:mm:ss");

  const items = payload.items || [];
  const recipient = payload.recipient || "";
  const department = payload.department || "";
  const reason = payload.reason || "";
  const note = payload.note || "";

  const updatedItems = [];

  // Lấy lại dữ liệu tồn kho hiện tại
  const fullData = getItems();
  const itemMap = {};
  fullData.forEach(item => {
    itemMap[item.sku || item.name] = item;
  });

  items.forEach(expItem => {
    const key = expItem.sku || expItem.name;
    const currentObj = itemMap[key];
    
    let oldStock = currentObj ? currentObj.stock : expItem.stock;
    let exportQty = Number(expItem.exportQty) || 0;
    let newStock = Math.max(0, oldStock - exportQty);

    // Ghi vào Sheet Lịch sử
    sheetLogs.appendRow([
      exportId,
      timestamp,
      expItem.sku,
      expItem.name,
      expItem.unit,
      exportQty,
      oldStock,
      newStock,
      recipient,
      department,
      reason,
      note
    ]);

    // Trừ tồn kho trực tiếp trong tab Data nếu tìm thấy dòng
    if (currentObj && currentObj.rowIndex) {
      // Cột tồn kho Cuối kỳ (thường là cột F - cột 6)
      sheetData.getRange(currentObj.rowIndex, 6).setValue(newStock);
    }

    updatedItems.push({
      sku: expItem.sku,
      name: expItem.name,
      oldStock: oldStock,
      newStock: newStock,
      exportQty: exportQty
    });
  });

  return {
    exportId: exportId,
    timestamp: timestamp,
    updatedCount: updatedItems.length,
    items: updatedItems
  };
}
