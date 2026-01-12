from flask import Flask, send_file, jsonify, request, make_response
from flask_cors import CORS
import uuid
import time
import shutil
from pathlib import Path

app = Flask(__name__)

# CORS: esponiamo anche gli header custom, così il front può leggere X-Model-Id
CORS(
    app,
    resources={r"/*": {"origins": "*"}},
    methods=["GET", "POST", "OPTIONS", "PUT", "DELETE"],
    allow_headers="*",
    expose_headers=["X-Model-Id"]
)

# --- Config "giocattolo" ---
BASE_DIR   = Path(__file__).parent.resolve()
MODEL_PATH = BASE_DIR / "models" / "super_mario_bros_coin.glb"  # il GLB finto
TEMP_DIR   = BASE_DIR / "temp_assets"                           # dove "salviamo" i modelli

# --- PRESET FILES ---
PRESET_DIR = BASE_DIR / "preset_files"                          # cartella preset (GLB/GLTF)

def _safe_filename(name: str) -> bool:
    # evita path traversal
    if ".." in name:
        return False
    if "/" in name or "\\" in name:
        return False
    return True

@app.route("/generate", methods=["POST", "OPTIONS"])
def generate_glb():
    """Simula la generazione:
       - crea un nuovo uid
       - copia il GLB sorgente in temp_assets/<uid>_out/0/mesh.glb
       - risponde col file e con l'header X-Model-Id
    """
    if request.method == "OPTIONS":
        return "", 204

    # Simula tempo di generazione
    time.sleep(2)

    if not MODEL_PATH.exists():
        return jsonify({"error": "Il modello non esiste nella cartella models."}), 404

    uid = uuid.uuid4().hex

    out_dir = TEMP_DIR / f"{uid}_out" / "0"
    out_dir.mkdir(parents=True, exist_ok=True)

    saved_glb = out_dir / "mesh.glb"
    shutil.copyfile(MODEL_PATH, saved_glb)

    resp = make_response(send_file(
        saved_glb,
        mimetype="model/gltf-binary",
        as_attachment=True,
        download_name="model.glb"
    ))
    resp.headers["X-Model-Id"] = uid
    return resp


@app.route("/models/<model_id>", methods=["GET"])
def get_saved_model(model_id: str):
    """Ritorna il modello salvato cercandolo in temp_assets/<id>_out/**/mesh*.glb"""
    candidates = [
        * (TEMP_DIR / f"{model_id}_out").glob("**/mesh.glb"),
        * (TEMP_DIR / f"{model_id}_out").glob("**/mesh_rigged.glb"),
        * (TEMP_DIR / f"{model_id}_out").glob("**/mesh_rigged*.glb"),
    ]

    if not candidates:
        return jsonify({"error": "Modello non trovato"}), 404

    path = candidates[0]
    return send_file(path, mimetype="model/gltf-binary")


# -------------------------
# PRESETS (da preset_files/)
# -------------------------

@app.route("/presets", methods=["GET"])
def list_presets():
    """
    Lista preset in preset_files/.
    Ritorna: [{ id: "<filename>", name: "<stem>", ts: <mtime_ms> }, ...]
    """
    if not PRESET_DIR.exists():
        return jsonify([]), 200

    items = []
    for p in sorted(PRESET_DIR.glob("*")):
        if not p.is_file():
            continue
        if p.suffix.lower() not in [".glb", ".gltf"]:
            continue

        try:
            st = p.stat()
            ts_ms = int(st.st_mtime * 1000)
        except Exception:
            ts_ms = None

        items.append({
            "id": p.name,
            "name": p.stem,
            "ts": ts_ms
        })

    return jsonify(items), 200


@app.route("/presets/<preset_id>", methods=["GET"])
def get_preset(preset_id: str):
    """Ritorna il preset da preset_files/<preset_id>"""
    if not _safe_filename(preset_id):
        return jsonify({"error": "Nome preset non valido"}), 400

    path = PRESET_DIR / preset_id
    if not path.exists() or not path.is_file():
        return jsonify({"error": "Preset non trovato"}), 404

    if path.suffix.lower() == ".glb":
        mime = "model/gltf-binary"
    elif path.suffix.lower() == ".gltf":
        mime = "model/gltf+json"
    else:
        mime = "application/octet-stream"

    return send_file(path, mimetype=mime)


if __name__ == "__main__":
    (BASE_DIR / "models").mkdir(exist_ok=True)
    TEMP_DIR.mkdir(exist_ok=True)
    PRESET_DIR.mkdir(exist_ok=True)

    print(f"MODEL_PATH : {MODEL_PATH}")
    print(f"TEMP_DIR   : {TEMP_DIR}")
    print(f"PRESET_DIR : {PRESET_DIR}")

    app.run(host="0.0.0.0", port=5000, debug=False)
