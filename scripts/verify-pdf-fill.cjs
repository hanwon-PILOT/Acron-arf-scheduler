/**
 * Regression check: Master.pdf fields fill after the same clear/fill logic as the web app.
 * Run: node scripts/verify-pdf-fill.cjs
 */
const fs = require("fs");
const path = require("path");
const { PDFDocument, PDFTextField, PDFCheckBox, PDFDropdown, PDFOptionList, PDFRadioGroup } = require("pdf-lib");

const root = path.join(__dirname, "..");
const pdfPath = process.env.PDF_VERIFY_PATH
  ? path.resolve(process.env.PDF_VERIFY_PATH)
  : path.join(root, "Master.pdf");

/** @returns {"legacy" | "2025" | "v2" | "v3"} */
function detectLayout(form) {
  try {
    form.getTextField("NAME_1_1_1");
  } catch {
    try {
      form.getTextField("NAME");
      return "2025";
    } catch {
      return "legacy";
    }
  }
  try {
    form.getDropdown("Equipment 2_1#1");
    return "v2";
  } catch {
    try {
      form.getDropdown("Equipment 1_1");
      return "v2";
    } catch {
      return "v3";
    }
  }
}

function dayNightFieldName(layout, idx) {
  if (layout === "2025") return `Dropdown${10 + idx}`;
  if (layout === "v3") return idx <= 8 ? `Dropdown${10 + idx}` : null;
  if (idx <= 8) return `Dropdown${10 + idx}`;
  return idx === 9 ? "Dropdown19_1_1" : "Dropdown20_1_1";
}

function cadetFieldName(layout, idx) {
  if (layout === "2025") return `Dropdown${idx}`;
  if (layout === "v3") return `Text${idx}`;
  if (layout === "v2") {
    if (idx === 1) return "Dropdown1_1_1";
    if (idx === 2) return "Dropdown2_1_1";
    if (idx === 10) return "Dropdown10_1_1";
    return null;
  }
  if (idx === 1) return "Dropdown1_1_1";
  if (idx === 2) return "Dropdown2_1_1";
  if (idx === 10) return "Dropdown10_1_1";
  return `Dropdown${idx}`;
}

function equipmentFieldNames(layout, idx) {
  if (layout === "2025") return [`Equipment ${idx}`];
  if (layout === "v2") {
    if (idx === 1) return ["Equipment 1_1", "Equipment 1_1#1"];
    if (idx <= 9) return [`Equipment ${idx}_1#1`];
    return [];
  }
  if (idx === 1) return ["Equipment 1_1", "Equipment 1_1#1"];
  if (idx <= 9) return [`Equipment ${idx}_1#1`];
  return [];
}

function rawOpt(o) {
  return Array.isArray(o) ? o[0] : o;
}
function normStr(x) {
  return String(rawOpt(x)).trim();
}
function compactKey(s) {
  return String(s).replace(/\s+/g, "").toUpperCase();
}
function matchOptionInOptions(vRaw, opts) {
  if (!vRaw) return null;
  const vUp = vRaw.toUpperCase();
  const vCompact = compactKey(vRaw);
  for (const o of opts) {
    const s = normStr(o);
    if (s === vRaw || s.toUpperCase() === vUp) return o;
    if (compactKey(s) === vCompact) return o;
  }
  return null;
}

const DAY_NIGHT_OPTIONLIST_BACKSTOP = [" ", "Day", "Night", "Both"];
const CADET_OPTIONLIST_BACKSTOP = [" ", "PTO", "GND", "RTP", "FAA", "STG", "ACT"];

function clearEntireForm(form) {
  for (const field of form.getFields()) {
    try {
      if (field instanceof PDFTextField) field.setText("");
      else if (field instanceof PDFCheckBox) field.uncheck();
      else if (field instanceof PDFDropdown) {
        const opts = field.getOptions();
        const space = opts.find((o) => normStr(o) === "" || rawOpt(o) === " ");
        if (space !== undefined) field.select(space);
        else if (opts.length) field.select(opts[0]);
      } else if (field instanceof PDFOptionList) field.clear();
      else if (field instanceof PDFRadioGroup) {
        try {
          field.clear();
        } catch {
          /* */
        }
      }
    } catch {
      /* */
    }
  }
}

function selectDropdownIf(form, name, value) {
  const vRaw = value == null ? "" : String(value).trim();
  if (!vRaw) return;
  try {
    const dd = form.getDropdown(name);
    const raw = dd.getOptions();
    const m = matchOptionInOptions(vRaw, raw);
    if (m !== null) {
      dd.select(m);
      return;
    }
    dd.addOptions([vRaw]);
    dd.select(vRaw);
  } catch {
    /* */
  }
}

function selectFormChoiceIf(form, name, value, optionListBackstop) {
  const vRaw = value == null ? "" : String(value).trim();
  if (!vRaw) return;
  let field;
  try {
    field = form.getField(name);
  } catch {
    return;
  }
  if (field.constructor.name === "PDFDropdown") {
    let raw = field.getOptions();
    if (!raw.length && optionListBackstop?.length) {
      field.addOptions(optionListBackstop);
      raw = field.getOptions();
    }
    const m = matchOptionInOptions(vRaw, raw);
    if (m !== null) {
      field.select(m);
      return;
    }
    field.addOptions([vRaw]);
    field.select(vRaw);
    return;
  }
  if (field.constructor.name === "PDFOptionList") {
    let raw = field.getOptions();
    if (!raw.length && optionListBackstop?.length) {
      field.addOptions(optionListBackstop);
      raw = field.getOptions();
    }
    const m = matchOptionInOptions(vRaw, raw);
    if (m !== null) {
      field.clear();
      field.select([m]);
      return;
    }
    field.addOptions([vRaw]);
    field.clear();
    field.select([vRaw]);
  }
}

