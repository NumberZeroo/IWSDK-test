from __future__ import annotations
import os
import re
import uuid
import time
import json
import base64
import shutil
import requests
from pathlib import Path
from typing import Optional, List, Dict

from flask import Flask, send_file, jsonify, request, make_response
from flask_cors import CORS
from werkzeug.utils import secure_filename

# SDK AI
from google import genai
from google.genai import types
from tencentcloud.common import credential
from tencentcloud.common.profile.client_profile import ClientProfile
from tencentcloud.common.profile.http_profile import HttpProfile
from tencentcloud.hunyuan.v20230901 import hunyuan_client, models

# --- CONFIGURAZIONE CHIAVI (HARDCODED) ---
os.environ["GEMINI_API_KEY"] = ""
os.environ["TENCENTCLOUD_SECRET_ID"] = ""
os.environ["TENCENTCLOUD_SECRET_KEY"] = ""
os.environ["TENCENT_REGION"] = "ap-singapore"
os.environ["TENCENT_ENDPOINT"] = "hunyuan.intl.tencentcloudapi.com"

app = Flask(__name__)

# --- CONFIGURAZIONE CORS ---
CORS(
    app,
    resources={r"/*": {"origins": "*"}},
    methods=["GET", "POST", "OPTIONS", "PUT", "DELETE"],
    allow_headers="*",
    expose_headers=["X-Model-Id"]
)

# --- CONFIGURAZIONE PERCORSI ---
BASE_DIR = Path(__file__).parent.resolve()
TEMP_DIR = BASE_DIR / "temp_assets"     # Modelli generati dall'AI
PRESET_DIR = BASE_DIR / "preset_files"  # Modelli caricati dall'utente
MODELS_DIR = BASE_DIR / "models"        # Asset statici

TEMP_DIR.mkdir(exist_ok=True)
PRESET_DIR.mkdir(exist_ok=True)
MODELS_DIR.mkdir(exist_ok=True)

# --- FUNZIONI DI UTILITÀ ---
def _safe_filename(name: str) -> bool:
    if ".." in name or "/" in name or "\\" in name:
        return False
    return True

# ---------------------------------------------------------
# CORE AI LOGIC (GOOGLE + TENCENT)
# ---------------------------------------------------------

# --- FUNZIONE DI MIGLIORAMENTO PROMPT ---
def enhance_prompt(user_prompt: str) -> str:
    """Utilizza Gemini per trasformare un prompt semplice in uno ottimizzato per il 3D."""
    client = genai.Client(vertexai=False, api_key=os.environ["GEMINI_API_KEY"])
    
    system_instruction = (
        "You are an expert 3D character and prop designer. "
        "Your task is to rewrite the user's prompt to generate a perfect 2D reference image for 3D reconstruction. "
        "Rules: \n"
        "1. Describe the object on a PURE WHITE BACKGROUND.\n"
        "2. Specify 'single object, centered, full view'.\n"
        "3. Describe high-quality materials (e.g., 'highly detailed textures, 8k, realistic lighting').\n"
        "4. Avoid any text, watermarks, or cluttered backgrounds.\n"
        "5. Keep the output concise but descriptive."
    )
    
    # Usiamo lo stesso modello o un modello flash per la velocità
    resp = client.models.generate_content(
        model="gemini-2.0-flash", # Più veloce per il testo
        contents=[f"{system_instruction}\n\nUser prompt: {user_prompt}"]
    )
    return resp.text.strip()

