/**
 * Acron ARF Master.pdf — clear all fields, then fill only user data.
 * Supports legacy AcroForm names (*_1_1) and newer templates (*_1_1_1, TIME vs Equipment).
 */
import {
  PDFDocument,
  PDFTextField,
  PDFCheckBox,
  PDFDropdown,
  PDFOptionList,
  PDFRadioGroup,
  StandardFonts,
} from "https://esm.sh/pdf-lib@1.17.1";

/** pdf-lib often reports empty getOptions() on list-box widgets; restore choices from the real PDF. */
const DAY_NIGHT_OPTIONLIST_BACKSTOP = [" ", "Day", "Night", "Both"];

const CADET_OPTIONLIST_BACKSTOP = [" ", "PTO", "GND", "RTP", "FAA", "STG", "ACT"];

/**
 * PDF Group Manager dropdown — match AcroForm export strings (spacing matters in some viewers).
 * UI can send "IAN OBRIEN" / store "CYLE RAZEE"; matchOptionInOptions still pairs with PDF values.
 */
const GROUP_MANAGER_OPTIONLIST_BACKSTOP = [
  " ",
  "ERIC DONAHUE",
  " IAN OBRIEN",
  "ERICA LAMPHIER",
  "CYLE RAZEE",
  "JOHN SLICK",
  "RICK NILSSON (UK)",
];

/** Master.pdf Equipment combos — used when getOptions() is empty (pdf-lib quirk). */
const EQUIPMENT_OPTIONLIST_BACKSTOP = [
  " ",
  "GW",
  "172 P",
  "172 SP",
  "AATD 15",
  "AATD17",
  "RBSIM1",
  "PA28",
  "AATD18",
  "R14193",
  "PA44",
  "AATDM-1",
];

const COURSE_OPTIONLIST_BACKSTOP = [
  " ",
  "PPC",
  "IRA",
  "CASEL",
  "CAMEL",
  "CAMEL Add-on",
  "CFI-A",
  "CFI-I",
  "MEI",
  "Check/Misc",
  " UK EASA",
  "Timebuilding",
  "TRN (New Hire)",
  "TRN (Line Pilot)",
];

/** @typedef {{
 *   id: string,
 *   headerName: string,
 *   headerDate: string,
 *   headerDay: string,
 *   headerNotes: string,
 *   headerGroup: string,
 *   aircraft: Record<string, string>,
 *   spin: string,
 *   qualQ: [string, string, string],
 *   qualAdd: [string, string, string],
 *   qualUkFi: string,
 *   qualUkIri: string,
 *   qualUkCri?: string,
 *   courseField: (row: number) => string,
 *   studentField: (row: number) => string,
 *   idField: (row: number) => string,
 *   lessonField: (row: number) => string,
 *   remarksField: (row: number) => string,
 *   typeField: (row: number) => string,
 *   blockField: (row: number) => string | null,
 *   timeField: (row: number) => string | null,
 *   equipmentFieldNames: (row: number) => string[],
 *   cadetDropdown: (row: number) => string, // may be "" when PDF has no widget for that row
 *   cadetAsText?: boolean, // true → write cadetDropdown() name as PDFTextField
 *   dayNightDropdown: (row: number) => string,
 *   lastLessonText: (row: number) => string,
 *   dayNightTextField?: (row: number) => string, // plain PDF text (clean masters: TIME column)
 *   cadetLastLessonTextField?: (row: number) => string, // last-lesson date text only (clean: Text6+n; cadet → ID/Status)
 * }} PdfFieldSpec */

/** @type {PdfFieldSpec} */
const SPEC_LEGACY = {
  id: "legacy",
  headerName: "NAME_1_1",
  headerDate: "DATE_1_1",
  headerDay: "Day_1_1",
  headerNotes: "NOTES TO SCHEDULING_1_1",
  headerGroup: "GROUP MANAGER_1_1",
  aircraft: {
    "PA-28": "Check Box3_1_1",
    "SR-20": "Check Box4_1_1",
    "C-172": "Check Box5_1_1",
    "C-172SP": "Check Box6_1_1",
    "PA-44": "Check Box7_1_1",
  },
  spin: "Check Box1_1_1",
  qualQ: ["Q 1_1_1", "Q 2_1_1", "Q 3_1_1"],
  qualAdd: ["A 1_1_1", "A 2_1_1", "A 3_1_1"],
  qualUkFi: "A 4_1_1",
  qualUkIri: "A 0_1_1",
  courseField(row) {
    if (row === 1) return "Course 1";
    if (row === 2) return "Course 2";
    if (row === 10) return "Course 10_1_1";
    return `Course ${row}_1_1`;
  },
  studentField(row) {
    return `STUDENT ${row}_1_1`;
  },
  idField(row) {
    return `ID ${row}_1_1`;
  },
  lessonField(row) {
    return `LESSON ${row}_1_1`;
  },
  remarksField(row) {
    return `REMARKSRow${row}_1_1`;
  },
  typeField(row) {
    return `Type ${row}_1_1`;
  },
  blockField(row) {
    if (row === 9) return "BLOCK 9";
    return `BLOCK ${row}_1_1`;
  },
  timeField() {
    return null;
  },
  equipmentFieldNames(row) {
    if (row === 1) return ["Equipment 1_1", "Equipment 1_1#1"];
    if (row >= 2 && row <= 9) return [`Equipment ${row}_1#1`];
    return [];
  },
  cadetDropdown(row) {
    const m = {
      1: "Dropdown1_1_1",
      2: "Dropdown2_1_1",
      10: "Dropdown10_1_1",
    };
    return m[row] || `Dropdown${row}`;
  },
  dayNightDropdown(row) {
    if (row <= 8) return `Dropdown${10 + row}`;
    if (row === 9) return "Dropdown19_1_1";
    return "Dropdown20_1_1";
  },
  lastLessonText(row) {
    return `Text${6 + row}_1_1`;
  },
};

