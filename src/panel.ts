import { createSystem, PanelUI, PanelDocument, eq, VisibilityState, UIKitDocument, UIKit, AssetManager, Entity, Interactable, TwoHandsGrabbable, LocomotionEnvironment } from "@iwsdk/core";
import { XRInputManager } from '@iwsdk/xr-input';
import * as THREE from 'three';

export class PanelSystem extends createSystem({
  promptPanel: { required: [PanelUI, PanelDocument], where: [eq(PanelUI, "config", "/ui/prompt.json")] },
  environments: { required: [LocomotionEnvironment] },
}) {
  private document?: UIKitDocument;
  private listenersBound = false;
  private xrInput?: XRInputManager;
  private selectedView: "front" | "side" | null = null;
  private activeMode: "saved" | "preset" | "primitive" | null = null;

  private saved: any[] = [];
  private presets: any[] = [];
  private readonly primitiveList = [
    { id: "prim_cube", name: "Cube" },
    { id: "prim_sphere", name: "Sphere" },
    { id: "prim_cylinder", name: "Cylinder" },
    { id: "prim_capsule", name: "Capsule" }
  ];

  private currentPage = 0;
  private readonly pageSize = 4;
  private _entitiesById = new Map<string, Entity[]>();
  private _slotIds: string[] = ["", "", "", ""];

  init() {
    this.xrInput = new XRInputManager({ scene: this.world.scene, camera: this.world.camera });
    this._loadFromLS();

    this.queries.promptPanel.subscribe("qualify", (entity) => {
      if (this.listenersBound) return;
      this.listenersBound = true;
      this.document = PanelDocument.data.document[entity.index] as UIKitDocument;

      for (let i = 1; i <= 4; i++) {
        const btn = this.document.getElementById(`btn-${i}`) as UIKit.Text;
        btn?.addEventListener("click", async (e: any) => {
          if (this._consumeOnce(e)) await this._onSlotClick(i - 1);
        });
      }

      this.document.getElementById("front-view-button")?.addEventListener("click", (e: any) => { if (this._consumeOnce(e)) this.pickView("front"); });
      this.document.getElementById("side-view-button")?.addEventListener("click", (e: any) => { if (this._consumeOnce(e)) this.pickView("side"); });
      this.document.getElementById("no-rigging-button")?.addEventListener("click", (e: any) => { if (this._consumeOnce(e)) this.handleGenerateNoRigging(); });
      
      this.document.getElementById("saved-models-button")?.addEventListener("click", (e: any) => { if (this._consumeOnce(e)) this.openSecondary("saved"); });
      this.document.getElementById("preset-models-button")?.addEventListener("click", (e: any) => { if (this._consumeOnce(e)) this.openSecondary("preset"); });
      this.document.getElementById("primitive-button")?.addEventListener("click", (e: any) => { if (this._consumeOnce(e)) this.openSecondary("primitive"); });
      
      this.document.getElementById("secondary-close")?.addEventListener("click", (e: any) => { if (this._consumeOnce(e)) this.closeSecondary(); });
      this.document.getElementById("secondary-more")?.addEventListener("click", (e: any) => {
        if (this._consumeOnce(e)) {
            const data = this.activeMode === "saved" ? this.saved : (this.activeMode === "preset" ? this.presets : this.primitiveList);
            const totalPages = Math.ceil(data.length / this.pageSize);
            if (totalPages > 0) {
                this.currentPage = (this.currentPage + 1) % totalPages;
                this.renderSecondary();
            }
        }
      });
      this.document.getElementById("vr-ar-button")?.addEventListener("click", (e: any) => {
        if (this._consumeOnce(e)) this.world.visibilityState.value === VisibilityState.NonImmersive ? this.world.launchXR() : this.world.exitXR();
      });
    });
  }

  private _loadFromLS() {
    try { const raw = localStorage.getItem("savedModels"); if (raw) this.saved = JSON.parse(raw); } catch {}
  }

  private closeSecondary() {
    const panel = this.document?.getElementById("secondary-panel") as UIKit.Container;
    panel?.setProperties({ visibility: "hidden" });
    const empty = this.document?.getElementById("secondary-empty") as UIKit.Text;
    empty?.setProperties({ visibility: "hidden" });

    for (let i = 1; i <= 4; i++) {
      this.document?.getElementById(`row-${i}`)?.setProperties({ visibility: "hidden" });
      this.document?.getElementById(`label-${i}`)?.setProperties({ text: "?", visibility: "hidden" });
      this.document?.getElementById(`btn-${i}`)?.setProperties({ text: "?", visibility: "hidden" });
      this._slotIds[i-1] = "";
    }
    this.activeMode = null;
  }

  private async openSecondary(mode: "saved" | "preset" | "primitive") {
    this.closeSecondary();
    this.activeMode = mode;
    this.currentPage = 0;
    const panel = this.document?.getElementById("secondary-panel") as UIKit.Container;
    panel?.setProperties({ visibility: "visible" });
    
    if (mode === "preset") {
      try {
        const res = await fetch("/api/presets");
        const data = await res.json();
        this.presets = Array.isArray(data) ? data : (data.items || []);
      } catch { this.presets = []; }
    }
    this.renderSecondary();
  }

  private renderSecondary() {
    const mode = this.activeMode;
    let data: any[] = [];
    if (mode === "saved") data = [...this.saved].sort((a,b) => b.ts - a.ts);
    else if (mode === "preset") data = this.presets;
    else if (mode === "primitive") data = this.primitiveList;
    
    const heading = this.document?.getElementById("secondary-heading") as UIKit.Text;
    heading?.setProperties({ text: mode === "primitive" ? "Primitives" : (mode === "saved" ? "Saved Models" : "Preset Models") });

    const empty = this.document?.getElementById("secondary-empty") as UIKit.Text;
    const hasData = data && data.length > 0;
    empty?.setProperties({ 
        text: mode === "saved" ? "No saved models." : (mode === "primitive" ? "No primitives." : "No presets available."),
        visibility: hasData ? "hidden" : "visible" 
    });

    const totalPages = Math.max(1, Math.ceil(data.length / this.pageSize));
    const start = this.currentPage * this.pageSize;
    const items = data.slice(start, start + this.pageSize);
    this._slotIds = ["", "", "", ""];

    for (let i = 0; i < 4; i++) {
      const row = this.document?.getElementById(`row-${i+1}`) as UIKit.Container;
      const lbl = this.document?.getElementById(`label-${i+1}`) as UIKit.Text;
      const btn = this.document?.getElementById(`btn-${i+1}`) as UIKit.Text;
      const it = items[i];

      if (!it || !hasData) {
        row?.setProperties({ visibility: "hidden" });
        lbl?.setProperties({ text: "?", visibility: "hidden" });
        btn?.setProperties({ visibility: "hidden" });
        continue;
      }
      
      this._slotIds[i] = it.id;
      const title = it.name || it.prompt || it.id;
      lbl?.setProperties({ text: title.length > 35 ? title.slice(0, 35) + "..." : title, visibility: "visible" });
      btn?.setProperties({ text: this._isLoaded(it.id) ? "Delete" : "Load", visibility: "visible" });
      row?.setProperties({ visibility: "visible" });
    }
  }

  private async _onSlotClick(idx: number) {
    const id = this._slotIds[idx];
    if (!id) return;
    const btn = this.document?.getElementById(`btn-${idx+1}`) as UIKit.Text;

    if (this._isLoaded(id)) {
      this._unloadModel(id);
      btn?.setProperties({ text: "Load" });
    } else {
      if (this.activeMode === "primitive") {
        this.createPrimitive(id);
        btn?.setProperties({ text: "Delete" });
      } else {
        try {
          btn?.setProperties({ text: "..." });
          const url = this.activeMode === "saved" ? `/api/models/${id}` : `/api/presets/${encodeURIComponent(id)}`;
          const res = await fetch(url);
          const blob = await res.blob();
          const key = `model-${id}`;
          await AssetManager.loadGLTF(URL.createObjectURL(blob), key);
          const ent = this.placeLoadedModel(key, { x: 0, y: 1, z: -1.2 });
          ent.addComponent(Interactable).addComponent(TwoHandsGrabbable, { translate: true, rotate: true, scale: true });
          this._markLoaded(id, ent);
          btn?.setProperties({ text: "Delete" });
        } catch (e) { btn?.setProperties({ text: "Error" }); }
      }
    }
  }

  private createPrimitive(type: string) {
    let mesh;
    const material = new THREE.MeshStandardMaterial({ color: 0x4ade80 });
    switch(type) {
      case "prim_cube": mesh = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), material); break;
      case "prim_sphere": mesh = new THREE.Mesh(new THREE.SphereGeometry(0.3, 32, 32), material); break;
      case "prim_cylinder": mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.5, 32), material); break;
      case "prim_capsule": mesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.4, 4, 16), material); break;
    }
    if (mesh) {
      mesh.position.set(0, 1, -1.2);
      const ent = this.world.createTransformEntity(mesh);
      ent.addComponent(Interactable).addComponent(TwoHandsGrabbable, { translate: true, rotate: true, scale: true });
      this._markLoaded(type, ent);
    }
  }

  private _isLoaded(id: string) { return (this._entitiesById.get(id)?.length ?? 0) > 0; }
  private _markLoaded(id: string, ent: Entity) {
    const arr = this._entitiesById.get(id) || [];
    arr.push(ent);
    this._entitiesById.set(id, arr);
  }
  private _unloadModel(id: string) {
    this._entitiesById.get(id)?.forEach(e => { try { e.destroy(); } catch{} });
    this._entitiesById.delete(id);
  }

  private pickView(view: "front" | "side") {
    this.selectedView = this.selectedView === view ? null : view;
    const f = this.document?.getElementById("front-view-button") as UIKit.Text;
    const s = this.document?.getElementById("side-view-button") as UIKit.Text;
    f?.setProperties({ backgroundColor: this.selectedView === "front" ? "#4ade80" : "#fafafa" });
    s?.setProperties({ backgroundColor: this.selectedView === "side" ? "#4ade80" : "#fafafa" });
  }

  private async handleGenerateNoRigging() {
    const input = this.document?.getElementById("text-area") as UIKit.Text;
    const base = input?.currentSignal?.v || "";
    if (!base) return;
    this.document?.getElementById("pannello-prompt")?.setProperties({ visibility: "hidden" });
    this.closeSecondary();
    try {
      const prompt = this.selectedView ? `${this.selectedView} view ${base}` : base;
      const res = await fetch("/api/generate3dOnly", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt, rig: true }) });
      const id = res.headers.get("X-Model-Id");
      const blob = await res.blob();
      if (id) { this.saved.push({ id, prompt, ts: Date.now() }); localStorage.setItem("savedModels", JSON.stringify(this.saved)); }
      const key = "dynamicModel";
      await AssetManager.loadGLTF(URL.createObjectURL(blob), key);
      const ent = this.placeLoadedModel(key, { x: 0, y: 1, z: -1 });
      ent.addComponent(Interactable).addComponent(TwoHandsGrabbable, { translate: true, rotate: true, scale: true });
    } catch (e) {}
  }

  private placeLoadedModel(key: string, pos: any): Entity {
    const gltf = AssetManager.getGLTF(key);
    if (!gltf) return this.world.createTransformEntity();
    const mesh = gltf.scene.clone();
    mesh.position.set(pos.x, pos.y, pos.z);
    mesh.rotation.y = Math.PI;
    return this.world.createTransformEntity(mesh);
  }

  private _lastClickAt = 0;
  private _consumeOnce(e: any) {
    const now = Date.now();
    if (now - this._lastClickAt < 200) return false;
    this._lastClickAt = now;
    return true;
  }

  update(dt: number, time: number) {
    if (!this.xrInput || this.world.visibilityState.value === VisibilityState.NonImmersive) return;
    const xr = (this.world as any).xr || (this.world as any).renderer?.xr || (this.world as any).xrManager;
    this.xrInput.update(xr, dt, time);
    if (this.xrInput.gamepads.right?.getButtonDown('b-button')) {
      const p = this.document?.getElementById("pannello-prompt") as UIKit.Container;
      if (!p) return;
      const nextVis = p.properties.value.visibility === "hidden" ? "visible" : "hidden";
      p.setProperties({ visibility: nextVis });
      if (nextVis === "hidden") this.closeSecondary();
    }
  }
}