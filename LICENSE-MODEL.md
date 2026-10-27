# Libraries.dev Model License

Version 1.1 · Effective 27 October 2026

Copyright (c) 2026 Jakub Antalik. All rights reserved except as granted below.

This license covers the machine-learning models published by Libraries.dev:
the magnet model behind Magnetic UI (`Magnet.mfxl`) and the Voice direction
model (`VoiceDirection.mfxl`). The source code around a model (MagnetKit for
iOS and Android, VoiceRingKit and VoiceDirectionKit, and the other
Libraries.dev packages) is MIT and is not covered here; this license applies
only to the model files.

## 1. Definitions

- **Model**: a model file published by Libraries.dev (for example
  `Magnet.mfxl` or `VoiceDirection.mfxl`), its weights and parameters, and
  any copy, conversion, quantization, compression, fine-tune or other
  derivative of them.
- **You**: the individual, or the company or organization, that downloads or
  uses the Model.
- **Plan**: an active Libraries.dev Pro or Business subscription, a Pro
  Lifetime purchase, or a separate written agreement with the Licensor (an
  Enterprise agreement).
- **Commercial Release**: making a product that contains or loads the Model
  available to anyone outside your own development team (through an app
  store, TestFlight or other beta channel open to the public, a website, a
  customer delivery or any other channel), when the product is sold, earns
  revenue (including ads, subscriptions or in-app purchases), is built for a
  client, or is used in the course of a business.
- **Licensor**: Jakub Antalik, the author of Libraries.dev.

## 2. Free use

The Licensor grants you a worldwide, non-exclusive, non-transferable,
royalty-free license to download, run and integrate the Model for:

- development, testing and evaluation;
- prototypes, demos and internal tools that are not a Commercial Release;
- personal and non-commercial projects, including open-source projects that
  earn no revenue, provided they follow section 4.

No Plan is needed for these uses.

## 3. Commercial Release

A Commercial Release requires a Plan held by you:

- **Pro** covers one individual, such as a solo builder or freelancer, for
  unlimited products, client work included.
- **Pro Lifetime** covers the same for 12 months from the purchase date,
  for every Model, including Models released during those 12 months. After
  that, Pro Lifetime is treated as a Plan that has ended: builds released
  during the 12 months may stay available, and a new Commercial Release
  (including an update that ships a Model) needs an active Pro or Business
  subscription. Pro Lifetime purchased before 27 October 2026 covers every
  Model with no end date, whenever it is released.
- **Business** covers a company or organization for unlimited products.
- **Enterprise** terms are set by a separate written agreement.

Builds of a product released while your Plan was active may stay available
after the Plan ends. A new Commercial Release (including an update that ships
the Model) needs an active Plan.

## 4. Conditions

You may distribute the Model only inside the product that uses it (for
example within an app bundle or package), for that product to run. You may
not:

1. distribute, publish, host or share the Model on its own, or in a way that
   lets others take it out and use it apart from your product (for example
   in a public repository, a model hub or a download link);
2. sublicense, sell, rent or lend the Model;
3. use the Model, its weights or its outputs to train, fine-tune, distil or
   evaluate a model that offers similar functionality to the Model, except
   for your own product under this license;
4. remove or change this license or any copyright notice that comes with the
   Model;
5. use the Model in breach of applicable law.

The file format is documented publicly so you can inspect what you ship.
Reading the format does not grant any right beyond this license.

## 5. Ownership

The Licensor keeps all rights, title and interest in the Model. Your
products, and the code and data you create with them, stay yours. Anything not
expressly granted here is reserved.

## 6. Termination

This license ends automatically if you break it. If you fix the breach within
30 days of noticing it or being told about it, your license is restored. When
the license ends, you must stop distributing new copies of the Model. Sections
5, 7 and 8 survive termination.

## 7. No warranty

THE MODEL IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE, ACCURACY AND NON-INFRINGEMENT. The Model
estimates physical quantities from sensor readings and can be wrong. Do not
rely on it where an error could cause injury, damage or financial loss.

## 8. Limitation of liability

IN NO EVENT SHALL THE LICENSOR BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE MODEL OR THE USE OF OR OTHER DEALINGS IN THE
MODEL.

## 9. Earlier versions

Version 1.0 of `Magnet.mfxl` was published from 20 to 24 October 2026 as part
of a repository under the MIT License. Copies obtained in that period keep the
MIT License. Every copy obtained from Libraries.dev after that, and every later
version of the Model, is licensed under this license only.

`VoiceDirection.mfxl` has never been published under any other license.

## 10. Changes to this license

The Licensor may publish new versions of this license. A new version applies
to Model versions released after it is published; the version you received
with a Model continues to apply to that Model version. Version 1.1 adds the
Voice direction model, and limits the Model rights of Pro Lifetime purchased
from 27 October 2026 to 12 months from purchase (section 3); Pro Lifetime
purchased earlier keeps every Model. It changes no other term of version 1.0.

Questions or Enterprise licensing: jakub@libraries.dev
