// WifeFlip migration guard: JSON backups from the legacy Mac must restore the
// original record IDs so existing cloud rows are updated instead of duplicated.
// CSV imports keep the legacy behavior and are handled by app.js.

import * as db from "./db.js";
import * as sync from "./sync.js";

function showToast(message) {
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent = message;
  el.hidden = false;
  setTimeout(() => { el.hidden = true; }, 2600);
}

document.addEventListener("change", async (event) => {
  const input = event.target;
  if (!(input instanceof HTMLInputElement) || input.id !== "importFile") return;
  const file = input.files && input.files[0];
  if (!file || !file.name.toLowerCase().endsWith(".json")) return;

  // Run before app.js's target-level onchange handler so the legacy importer
  // cannot clear IDs and create duplicate cloud rows.
  event.preventDefault();
  event.stopImmediatePropagation();

  try {
    const parsed = JSON.parse(await file.text());
    const items = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.items) ? parsed.items : []);
    const expenses = Array.isArray(parsed && parsed.expenses) ? parsed.expenses : [];
    if (!items.length && !expenses.length) throw new Error("No records found");

    for (const item of items) {
      if (!item || typeof item !== "object") continue;
      if (!item.status) item.status = "sourced";
      if (!Array.isArray(item.photos)) item.photos = [];
      // bulkPutItems keeps an existing id/updatedAt and only fills them when absent.
    }
    const restoredItems = await db.bulkPutItems(items);
    for (const item of items) {
      if (item && item.id) await sync.onLocalChange("upsert", item);
    }

    let restoredExpenses = 0;
    for (const expense of expenses) {
      if (!expense || typeof expense !== "object") continue;
      // saveExpense preserves an existing id while refreshing its edit timestamp.
      const saved = await db.saveExpense(expense);
      await sync.onLocalChange("upsert", saved);
      restoredExpenses++;
    }

    showToast(`Restored ${restoredItems} items${restoredExpenses ? ` + ${restoredExpenses} expenses` : ""}`);
    location.hash = "#/dashboard";
  } catch (error) {
    console.error("Backup restore failed", error);
    showToast("Could not restore that backup");
  } finally {
    input.value = "";
  }
}, true);
