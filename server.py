from flask import Flask, send_file, jsonify, request, make_response
from flask_cors import CORS
from pathlib import Path
import uuid
import time
import shutil
import os

app = Flask(__name__)

# --- CONFIGURAZIONE CORS ---
# Espone l'header custom X-Model-Id per permettere al frontend di leggere l'ID del modello generato
CORS(
    app,
    resources={r"/*": {"origins": "*"}},
    methods=["GET", "POST", "OPTIONS", "PUT", "DELETE"],
    allow_headers="*",
    expose_headers=["X-Model-Id"]
)

# --- CONFIGURAZIONE PERCORSI (FILESYSTEM) ---
BASE_DIR = Path(__file__).parent.resolve()
MODEL_PATH = BASE_DIR / "models" / "super_mario_bros_coin.glb"  # Modello base per simulazione
TEMP_DIR = BASE_DIR / "temp_assets"                            # Directory modelli generati dall'AI
PRESET_DIR = BASE_DIR / "preset_files"                         # Directory modelli caricati dall'utente (Uploader)

# --- FUNZIONI DI UTILITÀ ---
def _safe_filename(name: str) -> bool:
    """Verifica che il nome del file non contenga caratteri pericolosi per il filesystem."""
    if ".." in name or "/" in name or "\\" in name:
        return False
    return True

# ---------------------------------------------------------
# SEZIONE 1: GENERAZIONE E MODELLI AI
# ---------------------------------------------------------

# DA SOSTITUIRE CON PIPE VERA DI GENERAZIONE!!!
@app.route("/generate3dOnly", methods=["POST", "OPTIONS"])
def generate_glb():
    """Simula il processo di sintesi 3D partendo da un prompt testuale."""
    if request.method == "OPTIONS":
        return "", 204
    
    # Simula il tempo di elaborazione neurale
    time.sleep(2)
    
    if not MODEL_PATH.exists():
        return jsonify({"error": "Il modello base non esiste nella cartella models."}), 404
    
    # Genera un ID unico per la sessione di generazione
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

@app.route("/models", methods=["GET"])
def list_generated_models():
    """Recupera la lista di tutti i modelli precedentemente sintetizzati dall'AI."""
    items = []
    if TEMP_DIR.exists():
        for folder in TEMP_DIR.glob("*_out"):
            model_id = folder.name.replace("_out", "")
            mesh_files = list(folder.glob("**/mesh.glb"))
            if mesh_files:
                p = mesh_files[0]
                items.append({
                    "id": model_id,
                    "name": f"AI_Gen_{model_id[:5]}",
                    "size": f"{(p.stat().st_size / 1024 / 1024):.1f}MB"
                })
    return jsonify(items), 200

@app.route("/models/<model_id>", methods=["GET"])
def get_saved_model(model_id: str):
    """Serve il file binario (.glb) di un modello specifico generato dall'AI."""
    candidates = [
        *(TEMP_DIR / f"{model_id}_out").glob("**/mesh.glb"),
        *(TEMP_DIR / f"{model_id}_out").glob("**/mesh_rigged.glb"),
        *(TEMP_DIR / f"{model_id}_out").glob("**/mesh_rigged*.glb"),
    ]
    if not candidates:
        return jsonify({"error": "Modello non trovato"}), 404
    return send_file(candidates[0], mimetype="model/gltf-binary")

@app.route("/models/<model_id>", methods=["DELETE"])
def delete_model(model_id):
    """Rimuove fisicamente la directory e i file di un modello generato."""
    folder_path = TEMP_DIR / f"{model_id}_out"
    if folder_path.exists() and folder_path.is_dir():
        shutil.rmtree(folder_path)
        return jsonify({"status": "deleted"}), 200
    return jsonify({"error": "Model not found"}), 404

# ---------------------------------------------------------
# SEZIONE 2: PRESET E UPLOADS
# ---------------------------------------------------------

@app.route("/presets", methods=["GET"])
def list_presets():
    """Elenca i file .glb e .gltf caricati manualmente nella cartella preset."""
    if not PRESET_DIR.exists():
        return jsonify([]), 200
    items = []
    for p in sorted(PRESET_DIR.glob("*")):
        if not p.is_file() or p.suffix.lower() not in [".glb", ".gltf"]:
            continue
        try:
            ts_ms = int(p.stat().st_mtime * 1000)
        except Exception:
            ts_ms = None
        items.append({"id": p.name, "name": p.stem, "ts": ts_ms})
    return jsonify(items), 200

@app.route("/presets/<preset_id>", methods=["GET"])
def get_preset(preset_id: str):
    """Download o visualizzazione di un file preset specifico."""
    if not _safe_filename(preset_id):
        return jsonify({"error": "Nome preset non valido"}), 400
    path = PRESET_DIR / preset_id
    if not path.exists() or not path.is_file():
        return jsonify({"error": "Preset non trovato"}), 404
    
    mime = "model/gltf-binary" if path.suffix.lower() == ".glb" else "model/gltf+json"
    return send_file(path, mimetype=mime)

@app.route("/presets/upload", methods=["POST"])
def upload_to_presets():
    """Gestisce il caricamento di file .glb dal frontend alla cartella preset."""
    if 'file' not in request.files:
        return jsonify({"error": "Nessun file inviato"}), 400
    file = request.files['file']
    if file.filename == '' or not _safe_filename(file.filename):
        return jsonify({"error": "Nome file non valido"}), 400
    
    save_path = PRESET_DIR / file.filename
    file.save(save_path)
    return jsonify({
        "message": "File salvato nei preset",
        "id": file.filename,
        "name": Path(file.filename).stem
    }), 200

@app.route("/presets/rename", methods=["POST"])
def rename_preset():
    """Rinomina un file esistente nella cartella preset."""
    data = request.json
    old_id = data.get("oldId")
    new_name = data.get("newName")
    
    if not old_id or not new_name or not _safe_filename(new_name):
        return jsonify({"error": "Dati non validi"}), 400

    if not new_name.lower().endswith(".glb"):
        new_name += ".glb"

    old_path = PRESET_DIR / old_id
    new_path = PRESET_DIR / new_name

    if not old_path.exists():
        return jsonify({"error": f"File {old_id} non trovato"}), 404
    if new_path.exists() and old_id != new_name:
        return jsonify({"error": "Un file con questo nome esiste già"}), 400

    try:
        old_path.rename(new_path)
        return jsonify({"status": "success", "newId": new_name}), 200
    except Exception as e:
        print(f"Errore rename: {e}")
        return jsonify({"error": str(e)}), 500

@app.route("/presets/<filename>", methods=["DELETE"])
def delete_preset(filename):
    """Elimina definitivamente un file dalla cartella preset."""
    file_path = PRESET_DIR / filename
    if file_path.exists():
        file_path.unlink()
        return jsonify({"status": "deleted"}), 200
    return jsonify({"error": "File not found"}), 404

# --- AVVIO SERVER ---
if __name__ == "__main__":
    # Assicura l'esistenza delle cartelle necessarie all'avvio
    (BASE_DIR / "models").mkdir(exist_ok=True)
    TEMP_DIR.mkdir(exist_ok=True)
    PRESET_DIR.mkdir(exist_ok=True)
    
    print(f"--- EFESTO BACKEND AVVIATO ---")
    print(f"Modello base: {MODEL_PATH}")
    print(f"Storage AI  : {TEMP_DIR}")
    print(f"Storage User: {PRESET_DIR}")
    print(f"-------------------------------")
    
    app.run(host="0.0.0.0", port=5000, debug=False)