/**
 * ARF 2025 MASTER: unsuffixed field names (NAME, DATE, STUDENT 1, Equipment 1, Dropdown1…20).
 * Rows 1–10 have cadet and Day/Night dropdowns; Equipment combos exist for all rows.
 */
/** @type {PdfFieldSpec} */
const SPEC_2025 = {
  id: "2025",
  headerName: "NAME",
  headerDate: "DATE",
  headerDay: "Day",
  headerNotes: "NOTES TO SCHEDULING",
  headerGroup: "GROUP MANAGER",
  aircraft: {
    "PA-28": "Check Box3",
    "SR-20": "Check Box4",
    "C-172": "Check Box5",
    "C-172SP": "Check Box6",
    "PA-44": "Check Box7",
  },
  spin: "Check Box1",
  qualQ: ["Q 1", "Q 2", "Q 3"],
  qualAdd: ["A 1", "A 2", "A 3"],
  /** ARF 2025 Master: FI is widget A 0, IRI is A 4 (was reversed; wrong mapping checked “IRI” when FI was on). */
  qualUkFi: "A 0",
  qualUkIri: "A 4",
  courseField(row) {
    return `Course ${row}`;
  },
  studentField(row) {
    return `STUDENT ${row}`;
  },
  idField(row) {
    return `ID ${row}`;
  },
  lessonField(row) {
    return `LESSON ${row}`;
  },
  remarksField(row) {
    return `REMARKSRow${row}`;
  },
  typeField(row) {
    return `Type ${row}`;
  },
  blockField(row) {
    if (row === 10) return null;
    return `BLOCK ${row}`;
  },
  timeField(row) {
    return `TIME ${row}`;
  },
  equipmentFieldNames(row) {
    return [`Equipment ${row}`];
  },
  cadetDropdown(row) {
    return `Dropdown${row}`;
  },
  dayNightDropdown(row) {
    return `Dropdown${10 + row}`;
  },
  lastLessonText(row) {
    return `Text${6 + row}`;
  },
};

/**
 * Clean Master (older export): fields use *_1; header NAME_1. Superseded by SPEC_CLEAN when Course 1_1_1 exists.
 */
/** @type {PdfFieldSpec} */
const SPEC_CLEAN_LEGACY = {
  id: "cleanLegacy",
  headerName: "NAME_1",
  headerDate: "DATE_1",
  headerDay: "Day_1",
  headerNotes: "NOTES TO SCHEDULING_1",
  headerGroup: "GROUP MANAGER_1",
  aircraft: {
    "PA-28": "Check Box2_1",
    "SR-20": "Check Box3_1",
    "C-172": "Check Box4_1",
    "C-172SP": "Check Box5_1",
    "PA-44": "Check Box5_2",
  },
  spin: "Q 1_4",
  qualQ: ["Q 1_1", "Q 1_2", "Q 1_3"],
  qualAdd: ["A 1_1", "A 2_1", "A 3_1"],
  qualUkFi: "A 4_1",
  qualUkIri: "A 5_1",
  courseField(row) {
    if (row === 1) return "Course 1_1";
    if (row === 2) return "Course 2_2";
    if (row === 10) return "Course 10_1";
    return `Course ${row}_1`;
  },
  studentField(row) {
    return `STUDENT ${row}_1`;
  },
  idField(row) {
    return `ID ${row}_1`;
  },
  lessonField(row) {
    return `LESSON ${row}_1`;
  },
  remarksField(row) {
    return `REMARKSRow${row}_1`;
  },
  typeField(row) {
    return `Type ${row}_1`;
  },
  blockField(row) {
    return `BLOCK ${row}_1`;
  },
  timeField(row) {
    return `TIME ${row}_1`;
  },
  equipmentFieldNames(row) {
    return [`Equipment ${row}_1`];
  },
  cadetDropdown() {
    return "";
  },
  dayNightDropdown() {
    return "";
  },
  lastLessonText(row) {
    return `Text${6 + row}_1`;
  },
  /** No Dropdown widgets — Day/Night/Both as text in TIME; last lesson date in Text(6+row); cadet → ID column. */
  dayNightTextField(row) {
    return `TIME ${row}_1`;
  },
  cadetLastLessonTextField(row) {
    return `Text${6 + row}_1`;
  },
};

/**
 * Clean Master (table rows re-exported): same logic as legacy clean but AcroForm names use *_1_1 (e.g. NAME_1_1, Course 1_1_1).
 * Distinguished from ARF legacy (NAME_1_1 + Course 1) by presence of Course 1_1_1. No cadet / day-night dropdowns (cadet → ID n, date → Text6+n).
 */
/** @type {PdfFieldSpec} */
const SPEC_CLEAN = {
  id: "clean",
  headerName: "NAME_1_1",
  headerDate: "DATE_1_1",
  headerDay: "Day_1_1",
  headerNotes: "NOTES TO SCHEDULING_1_1",
  headerGroup: "GROUP MANAGER_1_1",
  aircraft: {
    "PA-28": "Check Box2_1_1",
    "SR-20": "Check Box3_1_1",
    "C-172": "Check Box4_1_1",
    "C-172SP": "Check Box5_1_1",
    "PA-44": "Check Box5_2_1",
  },
  spin: "Q 1_4_1",
  qualQ: ["Q 1_1_1", "Q 1_2_1", "Q 1_3_1"],
  qualAdd: ["A 1_1_1", "A 2_1_1", "A 3_1_1"],
  qualUkFi: "A 4_1_1",
  qualUkIri: "A 5_1_1",
  courseField(row) {
    if (row === 1) return "Course 1_1_1";
    if (row === 2) return "Course 2_2_1";
    if (row === 10) return "Course 10_1_1";
    return `Course ${row}_1_1`;
  },
  studentField(row) {
    return `STUDENT ${row}_1_1`;
  },
  idField(row) {
    return `ID ${row}_1_1`;
  },
  lessonField(row) {
    return `LESSON ${row}_1_1`;
  },
  remarksField(row) {
    return `REMARKSRow${row}_1_1`;
  },
  typeField(row) {
    return `Type ${row}_1_1`;
  },
  blockField(row) {
    return `BLOCK ${row}_1_1`;
  },
  timeField(row) {
    return `TIME ${row}_1_1`;
  },
  equipmentFieldNames(row) {
    return [`Equipment ${row}_1_1`];
  },
  cadetDropdown() {
    return "";
  },
  dayNightDropdown() {
    return "";
  },
  lastLessonText(row) {
    return `Text${6 + row}_1_1`;
  },
  dayNightTextField(row) {
    return `TIME ${row}_1_1`;
  },
  cadetLastLessonTextField(row) {
    return `Text${6 + row}_1_1`;
  },
};