# --- FUNZIONE GENERAZIONE IMMAGINE AGGIORNATA ---
def nanobanana_generate_ref_image(prompt, out_path):
    # 1. MIGLIORIAMO IL PROMPT
    enhanced = enhance_prompt(prompt)
    print(f"Prompt Originale: {prompt}")
    print(f"rompt Migliorato: {enhanced}")

    client = genai.Client(vertexai=False, api_key=os.environ["GEMINI_API_KEY"])
    cfg = types.GenerateContentConfig(
        image_config=types.ImageConfig(aspect_ratio="1:1", image_size="1K")
    )
    
    # Usiamo il prompt migliorato qui
    resp = client.models.generate_content(
        model="gemini-3-pro-image-preview",
        contents=[enhanced],
        config=cfg
    )
    
    parts = getattr(resp, "parts", None) or resp.candidates[0].content.parts
    img_data = next((p.inline_data.data for p in parts if p.inline_data), None)
    if not img_data: raise RuntimeError("Google AI non ha generato l'immagine.")
    out_path.write_bytes(base64.b64decode(img_data) if isinstance(img_data, str) else img_data)
    
    print(f"Immagine di riferimento salvata in locale.")

def get_tencent_client():
    cred = credential.Credential(os.environ["TENCENTCLOUD_SECRET_ID"], os.environ["TENCENTCLOUD_SECRET_KEY"])
    hp = HttpProfile(endpoint=os.environ["TENCENT_ENDPOINT"])
    return hunyuan_client.HunyuanClient(cred, os.environ["TENCENT_REGION"], ClientProfile(httpProfile=hp))

# ---------------------------------------------------------
# SEZIONE 1: GENERAZIONE E MODELLI AI
# ---------------------------------------------------------

@app.route("/generate3dOnly", methods=["POST", "OPTIONS"])
def generate_glb():
    if request.method == "OPTIONS":
        return "", 204
    
    data = request.get_json() or {}
    prompt = data.get("prompt", "").strip()
    if not prompt:
        return jsonify({"error": "Prompt richiesto"}), 400

    uid = uuid.uuid4().hex
    # Creazione struttura cartelle coerente con la funzione list_generated_models
    out_dir = TEMP_DIR / f"{uid}_out" / "0"
    out_dir.mkdir(parents=True, exist_ok=True)

    try:
        # 1. GOOGLE: Genera Immagine 2D
        ref_path = out_dir / "ref.png"
        nanobanana_generate_ref_image(prompt, ref_path)
        
        # Salva il prompt per la cronologia
        (out_dir / "prompt.txt").write_text(prompt, encoding="utf-8")

        # 2. TENCENT: Genera Modello 3D
        client = get_tencent_client()
        img_b64 = base64.b64encode(ref_path.read_bytes()).decode("utf-8")
        
        # Chiamata JSON-based per massima compatibilità SDK
        params = {"ImageBase64": img_b64, "GenerateType": "Normal"}
        response_json = client.call_json("SubmitHunyuanTo3DProJob", params)
        job_id = response_json.get("Response", {}).get("JobId")
        
        if not job_id:
            response_json = client.call_json("SubmitHunyuanTo3DJob", params)
            job_id = response_json.get("Response", {}).get("JobId")

        # 3. POLLING: Attesa completamento
        glb_path = out_dir / "mesh.glb"
        done = False
        for _ in range(120):
            q_params = {"JobId": job_id}
            # Tenta query Pro o Standard
            try:
                q_resp = client.call_json("QueryHunyuanTo3DProJob", q_params).get("Response", {})
            except:
                q_resp = client.call_json("QueryHunyuanTo3DJob", q_params).get("Response", {})

            if q_resp.get("Status") == "DONE":
                results = q_resp.get("ResultFile3Ds", [])
                glb_url = next(f["Url"] for f in results if "glb" in f.get("Url", "").lower())
                glb_path.write_bytes(requests.get(glb_url).content)
                done = True
                break
            elif q_resp.get("Status") == "FAIL":
                raise RuntimeError(q_resp.get("ErrorMessage"))
            time.sleep(4)

        if not done: raise TimeoutError("Tencent generation timeout")

        # 4. RISPOSTA
        resp = make_response(send_file(glb_path, mimetype="model/gltf-binary", as_attachment=True, download_name=f"{uid}.glb"))
        resp.headers["X-Model-Id"] = uid
        return resp

    except Exception as e:
        print(f"ERRORE GENERAZIONE: {e}")
        return jsonify({"error": str(e)}), 500

