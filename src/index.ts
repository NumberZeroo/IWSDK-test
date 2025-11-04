import {
  AssetManifest,
  AssetType,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SessionMode,
  SRGBColorSpace,
  AssetManager,
  World,
  XRInputManager
} from "@iwsdk/core";

import { PanelSystem } from "./panel.js";

import { RobotSystem } from "./robot.js";

import { EnvironmentType, LocomotionEnvironment } from "@iwsdk/core";

const assets: AssetManifest = {
  chimeSound: {
    url: "/audio/chime.mp3",
    type: AssetType.Audio,
    priority: "background",
  },
  webxr: {
    url: "/textures/webxr.png",
    type: AssetType.Texture,
    priority: "critical",
  },
    simpHouse: {
    url: "/gltf/simp/scene.gltf",
    type: AssetType.GLTF,
    priority: "critical",
  },
    environmentDesk: {
    url: "/gltf/environmentDesk/environmentDesk.gltf",
    type: AssetType.GLTF,
    priority: "critical",
  },
};

World.create(document.getElementById("scene-container") as HTMLDivElement, {
  assets,
  xr: {
    sessionMode: SessionMode.ImmersiveAR, //O ImmersiveVR
    offer: "always",
      features: {
        handTracking: true,
        anchors: true,
        hitTest: true,
        planeDetection: true,
        meshDetection: true,
        layers: true,
    },
  },
  features: {
    locomotion: { useWorker: true },
    grabbing: true,
    physics: true,
    sceneUnderstanding: false,
  },
  level: "/glxf/Composition.glxf",
}).then((world) => {
  const { camera } = world;

  camera.position.set(-4, 1.5, -6);
  camera.rotateY(-Math.PI * 0.75);

  const { scene: envMeshOrigin } = AssetManager.getGLTF("simpHouse")!;
  const envMesh = envMeshOrigin.clone(true);
  envMesh.rotateY(Math.PI);
  envMesh.position.set(0, -0.1, 0);
  world
    .createTransformEntity(envMesh)
    .addComponent(LocomotionEnvironment, { type: EnvironmentType.STATIC });

  const webxrLogoTexture = AssetManager.getTexture("webxr")!;
  webxrLogoTexture.colorSpace = SRGBColorSpace;
  const logoBanner = new Mesh(
    new PlaneGeometry(3.39, 0.96),
    new MeshBasicMaterial({
      map: webxrLogoTexture,
      transparent: true,
    }),
  );
  world.createTransformEntity(logoBanner);
  logoBanner.position.set(0, 1, 1.8);
  logoBanner.rotateY(Math.PI);

  const scene = world.scene;
      
  const xrInput = new XRInputManager({ scene, camera });
  
  const rightPad = xrInput.gamepads.right;
  if(rightPad){
    console.log("Right pad connected:", rightPad);
  }
  else{
    console.log("Right pad not connected");
  }
  if(rightPad?.getButtonPressed('xr-standard-trigger')){
    console.log("Right trigger is pressed");
  }

  world.registerSystem(PanelSystem).registerSystem(RobotSystem);
});