/**
 * “Clean Master For Optimizing”: clear IQ / A / B+C / D checkbox names; header NAME+Day+DATE unsuffixed;
 * row fields match other clean masters (STUDENT n_1_1, Course 1_1_1 & Course 2_2_1, etc.).
 */
/** @type {PdfFieldSpec} */
const SPEC_CLEAN_OPTIM = {
  id: "cleanOptim",
  headerName: "NAME",
  headerDate: "DATE",
  headerDay: "Day",
  headerNotes: "NOTES TO SCHEDULING_1_1",
  headerGroup: "GROUP MANAGER_1_1",
  /** Row 1: PA-28…PA-44 left→right (x order in PDF). */
  aircraft: {
    "PA-28": "A 1",
    "SR-20": "A 2",
    "C-172": "A 3",
    "C-172SP": "A 4",
    "PA-44": "A 5",
  },
  spin: "",
  qualQ: ["IQ 1", "IQ 2", "IQ 3"],
  qualAdd: ["B 1", "B 2", "C 3"],
  qualUkFi: "D 1",
  qualUkIri: "D 2",
  qualUkCri: "D 3",
  courseField(row) {
    if (row === 1) return "Course 1_1_1";
    if (row === 2) return "Course 2_2_1";
    if (row === 10) return "Course 10_1_1";
    return `Course ${row}_1_1`;
  },
  studentField(row) {
    return `STUDENT ${row}_1_1`;
  },
  idField(row) {
    return `ID ${row}_1_1`;
  },
  lessonField(row) {
    return `LESSON ${row}_1_1`;
  },
  remarksField(row) {
    return `REMARKSRow${row}_1_1`;
  },
  typeField(row) {
    return `Type ${row}_1_1`;
  },
  blockField(row) {
    return `BLOCK ${row}_1_1`;
  },
  timeField(row) {
    return `TIME ${row}_1_1`;
  },
  equipmentFieldNames(row) {
    return [`Equipment ${row}_1_1`];
  },
  cadetDropdown() {
    return "";
  },
  dayNightDropdown() {
    return "";
  },
  lastLessonText(row) {
    return `Text${6 + row}_1_1`;
  },
  dayNightTextField(row) {
    return `TIME ${row}_1_1`;
  },
  cadetLastLessonTextField(row) {
    return `Text${6 + row}_1_1`;
  },
};

/**
 * Newer Master: main data fields use *_1_1_1. Cadet / Day-Night keep Dropdown1_1_1 … Dropdown20_1_1
 * (not Dropdown1_1_1_1) after overlap fixes. Rows 1–9 use Equipment * combo + TIME * text; row 10 TIME only.
 */
/** @type {PdfFieldSpec} */
const SPEC_V2 = {
  id: "v2",
  headerName: "NAME_1_1_1",
  headerDate: "DATE_1_1_1",
  headerDay: "Day_1_1_1",
  headerNotes: "NOTES TO SCHEDULING_1_1_1",
  headerGroup: "GROUP MANAGER_1_1_1",
  aircraft: {
    "PA-28": "Check Box3_1_1_1",
    "SR-20": "Check Box4_1_1_1",
    "C-172": "Check Box5_1_1_1",
    "C-172SP": "Check Box6_1_1_1",
    "PA-44": "Check Box7_1_1_1",
  },
  spin: "Check Box1_1_1_1",
  qualQ: ["Q 1_1_1_1", "Q 2_1_1_1", "Q 3_1_1_1"],
  qualAdd: ["A 1_1_1_1", "A 2_1_1_1", "A 3_1_1_1"],
  qualUkFi: "A 4_1_1_1",
  qualUkIri: "A 0_1_1_1",
  courseField(row) {
    if (row === 1) return "Course 1";
    if (row === 2) return "Course 2";
    if (row === 10) return "Course 10_1_1_1";
    return `Course ${row}_1_1_1`;
  },
  studentField(row) {
    return `STUDENT ${row}_1_1_1`;
  },
  idField(row) {
    return `ID ${row}_1_1_1`;
  },
  lessonField(row) {
    return `LESSON ${row}_1_1_1`;
  },
  remarksField(row) {
    return `REMARKSRow${row}_1_1_1`;
  },
  typeField(row) {
    return `Type ${row}_1_1_1`;
  },
  blockField(row) {
    if (row === 10) return null;
    if (row === 9) return "BLOCK 9";
    if (row <= 8) return `BLOCK ${row}_1_1_1`;
    return null;
  },
  timeField(row) {
    return `TIME ${row}_1_1_1`;
  },
  equipmentFieldNames(row) {
    if (row === 1) return ["Equipment 1_1", "Equipment 1_1#1"];
    if (row >= 2 && row <= 9) return [`Equipment ${row}_1#1`];
    return [];
  },
  /** Rows 3–9 have no cadet widget (overlap cleanup in current Master). */
  cadetDropdown(row) {
    if (row === 1) return "Dropdown1_1_1";
    if (row === 2) return "Dropdown2_1_1";
    if (row === 10) return "Dropdown10_1_1";
    return "";
  },
  dayNightDropdown(row) {
    if (row <= 8) return `Dropdown${10 + row}`;
    if (row === 9) return "Dropdown19_1_1";
    return "Dropdown20_1_1";
  },
  lastLessonText(row) {
    return `Text${6 + row}_1_1_1`;
  },
};