@app.route("/models", methods=["GET"])
def list_generated_models():
    items = []
    if not TEMP_DIR.exists():
        return jsonify([]), 200

    for folder in TEMP_DIR.glob("*_out"):
        model_id = folder.name.replace("_out", "")
        
        # Cerchiamo il file mesh.glb ovunque dentro la cartella [ID]_out
        mesh_files = list(folder.rglob("mesh.glb"))
        
        if mesh_files:
            p = mesh_files[0] # Questo è il percorso a .../[ID]_out/0/mesh.glb
            
            # CERCA IL PROMPT NELLA STESSA CARTELLA DELLA MESH
            prompt_file = p.parent / "prompt.txt"
            
            if prompt_file.exists():
                try:
                    name = prompt_file.read_text(encoding="utf-8").strip()
                except Exception:
                    name = f"AI_{model_id[:5]}"
            else:
                name = f"AI_{model_id[:5]}"
                
            items.append({
                "id": model_id,
                "name": name,
                "size": f"{(p.stat().st_size / 1024 / 1024):.1f}MB",
                "ts": int(folder.stat().st_mtime * 1000)
            })
            
    # Ordina per i più recenti
    items.sort(key=lambda x: x['ts'], reverse=True)
    return jsonify(items), 200

@app.route("/models/<model_id>", methods=["GET"])
def get_saved_model(model_id: str):
    candidates = list((TEMP_DIR / f"{model_id}_out").rglob("mesh*.glb"))
    if not candidates:
        return jsonify({"error": "Modello non trovato"}), 404
    return send_file(candidates[0], mimetype="model/gltf-binary")

@app.route("/models/<model_id>", methods=["DELETE"])
def delete_model(model_id):
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
    if not PRESET_DIR.exists(): return jsonify([]), 200
    items = []
    for p in sorted(PRESET_DIR.glob("*")):
        if not p.is_file() or p.suffix.lower() not in [".glb", ".gltf"]: continue
        items.append({"id": p.name, "name": p.stem, "ts": int(p.stat().st_mtime * 1000)})
    return jsonify(items), 200

@app.route("/presets/<preset_id>", methods=["GET"])
def get_preset(preset_id: str):
    if not _safe_filename(preset_id): return jsonify({"error": "ID non valido"}), 400
    path = PRESET_DIR / preset_id
    if not path.exists(): return jsonify({"error": "Non trovato"}), 404
    mime = "model/gltf-binary" if path.suffix.lower() == ".glb" else "model/gltf+json"
    return send_file(path, mimetype=mime)

@app.route("/presets/upload", methods=["POST"])
def upload_to_presets():
    if 'file' not in request.files: return jsonify({"error": "No file"}), 400
    file = request.files['file']
    if file.filename == '' or not _safe_filename(file.filename): return jsonify({"error": "Invalid"}), 400
    save_path = PRESET_DIR / secure_filename(file.filename)
    file.save(save_path)
    return jsonify({"message": "OK", "id": save_path.name, "name": save_path.stem}), 200

@app.route("/presets/rename", methods=["POST"])
def rename_preset():
    data = request.json
    old_id, new_name = data.get("oldId"), data.get("newName")
    if not old_id or not new_name or not _safe_filename(new_name): return jsonify({"error": "Error"}), 400
    if not new_name.lower().endswith(".glb"): new_name += ".glb"
    old_path, new_path = PRESET_DIR / old_id, PRESET_DIR / new_name
    if not old_path.exists(): return jsonify({"error": "Not found"}), 404
    old_path.rename(new_path)
    return jsonify({"status": "success", "newId": new_name}), 200

@app.route("/presets/<filename>", methods=["DELETE"])
def delete_preset(filename):
    file_path = PRESET_DIR / filename
    if file_path.exists():
        file_path.unlink()
        return jsonify({"status": "deleted"}), 200
    return jsonify({"error": "Not found"}), 404

if __name__ == "__main__":
    print(f"--- EFESTO BACKEND AVVIATO ---")
    app.run(host="0.0.0.0", port=5000, debug=False)