# Acron ARF — Schedule Request

Browser form that fills `Master.pdf` (Acron ARF template). Data stays on the device unless you download a PDF.

## Edit in Cursor

Open the folder `/Users/hw/acron-arf-scheduler` (or your clone path) in Cursor. After changes, commit and push so GitHub Pages updates.

## Local preview

Serve this directory over HTTP (Safari needs HTTP for `fetch`). Prefer **`serve.py`** so Safari’s normal window does not keep stale `app.js` / `styles.css` (Private Browsing often looks “updated” because it starts with an empty cache):

```bash
cd /path/to/acron-arf-scheduler
python3 serve.py -p 8080
```

Open `http://127.0.0.1:8080/` in Safari. (`python3 -m http.server` works but caches aggressively.)

After you deploy to **GitHub Pages**, bump the `?v=` query on `styles.css` and `app.js` in `index.html` when you want every visitor to pull new assets without waiting on CDN cache.

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
# Acron-arf-scheduler