/**
 * Compact Master: no row Equipment combos; cadet in Text1…Text10; Day/Night rows 1–8 only (Dropdown11–18);
 * BLOCK n_1_1_1_1; equipment → TIME text all rows.
 */
/** @type {PdfFieldSpec} */
const SPEC_V3 = {
  id: "v3",
  headerName: "NAME_1_1_1",
  headerDate: "DATE_1_1_1",
  headerDay: "Day_1_1_1",
  headerNotes: "NOTES TO SCHEDULING_1_1_1",
  headerGroup: "GROUP MANAGER_1_1_1",
  aircraft: {
    "PA-28": "Check Box3_1_1_1",
    "SR-20": "Check Box4_1_1_1",
    "C-172": "Check Box5_1_1_1",
    "C-172SP": "Check Box6_1_1_1",
    "PA-44": "Check Box7_1_1_1",
  },
  spin: "Check Box1_1_1_1",
  qualQ: ["Q 1_1_1_1", "Q 2_1_1_1", "Q 3_1_1_1"],
  qualAdd: ["A 1_1_1_1", "A 2_1_1_1", "A 3_1_1_1"],
  qualUkFi: "A 4_1_1_1",
  qualUkIri: "A 0_1_1_1",
  courseField(row) {
    if (row === 1) return "Course 1";
    if (row === 2) return "Course 2";
    if (row === 10) return "Course 10_1_1_1";
    return `Course ${row}_1_1_1`;
  },
  studentField(row) {
    return `STUDENT ${row}_1_1_1`;
  },
  idField(row) {
    return `ID ${row}_1_1_1`;
  },
  lessonField(row) {
    return `LESSON ${row}_1_1_1`;
  },
  remarksField(row) {
    return `REMARKSRow${row}_1_1_1`;
  },
  typeField(row) {
    return `Type ${row}_1_1_1`;
  },
  blockField(row) {
    if (row === 10) return null;
    if (row === 9) return "BLOCK 9";
    if (row <= 8) return `BLOCK ${row}_1_1_1_1`;
    return null;
  },
  timeField(row) {
    return `TIME ${row}_1_1_1`;
  },
  equipmentFieldNames() {
    return [];
  },
  cadetAsText: true,
  cadetDropdown(row) {
    return `Text${row}`;
  },
  dayNightDropdown(row) {
    if (row <= 8) return `Dropdown${10 + row}`;
    return "";
  },
  lastLessonText(row) {
    return `Text${6 + row}_1_1_1`;
  },
};

function hasRowEquipmentCombo(form) {
  try {
    form.getDropdown("Equipment 2_1#1");
    return true;
  } catch {
    try {
      form.getDropdown("Equipment 1_1");
      return true;
    } catch {
      return false;
    }
  }
}

/** Current clean master uses Course 1_1_1; ARF legacy uses Course 1 / Course n_1_1. */
function hasCleanMasterCourseField(form) {
  try {
    form.getDropdown("Course 1_1_1");
    return true;
  } catch {
    try {
      form.getOptionList("Course 1_1_1");
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * @param {import('pdf-lib').PDFForm} form
 * @returns {PdfFieldSpec}
 */
function detectFieldSpec(form) {
  try {
    form.getTextField("NAME_1_1_1");
    return hasRowEquipmentCombo(form) ? SPEC_V2 : SPEC_V3;
  } catch {
    if (hasCleanMasterCourseField(form)) {
      try {
        form.getTextField("NAME_1_1");
        return SPEC_CLEAN;
      } catch {
        try {
          form.getCheckBox("IQ 1");
          return SPEC_CLEAN_OPTIM;
        } catch {
          return SPEC_CLEAN;
        }
      }
    }
    try {
      form.getTextField("NAME_1");
      return SPEC_CLEAN_LEGACY;
    } catch {
      try {
        form.getTextField("NAME");
        return SPEC_2025;
      } catch {
        return SPEC_LEGACY;
      }
    }
  }
}

/** Master.pdf lists CASEL once; app distinguishes CASEL.1 / CASEL.2 in the UI only. CFI-A for airplane CFI. */
function normalizeCourseCodeForPdf(code) {
  const s = String(code || "").trim();
  if (s === "CASEL1" || s === "CASEL2") return "CASEL";
  if (s === "CFI") return "CFI-A";
  return s;
}

function rawOpt(o) {
  if (Array.isArray(o)) return o[0];
  return o;
}

function normStr(x) {
  return String(rawOpt(x)).trim();
}

function compactKey(s) {
  return String(s).replace(/\s+/g, "").toUpperCase();
}

/** @param {string} vRaw trimmed user value
 * @returns {unknown | null} raw option entry from PDF list */
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

/** PDF may use "CYLE RAZEE" while the roster lists "V CYLE RAZEE". */
function matchGroupManagerInOptions(vRaw, opts) {
  const m = matchOptionInOptions(vRaw, opts);
  if (m !== null) return m;
  const t = String(vRaw || "").trim();
  const noLeadV = t.replace(/^\s*V\s+/i, "").trim();
  if (noLeadV && noLeadV !== t) return matchOptionInOptions(noLeadV, opts);
  return null;
}

/** Lesson metadata uses "Ground"; PDF uses "GW". */
function matchEquipmentInOptions(vRaw, opts) {
  const v = String(vRaw ?? "").trim();
  if (!v) return null;
  const m0 = matchOptionInOptions(v, opts);
  if (m0 !== null) return m0;
  const ul = v.replace(/\s+/g, " ").trim().toUpperCase();
  if (ul === "GROUND" || ul === "GND" || ul === "GRND") {
    const m = matchOptionInOptions("GW", opts);
    if (m !== null) return m;
  }
  return null;
}

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
          /* ignore */
        }
      }
    } catch {
      /* signatures etc. */
    }
  }
}