(async () => {
  const bytes = fs.readFileSync(pdfPath);
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const form = doc.getForm();
  const layout = detectLayout(form);

  clearEntireForm(form);

  for (let idx = 1; idx <= 10; idx++) {
    const dnf = dayNightFieldName(layout, idx);
    if (dnf) {
      selectFormChoiceIf(form, dnf, idx % 2 === 0 ? "Night" : "Day", DAY_NIGHT_OPTIONLIST_BACKSTOP);
    }

    const cfn = cadetFieldName(layout, idx);
    if (cfn) {
      if (layout === "v3") {
        try {
          form.getTextField(cfn).setText("PTO");
        } catch {
          /* */
        }
      } else {
        selectFormChoiceIf(form, cfn, "PTO", CADET_OPTIONLIST_BACKSTOP);
      }
    }

    if (layout === "v2") {
      if (idx === 1) {
        selectDropdownIf(form, "Equipment 1_1", "AATD17");
        selectDropdownIf(form, "Equipment 1_1#1", "AATD17");
      } else if (idx <= 9) {
        selectDropdownIf(form, `Equipment ${idx}_1#1`, "AATD17");
      } else {
        try {
          form.getTextField(`TIME ${idx}_1_1_1`).setText("AATD17");
        } catch {
          /* */
        }
      }
    } else if (layout === "v3") {
      try {
        form.getTextField(`TIME ${idx}_1_1_1`).setText("AATD17");
      } catch {
        /* */
      }
    } else {
      for (const name of equipmentFieldNames(layout, idx)) {
        selectDropdownIf(form, name, "AATD17");
      }
    }
  }

  const out = await doc.save({ updateFieldAppearances: true });
  const doc2 = await PDFDocument.load(out);
  const f2 = doc2.getForm();

  const d1 = f2.getField("Dropdown11").getSelected();
  const d2 = f2.getField("Dropdown12").getSelected();
  if (!d1 || normStr(d1[0]) !== "Day") throw new Error(`Row1 Day/Night expected Day, got ${d1}`);
  if (!d2 || normStr(d2[0]) !== "Night") throw new Error(`Row2 Day/Night expected Night, got ${d2}`);

  if (layout === "2025") {
    const d9 = f2.getField("Dropdown19").getSelected();
    if (!d9 || normStr(d9[0]) !== "Day") throw new Error(`Row9 Day/Night expected Day, got ${d9}`);
    const c1 = f2.getField("Dropdown1").getSelected();
    if (!c1 || normStr(c1[0]) !== "PTO") throw new Error(`Row1 Cadet expected PTO, got ${c1}`);
    const e2 = f2.getDropdown("Equipment 2").getSelected();
    if (!e2 || normStr(e2[0]) !== "AATD17") throw new Error(`Row2 Equipment expected AATD17, got ${e2}`);
    const e10 = f2.getDropdown("Equipment 10").getSelected();
    if (!e10 || normStr(e10[0]) !== "AATD17") throw new Error(`Row10 Equipment expected AATD17, got ${e10}`);
    console.log("verify-pdf-fill: OK (ARF 2025 Master)");
  } else if (layout === "v3") {
    const t1 = f2.getTextField("Text1").getText();
    if (normStr(t1) !== "PTO") throw new Error(`Row1 Cadet (Text1) expected PTO, got ${JSON.stringify(t1)}`);
    const t2 = f2.getTextField("TIME 2_1_1_1").getText();
    if (t2 !== "AATD17") throw new Error(`Row2 TIME expected AATD17, got ${JSON.stringify(t2)}`);
    console.log("verify-pdf-fill: OK (v3 compact Master)");
  } else if (layout === "v2") {
    const d9 = f2.getField("Dropdown19_1_1").getSelected();
    if (!d9 || normStr(d9[0]) !== "Day") throw new Error(`Row9 Day/Night expected Day, got ${d9}`);
    const c1 = f2.getField("Dropdown1_1_1").getSelected();
    if (!c1 || normStr(c1[0]) !== "PTO") throw new Error(`Row1 Cadet expected PTO, got ${c1}`);
    const e2 = f2.getDropdown("Equipment 2_1#1").getSelected();
    if (!e2 || normStr(e2[0]) !== "AATD17") throw new Error(`Row2 Equipment expected AATD17, got ${e2}`);
    const t10 = f2.getTextField("TIME 10_1_1_1").getText();
    if (t10 !== "AATD17") throw new Error(`Row10 TIME expected AATD17, got ${JSON.stringify(t10)}`);
    console.log("verify-pdf-fill: OK (v2 Master layout)");
  } else {
    const d9 = f2.getField("Dropdown19_1_1").getSelected();
    if (!d9 || normStr(d9[0]) !== "Day") throw new Error(`Row9 Day/Night expected Day, got ${d9}`);
    const c1 = f2.getField("Dropdown1_1_1").getSelected();
    if (!c1 || normStr(c1[0]) !== "PTO") throw new Error(`Row1 Cadet expected PTO, got ${c1}`);
    const e2 = f2.getDropdown("Equipment 2_1#1").getSelected();
    if (!e2 || normStr(e2[0]) !== "AATD17") throw new Error(`Row2 Equipment expected AATD17, got ${e2}`);
    console.log("verify-pdf-fill: OK (legacy layout)");
  }
})().catch((e) => {
  console.error("verify-pdf-fill FAILED:", e.message);
  process.exit(1);
});
