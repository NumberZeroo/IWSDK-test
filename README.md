# IWSDK Front-End

This repository contains **only the web front-end** of TextTo3D-WebXR project.  
It provides the UI for entering prompts, requesting model generation, and interacting with generated models.  
The **actual backend is not included** here. However, a **mock backend** is provided to help test requests and loading flows during development.

## Key Features

- Web interface compatible with multiple environments (desktop, mobile, VR/AR)
- Control panel to:
  - enter a prompt
  - send the prompt to a backend (real or mock) to generate a model (with or without skeleton)
  - interact/play with the generated model
- Background music playback
- Ability to reload previously generated models

## Backend Notes

- The **real backend** is part of the full Project TextTo3D-WebXR (repo available on git) and must be configured separately.
- A **mock backend** is included here for **local testing** of requests and loading behavior.  
  It does **not** perform real model generation.

## Getting Started

```bash
git clone https://github.com/NumberZeroo/IWSDK-test.git
cd IWSDK-test
npm install
npm run dev
