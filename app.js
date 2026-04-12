import {
  fillArfTemplate,
  downloadPdfBytes,
  lessonTextForPdfField,
  typeFromLessonCode,
} from "./pdf-export.js";

/** Resolve static assets next to this module (works on GitHub Pages project URLs). */
function assetUrl(filename) {
  return new URL(filename, import.meta.url).href;
}

const STORAGE_STUDENTS = "acron_arf_v1_students";
const STORAGE_STUDENT_COURSE = "acron_arf_v1_student_course";
const STORAGE_DRAFT = "acron_arf_v1_draft";
const STORAGE_CADET = "acron_arf_v2_cadet_statuses";
const STORAGE_FLIGHT_TYPES = "acron_arf_v2_flight_types";
const STORAGE_EQUIPMENT = "acron_arf_v2_equipment_options";

const PDF_IDB_NAME = "acron_arf_pdf_store";
const PDF_IDB_STORE = "templates";
const PDF_TEMPLATE_KEY = "arf_master";

const DEFAULT_CADET = ["PTO", "GND", "RTP", "FAA", "STG", "ACT"];
const DEFAULT_FLIGHT_TYPES = ["D", "DSIM", "DSolo", "Solo", "SoloXC", "Ground"];
const DEFAULT_EQUIPMENT = ["GW", "172 P", "172 SP", "AATD 15", "AATD17", "RBSIM1", "PA28", "AATD18", "R14193", "PA44", "AATDM-1"];

const DAY_NIGHT_OPTIONS = ["Day", "Night", "Both"];

/** @type {Uint8Array | null} */
let memoryTemplateBytes = null;

/** @type {{ version: number, courses: any[] }} */
let catalog = { version: 1, courses: [] };

let cadetStatuses = [...DEFAULT_CADET];
let flightTypes = [...DEFAULT_FLIGHT_TYPES];
let equipmentOptions = [...DEFAULT_EQUIPMENT];

/** @type {"cadet" | "flightType" | "equipment" | null} */
let listEditorKind = null;

function isoToWeekdayShort(iso) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return "";
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const days = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
  return days[dt.getUTCDay()];
}

function loadStringList(key, defaults) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [...defaults];
    const p = JSON.parse(raw);
    if (!Array.isArray(p) || !p.length) return [...defaults];
    return p.filter((x) => typeof x === "string" && String(x).trim());
  } catch {
    return [...defaults];
  }
}

function saveStringList(key, arr) {
  localStorage.setItem(key, JSON.stringify(arr));
}

function refreshOptionLists() {
  cadetStatuses = loadStringList(STORAGE_CADET, DEFAULT_CADET);
  flightTypes = loadStringList(STORAGE_FLIGHT_TYPES, DEFAULT_FLIGHT_TYPES);
  equipmentOptions = loadStringList(STORAGE_EQUIPMENT, DEFAULT_EQUIPMENT);
}

function loadStudents() {
  try {
    const raw = localStorage.getItem(STORAGE_STUDENTS);
    if (!raw) return [];
    const p = JSON.parse(raw);
    return Array.isArray(p) ? p.filter((s) => typeof s === "string" && s.trim()) : [];
  } catch {
    return [];
  }
}

function saveStudents(list) {
  localStorage.setItem(STORAGE_STUDENTS, JSON.stringify(list));
}

function loadStudentCourseMap() {
  try {
    const raw = localStorage.getItem(STORAGE_STUDENT_COURSE);
    if (!raw) return {};
    const p = JSON.parse(raw);
    return p && typeof p === "object" && !Array.isArray(p) ? p : {};
  } catch {
    return {};
  }
}

function saveStudentCourseMap(map) {
  localStorage.setItem(STORAGE_STUDENT_COURSE, JSON.stringify(map));
}

/** @type {Record<string, string>} student display name → course id */
let studentCourseMap = loadStudentCourseMap();

