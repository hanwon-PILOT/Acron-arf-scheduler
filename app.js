/**
 * Safari (non‑Private) caches ES modules aggressively. `index.html` loads this file as `app.js?v=N`;
 * we reuse the same `v` for `pdf-export.js` so both refresh together when N is bumped.
 */
const _appEntry = new URL(import.meta.url);
const _cacheBust = _appEntry.searchParams.get("v") || "1";
const {
  fillArfTemplate,
  downloadPdfBytes,
  lessonTextForPdfField,
  typeFromLessonCode,
} = await import(`./pdf-export.js?v=${encodeURIComponent(_cacheBust)}`);

/** Resolve static assets next to this module (same `v` as app entry for CDN/Safari cache). */
function assetUrl(filename) {
  const u = new URL(filename, import.meta.url);
  u.searchParams.set("v", _cacheBust);
  return u.href;
}

/** Legacy single shared list (migrated once into per-instructor storage). */
const STORAGE_STUDENTS_LEGACY = "acron_arf_v1_students";
const STORAGE_STUDENT_COURSE_LEGACY = "acron_arf_v1_student_course";
const STORAGE_STUDENTS_BY_INSTRUCTOR = "acron_arf_v3_students_by_instructor";
const STORAGE_STUDENT_COURSE_BY_INSTRUCTOR = "acron_arf_v3_student_course_by_instructor";
const STORAGE_LEGACY_STUDENTS_MIGRATED = "acron_arf_v3_students_migrated_v1";
/** Bucket when no instructor profile is committed (empty select + name not blurred to a profile). */
const STUDENTS_UNASSIGNED_KEY = "__unassigned__";
const STORAGE_DRAFT = "acron_arf_v1_draft";
const STORAGE_LAST_INSTRUCTOR = "acron_arf_v1_last_instructor";
const STORAGE_INSTRUCTOR_HISTORY = "acron_arf_v1_instructor_history";
const STORAGE_INSTRUCTOR_PROFILES = "acron_arf_v2_instructor_profiles";
const STORAGE_LAST_ACTIVE_INSTRUCTOR = "acron_arf_v2_last_active_instructor";
const STORAGE_INSTRUCTOR_ROSTER = "acron_arf_v2_instructor_roster";

/** Prevents instructor <select> change handler while syncing from code. */
let instructorSelectSuppress = false;
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

function loadStudentsMap() {
  try {
    const raw = localStorage.getItem(STORAGE_STUDENTS_BY_INSTRUCTOR);
    const o = raw ? JSON.parse(raw) : {};
    return o && typeof o === "object" && !Array.isArray(o) ? o : {};
  } catch {
    return {};
  }
}

function saveStudentsMap(map) {
  localStorage.setItem(STORAGE_STUDENTS_BY_INSTRUCTOR, JSON.stringify(map));
}

function loadCourseMapsByInstructor() {
  try {
    const raw = localStorage.getItem(STORAGE_STUDENT_COURSE_BY_INSTRUCTOR);
    const o = raw ? JSON.parse(raw) : {};
    return o && typeof o === "object" && !Array.isArray(o) ? o : {};
  } catch {
    return {};
  }
}

function saveCourseMapsByInstructor(map) {
  localStorage.setItem(STORAGE_STUDENT_COURSE_BY_INSTRUCTOR, JSON.stringify(map));
}

/** Copy legacy global student list + default-course map into the active instructor bucket once. */
function migrateLegacySharedStudents() {
  try {
    if (localStorage.getItem(STORAGE_LEGACY_STUDENTS_MIGRATED)) return;
    const rawList = localStorage.getItem(STORAGE_STUDENTS_LEGACY);
    const rawCourse = localStorage.getItem(STORAGE_STUDENT_COURSE_LEGACY);
    if (!rawList && !rawCourse) {
      localStorage.setItem(STORAGE_LEGACY_STUDENTS_MIGRATED, "1");
      return;
    }
    let list = [];
    if (rawList) {
      const p = JSON.parse(rawList);
      list = Array.isArray(p) ? p.filter((s) => typeof s === "string" && s.trim()) : [];
    }
    let courses = {};
    if (rawCourse) {
      const p = JSON.parse(rawCourse);
      courses = p && typeof p === "object" && !Array.isArray(p) ? p : {};
    }
    const target = profileKey(getLastActiveInstructor()) || profileKey(getLastInstructorName()) || STUDENTS_UNASSIGNED_KEY;
    const smap = loadStudentsMap();
    const cmap = loadCourseMapsByInstructor();
    if (!smap[target] || !Array.isArray(smap[target]) || smap[target].length === 0) {
      smap[target] = list;
    }
    if (!cmap[target] || typeof cmap[target] !== "object") {
      cmap[target] = { ...courses };
    } else {
      cmap[target] = { ...courses, ...cmap[target] };
    }
    saveStudentsMap(smap);
    saveCourseMapsByInstructor(cmap);
    localStorage.removeItem(STORAGE_STUDENTS_LEGACY);
    localStorage.removeItem(STORAGE_STUDENT_COURSE_LEGACY);
    localStorage.setItem(STORAGE_LEGACY_STUDENTS_MIGRATED, "1");
  } catch {
    /* */
  }
}

