from flask import Flask, send_file, jsonify, request, make_response
from flask_cors import CORS
import os
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
    time.sleep(2)  # metti 20 se vuoi simulare più "lento"

    if not MODEL_PATH.exists():
        return jsonify({"error": "Il modello non esiste nella cartella models."}), 404

    # 1) genera un id univoco
    uid = uuid.uuid4().hex

    # 2) prepara struttura cartelle tipo quella del backend reale
    out_dir = TEMP_DIR / f"{uid}_out" / "0"
    out_dir.mkdir(parents=True, exist_ok=True)

    # 3) copia il modello finto nel path atteso
    saved_glb = out_dir / "mesh.glb"
    shutil.copyfile(MODEL_PATH, saved_glb)

    # 4) invia il file e l'header X-Model-Id
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
    # Possibili nomi, per compatibilità con il backend "vero"
    candidates = [
        * (TEMP_DIR / f"{model_id}_out").glob("**/mesh.glb"),
        * (TEMP_DIR / f"{model_id}_out").glob("**/mesh_rigged.glb"),
        * (TEMP_DIR / f"{model_id}_out").glob("**/mesh_rigged*.glb"),
    ]

    if not candidates:
        return jsonify({"error": "Modello non trovato"}), 404

    path = candidates[0]
    return send_file(path, mimetype="model/gltf-binary")


if __name__ == "__main__":
    # crea cartelle se mancano
    (BASE_DIR / "models").mkdir(exist_ok=True)
    TEMP_DIR.mkdir(exist_ok=True)

    print(f"MODEL_PATH: {MODEL_PATH}")
    print(f"TEMP_DIR  : {TEMP_DIR}")

    app.run(host="0.0.0.0", port=5000, debug=False)