/** Master.pdf Course dropdown uses CASEL for both syllabi. */
function courseShortCodeForPdf(shortCode) {
  const s = String(shortCode || "").trim();
  if (s === "CASEL1" || s === "CASEL2") return "CASEL";
  return s;
}

function getCourseById(id) {
  return catalog.courses.find((c) => c.id === id) || null;
}

function emptyRow() {
  return {
    student: "",
    courseId: "",
    lessonCode: "",
    block: "",
    type: "",
    equipment: "",
    remarks: "",
    cadetStatus: "",
    dayNight: "",
    lastLessonDate: "",
  };
}

function emptyQualifications() {
  return {
    instructor: { CFI: false, CFII: false, MEI: false, SPIN: false },
    additionalCourse: { cfiA141: false, cfiI141: false, mei141: false },
    ukEasa: { FI: false, IRI: false, CRI: false },
  };
}

/** Ignore unknown keys / bad types from old drafts or hand-edited JSON so PDF matches known checkboxes only. */
function sanitizeQualifications(saved) {
  const e = emptyQualifications();
  if (!saved || typeof saved !== "object") return e;
  for (const k of Object.keys(e.instructor)) {
    e.instructor[k] = !!(saved.instructor && saved.instructor[k]);
  }
  for (const k of Object.keys(e.additionalCourse)) {
    e.additionalCourse[k] = !!(saved.additionalCourse && saved.additionalCourse[k]);
  }
  for (const k of Object.keys(e.ukEasa)) {
    e.ukEasa[k] = !!(saved.ukEasa && saved.ukEasa[k]);
  }
  return e;
}

function mergeQualifications(saved) {
  return sanitizeQualifications(saved);
}

/** Read qualification checkboxes from the page (source of truth for PDF). */
function readQualificationsFromDom() {
  const out = emptyQualifications();
  document
    .querySelectorAll("#qualInstructor input[type=checkbox], #qualAdditional input[type=checkbox], #qualUk input[type=checkbox]")
    .forEach((cb) => {
      const q = cb.getAttribute("data-q");
      const k = cb.getAttribute("data-k");
      if (q && k && out[q]) out[q][k] = cb.checked;
    });
  return out;
}

