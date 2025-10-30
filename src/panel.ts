import {
  createSystem,
  PanelUI,
  PanelDocument,
  eq,
  VisibilityState,
  UIKitDocument,
  UIKit,
  AssetManager,
  AudioUtils,
  AudioSource,
  Entity,
  Interactable,
  DistanceGrabbable,
  MovementMode,
  TwoHandsGrabbable,
} from "@iwsdk/core";

import { XRInputManager } from '@iwsdk/xr-input';

export class PanelSystem extends createSystem({
  promptPanel: {
    required: [PanelUI, PanelDocument],
    where: [eq(PanelUI, "config", "/ui/prompt.json")],
  },
}) {
  // memorizzo l’entità musicale per riutilizzarla
  private musicEntity?: Entity;
  private document?: UIKitDocument;

  // XR: manager per i controller
  private xrInput?: XRInputManager;

  private static readonly MUSIC_SRC = "/audio/lofi-chill.mp3";

  init() {
    // Logica pad
    const scene = this.world.scene;
    const camera = this.world.camera;
    this.xrInput = new XRInputManager({ scene, camera });
    

    this.queries.promptPanel.subscribe("qualify", (entity) => {
      this.document = PanelDocument.data.document[entity.index] as UIKitDocument;
      if (!this.document) return;

      const generaButton = this.document.getElementById("genera-button") as UIKit.Text;
      const noRiggingButton = this.document.getElementById("no-rigging-button") as UIKit.Text;
      const textPrompt = this.document.getElementById("text-area") as UIKit.Text;
      const musicButton = this.document.getElementById("audio-button") as UIKit.Text;
      const vrButton = this.document.getElementById("vr-ar-button") as UIKit.Text;

      generaButton.addEventListener(
        "click",
        this.handleGenerateWithRigging.bind(this, this.document, textPrompt)
      );

      noRiggingButton.addEventListener(
        "click",
        this.handleGenerateNoRigging.bind(this, this.document, textPrompt)
      );

      // --- Musica
      musicButton.addEventListener("click", this.playMusic);

      // --- VR/AR
      vrButton.addEventListener("click", this.vrButtonClick);
      this.world.visibilityState.subscribe((visibilityState) => {
        if (visibilityState === VisibilityState.NonImmersive) {
          vrButton.setProperties({ text: "VR" });
        } else {
          vrButton.setProperties({ text: "AR" });
        }
      });
    });
  }

  //Controllo pad ogni frame
  update(dt: number, time: number) { this._tickXR(dt, time); }

  private _tickXR(dt: number, time: number) {
    if (!this.xrInput) return;
    if (this.world.visibilityState.value === VisibilityState.NonImmersive) return; // pad solo in XR

    // recupera handle XR
    const xrHandle = (this.world as any).xr
      ?? (this.world as any).renderer?.xr
      ?? (this.world as any).xrManager
      ?? undefined;

    this.xrInput.update(xrHandle, dt, time);

    const rightPad = this.xrInput.gamepads.right; // SOLO destro
    if (!rightPad) return;

    // Tasto B destro
    if (rightPad.getButtonDown('b-button')) {
      //Refresh della pagina temporaneo
      //Devo fare in modo che, se il pannello è aperto, lo chiuda, altrimenti lo apra
      const panel = this.document?.getElementById("pannello-prompt") as UIKit.Container;
      if (!panel) return;
      console.log("Toggle pannello prompt:", panel.properties.value.visibility);
      panel.setProperties({ visibility: panel.properties.value.visibility === "hidden" ? "visible" : "hidden" });
    }
  }

  /**
   * Genera modello con rigging + TwoHandsGrabbable
   */
  private async handleGenerateWithRigging(document: UIKitDocument, textPrompt: UIKit.Text) {
    const prompt = textPrompt?.currentSignal?.v;
    console.log("Prompt inserito:", prompt);

    if (!prompt) {
      textPrompt.setProperties({ placeholder: "Inserisci un prompt valido." });
      console.warn("Nessun prompt inserito.");
      return;
    }

    try {
      const blob = await this.postForModel("/api/generate", { prompt });
      await this.loadModelFromBlob(blob, "dynamicModel");

      // Nascondo il pannello dopo la generazione
      this.hidePromptPanel(document);

      const ent = this.placeLoadedModel("dynamicModel", { x: 0, y: 1, z: -1 });
      // Delay breve per essere certi che i componenti siano pronti
      setTimeout(() => {
        ent
          .addComponent(Interactable)
          .addComponent(TwoHandsGrabbable, {
            translate: true,
            rotate: true,
            scale: true,
          });
      }, 100);
    } catch (error) {
      this.onGenerationError(error as Error, textPrompt);
    }
  }

  /**
   * Genera modello senza rigging + DistanceGrabbable (MoveFromTarget)
   */
  private async handleGenerateNoRigging(document: UIKitDocument, textPrompt: UIKit.Text) {
    const prompt = textPrompt?.currentSignal?.v;
    console.log("Prompt inserito:", prompt);

    if (!prompt) {
      textPrompt.setProperties({ placeholder: "Inserisci un prompt valido." });
      console.warn("Nessun prompt inserito.");
      return;
    }

    try {
      const blob = await this.postForModel("http://127.0.0.1:5000/generate-no-rigging", { prompt });
      await this.loadModelFromBlob(blob, "dynamicModel");

      // Nascondo il pannello prima della generazione
      this.hidePromptPanel(document);

      const ent = this.placeLoadedModel("dynamicModel", { x: 0, y: 1, z: -2 });
      setTimeout(() => {
        ent
          .addComponent(Interactable)
          .addComponent(DistanceGrabbable, {
            movementMode: MovementMode.MoveFromTarget,
          });
      }, 100);
    } catch (error) {
      this.onGenerationError(error as Error, textPrompt);
    }
  }

  /**
   * POST verso l'endpoint di generazione e ritorna il Blob GLB.
   */
  private async postForModel(url: string, body: unknown): Promise<Blob> {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const msg = await res.text();
      throw new Error(msg || `Richiesta fallita: ${res.status}`);
    }

    return res.blob();
  }

  /**
   * Carica un GLB dal Blob in AssetManager con una chiave specifica.
   */
  private async loadModelFromBlob(blob: Blob, key: string): Promise<void> {
    const glbUrl = URL.createObjectURL(blob);
    await AssetManager.loadGLTF(glbUrl, key);
  }

  /**
   * Recupera il GLTF già caricato e lo posiziona; ritorna l'Entity creata.
   */
  private placeLoadedModel(
    key: string,
    position: { x: number; y: number; z: number }
  ): Entity {
    const gltf = AssetManager.getGLTF(key);
    if (!gltf) {
      // Evita il TypeError del destructuring e ritenta tra pochissimo
      // (non cambia la tua logica: serve solo a non loggare l’errore transitorio)
      setTimeout(() => {
        const retry = AssetManager.getGLTF(key);
        if (!retry) {
          console.warn(`[AssetManager] GLTF '${key}' non ancora pronto.`);
          return;
        }
        const { scene: mesh } = retry;
        mesh.position.set(position.x, position.y, position.z);
        this.world.createTransformEntity(mesh);
      }, 0);
      // Ritorna una entity “placeholder” vuota per coerenza del tipo
      return this.world.createTransformEntity(); 
  }

  const { scene: dynamicMesh } = gltf;
  dynamicMesh.position.set(position.x, position.y, position.z);
  const ent = this.world.createTransformEntity(dynamicMesh);
  return ent;
}

  /**
   * Nasconde il pannello prompt se presente.
   */
  private hidePromptPanel(document: UIKitDocument) {
    const pannelloPrompt = document.getElementById("pannello-prompt") as UIKit.Container;
    if (pannelloPrompt) {
      pannelloPrompt.setProperties({ visibility: "hidden" });
    }
  }

  /**
   * Gestione errore uniforme.
   */
  private onGenerationError(error: Error, textPrompt: UIKit.Text) {
    console.error("Failed to load dynamic asset:", error);
    textPrompt.setProperties({ placeholder: "Errore nella generazione!!." });
    console.warn("Errore nella generazione!!.");
  }

  /**
   * Funzione per la musica di sottofondo.
   */
  private playMusic = () => {
    // Crea l’entità audio solo la prima volta
    if (!this.musicEntity || !this.musicEntity.hasComponent(AudioSource)) {
      this.musicEntity = this.createEntity();
      this.musicEntity.addComponent(AudioSource, {
        src: PanelSystem.MUSIC_SRC,
        loop: true,
        positional: false,
        volume: 0.75,
        autoplay: false,
      });
    }

    // Avvia/pausa
    if (!AudioUtils.isPlaying(this.musicEntity)) {
      AudioUtils.play(this.musicEntity, 0.2);
    } else {
      AudioUtils.pause(this.musicEntity, 0.2);
    }
  };

  /**
   * Funzione per il button VR/AR
   */
  private vrButtonClick = () => {
    if (this.world.visibilityState.value === VisibilityState.NonImmersive) {
      this.world.launchXR();
    } else {
      this.world.exitXR();
    }
  };
}
