# Third-Party Notices

Lightbench is built on the following open-source software and AI models. Each is used under
its own license, reproduced or linked below. All of them permit commercial use.

## Bundled software

| Component | Used for | License | Copyright |
|---|---|---|---|
| [Electron](https://github.com/electron/electron) (incl. Chromium, Node.js) | Desktop app shell | MIT (Chromium/Node notices in `LICENSES.chromium.html` next to `Lightbench.exe`) | © Electron contributors, © GitHub Inc. |
| [LibRaw](https://www.libraw.org/) via [libraw-wasm](https://github.com/ybouane/LibRaw-Wasm) | RAW file decoding | LibRaw: **CDDL-1.0** (chosen from its LGPL-2.1 / CDDL-1.0 dual license) · libraw-wasm: ISC | © 2008-2024 LibRaw LLC · © ybouane |
| [Transformers.js](https://github.com/huggingface/transformers.js) | Running AI models | Apache-2.0 | © Hugging Face |
| [ONNX Runtime Web](https://github.com/microsoft/onnxruntime) | Running AI models (Denoise) | MIT | © Microsoft Corporation |
| [exifr](https://github.com/MikeKovarik/exifr) | Reading photo metadata | MIT | © Mike Kovařík |
| [Leaflet](https://github.com/Leaflet/Leaflet) | Map module | BSD-2-Clause | © Volodymyr Agafonkin, © CloudMade |

**LibRaw source code** is available unmodified from <https://github.com/LibRaw/LibRaw>;
the WebAssembly build used by Lightbench is available from <https://github.com/ybouane/LibRaw-Wasm>.

## AI models (downloaded on first use, run locally)

| Model | Used for | License | Authors |
|---|---|---|---|
| [IS-Net (DIS)](https://github.com/xuebinqin/DIS) ([ONNX](https://huggingface.co/imgly/isnet-general-onnx)) | Select Subject / Background | Apache-2.0 (original weights); ONNX conversion by IMG.LY, MIT | Xuebin Qin et al. |
| [DETR ResNet-50 panoptic](https://huggingface.co/facebook/detr-resnet-50-panoptic) ([ONNX](https://huggingface.co/Xenova/detr-resnet-50-panoptic)) | Select Sky / Landscape / People, Detect Objects, auto-tags | Apache-2.0 | Meta AI (Carion et al.) |
| [SlimSAM-77](https://huggingface.co/Zigeng/SlimSAM-uniform-77) ([ONNX](https://huggingface.co/Xenova/slimsam-77-uniform)) | Select Object (click) | Apache-2.0 | Zigeng Chen et al. (based on Meta's Segment Anything, Apache-2.0) |
| [CLIP ViT-B/32](https://github.com/openai/CLIP) ([ONNX](https://huggingface.co/Xenova/clip-vit-base-patch32)) | Auto-tagging, natural-language search | MIT | OpenAI |
| [SCUNet](https://github.com/cszn/SCUNet) ([ONNX](https://huggingface.co/Heliosoph/scunet-onnx)) | AI Denoise | Apache-2.0 | Kai Zhang et al. |

## Online services

- **Map tiles** © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), data under the ODbL.
- Models and some libraries are downloaded from Hugging Face and the jsDelivr CDN on first use.

## License texts

The full license texts are included in this folder:
`Apache-2.0.txt`, `LibRaw-CDDL-1.0.txt` (and `LibRaw-LGPL-2.1.txt`, `LibRaw-COPYRIGHT.txt`),
`CLIP-LICENSE.txt`, `Electron-LICENSE.txt`, `onnxruntime-LICENSE.txt`,
`exifr-LICENSE.txt`, `Leaflet-LICENSE.txt`.

### ISC License (libraw-wasm)

Copyright (c) ybouane and contributors

Permission to use, copy, modify, and/or distribute this software for any purpose with or
without fee is hereby granted, provided that the above copyright notice and this permission
notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS
SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE
AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT,
NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.
