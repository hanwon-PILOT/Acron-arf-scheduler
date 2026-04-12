# Acron ARF — Schedule Request

Browser form that fills `Master.pdf` (Acron ARF template). Data stays on the device unless you download a PDF.

## Edit in Cursor

Open the folder `/Users/hw/acron-arf-scheduler` (or your clone path) in Cursor. After changes, commit and push so GitHub Pages updates.

## Local preview

Serve this directory over HTTP (Safari needs HTTP for `fetch`):

```bash
cd /path/to/acron-arf-scheduler
python3 -m http.server 8080
```

Open `http://127.0.0.1:8080/` in Safari.

## GitHub Pages

1. **Create the git repo** (once). If `git init` fails inside Cursor, run in Terminal:

   ```bash
   bash scripts/bootstrap-repo.sh
   ```

2. On GitHub: **New repository** → copy the HTTPS URL.

3. **Push:**

   ```bash
   git remote add origin https://github.com/<you>/<repo>.git
   git push -u origin main
   ```

4. **Enable Pages:** Repository **Settings → Pages → Build and deployment → Deploy from a branch** → Branch **main**, folder **/ (root)** → Save.

5. After a minute or two, open the site URL shown on the Pages settings page in Safari. `app.js` loads `Master.pdf` and `courses.json` using paths relative to the script, so it works for both `https://<user>.github.io/<repo>/` and root sites.

## Optional CLI

`fill_arf_pdf.py` fills the same template from JSON; not required for the web app.