function loadStudentsListForKey(bucketKey) {
  const smap = loadStudentsMap();
  const list = smap[bucketKey];
  return Array.isArray(list) ? list.filter((s) => typeof s === "string" && s.trim()) : [];
}

function loadCourseMapForKey(bucketKey) {
  const cmap = loadCourseMapsByInstructor();
  const m = cmap[bucketKey];
  return m && typeof m === "object" && !Array.isArray(m) ? { ...m } : {};
}

function persistStudentsAndCourses(bucketKey) {
  const smap = loadStudentsMap();
  smap[bucketKey] = [...students];
  saveStudentsMap(smap);
  const cmap = loadCourseMapsByInstructor();
  cmap[bucketKey] = { ...studentCourseMap };
  saveCourseMapsByInstructor(cmap);
}

function deleteStudentsDataForInstructor(name) {
  const k = profileKey(name);
  if (!k) return;
  const smap = loadStudentsMap();
  delete smap[k];
  saveStudentsMap(smap);
  const cmap = loadCourseMapsByInstructor();
  delete cmap[k];
  saveCourseMapsByInstructor(cmap);
}

/** @type {Record<string, string>} student display name → course id (current instructor bucket) */
let studentCourseMap = {};

/** Master.pdf Course dropdown uses CASEL for both syllabi; CFI-A for airplane CFI. */
function courseShortCodeForPdf(shortCode) {
  const s = String(shortCode || "").trim();
  if (s === "CASEL1" || s === "CASEL2") return "CASEL";
  if (s === "CFI") return "CFI-A";
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

function getLastInstructorName() {
  try {
    const s = localStorage.getItem(STORAGE_LAST_INSTRUCTOR);
    return s ? String(s).trim() : "";
  } catch {
    return "";
  }
}

function loadInstructorHistory() {
  try {
    const raw = localStorage.getItem(STORAGE_INSTRUCTOR_HISTORY);
    const p = raw ? JSON.parse(raw) : [];
    return Array.isArray(p) ? p.filter((x) => typeof x === "string" && String(x).trim()) : [];
  } catch {
    return [];
  }
}

/** Remember last non-empty instructor name for default + datalist suggestions. */
function rememberInstructorName(name) {
  const t = String(name || "").trim();
  if (!t) return;
  try {
    localStorage.setItem(STORAGE_LAST_INSTRUCTOR, t);
    const list = loadInstructorHistory().filter((x) => x.toLowerCase() !== t.toLowerCase());
    list.unshift(t);
    localStorage.setItem(STORAGE_INSTRUCTOR_HISTORY, JSON.stringify(list.slice(0, 12)));
  } catch {
    /* */
  }
}

function profileKey(name) {
  return String(name || "").trim();
}

function loadProfilesRaw() {
  try {
    const raw = localStorage.getItem(STORAGE_INSTRUCTOR_PROFILES);
    const o = raw ? JSON.parse(raw) : {};
    return o && typeof o === "object" && !Array.isArray(o) ? o : {};
  } catch {
    return {};
  }
}

function saveProfilesRaw(obj) {
  localStorage.setItem(STORAGE_INSTRUCTOR_PROFILES, JSON.stringify(obj));
}

function listProfileNames() {
  return Object.keys(loadProfilesRaw()).sort((a, b) => a.localeCompare(b, "en"));
}

function saveProfile(key, payload) {
  const k = profileKey(key);
  if (!k || !payload) return;
  const all = loadProfilesRaw();
  all[k] = { ...payload, instructorName: k };
  saveProfilesRaw(all);
}

function getProfile(key) {
  const k = profileKey(key);
  return k ? loadProfilesRaw()[k] : null;
}

function deleteProfile(key) {
  const k = profileKey(key);
  if (!k) return;
  const all = loadProfilesRaw();
  delete all[k];
  saveProfilesRaw(all);
}

function getLastActiveInstructor() {
  try {
    const s = localStorage.getItem(STORAGE_LAST_ACTIVE_INSTRUCTOR);
    return s ? String(s).trim() : "";
  } catch {
    return "";
  }
}

function setLastActiveInstructor(name) {
  const t = profileKey(name);
  try {
    if (t) localStorage.setItem(STORAGE_LAST_ACTIVE_INSTRUCTOR, t);
    else localStorage.removeItem(STORAGE_LAST_ACTIVE_INSTRUCTOR);
  } catch {
    /* */
  }
}

/** One-time: put legacy single draft into per-instructor profiles. */
function migrateLegacyDraftToProfiles() {
  try {
    const profiles = loadProfilesRaw();
    if (Object.keys(profiles).length > 0) return;
    const d = loadDraft();
    if (!d || !Array.isArray(d.rows)) return;
    const key = profileKey(d.instructorName) || profileKey(getLastInstructorName());
    if (!key) return;
    profiles[key] = {
      instructorName: key,
      requestDay: d.requestDay || "",
      requestDate: d.requestDate || "",
      aircraft: d.aircraft || {},
      qualifications: d.qualifications || emptyQualifications(),
      notesScheduling: d.notesScheduling || "",
      groupManager: d.groupManager || "",
      rows: d.rows,
    };
    saveProfilesRaw(profiles);
    setLastActiveInstructor(key);
  } catch {
    /* */
  }
}

function mapDraftRows(rows) {
  return rows.map((r) => {
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
  });
}

function normalizePayloadToState(d) {
  if (!d || !Array.isArray(d.rows)) return null;
  return {
    instructorName: String(d.instructorName || "").trim(),
    requestDay: d.requestDay || "",
    requestDate: d.requestDate || "",
    aircraft: d.aircraft && typeof d.aircraft === "object" ? { ...d.aircraft } : {},
    qualifications: mergeQualifications(d.qualifications),
    notesScheduling: d.notesScheduling || "",
    groupManager: d.groupManager || "",
    rows: mapDraftRows(d.rows),
  };
}

function defaultEmptyState() {
  return {
    instructorName: getLastInstructorName(),
    requestDay: "",
    requestDate: "",
    aircraft: {},
    qualifications: emptyQualifications(),
    notesScheduling: "",
    groupManager: "",
    rows: [emptyRow(), emptyRow(), emptyRow()],
  };
}

function draftSnapshot() {
  return {
    instructorName: state.instructorName,
    requestDay: state.requestDay,
    requestDate: state.requestDate,
    aircraft: { ...state.aircraft },
    qualifications: JSON.parse(JSON.stringify(state.qualifications)),
    notesScheduling: state.notesScheduling,
    groupManager: state.groupManager,
    rows: state.rows.map((r) => ({ ...r })),
  };
}

function buildInitialState() {
  migrateLegacyDraftToProfiles();
  const profiles = loadProfilesRaw();
  const last = getLastActiveInstructor();
  if (last && profiles[last]) {
    const st = normalizePayloadToState(profiles[last]);
    if (st) {
      st.instructorName = last;
      return st;
    }
  }
  const d = loadDraft();
  if (d && d.rows && Array.isArray(d.rows)) {
    const st = normalizePayloadToState(d);
    if (st) {
      st.instructorName = String(d.instructorName || "").trim() || getLastInstructorName();
      return st;
    }
  }
  return defaultEmptyState();
}

let state = buildInitialState();
/** Profile JSON key while editing; only matches typed name after blur (avoids saving "B", "Bo" while typing). */
let profileSaveKey = profileKey(state.instructorName);
migrateLegacySharedStudents();
const _initialStudentBucket = profileSaveKey.trim() || STUDENTS_UNASSIGNED_KEY;
let students = loadStudentsListForKey(_initialStudentBucket);
studentCourseMap = loadCourseMapForKey(_initialStudentBucket);

function studentBucketKey() {
  return profileSaveKey.trim() || STUDENTS_UNASSIGNED_KEY;
}

function loadInstructorRoster() {
  try {
    const raw = localStorage.getItem(STORAGE_INSTRUCTOR_ROSTER);
    if (!raw) return [];
    const p = JSON.parse(raw);
    return Array.isArray(p) ? p.filter((x) => typeof x === "string" && String(x).trim()) : [];
  } catch {
    return [];
  }
}

function saveInstructorRoster(list) {
  const u = [...new Set(list.map((x) => String(x || "").trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, "en")
  );
  localStorage.setItem(STORAGE_INSTRUCTOR_ROSTER, JSON.stringify(u));
  return u;
}

/** Dropdown = roster ∪ saved profile names */
function instructorNamesForDropdown() {
  const s = new Set(loadInstructorRoster());
  for (const n of listProfileNames()) s.add(n);
  return [...s].sort((a, b) => a.localeCompare(b, "en"));
}

function ensureInstructorRosterSeededFromLegacy() {
  if (loadInstructorRoster().length) return;
  const seed = [...new Set([...listProfileNames(), ...loadInstructorHistory()])].filter(Boolean);
  if (seed.length) saveInstructorRoster(seed);
}

function rememberInstructorRosterName(name) {
  const t = profileKey(name);
  if (!t) return;
  const cur = loadInstructorRoster();
  if (cur.some((x) => x.toLowerCase() === t.toLowerCase())) return;
  saveInstructorRoster([...cur, t]);
}

const els = {
  instructorProfileSelect: document.getElementById("instructorProfileSelect"),
  instructorName: document.getElementById("instructorName"),
  requestDay: document.getElementById("requestDay"),
  requestDate: document.getElementById("requestDate"),
  notesScheduling: document.getElementById("notesScheduling"),
  groupManager: document.getElementById("groupManager"),
  scheduleRows: document.getElementById("scheduleRows"),
  nameModal: document.getElementById("nameModal"),
  nameList: document.getElementById("nameList"),
  newStudentName: document.getElementById("newStudentName"),
  instructorNameModal: document.getElementById("instructorNameModal"),
  instructorRosterList: document.getElementById("instructorRosterList"),
  newInstructorRosterName: document.getElementById("newInstructorRosterName"),
  instructorProfileModal: document.getElementById("instructorProfileModal"),
  instructorProfileList: document.getElementById("instructorProfileList"),
  listEditorModal: document.getElementById("listEditorModal"),
  listEditorTitle: document.getElementById("listEditorTitle"),
  listEditorHint: document.getElementById("listEditorHint"),
  listEditorList: document.getElementById("listEditorList"),
  listEditorNew: document.getElementById("listEditorNew"),
};

function refreshInstructorProfileSelect() {
  const sel = els.instructorProfileSelect;
  if (!sel) return;
  const names = instructorNamesForDropdown();
  const cur = profileKey(state.instructorName);
  instructorSelectSuppress = true;
  sel.replaceChildren();
  const opt0 = document.createElement("option");
  opt0.value = "";
  opt0.textContent = "— Select instructor —";
  sel.appendChild(opt0);
  for (const n of names) {
    const o = document.createElement("option");
    o.value = n;
    o.textContent = n;
    sel.appendChild(o);
  }
  if (cur && names.includes(cur)) sel.value = cur;
  else sel.value = "";
  instructorSelectSuppress = false;
}

function persistSoon() {
  clearTimeout(persistSoon._t);
  persistSoon._t = setTimeout(() => {
    const snap = draftSnapshot();
    const cur = profileKey(snap.instructorName);
    rememberInstructorName(snap.instructorName);
    rememberInstructorRosterName(snap.instructorName);
    refreshInstructorProfileSelect();
    saveDraft(snap);
    if (profileSaveKey && cur === profileSaveKey) {
      saveProfile(profileSaveKey, snap);
    }
    if (cur) setLastActiveInstructor(cur);
    else if (profileSaveKey) setLastActiveInstructor(profileSaveKey);
    else setLastActiveInstructor("");
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

function applyStateToDom() {
  refreshInstructorProfileSelect();
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

  document.querySelectorAll("#aircraftChecks input[type=checkbox]").forEach((cb) => {
    const k = cb.getAttribute("data-ac");
    cb.checked = !!state.aircraft[k];
  });
  syncQualificationCheckboxesFromState();
  renderRows();
}

function bindHeader() {
  els.instructorProfileSelect.addEventListener("change", () => {
    if (instructorSelectSuppress) return;
    persistStudentsAndCourses(studentBucketKey());
    const prevKey = profileKey(state.instructorName);
    if (prevKey) saveProfile(prevKey, draftSnapshot());
    const selVal = els.instructorProfileSelect.value;
    setLastActiveInstructor(selVal);
    if (!selVal) {
      state = defaultEmptyState();
      state.instructorName = "";
      profileSaveKey = "";
    } else {
      const prof = getProfile(selVal);
      const st = prof ? normalizePayloadToState(prof) : null;
      if (st) {
        state = st;
        state.instructorName = selVal;
      } else {
        state = defaultEmptyState();
        state.instructorName = selVal;
      }
      profileSaveKey = profileKey(selVal);
    }
    const nextBucket = studentBucketKey();
    students = loadStudentsListForKey(nextBucket);
    studentCourseMap = loadCourseMapForKey(nextBucket);
    applyStateToDom();
    rememberInstructorName(state.instructorName);
    persistSoon();
  });

  els.instructorName.addEventListener("input", () => {
    state.instructorName = els.instructorName.value;
    if (!instructorSelectSuppress) {
      const v = profileKey(state.instructorName);
      const names = instructorNamesForDropdown();
      instructorSelectSuppress = true;
      if (v && names.includes(v)) els.instructorProfileSelect.value = v;
      else els.instructorProfileSelect.value = "";
      instructorSelectSuppress = false;
    }
    persistSoon();
  });

  els.instructorName.addEventListener("blur", () => {
    const prevBucket = studentBucketKey();
    persistStudentsAndCourses(prevBucket);
    profileSaveKey = profileKey(state.instructorName);
    const nextBucket = studentBucketKey();
    if (nextBucket !== prevBucket) {
      students = loadStudentsListForKey(nextBucket);
      studentCourseMap = loadCourseMapForKey(nextBucket);
      if (els.nameModal.classList.contains("open")) renderNameList();
      renderRows();
    }
    const k = profileSaveKey;
    if (k) {
      saveProfile(k, draftSnapshot());
      setLastActiveInstructor(k);
    }
    refreshInstructorProfileSelect();
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

  applyStateToDom();
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
          <label>Remarks (English: max 12 uppercase / 16 lowercase characters)</label>
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
        persistStudentsAndCourses(studentBucketKey());
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
      persistStudentsAndCourses(studentBucketKey());
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
      delete studentCourseMap[removed];
      persistStudentsAndCourses(studentBucketKey());
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
  persistStudentsAndCourses(studentBucketKey());
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

function renderInstructorProfileList() {
  if (!els.instructorProfileList) return;
  els.instructorProfileList.innerHTML = "";
  const names = listProfileNames();
  if (!names.length) {
    els.instructorProfileList.innerHTML = '<li class="hint">No saved profiles yet. Fill the form and type an instructor name — it saves automatically.</li>';
    return;
  }
  names.forEach((name) => {
    const li = document.createElement("li");
    const span = document.createElement("span");
    span.className = "student-name-cell";
    span.textContent = name;
    const del = document.createElement("button");
    del.type = "button";
    del.className = "btn-danger";
    del.textContent = "Delete";
    del.addEventListener("click", () => {
      if (!confirm(`Delete saved profile for "${name}"?`)) return;
      deleteProfile(name);
      deleteStudentsDataForInstructor(name);
      if (profileKey(state.instructorName) === name) {
        state = defaultEmptyState();
        state.instructorName = "";
        profileSaveKey = "";
        students = loadStudentsListForKey(studentBucketKey());
        studentCourseMap = loadCourseMapForKey(studentBucketKey());
        applyStateToDom();
      }
      refreshInstructorProfileSelect();
      renderInstructorProfileList();
      persistSoon();
    });
    li.appendChild(span);
    li.appendChild(del);
    els.instructorProfileList.appendChild(li);
  });
}

function renderInstructorRosterList() {
  if (!els.instructorRosterList) return;
  els.instructorRosterList.innerHTML = "";
  const names = loadInstructorRoster();
  if (!names.length) {
    els.instructorRosterList.innerHTML = '<li class="hint">No names yet.</li>';
    return;
  }
  names.forEach((name) => {
    const li = document.createElement("li");
    const span = document.createElement("span");
    span.className = "student-name-cell";
    span.textContent = name;
    const del = document.createElement("button");
    del.type = "button";
    del.className = "btn-danger";
    del.textContent = "Remove";
    del.addEventListener("click", () => {
      saveInstructorRoster(loadInstructorRoster().filter((x) => x !== name));
      renderInstructorRosterList();
      refreshInstructorProfileSelect();
    });
    li.appendChild(span);
    li.appendChild(del);
    els.instructorRosterList.appendChild(li);
  });
}

function openInstructorNameModal() {
  if (!els.instructorNameModal) return;
  renderInstructorRosterList();
  els.instructorNameModal.classList.add("open");
  els.instructorNameModal.setAttribute("aria-hidden", "false");
}

function closeInstructorNameModal() {
  if (!els.instructorNameModal) return;
  els.instructorNameModal.classList.remove("open");
  els.instructorNameModal.setAttribute("aria-hidden", "true");
}

function addInstructorRosterEntry() {
  const n = els.newInstructorRosterName?.value?.trim();
  if (!n) return;
  const cur = loadInstructorRoster();
  if (!cur.some((x) => x.toLowerCase() === n.toLowerCase())) saveInstructorRoster([...cur, n]);
  els.newInstructorRosterName.value = "";
  renderInstructorRosterList();
  refreshInstructorProfileSelect();
}

function openInstructorProfileModal() {
  if (!els.instructorProfileModal) return;
  renderInstructorProfileList();
  els.instructorProfileModal.classList.add("open");
  els.instructorProfileModal.setAttribute("aria-hidden", "false");
}

function closeInstructorProfileModal() {
  if (!els.instructorProfileModal) return;
  els.instructorProfileModal.classList.remove("open");
  els.instructorProfileModal.setAttribute("aria-hidden", "true");
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

function readAircraftFromDom() {
  const out = {};
  document.querySelectorAll("#aircraftChecks input[type=checkbox]").forEach((cb) => {
    const k = cb.getAttribute("data-ac");
    if (k) out[k] = cb.checked;
  });
  return out;
}

function exportPayload() {
  const qualifications = sanitizeQualifications(readQualificationsFromDom());
  const aircraft = readAircraftFromDom();
  return {
    exportedAt: new Date().toISOString(),
    instructorName: state.instructorName,
    requestDay: state.requestDay,
    requestDate: state.requestDate,
    aircraft,
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

async function loadCatalog() {
  const res = await fetch(assetUrl("courses.json"), { cache: "no-store" });
  if (!res.ok) throw new Error("Could not load courses.json");
  catalog = await res.json();
}

function init() {
  refreshOptionLists();
  ensureInstructorRosterSeededFromLegacy();

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

  document.getElementById("openInstructorNameModal")?.addEventListener("click", openInstructorNameModal);
  document.getElementById("closeInstructorNameModal")?.addEventListener("click", closeInstructorNameModal);
  els.instructorNameModal?.addEventListener("click", (e) => {
    if (e.target === els.instructorNameModal) closeInstructorNameModal();
  });
  document.getElementById("addInstructorRosterBtn")?.addEventListener("click", addInstructorRosterEntry);
  els.newInstructorRosterName?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addInstructorRosterEntry();
    }
  });

  document.getElementById("openInstructorProfileModal")?.addEventListener("click", openInstructorProfileModal);
  document.getElementById("closeInstructorProfileModal")?.addEventListener("click", closeInstructorProfileModal);
  els.instructorProfileModal?.addEventListener("click", (e) => {
    if (e.target === els.instructorProfileModal) closeInstructorProfileModal();
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

  document.getElementById("downloadArfPdf").addEventListener("click", async () => {
    try {
      const bytes = await resolveArfTemplateBytes();
      if (!bytes) {
        alert("Could not load Master.pdf. Put Master.pdf in the same folder as this page and open the app over HTTP (local server).");
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

}

loadCatalog()
  .then(() => {
    init();
    renderRows();
  })
  .catch((err) => {
    document.body.innerHTML = `<main class="card" style="margin:2rem"><h2>Load error</h2><p>${escapeHtml(err.message)}</p><p class="hint">Serve this folder over HTTP (required for <code>courses.json</code> and <code>Master.pdf</code>):<br><code>cd acron-arf-scheduler && python3 serve.py -p 8765</code> (avoids Safari caching stale JS)<br>Then open <code>http://127.0.0.1:8765</code> — or deploy the folder to Netlify / GitHub Pages / Cloudflare Pages.</p></main>`;
  });
