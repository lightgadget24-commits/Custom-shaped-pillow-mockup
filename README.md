# LightMax Pillow Lab — prototype 1.0

A browser-based prototype for turning a customer photo into a transparent cutout, using that silhouette to generate a beveled 3D pillow-like mockup, and applying the same texture to both sides. Built with Vite, Three.js and Transformers.js.

## Run locally

```bash
npm install
npm run dev
```

Open the local URL shown by Vite.

## Deploy to Netlify

1. Upload this project to a GitHub repository.
2. In Netlify, choose **Add new site → Import an existing project** and select the repository.
3. Build command: `npm run build`
4. Publish directory: `dist`
5. Use Node 20 or newer.

You can also run `npm run build` locally and drag the generated `dist` folder into Netlify's manual deploy area. For repeatable updates, use Git deployment.

## How to use

1. Upload a JPG, PNG or WebP.
2. Click **Remove background with AI**. On first use, the browser downloads the model, which can be large; allow it to finish.
3. The resulting alpha silhouette is used to trace the outer contour and create a 3D beveled extrusion.
4. Drag the 3D object to rotate, scroll/pinch to zoom, and switch to 2D cutout view.
5. Export the transparent PNG or a screenshot of the current 3D view.

Transparent PNG uploads are used directly without AI background removal.

## Commercial licensing note

The starter currently references BRIA RMBG-1.4 for background removal. BRIA states that this model is available for non-commercial use and commercial use requires a separate commercial agreement. Do not deploy this model for a revenue-generating store until you have confirmed the appropriate license with BRIA, or replace it with a model/service whose license permits your intended commercial use. See https://huggingface.co/briaai/RMBG-1.4.

## Limitations — read before production

- This is a visual prototype, not production-ready manufacturing software.
- General background removal can make mistakes on intricate objects, transparent glass, hair, wheels/spokes, and low-contrast edges. Inspect the cutout.
- The first AI model load can be slow and may fail on unsupported browsers, blocked model hosts, or low-memory devices. A transparent PNG cutout is the fallback.
- The 3D object is a beveled extrusion, not physically simulated stuffed fabric. It does not reproduce realistic bulging, stitching, fabric grain, or accurate pillow compression.
- The front/back textures share the same artwork canvas in the current prototype. Back-side mirroring/orientation and print-template alignment must be verified for your supplier.
- `Download 3D view` exports a PNG screenshot, not a GLB/OBJ 3D file.
- This app does not upload customer images, store designs, create print-ready production templates, or connect to WooCommerce.
- Do not treat a preview PNG as a print-ready file. Confirm production size, bleed, seam allowance, DPI, and orientation with the supplier's actual template.

## Technical references

- Three.js ExtrudeGeometry: https://threejs.org/docs/pages/ExtrudeGeometry.html
- Three.js CanvasTexture: https://threejs.org/docs/pages/CanvasTexture.html
- Transformers.js: https://github.com/huggingface/transformers.js
