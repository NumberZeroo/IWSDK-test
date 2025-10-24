from flask import Flask, send_file
from flask_cors import CORS
import os

app = Flask(__name__)

CORS(
    app,
    resources={r"/generate": {"origins": ["https://localhost:8081", "https://127.0.0.1:8081"]}},
    methods=["POST", "OPTIONS"],
    allow_headers=["Content-Type"],
    expose_headers=["Content-Disposition"]  # utile se vuoi leggere il filename lato client
)

# Percorso del modello nella directory 'models'
MODEL_PATH = os.path.join(os.path.dirname(__file__), "models", "super_mario_bros_coin.glb")

@app.route("/generate", methods=["POST"])
def generate_glb():
    """
    Restituisce il file GLB dalla directory models
    """
    if not os.path.exists(MODEL_PATH):
        return {"error": "Il modello non esiste nella cartella models."}, 404

    return send_file(
        MODEL_PATH,
        mimetype="model/gltf-binary",
        as_attachment=True,
        download_name="modello_a_caso.glb"
    )

if __name__ == "__main__":
    # Avvia il server Flask
    app.run(host="0.0.0.0", port=5000)