function loadDraft() {
  try {
    const raw = localStorage.getItem(STORAGE_DRAFT);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveDraft(state) {
  localStorage.setItem(STORAGE_DRAFT, JSON.stringify(state));
}

function buildInitialState() {
  const d = loadDraft();
  if (d && d.rows && Array.isArray(d.rows)) {
    return {
      instructorName: d.instructorName || "",
      requestDay: d.requestDay || "",
      requestDate: d.requestDate || "",
      aircraft: d.aircraft || {},
      qualifications: mergeQualifications(d.qualifications),
      notesScheduling: d.notesScheduling || "",
      groupManager: d.groupManager || "",
      rows: d.rows.map((r) => {
        const base = { ...emptyRow(), ...r };
        delete base.time;
        delete base.studentId;
        delete base.timeFields;
        if (base.courseId === "comm-141-55e") base.courseId = "casel1";
        if (base.courseId === "casel-appd") base.courseId = "casel2";
        if (!base.block && r.time) base.block = r.time;
        if (!String(base.type || "").trim() && base.lessonCode) {
          base.type = typeFromLessonCode(base.lessonCode);
        }
        return base;
      }),
    };
  }
  return {
    instructorName: "",
    requestDay: "",
    requestDate: "",
    aircraft: {},
    qualifications: emptyQualifications(),
    notesScheduling: "",
    groupManager: "",
    rows: [emptyRow(), emptyRow(), emptyRow()],
  };
}

let state = buildInitialState();
let students = loadStudents();

const els = {
  instructorName: document.getElementById("instructorName"),
  requestDay: document.getElementById("requestDay"),
  requestDate: document.getElementById("requestDate"),
  notesScheduling: document.getElementById("notesScheduling"),
  groupManager: document.getElementById("groupManager"),
  scheduleRows: document.getElementById("scheduleRows"),
  nameModal: document.getElementById("nameModal"),
  nameList: document.getElementById("nameList"),
  newStudentName: document.getElementById("newStudentName"),
  listEditorModal: document.getElementById("listEditorModal"),
  listEditorTitle: document.getElementById("listEditorTitle"),
  listEditorHint: document.getElementById("listEditorHint"),
  listEditorList: document.getElementById("listEditorList"),
  listEditorNew: document.getElementById("listEditorNew"),
};

function persistSoon() {
  clearTimeout(persistSoon._t);
  persistSoon._t = setTimeout(() => {
    saveDraft({
      instructorName: state.instructorName,
      requestDay: state.requestDay,
      requestDate: state.requestDate,
      aircraft: state.aircraft,
      qualifications: state.qualifications,
      notesScheduling: state.notesScheduling,
      groupManager: state.groupManager,
      rows: state.rows,
    });
  }, 250);
}

function ensureGroupManagerSelectValue() {
  const v = String(state.groupManager || "").trim();
  if (!v) return;
  const sel = els.groupManager;
  const has = [...sel.options].some((o) => o.value === v);
  if (has) return;
  const o = document.createElement("option");
  o.value = v;
  o.textContent = `${v} (saved)`;
  sel.appendChild(o);
}

function bindHeader() {
  els.instructorName.value = state.instructorName;
  els.requestDay.value = state.requestDay;
  els.requestDate.value = state.requestDate;
  els.notesScheduling.value = state.notesScheduling;
  ensureGroupManagerSelectValue();
  els.groupManager.value = state.groupManager || "";

  if (state.requestDate) {
    const auto = isoToWeekdayShort(state.requestDate);
    if (auto && !state.requestDay) {
      state.requestDay = auto;
      els.requestDay.value = auto;
    }
  }

  els.instructorName.addEventListener("input", () => {
    state.instructorName = els.instructorName.value;
    persistSoon();
  });
  els.requestDay.addEventListener("input", () => {
    state.requestDay = els.requestDay.value;
    persistSoon();
  });
  els.requestDate.addEventListener("change", () => {
    state.requestDate = els.requestDate.value;
    const auto = isoToWeekdayShort(state.requestDate);
    if (auto) {
      state.requestDay = auto;
      els.requestDay.value = auto;
    }
    persistSoon();
  });
  els.notesScheduling.addEventListener("input", () => {
    state.notesScheduling = els.notesScheduling.value;
    persistSoon();
  });
  els.groupManager.addEventListener("change", () => {
    state.groupManager = els.groupManager.value;
    persistSoon();
  });

  document.querySelectorAll("#aircraftChecks input[type=checkbox]").forEach((cb) => {
    const k = cb.getAttribute("data-ac");
    cb.checked = !!state.aircraft[k];
    cb.addEventListener("change", () => {
      state.aircraft[k] = cb.checked;
      persistSoon();
    });
  });

  document
    .querySelectorAll("#qualInstructor input[type=checkbox], #qualAdditional input[type=checkbox], #qualUk input[type=checkbox]")
    .forEach((cb) => {
      const q = cb.getAttribute("data-q");
      const k = cb.getAttribute("data-k");
      if (q && k && state.qualifications[q]) {
        cb.checked = !!state.qualifications[q][k];
      }
      cb.addEventListener("change", () => {
        if (q && k && state.qualifications[q]) {
          state.qualifications[q][k] = cb.checked;
          persistSoon();
        }
      });
    });
}

function syncQualificationCheckboxesFromState() {
  document
    .querySelectorAll("#qualInstructor input[type=checkbox], #qualAdditional input[type=checkbox], #qualUk input[type=checkbox]")
    .forEach((cb) => {
      const q = cb.getAttribute("data-q");
      const k = cb.getAttribute("data-k");
      if (q && k && state.qualifications[q]) {
        cb.checked = !!state.qualifications[q][k];
      }
    });
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/'/g, "&#39;");
}

function optionsFromList(list, selected, emptyLabel = "—") {
  const parts = [`<option value="">${escapeHtml(emptyLabel)}</option>`];
  for (const x of list) {
    const sel = x === selected ? " selected" : "";
    parts.push(`<option value="${escapeAttr(x)}"${sel}>${escapeHtml(x)}</option>`);
  }
  return parts.join("");
}

function matchEquipmentFromLesson(raw) {
  const t = String(raw || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
  if (!t) return "";
  for (const e of equipmentOptions) {
    const n = e.replace(/\s+/g, "").toUpperCase();
    if (n === t || n.includes(t) || t.includes(n)) return e;
  }
  return "";
}

function studentOptionsHtml(selected) {
  return optionsFromList(students, selected, "—");
}

function courseOptionsHtml(selectedId) {
  const opts = ['<option value="">— Course —</option>'];
  for (const c of catalog.courses) {
    const sel = c.id === selectedId ? " selected" : "";
    opts.push(`<option value="${escapeAttr(c.id)}"${sel}>${escapeHtml(c.shortCode + " — " + c.name)}</option>`);
  }
  return opts.join("");
}

function lessonOptionsHtmlFixed(course, selectedCode) {
  const parts = ['<option value="">— Lesson —</option>'];
  for (const L of course.lessons) {
    const sel = L.code === selectedCode ? " selected" : "";
    parts.push(`<option value="${escapeAttr(L.code)}"${sel}>${escapeHtml(L.code)}</option>`);
  }
  return parts.join("");
}

function findLesson(courseId, code) {
  const c = getCourseById(courseId);
  if (!c) return null;
  return c.lessons.find((l) => l.code === code) || null;
}

function renderRows() {
  els.scheduleRows.innerHTML = "";
  state.rows.forEach((row, idx) => {
    const wrap = document.createElement("div");
    wrap.className = "schedule-row";
    wrap.innerHTML = `
      <h3>Row ${idx + 1}</h3>
      <div class="row-grid">
        <div>
          <label>Student</label>
          <select class="sel-student" data-i="${idx}">${studentOptionsHtml(row.student)}</select>
        </div>
        <div>
          <label>Cadet Status</label>
          <select class="sel-cadet" data-i="${idx}">${optionsFromList(cadetStatuses, row.cadetStatus)}</select>
        </div>
        <div>
          <label>Course</label>
          <select class="sel-course" data-i="${idx}">${courseOptionsHtml(row.courseId)}</select>
        </div>
        <div>
          <label>Lesson</label>
          <select class="sel-lesson" data-i="${idx}">${row.courseId ? lessonOptionsHtmlFixed(getCourseById(row.courseId), row.lessonCode) : '<option value="">— Select course first —</option>'}</select>
        </div>
        <div>
          <label>Day / Night / Both</label>
          <select class="sel-daynight" data-i="${idx}">${optionsFromList(DAY_NIGHT_OPTIONS, row.dayNight)}</select>
        </div>
        <div>
          <label>Block Time</label>
          <input type="text" class="inp-block" data-i="${idx}" value="${escapeAttr(row.block)}" placeholder="Block time" />
        </div>
        <div>
          <label>Type</label>
          <select class="sel-type" data-i="${idx}">${optionsFromList(flightTypes, row.type)}</select>
        </div>
        <div>
          <label>Equipment</label>
          <select class="sel-equip" data-i="${idx}">${optionsFromList(equipmentOptions, row.equipment)}</select>
        </div>
        <div>
          <label>Date of Last Lesson</label>
          <input type="date" class="inp-lastlesson" data-i="${idx}" value="${escapeAttr(row.lastLessonDate || "")}" />
        </div>
        <div style="grid-column: 1 / -1">
          <label>Remarks</label>
          <input type="text" class="inp-remarks" data-i="${idx}" value="${escapeAttr(row.remarks)}" />
        </div>
      </div>
    `;
    els.scheduleRows.appendChild(wrap);

    wrap.querySelector(".sel-student").addEventListener("change", (e) => {
      state.rows[idx].student = e.target.value;
      const name = String(e.target.value || "").trim();
      if (name && studentCourseMap[name] && catalog.courses.some((c) => c.id === studentCourseMap[name])) {
        state.rows[idx].courseId = studentCourseMap[name];
        state.rows[idx].lessonCode = "";
        state.rows[idx].equipment = "";
        state.rows[idx].type = "";
        renderRows();
      }
      persistSoon();
    });
    wrap.querySelector(".sel-cadet").addEventListener("change", (e) => {
      state.rows[idx].cadetStatus = e.target.value;
      persistSoon();
    });
    wrap.querySelector(".sel-course").addEventListener("change", (e) => {
      state.rows[idx].courseId = e.target.value;
      state.rows[idx].lessonCode = "";
      state.rows[idx].equipment = "";
      state.rows[idx].type = "";
      const st = String(state.rows[idx].student || "").trim();
      const cid = e.target.value;
      if (st && cid) {
        studentCourseMap[st] = cid;
        saveStudentCourseMap(studentCourseMap);
      }
      renderRows();
      persistSoon();
    });
    wrap.querySelector(".sel-lesson").addEventListener("change", (e) => {
      state.rows[idx].lessonCode = e.target.value;
      const L = findLesson(state.rows[idx].courseId, e.target.value);
      if (L) {
        const matched = matchEquipmentFromLesson(L.equipment);
        state.rows[idx].equipment = matched;
      }
      state.rows[idx].type = typeFromLessonCode(e.target.value);
      renderRows();
      persistSoon();
    });
    wrap.querySelector(".sel-daynight").addEventListener("change", (e) => {
      state.rows[idx].dayNight = e.target.value;
      persistSoon();
    });
    wrap.querySelector(".inp-block").addEventListener("input", (e) => {
      state.rows[idx].block = e.target.value;
      persistSoon();
    });
    wrap.querySelector(".sel-type").addEventListener("change", (e) => {
      state.rows[idx].type = e.target.value;
      persistSoon();
    });
    wrap.querySelector(".sel-equip").addEventListener("change", (e) => {
      state.rows[idx].equipment = e.target.value;
      persistSoon();
    });
    wrap.querySelector(".inp-lastlesson").addEventListener("change", (e) => {
      state.rows[idx].lastLessonDate = e.target.value;
      persistSoon();
    });
    wrap.querySelector(".inp-remarks").addEventListener("input", (e) => {
      state.rows[idx].remarks = e.target.value;
      persistSoon();
    });
  });
}

function renderNameList() {
  els.nameList.innerHTML = "";
  if (!students.length) {
    els.nameList.innerHTML = '<li class="hint">No names yet.</li>';
    return;
  }
  students.forEach((name, i) => {
    const li = document.createElement("li");

    const span = document.createElement("span");
    span.className = "student-name-cell";
    span.textContent = name;

    const sel = document.createElement("select");
    sel.className = "sel-student-default-course";
    sel.setAttribute("aria-label", `Default course for ${name}`);
    const optNone = document.createElement("option");
    optNone.value = "";
    optNone.textContent = "— Course —";
    sel.appendChild(optNone);
    const mappedId = studentCourseMap[name];
    for (const c of catalog.courses) {
      const o = document.createElement("option");
      o.value = c.id;
      o.textContent = `${c.shortCode} — ${c.name}`;
      if (mappedId === c.id) o.selected = true;
      sel.appendChild(o);
    }
    sel.addEventListener("change", () => {
      const v = sel.value.trim();
      if (v) studentCourseMap[name] = v;
      else delete studentCourseMap[name];
      saveStudentCourseMap(studentCourseMap);
      renderRows();
      persistSoon();
    });

    const del = document.createElement("button");
    del.type = "button";
    del.className = "btn-danger";
    del.textContent = "Remove";
    del.addEventListener("click", () => {
      const removed = students[i];
      students = students.filter((_, j) => j !== i);
      saveStudents(students);
      delete studentCourseMap[removed];
      saveStudentCourseMap(studentCourseMap);
      renderNameList();
      renderRows();
      persistSoon();
    });

    li.appendChild(span);
    li.appendChild(sel);
    li.appendChild(del);
    els.nameList.appendChild(li);
  });
}

function openNameModal() {
  els.nameModal.classList.add("open");
  els.nameModal.setAttribute("aria-hidden", "false");
  renderNameList();
}

function closeNameModal() {
  els.nameModal.classList.remove("open");
  els.nameModal.setAttribute("aria-hidden", "true");
}

function addStudent() {
  const n = els.newStudentName.value.trim();
  if (!n) return;
  if (!students.includes(n)) students.push(n);
  students.sort((a, b) => a.localeCompare(b, "en"));
  saveStudents(students);
  els.newStudentName.value = "";
  renderNameList();
  renderRows();
}

function getEditorArrayRef() {
  if (listEditorKind === "cadet") return cadetStatuses;
  if (listEditorKind === "flightType") return flightTypes;
  return equipmentOptions;
}

function saveEditorArrayFromRef() {
  const arr = getEditorArrayRef();
  if (listEditorKind === "cadet") saveStringList(STORAGE_CADET, arr);
  else if (listEditorKind === "flightType") saveStringList(STORAGE_FLIGHT_TYPES, arr);
  else saveStringList(STORAGE_EQUIPMENT, arr);
}

function renderListEditorItems() {
  const arr = getEditorArrayRef();
  els.listEditorList.innerHTML = "";
  arr.forEach((item, i) => {
    const li = document.createElement("li");
    li.innerHTML = `<span>${escapeHtml(item)}</span>`;
    const del = document.createElement("button");
    del.type = "button";
    del.className = "btn-danger";
    del.textContent = "Remove";
    del.addEventListener("click", () => {
      arr.splice(i, 1);
      saveEditorArrayFromRef();
      renderListEditorItems();
      renderRows();
    });
    li.appendChild(del);
    els.listEditorList.appendChild(li);
  });
}

function openListEditor(kind) {
  listEditorKind = kind;
  if (kind === "cadet") {
    els.listEditorTitle.textContent = "Cadet status options";
    els.listEditorHint.textContent = "Shown in each row’s Cadet Status dropdown (match the PDF, e.g. PTO).";
  } else if (kind === "flightType") {
    els.listEditorTitle.textContent = "Type options";
    els.listEditorHint.textContent = "Flight type dropdown (D, DSIM, etc.).";
  } else {
    els.listEditorTitle.textContent = "Equipment options";
    els.listEditorHint.textContent = "Use the same spelling as in Master.pdf (e.g. 172 SP, PA28).";
  }
  els.listEditorNew.value = "";
  renderListEditorItems();
  els.listEditorModal.classList.add("open");
  els.listEditorModal.setAttribute("aria-hidden", "false");
}

function closeListEditor() {
  els.listEditorModal.classList.remove("open");
  els.listEditorModal.setAttribute("aria-hidden", "true");
  listEditorKind = null;
}

function addListEditorItem() {
  const v = els.listEditorNew.value.trim();
  if (!v || !listEditorKind) return;
  const arr = getEditorArrayRef();
  if (!arr.includes(v)) arr.push(v);
  arr.sort((a, b) => a.localeCompare(b, "en"));
  saveEditorArrayFromRef();
  els.listEditorNew.value = "";
  renderListEditorItems();
  renderRows();
}

function openPdfIndexedDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(PDF_IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(PDF_IDB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbPutArfTemplate(bytes) {
  const db = await openPdfIndexedDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PDF_IDB_STORE, "readwrite");
    tx.objectStore(PDF_IDB_STORE).put(bytes, PDF_TEMPLATE_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbGetArfTemplate() {
  const db = await openPdfIndexedDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PDF_IDB_STORE, "readonly");
    const r = tx.objectStore(PDF_IDB_STORE).get(PDF_TEMPLATE_KEY);
    r.onsuccess = () => resolve(r.result || null);
    r.onerror = () => reject(r.error);
  });
}

async function resolveArfTemplateBytes() {
  if (memoryTemplateBytes) return memoryTemplateBytes;
  try {
    const fromIdb = await idbGetArfTemplate();
    if (fromIdb instanceof Uint8Array) {
      memoryTemplateBytes = fromIdb;
      return memoryTemplateBytes;
    }
    if (fromIdb instanceof ArrayBuffer) {
      memoryTemplateBytes = new Uint8Array(fromIdb);
      return memoryTemplateBytes;
    }
  } catch {
    /* */
  }
  const res = await fetch(assetUrl("Master.pdf"), { cache: "no-store" });
  if (res.ok) {
    memoryTemplateBytes = new Uint8Array(await res.arrayBuffer());
    return memoryTemplateBytes;
  }
  return null;
}

function exportPayload() {
  const qualifications = sanitizeQualifications(readQualificationsFromDom());
  return {
    exportedAt: new Date().toISOString(),
    instructorName: state.instructorName,
    requestDay: state.requestDay,
    requestDate: state.requestDate,
    aircraft: state.aircraft,
    qualifications,
    notesScheduling: state.notesScheduling,
    groupManager: state.groupManager,
    rows: state.rows.map((r) => {
      const c = getCourseById(r.courseId);
      const rowRest = { ...r };
      delete rowRest.studentId;
      delete rowRest.timeFields;
      return {
        ...rowRest,
        courseShortCode: courseShortCodeForPdf(c?.shortCode || ""),
        lessonPdfCode: r.lessonCode ? lessonTextForPdfField(r.lessonCode) : "",
      };
    }),
  };
}

function copyEmailBody() {
  const lines = [];
  lines.push("[Acron ARF summary]");
  lines.push(`Instructor: ${state.instructorName || "-"}`);
  lines.push(`Day/Date: ${state.requestDay || "-"} / ${state.requestDate || "-"}`);
  const ac = Object.keys(state.aircraft).filter((k) => state.aircraft[k]);
  lines.push(`Aircraft qualification: ${ac.length ? ac.join(", ") : "-"}`);
  const q = sanitizeQualifications(readQualificationsFromDom());
  state.qualifications = q;
  persistSoon();
  const ins = Object.keys(q.instructor).filter((k) => q.instructor[k]);
  if (ins.length) lines.push(`Instructor quals: ${ins.join(", ")}`);
  const add = Object.entries(q.additionalCourse)
    .filter(([, v]) => v)
    .map(([k]) => k);
  if (add.length) lines.push(`Additional course quals: ${add.join(", ")}`);
  const uk = Object.keys(q.ukEasa).filter((k) => q.ukEasa[k]);
  if (uk.length) lines.push(`UK/EASA: ${uk.join(", ")}`);
  lines.push("");
  state.rows.forEach((r, i) => {
    if (!r.student && !r.courseId && !r.lessonCode && !r.cadetStatus) return;
    const c = getCourseById(r.courseId);
    lines.push(`--- Row ${i + 1} ---`);
    lines.push(`Student: ${r.student || "-"}`);
    lines.push(`Cadet Status: ${r.cadetStatus || "-"}`);
    lines.push(`Course: ${c?.shortCode || "-"} (${c?.name || ""})`);
    lines.push(`Lesson: ${r.lessonCode || "-"}`);
    const typeLine = r.type || typeFromLessonCode(r.lessonCode) || "-";
    lines.push(`Day/Night: ${r.dayNight || "-"} | Block Time: ${r.block || "-"} | Type: ${typeLine}`);
    lines.push(`Equipment: ${r.equipment || "-"} | Last lesson: ${r.lastLessonDate || "-"}`);
    if (r.remarks) lines.push(`Remarks: ${r.remarks}`);
    lines.push("");
  });
  lines.push("Notes to Scheduling:");
  lines.push(state.notesScheduling || "-");
  lines.push("");
  lines.push(`Group Manager: ${state.groupManager || "-"}`);
  const text = lines.join("\n");
  navigator.clipboard.writeText(text).then(
    () => alert("Copied to clipboard."),
    () => alert("Could not copy. Check browser permissions.")
  );
}

async function loadCatalog() {
  const res = await fetch(assetUrl("courses.json"), { cache: "no-store" });
  if (!res.ok) throw new Error("Could not load courses.json");
  catalog = await res.json();
}

function init() {
  refreshOptionLists();

  bindHeader();
  document.getElementById("openNameManager").addEventListener("click", openNameModal);
  document.getElementById("closeNameModal").addEventListener("click", closeNameModal);
  els.nameModal.addEventListener("click", (e) => {
    if (e.target === els.nameModal) closeNameModal();
  });
  document.getElementById("addStudentBtn").addEventListener("click", addStudent);
  els.newStudentName.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addStudent();
    }
  });

  document.getElementById("openCadetListEditor").addEventListener("click", () => openListEditor("cadet"));
  document.getElementById("openFlightTypeListEditor").addEventListener("click", () => openListEditor("flightType"));
  document.getElementById("openEquipmentListEditor").addEventListener("click", () => openListEditor("equipment"));
  document.getElementById("closeListEditorModal").addEventListener("click", closeListEditor);
  els.listEditorModal.addEventListener("click", (e) => {
    if (e.target === els.listEditorModal) closeListEditor();
  });
  document.getElementById("listEditorAddBtn").addEventListener("click", addListEditorItem);
  els.listEditorNew.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addListEditorItem();
    }
  });

  document.getElementById("addRow").addEventListener("click", () => {
    if (state.rows.length >= 10) {
      alert("Maximum 10 rows.");
      return;
    }
    state.rows.push(emptyRow());
    renderRows();
    persistSoon();
  });
  document.getElementById("clearRows").addEventListener("click", () => {
    if (!confirm("Clear all schedule rows?")) return;
    state.rows = [emptyRow()];
    renderRows();
    persistSoon();
  });

  document.getElementById("copyEmailBody").addEventListener("click", copyEmailBody);
  document.getElementById("printPage").addEventListener("click", () => window.print());

  document.getElementById("downloadArfPdf").addEventListener("click", async () => {
    try {
      const bytes = await resolveArfTemplateBytes();
      if (!bytes) {
        alert(
          "Could not load Master.pdf. Put Master.pdf next to this page and open via a local or hosted server, or use Change PDF template to pick the file."
        );
        return;
      }
      state.qualifications = sanitizeQualifications(readQualificationsFromDom());
      syncQualificationCheckboxesFromState();
      persistSoon();
      const filled = await fillArfTemplate(bytes, exportPayload());
      const safeDate = (state.requestDate || "draft").replace(/\//g, "-");
      downloadPdfBytes(filled, `ARF-${safeDate}.pdf`);
    } catch (err) {
      console.error(err);
      alert(`Could not build PDF: ${err && err.message ? err.message : String(err)}`);
    }
  });

  document.getElementById("arfTemplateFile").addEventListener("change", async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      memoryTemplateBytes = new Uint8Array(await f.arrayBuffer());
      await idbPutArfTemplate(memoryTemplateBytes);
      alert("Saved this PDF as the template in your browser. Use Download filled ARF PDF.");
    } catch (err) {
      alert(`Could not save template: ${err.message || err}`);
    }
    e.target.value = "";
  });
}

loadCatalog()
  .then(() => {
    init();
    renderRows();
  })
  .catch((err) => {
    document.body.innerHTML = `<main class="card" style="margin:2rem"><h2>Load error</h2><p>${escapeHtml(err.message)}</p><p class="hint">Serve this folder over HTTP (required for <code>courses.json</code> and <code>Master.pdf</code>):<br><code>cd acron-arf-scheduler && python3 -m http.server 8765</code><br>Then open <code>http://localhost:8765</code> — or deploy the folder to Netlify / GitHub Pages / Cloudflare Pages.</p></main>`;
  });