function setTextIf(form, name, text) {
  const s = text == null ? "" : String(text).trim();
  if (!s) return;
  if (!name) return;
  try {
    form.getTextField(name).setText(s);
  } catch {
    /* ignore */
  }
}

/** Set PDF text field even to "" (clear). Returns true if the field existed. */
function setTextFieldRaw(form, name, text) {
  if (!name) return false;
  try {
    form.getTextField(name).setText(text == null ? "" : String(text));
    return true;
  } catch {
    return false;
  }
}

/**
 * Select combo/dropdown (PDFDropdown). List-box style fields must use selectFormChoiceIf.
 */
function selectDropdownIf(form, name, value) {
  const vRaw = value == null ? "" : String(value).trim();
  if (!vRaw || !name) return;
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
    /* ignore */
  }
}

/**
 * Handles PDFDropdown and PDFOptionList (pdf-lib often lists Day/Night & cadet as option lists with no options until addOptions).
 * @param {(v: string, opts: unknown[]) => unknown | null} [matchImpl]
 */
function selectFormChoiceIf(form, name, value, optionListBackstop, matchImpl = matchOptionInOptions) {
  const vRaw = value == null ? "" : String(value).trim();
  if (!vRaw || !name) return;
  let field;
  try {
    field = form.getField(name);
  } catch {
    return;
  }

  if (field instanceof PDFDropdown) {
    let raw = field.getOptions();
    if (!raw.length && optionListBackstop?.length) {
      field.addOptions(optionListBackstop);
      raw = field.getOptions();
    }
    const m = matchImpl(vRaw, raw);
    if (m !== null) {
      field.select(m);
      return;
    }
    field.addOptions([vRaw]);
    field.select(vRaw);
    return;
  }

  if (field instanceof PDFOptionList) {
    let raw = field.getOptions();
    if (!raw.length && optionListBackstop?.length) {
      field.addOptions(optionListBackstop);
      raw = field.getOptions();
    }
    const m = matchImpl(vRaw, raw);
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

/** Force blank selection (fixes stale / wrong appearance on some viewers). */
function selectDropdownEmpty(form, name) {
  if (!name) return;
  try {
    const dd = form.getDropdown(name);
    const raw = dd.getOptions();
    const space = raw.find((o) => normStr(o) === "" || rawOpt(o) === " ");
    if (space !== undefined) {
      dd.select(space);
      return;
    }
    if (raw.length) dd.select(raw[0]);
  } catch {
    /* ignore */
  }
}

/** Clear dropdown or list-box to blank/first option (Equipment, etc.). */
function clearFormChoiceIf(form, name) {
  if (!name) return;
  let field;
  try {
    field = form.getField(name);
  } catch {
    return;
  }
  try {
    if (field instanceof PDFDropdown) {
      const raw = field.getOptions();
      const space = raw.find((o) => normStr(o) === "" || rawOpt(o) === " ");
      if (space !== undefined) {
        field.select(space);
        return;
      }
      if (raw.length) field.select(raw[0]);
      return;
    }
    if (field instanceof PDFOptionList) {
      let raw = field.getOptions();
      if (!raw.length && EQUIPMENT_OPTIONLIST_BACKSTOP.length) {
        field.addOptions(EQUIPMENT_OPTIONLIST_BACKSTOP);
        raw = field.getOptions();
      }
      const space = raw.find((o) => normStr(o) === "" || rawOpt(o) === " ");
      if (space !== undefined) {
        field.clear();
        field.select([space]);
        return;
      }
      if (raw.length) {
        field.clear();
        field.select([raw[0]]);
      }
    }
  } catch {
    /* ignore */
  }
}

function setCourseIf(form, name, code) {
  const c = code == null ? "" : String(code).trim();
  if (!c || !name) return;
  try {
    const ol = form.getOptionList(name);
    let opts = ol.getOptions();
    if (!opts.length) {
      ol.addOptions(COURSE_OPTIONLIST_BACKSTOP);
      opts = ol.getOptions();
    }
    const m = matchOptionInOptions(c, opts);
    if (m !== null) {
      ol.clear();
      ol.select([m]);
      return;
    }
    ol.addOptions([c]);
    ol.clear();
    ol.select([c]);
    return;
  } catch {
    /* fall through */
  }
  /* Dropdown or list-box via getField (covers widgets getOptionList/getDropdown miss). */
  selectFormChoiceIf(form, name, c, COURSE_OPTIONLIST_BACKSTOP);
}

function setEquipmentRow(form, names, equipment) {
  const label = equipment == null ? "" : String(equipment).trim();
  for (const n of names) {
    if (label) {
      selectFormChoiceIf(form, n, label, EQUIPMENT_OPTIONLIST_BACKSTOP, matchEquipmentInOptions);
    } else {
      clearFormChoiceIf(form, n);
    }
  }
}

/** Names to try when the equipment column is plain text (Acrobat conversion from combo). */
function equipmentTextFieldCandidates(spec, row) {
  if (spec.id === "v2") {
    const base = `Equipment ${row}_1_1_1`;
    if (row === 1) return [base, `${base}#1`];
    return [base];
  }
  if (spec.id === "2025" || spec.id === "clean" || spec.id === "cleanOptim" || spec.id === "cleanLegacy" || spec.id === "v3")
    return [];
  if (row === 1) return ["Equipment 1_1", "Equipment 1_1#1"];
  if (row >= 2 && row <= 9) return [`Equipment ${row}_1#1`];
  return [];
}

/**
 * Equipment: fill combo/list fields first (Master.pdf), then optional text aliases, then TIME fallback.
 */
function fillEquipmentColumn(form, spec, row, block, equip) {
  const eq = equip == null ? "" : String(equip).trim();
  const blk = block == null ? "" : String(block).trim();
  const ddNames = spec.equipmentFieldNames(row);
  const row10Bundle = spec.id === "v2" && row === 10 ? [blk, eq].filter(Boolean).join(" · ") : eq;

  setEquipmentRow(form, ddNames, eq);

  const textForOptionalFields = row10Bundle || eq;
  for (const n of equipmentTextFieldCandidates(spec, row)) {
    try {
      form.getTextField(n);
      setTextFieldRaw(form, n, textForOptionalFields);
    } catch {
      /* not a text field */
    }
  }

  const tf = spec.timeField(row);
  if (!tf) return;
  if (spec.id === "v2" && row === 10) {
    if (row10Bundle) setTextIf(form, tf, row10Bundle);
    else setTextFieldRaw(form, tf, "");
    return;
  }
  if (!ddNames.length && eq) {
    setTextIf(form, tf, eq);
  } else if (!ddNames.length) {
    setTextFieldRaw(form, tf, "");
  }
}

function setAircraftFromData(form, aircraft, spec) {
  const useFallbacks = spec.id === "clean" || spec.id === "cleanLegacy";
  for (const [key, pdfName] of Object.entries(spec.aircraft)) {
    const extra = useFallbacks ? AIRCRAFT_CHECK_FALLBACKS[key] : [];
    const candidates = [pdfName, ...(extra || [])].filter(Boolean);
    const dedup = [...new Set(candidates)];
    const on = !!(aircraft && aircraft[key]);
    if (useFallbacks) setCheckboxFirstExisting(form, dedup, on);
    else setCheckboxIf(form, pdfName, on);
  }
}

function setCheckboxIf(form, name, on) {
  if (!name) return;
  try {
    const cb = form.getCheckBox(name);
    if (on) cb.check();
    else cb.uncheck();
  } catch {
    /* ignore */
  }
}

function formHasCheckbox(form, name) {
  if (!name) return false;
  try {
    form.getCheckBox(name);
    return true;
  } catch {
    return false;
  }
}

/**
 * Some Master.pdf re-exports rename widgets (e.g. MEI → Q 3_1_1, aircraft → legacy-style Check Box3…7).
 * Pick the first name that exists, set it; uncheck other candidates so stale widgets don’t stay on.
 */
function setCheckboxFirstExisting(form, candidates, on) {
  if (!candidates?.length) return;
  let chosen = null;
  for (const n of candidates) {
    if (formHasCheckbox(form, n)) {
      chosen = n;
      break;
    }
  }
  if (!chosen) return;
  for (const n of candidates) {
    if (!formHasCheckbox(form, n)) continue;
    setCheckboxIf(form, n, !!(on && n === chosen));
  }
}

/** Extra AcroForm names to try for clean / cleanLegacy aircraft row (primary names in spec.aircraft). */
const AIRCRAFT_CHECK_FALLBACKS = {
  "PA-28": ["Check Box3_1_1", "Check Box3_1_1_1"],
  "SR-20": ["Check Box4_1_1", "Check Box4_1_1_1"],
  "C-172": ["Check Box5_1_1", "Check Box5_1_1_1"],
  "C-172SP": ["Check Box6_1_1", "Check Box6_1_1_1"],
  "PA-44": ["Check Box7_1_1", "Check Box7_1_1_1", "Check Box5_2_1", "Check Box5_2_1_1"],
};

/** Only known qualification keys; strips stray JSON so PDF matches intended checkboxes. */
function normalizeQualificationsInPdf(q) {
  const instructor = { CFI: false, CFII: false, MEI: false, SPIN: false };
  const additionalCourse = { cfiA141: false, cfiI141: false, mei141: false };
  const ukEasa = { FI: false, IRI: false, CRI: false };
  const src = q && typeof q === "object" ? q : {};
  const si = src.instructor || {};
  const sa = src.additionalCourse || {};
  const su = src.ukEasa || {};
  for (const k of Object.keys(instructor)) instructor[k] = !!si[k];
  for (const k of Object.keys(additionalCourse)) additionalCourse[k] = !!sa[k];
  for (const k of Object.keys(ukEasa)) ukEasa[k] = !!su[k];
  return { instructor, additionalCourse, ukEasa };
}

function buildNotesWithQualifiers(data) {
  const base = (data.notesScheduling || "").trim();
  const tags = [];
  const q = normalizeQualificationsInPdf(data.qualifications);
  if (q.ukEasa.CRI) tags.push("UK/EASA: CRI");
  if (!tags.length) return base;
  const prefix = tags.join(" | ");
  return base ? `${prefix}\n${base}` : prefix;
}

/**
 * @param {import('pdf-lib').PDFForm} form
 * @param {object} data
 * @param {PdfFieldSpec} spec
 */
/** First AcroForm checkbox name in list that exists (pdf-lib). */
function firstExistingCheckboxName(form, names) {
  for (const n of names) {
    if (formHasCheckbox(form, n)) return n;
  }
  return null;
}

/** Clean masters: wipe every “A n_*” widget we might use for Additional + UK, then set only from data (fixes wrong FI / CFI-A when names overlap between exports). */
function uncheckCleanAdditionalUkPool(form, legacy) {
  const pool = legacy
    ? ["A 0_1", "A 1_1", "A 1_1_1", "A 2_1", "A 2_1_1", "A 3_1", "A 3_1_1", "A 4_1", "A 5_1", "A 6_1"]
    : ["A 0_1_1", "A 1_1_1", "A 1_1", "A 2_1_1", "A 2_1", "A 3_1_1", "A 3_1", "A 4_1_1", "A 5_1_1", "A 6_1_1"];
  for (const n of pool) setCheckboxIf(form, n, false);
}

function applyCleanAdditionalAndUk(form, q, legacy) {
  const add = q.additionalCourse;
  const uk = q.ukEasa;
  uncheckCleanAdditionalUkPool(form, legacy);

  const cfiA = firstExistingCheckboxName(form, legacy ? ["A 1_1", "A 1_1_1"] : ["A 1_1_1", "A 1_1"]);
  const cfiI = firstExistingCheckboxName(form, legacy ? ["A 2_1", "A 2_1_1"] : ["A 2_1_1", "A 2_1"]);
  const meiA = firstExistingCheckboxName(form, legacy ? ["A 3_1", "A 3_1_1"] : ["A 3_1_1", "A 3_1"]);
  if (cfiA) setCheckboxIf(form, cfiA, add.cfiA141);
  if (cfiI) setCheckboxIf(form, cfiI, add.cfiI141);
  if (meiA) setCheckboxIf(form, meiA, add.mei141);

  const a4 = legacy ? "A 4_1" : "A 4_1_1";
  const a5 = legacy ? "A 5_1" : "A 5_1_1";
  const a0 = legacy ? "A 0_1" : "A 0_1_1";
  const has45 = formHasCheckbox(form, a4) && formHasCheckbox(form, a5);
  const has04 = formHasCheckbox(form, a0) && formHasCheckbox(form, a4);

  if (has45) {
    /* Typical clean row: FI = A4, IRI = A5; leave A0 off if it exists as a spare widget */
    setCheckboxIf(form, a4, uk.FI);
    setCheckboxIf(form, a5, uk.IRI);
    if (formHasCheckbox(form, a0)) setCheckboxIf(form, a0, false);
  } else if (has04) {
    /* ARF 2025–style pairing on some exports: FI → A 0, IRI → A 4 */
    setCheckboxIf(form, a0, uk.FI);
    setCheckboxIf(form, a4, uk.IRI);
  } else {
    setCheckboxIf(form, a4, uk.FI);
    setCheckboxIf(form, a5, uk.IRI);
  }
}

function applyQualifications(form, data, spec) {
  const q = normalizeQualificationsInPdf(data.qualifications);
  const ins = q.instructor;

  if (spec.id === "cleanOptim") {
    setCheckboxIf(form, "IQ 1", ins.CFI);
    setCheckboxIf(form, "IQ 2", ins.CFII);
    setCheckboxIf(form, "IQ 3", ins.MEI);
    setCheckboxIf(form, "IQ 4", ins.SPIN);
    const add = q.additionalCourse;
    setCheckboxIf(form, "B 1", add.cfiA141);
    setCheckboxIf(form, "B 2", add.cfiI141);
    setCheckboxIf(form, "C 3", add.mei141);
    const uk = q.ukEasa;
    setCheckboxIf(form, "D 1", uk.FI);
    setCheckboxIf(form, "D 2", uk.IRI);
    setCheckboxIf(form, "D 3", uk.CRI);
    return;
  }

  setCheckboxIf(form, spec.qualQ[0], ins.CFI);
  setCheckboxIf(form, spec.qualQ[1], ins.CFII);

  if (spec.id === "clean") {
    setCheckboxFirstExisting(form, ["Q 1_3_1", "Q 3_1_1", "Q 3_1_1_1"], ins.MEI);
    setCheckboxFirstExisting(
      form,
      ["Q 1_4_1", "Q 4_1_1", "Q 4_1_1_1", "Check Box1_1_1", "Check Box1_1_1_1"],
      ins.SPIN
    );
    applyCleanAdditionalAndUk(form, q, false);
  } else if (spec.id === "cleanLegacy") {
    setCheckboxFirstExisting(form, ["Q 1_3", "Q 3_1", "Q 3_1_1"], ins.MEI);
    setCheckboxFirstExisting(form, ["Q 1_4", "Q 4_1", "Q 4_1_1", "Check Box1_1"], ins.SPIN);
    applyCleanAdditionalAndUk(form, q, true);
  } else {
    setCheckboxIf(form, spec.qualQ[2], ins.MEI);
    setCheckboxIf(form, spec.spin, ins.SPIN);
    const add = q.additionalCourse;
    setCheckboxIf(form, spec.qualAdd[0], add.cfiA141);
    setCheckboxIf(form, spec.qualAdd[1], add.cfiI141);
    setCheckboxIf(form, spec.qualAdd[2], add.mei141);
    const uk = q.ukEasa;
    setCheckboxIf(form, spec.qualUkFi, uk.FI);
    setCheckboxIf(form, spec.qualUkIri, uk.IRI);
    if (spec.qualUkCri) setCheckboxIf(form, spec.qualUkCri, uk.CRI);
  }
}

export function formatDateUs(value) {
  const s = String(value || "").trim();
  const parts = s.split("-");
  if (parts.length === 3 && parts[0].length === 4 && /^\d+$/.test(parts[0])) {
    const y = parts[0];
    const m = String(Number(parts[1])).padStart(2, "0");
    const d = String(Number(parts[2])).padStart(2, "0");
    return `${m}/${d}/${y}`;
  }
  return s;
}

/** Last lesson: month/day only, e.g. 5/15 */
export function formatMonthDay(iso) {
  const parts = String(iso || "").trim().split("-");
  if (parts.length !== 3) return "";
  const m = Number(parts[1]);
  const d = Number(parts[2]);
  if (!m || !d) return "";
  return `${m}/${d}`;
}

/**
 * PDF LESSON field: AATD/FTD-style lessons → {n}TD (e.g. 15TD). UPRT → {n}DL. Otherwise hyphens removed.
 */
export function lessonTextForPdfField(code) {
  const raw = String(code ?? "").trim();
  if (!raw) return "";

  const numMatch = raw.match(/^(\d+[a-z]?)\s*[-–]/i);
  const num = numMatch ? numMatch[1] : "";

  if (/UPRT/i.test(raw)) {
    return num ? `${num}DL` : "DL";
  }

  const isAatd =
    /-TD\s*$/i.test(raw) ||
    /AA\s*TD|AATD|TD\s*\/\s*FTD|\bDFT\b/i.test(raw);

  if (isAatd && num) {
    return `${num}TD`;
  }

  return raw.replace(/-/g, "");
}

/**
 * PDF Type dropdown from lesson code. Unknown patterns → "" (user picks manually).
 * GB = Ground, DL/DXC/UPRT/DSL/DLN = D, AATD·FTD·TD·DFT = DSIM, SLN = Solo, SXC = SoloXC.
 */
export function typeFromLessonCode(code) {
  const raw = String(code ?? "").trim();
  if (!raw) return "";

  if (/\bUPRT\b/i.test(raw)) return "D";

  if (/-GB\b/i.test(raw)) return "Ground";

  const isSim =
    /-TD\s*$/i.test(raw) ||
    /AA\s*TD|AATD|TD\s*\/\s*FTD|\bDFT\b/i.test(raw);
  if (isSim) return "DSIM";

  if (/-DXCN\b/i.test(raw) || /-DXC\b/i.test(raw)) return "D";
  if (/-DSL\b/i.test(raw)) return "D";
  if (/-DLN\b/i.test(raw)) return "D";
  if (/-DL\b/i.test(raw)) return "D";

  if (/-SLN\b/i.test(raw)) return "Solo";
  if (/-SXC\b/i.test(raw)) return "SoloXC";

  return "";
}

/**
 * @param {Uint8Array} templateBytes
 * @param {object} data exportPayload
 */
export async function fillArfTemplate(templateBytes, data) {
  const pdfDoc = await PDFDocument.load(templateBytes, { ignoreEncryption: true });
  const form = pdfDoc.getForm();
  clearEntireForm(form);

  const spec = detectFieldSpec(form);

  setTextIf(form, spec.headerName, data.instructorName);

  const dayVal = (data.requestDay || "").trim().toUpperCase();
  if (dayVal) selectDropdownIf(form, spec.headerDay, dayVal);

  if (data.requestDate) setTextIf(form, spec.headerDate, formatDateUs(data.requestDate));

  setAircraftFromData(form, data.aircraft || {}, spec);

  applyQualifications(form, data, spec);

  const notesCombined = buildNotesWithQualifiers(data);
  setTextIf(form, spec.headerNotes, notesCombined);

  const gm = String(data.groupManager || "").trim();
  if (gm) {
    selectFormChoiceIf(form, spec.headerGroup, gm, GROUP_MANAGER_OPTIONLIST_BACKSTOP, matchGroupManagerInOptions);
  }

  const rows = data.rows || [];
  for (let idx = 1; idx <= 10; idx++) {
    const row = rows[idx - 1] || {};
    const courseCode = normalizeCourseCodeForPdf(row.courseShortCode || row.courseCode || "");

    setTextIf(form, spec.studentField(idx), row.student);
    /** Clean masters: PDF “Status” column is the ID n field; cadet status belongs there (not in Date of Last Lesson). */
    const statusOnIdField = spec.id === "clean" || spec.id === "cleanOptim" || spec.id === "cleanLegacy";
    const idCell = statusOnIdField
      ? String(row.cadetStatus || row.studentId || "").trim()
      : String(row.studentId || "").trim();
    if (idCell) setTextIf(form, spec.idField(idx), idCell);

    const cname = spec.courseField(idx);
    if (courseCode) {
      /* Rows 1–2 are often PDFOptionList; 3+ may be list or dropdown — setCourseIf handles both. */
      setCourseIf(form, cname, courseCode);
    }

    const lessonSrc = String(row.lessonCode || row.lessonPdfCode || "").trim();
    const lesson = lessonSrc ? lessonTextForPdfField(lessonSrc) : "";
    setTextIf(form, spec.lessonField(idx), lesson);

    const block = String(row.block || "").trim();
    const equip = String(row.equipment || "").trim();
    const bf = spec.blockField(idx);
    if (bf) setTextIf(form, bf, block);

    fillEquipmentColumn(form, spec, idx, block, equip);

    const inferredType = typeFromLessonCode(lessonSrc);
    const typeForPdf = String(row.type || "").trim() || inferredType;
    if (typeForPdf) selectDropdownIf(form, spec.typeField(idx), typeForPdf);

    setTextIf(form, spec.remarksField(idx), row.remarks);

    const cadet = (row.cadetStatus || "").trim();
    const dn = (row.dayNight || "").trim();
    const llMd = row.lastLessonDate ? formatMonthDay(row.lastLessonDate) : "";

    const dnText = typeof spec.dayNightTextField === "function" ? spec.dayNightTextField(idx) : "";
    const cadetLlText = typeof spec.cadetLastLessonTextField === "function" ? spec.cadetLastLessonTextField(idx) : "";

    if (dnText) {
      if (dn) setTextFieldRaw(form, dnText, dn);
    } else if (dn) {
      const dnName = spec.dayNightDropdown(idx);
      if (dnName) selectFormChoiceIf(form, dnName, dn, DAY_NIGHT_OPTIONLIST_BACKSTOP);
    }

    if (cadetLlText) {
      /* Same widget as lastLessonText on clean masters — date only (cadet is in ID / Status). */
      setTextFieldRaw(form, cadetLlText, llMd);
    } else {
      if (cadet) {
        const cname = spec.cadetDropdown(idx);
        if (cname) {
          if (spec.cadetAsText) setTextIf(form, cname, cadet);
          else selectFormChoiceIf(form, cname, cadet, CADET_OPTIONLIST_BACKSTOP);
        }
      }
      if (llMd) setTextIf(form, spec.lastLessonText(idx), llMd);
    }

  }

  /**
   * Text/dropdown/list only — Helvetica appearances for typed values.
   * Do NOT call updateAppearances on PDFCheckBox: pdf-lib redraw can drop the template’s visible
   * square outline (/AP) so boxes “disappear” while /Yes still toggles in some viewers.
   */
  const helv = await pdfDoc.embedFont(StandardFonts.Helvetica);
  for (const field of form.getFields()) {
    if (field instanceof PDFDropdown || field instanceof PDFOptionList || field instanceof PDFTextField) {
      try {
        field.updateAppearances(helv);
      } catch {
        /* ignore */
      }
    }
  }

  /* false = keep Master.pdf’s original widget graphics (checkbox borders, etc.); values still saved in /V. */
  return pdfDoc.save({ updateFieldAppearances: false });
}

export function downloadPdfBytes(bytes, filename) {
  const blob = new Blob([bytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
