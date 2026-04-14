#!/usr/bin/env python3
"""
Web app JSON → Acron ARF Master.pdf. Clears all fields, then fills only provided values.

  python3 fill_arf_pdf.py --template Master.pdf --data export.json --output filled.pdf
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

try:
    import fitz
except ImportError:
    print("Requires PyMuPDF: pip install pymupdf", file=sys.stderr)
    sys.exit(1)

AIRCRAFT_CHECK = {
    "PA-28": "Check Box3_1_1",
    "SR-20": "Check Box4_1_1",
    "C-172": "Check Box5_1_1",
    "C-172SP": "Check Box6_1_1",
    "PA-44": "Check Box7_1_1",
}

AIRCRAFT_CHECK_V2 = {
    "PA-28": "Check Box3_1_1_1",
    "SR-20": "Check Box4_1_1_1",
    "C-172": "Check Box5_1_1_1",
    "C-172SP": "Check Box6_1_1_1",
    "PA-44": "Check Box7_1_1_1",
}

AIRCRAFT_CHECK_2025 = {
    "PA-28": "Check Box3",
    "SR-20": "Check Box4",
    "C-172": "Check Box5",
    "C-172SP": "Check Box6",
    "PA-44": "Check Box7",
}

AIRCRAFT_CHECK_CLEAN_LEGACY = {
    "PA-28": "Check Box2_1",
    "SR-20": "Check Box3_1",
    "C-172": "Check Box4_1",
    "C-172SP": "Check Box5_1",
    "PA-44": "Check Box5_2",
}

AIRCRAFT_CHECK_CLEAN = {
    "PA-28": "Check Box2_1_1",
    "SR-20": "Check Box3_1_1",
    "C-172": "Check Box4_1_1",
    "C-172SP": "Check Box5_1_1",
    "PA-44": "Check Box5_2_1",
}

AIRCRAFT_CHECK_CLEAN_OPT = {
    "PA-28": "A 1",
    "SR-20": "A 2",
    "C-172": "A 3",
    "C-172SP": "A 4",
    "PA-44": "A 5",
}


def detect_layout(m: dict[str, list]) -> str:
    """v1 legacy; v2025; vclean (*_1_1 row fields); vclean_opt (IQ/A/B/D checkboxes); vclean_old (*_1); v2/v3 new masters."""
    if m.get("NAME_1_1_1"):
        if m.get("Equipment 2_1#1") or m.get("Equipment 1_1"):
            return "v2"
        return "v3"
    if m.get("Course 1_1_1"):
        if m.get("NAME_1_1"):
            return "vclean"
        if m.get("IQ 1"):
            return "vclean_opt"
        return "vclean"
    if m.get("NAME_1"):
        return "vclean_old"
    if m.get("NAME"):
        return "v2025"
    return "v1"


def layout_new_master(layout: str) -> bool:
    return layout in ("v2", "v3")


def course_field_name(layout: str, row_index: int) -> str:
    if layout == "v2025":
        return f"Course {row_index}"
    if layout in ("vclean", "vclean_opt"):
        if row_index == 1:
            return "Course 1_1_1"
        if row_index == 2:
            return "Course 2_2_1"
        if row_index == 10:
            return "Course 10_1_1"
        return f"Course {row_index}_1_1"
    if layout == "vclean_old":
        if row_index == 1:
            return "Course 1_1"
        if row_index == 2:
            return "Course 2_2"
        if row_index == 10:
            return "Course 10_1"
        return f"Course {row_index}_1"
    if row_index == 1:
        return "Course 1"
    if row_index == 2:
        return "Course 2"
    if layout_new_master(layout):
        if row_index == 10:
            return "Course 10_1_1_1"
        return f"Course {row_index}_1_1_1"
    if row_index == 10:
        return "Course 10_1_1"
    return f"Course {row_index}_1_1"


def block_field_name(layout: str, row_index: int) -> str | None:
    if layout in ("vclean", "vclean_opt"):
        return f"BLOCK {row_index}_1_1"
    if layout == "vclean_old":
        return f"BLOCK {row_index}_1"
    if layout == "v2025":
        if row_index == 10:
            return None
        return f"BLOCK {row_index}"
    if layout == "v3":
        if row_index == 10:
            return None
        if row_index == 9:
            return "BLOCK 9"
        if row_index <= 8:
            return f"BLOCK {row_index}_1_1_1_1"
        return None
    if layout == "v2":
        if row_index == 10:
            return None
        if row_index == 9:
            return "BLOCK 9"
        return f"BLOCK {row_index}_1_1_1"
    if row_index == 9:
        return "BLOCK 9"
    return f"BLOCK {row_index}_1_1"


def time_field_name(layout: str, row_index: int) -> str | None:
    if layout == "v2025":
        return f"TIME {row_index}"
    if layout in ("vclean", "vclean_opt"):
        return f"TIME {row_index}_1_1"
    if layout == "vclean_old":
        return f"TIME {row_index}_1"
    if layout in ("v2", "v3"):
        return f"TIME {row_index}_1_1_1"
    return None


def equipment_field_names(layout: str, row_index: int) -> list[str]:
    if layout == "v2025":
        return [f"Equipment {row_index}"]
    if layout in ("vclean", "vclean_opt"):
        return [f"Equipment {row_index}_1_1"]
    if layout == "vclean_old":
        return [f"Equipment {row_index}_1"]
    if layout == "v3":
        return []
    if row_index == 1:
        return ["Equipment 1_1", "Equipment 1_1#1"]
    if 2 <= row_index <= 9:
        return [f"Equipment {row_index}_1#1"]
    return []


def equipment_text_field_names(layout: str, row_index: int) -> list[str]:
    """Acrobat 'equipment' column as plain text (same suffix pattern as TIME/LESSON)."""
    if layout in ("v2025", "vclean", "vclean_opt", "vclean_old", "v3"):
        return []
    if layout == "v2":
        base = f"Equipment {row_index}_1_1_1"
        if row_index == 1:
            return [base, f"{base}#1"]
        return [base]
    if row_index == 1:
        return ["Equipment 1_1", "Equipment 1_1#1"]
    if 2 <= row_index <= 9:
        return [f"Equipment {row_index}_1#1"]
    return []


def equipment_display_text(layout: str, idx: int, block: str, eq: str) -> str:
    if layout in ("v2", "v3") and idx == 10:
        return " · ".join(p for p in (str(block).strip(), str(eq).strip()) if p)
    return str(eq).strip()


def student_field(layout: str, idx: int) -> str:
    if layout == "v2025":
        return f"STUDENT {idx}"
    if layout in ("vclean", "vclean_opt"):
        return f"STUDENT {idx}_1_1"
    if layout == "vclean_old":
        return f"STUDENT {idx}_1"
    return f"STUDENT {idx}_1_1_1" if layout_new_master(layout) else f"STUDENT {idx}_1_1"


def id_field(layout: str, idx: int) -> str:
    if layout == "v2025":
        return f"ID {idx}"
    if layout in ("vclean", "vclean_opt"):
        return f"ID {idx}_1_1"
    if layout == "vclean_old":
        return f"ID {idx}_1"
    return f"ID {idx}_1_1_1" if layout_new_master(layout) else f"ID {idx}_1_1"


def lesson_field(layout: str, idx: int) -> str:
    if layout == "v2025":
        return f"LESSON {idx}"
    if layout in ("vclean", "vclean_opt"):
        return f"LESSON {idx}_1_1"
    if layout == "vclean_old":
        return f"LESSON {idx}_1"
    return f"LESSON {idx}_1_1_1" if layout_new_master(layout) else f"LESSON {idx}_1_1"


def remarks_field(layout: str, idx: int) -> str:
    if layout == "v2025":
        return f"REMARKSRow{idx}"
    if layout in ("vclean", "vclean_opt"):
        return f"REMARKSRow{idx}_1_1"
    if layout == "vclean_old":
        return f"REMARKSRow{idx}_1"
    return f"REMARKSRow{idx}_1_1_1" if layout_new_master(layout) else f"REMARKSRow{idx}_1_1"


def type_field(layout: str, idx: int) -> str:
    if layout == "v2025":
        return f"Type {idx}"
    if layout in ("vclean", "vclean_opt"):
        return f"Type {idx}_1_1"
    if layout == "vclean_old":
        return f"Type {idx}_1"
    return f"Type {idx}_1_1_1" if layout_new_master(layout) else f"Type {idx}_1_1"


def last_lesson_field(layout: str, idx: int) -> str:
    if layout == "v2025":
        return f"Text{6 + idx}"
    if layout in ("vclean", "vclean_opt"):
        return f"Text{6 + idx}_1_1"
    if layout == "vclean_old":
        return f"Text{6 + idx}_1"
    return f"Text{6 + idx}_1_1_1" if layout_new_master(layout) else f"Text{6 + idx}_1_1"


def cadet_dropdown(layout: str, idx: int) -> str:
    if layout == "v2025":
        return f"Dropdown{idx}"
    if layout in ("vclean", "vclean_opt", "vclean_old"):
        return ""
    if layout == "v3":
        return f"Text{idx}"
    if layout == "v2":
        if idx == 1:
            return "Dropdown1_1_1"
        if idx == 2:
            return "Dropdown2_1_1"
        if idx == 10:
            return "Dropdown10_1_1"
        return ""
    if idx == 1:
        return "Dropdown1_1_1"
    if idx == 2:
        return "Dropdown2_1_1"
    if idx == 10:
        return "Dropdown10_1_1"
    return f"Dropdown{idx}"


def day_night_dropdown(layout: str, idx: int) -> str:
    if layout == "v2025":
        return f"Dropdown{10 + idx}"
    if layout in ("vclean", "vclean_opt", "vclean_old"):
        return ""
    if layout == "v3":
        return f"Dropdown{10 + idx}" if idx <= 8 else ""
    if idx <= 8:
        return f"Dropdown{10 + idx}"
    return "Dropdown19_1_1" if idx == 9 else "Dropdown20_1_1"


def day_night_text_field(layout: str, idx: int) -> str | None:
    """Clean masters: no Dropdown for row D/N — use TIME text column."""
    if layout in ("vclean", "vclean_opt"):
        return f"TIME {idx}_1_1"
    if layout == "vclean_old":
        return f"TIME {idx}_1"
    return None


def cadet_last_lesson_text_field(layout: str, idx: int) -> str | None:
    """Clean masters: last-lesson date only in Text(6+idx); cadet goes to ID column (fill_pdf)."""
    if layout in ("vclean", "vclean_opt"):
        return f"Text{6 + idx}_1_1"
    if layout == "vclean_old":
        return f"Text{6 + idx}_1"
    return None


def format_date_us(value: str) -> str:
    s = str(value).strip()
    parts = s.split("-")
    if len(parts) == 3 and len(parts[0]) == 4 and parts[0].isdigit():
        y, m, d = parts
        return f"{int(m):02d}/{int(d):02d}/{y}"
    return s


def format_month_day(value: str) -> str:
    s = str(value).strip()
    parts = s.split("-")
    if len(parts) == 3 and parts[1].isdigit() and parts[2].isdigit():
        return f"{int(parts[1])}/{int(parts[2])}"
    return s


def lesson_text_for_pdf(lesson_code: str) -> str:
    """AATD/FTD-style → n+TD (e.g. 15TD). UPRT → n+DL. Else hyphens removed."""
    raw = str(lesson_code or "").strip()
    if not raw:
        return ""
    m = re.match(r"^(\d+[a-z]?)\s*[-–]", raw, re.I)
    num = m.group(1) if m else ""
    if re.search(r"UPRT", raw, re.I):
        return f"{num}DL" if num else "DL"
    is_aatd = bool(
        re.search(r"-TD\s*$", raw, re.I)
        or re.search(r"AA\s*TD|AATD|TD\s*/\s*FTD|\bDFT\b", raw, re.I)
    )
    if is_aatd and num:
        return f"{num}TD"
    return re.sub(r"-", "", raw).strip()


def type_from_lesson_code(lesson_code: str) -> str:
    """PDF Type from lesson code; unknown → empty string (user chooses). Mirrors pdf-export.js."""
    raw = str(lesson_code or "").strip()
    if not raw:
        return ""

    if re.search(r"\bUPRT\b", raw, re.I):
        return "D"

    if re.search(r"-GB\b", raw, re.I):
        return "Ground"

    is_sim = bool(
        re.search(r"-TD\s*$", raw, re.I)
        or re.search(r"AA\s*TD|AATD|TD\s*/\s*FTD|\bDFT\b", raw, re.I)
    )
    if is_sim:
        return "DSIM"

    if re.search(r"-DXCN\b", raw, re.I) or re.search(r"-DXC\b", raw, re.I):
        return "D"
    if re.search(r"-DSL\b", raw, re.I):
        return "D"
    if re.search(r"-DLN\b", raw, re.I):
        return "D"
    if re.search(r"-DL\b", raw, re.I):
        return "D"

    if re.search(r"-SLN\b", raw, re.I):
        return "Solo"
    if re.search(r"-SXC\b", raw, re.I):
        return "SoloXC"

    return ""


def choice_key(c) -> str:
    if isinstance(c, (tuple, list)):
        return str(c[0]).strip()
    return str(c).strip()


def set_checkbox_state(w: fitz.Widget, on: bool) -> None:
    states = (w.button_states() or {}).get("normal") or []
    off_candidates = {"Off", "No"}
    if not on:
        for s in states:
            if s in off_candidates:
                w.field_value = s
                w.update()
                return
        if states:
            w.field_value = states[0]
        w.update()
        return
    for s in states:
        if s not in off_candidates:
            w.field_value = s
            w.update()
            return
    w.field_value = "Yes"
    w.update()


def clear_widget(w: fitz.Widget) -> None:
    if not w.field_name:
        return
    t = w.field_type
    if t == fitz.PDF_WIDGET_TYPE_CHECKBOX:
        set_checkbox_state(w, False)
    elif t in (fitz.PDF_WIDGET_TYPE_COMBOBOX, fitz.PDF_WIDGET_TYPE_LISTBOX):
        vals = list(w.choice_values or [])
        pick = None
        for v in vals:
            if choice_key(v) == "" or v == " ":
                pick = v
                break
        if pick is None and vals:
            pick = vals[0]
        if pick is not None:
            w.field_value = pick
        else:
            w.field_value = ""
        w.update()
    else:
        w.field_value = ""
        w.update()


def clear_all_page_widgets(page: fitz.Page) -> None:
    for w in page.widgets() or []:
        try:
            clear_widget(w)
        except Exception:
            pass


def widgets_by_name(page: fitz.Page) -> dict[str, list[fitz.Widget]]:
    m: dict[str, list[fitz.Widget]] = {}
    for w in page.widgets() or []:
        if w.field_name:
            m.setdefault(w.field_name, []).append(w)
    return m


def set_text_all(m: dict[str, list[fitz.Widget]], name: str, value: str) -> None:
    s = str(value).strip()
    if not s:
        return
    for w in m.get(name, []):
        if w.field_type == fitz.PDF_WIDGET_TYPE_TEXT:
            w.field_value = s
            w.update()


def set_text_field_value_all(m: dict[str, list[fitz.Widget]], name: str, value: str) -> bool:
    """Write text widgets including empty string. Returns True if any text widget was updated."""
    did = False
    for w in m.get(name, []):
        if w.field_type != fitz.PDF_WIDGET_TYPE_TEXT:
            continue
        w.field_value = str(value)
        w.update()
        did = True
    return did


def match_choice(user_val: str, choices: list):
    u = user_val.strip()
    if not u:
        return None
    u_up = u.upper()
    u_nospace = re.sub(r"\s+", "", u).upper()
    for c in choices:
        ck = choice_key(c)
        if ck == u or ck.upper() == u_up or ck.strip() == u:
            return c
    for c in choices:
        ck = choice_key(c)
        if ck.strip().upper() == u_up:
            return c
    for c in choices:
        ck = choice_key(c)
        ck_ns = re.sub(r"\s+", "", ck).upper()
        if ck_ns == u_nospace:
            return c
    return None


def match_group_manager_choice(user_val: str, choices: list):
    m = match_choice(user_val, choices)
    if m is not None:
        return m
    u = user_val.strip()
    stripped = re.sub(r"^\s*V\s+", "", u, count=1, flags=re.I).strip()
    if stripped and stripped != u:
        return match_choice(stripped, choices)
    return None


def match_equipment_choice(user_val: str, choices: list):
    m = match_choice(user_val, choices)
    if m is not None:
        return m
    u = re.sub(r"\s+", "", user_val.strip().upper())
    if u in ("GROUND", "GND", "GRND"):
        return match_choice("GW", choices)
    return None


def set_equipment_combo_all(m: dict[str, list[fitz.Widget]], name: str, value: str) -> None:
    u = str(value).strip()
    if not u:
        return
    for w in m.get(name, []):
        if w.field_type not in (fitz.PDF_WIDGET_TYPE_COMBOBOX, fitz.PDF_WIDGET_TYPE_LISTBOX):
            continue
        choices = list(w.choice_values or [])
        pick = match_equipment_choice(u, choices)
        if pick is None:
            if w.field_type in (fitz.PDF_WIDGET_TYPE_COMBOBOX, fitz.PDF_WIDGET_TYPE_LISTBOX):
                w.field_value = u
                w.update()
            continue
        assign_combo_value(w, pick)


def set_combo_group_manager_all(m: dict[str, list[fitz.Widget]], name: str, value: str) -> None:
    u = str(value).strip()
    if not u:
        return
    for w in m.get(name, []):
        if w.field_type not in (fitz.PDF_WIDGET_TYPE_COMBOBOX, fitz.PDF_WIDGET_TYPE_LISTBOX):
            continue
        choices = list(w.choice_values or [])
        pick = match_group_manager_choice(u, choices)
        if pick is None:
            if w.field_type in (fitz.PDF_WIDGET_TYPE_COMBOBOX, fitz.PDF_WIDGET_TYPE_LISTBOX):
                w.field_value = u
                w.update()
            continue
        assign_combo_value(w, pick)


def assign_combo_value(w: fitz.Widget, pick) -> None:
    if isinstance(pick, (tuple, list)):
        w.field_value = pick[0]
    else:
        w.field_value = pick
    w.update()


def set_combo_all(m: dict[str, list[fitz.Widget]], name: str, value: str) -> None:
    u = str(value).strip()
    if not u:
        return
    for w in m.get(name, []):
        if w.field_type not in (fitz.PDF_WIDGET_TYPE_COMBOBOX, fitz.PDF_WIDGET_TYPE_LISTBOX):
            continue
        choices = list(w.choice_values or [])
        pick = match_choice(u, choices)
        if pick is None:
            # Editable combo / list export value / near-miss
            if w.field_type in (fitz.PDF_WIDGET_TYPE_COMBOBOX, fitz.PDF_WIDGET_TYPE_LISTBOX):
                w.field_value = u
                w.update()
            continue
        assign_combo_value(w, pick)


def set_combo_empty_all(m: dict[str, list[fitz.Widget]], name: str) -> None:
    for w in m.get(name, []):
        if w.field_type not in (fitz.PDF_WIDGET_TYPE_COMBOBOX, fitz.PDF_WIDGET_TYPE_LISTBOX):
            continue
        choices = list(w.choice_values or [])
        pick = None
        for c in choices:
            if choice_key(c) == "" or c == " ":
                pick = c
                break
        if pick is None and choices:
            pick = choices[0]
        if pick is not None:
            assign_combo_value(w, pick)


def sanitize_qualifications(raw) -> dict:
    """Only known keys; bool coercion. Ignores stray keys from old JSON."""
    instructor = {"CFI": False, "CFII": False, "MEI": False, "SPIN": False}
    additional = {"cfiA141": False, "cfiI141": False, "mei141": False}
    uk = {"FI": False, "IRI": False, "CRI": False}
    if not raw or not isinstance(raw, dict):
        return {"instructor": instructor.copy(), "additionalCourse": additional.copy(), "ukEasa": uk.copy()}
    ins_src = raw.get("instructor") or {}
    add_src = raw.get("additionalCourse") or {}
    uk_src = raw.get("ukEasa") or {}
    return {
        "instructor": {k: bool(ins_src.get(k)) for k in instructor},
        "additionalCourse": {k: bool(add_src.get(k)) for k in additional},
        "ukEasa": {k: bool(uk_src.get(k)) for k in uk},
    }


def set_aircraft(m: dict[str, list[fitz.Widget]], aircraft: dict, layout: str) -> None:
    if layout == "v2025":
        mapping = AIRCRAFT_CHECK_2025
    elif layout == "vclean_opt":
        mapping = AIRCRAFT_CHECK_CLEAN_OPT
    elif layout == "vclean":
        mapping = AIRCRAFT_CHECK_CLEAN
    elif layout == "vclean_old":
        mapping = AIRCRAFT_CHECK_CLEAN_LEGACY
    elif layout_new_master(layout):
        mapping = AIRCRAFT_CHECK_V2
    else:
        mapping = AIRCRAFT_CHECK
    for key, fname in mapping.items():
        for w in m.get(fname, []):
            if w.field_type == fitz.PDF_WIDGET_TYPE_CHECKBOX:
                set_checkbox_state(w, bool(aircraft.get(key)))


def set_checkboxes_qualifications(m: dict[str, list[fitz.Widget]], q: dict, layout: str) -> None:
    if layout == "v2025":
        ins_fields = [
            ("CFI", "Q 1"),
            ("CFII", "Q 2"),
            ("MEI", "Q 3"),
            ("SPIN", "Check Box1"),
        ]
        add_fields = [
            ("cfiA141", "A 1"),
            ("cfiI141", "A 2"),
            ("mei141", "A 3"),
        ]
        uk_fields = [("FI", "A 0"), ("IRI", "A 4")]
    elif layout == "vclean":
        ins_fields = [
            ("CFI", "Q 1_1_1"),
            ("CFII", "Q 1_2_1"),
            ("MEI", "Q 1_3_1"),
            ("SPIN", "Q 1_4_1"),
        ]
        add_fields = [
            ("cfiA141", "A 1_1_1"),
            ("cfiI141", "A 2_1_1"),
            ("mei141", "A 3_1_1"),
        ]
        uk_fields = [("FI", "A 4_1_1"), ("IRI", "A 5_1_1")]
    elif layout == "vclean_opt":
        ins_fields = [
            ("CFI", "IQ 1"),
            ("CFII", "IQ 2"),
            ("MEI", "IQ 3"),
            ("SPIN", "IQ 4"),
        ]
        add_fields = [
            ("cfiA141", "B 1"),
            ("cfiI141", "B 2"),
            ("mei141", "C 3"),
        ]
        uk_fields = [("FI", "D 1"), ("IRI", "D 2"), ("CRI", "D 3")]
    elif layout == "vclean_old":
        ins_fields = [
            ("CFI", "Q 1_1"),
            ("CFII", "Q 1_2"),
            ("MEI", "Q 1_3"),
            ("SPIN", "Q 1_4"),
        ]
        add_fields = [
            ("cfiA141", "A 1_1"),
            ("cfiI141", "A 2_1"),
            ("mei141", "A 3_1"),
        ]
        uk_fields = [("FI", "A 4_1"), ("IRI", "A 5_1")]
    elif layout_new_master(layout):
        ins_fields = [
            ("CFI", "Q 1_1_1_1"),
            ("CFII", "Q 2_1_1_1"),
            ("MEI", "Q 3_1_1_1"),
            ("SPIN", "Check Box1_1_1_1"),
        ]
        add_fields = [
            ("cfiA141", "A 1_1_1_1"),
            ("cfiI141", "A 2_1_1_1"),
            ("mei141", "A 3_1_1_1"),
        ]
        uk_fields = [("FI", "A 4_1_1_1"), ("IRI", "A 0_1_1_1")]
    else:
        ins_fields = [
            ("CFI", "Q 1_1_1"),
            ("CFII", "Q 2_1_1"),
            ("MEI", "Q 3_1_1"),
            ("SPIN", "Check Box1_1_1"),
        ]
        add_fields = [
            ("cfiA141", "A 1_1_1"),
            ("cfiI141", "A 2_1_1"),
            ("mei141", "A 3_1_1"),
        ]
        uk_fields = [("FI", "A 4_1_1"), ("IRI", "A 0_1_1")]

    ins = q.get("instructor") or {}
    for key, fname in ins_fields:
        for w in m.get(fname, []):
            if w.field_type == fitz.PDF_WIDGET_TYPE_CHECKBOX:
                set_checkbox_state(w, bool(ins.get(key)))

    add = q.get("additionalCourse") or {}
    for key, fname in add_fields:
        for w in m.get(fname, []):
            if w.field_type == fitz.PDF_WIDGET_TYPE_CHECKBOX:
                set_checkbox_state(w, bool(add.get(key)))

    uk = q.get("ukEasa") or {}
    for key, fname in uk_fields:
        for w in m.get(fname, []):
            if w.field_type == fitz.PDF_WIDGET_TYPE_CHECKBOX:
                set_checkbox_state(w, bool(uk.get(key)))


def build_notes_with_qualifiers(data: dict, q_qual: dict) -> str:
    base = str(data.get("notesScheduling", "")).strip()
    tags = []
    uk = q_qual.get("ukEasa") or {}
    if uk.get("CRI"):
        tags.append("UK/EASA: CRI")
    if not tags:
        return base
    prefix = " | ".join(tags)
    return f"{prefix}\n{base}" if base else prefix


def fill_pdf(template: Path, data: dict, output: Path) -> None:
    data = dict(data)
    q_qual = sanitize_qualifications(data.get("qualifications"))
    data["qualifications"] = q_qual

    doc = fitz.open(template)
    page = doc[0]
    clear_all_page_widgets(page)
    m = widgets_by_name(page)
    layout = detect_layout(m)

    if layout == "v2025":
        name_f = "NAME"
        day_f = "Day"
        date_f = "DATE"
        notes_f = "NOTES TO SCHEDULING"
        gm_f = "GROUP MANAGER"
    elif layout == "vclean":
        name_f = "NAME_1_1"
        day_f = "Day_1_1"
        date_f = "DATE_1_1"
        notes_f = "NOTES TO SCHEDULING_1_1"
        gm_f = "GROUP MANAGER_1_1"
    elif layout == "vclean_opt":
        name_f = "NAME"
        day_f = "Day"
        date_f = "DATE"
        notes_f = "NOTES TO SCHEDULING_1_1"
        gm_f = "GROUP MANAGER_1_1"
    elif layout == "vclean_old":
        name_f = "NAME_1"
        day_f = "Day_1"
        date_f = "DATE_1"
        notes_f = "NOTES TO SCHEDULING_1"
        gm_f = "GROUP MANAGER_1"
    else:
        name_f = "NAME_1_1_1" if layout_new_master(layout) else "NAME_1_1"
        day_f = "Day_1_1_1" if layout_new_master(layout) else "Day_1_1"
        date_f = "DATE_1_1_1" if layout_new_master(layout) else "DATE_1_1"
        notes_f = "NOTES TO SCHEDULING_1_1_1" if layout_new_master(layout) else "NOTES TO SCHEDULING_1_1"
        gm_f = "GROUP MANAGER_1_1_1" if layout_new_master(layout) else "GROUP MANAGER_1_1"

    if str(data.get("instructorName", "")).strip():
        set_text_all(m, name_f, str(data["instructorName"]))

    day = str(data.get("requestDay", "")).strip().upper()
    if day:
        set_combo_all(m, day_f, day)

    rd = str(data.get("requestDate", "")).strip()
    if rd:
        set_text_all(m, date_f, format_date_us(rd))

    set_aircraft(m, data.get("aircraft") or {}, layout)
    set_checkboxes_qualifications(m, q_qual, layout)

    notes = build_notes_with_qualifiers(data, q_qual)
    if notes:
        set_text_all(m, notes_f, notes)

    gm = str(data.get("groupManager", "")).strip()
    if gm:
        set_combo_group_manager_all(m, gm_f, gm)

    rows = data.get("rows") or []
    for idx in range(1, 11):
        row = rows[idx - 1] if idx - 1 < len(rows) else {}
        if not isinstance(row, dict):
            row = {}

        if str(row.get("student", "")).strip():
            set_text_all(m, student_field(layout, idx), str(row["student"]))
        id_cell = str(row.get("cadetStatus") or row.get("studentId", "") or "").strip()
        if layout in ("vclean", "vclean_opt", "vclean_old") and id_cell:
            set_text_all(m, id_field(layout, idx), id_cell)
        elif str(row.get("studentId", "")).strip():
            set_text_all(m, id_field(layout, idx), str(row["studentId"]))

        course_code = str(row.get("courseShortCode") or row.get("courseCode") or "").strip()
        if course_code in ("CASEL1", "CASEL2", "CASEL3"):
            course_code = "CASEL"
        if course_code == "CFI":
            course_code = "CFI-A"
        if course_code:
            set_combo_all(m, course_field_name(layout, idx), course_code)

        lc = str(row.get("lessonCode") or "").strip()
        lesson = lesson_text_for_pdf(lc) if lc else lesson_text_for_pdf(str(row.get("lessonPdfCode") or "").strip())
        if not lesson:
            lesson = str(row.get("lessonPdfCode") or "").replace("-", "").strip()
        if lesson:
            set_text_all(m, lesson_field(layout, idx), lesson)

        block = str(row.get("block", "")).strip()
        bf = block_field_name(layout, idx)
        if block and bf:
            set_text_all(m, bf, block)

        type_val = str(row.get("type") or "").strip() or type_from_lesson_code(lc)
        if type_val:
            set_combo_all(m, type_field(layout, idx), type_val)

        if str(row.get("remarks", "")).strip():
            set_text_all(m, remarks_field(layout, idx), str(row["remarks"]))

        cadet = str(row.get("cadetStatus", "")).strip()
        dn = str(row.get("dayNight", "")).strip()
        ll = str(row.get("lastLessonDate", "")).strip()

        dnt = day_night_text_field(layout, idx)
        clt = cadet_last_lesson_text_field(layout, idx)
        if dnt is not None:
            if dn:
                set_text_all(m, dnt, dn)
        elif dn:
            ddn = day_night_dropdown(layout, idx)
            if ddn:
                set_combo_all(m, ddn, dn)

        if clt is not None:
            if layout in ("vclean", "vclean_opt", "vclean_old"):
                if ll:
                    set_text_all(m, clt, format_month_day(ll))
            else:
                parts: list[str] = []
                if cadet:
                    parts.append(cadet)
                if ll:
                    parts.append(format_month_day(ll))
                if parts:
                    set_text_all(m, clt, " · ".join(parts))
        else:
            if cadet:
                cdn = cadet_dropdown(layout, idx)
                if cdn:
                    if layout == "v3":
                        set_text_all(m, cdn, cadet)
                    else:
                        set_combo_all(m, cdn, cadet)
            if ll:
                set_text_all(m, last_lesson_field(layout, idx), format_month_day(ll))

        eq = str(row.get("equipment", "")).strip()
        disp = equipment_display_text(layout, idx, block, eq)
        eq_names = equipment_field_names(layout, idx)

        for ename in eq_names:
            if eq:
                set_equipment_combo_all(m, ename, eq)
            else:
                set_combo_empty_all(m, ename)

        for ename in equipment_text_field_names(layout, idx):
            ws = m.get(ename, [])
            if not any(w.field_type == fitz.PDF_WIDGET_TYPE_TEXT for w in ws):
                continue
            set_text_field_value_all(m, ename, disp)

        tf = time_field_name(layout, idx)
        if tf:
            if layout in ("v2", "v3") and idx == 10:
                if disp:
                    set_text_all(m, tf, disp)
                else:
                    set_text_field_value_all(m, tf, "")
            elif not eq_names:
                if disp:
                    set_text_all(m, tf, disp)
                else:
                    set_text_field_value_all(m, tf, "")

    doc.save(output, incremental=False)
    doc.close()


def main() -> None:
    ap = argparse.ArgumentParser(description="Fill Acron ARF PDF from JSON")
    ap.add_argument("--template", required=True, type=Path)
    ap.add_argument("--data", required=True, type=Path)
    ap.add_argument("--output", required=True, type=Path)
    args = ap.parse_args()
    payload = json.loads(args.data.read_text(encoding="utf-8"))
    fill_pdf(args.template, payload, args.output)
    print("Saved:", args.output)


if __name__ == "__main__":
    main()
