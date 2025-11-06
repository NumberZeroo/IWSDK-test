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

  // === NEW: stato in memoria dei modelli salvati + storage locale
  private saved: Array<{ id: string; prompt: string; view: "front"|"side"|null; rig: boolean; ts: number }> = [];
  private _slotModelIds: string[] = new Array(8).fill("");

  private _saveToLS() {
    try { localStorage.setItem("savedModels", JSON.stringify(this.saved)); } catch {}
  }
  private _loadFromLS() {
    try {
      const raw = localStorage.getItem("savedModels");
      if (raw) this.saved = JSON.parse(raw);
    } catch {}
  }
  // === /NEW

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

    // === NEW: carica eventuali ID salvati in precedenza
    this._loadFromLS();
    // === /NEW

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

      // === NEW: riferimenti al pannello "Modelli salvati"
      const savedPanel = this.document.getElementById("saved-panel") as UIKit.Container;
      const savedList  = this.document.getElementById("saved-list")  as UIKit.Container;
      const savedEmpty = this.document.getElementById("saved-empty") as UIKit.Text;
      const savedClose = this.document.getElementById("saved-close-button") as UIKit.Text;
      const savedMore  = this.document.getElementById("saved-load-more") as UIKit.Text;
      const savedBtn   = this.document.getElementById("saved-models-button") as UIKit.Text;

      // bind esplicito ai bottoni degli 8 slot (affidabile con UIKit)
      const slotButtons: UIKit.Text[] = [];
      for (let i = 1; i <= 8; i++) {
        const btn = this.document.getElementById(`saved-btn-${i}`) as UIKit.Text;
        if (btn) {
          slotButtons.push(btn);
          btn.addEventListener("click", async (e:any) => {
            if (!this._consumeOnce(e)) return;
            await this._onSavedSlotClick(i - 1); // indice 0..7
          });
        }
      }
      // === /NEW

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

      // === NEW: handler pannello "Modelli salvati"
      savedBtn.addEventListener("click", (e:any) => {
        if (!this._consumeOnce(e)) return;
        this.openSavedPanel(savedPanel, savedList, savedEmpty);
      });

      savedClose.addEventListener("click", (e:any) => {
        if (!this._consumeOnce(e)) return;
        this.closeSavedPanel(savedPanel);
      });

      // (stub per futura paginazione)
      savedMore.addEventListener("click", (e:any) => {
        if (!this._consumeOnce(e)) return;
        this.renderSavedList(savedList, savedEmpty, { append: true });
      });

      // (RIMOSSO il vecchio listener delegato su savedList per evitare problemi di bubbling in UIKit)
      // === /NEW
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

    // Chiudi il pannello "Modelli salvati" se era aperto
    const savedPanel = this.document?.getElementById("saved-panel") as UIKit.Container;
      if (savedPanel && savedPanel.properties?.value?.visibility === "visible") {
        this.closeSavedPanel(savedPanel);
    }


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
      // === CHANGED: passo anche rig/view; cattureremo l'X-Model-Id in postForModel
      const blob = await this.postForModel("/api/generate", { prompt, rig: true, view: this.selectedView });
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
    // === CHANGED: coerente con front/side
    const prompt = this.buildPrompt(textPrompt?.currentSignal?.v);
    console.log("Prompt inserito:", prompt);

    if (!prompt) {
      textPrompt.setProperties({ placeholder: "Inserisci un prompt valido." });
      console.warn("Nessun prompt inserito.");
      return;
    }

    try {
      // NB: lascia l’endpoint che usi ora; se il backend espone /generate3dOnly con header, metti quello.
      const blob = await this.postForModel("http://127.0.0.1:5000/generate-no-rigging", { prompt, rig: false, view: this.selectedView });
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

  // === CHANGED: cattura X-Model-Id, salva entry, aggiorna lista se aperta
  private async postForModel(url: string, body: { prompt: string; rig?: boolean; view?: "front"|"side"|null }): Promise<Blob> {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const msg = await res.text();
      throw new Error(msg || `Richiesta fallita: ${res.status}`);
    }

    const id = res.headers.get("X-Model-Id") || "";
    const blob = await res.blob();

    if (id) {
      this.saved.push({
        id,
        prompt: body.prompt,
        view: body.view ?? this.selectedView ?? null,
        rig: Boolean(body.rig),
        ts: Date.now(),
      });
      this._saveToLS();

      // se il pannello è aperto, aggiorna la lista
      const savedPanel = this.document?.getElementById("saved-panel") as UIKit.Container;
      if (savedPanel && savedPanel.properties?.value?.visibility === "visible") {
        const list  = this.document!.getElementById("saved-list")  as UIKit.Container;
        const empty = this.document!.getElementById("saved-empty") as UIKit.Text;
        this.renderSavedList(list, empty, { reset: true });
      }
    } else {
      console.warn("X-Model-Id non presente nella risposta.");
    }

    return blob;
  }
  // === /CHANGED

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

  // === NEW: helper per aprire/chiudere pannello e renderizzare la lista
  private openSavedPanel(savedPanel: UIKit.Container, savedList: UIKit.Container, savedEmpty: UIKit.Text) {
  savedPanel.setProperties({ visibility: "visible" });

  // ri-mostra i container base
  savedList.setProperties({ visibility: "visible" });
  savedEmpty.setProperties({ visibility: "visible" });

  this.renderSavedList(savedList, savedEmpty, { reset: true });
}

  private closeSavedPanel(savedPanel: UIKit.Container) {
    // nascondi pannello
    savedPanel.setProperties({ visibility: "hidden" });

    // nascondi esplicitamente lista + empty + tutti gli 8 slot
    const list  = this.document?.getElementById("saved-list")  as UIKit.Container;
    const empty = this.document?.getElementById("saved-empty") as UIKit.Text;

    empty?.setProperties({ visibility: "hidden" });
    list?.setProperties({ visibility: "hidden" });

    for (let i = 1; i <= 8; i++) {
      const row   = this.document?.getElementById(`saved-row-${i}`)   as UIKit.Container;
      const label = this.document?.getElementById(`saved-label-${i}`) as UIKit.Text;
      const btn   = this.document?.getElementById(`saved-btn-${i}`)   as UIKit.Text;

      row?.setProperties({ visibility: "hidden" });
      label?.setProperties({ visibility: "hidden" });
      btn?.setProperties({ visibility: "hidden" });
    }
  }

  private renderSavedList(
    savedList: UIKit.Container,
    savedEmpty: UIKit.Text,
    opts: { reset?: boolean; append?: boolean } = {}
  ) {
    const items = [...this.saved].sort((a,b) => b.ts - a.ts);
    const hasItems = items.length > 0;
    savedEmpty.setProperties({ visibility: hasItems ? "hidden" : "visible" });

    // reset mappa
    this._slotModelIds.fill("");

    // per i primi 8 elementi, riempi slot
    for (let i = 0; i < 8; i++) {
      const row   = this.document!.getElementById(`saved-row-${i+1}`)   as UIKit.Container;
      const label = this.document!.getElementById(`saved-label-${i+1}`) as UIKit.Text;

      const it = items[i];
      if (!row || !label) continue;

      if (!it) {
        // nascondi slot non usati
        row.setProperties({ visibility: "hidden" });
        label.setProperties({ text: "—" });
        this._slotModelIds[i] = "";
        continue;
      }

      const tagView = it.view ? (it.view === "front" ? "Frontale" : "Laterale") : "—";
      const tagRig  = it.rig ? "Rig" : "No rig";
      const shortId = it.id.slice(0, 8);
      const p = it.prompt || "";
      const shortPrompt = p.length > 36 ? (p.slice(0,36) + "…") : p;

      // testo su due righe (prompt + meta). Con UIKit.Text usiamo
      label.setProperties({ text: shortPrompt, visibility: "visible" });
      row.setProperties({ visibility: "visible" });
      const btn = this.document!.getElementById(`saved-btn-${i+1}`) as UIKit.Text;
      btn?.setProperties?.({ visibility: "visible" });


      row.setProperties({ visibility: "visible" });
      this._slotModelIds[i] = it.id;
    }
  }

  // scarica un modello salvato dal backend per ID
  private async getSavedModelBlob(modelId: string): Promise<Blob> {
    // === CHANGED: usa il proxy /api per coerenza con le altre chiamate (evita CORS)
    const res = await fetch(`/api/models/${modelId}`, { method: "GET" });
    console.log("GET /api/models/", modelId, "→", res.status);
    if (!res.ok) {
      const msg = await res.text();
      throw new Error(msg || `Impossibile recuperare il modello ${modelId}`);
    }
    return res.blob();
  }
  // === /NEW

  // === NEW: handler click per uno slot (bottoni saved-btn-1..8)
  private async _onSavedSlotClick(slotIndex: number) {
    const modelId = this._slotModelIds?.[slotIndex];
    if (!modelId) {
      console.warn("Nessun modelId associato allo slot", slotIndex);
      return;
    }

    try {
      console.log("Carico modello salvato:", modelId);
      const blob = await this.getSavedModelBlob(modelId);
      const key = `savedModel-${modelId}`;
      await this.loadModelFromBlob(blob, key);
      const ent = this.placeLoadedModel(key, {x: 0, y: 1, z: -1.2});
      setTimeout(() => {
        ent.addComponent(Interactable).addComponent(TwoHandsGrabbable, {
          translate: true, rotate: true, scale: true,
        });
      }, 100);
    } catch (err) {
      console.error("Errore nel recupero del modello:", err);
      const promptInput = this.document!.getElementById("text-area") as UIKit.Text;
      promptInput?.setProperties?.({placeholder: "Errore nel recupero del modello salvato."});
    }
  }
}
