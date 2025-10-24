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
  OneHandGrabbable,
  DistanceGrabbable,
  XRInputManager,
} from "@iwsdk/core";

export class PanelSystem extends createSystem({
  promptPanel: {
    required: [PanelUI, PanelDocument],
    where: [eq(PanelUI, "config", "/ui/prompt.json")],
  },
}) {
  // memorizzo l’entità musicale per riutilizzarla
  private musicEntity?: Entity;
  
  private static readonly MUSIC_SRC = "/audio/lofi-chill.mp3";

  init() {
    this.queries.promptPanel.subscribe("qualify", (entity) => {
      const document = PanelDocument.data.document[entity.index] as UIKitDocument;
      if (!document) return;

      const generaButton = document.getElementById("genera-button") as UIKit.Text;
      const textPrompt = document.getElementById("text-area") as UIKit.Text;

      generaButton.addEventListener("click", () => {
        // Log del prompt per debug locale
        console.log("Prompt inserito:", textPrompt.currentSignal.v);

        if (!textPrompt.currentSignal.v) {
          //Modifica il pannello per indicare che il prompt è vuoto
          textPrompt.setProperties({ placeholder: "Inserisci un prompt valido." });
          console.warn("Nessun prompt inserito.");
          return;
        }

        fetch("http://127.0.0.1:5000/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: textPrompt.currentSignal.v }),
        })
          .then(async (response) => {
            if (!response.ok) throw new Error(await response.text());
            const blob = await response.blob();
            const glbUrl = URL.createObjectURL(blob);
            return AssetManager.loadGLTF(glbUrl, "dynamicModel");
          })
          .then(() => {
            const { scene: dynamicMesh } = AssetManager.getGLTF("dynamicModel");
            dynamicMesh.position.set(0, 1, -2);
            console.log("dynamicMesh:", dynamicMesh);
            
            const ent =  this.world.createTransformEntity(dynamicMesh)

            setTimeout(() => {
            ent.addComponent(Interactable)
            ent.addComponent(DistanceGrabbable, {
                translate: true,
                rotate: true,
                scale: true,
            });
          }, 100);
          })
          .catch((error) => {
            console.error("Failed to load dynamic asset:", error);
          });  
      });

      // Button per avviare la musica in loop
      const musicButton = document.getElementById("audio-button") as UIKit.Text;
      musicButton.addEventListener("click", () => {
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

        // Avvia (o ri-avvia) la riproduzione
        if (!AudioUtils.isPlaying(this.musicEntity)) {
          AudioUtils.play(this.musicEntity, 0.2);
        } else {
          AudioUtils.pause(this.musicEntity, 0.2);
        }
      });

      //Button per VR/AR
      const vrButton = document.getElementById("vr-ar-button") as UIKit.Text;
      vrButton.addEventListener("click", () => {
        if (this.world.visibilityState.value === VisibilityState.NonImmersive) {
          this.world.launchXR();
        } else {
          this.world.exitXR();
        }
      });
      this.world.visibilityState.subscribe((visibilityState) => {
          if (visibilityState === VisibilityState.NonImmersive) {
            vrButton.setProperties({ text: "VR" });
          } else {
            vrButton.setProperties({ text: "AR" });
          }
      });
    });
  }
}
