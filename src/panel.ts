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
  LocomotionEnvironment,
  EnvironmentType,
} from "@iwsdk/core";

import { XRInputManager } from '@iwsdk/xr-input';

export class PanelSystem extends createSystem({
  promptPanel: {
    required: [PanelUI, PanelDocument],
    where: [eq(PanelUI, "config", "/ui/prompt.json")],
  },
  environments: {
    required: [LocomotionEnvironment],
  },
}) {
  private musicEntity?: Entity;
  private document?: UIKitDocument;

  // evita doppi binding degli handler
  private listenersBound = false;

  private xrInput?: XRInputManager;

  private static readonly MUSIC_SRC = "/audio/lofi-chill.mp3";

  // selected view for prompt
  private selectedView: "front" | "side" | null = null;

  // gate anti “doppio click” - XR infame fa due click per qualche motivo
  private _lastClickAt = 0;
  private _consumeOnce(e: any): boolean {
    e?.stopPropagation?.();
    e?.preventDefault?.();
    const now = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
    if (now - this._lastClickAt < 160) return false; // scarta il secondo evento gemello
    this._lastClickAt = now;
    return true;
  }

  init() {
    const scene = this.world.scene;
    const camera = this.world.camera;
    this.xrInput = new XRInputManager({ scene, camera });

    this.queries.promptPanel.subscribe("qualify", (entity) => {
      // se il pannello si ri-qualifica, non ri-aggiungere i listener
      if (this.listenersBound) return;
      this.listenersBound = true;

      this.document = PanelDocument.data.document[entity.index] as UIKitDocument;
      if (!this.document) return;

      const generaButton = this.document.getElementById("genera-button") as UIKit.Text;
      const noRiggingButton = this.document.getElementById("no-rigging-button") as UIKit.Text;
      const textPrompt = this.document.getElementById("text-area") as UIKit.Text;
      const musicButton = this.document.getElementById("audio-button") as UIKit.Text;
      const vrButton = this.document.getElementById("vr-ar-button") as UIKit.Text;
      const skyboxButton = this.document.getElementById("skybox-button") as UIKit.Text;
      const frontBtn = this.document.getElementById("front-view-button") as UIKit.Text;
      const sideBtn = this.document.getElementById("side-view-button") as UIKit.Text;

      frontBtn.addEventListener("click", (e: any) => {
        if (!this._consumeOnce(e)) return;
        this.pickView("front", frontBtn, sideBtn);
      });

      sideBtn.addEventListener("click", (e: any) => {
        if (!this._consumeOnce(e)) return;
        this.pickView("side", frontBtn, sideBtn);
      });


      generaButton.addEventListener("click", (e: any) => {
        if (!this._consumeOnce(e)) return;
        this.handleGenerateWithRigging(this.document!, textPrompt);
      });

      noRiggingButton.addEventListener("click", (e: any) => {
        if (!this._consumeOnce(e)) return;
        this.handleGenerateNoRigging(this.document!, textPrompt);
      });

      musicButton.addEventListener("click", (e: any) => {
        if (!this._consumeOnce(e)) return;
        this.playMusic();
      });

      vrButton.addEventListener("click", (e: any) => {
        if (!this._consumeOnce(e)) return;
        this.vrButtonClick();
      });

      this.world.visibilityState.subscribe((visibilityState) => {
        if (visibilityState === VisibilityState.NonImmersive) {
          vrButton.setProperties({ text: "AR" });
        } else {
          vrButton.setProperties({ text: "Esci" });
        }
      });

      /** Skybox button handler */
      let isActive = false;
      skyboxButton.addEventListener("click", (e: any) => {
        if (!this._consumeOnce(e)) return;
        console.log("Skybox button clicked");

        // 1) rimuovi/nascondi environment esistenti
        for (const envEntity of this.queries.environments.entities) {
          try { envEntity.removeComponent?.(LocomotionEnvironment); } catch {}
          const obj = envEntity.object3D;
          if (obj) { obj.visible = false; obj.parent?.remove(obj); }
        }

        if (!isActive) {
          const gltf = AssetManager.getGLTF("environmentDesk");
          const envMeshNew = gltf.scene.clone(true);

          // togli l’environment dal raycast della UI
          envMeshNew.traverse((o: any) => {
            if (o?.isMesh) { o.raycast = () => {}; }
          });

          envMeshNew.rotation.set(0, Math.PI, 0);
          envMeshNew.position.set(0, -0.1, 0);

          this.world
            .createTransformEntity(envMeshNew)
            .addComponent(LocomotionEnvironment, { type: EnvironmentType.STATIC });

          isActive = true;
        } else {
          const gltf = AssetManager.getGLTF("simpHouse");
          const envMeshNewNew = gltf.scene.clone(true);

          envMeshNewNew.traverse((o: any) => {
            if (o?.isMesh) { o.raycast = () => {}; }
          });

          envMeshNewNew.rotation.set(0, Math.PI, 0);
          envMeshNewNew.position.set(0, -0.1, 0);

          this.world
            .createTransformEntity(envMeshNewNew)
            .addComponent(LocomotionEnvironment, { type: EnvironmentType.STATIC });

          isActive = false;
        }
      });
    });
  }

  update(dt: number, time: number) { this._tickXR(dt, time); }

  /** Costruisce il prompt con la vista selezionata */
  private buildPrompt(baseRaw: unknown): string {
    const base = (baseRaw ?? "").toString().trim();
    if (!base) return "";
    if (this.selectedView === "front") return `front view ${base}`;
    if (this.selectedView === "side")  return `side view ${base}`;
    return base;  
  }

  /** Seleziona/deseleziona la vista e aggiorna i bottoni */
  private pickView(
    view: "front" | "side",
    frontBtn: UIKit.Text,
    sideBtn: UIKit.Text
  ) {
    // toggle: se clicchi la stessa, deseleziona
    // Se clicchi di nuovo la stessa, reset
    if (this.selectedView === view) {
      this.selectedView = null;

      frontBtn.setProperties({
        text: "Frontale",
        backgroundColor: "#fafafa",
        color: "#09090b",
      });

      sideBtn.setProperties({
        text: "Laterale",
        backgroundColor: "#fafafa",
        color: "#09090b",
      });

      return;
    }

    this.selectedView = view;

    if (view === "front") {
      frontBtn.setProperties({ backgroundColor: "#4ade80", color: "#09090b" });
      sideBtn.setProperties({ backgroundColor: "#fafafa", color: "#09090b" });
    } else {
      sideBtn.setProperties({ backgroundColor: "#4ade80", color: "#09090b" });
      frontBtn.setProperties({ backgroundColor: "#fafafa", color: "#09090b" });
    }
  }

  /** Gestione input XR */
  private _tickXR(dt: number, time: number) {
    if (!this.xrInput) return;
    if (this.world.visibilityState.value === VisibilityState.NonImmersive) return;

    const xrHandle = (this.world as any).xr
      ?? (this.world as any).renderer?.xr
      ?? (this.world as any).xrManager
      ?? undefined;

    this.xrInput.update(xrHandle, dt, time);

    const rightPad = this.xrInput.gamepads.right;
    if (!rightPad) return;

    if (rightPad.getButtonDown('b-button')) {
      const panel = this.document?.getElementById("pannello-prompt") as UIKit.Container;
      if (!panel) return;
      console.log("Toggle pannello prompt:", panel.properties.value.visibility);
      panel.setProperties({ visibility: panel.properties.value.visibility === "hidden" ? "visible" : "hidden" });
    }
  }

  /** Genera un modello 3D con rigging */
  private async handleGenerateWithRigging(document: UIKitDocument, textPrompt: UIKit.Text) {
    const prompt = this.buildPrompt(textPrompt?.currentSignal?.v);
    console.log("Prompt inserito:", prompt);


    this.hidePromptPanel(document);

    //modello provvisorio fino a che non funziona il server di generazione
    const temp = this.placeLoadedModel("loading", { x: 0, y: 2, z: -1 });
    setTimeout(() => {
        temp
          .addComponent(Interactable)
          .addComponent(TwoHandsGrabbable, {
            translate: true,
            rotate: true,
            scale: true,
          });
      }, 100);

    if (!prompt) {
      textPrompt.setProperties({ placeholder: "Inserisci un prompt valido." });
      console.warn("Nessun prompt inserito.");
      return;
    }

    try {
      const blob = await this.postForModel("/api/generate", { prompt });
      await this.loadModelFromBlob(blob, "dynamicModel");

      //Rimuovi il modello provvisorio
      this.world.entityManager.getEntityByIndex(temp.index)?.destroy();

      const ent = this.placeLoadedModel("dynamicModel", { x: 0, y: 1, z: -1 });
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

  /** Genera un modello 3D senza rigging */
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

  private async loadModelFromBlob(blob: Blob, key: string): Promise<void> {
    const glbUrl = URL.createObjectURL(blob);
    await AssetManager.loadGLTF(glbUrl, key);
  }

  private placeLoadedModel(
    key: string,
    position: { x: number; y: number; z: number }
  ): Entity {
    const gltf = AssetManager.getGLTF(key);
    if (!gltf) {
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
      return this.world.createTransformEntity();
    }

    const { scene: dynamicMesh } = gltf;
    dynamicMesh.position.set(position.x, position.y, position.z);
    const ent = this.world.createTransformEntity(dynamicMesh);
    return ent;
  }

  /** Nasconde il pannello prompt */
  private hidePromptPanel(document: UIKitDocument) {
    const pannelloPrompt = document.getElementById("pannello-prompt") as UIKit.Container;
    if (pannelloPrompt) {
      pannelloPrompt.setProperties({ visibility: "hidden" });
    }
  }

  private onGenerationError(error: Error, textPrompt: UIKit.Text) {
    console.error("Failed to load dynamic asset:", error);
    textPrompt.setProperties({ placeholder: "Errore nella generazione!!." });
    console.warn("Errore nella generazione!!.");
  }

  /** Music button handler */
  private playMusic = () => {
    console.log("Toggling music playback");
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

    if (!AudioUtils.isPlaying(this.musicEntity)) {
      AudioUtils.play(this.musicEntity, 0.2);
    } else {
      AudioUtils.pause(this.musicEntity, 0.2);
    }
  };

  /** VR/AR button handler */
  private vrButtonClick = () => {
    console.log("VR/AR button clicked");
    if (this.world.visibilityState.value === VisibilityState.NonImmersive) {
      this.world.launchXR();
    } else {
      this.world.exitXR();
    }
  };
}
