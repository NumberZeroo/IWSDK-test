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
} from "@iwsdk/core";

export class ErrorPanel extends createSystem({
  errorPanel: {
    required: [PanelUI, PanelDocument],
    where: [eq(PanelUI, "config", "/ui/error-panel.json")],
  },
}) {
    init() {
    this.queries.errorPanel.subscribe("qualify", (entity) => {
      const document = PanelDocument.data.document[entity.index] as UIKitDocument;
      if (!document) return;
    });

    void function showError() {
    const errorText = this.world.getElementById("error-panel") as UIKit.Container;
    errorText.setProperties({ visibility: true });
    }
  }
}
      